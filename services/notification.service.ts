import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { router } from 'expo-router';

// True when running inside Expo Go (push tokens not supported in SDK 53+)
const IS_EXPO_GO = Constants.appOwnership === 'expo';

// ─── Notification Categories ────────────────────────────────────────────────
export const NOTIFICATION_CATEGORIES = {
    NEW_BOOKING: 'new_booking',
};

export const NOTIFICATION_ACTIONS = {
    ACCEPT: 'accept_ride',
};

// ─── Service ────────────────────────────────────────────────────────────────
export class NotificationService {
    static async init() {
        // 1. Request permissions
        await this.requestPermissions();

        // 2. Set notification handler
        Notifications.setNotificationHandler({
            handleNotification: async () => ({
                shouldShowAlert: true,
                shouldPlaySound: true,
                shouldSetBadge: true,
                priority: Notifications.AndroidNotificationPriority.MAX,
            } as Notifications.NotificationBehavior),
        });

        // 3. Define Categories (Actions)
        if (Platform.OS !== 'web') {
            await Notifications.setNotificationCategoryAsync(NOTIFICATION_CATEGORIES.NEW_BOOKING, [
                {
                    identifier: NOTIFICATION_ACTIONS.ACCEPT,
                    buttonTitle: '✅ Accept Ride',
                    options: { opensAppToForeground: true },
                },
            ]);
        }

        // 4. Schedule daily reminders
        await this.scheduleDailyReminders();
    }

    static async requestPermissions() {
        if (Platform.OS === 'web') return;

        // Skip push-token permission flow in Expo Go (not supported in SDK 53+)
        // Local notifications (schedule/show) still work fine.
        if (!IS_EXPO_GO) {
            const { status: existingStatus } = await Notifications.getPermissionsAsync();
            let finalStatus = existingStatus;
            if (existingStatus !== 'granted') {
                const { status } = await Notifications.requestPermissionsAsync();
                finalStatus = status;
            }
            if (finalStatus !== 'granted') {
                console.log('Push notification permission not granted.');
                return;
            }
        }

        if (Platform.OS === 'android') {
            await Notifications.setNotificationChannelAsync('default', {
                name: 'default',
                importance: Notifications.AndroidImportance.MAX,
                vibrationPattern: [0, 250, 250, 250],
                lightColor: '#FF231F7C',
            });

            await Notifications.setNotificationChannelAsync('bookings', {
                name: 'Booking Alerts',
                importance: Notifications.AndroidImportance.MAX,
                sound: 'default',
                vibrationPattern: [0, 500, 200, 500],
            });
        }
    }

    // ─── Scheduled Notifications ─────────────────────────────────────────────
    static async scheduleDailyReminders() {
        // Clear old ones to prevent duplicates
        await Notifications.cancelAllScheduledNotificationsAsync();

        const times = [
            { hour: 7, minute: 0 },
            { hour: 12, minute: 0 },
            { hour: 16, minute: 0 }, // 4 PM
        ];

        for (const time of times) {
            await Notifications.scheduleNotificationAsync({
                content: {
                    title: "Ready to earn? 💰",
                    body: "Go online now to start receiving booking requests!",
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

    // ─── Event Notifications ─────────────────────────────────────────────────
    static async notifyRideStatus(title: string, body: string, rideId?: string) {
        await Notifications.scheduleNotificationAsync({
            content: {
                title,
                body,
                data: { url: rideId ? `/active-ride/${rideId}` : '/(tabs)/history' },
            },
            trigger: null, // immediate
        });
    }

    static async notifyNewBooking(ride: any) {
        await Notifications.scheduleNotificationAsync({
            content: {
                title: "🚖 New Booking Request!",
                body: `${ride.service_type.replace('_', ' ').toUpperCase()} • ₹${ride.fare} • ${ride.distance_km}km`,
                data: { 
                    rideId: ride.id,
                    url: `/(tabs)/bookings`,
                    type: 'NEW_BOOKING'
                },
                categoryIdentifier: NOTIFICATION_CATEGORIES.NEW_BOOKING,
                sound: true,
            },
            trigger: null,
        });
    }
}
