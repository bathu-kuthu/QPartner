import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import * as TaskManager from 'expo-task-manager';

/**
 * BACKGROUND_NOTIFICATION_TASK
 * 
 * This task runs when a FCM data message (or notification with data) arrives
 * while the app is killed or in the background.
 * 
 * On Android, FCM delivers a notification with sound+vibration automatically
 * via the 'bookings' notification channel. When the driver taps the notification,
 * the app opens and our notification response listener in _layout.tsx fires.
 * 
 * This task handles the edge case where we want to do additional logic on
 * FCM data arrival (e.g., dismissing stale rides, tracking ride IDs).
 * 
 * HOW THIS WORKS END-TO-END:
 * 1. Customer creates a ride → Supabase triggers DB webhook
 * 2. Webhook calls our Edge Function (notify-driver)
 * 3. Edge Function sends FCM push to eligible nearby online drivers
 * 4. Android OS receives FCM → displays heads-up notification with sound/vibration
 *    using the 'bookings' channel (even on locked/sleeping phone)
 * 5. If driver taps notification → app opens → _layout.tsx response listener fires
 *    → GlobalRideAlertModal shown
 * 6. If app was in foreground → realtime subscription in _layout.tsx shows modal
 */

export const BACKGROUND_RIDE_TASK = 'BACKGROUND_RIDE_POLLING'; // Keep for compat

export const BACKGROUND_NOTIFICATION_TASK = 'BACKGROUND_NOTIFICATION_TASK';

const DRIVER_ID_KEY = 'driver_id';
const INFORMED_RIDES_KEY = 'informed_rides';

// Store driver id for background access
export async function setBackgroundTaskData(driverId: string, serviceTypes: string[]) {
    await SecureStore.setItemAsync(DRIVER_ID_KEY, driverId);
    await SecureStore.setItemAsync('driver_service_types', JSON.stringify(serviceTypes));
}

// ─── Background Notification Task ─────────────────────────────────────────────
// This fires when a FCM notification/data message arrives while app is background/killed
TaskManager.defineTask(BACKGROUND_NOTIFICATION_TASK, async ({ data, error }: any) => {
    if (error) {
        console.error('[BG Task] Background notification task error:', error);
        return;
    }

    try {
        // data.notification is the raw Expo notification object
        const notificationData =
            data?.notification?.request?.content?.data ||
            data?.notification?.data ||
            {};

        console.log('[BG Task] Background FCM received, type:', notificationData.type);

        // Only process NEW_BOOKING payloads
        if (notificationData.type !== 'NEW_BOOKING' || !notificationData.rideId) {
            return;
        }

        const driverId = await SecureStore.getItemAsync(DRIVER_ID_KEY);
        if (!driverId) {
            console.log('[BG Task] No driver ID stored — driver logged out');
            return;
        }

        // Deduplication: don't notify multiple times for same ride
        const informedRidesStr = await SecureStore.getItemAsync(INFORMED_RIDES_KEY) || '[]';
        const informedRides: string[] = JSON.parse(informedRidesStr);

        if (informedRides.includes(notificationData.rideId)) {
            console.log('[BG Task] Already notified for ride:', notificationData.rideId);
            return;
        }

        // Track this ride as notified
        informedRides.push(notificationData.rideId);
        const updated = informedRides.slice(-20); // Keep last 20
        await SecureStore.setItemAsync(INFORMED_RIDES_KEY, JSON.stringify(updated));

        // The FCM notification itself (sent from Edge Function) already causes
        // Android to show a heads-up notification with sound + vibration via the
        // 'bookings' channel. We don't need to schedule another local notification here.
        //
        // However, if FCM only sent a DATA message (no notification block), we schedule
        // a local notification manually to ensure the driver sees it:
        const hasNotificationBlock = !!data?.notification?.request?.content?.title;
        if (!hasNotificationBlock) {
            await Notifications.scheduleNotificationAsync({
                content: {
                    title: '🚖 New Booking Request!',
                    body: `${(notificationData.serviceType ?? '').replace('_', ' ').toUpperCase()} • ₹${notificationData.fare} • ${notificationData.distanceKm}km`,
                    data: {
                        type: 'NEW_BOOKING',
                        rideId: notificationData.rideId,
                        url: '/(tabs)/bookings',
                        // Pass full ride data so modal can show it without a DB fetch
                        pickupAddress: notificationData.pickupAddress,
                        dropAddress: notificationData.dropAddress,
                        fare: notificationData.fare,
                        distanceKm: notificationData.distanceKm,
                        serviceType: notificationData.serviceType,
                        details: notificationData.details,
                    },
                    sound: 'booking_alert.wav',
                    // @ts-ignore
                    channelId: 'bookings',
                },
                trigger: null,
            });
        }

        console.log('[BG Task] Processed ride notification:', notificationData.rideId);

    } catch (err) {
        console.error('[BG Task] Error processing background notification:', err);
    }
});

// Keep the location-based task definition for backward compat (it's registered in
// background-location flow). It's a no-op now since we rely on FCM.
TaskManager.defineTask(BACKGROUND_RIDE_TASK, async ({ data, error }: any) => {
    if (error) {
        console.error('[BG Location Task] Error:', error);
        return;
    }
    // Location updates used only to keep driver position fresh — no ride polling here
    // Ride notifications are now driven by FCM push from the Edge Function
});