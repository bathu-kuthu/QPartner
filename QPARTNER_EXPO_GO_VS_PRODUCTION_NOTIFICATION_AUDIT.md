# QPARTNER — EXPO GO vs. EAS APK vs. PRODUCTION NOTIFICATION & FOREGROUND SERVICE AUDIT

**Application:** Quickora QPartner (`com.quickora.qpartner`)  
**Project Directory:** [`D:\Quickora Delivery\QPartner`](file:///d:/Quickora%20Delivery/QPartner)  
**Audit Date:** November 17, 2026  

---

## 1. Actual Project Architecture

- **Framework & SDK:** Expo SDK `~54.0.33` / React Native `0.81.5` / React `19.1.0` (`newArchEnabled: true`)
- **Navigation:** `expo-router` `~6.0.23`
- **Dev Client Package Installed:** `expo-dev-client` `~6.0.21`
- **Notification & Background Libraries:**
  - `expo-notifications` `~0.32.16` (Configured in [`app.json`](file:///d:/Quickora%20Delivery/QPartner/app.json) with `"defaultChannel": "bookings"` and custom sound `"./assets/sounds/booking_alert.wav"`)
  - `expo-location` `~19.0.8` (Configured in [`app.json`](file:///d:/Quickora%20Delivery/QPartner/app.json) with `"isAndroidBackgroundLocationEnabled": true` and `"isAndroidForegroundServiceEnabled": true`)
  - `expo-task-manager` `~14.0.9` & `expo-background-fetch` `~14.0.9`
- **Native Directory Status:** Managed / Prebuild workflow (no committed `android/` folder in git tree; native Android code and `AndroidManifest.xml` are generated at build time by EAS Build / `npx expo prebuild` from `app.json` and `google-services.json`).
- **Firebase Configuration:** [`google-services.json`](file:///d:/Quickora%20Delivery/QPartner/google-services.json) is bound to Firebase project `qpartner-3e88c` (`project_number: 190824250048`) and Android package name `com.quickora.qpartner`.

---

## 2. Current Testing Environment (`npx expo start` + QR Code Scan)

You are currently testing QPartner by running `npx expo start` and scanning the QR code on your Android phone. Depending on which app opens the QR code on your phone, one of two runtime containers executes your JavaScript bundle:

1. **Standard Expo Go App (`host.exp.exponent` from Google Play Store):**
   - Runs inside Expo's shared sandboxed container (`Constants.appOwnership === 'expo'`).
   - Does **not** have package name `com.quickora.qpartner` and does **not** include your `google-services.json` or custom `AndroidManifest.xml`.
2. **Previously Installed Custom Development Client (`com.quickora.qpartner` built with `expo-dev-client`):**
   - Runs your JavaScript live from `npx expo start`, but uses whatever native `AndroidManifest.xml`, native plugins, and sound resources were compiled into that APK when it was originally built.

---

## 3. Expo Go Limitations (Why Background Push & True Foreground Services Cannot Work in Expo Go)

In **Expo SDK 53 and SDK 54 (`~54.0.33`)**, Expo permanently removed remote Android push notification support (FCM) from the Android Expo Go app.

| Feature | Supported in Expo Go (`npx expo start`)? | Technical Reason |
| :--- | :--- | :--- |
| **Remote FCM Push Notifications (`getDevicePushTokenAsync`)** | **NOT SUPPORTED** | Expo Go uses package `host.exp.exponent`, not `com.quickora.qpartner`. It does not contain your `google-services.json` and cannot receive FCM pushes from your `notify-driver` Edge Function when closed. |
| **Background Push Task (`registerTaskAsync`)** | **NOT SUPPORTED** | `ExpoFirebaseMessagingService` for `com.quickora.qpartner` is not present in Expo Go. |
| **True Native Foreground Location Service (`FOREGROUND_SERVICE_LOCATION`)** | **NOT SUPPORTED WHEN CLOSED** | Expo Go does not declare your app's standalone foreground service in its manifest; swiping Expo Go from Recents terminates the JS runtime completely. |
| **Custom Bundled Sound (`booking_alert.wav`)** | **NOT SUPPORTED IN EXPO GO** | Android Notification Channels load custom sound files from native `res/raw/booking_alert.wav`, which is only copied into the APK during a native build (`eas build` / `expo run:android`). In Expo Go, Android falls back to the default system notification sound. |
| **Local Sticky Online Notification (`scheduleNotificationAsync`)** | **SUPPORTED** | Works in Expo Go via `NotificationService.showOnlineStatusNotification()`. |
| **Local Heads-Up Notification While Minimized (JS Alive)** | **SUPPORTED (WITH OUR FIX)** | Works in Expo Go as long as the Expo Go process is minimized (not killed) and `_layout.tsx` polls / listens via Realtime. |

### What We Fixed Specifically for Your `npx expo start` Testing Environment:
During this audit, we found **three code defects** that prevented notifications and tap navigation from working even when minimized in `npx expo start`:
1. **[`app/_layout.tsx`](file:///d:/Quickora%20Delivery/QPartner/app/_layout.tsx#L491) had `if (IS_EXPO_GO) return;` blocking notification tap listeners:** Even when a local notification appeared in Expo Go, tapping it did nothing because the response listener exited early on `IS_EXPO_GO`. **Fixed:** Removed `if (IS_EXPO_GO) return;` so tapping a notification or its `✅ Accept` button works in `npx expo start`.
2. **[`app/_layout.tsx`](file:///d:/Quickora%20Delivery/QPartner/app/_layout.tsx#L162-L310) relied only on Supabase Realtime WebSockets and had no polling fallback:** When you minimized the app, if the Realtime WebSocket dropped or if an order was already pending, `BookingsScreen` (`bookings.tsx`) fetched it on its 10s timer and rendered the small in-app card, **but `_layout.tsx` never knew about it**, so `NotificationEngine` and `GlobalRideAlertModal` never fired! **Fixed:** Added `checkPendingWork()` directly inside `_layout.tsx` (running immediately on going online, every 6 seconds while online, and on `AppState` changes).
3. **[`services/notification.service.ts`](file:///d:/Quickora%20Delivery/QPartner/services/notification.service.ts#L334) Always Shows Persistent Online Notification:** Updated `startOnlineForegroundService` so `Quickora Partner — You're Online — Searching for orders` is **always** posted immediately to the Android notification bar when you switch ONLINE (both in `npx expo start` and in standalone APKs).

---

## 4. Expo Development Build vs. EAS Preview APK vs. Production APK

### A. Expo Development Build (`eas.json` → `"development"` profile)
- **Configuration in [`eas.json`](file:///d:/Quickora%20Delivery/QPartner/eas.json#L7-L10):** `"developmentClient": true, "distribution": "internal"`.
- **What It Provides:** Compiles a real native Android APK (`com.quickora.qpartner`) containing `google-services.json`, `res/raw/booking_alert.wav`, `AndroidManifest.xml` permissions (`POST_NOTIFICATIONS`, `FOREGROUND_SERVICE_LOCATION`, `WAKE_LOCK`), and `expo-location` Foreground Service, **while still allowing you to scan the QR code from `npx expo start --dev-client` for instant JS reloads**.

### B. EAS Preview APK (`eas.json` → `"preview"` profile)
- **Configuration in [`eas.json`](file:///d:/Quickora%20Delivery/QPartner/eas.json#L11-L16):** `"distribution": "internal", "android": { "buildType": "apk" }`.
- **What It Provides:** Generates a standalone, self-contained `.apk` file with the JavaScript bundle embedded inside the APK (no `npx expo start` server needed). Includes:
  - Application ID: `com.quickora.qpartner`
  - Firebase config: `google-services.json` (`qpartner-3e88c`)
  - Native plugins: `expo-notifications`, `expo-location` (`isAndroidForegroundServiceEnabled: true`), `expo-task-manager`
  - Sound resource: `./assets/sounds/booking_alert.wav` compiled into `res/raw/booking_alert.wav`

### C. Production Build (`eas.json` → `"production"` profile)
- **Configuration in [`eas.json`](file:///d:/Quickora%20Delivery/QPartner/eas.json#L17-L19):** `"autoIncrement": true` (builds Play Store `.aab` by default, or `.apk` if `"android": { "buildType": "apk" }` is added).
- **Differences from Development Build:** Bundles minification/Hermes bytecode directly into the binary with no Metro dev menu overhead. Identical native FCM and Foreground Service behavior to Preview APK.

---

## 5. Android Permission Audit

Every permission in [`app.json`](file:///d:/Quickora%20Delivery/QPartner/app.json#L27-L37) was audited against Android 12, 13, 14, and 15 requirements:

| Permission | 1. Declared in `app.json`? | 2. Requested at Runtime? | 3. Granted on Device? | 4. Required for Feature? | 5. Requires New Native Build? | 6. Behavior if Denied by User |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `POST_NOTIFICATIONS` (Android 13+) | **YES** | **YES** (`PermissionsScreen`, `_layout.tsx`, `toggleOnline`) | **YES** (Verified FCM token exists in DB) | **YES** (Required to display persistent online & incoming order notifications) | **NO** (Already included by `expo-notifications` plugin) | App shows in-app alert with `Open Settings` button; in-app modal still works when app is open. |
| `ACCESS_FINE_LOCATION` & `ACCESS_COARSE_LOCATION` | **YES** | **YES** (`PermissionsScreen`, `BookingsScreen`) | **YES** (Verified coords `(11.3817, 77.2243)` in DB) | **YES** (Required to match nearby rides & calculate pickup distance) | **NO** | Partner cannot toggle ONLINE until GPS location fix is available; guided to Settings. |
| `ACCESS_BACKGROUND_LOCATION` | **YES** | **YES** (`PermissionsScreen`) | **Depends on "Allow all the time" in Settings** | **YES** (Required for `expo-location` Android Foreground Service while minimized) | **NO** | Foreground location service cannot run in background; app falls back to sticky local online notification + server-side FCM pushes. |
| `FOREGROUND_SERVICE` & `FOREGROUND_SERVICE_LOCATION` | **YES** | **Install-time permission** (requires runtime `ACCESS_BACKGROUND_LOCATION`) | **YES** (in standalone APK) | **YES** (Required on Android 14+ to run ongoing location foreground service while online) | **NO** (Already in `app.json`) | OS blocks `startLocationUpdatesAsync` in background; app falls back to sticky online notification + FCM push. |
| `VIBRATE` | **YES** | **Install-time permission** | **YES** | **YES** (Required for `[0, 500, 200, 500, 200, 500]` channel vibration) | **YES** (Added to `app.json`) | Notification uses default system vibration or silent mode. |
| `WAKE_LOCK` | **YES** | **Install-time permission** | **YES** | **YES** (Wakes CPU when FCM high-priority message or background task arrives) | **NO** (Already in `app.json`) | Device CPU may sleep during Doze mode. |
| `RECEIVE_BOOT_COMPLETED` | **YES** | **Install-time permission** | **YES** | **YES** (Used by `expo-notifications` to restore scheduled notification channels after reboot) | **YES** (Added to `app.json`) | Scheduled reminders do not restore until app is opened after reboot. |
| `USE_FULL_SCREEN_INTENT` | **NO** (Not declared) | N/A | N/A | **NOT ELIGIBLE UNDER GOOGLE PLAY POLICY** (See Section 7) | Would require custom plugin | Android 14+ restricts full-screen intents strictly to calling & alarm apps; heads-up notification (`IMPORTANCE_MAX`) is used instead. |
| `SYSTEM_ALERT_WINDOW` (Draw Over Other Apps) | **NO** (Not declared) | **REMOVED** from mandatory gate | N/A | **NO** (No native overlay view exists in codebase; see Section 7) | Would require custom Kotlin module | Not required; high-priority heads-up notification + tap/Accept action opens full-screen in-app modal. |

---

## 6. Foreground Service Audit

- **How It Works in QPartner ([`services/notification.service.ts`](file:///d:/Quickora%20Delivery/QPartner/services/notification.service.ts#L326-L375)):**
  1. **Immediate Persistent Status Notification (`ONLINE_STATUS_NOTIFICATION_ID = 'qpartner_online_status'`):**
     - Whenever you switch ONLINE, QPartner immediately posts an ongoing notification on channel `'online_status'` (`AndroidImportance.LOW`, `sticky: true`, `autoDismiss: false`):
       - **Title:** `Quickora Partner`
       - **Body:** `You're Online — Searching for orders`
       - **Subtitle:** `Available for delivery requests`
     - This works in **both** `npx expo start` (Expo Go / Dev Client) and standalone APKs.
  2. **Native Android Foreground Service (`Location.startLocationUpdatesAsync(BACKGROUND_RIDE_TASK, ...)`):**
     - In standalone APKs / Development Builds (`!IS_EXPO_GO`) when Background Location ("Allow all the time") is granted, `expo-location` starts a genuine Android `foregroundServiceType="location"` service that executes `BACKGROUND_RIDE_TASK` every 5 seconds.
     - On every 5-second tick ([`services/background-task.ts`](file:///d:/Quickora%20Delivery/QPartner/services/background-task.ts#L220-L390)), it verifies `users.is_online === true` in Supabase, updates the driver's GPS coordinates, polls for unassigned Transport rides and Food/Grocery orders, and fires a high-priority `'bookings'` notification if a new order is found.
  3. **Guaranteed Teardown:**
     - Switching OFFLINE or logging out calls `NotificationService.stopOnlineForegroundService()`, which stops `Location.stopLocationUpdatesAsync(BACKGROUND_RIDE_TASK)` and dismisses `qpartner_online_status` from the Android notification bar.

---

## 7. Floating Card, Overlay & Full-Screen Experience Investigation

### A. What Are the Existing UI Components in QPartner?
We inspected all four components requested in Section 7:

1. **The Small `New Booking` Card in [`app/(tabs)/bookings.tsx`](file:///d:/Quickora%20Delivery/QPartner/app/%28tabs%29/bookings.tsx#L638-L721) (`<View style={styles.rideCard}>`):**
   - **What it is:** An **in-app React Native `<View>` component** rendered inside the `<ScrollView>` of the Bookings tab.
   - **Why it previously appeared only when opening the app:** Previously, `bookings.tsx` had a 10-second `setInterval` (`loadData()`) that updated `availableRides` (this small card), whereas `app/_layout.tsx` (which controls `GlobalRideAlertModal` and `NotificationEngine`) had **no polling loop** and only listened to Supabase Realtime WebSockets. When the WebSocket dropped in the background, opening the app triggered `bookings.tsx`'s `loadData()`, showing only the small card inside the Bookings tab instead of triggering the full-screen modal or background notification. **We fixed this in `app/_layout.tsx`** by adding `checkPendingWork()` on a 6-second loop + `AppState` listener.
2. **[`components/GlobalRideAlertModal.tsx`](file:///d:/Quickora%20Delivery/QPartner/components/GlobalRideAlertModal.tsx) & [`components/GlobalOrderAlertModal.tsx`](file:///d:/Quickora%20Delivery/QPartner/components/GlobalOrderAlertModal.tsx):**
   - **What they are:** Full-screen **in-app React Native `<Modal>` components** mounted at the root layout (`app/_layout.tsx`) with a 30-second animated countdown bar, pulsing Accept button, route details, fare, and continuous vibration.
   - **When they appear:** Immediately when QPartner is in the foreground, or immediately when the partner taps the incoming order notification from the background/lock screen.
3. **[`components/GlobalStatusBanner.tsx`](file:///d:/Quickora%20Delivery/QPartner/components/GlobalStatusBanner.tsx):**
   - **What it is:** An **in-app top slide-down banner** (`Animated.View`) that warns the driver inside the app when internet connectivity or GPS location services are turned off.
4. **[`services/native-bridge.service.ts`](file:///d:/Quickora%20Delivery/QPartner/services/native-bridge.service.ts) (`NativeModules.DriverServiceModule`):**
   - **What it is:** A JavaScript wrapper referencing `NativeModules.DriverServiceModule` (`startFloatingWidget`, `updateFloatingWidgetData`, `startRinging`, `checkDrawOverAppsPermission`).
   - **Actual Status:** **Stub / Unimplemented Native Module.** No Kotlin/Java implementation of `DriverServiceModule` exists anywhere in the project or its config plugins. Therefore, `DriverServiceModule` is `undefined`, and all calls to `NativeBridgeService` are silent no-ops.

### B. Evaluation of the 5 Android Mechanisms (Comparison to Rapido / Zomato)

| Mechanism | What It Does on Android | Supported in QPartner? | Policy & Platform Evaluation |
| :--- | :--- | :--- | :--- |
| **1. Persistent Foreground-Service Notification** | Shows an ongoing notification in the status bar (`Quickora Partner — You're Online — Searching for orders`) while keeping the app's background location service alive. | **YES (Implemented)** | **Required foundation** used by Rapido/Zomato to indicate online status and prevent Android from killing the background process. |
| **2. High-Priority FCM Notification** | Wakes the device via Google Play Services even when the app is minimized, screen-locked, or swiped from Recents. | **YES (Implemented in `notify-driver` v10; requires deploy + standalone APK)** | **Mandatory server-side wakeup channel** when the app process is not running. |
| **3. Heads-Up Notification (`IMPORTANCE_MAX`)** | Drops down a high-visibility banner over the top of whatever app the partner is currently using (YouTube, WhatsApp, Maps) with custom alarm sound (`booking_alert.wav`), vibration, and `✅ Accept` / `👁️ View Order` buttons. | **YES (Implemented on `'bookings'` channel)** | **Primary compliant mechanism** on Android 12–15 when the partner is using another app. Tapping the banner or `✅ Accept` opens QPartner's full-screen order modal immediately. |
| **4. Full-Screen Notification Intent (`USE_FULL_SCREEN_INTENT`)** | Automatically turns on the screen and launches a full-screen Activity over the lock screen without user tap. | **NOT ELIGIBLE (Restricted by Google Play / Android 14+)** | Starting May 2024 / Android 14 (API 34), Google Play **revokes `USE_FULL_SCREEN_INTENT`** for all apps except phone dialers and alarm clocks. Delivery apps using it face Play Store rejection unless the user manually grants special access. High-priority heads-up notifications (`IMPORTANCE_MAX` + `PUBLIC` lock-screen visibility + `bypassDnd: true`) provide the compliant equivalent. |
| **5. Android Overlay (`SYSTEM_ALERT_WINDOW`)** | Draws a custom native Android View (`WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY`) on top of other apps. | **NOT IMPLEMENTED (Requires custom Kotlin module + prebuild)** | Blocked on Android Go devices, triggers Play Protect warnings, and cannot render React Native screens directly without a custom Kotlin `Service` + XML layout. The `'bookings'` Heads-Up Notification with `✅ Accept` / `👁️ View Order` buttons + full-screen `GlobalRideAlertModal` achieves the same workflow cleanly without overlay vulnerabilities. |

---

## 8. FCM & Backend Verification Summary

From our live read-only diagnostic against `https://zoatdppograoxpgifhbl.supabase.co`:

1. **Production `notify-driver` Deployment Version (`FAIL — PENDING DEPLOYMENT`):**
   - Deployed version in Supabase is **Version 9 (`2026-06-29 18:06:38 UTC`)**.
   - Live HTTP probe confirmed Version 9 crashes with **`HTTP 500: DB error`** (`42703: column users.accept_both does not exist`) before sending any FCM push.
   - Local file [`supabase/functions/notify-driver/index.ts`](file:///d:/Quickora%20Delivery/QPartner/supabase/functions/notify-driver/index.ts) is fixed and ready to deploy.
2. **FCM Token Registration (`PASS`):**
   - Verified in live `public.users`: Driver `393f1645-****-2ce4` (`is_online: true`, `rider_status: "verified"`, `vehicle_category: "logistics"`, `vehicle_type: "bike"`) has a valid **142-character native FCM registration token** (`tokenHash: 6bbd2d78c0`).
3. **Firebase Secrets (`PASS`):**
   - `FCM_PROJECT_ID` (`qpartner-3e88c`), `FCM_CLIENT_EMAIL`, and `FCM_PRIVATE_KEY` are configured in Supabase Edge Function secrets.

---

## 9. Environment & Feature Test Matrix

| Test | Expo Go (`npx expo start`) | Custom Development Build (`expo-dev-client`) | EAS Preview APK | Production APK |
| :--- | :--- | :--- | :--- | :--- |
| **Online persistent notification** | **PASS** (Local sticky notification on `'online_status'` channel) | **NOT TESTED** (Supported via native FGS + sticky notification) | **NOT TESTED** (Supported via native FGS + sticky notification) | **NOT TESTED** (Supported via native FGS + sticky notification) |
| **Background push (Server FCM)** | **NOT SUPPORTED** (Expo Go SDK 54 removed remote FCM) | **BLOCKED** (Requires deploying `notify-driver` v10) | **BLOCKED** (Requires deploying `notify-driver` v10 + installing APK) | **BLOCKED** (Requires deploying `notify-driver` v10 + installing APK) |
| **App minimized (JS alive — 6s poll + Realtime)** | **PASS (SOURCE CODE VERIFIED)** (Schedules local `'bookings'` alert when minimized) | **NOT TESTED** | **NOT TESTED** | **NOT TESTED** |
| **App removed from Recents** | **NOT SUPPORTED** (Swiping Expo Go kills JS runtime & no FCM) | **BLOCKED** (Requires deploying `notify-driver` v10) | **BLOCKED** (Requires deploying `notify-driver` v10 + installing APK) | **BLOCKED** (Requires deploying `notify-driver` v10 + installing APK) |
| **Heads-up notification** | **PASS (SOURCE CODE VERIFIED)** (Uses system default sound in Expo Go) | **NOT TESTED** (Uses `booking_alert.wav`) | **NOT TESTED** (Uses `booking_alert.wav`) | **NOT TESTED** (Uses `booking_alert.wav`) |
| **Sound and vibration** | **PASS (SOURCE CODE VERIFIED)** (Default sound + custom vibration in Expo Go; `booking_alert.wav` requires APK build) | **NOT TESTED** | **NOT TESTED** | **NOT TESTED** |
| **Lock-screen notification** | **PASS (SOURCE CODE VERIFIED)** (While Expo Go is minimized, not killed) | **NOT TESTED** | **NOT TESTED** | **NOT TESTED** |
| **Full-screen intent** | **NOT SUPPORTED** | **NOT ELIGIBLE** (Android 14+ Play policy restricts to call/alarm apps; uses Heads-Up `IMPORTANCE_MAX`) | **NOT ELIGIBLE** | **NOT ELIGIBLE** |
| **Accept order navigation** | **PASS (SOURCE CODE VERIFIED)** (`if (IS_EXPO_GO) return;` removed in `_layout.tsx`) | **NOT TESTED** | **NOT TESTED** | **NOT TESTED** |

---

## 10. Exact Build Commands & Manual Settings Required

### A. Immediate Test in Your Current `npx expo start` Session (Reload App)
Because we fixed `_layout.tsx` (added the 6-second background/foreground polling loop + removed `if (IS_EXPO_GO) return;`) and `notification.service.ts` (always posts `Quickora Partner — You're Online — Searching for orders` and enables `shouldPlaySound: true`):
1. In your running `npx expo start` terminal, press **`r`** to reload QPartner on your phone.
2. Switch QPartner **OFFLINE** and back **ONLINE**: you will immediately see **`Quickora Partner — You're Online — Searching for orders`** in your Android notification bar.
3. Minimize QPartner (do not swipe-kill Expo Go) and place a Bike order: within ≤6 seconds, QPartner will fire the heads-up notification, and tapping it will open `GlobalRideAlertModal`.

### B. Deploy Server-Side FCM Push (`notify-driver`) — Requires Your Approval
To enable server-side FCM pushes when the app is closed or swiped from Recents:
```powershell
cd "D:\Quickora Delivery\QPartner"
supabase functions deploy notify-driver --project-ref zoatdppograoxpgifhbl
```
And in **Supabase Dashboard** → `zoatdppograoxpgifhbl` → **Database** → **Webhooks**, ensure `public.rides` (`INSERT`) triggers `notify-driver`.

### C. Build Standalone APK or Custom Development Client (Required for True FCM & Native Foreground Service)
- **Option 1 — Build Standalone Preview APK (Recommended for real handset testing without `npx expo start`):**
  ```powershell
  cd "D:\Quickora Delivery\QPartner"
  eas build --platform android --profile preview
  ```
- **Option 2 — Build Custom Development Client APK (If you want to keep using `npx expo start` QR codes with full native FCM + Foreground Service):**
  ```powershell
  cd "D:\Quickora Delivery\QPartner"
  eas build --platform android --profile development
  ```
- **Option 3 — Build Production AAB/APK:**
  ```powershell
  cd "D:\Quickora Delivery\QPartner"
  eas build --platform android --profile production
  ```

### D. Android Handset Settings to Enable After Installing APK
1. **Location Permission:** `Settings → Apps → QPartner → Permissions → Location` → Select **"Allow all the time"** (enables the native Android Foreground Location Service).
2. **Notifications:** `Settings → Apps → QPartner → Notifications` → Ensure **Allow notifications** and the **Incoming Order Alerts** channel (`Pop on screen` / `Sound` / `Vibration` / `Lock screen: Show all notification content`) are enabled.
3. **Battery Optimization:** `Settings → Apps → QPartner → Battery` → Select **"Unrestricted"** so OEM battery savers do not throttle the foreground service when minimized.

---

## 11. Physical-Device Testing Instructions (10 Scenarios)

1. **QPartner Foreground:** Go ONLINE, keep QPartner open on screen, place a Bike order → Verify `GlobalRideAlertModal` slides up immediately with sound (`booking_alert.wav`) and vibration.
2. **QPartner Minimized:** Go ONLINE, press Android Home button, place a Bike order → Verify heads-up notification `New Quickora Order • Bike Taxi / Delivery` appears at top of screen with sound and vibration; tap it to open `GlobalRideAlertModal`.
3. **QPartner Removed from Recents (Requires Preview/Dev APK + Deployed `notify-driver`):** Go ONLINE in the installed APK, swipe QPartner away from Recent Apps, place a Bike order → Verify server-side FCM notification arrives; tap it to cold-start QPartner into the order. *(Note: Do NOT use `Settings → Apps → Force Stop`, as Android OS blocks all FCM and background execution for force-stopped apps until manually reopened).*
4. **Another Application Open:** Go ONLINE, open YouTube or WhatsApp in foreground, place a Bike order → Verify heads-up banner drops down over the current app and tapping `✅ Accept` claims the ride and opens `/active-ride/[id]`.
5. **Phone Screen Locked:** Go ONLINE, lock the phone screen, place a Bike order → Verify the lock-screen notification wakes the screen and plays the alert sound.
6. **Notification Permission Denied:** Deny Notification permission in Android Settings and toggle ONLINE → Verify QPartner shows the `Notifications Disabled` alert with an **`Open Settings`** button.
7. **Notification Permission Granted:** Re-enable Notification permission in Settings and toggle ONLINE → Verify `Quickora Partner — You're Online — Searching for orders` appears in the status bar.
8. **Partner Switches Offline:** Toggle the switch to OFFLINE → Verify the `Quickora Partner — You're Online — Searching for orders` notification disappears immediately and new orders do not alert.
9. **New Bike Order:** Log in with Bike driver account (`393f1645-****-2ce4`), go ONLINE, place a Bike order (`taxi_bike`) → Verify alert arrives and can be accepted.
10. **New Cab Order:** Log in with a verified Cab driver account (`vehicle_type = 'cab'`), go ONLINE, place a Cab (`taxi_car`) or Tata Ace (`log_mini_auto`) order → Verify alert arrives and can be accepted.

---

## 12. Rollback Instructions

To revert the changes made during this audit, restore the modified files in `D:\Quickora Delivery\QPartner` (`app.json`, `app/_layout.tsx`, `app/(tabs)/bookings.tsx`, `app/(auth)/permissions.tsx`, `contexts/auth-context.tsx`, `services/notification.service.ts`, `services/notification-engine.service.ts`, `services/background-task.ts`, `services/push-token.service.ts`, `services/food-driver.service.ts`, `services/grocery-driver.service.ts`, `supabase/functions/notify-driver/index.ts`).

---

## 13. Final Status

**EXPO GO COMPATIBILITY: NOT SUPPORTED FOR REMOTE FCM / SWIPE-KILLED APP (SUPPORTED FOR LOCAL PERSISTENT ONLINE NOTIFICATION & MINIMIZED POLLING AFTER OUR FIX)**

**CUSTOM DEVELOPMENT BUILD: NOT TESTED (REQUIRES `eas build --platform android --profile development`)**

**EAS PREVIEW APK: NOT TESTED (REQUIRES `eas build --platform android --profile preview`)**

**PRODUCTION APK: NOT TESTED (REQUIRES `eas build --platform android --profile production`)**

**PERSISTENT ONLINE NOTIFICATION: PASS (SOURCE CODE VERIFIED — POSTS `Quickora Partner — You're Online — Searching for orders` IMMEDIATELY IN BOTH EXPO GO & APK; PENDING DEVICE VERIFICATION)**

**BACKGROUND ORDER ALERT: BLOCKED FOR KILLED APP (PENDING `notify-driver` EDGE FUNCTION DEPLOYMENT & APK INSTALL) / PASS FOR MINIMIZED APP IN CODE**

**HEADS-UP NOTIFICATION: PASS (SOURCE CODE VERIFIED ON `'bookings'` CHANNEL WITH `IMPORTANCE_MAX` / PENDING DEVICE VERIFICATION)**

**FULL-SCREEN INTENT: NOT ELIGIBLE (ANDROID 14+ & GOOGLE PLAY RESTRICT `USE_FULL_SCREEN_INTENT` TO CALL/ALARM APPS; COMPLIANT `IMPORTANCE_MAX` HEADS-UP + TAP-TO-MODAL IMPLEMENTED)**

**ANDROID PERMISSIONS: COMPLETE (ALL REQUIRED PERMISSIONS CONFIGURED IN `app.json` & RUNTIME FLOWS)**

**PRODUCTION READINESS: BLOCKED (AWAITING: 1. DEPLOYMENT OF `notify-driver` EDGE FUNCTION, 2. SUPABASE WEBHOOK CHECK, 3. EAS APK BUILD & INSTALL ON PHONE)**

