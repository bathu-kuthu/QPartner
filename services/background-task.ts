import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import {
    buildIncomingOrderPayload,
    INCOMING_ORDER_NOTIFICATION_ID,
    NOTIFICATION_CATEGORIES,
    ONLINE_STATUS_NOTIFICATION_ID,
} from './notification.service';

let TaskManager: typeof import('expo-task-manager') | null = null;
try {
    TaskManager = require('expo-task-manager');
} catch {
    TaskManager = null;
}

function safeDefineTask(taskName: string, taskExecutor: (body: any) => Promise<void>) {
    try {
        if (TaskManager && typeof TaskManager.defineTask === 'function') {
            TaskManager.defineTask(taskName, taskExecutor);
        }
    } catch (err) {
        console.warn(`[TaskManager] Could not define task ${taskName}:`, err);
    }
}

export const BACKGROUND_RIDE_TASK = 'BACKGROUND_RIDE_POLLING';
export const BACKGROUND_NOTIFICATION_TASK = 'BACKGROUND_NOTIFICATION_TASK';

const DRIVER_ID_KEY = 'driver_id';
const DRIVER_SERVICES_KEY = 'driver_service_types';
const DRIVER_IS_BIKE_KEY = 'driver_is_bike';
const DRIVER_ONLINE_KEY = 'driver_is_online';
const INFORMED_RIDES_KEY = 'informed_rides';

let _lastBgLocationSyncMs = 0;
let _lastInformedOrderId: string | null = null;

/**
 * Persist driver metadata in SecureStore for background tasks.
 */
export async function setBackgroundTaskData(
    driverId: string,
    serviceTypes: string[],
    isBike: boolean = false,
    isOnline: boolean = true
) {
    try {
        await SecureStore.setItemAsync(DRIVER_ID_KEY, driverId);
        await SecureStore.setItemAsync(DRIVER_SERVICES_KEY, JSON.stringify(serviceTypes));
        await SecureStore.setItemAsync(DRIVER_IS_BIKE_KEY, isBike ? 'true' : 'false');
        await SecureStore.setItemAsync(DRIVER_ONLINE_KEY, isOnline ? 'true' : 'false');
    } catch (err) {
        console.warn('[BG Task] Could not save background task metadata:', err);
    }
}

export async function setBackgroundOnlineState(isOnline: boolean) {
    try {
        await SecureStore.setItemAsync(DRIVER_ONLINE_KEY, isOnline ? 'true' : 'false');
    } catch {
        // Ignore on unsupported platforms
    }
}

export async function clearBackgroundTaskData() {
    try {
        await SecureStore.deleteItemAsync(DRIVER_ID_KEY);
        await SecureStore.deleteItemAsync(DRIVER_SERVICES_KEY);
        await SecureStore.deleteItemAsync(DRIVER_IS_BIKE_KEY);
        await SecureStore.setItemAsync(DRIVER_ONLINE_KEY, 'false');
    } catch {
        // Ignore on unsupported platforms
    }
}

/**
 * Records an order/ride ID in SecureStore deduplication list so neither
 * background polling nor background FCM fires a duplicate alert for it.
 */
export async function markOrderInformedInBackground(orderId: string): Promise<boolean> {
    if (!orderId) return false;
    try {
        const cleanId = String(orderId);
        const informedStr = (await SecureStore.getItemAsync(INFORMED_RIDES_KEY)) || '[]';
        const informed: string[] = JSON.parse(informedStr);
        if (informed.includes(cleanId)) {
            return false; // Already informed
        }
        informed.push(cleanId);
        const updated = informed.slice(-50);
        await SecureStore.setItemAsync(INFORMED_RIDES_KEY, JSON.stringify(updated));
        return true; // Newly marked
    } catch {
        return true;
    }
}

// ─── Haversine distance helper (km) ───────────────────────────────────────────
function _haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
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

// ─── 1. Background FCM Notification Task ──────────────────────────────────────
// Fires when an FCM notification/data message arrives while app is backgrounded or killed.
safeDefineTask(BACKGROUND_NOTIFICATION_TASK, async ({ data, error }: any) => {
    if (error) {
        console.error('[BG Task] Background notification task error:', error);
        return;
    }

    try {
        const notificationData =
            data?.notification?.request?.content?.data ||
            data?.notification?.data ||
            data?.data ||
            {};

        const msgType = notificationData.type;
        const isValidOrderEvent =
            msgType === 'NEW_BOOKING' ||
            msgType === 'NEW_FOOD_ORDER' ||
            msgType === 'NEW_GROCERY_ORDER';

        const targetId = notificationData.rideId || notificationData.orderId;
        if (!isValidOrderEvent || !targetId) {
            return;
        }

        const driverId = await SecureStore.getItemAsync(DRIVER_ID_KEY);
        const isOnlineStr = await SecureStore.getItemAsync(DRIVER_ONLINE_KEY);
        if (!driverId || isOnlineStr === 'false') {
            console.log('[BG Task] Driver logged out or offline — ignoring push');
            return;
        }

        // Deduplication: ensure one logical order event never generates repeated notifications
        const isNew = await markOrderInformedInBackground(String(targetId));
        if (!isNew) {
            console.log('[BG Task] Already notified for order:', targetId);
            return;
        }

        _lastInformedOrderId = String(targetId);

        const { NativeBridgeService } = require('@/services/native-bridge.service');
        if (NativeBridgeService.isAndroid) {
            NativeBridgeService.updateFloatingWidgetData(
                JSON.stringify({
                    status: 'order',
                    pickup: notificationData.pickupAddress || 'New Request',
                    fare: `₹${notificationData.fare || ''}`,
                })
            );
        }

        // If the FCM push already contained a notification block, Android OS displayed it directly
        // via the 'bookings' channel. If it arrived as a data-only push, schedule the local high-priority alert now.
        const hasNotificationBlock = Boolean(
            data?.notification?.request?.content?.title || data?.notification?.title
        );

        if (!hasNotificationBlock) {
            const domain: 'transport' | 'food' | 'grocery' =
                notificationData.domain ||
                (msgType === 'NEW_FOOD_ORDER'
                    ? 'food'
                    : msgType === 'NEW_GROCERY_ORDER'
                      ? 'grocery'
                      : 'transport');

            const syntheticRecord = {
                id: targetId,
                service_type: notificationData.serviceType || domain,
                fare: notificationData.fare,
                delivery_fee: notificationData.fare,
                distance_km: notificationData.distanceKm,
                pickup_address: notificationData.pickupAddress,
                drop_address: notificationData.dropAddress,
                delivery_address: notificationData.dropAddress,
                store: { name: notificationData.pickupAddress, address: '' },
                details: notificationData.details,
            };

            const payload = buildIncomingOrderPayload(syntheticRecord, domain);

            await Notifications.scheduleNotificationAsync({
                identifier: INCOMING_ORDER_NOTIFICATION_ID,
                content: {
                    title: payload.title,
                    body: payload.body,
                    subtitle: payload.subtitle,
                    data: payload.data,
                    categoryIdentifier: NOTIFICATION_CATEGORIES.NEW_BOOKING,
                    color: '#1565C0',
                    sound: 'booking_alert.wav',
                    // @ts-ignore
                    channelId: 'bookings',
                },
                trigger: null,
            });
        }

        console.log('[BG Task] Processed background order alert:', targetId);
    } catch (err) {
        console.error('[BG Task] Error processing background notification:', err);
    }
});

// ─── 2. Foreground Service Location & Background Order Polling Task ───────────
// Runs every 5 seconds inside the Android Foreground Service while the partner is ONLINE.
safeDefineTask(BACKGROUND_RIDE_TASK, async ({ data, error }: any) => {
    if (error) {
        console.error('[BG Location Task] Error:', error);
        return;
    }

    try {
        const driverId = await SecureStore.getItemAsync(DRIVER_ID_KEY);
        const isOnlineStr = await SecureStore.getItemAsync(DRIVER_ONLINE_KEY);
        const typesStr = await SecureStore.getItemAsync(DRIVER_SERVICES_KEY);
        const isBikeStr = await SecureStore.getItemAsync(DRIVER_IS_BIKE_KEY);

        if (!driverId || isOnlineStr === 'false' || !typesStr) {
            return;
        }

        const serviceTypes: string[] = JSON.parse(typesStr);
        const isBike = isBikeStr === 'true' || serviceTypes.some((s) => s.includes('bike') || s === 'parcel');

        const locations = data?.locations;
        const latestLoc = locations && locations.length > 0 ? locations[locations.length - 1] : null;
        const lat: number | undefined = latestLoc?.coords?.latitude;
        const lng: number | undefined = latestLoc?.coords?.longitude;

        const { supabase } = require('@/config/supabase');
        const { NativeBridgeService } = require('@/services/native-bridge.service');

        // 1. Verify authoritative driver online & eligibility state in backend
        const { data: driverRow } = await supabase
            .from('users')
            .select('id, is_online, rider_status, current_lat, current_lng')
            .eq('id', driverId)
            .maybeSingle();

        if (
            !driverRow ||
            !driverRow.is_online ||
            (driverRow.rider_status ?? '').trim().toLowerCase() !== 'verified'
        ) {
            // Backend says partner is offline or no longer eligible: stop foreground service immediately
            await SecureStore.setItemAsync(DRIVER_ONLINE_KEY, 'false');
            try {
                const started = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_RIDE_TASK);
                if (started) {
                    await Location.stopLocationUpdatesAsync(BACKGROUND_RIDE_TASK);
                }
            } catch {
                // Ignore
            }
            try {
                await Notifications.dismissNotificationAsync(ONLINE_STATUS_NOTIFICATION_ID);
                await Notifications.dismissNotificationAsync(INCOMING_ORDER_NOTIFICATION_ID);
            } catch {
                // Ignore
            }
            return;
        }

        const effectiveLat = lat ?? driverRow.current_lat;
        const effectiveLng = lng ?? driverRow.current_lng;

        // 2. Sync fresh GPS coordinates to Supabase (throttled to every 15s)
        const now = Date.now();
        if (lat != null && lng != null && now - _lastBgLocationSyncMs >= 15_000) {
            _lastBgLocationSyncMs = now;
            supabase
                .from('users')
                .update({ current_lat: lat, current_lng: lng })
                .eq('id', driverId)
                .then(() => {})
                .catch(() => {});
        }

        // 3. Check if partner already has an active ride
        const { data: activeRide } = await supabase
            .from('rides')
            .select('id, fare, pickup_address')
            .eq('driver_id', driverId)
            .in('status', ['accepted', 'picked_up', 'on_ride'])
            .limit(1)
            .maybeSingle();

        if (activeRide) {
            if (NativeBridgeService.isAndroid) {
                NativeBridgeService.updateFloatingWidgetData(
                    JSON.stringify({
                        status: 'order',
                        pickup: activeRide.pickup_address,
                        fare: `₹${activeRide.fare}`,
                    })
                );
            }
            return;
        }

        // 4. Poll for eligible unassigned Transport Rides
        let candidateItem: { domain: 'transport' | 'food' | 'grocery'; record: any } | null = null;

        if (serviceTypes.length > 0) {
            const { data: pendingRides } = await supabase
                .from('rides')
                .select(
                    'id, service_type, fare, distance_km, pickup_address, drop_address, pickup_location, details, created_at'
                )
                .eq('status', 'pending')
                .is('driver_id', null)
                .in('service_type', serviceTypes)
                .order('created_at', { ascending: false })
                .limit(10);

            if (pendingRides && pendingRides.length > 0) {
                const sortedRides = [...pendingRides];
                if (effectiveLat != null && effectiveLng != null) {
                    sortedRides.sort((a: any, b: any) => {
                        const dA = _haversineKm(
                            effectiveLat,
                            effectiveLng,
                            a.pickup_location?.latitude ?? 0,
                            a.pickup_location?.longitude ?? 0
                        );
                        const dB = _haversineKm(
                            effectiveLat,
                            effectiveLng,
                            b.pickup_location?.latitude ?? 0,
                            b.pickup_location?.longitude ?? 0
                        );
                        return dA - dB;
                    });
                }
                candidateItem = { domain: 'transport', record: sortedRides[0] };
            }
        }

        // 5. If no transport ride and driver is a bike partner, check Food & Grocery orders
        if (!candidateItem && isBike) {
            const { data: pendingOrders } = await supabase
                .from('orders')
                .select(
                    'id, store_type, delivery_fee, total, subtotal, delivery_address, distance_km, store_lat, store_lng, created_at, store:stores(name, address, latitude, longitude)'
                )
                .eq('status', 'preparing')
                .in('store_type', ['food', 'grocery'])
                .order('created_at', { ascending: false })
                .limit(10);

            if (pendingOrders && pendingOrders.length > 0) {
                const sortedOrders = [...pendingOrders];
                if (effectiveLat != null && effectiveLng != null) {
                    sortedOrders.sort((a: any, b: any) => {
                        const sLatA = a.store_lat ?? a.store?.latitude ?? 0;
                        const sLngA = a.store_lng ?? a.store?.longitude ?? 0;
                        const sLatB = b.store_lat ?? b.store?.latitude ?? 0;
                        const sLngB = b.store_lng ?? b.store?.longitude ?? 0;
                        const dA = sLatA && sLngA ? _haversineKm(effectiveLat, effectiveLng, sLatA, sLngA) : 999;
                        const dB = sLatB && sLngB ? _haversineKm(effectiveLat, effectiveLng, sLatB, sLngB) : 999;
                        return dA - dB;
                    });
                }
                const topOrder = sortedOrders[0];
                const orderDomain: 'food' | 'grocery' =
                    topOrder.store_type === 'grocery' ? 'grocery' : 'food';
                candidateItem = { domain: orderDomain, record: topOrder };
            }
        }

        // 6. Dispatch background notification if a new unassigned order is found
        if (candidateItem) {
            const itemId = String(candidateItem.record.id);

            if (NativeBridgeService.isAndroid) {
                NativeBridgeService.updateFloatingWidgetData(
                    JSON.stringify({
                        status: 'order',
                        pickup:
                            candidateItem.domain === 'transport'
                                ? candidateItem.record.pickup_address
                                : candidateItem.record.store?.name || 'Partner Store',
                        fare: `₹${
                            candidateItem.domain === 'transport'
                                ? candidateItem.record.fare
                                : candidateItem.record.delivery_fee || 35
                        }`,
                    })
                );
            }

            // Deduplicate: only fire notification once per unique order ID
            const isNewlyInformed = await markOrderInformedInBackground(itemId);
            if (isNewlyInformed) {
                _lastInformedOrderId = itemId;
                const payload = buildIncomingOrderPayload(candidateItem.record, candidateItem.domain);

                await Notifications.scheduleNotificationAsync({
                    identifier: INCOMING_ORDER_NOTIFICATION_ID,
                    content: {
                        title: payload.title,
                        body: payload.body,
                        subtitle: payload.subtitle,
                        data: payload.data,
                        categoryIdentifier: NOTIFICATION_CATEGORIES.NEW_BOOKING,
                        color: '#1565C0',
                        sound: 'booking_alert.wav',
                        // @ts-ignore
                        channelId: 'bookings',
                    },
                    trigger: null,
                });
                console.log(`[BG Location Task] Dispatched background ${candidateItem.domain} alert:`, itemId);
            }
        } else {
            // No pending rides or orders available — clear stale incoming alert from shade if any
            if (_lastInformedOrderId) {
                _lastInformedOrderId = null;
                try {
                    await Notifications.dismissNotificationAsync(INCOMING_ORDER_NOTIFICATION_ID);
                } catch {
                    // Ignore
                }
            }

            if (NativeBridgeService.isAndroid) {
                NativeBridgeService.updateFloatingWidgetData(
                    JSON.stringify({
                        status: 'searching',
                    })
                );
            }
        }
    } catch (err) {
        console.error('[BG Location Task] Polling Error:', err);
    }
});
