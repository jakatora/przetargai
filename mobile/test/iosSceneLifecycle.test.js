import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdtempSync, unlinkSync, rmdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import plugin from '../plugins/withIosSceneLifecycle.cjs';

const require = createRequire(import.meta.url);
const template = join(dirname(require.resolve('expo/package.json')), 'template.tgz');
const swift = execFileSync('tar', ['-xOf', template, 'package/ios/HelloWorld/AppDelegate.swift'], { encoding: 'utf8' });

test('real Expo 54 template moves the window startup to its scene, preserving Expo and linking', () => {
  const result = plugin.migrateAppDelegate(swift);
  assert.doesNotMatch(result, /UIWindow\(frame: UIScreen\.main\.bounds\)/);
  assert.doesNotMatch(result, /factory\.startReactNative\(/);
  assert.match(result, /sceneLaunchOptions = launchOptions/);
  assert.match(result, /bindReactNativeFactory\(factory\)/);
  assert.match(result, /super\.application\(application, didFinishLaunchingWithOptions: launchOptions\)/);
  assert.match(result, /RCTLinkingManager\.application\(app, open: url/);
  assert.match(result, /RCTLinkingManager\.application\(application, continue: userActivity/);
});

test('repeated prebuild does not duplicate scene migration', () => {
  const once = plugin.migrateAppDelegate(swift);
  assert.equal(plugin.migrateAppDelegate(once), once);
});

test('changed native template fails closed instead of leaving two window owners', () => {
  assert.throws(() => plugin.migrateAppDelegate(swift.replace('"main"', '"changed"')), /Unexpected Expo/);
});

test('manifest adopts a single scene without losing URLs or encryption metadata', () => {
  const original = { ITSAppUsesNonExemptEncryption: false, CFBundleURLTypes: [{ CFBundleURLSchemes: ['przetargai'] }] };
  const result = plugin.sceneManifest(original);
  assert.equal(result.ITSAppUsesNonExemptEncryption, false);
  assert.deepEqual(result.CFBundleURLTypes, original.CFBundleURLTypes);
  assert.equal(result.UIApplicationSceneManifest.UIApplicationSupportsMultipleScenes, false);
  assert.equal(result.UIApplicationSceneManifest.UISceneConfigurations.UIWindowSceneSessionRoleApplication[0].UISceneDelegateClassName,
    '$(PRODUCT_MODULE_NAME).SceneDelegate');
  assert.deepEqual(plugin.sceneManifest(result), result);
  assert.equal(original.UIApplicationSceneManifest, undefined);
});

test('an existing foreign scene configuration requires review', () => {
  assert.throws(() => plugin.sceneManifest({ UIApplicationSceneManifest: { UISceneConfigurations: {
    UIWindowSceneSessionRoleApplication: [{ UISceneDelegateClassName: 'OtherDelegate' }],
  } } }), /existing scene delegate/);
});

test('generated scene is linked exactly once into the real Xcode application target', () => {
  const directory = mkdtempSync(join(tmpdir(), 'przetargai-scene-'));
  const file = join(directory, 'project.pbxproj');
  try {
    writeFileSync(file, execFileSync('tar', ['-xOf', template, 'package/ios/HelloWorld.xcodeproj/project.pbxproj']));
    const project = require('xcode').project(file).parseSync();
    plugin.addSceneSource(project, 'HelloWorld');
    plugin.addSceneSource(project, 'HelloWorld');
    const result = project.writeSync();
    assert.equal((result.match(/SceneDelegate.swift in Sources \*\/ =/g) || []).length, 1);
    assert.match(result, /path = "?HelloWorld\/SceneDelegate\.swift"?/);
  } finally {
    unlinkSync(file);
    rmdirSync(directory);
  }
});

test('normal prebuild activates plugin; scene forwards cold links, warm links and Expo lifecycle', () => {
  const config = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8'));
  assert.ok(config.expo.plugins.includes('./plugins/withIosSceneLifecycle.cjs'));
  const scene = readFileSync(new URL('../plugins/SceneDelegate.swift', import.meta.url), 'utf8');
  assert.match(scene, /UIWindow\(windowScene: windowScene\)/);
  assert.match(scene, /factory.startReactNative\(withModuleName: "main", in: window, launchOptions: launchOptions\)/);
  assert.match(scene, /launchOptions\[.url\] = context.url/);
  assert.match(scene, /UIApplicationLaunchOptionsUserActivityKey/);
  assert.match(scene, /open: context.url, options: options/);
  assert.match(scene, /continue: userActivity, restorationHandler/);
  for (const event of ['DidBecomeActive', 'WillResignActive', 'WillEnterForeground', 'DidEnterBackground']) {
    assert.ok(scene.includes(`appDelegate?.application${event}(UIApplication.shared)`));
  }
});
