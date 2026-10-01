import { useEffect, useState } from "react";
import { browser } from "wxt/browser";
import { REFRESH_PAGE_MESSAGE } from "@/shared/messaging";
import { courseSlugFromUrl, isCourseUrl, itemKindFromUrl } from "@/shared/urls";

export interface PageContext {
  tabId: number | null;
  url: string;
  isCourse: boolean;
  courseSlug: string;
  itemKind: string;
}

function pageContext(tabId: number | null, url: string): PageContext {
  const isCourse = isCourseUrl(url);
  return {
    tabId,
    url,
    isCourse,
    courseSlug: isCourse ? courseSlugFromUrl(url) : "",
    itemKind: isCourse ? itemKindFromUrl(url) : "",
  };
}

/** The active tab id for a page action; without one, the page must be refreshed. */
export function requireTabId(context: PageContext): number {
  if (context.tabId === null) throw new Error(REFRESH_PAGE_MESSAGE);
  return context.tabId;
}

/**
 * The active tab, read when the popup opens and followed while the popup stays open, as it does
 * after a requirement link navigates the tab. A navigation counts once the tab has finished
 * loading, so the new page's content script is there to answer. `null` until the query settles.
 */
export function usePageContext(): PageContext | null {
  const [context, setContext] = useState<PageContext | null>(null);

  useEffect(() => {
    let cancelled = false;
    let tabId: number | null = null;
    const onUpdated: Parameters<typeof browser.tabs.onUpdated.addListener>[0] = (id, _, tab) => {
      if (id !== tabId || tab.status !== "complete") return;
      const url = tab.url ?? "";
      setContext((current) => (current?.url === url ? current : pageContext(id, url)));
    };
    browser.tabs.onUpdated.addListener(onUpdated);
    browser.tabs.query({ active: true, currentWindow: true }).then(
      ([tab]) => {
        if (cancelled) return;
        tabId = tab?.id ?? null;
        setContext(pageContext(tabId, tab?.url ?? ""));
      },
      () => {
        if (!cancelled) setContext(pageContext(null, ""));
      },
    );
    return () => {
      cancelled = true;
      browser.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);

  return context;
}
