# Chrome Extension (MV3)

Relay captured tweet JSON from `x.com` to a local collector endpoint.

## Files

- `manifest.json`: extension manifest
- `service-worker.js`: action handling + relay/lookup requests
- `content-script.js`: page bridge + saved marker rendering
- `page-bridge.js`: installs `window.__X_CLIPPER_CAPTURE_HOOK__` in MAIN world
- `options.*`: options UI (`ingestUrl`, token, tags)
- `logs.*`: capture log browser/editor
- `x-clipper.js`: runtime capture script (synced from `../core/x-clipper.js`)

## Sync Rule

After updating `../core/x-clipper.js`, run:

```bash
node ../scripts/sync-extension-clipper.js
```

## Behavior

- Capture only runs on status detail URLs (`/status/<id>`).
- Saved markers are shown for already-captured tweets via `/lookup/seen`.
- Logs page supports editing tags, notes, archived flag, and graph inspection.
