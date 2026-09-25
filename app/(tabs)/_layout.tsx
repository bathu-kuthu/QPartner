import { Tabs, router } from 'expo-router';
import { useEffect } from 'react';
import { colors, Fonts } from '@/constants/colors';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/contexts/auth-context';
import { useTranslation } from 'react-i18next';

export default function TabLayout() {
    const insets = useSafeAreaInsets();
    const { driver } = useAuth();
    const { t } = useTranslation();

    // Guard: redirect non-verified drivers back to onboarding
    useEffect(() => {
        if (driver && driver.rider_status !== 'verified') {
            router.replace('/(auth)/onboarding');
        }
    }, [driver]);

    return (
        <Tabs
            screenOptions={{
                headerShown: false,
                tabBarStyle: {
                    backgroundColor: colors.surface,
                    borderTopColor: colors.border,
                    height: 60 + insets.bottom,
                    paddingTop: 10,
                    paddingBottom: insets.bottom + 8,
                    elevation: 10,
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: -4 },
                    shadowOpacity: 0.06,
                    shadowRadius: 8,
                },
                tabBarActiveTintColor: colors.primary,
                tabBarInactiveTintColor: colors.textMuted,
                tabBarLabelStyle: {
                    fontFamily: Fonts.bold,
                    fontSize: 11,
                    marginTop: 4,
                },
            }}
        >
            <Tabs.Screen
                name="bookings"
                options={{
                    title: t('tabs.bookings'),
                    tabBarIcon: ({ color }) => <Feather name="map" size={22} color={color} />,
                }}
            />
            <Tabs.Screen
                name="history"
                options={{
                    title: t('tabs.history'),
                    tabBarIcon: ({ color }) => <Feather name="clock" size={22} color={color} />,
                }}
            />
            <Tabs.Screen
                name="profile"
                options={{
                    title: t('tabs.profile'),
                    tabBarIcon: ({ color }) => <Feather name="user" size={22} color={color} />,
                }}
            />
        </Tabs>
    );
}
