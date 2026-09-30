import { useEffect, useState } from "react";
import { browser } from "wxt/browser";
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

/** The active tab, read once when the popup opens; `null` until the query settles. */
export function usePageContext(): PageContext | null {
  const [context, setContext] = useState<PageContext | null>(null);

  useEffect(() => {
    let cancelled = false;
    browser.tabs.query({ active: true, currentWindow: true }).then(
      ([tab]) => {
        if (!cancelled) setContext(pageContext(tab?.id ?? null, tab?.url ?? ""));
      },
      () => {
        if (!cancelled) setContext(pageContext(null, ""));
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return context;
}
