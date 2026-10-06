# QPARTNER — APPROVED DRIVER ROUTING BUG ROOT-CAUSE INVESTIGATION
### Comprehensive Technical Analysis of Onboarding & Approval Routing Flow

- **Document Version:** 1.0.0
- **Status:** **READ-ONLY ROOT-CAUSE VERIFIED** (No Code Modified, No SQL Executed)
- **Target Repository:** QPartner (`d:\Quickora Delivery\QPartner`)

---

## 1. Observed vs. Expected Behavior

### 1.1 Observed Behavior
1. Driver registers, fills vehicle info, uploads KYC documents, and submits in [`app/(auth)/documents.tsx`](file:///d:/Quickora%20Delivery/QPartner/app/(auth)/documents.tsx).
2. Driver is placed on `app/(auth)/onboarding.tsx` which displays **"Under Review"** (`rider_status = 'pending'`).
3. Admin/backend manually updates `public.users.rider_status` to approved/verified in the database.
4. When the driver opens, resumes, or stays on the app, the driver does **NOT** transition to the Home/Bookings screen (`/(tabs)/bookings`).
5. Instead, the UI switches from **"Under Review"** to **"Set Up Your Vehicle"** (Service Category: Taxi / Logistics, Vehicle Type, Continue to Documents).

### 1.2 Expected Behavior
When a driver has completed onboarding/document submission and the backend updates `rider_status` to `'verified'` (or `'approved'`), the driver must automatically transition past onboarding into Permissions setup and the Home/Bookings screen (`/(tabs)/bookings`), and must **never** be presented with the "Set Up Your Vehicle" onboarding form.

---

## 2. Exact Authoritative Fields in `public.users`

[VERIFIED] From [`types/index.ts:1-29`](file:///d:/Quickora%20Delivery/QPartner/types/index.ts#L1-L29) and [`contexts/auth-context.tsx:69-77`](file:///d:/Quickora%20Delivery/QPartner/contexts/auth-context.tsx#L69-L77):
The authoritative database table is `public.users`. The fields evaluated by the routing logic are:

| Field Name | Type | Used in Routing? | Role in Routing |
| :--- | :--- | :---: | :--- |
| **`id`** | `uuid` | ✅ Yes | Identifies authenticated driver session. |
| **`is_driver`** | `boolean` | ✅ Yes | Guard: If `false`, forced to `/(auth)/onboarding`. |
| **`rider_status`** | `text` | ✅ Yes | **Primary State Discriminator** (`'unsubmitted'`, `'pending'`, `'verified'`, `'rejected'`). |
| **`vehicle_category`** | `text` | ❌ No | Not checked in routing condition (used in services & profile). |
| **`vehicle_type`** | `text` | ❌ No | Not checked in routing condition (used in services & profile). |
| **`vehicle_number`** | `text` | ❌ No | Not checked in routing condition. |
| **`pan_number` / `aadhaar_number` / `license_number`** | `text` | ❌ No | Not checked in routing condition (checked only during form submission in `documents.tsx`). |
| **`is_online`** | `boolean` | ❌ No | Used for realtime dispatching, not initial routing. |

---

## 3. Recognized `rider_status` Values in the Codebase

[VERIFIED] Across the entire codebase, `rider_status` is typed and handled as:
* **`'unsubmitted'`** $\rightarrow$ Driver created account but has not submitted vehicle/docs.
* **`'pending'`** $\rightarrow$ Documents submitted; waiting for admin verification.
* **`'verified'`** $\rightarrow$ Admin approved; active driver allowed on platform.
* **`'rejected'`** $\rightarrow$ Admin rejected documents; prompted to re-submit.

Evidence:
* [`types/index.ts:8`](file:///d:/Quickora%20Delivery/QPartner/types/index.ts#L8): `rider_status: 'unsubmitted' | 'pending' | 'verified' | 'rejected';`
* [`supabase/functions/notify-driver/index.ts:195`](file:///d:/Quickora%20Delivery/QPartner/supabase/functions/notify-driver/index.ts#L195): `.eq('rider_status', 'verified')`
* [`services/auth.service.ts:192, 256`](file:///d:/Quickora%20Delivery/QPartner/services/auth.service.ts#L192): Default is `'unsubmitted'`; becomes `'pending'` on `submitDocuments`.
* [`app/(tabs)/_layout.tsx:16`](file:///d:/Quickora%20Delivery/QPartner/app/(tabs)/_layout.tsx#L16): `if (driver && driver.rider_status !== 'verified') router.replace('/(auth)/onboarding');`

---

## 4. Complete Routing Decision Tree & Code Trace

### 4.1 Root Router: [`app/_layout.tsx:40-117`](file:///d:/Quickora%20Delivery/QPartner/app/_layout.tsx#L40-L117)
```tsx
const hasRouted = useRef(false); // Prevent re-routing after initial navigation

useEffect(() => {
    if (!rootNavState?.key) return;
    if (loading) return;

    // Line 55: BLOCKING GUARD
    if (hasRouted.current) return;

    if (!driver) {
        hasRouted.current = true;
        setTimeout(() => router.replace('/(auth)/login'), 0);
    } else if (!driver.is_driver || driver.rider_status === 'unsubmitted') {
        hasRouted.current = true;
        setTimeout(() => router.replace('/(auth)/onboarding'), 0);
    } else if (driver.rider_status === 'pending' || driver.rider_status === 'rejected') {
        hasRouted.current = true;
        setTimeout(() => router.replace('/(auth)/onboarding'), 0);
    } else if (driver.rider_status === 'verified') {
        hasRouted.current = true;
        // Permissions check -> if all granted -> /(tabs)/bookings
        // if missing -> /(auth)/permissions
    } else {
        // Line 114: FALLTHROUGH ELSE
        hasRouted.current = true;
        setTimeout(() => router.replace('/(auth)/onboarding'), 0);
    }
}, [driver, loading, rootNavState?.key]);
```

### 4.2 Onboarding Screen: [`app/(auth)/onboarding.tsx:46-95`](file:///d:/Quickora%20Delivery/QPartner/app/(auth)/onboarding.tsx#L46-L95)
```tsx
export default function OnboardingScreen() {
    const insets = useSafeAreaInsets();
    const { driver } = useAuth();
    const { t } = useTranslation();
    ...
    // Condition 1: Under Review
    if (driver?.rider_status === 'pending') {
        return (
            <View style={...}>
                <Text>{t('onboarding.underReview')}</Text>
                <Text>{t('onboarding.reviewSubtitle')}</Text>
            </View>
        );
    }

    // Condition 2: Rejected
    if (driver?.rider_status === 'rejected') {
        return (
            <View style={...}>
                <Text>{t('onboarding.rejected')}</Text>
            </View>
        );
    }

    // Condition 3: FALLTHROUGH (Lines 94-166)
    // Renders "Set Up Your Vehicle" (Taxi / Logistics / Vehicle Type)
    return (
        <View style={...}>
            <Text>{t('onboarding.title')}</Text> <!-- "Set Up Your Vehicle" -->
            ...
        </View>
    );
}
```

---

## 5. The Exact Root Cause Analysis

[ROOT CAUSE] The bug is caused by **two interacting architectural flaws in state propagation and routing guards**:

### Root Cause 1: Realtime In-Session Block (`hasRouted.current = true` in `_layout.tsx`)
1. While waiting for verification, the driver has `app/(auth)/onboarding.tsx` open on the "Under Review" screen (`driver.rider_status === 'pending'`).
2. At initial mount, `app/_layout.tsx` executed and set `hasRouted.current = true` ([`app/_layout.tsx:64`](file:///d:/Quickora%20Delivery/QPartner/app/_layout.tsx#L64)).
3. When the admin updates `users.rider_status = 'verified'` in Supabase, the Supabase Realtime channel in [`contexts/auth-context.tsx:38-54`](file:///d:/Quickora%20Delivery/QPartner/contexts/auth-context.tsx#L38-L54) fires and calls `setDriverData(updated)`.
4. `auth-context.tsx` successfully updates the React `driver` state to `rider_status: 'verified'`.
5. `app/_layout.tsx` re-evaluates its `useEffect`, BUT hits Line 55:
   ```tsx
   if (hasRouted.current) return;
   ```
   **`_layout.tsx` aborts immediately and refuses to route the driver to `/(tabs)/bookings` or `/(auth)/permissions`!**
6. Simultaneously, `app/(auth)/onboarding.tsx` re-renders because `driver` from `useAuth()` changed.
7. In `onboarding.tsx`:
   - `if (driver?.rider_status === 'pending')` is now `FALSE` (status is `'verified'`).
   - `if (driver?.rider_status === 'rejected')` is `FALSE`.
   - **`onboarding.tsx` has NO redirect logic for `verified` status!**
8. It falls through to the bottom of the component and renders the default form: **"Set Up Your Vehicle"**!

---

### Root Cause 2: Status Value Mismatch / Unhandled Value Fallback
1. If the admin/backend updates `public.users.rider_status` to `'approved'` (or `'active'`, or any string other than exact lowercase `'verified'`):
   - In `_layout.tsx:66`, `driver.rider_status === 'verified'` evaluates to `FALSE`.
   - In `_layout.tsx:113`, the fallback `else` block triggers:
     ```tsx
     setTimeout(() => router.replace('/(auth)/onboarding'), 0);
     ```
   - On `onboarding.tsx`, `rider_status === 'pending'` is `FALSE`.
   - `onboarding.tsx` falls through and renders: **"Set Up Your Vehicle"**!

---

### Root Cause 3: Missing Verified Driver Guard in `app/(auth)/onboarding.tsx`
`onboarding.tsx` is an authentication screen. If a driver with `rider_status === 'verified'` ever lands on or stays on `onboarding.tsx`, there is no `useEffect` inside `onboarding.tsx` to redirect them to `/(tabs)/bookings`. It blindly assumes that anyone not `pending` and not `rejected` must configure a vehicle.

---

## 6. Local Cache & State Invalidation Trace

[VERIFIED] Inspection of cache mechanisms:
1. **`AsyncStorage` (`@quickora_driver`):**
   - In [`contexts/auth-context.tsx:62-77`](file:///d:/Quickora%20Delivery/QPartner/contexts/auth-context.tsx#L62-L77), `AsyncStorage` is read on boot, and then immediately refreshed from `public.users` via `supabase.from('users').select('*').eq('id', parsed.id).single()`.
   - On realtime update, `auth-context.tsx` writes the fresh driver object to `AsyncStorage`.
   - Therefore, `AsyncStorage` is **not** stale; the fresh `rider_status = 'verified'` IS present in the React state!
2. **React Context (`AuthContext`):**
   - Holds the fresh verified driver object.
3. **The failure point is purely in the navigation routing logic (`_layout.tsx` and `onboarding.tsx`), not in data fetching or caching.**

---

## 7. Competing Routing Dispatchers Matrix

| Dispatcher / File | Condition | Dispatched Route | Conflict Behavior |
| :--- | :--- | :--- | :--- |
| **`app/_layout.tsx`** (Initial Boot) | `rider_status === 'pending'` | `/(auth)/onboarding` (Renders "Under Review") | Sets `hasRouted.current = true`, freezing future in-session status updates. |
| **`app/_layout.tsx`** (Realtime Status Change) | `rider_status === 'verified'` | **BLOCKED** by `hasRouted.current` | **Fails to navigate to Home.** |
| **`app/(auth)/onboarding.tsx`** | `rider_status === 'verified'` | **NO NAVIGATION** (Falls through to JSX) | **Renders "Set Up Your Vehicle".** |
| **`app/(tabs)/_layout.tsx`** | `rider_status !== 'verified'` | `/(auth)/onboarding` | Protects Tabs, but does not pull verified drivers in from auth screens. |
| **`app/(auth)/otp.tsx`** | `rider_status === 'verified'` | `/(tabs)/bookings` | Works correctly on fresh login, but not during live status changes or cold reloads blocked by layout. |

---

## 8. Summary of Root Cause Evidence

```text
Admin updates DB (rider_status = 'verified')
               │
               ▼
Supabase Realtime sends payload to driver app
               │
               ▼
contexts/auth-context.tsx updates driver state ✅
               │
               ├───────────────────────────────────────────────┐
               ▼                                               ▼
app/_layout.tsx useEffect runs                  app/(auth)/onboarding.tsx re-renders
               │                                               │
  if (hasRouted.current) return; ❌              if (rider_status === 'pending') -> FALSE
(Aborts! Does not route to Home)                (Stops showing "Under Review")
                                                               │
                                                               ▼
                                                Falls through to default JSX ❌
                                                Renders: "Set Up Your Vehicle"
```

---

## 9. Minimal Justified Fix (Design Specification Only — No Code Changed)

To fix this completely without regressions:

1. **In `app/(auth)/onboarding.tsx`:**
   Add a direct status guard effect:
   ```tsx
   useEffect(() => {
       if (driver?.rider_status === 'verified') {
           router.replace('/(tabs)/bookings');
       }
   }, [driver?.rider_status]);
   ```
2. **In `app/_layout.tsx`:**
   Track previous `rider_status` using a ref (`prevStatusRef`). When `driver.rider_status` transitions (e.g. from `'pending'` $\rightarrow$ `'verified'` or on logout/login), allow re-routing even if `hasRouted.current` is true, while maintaining the lock against minor updates (like GPS coordinate changes).
3. **Handle Case-Insensitive / Synonym Statuses:**
   Accept both `'verified'` and `'approved'` as valid active driver statuses:
   `const isVerified = driver.rider_status === 'verified' || driver.rider_status === 'approved';`

---

## 10. Files That Would Need Modification vs. Files Untouched

### Files to Modify (When Approved):
1. [`app/(auth)/onboarding.tsx`](file:///d:/Quickora%20Delivery/QPartner/app/(auth)/onboarding.tsx) (Add auto-redirect guard for verified drivers).
2. [`app/_layout.tsx`](file:///d:/Quickora%20Delivery/QPartner/app/_layout.tsx) (Allow re-routing on `rider_status` transitions).

### Files That Must NOT Be Modified:
- Customer App files (0 changes).
- Database tables / schemas (0 changes).
- Food/Grocery delivery logic (0 changes).
- `services/auth.service.ts` (0 changes).

---

## 11. Regression Risks & Verification Plan

### Regression Risks:
- **Risk:** Unwanted re-routing during active rides when location updates.
  - **Mitigation:** Only trigger navigation when `driver.rider_status` or `driver.id` changes, NOT on location or `is_online` updates.

### Verification Matrix:
1. **Cold Start Verification:** Approved driver launches app $\rightarrow$ Lands directly on `/(tabs)/bookings`.
2. **Live In-Session Transition:** Driver on "Under Review" screen $\rightarrow$ Admin approves in DB $\rightarrow$ Screen automatically flips to `/(tabs)/bookings` in real time without restart.
3. **Unverified Driver Security:** Driver with `rider_status = 'unsubmitted'` or `'pending'` attempting to access `/(tabs)/bookings` $\rightarrow$ Instantly redirected back to onboarding.

---
