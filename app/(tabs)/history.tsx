import React, { useState, useEffect, useCallback } from 'react';
import {
    View, Text, StyleSheet, FlatList, RefreshControl,
    ActivityIndicator, TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { format } from 'date-fns';
import { colors, Fonts } from '@/constants/colors';
import { useAuth } from '@/contexts/auth-context';
import { DriverService } from '@/services/driver.service';
import { Ride } from '@/types';
import { useTranslation } from 'react-i18next';

type FilterType = 'all' | 'completed' | 'cancelled';

export default function HistoryScreen() {
    const insets = useSafeAreaInsets();
    const { driver } = useAuth();
    const { t } = useTranslation();
    const [rides, setRides] = useState<Ride[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [filter, setFilter] = useState<FilterType>('all');

    const SERVICE_LABELS: Record<string, string> = {
        taxi_bike: t('history.services.taxi_bike'), taxi_auto: t('history.services.taxi_auto'), taxi_car: t('history.services.taxi_car'),
        log_bike: t('history.services.log_bike'), log_mini_truck: t('history.services.log_mini_truck'), log_truck: t('history.services.log_truck'),
        parcel: t('history.services.parcel'), bike_taxi: t('history.services.bike_taxi'), custom: t('history.services.custom'),
    };

    const load = useCallback(async () => {
        if (!driver?.id) return;
        const data = await DriverService.getRideHistory(driver.id);
        setRides(data);
        setLoading(false);
        setRefreshing(false);
    }, [driver?.id]);

    useEffect(() => { load(); }, [load]);

    const filtered = rides.filter(r => filter === 'all' || r.status === filter);

    const totalEarned = rides
        .filter(r => r.status === 'completed')
        .reduce((sum, r) => sum + Math.round(r.fare), 0);

    const renderItem = ({ item }: { item: Ride }) => (
        <View style={styles.card}>
            <View style={styles.cardHeader}>
                <View style={styles.leftHeader}>
                    <Text style={styles.serviceLabel}>{SERVICE_LABELS[item.service_type] ?? item.service_type}</Text>
                    <Text style={styles.date}>{format(new Date(item.created_at), 'dd MMM, hh:mm a')}</Text>
                </View>
                <View style={styles.rightHeader}>
                    <Text style={styles.fare}>₹{item.status === 'completed' ? Math.round(item.fare) : 0}</Text>
                    <View style={[styles.statusBadge, item.status === 'completed' ? styles.statusDone : styles.statusCancel]}>
                        <Text style={[styles.statusText, item.status === 'completed' ? styles.statusTextDone : styles.statusTextCancel]}>
                            {item.status === 'completed' ? t('history.completed') : t('history.cancelled')}
                        </Text>
                    </View>
                </View>
            </View>

            <View style={styles.divider} />

            <View style={styles.routeInfo}>
                <View style={styles.routeRow}>
                    <View style={[styles.routeDot, { backgroundColor: colors.success }]} />
                    <Text style={styles.routeText} numberOfLines={1}>{item.pickup_address}</Text>
                </View>
                <View style={styles.routeConnector} />
                <View style={styles.routeRow}>
                    <View style={[styles.routeDot, { backgroundColor: colors.error }]} />
                    <Text style={styles.routeText} numberOfLines={1}>{item.drop_address}</Text>
                </View>
            </View>

            <View style={styles.metaRow}>
                <View style={styles.metaItem}>
                    <Feather name="map-pin" size={12} color={colors.textMuted} />
                    <Text style={styles.metaText}>{item.distance_km} km</Text>
                </View>
                {item.status === 'completed' && (
                    <View style={styles.metaItem}>
                        <Feather name="trending-up" size={12} color={colors.success} />
                        <Text style={[styles.metaText, { color: colors.success }]}>
                            {t('history.earned', { amount: Math.round(item.fare) })}
                        </Text>
                    </View>
                )}
            </View>
        </View>
    );

    return (
        <View style={[styles.container, { paddingTop: insets.top }]}>
            {/* Header */}
            <View style={styles.header}>
                <Text style={styles.headerTitle}>{t('history.title')}</Text>
                <View style={styles.earningsChip}>
                    <Feather name="dollar-sign" size={13} color={colors.success} />
                    <Text style={styles.earningsChipText}>{t('history.total', { amount: totalEarned })}</Text>
                </View>
            </View>

            {/* Filters */}
            <View style={styles.filters}>
                {(['all', 'completed', 'cancelled'] as FilterType[]).map((f) => (
                    <TouchableOpacity
                        key={f}
                        style={[styles.filterBtn, filter === f && styles.filterBtnActive]}
                        onPress={() => setFilter(f)}
                    >
                        <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>
                            {t(`history.${f}`)}
                        </Text>
                    </TouchableOpacity>
                ))}
            </View>

            {loading ? (
                <View style={styles.center}>
                    <ActivityIndicator size="large" color={colors.primary} />
                </View>
            ) : (
                <FlatList
                    data={filtered}
                    keyExtractor={(item) => item.id}
                    renderItem={renderItem}
                    contentContainerStyle={styles.list}
                    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
                    showsVerticalScrollIndicator={false}
                    ListEmptyComponent={
                        <View style={styles.emptyState}>
                            <Feather name="inbox" size={40} color={colors.textMuted} />
                            <Text style={styles.emptyTitle}>{t('history.noRides')}</Text>
                            <Text style={styles.emptySubtitle}>{t('history.noRidesSubtitle')}</Text>
                        </View>
                    }
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 20, paddingVertical: 14,
        backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    headerTitle: { fontFamily: Fonts.bold, fontSize: 20, color: colors.text },
    earningsChip: {
        flexDirection: 'row', alignItems: 'center', gap: 4,
        backgroundColor: colors.successLight, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5,
    },
    earningsChipText: { fontFamily: Fonts.bold, fontSize: 13, color: colors.success },
    filters: {
        flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 12,
        backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    filterBtn: {
        paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20,
        backgroundColor: colors.background, borderWidth: 1.5, borderColor: colors.border,
    },
    filterBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    filterText: { fontFamily: Fonts.medium, fontSize: 13, color: colors.textSecondary },
    filterTextActive: { color: colors.white },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    list: { padding: 16, paddingBottom: 32 },
    card: {
        backgroundColor: colors.surface, borderRadius: 18, padding: 16,
        marginBottom: 12, borderWidth: 1, borderColor: colors.border,
    },
    cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
    leftHeader: { gap: 3 },
    rightHeader: { alignItems: 'flex-end', gap: 6 },
    serviceLabel: { fontFamily: Fonts.bold, fontSize: 15, color: colors.text },
    date: { fontFamily: Fonts.regular, fontSize: 12, color: colors.textMuted },
    fare: { fontFamily: Fonts.black, fontSize: 18, color: colors.text },
    statusBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
    statusDone: { backgroundColor: colors.successLight },
    statusCancel: { backgroundColor: colors.errorLight },
    statusText: { fontFamily: Fonts.medium, fontSize: 11 },
    statusTextDone: { color: colors.success },
    statusTextCancel: { color: colors.error },
    divider: { height: 1, backgroundColor: colors.border, marginVertical: 12 },
    routeInfo: { gap: 0 },
    routeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    routeDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
    routeText: { flex: 1, fontFamily: Fonts.medium, fontSize: 13, color: colors.textSecondary },
    routeConnector: { width: 1, height: 10, backgroundColor: colors.border, marginLeft: 3, marginVertical: 1 },
    metaRow: { flexDirection: 'row', gap: 16, marginTop: 10 },
    metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    metaText: { fontFamily: Fonts.regular, fontSize: 12, color: colors.textMuted },
    emptyState: { alignItems: 'center', paddingTop: 60, gap: 10 },
    emptyTitle: { fontFamily: Fonts.bold, fontSize: 17, color: colors.text },
    emptySubtitle: { fontFamily: Fonts.regular, fontSize: 14, color: colors.textMuted },
});
