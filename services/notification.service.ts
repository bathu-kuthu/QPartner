import Constants from 'expo-constants';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { AppState, Platform } from 'react-native';

const IS_EXPO_GO = Constants.appOwnership === 'expo';

// ─── Notification Categories & Identifiers ───────────────────────────────────
export const NOTIFICATION_CATEGORIES = {
    NEW_BOOKING: 'new_booking',
    ONLINE_STATUS: 'online_status_category',
};

export const NOTIFICATION_ACTIONS = {
    ACCEPT: 'accept_ride',
    VIEW: 'view_order',
    DECLINE: 'decline_ride',
};

export const ONLINE_STATUS_NOTIFICATION_ID = 'qpartner_online_status';
export const INCOMING_ORDER_NOTIFICATION_ID = 'continuous_booking_alert';

// FCM token storage key
export const FCM_TOKEN_KEY = 'driver_fcm_token';

// Service label mapping for safe lock-screen display
const SERVICE_LABELS: Record<string, string> = {
    taxi_bike: 'Bike Taxi',
    bike_taxi: 'Bike Taxi',
    taxi_auto: 'Auto',
    taxi_car: 'Cab',
    cab: 'Cab',
    log_cab: 'Cab Logistics',
    log_car: 'Cab Logistics',
    log_bike: 'Bike Delivery',
    log_mini_auto: 'Mini Truck',
    log_mini_truck: 'Mini Truck',
    log_truck: 'Truck',
    parcel: 'Parcel Delivery',
    food: 'Food Delivery',
    grocery: 'Grocery Delivery',
};

export function getSafeServiceLabel(serviceType?: string, domain?: 'transport' | 'food' | 'grocery'): string {
    if (domain === 'food') return 'Food Delivery';
    if (domain === 'grocery') return 'Grocery Delivery';
    return SERVICE_LABELS[(serviceType ?? '').trim().toLowerCase()] ?? 'Delivery Request';
}

/**
 * Builds a privacy-safe, high-visibility incoming order notification payload.
 * Never exposes customer personal information (phone, name, OTP) on lock screen.
 */
export function buildIncomingOrderPayload(
    record: any,
    domain: 'transport' | 'food' | 'grocery' = 'transport'
) {
    const isTransport = domain === 'transport';
    const orderId = String(record?.id ?? '');
    const type =
        domain === 'food'
            ? 'NEW_FOOD_ORDER'
            : domain === 'grocery'
              ? 'NEW_GROCERY_ORDER'
              : 'NEW_BOOKING';

    const serviceType = isTransport ? (record?.service_type ?? 'taxi_bike') : domain;
    const serviceLabel = getSafeServiceLabel(serviceType, domain);

    const earning = isTransport
        ? Number(record?.fare ?? 0)
        : Number(record?.delivery_fee || 35);

    const distanceKm = record?.distance_km != null ? `${record.distance_km} km` : '';

    const rawPickup = isTransport
        ? (record?.pickup_address || 'Pickup Location')
        : (record?.store?.name
            ? `${record.store.name}${record.store.address ? `, ${record.store.address}` : ''}`
            : (record?.store?.address || 'Partner Store Pickup'));

    const rawDrop = isTransport
        ? (record?.drop_address || 'Dropoff Location')
        : (record?.delivery_address || 'Customer Dropoff Area');

    // Truncate addresses for clean notification shade presentation without customer PII
    const pickupSummary = String(rawPickup).slice(0, 60);
    const dropSummary = String(rawDrop).slice(0, 60);

    const metaParts = [
        serviceLabel,
        earning > 0 ? `₹${earning}` : null,
        distanceKm || null,
        'Respond within 30s',
    ].filter(Boolean);

    const title = `New Quickora Order • ${serviceLabel}`;
    const body = `A new delivery request is waiting for your response.\n${metaParts.join(' • ')}\n📍 ${pickupSummary} → 🏁 ${dropSummary}`;

    return {
        title,
        body,
        subtitle: 'Available for immediate acceptance',
        data: {
            type,
            domain,
            rideId: isTransport ? orderId : undefined,
            orderId,
            url: '/(tabs)/bookings',
            pickupAddress: pickupSummary,
            dropAddress: dropSummary,
            fare: earning,
            distanceKm: record?.distance_km ?? '',
            serviceType,
            details: isTransport ? (record?.details ?? '') : '',
            deadlineSeconds: 30,
        },
    };
}

// ─── Service ──────────────────────────────────────────────────────────────────
export class NotificationService {
    private static _isInitialized = false;

    static async init() {
        if (this._isInitialized) return;
        this._isInitialized = true;

        // Notification handler: controls how notifications behave when JS process is active.
        // CRITICAL: Only suppress the heads-up system banner when the app is actively visible
        // in the FOREGROUND (AppState.currentState === 'active') because GlobalRideAlertModal /
        // GlobalOrderAlertModal is already rendered full-screen.
        // When the app is minimized / backgrounded / screen locked, ALWAYS show banner & play sound!
        Notifications.setNotificationHandler({
            handleNotification: async (notification) => {
                const data = (notification.request.content.data ?? {}) as any;
                const isIncomingOrder =
                    data?.type === 'NEW_BOOKING' ||
                    data?.type === 'NEW_FOOD_ORDER' ||
                    data?.type === 'NEW_GROCERY_ORDER';
                const isOnlineStatus = data?.type === 'ONLINE_STATUS';
                const isAppForeground = AppState.currentState === 'active';

                if (isOnlineStatus) {
                    return {
                        shouldShowBanner: false,
                        shouldShowList: true,
                        shouldPlaySound: false,
                        shouldSetBadge: false,
                        priority: Notifications.AndroidNotificationPriority.LOW,
                    } as Notifications.NotificationBehavior;
                }

                return {
                    shouldShowBanner: isIncomingOrder ? !isAppForeground : true,
                    shouldShowList: true,
                    shouldPlaySound: true,
                    shouldSetBadge: isIncomingOrder,
                    priority: Notifications.AndroidNotificationPriority.MAX,
                } as Notifications.NotificationBehavior;
            },
        });

        await this.requestPermissions();

        if (Platform.OS !== 'web') {
            await Notifications.setNotificationCategoryAsync(NOTIFICATION_CATEGORIES.NEW_BOOKING, [
                {
                    identifier: NOTIFICATION_ACTIONS.ACCEPT,
                    buttonTitle: '✅ Accept',
                    options: { opensAppToForeground: true },
                },
                {
                    identifier: NOTIFICATION_ACTIONS.VIEW,
                    buttonTitle: '👁️ View Order',
                    options: { opensAppToForeground: true },
                },
                {
                    identifier: NOTIFICATION_ACTIONS.DECLINE,
                    buttonTitle: '❌ Decline',
                    options: { opensAppToForeground: false },
                },
            ]);
        }

        // Register background notification handler for FCM data messages.
        if (Platform.OS === 'android') {
            this._registerBackgroundTaskWithRetry();
        }

        await this.scheduleDailyReminders();
    }

    // ─── Background Task Registration (with retry-backoff) ────────────────────
    private static async _registerBackgroundTaskWithRetry(
        attempt = 1,
        maxAttempts = 4,
        baseDelayMs = 1000,
    ): Promise<void> {
        try {
            await new Promise(resolve => setTimeout(resolve, baseDelayMs * attempt));

            const [{ BACKGROUND_NOTIFICATION_TASK }, TaskManager] = await Promise.all([
                import('./background-task'),
                import('expo-task-manager'),
            ]);

            const alreadyRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_NOTIFICATION_TASK);
            if (alreadyRegistered) {
                return;
            }

            await Notifications.registerTaskAsync(BACKGROUND_NOTIFICATION_TASK);
            console.log(`[NotificationService] Background task registered (attempt ${attempt})`);
        } catch (err: any) {
            if (attempt < maxAttempts) {
                this._registerBackgroundTaskWithRetry(attempt + 1, maxAttempts, baseDelayMs);
            } else {
                console.warn('[NotificationService] Background task registration permanently failed (non-fatal):', err?.message ?? err);
            }
        }
    }

    // ─── Permission + Channel Setup ───────────────────────────────────────────
    static async requestPermissions(): Promise<boolean> {
        if (Platform.OS === 'web') return false;

        await this.createAndroidChannels();

        if (IS_EXPO_GO) {
            return true;
        }

        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        let finalStatus = existingStatus;

        if (existingStatus !== 'granted') {
            const { status } = await Notifications.requestPermissionsAsync();
            finalStatus = status;
        }

        if (finalStatus !== 'granted') {
            console.warn('[NotificationService] Notification permission not granted');
            return false;
        }

        return true;
    }

    static async hasNotificationPermission(): Promise<boolean> {
        if (Platform.OS === 'web') return false;
        if (IS_EXPO_GO) return true;
        try {
            const { status } = await Notifications.getPermissionsAsync();
            return status === 'granted';
        } catch {
            return false;
        }
    }

    static async createAndroidChannels() {
        if (Platform.OS !== 'android') return;

        // 1. General channel
        await Notifications.setNotificationChannelAsync('default', {
            name: 'General Updates',
            description: 'Ride status updates and general partner reminders',
            importance: Notifications.AndroidImportance.DEFAULT,
            vibrationPattern: [0, 250, 250, 250],
        });

        // 2. Partner Online Status channel — Ongoing foreground/availability bar presence
        await Notifications.setNotificationChannelAsync('online_status', {
            name: 'Partner Availability Status',
            description: 'Ongoing notification displayed while you are online and waiting for orders',
            importance: Notifications.AndroidImportance.LOW,
            lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
            enableVibrate: false,
            showBadge: false,
        });

        // 3. Bookings & Incoming Order Alerts channel — MAX importance for heads-up + lock screen + sound
        await Notifications.setNotificationChannelAsync('bookings', {
            name: 'Incoming Order Alerts',
            description: 'Critical incoming ride, food, and grocery order requests',
            importance: Notifications.AndroidImportance.MAX,
            sound: 'booking_alert.wav',
            vibrationPattern: [0, 500, 200, 500, 200, 500],
            enableVibrate: true,
            lightColor: '#1565C0',
            lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
            bypassDnd: true,
            enableLights: true,
            showBadge: true,
        });
    }

    // ─── Persistent Online Status & Foreground Service Lifecycle ─────────────
    /**
     * Displays or updates the ongoing "Quickora Partner — You're Online" notification
     * in the Android notification bar.
     */
    static async showOnlineStatusNotification(
        bodyText: string = "You're Online — Searching for orders",
        subtitleText: string = 'Available for delivery requests'
    ): Promise<void> {
        if (Platform.OS === 'web') return;
        try {
            await this.createAndroidChannels();
            await Notifications.scheduleNotificationAsync({
                identifier: ONLINE_STATUS_NOTIFICATION_ID,
                content: {
                    title: 'Quickora Partner',
                    body: bodyText,
                    subtitle: subtitleText,
                    sticky: true,
                    autoDismiss: false,
                    color: '#1565C0',
                    data: {
                        type: 'ONLINE_STATUS',
                        url: '/(tabs)/bookings',
                    },
                    // @ts-ignore — channelId is Android-only
                    channelId: 'online_status',
                },
                trigger: null,
            });
        } catch (err) {
            console.warn('[NotificationService] Failed to show online status notification:', err);
        }
    }

    /**
     * Removes the ongoing online status notification when the partner goes offline or logs out.
     */
    static async dismissOnlineStatusNotification(): Promise<void> {
        if (Platform.OS === 'web') return;
        try {
            await Notifications.dismissNotificationAsync(ONLINE_STATUS_NOTIFICATION_ID);
        } catch {
            // Non-critical if notification was already dismissed
        }
    }

    /**
     * Starts the Android foreground service and ongoing online status notification
     * when an authenticated, verified partner switches their availability to ONLINE.
     */
    static async startOnlineForegroundService(
        driverId: string,
        serviceTypes: string[],
        isBike: boolean = false,
        statusBody: string = "You're Online — Searching for orders"
    ): Promise<void> {
        if (Platform.OS === 'web') return;

        // Always show the persistent ongoing status notification immediately so it works
        // in Expo Go, Development Builds, Preview APKs, and Production APKs alike.
        await this.showOnlineStatusNotification(statusBody, 'Available for delivery requests');

        try {
            const { setBackgroundTaskData, BACKGROUND_RIDE_TASK } = await import('./background-task');
            await setBackgroundTaskData(driverId, serviceTypes, isBike, true);

            const { NativeBridgeService } = await import('./native-bridge.service');
            if (NativeBridgeService.isAndroid) {
                NativeBridgeService.syncDriverSession(driverId, serviceTypes, isBike, true);
                NativeBridgeService.startFloatingWidget();
            }

            if (Platform.OS === 'android' && !IS_EXPO_GO) {
                try {
                    const bgPerm = await Location.getBackgroundPermissionsAsync();
                    if (bgPerm.status === 'granted') {
                        await Location.startLocationUpdatesAsync(BACKGROUND_RIDE_TASK, {
                            accuracy: Location.Accuracy.Balanced,
                            timeInterval: 5000,
                            distanceInterval: 0,
                            foregroundService: {
                                notificationTitle: 'Quickora Partner',
                                notificationBody: statusBody,
                                notificationColor: '#1565C0',
                            },
                            pausesUpdatesAutomatically: false,
                        });
                    }
                } catch (fgErr: any) {
                    console.warn('[NotificationService] Foreground location service could not start:', fgErr?.message);
                }
            }
        } catch (err) {
            console.warn('[NotificationService] Error starting online foreground service:', err);
        }
    }

    /**
     * Stops the Android foreground service, dismisses the ongoing online notification,
     * and clears background online state when the partner goes OFFLINE or logs out.
     */
    static async stopOnlineForegroundService(): Promise<void> {
        if (Platform.OS === 'web') return;

        try {
            const { setBackgroundOnlineState, BACKGROUND_RIDE_TASK } = await import('./background-task');
            await setBackgroundOnlineState(false);

            const { NativeBridgeService } = await import('./native-bridge.service');
            if (NativeBridgeService.isAndroid) {
                NativeBridgeService.syncDriverSession('', [], false, false);
                NativeBridgeService.stopFloatingWidget();
                NativeBridgeService.stopRinging();
            }

            if (Platform.OS === 'android' && !IS_EXPO_GO) {
                try {
                    const isStarted = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_RIDE_TASK);
                    if (isStarted) {
                        await Location.stopLocationUpdatesAsync(BACKGROUND_RIDE_TASK);
                    }
                } catch {
                    // Ignore if task was not registered
                }
            }
        } catch (err) {
            console.warn('[NotificationService] Error stopping online foreground service:', err);
        } finally {
            await this.dismissOnlineStatusNotification();
            try {
                await Notifications.dismissNotificationAsync(INCOMING_ORDER_NOTIFICATION_ID);
            } catch {
                // Ignore
            }
        }
    }

    // ─── Register + Store FCM Push Token ─────────────────────────────────────
    static async registerForPushNotifications(): Promise<string | null> {
        if (IS_EXPO_GO || Platform.OS === 'web') {
            console.log('[NotificationService] Push tokens not available in Expo Go/web');
            return null;
        }

        try {
            const granted = await this.requestPermissions();
            if (!granted) return null;

            const tokenData = await Notifications.getDevicePushTokenAsync();
            const token = tokenData.data as string;
            if (!token) return null;

            await SecureStore.setItemAsync(FCM_TOKEN_KEY, token);
            console.log('[NotificationService] Native FCM token obtained (length:', token.length, ')');
            return token;
        } catch (err) {
            console.error('[NotificationService] Failed to get push token:', err);
            return null;
        }
    }

    // ─── Local Notifications ──────────────────────────────────────────────────
    static async notifyRideStatus(title: string, body: string, rideId?: string) {
        if (Platform.OS === 'web') return;
        await Notifications.scheduleNotificationAsync({
            content: {
                title,
                body,
                data: { url: rideId ? `/active-ride/${rideId}` : '/(tabs)/history' },
                // @ts-ignore
                channelId: 'default',
            },
            trigger: null,
        });
    }

    static async notifyNewBooking(ride: any, domain: 'transport' | 'food' | 'grocery' = 'transport') {
        if (Platform.OS === 'web') return;
        const payload = buildIncomingOrderPayload(ride, domain);
        await Notifications.scheduleNotificationAsync({
            identifier: INCOMING_ORDER_NOTIFICATION_ID,
            content: {
                title: payload.title,
                body: payload.body,
                subtitle: payload.subtitle,
                data: payload.data,
                categoryIdentifier: NOTIFICATION_CATEGORIES.NEW_BOOKING,
                sound: 'booking_alert.wav',
                color: '#1565C0',
                // @ts-ignore
                channelId: 'bookings',
            },
            trigger: null,
        });
    }

    static async notifyBookingRepeat(ride: any, count: number, domain: 'transport' | 'food' | 'grocery' = 'transport') {
        if (Platform.OS === 'web') return;
        const payload = buildIncomingOrderPayload(ride, domain);
        await Notifications.scheduleNotificationAsync({
            identifier: INCOMING_ORDER_NOTIFICATION_ID,
            content: {
                title: payload.title,
                body: payload.body,
                subtitle: payload.subtitle,
                data: payload.data,
                categoryIdentifier: NOTIFICATION_CATEGORIES.NEW_BOOKING,
                sound: 'booking_alert.wav',
                color: '#1565C0',
                // @ts-ignore
                channelId: 'bookings',
            },
            trigger: null,
        });
    }

    // ─── Scheduled Reminders ──────────────────────────────────────────────────
    static async scheduleDailyReminders() {
        if (Platform.OS === 'web') return;
        try {
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
                        // @ts-ignore
                        channelId: 'default',
                    },
                    trigger: {
                        type: Notifications.SchedulableTriggerInputTypes.DAILY,
                        hour: time.hour,
                        minute: time.minute,
                    } as Notifications.DailyTriggerInput,
                });
            }
        } catch {
            // Non-critical if daily reminder scheduling fails
        }
    }
}
