# QPARTNER — PRODUCTION BACKGROUND ORDER NOTIFICATION & FOREGROUND SERVICE AUDIT REPORT

**Application:** Quickora QPartner (Delivery Partner Android Application)  
**Confirmed Project Path:** `D:\Quickora Delivery\QPartner`  
**Android Package Name:** `com.quickora.qpartner`  
**Supabase Project Ref:** `zoatdppograoxpgifhbl`  
**Audit & Investigation Date:** November 17, 2026  

---

## 1. Executive Summary: Actual Root Cause of Continued Background Failure

After performing a **live read-only production diagnostic** against the Supabase backend (`zoatdppograoxpgifhbl`), the deployed Edge Functions, and the live `public.users`, `public.rides`, and `public.orders` tables, we identified the **exact reasons** why incoming orders currently appear only after manually opening QPartner:

### Primary Production Failure Chain (Verified via Live Read-Only Probes)

1. **DEPLOYED `notify-driver` EDGE FUNCTION IS STALE (VERSION 9 FROM JUNE 29, 2026) AND CRASHES WITH `HTTP 500: DB error` ON EVERY ORDER:**
   - Running `supabase functions list --project-ref zoatdppograoxpgifhbl` confirmed that the deployed `notify-driver` Edge Function in production is **Version 9 (`UPDATED_AT: 2026-06-29 18:06:38 UTC`)** — it has **not** yet been redeployed with the updated local source code.
   - Live Probe C against `https://zoatdppograoxpgifhbl.supabase.co/functions/v1/notify-driver` returned **`HTTP 500: DB error`** because deployed Version 9 executes `.from('users').select('..., accept_both')`, which immediately fails with PostgreSQL error `42703: column users.accept_both does not exist` **before any FCM HTTP v1 request is ever sent**.
   - Additionally, deployed Version 9:
     - Sends a **data-only** FCM payload without a `notification` block (so Android OS displays nothing when the app is closed or swiped from Recents).
     - Excludes `vehicle_category = 'logistics'` + `vehicle_type = 'bike'` (which is your active online driver account `393f1645-****-2ce4`!) from receiving `'taxi_bike'` orders (`8c2c49ed-****-e0b3`).
     - Enforces a hard `MAX_RADIUS_KM = 10` km cutoff, which drops ride `8c2c49ed-****-e0b3` whose pickup `(11.3063, 77.1388)` is **12.53 km** from driver `393f1645-****-2ce4` `(11.3817, 77.2243)`, even though `DriverService.getAvailableRides()` has no distance cutoff and displays the ride as soon as you open the app.
     - Returns `200 "No eligible vehicle categories"` for `log_mini_auto` (Tata Ace / Mini-Truck) and `200 "Not a pending ride"` for `orders`.

2. **THE APK INSTALLED ON THE ANDROID PHONE HAS NOT BEEN REBUILT & REINSTALLED YET:**
   - As noted in Section 4, `npx expo export --platform android` only compiles a local JavaScript bundle for verification and **does not update the native APK installed on your handset**.
   - Until a new APK is built (`npx eas build --platform android --profile preview`) and installed on your phone, the phone continues running the pre-fix bundle where:
     - `NotificationService` suppressed banners and sound (`shouldShowBanner: !isBooking`) without checking `AppState.currentState === 'active'`.
     - `BACKGROUND_RIDE_TASK` (5s foreground service polling) only called `NativeBridgeService.updateFloatingWidgetData` (a no-op) and never scheduled a system notification.
     - Cold-start notification taps were dropped because `getLastNotificationResponseAsync()` was not called.

3. **PRODUCTION SCHEMA MISMATCH ON `public.orders` (`column orders.driver_id does not exist`) — FIXED IN CODE:**
   - Live read-only inspection of `public.orders` returned `HTTP 400: {"code":"42703","message":"column orders.driver_id does not exist"}`.
   - Any query in `notify-driver/index.ts` or `background-task.ts` referencing `orders.driver_id` would fail against production until `schema_updates.sql` Section 7 is applied. We immediately updated `supabase/functions/notify-driver/index.ts`, `services/background-task.ts`, `services/food-driver.service.ts`, and `services/grocery-driver.service.ts` to work cleanly without requiring `orders.driver_id` and removed the `MAX_RADIUS_KM` cutoff in `notify-driver/index.ts`.

---

## 2. Live Production Pipeline Verification (9-Stage Trace)

All diagnostics were executed strictly in **READ-ONLY** mode against `https://zoatdppograoxpgifhbl.supabase.co` without creating fake orders, modifying records, or exposing secrets:

| Stage | Pipeline Step | Live Production Result | Status |
| :--- | :--- | :--- | :--- |
| **Stage 1** | **Order is created in DB** | Verified real pending Bike order `8c2c49ed-****-e0b3` (`service_type: 'taxi_bike'`, `status: 'pending'`, `driver_id: null`, `fare: ₹179.2`, `distance_km: 14.85`, `pickup: (11.3063, 77.1388)`, created `2026-11-17T10:02:47Z`) and pending Cab order `65eb5eba-****-b53f` (`service_type: 'taxi_car'`, `status: 'pending'`, `driver_id: null`, `fare: ₹254.9`, `distance_km: 7.83`, `pickup: (11.3829, 77.2211)`). | **PASS** (`BACKEND VERIFIED`) |
| **Stage 2** | **Eligible QPartner & FCM Token in DB** | Verified active driver `393f1645-****-2ce4` in `public.users`: `is_online: true`, `rider_status: "verified"`, `vehicle_category: "logistics"`, `vehicle_type: "bike"`, `coords: (11.3817, 77.2243)`, `updated_at: 2026-11-17T10:10:30Z`. Note: **0 verified Cab drivers** currently exist in `public.users` (only 1 driver row exists in `public.users`, which is `bike`). | **PASS for Bike / NO CAB DRIVER IN DB** (`BACKEND VERIFIED`) |
| **Stage 3** | **Registered Push Token Type & Validity** | Driver `393f1645-****-2ce4` has `fcm_token` populated (`length: 142`, SHA-256 prefix: `6bbd2d78c0`). Confirmed format is a **Native FCM Registration Token** (contains `:` instance separator, length 142 — **NOT** an `ExponentPushToken[...]`). Matches FCM HTTP v1 API requirements. | **PASS** (`BACKEND VERIFIED`) |
| **Stage 4** | **Supabase Webhook Configuration** | Customer apps (`Quickora` and `quickora-web`) only `INSERT` into `public.rides` and do not invoke `notify-driver` from client code; push dispatch relies on a Supabase Database Webhook on `public.rides` (`INSERT`). Webhook status in Supabase Dashboard must be verified/enabled manually. | **NOT CONFIGURED / UNVERIFIED IN DASHBOARD** |
| **Stage 5** | **Edge Function Deployment & Execution (FIRST FAILING STAGE)** | `supabase functions list` confirmed `notify-driver` in production is **Version 9 (`2026-06-29 18:06:38 UTC`)**. Live HTTP probes proved Version 9 returns **`HTTP 500: DB error`** on valid ride payloads (`column users.accept_both does not exist`), returns `No eligible vehicle categories` on `log_mini_auto`, and returns `Not a pending ride` on `orders`. | **FAIL — STALE DEPLOYMENT CRASHES WITH HTTP 500** (`BACKEND VERIFIED`) |
| **Stage 6** | **FCM HTTP v1 Secrets Configuration** | `supabase secrets list` confirmed `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, and `FCM_PRIVATE_KEY` are set in production. Verified `SHA256("qpartner-3e88c")` = `8409109ba0dafddd8a7b887bd0d9f8a964e9fbaa60c654d31543e4fa7778f711`, which is an **exact 100% match** with the production `FCM_PROJECT_ID` secret digest and `google-services.json`. | **PASS** (`BACKEND VERIFIED`) |
| **Stage 7** | **FCM HTTP v1 Request & Response** | Never reached in production because deployed `notify-driver` Version 9 aborts at Stage 5 with `HTTP 500: DB error` before calling `getGoogleAccessToken()` or `sendFcmPush()`. | **FAIL — BLOCKED BY STAGE 5** (`BACKEND VERIFIED`) |
| **Stage 8** | **Android Device Receives Push** | No FCM message was transmitted by the server due to Stage 5 failure. When QPartner was manually opened, `anon` `SELECT` on `public.rides` succeeded (returning 3 rows), which is why the order appeared only upon opening the app. | **FAIL — NO PUSH SENT BY SERVER** (`BACKEND VERIFIED`) |
| **Stage 9** | **Installed Android APK Configuration** | Installed handset APK has not yet been rebuilt via EAS Build since the code fixes were written. | **FAIL — REQUIRES APK REBUILD & INSTALL** |

---

## 3. Detailed Investigation Findings (Sections 3A – 3D & 4)

### A. Is the Edge Function Actually Deployed?
- **Finding:** `notify-driver` exists in Supabase project `zoatdppograoxpgifhbl` (`ID: c998abaf-08ed-47be-861e-a839a462a3ac`, `STATUS: ACTIVE`), **but it is running Version 9 from `2026-06-29 18:06:38 UTC`**, NOT the latest local source code in [`supabase/functions/notify-driver/index.ts`](file:///d:/Quickora%20Delivery/QPartner/supabase/functions/notify-driver/index.ts).
- **Live Probe Evidence:**
  - `Probe A` (`type: 'UPDATE'`, `old_record.status: 'pending'`): Returned `200 "No eligible vehicle categories"` instead of `"Duplicate pending update ignored"`, confirming Version 9 lacks the duplicate-update guard.
  - `Probe B` (`table: 'orders'`, `store_type: 'food'`, `status: 'preparing'`): Returned `200 "Not a pending ride"`, confirming Version 9 does not support Food/Grocery orders.
  - `Probe C` (`table: 'rides'`, `status: 'pending'`, `service_type: 'log_truck'`): Returned **`500 "DB error"`**, confirming Version 9 crashes when querying `public.users` for non-existent column `accept_both`.
  - `Probe D` (`table: 'rides'`, `status: 'pending'`, `service_type: 'log_mini_auto'`): Returned `200 "No eligible vehicle categories"`, confirming Version 9 lacks `log_mini_auto` mapping.

### B. Is the Supabase Webhook Actually Configured?
- **Table & Event Architecture:**
  - **Bike & Cab Logistics / Transport Orders** are inserted into `public.rides` (`status = 'pending'`, `driver_id = NULL`).
  - **Bike Logistics `service_type`:** Customer apps (`Quickora` and `quickora-web`) insert `service_type = 'taxi_bike'` for Bike bookings (and `'log_bike'` / `'parcel'` if booked via logistics config).
  - **Cab / Mini-Truck Logistics `service_type`:** Customer apps insert `service_type = 'taxi_car'` for Cab and `service_type = 'log_mini_auto'` for Tata Ace / Mini-Truck Logistics.
  - **Assignment Model:** Open-pool dispatch (`status = 'pending'`, `driver_id IS NULL`) followed by atomic driver claim via `accept_ride(p_ride_id, p_driver_id)`.
- **Webhook Requirement:** Neither `Quickora` (`services/ride.service.ts`) nor `quickora-web` (`src/services/rideService.ts`) calls `notify-driver` from client code. Therefore, a Supabase Database Webhook on `public.rides` (`INSERT`) is mandatory to trigger `notify-driver`.

### C. Is the Registered Push Token Correct?
- **Code & Live DB Verification (`PASS`):**
  - [`services/notification.service.ts`](file:///d:/Quickora%20Delivery/QPartner/services/notification.service.ts#L367-L388) calls `Notifications.getDevicePushTokenAsync()`, which returns the **raw native Android FCM token** (NOT `getExpoPushTokenAsync()`).
  - Live database inspection of `public.users` confirmed that driver `393f1645-****-2ce4` has a valid 142-character native FCM registration token (`tokenHash: 6bbd2d78c0`, updated `2026-11-17T10:10:30Z`).
  - `google-services.json` (`project_id: qpartner-3e88c`, package: `com.quickora.qpartner`) matches the `FCM_PROJECT_ID` secret in Supabase (`SHA-256: 8409109ba0dafddd8a7b887bd0d9f8a964e9fbaa60c654d31543e4fa7778f711`).

### D. Additional Code Defects Found & Fixed During Live Diagnosis
1. **Removed `MAX_RADIUS_KM` Hard Cutoff in [`supabase/functions/notify-driver/index.ts`](file:///d:/Quickora%20Delivery/QPartner/supabase/functions/notify-driver/index.ts):**
   - Previously, `notify-driver` skipped any driver whose last stored GPS coordinates were >10–15 km from the ride pickup. For real test ride `8c2c49ed-****-e0b3`, the distance between driver `393f1645-****-2ce4` `(11.3817, 77.2243)` and pickup `(11.3063, 77.1388)` was **12.53 km**. Removing the hard distance cutoff ensures that any order visible in `BookingsScreen` (`DriverService.getAvailableRides()`) also triggers a push notification to eligible online verified drivers.
2. **Removed Non-Existent `orders.driver_id` Queries in [`supabase/functions/notify-driver/index.ts`](file:///d:/Quickora%20Delivery/QPartner/supabase/functions/notify-driver/index.ts), [`services/background-task.ts`](file:///d:/Quickora%20Delivery/QPartner/services/background-task.ts), [`services/food-driver.service.ts`](file:///d:/Quickora%20Delivery/QPartner/services/food-driver.service.ts), and [`services/grocery-driver.service.ts`](file:///d:/Quickora%20Delivery/QPartner/services/grocery-driver.service.ts):**
   - Live query to `public.orders` revealed `column orders.driver_id does not exist` (`42703`). Removed `orders.driver_id` queries from `notify-driver` and `background-task.ts`, and added automatic `42703` fallback in `food-driver.service.ts` and `grocery-driver.service.ts`.
3. **Note on Cab Order Testing in Production DB:**
   - Currently, `public.users` contains **only 1 driver record** (`393f1645-****-2ce4`), which is registered as `vehicle_category: "logistics"`, `vehicle_type: "bike"`. Because a Bike partner cannot fulfill a 4-wheeler Cab order (`service_type: "taxi_car"`, such as `65eb5eba-****-b53f`), testing Cab order push notifications requires logging into a driver account whose `vehicle_type` is `'cab'` (or `'car'`), or switching the test driver's `vehicle_type` to `'cab'` during Cab testing.

---

## 4. Exact Files Modified in `D:\Quickora Delivery\QPartner`

1. [`supabase/functions/notify-driver/index.ts`](file:///d:/Quickora%20Delivery/QPartner/supabase/functions/notify-driver/index.ts) — Fixed `accept_both` crash, added hybrid FCM `notification` + `data` payload on `'bookings'` channel (`PRIORITY_MAX`, `booking_alert.wav`, `ttl: 60s`), aligned cross-category Bike (`taxi_bike`, `log_bike`, `parcel`) and Cab/Mini-Truck (`taxi_car`, `log_cab`, `log_mini_auto`, `log_mini_truck`) mappings, removed `MAX_RADIUS_KM` cutoff, removed non-existent `orders.driver_id` query, and added `dry_run` diagnostic support.
2. [`services/background-task.ts`](file:///d:/Quickora%20Delivery/QPartner/services/background-task.ts) — Upgraded `BACKGROUND_NOTIFICATION_TASK` and `BACKGROUND_RIDE_TASK` to dispatch deduplicated high-priority local notifications on `'bookings'` channel, verify backend `is_online` truth, sync GPS coordinates, and query `public.orders` without non-existent `driver_id`.
3. [`services/notification.service.ts`](file:///d:/Quickora%20Delivery/QPartner/services/notification.service.ts) — Fixed `handleNotification` to check `AppState.currentState === 'active'` (so background/minimized notifications always show heads-up banner and play sound), added `'online_status'` and `'bookings'` channels, and implemented `startOnlineForegroundService` / `stopOnlineForegroundService`.
4. [`services/notification-engine.service.ts`](file:///d:/Quickora%20Delivery/QPartner/services/notification-engine.service.ts) — Added multi-domain support (`transport`, `food`, `grocery`), eliminated 8-second duplicate notification spam, and added background transition surfacing.
5. [`services/push-token.service.ts`](file:///d:/Quickora%20Delivery/QPartner/services/push-token.service.ts) — Added retry-on-failure token persistence and `listenForPushTokenRefresh` (`Notifications.addPushTokenListener`).
6. [`services/food-driver.service.ts`](file:///d:/Quickora%20Delivery/QPartner/services/food-driver.service.ts) & [`services/grocery-driver.service.ts`](file:///d:/Quickora%20Delivery/QPartner/services/grocery-driver.service.ts) — Added fallback when `orders.driver_id` column is not present in production DB (`42703`).
7. [`app/_layout.tsx`](file:///d:/Quickora%20Delivery/QPartner/app/_layout.tsx) — Added cold-start (`getLastNotificationResponseAsync`) and warm-start (`addNotificationResponseReceivedListener`) notification handling, connected `incomingOrder` to `NotificationEngine`, and synced online foreground service on startup.
8. [`app/(tabs)/bookings.tsx`](file:///d:/Quickora%20Delivery/QPartner/app/(tabs)/bookings.tsx) — Integrated `startOnlineForegroundService` / `stopOnlineForegroundService`, added notification permission guidance, and added `NetInfo` reconnect refresh.
9. [`app/(auth)/permissions.tsx`](file:///d:/Quickora%20Delivery/QPartner/app/(auth)/permissions.tsx) — Removed non-compliant `SYSTEM_ALERT_WINDOW` gate and added `registerDriverPushToken` call on Continue.
10. [`contexts/auth-context.tsx`](file:///d:/Quickora%20Delivery/QPartner/contexts/auth-context.tsx) — Added foreground service and notification cleanup on logout.
11. [`app.json`](file:///d:/Quickora%20Delivery/QPartner/app.json) — Added `POST_NOTIFICATIONS`, `VIBRATE`, `RECEIVE_BOOT_COMPLETED`; removed unused `RECORD_AUDIO`; set `defaultChannel` to `"bookings"`.
12. [`schema_updates.sql`](file:///d:/Quickora%20Delivery/QPartner/schema_updates.sql) & [`__tests__/background-notification-system.test.js`](file:///d:/Quickora%20Delivery/QPartner/__tests__/background-notification-system.test.js) — Added index proposal and 6-part automated test suite.

---

## 5. Exact Manual Actions Required Before Physical Device Testing

Per Section 8 rules, production deployments and database webhooks require your explicit approval or manual execution:

### Action 1: Deploy the Fixed `notify-driver` Edge Function to Supabase
Run the following command in PowerShell (or approve me to run it for you):
```powershell
cd "D:\Quickora Delivery\QPartner"
supabase functions deploy notify-driver --project-ref zoatdppograoxpgifhbl
```
*(Once deployed, Version 10 will replace the broken Version 9 from June 29, 2026, eliminating the `500 DB error` crash immediately.)*

### Action 2: Verify / Enable the Database Webhook in Supabase Dashboard
1. Open **Supabase Dashboard** → Project `zoatdppograoxpgifhbl` → **Database** → **Webhooks**.
2. Verify that a webhook exists on table **`public.rides`** for event **`INSERT`** (or create one named `notify_driver_on_ride`):
   - **Table:** `public.rides`
   - **Events:** `INSERT`
   - **Type:** `Supabase Edge Functions` → select `notify-driver` (Method: `POST`)
   - **HTTP Headers:** `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`
3. *(Optional for Food/Grocery)* Create a second webhook `notify_driver_on_order` on table **`public.orders`** for events **`INSERT`, `UPDATE`** pointing to `notify-driver`.

### Action 3: Build & Install the Updated QPartner Android APK
Because native notification channels, `app.json` permissions, and the updated JS bundle must be compiled into the APK installed on your phone:
```powershell
cd "D:\Quickora Delivery\QPartner"
eas build --platform android --profile preview
```
Download and install the resulting `.apk` on your Android phone.

---

## 6. Step-by-Step Physical Android Device Verification Procedure

Perform the following 12-step verification on your Android phone after completing Actions 1–3:

1. **Build the Updated QPartner APK:** Run `eas build --platform android --profile preview` in `D:\Quickora Delivery\QPartner`.
2. **Install the APK:** Uninstall any older QPartner build on your Android phone and install the newly generated APK.
3. **Login to QPartner:** Log in with your verified partner phone number (`393f1645-****-2ce4`).
4. **Grant Permissions:** Grant Foreground Location ("While using the app"), Background Location ("Allow all the time"), and Notifications ("Allow").
5. **Switch to ONLINE:** Toggle the availability switch to **ONLINE** on the Bookings tab.
6. **Verify Persistent Online Notification:** Pull down the Android notification bar and confirm you see **`Quickora Partner — You're Online — Waiting for new orders`**.
7. **Minimize QPartner:** Press the Android Home button (or switch to another app such as YouTube/WhatsApp) and lock the phone screen.
8. **Place a Safe Test Bike Logistics Order:** From the Customer App, place a Bike order (`taxi_bike`).
9. **Verify Push Notification Appears Without Opening QPartner:** Confirm that the high-priority **`New Quickora Order • Bike Taxi / Delivery`** alert rings (`booking_alert.wav`), vibrates, and appears on your lock screen / heads-up banner without opening QPartner.
10. **Tap the Notification:** Tap the notification body (or tap **`✅ Accept`** directly on the notification).
11. **Verify Incoming Order Screen:** Confirm QPartner opens and immediately displays the incoming order modal (`GlobalRideAlertModal`) with countdown timer, fare, and pickup/drop addresses (or routes directly to `/active-ride/[id]` if you tapped `✅ Accept`).Cancel/clean up the test order from the customer side if you do not wish to complete it.
12. **Test Swiping App from Recents & Test Cab Separately:**
    - **Swiped from Recents Test:** While ONLINE, open Android Recent Apps and swipe QPartner away (Note: **Do NOT** go to `Android Settings → Apps → Force Stop`, as Android OS permanently blocks all FCM pushes to force-stopped apps until manually reopened). Place another test order and confirm the server-side FCM push notification still arrives in the system tray and cold-starts QPartner into the order when tapped.
    - **Cab Order Test:** Log in on QPartner with a verified Cab driver account (`vehicle_type = 'cab'`), switch to ONLINE, minimize the app, and place a Cab (`taxi_car`) or Tata Ace (`log_mini_auto`) order from the Customer App to verify Cab push delivery.

---

## 7. Final Verification Status

**EDGE FUNCTION DEPLOYMENT: FAIL (PRODUCTION IS STILL RUNNING VERSION 9 FROM 2026-06-29 WHICH CRASHES WITH HTTP 500 `DB error`; LOCAL FIX READY TO DEPLOY)**

**SUPABASE WEBHOOK: NOT VERIFIED (REQUIRES DASHBOARD CHECK / ENABLEMENT ON `public.rides`)**

**FCM TOKEN REGISTRATION: PASS (VERIFIED IN LIVE DB: DRIVER `393f1645-****-2ce4` HAS VALID 142-CHAR NATIVE FCM TOKEN & MATCHING `FCM_PROJECT_ID` SECRET)**

**FCM MESSAGE DELIVERY: FAIL (BLOCKED IN PRODUCTION BECAUSE DEPLOYED `notify-driver` V9 CRASHES AT DB QUERY BEFORE CALLING FCM)**

**ANDROID BACKGROUND DISPLAY: NOT TESTED (REQUIRES DEPLOYING `notify-driver` V10 + INSTALLING REBUILT APK ON PHONE)**

**APP SWIPED FROM RECENTS: NOT TESTED (REQUIRES DEPLOYING `notify-driver` V10 + INSTALLING REBUILT APK ON PHONE)**

**BIKE ORDER PUSH: NOT TESTED END-TO-END ON DEVICE (REAL PENDING BIKE ORDER `8c2c49ed-****-e0b3` VERIFIED IN DB; PUSH BLOCKED BY UNDEPLOYED `notify-driver` V9)**

**CAB ORDER PUSH: NOT TESTED (REAL PENDING CAB ORDER `65eb5eba-****-b53f` VERIFIED IN DB; NO VERIFIED CAB DRIVER CURRENTLY ONLINE IN `public.users` + BLOCKED BY UNDEPLOYED `notify-driver` V9)**

**PRODUCTION READINESS: BLOCKED (AWAITING APPROVAL TO DEPLOY `notify-driver` EDGE FUNCTION, VERIFY SUPABASE WEBHOOK, AND INSTALL REBUILT APK ON PHYSICAL DEVICE)**
