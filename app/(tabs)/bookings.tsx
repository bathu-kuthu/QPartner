import { supabase } from '@/config/supabase';
import { colors, Fonts } from '@/constants/colors';
import { useAuth } from '@/contexts/auth-context';
import { BACKGROUND_RIDE_TASK, setBackgroundTaskData } from '@/services/background-task';
import { DriverService, getServiceTypesForDriver } from '@/services/driver.service';
import { FoodDriverService } from '@/services/food-driver.service';
import { GroceryDriverService } from '@/services/grocery-driver.service';
import { NativeBridgeService } from '@/services/native-bridge.service';
import { FoodOrder, GroceryOrder, Ride } from '@/types';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    ActivityIndicator, Alert,
    AppState, AppStateStatus,
    DeviceEventEmitter,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Switch,
    Text, TouchableOpacity,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const ACCEPT_BOTH_KEY = '@quickora_accept_both';

const SERVICE_LABELS: Record<string, { label: string; icon: string; color: string }> = {
    taxi_bike: { label: 'Bike Taxi', icon: '🏍️', color: '#FF6B35' },
    taxi_auto: { label: 'Auto', icon: '🛺', color: '#2196F3' },
    taxi_car: { label: 'Cab', icon: '🚗', color: '#4CAF50' },
    log_bike: { label: 'Bike Delivery', icon: '🏍️', color: '#FF6B35' },
    log_mini_truck: { label: 'Mini Truck', icon: '🛻', color: '#9C27B0' },
    log_truck: { label: 'Truck', icon: '🚚', color: '#795548' },
    parcel: { label: 'Parcel', icon: '📦', color: '#FF9800' },
    bike_taxi: { label: 'Bike Taxi', icon: '🏍️', color: '#FF6B35' },
    custom: { label: 'Custom', icon: '⚡', color: '#607D8B' },
};

export default function BookingsScreen() {
    const insets = useSafeAreaInsets();
    const { driver, setDriverData } = useAuth();
    const { t, i18n } = useTranslation();

    const [isOnline, setIsOnline] = useState(driver?.is_online ?? false);
    const [activeRide, setActiveRide] = useState<Ride | null>(null);
    const [availableRides, setAvailableRides] = useState<Ride[]>([]);
    const [availableFoodOrders, setAvailableFoodOrders] = useState<FoodOrder[]>([]);
    const [availableGroceryOrders, setAvailableGroceryOrders] = useState<GroceryOrder[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [accepting, setAccepting] = useState<string | null>(null);
    const [acceptBoth, setAcceptBoth] = useState(false);   // cross-category for bikes
    const [driverLat, setDriverLat] = useState<number | undefined>(driver?.current_lat ?? undefined);
    const [driverLng, setDriverLng] = useState<number | undefined>(driver?.current_lng ?? undefined);
    const [networkError, setNetworkError] = useState(false);

    const channelRef = useRef<any>(null);
    const foodChannelRef = useRef<any>(null);
    const groceryChannelRef = useRef<any>(null);
    const locationSubRef = useRef<any>(null);

    // ── Derived service types ──────────────────────────────────────────────
    const serviceTypes = getServiceTypesForDriver(
        driver?.vehicle_category ?? 'taxi',
        driver?.vehicle_type ?? 'bike',
        acceptBoth
    );

    // Is this driver a bike driver? (cross-category toggle only shows for bikes)
    const isBikeDriver = driver?.vehicle_type === 'bike';

    const crossCategoryLabel = driver?.vehicle_category === 'taxi'
        ? '📦 Low rides? Also accept Bike Logistics'
        : '🏍️ Low rides? Also accept Bike Taxi';

    // ── Load persisted acceptBoth pref ────────────────────────────────────
    useEffect(() => {
        AsyncStorage.getItem(ACCEPT_BOTH_KEY).then((val) => {
            if (val === 'true') setAcceptBoth(true);
        });
    }, []);

    const toggleAcceptBoth = async (val: boolean) => {
        setAcceptBoth(val);
        await AsyncStorage.setItem(ACCEPT_BOTH_KEY, val ? 'true' : 'false');
        if (driver?.id) {
            const types = getServiceTypesForDriver(driver.vehicle_category ?? 'taxi', driver.vehicle_type ?? 'bike', val);
            await setBackgroundTaskData(driver.id, types);
            // Persist to DB — the notify-driver Edge Function reads accept_both
            // server-side to decide which drivers qualify for cross-category push notifications.
            try {
                await supabase.from('users').update({ accept_both: val }).eq('id', driver.id);
            } catch (e) {
                console.warn('Failed to persist accept_both to DB:', e);
            }
        }
    };

    // ── Location services ─────────────────────────────────────────────────
    useEffect(() => {
        (async () => {
            try {
                const { status } = await Location.requestForegroundPermissionsAsync();
                if (status !== 'granted') {
                    console.warn('Foreground location permission not granted.');
                    return;
                }

                // Get initial position — safely handle GPS unavailable
                try {
                    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
                    setDriverLat(pos.coords.latitude);
                    setDriverLng(pos.coords.longitude);
                } catch (gpsErr) {
                    // GPS not ready yet — try last known position as fallback
                    try {
                        const last = await Location.getLastKnownPositionAsync();
                        if (last) {
                            setDriverLat(last.coords.latitude);
                            setDriverLng(last.coords.longitude);
                        }
                    } catch { /* silently skip */ }
                }

                // Watch position
                locationSubRef.current = await Location.watchPositionAsync(
                    { accuracy: Location.Accuracy.Balanced, distanceInterval: 50 },
                    (loc) => {
                        setDriverLat(loc.coords.latitude);
                        setDriverLng(loc.coords.longitude);
                        // Update in DB if online (throttled by distanceInterval)
                        if (driver?.id && isOnline) {
                            DriverService.setOnlineStatus(
                                driver.id, true,
                                loc.coords.latitude,
                                loc.coords.longitude
                            ).catch((e) => console.warn('DB location update failed:', e?.message));
                        }
                    }
                );
            } catch (err: any) {
                console.warn('Location setup failed:', err?.message ?? err);
            }
        })();

        return () => { locationSubRef.current?.remove?.(); };
    }, []);

    // ── Load rides + food/grocery + subscribe ─────────────────────────────
    const loadData = useCallback(async () => {
        if (!driver?.id) return;
        setNetworkError(false);
        try {
            const [active, available, food, grocery] = await Promise.all([
                DriverService.getActiveRide(driver.id),
                DriverService.getAvailableRides(serviceTypes, driverLat, driverLng),
                isBikeDriver ? FoodDriverService.getAvailableOrders(driverLat, driverLng) : Promise.resolve([]),
                isBikeDriver ? GroceryDriverService.getAvailableOrders(driverLat, driverLng) : Promise.resolve([]),
            ]);
            setActiveRide(active);
            if (!active) {
                setAvailableRides(available.slice(0, 1));
                setAvailableFoodOrders(food.slice(0, 1));
                setAvailableGroceryOrders(grocery.slice(0, 1));
            }
        } catch (e: any) {
            if (e.message === 'NETWORK_ERROR') setNetworkError(true);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [driver?.id, serviceTypes.join(','), driverLat, driverLng, isBikeDriver]);

    useEffect(() => {
        loadData();

        // Unsubscribe old channels before creating new ones
        channelRef.current?.unsubscribe?.();
        foodChannelRef.current?.unsubscribe?.();
        groceryChannelRef.current?.unsubscribe?.();

        channelRef.current = DriverService.subscribeToPendingRides(
            (rides) => {
                try {
                    if (!activeRide) setAvailableRides(rides.slice(0, 1));
                } catch (e) {
                    console.warn('Error updating available rides:', e);
                }
            },
            serviceTypes,
            driverLat,
            driverLng
        );

        if (isBikeDriver) {
            foodChannelRef.current = FoodDriverService.subscribeToPendingOrders(
                (orders) => {
                    try {
                        if (!activeRide) setAvailableFoodOrders(orders.slice(0, 1));
                    } catch (e) {
                        console.warn('Error updating available food:', e);
                    }
                },
                driverLat,
                driverLng
            );

            groceryChannelRef.current = GroceryDriverService.subscribeToPendingOrders(
                (orders) => {
                    try {
                        if (!activeRide) setAvailableGroceryOrders(orders.slice(0, 1));
                    } catch (e) {
                        console.warn('Error updating available grocery:', e);
                    }
                },
                driverLat,
                driverLng
            );
        }

        return () => {
            channelRef.current?.unsubscribe?.();
            foodChannelRef.current?.unsubscribe?.();
            groceryChannelRef.current?.unsubscribe?.();
        };
    }, [loadData, acceptBoth, isBikeDriver]);

    // Subscribe to active ride changes
    useEffect(() => {
        if (!activeRide?.id) return;
        const sub = DriverService.subscribeToRide(activeRide.id, (updated) => {
            setActiveRide(updated);
            if (updated.status === 'completed' || updated.status === 'cancelled') loadData();
        });
        return () => { sub.unsubscribe?.(); };
    }, [activeRide?.id]);

    // ── AppState & Widget Refresh listener ────────────────────────────────────
    useEffect(() => {
        const sub = AppState.addEventListener('change', (nextAppState) => {
            if (nextAppState === 'active') {
                loadData();
            }
        });
        
        // Listen for manual refresh from the native floating widget
        const refreshSub = DeviceEventEmitter.addListener('onWidgetRefresh', () => {
            loadData();
        });
        
        return () => {
            sub.remove();
            refreshSub.remove();
        };
    }, [loadData]);

    // ── Floating Widget Sync (Reacts to state changes) ───────────────────────
    useEffect(() => {
        if (!isOnline) return;

        const firstAvailable = availableRides[0];
        
        if (activeRide) {
            // If there's an active ride (accepted/on_ride)
            NativeBridgeService.updateFloatingWidgetData(JSON.stringify({
                status: 'order',
                pickup: activeRide.pickup_address,
                fare: `₹${activeRide.fare}`
            }));
        } else if (firstAvailable) {
            // If there's a new incoming request ringing
            NativeBridgeService.updateFloatingWidgetData(JSON.stringify({
                status: 'order',
                pickup: firstAvailable.pickup_address,
                fare: `₹${firstAvailable.fare}`
            }));
        } else {
            // Searching
            NativeBridgeService.updateFloatingWidgetData(JSON.stringify({
                status: 'searching'
            }));
        }
    }, [isOnline, activeRide, availableRides]);

    // ── Online toggle ─────────────────────────────────────────────────────
    const toggleOnline = async (value: boolean) => {
        if (!driver?.id) return;
        // Block going offline/logout while active ride exists
        if (!value && activeRide) {
            Alert.alert(
                'Cannot Go Offline',
                'You have an active ride. Complete or cancel it first.',
                [{ text: 'OK' }]
            );
            return;
        }
        if (value && (driverLat == null || driverLng == null)) {
            Alert.alert('Locating...', 'Please wait until a GPS location fix is obtained before going online.');
            return;
        }

        if (value) {
            const hasOverlayPermission = await NativeBridgeService.checkDrawOverAppsPermission();
            if (!hasOverlayPermission) {
                Alert.alert(
                    'Overlay Permission Required',
                    'Quickora needs "Display over other apps" permission to show you new order requests while you use other apps.',
                    [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Enable', onPress: () => NativeBridgeService.requestDrawOverAppsPermission() }
                    ]
                );
                return;
            }
        }

        setIsOnline(value);
        await DriverService.setOnlineStatus(driver.id, value, driverLat, driverLng);
        if (driver) await setDriverData({ ...driver, is_online: value });

        // Handle Background Task ─────────
        try {
            if (value) {
                NativeBridgeService.startFloatingWidget();

                // 1. Refresh background task metadata
                await setBackgroundTaskData(driver.id, serviceTypes);

                // 2. Start location task
                const { status } = await Location.requestBackgroundPermissionsAsync();
                if (status === 'granted') {
                    await Location.startLocationUpdatesAsync(BACKGROUND_RIDE_TASK, {
                        accuracy: Location.Accuracy.Balanced,
                        timeInterval: 5000, // 5 seconds
                        distanceInterval: 0, // Don't require movement
                        foregroundService: {
                            notificationTitle: 'Quickora Driver Online',
                            notificationBody: 'Searching for nearby rides...',
                            notificationColor: colors.primary,
                        },
                        pausesUpdatesAutomatically: false,
                    });
                } else {
                    Alert.alert('Permission Required', 'Background location is needed to receive bookings while the app is closed.');
                }
            } else {
                NativeBridgeService.stopFloatingWidget();

                // Stop location task
                const isStarted = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_RIDE_TASK);
                if (isStarted) {
                    await Location.stopLocationUpdatesAsync(BACKGROUND_RIDE_TASK);
                }
            }
        } catch (taskErr: any) {
            console.warn('Background task setup failed:', taskErr?.message);
        }
    };

    // ── Language toggle ───────────────────────────────────────────────────
    const toggleLanguage = async () => {
        const newLang = i18n.language === 'en' ? 'ta' : 'en';
        await i18n.changeLanguage(newLang);
        await AsyncStorage.setItem('user-language', newLang);
    };

    // ── Accept ride ───────────────────────────────────────────────────────
    const handleAccept = async (rideId: string) => {
        if (!driver?.id) return;
        setAccepting(rideId);
        try {
            const ride = await DriverService.acceptRide(rideId, driver.id);
            setActiveRide(ride);
            setAvailableRides([]);
            router.push(`/active-ride/${rideId}`);
        } catch (e: any) {
            if (e.message === 'NETWORK_ERROR') {
                Alert.alert('No Internet', 'Check your connection and try again.');
            } else {
                Alert.alert('Cannot Accept', e.message ?? 'This ride is no longer available.');
            }
            loadData();
        } finally {
            setAccepting(null);
        }
    };

    // ── Accept Food Order ──────────────────────────────────────────────────
    const handleAcceptFood = async (orderId: string) => {
        if (!driver?.id) return;
        setAccepting(orderId);
        try {
            const claimed = await FoodDriverService.claimOrder(orderId);
            setAvailableFoodOrders([]);
            if (claimed) {
                router.push(`/active-food/${orderId}` as any);
            }
        } catch (e: any) {
            if (e.message === 'NETWORK_ERROR') {
                Alert.alert('No Internet', 'Check your connection and try again.');
            } else {
                Alert.alert('Cannot Accept', e.message ?? 'This food order is no longer available.');
            }
            loadData();
        } finally {
            setAccepting(null);
        }
    };

    // ── Accept Grocery Order ───────────────────────────────────────────────
    const handleAcceptGrocery = async (orderId: string) => {
        if (!driver?.id) return;
        setAccepting(orderId);
        try {
            const claimed = await GroceryDriverService.claimOrder(orderId);
            setAvailableGroceryOrders([]);
            if (claimed) {
                router.push(`/active-grocery/${orderId}` as any);
            }
        } catch (e: any) {
            if (e.message === 'NETWORK_ERROR') {
                Alert.alert('No Internet', 'Check your connection and try again.');
            } else {
                Alert.alert('Cannot Accept', e.message ?? 'This grocery order is no longer available.');
            }
            loadData();
        } finally {
            setAccepting(null);
        }
    };

    const handleOpenActiveRide = () => {
        if (activeRide) router.push(`/active-ride/${activeRide.id}`);
    };

    const onRefresh = () => { setRefreshing(true); loadData(); };

    const serviceInfo = (type: string) =>
        SERVICE_LABELS[type] ?? { label: type, icon: '🚗', color: colors.primary };

    if (loading) {
        return (
            <View style={[styles.container, styles.center, { paddingTop: insets.top }]}>
                <ActivityIndicator size="large" color={colors.primary} />
            </View>
        );
    }

    return (
        <View style={[styles.container, { paddingTop: insets.top }]}>
            {/* Header */}
            <View style={styles.header}>
                <View style={{ flex: 1 }}>
                    <Text style={styles.greeting} numberOfLines={1}>
                        {t('bookings.hello', { name: driver?.name?.split(' ')[0] })}
                    </Text>
                    <Text style={styles.ratingRow}>
                        ⭐ {driver?.rating?.toFixed(1)} · {driver?.total_rides} {t('bookings.totalRides')}
                    </Text>
                </View>
                <View style={styles.headerRight}>
                    <TouchableOpacity style={styles.langBadge} onPress={toggleLanguage}>
                        <Text style={styles.langBadgeText}>{i18n.language === 'en' ? 'தமிழ்' : 'EN'}</Text>
                    </TouchableOpacity>
                    <View style={styles.onlineToggle}>
                        {driverLat == null || driverLng == null ? (
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                <ActivityIndicator size="small" color={colors.primary} />
                                <Text style={{ fontFamily: Fonts.medium, fontSize: 12, color: colors.textMuted }}>
                                    Locating...
                                </Text>
                            </View>
                        ) : (
                            <>
                                <Text style={[styles.onlineLabel, isOnline && styles.onlineLabelActive]}>
                                    {isOnline ? t('bookings.online') : t('bookings.offline')}
                                </Text>
                                <Switch
                                    value={isOnline}
                                    onValueChange={toggleOnline}
                                    trackColor={{ false: colors.border, true: colors.success }}
                                    thumbColor={colors.white}
                                />
                            </>
                        )}
                    </View>
                </View>
            </View>

            {/* Network error banner */}
            {networkError && (
                <View style={styles.networkBanner}>
                    <Feather name="wifi-off" size={14} color={colors.white} />
                    <Text style={styles.networkBannerText}>No internet connection</Text>
                    <TouchableOpacity onPress={loadData}>
                        <Text style={styles.networkRetry}>Retry</Text>
                    </TouchableOpacity>
                </View>
            )}

            <ScrollView
                contentContainerStyle={styles.scroll}
                showsVerticalScrollIndicator={false}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
            >
                {/* Active Ride Banner */}
                {activeRide && (
                    <TouchableOpacity style={styles.activeRideBanner} onPress={handleOpenActiveRide} activeOpacity={0.85}>
                        <View style={styles.activeRideLeft}>
                            <View style={styles.activePulse}>
                                <View style={styles.activeDot} />
                            </View>
                            <View>
                                <Text style={styles.activeRideTitle}>{t('bookings.activeRide')}</Text>
                                <Text style={styles.activeRideStatus}>
                                    {activeRide.status === 'accepted' ? t('bookings.headToPickup') :
                                        activeRide.status === 'picked_up' ? t('bookings.passengerOnBoard') :
                                            activeRide.status === 'on_ride' ? t('bookings.enRoute') : activeRide.status}
                                </Text>
                            </View>
                        </View>
                        <View style={styles.activeRideRight}>
                            <Text style={styles.activeRideFare}>₹{activeRide.fare}</Text>
                            <Feather name="chevron-right" size={20} color={colors.white} />
                        </View>
                    </TouchableOpacity>
                )}

                {/* Cross-category toggle — only for bike drivers, only when online and no active ride */}
                {isBikeDriver && isOnline && !activeRide && (
                    <TouchableOpacity
                        style={[styles.acceptBothCard, acceptBoth && styles.acceptBothCardActive]}
                        onPress={() => toggleAcceptBoth(!acceptBoth)}
                        activeOpacity={0.8}
                    >
                        <Text style={styles.acceptBothIcon}>{driver?.vehicle_category === 'taxi' ? '-' : '-'}</Text>
                        <Text style={[styles.acceptBothText, acceptBoth && styles.acceptBothTextActive]}>
                            {crossCategoryLabel}
                        </Text>
                        <View style={[styles.acceptBothPill, acceptBoth && styles.acceptBothPillActive]}>
                            <Text style={[styles.acceptBothPillText, acceptBoth && styles.acceptBothPillTextActive]}>
                                {acceptBoth ? 'ON' : 'OFF'}
                            </Text>
                        </View>
                    </TouchableOpacity>
                )}

                {/* Offline state */}
                {!isOnline && !activeRide && (
                    <View style={styles.offlineCard}>
                        <Feather name="moon" size={36} color={colors.textMuted} />
                        <Text style={styles.offlineTitle}>{t('bookings.youAreOffline')}</Text>
                        <Text style={styles.offlineSubtitle}>{t('bookings.offlineSubtitle')}</Text>
                        {driverLat == null || driverLng == null ? (
                            <View style={{ alignItems: 'center', gap: 8, marginTop: 10 }}>
                                <ActivityIndicator color={colors.primary} />
                                <Text style={{ fontFamily: Fonts.medium, fontSize: 14, color: colors.textSecondary }}>
                                    Getting your location...
                                </Text>
                            </View>
                        ) : (
                            <TouchableOpacity style={styles.goOnlineBtn} onPress={() => toggleOnline(true)}>
                                <Text style={styles.goOnlineText}>{t('bookings.goOnline')}</Text>
                            </TouchableOpacity>
                        )}
                    </View>
                )}

                {/* Available ride */}
                {isOnline && !activeRide && availableRides.length > 0 && (
                    <>
                        <View style={styles.sectionHeader}>
                            <Text style={styles.sectionTitle}>{t('bookings.newBooking')}</Text>
                            <View style={styles.newBadge}><Text style={styles.newBadgeText}>{t('bookings.new')}</Text></View>
                        </View>

                        {availableRides.map((ride) => {
                            const svc = serviceInfo(ride.service_type);
                            // Distance from driver to pickup
                            const pickupDist = driverLat != null && driverLng != null
                                ? (() => {
                                    const km = require('@/services/driver.service').haversineKm?.(
                                        driverLat, driverLng,
                                        ride.pickup_location?.latitude ?? 0,
                                        ride.pickup_location?.longitude ?? 0
                                    );
                                    return km ? `${km.toFixed(1)} km away` : null;
                                })()
                                : null;

                            return (
                                <View key={ride.id} style={styles.rideCard}>
                                    <View style={styles.rideCardHeader}>
                                        <View style={[styles.serviceTag, { backgroundColor: svc.color + '20' }]}>
                                            <Text style={styles.serviceTagIcon}>{svc.icon}</Text>
                                            <Text style={[styles.serviceTagLabel, { color: svc.color }]}>{svc.label}</Text>
                                        </View>
                                        <Text style={styles.rideFare}>₹{ride.fare}</Text>
                                    </View>

                                    <View style={styles.routeSection}>
                                        <View style={styles.routeRow}>
                                            <View style={[styles.routeDot, { backgroundColor: colors.success }]} />
                                            <Text style={styles.routeAddress} numberOfLines={2}>{ride.pickup_address}</Text>
                                        </View>
                                        <View style={styles.routeLine} />
                                        <View style={styles.routeRow}>
                                            <View style={[styles.routeDot, { backgroundColor: colors.error }]} />
                                            <Text style={styles.routeAddress} numberOfLines={2}>{ride.drop_address}</Text>
                                        </View>
                                    </View>

                                    <View style={styles.rideStats}>
                                        <View style={styles.stat}>
                                            <Feather name="map-pin" size={14} color={colors.textMuted} />
                                            <Text style={styles.statText}>{ride.distance_km} km trip</Text>
                                        </View>

                                        {pickupDist && (
                                            <>
                                                <View style={styles.statDivider} />
                                                <View style={styles.stat}>
                                                    <Feather name="navigation" size={14} color={colors.primary} />
                                                    <Text style={[styles.statText, { color: colors.primary }]}>{pickupDist}</Text>
                                                </View>
                                            </>
                                        )}
                                    </View>

                                    {ride.details ? (
                                        <View style={styles.detailsRow}>
                                            <Feather name="info" size={13} color={colors.primary} />
                                            <Text style={styles.detailsText} numberOfLines={2}>{ride.details}</Text>
                                        </View>
                                    ) : null}

                                    <TouchableOpacity
                                        style={[styles.acceptBtn, accepting === ride.id && styles.acceptBtnLoading]}
                                        onPress={() => handleAccept(ride.id)}
                                        disabled={accepting !== null}
                                        activeOpacity={0.85}
                                    >
                                        {accepting === ride.id ? (
                                            <ActivityIndicator color={colors.white} />
                                        ) : (
                                            <>
                                                <Feather name="check" size={18} color={colors.white} />
                                                <Text style={styles.acceptBtnText}>{t('bookings.acceptRide')}</Text>
                                            </>
                                        )}
                                    </TouchableOpacity>
                                </View>
                            );
                        })}

                        {/* Available Food Orders */}
                        {availableFoodOrders.map((fOrder) => (
                            <View key={fOrder.id} style={[styles.rideCard, { borderColor: '#FF6B35' }]}>
                                <View style={styles.rideCardHeader}>
                                    <View style={[styles.serviceTag, { backgroundColor: '#FFF7ED' }]}>
                                        <MaterialCommunityIcons name="food-fork-drink" size={16} color="#FF6B35" />
                                        <Text style={[styles.serviceTagLabel, { color: '#FF6B35', marginLeft: 4 }]}>Food Delivery</Text>
                                    </View>
                                    <Text style={[styles.rideFare, { color: '#FF6B35' }]}>₹{fOrder.delivery_fee || 35}</Text>
                                </View>

                                <View style={styles.routeSection}>
                                    <View style={styles.routeRow}>
                                        <View style={[styles.routeDot, { backgroundColor: '#8B5CF6' }]} />
                                        <Text style={styles.routeAddress} numberOfLines={2}>
                                            {fOrder.store?.name ? `${fOrder.store.name} (${fOrder.store.address})` : 'Restaurant Pickup'}
                                        </Text>
                                    </View>
                                    <View style={styles.routeLine} />
                                    <View style={styles.routeRow}>
                                        <View style={[styles.routeDot, { backgroundColor: '#10B981' }]} />
                                        <Text style={styles.routeAddress} numberOfLines={2}>{fOrder.delivery_address}</Text>
                                    </View>
                                </View>

                                <View style={styles.rideStats}>
                                    <View style={styles.stat}>
                                        <Feather name="package" size={14} color={colors.textMuted} />
                                        <Text style={styles.statText}>{fOrder.items?.length || 1} Items</Text>
                                    </View>
                                    <View style={styles.statDivider} />
                                    <View style={styles.stat}>
                                        <Feather name="dollar-sign" size={14} color="#FF6B35" />
                                        <Text style={[styles.statText, { color: '#FF6B35' }]}>Direct Payout</Text>
                                    </View>
                                </View>

                                <TouchableOpacity
                                    style={[styles.acceptBtn, { backgroundColor: '#FF6B35' }, accepting === fOrder.id && styles.acceptBtnLoading]}
                                    onPress={() => handleAcceptFood(fOrder.id)}
                                    disabled={accepting !== null}
                                    activeOpacity={0.85}
                                >
                                    {accepting === fOrder.id ? (
                                        <ActivityIndicator color={colors.white} />
                                    ) : (
                                        <>
                                            <Feather name="check" size={18} color={colors.white} />
                                            <Text style={styles.acceptBtnText}>ACCEPT FOOD ORDER</Text>
                                        </>
                                    )}
                                </TouchableOpacity>
                            </View>
                        ))}

                        {/* Available Grocery Orders */}
                        {availableGroceryOrders.map((gOrder) => (
                            <View key={gOrder.id} style={[styles.rideCard, { borderColor: '#10B981' }]}>
                                <View style={styles.rideCardHeader}>
                                    <View style={[styles.serviceTag, { backgroundColor: '#ECFDF5' }]}>
                                        <MaterialCommunityIcons name="shopping" size={16} color="#10B981" />
                                        <Text style={[styles.serviceTagLabel, { color: '#10B981', marginLeft: 4 }]}>Grocery Delivery</Text>
                                    </View>
                                    <Text style={[styles.rideFare, { color: '#10B981' }]}>₹{gOrder.delivery_fee || 35}</Text>
                                </View>

                                <View style={styles.routeSection}>
                                    <View style={styles.routeRow}>
                                        <View style={[styles.routeDot, { backgroundColor: '#10B981' }]} />
                                        <Text style={styles.routeAddress} numberOfLines={2}>
                                            {gOrder.store?.name ? `${gOrder.store.name} (${gOrder.store.address})` : 'Supermarket Pickup'}
                                        </Text>
                                    </View>
                                    <View style={styles.routeLine} />
                                    <View style={styles.routeRow}>
                                        <View style={[styles.routeDot, { backgroundColor: '#10B981' }]} />
                                        <Text style={styles.routeAddress} numberOfLines={2}>{gOrder.delivery_address}</Text>
                                    </View>
                                </View>

                                <View style={styles.rideStats}>
                                    <View style={styles.stat}>
                                        <Feather name="package" size={14} color={colors.textMuted} />
                                        <Text style={styles.statText}>{gOrder.items?.length || 1} Packages</Text>
                                    </View>
                                    <View style={styles.statDivider} />
                                    <View style={styles.stat}>
                                        <Feather name="dollar-sign" size={14} color="#10B981" />
                                        <Text style={[styles.statText, { color: '#10B981' }]}>Direct Payout</Text>
                                    </View>
                                </View>

                                <TouchableOpacity
                                    style={[styles.acceptBtn, { backgroundColor: '#10B981' }, accepting === gOrder.id && styles.acceptBtnLoading]}
                                    onPress={() => handleAcceptGrocery(gOrder.id)}
                                    disabled={accepting !== null}
                                    activeOpacity={0.85}
                                >
                                    {accepting === gOrder.id ? (
                                        <ActivityIndicator color={colors.white} />
                                    ) : (
                                        <>
                                            <Feather name="check" size={18} color={colors.white} />
                                            <Text style={styles.acceptBtnText}>ACCEPT GROCERY ORDER</Text>
                                        </>
                                    )}
                                </TouchableOpacity>
                            </View>
                        ))}
                    </>
                )}

                {/* Online, no rides or deliveries */}
                {isOnline && !activeRide && availableRides.length === 0 && availableFoodOrders.length === 0 && availableGroceryOrders.length === 0 && (
                    <View style={styles.waitingCard}>
                        <View style={styles.waitingIcon}>
                            <Feather name="search" size={28} color={colors.primary} />
                        </View>
                        <Text style={styles.waitingTitle}>{t('bookings.lookingForRides')}</Text>
                        <Text style={styles.waitingSubtitle}>{t('bookings.waitingSubtitle')}</Text>
                        <ActivityIndicator color={colors.primary} style={{ marginTop: 16 }} />
                    </View>
                )}

                {/* Quick stats */}
                <View style={styles.statsRow}>
                    <View style={styles.statCard}>
                        <Feather name="star" size={20} color={colors.warning} />
                        <Text style={styles.statCardValue}>{driver?.rating?.toFixed(1)}</Text>
                        <Text style={styles.statCardLabel}>{t('bookings.rating')}</Text>
                    </View>
                    <View style={styles.statCard}>
                        <Feather name="navigation" size={20} color={colors.primary} />
                        <Text style={styles.statCardValue}>{driver?.total_rides}</Text>
                        <Text style={styles.statCardLabel}>{t('bookings.totalRides')}</Text>
                    </View>
                    <View style={styles.statCard}>
                        <Feather name="shield" size={20} color={colors.success} />
                        <Text style={[styles.statCardValue, { fontSize: 12 }]}>
                            {driver?.vehicle_type?.toUpperCase() ?? '—'}
                        </Text>
                        <Text style={styles.statCardLabel}>{t('bookings.vehicle')}</Text>
                    </View>
                </View>
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    center: { justifyContent: 'center', alignItems: 'center' },

    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 20, paddingVertical: 14,
        backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    greeting: { fontFamily: Fonts.bold, fontSize: 17, color: colors.text },
    ratingRow: { fontFamily: Fonts.regular, fontSize: 13, color: colors.textSecondary, marginTop: 2 },
    headerRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    langBadge: {
        backgroundColor: colors.background, paddingHorizontal: 10, paddingVertical: 5,
        borderRadius: 8, borderWidth: 1, borderColor: colors.border,
    },
    langBadgeText: { fontFamily: Fonts.bold, fontSize: 11, color: colors.text },
    onlineToggle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    onlineLabel: { fontFamily: Fonts.medium, fontSize: 13, color: colors.textMuted },
    onlineLabelActive: { color: colors.success },

    // Network error banner
    networkBanner: {
        flexDirection: 'row', alignItems: 'center', gap: 8,
        backgroundColor: colors.error, paddingHorizontal: 16, paddingVertical: 10,
    },
    networkBannerText: { flex: 1, fontFamily: Fonts.medium, fontSize: 13, color: colors.white },
    networkRetry: { fontFamily: Fonts.bold, fontSize: 13, color: colors.white, textDecorationLine: 'underline' },

    scroll: { padding: 16, paddingBottom: 32 },

    // Active ride banner
    activeRideBanner: {
        backgroundColor: colors.primary, borderRadius: 16,
        padding: 16, flexDirection: 'row', alignItems: 'center',
        justifyContent: 'space-between', marginBottom: 12,
        shadowColor: colors.primary, shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3, shadowRadius: 8, elevation: 6,
    },
    activeRideLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    activePulse: {
        width: 32, height: 32, borderRadius: 16,
        backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center',
    },
    activeDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#4AE54A' },
    activeRideTitle: { fontFamily: Fonts.bold, fontSize: 14, color: colors.white },
    activeRideStatus: { fontFamily: Fonts.regular, fontSize: 13, color: 'rgba(255,255,255,0.8)', marginTop: 2 },
    activeRideRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    activeRideFare: { fontFamily: Fonts.black, fontSize: 18, color: colors.white },

    // Cross-category toggle
    acceptBothCard: {
        flexDirection: 'row', alignItems: 'center', gap: 10,
        backgroundColor: colors.surface, borderRadius: 14, padding: 14,
        borderWidth: 1.5, borderColor: colors.border,
        marginBottom: 12,
    },
    acceptBothCardActive: {
        borderColor: colors.primary, backgroundColor: colors.primaryLight,
    },
    acceptBothIcon: { fontSize: 18 },
    acceptBothText: { flex: 1, fontFamily: Fonts.medium, fontSize: 13, color: colors.textSecondary },
    acceptBothTextActive: { color: colors.primary },
    acceptBothPill: {
        backgroundColor: colors.border, borderRadius: 10,
        paddingHorizontal: 10, paddingVertical: 3,
    },
    acceptBothPillActive: { backgroundColor: colors.primary },
    acceptBothPillText: { fontFamily: Fonts.bold, fontSize: 11, color: colors.textMuted },
    acceptBothPillTextActive: { color: colors.white },

    // Offline state
    offlineCard: {
        backgroundColor: colors.surface, borderRadius: 20, padding: 32,
        alignItems: 'center', marginBottom: 16,
    },
    offlineTitle: { fontFamily: Fonts.bold, fontSize: 18, color: colors.text, marginTop: 12, marginBottom: 6 },
    offlineSubtitle: { fontFamily: Fonts.regular, fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 20, marginBottom: 20 },
    goOnlineBtn: { backgroundColor: colors.success, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 28 },
    goOnlineText: { fontFamily: Fonts.bold, fontSize: 15, color: colors.white },

    // Section header
    sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
    sectionTitle: { fontFamily: Fonts.bold, fontSize: 16, color: colors.text },
    newBadge: { backgroundColor: colors.error, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
    newBadgeText: { fontFamily: Fonts.bold, fontSize: 11, color: colors.white, letterSpacing: 0.5 },

    // Ride card
    rideCard: {
        backgroundColor: colors.surface, borderRadius: 20, padding: 18,
        marginBottom: 16, borderWidth: 1, borderColor: colors.border,
        shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
    },
    rideCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
    serviceTag: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5 },
    serviceTagIcon: { fontSize: 14 },
    serviceTagLabel: { fontFamily: Fonts.bold, fontSize: 13 },
    rideFare: { fontFamily: Fonts.black, fontSize: 22, color: colors.text },

    routeSection: { marginBottom: 14 },
    routeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    routeDot: { width: 10, height: 10, borderRadius: 5, marginTop: 4, flexShrink: 0 },
    routeLine: { width: 1.5, backgroundColor: colors.border, height: 14, marginLeft: 4, marginVertical: 3 },
    routeAddress: { flex: 1, fontFamily: Fonts.medium, fontSize: 14, color: colors.text, lineHeight: 20 },

    rideStats: {
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: colors.background, borderRadius: 12, padding: 12, marginBottom: 12,
    },
    stat: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5 },
    statText: { fontFamily: Fonts.medium, fontSize: 12, color: colors.textSecondary },
    statDivider: { width: 1, height: 16, backgroundColor: colors.border },

    detailsRow: {
        flexDirection: 'row', gap: 8, backgroundColor: colors.primaryLight,
        borderRadius: 10, padding: 10, marginBottom: 12, alignItems: 'flex-start',
    },
    detailsText: { flex: 1, fontFamily: Fonts.regular, fontSize: 13, color: colors.primary, lineHeight: 18 },

    acceptBtn: {
        backgroundColor: colors.success, borderRadius: 14, paddingVertical: 15,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
        shadowColor: colors.success, shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.3, shadowRadius: 6, elevation: 3,
    },
    acceptBtnLoading: { opacity: 0.7 },
    acceptBtnText: { fontFamily: Fonts.bold, fontSize: 16, color: colors.white },

    // Waiting state
    waitingCard: {
        backgroundColor: colors.surface, borderRadius: 20, padding: 32,
        alignItems: 'center', marginBottom: 16,
    },
    waitingIcon: {
        width: 64, height: 64, borderRadius: 32,
        backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center',
        marginBottom: 14,
    },
    waitingTitle: { fontFamily: Fonts.bold, fontSize: 17, color: colors.text, marginBottom: 6 },
    waitingSubtitle: { fontFamily: Fonts.regular, fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },

    // Bottom stats
    statsRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
    statCard: {
        flex: 1, backgroundColor: colors.surface, borderRadius: 16, padding: 14,
        alignItems: 'center', gap: 6,
        shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
    },
    statCardValue: { fontFamily: Fonts.black, fontSize: 18, color: colors.text },
    statCardLabel: { fontFamily: Fonts.regular, fontSize: 12, color: colors.textMuted },
});