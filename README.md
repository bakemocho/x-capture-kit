# x-capture-kit

X (Twitter) capture toolkit for three runtimes:

- Legacy bookmarklet
- Chrome extension (MV3)
- Safari extension (planned)

This repository is intentionally productized and detached from any private project history.

## Highlights

- Local-first capture: local collector (`http://127.0.0.1:18765/ingest`) to store clips on your machine.
- Taggable archive: manage captured posts with custom tags/notes/archive flags.
- Cross-account friendly: clips from multiple accounts/sessions can be organized with one tag taxonomy.
- Structured output: capture payload is JSON, ready for downstream processing.

## Runtime Positioning

- Primary runtime: Chrome extension (MV3) for day-to-day capture workflow.
- Legacy bookmarklet: fallback for restricted environments and quick manual validation.
- Safari: planned extension; until then, use the bookmarklet path in Safari.

## Operating Model

x-capture-kit is passive and user-triggered.
It does not autonomously browse, post, like, follow, or perform background account actions.
Capture runs only when explicitly invoked by the user.

## Roadmap

- LLM context export (prompt-ready JSON/Markdown views).
- Optional multi-device sync patterns (self-hosted collector / BYO sync setup).

## Structure

- `core/x-clipper.js`: shared capture logic
- `scripts/build-bookmarklet.js`: builds 1-line bookmarklet URL from `core/x-clipper.js`
- `scripts/sync-extension-clipper.js`: syncs `core/x-clipper.js` into Chrome extension runtime file
- `chrome-extension/`: MV3 extension
- `bookmarklet/`: bookmarklet notes
- `safari-extension/`: planning notes and upcoming implementation

## Quick Start

Build bookmarklet string:

```bash
node scripts/build-bookmarklet.js
```

Sync core to extension runtime:

```bash
node scripts/sync-extension-clipper.js
```

Load Chrome extension:

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select `chrome-extension/`

## Notes

- Default collector endpoint is `http://127.0.0.1:18765/ingest`.
- Tag defaults are generic (`research`) and can be changed in options.

## Legal

- License: MIT (`LICENSE`)
- Legal notice and usage responsibility: `LEGAL.md`
