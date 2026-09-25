# QUICKORA Q PARTNER — MASTER ARCHITECTURE & INTEGRATION PLAN
## READ-ONLY MASTER PLANNING AUDIT

**Document Version**: 1.0.0 (Master Planning Baseline)  
**Date**: September 17, 2026  
**Auditor**: Antigravity AI  
**Scope**: Non-mutating architectural analysis and integration blueprint bridging the **FROZEN Quickora Customer App V1** and the **Q Partner Application** across **Transport (Taxi/Logistics)**, **Food Delivery**, and **Grocery Delivery**.  
**Execution Guard**: **0 Code Changes | 0 Database Migrations | 0 Customer V1 Unlocks**.

---

## 1. Executive Summary

This Master Architecture & Integration Plan provides the technical blueprint for expanding the **Q Partner** driver application from a standalone Transport/Taxi tool into a **Unified Partner SuperApp** (Transport, Food Delivery, and Quickora SuperMart Grocery Delivery).

### Core Architectural Realities Discovered

1. **Customer App V1 Baseline**:
   - The Customer App V1 is **100% frozen** and operates against two distinct operational database tables:
     - `public.rides`: Powers 6-vehicle transport (`taxi_bike`, `taxi_auto`, `taxi_car`, `log_bike`, `log_mini_truck`, `log_truck`).
     - `public.orders`: Powers Food Delivery and SuperMart Grocery Delivery (`store_type: 'food'` vs `'grocery'`), with status stages `pending ➔ confirmed ➔ preparing ➔ out_for_delivery ➔ delivered`.
2. **Q Partner Baseline**:
   - Q Partner currently implements a complete, working **Transport workflow** (Taxi & Logistics) with atomic claiming (`accept_ride`), server-side OTP verification (`verify_ride_otp`), FCM HTTP v1 push dispatch (`notify-driver`), 8-second repeating alert loops (`NotificationEngine`), and native Android floating overlays (`FloatingWidgetService.kt`).
   - Q Partner currently contains **0 implementation of Food or Grocery orders**.
3. **Primary Integration Challenge**:
   - `public.orders` currently lacks driver assignment fields (`driver_id`, `delivery_otp`).
   - Q Partner manages driver accounts in `public.users` via custom `public.otp` verification, whereas Customer App V1 operates via Supabase Auth (`auth.users`) and `public.profiles`.
4. **Integration Strategy**:
   - **Zero modifications to Customer App V1**.
   - Preserve existing Transport architecture in its entirety.
   - Build an **isolated backend integration and atomic dispatch layer** (`claim_food_order`, `claim_grocery_order`, unified notification router) that feeds both domains into a unified incoming alert pipeline on Q Partner.

---

## 2. Current Architecture (As of Today)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        QUICKORA ECOSYSTEM (CURRENT STATE)                       │
├──────────────────────────────────────┬──────────────────────────────────────────┤
│        CUSTOMER APP V1 (FROZEN)      │          Q PARTNER DRIVER APP            │
│  - Supabase Auth (auth.users)        │  - Custom OTP Auth (public.otp)          │
│  - public.profiles                   │  - public.users (is_driver = true)       │
│  - Transport UI (public.rides)       │  - Transport Dashboard (public.rides)    │
│  - Food/Grocery UI (public.orders)   │  - Native Kotlin Overlay & Alarm Ringing │
│  - Razorpay Online / COD Payments    │  - No Food / Grocery Awareness (0%)      │
├──────────────────────────────────────┴──────────────────────────────────────────┤
│                       SHARED SUPABASE POSTGRESQL 15                             │
│  ┌─────────────────────────┐ ┌─────────────────────────┐ ┌────────────────────┐ │
│  │      public.rides       │ │      public.orders      │ │    public.users    │ │
│  │ (Taxi / Freight Engine) │ │ (Food / Grocery Engine) │ │  (Driver Records)  │ │
│  └─────────────────────────┘ └─────────────────────────┘ └────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Frozen Customer App V1 Boundary

| Principle | Enforcement & Evidence |
| :--- | :--- |
| **Status** | **FINAL / FROZEN / LOCKED** ([`V1_FREEZE.md`](file:///d:/Quickora%20Delivery/Quickora/V1_FREEZE.md)) |
| **Customer App UI** | Must NOT be modified. Customer App V1 consumes `public.orders` and `public.rides` updates via PostgreSQL Realtime subscriptions. |
| **Customer Order Tracking** | [`components/ActiveFoodOrderTracker.tsx`](file:///d:/Quickora%20Delivery/Quickora/components/ActiveFoodOrderTracker.tsx) subscribes to `postgres_changes` on `public.orders` where `id = eq.${orderId}`. When `status` changes to `out_for_delivery` or `delivered`, the UI transitions automatically. |
| **Customer Payment Flow** | Razorpay online verification and COD pipelines are server-authoritative and immutable. |
| **Customer V1 Modification Rule** | **STRICTLY PROHIBITED**. All dispatch, partner assignment, and lifecycle extensions must occur in PostgreSQL RPCs, Edge Functions, and Q Partner client code. |

---

## 4. Frozen Transport Boundary

The existing Q Partner Transport engine is working and must remain completely untouched:

| Transport Subsystem | Current Implementation | Preservation Status | Evidence File |
| :--- | :--- | :---: | :--- |
| **Vehicle Categories** | 6 vehicle types (`taxi_bike`, `taxi_auto`, `taxi_car`, `log_bike`, `log_mini_truck`, `log_truck`) | **FROZEN** | [`services/driver.service.ts`](file:///d:/Quickora%20Delivery/QPartner/QPartner/services/driver.service.ts) |
| **Atomic Claiming** | `accept_ride(p_ride_id, p_driver_id)` with `FOR UPDATE SKIP LOCKED` | **FROZEN** | [`schema_updates.sql:L57-109`](file:///d:/Quickora%20Delivery/QPartner/QPartner/schema_updates.sql#L57-L109) |
| **OTP Verification** | `verify_ride_otp(p_ride_id, p_entered_otp)` with `SECURITY DEFINER` | **FROZEN** | [`schema_updates.sql:L9-24`](file:///d:/Quickora%20Delivery/QPartner/QPartner/schema_updates.sql#L9-L24) |
| **Completion & 80% Payout**| `complete_driver_ride(p_ride_id, p_driver_id, p_earnings_amount)` | **FROZEN** | [`schema_updates.sql:L114-132`](file:///d:/Quickora%20Delivery/QPartner/QPartner/schema_updates.sql#L114-L132) |
| **Active Ride Screen** | [`app/active-ride/[id].tsx`](file:///d:/Quickora%20Delivery/QPartner/QPartner/app/active-ride/%5Bid%5D.tsx) (Hardware Back Locked) | **FROZEN** | [`app/active-ride/[id].tsx`](file:///d:/Quickora%20Delivery/QPartner/QPartner/app/active-ride/%5Bid%5D.tsx) |
| **Alarm & Alert Engine** | Kotlin `DriverServiceModule.startRinging()` + `NotificationEngine.ts` | **FROZEN** | [`services/native-bridge.service.ts`](file:///d:/Quickora%20Delivery/QPartner/QPartner/services/native-bridge.service.ts) |

---

## 5. Food Delivery Workflow — Architectural Specification

```
   [Customer Places Food Order] (Customer App V1)
                 │
                 ▼ (orders table: status = 'pending')
   [Restaurant Accepts & Prepares] (status = 'confirmed' ➔ 'preparing')
                 │
                 ▼ (Trigger: Food Dispatch Event)
   [Unified Dispatch Engine identifies nearby online Bike Drivers]
                 │
                 ▼ (FCM HTTP v1 + Supabase Realtime)
   [Q Partner Receives Food Booking Request]
                 │
         ┌───────┴───────┐
         ▼               ▼
   [Driver Declines]   [Driver Taps Accept]
         │               │
         ▼               ▼
   [Next Driver]       [RPC: claim_food_order]
                         • Row lock on orders table
                         • Sets driver_id = auth_id
                         • status = 'preparing' (driver assigned)
                         │
                         ▼
                       [Active Food Delivery Screen on Q Partner]
                         │
                         ├── 1. Navigate to Restaurant (Store GPS)
                         ├── 2. Arrived at Restaurant (status = 'preparing')
                         ├── 3. Pick Up Order (Verify items & bill)
                         ├── 4. Tap "Order Picked Up" (status = 'out_for_delivery')
                         ├── 5. Navigate to Customer Address
                         └── 6. Delivered ➔ Enter OTP / Confirm ➔ status = 'delivered'
                                 │
                                 ▼
                               [RPC: complete_food_delivery]
                               • Credits delivery fee + surge + tips to driver_earnings
```

### Food Integration Mapping Matrix

| Workflow Stage | Customer App V1 Source | DB Table & Column | Q Partner Status | Classification | Integration Requirement |
| :--- | :--- | :--- | :--- | :---: | :--- |
| **Order Placement** | `order-confirmation.tsx` | `public.orders.status = 'pending'` | Unaware | **EXISTING** in V1 | None (Backend manages) |
| **Restaurant Prep** | `ActiveFoodOrderTracker.tsx` | `public.orders.status = 'preparing'` | Unaware | **EXISTING** in V1 | Dispatch trigger on `preparing` |
| **Driver Assignment**| `ActiveFoodOrderTracker.tsx` | `public.orders` (Missing `driver_id`) | Needs Handler | **MISSING** in DB | Add `driver_id` column to `orders` |
| **Driver Accept** | None (Driver side) | Proposed `claim_food_order()` RPC | New Screen | **MISSING** in QPartner | Create atomic claiming RPC |
| **Pickup Event** | `ActiveFoodOrderTracker.tsx` | `public.orders.status = 'out_for_delivery'`| Action button | **EXISTING** in V1 | Q Partner updates status |
| **Delivery Completion**| `ActiveFoodOrderTracker.tsx`| `public.orders.status = 'delivered'` | Action button | **EXISTING** in V1 | RPC records driver earnings |

---

## 6. Grocery Delivery Workflow — Architectural Specification

```
   [Customer Places SuperMart Order] (Customer App V1)
                 │
                 ▼ (orders table: store_type = 'grocery', status = 'pending')
   [Store Accepts & Packs Items] (status = 'confirmed' ➔ 'preparing')
                 │
                 ▼ (Trigger: Grocery Dispatch Event)
   [Unified Dispatch Engine identifies nearby online Delivery Drivers]
                 │
                 ▼ (FCM HTTP v1 + Supabase Realtime)
   [Q Partner Receives SuperMart Delivery Alert]
                 │
         ┌───────┴───────┐
         ▼               ▼
   [Driver Declines]   [Driver Taps Accept]
         │               │
         ▼               ▼
   [Next Driver]       [RPC: claim_grocery_order]
                         • Sets driver_id on orders row
                         │
                         ▼
                       [Active Grocery Delivery Screen on Q Partner]
                         │
                         ├── 1. Navigate to SuperMart Hub
                         ├── 2. Verify Package Count / Order Number
                         ├── 3. Tap "Items Collected" (status = 'out_for_delivery')
                         ├── 4. Navigate to Customer Address
                         └── 5. Tap "Delivered" ➔ status = 'delivered'
                                 │
                                 ▼
                               [RPC: complete_grocery_delivery]
                               • Credits delivery fee to driver_earnings
```

### Grocery Integration Mapping Matrix

| Workflow Stage | Customer App V1 Source | DB Table & Column | Q Partner Status | Classification | Integration Requirement |
| :--- | :--- | :--- | :--- | :---: | :--- |
| **Order Placement** | `order-confirmation.tsx` | `public.orders.store_type = 'grocery'` | Unaware | **EXISTING** in V1 | Filter by `store_type = 'grocery'` |
| **Store Packing** | `ActiveFoodOrderTracker.tsx` | `public.orders.status = 'preparing'` | Unaware | **EXISTING** in V1 | Store marks packed |
| **Driver Claim** | None | Proposed `claim_grocery_order()` RPC | New Screen | **MISSING** in QPartner | Isolated claiming RPC |
| **Out for Delivery** | `ActiveFoodOrderTracker.tsx` | `public.orders.status = 'out_for_delivery'`| Action button | **EXISTING** in V1 | Realtime update to Customer V1 |
| **Delivered** | `ActiveFoodOrderTracker.tsx` | `public.orders.status = 'delivered'` | Action button | **EXISTING** in V1 | Update status + credit ledger |

---

## 7. Unified Dispatch Engine Architecture

To avoid code duplication and prevent breaking Transport, Q Partner should adopt a **Domain Adapter Pattern**:

```
                              ┌────────────────────────┐
                              │  INCOMING DISPATCH BUS │
                              │    (Realtime + FCM)    │
                              └───────────┬────────────┘
                                          │
            ┌─────────────────────────────┼─────────────────────────────┐
            │                             │                             │
            ▼                             ▼                             ▼
 ┌─────────────────────┐       ┌─────────────────────┐       ┌─────────────────────┐
 │  Transport Adapter  │       │    Food Adapter     │       │   Grocery Adapter   │
 │   (public.rides)    │       │ (orders: type=food) │       │(orders:type=grocery)│
 └──────────┬──────────┘       └──────────┬──────────┘       └──────────┬──────────┘
            │                             │                             │
            └─────────────────────────────┼─────────────────────────────┘
                                          │
                                          ▼
                      ┌───────────────────────────────────────┐
                      │    Unified Incoming Work Interface    │
                      │  { id, domain, pickup, drop, fare,    │
                      │    countdown, distance, items_summary}│
                      └───────────────────┬───────────────────┘
                                          │
                                          ▼
                      ┌───────────────────────────────────────┐
                      │       GlobalOrderAlertModal.tsx       │
                      │    (Unified 30s Visual Countdown,     │
                      │     Alarm Ringing & Haptic Loop)      │
                      └───────────────────┬───────────────────┘
                                          │
                                  [Driver Accepts]
                                          │
            ┌─────────────────────────────┼─────────────────────────────┐
            │                             │                             │
            ▼                             ▼                             ▼
 ┌─────────────────────┐       ┌─────────────────────┐       ┌─────────────────────┐
 │  RPC: accept_ride   │       │RPC: claim_food_order│       │RPC: claim_grocery_..│
 └──────────┬──────────┘       └──────────┬──────────┘       └──────────┬──────────┘
            │                             │                             │
            ▼                             ▼                             ▼
 ┌─────────────────────┐       ┌─────────────────────┐       ┌─────────────────────┐
 │  active-ride/[id]   │       │ active-food/[id]    │       │ active-grocery/[id] │
 └─────────────────────┘       └─────────────────────┘       └─────────────────────┘
```

---

## 8. Realtime & FCM HTTP v1 Topology

| App State | Primary Ingestion Channel | Mechanism | Reliability Level |
| :--- | :--- | :--- | :--- |
| **App in Foreground** | **Supabase Realtime (PostgreSQL Changes)** | Subscribes to `INSERT` on `public.rides` (Transport) and `UPDATE` on `public.orders` where `status = 'preparing' AND driver_id IS NULL`. Displays `GlobalOrderAlertModal` with zero notification tray spam. | **VERIFIED LOW-LATENCY** |
| **App in Background** | **FCM HTTP v1 (via notify-driver Edge Function)** | Database Webhook invokes Edge Function; signs Google OAuth2 service account JWT; sends high-priority Android FCM payload. Displays Heads-Up Notification with sound `booking_alert.wav`. | **VERIFIED HIGH-PRIORITY** |
| **App Killed / Locked** | **FCM + Native Kotlin Receiver** | Android wakes device via `WAKE_LOCK`; native `FloatingWidgetService` displays floating request card over lock screen/apps; continuous alarm ringing via `AudioManager.STREAM_ALARM`. | **VERIFIED NATIVE ANDROID** |

### Duplicate Prevention Architecture
- Use deterministic notification ID (`continuous_booking_alert`) to overwrite notification tray cards.
- Edge Function checks `fcm_token` and `is_online = true` before sending.
- Client maintains 20-element LRU cache (`informed_rides`) in `SecureStore` to prevent re-alerting on the same booking.

---

## 9. Concurrency & Atomic Claiming Architecture

To prevent race conditions when 10+ drivers attempt to accept the same Food or Grocery order simultaneously:

```sql
-- CONCEPTUAL SPECIFICATION ONLY (NOT TO BE EXECUTED)
CREATE OR REPLACE FUNCTION public.claim_food_order(p_order_id UUID, p_driver_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_order RECORD;
BEGIN
    -- 1. Check if driver already has an active delivery or ride
    IF EXISTS (
        SELECT 1 FROM public.orders WHERE driver_id = p_driver_id AND status IN ('preparing', 'out_for_delivery')
    ) OR EXISTS (
        SELECT 1 FROM public.rides WHERE driver_id = p_driver_id AND status IN ('accepted', 'picked_up', 'on_ride')
    ) THEN
        RAISE EXCEPTION 'You already have an active order or ride in progress';
    END IF;

    -- 2. Acquire atomic lock on the target order row
    SELECT * INTO v_order
    FROM public.orders
    WHERE id = p_order_id
      AND status = 'preparing'
      AND driver_id IS NULL
    FOR UPDATE SKIP LOCKED;

    IF v_order IS NULL THEN
        RAISE EXCEPTION 'Order is no longer available or already claimed';
    END IF;

    -- 3. Assign driver
    UPDATE public.orders
    SET driver_id = p_driver_id,
        updated_at = NOW()
    WHERE id = p_order_id
    RETURNING * INTO v_order;

    RETURN to_jsonb(v_order);
END;
$$;
```

---

## 10. Cross-Domain State Synchronization

| Domain | State Writer (Q Partner) | Authoritative DB State | State Reader (Customer V1) | Sync Channel | Expected Latency |
| :--- | :--- | :--- | :--- | :--- | :---: |
| **Transport** | `DriverService.updateRideStatus` | `public.rides.status` | `RideTrackingView.tsx` | Supabase Realtime (`rides:id`) | < 250ms |
| **Food Delivery** | Proposed `FoodService.updateStatus` | `public.orders.status` | `ActiveFoodOrderTracker.tsx` | Supabase Realtime (`orders:id`) | < 250ms |
| **Grocery Delivery**| Proposed `GroceryService.updateStatus`| `public.orders.status` | `ActiveFoodOrderTracker.tsx` | Supabase Realtime (`orders:id`) | < 250ms |

> [!NOTE]
> Because Customer App V1 already subscribes to `public.orders` via Realtime in [`ActiveFoodOrderTracker.tsx:L134-149`](file:///d:/Quickora%20Delivery/Quickora/components/ActiveFoodOrderTracker.tsx#L134-L149), any status update (`out_for_delivery`, `delivered`) written by Q Partner to `public.orders` **automatically reflects on Customer App V1 with zero Customer App modifications required**.

---

## 11. Universal Live Location Architecture

```
[Q Partner Location Engine] (expo-location watchPositionAsync: 50m / 10s)
            │
            ├── If Active Transport Ride ──► Updates public.rides (driver_lat, driver_lng)
            │
            └── If Active Food / Grocery  ──► Updates public.users (current_lat, current_lng)
                                              (or proposed delivery_location table)
```

- **Transport Tracking**: Customer App reads driver coordinates from `public.rides` or `public.users`.
- **Food / Grocery Tracking**: Customer App V1 displays the delivery stage; live map tracking on Food orders can read `public.users(current_lat, current_lng)` where `id = orders.driver_id`.

---

## 12. Unified Driver Earnings & Ledger Architecture

```
                               ┌────────────────────────┐
                               │ public.driver_earnings │
                               └───────────┬────────────┘
                                           │
            ┌──────────────────────────────┼──────────────────────────────┐
            │                              │                              │
            ▼                              ▼                              ▼
 ┌──────────────────────┐       ┌──────────────────────┐       ┌──────────────────────┐
 │   TRANSPORT TRIP     │       │    FOOD DELIVERY     │       │   GROCERY DELIVERY   │
 │ - domain: 'TRANSPORT'│       │ - domain: 'FOOD'     │       │ - domain: 'GROCERY'  │
 │ - 80% Fare Payout    │       │ - Base Delivery Fee  │       │ - Base Delivery Fee  │
 │ - 0% Transport GST   │       │ - Rain/Night Surge   │       │ - Distance Tier Fee  │
 │                      │       │ - Customer Tip (100%)│       │ - Customer Tip (100%)│
 └──────────────────────┘       └──────────────────────┘       └──────────────────────┘
```

- **Transport Rule**: Preserves existing `80% fare` formula (`schema_updates.sql:L161`).
- **Food / Grocery Rule**: Driver earns `100% Delivery Fee + 100% Applied Surge + 100% Tip` (Business decision required for platform deduction percentage if applicable).

---

## 13. Security & Auth Alignment

### Critical Auth Disconnect Analysis

| Dimension | Customer App V1 | Q Partner Driver App | Risk / Integration Gap |
| :--- | :--- | :--- | :--- |
| **Authentication Engine** | Supabase Auth (`auth.users`) | Custom `public.otp` table | Q Partner queries run with `anon` client without setting Supabase Auth JWT. |
| **Profile Storage** | `public.profiles` (`id = auth.uid()`) | `public.users` (`is_driver = true`)| Divergent user tables in same Supabase project. |
| **RLS Policy Enforcement** | Enforced via `auth.uid() = user_id` | Requires `SECURITY DEFINER` RPCs | Client-side updates from Q Partner fail if RLS requires `auth.uid()`. |
| **Document Storage RLS** | Standard authenticated user storage | Public bucket `driver-documents` | Documents uploaded with public read access. |

### Architectural Recommendation
All write operations from Q Partner to `public.orders` must be performed through **PostgreSQL RPCs (`SECURITY DEFINER`)** or Edge Functions that validate the driver's phone/session token, ensuring that Customer App RLS policies (`auth.uid()`) remain strictly intact and uncompromised.

---

## 14. Cross-Domain Fault Isolation

```
           ┌───────────────────────────────────────────────┐
           │            Q PARTNER RUNTIME ENGINE           │
           ├─────────────────┬───────────────┬─────────────┤
           │    TRANSPORT    │     FOOD      │   GROCERY   │
           │     DOMAIN      │    DOMAIN     │   DOMAIN    │
           └────────┬────────┴───────┬───────┴──────┬──────┘
                    │                │              │
                    ▼                ▼              ▼
           ┌─────────────────┐┌──────────────┐┌────────────┐
           │ Error Boundary  ││Error Boundary││Error Bound.│
           └─────────────────┘└──────────────┘└────────────┘
```

1. **Service Boundary**: `services/driver.service.ts` (Transport), `services/food-driver.service.ts` (Food), and `services/grocery-driver.service.ts` (Grocery) must remain separate modules.
2. **Crash Isolation**: A crash in Food item parsing or image rendering must never block a driver from accepting a Taxi ride.
3. **Database Independence**: Failures in `public.orders` table triggers do not affect `public.rides`.

---

## 15. Platform Scope & Parity Matrix

| Feature | Android | iOS | Web / Tablet |
| :--- | :---: | :---: | :---: |
| **Incoming Order Alerts** | Full-Screen Modal + Alarm + Vibration | Full-Screen Modal + In-App Sound | Browser Modal (No native alarm) |
| **Background FCM Push** | High Priority (`PRIORITY_MAX`) | APNs Notification | ServiceWorker Web Push |
| **Floating System Overlay** | Native Kotlin (`FloatingWidgetService`) | **NOT SUPPORTED** (iOS restriction) | **NOT SUPPORTED** |
| **Draw Over Other Apps** | `Settings.canDrawOverlays()` | **NOT SUPPORTED** (iOS restriction) | **NOT SUPPORTED** |
| **Continuous Audio Ringing**| `AudioManager.STREAM_ALARM` override | Standard audio player | Web Audio API |
| **Live GPS Streaming** | Foreground + Background TaskManager | Foreground only (standard) | Geolocation API |

---

## 16. Failure Recovery Architecture

| Failure Scenario | Immediate Behavior | Authoritative Recovery Mechanism | Risk Level |
| :--- | :--- | :--- | :---: |
| **A. Network Loss Mid-Delivery** | `GlobalStatusBanner` slides down ("No Internet Connection") | Offline queue caches state; syncs to Supabase on reconnection. | Low |
| **B. Simultaneous Accept (2 Drivers)**| Driver 1 gets order, Driver 2 gets rejection | `FOR UPDATE SKIP LOCKED` inside claiming RPC returns instant "Already claimed" error. | Medium |
| **C. App Killed During Active Trip** | App terminates | Cold launch detects uncompleted order in `orders` where `driver_id = me` and restores screen. | Low |
| **D. Duplicate FCM Arrives** | Operating system displays notification | SecureStore LRU deduplication (`informed_rides`) ignores duplicate ID. | Low |
| **E. Customer Cancels Mid-Trip** | Realtime subscription receives `status = 'cancelled'` | Active screen displays "Order Cancelled" alert and returns driver to dashboard. | Medium |
| **F. GPS Signal Lost in Transit** | Location watcher fails | Fallback to last known coordinates stored in memory; warns driver via banner. | Low |

---

## 17. Data Contract Map

| Contract Field | Transport (`public.rides`) | Food (`public.orders`) | Grocery (`public.orders`) |
| :--- | :--- | :--- | :--- |
| **Primary Key** | `id` (UUID) | `id` (UUID) | `id` (UUID) |
| **Customer ID** | `user_id` (UUID) | `user_id` (UUID) | `user_id` (UUID) |
| **Driver ID** | `driver_id` (UUID) | Proposed `driver_id` (UUID) | Proposed `driver_id` (UUID) |
| **Pickup Location** | `pickup_address` / `pickup_location` (JSONB) | `stores.address` / `stores.latitude, longitude` | `stores.address` / `stores.latitude, longitude` |
| **Drop Location** | `drop_address` / `drop_location` (JSONB) | `delivery_address` (TEXT/JSONB) | `delivery_address` (TEXT/JSONB) |
| **Grand Total** | `fare` (NUMERIC) | `total` (NUMERIC) | `total` (NUMERIC) |
| **Driver Payout** | `driver_earnings.amount` (80% fare) | `delivery_fee + surge + tip` | `delivery_fee + surge + tip` |
| **Status Field** | `status` (`pending`, `accepted`, `picked_up`, `on_ride`, `completed`) | `status` (`pending`, `confirmed`, `preparing`, `out_for_delivery`, `delivered`) | `status` (`pending`, `confirmed`, `preparing`, `out_for_delivery`, `delivered`) |
| **OTP Field** | `otp_code` (4-digit) | Proposed `delivery_otp` (4-digit) | Proposed `delivery_otp` (4-digit) |

---

## 18. Current vs. Target Architecture Diagrams

### A. Current Architecture (Exists Today)

```
                    ┌────────────────────────────┐
                    │  Quickora Customer App V1  │
                    │      (FINAL / FROZEN)      │
                    └─────────────┬──────────────┘
                                  │
                 ┌────────────────┴────────────────┐
                 ▼                                 ▼
      ┌────────────────────┐            ┌────────────────────┐
      │    public.rides    │            │   public.orders    │
      └──────────┬─────────┘            └────────────────────┘
                 │                                 │
                 ▼                                 ▼
      ┌────────────────────┐            ┌────────────────────┐
      │     Q PARTNER      │            │   NO DRIVER APP    │
      │   (Transport Only) │            │     CONNECTION     │
      └────────────────────┘            └────────────────────┘
```

### B. Target Architecture (Proposed Planning Model)

```
                    ┌────────────────────────────┐
                    │  Quickora Customer App V1  │
                    │      (FINAL / FROZEN)      │
                    └─────────────┬──────────────┘
                                  │
                 ┌────────────────┴────────────────┐
                 ▼                                 ▼
      ┌────────────────────┐            ┌────────────────────┐
      │    public.rides    │            │   public.orders    │
      │    (Transport)     │            │  (Food & Grocery)  │
      └──────────┬─────────┘            └──────────┬─────────┘
                 │                                 │
                 └────────────────┬────────────────┘
                                  ▼
                   ┌─────────────────────────────┐
                   │    UNIFIED DISPATCH ENGINE  │
                   │  - Deno Edge: notify-driver │
                   │  - Realtime Broadcast Bus   │
                   └──────────────┬──────────────┘
                                  │
                                  ▼
                   ┌─────────────────────────────┐
                   │          Q PARTNER          │
                   │   - Transport Subsystem     │
                   │   - Food Delivery Subsystem │
                   │   - Grocery Delivery Subsys │
                   │   - Unified Earnings Ledger │
                   └─────────────────────────────┘
```

---

## 19. Future Database Requirements (Planning Specification)

> [!IMPORTANT]
> **Planning specification only. No database modifications have been executed.**

| Proposed Object | Type | Rationale | Modifies Customer V1? |
| :--- | :--- | :--- | :---: |
| `ALTER TABLE public.orders ADD COLUMN driver_id UUID;` | Column Addition | Allows assigning a driver to Food/Grocery orders without breaking existing column schemas. | **NO** (Backward compatible) |
| `ALTER TABLE public.orders ADD COLUMN delivery_otp TEXT;` | Column Addition | Allows 4-digit proof of delivery verification at customer doorstep. | **NO** (Backward compatible) |
| `claim_food_order(order_id, driver_id)` | PostgreSQL RPC | Atomic locking and claiming of food orders. | **NO** (Isolated function) |
| `claim_grocery_order(order_id, driver_id)` | PostgreSQL RPC | Atomic locking and claiming of grocery orders. | **NO** (Isolated function) |
| `complete_food_delivery(order_id, driver_id)` | PostgreSQL RPC | Credits driver earnings and sets order status to `delivered`. | **NO** (Isolated function) |
| `complete_grocery_delivery(order_id, driver_id)` | PostgreSQL RPC | Credits driver earnings and sets grocery order status to `delivered`. | **NO** (Isolated function) |

---

## 20. Feature Reuse Matrix

| Feature Module | Q Partner Current | Can Reuse As-Is | Extension Needed | New Module Required |
| :--- | :---: | :---: | :---: | :---: |
| **Phone / OTP Authentication** | ✅ Working | ✅ Yes | — | — |
| **Driver Onboarding & Docs** | ✅ Working | ✅ Yes | Add Food/Grocery bag verification if needed | — |
| **Online / Offline Toggle** | ✅ Working | ✅ Yes | Broadcast availability to Food/Grocery dispatchers | — |
| **Location & GPS Engine** | ✅ Working | ✅ Yes | Stream coordinates during food transit | — |
| **Global Alert Modal** | ✅ Working | ⚠️ Adaptable | Generalize from Ride to Order | `GlobalOrderAlertModal` |
| **Continuous Alarm Ringing** | ✅ Working | ✅ Yes | — | — |
| **Android Floating Widget** | ✅ Working | ✅ Yes | Add "Food Order ₹XX" status text support | — |
| **In-App Customer Chat** | ✅ Working | ✅ Yes | Connect chat to Food/Grocery customer ID | — |
| **Earnings & History Screen** | ✅ Working | ⚠️ Partial | Add Food & Grocery filter chips | — |
| **Food Active Delivery Screen**| ❌ None | — | — | **`app/active-food/[id].tsx`** |
| **Grocery Active Delivery Screen**| ❌ None | — | — | **`app/active-grocery/[id].tsx`**|

---

## 21. Customer App V1 Compatibility Matrix

| Customer V1 Subsystem | Target Backend Object | Q Partner Integration Strategy | Customer V1 Change Required? |
| :--- | :--- | :--- | :---: |
| **Food Order Tracking** | `public.orders` (`id`) | Q Partner updates `orders.status` ➔ Customer V1 Realtime updates automatically. | **NO** |
| **Grocery Order Tracking**| `public.orders` (`id`) | Q Partner updates `orders.status` ➔ Customer V1 Realtime updates automatically. | **NO** |
| **Transport Ride Tracking**| `public.rides` (`id`) | Existing working integration preserved 100%. | **NO** |
| **Food Rating / Review** | `public.store_reviews` | Customer V1 triggers review modal on `status = 'delivered'`. | **NO** |
| **Payment Ledger** | `public.order_payments`| Razorpay / COD captures remain untouched on Customer V1 backend. | **NO** |

---

## 22. Future Implementation Order (Phased Roadmap)

```
┌────────────────────────────────────────────────────────────────────────┐
│               RECOMMENDED STEP-BY-STEP IMPLEMENTATION ROADMAP           │
├────────────────────────────────────────────────────────────────────────┤
│ PHASE 1: Database & RPC Foundation (Non-breaking additive migrations)   │
│          - Add driver_id, delivery_otp columns to orders table         │
│          - Create claim_food_order and claim_grocery_order RPCs        │
│          - Create complete_food_delivery RPC                           │
├────────────────────────────────────────────────────────────────────────┤
│ PHASE 2: Dispatch Engine & Edge Function Expansion                    │
│          - Update notify-driver Edge Function to handle Food/Grocery   │
│          - Configure Database Webhook on orders table                  │
├────────────────────────────────────────────────────────────────────────┤
│ PHASE 3: Q Partner Unified Incoming Dispatch Layer                     │
│          - Create domain adapters (Transport, Food, Grocery)           │
│          - Refactor GlobalRideAlertModal into GlobalOrderAlertModal    │
├────────────────────────────────────────────────────────────────────────┤
│ PHASE 4: Food & Grocery Active Delivery Screens                        │
│          - Build active-food/[id].tsx (Restaurant ➔ Pickup ➔ Drop)      │
│          - Build active-grocery/[id].tsx (Hub ➔ Pickup ➔ Drop)          │
├────────────────────────────────────────────────────────────────────────┤
│ PHASE 5: Unified Earnings Ledger & History Extension                   │
│          - Extend driver_earnings and Profile/History screens          │
├────────────────────────────────────────────────────────────────────────┤
│ PHASE 6: End-to-End Regression & Production Validation                 │
│          - Verify Transport flow remains 100% regression-free          │
│          - Verify Customer App V1 tracking updates with zero lag       │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 23. Future Testing Strategy Matrix

| Test Suite Category | Target Assertions | Validation Method |
| :--- | :--- | :--- |
| **1. Transport Regression Suite** | Verify Taxi Bike, Auto, Cab, Logistics Bike, Truck flows, OTP verification, and 80% earnings are unaffected. | Automated CLI test script |
| **2. Concurrency & Double-Claim** | 10 simulated drivers attempting to claim the same Food order simultaneously; exactly 1 succeeds, 9 receive friendly rejection. | Concurrency script (`Promise.allSettled`) |
| **3. Customer V1 Live Sync** | Verify Customer App V1 tracker changes status to `out_for_delivery` and `delivered` when Q Partner updates order. | Dual device live validation |
| **4. App-Kill & Resume Recovery** | Driver kills Q Partner while on an active delivery; reopen must resume active delivery state. | Manual process termination test |
| **5. Network Offline Resilience** | Driver loses cellular network during transit; updates queue locally and resync upon reconnection. | Airplane mode toggling |

---

## 24. Critical Security Findings Before Production

| Severity | Category | Finding | Recommended Resolution |
| :--- | :--- | :--- | :--- |
| 🔴 **HIGH** | Auth Model | Q Partner queries database using `anon` key + client-provided `driver_id`. | Encapsulate all driver mutations in `SECURITY DEFINER` RPCs that validate driver status server-side. |
| 🟡 **MEDIUM** | Open OTP Access | `public.otp` has broad SELECT/INSERT policy for anon role. | Add rate-limiting trigger or RPC to prevent phone number SMS brute-forcing. |
| 🟢 **VERIFIED SAFE** | OTP Column Security | `rides.otp_code` SELECT permission is revoked from anon/authenticated roles. | Verified secure via `verify_ride_otp` stored procedure. |
| 🟢 **VERIFIED SAFE** | Concurrency Lock | `accept_ride` uses `FOR UPDATE SKIP LOCKED`. | Prevents double-booking race conditions across simultaneous drivers. |

---

## 25. Decision Register (Business & Product Decisions Required)

1. **Food Delivery Partner Commission Model**:
   - *Question*: Does the driver receive 100% of the customer delivery fee + surge + tip, or is there a platform commission deduction (e.g. 20%)?
2. **Food / Grocery OTP Requirement**:
   - *Question*: Is a customer 4-digit OTP mandatory for Food/Grocery doorstep delivery completion, or is a single-tap "Mark Delivered" button sufficient?
3. **Multi-Order Batching**:
   - *Question*: Should Q Partner allow drivers to accept 2 nearby food orders simultaneously, or enforce strict 1-order-at-a-time concurrency?
4. **Dispatch Proximity Radius**:
   - *Question*: What is the maximum search radius for dispatching food orders to nearby drivers (e.g., 5 km vs. 10 km)?

---

## 26. Open Questions

1. **Driver Vehicle Eligibility for Food Delivery**:
   - Should cab/car drivers be eligible for food delivery, or should food dispatch be strictly restricted to two-wheelers (`bike`) and auto-rickshaws (`auto`)?
2. **Cancellation Compensation**:
   - If a customer cancels a food order after the driver has already reached the restaurant, is there an automated partial compensation credited to `driver_earnings`?

---

## 27. Absolute Read-Only Verification

```
APPLICATION SOURCE CODE CHANGES:  0
CUSTOMER APP V1 CODE CHANGES:     0
DATABASE SCHEMA CHANGES:          0
SUPABASE CONFIGURATION CHANGES:   0
RLS POLICY CHANGES:               0
POSTGRESQL RPC CHANGES:           0
DEPENDENCY / PACKAGE CHANGES:     0
GIT FETCH / PULL / RESET:         NONE
```

---
*Quickora Q Partner — Master Architecture & Integration Plan (V1 Baseline Complete)*
