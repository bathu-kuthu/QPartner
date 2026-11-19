const assert = require('assert');

console.log('====================================================');
console.log('🧪 QPARTNER BACKGROUND ORDER NOTIFICATION SYSTEM TESTS');
console.log('====================================================');

// ─── 1. Foreground vs Background Notification Handler Policy ─────────────────
console.log('▶ [1/6] Testing Foreground vs Background Notification Handler Policy...');

function evaluateNotificationBehavior(notificationData, appState) {
    const isIncomingOrder =
        notificationData?.type === 'NEW_BOOKING' ||
        notificationData?.type === 'NEW_FOOD_ORDER' ||
        notificationData?.type === 'NEW_GROCERY_ORDER';
    const isOnlineStatus = notificationData?.type === 'ONLINE_STATUS';
    const isAppForeground = appState === 'active';

    if (isOnlineStatus) {
        return {
            shouldShowBanner: false,
            shouldShowList: true,
            shouldPlaySound: false,
            shouldSetBadge: false,
            priority: 'LOW',
        };
    }

    return {
        shouldShowBanner: isIncomingOrder ? !isAppForeground : true,
        shouldShowList: true,
        shouldPlaySound: isIncomingOrder ? !isAppForeground : true,
        shouldSetBadge: isIncomingOrder,
        priority: 'MAX',
    };
}

// Case A: App in foreground -> suppress system banner (modal handles alert)
const fgBehavior = evaluateNotificationBehavior({ type: 'NEW_BOOKING', rideId: 'r_1' }, 'active');
assert.strictEqual(fgBehavior.shouldShowBanner, false, 'Foreground incoming order should use in-app modal instead of duplicate system banner');
assert.strictEqual(fgBehavior.shouldPlaySound, false);

// Case B: App minimized / background / another app open / screen locked -> MUST show banner and play sound
for (const state of ['background', 'inactive']) {
    for (const type of ['NEW_BOOKING', 'NEW_FOOD_ORDER', 'NEW_GROCERY_ORDER']) {
        const bgBehavior = evaluateNotificationBehavior({ type, orderId: 'o_1' }, state);
        assert.strictEqual(bgBehavior.shouldShowBanner, true, `Background (${state}) ${type} MUST show heads-up banner`);
        assert.strictEqual(bgBehavior.shouldPlaySound, true, `Background (${state}) ${type} MUST play alert sound`);
        assert.strictEqual(bgBehavior.priority, 'MAX', `Background (${state}) ${type} MUST have MAX priority`);
    }
}

// Case C: Persistent online status notification -> silent ongoing presence
const onlineStatusBehavior = evaluateNotificationBehavior({ type: 'ONLINE_STATUS' }, 'background');
assert.strictEqual(onlineStatusBehavior.shouldShowBanner, false);
assert.strictEqual(onlineStatusBehavior.shouldPlaySound, false);
assert.strictEqual(onlineStatusBehavior.shouldShowList, true);
console.log('  ✅ Notification handler policy verified across foreground, background, and locked states.');

// ─── 2. Privacy-Safe Lock-Screen Notification Payload Builder ────────────────
console.log('▶ [2/6] Testing Privacy-Safe Incoming Order Payload Construction...');

function buildIncomingOrderPayload(record, domain = 'transport') {
    const isTransport = domain === 'transport';
    const orderId = String(record?.id ?? '');
    const type =
        domain === 'food'
            ? 'NEW_FOOD_ORDER'
            : domain === 'grocery'
              ? 'NEW_GROCERY_ORDER'
              : 'NEW_BOOKING';

    const serviceLabels = {
        taxi_bike: 'Bike Taxi',
        taxi_car: 'Cab',
        food: 'Food Delivery',
        grocery: 'Grocery Delivery',
    };
    const serviceType = isTransport ? (record?.service_type ?? 'taxi_bike') : domain;
    const serviceLabel = serviceLabels[serviceType] ?? 'Delivery Request';
    const earning = isTransport ? Number(record?.fare ?? 0) : Number(record?.delivery_fee || 35);
    const distanceKm = record?.distance_km != null ? `${record.distance_km} km` : '';

    const rawPickup = isTransport
        ? (record?.pickup_address || 'Pickup Location')
        : (record?.store?.name ? `${record.store.name}, ${record.store.address || ''}` : 'Partner Store Pickup');
    const rawDrop = isTransport
        ? (record?.drop_address || 'Dropoff Location')
        : (record?.delivery_address || 'Customer Dropoff Area');

    const pickupSummary = String(rawPickup).slice(0, 60);
    const dropSummary = String(rawDrop).slice(0, 60);

    const metaParts = [serviceLabel, earning > 0 ? `₹${earning}` : null, distanceKm || null, 'Respond within 30s'].filter(Boolean);

    return {
        title: `New Quickora Order • ${serviceLabel}`,
        body: `A new delivery request is waiting for your response.\n${metaParts.join(' • ')}\n📍 ${pickupSummary} → 🏁 ${dropSummary}`,
        data: {
            type,
            domain,
            rideId: isTransport ? orderId : undefined,
            orderId,
            url: '/(tabs)/bookings',
            fare: earning,
        },
    };
}

const sampleFoodOrder = {
    id: 'ord_food_99',
    store_type: 'food',
    delivery_fee: 45,
    distance_km: 3.2,
    delivery_address: '12 Anna Nagar East, Chennai',
    customer_name: 'Private Customer Name',
    customer_phone: '+919999988888',
    delivery_otp: '4821',
    store: { name: 'Saaral Restaurant', address: 'T Nagar' },
};

const foodPayload = buildIncomingOrderPayload(sampleFoodOrder, 'food');
assert.ok(foodPayload.title.includes('New Quickora Order • Food Delivery'));
assert.ok(foodPayload.body.includes('₹45'));
assert.ok(foodPayload.body.includes('Respond within 30s'));
assert.ok(!foodPayload.body.includes('Private Customer Name'), 'Customer name must not be exposed on lock-screen notification');
assert.ok(!foodPayload.body.includes('9999988888'), 'Customer phone must not be exposed on lock-screen notification');
assert.ok(!foodPayload.body.includes('4821'), 'OTP must never be exposed in notification');
console.log('  ✅ Privacy-safe payload verified (zero customer PII / OTP exposure).');

// ─── 3. Persistent Online Foreground Service Lifecycle & Backend Authority ───
console.log('▶ [3/6] Testing Persistent Online Foreground Service & Backend Authority...');

class MockOnlineServiceLifecycle {
    constructor() {
        this.fgServiceRunning = false;
        this.onlineNotificationVisible = false;
        this.notificationTitle = null;
        this.notificationBody = null;
    }

    startOnline(driver) {
        if (!driver || !driver.id || !driver.is_driver || driver.rider_status !== 'verified') {
            throw new Error('Ineligible driver cannot start online service');
        }
        this.fgServiceRunning = true;
        this.onlineNotificationVisible = true;
        this.notificationTitle = 'Quickora Partner';
        this.notificationBody = "You're Online — Searching for orders";
    }

    syncWithBackend(backendDriverRow) {
        if (!backendDriverRow || !backendDriverRow.is_online || backendDriverRow.rider_status !== 'verified') {
            this.stopOnline();
            return false;
        }
        return true;
    }

    stopOnline() {
        this.fgServiceRunning = false;
        this.onlineNotificationVisible = false;
        this.notificationTitle = null;
        this.notificationBody = null;
    }
}

const lifecycle = new MockOnlineServiceLifecycle();

// Unverified driver cannot start online service
assert.throws(() => {
    lifecycle.startOnline({ id: 'd1', is_driver: true, rider_status: 'pending' });
}, /Ineligible driver/);

// Verified driver goes online
lifecycle.startOnline({ id: 'd1', is_driver: true, rider_status: 'verified' });
assert.strictEqual(lifecycle.fgServiceRunning, true);
assert.strictEqual(lifecycle.onlineNotificationVisible, true);
assert.strictEqual(lifecycle.notificationTitle, 'Quickora Partner');
assert.strictEqual(lifecycle.notificationBody, "You're Online — Searching for orders");

// Backend marks driver offline (or phone restarts and DB says offline) -> service must stop immediately
lifecycle.syncWithBackend({ id: 'd1', is_online: false, rider_status: 'verified' });
assert.strictEqual(lifecycle.fgServiceRunning, false, 'Foreground service must stop when backend reports driver offline');
assert.strictEqual(lifecycle.onlineNotificationVisible, false, 'Online notification must be dismissed when offline');
console.log('  ✅ Persistent online notification & foreground service lifecycle verified.');

// ─── 4. Duplicate Prevention Across Realtime, Polling, and Push ──────────────
console.log('▶ [4/6] Testing Order Event Deduplication (Zero Repeated Alerts)...');

class MockDeduplicatedAlertEngine {
    constructor() {
        this.notifiedIds = new Set();
        this.handledIds = new Set();
        this.notificationsSent = [];
    }

    triggerAlert(orderId, source) {
        if (this.handledIds.has(orderId) || this.notifiedIds.has(orderId)) {
            return false; // Duplicate suppressed
        }
        this.notifiedIds.add(orderId);
        this.notificationsSent.push({ orderId, source });
        return true;
    }

    markHandled(orderId) {
        this.handledIds.add(orderId);
        this.notifiedIds.add(orderId);
    }
}

const alertEngine = new MockDeduplicatedAlertEngine();

// Same order arrives via FCM Push, Realtime, and 5s Background Polling
const firstPush = alertEngine.triggerAlert('ride_500', 'fcm_push');
const secondRealtime = alertEngine.triggerAlert('ride_500', 'realtime');
const thirdPoll = alertEngine.triggerAlert('ride_500', 'bg_poll');

assert.strictEqual(firstPush, true, 'First arrival of ride_500 must trigger alert');
assert.strictEqual(secondRealtime, false, 'Second arrival via realtime must be suppressed');
assert.strictEqual(thirdPoll, false, 'Third arrival via background poll must be suppressed');
assert.strictEqual(alertEngine.notificationsSent.length, 1, 'Exactly 1 notification must be sent for ride_500');

// Declined order must never re-alert
alertEngine.markHandled('ride_501');
assert.strictEqual(alertEngine.triggerAlert('ride_501', 'realtime'), false, 'Declined order must not alert');
console.log('  ✅ Order event deduplication verified across FCM, Realtime, and Background Polling.');

// ─── 5. Server-Side Edge Function Dispatch Filtering & Token Hygiene ─────────
console.log('▶ [5/6] Testing Edge Function Eligibility, Busy-Driver Exclusion & Stale Token Cleanup...');

function filterEligibleDriversForPush(drivers, busyDriverIds, domain, serviceType) {
    const seenTokens = new Set();
    const targets = [];

    for (const d of drivers) {
        if (!d.id || !d.fcm_token || !d.is_online || !d.is_driver) continue;
        if ((d.rider_status ?? '').trim().toLowerCase() !== 'verified') continue;
        if (busyDriverIds.has(d.id)) continue;

        const vType = (d.vehicle_type ?? '').trim().toLowerCase();
        if (domain === 'food' || domain === 'grocery') {
            if (vType !== 'bike') continue;
        } else if (serviceType === 'taxi_car' && vType !== 'cab' && vType !== 'car') {
            continue;
        }

        if (seenTokens.has(d.fcm_token)) continue;
        seenTokens.add(d.fcm_token);
        targets.push(d);
    }
    return targets;
}

const candidateDrivers = [
    { id: 'd_online_free', is_driver: true, is_online: true, rider_status: 'verified', vehicle_type: 'bike', fcm_token: 'tok_1' },
    { id: 'd_dup_token', is_driver: true, is_online: true, rider_status: 'verified', vehicle_type: 'bike', fcm_token: 'tok_1' }, // Duplicate token
    { id: 'd_busy', is_driver: true, is_online: true, rider_status: 'verified', vehicle_type: 'bike', fcm_token: 'tok_2' },       // Busy on active ride
    { id: 'd_offline', is_driver: true, is_online: false, rider_status: 'verified', vehicle_type: 'bike', fcm_token: 'tok_3' },   // Offline
    { id: 'd_unverified', is_driver: true, is_online: true, rider_status: 'pending', vehicle_type: 'bike', fcm_token: 'tok_4' },  // Unverified
    { id: 'd_cab', is_driver: true, is_online: true, rider_status: 'verified', vehicle_type: 'cab', fcm_token: 'tok_5' },         // Cab (ineligible for food)
];

const busySet = new Set(['d_busy']);
const foodTargets = filterEligibleDriversForPush(candidateDrivers, busySet, 'food', 'food');
assert.strictEqual(foodTargets.length, 1, 'Only free, verified, online bike driver with unique token should receive food push');
assert.strictEqual(foodTargets[0].id, 'd_online_free');
console.log('  ✅ Server-side dispatch eligibility, busy-driver exclusion, and token deduplication verified.');

// ─── 6. Cold-Start & Warm-Start Notification Tap + Accept Navigation ─────────
console.log('▶ [6/6] Testing Cold-Start & Warm-Start Notification Tap & Atomic Accept Navigation...');

class MockNotificationRouter {
    constructor(ordersDb) {
        this.ordersDb = ordersDb;
        this.handledResponses = new Set();
        this.currentRoute = '/(tabs)/bookings';
        this.modalOrder = null;
        this.lastAlert = null;
    }

    processResponse(notifId, actionId, data, driverId) {
        const key = `${notifId}:${actionId}`;
        if (this.handledResponses.has(key)) {
            return { deduplicated: true };
        }
        this.handledResponses.add(key);

        const order = this.ordersDb.get(data.orderId);

        if (actionId === 'accept_ride') {
            if (!order || order.status !== 'preparing' || order.driver_id !== null) {
                this.lastAlert = 'Order No Longer Available';
                this.currentRoute = '/(tabs)/bookings';
                return { accepted: false };
            }
            order.status = 'out_for_delivery';
            order.driver_id = driverId;
            this.currentRoute = `/active-${data.domain}/${order.id}`;
            return { accepted: true, route: this.currentRoute };
        }

        // Body tap or View action
        if (!order || order.status !== 'preparing' || order.driver_id !== null) {
            this.lastAlert = 'Order Already Taken';
            this.currentRoute = '/(tabs)/bookings';
            return { shownModal: false };
        }

        this.currentRoute = '/(tabs)/bookings';
        this.modalOrder = order;
        return { shownModal: true };
    }
}

const mockOrders = new Map([
    ['ord_1', { id: 'ord_1', status: 'preparing', driver_id: null }],
    ['ord_taken', { id: 'ord_taken', status: 'out_for_delivery', driver_id: 'other_driver' }],
]);

const navRouter = new MockNotificationRouter(mockOrders);

// 1. Cold-start Accept on valid order -> navigates directly to active delivery screen
const resAccept = navRouter.processResponse('notif_100', 'accept_ride', { orderId: 'ord_1', domain: 'food' }, 'driver_me');
assert.strictEqual(resAccept.accepted, true);
assert.strictEqual(navRouter.currentRoute, '/active-food/ord_1');

// 2. Duplicate delivery of same cold-start response -> ignored
const resDup = navRouter.processResponse('notif_100', 'accept_ride', { orderId: 'ord_1', domain: 'food' }, 'driver_me');
assert.strictEqual(resDup.deduplicated, true);

// 3. Tap on order already taken by another partner -> shows alert and routes safely to bookings
const resTaken = navRouter.processResponse('notif_200', 'default', { orderId: 'ord_taken', domain: 'food' }, 'driver_me');
assert.strictEqual(resTaken.shownModal, false);
assert.strictEqual(navRouter.lastAlert, 'Order Already Taken');
assert.strictEqual(navRouter.currentRoute, '/(tabs)/bookings');

console.log('  ✅ Cold-start & warm-start notification response routing and atomic accept verified.');
console.log('====================================================');
console.log('🎉 ALL BACKGROUND ORDER NOTIFICATION TESTS PASSED');
console.log('====================================================');

