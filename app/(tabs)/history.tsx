import React, { useState, useEffect, useCallback } from 'react';
import {
    View, Text, StyleSheet, FlatList, RefreshControl,
    ActivityIndicator, TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { colors, Fonts } from '@/constants/colors';
import { useAuth } from '@/contexts/auth-context';
import { DriverService } from '@/services/driver.service';
import { FoodDriverService } from '@/services/food-driver.service';
import { GroceryDriverService } from '@/services/grocery-driver.service';
import { FoodOrder, GroceryOrder, Ride } from '@/types';
import { useTranslation } from 'react-i18next';

type DomainFilter = 'all' | 'rides' | 'food' | 'grocery';
type StatusFilter = 'all' | 'completed' | 'cancelled';

type UnifiedHistoryItem =
    | { domain: 'transport'; data: Ride }
    | { domain: 'food'; data: FoodOrder }
    | { domain: 'grocery'; data: GroceryOrder };

export default function HistoryScreen() {
    const insets = useSafeAreaInsets();
    const { driver } = useAuth();
    const { t } = useTranslation();

    const [domainFilter, setDomainFilter] = useState<DomainFilter>('all');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
    const [historyItems, setHistoryItems] = useState<UnifiedHistoryItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    const SERVICE_LABELS: Record<string, string> = {
        taxi_bike: 'Bike Taxi', taxi_auto: 'Auto', taxi_car: 'Cab',
        log_bike: 'Bike Logistics', log_mini_truck: 'Mini Truck', log_truck: 'Truck',
        parcel: 'Parcel', bike_taxi: 'Bike Taxi', custom: 'Custom',
    };

    const loadHistory = useCallback(async () => {
        if (!driver?.id) return;
        try {
            const [rides, foodOrders, groceryOrders] = await Promise.all([
                DriverService.getRideHistory(driver.id),
                FoodDriverService.getOrderHistory(),
                GroceryDriverService.getOrderHistory(),
            ]);

            const combined: UnifiedHistoryItem[] = [
                ...rides.map((r): UnifiedHistoryItem => ({ domain: 'transport', data: r })),
                ...foodOrders.map((f): UnifiedHistoryItem => ({ domain: 'food', data: f })),
                ...groceryOrders.map((g): UnifiedHistoryItem => ({ domain: 'grocery', data: g })),
            ];

            // Sort by created_at descending
            combined.sort((a, b) => new Date(b.data.created_at).getTime() - new Date(a.data.created_at).getTime());

            setHistoryItems(combined);
        } catch (e) {
            console.warn('[HistoryScreen] Failed to load history:', e);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [driver?.id]);

    useEffect(() => {
        loadHistory();
    }, [loadHistory]);

    // Apply filters
    const filteredItems = historyItems.filter((item) => {
        // 1. Domain Filter
        if (domainFilter === 'rides' && item.domain !== 'transport') return false;
        if (domainFilter === 'food' && item.domain !== 'food') return false;
        if (domainFilter === 'grocery' && item.domain !== 'grocery') return false;

        // 2. Status Filter
        const status = item.data.status;
        const isDone = status === 'completed' || status === 'delivered';
        const isCancel = status === 'cancelled';

        if (statusFilter === 'completed' && !isDone) return false;
        if (statusFilter === 'cancelled' && !isCancel) return false;

        return true;
    });

    const totalEarned = historyItems.reduce((sum, item) => {
        const isDone = item.data.status === 'completed' || item.data.status === 'delivered';
        if (!isDone) return sum;
        if (item.domain === 'transport') {
            return sum + Math.round((item.data as Ride).fare || 0);
        } else {
            return sum + Math.round((item.data as FoodOrder).delivery_fee || 35);
        }
    }, 0);

    const renderItem = ({ item }: { item: UnifiedHistoryItem }) => {
        if (item.domain === 'transport') {
            const ride = item.data as Ride;
            const isCompleted = ride.status === 'completed';
            return (
                <View style={styles.card}>
                    <View style={styles.cardHeader}>
                        <View style={styles.leftHeader}>
                            <View style={[styles.domainChip, { backgroundColor: '#EFF6FF' }]}>
                                <Feather name="navigation" size={12} color="#2563EB" />
                                <Text style={[styles.domainChipText, { color: '#2563EB' }]}>RIDE</Text>
                            </View>
                            <Text style={styles.serviceLabel}>{SERVICE_LABELS[ride.service_type] ?? ride.service_type}</Text>
                        </View>
                        <View style={styles.rightHeader}>
                            <Text style={styles.fare}>₹{isCompleted ? Math.round(ride.fare) : 0}</Text>
                            <View style={[styles.statusBadge, isCompleted ? styles.statusDone : styles.statusCancel]}>
                                <Text style={[styles.statusText, isCompleted ? styles.statusTextDone : styles.statusTextCancel]}>
                                    {isCompleted ? 'Completed' : 'Cancelled'}
                                </Text>
                            </View>
                        </View>
                    </View>

                    <Text style={styles.date}>{format(new Date(ride.created_at), 'dd MMM yyyy, hh:mm a')}</Text>
                    <View style={styles.divider} />

                    <View style={styles.routeInfo}>
                        <View style={styles.routeRow}>
                            <View style={[styles.routeDot, { backgroundColor: '#10B981' }]} />
                            <Text style={styles.routeText} numberOfLines={1}>{ride.pickup_address}</Text>
                        </View>
                        <View style={styles.routeConnector} />
                        <View style={styles.routeRow}>
                            <View style={[styles.routeDot, { backgroundColor: '#EF4444' }]} />
                            <Text style={styles.routeText} numberOfLines={1}>{ride.drop_address}</Text>
                        </View>
                    </View>
                </View>
            );
        }

        // Food & Grocery orders
        const isFood = item.domain === 'food';
        const order = item.data as FoodOrder | GroceryOrder;
        const isDelivered = order.status === 'delivered';
        const brandColor = isFood ? '#FF6B35' : '#10B981';

        return (
            <View style={styles.card}>
                <View style={styles.cardHeader}>
                    <View style={styles.leftHeader}>
                        <View style={[styles.domainChip, { backgroundColor: isFood ? '#FFF7ED' : '#ECFDF5' }]}>
                            <MaterialCommunityIcons
                                name={isFood ? 'food-fork-drink' : 'shopping'}
                                size={12}
                                color={brandColor}
                            />
                            <Text style={[styles.domainChipText, { color: brandColor }]}>
                                {isFood ? 'FOOD' : 'GROCERY'}
                            </Text>
                        </View>
                        <Text style={styles.serviceLabel}>{order.store?.name || (isFood ? 'Restaurant' : 'Supermarket')}</Text>
                    </View>
                    <View style={styles.rightHeader}>
                        <Text style={styles.fare}>₹{isDelivered ? Math.round(order.delivery_fee || 35) : 0}</Text>
                        <View style={[styles.statusBadge, isDelivered ? styles.statusDone : styles.statusCancel]}>
                            <Text style={[styles.statusText, isDelivered ? styles.statusTextDone : styles.statusTextCancel]}>
                                {isDelivered ? 'Delivered' : 'Cancelled'}
                            </Text>
                        </View>
                    </View>
                </View>

                <Text style={styles.date}>{format(new Date(order.created_at), 'dd MMM yyyy, hh:mm a')}</Text>
                <View style={styles.divider} />

                <View style={styles.routeInfo}>
                    <View style={styles.routeRow}>
                        <View style={[styles.routeDot, { backgroundColor: '#8B5CF6' }]} />
                        <Text style={styles.routeText} numberOfLines={1}>{order.store?.address || 'Store Location'}</Text>
                    </View>
                    <View style={styles.routeConnector} />
                    <View style={styles.routeRow}>
                        <View style={[styles.routeDot, { backgroundColor: '#10B981' }]} />
                        <Text style={styles.routeText} numberOfLines={1}>{order.delivery_address}</Text>
                    </View>
                </View>
            </View>
        );
    };

    return (
        <View style={[styles.container, { paddingTop: insets.top }]}>
            {/* Header */}
            <View style={styles.header}>
                <Text style={styles.headerTitle}>History & Trips</Text>
                <View style={styles.earningsChip}>
                    <Feather name="trending-up" size={14} color="#10B981" />
                    <Text style={styles.earningsChipText}>₹{totalEarned} Total</Text>
                </View>
            </View>

            {/* Domain Filters */}
            <View style={styles.filterRow}>
                {(['all', 'rides', 'food', 'grocery'] as DomainFilter[]).map((df) => (
                    <TouchableOpacity
                        key={df}
                        style={[styles.filterChip, domainFilter === df && styles.filterChipActive]}
                        onPress={() => setDomainFilter(df)}
                    >
                        <Text style={[styles.filterChipText, domainFilter === df && styles.filterChipTextActive]}>
                            {df.toUpperCase()}
                        </Text>
                    </TouchableOpacity>
                ))}
            </View>

            {/* Status Sub-Filters */}
            <View style={styles.statusFilterRow}>
                {(['all', 'completed', 'cancelled'] as StatusFilter[]).map((sf) => (
                    <TouchableOpacity
                        key={sf}
                        style={[styles.statusSubBtn, statusFilter === sf && styles.statusSubBtnActive]}
                        onPress={() => setStatusFilter(sf)}
                    >
                        <Text style={[styles.statusSubText, statusFilter === sf && styles.statusSubTextActive]}>
                            {sf === 'all' ? 'All Status' : sf === 'completed' ? 'Completed' : 'Cancelled'}
                        </Text>
                    </TouchableOpacity>
                ))}
            </View>

            {loading ? (
                <View style={styles.center}>
                    <ActivityIndicator size="large" color="#FF6B35" />
                </View>
            ) : (
                <FlatList
                    data={filteredItems}
                    keyExtractor={(item) => `${item.domain}_${item.data.id}`}
                    renderItem={renderItem}
                    contentContainerStyle={styles.list}
                    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadHistory(); }} tintColor="#FF6B35" />}
                    showsVerticalScrollIndicator={false}
                    ListEmptyComponent={
                        <View style={styles.emptyState}>
                            <Feather name="inbox" size={48} color="#94A3B8" />
                            <Text style={styles.emptyTitle}>No Trips Found</Text>
                            <Text style={styles.emptySubtitle}>Completed rides and deliveries will appear here.</Text>
                        </View>
                    }
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#0B0F19' },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 20, paddingVertical: 14,
        backgroundColor: '#0F172A', borderBottomWidth: 1, borderBottomColor: '#1E293B',
    },
    headerTitle: { fontFamily: Fonts.bold, fontSize: 20, color: '#F8FAFC' },
    earningsChip: {
        flexDirection: 'row', alignItems: 'center', gap: 6,
        backgroundColor: '#064E3B', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6,
    },
    earningsChipText: { fontFamily: Fonts.bold, fontSize: 13, color: '#34D399' },

    filterRow: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 12, gap: 8 },
    filterChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, backgroundColor: '#1E293B' },
    filterChipActive: { backgroundColor: '#FF6B35' },
    filterChipText: { fontFamily: Fonts.bold, fontSize: 11, color: '#94A3B8' },
    filterChipTextActive: { color: '#fff' },

    statusFilterRow: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 10, gap: 8, borderBottomWidth: 1, borderBottomColor: '#1E293B' },
    statusSubBtn: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12, backgroundColor: 'transparent' },
    statusSubBtnActive: { backgroundColor: '#334155' },
    statusSubText: { fontFamily: Fonts.medium, fontSize: 12, color: '#64748B' },
    statusSubTextActive: { color: '#F8FAFC', fontFamily: Fonts.bold },

    list: { padding: 16, paddingBottom: 32 },
    card: {
        backgroundColor: '#1E293B', borderRadius: 16, padding: 16, marginBottom: 12,
        borderWidth: 1, borderColor: '#334155',
    },
    cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    leftHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
    domainChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
    domainChipText: { fontFamily: Fonts.bold, fontSize: 10 },
    serviceLabel: { fontFamily: Fonts.bold, fontSize: 15, color: '#F8FAFC', flex: 1 },
    rightHeader: { alignItems: 'flex-end' },
    fare: { fontFamily: Fonts.black, fontSize: 16, color: '#F8FAFC' },
    statusBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, marginTop: 4 },
    statusDone: { backgroundColor: '#064E3B' },
    statusCancel: { backgroundColor: '#450A0A' },
    statusText: { fontFamily: Fonts.bold, fontSize: 10 },
    statusTextDone: { color: '#34D399' },
    statusTextCancel: { color: '#F87171' },

    date: { fontFamily: Fonts.regular, fontSize: 12, color: '#64748B', marginTop: 4 },
    divider: { height: 1, backgroundColor: '#334155', marginVertical: 12 },

    routeInfo: { gap: 4 },
    routeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    routeDot: { width: 8, height: 8, borderRadius: 4 },
    routeConnector: { width: 2, height: 10, backgroundColor: '#334155', marginLeft: 3 },
    routeText: { fontFamily: Fonts.medium, fontSize: 13, color: '#CBD5E1', flex: 1 },

    emptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
    emptyTitle: { fontFamily: Fonts.bold, fontSize: 16, color: '#F8FAFC', marginTop: 12 },
    emptySubtitle: { fontFamily: Fonts.regular, fontSize: 13, color: '#64748B', marginTop: 4, textAlign: 'center' },
});
