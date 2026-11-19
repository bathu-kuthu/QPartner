import { colors, Fonts } from '@/constants/colors';
import { useAuth } from '@/contexts/auth-context';
import { NativeBridgeService } from '@/services/native-bridge.service';
import { NotificationService } from '@/services/notification.service';
import { registerDriverPushToken } from '@/services/push-token.service';
import { Feather } from '@expo/vector-icons';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
    Alert,
    AppState,
    Linking,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function PermissionsScreen() {
    const { driver } = useAuth();
    const [fgLocationGranted, setFgLocationGranted] = useState(false);
    const [bgLocationGranted, setBgLocationGranted] = useState(false);
    const [notificationsGranted, setNotificationsGranted] = useState(false);
    const [overlayGranted, setOverlayGranted] = useState(false);

    const checkPermissions = useCallback(async () => {
        try {
            const fgRes = await Location.getForegroundPermissionsAsync();
            setFgLocationGranted(fgRes.status === 'granted');

            const bgRes = await Location.getBackgroundPermissionsAsync();
            setBgLocationGranted(bgRes.status === 'granted');

            const notifRes = await Notifications.getPermissionsAsync();
            setNotificationsGranted(notifRes.status === 'granted');

            const canDraw = await NativeBridgeService.checkDrawOverAppsPermission();
            setOverlayGranted(canDraw);
        } catch (err) {
            console.warn('[Permissions] Error checking permissions:', err);
        }
    }, []);

    useEffect(() => {
        checkPermissions();
        const sub = AppState.addEventListener('change', (state) => {
            if (state === 'active') {
                checkPermissions();
            }
        });
        return () => sub.remove();
    }, [checkPermissions]);

    const requestForegroundLocation = async () => {
        const res = await Location.requestForegroundPermissionsAsync();
        setFgLocationGranted(res.status === 'granted');
        if (res.status === 'granted') {
            checkPermissions();
        } else if (!res.canAskAgain) {
            Alert.alert(
                'Location Permission Required',
                'Please enable Location permission in Android Settings ("Allow while using the app" or "Allow all the time") to receive nearby delivery requests.',
                [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Open Settings', onPress: () => Linking.openSettings() },
                ]
            );
        }
    };

    const requestBackgroundLocation = async () => {
        if (!fgLocationGranted) {
            Alert.alert('Required', 'Please grant Foreground Location permission first.');
            return;
        }
        const res = await Location.requestBackgroundPermissionsAsync();
        setBgLocationGranted(res.status === 'granted');
        if (res.status === 'granted') {
            checkPermissions();
        } else if (!res.canAskAgain) {
            Alert.alert(
                'Background Location Required',
                'Please select "Allow all the time" under Location permissions in Android Settings so QPartner can keep you online and dispatch nearby orders while minimized.',
                [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Open Settings', onPress: () => Linking.openSettings() },
                ]
            );
        }
    };

    const requestNotifications = async () => {
        await NotificationService.createAndroidChannels();
        const res = await Notifications.requestPermissionsAsync();
        const granted = res.status === 'granted';
        setNotificationsGranted(granted);
        if (granted) {
            if (driver?.id) {
                registerDriverPushToken(driver.id).catch(console.warn);
            }
            checkPermissions();
        } else if (!res.canAskAgain) {
            Alert.alert(
                'Notifications Disabled',
                'Notification permission is required to alert you with sound and vibration when new delivery orders arrive in the background.',
                [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Open Settings', onPress: () => Linking.openSettings() },
                ]
            );
        }
    };

    const allGranted = fgLocationGranted && bgLocationGranted && notificationsGranted;

    const handleContinue = async () => {
        if (!allGranted) return;
        await NotificationService.createAndroidChannels();
        if (driver?.id) {
            registerDriverPushToken(driver.id).catch(console.warn);
        }
        router.replace('/(tabs)/bookings');
    };

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.title}>Required Permissions</Text>
                <Text style={styles.subtitle}>
                    To keep you online in the background and alert you immediately when new delivery orders arrive, QPartner requires the following permissions.
                </Text>
            </View>

            <ScrollView contentContainerStyle={styles.scrollContent}>
                {/* Foreground Location */}
                <PermissionCard
                    title="Foreground Location"
                    description="To find nearby orders and navigate pickup and drop-off routes."
                    icon="map-pin"
                    granted={fgLocationGranted}
                    onPress={requestForegroundLocation}
                />

                {/* Background Location */}
                <PermissionCard
                    title="Background Location"
                    description="Keeps your online availability active while QPartner is minimized or another app is open."
                    icon="navigation"
                    granted={bgLocationGranted}
                    onPress={requestBackgroundLocation}
                />

                {/* Notifications */}
                <PermissionCard
                    title="Order Alert Notifications"
                    description="Required for high-priority sound, vibration, and lock-screen order alerts."
                    icon="bell"
                    granted={notificationsGranted}
                    onPress={requestNotifications}
                />

                {/* Floating Order Receiver Card Overlay (Rapido / Zomato Style) */}
                {NativeBridgeService.isAndroid ? (
                    <PermissionCard
                        title="Floating Order Card (Draw Over Apps)"
                        description="Displays incoming order cards on top of any app or when QPartner is closed."
                        icon="layers"
                        granted={overlayGranted}
                        onPress={() => NativeBridgeService.requestDrawOverAppsPermission()}
                    />
                ) : null}
            </ScrollView>

            <View style={styles.footer}>
                {!allGranted ? (
                    <TouchableOpacity style={styles.checkAgainButton} onPress={checkPermissions}>
                        <Text style={styles.checkAgainText}>Check Again</Text>
                    </TouchableOpacity>
                ) : null}

                <TouchableOpacity
                    style={[styles.continueButton, !allGranted && styles.continueDisabled]}
                    onPress={handleContinue}
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
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: colors.primaryLight,
        alignItems: 'center',
        justifyContent: 'center',
    },
    cardText: { flex: 1 },
    cardTitle: { fontFamily: Fonts.bold, fontSize: 16, color: colors.text, marginBottom: 4 },
    cardDesc: { fontFamily: Fonts.regular, fontSize: 12, color: colors.textSecondary, lineHeight: 18 },
    grantButton: { backgroundColor: colors.primary, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
    grantButtonText: { fontFamily: Fonts.bold, fontSize: 12, color: colors.white },
    grantedBadge: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: colors.success,
        alignItems: 'center',
        justifyContent: 'center',
    },
    footer: {
        padding: 24,
        backgroundColor: colors.surface,
        borderTopWidth: 1,
        borderTopColor: colors.border,
        gap: 12,
    },
    checkAgainButton: {
        padding: 16,
        alignItems: 'center',
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.primary,
    },
    checkAgainText: { fontFamily: Fonts.bold, fontSize: 16, color: colors.primary },
    continueButton: { backgroundColor: colors.primary, padding: 16, alignItems: 'center', borderRadius: 16 },
    continueDisabled: { backgroundColor: colors.border },
    continueText: { fontFamily: Fonts.bold, fontSize: 16, color: colors.white },
});
