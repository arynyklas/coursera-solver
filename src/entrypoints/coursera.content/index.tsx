import { defineContentScript } from "#imports";

export default defineContentScript({
  matches: ["*://*.coursera.org/learn/*"],
  cssInjectionMode: "ui",
  main() {
    // Runtime wiring lands in Task 10.
  },
});
