// Expo SDK 54 template migration required when linking against iOS SDK 27.
const fs = require('node:fs/promises');
const path = require('node:path');
const { withAppDelegate, withInfoPlist, withDangerousMod, withXcodeProject, IOSConfig } = require('expo/config-plugins');

const marker = '// PrzetargAI: scene-based lifecycle (iOS SDK 27).';
const legacyStart = /#if os\(iOS\) \|\| os\(tvOS\)\s+window = UIWindow\(frame: UIScreen\.main\.bounds\)\s+factory\.startReactNative\(\s+withModuleName: "main",\s+in: window,\s+launchOptions: launchOptions\)\s+#endif/;

function migrateAppDelegate(contents) {
  if (contents.includes(marker)) return contents;
  if (!legacyStart.test(contents) || !contents.includes('var reactNativeFactory: RCTReactNativeFactory?')) {
    throw new Error('Unexpected Expo AppDelegate template; review UIScene migration before building.');
  }
  return contents
    .replace('var reactNativeFactory: RCTReactNativeFactory?',
      'var reactNativeFactory: RCTReactNativeFactory?\n  var sceneLaunchOptions: [UIApplication.LaunchOptionsKey: Any]?')
    .replace(legacyStart, `${marker}\n    sceneLaunchOptions = launchOptions`);
}

function sceneManifest(info) {
  const manifest = info.UIApplicationSceneManifest || {};
  const roles = manifest.UISceneConfigurations || {};
  const existing = roles.UIWindowSceneSessionRoleApplication || [];
  if (existing.some(scene => scene.UISceneDelegateClassName !== '$(PRODUCT_MODULE_NAME).SceneDelegate')) {
    throw new Error('An existing scene delegate needs review; refusing to overwrite it.');
  }
  return { ...info, UIApplicationSceneManifest: {
    ...manifest,
    UIApplicationSupportsMultipleScenes: false,
    UISceneConfigurations: { ...roles, UIWindowSceneSessionRoleApplication: [{
      UISceneConfigurationName: 'Default Configuration',
      UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
    }] },
  } };
}

function addSceneSource(project, projectName) {
  return IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
    filepath: `${projectName}/SceneDelegate.swift`, groupName: projectName, project,
  });
}

function withIosSceneLifecycle(config) {
  config = withInfoPlist(config, mod => {
    mod.modResults = sceneManifest(mod.modResults);
    return mod;
  });
  config = withAppDelegate(config, mod => {
    if (mod.modResults.language !== 'swift') throw new Error('UIScene plugin requires the Expo Swift AppDelegate.');
    mod.modResults.contents = migrateAppDelegate(mod.modResults.contents);
    return mod;
  });
  config = withDangerousMod(config, ['ios', async mod => {
    const destination = path.join(mod.modRequest.platformProjectRoot, mod.modRequest.projectName, 'SceneDelegate.swift');
    await fs.copyFile(path.join(__dirname, 'SceneDelegate.swift'), destination);
    return mod;
  }]);
  return withXcodeProject(config, mod => {
    mod.modResults = addSceneSource(mod.modResults, mod.modRequest.projectName);
    return mod;
  });
}

module.exports = withIosSceneLifecycle;
module.exports.migrateAppDelegate = migrateAppDelegate;
module.exports.sceneManifest = sceneManifest;
module.exports.addSceneSource = addSceneSource;
