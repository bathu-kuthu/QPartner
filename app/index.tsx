import { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '@/contexts/auth-context';
import { colors } from '@/constants/colors';

export default function Index() {
    const { driver, loading } = useAuth();

    useEffect(() => {
        if (!loading) {
            if (!driver) {
                router.replace('/(auth)/login');
            } else if (!driver.is_driver || driver.rider_status === 'unsubmitted') {
                router.replace('/(auth)/onboarding');
            } else if (driver.rider_status === 'pending' || driver.rider_status === 'rejected') {
                // Show pending/rejected screen (handled inside onboarding.tsx)
                router.replace('/(auth)/onboarding');
            } else if (driver.rider_status === 'verified') {
                router.replace('/(tabs)/bookings');
            } else {
                router.replace('/(auth)/onboarding');
            }
        }
    }, [driver, loading]);

    return (
        <View style={styles.container}>
            <ActivityIndicator size="large" color={colors.primary} />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: colors.background,
    },
});