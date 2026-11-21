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
        for name in ['iPhone 17', 'iPhone 17e', 'iPhone 17 Pro', 'iPhone 18 Pro']:
            for device in entries:
                if device['name'] != name or not device.get('isAvailable'):
                    continue
                Path('ios-simulator-smoke/selected-device.json').write_text(
                    json.dumps({'runtime': runtime, 'device': device}, indent=2))
                print(device['udid'])
                raise SystemExit(0)
raise SystemExit('No available single-screen iPhone simulator with iOS 27')
PY
)
# Compile before booting to leave the builder's memory available to Xcode.
xcodebuild -workspace "mobile/ios/$XCODE_SCHEME.xcworkspace" \
  -scheme "$XCODE_SCHEME" -configuration Release -sdk iphonesimulator \
  -destination "id=$DEVICE_ID" -derivedDataPath "$CM_BUILD_DIR/ios-simulator-derived" \
  CODE_SIGNING_ALLOWED=NO > ios-simulator-smoke-build.log 2>&1
APP="$CM_BUILD_DIR/ios-simulator-derived/Build/Products/Release-iphonesimulator/$XCODE_SCHEME.app"
cat ios-simulator-smoke/selected-device.json
xcrun simctl boot "$DEVICE_ID"
xcrun simctl bootstatus "$DEVICE_ID" -b
xcrun simctl install "$DEVICE_ID" "$APP"
xcrun simctl status_bar "$DEVICE_ID" override --time '9:41' --batteryState charged --batteryLevel 100
xcrun simctl ui "$DEVICE_ID" appearance light
xcrun simctl launch "$DEVICE_ID" "$BUNDLE_ID"
sleep 12
xcrun simctl io "$DEVICE_ID" screenshot --display=1 ios-simulator-smoke/light.png
xcrun simctl ui "$DEVICE_ID" appearance dark
sleep 3
xcrun simctl io "$DEVICE_ID" screenshot --display=1 ios-simulator-smoke/dark.png
xcrun simctl shutdown "$DEVICE_ID"
