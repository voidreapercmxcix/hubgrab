/**
 * router.js — HubGrab content script entry point
 * Detects current site and dynamically loads the correct handler.
 * Injected on all matched pages via manifest content_scripts.
 */

(function () {
  "use strict";

  const hostname = window.location.hostname;

  function loadHandler(path) {
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL(path);
    script.type = "text/javascript";
    (document.head || document.documentElement).appendChild(script);
  }

  if (hostname === "huggingface.co" || hostname.endsWith(".huggingface.co")) {
    loadHandler("handlers/huggingface.js");
    return;
  }

  if (hostname === "suno.com" || hostname.endsWith(".suno.com") || hostname.endsWith(".suno.ai")) {
    loadHandler("handlers/suno.js");
    return;
  }

  // Future handlers: add additional hostname checks here.
  // e.g. if (hostname.includes("civitai.com")) { loadHandler("handlers/civitai.js"); }

})();
