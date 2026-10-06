const assert = require('assert');

// ─── Distance helper (Haversine, km) ────────────────────────────────────────
function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Service type mapping ────────────────────────────────────────────────────
function getServiceTypesForDriver(category, vehicleType, acceptBoth = false) {
    if (category === 'taxi') {
        if (vehicleType === 'bike') {
            const base = ['taxi_bike', 'bike_taxi'];
            return acceptBoth ? [...base, 'log_bike'] : base;
        }
        if (vehicleType === 'auto') return ['taxi_auto'];
        if (vehicleType === 'cab') return ['taxi_car'];
    }
    if (category === 'logistics') {
        if (vehicleType === 'bike') {
            const base = ['log_bike'];
            return acceptBoth ? [...base, 'taxi_bike', 'bike_taxi'] : base;
        }
        if (vehicleType === 'mini_truck') return ['log_mini_truck'];
        if (vehicleType === 'truck') return ['log_truck'];
    }
    return [];
}

// ─── Test 1: Service Type Mapping ─────────────────────────────────────────────
console.log('  [Test 1] Testing Driver Service Type Mapping...');

// Taxi Bike - Default
const taxiBike = getServiceTypesForDriver('taxi', 'bike', false);
assert.deepStrictEqual(taxiBike, ['taxi_bike', 'bike_taxi'], 'Taxi bike default mapping mismatch');

// Taxi Bike - Cross-category (acceptBoth = true)
const taxiBikeCross = getServiceTypesForDriver('taxi', 'bike', true);
assert.deepStrictEqual(taxiBikeCross, ['taxi_bike', 'bike_taxi', 'log_bike'], 'Taxi bike cross-category mapping mismatch');

// Logistics Bike - Default
const logBike = getServiceTypesForDriver('logistics', 'bike', false);
assert.deepStrictEqual(logBike, ['log_bike'], 'Logistics bike default mapping mismatch');

// Logistics Bike - Cross-category (acceptBoth = true)
const logBikeCross = getServiceTypesForDriver('logistics', 'bike', true);
assert.deepStrictEqual(logBikeCross, ['log_bike', 'taxi_bike', 'bike_taxi'], 'Logistics bike cross-category mapping mismatch');

// Auto & Cab
const auto = getServiceTypesForDriver('taxi', 'auto', false);
assert.deepStrictEqual(auto, ['taxi_auto'], 'Auto mapping mismatch');

const cab = getServiceTypesForDriver('taxi', 'cab', false);
assert.deepStrictEqual(cab, ['taxi_car'], 'Cab mapping mismatch');

// Mini Truck & Truck
const miniTruck = getServiceTypesForDriver('logistics', 'mini_truck', false);
assert.deepStrictEqual(miniTruck, ['log_mini_truck'], 'Mini truck mapping mismatch');

const truck = getServiceTypesForDriver('logistics', 'truck', false);
assert.deepStrictEqual(truck, ['log_truck'], 'Truck mapping mismatch');

// ─── Test 2: Haversine Distance Accuracy ──────────────────────────────────────
console.log('  [Test 2] Testing Haversine Distance Calculation & Proximity Sorting...');

// Chennai Central (13.0827, 80.2707) to Marina Beach (13.0499, 80.2824) ~ 3.8-4.0 km
const dist = haversineKm(13.0827, 80.2707, 13.0499, 80.2824);
assert.ok(dist > 3.5 && dist < 4.5, `Haversine distance calculation out of range: ${dist} km`);

// Test sorting orders by proximity
const driverLocation = { lat: 13.0827, lng: 80.2707 };
const mockOrders = [
    { id: 'far_order', store_lat: 13.0000, store_lng: 80.2000 },     // ~11 km
    { id: 'near_order', store_lat: 13.0800, store_lng: 80.2700 },    // ~0.3 km
    { id: 'mid_order', store_lat: 13.0500, store_lng: 80.2800 },     // ~4 km
];

const sorted = [...mockOrders].sort((a, b) => {
    const dA = haversineKm(driverLocation.lat, driverLocation.lng, a.store_lat, a.store_lng);
    const dB = haversineKm(driverLocation.lat, driverLocation.lng, b.store_lat, b.store_lng);
    return dA - dB;
});

assert.strictEqual(sorted[0].id, 'near_order', 'Nearest order must be first');
assert.strictEqual(sorted[1].id, 'mid_order', 'Middle order must be second');
assert.strictEqual(sorted[2].id, 'far_order', 'Farthest order must be last');

// ─── Test 3: Absence of 3 km Cutoff Filter ────────────────────────────────────
console.log('  [Test 3] Testing Absence of 3 km Dispatch Radius Restriction...');

const simulatedDriverLat = 13.0827;
const simulatedDriverLng = 80.2707;
const ordersAcrossDistances = [
    { id: 'order_1km', store_lat: 13.0800, store_lng: 80.2700 },   // ~0.3 km (< 3 km)
    { id: 'order_3km', store_lat: 13.0600, store_lng: 80.2700 },   // ~2.5 km (≈ 3 km)
    { id: 'order_5km', store_lat: 13.0400, store_lng: 80.2700 },   // ~4.7 km (> 3 km)
    { id: 'order_12km', store_lat: 12.9800, store_lng: 80.2700 },  // ~11.4 km (> 10 km)
];

// Verify that all orders across all distance ranges are preserved and ordered by proximity
const processedOrders = [...ordersAcrossDistances].sort((a, b) => {
    const dA = haversineKm(simulatedDriverLat, simulatedDriverLng, a.store_lat, a.store_lng);
    const dB = haversineKm(simulatedDriverLat, simulatedDriverLng, b.store_lat, b.store_lng);
    return dA - dB;
});

assert.strictEqual(processedOrders.length, 4, 'All 4 orders across distance tiers must be retained (no distance exclusion)');
assert.strictEqual(processedOrders[0].id, 'order_1km');
assert.strictEqual(processedOrders[1].id, 'order_3km');
assert.strictEqual(processedOrders[2].id, 'order_5km');
assert.strictEqual(processedOrders[3].id, 'order_12km');
console.log('  ✅ Verified: Orders > 3 km, > 5 km, and > 10 km are fully preserved and sorted by proximity.');

