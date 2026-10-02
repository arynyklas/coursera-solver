import { ExternalLink, Eye, EyeOff, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeServerUrl } from "@/ai/endpoint";
import { effortFor, isProviderId, PROVIDER_IDS, PROVIDERS, takesEffort } from "@/ai/providers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Note } from "@/popup/components/Note";
import { SpinningLoader } from "@/popup/components/SpinningLoader";
import { HINT_CLASS, ViewBody } from "@/popup/components/ViewBody";
import { ViewHeader } from "@/popup/components/ViewHeader";
import type { ProviderConfigState } from "@/popup/hooks/useProviderConfig";
import { plural } from "@/popup/lib/format";
import { hasServerAccess, requestServerAccess } from "@/popup/lib/server-access";
import type { Navigate } from "@/popup/navigation";
import { BACKGROUND_FALLBACKS, errorMessage, sendToBackground } from "@/shared/messaging";
import { isProviderReady, type ProviderSettingsMap } from "@/shared/storage";
import type { ProviderId, ReasoningEffort } from "@/shared/types";

const CUSTOM_MODEL = "__custom__";
/** The effort choice that sends none, leaving it to a self-hosted server's model. */
const MODEL_DEFAULT = "__model__";
const SUCCESS_REDIRECT_MS = 750;

const FIELD_CLASS = "flex flex-col gap-[5px]";
const LABEL_CLASS = "text-xs";
const CONTROL_CLASS = "h-[34px] w-full rounded-md px-2.5 text-[12.5px] md:text-[12.5px]";

const EFFORT_LABELS: Record<ReasoningEffort, string> = {
  none: "None — No thinking",
  low: "Low — Fast",
  medium: "Medium — Balanced",
  high: "High — Thorough",
};

interface Form {
  apiKey: string;
  modelChoice: string;
  customModel: string;
  /** The server URL as typed; self-hosted providers only. */
  baseUrl: string;
  /** Absent leaves it to the model. */
  effort: ReasoningEffort | undefined;
}

interface Status {
  tone: "success" | "error" | "muted";
  text: string;
  pending?: boolean;
}

function formFor(provider: ProviderId, settings: ProviderSettingsMap): Form {
  const saved = settings[provider];
  const model = saved?.model || PROVIDERS[provider].defaultModel;
  // A self-hosted server has no presets: its saved model is simply the chosen one.
  const isPreset =
    PROVIDERS[provider].selfHosted ||
    PROVIDERS[provider].models.some((entry) => entry.id === model);
  return {
    apiKey: saved?.apiKey ?? "",
    modelChoice: isPreset ? model : CUSTOM_MODEL,
    customModel: isPreset ? "" : model,
    baseUrl: saved?.baseUrl ?? "",
    effort: effortFor(provider, saved?.effort),
  };
}

export function Settings({
  config,
  onNavigate,
}: {
  config: ProviderConfigState;
  onNavigate: Navigate;
}) {
  const { save, clear, clearDraft } = config;
  const [editingProvider, setEditingProvider] = useState<ProviderId>(
    config.draft?.provider ?? config.activeProvider,
  );
  const [form, setForm] = useState<Form>(() => {
    const { draft } = config;
    return draft
      ? {
          apiKey: draft.apiKey,
          modelChoice: draft.model,
          customModel: "",
          baseUrl: draft.baseUrl,
          effort: effortFor(draft.provider, draft.effort),
        }
      : formFor(config.activeProvider, config.settings);
  });
  const [showKey, setShowKey] = useState(false);
  // Stays true from "Save & verify" through the success redirect, so neither Back nor a second
  // Save can race the pending navigation; only a failed check unlocks the form.
  const [verifying, setVerifying] = useState(false);
  const [status, setStatus] = useState<Status | null>(
    config.loadError ? { tone: "error", text: "Could not load saved provider settings." } : null,
  );
  /** The models a self-hosted server listed for the current URL; `null` until loaded. */
  const [serverModels, setServerModels] = useState<string[] | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const keyInput = useRef<HTMLInputElement>(null);
  const customInput = useRef<HTMLInputElement>(null);
  const serverInput = useRef<HTMLInputElement>(null);
  const redirect = useRef<number | undefined>(undefined);
  const mounted = useRef(false);
  /** Bumped when the server or provider changes, so an older model list is dropped. */
  const modelRequest = useRef(0);
  /** What the view opened on: a known server lists its models once from it. */
  const opening = useRef({ provider: editingProvider, form, resumed: config.draft !== null });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      window.clearTimeout(redirect.current);
    };
  }, []);

  /**
   * Lists the server's models. `interactive` runs inside a click and may ask Chrome for access;
   * otherwise it loads only if access was granted before, and stays silent when it was not.
   */
  const loadModels = useCallback(
    async (target: ProviderId, current: Form, interactive: boolean) => {
      let baseUrl: string;
      try {
        baseUrl = normalizeServerUrl(current.baseUrl);
      } catch (error) {
        if (interactive) {
          setStatus({ tone: "error", text: errorMessage(error, BACKGROUND_FALLBACKS.listModels) });
          serverInput.current?.focus();
        }
        return;
      }
      const apiKey = current.apiKey.trim();
      const request = ++modelRequest.current;
      const isLatest = () => mounted.current && request === modelRequest.current;
      const showLoading = () => {
        setLoadingModels(true);
        setStatus({
          tone: "muted",
          text: `Loading models from ${new URL(baseUrl).host}…`,
          pending: true,
        });
      };

      try {
        if (interactive) {
          showLoading();
          // The first await of the click: Chrome prompts only during a user gesture.
          await requestServerAccess({
            provider: target,
            baseUrl,
            apiKey,
            model: current.modelChoice,
            effort: current.effort,
          });
        } else {
          if (!(await hasServerAccess(baseUrl)) || !isLatest()) return;
          showLoading();
        }
        const { models } = await sendToBackground("listModels", {
          provider: target,
          apiKey,
          baseUrl,
        });
        if (!isLatest()) return;
        setServerModels(models);
        setForm((latest) => ({
          ...latest,
          modelChoice: models.includes(latest.modelChoice) ? latest.modelChoice : (models[0] ?? ""),
        }));
        setStatus({
          tone: "success",
          text: `${plural(models.length, "model", "models")} available.`,
        });
      } catch (error) {
        if (isLatest()) {
          setStatus({ tone: "error", text: errorMessage(error, BACKGROUND_FALLBACKS.listModels) });
        }
      } finally {
        if (isLatest()) setLoadingModels(false);
      }
    },
    [],
  );

  useEffect(() => {
    const { provider, form: initialForm, resumed } = opening.current;
    if (resumed) clearDraft();
    if (PROVIDERS[provider].selfHosted && initialForm.baseUrl) {
      void loadModels(provider, initialForm, false);
    }
  }, [clearDraft, loadModels]);

  const provider = PROVIDERS[editingProvider];
  const hasSavedSettings = isProviderReady(editingProvider, config.settings[editingProvider]);
  const isCustom = form.modelChoice === CUSTOM_MODEL;
  const serverModelOptions = serverModels ?? (form.modelChoice ? [form.modelChoice] : []);

  function forgetServerModels() {
    modelRequest.current += 1;
    setServerModels(null);
    setLoadingModels(false);
  }

  function selectProvider(value: string) {
    if (!isProviderId(value)) return;
    const next = formFor(value, config.settings);
    forgetServerModels();
    setEditingProvider(value);
    setForm(next);
    setShowKey(false);
    setStatus(null);
    if (PROVIDERS[value].selfHosted && next.baseUrl) void loadModels(value, next, false);
  }

  function updateServerUrl(baseUrl: string) {
    forgetServerModels();
    setForm((current) => ({ ...current, baseUrl }));
    // A load for the previous URL no longer reports, so its spinner goes too.
    setStatus((current) => (current?.pending ? null : current));
  }

  async function saveAndVerify() {
    // F7: everything below uses the provider captured at click time, never the live select.
    const target = editingProvider;
    const { label, selfHosted } = PROVIDERS[target];
    const apiKey = form.apiKey.trim();
    const model = isCustom ? form.customModel.trim() : form.modelChoice;
    let baseUrl: string | undefined;

    if (selfHosted) {
      try {
        baseUrl = normalizeServerUrl(form.baseUrl);
      } catch (error) {
        setStatus({
          tone: "error",
          text: errorMessage(error, BACKGROUND_FALLBACKS.verifyProvider),
        });
        serverInput.current?.focus();
        return;
      }
      if (!model) {
        setStatus({ tone: "error", text: "Load the server's models, then choose one." });
        return;
      }
    } else if (!apiKey) {
      setStatus({ tone: "error", text: "Enter an API key first." });
      keyInput.current?.focus();
      return;
    } else if (!model) {
      setStatus({ tone: "error", text: "Enter a custom model ID first." });
      customInput.current?.focus();
      return;
    }

    setVerifying(true);
    setStatus({ tone: "muted", text: `Checking ${label}…`, pending: true });
    try {
      // Only a self-hosted provider's settings carry a server URL.
      const server = baseUrl === undefined ? {} : { baseUrl };
      if (baseUrl !== undefined) {
        // The first await of the click: Chrome prompts only during a user gesture.
        await requestServerAccess({
          provider: target,
          baseUrl,
          apiKey,
          model,
          effort: form.effort,
        });
      }
      const reply = await sendToBackground("verifyProvider", {
        provider: target,
        apiKey,
        model,
        ...server,
      });
      // The user verified this key, so it is stored even if the popup view has closed meanwhile.
      await save(target, {
        apiKey,
        model,
        ...(form.effort ? { effort: form.effort } : {}),
        ...server,
        verifiedAt: Date.now(),
      });
      if (!mounted.current) return;
      setStatus({ tone: "success", text: reply.message || `${label} is connected.` });
      redirect.current = window.setTimeout(() => onNavigate("home"), SUCCESS_REDIRECT_MS);
    } catch (error) {
      if (!mounted.current) return;
      setStatus({ tone: "error", text: errorMessage(error, BACKGROUND_FALLBACKS.verifyProvider) });
      setVerifying(false);
    }
  }

  async function clearSavedKey() {
    const target = editingProvider;
    await clear(target);
    forgetServerModels();
    setForm(formFor(target, {}));
    setShowKey(false);
    setStatus({
      tone: "success",
      text: PROVIDERS[target].selfHosted ? "Saved server cleared." : "Saved key cleared.",
    });
  }

  const presetModelFields = (
    <>
      <div className={FIELD_CLASS}>
        <Label htmlFor="model" className={LABEL_CLASS}>
          Model
        </Label>
        <Select
          value={form.modelChoice}
          onValueChange={(modelChoice) => setForm((current) => ({ ...current, modelChoice }))}
          disabled={verifying}
        >
          <SelectTrigger id="model" className={CONTROL_CLASS}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {provider.models.map((model) => (
              <SelectItem key={model.id} value={model.id}>
                {`${model.label} — ${model.hint}`}
              </SelectItem>
            ))}
            <SelectItem value={CUSTOM_MODEL}>Custom model ID…</SelectItem>
          </SelectContent>
        </Select>
        <span className={HINT_CLASS}>Balanced is recommended for most quizzes.</span>
      </div>

      {isCustom ? (
        <div className={FIELD_CLASS}>
          <Label htmlFor="custom-model" className={LABEL_CLASS}>
            Custom model ID
          </Label>
          <Input
            id="custom-model"
            ref={customInput}
            className={cn(CONTROL_CLASS, "font-mono")}
            placeholder="provider/model-name"
            autoComplete="off"
            spellCheck={false}
            value={form.customModel}
            onChange={(event) => {
              const customModel = event.target.value;
              setForm((current) => ({ ...current, customModel }));
            }}
            disabled={verifying}
          />
        </div>
      ) : null}
    </>
  );

  const serverUrlField = (
    <div className={FIELD_CLASS}>
      <Label htmlFor="server-url" className={LABEL_CLASS}>
        Server URL
      </Label>
      <Input
        id="server-url"
        ref={serverInput}
        inputMode="url"
        className={cn(CONTROL_CLASS, "font-mono")}
        placeholder="http://localhost:8000/v1"
        autoComplete="off"
        spellCheck={false}
        value={form.baseUrl}
        onChange={(event) => updateServerUrl(event.target.value)}
        disabled={verifying}
      />
      <span className={HINT_CLASS}>Chrome asks once for access to this server.</span>
    </div>
  );

  const serverModelField = (
    <div className={FIELD_CLASS}>
      <Label htmlFor="model" className={LABEL_CLASS}>
        Model
      </Label>
      <div className="flex gap-2">
        <Select
          value={form.modelChoice}
          onValueChange={(modelChoice) => setForm((current) => ({ ...current, modelChoice }))}
          disabled={verifying || loadingModels || serverModelOptions.length === 0}
        >
          <SelectTrigger id="model" className={cn(CONTROL_CLASS, "min-w-0 flex-1 font-mono")}>
            <SelectValue placeholder="Load the server's models" />
          </SelectTrigger>
          <SelectContent>
            {serverModelOptions.map((id) => (
              <SelectItem key={id} value={id}>
                {id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="icon"
          className="size-[34px] shrink-0 rounded-md"
          aria-label="Load models"
          title="Load models"
          onClick={() => void loadModels(editingProvider, form, true)}
          disabled={verifying || loadingModels}
        >
          {loadingModels ? <SpinningLoader aria-hidden /> : <RefreshCw aria-hidden />}
        </Button>
      </div>
    </div>
  );

  const effortField = (
    <div className={FIELD_CLASS}>
      <Label htmlFor="effort" className={LABEL_CLASS}>
        Reasoning effort
      </Label>
      <Select
        value={form.effort ?? MODEL_DEFAULT}
        onValueChange={(value) => {
          const effort = provider.efforts.find((level) => level === value);
          setForm((current) => ({ ...current, effort }));
        }}
        disabled={verifying}
      >
        <SelectTrigger id="effort" className={CONTROL_CLASS}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {provider.selfHosted ? (
            <SelectItem value={MODEL_DEFAULT}>Model default</SelectItem>
          ) : null}
          {provider.efforts.map((effort) => (
            <SelectItem key={effort} value={effort}>
              {EFFORT_LABELS[effort]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className={HINT_CLASS}>
        {provider.selfHosted
          ? "What a level does depends on the model. None turns thinking off where the model allows it."
          : "How long the model thinks before it answers. Lower answers sooner; High may time out."}
      </span>
    </div>
  );

  const apiKeyField = (
    <div className={FIELD_CLASS}>
      <Label htmlFor="api-key" className={LABEL_CLASS}>
        API key
      </Label>
      <div className="relative">
        <Input
          id="api-key"
          ref={keyInput}
          type={showKey ? "text" : "password"}
          className={cn(CONTROL_CLASS, "pr-9 font-mono")}
          placeholder={provider.keyPlaceholder}
          autoComplete="off"
          spellCheck={false}
          value={form.apiKey}
          onChange={(event) => {
            const apiKey = event.target.value;
            setForm((current) => ({ ...current, apiKey }));
          }}
          disabled={verifying}
        />
        <Button
          variant="ghost"
          size="icon-sm"
          className="absolute top-1/2 right-1 -translate-y-1/2 rounded-sm text-muted-foreground"
          aria-label={showKey ? "Hide API key" : "Show API key"}
          title={showKey ? "Hide API key" : "Show API key"}
          onClick={() => setShowKey((shown) => !shown)}
          disabled={verifying}
        >
          {showKey ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
        </Button>
      </div>
      {provider.keyUrl ? (
        <a
          href={provider.keyUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex w-fit items-center gap-1 text-xs text-brand-text"
        >
          Get a {provider.label} API key
          <ExternalLink className="size-[13px]" aria-hidden />
        </a>
      ) : (
        <span className={HINT_CLASS}>Only needed if the server runs with --api-key.</span>
      )}
    </div>
  );

  return (
    <>
      <ViewHeader title="AI provider" onBack={() => onNavigate("home")} backDisabled={verifying} />
      <ViewBody>
        <div className={FIELD_CLASS}>
          <Label htmlFor="provider" className={LABEL_CLASS}>
            Provider
          </Label>
          <Select value={editingProvider} onValueChange={selectProvider} disabled={verifying}>
            <SelectTrigger id="provider" className={CONTROL_CLASS}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROVIDER_IDS.map((id) => (
                <SelectItem key={id} value={id}>
                  {PROVIDERS[id].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {provider.selfHosted ? (
          <>
            {serverUrlField}
            {apiKeyField}
            {serverModelField}
            {effortField}
          </>
        ) : (
          <>
            {presetModelFields}
            {takesEffort(editingProvider, isCustom ? form.customModel : form.modelChoice)
              ? effortField
              : null}
            {apiKeyField}
          </>
        )}

        <div className="flex gap-2">
          <Button
            className="h-9 flex-1 rounded-sm text-[13px]"
            onClick={saveAndVerify}
            disabled={verifying || loadingModels}
          >
            {status?.pending && verifying ? <SpinningLoader aria-hidden /> : null}
            Save &amp; verify
          </Button>
          <Button
            variant="outline"
            className="h-9 rounded-sm px-3 text-[13px]"
            onClick={clearSavedKey}
            disabled={verifying || !hasSavedSettings}
          >
            Clear
          </Button>
        </div>

        {/* display: contents keeps the always-present live region out of the flex gap. */}
        <div aria-live="polite" className="contents">
          {status ? (
            <Note tone={status.tone} icon={status.pending ? SpinningLoader : undefined}>
              {status.text}
            </Note>
          ) : null}
        </div>

        <span className={HINT_CLASS}>
          Stored only in this Chrome profile.
          {provider.selfHosted ? null : " API usage is billed by your provider."}
        </span>
      </ViewBody>
    </>
  );
}
