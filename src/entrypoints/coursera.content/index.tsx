import { defineContentScript } from "#imports";
import "./banner.css";

export default defineContentScript({
  matches: ["*://*.coursera.org/learn/*"],
  cssInjectionMode: "ui",
  main() {
    // Runtime wiring lands in Task 10.
  },
});
