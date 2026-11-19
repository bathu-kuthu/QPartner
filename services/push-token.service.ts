import { supabase } from '@/config/supabase';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { FCM_TOKEN_KEY, NotificationService } from './notification.service';

const IS_EXPO_GO = Constants.appOwnership === 'expo';

let _tokenRefreshSub: { remove: () => void } | null = null;
let _listeningDriverId: string | null = null;

/**
 * Registers the device for push notifications and saves the native FCM token
 * to `public.users.fcm_token` for the authenticated driver.
 * Also attaches a token-refresh listener so rotated FCM tokens are synced automatically.
 */
export async function registerDriverPushToken(driverId: string): Promise<void> {
    if (!driverId) return;

    try {
        // Attach token rotation listener for this driver
        listenForPushTokenRefresh(driverId);

        const token = await NotificationService.registerForPushNotifications();
        if (!token) return;

        await saveDriverPushToken(driverId, token);
    } catch (err) {
        console.error('[PushToken] registerDriverPushToken error:', err);
    }
}

/**
 * Persists a push token to `public.users.fcm_token` with a single retry on transient error.
 */
async function saveDriverPushToken(driverId: string, token: string, retry = true): Promise<void> {
    try {
        const { error } = await supabase
            .from('users')
            .update({ fcm_token: token })
            .eq('id', driverId);

        if (error) {
            if (retry) {
                await new Promise((r) => setTimeout(r, 1500));
                return saveDriverPushToken(driverId, token, false);
            }
            console.error('[PushToken] Failed to save FCM token to DB:', error.message);
        } else {
            console.log('[PushToken] FCM token synced for driver:', driverId);
        }
    } catch (err) {
        console.error('[PushToken] saveDriverPushToken exception:', err);
    }
}

/**
 * Listens for FCM token rotation events while the partner session is active
 * and automatically updates both SecureStore and `public.users.fcm_token`.
 */
export function listenForPushTokenRefresh(driverId: string): () => void {
    if (IS_EXPO_GO || Platform.OS === 'web' || !driverId) {
        return () => {};
    }

    if (_listeningDriverId === driverId && _tokenRefreshSub) {
        return () => {
            _tokenRefreshSub?.remove();
            _tokenRefreshSub = null;
            _listeningDriverId = null;
        };
    }

    _tokenRefreshSub?.remove();
    _listeningDriverId = driverId;

    try {
        _tokenRefreshSub = Notifications.addPushTokenListener(async (tokenEvent) => {
            const rotatedToken = tokenEvent?.data as string | undefined;
            if (!rotatedToken || typeof rotatedToken !== 'string') return;

            try {
                await SecureStore.setItemAsync(FCM_TOKEN_KEY, rotatedToken);
            } catch {
                // Ignore SecureStore error
            }

            if (_listeningDriverId) {
                await saveDriverPushToken(_listeningDriverId, rotatedToken);
            }
        });
    } catch (err) {
        console.warn('[PushToken] Could not attach token refresh listener:', err);
    }

    return () => {
        _tokenRefreshSub?.remove();
        _tokenRefreshSub = null;
        _listeningDriverId = null;
    };
}

/**
 * Clears the FCM token in Supabase and stops token refresh listeners when the driver logs out.
 */
export async function unregisterDriverPushToken(driverId: string): Promise<void> {
    _tokenRefreshSub?.remove();
    _tokenRefreshSub = null;
    _listeningDriverId = null;

    try {
        try {
            await SecureStore.deleteItemAsync(FCM_TOKEN_KEY);
        } catch {
            // Ignore on unsupported platforms
        }

        const { error } = await supabase
            .from('users')
            .update({ fcm_token: null })
            .eq('id', driverId);

        if (error) {
            console.error('[PushToken] Failed to clear FCM token:', error.message);
        } else {
            console.log('[PushToken] FCM token cleared for driver:', driverId);
        }
    } catch (err) {
        console.error('[PushToken] unregisterDriverPushToken error:', err);
    }
}
