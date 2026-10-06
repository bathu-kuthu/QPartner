import '@/config/i18n'; // Initialize i18n
import { AuthProvider, useAuth } from '@/contexts/auth-context';
import '@/services/background-task'; // Register task-manager definition
import { DriverService } from '@/services/driver.service';
import { NotificationEngine } from '@/services/notification-engine.service';
import { NOTIFICATION_ACTIONS, NotificationService } from '@/services/notification.service';
import Constants from 'expo-constants';
import { useFonts } from 'expo-font';
import { Stack, router, useRootNavigationState } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { LogBox, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import 'react-native-url-polyfill/auto';

const IS_EXPO_GO = Constants.appOwnership === 'expo';

LogBox.ignoreLogs([
    'expo-notifications: Android Push notifications',
    '`expo-notifications` functionality is not fully supported',
    'Unable to activate keep awake',
]);

SplashScreen.preventAutoHideAsync();

import { GlobalRideAlertModal } from '@/components/GlobalRideAlertModal';
import { GlobalOrderAlertModal } from '@/components/GlobalOrderAlertModal';
import { GlobalStatusBanner } from '@/components/GlobalStatusBanner';
import { supabase } from '@/config/supabase';
import { getServiceTypesForDriver } from '@/services/driver.service';
import { FoodDriverService } from '@/services/food-driver.service';
import { GroceryDriverService } from '@/services/grocery-driver.service';
import { registerDriverPushToken } from '@/services/push-token.service';
import { FoodOrder, GroceryOrder } from '@/types';
import * as Location from 'expo-location';
import { useState } from 'react';

function RootContent() {
    const { driver, loading } = useAuth();
    const [incomingRide, setIncomingRide] = useState<any>(null);
    const [incomingOrder, setIncomingOrder] = useState<{ domain: 'food' | 'grocery'; order: FoodOrder | GroceryOrder } | null>(null);
    const rootNavState = useRootNavigationState();
    // Track the last routed (driverId + rider_status) tuple to allow legitimate status transitions
    // (e.g. pending -> verified, login/logout) while blocking redundant reroutes from GPS / is_online updates.
    const lastRoutedKeyRef = useRef<string | null>(null);

    useEffect(() => {
        // Wait until navigation is fully mounted and ready before attempting to route
        if (!rootNavState?.key) return;
        if (loading) return;

        const currentRouteKey = `${driver?.id ?? 'anon'}:${driver?.rider_status ?? 'none'}:${driver?.is_driver ?? 'false'}`;
        if (lastRoutedKeyRef.current === currentRouteKey) return;
        lastRoutedKeyRef.current = currentRouteKey;

        if (!driver) {
            setTimeout(() => router.replace('/(auth)/login'), 0);
        } else if (!driver.is_driver || driver.rider_status === 'unsubmitted') {
            setTimeout(() => router.replace('/(auth)/onboarding'), 0);
        } else if (driver.rider_status === 'pending' || driver.rider_status === 'rejected') {
            setTimeout(() => router.replace('/(auth)/onboarding'), 0);
        } else if (driver.rider_status === 'verified') {
            // Async check for required permissions before going to bookings
            (async () => {
                try {
                    const fg = await Location.getForegroundPermissionsAsync();
                    const bg = await Location.getBackgroundPermissionsAsync();
                    const notif = await import('expo-notifications').then(n => n.getPermissionsAsync());
                    let overlay = true;
                    if (Platform.OS === 'android') {
                        const { NativeBridgeService } = await import('@/services/native-bridge.service');
                        overlay = await NativeBridgeService.checkDrawOverAppsPermission();
                    }

                    if (
                        fg.status !== 'granted' ||
                        bg.status !== 'granted' ||
                        notif.status !== 'granted' ||
                        !overlay
                    ) {
                        setTimeout(() => router.replace('/(auth)/permissions'), 0);
                    } else {
                        // Register FCM push token so Edge Function can notify this device
                        registerDriverPushToken(driver.id).catch(console.warn);

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
                            setTimeout(() => router.replace(`/active-grocery/${activeGrocery.id}` as any), 0);
                        } else {
                            setTimeout(() => router.replace('/(tabs)/bookings'), 0);
                        }
                    }
                } catch (e) {
                    // Fallback
                    setTimeout(() => router.replace('/(tabs)/bookings'), 0);
                }
            })();
        } else {
            setTimeout(() => router.replace('/(auth)/onboarding'), 0);
        }
    }, [driver, loading, rootNavState?.key]);

    // Handle Realtime pending rides & orders globally when online ───
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

        const initRealtime = async () => {
            try {
                // Get acceptBoth preference from AsyncStorage
                let acceptBoth = false;
                try {
                    const AS = await import('@react-native-async-storage/async-storage');
                    const acceptBothVal = await AS.default.getItem('@quickora_accept_both');
                    acceptBoth = acceptBothVal === 'true';
                } catch {
                    // AsyncStorage failure is non-critical, continue with default
                }

                const isBike = driver.vehicle_type === 'bike';
                const serviceTypes = getServiceTypesForDriver(
                    driver.vehicle_category ?? 'taxi',
                    driver.vehicle_type ?? 'bike',
                    acceptBoth
                );

                if (!isMounted) return;

                // 1. Transport Realtime Channel
                rideChannel = DriverService.subscribeToPendingRides(
                    async () => {
                        if (!isMounted) return;
                        try {
                            // Check if driver has an active ride (guard against network errors)
                            let activeRide = null;
                            try {
                                activeRide = await DriverService.getActiveRide(driver.id);
                            } catch (activeErr: any) {
                                if (activeErr?.message === 'NETWORK_ERROR') return;
                            }
                            if (activeRide) {
                                setIncomingRide(null);
                                return;
                            }

                            const rides = await DriverService.getAvailableRides(serviceTypes, driver.current_lat, driver.current_lng);
                            if (rides && rides.length > 0 && isMounted) {
                                setIncomingRide(rides[0]);
                            } else if (isMounted) {
                                setIncomingRide(null);
                            }
                        } catch (rideErr) {
                            console.warn('[Layout] Error processing incoming rides:', rideErr);
                        }
                    },
                    serviceTypes,
                    () => ({ lat: driver.current_lat, lng: driver.current_lng })
                );

                // 2. Food & Grocery Realtime Channels for bike partners
                if (isBike) {
                    foodChannel = FoodDriverService.subscribeToPendingOrders(
                        async (orders) => {
                            if (!isMounted) return;
                            try {
                                let activeRide = await DriverService.getActiveRide(driver.id);
                                let activeFood = await FoodDriverService.getActiveFoodOrder(driver.id);
                                if (activeRide || activeFood) {
                                    setIncomingOrder(null);
                                    return;
                                }
                                if (orders && orders.length > 0 && isMounted) {
                                    setIncomingOrder({ domain: 'food', order: orders[0] });
                                } else if (isMounted) {
                                    setIncomingOrder(null);
                                }
                            } catch (err) {
                                console.warn('[Layout] Error processing incoming food orders:', err);
                            }
                        },
                        () => ({ lat: driver.current_lat, lng: driver.current_lng })
                    );

                    groceryChannel = GroceryDriverService.subscribeToPendingOrders(
                        async (orders) => {
                            if (!isMounted) return;
                            try {
                                let activeRide = await DriverService.getActiveRide(driver.id);
                                let activeGrocery = await GroceryDriverService.getActiveGroceryOrder(driver.id);
                                if (activeRide || activeGrocery) {
                                    setIncomingOrder(null);
                                    return;
                                }
                                if (orders && orders.length > 0 && isMounted) {
                                    setIncomingOrder({ domain: 'grocery', order: orders[0] });
                                } else if (isMounted) {
                                    setIncomingOrder(null);
                                }
                            } catch (err) {
                                console.warn('[Layout] Error processing incoming grocery orders:', err);
                            }
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
            rideChannel?.unsubscribe?.();
            foodChannel?.unsubscribe?.();
            groceryChannel?.unsubscribe?.();
        };
    }, [driver?.id, driver?.is_online, driver?.vehicle_type]);

    // Handle Notification Actions and Foreground Reception ───
    useEffect(() => {
        if (IS_EXPO_GO) return; // Push notifications not supported in Expo Go SDK 53+
        if (!driver?.id) return; // Only listen when a driver is logged in

        let isMounted = true;
        let subResponse: { remove: () => void } | null = null;
        let subReceived: { remove: () => void } | null = null;

        import('expo-notifications').then((N) => {
            if (!isMounted) return;

            // 1. Response (Click/Action) Listener — fires when driver taps FCM notification
            subResponse = N.addNotificationResponseReceivedListener(async (response) => {
                const data = response.notification.request.content.data as any;
                const actionId = response.actionIdentifier;
                const rideId = data.rideId;

                console.log('[Layout] Notification tapped:', { actionId, type: data.type });

                if (actionId === NOTIFICATION_ACTIONS.ACCEPT && rideId && driver.id) {
                    // Driver tapped "Accept" action button directly from notification tray
                    try {
                        const ride = await DriverService.acceptRide(rideId, driver.id);
                        if (ride) {
                            setIncomingRide(null);
                            router.push(`/active-ride/${rideId}`);
                        }
                    } catch (e: any) {
                        console.error('[Layout] Accept via notification action failed:', e.message);
                        router.push(`/(tabs)/bookings`);
                    }
                } else if (data.type === 'NEW_BOOKING' && rideId && driver.is_online) {
                    // Driver tapped the notification body — check if ride still available,
                    // then show the ride alert modal
                    try {
                        const { data: ride } = await supabase
                            .from('rides')
                            .select('*')
                            .eq('id', rideId)
                            .eq('status', 'pending')
                            .is('driver_id', null)
                            .single();

                        if (ride && isMounted) {
                            setIncomingRide(ride);
                        } else {
                            // Ride already taken — just navigate to bookings
                            router.push('/(tabs)/bookings');
                        }
                    } catch (err) {
                        console.warn('[Layout] Failed to fetch ride from notification tap:', err);
                        router.push('/(tabs)/bookings');
                    }
                } else if (data.url) {
                    setIncomingRide(null);
                    router.push(data.url);
                } else {
                    router.push('/(tabs)/bookings');
                }
            });

            // 2. Foreground Received Listener
            subReceived = N.addNotificationReceivedListener(async (notification) => {
                const data = notification.request.content.data as any;
                if (data?.type === 'NEW_BOOKING' && data?.rideId && driver.is_online) {
                    try {
                        const activeRide = await DriverService.getActiveRide(driver.id);
                        if (!activeRide) {
                            const { data: ride } = await supabase
                                .from('rides')
                                .select('*')
                                .eq('id', data.rideId)
                                .single();
                            if (ride && ride.status === 'pending' && isMounted) {
                                setIncomingRide(ride);
                            }
                        }
                    } catch (err) {
                        console.error('Error fetching foreground notification ride details:', err);
                    }
                }
            });
        }).catch(() => { }); // silently skip if unavailable

        return () => {
            isMounted = false;
            subResponse?.remove();
            subReceived?.remove();
        };
    }, [driver?.id, driver?.is_online]);

    // ─── Continuous Notification Engine ──────────────────────────────────────
    // Start the engine whenever a new pending ride appears; stop it when cleared.
    useEffect(() => {
        if (incomingRide) {
            NotificationEngine.start(incomingRide);
        } else {
            NotificationEngine.stop();
        }
    }, [incomingRide]);

    const handleAcceptRide = async (rideId: string) => {
        if (!driver?.id) return;
        NotificationEngine.stop();   // Stop immediately — don't wait for state update
        try {
            const ride = await DriverService.acceptRide(rideId, driver.id);
            setIncomingRide(null);
            if (ride) {
                router.push(`/active-ride/${rideId}`);
            }
        } catch (e: any) {
            setIncomingRide(null);
            console.error('Accept global ride failed:', e.message);
        }
    };

    const handleDeclineRide = () => {
        NotificationEngine.stop();   // Stop immediately
        setIncomingRide(null);
    };

    const handleAcceptOrder = async (orderId: string, domain: 'food' | 'grocery') => {
        if (!driver?.id) return;
        NotificationEngine.stop();
        try {
            if (domain === 'food') {
                const claimed = await FoodDriverService.claimOrder(orderId, driver.id);
                setIncomingOrder(null);
                if (claimed) {
                    router.push(`/active-food/${orderId}` as any);
                }
            } else {
                const claimed = await GroceryDriverService.claimOrder(orderId, driver.id);
                setIncomingOrder(null);
                if (claimed) {
                    router.push(`/active-grocery/${orderId}` as any);
                }
            }
        } catch (e: any) {
            setIncomingOrder(null);
            console.error('Accept order failed:', e.message);
        }
    };

    const handleDeclineOrder = () => {
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

import { ErrorBoundary } from '@/components/ErrorBoundary';

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
            NotificationService.init(); // Boot engine
            const { OfflineQueueService } = require('@/services/offline-queue.service');
            OfflineQueueService.init(); // Boot offline retry engine
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