import { supabase } from '@/config/supabase';
import { NotificationService } from './notification.service';

/**
 * Call this function once after a driver successfully logs in or the app
 * restores a session. It registers the device for push notifications and
 * saves the FCM token to Supabase.
 *
 * Recommended: call from auth-context.tsx in the useEffect that loads
 * the driver profile, after confirming driver.rider_status === 'verified'.
 */
export async function registerDriverPushToken(driverId: string): Promise<void> {
    try {
        const token = await NotificationService.registerForPushNotifications();
        if (!token) return;

        // Driver rows live in the `users` table.
        const { error } = await supabase
            .from('users')
            .update({ fcm_token: token })
            .eq('id', driverId);

        if (error) {
            console.error('[Auth] Failed to save FCM token to DB:', error.message);
        } else {
            console.log('[Auth] FCM token saved for driver:', driverId);
        }
    } catch (err) {
        console.error('[Auth] registerDriverPushToken error:', err);
    }
}

/**
 * Call this when the driver logs out — clear the FCM token so they don't
 * receive pushes after signing out on this device.
 */
export async function unregisterDriverPushToken(driverId: string): Promise<void> {
    try {
        const { error } = await supabase
            .from('users')
            .update({ fcm_token: null })
            .eq('id', driverId);

        if (error) {
            console.error('[Auth] Failed to clear FCM token:', error.message);
        } else {
            console.log('[Auth] FCM token cleared for driver:', driverId);
        }
    } catch (err) {
        console.error('[Auth] unregisterDriverPushToken error:', err);
    }
}