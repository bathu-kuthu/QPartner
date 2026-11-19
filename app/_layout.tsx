import '@/config/i18n'; // Initialize i18n
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { GlobalOrderAlertModal } from '@/components/GlobalOrderAlertModal';
import { GlobalRideAlertModal } from '@/components/GlobalRideAlertModal';
import { GlobalStatusBanner } from '@/components/GlobalStatusBanner';
import { supabase } from '@/config/supabase';
import { AuthProvider, useAuth } from '@/contexts/auth-context';
import '@/services/background-task'; // Register task-manager definitions
import { markOrderInformedInBackground } from '@/services/background-task';
import { DriverService, getServiceTypesForDriver, RIDE_COLUMNS } from '@/services/driver.service';
import { FoodDriverService } from '@/services/food-driver.service';
import { GroceryDriverService } from '@/services/grocery-driver.service';
import { NativeBridgeService } from '@/services/native-bridge.service';
import { NotificationEngine } from '@/services/notification-engine.service';
import { NOTIFICATION_ACTIONS, NotificationService } from '@/services/notification.service';
import { registerDriverPushToken } from '@/services/push-token.service';
import { FoodOrder, GroceryOrder } from '@/types';
import Constants from 'expo-constants';
import { useFonts } from 'expo-font';
import * as Location from 'expo-location';
import { router, Stack, useRootNavigationState } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, LogBox } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import 'react-native-url-polyfill/auto';

const IS_EXPO_GO = Constants.appOwnership === 'expo';

LogBox.ignoreLogs([
    'expo-notifications: Android Push notifications',
    '`expo-notifications` functionality is not fully supported',
    'Unable to activate keep awake',
]);

SplashScreen.preventAutoHideAsync();

function RootContent() {
    const { driver, loading } = useAuth();
    const [incomingRide, setIncomingRide] = useState<any>(null);
    const [incomingOrder, setIncomingOrder] = useState<{
        domain: 'food' | 'grocery';
        order: FoodOrder | GroceryOrder;
    } | null>(null);
    const rootNavState = useRootNavigationState();

    // Track the last routed (driverId + rider_status) tuple to allow legitimate status transitions
    // while blocking redundant reroutes from GPS / is_online updates.
    const lastRoutedKeyRef = useRef<string | null>(null);
    // Track processed notification response keys so cold-start + warm-start listeners never double-fire
    const handledResponseKeysRef = useRef<Set<string>>(new Set());

    // ─── 1. Authoritative Startup Routing & Active Work Recovery ─────────────
    useEffect(() => {
        if (!rootNavState?.key) return;
        if (loading) return;

        const normalizedStatus = (driver?.rider_status ?? 'none').trim().toLowerCase();
        const currentRouteKey = `${driver?.id ?? 'anon'}:${normalizedStatus}:${driver?.is_driver ?? 'false'}`;
        if (lastRoutedKeyRef.current === currentRouteKey) return;
        lastRoutedKeyRef.current = currentRouteKey;

        if (!driver) {
            setTimeout(() => router.replace('/(auth)/login'), 0);
        } else if (!driver.is_driver || normalizedStatus === 'unsubmitted') {
            setTimeout(() => router.replace('/(auth)/onboarding'), 0);
        } else if (normalizedStatus === 'pending' || normalizedStatus === 'rejected') {
            setTimeout(() => router.replace('/(auth)/onboarding'), 0);
        } else if (normalizedStatus === 'verified') {
            (async () => {
                try {
                    // Always register/refresh FCM push token for verified partners
                    registerDriverPushToken(driver.id).catch(console.warn);

                    const fg = await Location.getForegroundPermissionsAsync();
                    const bg = await Location.getBackgroundPermissionsAsync();
                    const notif = await import('expo-notifications').then((n) =>
                        n.getPermissionsAsync()
                    );

                    if (
                        fg.status !== 'granted' ||
                        bg.status !== 'granted' ||
                        notif.status !== 'granted'
                    ) {
                        setTimeout(() => router.replace('/(auth)/permissions'), 0);
                        return;
                    }

                    // Check for in-progress active work across all 3 verticals
                    const [activeRide, activeFood, activeGrocery] = await Promise.all([
                        DriverService.getActiveRide(driver.id).catch(() => null),
                        FoodDriverService.getActiveFoodOrder(driver.id).catch(() => null),
                        GroceryDriverService.getActiveGroceryOrder(driver.id).catch(() => null),
                    ]);

                    if (activeRide) {
                        setTimeout(() => router.replace(`/active-ride/${activeRide.id}` as any), 0);
                    } else if (activeFood) {
                        setTimeout(() => router.replace(`/active-food/${activeFood.id}` as any), 0);
                    } else if (activeGrocery) {
                        setTimeout(
                            () => router.replace(`/active-grocery/${activeGrocery.id}` as any),
                            0
                        );
                    } else {
                        setTimeout(() => router.replace('/(tabs)/bookings'), 0);
                    }
                } catch {
                    setTimeout(() => router.replace('/(tabs)/bookings'), 0);
                }
            })();
        } else {
            setTimeout(() => router.replace('/(auth)/onboarding'), 0);
        }
    }, [driver, loading, rootNavState?.key]);

    // ─── 2. Keep Persistent Online Foreground Service Synchronized with DB ───
    useEffect(() => {
        if (!driver?.id) return;
        const normalizedStatus = (driver.rider_status ?? '').trim().toLowerCase();
        if (!driver.is_driver || normalizedStatus !== 'verified') {
            NotificationService.stopOnlineForegroundService().catch(() => {});
            return;
        }

        let cancelled = false;
        (async () => {
            if (driver.is_online) {
                let acceptBoth = true;
                try {
                    const AS = await import('@react-native-async-storage/async-storage');
                    const val = await AS.default.getItem('@quickora_accept_both');
                    acceptBoth = val !== 'false';
                } catch {
                    // Use default
                }
                if (cancelled) return;
                const isBike = (driver.vehicle_type ?? '').trim().toLowerCase() === 'bike';
                const serviceTypes = getServiceTypesForDriver(
                    driver.vehicle_category ?? 'taxi',
                    driver.vehicle_type ?? 'bike',
                    acceptBoth
                );
                await NotificationService.startOnlineForegroundService(
                    driver.id,
                    serviceTypes,
                    isBike,
                    "You're Online — Searching for orders"
                );
                NativeBridgeService.setAppForegroundState(AppState.currentState === 'active');
            } else {
                await NotificationService.stopOnlineForegroundService();
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [driver?.id, driver?.is_online, driver?.rider_status, driver?.vehicle_type, driver?.vehicle_category]);

    // ─── 3. Handle Realtime + Resilient Polling for Pending Rides & Orders ───
    useEffect(() => {
        if (!driver?.id || !driver.is_online) {
            setIncomingRide(null);
            setIncomingOrder(null);
            return;
        }

        let isMounted = true;
        let rideChannel: any = null;
        let foodChannel: any = null;
        let groceryChannel: any = null;
        let pollTimer: ReturnType<typeof setInterval> | null = null;
        let appStateSub: { remove: () => void } | null = null;

        const initRealtime = async () => {
            try {
                let acceptBoth = true;
                try {
                    const AS = await import('@react-native-async-storage/async-storage');
                    const acceptBothVal = await AS.default.getItem('@quickora_accept_both');
                    acceptBoth = acceptBothVal !== 'false';
                } catch {
                    // Continue with default
                }

                const isBike = (driver.vehicle_type ?? '').trim().toLowerCase() === 'bike';
                const serviceTypes = getServiceTypesForDriver(
                    driver.vehicle_category ?? 'taxi',
                    driver.vehicle_type ?? 'bike',
                    acceptBoth
                );

                if (!isMounted) return;

                const checkPendingWork = async () => {
                    if (!isMounted) return;
                    try {
                        let activeRide = null;
                        try {
                            activeRide = await DriverService.getActiveRide(driver.id);
                        } catch (activeErr: any) {
                            if (activeErr?.message === 'NETWORK_ERROR') return;
                        }
                        if (activeRide) {
                            if (isMounted) {
                                setIncomingRide(null);
                                setIncomingOrder(null);
                            }
                            return;
                        }

                        const rides = await DriverService.getAvailableRides(
                            serviceTypes,
                            driver.current_lat,
                            driver.current_lng
                        );
                        const eligibleRides = (rides ?? []).filter(
                            (r) => !NotificationEngine.isHandled(r.id)
                        );
                        if (eligibleRides.length > 0 && isMounted) {
                            setIncomingRide(eligibleRides[0]);
                            return;
                        } else if (isMounted) {
                            setIncomingRide(null);
                        }

                        if (isBike && isMounted) {
                            const [foodOrders, groceryOrders] = await Promise.all([
                                FoodDriverService.getAvailableOrders(
                                    driver.current_lat,
                                    driver.current_lng
                                ).catch(() => []),
                                GroceryDriverService.getAvailableOrders(
                                    driver.current_lat,
                                    driver.current_lng
                                ).catch(() => []),
                            ]);
                            const eligibleFood = (foodOrders ?? []).filter(
                                (o) => !NotificationEngine.isHandled(o.id)
                            );
                            if (eligibleFood.length > 0 && isMounted) {
                                setIncomingOrder({ domain: 'food', order: eligibleFood[0] });
                                return;
                            }
                            const eligibleGrocery = (groceryOrders ?? []).filter(
                                (o) => !NotificationEngine.isHandled(o.id)
                            );
                            if (eligibleGrocery.length > 0 && isMounted) {
                                setIncomingOrder({ domain: 'grocery', order: eligibleGrocery[0] });
                                return;
                            }
                            if (isMounted) {
                                setIncomingOrder(null);
                            }
                        }
                    } catch (err) {
                        console.warn('[Layout] Error checking pending work:', err);
                    }
                };

                // Initial check immediately when going online
                checkPendingWork();

                // Resilient 6-second polling loop (ensures incoming alerts fire even if WebSocket drops while minimized)
                pollTimer = setInterval(checkPendingWork, 6000);

                // Re-check immediately on AppState transitions & sync Native Overlay Foreground State
                appStateSub = AppState.addEventListener('change', (nextState) => {
                    NativeBridgeService.setAppForegroundState(nextState === 'active');
                    if (nextState === 'active') {
                        checkPendingWork();
                    }
                });

                // 1. Transport Realtime Channel
                rideChannel = DriverService.subscribeToPendingRides(
                    async () => {
                        await checkPendingWork();
                    },
                    serviceTypes,
                    () => ({ lat: driver.current_lat, lng: driver.current_lng })
                );

                // 2. Food & Grocery Realtime Channels for bike partners
                if (isBike) {
                    foodChannel = FoodDriverService.subscribeToPendingOrders(
                        async () => {
                            await checkPendingWork();
                        },
                        () => ({ lat: driver.current_lat, lng: driver.current_lng })
                    );

                    groceryChannel = GroceryDriverService.subscribeToPendingOrders(
                        async () => {
                            await checkPendingWork();
                        },
                        () => ({ lat: driver.current_lat, lng: driver.current_lng })
                    );
                }
            } catch (err: any) {
                console.warn('Realtime bookings init failed:', err?.message ?? err);
            }
        };

        initRealtime();

        return () => {
            isMounted = false;
            if (pollTimer) clearInterval(pollTimer);
            appStateSub?.remove();
            rideChannel?.unsubscribe?.();
            foodChannel?.unsubscribe?.();
            groceryChannel?.unsubscribe?.();
        };
    }, [driver?.id, driver?.is_online, driver?.vehicle_type, driver?.vehicle_category]);

    // ─── 4. Unified Notification Tap / Action Processor (Cold + Warm Start) ──
    const processNotificationResponse = useCallback(
        async (response: any) => {
            if (!response || !driver?.id) return;

            const notifId = response.notification?.request?.identifier ?? 'unknown';
            const actionId = response.actionIdentifier ?? 'default';
            const responseKey = `${notifId}:${actionId}`;

            if (handledResponseKeysRef.current.has(responseKey)) {
                return;
            }
            handledResponseKeysRef.current.add(responseKey);

            const data = (response.notification?.request?.content?.data ?? {}) as any;
            const msgType = data.type;
            const domain: 'transport' | 'food' | 'grocery' =
                data.domain ||
                (msgType === 'NEW_FOOD_ORDER'
                    ? 'food'
                    : msgType === 'NEW_GROCERY_ORDER'
                      ? 'grocery'
                      : 'transport');
            const targetId = data.rideId || data.orderId;

            console.log('[Layout] Processing notification interaction:', {
                actionId,
                msgType,
                domain,
                targetId,
            });

            // A. Partner tapped Decline action in notification shade
            if (actionId === NOTIFICATION_ACTIONS.DECLINE) {
                if (targetId) {
                    NotificationEngine.markHandled(targetId);
                    markOrderInformedInBackground(String(targetId)).catch(() => {});
                }
                NotificationEngine.stop();
                setIncomingRide(null);
                setIncomingOrder(null);
                return;
            }

            // B. Partner tapped Accept action button directly from notification shade
            if (actionId === NOTIFICATION_ACTIONS.ACCEPT && targetId) {
                NotificationEngine.markHandled(targetId);
                NotificationEngine.stop();
                markOrderInformedInBackground(String(targetId)).catch(() => {});
                setIncomingRide(null);
                setIncomingOrder(null);

                try {
                    if (domain === 'food') {
                        const claimed = await FoodDriverService.claimOrder(targetId, driver.id);
                        if (claimed) {
                            router.replace(`/active-food/${targetId}` as any);
                            return;
                        }
                    } else if (domain === 'grocery') {
                        const claimed = await GroceryDriverService.claimOrder(targetId, driver.id);
                        if (claimed) {
                            router.replace(`/active-grocery/${targetId}` as any);
                            return;
                        }
                    } else {
                        const ride = await DriverService.acceptRide(targetId, driver.id);
                        if (ride) {
                            router.replace(`/active-ride/${targetId}` as any);
                            return;
                        }
                    }
                } catch (e: any) {
                    Alert.alert(
                        'Order No Longer Available',
                        e?.message || 'This order was already accepted by another partner or cancelled.'
                    );
                    router.replace('/(tabs)/bookings');
                    return;
                }
            }

            // C. Partner tapped the notification body or "View Order" action
            const isIncomingOrderType =
                msgType === 'NEW_BOOKING' ||
                msgType === 'NEW_FOOD_ORDER' ||
                msgType === 'NEW_GROCERY_ORDER';

            if (isIncomingOrderType && targetId) {
                try {
                    if (domain === 'food' || domain === 'grocery') {
                        const order =
                            domain === 'food'
                                ? await FoodDriverService.getOrderById(targetId)
                                : await GroceryDriverService.getOrderById(targetId);

                        if (!order) {
                            Alert.alert(
                                'Order Unavailable',
                                'This delivery request is no longer available.'
                            );
                            router.replace('/(tabs)/bookings');
                            return;
                        }

                        if (order.driver_id === driver.id && order.status === 'out_for_delivery') {
                            router.replace(`/active-${domain}/${targetId}` as any);
                            return;
                        }

                        if (order.status === 'preparing' && !order.driver_id) {
                            router.replace('/(tabs)/bookings');
                            setIncomingOrder({ domain, order });
                            return;
                        }

                        NotificationEngine.markHandled(targetId);
                        NotificationEngine.stop();
                        Alert.alert(
                            'Order Already Taken',
                            'Another delivery partner has already accepted this order.'
                        );
                        router.replace('/(tabs)/bookings');
                        return;
                    } else {
                        const { data: ride } = await supabase
                            .from('rides')
                            .select(RIDE_COLUMNS)
                            .eq('id', targetId)
                            .maybeSingle();

                        if (!ride) {
                            Alert.alert('Order Unavailable', 'This ride request was cancelled.');
                            router.replace('/(tabs)/bookings');
                            return;
                        }

                        if (
                            ride.driver_id === driver.id &&
                            ['accepted', 'picked_up', 'on_ride'].includes(ride.status)
                        ) {
                            router.replace(`/active-ride/${targetId}` as any);
                            return;
                        }

                        if (ride.status === 'pending' && !ride.driver_id) {
                            router.replace('/(tabs)/bookings');
                            setIncomingRide(ride);
                            return;
                        }

                        NotificationEngine.markHandled(targetId);
                        NotificationEngine.stop();
                        Alert.alert(
                            'Order Already Taken',
                            'Another partner has already accepted this request or it was cancelled.'
                        );
                        router.replace('/(tabs)/bookings');
                        return;
                    }
                } catch (err) {
                    console.warn('[Layout] Failed to fetch order from notification tap:', err);
                    router.replace('/(tabs)/bookings');
                    return;
                }
            }

            if (data.url) {
                setIncomingRide(null);
                setIncomingOrder(null);
                router.replace(data.url);
            } else {
                router.replace('/(tabs)/bookings');
            }
        },
        [driver?.id]
    );

    // ─── 5. Register Cold-Start & Warm-Start Notification + Native Overlay Listeners ──
    const consumeNativeOverlayAction = useCallback(async () => {
        if (!driver?.id) return;
        const pending = await NativeBridgeService.consumePendingOrderAction();
        if (!pending || !pending.orderId) return;

        const { orderId, domain, action } = pending;
        console.log('[Layout] Processing Native Floating Overlay order action:', pending);

        await processNotificationResponse({
            notification: {
                request: {
                    identifier: `native_overlay_${orderId}_${Date.now()}`,
                    content: {
                        data: {
                            type:
                                domain === 'food'
                                    ? 'NEW_FOOD_ORDER'
                                    : domain === 'grocery'
                                      ? 'NEW_GROCERY_ORDER'
                                      : 'NEW_BOOKING',
                            domain,
                            rideId: domain === 'transport' ? orderId : undefined,
                            orderId,
                        },
                    },
                },
            },
            actionIdentifier:
                action === 'accept' ? NOTIFICATION_ACTIONS.ACCEPT : NOTIFICATION_ACTIONS.VIEW,
        });
    }, [driver?.id, processNotificationResponse]);

    useEffect(() => {
        if (!driver?.id || !rootNavState?.key) return;

        let isMounted = true;
        let subResponse: { remove: () => void } | null = null;
        let subReceived: { remove: () => void } | null = null;

        // Check if partner tapped Accept / View on the Native Floating Order Receiver Overlay Card
        consumeNativeOverlayAction().catch(() => {});
        const overlayAppStateSub = AppState.addEventListener('change', (nextState) => {
            if (nextState === 'active' && isMounted) {
                consumeNativeOverlayAction().catch(() => {});
            }
        });

        import('expo-notifications')
            .then(async (N) => {
                if (!isMounted) return;

                // 1. Cold-Start Check: inspect if the app was launched from a killed state by tapping a notification
                try {
                    const lastResponse = await N.getLastNotificationResponseAsync();
                    if (lastResponse && isMounted) {
                        await processNotificationResponse(lastResponse);
                    }
                } catch {
                    // Ignore if unavailable
                }

                if (!isMounted) return;

                // 2. Warm-Start Response Listener: fires when driver taps notification or action button
                subResponse = N.addNotificationResponseReceivedListener((response) => {
                    processNotificationResponse(response);
                });

                // 3. Foreground Received Listener: syncs incoming push immediately to in-app modal
                subReceived = N.addNotificationReceivedListener(async (notification) => {
                    const data = (notification.request.content.data ?? {}) as any;
                    if (!driver.is_online) return;

                    const msgType = data?.type;
                    const targetId = data?.rideId || data?.orderId;
                    if (!targetId || NotificationEngine.isHandled(targetId)) return;

                    try {
                        const [activeRide, activeFood, activeGrocery] = await Promise.all([
                            DriverService.getActiveRide(driver.id),
                            FoodDriverService.getActiveFoodOrder(driver.id),
                            GroceryDriverService.getActiveGroceryOrder(driver.id),
                        ]);
                        if (activeRide || activeFood || activeGrocery) return;

                        if (msgType === 'NEW_FOOD_ORDER' || data?.domain === 'food') {
                            const order = await FoodDriverService.getOrderById(targetId);
                            if (order && order.status === 'preparing' && !order.driver_id && isMounted) {
                                setIncomingOrder({ domain: 'food', order });
                            }
                        } else if (msgType === 'NEW_GROCERY_ORDER' || data?.domain === 'grocery') {
                            const order = await GroceryDriverService.getOrderById(targetId);
                            if (order && order.status === 'preparing' && !order.driver_id && isMounted) {
                                setIncomingOrder({ domain: 'grocery', order });
                            }
                        } else if (msgType === 'NEW_BOOKING') {
                            const { data: ride } = await supabase
                                .from('rides')
                                .select(RIDE_COLUMNS)
                                .eq('id', targetId)
                                .maybeSingle();
                            if (ride && ride.status === 'pending' && !ride.driver_id && isMounted) {
                                setIncomingRide(ride);
                            }
                        }
                    } catch (err) {
                        console.error('Error fetching foreground notification order details:', err);
                    }
                });
            })
            .catch(() => {});

        return () => {
            isMounted = false;
            overlayAppStateSub.remove();
            subResponse?.remove();
            subReceived?.remove();
        };
    }, [driver?.id, driver?.is_online, rootNavState?.key, processNotificationResponse, consumeNativeOverlayAction]);

    // ─── 6. Synchronize NotificationEngine Across All Incoming Domains ───────
    useEffect(() => {
        if (incomingRide?.id) {
            markOrderInformedInBackground(String(incomingRide.id)).catch(() => {});
            NotificationEngine.start(incomingRide);
        } else if (incomingOrder?.order?.id) {
            markOrderInformedInBackground(String(incomingOrder.order.id)).catch(() => {});
            NotificationEngine.startOrder(incomingOrder.order, incomingOrder.domain);
        } else {
            NotificationEngine.stop();
        }
    }, [incomingRide, incomingOrder]);

    // ─── 7. Modal Accept / Decline Handlers ──────────────────────────────────
    const handleAcceptRide = async (rideId: string) => {
        if (!driver?.id) return;
        NotificationEngine.markHandled(rideId);
        NotificationEngine.stop();
        markOrderInformedInBackground(String(rideId)).catch(() => {});

        try {
            const ride = await DriverService.acceptRide(rideId, driver.id);
            setIncomingRide(null);
            if (ride) {
                router.replace(`/active-ride/${rideId}` as any);
            }
        } catch (e: any) {
            setIncomingRide(null);
            Alert.alert(
                'Order No Longer Available',
                e?.message || 'This ride was already accepted by another partner or cancelled.'
            );
        }
    };

    const handleDeclineRide = () => {
        if (incomingRide?.id) {
            NotificationEngine.markHandled(incomingRide.id);
            markOrderInformedInBackground(String(incomingRide.id)).catch(() => {});
        }
        NotificationEngine.stop();
        setIncomingRide(null);
    };

    const handleAcceptOrder = async (orderId: string, domain: 'food' | 'grocery') => {
        if (!driver?.id) return;
        NotificationEngine.markHandled(orderId);
        NotificationEngine.stop();
        markOrderInformedInBackground(String(orderId)).catch(() => {});

        try {
            if (domain === 'food') {
                const claimed = await FoodDriverService.claimOrder(orderId, driver.id);
                setIncomingOrder(null);
                if (claimed) {
                    router.replace(`/active-food/${orderId}` as any);
                }
            } else {
                const claimed = await GroceryDriverService.claimOrder(orderId, driver.id);
                setIncomingOrder(null);
                if (claimed) {
                    router.replace(`/active-grocery/${orderId}` as any);
                }
            }
        } catch (e: any) {
            setIncomingOrder(null);
            Alert.alert(
                'Order No Longer Available',
                e?.message || 'This delivery order was already accepted by another partner.'
            );
        }
    };

    const handleDeclineOrder = () => {
        if (incomingOrder?.order?.id) {
            NotificationEngine.markHandled(incomingOrder.order.id);
            markOrderInformedInBackground(String(incomingOrder.order.id)).catch(() => {});
        }
        NotificationEngine.stop();
        setIncomingOrder(null);
    };

    return (
        <>
            <StatusBar style="dark" />
            <GlobalStatusBanner />
            <Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
                <Stack.Screen name="index" />
                <Stack.Screen name="(auth)" />
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="active-ride" />
                <Stack.Screen name="active-food" />
                <Stack.Screen name="active-grocery" />
                <Stack.Screen name="chat" options={{ animation: 'slide_from_right' }} />
                <Stack.Screen name="terms" />
            </Stack>

            <GlobalRideAlertModal
                visible={incomingRide !== null}
                ride={incomingRide}
                driverLat={driver?.current_lat}
                driverLng={driver?.current_lng}
                onAccept={handleAcceptRide}
                onDecline={handleDeclineRide}
            />

            <GlobalOrderAlertModal
                visible={incomingOrder !== null}
                domain={incomingOrder?.domain ?? 'food'}
                order={incomingOrder?.order ?? null}
                driverLat={driver?.current_lat}
                driverLng={driver?.current_lng}
                onAccept={handleAcceptOrder}
                onDecline={handleDeclineOrder}
            />
        </>
    );
}

export default function RootLayout() {
    const [loaded, error] = useFonts({
        'Satoshi-Regular': require('../assets/fonts/Satoshi-Regular.otf'),
        'Satoshi-Medium': require('../assets/fonts/Satoshi-Medium.otf'),
        'Satoshi-Bold': require('../assets/fonts/Satoshi-Bold.otf'),
        'Satoshi-Black': require('../assets/fonts/Satoshi-Black.otf'),
    });

    useEffect(() => {
        if (loaded || error) SplashScreen.hideAsync();
        if (loaded) {
            NotificationService.init();
            const { OfflineQueueService } = require('@/services/offline-queue.service');
            OfflineQueueService.init();
        }
    }, [loaded, error]);

    if (!loaded && !error) return null;

    return (
        <SafeAreaProvider>
            <ErrorBoundary>
                <AuthProvider>
                    <RootContent />
                </AuthProvider>
            </ErrorBoundary>
        </SafeAreaProvider>
    );
}
