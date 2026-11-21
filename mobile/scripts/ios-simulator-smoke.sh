#!/bin/bash
# Native startup evidence from Codemagic; no credentials or business mutations.
set -euo pipefail
cd "$CM_BUILD_DIR"
mkdir -p ios-simulator-smoke
xcrun simctl list devices available -j > ios-simulator-smoke/devices.json
DEVICE_ID=$(python3 - <<'PY'
import json
from pathlib import Path
devices = json.loads(Path('ios-simulator-smoke/devices.json').read_text())['devices']
for runtime, entries in sorted(devices.items(), reverse=True):
    if 'iOS-27-' in runtime:
        for device in entries:
            if device['name'].startswith('iPhone') and device.get('isAvailable'):
                print(device['udid'])
                raise SystemExit(0)
raise SystemExit('No available iPhone simulator with iOS 27')
PY
)
xcrun simctl boot "$DEVICE_ID"
xcrun simctl bootstatus "$DEVICE_ID" -b
xcodebuild -workspace "mobile/ios/$XCODE_SCHEME.xcworkspace" \
  -scheme "$XCODE_SCHEME" -configuration Release -sdk iphonesimulator \
  -destination "id=$DEVICE_ID" -derivedDataPath "$CM_BUILD_DIR/ios-simulator-derived" \
  CODE_SIGNING_ALLOWED=NO > ios-simulator-smoke-build.log 2>&1
APP="$CM_BUILD_DIR/ios-simulator-derived/Build/Products/Release-iphonesimulator/$XCODE_SCHEME.app"
xcrun simctl install "$DEVICE_ID" "$APP"
xcrun simctl status_bar "$DEVICE_ID" override --time '9:41' --batteryState charged --batteryLevel 100
xcrun simctl ui "$DEVICE_ID" appearance light
xcrun simctl launch "$DEVICE_ID" "$BUNDLE_ID"
sleep 12
xcrun simctl io "$DEVICE_ID" screenshot ios-simulator-smoke/light.png
xcrun simctl ui "$DEVICE_ID" appearance dark
sleep 3
xcrun simctl io "$DEVICE_ID" screenshot ios-simulator-smoke/dark.png
xcrun simctl shutdown "$DEVICE_ID"
