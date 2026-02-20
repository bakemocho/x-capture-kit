#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_EXT="$ROOT_DIR/chrome-extension"
OUTPUT_DIR="$ROOT_DIR/safari-extension"
APP_NAME="x-clipper Safari"
BUNDLE_ID="com.xcapturekit.x-clipper-Safari"

xcrun safari-web-extension-converter \
  "$SOURCE_EXT" \
  --project-location "$OUTPUT_DIR" \
  --app-name "$APP_NAME" \
  --bundle-identifier "$BUNDLE_ID" \
  --swift \
  --macos-only \
  --no-open \
  --no-prompt \
  --force

echo "[build-safari-extension] generated project at: $OUTPUT_DIR"
