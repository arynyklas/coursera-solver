/**
 * `fetch` for Coursera's API in the language of the page. Coursera names modules and items in the
 * language a request asks for. Its own app asks for its interface language, which `<html lang>`
 * carries, while Chrome's default `Accept-Language` lists the browser's languages, so materials the
 * extension fetched could come back in another language than the materials the page loaded.
 */
export function fetchInPageLanguage(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const request = new Request(input, init);
  const language = document.documentElement.lang;
  if (language) request.headers.set("Accept-Language", language);
  return window.fetch(request);
}
