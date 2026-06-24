import React, { useEffect, useState, useRef } from 'react';
import {
    View, Text, StyleSheet, Modal, TouchableOpacity,
    Vibration, Animated, Dimensions, Platform
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, Fonts } from '@/constants/colors';
import { NativeBridgeService } from '@/services/native-bridge.service';

const { width, height } = Dimensions.get('window');

const SERVICE_INFO: Record<string, { label: string; icon: string; color: string }> = {
    taxi_bike: { label: 'Bike Taxi', icon: '🏍️', color: '#FF6B35' },
    taxi_auto: { label: 'Auto', icon: '🛺', color: '#2196F3' },
    taxi_car: { label: 'Cab', icon: '🚗', color: '#4CAF50' },
    log_bike: { label: 'Bike Delivery', icon: '🏍️', color: '#FF6B35' },
    log_mini_truck: { label: 'Mini Truck', icon: '🛻', color: '#9C27B0' },
    log_truck: { label: 'Truck', icon: '🚚', color: '#795548' },
    parcel: { label: 'Parcel', icon: '📦', color: '#FF9800' },
    bike_taxi: { label: 'Bike Taxi', icon: '🏍️', color: '#FF6B35' },
};

interface GlobalRideAlertModalProps {
    visible: boolean;
    ride: any; // Ride object
    driverLat?: number;
    driverLng?: number;
    onAccept: (rideId: string) => Promise<void>;
    onDecline: () => void;
}

export function GlobalRideAlertModal({
    visible,
    ride,
    driverLat,
    driverLng,
    onAccept,
    onDecline
}: GlobalRideAlertModalProps) {
    const [timeLeft, setTimeLeft] = useState(30);
    const [loading, setLoading] = useState(false);
    
    // Animations
    const pulseAnim = useRef(new Animated.Value(1)).current;
    const progressAnim = useRef(new Animated.Value(1)).current;

    useEffect(() => {
        if (!visible || !ride) return;

        // Reset state
        setTimeLeft(30);
        setLoading(false);
        progressAnim.setValue(1);

        // 1. Continuous Vibration and Ringing
        const vibrationPattern = [1000, 1000, 1000, 1000];
        Vibration.vibrate(vibrationPattern, true);
        NativeBridgeService.startRinging();

        // 2. Play Haptics periodically
        const hapticInterval = setInterval(() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        }, 1500);

        // 3. Countdown timer
        const timer = setInterval(() => {
            setTimeLeft((prev) => {
                if (prev <= 1) {
                    clearInterval(timer);
                    clearInterval(hapticInterval);
                    Vibration.cancel();
                    NativeBridgeService.stopRinging();
                    onDecline();
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);

        // 4. Progress bar animation
        Animated.timing(progressAnim, {
            toValue: 0,
            duration: 30000,
            useNativeDriver: false,
        }).start();

        // 5. Pulsing animation for Accept button
        Animated.loop(
            Animated.sequence([
                Animated.timing(pulseAnim, {
                    toValue: 1.1,
                    duration: 800,
                    useNativeDriver: true,
                }),
                Animated.timing(pulseAnim, {
                    toValue: 1.0,
                    duration: 800,
                    useNativeDriver: true,
                }),
            ])
        ).start();

        return () => {
            clearInterval(timer);
            clearInterval(hapticInterval);
            Vibration.cancel();
            NativeBridgeService.stopRinging();
        };
    }, [visible, ride]);

    if (!visible || !ride) return null;

    const svc = SERVICE_INFO[ride.service_type] ?? { label: 'Ride Request', icon: '🚗', color: colors.primary };

    // Calculate distance from driver to pickup
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

    const handleAcceptPress = async () => {
        setLoading(true);
        Vibration.cancel();
        NativeBridgeService.stopRinging();
        try {
            await onAccept(ride.id);
        } catch (e) {
            setLoading(false);
        }
    };

    const handleDeclinePress = () => {
        Vibration.cancel();
        NativeBridgeService.stopRinging();
        onDecline();
    };

    return (
        <Modal
            transparent
            visible={visible}
            animationType="slide"
            statusBarTranslucent
        >
            <View style={styles.overlay}>
                <SafeAreaView edges={['bottom']}>
                    <View style={styles.card}>
                        {/* Header with Countdown */}
                        <View style={styles.header}>
                            <View style={[styles.serviceBadge, { backgroundColor: svc.color + '20' }]}>
                                <Text style={styles.serviceIcon}>{svc.icon}</Text>
                                <Text style={[styles.serviceLabel, { color: svc.color }]}>{svc.label}</Text>
                            </View>
                            <View style={styles.timerBadge}>
                                <Feather name="clock" size={16} color={colors.error} />
                                <Text style={styles.timerText}>{timeLeft}s</Text>
                            </View>
                        </View>

                        {/* Progress Bar */}
                        <View style={styles.progressBarBg}>
                            <Animated.View
                                style={[
                                    styles.progressBarFill,
                                    {
                                        width: progressAnim.interpolate({
                                            inputRange: [0, 1],
                                            outputRange: ['0%', '100%'],
                                        }),
                                        backgroundColor: timeLeft > 10 ? colors.success : colors.error,
                                    },
                                ]}
                            />
                        </View>

                        {/* Fare */}
                        <View style={styles.fareContainer}>
                            <Text style={styles.fareLabel}>ESTIMATED EARNING</Text>
                            <Text style={styles.fareValue}>₹{ride.fare}</Text>
                        </View>

                        {/* Route Details */}
                        <View style={styles.routeContainer}>
                            <View style={styles.routeRow}>
                                <View style={[styles.routeDot, { backgroundColor: colors.success }]} />
                                <View style={styles.addressBox}>
                                    <Text style={styles.addressTitle}>PICKUP</Text>
                                    <Text style={styles.addressText} numberOfLines={2}>{ride.pickup_address}</Text>
                                </View>
                            </View>
                            
                            <View style={styles.routeLine} />

                            <View style={styles.routeRow}>
                                <View style={[styles.routeDot, { backgroundColor: colors.error }]} />
                                <View style={styles.addressBox}>
                                    <Text style={styles.addressTitle}>DROP</Text>
                                    <Text style={styles.addressText} numberOfLines={2}>{ride.drop_address}</Text>
                                </View>
                            </View>
                        </View>

                        {/* Ride Stats */}
                        <View style={styles.statsRow}>
                            <View style={styles.statCard}>
                                <Feather name="map-pin" size={18} color={colors.textSecondary} />
                                <Text style={styles.statVal}>{ride.distance_km} km</Text>
                                <Text style={styles.statLbl}>Trip Distance</Text>
                            </View>

                            {pickupDist && (
                                <View style={styles.statCard}>
                                    <Feather name="navigation" size={18} color={colors.primary} />
                                    <Text style={[styles.statVal, { color: colors.primary }]}>{pickupDist}</Text>
                                    <Text style={styles.statLbl}>To Pickup</Text>
                                </View>
                            )}
                        </View>

                        {/* Details Box */}
                        {ride.details ? (
                            <View style={styles.detailsBox}>
                                <Feather name="info" size={14} color={colors.primary} />
                                <Text style={styles.detailsText} numberOfLines={2}>{ride.details}</Text>
                            </View>
                        ) : null}

                        {/* Actions */}
                        <View style={styles.actionsRow}>
                            <TouchableOpacity
                                style={styles.declineButton}
                                onPress={handleDeclinePress}
                                disabled={loading}
                            >
                                <Feather name="x" size={24} color={colors.textSecondary} />
                                <Text style={styles.declineText}>Decline</Text>
                            </TouchableOpacity>

                            <Animated.View style={{ flex: 1.5, transform: [{ scale: pulseAnim }] }}>
                                <TouchableOpacity
                                    style={styles.acceptButton}
                                    onPress={handleAcceptPress}
                                    disabled={loading}
                                >
                                    <Feather name="check" size={26} color={colors.white} />
                                    <Text style={styles.acceptText}>
                                        {loading ? 'Accepting...' : 'ACCEPT'}
                                    </Text>
                                </TouchableOpacity>
                            </Animated.View>
                        </View>
                    </View>
                </SafeAreaView>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(11, 31, 58, 0.85)',
        justifyContent: 'flex-end',
        alignItems: 'center',
    },
    card: {
        width: width,
        backgroundColor: colors.surface,
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        paddingHorizontal: 20,
        paddingTop: 24,
        paddingBottom: Platform.OS === 'ios' ? 44 : 28,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -10 },
        shadowOpacity: 0.15,
        shadowRadius: 10,
        elevation: 20,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
    },
    serviceBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        borderRadius: 20,
        paddingHorizontal: 14,
        paddingVertical: 6,
    },
    serviceIcon: {
        fontSize: 16,
    },
    serviceLabel: {
        fontFamily: Fonts.bold,
        fontSize: 14,
    },
    timerBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: colors.errorLight,
        borderRadius: 20,
        paddingHorizontal: 12,
        paddingVertical: 6,
    },
    timerText: {
        fontFamily: Fonts.bold,
        fontSize: 14,
        color: colors.error,
    },
    progressBarBg: {
        height: 6,
        backgroundColor: colors.border,
        borderRadius: 3,
        overflow: 'hidden',
        marginBottom: 20,
    },
    progressBarFill: {
        height: '100%',
        borderRadius: 3,
    },
    fareContainer: {
        alignItems: 'center',
        marginBottom: 24,
        backgroundColor: colors.surfaceLight,
        paddingVertical: 14,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.border,
    },
    fareLabel: {
        fontFamily: Fonts.bold,
        fontSize: 11,
        color: colors.textSecondary,
        letterSpacing: 1.5,
        marginBottom: 4,
    },
    fareValue: {
        fontFamily: Fonts.black,
        fontSize: 36,
        color: colors.success,
    },
    routeContainer: {
        marginBottom: 20,
        paddingHorizontal: 6,
    },
    routeRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 12,
    },
    routeDot: {
        width: 12,
        height: 12,
        borderRadius: 6,
        marginTop: 6,
    },
    addressBox: {
        flex: 1,
    },
    addressTitle: {
        fontFamily: Fonts.bold,
        fontSize: 10,
        color: colors.textMuted,
        letterSpacing: 1,
        marginBottom: 2,
    },
    addressText: {
        fontFamily: Fonts.medium,
        fontSize: 15,
        color: colors.text,
        lineHeight: 20,
    },
    routeLine: {
        width: 2,
        height: 24,
        backgroundColor: colors.border,
        marginLeft: 5,
        marginVertical: 4,
    },
    statsRow: {
        flexDirection: 'row',
        gap: 12,
        marginBottom: 20,
    },
    statCard: {
        flex: 1,
        backgroundColor: colors.surfaceLight,
        borderRadius: 16,
        padding: 12,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: colors.border,
    },
    statVal: {
        fontFamily: Fonts.bold,
        fontSize: 16,
        color: colors.text,
        marginTop: 6,
    },
    statLbl: {
        fontFamily: Fonts.regular,
        fontSize: 11,
        color: colors.textSecondary,
        marginTop: 2,
    },
    detailsBox: {
        flexDirection: 'row',
        gap: 8,
        backgroundColor: colors.primaryLight,
        borderRadius: 12,
        padding: 12,
        marginBottom: 24,
        alignItems: 'center',
    },
    detailsText: {
        flex: 1,
        fontFamily: Fonts.medium,
        fontSize: 13,
        color: colors.primary,
    },
    actionsRow: {
        flexDirection: 'row',
        gap: 14,
        alignItems: 'center',
    },
    declineButton: {
        flex: 1,
        height: 58,
        borderRadius: 18,
        borderWidth: 1.5,
        borderColor: colors.border,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: colors.surface,
    },
    declineText: {
        fontFamily: Fonts.bold,
        fontSize: 16,
        color: colors.textSecondary,
    },
    acceptButton: {
        height: 58,
        borderRadius: 18,
        backgroundColor: colors.success,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        shadowColor: colors.success,
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.35,
        shadowRadius: 8,
        elevation: 6,
    },
    acceptText: {
        fontFamily: Fonts.black,
        fontSize: 18,
        color: colors.white,
        letterSpacing: 1,
    },
});
