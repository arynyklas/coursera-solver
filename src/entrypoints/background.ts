import { browser } from "wxt/browser";
import { defineBackground } from "#imports";
import { createBackgroundHandlers } from "@/background/handlers";
import {
  BACKGROUND_FALLBACKS,
  type BackgroundRequests,
  createMessageRouter,
} from "@/shared/messaging";
import { migrateLegacyGeminiKey } from "@/shared/storage";

export default defineBackground(() => {
  browser.runtime.onMessage.addListener(
    createMessageRouter<BackgroundRequests>(createBackgroundHandlers(), BACKGROUND_FALLBACKS),
  );
  browser.runtime.onInstalled.addListener(() => {
    void migrateLegacyGeminiKey();
  });
  void migrateLegacyGeminiKey();
});
