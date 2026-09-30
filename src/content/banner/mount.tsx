import { createRoot } from "react-dom/client";
import { type ContentScriptContext, createShadowRootUi } from "#imports";
import { Banner } from "./Banner";
import { type BannerController, createBannerStore } from "./store";

export function createBanner(ctx: ContentScriptContext): BannerController {
  const store = createBannerStore();
  let mounted: Promise<void> | null = null;

  const ensureMounted = () => {
    mounted ??= createShadowRootUi(ctx, {
      name: "coursera-solver-banner",
      position: "inline",
      anchor: "body",
      append: "last",
      onMount(container) {
        const el = document.createElement("div");
        container.append(el);
        const root = createRoot(el);
        root.render(<Banner store={store} />);
        return root;
      },
      onRemove(root) {
        root?.unmount();
      },
    }).then((ui) => ui.mount());
    return mounted;
  };

  return {
    show(content) {
      store.show(content);
      void ensureMounted();
    },
    hide() {
      store.hide();
    },
  };
}
