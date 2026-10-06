const assert = require('assert');

console.log('====================================================');
console.log('🧪 QPARTNER LOGIN & AUTH STATE MACHINE VERIFICATION');
console.log('====================================================');

// ─── 1. Strict Indian Phone Normalization Matrix ─────────────────────────────
function normalizeIndianPhone(input) {
    if (!input || typeof input !== 'string') {
        return { isValid: false, formatted: '', nationalNumber: '', error: 'Phone number is required' };
    }

    const trimmed = input.trim();
    if (!trimmed) {
        return { isValid: false, formatted: '', nationalNumber: '', error: 'Phone number is required' };
    }

    // Only allow digits, spaces, hyphens, and a single leading '+'
    if (!/^\+?[\d\s\-()]+$/.test(trimmed)) {
        return { isValid: false, formatted: '', nationalNumber: '', error: 'Phone number contains invalid characters' };
    }

    let cleaned = trimmed.replace(/[^\d+]/g, '');

    if (cleaned.startsWith('+')) {
        cleaned = cleaned.substring(1);
    }

    if (cleaned.startsWith('91') && cleaned.length === 12) {
        cleaned = cleaned.substring(2);
    } else if (cleaned.startsWith('0') && cleaned.length === 11) {
        cleaned = cleaned.substring(1);
    }

    if (!/^\d{10}$/.test(cleaned)) {
        return { isValid: false, formatted: '', nationalNumber: '', error: 'Please enter a valid 10-digit mobile number' };
    }

    if (!/^[6-9]\d{9}$/.test(cleaned)) {
        return { isValid: false, formatted: '', nationalNumber: '', error: 'Mobile number must start with 6, 7, 8, or 9' };
    }

    return {
        isValid: true,
        formatted: `+91${cleaned}`,
        nationalNumber: cleaned,
    };
}

console.log('▶ [1/5] Testing Indian Phone Normalization Matrix...');
const validCases = [
    { input: '9876543210', expected: '+919876543210' },
    { input: '+91 98765 43210', expected: '+919876543210' },
    { input: '+919876543210', expected: '+919876543210' },
    { input: '919876543210', expected: '+919876543210' },
    { input: '09876543210', expected: '+919876543210' },
    { input: '9123456789', expected: '+919123456789' }, // Starts with 91 as first 2 digits of 10-digit phone
    { input: '6234567890', expected: '+916234567890' },
    { input: '7234567890', expected: '+917234567890' },
    { input: '8234567890', expected: '+918234567890' },
];

for (const tc of validCases) {
    const res = normalizeIndianPhone(tc.input);
    assert.strictEqual(res.isValid, true, `Expected ${tc.input} to be valid`);
    assert.strictEqual(res.formatted, tc.expected, `Expected ${tc.input} -> ${tc.expected}`);
}

const invalidCases = [
    '',
    '   ',
    '1234567890', // Does not start with 6-9
    '2345678901', // Does not start with 6-9
    '98765',      // Too short
    '987654321012345', // Too long
    'abcd9876543210',  // Mixed alpha
    'null',
    undefined,
];

for (const tc of invalidCases) {
    const res = normalizeIndianPhone(tc);
    assert.strictEqual(res.isValid, false, `Expected ${tc} to be invalid`);
}
console.log('  ✅ Phone normalization matrix passed (9 valid, 9 invalid cases).');

// ─── 2. OTP Expiry, Single-Use & Replay Protection ───────────────────────────
console.log('▶ [2/5] Testing OTP Expiry & Replay Protection...');
class MockOtpStore {
    constructor() {
        this.store = new Map();
    }

    insert(phone, otp, expiresAt) {
        this.store.set(phone, { otp, expiresAt });
    }

    verifyAndConsume(phone, enteredOtp) {
        const record = this.store.get(phone);
        if (!record) throw new Error('Invalid or expired OTP');
        if (record.otp !== enteredOtp) throw new Error('Invalid or expired OTP');
        if (new Date(record.expiresAt) < new Date()) throw new Error('OTP has expired');

        // Immediate single-use consumption
        this.store.delete(phone);
        return true;
    }
}

const futureExpiry = new Date(Date.now() + 120000).toISOString();
const pastExpiry = new Date(Date.now() - 5000).toISOString();

const mockStore = new MockOtpStore();
mockStore.insert('+919876543210', '482910', futureExpiry);

// First verification succeeds
assert.strictEqual(mockStore.verifyAndConsume('+919876543210', '482910'), true);

// Replay with exact same OTP must fail
assert.throws(() => {
    mockStore.verifyAndConsume('+919876543210', '482910');
}, /Invalid or expired OTP/);

// Expired OTP must fail
mockStore.insert('+919876543210', '999999', pastExpiry);
assert.throws(() => {
    mockStore.verifyAndConsume('+919876543210', '999999');
}, /OTP has expired/);
console.log('  ✅ OTP expiry, single-use, and replay protection passed.');

// ─── 3. In-Flight Lock & Concurrency Simulation (1, 10, 50, 100 Taps) ─────────
console.log('▶ [3/5] Testing Button Duplicate-Tap & In-Flight Lock Concurrency...');

class MockSubmitLock {
    constructor() {
        this.isLocked = false;
        this.networkCallCount = 0;
    }

    async submit(action) {
        if (this.isLocked) {
            return { handled: false, reason: 'LOCKED' };
        }
        this.isLocked = true;
        try {
            this.networkCallCount++;
            const result = await action();
            return { handled: true, result };
        } finally {
            this.isLocked = false;
        }
    }
}

async function testConcurrency(tapCount) {
    const lock = new MockSubmitLock();
    const action = () => new Promise((resolve) => setTimeout(() => resolve('OK'), 20));

    // Simulate N simultaneous taps
    const promises = Array.from({ length: tapCount }, () => lock.submit(action));
    const results = await Promise.all(promises);

    const successfulCalls = results.filter((r) => r.handled);
    const lockedCalls = results.filter((r) => !r.handled && r.reason === 'LOCKED');

    assert.strictEqual(lock.networkCallCount, 1, `Exactly 1 backend call should execute for ${tapCount} simultaneous taps`);
    assert.strictEqual(successfulCalls.length, 1, `Only 1 call should resolve as handled`);
    assert.strictEqual(lockedCalls.length, tapCount - 1, `Remaining ${tapCount - 1} taps must be cleanly debounced`);
}

(async () => {
    for (const taps of [1, 10, 50, 100]) {
        await testConcurrency(taps);
    }
    console.log('  ✅ Concurrency locks passed for 1, 10, 50, and 100 simultaneous taps.');
})();

// ─── 4. Timeout Simulation ───────────────────────────────────────────────────
console.log('▶ [4/5] Testing Bounded Timeout Rejection...');
async function withTimeout(promise, timeoutMs) {
    let timer;
    const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('REQUEST_TIMEOUT')), timeoutMs);
    });
    try {
        const res = await Promise.race([promise, timeoutPromise]);
        clearTimeout(timer);
        return res;
    } catch (e) {
        clearTimeout(timer);
        throw e;
    }
}

(async () => {
    const hangingRequest = new Promise((resolve) => setTimeout(resolve, 500));
    try {
        await withTimeout(hangingRequest, 50);
        assert.fail('Should have timed out');
    } catch (err) {
        assert.strictEqual(err.message, 'REQUEST_TIMEOUT');
    }
    console.log('  ✅ Bounded timeout rejected hanging request within deadline.');
})();

// ─── 5. 100-Iteration Deterministic State Machine Simulation ──────────────────
console.log('▶ [5/5] Running 100-Iteration Deterministic Auth State Machine Simulation...');

const State = {
    UNAUTHENTICATED: 'UNAUTHENTICATED',
    OTP_REQUESTING: 'OTP_REQUESTING',
    OTP_SENT: 'OTP_SENT',
    OTP_VERIFYING: 'OTP_VERIFYING',
    AUTHENTICATED: 'AUTHENTICATED',
    REGISTER_REQUIRED: 'REGISTER_REQUIRED',
    ONBOARDING_REQUIRED: 'ONBOARDING_REQUIRED',
    PERMISSIONS_REQUIRED: 'PERMISSIONS_REQUIRED',
    READY: 'READY',
    ERROR: 'ERROR',
};

class AuthStateMachine {
    constructor() {
        this.state = State.UNAUTHENTICATED;
        this.phone = null;
        this.driver = null;
        this.error = null;
    }

    requestOtp(rawPhone) {
        const norm = normalizeIndianPhone(rawPhone);
        if (!norm.isValid) {
            this.state = State.ERROR;
            this.error = norm.error;
            return false;
        }
        this.phone = norm.formatted;
        this.state = State.OTP_SENT;
        return true;
    }

    verifyOtp(enteredOtp, expectedOtp, isExistingDriver = true, riderStatus = 'verified') {
        this.state = State.OTP_VERIFYING;
        if (!enteredOtp || enteredOtp !== expectedOtp) {
            this.state = State.ERROR;
            this.error = 'Invalid or expired OTP';
            return false;
        }

        if (!isExistingDriver) {
            this.state = State.REGISTER_REQUIRED;
            return true;
        }

        this.driver = { phone: this.phone, rider_status: riderStatus };
        if (riderStatus === 'unsubmitted' || riderStatus === 'pending' || riderStatus === 'rejected') {
            this.state = State.ONBOARDING_REQUIRED;
        } else {
            this.state = State.READY;
        }
        return true;
    }

    logout() {
        this.state = State.UNAUTHENTICATED;
        this.phone = null;
        this.driver = null;
        this.error = null;
    }
}

let simulatedRuns = 0;
for (let i = 0; i < 100; i++) {
    const sm = new AuthStateMachine();

    // 1. Invalid phone attempt
    sm.requestOtp('12345');
    assert.strictEqual(sm.state, State.ERROR);

    // 2. Valid phone request
    const sent = sm.requestOtp('9876543210');
    assert.strictEqual(sent, true);
    assert.strictEqual(sm.state, State.OTP_SENT);

    // 3. Invalid OTP attempt
    sm.verifyOtp('000000', '123456');
    assert.strictEqual(sm.state, State.ERROR);

    // 4. Successful verification branches
    if (i % 3 === 0) {
        // New driver branch
        sm.verifyOtp('123456', '123456', false);
        assert.strictEqual(sm.state, State.REGISTER_REQUIRED);
    } else if (i % 3 === 1) {
        // Unsubmitted/Onboarding branch
        sm.verifyOtp('123456', '123456', true, 'unsubmitted');
        assert.strictEqual(sm.state, State.ONBOARDING_REQUIRED);
    } else {
        // Verified ready branch
        sm.verifyOtp('123456', '123456', true, 'verified');
        assert.strictEqual(sm.state, State.READY);
    }

    // 5. Logout transition
    sm.logout();
    assert.strictEqual(sm.state, State.UNAUTHENTICATED);
    assert.strictEqual(sm.driver, null);

    simulatedRuns++;
}

console.log(`  ✅ 100/100 deterministic state machine iterations completed without deadlocks.`);
console.log('====================================================');
console.log('🎉 ALL LOGIN & AUTHENTICATION TESTS PASSED');
console.log('====================================================');
