/** Mobile app download details, shown on /download-app, the top-bar "Get app" button and the after-login banner. */

/** Direct-download Android app (APK), served from public/downloads. Replace the file and bump the version together. */
export const ANDROID_APK = {
  url: "/downloads/leadbox.apk",
  version: "1.1.0",
  size: "3.0 MB",
};

/** Google Play listing. Leave empty until the app is live on Play; the page then shows the Play button too. */
export const PLAY_STORE_URL = process.env.NEXT_PUBLIC_PLAY_STORE_URL ?? "";

/**
 * App Store / TestFlight link for iPhone. Needs an Apple Developer account, so it is empty for now and iPhone users
 * get "Add to Home Screen" (opens full screen with the Lead Box icon, like an app).
 */
export const IOS_APP_URL = process.env.NEXT_PUBLIC_IOS_APP_URL ?? "";
