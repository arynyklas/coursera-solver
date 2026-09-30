(function (root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CourseraPresentationKit = api;

  if (root.document) {
    root.CourseraPresentation = api.createBannerPresenter(root.document, root);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const BANNER_ID = "auto-coursera-banner";
  const STYLE_ID = "auto-coursera-styles";

  const THEMES = Object.freeze({
    info: Object.freeze({
      prefix: "⏳",
      backgroundColor: "#2563eb",
      spinner: true
    }),
    success: Object.freeze({
      prefix: "✅",
      backgroundColor: "#16a34a",
      spinner: false
    }),
    error: Object.freeze({
      prefix: "❌",
      backgroundColor: "#ef4444",
      spinner: false
    })
  });

  function normalizeBannerType(type) {
    return Object.prototype.hasOwnProperty.call(THEMES, type) ? type : "info";
  }

  function bannerDescriptor(text, type = "info") {
    const normalizedType = normalizeBannerType(type);
    const theme = THEMES[normalizedType];
    return Object.freeze({
      type: normalizedType,
      text: String(text ?? ""),
      prefix: theme.prefix,
      backgroundColor: theme.backgroundColor,
      spinner: theme.spinner
    });
  }

  function applyBaseStyles(banner) {
    banner.style.position = "fixed";
    banner.style.bottom = "30px";
    banner.style.left = "50%";
    banner.style.transform = "translateX(-50%)";
    banner.style.zIndex = "9999999";
    banner.style.padding = "16px 32px";
    banner.style.color = "white";
    banner.style.fontWeight = "bold";
    banner.style.borderRadius = "50px";
    banner.style.boxShadow = "0 10px 25px rgba(0,0,0,0.5)";
    banner.style.fontFamily = "ui-sans-serif, system-ui, -apple-system, sans-serif";
    banner.style.fontSize = "16px";
    banner.style.transition = "opacity 0.3s ease";
  }

  function ensureSpinnerStyle(doc) {
    if (doc.getElementById(STYLE_ID)) return;
    const style = doc.createElement("style");
    style.id = STYLE_ID;
    style.textContent = "@keyframes auto-coursera-spin { 100% { transform: rotate(360deg); } }";
    doc.head.appendChild(style);
  }

  function clearChildren(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function renderBannerContent(doc, banner, descriptor) {
    clearChildren(banner);

    if (descriptor.spinner) {
      ensureSpinnerStyle(doc);
      const spinner = doc.createElement("span");
      spinner.textContent = descriptor.prefix;
      spinner.setAttribute("aria-hidden", "true");
      spinner.style.display = "inline-block";
      spinner.style.marginRight = "8px";
      spinner.style.animation = "auto-coursera-spin 1s linear infinite";
      banner.appendChild(spinner);
      banner.appendChild(doc.createTextNode(descriptor.text));
      return;
    }

    banner.textContent = `${descriptor.prefix} ${descriptor.text}`;
  }

  function createBannerPresenter(doc, scheduler = globalThis) {
    if (!doc || typeof doc.createElement !== "function") {
      throw new TypeError("A DOM document is required to create the banner presenter.");
    }

    let hideTimer = null;

    function cancelPendingRemoval() {
      if (hideTimer == null) return;
      if (typeof scheduler.clearTimeout === "function") scheduler.clearTimeout(hideTimer);
      hideTimer = null;
    }

    function show(text, type = "info") {
      cancelPendingRemoval();
      const descriptor = bannerDescriptor(text, type);
      let banner = doc.getElementById(BANNER_ID);

      if (!banner) {
        banner = doc.createElement("div");
        banner.id = BANNER_ID;
        banner.setAttribute("role", "status");
        banner.setAttribute("aria-live", descriptor.type === "error" ? "assertive" : "polite");
        applyBaseStyles(banner);
        doc.body.appendChild(banner);
      }

      banner.setAttribute("aria-live", descriptor.type === "error" ? "assertive" : "polite");
      banner.style.opacity = "1";
      banner.style.backgroundColor = descriptor.backgroundColor;
      renderBannerContent(doc, banner, descriptor);
      return descriptor;
    }

    function hide() {
      const banner = doc.getElementById(BANNER_ID);
      if (!banner) return false;

      cancelPendingRemoval();
      banner.style.opacity = "0";
      hideTimer = scheduler.setTimeout(() => {
        if (doc.getElementById(BANNER_ID) === banner) banner.remove();
        hideTimer = null;
      }, 300);
      return true;
    }

    return Object.freeze({ show, hide });
  }

  return Object.freeze({
    BANNER_ID,
    STYLE_ID,
    bannerDescriptor,
    createBannerPresenter
  });
});
