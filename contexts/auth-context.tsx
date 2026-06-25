import { supabase } from '@/config/supabase';
import { Driver } from '@/types';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, ReactNode, useContext, useEffect, useState } from 'react';

interface AuthContextType {
    driver: Driver | null;
    loading: boolean;
    setDriverData: (driver: Driver | null) => Promise<void>;
    logout: () => Promise<void>;
    refreshDriver: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
    driver: null,
    loading: true,
    setDriverData: async () => { },
    logout: async () => { },
    refreshDriver: async () => { },
});

const DRIVER_STORAGE_KEY = '@quickora_driver';

export function AuthProvider({ children }: { children: ReactNode }) {
    const [driver, setDriverState] = useState<Driver | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        initialize();
    }, []);

    // Subscribe to realtime changes on this driver's row in users table.
    // This means: when you change rider_status to 'verified' in Supabase,
    // the app will automatically redirect the driver — no restart needed.
    useEffect(() => {
        if (!driver?.id) return;

        const channel = supabase
            .channel(`driver_status_${driver.id}`)
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'users',
                    filter: `id=eq.${driver.id}`,
                },
                async (payload) => {
                    const updated = payload.new as Driver;
                    await setDriverData(updated);
                }
            )
            .subscribe();

        return () => {
            channel.unsubscribe();
        };
    }, [driver?.id]);

    const initialize = async () => {
        try {
            const stored = await AsyncStorage.getItem(DRIVER_STORAGE_KEY);
            if (stored) {
                const parsed = JSON.parse(stored) as Driver;
                setDriverState(parsed);

                // Always fetch fresh data from DB on app start
                // so rider_status is never stale from AsyncStorage
                const { data } = await supabase
                    .from('users')
                    .select('*')
                    .eq('id', parsed.id)
                    .single();
                if (data) {
                    await AsyncStorage.setItem(DRIVER_STORAGE_KEY, JSON.stringify(data));
                    setDriverState(data as Driver);
                }
            }
        } catch (e) {
            console.error('Failed to load driver:', e);
        } finally {
            setLoading(false);
        }
    };

    const setDriverData = async (driverData: Driver | null) => {
        try {
            if (driverData) {
                await AsyncStorage.setItem(DRIVER_STORAGE_KEY, JSON.stringify(driverData));
                setDriverState(driverData);
            } else {
                await AsyncStorage.removeItem(DRIVER_STORAGE_KEY);
                setDriverState(null);
            }
        } catch (e) {
            console.error('Failed to update driver data:', e);
        }
    };

    const refreshDriver = async () => {
        if (!driver?.id) return;
        try {
            const { data } = await supabase
                .from('users')
                .select('*')
                .eq('id', driver.id)
                .single();
            if (data) {
                await setDriverData(data as Driver);
            }
        } catch (e) {
            console.error('Failed to refresh driver:', e);
        }
    };

    const logout = async () => {
        try {
            // Clear FCM token first so this device stops receiving ride pushes
            // for the session that's ending. Best-effort: don't block logout on it.
            if (driver?.id) {
                const { unregisterDriverPushToken } = await import('@/services/push-token.service');
                unregisterDriverPushToken(driver.id).catch((e) =>
                    console.warn('Failed to clear FCM token on logout:', e)
                );
            }
            await AsyncStorage.removeItem(DRIVER_STORAGE_KEY);
            setDriverState(null);
        } catch (e) {
            console.error('Logout error:', e);
        }
    };

    return (
        <AuthContext.Provider value={{ driver, loading, setDriverData, logout, refreshDriver }}>
            {children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => useContext(AuthContext);