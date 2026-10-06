const assert = require('assert');

console.log('  [Workflow Test] Testing Food/Grocery Claim Concurrency & Status Transitions...');

// 1. Optimistic Concurrency Claim Simulation
class MockOrderDatabase {
    constructor(initialOrders = []) {
        this.orders = new Map(initialOrders.map(o => [o.id, { ...o }]));
    }

    claimOrder(orderId, expectedCurrentStatus = 'preparing') {
        const order = this.orders.get(orderId);
        if (!order) {
            throw new Error('Order not found');
        }

        // Status guard matching .eq('status', 'preparing')
        if (order.status !== expectedCurrentStatus) {
            throw new Error('Order is no longer available');
        }

        // Transition atomically to 'out_for_delivery'
        order.status = 'out_for_delivery';
        order.updated_at = new Date().toISOString();
        return { ...order };
    }

    updateStatus(orderId, nextStatus) {
        const validTransitions = {
            'out_for_delivery': ['delivered', 'cancelled'],
            'delivered': [],
            'cancelled': [],
        };

        const order = this.orders.get(orderId);
        if (!order) throw new Error('Order not found');

        const allowed = validTransitions[order.status] || [];
        if (!allowed.includes(nextStatus)) {
            throw new Error(`Invalid status transition from ${order.status} to ${nextStatus}`);
        }

        order.status = nextStatus;
        return { ...order };
    }
}

const db = new MockOrderDatabase([
    { id: 'order_101', store_type: 'food', status: 'preparing' },
    { id: 'order_102', store_type: 'grocery', status: 'preparing' },
]);

// Driver 1 claims order_101
const claimed = db.claimOrder('order_101');
assert.strictEqual(claimed.status, 'out_for_delivery');

// Driver 2 tries to claim order_101 concurrently -> MUST FAIL with 'Order is no longer available'
assert.throws(() => {
    db.claimOrder('order_101');
}, /Order is no longer available/, 'Concurrent claim on already claimed order must fail');

// Status transition to delivered
const delivered = db.updateStatus('order_101', 'delivered');
assert.strictEqual(delivered.status, 'delivered');

// Double completion attempt -> MUST FAIL
assert.throws(() => {
    db.updateStatus('order_101', 'delivered');
}, /Invalid status transition/, 'Double completion must be rejected');
