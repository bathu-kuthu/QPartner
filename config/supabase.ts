import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://zoatdppograoxpgifhbl.supabase.co';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpvYXRkcHBvZ3Jhb3hwZ2lmaGJsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5MDEwMzMsImV4cCI6MjA5MDQ3NzAzM30.2uanxlSn2zclvd5Be1yNzOymwKqvBXY0qkIigVMPCTQ';

const AsyncStorageAdapter = {
    getItem: (key: string) => {
        if (Platform.OS === 'web') return Promise.resolve(localStorage.getItem(key));
        return AsyncStorage.getItem(key);
    },
    setItem: (key: string, value: string) => {
        if (Platform.OS === 'web') {
            localStorage.setItem(key, value);
            return Promise.resolve();
        }
        return AsyncStorage.setItem(key, value);
    },
    removeItem: (key: string) => {
        if (Platform.OS === 'web') {
            localStorage.removeItem(key);
            return Promise.resolve();
        }
        return AsyncStorage.removeItem(key);
    },
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
        storage: AsyncStorageAdapter,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
    },
});
