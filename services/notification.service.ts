import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const IS_EXPO_GO = Constants.appOwnership === 'expo';

// ─── Notification Categories ─────────────────────────────────────────────────
export const NOTIFICATION_CATEGORIES = {
    NEW_BOOKING: 'new_booking',
};

export const NOTIFICATION_ACTIONS = {
    ACCEPT: 'accept_ride',
    DECLINE: 'decline_ride',
};

// FCM token storage key
export const FCM_TOKEN_KEY = 'driver_fcm_token';

// ─── Service ──────────────────────────────────────────────────────────────────
export class NotificationService {
    static async init() {
        await this.requestPermissions();

        // Notification handler: controls how notifications behave when app is FOREGROUND
        // When app is background/killed, the OS handles display using the notification payload.
        Notifications.setNotificationHandler({
            handleNotification: async (notification) => {
                const data = notification.request.content.data as any;
                const isBooking = data?.type === 'NEW_BOOKING';
                return {
                    shouldShowBanner: !isBooking, // Don't show banner — we show GlobalRideAlertModal instead
                    shouldShowList: true,
                    shouldPlaySound: !isBooking,  // Don't play sound in foreground — modal handles it
                    shouldSetBadge: false,
                    priority: Notifications.AndroidNotificationPriority.MAX,
                } as Notifications.NotificationBehavior;
            },
        });

        if (Platform.OS !== 'web') {
            await Notifications.setNotificationCategoryAsync(NOTIFICATION_CATEGORIES.NEW_BOOKING, [
                {
                    identifier: NOTIFICATION_ACTIONS.ACCEPT,
                    buttonTitle: '✅ Accept',
                    options: { opensAppToForeground: true },
                },
                {
                    identifier: NOTIFICATION_ACTIONS.DECLINE,
                    buttonTitle: '❌ Decline',
                    options: { opensAppToForeground: false },
                },
            ]);
        }

        // Register background notification handler for FCM data messages
        if (Platform.OS === 'android') {
            try {
                const { BACKGROUND_NOTIFICATION_TASK } = await import('./background-task');
                await Notifications.registerTaskAsync(BACKGROUND_NOTIFICATION_TASK);
                console.log('[NotificationService] Background task registered');
            } catch (err) {
                console.warn('[NotificationService] Failed to register background task:', err);
            }
        }

        await this.scheduleDailyReminders();
    }

    // ─── Permission + Channel Setup ───────────────────────────────────────────
    static async requestPermissions(): Promise<boolean> {
        if (Platform.OS === 'web') return false;

        if (IS_EXPO_GO) {
            // In Expo Go, local notifications still work
            await this.createAndroidChannels();
            return true;
        }

        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        let finalStatus = existingStatus;

        if (existingStatus !== 'granted') {
            const { status } = await Notifications.requestPermissionsAsync();
            finalStatus = status;
        }

        if (finalStatus !== 'granted') {
            console.warn('[NotificationService] Permission not granted');
            return false;
        }

        await this.createAndroidChannels();
        return true;
    }

    static async createAndroidChannels() {
        if (Platform.OS !== 'android') return;

        // Default channel
        await Notifications.setNotificationChannelAsync('default', {
            name: 'General',
            importance: Notifications.AndroidImportance.DEFAULT,
            vibrationPattern: [0, 250, 250, 250],
        });

        // Bookings channel — HIGH importance for heads-up + lock screen + sound
        await Notifications.setNotificationChannelAsync('bookings', {
            name: 'Booking Alerts',
            importance: Notifications.AndroidImportance.MAX,
            sound: 'booking_alert.wav',       // Must be in assets/sounds and listed in app.json
            vibrationPattern: [0, 500, 200, 500, 200, 500],
            lightColor: '#1565C0',
            lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
            bypassDnd: true,                   // Ring even in DND mode (like alarms)
            enableLights: true,
            showBadge: true,
        });
    }

    // ─── Register + Store FCM Push Token ─────────────────────────────────────
    /**
     * Call this after login. Returns the Expo push token string,
     * or null if unavailable (Expo Go, simulator, etc).
     * 
     * IMPORTANT: You must save the returned token to your `drivers` table
     * in the `fcm_token` column so the Edge Function can use it.
     */
    static async registerForPushNotifications(): Promise<string | null> {
        if (IS_EXPO_GO || Platform.OS === 'web') {
            console.log('[NotificationService] Push tokens not available in Expo Go/web');
            return null;
        }

        try {
            const granted = await this.requestPermissions();
            if (!granted) return null;

            // getDevicePushTokenAsync returns the RAW FCM registration token.
            // This is what FCM HTTP v1 API expects. Do NOT use getExpoPushTokenAsync
            // (that returns an Expo relay token which only works with Expo's push gateway,
            // NOT when sending directly from our Edge Function to FCM).
            const tokenData = await Notifications.getDevicePushTokenAsync();
            const token = tokenData.data as string;

            // Cache locally
            await SecureStore.setItemAsync(FCM_TOKEN_KEY, token);
            console.log('[NotificationService] Native FCM token obtained (length:', token.length, ')');
            return token;
        } catch (err) {
            console.error('[NotificationService] Failed to get push token:', err);
            return null;
        }
    }

    // ─── Local Notifications (used as fallback when app is foreground) ────────
    static async notifyRideStatus(title: string, body: string, rideId?: string) {
        await Notifications.scheduleNotificationAsync({
            content: {
                title,
                body,
                data: { url: rideId ? `/active-ride/${rideId}` : '/(tabs)/history' },
            },
            trigger: null,
        });
    }

    /**
     * This is only called as a LOCAL notification fallback when the app is in foreground
     * and realtime fires. When app is background/killed, FCM sends the push directly.
     * We suppress the banner in foreground (handled by GlobalRideAlertModal) so this
     * mostly serves the notification tray record.
     */
    static async notifyNewBooking(ride: any) {
        await Notifications.scheduleNotificationAsync({
            content: {
                title: '🚖 New Booking Request!',
                body: `${(ride.service_type ?? '').replace('_', ' ').toUpperCase()} • ₹${ride.fare} • ${ride.distance_km}km`,
                data: {
                    rideId: ride.id,
                    url: '/(tabs)/bookings',
                    type: 'NEW_BOOKING',
                },
                categoryIdentifier: NOTIFICATION_CATEGORIES.NEW_BOOKING,
                sound: 'booking_alert.wav',
                // @ts-ignore
                channelId: 'bookings',
            },
            trigger: null,
        });
    }

    // ─── Scheduled Reminders ──────────────────────────────────────────────────
    static async scheduleDailyReminders() {
        await Notifications.cancelAllScheduledNotificationsAsync();

        const times = [
            { hour: 7, minute: 0 },
            { hour: 12, minute: 0 },
            { hour: 16, minute: 0 },
        ];

        for (const time of times) {
            await Notifications.scheduleNotificationAsync({
                content: {
                    title: 'Ready to earn? 💰',
                    body: 'Go online now to start receiving booking requests!',
                    data: { url: '/(tabs)/bookings' },
                },
                trigger: {
                    type: Notifications.SchedulableTriggerInputTypes.DAILY,
                    hour: time.hour,
                    minute: time.minute,
                } as Notifications.DailyTriggerInput,
            });
        }
    }
}