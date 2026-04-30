/**
 * handlers/suno.js — HubGrab Suno handler
 *
 * The Suno logic lives in the original content.js (4742 lines).
 * This stub loads it so routing is clean. The actual download
 * logic runs via background.js which is unchanged from v1.0.5.
 *
 * TODO: In a future pass, migrate content.js internals here and
 * remove the separate content.js file entirely.
 */

(function () {
  "use strict";

  // content.js is still loaded separately via manifest for Suno pages
  // as a fallback until full migration. This handler currently serves
  // as a placeholder to signal intent to the router architecture.

  if (window.location.hostname.includes("suno")) {
    console.log("[HubGrab/Suno] Suno handler active — using legacy content.js path");
  }

})();
