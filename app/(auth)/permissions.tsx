import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { NativeBridgeService } from '@/services/native-bridge.service';
import { colors, Fonts } from '@/constants/colors';

export default function PermissionsScreen() {
    const [fgLocationGranted, setFgLocationGranted] = useState(false);
    const [bgLocationGranted, setBgLocationGranted] = useState(false);
    const [notificationsGranted, setNotificationsGranted] = useState(false);
    const [overlayGranted, setOverlayGranted] = useState(true); // Default true for iOS

    useEffect(() => {
        checkPermissions();
    }, []);

    const checkPermissions = async () => {
        // Foreground Location
        const fgRes = await Location.getForegroundPermissionsAsync();
        setFgLocationGranted(fgRes.status === 'granted');

        // Background Location
        const bgRes = await Location.getBackgroundPermissionsAsync();
        setBgLocationGranted(bgRes.status === 'granted');

        // Notifications
        const notifRes = await Notifications.getPermissionsAsync();
        setNotificationsGranted(notifRes.status === 'granted');

        // Overlay (Draw over apps)
        if (Platform.OS === 'android') {
            const overlay = await NativeBridgeService.checkDrawOverAppsPermission();
            setOverlayGranted(overlay);
        }
    };

    const requestForegroundLocation = async () => {
        const { status } = await Location.requestForegroundPermissionsAsync();
        setFgLocationGranted(status === 'granted');
        if (status === 'granted') checkPermissions();
    };

    const requestBackgroundLocation = async () => {
        if (!fgLocationGranted) {
            Alert.alert('Required', 'Please grant Foreground Location permission first.');
            return;
        }
        const { status } = await Location.requestBackgroundPermissionsAsync();
        setBgLocationGranted(status === 'granted');
        if (status === 'granted') checkPermissions();
    };

    const requestNotifications = async () => {
        const { status } = await Notifications.requestPermissionsAsync();
        setNotificationsGranted(status === 'granted');
        if (status === 'granted') checkPermissions();
    };

    const requestOverlay = async () => {
        NativeBridgeService.requestDrawOverAppsPermission();
        Alert.alert(
            'Settings Opened',
            'Please find Quickora in the list, enable "Allow display over other apps", then return and press "Check Again".'
        );
    };

    const allGranted = fgLocationGranted && bgLocationGranted && notificationsGranted && overlayGranted;

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.title}>Required Permissions</Text>
                <Text style={styles.subtitle}>
                    To receive ride requests efficiently and alert you while using other apps, Quickora requires the following permissions.
                </Text>
            </View>

            <ScrollView contentContainerStyle={styles.scrollContent}>
                {/* Foreground Location */}
                <PermissionCard
                    title="Foreground Location"
                    description="To find nearby rides and track your ongoing trips."
                    icon="map-pin"
                    granted={fgLocationGranted}
                    onPress={requestForegroundLocation}
                />

                {/* Background Location */}
                <PermissionCard
                    title="Background Location"
                    description="Crucial to keep the app actively searching for rides in the background, so you never miss an order."
                    icon="navigation"
                    granted={bgLocationGranted}
                    onPress={requestBackgroundLocation}
                />

                {/* Notifications */}
                <PermissionCard
                    title="Notifications"
                    description="To alert you about new bookings and messages."
                    icon="bell"
                    granted={notificationsGranted}
                    onPress={requestNotifications}
                />

                {/* Draw Over Other Apps (Overlay) */}
                {Platform.OS === 'android' && (
                    <PermissionCard
                        title="Display Over Other Apps"
                        description="Allows the app to show a floating card with order details even if you are using YouTube or WhatsApp."
                        icon="layers"
                        granted={overlayGranted}
                        onPress={requestOverlay}
                    />
                )}
            </ScrollView>

            <View style={styles.footer}>
                {!allGranted ? (
                    <TouchableOpacity
                        style={styles.checkAgainButton}
                        onPress={checkPermissions}
                    >
                        <Text style={styles.checkAgainText}>Check Again</Text>
                    </TouchableOpacity>
                ) : null}

                <TouchableOpacity
                    style={[styles.continueButton, !allGranted && styles.continueDisabled]}
                    onPress={() => {
                        if (allGranted) router.replace('/(tabs)/bookings');
                    }}
                    disabled={!allGranted}
                >
                    <Text style={styles.continueText}>Continue</Text>
                </TouchableOpacity>
            </View>
        </SafeAreaView>
    );
}

function PermissionCard({ title, description, icon, granted, onPress }: any) {
    return (
        <View style={[styles.card, granted && styles.cardGranted]}>
            <View style={styles.cardIcon}>
                <Feather name={icon} size={24} color={granted ? colors.success : colors.primary} />
            </View>
            <View style={styles.cardText}>
                <Text style={styles.cardTitle}>{title}</Text>
                <Text style={styles.cardDesc}>{description}</Text>
            </View>
            {granted ? (
                <View style={styles.grantedBadge}>
                    <Feather name="check" size={20} color={colors.white} />
                </View>
            ) : (
                <TouchableOpacity style={styles.grantButton} onPress={onPress}>
                    <Text style={styles.grantButtonText}>Grant</Text>
                </TouchableOpacity>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: { padding: 24, paddingBottom: 16 },
    title: { fontFamily: Fonts.bold, fontSize: 24, color: colors.text, marginBottom: 8 },
    subtitle: { fontFamily: Fonts.regular, fontSize: 14, color: colors.textSecondary, lineHeight: 22 },
    scrollContent: { paddingHorizontal: 24, paddingBottom: 40, gap: 16 },
    card: {
        flexDirection: 'row',
        backgroundColor: colors.surface,
        borderRadius: 16,
        padding: 16,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: colors.border,
        gap: 12,
    },
    cardGranted: { borderColor: colors.success, backgroundColor: colors.successLight + '20' },
    cardIcon: {
        width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primaryLight,
        alignItems: 'center', justifyContent: 'center'
    },
    cardText: { flex: 1 },
    cardTitle: { fontFamily: Fonts.bold, fontSize: 16, color: colors.text, marginBottom: 4 },
    cardDesc: { fontFamily: Fonts.regular, fontSize: 12, color: colors.textSecondary, lineHeight: 18 },
    grantButton: { backgroundColor: colors.primary, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
    grantButtonText: { fontFamily: Fonts.bold, fontSize: 12, color: colors.white },
    grantedBadge: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center' },
    footer: { padding: 24, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border, gap: 12 },
    checkAgainButton: { padding: 16, alignItems: 'center', borderRadius: 16, borderWidth: 1, borderColor: colors.primary },
    checkAgainText: { fontFamily: Fonts.bold, fontSize: 16, color: colors.primary },
    continueButton: { backgroundColor: colors.primary, padding: 16, alignItems: 'center', borderRadius: 16 },
    continueDisabled: { backgroundColor: colors.border },
    continueText: { fontFamily: Fonts.bold, fontSize: 16, color: colors.white },
});
