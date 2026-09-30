import { defineConfig } from "vitest/config";
import { WxtVitest } from "wxt/testing/vitest-plugin";

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    environment: "happy-dom",
    restoreMocks: true,
    // Patterns are relative to --dir (tests/unit or tests/invariants), not to the repo root.
    include: ["**/*.test.ts", "**/*.test.tsx"],
  },
});
