import * as Notifications from 'expo-notifications';
import { AppState, AppStateStatus, Platform } from 'react-native';
import {
    buildIncomingOrderPayload,
    INCOMING_ORDER_NOTIFICATION_ID,
    NOTIFICATION_CATEGORIES,
} from './notification.service';

/**
 * NotificationEngine
 *
 * Manages incoming order alert lifecycle across Transport Rides, Food Orders,
 * and Grocery Orders without generating duplicate notifications for the same order.
 *
 * Key Guarantees:
 * 1. Exactly one system notification per unique logical order assignment event.
 * 2. Deduplication across realtime, polling, and push channels via `_handledOrderIds`
 *    and `_notifiedOrderIds`.
 * 3. Automatic cleanup & shade dismissal when an order is accepted, declined,
 *    cancelled, claimed by another partner, or expires after 30s.
 * 4. If an order arrives in the foreground (where the in-app modal handles ringing)
 *    and the partner minimizes the app before responding, surfaces the notification
 *    in the system tray once on background transition.
 */

const ORDER_OFFER_TTL_MS = 30_000; // Matches 30s response deadline in GlobalRideAlertModal / GlobalOrderAlertModal
const MAX_TRACKED_IDS = 100;

let _timeoutHandle: ReturnType<typeof setTimeout> | null = null;
let _appStateSub: { remove: () => void } | null = null;
let _activeOrderId: string | null = null;
let _activeDomain: 'transport' | 'food' | 'grocery' = 'transport';
let _activeRecord: any = null;
let _surfacedInBackground = false;

// Tracks orders already notified or explicitly declined/accepted to prevent duplicate alerts
const _notifiedOrderIds = new Set<string>();
const _handledOrderIds = new Set<string>();

function _addBounded(set: Set<string>, id: string) {
    set.add(id);
    if (set.size > MAX_TRACKED_IDS) {
        const oldest = set.values().next().value;
        if (oldest) set.delete(oldest);
    }
}

export const NotificationEngine = {
    /**
     * Start alert lifecycle for a transport ride.
     */
    start(ride: any): void {
        NotificationEngine.startWorkItem(ride, 'transport');
    },

    /**
     * Start alert lifecycle for a Food or Grocery order.
     */
    startOrder(order: any, domain: 'food' | 'grocery'): void {
        NotificationEngine.startWorkItem(order, domain);
    },

    /**
     * Unified entry point for starting an incoming order alert across all domains.
     */
    startWorkItem(record: any, domain: 'transport' | 'food' | 'grocery' = 'transport'): void {
        if (Platform.OS === 'web') return;
        const orderId = record?.id ? String(record.id) : null;
        if (!orderId) return;

        // Prevent re-alerting an order that was already accepted, declined, or expired
        if (_handledOrderIds.has(orderId)) {
            return;
        }

        // Already active for this exact order — no-op (prevents duplicate alerts)
        if (_activeOrderId === orderId) {
            return;
        }

        // Stop any previous order alert first
        NotificationEngine.stop();

        _activeOrderId = orderId;
        _activeDomain = domain;
        _activeRecord = record;
        _surfacedInBackground = AppState.currentState !== 'active';

        // Only fire the system notification if we haven't already notified for this orderId
        if (!_notifiedOrderIds.has(orderId)) {
            _addBounded(_notifiedOrderIds, orderId);
            _scheduleIncomingNotification(record, domain);
        }

        // Sync incoming order immediately to Native Floating Order Receiver Overlay Card
        try {
            const { NativeBridgeService } = require('./native-bridge.service');
            if (NativeBridgeService.isAndroid && AppState.currentState !== 'active') {
                const payload = buildIncomingOrderPayload(record, domain);
                NativeBridgeService.updateFloatingWidgetData(
                    JSON.stringify({
                        status: 'order',
                        orderId,
                        domain,
                        serviceType: payload.data.serviceType,
                        pickup: payload.data.pickupAddress,
                        drop: payload.data.dropAddress,
                        fare: `₹${payload.data.fare}`,
                        distance: payload.data.distanceKm ? `${payload.data.distanceKm} km` : '',
                    })
                );
            }
        } catch {
            // Ignore
        }

        // If the app started in foreground (modal shown, banner suppressed) and the partner
        // minimizes the app while the countdown is still active, surface the system banner & floating overlay card once.
        _appStateSub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
            if (
                nextState !== 'active' &&
                !_surfacedInBackground &&
                _activeOrderId === orderId &&
                _activeRecord
            ) {
                _surfacedInBackground = true;
                _scheduleIncomingNotification(_activeRecord, _activeDomain);
                try {
                    const { NativeBridgeService } = require('./native-bridge.service');
                    if (NativeBridgeService.isAndroid) {
                        const payload = buildIncomingOrderPayload(_activeRecord, _activeDomain);
                        NativeBridgeService.updateFloatingWidgetData(
                            JSON.stringify({
                                status: 'order',
                                orderId,
                                domain: _activeDomain,
                                serviceType: payload.data.serviceType,
                                pickup: payload.data.pickupAddress,
                                drop: payload.data.dropAddress,
                                fare: `₹${payload.data.fare}`,
                                distance: payload.data.distanceKm ? `${payload.data.distanceKm} km` : '',
                            })
                        );
                    }
                } catch {
                    // Ignore
                }
            }
        });

        // Auto-expire after the 30s response deadline
        _timeoutHandle = setTimeout(() => {
            console.log('[NotificationEngine] Order offer deadline reached — auto-stopping:', orderId);
            NotificationEngine.markHandled(orderId);
            NotificationEngine.stop(orderId);
        }, ORDER_OFFER_TTL_MS);
    },

    /**
     * Stop the engine and dismiss the active order notification from the Android shade.
     */
    stop(orderId?: string): void {
        if (orderId && _activeOrderId && orderId !== _activeOrderId) {
            return;
        }

        if (_timeoutHandle !== null) {
            clearTimeout(_timeoutHandle);
            _timeoutHandle = null;
        }

        if (_appStateSub !== null) {
            _appStateSub.remove();
            _appStateSub = null;
        }

        if (_activeOrderId) {
            _cancelNotification();
        }

        _activeOrderId = null;
        _activeRecord = null;
        _surfacedInBackground = false;
    },

    /**
     * Marks an order ID as handled (accepted, declined, or expired) so it will not
     * trigger duplicate alerts again.
     */
    markHandled(orderId?: string | null): void {
        if (!orderId) return;
        const cleanId = String(orderId);
        _addBounded(_handledOrderIds, cleanId);
        _addBounded(_notifiedOrderIds, cleanId);
        try {
            const { NativeBridgeService } = require('./native-bridge.service');
            NativeBridgeService.markOrderHandled(cleanId);
        } catch {
            // Ignore
        }
    },

    /**
     * Checks if an order ID has already been accepted, declined, or expired in this session.
     */
    isHandled(orderId?: string | null): boolean {
        if (!orderId) return false;
        return _handledOrderIds.has(String(orderId));
    },

    /**
     * Checks if a notification has already been dispatched for this order ID.
     */
    wasNotified(orderId?: string | null): boolean {
        if (!orderId) return false;
        return _notifiedOrderIds.has(String(orderId));
    },

    /** Returns true if an incoming order alert is currently active */
    isRunning(): boolean {
        return _activeOrderId !== null;
    },

    /** Returns the ID of the currently active incoming ride/order, or null */
    getActiveRideId(): string | null {
        return _activeOrderId;
    },
};

// ─── Internal Helpers ─────────────────────────────────────────────────────────

async function _scheduleIncomingNotification(
    record: any,
    domain: 'transport' | 'food' | 'grocery'
) {
    try {
        const payload = buildIncomingOrderPayload(record, domain);

        await Notifications.scheduleNotificationAsync({
            identifier: INCOMING_ORDER_NOTIFICATION_ID,
            content: {
                title: payload.title,
                body: payload.body,
                subtitle: payload.subtitle,
                data: payload.data,
                categoryIdentifier: NOTIFICATION_CATEGORIES.NEW_BOOKING,
                color: '#1565C0',
                // @ts-ignore — channelId is Android-only
                channelId: 'bookings',
                sound: 'booking_alert.wav',
            },
            trigger: null,
        });

        console.log(`[NotificationEngine] Dispatched incoming ${domain} alert for order:`, record.id);
    } catch (err) {
        console.warn('[NotificationEngine] Failed to schedule notification:', err);
    }
}

async function _cancelNotification() {
    try {
        await Notifications.dismissNotificationAsync(INCOMING_ORDER_NOTIFICATION_ID);
    } catch {
        // Non-critical if notification was already dismissed
    }
}
