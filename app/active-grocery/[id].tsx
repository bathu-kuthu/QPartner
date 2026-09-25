import React, { useState, useEffect, useRef } from 'react';
import {
    View, Text, TouchableOpacity, StyleSheet, Alert,
    Linking, ActivityIndicator, BackHandler, AppState, AppStateStatus,
    ScrollView, Platform, Modal
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, Fonts } from '@/constants/colors';
import { GroceryDriverService } from '@/services/grocery-driver.service';
import { useAuth } from '@/contexts/auth-context';
import { GroceryOrder } from '@/types';
import { NotificationService } from '@/services/notification.service';

export default function ActiveGroceryDeliveryScreen() {
    const insets = useSafeAreaInsets();
    const { id } = useLocalSearchParams<{ id: string }>();
    const { driver, setDriverData } = useAuth();

    const [order, setOrder] = useState<GroceryOrder | null>(null);
    const [loading, setLoading] = useState(true);
    const [updating, setUpdating] = useState(false);
    const [netError, setNetError] = useState(false);
    const [showCompletionModal, setShowCompletionModal] = useState(false);
    const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});

    const channelRef = useRef<any>(null);

    // ── Block hardware back — driver cannot leave mid-delivery ───────────────
    useEffect(() => {
        const handler = BackHandler.addEventListener('hardwareBackPress', () => {
            Alert.alert(
                'Delivery in Progress',
                'You cannot exit during an active grocery delivery. Please complete the delivery.',
                [{ text: 'OK' }]
            );
            return true;
        });
        return () => handler.remove();
    }, []);

    // ── Reload when app comes back to foreground ───────────────────────────
    useEffect(() => {
        const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
            if (state === 'active') loadOrder();
        });
        return () => sub.remove();
    }, [id]);

    // ── Load order details ──────────────────────────────────────────────────
    const loadOrder = async () => {
        if (!id) return;
        setNetError(false);
        try {
            const data = await GroceryDriverService.getOrderById(id);
            if (data) {
                setOrder(data);
                if (data.status === 'delivered') {
                    setShowCompletionModal(true);
                }
            } else {
                setNetError(true);
            }
        } catch (e: any) {
            if (e.message === 'NETWORK_ERROR') setNetError(true);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadOrder();
    }, [id]);

    // ── Realtime subscribe to grocery order updates ─────────────────────────
    useEffect(() => {
        if (!id) return;
        channelRef.current?.unsubscribe?.();
        channelRef.current = GroceryDriverService.subscribeToOrder(id, (updated) => {
            setOrder(updated);
            if (updated.status === 'delivered') {
                setShowCompletionModal(true);
            } else if (updated.status === 'cancelled') {
                Alert.alert('Order Cancelled', 'This order was cancelled by the customer or supermarket.', [
                    { text: 'OK', onPress: () => router.replace('/(tabs)/bookings') },
                ]);
            }
        });

        return () => {
            channelRef.current?.unsubscribe?.();
            channelRef.current = null;
        };
    }, [id]);

    const toggleItemCheck = (itemId: string) => {
        setCheckedItems((prev) => ({ ...prev, [itemId]: !prev[itemId] }));
    };

    const openMapsNavigation = (lat?: number | null, lng?: number | null, address?: string) => {
        if (lat && lng) {
            const url = Platform.select({
                ios: `maps://app?daddr=${lat},${lng}`,
                android: `google.navigation:q=${lat},${lng}`,
                default: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`,
            });
            Linking.canOpenURL(url!).then((supported) => {
                if (supported) {
                    Linking.openURL(url!);
                } else {
                    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address || `${lat},${lng}`)}`);
                }
            });
        } else if (address) {
            const encoded = encodeURIComponent(address);
            Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encoded}`);
        } else {
            Alert.alert('Location Unavailable', 'No coordinates or address available for navigation.');
        }
    };

    const makePhoneCall = (phoneNumber?: string | null) => {
        if (!phoneNumber) {
            Alert.alert('Not Available', 'Contact phone number is not available.');
            return;
        }
        Linking.openURL(`tel:${phoneNumber}`);
    };

    const handlePickupGrocery = async () => {
        if (!order || updating) return;
        setUpdating(true);
        try {
            const updated = await GroceryDriverService.updateOrderStatus(order.id, 'out_for_delivery');
            setOrder(updated);
            NotificationService.notifyRideStatus('Grocery Bags Collected! 🛒', 'Heading to customer delivery location.', order.id);
        } catch (e: any) {
            Alert.alert('Update Failed', e.message || 'Could not update status. Please try again.');
        } finally {
            setUpdating(false);
        }
    };

    const handleConfirmDelivery = () => {
        if (!order) return;
        Alert.alert(
            'Confirm Customer Handover',
            'Have you handed over all grocery bags to the customer?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Confirm Handover',
                    style: 'default',
                    onPress: async () => {
                        setUpdating(true);
                        try {
                            const updated = await GroceryDriverService.updateOrderStatus(order.id, 'delivered');
                            setOrder(updated);
                            if (driver) {
                                await setDriverData({ ...driver, total_rides: (driver.total_rides ?? 0) + 1 });
                            }
                            setShowCompletionModal(true);
                        } catch (e: any) {
                            Alert.alert('Delivery Confirmation Failed', e.message || 'Could not confirm delivery.');
                        } finally {
                            setUpdating(false);
                        }
                    },
                },
            ]
        );
    };

    if (loading) {
        return (
            <View style={[styles.center, { paddingTop: insets.top }]}>
                <ActivityIndicator size="large" color="#10B981" />
                <Text style={styles.loadingText}>Loading Grocery Delivery...</Text>
            </View>
        );
    }

    if (!order) {
        return (
            <View style={[styles.center, { paddingTop: insets.top }]}>
                <Feather name="alert-circle" size={48} color="#EF4444" />
                <Text style={styles.errorTitle}>Delivery Not Found</Text>
                <TouchableOpacity style={styles.retryBtn} onPress={() => router.replace('/(tabs)/bookings')}>
                    <Text style={styles.retryBtnText}>Return to Home</Text>
                </TouchableOpacity>
            </View>
        );
    }

    const isOutForDelivery = order.status === 'out_for_delivery';
    const storeLat = order.store_lat ?? order.store?.latitude;
    const storeLng = order.store_lng ?? order.store?.longitude;
    const items = Array.isArray(order.items) ? order.items : [];

    return (
        <View style={[styles.container, { paddingTop: insets.top }]}>
            {/* Header Stage Bar */}
            <View style={styles.header}>
                <View style={styles.stageIndicator}>
                    <View style={[styles.stageDot, { backgroundColor: '#10B981' }]} />
                    <Text style={styles.stageTitle}>
                        {isOutForDelivery ? 'ON THE WAY TO CUSTOMER' : 'HEAD TO STORE / HUB FOR PICKUP'}
                    </Text>
                </View>
                <View style={styles.orderIdBadge}>
                    <Text style={styles.orderIdText}>#{order.id.slice(0, 6).toUpperCase()}</Text>
                </View>
            </View>

            {netError && (
                <View style={styles.netBanner}>
                    <Feather name="wifi-off" size={14} color="#fff" />
                    <Text style={styles.netBannerText}>No internet connection. Tap to retry.</Text>
                    <TouchableOpacity onPress={loadOrder}>
                        <Text style={styles.netRetryText}>Retry</Text>
                    </TouchableOpacity>
                </View>
            )}

            <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
                {/* ── STAGE 1: Supermarket Pickup Card ──────────────────────────────── */}
                <View style={[styles.card, !isOutForDelivery && styles.cardActive]}>
                    <View style={styles.cardHeader}>
                        <View style={[styles.cardIconBox, { backgroundColor: '#DCFCE7' }]}>
                            <MaterialCommunityIcons name="shopping" size={20} color="#10B981" />
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.cardTag}>1. PICKUP STORE / HUB</Text>
                            <Text style={styles.cardTitle}>{order.store?.name || 'Supermarket'}</Text>
                        </View>
                        <TouchableOpacity
                            style={styles.callCircleBtn}
                            onPress={() => makePhoneCall(order.store?.phone)}
                        >
                            <Feather name="phone" size={18} color="#10B981" />
                        </TouchableOpacity>
                    </View>

                    <Text style={styles.addressLine}>{order.store?.address || 'Store location confirmed'}</Text>

                    <TouchableOpacity
                        style={styles.navBtn}
                        onPress={() => openMapsNavigation(storeLat, storeLng, order.store?.address)}
                    >
                        <Feather name="navigation" size={16} color="#fff" />
                        <Text style={styles.navBtnText}>Navigate to Store</Text>
                    </TouchableOpacity>

                    {/* Package / Items Checklist */}
                    <View style={styles.checklistSection}>
                        <Text style={styles.checklistTitle}>Grocery Items Checklist ({items.length})</Text>
                        {items.map((item, idx) => {
                            const isChecked = !!checkedItems[item.id || idx.toString()];
                            return (
                                <TouchableOpacity
                                    key={idx}
                                    style={styles.checkItemRow}
                                    onPress={() => toggleItemCheck(item.id || idx.toString())}
                                    activeOpacity={0.7}
                                >
                                    <MaterialCommunityIcons
                                        name={isChecked ? 'checkbox-marked' : 'checkbox-blank-outline'}
                                        size={22}
                                        color={isChecked ? '#10B981' : '#94A3B8'}
                                    />
                                    <View style={{ flex: 1, marginLeft: 10 }}>
                                        <Text style={[styles.itemName, isChecked && styles.itemCheckedText]}>
                                            {item.quantity}x {item.name}
                                        </Text>
                                    </View>
                                    <Text style={styles.itemPrice}>₹{item.price * (item.quantity || 1)}</Text>
                                </TouchableOpacity>
                            );
                        })}
                    </View>

                    {!isOutForDelivery && (
                        <TouchableOpacity
                            style={[styles.primaryActionBtn, updating && styles.btnDisabled]}
                            onPress={handlePickupGrocery}
                            disabled={updating}
                        >
                            {updating ? (
                                <ActivityIndicator color="#fff" />
                            ) : (
                                <>
                                    <Feather name="check" size={20} color="#fff" style={{ marginRight: 8 }} />
                                    <Text style={styles.primaryActionBtnText}>CONFIRM GROCERY PICKUP</Text>
                                </>
                            )}
                        </TouchableOpacity>
                    )}
                </View>

                {/* ── STAGE 2: Customer Delivery Card ───────────────────────────────── */}
                <View style={[styles.card, isOutForDelivery && styles.cardActive]}>
                    <View style={styles.cardHeader}>
                        <View style={[styles.cardIconBox, { backgroundColor: '#DCFCE7' }]}>
                            <Feather name="home" size={20} color="#10B981" />
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.cardTag}>2. CUSTOMER DELIVERY</Text>
                            <Text style={styles.cardTitle}>{order.customer_name || 'Customer'}</Text>
                        </View>
                        <TouchableOpacity
                            style={styles.callCircleBtn}
                            onPress={() => makePhoneCall(order.customer_phone)}
                        >
                            <Feather name="phone" size={18} color="#10B981" />
                        </TouchableOpacity>
                    </View>

                    <Text style={styles.addressLine}>{order.delivery_address}</Text>

                    {order.notes && (
                        <View style={styles.notesBox}>
                            <Feather name="info" size={14} color="#D97706" />
                            <Text style={styles.notesText}>{order.notes}</Text>
                        </View>
                    )}

                    <View style={styles.paymentInfoRow}>
                        <Text style={styles.paymentLabel}>Payment Status:</Text>
                        <View style={[styles.payBadge, order.payment_method === 'cod' ? styles.codBadge : styles.paidBadge]}>
                            <Text style={styles.payBadgeText}>
                                {order.payment_method === 'cod' ? `Collect Cash: ₹${order.total}` : 'PAID ONLINE'}
                            </Text>
                        </View>
                    </View>

                    <TouchableOpacity
                        style={[styles.navBtn, { backgroundColor: '#10B981' }]}
                        onPress={() => openMapsNavigation(order.delivery_lat, order.delivery_lng, order.delivery_address)}
                    >
                        <Feather name="navigation" size={16} color="#fff" />
                        <Text style={styles.navBtnText}>Navigate to Customer</Text>
                    </TouchableOpacity>

                    {isOutForDelivery && (
                        <TouchableOpacity
                            style={[styles.completeActionBtn, updating && styles.btnDisabled]}
                            onPress={handleConfirmDelivery}
                            disabled={updating}
                        >
                            {updating ? (
                                <ActivityIndicator color="#fff" />
                            ) : (
                                <>
                                    <Feather name="check-circle" size={22} color="#fff" style={{ marginRight: 8 }} />
                                    <Text style={styles.completeActionBtnText}>CONFIRM DELIVERY COMPLETE</Text>
                                </>
                            )}
                        </TouchableOpacity>
                    )}
                </View>
            </ScrollView>

            {/* Completion Modal */}
            <Modal visible={showCompletionModal} animationType="fade" transparent>
                <View style={styles.modalOverlay}>
                    <View style={styles.modalContent}>
                        <View style={styles.successIconBox}>
                            <Feather name="check" size={40} color="#fff" />
                        </View>
                        <Text style={styles.modalTitle}>Delivery Completed! 🎉</Text>
                        <Text style={styles.modalSubtitle}>Grocery bags handed over successfully to the customer.</Text>

                        <View style={styles.earningBox}>
                            <Text style={styles.earningLabel}>You Earned</Text>
                            <Text style={styles.earningAmount}>₹{order.delivery_fee || 35}</Text>
                        </View>

                        <TouchableOpacity
                            style={styles.modalBtn}
                            onPress={() => router.replace('/(tabs)/bookings')}
                        >
                            <Text style={styles.modalBtnText}>Back to Bookings</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#0B0F19' },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0B0F19', padding: 24 },
    loadingText: { color: '#94A3B8', fontFamily: Fonts.medium, fontSize: 14, marginTop: 12 },
    errorTitle: { color: '#F8FAFC', fontFamily: Fonts.bold, fontSize: 18, marginTop: 12 },
    retryBtn: { marginTop: 16, backgroundColor: '#10B981', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12 },
    retryBtnText: { color: '#fff', fontFamily: Fonts.bold, fontSize: 14 },

    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1E293B' },
    stageIndicator: { flexDirection: 'row', alignItems: 'center' },
    stageDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
    stageTitle: { color: '#F8FAFC', fontFamily: Fonts.bold, fontSize: 12, letterSpacing: 0.5 },
    orderIdBadge: { backgroundColor: '#1E293B', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
    orderIdText: { color: '#94A3B8', fontFamily: Fonts.medium, fontSize: 11 },

    netBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#EF4444', padding: 8, paddingHorizontal: 16 },
    netBannerText: { color: '#fff', fontSize: 12, fontFamily: Fonts.medium, flex: 1, marginLeft: 8 },
    netRetryText: { color: '#fff', fontSize: 12, fontFamily: Fonts.bold, textDecorationLine: 'underline' },

    scroll: { flex: 1, padding: 16 },
    card: { backgroundColor: '#1E293B', borderRadius: 16, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#334155', opacity: 0.7 },
    cardActive: { opacity: 1, borderColor: '#10B981' },
    cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
    cardIconBox: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
    cardTag: { color: '#94A3B8', fontFamily: Fonts.bold, fontSize: 10, letterSpacing: 0.5 },
    cardTitle: { color: '#F8FAFC', fontFamily: Fonts.bold, fontSize: 16, marginTop: 2 },
    callCircleBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#334155', justifyContent: 'center', alignItems: 'center' },
    addressLine: { color: '#CBD5E1', fontFamily: Fonts.regular, fontSize: 13, lineHeight: 18, marginBottom: 12 },

    navBtn: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', backgroundColor: '#3B82F6', height: 44, borderRadius: 12, marginBottom: 12 },
    navBtnText: { color: '#fff', fontFamily: Fonts.bold, fontSize: 13, marginLeft: 8 },

    checklistSection: { backgroundColor: '#0F172A', borderRadius: 12, padding: 12, marginVertical: 8 },
    checklistTitle: { color: '#94A3B8', fontFamily: Fonts.bold, fontSize: 11, marginBottom: 8, textTransform: 'uppercase' },
    checkItemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1E293B' },
    itemName: { color: '#F8FAFC', fontFamily: Fonts.medium, fontSize: 13 },
    itemCheckedText: { textDecorationLine: 'line-through', color: '#64748B' },
    itemPrice: { color: '#94A3B8', fontFamily: Fonts.bold, fontSize: 12 },

    notesBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEF3C7', padding: 10, borderRadius: 8, marginBottom: 12 },
    notesText: { color: '#92400E', fontFamily: Fonts.medium, fontSize: 12, marginLeft: 6, flex: 1 },

    paymentInfoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
    paymentLabel: { color: '#94A3B8', fontFamily: Fonts.medium, fontSize: 13 },
    payBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
    paidBadge: { backgroundColor: '#064E3B' },
    codBadge: { backgroundColor: '#78350F' },
    payBadgeText: { color: '#fff', fontFamily: Fonts.bold, fontSize: 12 },

    primaryActionBtn: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', backgroundColor: '#10B981', height: 52, borderRadius: 14, marginTop: 8 },
    primaryActionBtnText: { color: '#fff', fontFamily: Fonts.black, fontSize: 15, letterSpacing: 0.5 },
    completeActionBtn: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', backgroundColor: '#10B981', height: 54, borderRadius: 14, marginTop: 8 },
    completeActionBtnText: { color: '#fff', fontFamily: Fonts.black, fontSize: 15, letterSpacing: 0.5 },
    btnDisabled: { opacity: 0.6 },

    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center', padding: 24 },
    modalContent: { backgroundColor: '#1E293B', borderRadius: 24, padding: 24, alignItems: 'center', width: '100%', maxWidth: 360, borderWidth: 1, borderColor: '#334155' },
    successIconBox: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#10B981', justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
    modalTitle: { color: '#F8FAFC', fontFamily: Fonts.black, fontSize: 20, marginBottom: 6 },
    modalSubtitle: { color: '#94A3B8', fontFamily: Fonts.regular, fontSize: 13, textAlign: 'center', marginBottom: 20 },
    earningBox: { backgroundColor: '#0F172A', borderRadius: 16, padding: 16, width: '100%', alignItems: 'center', marginBottom: 20 },
    earningLabel: { color: '#94A3B8', fontFamily: Fonts.medium, fontSize: 12, textTransform: 'uppercase' },
    earningAmount: { color: '#10B981', fontFamily: Fonts.black, fontSize: 36, marginTop: 2 },
    modalBtn: { backgroundColor: '#10B981', height: 48, borderRadius: 14, justifyContent: 'center', alignItems: 'center', width: '100%' },
    modalBtnText: { color: '#fff', fontFamily: Fonts.bold, fontSize: 15 },
});
