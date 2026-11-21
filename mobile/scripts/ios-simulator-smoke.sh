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
  CODE_SIGNING_ALLOWED=NO ONLY_ACTIVE_ARCH=YES ARCHS=arm64 \
  > ios-simulator-smoke-build.log 2>&1
APP="$CM_BUILD_DIR/ios-simulator-derived/Build/Products/Release-iphonesimulator/$XCODE_SCHEME.app"
python3 - "$APP" <<'PY'
import hashlib, json, plistlib, sys
from pathlib import Path
app = Path(sys.argv[1])
info = plistlib.loads((app / 'Info.plist').read_bytes())
js = (app / 'main.jsbundle').read_bytes()
Path('ios-simulator-smoke/app-proof.json').write_text(json.dumps({
    'info': {k: info.get(k) for k in ['CFBundleIdentifier', 'CFBundleShortVersionString',
              'CFBundleVersion', 'DTSDKName', 'MinimumOSVersion']},
    'mainJsBundleSha256': hashlib.sha256(js).hexdigest(),
}, indent=2))
PY
cat ios-simulator-smoke/selected-device.json
xcrun simctl boot "$DEVICE_ID"
xcrun simctl bootstatus "$DEVICE_ID" -b
open -a Simulator --args -CurrentDeviceUDID "$DEVICE_ID"
xcrun simctl install "$DEVICE_ID" "$APP"
xcrun simctl status_bar "$DEVICE_ID" override --time '9:41' --batteryState charged --batteryLevel 100
xcrun simctl ui "$DEVICE_ID" appearance light
collect_runtime_logs() {
  xcrun simctl spawn "$DEVICE_ID" launchctl list > ios-simulator-smoke/launchctl.txt 2>&1 || true
  xcrun simctl spawn "$DEVICE_ID" log show --style compact --last 3m \
    --predicate 'process == "PrzetargAI" OR eventMessage CONTAINS "pl.przetargai.app"' \
    > ios-simulator-smoke/runtime-system.log 2>&1 || true
  python3 - "$DEVICE_ID" <<'PY'
from pathlib import Path
import shutil, sys
roots = [Path.home() / 'Library/Logs/DiagnosticReports',
         Path.home() / 'Library/Developer/CoreSimulator/Devices' / sys.argv[1] / 'data/Library/Logs']
for root in roots:
    if root.exists():
        for path in root.rglob('*PrzetargAI*'):
            if path.is_file() and path.suffix in ('.ips', '.crash'):
                shutil.copyfile(path, Path('ios-simulator-smoke') / path.name)
PY
}
trap collect_runtime_logs EXIT
xcrun simctl launch --console-pty "$DEVICE_ID" "$BUNDLE_ID" > ios-simulator-smoke/runtime-console.log 2>&1 &
LAUNCH_PID=$!
sleep 12
xcrun simctl io "$DEVICE_ID" screenshot --display=1 ios-simulator-smoke/light.png
xcrun simctl openurl "$DEVICE_ID" 'przetargai://sdk27-smoke'
sleep 3
xcrun simctl ui "$DEVICE_ID" appearance dark
sleep 8
xcrun simctl io "$DEVICE_ID" screenshot --display=1 ios-simulator-smoke/dark.png
collect_runtime_logs
trap - EXIT
# A returned launch PID alone is not evidence that the app stayed alive.
if ! kill -0 "$LAUNCH_PID" 2>/dev/null; then
  echo "Application exited before visual smoke completed; inspect runtime logs."
  exit 1
fi
xcrun simctl terminate "$DEVICE_ID" "$BUNDLE_ID"
xcrun simctl shutdown "$DEVICE_ID"
