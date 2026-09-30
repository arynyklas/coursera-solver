import { ExternalLink, Eye, EyeOff, LoaderCircle, type LucideProps } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { isProviderId, PROVIDER_IDS, PROVIDERS } from "@/ai/providers";
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
import { ViewBody } from "@/popup/components/ViewBody";
import { ViewHeader } from "@/popup/components/ViewHeader";
import type { ProviderConfigState } from "@/popup/hooks/useProviderConfig";
import type { Navigate } from "@/popup/navigation";
import { BACKGROUND_FALLBACKS, errorMessage, sendToBackground } from "@/shared/messaging";
import type { ProviderSettingsMap } from "@/shared/storage";
import type { ProviderId } from "@/shared/types";

const CUSTOM_MODEL = "__custom__";
const SUCCESS_REDIRECT_MS = 750;

const FIELD_CLASS = "flex flex-col gap-[5px]";
const LABEL_CLASS = "text-xs";
const CONTROL_CLASS = "h-[34px] w-full rounded-md px-2.5 text-[12.5px] md:text-[12.5px]";
const HINT_CLASS = "text-[11.5px] text-muted-foreground";

interface Form {
  apiKey: string;
  modelChoice: string;
  customModel: string;
}

interface Status {
  tone: "success" | "error" | "muted";
  text: string;
  pending?: boolean;
}

function formFor(provider: ProviderId, settings: ProviderSettingsMap): Form {
  const saved = settings[provider];
  const model = saved?.model || PROVIDERS[provider].defaultModel;
  const isPreset = PROVIDERS[provider].models.some((entry) => entry.id === model);
  return {
    apiKey: saved?.apiKey ?? "",
    modelChoice: isPreset ? model : CUSTOM_MODEL,
    customModel: isPreset ? "" : model,
  };
}

export function Settings({
  config,
  onNavigate,
}: {
  config: ProviderConfigState;
  onNavigate: Navigate;
}) {
  const { save, clear } = config;
  const [editingProvider, setEditingProvider] = useState<ProviderId>(config.activeProvider);
  const [form, setForm] = useState<Form>(() => formFor(config.activeProvider, config.settings));
  const [showKey, setShowKey] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [status, setStatus] = useState<Status | null>(
    config.loadError ? { tone: "error", text: "Could not load saved provider settings." } : null,
  );
  const keyInput = useRef<HTMLInputElement>(null);
  const customInput = useRef<HTMLInputElement>(null);
  const redirect = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(redirect.current), []);

  const provider = PROVIDERS[editingProvider];
  const hasSavedKey = Boolean(config.settings[editingProvider]?.apiKey);
  const isCustom = form.modelChoice === CUSTOM_MODEL;

  function selectProvider(value: string) {
    if (!isProviderId(value)) return;
    setEditingProvider(value);
    setForm(formFor(value, config.settings));
    setShowKey(false);
    setStatus(null);
  }

  async function saveAndVerify() {
    // F7: everything below uses the provider captured at click time, never the live select.
    const target = editingProvider;
    const label = PROVIDERS[target].label;
    const apiKey = form.apiKey.trim();
    const model = isCustom ? form.customModel.trim() : form.modelChoice;

    if (!apiKey) {
      setStatus({ tone: "error", text: "Enter an API key first." });
      keyInput.current?.focus();
      return;
    }
    if (!model) {
      setStatus({ tone: "error", text: "Enter a custom model ID first." });
      customInput.current?.focus();
      return;
    }

    setVerifying(true);
    setStatus({ tone: "muted", text: `Checking ${label}…`, pending: true });
    try {
      const reply = await sendToBackground("verifyProvider", { provider: target, apiKey, model });
      await save(target, { apiKey, model, verifiedAt: Date.now() });
      setStatus({ tone: "success", text: reply.message || `${label} is connected.` });
      window.clearTimeout(redirect.current);
      redirect.current = window.setTimeout(() => onNavigate("home"), SUCCESS_REDIRECT_MS);
    } catch (error) {
      setStatus({ tone: "error", text: errorMessage(error, BACKGROUND_FALLBACKS.verifyProvider) });
    } finally {
      setVerifying(false);
    }
  }

  async function clearSavedKey() {
    const target = editingProvider;
    await clear(target);
    setForm(formFor(target, {}));
    setShowKey(false);
    setStatus({ tone: "success", text: "Saved key cleared." });
  }

  return (
    <>
      <ViewHeader title="AI provider" onBack={() => onNavigate("home")} />
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
          <a
            href={provider.keyUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex w-fit items-center gap-1 text-xs text-brand-text"
          >
            Get a {provider.label} API key
            <ExternalLink className="size-[13px]" aria-hidden />
          </a>
        </div>

        <div className="flex gap-2">
          <Button
            className="h-9 flex-1 rounded-sm text-[13px]"
            onClick={saveAndVerify}
            disabled={verifying}
          >
            {verifying ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
            Save &amp; verify
          </Button>
          <Button
            variant="outline"
            className="h-9 rounded-sm px-3 text-[13px]"
            onClick={clearSavedKey}
            disabled={verifying || !hasSavedKey}
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
          Stored only in this Chrome profile. API usage is billed by your provider.
        </span>
      </ViewBody>
    </>
  );
}

function SpinningLoader({ className, ...props }: LucideProps) {
  return <LoaderCircle className={cn(className, "animate-spin")} {...props} />;
}
