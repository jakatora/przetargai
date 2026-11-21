import UIKit
import UserNotifications
import Expo
import React

// One scene, preserving Expo's app delegate subscribers and React Native linking.
@MainActor
public class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  public var window: UIWindow?

  private var appDelegate: AppDelegate? {
    UIApplication.shared.delegate as? AppDelegate
  }

  public func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene,
          let delegate = appDelegate,
          let factory = delegate.reactNativeFactory else {
      assertionFailure("Missing Expo React Native factory for window scene")
      return
    }

    var launchOptions = delegate.sceneLaunchOptions ?? [:]
    if let context = connectionOptions.urlContexts.first {
      launchOptions[.url] = context.url
    }
    if let activity = connectionOptions.userActivities.first(where: {
      $0.activityType == NSUserActivityTypeBrowsingWeb
    }) {
      // These are the keys consumed by RCTLinkingManager.getInitialURL().
      launchOptions[.userActivityDictionary] = [
        "UIApplicationLaunchOptionsUserActivityTypeKey": activity.activityType,
        "UIApplicationLaunchOptionsUserActivityKey": activity,
      ]
    }
    if let response = connectionOptions.notificationResponse {
      launchOptions[.remoteNotification] = response.notification.request.content.userInfo
    }

    let window = UIWindow(windowScene: windowScene)
    self.window = window
    delegate.window = window
    factory.startReactNative(withModuleName: "main", in: window, launchOptions: launchOptions)
  }

  public func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    for context in URLContexts {
      var options: [UIApplication.OpenURLOptionsKey: Any] = [.openInPlace: context.options.openInPlace]
      if let source = context.options.sourceApplication { options[.sourceApplication] = source }
      if let annotation = context.options.annotation { options[.annotation] = annotation }
      _ = appDelegate?.application(UIApplication.shared, open: context.url, options: options)
    }
  }

  public func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    _ = appDelegate?.application(UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
  }

  public func sceneDidBecomeActive(_ scene: UIScene) {
    appDelegate?.applicationDidBecomeActive(UIApplication.shared)
  }

  public func sceneWillResignActive(_ scene: UIScene) {
    appDelegate?.applicationWillResignActive(UIApplication.shared)
  }

  public func sceneWillEnterForeground(_ scene: UIScene) {
    appDelegate?.applicationWillEnterForeground(UIApplication.shared)
  }

  public func sceneDidEnterBackground(_ scene: UIScene) {
    appDelegate?.applicationDidEnterBackground(UIApplication.shared)
  }
}
