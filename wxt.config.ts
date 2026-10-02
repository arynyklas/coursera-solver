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
    // Promise.withResolvers, used by the content scripts, needs Chrome 119.
    minimum_chrome_version: "119",
    permissions: ["storage"],
    host_permissions: [
      "*://*.coursera.org/*",
      // Coursera serves quiz images from CloudFront, and some distributions send no CORS headers,
      // so the background can read those images only with host access.
      "https://*.cloudfront.net/*",
      "https://generativelanguage.googleapis.com/*",
      "https://api.openai.com/*",
      "https://api.anthropic.com/*",
      "https://api.x.ai/*",
      "https://api.deepseek.com/*",
      "https://api.groq.com/*",
      "https://openrouter.ai/*",
    ],
    // vLLM: the popup asks for the entered server's origin alone, when the user loads its models.
    optional_host_permissions: ["http://*/*", "https://*/*"],
  },
});
