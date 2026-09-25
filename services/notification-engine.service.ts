import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { NOTIFICATION_CATEGORIES } from './notification.service';

/**
 * NotificationEngine
 *
 * Fires repeated local notifications at a fixed interval while a pending ride
 * exists and the driver has not yet accepted or declined.
 *
 * Usage:
 *   NotificationEngine.start(ride)   — call when incomingRide is set
 *   NotificationEngine.stop()        — call on accept / decline / timeout
 *
 * The engine automatically stops after MAX_DURATION_MS even if stop() is never
 * called (safety valve).
 *
 * Design notes:
 *  - We use setInterval (JS-side) to schedule a new local notification every
 *    REPEAT_INTERVAL_MS. This works while the app is in the foreground OR
 *    background (React Native's JS thread stays alive in BG on Android).
 *  - When the app is fully killed, FCM itself delivers the initial push and
 *    the background task fires one notification — the engine is not needed there.
 *  - Each repeated notification carries the same `categoryIdentifier` so the
 *    system-level Accept/Decline action buttons appear in the notification shade.
 *  - Notifications are tagged with a fixed `identifier` so the OS only shows
 *    the latest one (prevents the shade from filling up).
 */

// ─── Config ───────────────────────────────────────────────────────────────────
const REPEAT_INTERVAL_MS = 8_000;   // Fire every 8 seconds
const MAX_DURATION_MS    = 60_000;  // Stop after 60 seconds max
const NOTIFICATION_ID    = 'continuous_booking_alert'; // Fixed ID → OS replaces previous

// ─── State ────────────────────────────────────────────────────────────────────
let _intervalHandle: ReturnType<typeof setInterval> | null = null;
let _timeoutHandle:  ReturnType<typeof setTimeout>  | null = null;
let _activeRideId:   string | null = null;
let _fireCount = 0;

// ─── Service ──────────────────────────────────────────────────────────────────
export const NotificationEngine = {

    /**
     * Start firing repeated notifications for this ride.
     * Safe to call multiple times — re-calling with the same rideId is a no-op.
     * Re-calling with a different rideId stops the previous engine first.
     */
    start(ride: any): void {
        if (Platform.OS === 'web') return;
        if (!ride?.id) return;

        // Already running for this ride — no-op
        if (_activeRideId === ride.id && _intervalHandle !== null) {
            console.log('[NotificationEngine] Already running for ride:', ride.id);
            return;
        }

        // Stop any previously running engine
        NotificationEngine.stop();

        _activeRideId = ride.id;
        _fireCount = 0;

        console.log('[NotificationEngine] Starting for ride:', ride.id,
            `(repeat every ${REPEAT_INTERVAL_MS / 1000}s, max ${MAX_DURATION_MS / 1000}s)`);

        // Fire the first notification immediately
        _scheduleNotification(ride);

        // Then repeat on interval
        _intervalHandle = setInterval(() => {
            _fireCount += 1;
            _scheduleNotification(ride);
        }, REPEAT_INTERVAL_MS);

        // Safety valve — stop after MAX_DURATION_MS regardless
        _timeoutHandle = setTimeout(() => {
            console.log('[NotificationEngine] Max duration reached — auto-stopping');
            NotificationEngine.stop();
        }, MAX_DURATION_MS);
    },

    /**
     * Stop the engine and cancel all pending notifications for the active ride.
     * Optionally pass a rideId to only stop if it matches the active ride.
     */
    stop(rideId?: string): void {
        if (rideId && _activeRideId && rideId !== _activeRideId) {
            // Different ride — don't touch the current engine
            return;
        }

        if (_intervalHandle !== null) {
            clearInterval(_intervalHandle);
            _intervalHandle = null;
        }
        if (_timeoutHandle !== null) {
            clearTimeout(_timeoutHandle);
            _timeoutHandle = null;
        }

        if (_activeRideId) {
            console.log('[NotificationEngine] Stopped for ride:', _activeRideId,
                `(fired ${_fireCount + 1} notifications)`);
            // Cancel the pinned notification from the shade
            _cancelNotification();
        }

        _activeRideId = null;
        _fireCount = 0;
    },

    /** Returns true if the engine is currently running for any ride */
    isRunning(): boolean {
        return _intervalHandle !== null;
    },

    /** Returns the rideId of the currently active engine, or null */
    getActiveRideId(): string | null {
        return _activeRideId;
    },
};

// ─── Internal Helpers ─────────────────────────────────────────────────────────

async function _scheduleNotification(ride: any) {
    try {
        const serviceLabel = _getServiceLabel(ride.service_type);
        const count = _fireCount + 1;
        const body = `${serviceLabel} • ₹${ride.fare} • ${ride.distance_km}km`;

        await Notifications.scheduleNotificationAsync({
            identifier: NOTIFICATION_ID,   // Fixed ID — replaces the previous notification
            content: {
                title: `🚖 New Booking! (${count})`,
                body,
                data: {
                    type: 'NEW_BOOKING',
                    rideId: ride.id,
                    url: '/(tabs)/bookings',
                    pickupAddress:  ride.pickup_address,
                    dropAddress:    ride.drop_address,
                    fare:           ride.fare,
                    distanceKm:     ride.distance_km,
                    serviceType:    ride.service_type,
                    details:        ride.details,
                },
                categoryIdentifier: NOTIFICATION_CATEGORIES.NEW_BOOKING,
                // @ts-ignore — channelId is Android-only
                channelId: 'bookings',
                sound: 'booking_alert.wav',
            },
            trigger: null,  // Fire immediately
        });

        console.log(`[NotificationEngine] Fired notification #${count} for ride:`, ride.id);
    } catch (err) {
        console.warn('[NotificationEngine] Failed to schedule notification:', err);
    }
}

async function _cancelNotification() {
    try {
        await Notifications.dismissNotificationAsync(NOTIFICATION_ID);
    } catch {
        // Not critical if this fails
    }
}

function _getServiceLabel(serviceType?: string): string {
    const map: Record<string, string> = {
        taxi_bike:     'Bike Taxi',
        taxi_auto:     'Auto',
        taxi_car:      'Cab',
        log_bike:      'Bike Delivery',
        log_mini_truck:'Mini Truck',
        log_truck:     'Truck',
        parcel:        'Parcel',
        bike_taxi:     'Bike Taxi',
    };
    return map[serviceType ?? ''] ?? 'Ride Request';
}
