# Safari Extension Runbook

This directory stores converter-generated Safari project output.

## Generate / Refresh

```bash
./scripts/build-safari-extension.sh
```

## Open Project

```bash
open "safari-extension/x-clipper Safari/x-clipper Safari.xcodeproj"
```

## Run (manual)

1. In Xcode, choose scheme `x-clipper Safari`.
2. Run the macOS app target.
3. In Safari, enable developer menu (`Settings -> Advanced -> Show features for web developers`).
4. In Safari menu bar, enable `Develop -> Allow Unsigned Extensions` (required for local, unnotarized build).
5. In Safari, enable `x-clipper Safari Extension` under `Settings -> Extensions`.
6. Open `x.com` status page and execute extension action.
7. To open management screens, click extension action on a non-status page (for example `https://x.com/home`) to open options.
8. In options, use `Open Logs` and `Open Collector` shortcuts.

## Notes

- Safari project references files under `chrome-extension/`.
- Re-run converter after adding/removing extension files so Xcode resource references stay in sync.
