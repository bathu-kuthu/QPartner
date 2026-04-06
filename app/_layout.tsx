import 'react-native-url-polyfill/auto';
import '@/config/i18n'; // Initialize i18n
import { AuthProvider, useAuth } from '@/contexts/auth-context';
import { useFonts } from 'expo-font';
import { Stack, router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { LogBox } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NotificationService, NOTIFICATION_ACTIONS } from '@/services/notification.service';
import * as Notifications from 'expo-notifications';

LogBox.ignoreLogs([
    'expo-notifications: Android Push notifications',
    '`expo-notifications` functionality is not fully supported',
]);
import { DriverService } from '@/services/driver.service';
import '@/services/background-task'; // Register task-manager definition

SplashScreen.preventAutoHideAsync();

function RootContent() {
    const { driver, loading } = useAuth();

    useEffect(() => {
        if (!loading) {
            // ... (Auth redirects)
        }
    }, [driver, loading]);

    // Handle Notification Actions ───
    useEffect(() => {
        const sub = Notifications.addNotificationResponseReceivedListener(async (response) => {
            const data = response.notification.request.content.data as any;
            const actionId = response.actionIdentifier;
            const rideId = data.rideId;

            // Log response for debugging
            console.log('Notification response received:', { actionId, data });

            if (actionId === NOTIFICATION_ACTIONS.ACCEPT && rideId && driver?.id) {
                try {
                    // Try to accept immediately
                    const ride = await DriverService.acceptRide(rideId, driver.id);
                    if (ride) {
                        router.push(`/active-ride/${rideId}`);
                    }
                } catch (e: any) {
                    console.error('Accept ride notification failed:', e.message);
                    // If accept failed (e.g. taken by others), still go to bookings to see fresh list
                    router.push(`/(tabs)/bookings`);
                }
            } else if (data.url) {
                router.push(data.url);
            } else {
                router.push(`/(tabs)/bookings`);
            }
        });

        return () => sub.remove();
    }, [driver?.id]);

    return (
        <>
            <StatusBar style="dark" />
            <Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
                <Stack.Screen name="index" />
                <Stack.Screen name="(auth)" />
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="active-ride" />
                <Stack.Screen name="chat" options={{ animation: 'slide_from_right' }} />
                <Stack.Screen name="terms" />
            </Stack>
        </>
    );
}

export default function RootLayout() {
    const [loaded, error] = useFonts({
        'Satoshi-Regular': require('../assets/fonts/Satoshi-Regular.otf'),
        'Satoshi-Medium': require('../assets/fonts/Satoshi-Medium.otf'),
        'Satoshi-Bold': require('../assets/fonts/Satoshi-Bold.otf'),
        'Satoshi-Black': require('../assets/fonts/Satoshi-Black.otf'),
    });

    useEffect(() => {
        if (loaded || error) SplashScreen.hideAsync();
        if (loaded) NotificationService.init(); // Boot engine
    }, [loaded, error]);

    if (!loaded && !error) return null;

    return (
        <SafeAreaProvider>
            <AuthProvider>
                <RootContent />
            </AuthProvider>
        </SafeAreaProvider>
    );
}