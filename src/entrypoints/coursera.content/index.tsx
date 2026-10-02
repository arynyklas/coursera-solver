import "./banner.css";
import { browser } from "wxt/browser";
import { defineContentScript } from "#imports";
import { PROVIDERS } from "@/ai/providers";
import { createBanner } from "@/content/banner/mount";
import { connectBridge } from "@/content/bridge-client";
import { createCompletionRunner } from "@/content/completion";
import { createMonacoClient } from "@/content/monaco-client";
import { fetchInPageLanguage } from "@/content/page-language";
import { createContentHandlers } from "@/content/runtime";
import { createSolveRunner } from "@/content/solve";
import { createCourseState } from "@/coursera/course-state";
import { createSessionCredentials } from "@/coursera/session";
import {
  CONTENT_FALLBACKS,
  type ContentRequests,
  createMessageRouter,
  sendToBackground,
} from "@/shared/messaging";
import { getActiveProvider } from "@/shared/storage";

export default defineContentScript({
  matches: ["*://*.coursera.org/learn/*"],
  cssInjectionMode: "ui",
  main(ctx) {
    const location = () => window.location.href;
    const state = createCourseState();
    const session = createSessionCredentials();
    const disconnect = connectBridge(window, {
      onCapture(capture) {
        state.ingestCapture(capture, location());
        session.update(capture);
      },
      onSnapshot(snapshot) {
        state.ingestSnapshot(snapshot, location());
        session.update(snapshot);
      },
    });
    const monaco = createMonacoClient(window);
    const banner = createBanner(ctx);
    const solve = createSolveRunner({
      doc: document,
      monaco,
      banner,
      requestAnswers: (questions) => sendToBackground("solveQuestions", { questions }),
      providerLabel: async () => PROVIDERS[await getActiveProvider()].label,
    });
    const completion = createCompletionRunner({
      location,
      session,
      fetch: fetchInPageLanguage,
      banner,
      delay(ms) {
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, ms);
        return promise;
      },
    });
    const listener = createMessageRouter<ContentRequests>(
      createContentHandlers({
        doc: document,
        location,
        state,
        session,
        monaco,
        solve,
        completion,
        fetch: fetchInPageLanguage,
        draftReply: (messages, currentQuestion) =>
          sendToBackground("draftDialogueReply", { messages, currentQuestion }),
      }),
      CONTENT_FALLBACKS,
    );
    browser.runtime.onMessage.addListener(listener);
    ctx.onInvalidated(() => {
      disconnect();
      browser.runtime.onMessage.removeListener(listener);
    });
  },
});
