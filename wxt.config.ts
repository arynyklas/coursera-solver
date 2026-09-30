import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: "src",
  modules: ["@wxt-dev/module-react"],
  vite: () => ({ plugins: [tailwindcss()] }),
  manifest: {
    name: "Coursera Auto Solver",
    description:
      "An AI-powered extension to instantly auto-complete Coursera videos, readings, and automatically solve quizzes.",
    permissions: ["storage"],
    host_permissions: [
      "*://*.coursera.org/*",
      "https://generativelanguage.googleapis.com/*",
      "https://api.openai.com/*",
      "https://api.anthropic.com/*",
      "https://api.x.ai/*",
      "https://api.deepseek.com/*",
      "https://api.groq.com/*",
      "https://openrouter.ai/*",
    ],
  },
});
