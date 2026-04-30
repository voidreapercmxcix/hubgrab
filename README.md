# 🔥 HubGrab

A Chrome extension for bulk downloading files from HuggingFace — because clicking 50 individual download buttons is nobody's idea of a good time.

## What it does

Adds a floating panel to any HuggingFace repository or dataset page listing all downloadable files with checkboxes, sizes, and a one-click bulk download button.

- ✅ Auto-detects HuggingFace model and dataset pages
- ✅ Lists all files with sizes
- ✅ Junk files (`.gitattributes`, `.gitignore` etc.) unchecked by default — README kept
- ✅ Folder name auto-filled from repo URL, editable before download
- ✅ Max file size filter
- ✅ Batches downloads in groups of 45 with cooldown to stay under Chrome's 50/min limit
- ✅ Works on public repos — uses your existing HuggingFace session cookies for private ones

## Installation

Not yet on the Chrome Web Store. Load it manually:

1. Download or clone this repo
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** and select the `hubgrab` folder
5. Navigate to any HuggingFace repo Files tab — the panel appears bottom-right

## Usage

1. Go to a HuggingFace repo, e.g. `https://huggingface.co/Qwen/Qwen3.6-35B-A3B/tree/main`
2. The HubGrab panel appears bottom-right automatically
   > **Tip:** If the panel doesn't appear, make sure you're on the **Files and versions** tab — the scraper relies on the download links that are only visible there.
3. Check the files you want (or hit **All**)
4. Optionally edit the folder name or set a max file size filter
5. Click **⬇ Download Selected**

> **Note:** Files download to your Chrome download folder. Change it at `chrome://settings/downloads` if needed.

## Supported sites

| Site | Status |
|------|--------|
| HuggingFace (models + datasets) | ✅ Working |
| Suno | ✅ Working (original functionality preserved) |

## Credits

Built on top of **Suno Tracks Exporter v1.0.5** by [UrsoowW](https://www.reddit.com/user/UrsoowW) — a fantastic community tool for bulk exporting Suno tracks. The download queue, rate limiting, retry logic, and background service worker are adapted from that extension.

What I added/changed:
- `handlers/huggingface.js` — HuggingFace file scraper and panel UI (new)
- `router.js` — site detection to load the correct handler (new)
- `popup.js` / `popup.html` — rewritten to be site-aware (new)
- `manifest.json` — broadened permissions and matches (modified)
- `background.js` — added HuggingFace download queue and batch limiter (modified)

The Suno functionality is untouched and fully working alongside the new HuggingFace features.

## Roadmap

- [ ] Subfolder preservation (currently blocked by a Chrome MV3 limitation)
- [ ] Progress indicator per file in the panel
- [ ] Private repo token support
- [ ] More sites (CivitAI, etc.)

## Privacy & Security

- All data stored locally on your device
- No external servers or third parties involved
- Your HuggingFace session cookies never leave your browser
- Open source and transparent — read the code yourself

## Licence

HubGrab additions are MIT. The underlying Suno Tracks Exporter code retains its original terms — credit to UrsoowW.
