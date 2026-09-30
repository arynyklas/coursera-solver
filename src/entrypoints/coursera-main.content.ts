import { defineContentScript } from "#imports";
import { installInterceptor } from "@/main-world/interceptor";
import { installMonacoHost } from "@/main-world/monaco-host";

export default defineContentScript({
  matches: ["*://*.coursera.org/learn/*"],
  world: "MAIN",
  runAt: "document_start",
  main() {
    installInterceptor(window);
    installMonacoHost(window);
  },
});
