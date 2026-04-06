import React, { useState } from 'react';
import {
    View, Text, TouchableOpacity, StyleSheet, ScrollView,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { colors, Fonts } from '@/constants/colors';
import { useAuth } from '@/contexts/auth-context';
import { useTranslation } from 'react-i18next';

type VehicleCategory = 'taxi' | 'logistics';
type VehicleType = string;



export default function OnboardingScreen() {
    const insets = useSafeAreaInsets();
    const { driver } = useAuth();
    const { t } = useTranslation();
    const [category, setCategory] = useState<VehicleCategory | null>(null);
    const [vehicleType, setVehicleType] = useState<VehicleType | null>(null);

    const TAXI_VEHICLES = [
        { id: 'bike', label: t('onboarding.vehicles.bike'), icon: '🏍️', desc: t('onboarding.vehicles.bikeDesc') },
        { id: 'auto', label: t('onboarding.vehicles.auto'), icon: '🛺', desc: t('onboarding.vehicles.autoDesc') },
        { id: 'cab', label: t('onboarding.vehicles.cab'), icon: '🚗', desc: t('onboarding.vehicles.cabDesc') },
    ];

    const LOGISTICS_VEHICLES = [
        { id: 'bike', label: t('onboarding.vehicles.bike'), icon: '🏍️', desc: t('onboarding.vehicles.logBikeDesc') },
        { id: 'mini_truck', label: t('onboarding.vehicles.miniVan'), icon: '🛻', desc: t('onboarding.vehicles.miniVanDesc') },
        { id: 'truck', label: t('onboarding.vehicles.truck'), icon: '🚚', desc: t('onboarding.vehicles.truckDesc') },
    ];

    const vehicles = category === 'taxi' ? TAXI_VEHICLES : LOGISTICS_VEHICLES;

    const handleContinue = () => {
        if (!category || !vehicleType) return;
        router.push({
            pathname: '/(auth)/documents',
            params: { category, vehicleType },
        });
    };

    // If driver already submitted docs, show pending screen
    if (driver?.rider_status === 'pending') {
        return (
            <View style={[styles.container, { paddingTop: insets.top }]}>
                <View style={styles.pendingContent}>
                    <View style={styles.pendingIcon}>
                        <Feather name="clock" size={40} color={colors.warning} />
                    </View>
                    <Text style={styles.pendingTitle}>{t('onboarding.underReview')}</Text>
                    <Text style={styles.pendingSubtitle}>
                        {t('onboarding.reviewSubtitle')}
                    </Text>
                    <View style={styles.pendingSteps}>
                        {[t('onboarding.step1'), t('onboarding.step2'), t('onboarding.step3')].map((step, i) => (
                            <View key={i} style={styles.stepRow}>
                                <View style={[styles.stepDot, i === 0 && styles.stepDotDone, i === 1 && styles.stepDotActive]} />
                                <Text style={[styles.stepText, i <= 1 && styles.stepTextActive]}>{step}</Text>
                            </View>
                        ))}
                    </View>
                </View>
            </View>
        );
    }

    if (driver?.rider_status === 'rejected') {
        return (
            <View style={[styles.container, { paddingTop: insets.top }]}>
                <View style={styles.pendingContent}>
                    <View style={[styles.pendingIcon, { backgroundColor: colors.errorLight }]}>
                        <Feather name="x-circle" size={40} color={colors.error} />
                    </View>
                    <Text style={styles.pendingTitle}>{t('onboarding.rejected')}</Text>
                    <Text style={styles.pendingSubtitle}>
                        {t('onboarding.rejectedSubtitle')}
                    </Text>
                    <TouchableOpacity
                        style={styles.resubmitBtn}
                        onPress={() => router.push('/(auth)/documents')}
                    >
                        <Text style={styles.resubmitText}>{t('onboarding.resubmit')}</Text>
                    </TouchableOpacity>
                </View>
            </View>
        );
    }

    return (
        <View style={[styles.container, { paddingTop: insets.top }]}>
            <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
                {/* Header */}
                <View style={styles.header}>
                    <Text style={styles.greeting}>{t('onboarding.hi', { name: driver?.name?.split(' ')[0] })}</Text>
                    <Text style={styles.title}>{t('onboarding.title')}</Text>
                    <Text style={styles.subtitle}>{t('onboarding.subtitle')}</Text>
                </View>

                {/* Category Selection */}
                <Text style={styles.sectionLabel}>{t('onboarding.categoryLabel')}</Text>
                <View style={styles.categoryRow}>
                    <TouchableOpacity
                        style={[styles.categoryCard, category === 'taxi' && styles.categorySelected]}
                        onPress={() => { setCategory('taxi'); setVehicleType(null); }}
                        activeOpacity={0.8}
                    >
                        <Text style={styles.categoryIcon}>🚖</Text>
                        <Text style={[styles.categoryLabel, category === 'taxi' && styles.categoryLabelSelected]}>{t('onboarding.taxi')}</Text>
                        <Text style={styles.categoryDesc}>{t('onboarding.taxiDesc')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.categoryCard, category === 'logistics' && styles.categorySelected]}
                        onPress={() => { setCategory('logistics'); setVehicleType(null); }}
                        activeOpacity={0.8}
                    >
                        <Text style={styles.categoryIcon}>📦</Text>
                        <Text style={[styles.categoryLabel, category === 'logistics' && styles.categoryLabelSelected]}>{t('onboarding.logistics')}</Text>
                        <Text style={styles.categoryDesc}>{t('onboarding.logisticsDesc')}</Text>
                    </TouchableOpacity>
                </View>

                {/* Vehicle Type */}
                {category && (
                    <>
                        <Text style={styles.sectionLabel}>{t('onboarding.vehicleType')}</Text>
                        {vehicles.map((v) => (
                            <TouchableOpacity
                                key={v.id}
                                style={[styles.vehicleCard, vehicleType === v.id && styles.vehicleSelected]}
                                onPress={() => setVehicleType(v.id)}
                                activeOpacity={0.8}
                            >
                                <Text style={styles.vehicleIcon}>{v.icon}</Text>
                                <View style={styles.vehicleInfo}>
                                    <Text style={[styles.vehicleLabel, vehicleType === v.id && styles.vehicleLabelSelected]}>
                                        {v.label}
                                    </Text>
                                    <Text style={styles.vehicleDesc}>{v.desc}</Text>
                                </View>
                                <View style={[styles.radio, vehicleType === v.id && styles.radioSelected]}>
                                    {vehicleType === v.id && <View style={styles.radioDot} />}
                                </View>
                            </TouchableOpacity>
                        ))}
                    </>
                )}

                {/* Continue */}
                <TouchableOpacity
                    style={[styles.continueBtn, (!category || !vehicleType) && styles.continueBtnDisabled]}
                    onPress={handleContinue}
                    disabled={!category || !vehicleType}
                    activeOpacity={0.85}
                >
                    <Text style={styles.continueBtnText}>{t('onboarding.continue')}</Text>
                    <Feather name="arrow-right" size={18} color={colors.white} />
                </TouchableOpacity>

                <View style={{ height: 32 }} />
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    scroll: { paddingHorizontal: 20, paddingBottom: 20 },
    header: { paddingTop: 24, paddingBottom: 28 },
    greeting: { fontFamily: Fonts.medium, fontSize: 15, color: colors.textSecondary, marginBottom: 4 },
    title: { fontFamily: Fonts.black, fontSize: 26, color: colors.text, marginBottom: 6 },
    subtitle: { fontFamily: Fonts.regular, fontSize: 14, color: colors.textSecondary },
    sectionLabel: { fontFamily: Fonts.bold, fontSize: 13, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 },
    categoryRow: { flexDirection: 'row', gap: 12, marginBottom: 28 },
    categoryCard: {
        flex: 1, backgroundColor: colors.surface, borderRadius: 16,
        padding: 16, alignItems: 'center', borderWidth: 2, borderColor: colors.border,
    },
    categorySelected: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
    categoryIcon: { fontSize: 32, marginBottom: 8 },
    categoryLabel: { fontFamily: Fonts.bold, fontSize: 15, color: colors.text, marginBottom: 2 },
    categoryLabelSelected: { color: colors.primary },
    categoryDesc: { fontFamily: Fonts.regular, fontSize: 12, color: colors.textMuted, textAlign: 'center' },
    vehicleCard: {
        flexDirection: 'row', alignItems: 'center', gap: 14,
        backgroundColor: colors.surface, borderRadius: 14,
        padding: 16, marginBottom: 10, borderWidth: 1.5, borderColor: colors.border,
    },
    vehicleSelected: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
    vehicleIcon: { fontSize: 28 },
    vehicleInfo: { flex: 1 },
    vehicleLabel: { fontFamily: Fonts.bold, fontSize: 15, color: colors.text, marginBottom: 2 },
    vehicleLabelSelected: { color: colors.primary },
    vehicleDesc: { fontFamily: Fonts.regular, fontSize: 13, color: colors.textMuted },
    radio: {
        width: 22, height: 22, borderRadius: 11, borderWidth: 2,
        borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
    },
    radioSelected: { borderColor: colors.primary },
    radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
    continueBtn: {
        backgroundColor: colors.primary, borderRadius: 14, marginTop: 24,
        paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
        shadowColor: colors.primary, shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
    },
    continueBtnDisabled: { opacity: 0.4 },
    continueBtnText: { fontFamily: Fonts.bold, fontSize: 16, color: colors.white },
    // Pending/rejected states
    pendingContent: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
    pendingIcon: {
        width: 90, height: 90, borderRadius: 45, backgroundColor: colors.warningLight,
        alignItems: 'center', justifyContent: 'center', marginBottom: 24,
    },
    pendingTitle: { fontFamily: Fonts.black, fontSize: 24, color: colors.text, marginBottom: 12, textAlign: 'center' },
    pendingSubtitle: { fontFamily: Fonts.regular, fontSize: 15, color: colors.textSecondary, textAlign: 'center', lineHeight: 22, marginBottom: 32 },
    pendingSteps: { width: '100%', gap: 16 },
    stepRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    stepDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.border },
    stepDotDone: { backgroundColor: colors.success },
    stepDotActive: { backgroundColor: colors.warning, width: 16, height: 16, borderRadius: 8 },
    stepText: { fontFamily: Fonts.medium, fontSize: 14, color: colors.textMuted },
    stepTextActive: { color: colors.text },
    resubmitBtn: {
        backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 32,
    },
    resubmitText: { fontFamily: Fonts.bold, fontSize: 15, color: colors.white },
});
