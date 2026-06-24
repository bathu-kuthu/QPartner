import React, { useState, useEffect, useRef } from 'react';
import {
    View, Text, StyleSheet, Animated, TouchableOpacity,
    Platform, Linking,
} from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import * as Location from 'expo-location';
import { Feather } from '@expo/vector-icons';
import { colors, Fonts } from '@/constants/colors';

type BannerType = 'internet_lost' | 'internet_back' | 'location_off' | 'location_permission' | null;

export function GlobalStatusBanner() {
    const [banner, setBanner] = useState<BannerType>(null);
    const slideAnim = useRef(new Animated.Value(-60)).current;
    const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const wasOffline = useRef(false);

    // ── Internet monitoring ───────────────────────────────────────────────
    useEffect(() => {
        const unsubscribe = NetInfo.addEventListener((state) => {
            if (!state.isConnected) {
                wasOffline.current = true;
                showBanner('internet_lost');
            } else if (wasOffline.current) {
                wasOffline.current = false;
                showBanner('internet_back');
                // Auto-hide "Back Online" after 3 seconds
                if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
                hideTimerRef.current = setTimeout(() => hideBanner(), 3000);
            }
        });

        return () => {
            unsubscribe();
            if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
        };
    }, []);

    // ── Location monitoring ───────────────────────────────────────────────
    useEffect(() => {
        let interval: ReturnType<typeof setInterval> | null = null;

        const checkLocation = async () => {
            try {
                // Check if location services are enabled on the device
                const enabled = await Location.hasServicesEnabledAsync();
                if (!enabled) {
                    // Don't override the internet_lost banner (higher priority)
                    setBanner((prev) => prev === 'internet_lost' ? prev : 'location_off');
                    showBanner('location_off');
                    return;
                }

                // Check if permission is still granted
                const { status } = await Location.getForegroundPermissionsAsync();
                if (status !== 'granted') {
                    setBanner((prev) => prev === 'internet_lost' ? prev : 'location_permission');
                    showBanner('location_permission');
                    return;
                }

                // Location is fine — hide the location-related banner if showing
                setBanner((prev) => {
                    if (prev === 'location_off' || prev === 'location_permission') {
                        hideBanner();
                        return null;
                    }
                    return prev;
                });
            } catch {
                // Silently ignore
            }
        };

        // Check immediately and then every 5 seconds
        checkLocation();
        interval = setInterval(checkLocation, 5000);

        return () => {
            if (interval) clearInterval(interval);
        };
    }, []);

    // ── Animation helpers ─────────────────────────────────────────────────
    const showBanner = (type: BannerType) => {
        setBanner(type);
        Animated.spring(slideAnim, {
            toValue: 0,
            useNativeDriver: true,
            tension: 80,
            friction: 12,
        }).start();
    };

    const hideBanner = () => {
        Animated.timing(slideAnim, {
            toValue: -60,
            duration: 250,
            useNativeDriver: true,
        }).start(() => setBanner(null));
    };

    // ── Banner config ─────────────────────────────────────────────────────
    const getBannerConfig = () => {
        switch (banner) {
            case 'internet_lost':
                return {
                    icon: 'wifi-off' as const,
                    text: 'No Internet Connection',
                    bg: colors.error,
                    action: null,
                };
            case 'internet_back':
                return {
                    icon: 'wifi' as const,
                    text: 'Back Online',
                    bg: colors.success,
                    action: null,
                };
            case 'location_off':
                return {
                    icon: 'map-pin' as const,
                    text: 'Location Services Off',
                    bg: colors.warning,
                    action: {
                        label: 'Turn On',
                        onPress: () => {
                            if (Platform.OS === 'android') {
                                Linking.openSettings();
                            } else {
                                Linking.openURL('app-settings:');
                            }
                        },
                    },
                };
            case 'location_permission':
                return {
                    icon: 'shield-off' as const,
                    text: 'Location Permission Required',
                    bg: '#E65100',
                    action: {
                        label: 'Grant',
                        onPress: async () => {
                            const { status } = await Location.requestForegroundPermissionsAsync();
                            if (status === 'granted') {
                                hideBanner();
                            } else {
                                // If denied, open settings
                                Linking.openSettings();
                            }
                        },
                    },
                };
            default:
                return null;
        }
    };

    const config = getBannerConfig();
    if (!config) return null;

    return (
        <Animated.View
            style={[
                styles.banner,
                { backgroundColor: config.bg, transform: [{ translateY: slideAnim }] },
            ]}
        >
            <Feather name={config.icon} size={16} color={colors.white} />
            <Text style={styles.bannerText}>{config.text}</Text>
            {config.action && (
                <TouchableOpacity
                    style={styles.bannerAction}
                    onPress={config.action.onPress}
                    activeOpacity={0.7}
                >
                    <Text style={styles.bannerActionText}>{config.action.label}</Text>
                </TouchableOpacity>
            )}
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    banner: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 16,
        paddingVertical: 10,
        zIndex: 999,
    },
    bannerText: {
        flex: 1,
        fontFamily: Fonts.medium,
        fontSize: 13,
        color: colors.white,
    },
    bannerAction: {
        backgroundColor: 'rgba(255,255,255,0.25)',
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 5,
    },
    bannerActionText: {
        fontFamily: Fonts.bold,
        fontSize: 12,
        color: colors.white,
    },
});
