/**
 * handlers/huggingface.js — HubGrab HuggingFace dataset handler
 *
 * How HuggingFace file downloads work:
 *   - Dataset file listings are rendered in the DOM as anchor tags
 *     with href like /datasets/{owner}/{repo}/resolve/main/{filepath}
 *   - Clicking those links redirects through HF's resolve endpoint,
 *     which issues a 302 to a signed AWS S3 URL (1hr expiry via XetHub)
 *   - We must request each resolve URL fresh at download time —
 *     do NOT batch S3 URLs upfront as they'll expire before use.
 *   - HF session cookies are sent automatically by the browser on
 *     same-origin requests; no Bearer token interception needed here.
 *
 * Strategy:
 *   1. Scrape file links from the dataset viewer DOM.
 *   2. Inject a floating HubGrab panel with checkboxes + size filter.
 *   3. On "Download Selected", send file list to background.js queue.
 *   4. background.js fetches each resolve URL (following the 302 to S3)
 *      and downloads via chrome.downloads.download().
 */

(function () {
  "use strict";

  // ── Constants ──────────────────────────────────────────────────────────────

  const HF_RESOLVE_PREFIX = "/resolve/";
  const PANEL_ID = "hubgrab-hf-panel";
  const STYLE_ID = "hubgrab-hf-style";

  // ── Utility ────────────────────────────────────────────────────────────────

  function log(...args) {
    console.log("[HubGrab/HF]", ...args);
  }

  function getDatasetBase() {
    // e.g. https://huggingface.co/datasets/owner/repo
    const match = window.location.pathname.match(/^(\/datasets\/[^/]+\/[^/]+)/);
    return match ? match[1] : null;
  }

  /**
   * Pulls a sensible folder name from the current URL.
   * huggingface.co/Qwen/Qwen3.6-35B-A3B/tree/main  → Qwen--Qwen3.6-35B-A3B
   * huggingface.co/datasets/roneneldan/TinyStories   → roneneldan--TinyStories
   */
  function detectFolderName() {
    const p = window.location.pathname.replace(/^\/datasets\//, "/");
    const match = p.match(/^\/([^/]+)\/([^/]+)/);
    if (match) return `${match[1]}--${match[2]}`;
    return "hubgrab-download";
  }

  function isDatasetPage() {
    const p = window.location.pathname;
    // HF datasets: /datasets/owner/repo[/tree/branch/subdir]
    if (p.startsWith("/datasets/")) return true;
    // HF model repos also use the same file listing UI with identical download link markup.
    // Match /owner/repo but exclude top-level nav paths.
    if (/^\/[^/]+\/[^/]+/.test(p) && !p.startsWith("/docs") && !p.startsWith("/blog")) return true;
    return false;
  }

  // ── File link scraper ──────────────────────────────────────────────────────

  /**
   * Scrapes all file download links from the current HF dataset page.
   * HuggingFace file download links use this exact pattern:
   *   <a title="Download file" download href="/user/repo/resolve/main/model.safetensors?download=true">
   * We target the `download` attribute to get only actual file links (not
   * directory nav links that also contain /resolve/ in their href).
   * Returns array of { name, resolveUrl, size }
   */
  function scrapeFileLinks() {
    // Primary selector: anchors with `download` attribute — these are the
    // explicit download buttons HF renders per file in the file tree.
    let anchors = [...document.querySelectorAll('a[href*="/resolve/"][download]')];

    // Fallback: if HF changes markup and loses the `download` attr,
    // catch any resolve link with ?download=true query param.
    if (!anchors.length) {
      anchors = [...document.querySelectorAll("a[href*='/resolve/'][href*='download=true']")];
    }

    // Last resort: any /resolve/ link — broad but better than nothing.
    if (!anchors.length) {
      anchors = [...document.querySelectorAll("a[href*='/resolve/']")];
    }

    const files = [];
    const seen = new Set();

    anchors.forEach((a) => {
      // a.href is the DOM property — always absolute, browser-resolved.
      // a.getAttribute('href') is the raw attribute — may be relative.
      // Use a.href throughout; no origin-prefix logic needed.
      let resolveUrl = a.href;
      if (!resolveUrl || seen.has(resolveUrl)) return;
      seen.add(resolveUrl);

      // Ensure ?download=true is present — HF requires it for direct S3 redirect.
      // Without it the resolve endpoint returns an HTML viewer page instead.
      if (!resolveUrl.includes("download=true")) {
        resolveUrl += (resolveUrl.includes("?") ? "&" : "?") + "download=true";
      }

      // Extract filename — strip query string first, then branch prefix.
      // e.g. https://huggingface.co/user/repo/resolve/main/subdir/model.safetensors?download=true
      //   → subdir/model.safetensors
      const pathOnly = new URL(resolveUrl).pathname;
      const parts = pathOnly.split("/resolve/");
      if (parts.length < 2) return;
      const filePath = parts[1].replace(/^[^/]+\//, ""); // strip branch (main/master/etc.)
      const name = filePath.split("/").pop() || filePath;

      // Try to read displayed size from nearby DOM text (best-effort).
      // HF renders it in a sibling element inside the file row.
      let size = "";
      const row = a.closest("li, tr, [class*='row'], [class*='file']");
      if (row) {
        const text = row.textContent || "";
        const sizeMatch = text.match(/\b(\d+(?:\.\d+)?\s*(?:B|KB|MB|GB|TB))\b/i);
        if (sizeMatch) size = sizeMatch[1];
      }

      // Auto-uncheck known junk files — user can still manually tick them.
      // README is intentionally excluded from this list as it's useful context.
      const JUNK = /^(\.(gitattributes|gitignore|git|DS_Store)|__MACOSX|thumbs\.db|desktop\.ini)$/i;
      const autoChecked = !JUNK.test(name);

      files.push({ name, resolveUrl, size, filePath, autoChecked });
    });

    log(`Scraped ${files.length} file links`);
    return files;
  }


  // ── Inject styles ──────────────────────────────────────────────────────────

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #hubgrab-hf-panel {
        position: fixed;
        bottom: 24px;
        right: 24px;
        width: 360px;
        max-height: 520px;
        background: #1a1a2e;
        color: #e0e0e0;
        border: 1px solid #ff6b35;
        border-radius: 10px;
        box-shadow: 0 4px 24px rgba(0,0,0,0.5);
        font-family: 'Segoe UI', sans-serif;
        font-size: 13px;
        z-index: 999999;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        transition: height 0.2s ease;
      }
      #hubgrab-hf-panel.collapsed { height: 44px; min-height: 44px; }
      #hubgrab-hf-header {
        background: #ff6b35;
        color: #fff;
        padding: 8px 12px;
        font-weight: bold;
        font-size: 14px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        cursor: pointer;
        user-select: none;
        flex-shrink: 0;
      }
      #hubgrab-hf-header span { font-size: 11px; opacity: 0.85; }
      #hubgrab-hf-toolbar {
        padding: 8px 10px;
        border-bottom: 1px solid #333;
        display: flex;
        gap: 8px;
        align-items: center;
        flex-shrink: 0;
        flex-wrap: wrap;
      }
      #hubgrab-hf-toolbar button {
        background: #ff6b35;
        color: #fff;
        border: none;
        border-radius: 5px;
        padding: 4px 10px;
        cursor: pointer;
        font-size: 12px;
        font-weight: 600;
      }
      #hubgrab-hf-toolbar button:hover { background: #e55a25; }
      #hubgrab-hf-toolbar button.secondary {
        background: #2a2a4a;
        border: 1px solid #555;
      }
      #hubgrab-hf-toolbar button.secondary:hover { background: #3a3a5a; }
      #hubgrab-size-filter {
        background: #2a2a4a;
        border: 1px solid #555;
        color: #e0e0e0;
        border-radius: 4px;
        padding: 3px 6px;
        font-size: 12px;
        width: 90px;
      }
      #hubgrab-hf-filelist {
        overflow-y: auto;
        flex: 1;
        padding: 6px 0;
      }
      .hubgrab-file-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 10px;
        border-bottom: 1px solid #2a2a2a;
        cursor: pointer;
      }
      .hubgrab-file-row:hover { background: #22224a; }
      .hubgrab-file-row input[type=checkbox] { accent-color: #ff6b35; flex-shrink: 0; }
      .hubgrab-file-name { flex: 1; word-break: break-all; font-size: 12px; }
      .hubgrab-file-size { color: #888; font-size: 11px; white-space: nowrap; }
      #hubgrab-hf-status {
        padding: 6px 10px;
        font-size: 12px;
        color: #aaa;
        border-top: 1px solid #333;
        flex-shrink: 0;
        min-height: 24px;
      }
    `;
    document.head.appendChild(style);
  }


  // ── Panel builder ──────────────────────────────────────────────────────────

  function buildPanel(files) {
    // Remove existing panel
    const old = document.getElementById(PANEL_ID);
    if (old) old.remove();

    injectStyles();

    const panel = document.createElement("div");
    panel.id = PANEL_ID;

    // Header
    const header = document.createElement("div");
    header.id = "hubgrab-hf-header";
    header.innerHTML = `<b>🔥 HubGrab</b><span>${files.length} files found</span>`;
    header.addEventListener("click", () => panel.classList.toggle("collapsed"));

    // Toolbar
    const toolbar = document.createElement("div");
    toolbar.id = "hubgrab-hf-toolbar";
    toolbar.innerHTML = `
      <input id="hubgrab-folder-name" type="text" value="${escAttr(detectFolderName())}" placeholder="folder name" title="Subfolder inside Downloads/hubgrab/" style="flex:1;min-width:0;background:#2a2a4a;border:1px solid #ff6b35;color:#e0e0e0;border-radius:4px;padding:3px 6px;font-size:12px;" />
      <button id="hg-dl-selected">⬇ Download Selected</button>
      <button id="hg-dl-all" class="secondary">All</button>
      <button id="hg-dl-none" class="secondary">None</button>
      <input id="hubgrab-size-filter" type="text" placeholder="max size e.g. 500MB" title="Filter: hide files larger than this" />
      <button id="hg-refresh" class="secondary" title="Re-scan page">↻</button>
    `;

    // File list
    const listEl = document.createElement("div");
    listEl.id = "hubgrab-hf-filelist";
    renderFileRows(listEl, files);

    // Status bar
    const status = document.createElement("div");
    status.id = "hubgrab-hf-status";
    status.textContent = "Select files and click Download.";

    // One-time setup warning
    const warning = document.createElement("div");
    warning.id = "hubgrab-hf-warning";
    warning.innerHTML = `
      <span>⚙️ Files download to your <strong>Chrome download folder</strong>. Change it in
      <a href="#" id="hg-open-dl-settings" style="color:#ff6b35;">Chrome settings</a>
      if needed.</span>
      <button id="hg-dismiss-warning" title="Dismiss" style="background:none;border:none;color:#888;cursor:pointer;font-size:14px;flex-shrink:0;">✕</button>
    `;
    warning.style.cssText = `
      padding: 7px 10px;
      background: #2a1a0a;
      border-top: 1px solid #ff6b35;
      font-size: 11px;
      color: #ccc;
      display: flex;
      gap: 8px;
      align-items: center;
      flex-shrink: 0;
      line-height: 1.5;
    `;

    panel.appendChild(header);
    panel.appendChild(toolbar);
    panel.appendChild(listEl);
    panel.appendChild(status);
    panel.appendChild(warning);
    document.body.appendChild(panel);

    // Wire up toolbar buttons
    document.getElementById("hg-dl-selected").addEventListener("click", () => {
      const checked = [...document.querySelectorAll(".hubgrab-file-cb:checked")];
      if (!checked.length) { status.textContent = "⚠ No files selected."; return; }
      const folderName = document.getElementById("hubgrab-folder-name").value.trim().replace(/[^a-zA-Z0-9._\-/ ]/g, "_") || detectFolderName();
      const toDownload = checked.map(cb => ({
        name: cb.dataset.name,
        resolveUrl: cb.dataset.url,
        filePath: cb.dataset.filepath,
        folderName
      }));
      status.textContent = `⏳ Queuing ${toDownload.length} file(s)...`;
      chrome.runtime.sendMessage(
        { action: "downloadFiles", files: toDownload, source: "huggingface" },
        (resp) => {
          if (resp && resp.success) {
            status.textContent = `✅ ${toDownload.length} file(s) sent to download queue.`;
          } else {
            status.textContent = `❌ Error: ${resp?.error || "unknown"}`;
          }
        }
      );
    });

    document.getElementById("hg-dl-all").addEventListener("click", () => {
      document.querySelectorAll(".hubgrab-file-cb").forEach(cb => cb.checked = true);
    });
    document.getElementById("hg-dl-none").addEventListener("click", () => {
      document.querySelectorAll(".hubgrab-file-cb").forEach(cb => cb.checked = false);
    });
    document.getElementById("hg-refresh").addEventListener("click", () => {
      status.textContent = "🔄 Re-scanning...";
      const fresh = scrapeFileLinks();
      renderFileRows(listEl, fresh);
      header.querySelector("span").textContent = `${fresh.length} files found`;
      status.textContent = `Found ${fresh.length} file(s).`;
    });
    document.getElementById("hubgrab-size-filter").addEventListener("change", (e) => {
      applyMaxSizeFilter(e.target.value);
    });

    // Warning banner — dismiss persists via storage, open settings via background
    chrome.storage.local.get("hubgrab_warning_dismissed", (r) => {
      if (r.hubgrab_warning_dismissed) warning.style.display = "none";
    });
    document.getElementById("hg-dismiss-warning").addEventListener("click", () => {
      warning.style.display = "none";
      chrome.storage.local.set({ hubgrab_warning_dismissed: true });
    });
    document.getElementById("hg-open-dl-settings").addEventListener("click", (e) => {
      e.preventDefault();
      chrome.runtime.sendMessage({ action: "openDownloadSettings" });
    });
  }


  // ── File row renderer ──────────────────────────────────────────────────────

  function renderFileRows(container, files) {
    container.innerHTML = "";
    if (!files.length) {
      container.innerHTML = `<div style="padding:12px;color:#888">No downloadable files found on this page.<br>Navigate into a dataset's Files tab.</div>`;
      return;
    }
    files.forEach((f) => {
      const row = document.createElement("div");
      row.className = "hubgrab-file-row";
      row.innerHTML = `
        <input type="checkbox" class="hubgrab-file-cb" ${f.autoChecked !== false ? 'checked' : ''}
          data-name="${escAttr(f.name)}"
          data-url="${escAttr(f.resolveUrl)}"
          data-filepath="${escAttr(f.filePath || f.name)}"
          data-rawsize="${escAttr(f.size)}" />
        <span class="hubgrab-file-name" title="${escAttr(f.filePath || f.name)}">${escHtml(f.name)}</span>
        <span class="hubgrab-file-size">${escHtml(f.size)}</span>
      `;
      // Clicking row toggles checkbox
      row.addEventListener("click", (e) => {
        if (e.target.type !== "checkbox") {
          const cb = row.querySelector(".hubgrab-file-cb");
          cb.checked = !cb.checked;
        }
      });
      container.appendChild(row);
    });
  }

  // ── Size filter ────────────────────────────────────────────────────────────

  function parseSizeMB(str) {
    // e.g. "500MB" → 500, "1.2GB" → 1228.8, "200KB" → 0.195
    const m = str.trim().match(/^([\d.]+)\s*(B|KB|MB|GB|TB)$/i);
    if (!m) return null;
    const n = parseFloat(m[1]);
    const unit = m[2].toUpperCase();
    const map = { B: 1 / (1024 * 1024), KB: 1 / 1024, MB: 1, GB: 1024, TB: 1024 * 1024 };
    return n * (map[unit] || 1);
  }

  function applyMaxSizeFilter(filterStr) {
    const maxMB = filterStr ? parseSizeMB(filterStr) : null;
    document.querySelectorAll(".hubgrab-file-row").forEach(row => {
      const rawSize = row.querySelector(".hubgrab-file-cb")?.dataset.rawsize || "";
      if (!maxMB || !rawSize) {
        row.style.display = "";
        return;
      }
      const fileMB = parseSizeMB(rawSize);
      row.style.display = (fileMB !== null && fileMB > maxMB) ? "none" : "";
    });
  }

  // ── HTML helpers ───────────────────────────────────────────────────────────

  function escAttr(s) { return String(s || "").replace(/"/g, "&quot;").replace(/</g, "&lt;"); }
  function escHtml(s) { return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  // ── MutationObserver for SPA navigation ───────────────────────────────────

  let lastPath = window.location.pathname;
  let scanTimeout = null;

  function scheduleScan() {
    clearTimeout(scanTimeout);
    scanTimeout = setTimeout(() => {
      if (!isDatasetPage()) return;
      const files = scrapeFileLinks();
      if (files.length > 0) buildPanel(files);
    }, 1200); // Give React/Vue time to render after nav
  }

  // Watch for HF's client-side page transitions
  const observer = new MutationObserver(() => {
    if (window.location.pathname !== lastPath) {
      lastPath = window.location.pathname;
      log("SPA navigation detected, scheduling scan");
      scheduleScan();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // ── Init ───────────────────────────────────────────────────────────────────

  function init() {
    if (!isDatasetPage()) {
      log("Not a dataset page, skipping");
      return;
    }
    log("Dataset page detected, scanning for files");
    scheduleScan();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // Allow popup "Open HubGrab Panel" button to force a re-scan and show panel
  // Also handles blob URL creation for folder-safe downloads (background SW can't use createObjectURL)
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "hubgrab_show_panel") {
      const files = scrapeFileLinks();
      if (files.length) {
        buildPanel(files);
      } else {
        scheduleScan();
      }
      return;
    }

    // background.js asks us to fetch a URL and return a blob URL it can download
    // This sidesteps the S3 Content-Disposition header overriding our filename
    if (request.action === "hubgrab_fetch_blob") {
      (async () => {
        try {
          const resp = await fetch(request.url, {
            method: "GET",
            credentials: "include",
          });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const blob = await resp.blob();
          const blobUrl = URL.createObjectURL(blob);
          // Revoke after 2 minutes — enough for chrome.downloads to grab it
          setTimeout(() => URL.revokeObjectURL(blobUrl), 120000);
          sendResponse({ success: true, blobUrl });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true; // keep channel open for async response
    }
  });

})();
