/**
 * popup.js — HubGrab popup controller
 * Detects current tab's site and shows relevant controls.
 */

document.addEventListener("DOMContentLoaded", () => {
  const badge   = document.getElementById("site-badge");
  const status  = document.getElementById("status");
  const mainBtn = document.getElementById("main-btn");
  const secBtn  = document.getElementById("secondary-btn");

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    const url = tab?.url || "";

    // ── HuggingFace ──────────────────────────────────────────────────────────
    if (url.includes("huggingface.co")) {
      badge.textContent = "🤗 HuggingFace";
      badge.className = "site-badge hf";

      const isDataset = url.includes("/datasets/");
      if (isDataset) {
        status.innerHTML = `
          <strong>Dataset page detected.</strong><br>
          The HubGrab panel should appear bottom-right on this page.<br>
          If not visible, click the button below to inject it.
        `;
        mainBtn.textContent = "📂 Open HubGrab Panel";
        mainBtn.style.display = "block";
        mainBtn.addEventListener("click", () => {
          chrome.tabs.sendMessage(tab.id, { action: "hubgrab_show_panel" }, (resp) => {
            if (chrome.runtime.lastError) {
              status.innerHTML = `<span style="color:#f87171">Could not reach content script. Try refreshing the page.</span>`;
            } else {
              window.close();
            }
          });
        });
      } else {
        status.innerHTML = `Navigate to a <strong>dataset Files tab</strong> on HuggingFace to use HubGrab.`;
        mainBtn.textContent = "Go to HuggingFace Datasets";
        mainBtn.style.display = "block";
        mainBtn.addEventListener("click", () => {
          chrome.tabs.create({ url: "https://huggingface.co/datasets" });
        });
      }
      return;
    }

    // ── Suno ─────────────────────────────────────────────────────────────────
    if (url.includes("suno.com") || url.includes("suno.ai")) {
      badge.textContent = "🎵 Suno";
      badge.className = "site-badge suno";

      chrome.runtime.sendMessage({ action: "getToken" }, (resp) => {
        if (resp && resp.success) {
          status.innerHTML = `<strong>✅ Token found.</strong> Ready to download tracks.`;
          mainBtn.textContent = "Open Suno Downloader";
        } else {
          status.innerHTML = `<strong>⚠ No token.</strong> Browse Suno to capture your session token.`;
          mainBtn.textContent = "Go to Suno";
        }
        mainBtn.style.display = "block";
        mainBtn.addEventListener("click", () => {
          chrome.tabs.sendMessage(tab.id, { action: "openTrackDownloader" }, () => {
            window.close();
          });
        });
      });
      return;
    }

    // ── Unsupported site ─────────────────────────────────────────────────────
    badge.textContent = "⚪ Unsupported site";
    badge.className = "site-badge none";
    status.innerHTML = `
      HubGrab works on:<br>
      • <strong>huggingface.co</strong> — dataset bulk download<br>
      • <strong>suno.com</strong> — track export<br><br>
      Navigate to a supported site to get started.
    `;
    mainBtn.textContent = "Open HuggingFace Datasets";
    mainBtn.style.display = "block";
    mainBtn.addEventListener("click", () => {
      chrome.tabs.create({ url: "https://huggingface.co/datasets" });
    });
  });
});
