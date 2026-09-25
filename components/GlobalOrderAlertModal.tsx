import React, { useEffect, useState, useRef } from 'react';
import {
    View, Text, StyleSheet, Modal, TouchableOpacity,
    Vibration, Animated, Dimensions, Platform, ScrollView
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, Fonts } from '@/constants/colors';
import { NativeBridgeService } from '@/services/native-bridge.service';
import { FoodOrder, GroceryOrder } from '@/types';
import { haversineKm } from '@/services/driver.service';

const { width } = Dimensions.get('window');

interface GlobalOrderAlertModalProps {
    visible: boolean;
    domain: 'food' | 'grocery';
    order: FoodOrder | GroceryOrder | null;
    driverLat?: number;
    driverLng?: number;
    onAccept: (orderId: string, domain: 'food' | 'grocery') => Promise<void>;
    onDecline: () => void;
}

export function GlobalOrderAlertModal({
    visible,
    domain,
    order,
    driverLat,
    driverLng,
    onAccept,
    onDecline,
}: GlobalOrderAlertModalProps) {
    const [timeLeft, setTimeLeft] = useState(30);
    const [loading, setLoading] = useState(false);

    const pulseAnim = useRef(new Animated.Value(1)).current;
    const progressAnim = useRef(new Animated.Value(1)).current;

    useEffect(() => {
        if (!visible || !order) return;

        setTimeLeft(30);
        setLoading(false);
        progressAnim.setValue(1);

        // Continuous Vibration & Ringing
        const vibrationPattern = [1000, 1000, 1000, 1000];
        Vibration.vibrate(vibrationPattern, true);
        NativeBridgeService.startRinging();

        const hapticInterval = setInterval(() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        }, 1500);

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

        Animated.timing(progressAnim, {
            toValue: 0,
            duration: 30000,
            useNativeDriver: false,
        }).start();

        const pulseLoop = Animated.loop(
            Animated.sequence([
                Animated.timing(pulseAnim, {
                    toValue: 1.06,
                    duration: 800,
                    useNativeDriver: true,
                }),
                Animated.timing(pulseAnim, {
                    toValue: 1.0,
                    duration: 800,
                    useNativeDriver: true,
                }),
            ])
        );
        pulseLoop.start();

        return () => {
            clearInterval(timer);
            clearInterval(hapticInterval);
            Vibration.cancel();
            NativeBridgeService.stopRinging();
            pulseLoop.stop();
        };
    }, [visible, order]);

    if (!visible || !order) return null;

    const handleAccept = async () => {
        if (loading) return;
        setLoading(true);
        Vibration.cancel();
        NativeBridgeService.stopRinging();
        try {
            await onAccept(order.id, domain);
        } finally {
            setLoading(false);
        }
    };

    const handleDecline = () => {
        Vibration.cancel();
        NativeBridgeService.stopRinging();
        onDecline();
    };

    // Calculate pickup distance if driver coords available
    const storeLat = order.store_lat ?? order.store?.latitude;
    const storeLng = order.store_lng ?? order.store?.longitude;
    const pickupDistKm = (driverLat && driverLng && storeLat && storeLng)
        ? haversineKm(driverLat, driverLng, storeLat, storeLng).toFixed(1)
        : null;

    const isFood = domain === 'food';
    const domainColor = isFood ? '#FF6B35' : '#10B981';
    const domainLabel = isFood ? 'FOOD DELIVERY' : 'GROCERY DELIVERY';
    const domainIcon = isFood ? 'food-fork-drink' : 'shopping';

    const itemsCount = Array.isArray(order.items) ? order.items.reduce((sum, it) => sum + (it.quantity || 1), 0) : 1;
    const deliveryPayout = order.delivery_fee || 35;

    return (
        <Modal visible={visible} animationType="slide" transparent={false}>
            <SafeAreaView style={styles.container}>
                {/* Header Banner with animated progress bar */}
                <View style={styles.topHeader}>
                    <View style={styles.headerRow}>
                        <View style={[styles.domainBadge, { backgroundColor: domainColor }]}>
                            <MaterialCommunityIcons name={domainIcon} size={16} color="#fff" style={{ marginRight: 6 }} />
                            <Text style={styles.domainText}>{domainLabel}</Text>
                        </View>
                        <View style={styles.timerChip}>
                            <Feather name="clock" size={14} color="#EF4444" />
                            <Text style={styles.timerText}>{timeLeft}s</Text>
                        </View>
                    </View>
                    <View style={styles.progressBarBg}>
                        <Animated.View
                            style={[
                                styles.progressBarFill,
                                {
                                    backgroundColor: timeLeft > 10 ? domainColor : '#EF4444',
                                    width: progressAnim.interpolate({
                                        inputRange: [0, 1],
                                        outputRange: ['0%', '100%'],
                                    }),
                                },
                            ]}
                        />
                    </View>
                </View>

                <ScrollView style={styles.scrollContent} showsVerticalScrollIndicator={false}>
                    {/* Guaranteed Payout Hero Card */}
                    <View style={styles.payoutCard}>
                        <Text style={styles.payoutLabel}>Guaranteed Earning</Text>
                        <Text style={[styles.payoutAmount, { color: domainColor }]}>₹{deliveryPayout.toFixed(0)}</Text>
                        <View style={styles.payoutBadge}>
                            <Feather name="check-circle" size={12} color="#10B981" />
                            <Text style={styles.payoutBadgeText}>Direct Payout on Completion</Text>
                        </View>
                    </View>

                    {/* Store Card (Pickup) */}
                    <View style={styles.sectionCard}>
                        <View style={styles.sectionHeaderRow}>
                            <View style={[styles.stepIconBox, { backgroundColor: '#F3E8FF' }]}>
                                <Feather name="map-pin" size={18} color="#8B5CF6" />
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.sectionTag}>PICKUP LOCATION</Text>
                                <Text style={styles.storeName}>{order.store?.name || 'Partner Store'}</Text>
                            </View>
                            {pickupDistKm && (
                                <View style={styles.distChip}>
                                    <Text style={styles.distText}>{pickupDistKm} km away</Text>
                                </View>
                            )}
                        </View>
                        <Text style={styles.addressText} numberOfLines={2}>
                            {order.store?.address || 'Store location confirmed'}
                        </Text>
                    </View>

                    {/* Customer Dropoff Card */}
                    <View style={styles.sectionCard}>
                        <View style={styles.sectionHeaderRow}>
                            <View style={[styles.stepIconBox, { backgroundColor: '#DCFCE7' }]}>
                                <Feather name="navigation" size={18} color="#10B981" />
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.sectionTag}>CUSTOMER DROPOFF</Text>
                                <Text style={styles.customerAreaText}>
                                    {order.customer_name ? `Deliver to ${order.customer_name}` : 'Customer Address'}
                                </Text>
                            </View>
                            <View style={styles.paymentMethodChip}>
                                <Text style={styles.paymentMethodText}>
                                    {order.payment_method === 'cod' ? '💵 COD' : '💳 PAID ONLINE'}
                                </Text>
                            </View>
                        </View>
                        <Text style={styles.addressText} numberOfLines={2}>
                            {order.delivery_address}
                        </Text>
                    </View>

                    {/* Order Items Summary */}
                    <View style={styles.orderSummaryCard}>
                        <View style={styles.summaryRow}>
                            <View style={styles.summaryItem}>
                                <Feather name="package" size={16} color="#64748B" />
                                <Text style={styles.summaryLabel}>{itemsCount} {itemsCount === 1 ? 'Item' : 'Items'}</Text>
                            </View>
                            <View style={styles.summaryItem}>
                                <Feather name="shopping-bag" size={16} color="#64748B" />
                                <Text style={styles.summaryLabel}>Order Total: ₹{order.total || order.subtotal}</Text>
                            </View>
                        </View>
                    </View>
                </ScrollView>

                {/* Action Buttons */}
                <View style={styles.actionsFooter}>
                    <TouchableOpacity
                        style={styles.declineButton}
                        onPress={handleDecline}
                        disabled={loading}
                        activeOpacity={0.7}
                    >
                        <Feather name="x" size={20} color="#64748B" />
                        <Text style={styles.declineText}>Decline</Text>
                    </TouchableOpacity>

                    <Animated.View style={{ flex: 2, transform: [{ scale: pulseAnim }] }}>
                        <TouchableOpacity
                            style={[styles.acceptButton, { backgroundColor: domainColor }]}
                            onPress={handleAccept}
                            disabled={loading}
                            activeOpacity={0.8}
                        >
                            <Feather name="check" size={24} color="#fff" style={{ marginRight: 8 }} />
                            <Text style={styles.acceptText}>
                                {loading ? 'Accepting...' : 'ACCEPT DELIVERY'}
                            </Text>
                        </TouchableOpacity>
                    </Animated.View>
                </View>
            </SafeAreaView>
        </Modal>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#0B0F19' },
    topHeader: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
    headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
    domainBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
    domainText: { color: '#fff', fontFamily: Fonts.bold, fontSize: 12, letterSpacing: 0.5 },
    timerChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEE2E2', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 16 },
    timerText: { color: '#EF4444', fontFamily: Fonts.bold, fontSize: 13, marginLeft: 4 },
    progressBarBg: { height: 4, backgroundColor: '#1E293B', borderRadius: 2, overflow: 'hidden' },
    progressBarFill: { height: '100%' },

    scrollContent: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
    payoutCard: {
        backgroundColor: '#1E293B',
        borderRadius: 20,
        padding: 20,
        alignItems: 'center',
        marginVertical: 12,
        borderWidth: 1,
        borderColor: '#334155',
    },
    payoutLabel: { color: '#94A3B8', fontFamily: Fonts.medium, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.5 },
    payoutAmount: { fontFamily: Fonts.black, fontSize: 44, marginVertical: 4 },
    payoutBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#064E3B', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
    payoutBadgeText: { color: '#34D399', fontFamily: Fonts.medium, fontSize: 11, marginLeft: 4 },

    sectionCard: {
        backgroundColor: '#1E293B',
        borderRadius: 16,
        padding: 16,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: '#334155',
    },
    sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
    stepIconBox: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
    sectionTag: { color: '#94A3B8', fontFamily: Fonts.bold, fontSize: 10, letterSpacing: 0.5 },
    storeName: { color: '#F8FAFC', fontFamily: Fonts.bold, fontSize: 16, marginTop: 2 },
    customerAreaText: { color: '#F8FAFC', fontFamily: Fonts.bold, fontSize: 15, marginTop: 2 },
    addressText: { color: '#CBD5E1', fontFamily: Fonts.regular, fontSize: 13, lineHeight: 18, paddingLeft: 48 },
    distChip: { backgroundColor: '#334155', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
    distText: { color: '#E2E8F0', fontFamily: Fonts.medium, fontSize: 11 },
    paymentMethodChip: { backgroundColor: '#334155', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
    paymentMethodText: { color: '#E2E8F0', fontFamily: Fonts.bold, fontSize: 11 },

    orderSummaryCard: {
        backgroundColor: '#1E293B',
        borderRadius: 14,
        padding: 14,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: '#334155',
    },
    summaryRow: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' },
    summaryItem: { flexDirection: 'row', alignItems: 'center' },
    summaryLabel: { color: '#E2E8F0', fontFamily: Fonts.medium, fontSize: 13, marginLeft: 8 },

    actionsFooter: {
        flexDirection: 'row',
        padding: 16,
        backgroundColor: '#0F172A',
        borderTopWidth: 1,
        borderTopColor: '#1E293B',
        alignItems: 'center',
        gap: 12,
    },
    declineButton: {
        flex: 1,
        height: 56,
        backgroundColor: '#1E293B',
        borderRadius: 16,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#334155',
    },
    declineText: { color: '#94A3B8', fontFamily: Fonts.bold, fontSize: 15, marginLeft: 6 },
    acceptButton: {
        height: 56,
        borderRadius: 16,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#FF6B35',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 6,
    },
    acceptText: { color: '#fff', fontFamily: Fonts.black, fontSize: 16, letterSpacing: 0.5 },
});
