import { defineContentScript } from "#imports";

export default defineContentScript({
  matches: ["*://*.coursera.org/learn/*"],
  world: "MAIN",
  runAt: "document_start",
  main() {
    // Interceptor and Monaco host land in Task 7.
  },
});
