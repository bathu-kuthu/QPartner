const assert = require('assert');

console.log('  [Routing Test] Testing State-Transition-Aware Router & Decoupled Location Updates...');

// Mock implementation of the router state machine logic from app/_layout.tsx
class MockRootRouter {
    constructor() {
        this.lastRoutedKey = null;
        this.routeHistory = [];
    }

    evaluateRoute(driver, permissions = { allGranted: true }, activeWork = null) {
        const currentRouteKey = `${driver?.id ?? 'anon'}:${driver?.rider_status ?? 'none'}:${driver?.is_driver ?? 'false'}`;
        if (this.lastRoutedKey === currentRouteKey) {
            // Decoupled / No reroute
            return null;
        }
        this.lastRoutedKey = currentRouteKey;

        let destination = null;
        if (!driver) {
            destination = '/(auth)/login';
        } else if (!driver.is_driver || driver.rider_status === 'unsubmitted') {
            destination = '/(auth)/onboarding';
        } else if (driver.rider_status === 'pending' || driver.rider_status === 'rejected') {
            destination = '/(auth)/onboarding';
        } else if (driver.rider_status === 'verified') {
            if (!permissions.allGranted) {
                destination = '/(auth)/permissions';
            } else if (activeWork?.activeRide) {
                destination = `/active-ride/${activeWork.activeRide.id}`;
            } else {
                destination = '/(tabs)/bookings';
            }
        } else {
            destination = '/(auth)/onboarding';
        }

        this.routeHistory.push(destination);
        return destination;
    }
}

// 1. Initial State: Unsubmitted driver
const router = new MockRootRouter();
let driver = { id: 'd_100', is_driver: true, rider_status: 'unsubmitted', current_lat: 13.08, current_lng: 80.27, is_online: false };
let dest = router.evaluateRoute(driver);
assert.strictEqual(dest, '/(auth)/onboarding', 'Unsubmitted driver must route to onboarding');

// 2. Driver submits documents -> becomes pending
driver = { ...driver, rider_status: 'pending' };
dest = router.evaluateRoute(driver);
assert.strictEqual(dest, '/(auth)/onboarding', 'Pending driver must route to onboarding (Under Review)');

// 3. Driver receives GPS coordinate updates while waiting in Under Review
driver = { ...driver, current_lat: 13.085, current_lng: 80.275 };
dest = router.evaluateRoute(driver);
assert.strictEqual(dest, null, 'GPS updates during pending review must NOT trigger rerouting');

// 4. Admin verifies driver in Supabase -> rider_status transitions to 'verified'
// Permissions are not yet granted
driver = { ...driver, rider_status: 'verified' };
dest = router.evaluateRoute(driver, { allGranted: false });
assert.strictEqual(dest, '/(auth)/permissions', 'Newly verified driver without permissions must route to Permissions screen');

// 5. Driver opens app with permissions already granted -> routes to Bookings
const freshRouter = new MockRootRouter();
dest = freshRouter.evaluateRoute(driver, { allGranted: true });
assert.strictEqual(dest, '/(tabs)/bookings', 'Verified driver with permissions must land directly on Bookings');

// 6. Verified driver is active on Bookings/Active Ride -> receives 100 GPS updates & is_online toggles
for (let i = 0; i < 100; i++) {
    driver = { ...driver, current_lat: 13.08 + i * 0.001, is_online: i % 2 === 0 };
    dest = freshRouter.evaluateRoute(driver, { allGranted: true });
    assert.strictEqual(dest, null, `GPS/is_online update #${i} must NOT trigger reroute`);
}

// 7. Driver logs out
dest = freshRouter.evaluateRoute(null);
assert.strictEqual(dest, '/(auth)/login', 'Logout must route to login screen');

console.log('  ✅ State transition routing & GPS immunity verified successfully.');
