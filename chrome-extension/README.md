# Chrome Extension (MV3)

Relay captured tweet JSON from `x.com` to a local ingest endpoint.

## Files

- `manifest.json`: extension manifest
- `service-worker.js`: action handling + relay/lookup calls to local collector
- `content-script.js`: page/content bridge relay + saved marker rendering
- `page-bridge.js`: installs `window.__X_CLIPPER_CAPTURE_HOOK__` in MAIN world
- `options.html` / `options.js` / `options.css`: extension options UI (`ingestUrl`, token, tags)
- `logs.html` / `logs.js` / `logs.css`: capture logs browser/editor
- `x-clipper.js`: runtime capture script (synced from `../core/x-clipper.js`)

## Sync Rule

After updating `../core/x-clipper.js`, run:

```bash
node ../scripts/sync-extension-clipper.js
```

## Behavior

- Capture action runs only on tweet detail URLs (`/status/<id>`).
- On non-detail pages, action click opens extension options page (with fallback to opening `options.html` tab).
- Content script marks already-saved tweets via collector lookup (`/lookup/seen`).

## Options / Management Flow

- Open extension options from browser extension settings, or click action on a non-status page.
- In options page:
  - `Open Logs`: opens `logs.html`
  - `Open Collector`: opens collector health endpoint (`/healthz`) derived from current ingest URL
  - `Flush Retry Queue` / `Refresh Queue`: manage relay retry queue

## Retry Queue

- Failed relay payloads are queued in extension storage and can be flushed later.
- Runtime message APIs:
  - `x_clipper_retry_status`
  - `x_clipper_retry_flush`
