"""Check the SDK recorded in the exported device IPA before store upload."""

import argparse
import json
import plistlib
from pathlib import Path
import re
import zipfile


def verify_ipa(path, bundle_id, minimum_sdk=27):
    with zipfile.ZipFile(path) as archive:
        names = [name for name in archive.namelist()
                 if re.fullmatch(r"Payload/[^/]+\.app/Info\.plist", name)]
        if len(names) != 1:
            raise ValueError("Expected exactly one main app Info.plist")
        info = plistlib.loads(archive.read(names[0]))
    if info.get("CFBundleIdentifier") != bundle_id:
        raise ValueError("Unexpected bundle identifier")
    sdk = info.get("DTSDKName", "")
    match = re.fullmatch(r"iphoneos(\d+)(?:\.\d+)*", sdk)
    if not match or int(match[1]) < minimum_sdk:
        raise ValueError(f"Device SDK {minimum_sdk}+ required; IPA records {sdk!r}")
    if info.get("CFBundleSupportedPlatforms") != ["iPhoneOS"]:
        raise ValueError("Expected an iPhoneOS device IPA")
    return {key: info.get(key) for key in (
        "CFBundleIdentifier", "CFBundleShortVersionString", "CFBundleVersion",
        "DTSDKName", "DTSDKBuild", "DTXcode", "DTXcodeBuild", "MinimumOSVersion")}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("ipa", type=Path)
    parser.add_argument("--bundle-id", required=True)
    parser.add_argument("--minimum-sdk", type=int, default=27)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    proof = verify_ipa(args.ipa, args.bundle_id, args.minimum_sdk)
    rendered = json.dumps(proof, indent=2) + "\n"
    if args.output:
        args.output.write_text(rendered, encoding="utf-8")
    print(rendered, end="")
