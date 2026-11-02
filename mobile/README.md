# Lead Box Android app (call tracking)

Capacitor shell that opens https://wacrm.leadboxs.in and adds the native plugin
`LeadBoxCalls` (`android/app/src/main/java/in/leadboxs/wacrm/`). It replaces the
earlier Trusted Web Activity build, which could not read calls. Same package id
`in.leadboxs.wacrm`, versionCode 2.

## Two builds (product flavors)

| Flavor | Where it goes | What it tracks | Extra permissions |
|---|---|---|---|
| `play` | Google Play | Calls started from the CRM (Call button / phone ⋮ menu). Duration = off-hook to hang-up, so it includes ringing time. No recordings. | READ_PHONE_STATE, CALL_PHONE |
| `full` | Direct APK for company phones | Every call in the phone's call log whose number is a CRM customer (outgoing, incoming, missed), exact duration, and the recording made by the phone's own call recorder. | + READ_CALL_LOG, READ_MEDIA_AUDIO |

Why two: Google Play only allows READ_CALL_LOG for a short list of app types (needs a
Permissions Declaration), and since Android 10 no app can record calls itself. The full
build therefore uploads the file the phone's built-in recorder saves.

## How it works

1. `src/components/call-sync.tsx` (web) runs inside the app on start, on resume and every 5 min.
2. It calls `LeadBoxCalls.getCalls({since})`, sends them to the server action `syncDeviceCalls`.
3. `lb_save_calls` (SQL) keeps only numbers that are customers of the user's company, files the call
   on the lead, writes a `call` event in the lead history and bumps last activity.
4. For calls with a recording, the page asks for a signed upload URL and the plugin PUTs the file.
5. After an outgoing call the page asks for the outcome (Interested, Call back, …).

Plugin API (`window.Capacitor.Plugins.LeadBoxCalls`):
`getInfo()`, `requestPermissions()`, `getCalls({since})`, `dial({number})`, `uploadFile({uri, url})`.

## Build

Needs JDK 21 and the Android SDK (platform 36).

```bash
cd mobile
npm ci
npx cap sync android
cd android
./gradlew bundlePlayRelease      # app/build/outputs/bundle/playRelease/app-play-release.aab  -> Play Console
./gradlew assembleFullRelease    # app/build/outputs/apk/full/release/app-full-release-unsigned.apk -> sign, share directly
```

Sign both with the same upload key as before (keystore from LeadBox-android.zip), e.g. add a
`signingConfigs.release` block or sign with `apksigner` / `jarsigner`.

`public/.well-known/assetlinks.json` is no longer required by this app (it was for the TWA) but is harmless.
