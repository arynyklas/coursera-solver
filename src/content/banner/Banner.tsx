import { CircleCheck, LoaderCircle, type LucideIcon, TriangleAlert, X } from "lucide-react";
import { useSyncExternalStore } from "react";
import type { BannerStore, BannerTone } from "./store";

const TONE_ICONS: Record<BannerTone, LucideIcon> = {
  info: LoaderCircle,
  success: CircleCheck,
  error: TriangleAlert,
};

export function Banner({ store }: { store: BannerStore }) {
  const { content, leaving } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  if (!content) return null;

  const { tone, title, description, detail, progress } = content;
  const Icon = TONE_ICONS[tone];
  return (
    <div
      className="csb-card"
      data-tone={tone}
      data-leaving={String(leaving)}
      role="status"
      aria-live={tone === "error" ? "assertive" : "polite"}
    >
      <div className="csb-top">
        <Icon className="csb-icon" aria-hidden="true" />
        <span className="csb-title">{title}</span>
        <button type="button" aria-label="Dismiss" className="csb-close" onClick={store.hide}>
          <X size={14} aria-hidden="true" />
        </button>
      </div>
      {description != null && (
        <p className="csb-desc">
          {description}
          {detail != null && (
            <>
              {" · "}
              <span className="csb-mono">{detail}</span>
            </>
          )}
        </p>
      )}
      {progress != null && (
        <div className="csb-track">
          <div className="csb-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}
    </div>
  );
}
