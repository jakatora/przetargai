import plistlib
from pathlib import Path
import tempfile
import unittest
import zipfile

from verify_ios_sdk import verify_ipa


class VerifyIosSdkTest(unittest.TestCase):
    def verify(self, sdk="iphoneos27.2", **changes):
        info = {"CFBundleIdentifier": "pl.przetargai.app", "DTSDKName": sdk,
                "CFBundleSupportedPlatforms": ["iPhoneOS"], "MinimumOSVersion": "15.1",
                "UIApplicationSceneManifest": {"UISceneConfigurations": {
                    "UIWindowSceneSessionRoleApplication": [{"UISceneDelegateClassName": "PrzetargAI.SceneDelegate"}]
                }}}
        info.update(changes)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "app.ipa"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("Payload/PrzetargAI.app/Info.plist",
                                 plistlib.dumps(info, fmt=plistlib.FMT_BINARY))
            return verify_ipa(path, "pl.przetargai.app")

    def test_new_sdk_accepts_older_deployment_target(self):
        self.assertEqual(self.verify()["MinimumOSVersion"], "15.1")

    def test_sdk_in_old_warning_is_rejected(self):
        with self.assertRaises(ValueError):
            self.verify("iphoneos26.5")

    def test_missing_sdk_is_rejected(self):
        with self.assertRaises(ValueError):
            self.verify("")

    def test_simulator_cannot_pass_as_device(self):
        with self.assertRaises(ValueError):
            self.verify("iphonesimulator27.2", CFBundleSupportedPlatforms=["iPhoneSimulator"])

    def test_other_app_is_rejected(self):
        with self.assertRaises(ValueError):
            self.verify(CFBundleIdentifier="pl.other.app")

    def test_new_sdk_without_scene_cannot_be_uploaded(self):
        with self.assertRaises(ValueError):
            self.verify(UIApplicationSceneManifest={})


if __name__ == "__main__":
    unittest.main()
