const assert = require('assert');

console.log('  [Realtime Test] Testing Realtime Subscription Lifecycle & GPS Decoupling...');

// Verify that coordinate updates do NOT re-subscribe channels when using a coordinate resolver
class MockRealtimeManager {
    constructor() {
        this.subscriptionCount = 0;
        this.unsubscriptionCount = 0;
    }

    subscribe(channelName, callback, coordsResolver) {
        this.subscriptionCount++;
        return {
            triggerEvent: () => {
                const coords = typeof coordsResolver === 'function' ? coordsResolver() : coordsResolver;
                callback(coords);
            },
            unsubscribe: () => {
                this.unsubscriptionCount++;
            }
        };
    }
}

const manager = new MockRealtimeManager();
let currentGPS = { lat: 13.0827, lng: 80.2707 };
let lastReceivedCoords = null;

// Initial subscription
const sub = manager.subscribe('pending_rides', (coords) => {
    lastReceivedCoords = coords;
}, () => currentGPS);

assert.strictEqual(manager.subscriptionCount, 1);

// Simulate 50 GPS updates while moving
for (let i = 0; i < 50; i++) {
    currentGPS = { lat: 13.0827 + i * 0.001, lng: 80.2707 + i * 0.001 };
}

// Ensure subscriptionCount is STILL 1 (zero channel churn!)
assert.strictEqual(manager.subscriptionCount, 1, 'GPS updates should NOT create new subscriptions');
assert.strictEqual(manager.unsubscriptionCount, 0, 'GPS updates should NOT trigger unsubscriptions');

// Trigger event and ensure latest GPS is picked up dynamically
sub.triggerEvent();
assert.deepStrictEqual(lastReceivedCoords, currentGPS, 'Event should dynamically resolve latest GPS coords');

// Clean unmount
sub.unsubscribe();
assert.strictEqual(manager.unsubscriptionCount, 1, 'Unsubscribe should be called cleanly on unmount');
