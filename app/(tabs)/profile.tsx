import React, { useState, useEffect, useCallback } from 'react';
import {
    View, Text, StyleSheet, ScrollView, TouchableOpacity,
    Alert, RefreshControl, ActivityIndicator, Linking, Modal, Platform, Image
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { format, startOfDay } from 'date-fns';
import { colors, Fonts } from '@/constants/colors';
import { useAuth } from '@/contexts/auth-context';
import { DriverService } from '@/services/driver.service';
import { useTranslation } from 'react-i18next';

export default function ProfileScreen() {
    const insets = useSafeAreaInsets();
    const { driver, logout, refreshDriver } = useAuth();
    const { t } = useTranslation();
    const [totalEarnings, setTotalEarnings] = useState(0);
    const [todayEarnings, setTodayEarnings] = useState(0);
    const [todayRides, setTodayRides] = useState(0);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [helpModal, setHelpModal] = useState(false);
    const [reasonModal, setReasonModal] = useState(false);

    const REASONS = [
        t('support.reason_payout'),
        t('support.reason_ride'),
        t('support.reason_account'),
        t('support.reason_app'),
        t('support.reason_other')
    ];

    const handleHelpAction = (reason: string) => {
        setReasonModal(false);
        setHelpModal(false);

        const driverName = driver?.name || 'N/A';
        const driverPhone = driver?.phone || 'N/A';
        const driverId = driver?.id || 'N/A';

        const bodyText = `Driver: ${driverName}\nPhone: ${driverPhone}\nID: ${driverId}\nReason: ${reason}\n\n`;
        const phoneNo = '9715749855';
        const url = Platform.OS === 'ios' ? `sms:${phoneNo}&body=${encodeURIComponent(bodyText)}` : `sms:${phoneNo}?body=${encodeURIComponent(bodyText)}`;
        
        Linking.openURL(url).catch(() => {
            Alert.alert(t('common.error'), 'Could not open SMS app');
        });
    };

    const loadEarnings = useCallback(async () => {
        if (!driver?.id) return;
        try {
            const [all, today] = await Promise.all([
                DriverService.getEarnings(driver.id),
                DriverService.getTodayEarnings(driver.id),
            ]);
            const total = all.reduce((sum, e) => sum + (e.amount ?? 0), 0);
            setTotalEarnings(total / 0.8);
            setTodayEarnings(today / 0.8);

            const todayHistory = await DriverService.getRideHistory(driver.id);
            const todayStart = startOfDay(new Date());
            const countToday = todayHistory.filter(
                r => r.status === 'completed' && new Date(r.created_at) >= todayStart
            ).length;
            setTodayRides(countToday);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [driver?.id]);

    useEffect(() => { loadEarnings(); }, [loadEarnings]);

    const handleRefresh = () => {
        setRefreshing(true);
        refreshDriver().then(loadEarnings);
    };

    const handleLogout = () => {
        Alert.alert(t('profile.logout'), t('profile.logoutConfirm'), [
            { text: t('common.cancel'), style: 'cancel' },
            {
                text: t('profile.logout'),
                style: 'destructive',
                onPress: async () => {
                    await logout();
                    router.replace('/(auth)/login');
                }
            },
        ]);
    };

    const menuItems = [
        {
            icon: 'trending-up' as const,
            label: t('profile.earnings'),
            subtitle: t('profile.earningsTotal', { amount: totalEarnings.toFixed(0) }),
            color: colors.success,
            onPress: () => Alert.alert(
                t('profile.earnings'),
                `${t('history.total', { amount: totalEarnings.toFixed(2) })}\n${t('profile.todayEarnings')}: ₹${todayEarnings.toFixed(2)}`
            ),
        },
        {
            icon: 'file-text' as const,
            label: t('profile.myDocs'),
            subtitle: `Status: ${driver?.rider_status === 'verified' ? t('profile.statusVerified') : driver?.rider_status ?? '—'}`,
            color: colors.primary,
            onPress: () => router.push('/(auth)/documents'),
        },
        {
            icon: 'help-circle' as const,
            label: t('profile.help'),
            subtitle: t('profile.helpSubtitle'),
            color: colors.warning,
            onPress: () => setHelpModal(true),
        },
        {
            icon: 'shield' as const,
            label: t('profile.terms'),
            subtitle: t('profile.termsSubtitle'),
            color: colors.info,
            // ✅ Opens the embedded Terms screen — no internet required
            onPress: () => router.push('../terms'),
        },
    ];

    if (loading) {
        return (
            <View style={[styles.container, styles.center, { paddingTop: insets.top }]}>
                <ActivityIndicator size="large" color={colors.primary} />
            </View>
        );
    }

    return (
        <View style={[styles.container, { paddingTop: insets.top }]}>
            <View style={styles.header}>
                <Text style={styles.headerTitle}>{t('profile.title')}</Text>
            </View>

            <ScrollView
                contentContainerStyle={styles.scroll}
                showsVerticalScrollIndicator={false}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />
                }
            >
                {/* Avatar & info */}
                <View style={styles.profileCard}>
                    <View style={styles.avatarBox}>
                        {driver?.avatar ? (
                            <Image source={{ uri: driver.avatar }} style={styles.avatarImage} />
                        ) : (
                            <Text style={styles.avatarText}>
                                {driver?.name?.charAt(0)?.toUpperCase() ?? '?'}
                            </Text>
                        )}
                    </View>
                    <View style={styles.profileInfo}>
                        <Text style={styles.driverName}>{driver?.name}</Text>
                        <Text style={styles.driverPhone}>{driver?.phone}</Text>
                        <View style={styles.verifiedBadge}>
                            <Feather name="check-circle" size={12} color={colors.success} />
                            <Text style={styles.verifiedText}>
                                {driver?.vehicle_category === 'logistics'
                                    ? `📦 ${t('onboarding.logistics')}`
                                    : `🚖 ${t('onboarding.taxi')}`} ·{' '}
                                {driver?.vehicle_type?.toUpperCase()}
                            </Text>
                        </View>
                    </View>
                    <View style={styles.ratingBadge}>
                        <Text style={styles.ratingValue}>⭐ {driver?.rating?.toFixed(1)}</Text>
                    </View>
                </View>

                {/* Stats */}
                <View style={styles.statsGrid}>
                    <View style={styles.statBox}>
                        <Text style={styles.statValue}>₹{todayEarnings.toFixed(0)}</Text>
                        <Text style={styles.statLabel}>{t('profile.todayEarnings')}</Text>
                    </View>
                    <View style={styles.statDivider} />
                    <View style={styles.statBox}>
                        <Text style={styles.statValue}>{todayRides}</Text>
                        <Text style={styles.statLabel}>{t('profile.todayRides')}</Text>
                    </View>
                    <View style={styles.statDivider} />
                    <View style={styles.statBox}>
                        <Text style={styles.statValue}>{driver?.total_rides ?? 0}</Text>
                        <Text style={styles.statLabel}>{t('profile.totalRides')}</Text>
                    </View>
                </View>

                {/* Earnings breakdown */}
                <View style={styles.earningsCard}>
                    <View style={styles.earningsRow}>
                        <Feather name="dollar-sign" size={18} color={colors.success} />
                        <Text style={styles.earningsTitle}>{t('profile.totalEarnings')}</Text>
                        <Text style={styles.earningsAmount}>₹{totalEarnings.toFixed(2)}</Text>
                    </View>
                </View>

                {/* Menu items */}
                <View style={styles.menuCard}>
                    {menuItems.map((item, idx) => (
                        <React.Fragment key={item.label}>
                            <TouchableOpacity style={styles.menuItem} onPress={item.onPress} activeOpacity={0.7}>
                                <View style={[styles.menuIconBox, { backgroundColor: item.color + '20' }]}>
                                    <Feather name={item.icon} size={18} color={item.color} />
                                </View>
                                <View style={styles.menuText}>
                                    <Text style={styles.menuLabel}>{item.label}</Text>
                                    <Text style={styles.menuSubtitle}>{item.subtitle}</Text>
                                </View>
                                <Feather name="chevron-right" size={18} color={colors.textMuted} />
                            </TouchableOpacity>
                            {idx < menuItems.length - 1 && <View style={styles.menuDivider} />}
                        </React.Fragment>
                    ))}
                </View>

                {/* Vehicle info */}
                <View style={styles.vehicleCard}>
                    <Text style={styles.vehicleCardTitle}>{t('profile.vehicleDetails')}</Text>
                    <View style={styles.vehicleRow}>
                        <Text style={styles.vehicleKey}>{t('profile.type')}</Text>
                        <Text style={styles.vehicleVal}>{driver?.vehicle_type?.toUpperCase() ?? '—'}</Text>
                    </View>
                    <View style={styles.vehicleRow}>
                        <Text style={styles.vehicleKey}>{t('profile.number')}</Text>
                        <Text style={styles.vehicleVal}>{driver?.vehicle_number ?? '—'}</Text>
                    </View>
                    <View style={styles.vehicleRow}>
                        <Text style={styles.vehicleKey}>{t('profile.category')}</Text>
                        <Text style={styles.vehicleVal}>
                            {driver?.vehicle_category === 'logistics'
                                ? `📦 ${t('onboarding.logistics')}`
                                : `🚖 ${t('onboarding.taxi')}`}
                        </Text>
                    </View>
                    <View style={[styles.vehicleRow, { borderBottomWidth: 0 }]}>
                        <Text style={styles.vehicleKey}>{t('profile.memberSince')}</Text>
                        <Text style={styles.vehicleVal}>
                            {driver?.created_at ? format(new Date(driver.created_at), 'MMM yyyy') : '—'}
                        </Text>
                    </View>
                </View>

                <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.85}>
                    <Feather name="log-out" size={18} color={colors.error} />
                    <Text style={styles.logoutText}>{t('profile.logout')}</Text>
                </TouchableOpacity>

                <Text style={styles.version}>{t('profile.version')}</Text>
                <View style={{ height: 32 }} />
            </ScrollView>

            {/* ─── Help & Support Modal ─── */}
            <Modal visible={helpModal} animationType="slide" transparent>
                <View style={styles.modalOverlay}>
                    <View style={styles.modalContent}>
                        <Text style={styles.modalTitle}>{t('support.title') || 'Help & Support'}</Text>
                        <TouchableOpacity style={styles.supportOption} onPress={() => Linking.openURL('tel:9715749855')}>
                            <View style={[styles.supportIconBox, { backgroundColor: colors.success + '15' }]}>
                                <Feather name="phone-call" size={20} color={colors.success} />
                            </View>
                            <Text style={styles.supportOptionText}>{t('support.call_support') || 'Call Support'}</Text>
                            <Feather name="chevron-right" size={16} color={colors.textMuted} />
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.supportOption} onPress={() => setReasonModal(true)}>
                            <View style={[styles.supportIconBox, { backgroundColor: colors.primary + '15' }]}>
                                <Feather name="message-circle" size={20} color={colors.primary} />
                            </View>
                            <Text style={styles.supportOptionText}>{t('support.send_msg') || 'Send Message'}</Text>
                            <Feather name="chevron-right" size={16} color={colors.textMuted} />
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.closeBtn} onPress={() => setHelpModal(false)}>
                            <Text style={styles.closeBtnText}>{t('common.close') || 'Close'}</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>

            {/* ─── Reason Modal ─── */}
            <Modal visible={reasonModal} animationType="slide">
                <View style={[styles.reasonContent, { paddingTop: insets.top + 20 }]}>
                    <View style={styles.reasonHeader}>
                        <Text style={styles.reasonTitle}>{t('support.select_reason') || 'Select a Reason'}</Text>
                        <TouchableOpacity onPress={() => setReasonModal(false)} style={styles.reasonClose}>
                            <Feather name="x" size={20} color={colors.text} />
                        </TouchableOpacity>
                    </View>
                    <ScrollView>
                        {REASONS.map((reason, i) => (
                            <TouchableOpacity key={i} style={styles.reasonItem} onPress={() => handleHelpAction(reason)}>
                                <Text style={styles.reasonText}>{reason}</Text>
                                <Feather name="chevron-right" size={18} color={colors.border} />
                            </TouchableOpacity>
                        ))}
                    </ScrollView>
                </View>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    center: { justifyContent: 'center', alignItems: 'center' },
    header: {
        paddingHorizontal: 20, paddingVertical: 14,
        backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    headerTitle: { fontFamily: Fonts.bold, fontSize: 20, color: colors.text },
    scroll: { paddingBottom: 20 },

    profileCard: {
        flexDirection: 'row', alignItems: 'center', gap: 14,
        backgroundColor: colors.surface, margin: 16, borderRadius: 20, padding: 16,
        borderWidth: 1, borderColor: colors.border,
    },
    avatarBox: {
        width: 56, height: 56, borderRadius: 28,
        backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    },
    avatarImage: { width: '100%', height: '100%' },
    avatarText: { fontFamily: Fonts.black, fontSize: 22, color: colors.white },
    profileInfo: { flex: 1, gap: 3 },
    driverName: { fontFamily: Fonts.bold, fontSize: 16, color: colors.text },
    driverPhone: { fontFamily: Fonts.regular, fontSize: 13, color: colors.textSecondary },
    verifiedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
    verifiedText: { fontFamily: Fonts.medium, fontSize: 12, color: colors.success },
    ratingBadge: { backgroundColor: colors.warningLight, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 },
    ratingValue: { fontFamily: Fonts.bold, fontSize: 14, color: colors.orange },

    statsGrid: {
        flexDirection: 'row', backgroundColor: colors.surface, marginHorizontal: 16,
        borderRadius: 18, padding: 16, marginBottom: 12,
        borderWidth: 1, borderColor: colors.border,
    },
    statBox: { flex: 1, alignItems: 'center', gap: 4 },
    statValue: { fontFamily: Fonts.black, fontSize: 22, color: colors.text },
    statLabel: { fontFamily: Fonts.regular, fontSize: 12, color: colors.textMuted, textAlign: 'center' },
    statDivider: { width: 1, backgroundColor: colors.border, marginHorizontal: 8 },

    earningsCard: {
        backgroundColor: colors.successLight, marginHorizontal: 16, borderRadius: 16,
        padding: 16, marginBottom: 12,
    },
    earningsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    earningsTitle: { flex: 1, fontFamily: Fonts.bold, fontSize: 15, color: colors.success },
    earningsAmount: { fontFamily: Fonts.black, fontSize: 20, color: colors.success },
    earningsNote: { fontFamily: Fonts.regular, fontSize: 12, color: colors.success, marginTop: 4, opacity: 0.8 },

    menuCard: {
        backgroundColor: colors.surface, marginHorizontal: 16, borderRadius: 18,
        paddingHorizontal: 4, marginBottom: 12,
        borderWidth: 1, borderColor: colors.border,
    },
    menuItem: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 },
    menuIconBox: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    menuText: { flex: 1 },
    menuLabel: { fontFamily: Fonts.medium, fontSize: 15, color: colors.text },
    menuSubtitle: { fontFamily: Fonts.regular, fontSize: 12, color: colors.textMuted, marginTop: 1 },
    menuDivider: { height: 1, backgroundColor: colors.border, marginLeft: 70 },

    vehicleCard: {
        backgroundColor: colors.surface, marginHorizontal: 16, borderRadius: 18,
        padding: 16, marginBottom: 12,
        borderWidth: 1, borderColor: colors.border,
    },
    vehicleCardTitle: { fontFamily: Fonts.bold, fontSize: 15, color: colors.text, marginBottom: 12 },
    vehicleRow: {
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    vehicleKey: { fontFamily: Fonts.regular, fontSize: 14, color: colors.textSecondary },
    vehicleVal: { fontFamily: Fonts.medium, fontSize: 14, color: colors.text },

    logoutBtn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
        marginHorizontal: 16, borderRadius: 14, paddingVertical: 14,
        borderWidth: 1.5, borderColor: colors.error, marginBottom: 12,
    },
    logoutText: { fontFamily: Fonts.bold, fontSize: 16, color: colors.error },
    version: { textAlign: 'center', fontFamily: Fonts.regular, fontSize: 12, color: colors.textMuted },
    
    // Help & Support Modal
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    modalContent: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
    modalTitle: { fontFamily: Fonts.bold, fontSize: 18, color: colors.text, marginBottom: 20, textAlign: 'center' },
    supportOption: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.background, padding: 16, borderRadius: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.border },
    supportIconBox: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginRight: 14 },
    supportOptionText: { flex: 1, fontFamily: Fonts.medium, fontSize: 15, color: colors.text },
    closeBtn: { marginTop: 10, paddingVertical: 14, alignItems: 'center', backgroundColor: colors.background, borderRadius: 14 },
    closeBtnText: { fontFamily: Fonts.bold, fontSize: 15, color: colors.textSecondary },

    // Reason Modal
    reasonContent: { flex: 1, backgroundColor: colors.background },
    reasonHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
    reasonTitle: { fontFamily: Fonts.bold, fontSize: 18, color: colors.text },
    reasonClose: { padding: 8, backgroundColor: colors.surface, borderRadius: 20 },
    reasonItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface },
    reasonText: { fontFamily: Fonts.medium, fontSize: 15, color: colors.text },
});