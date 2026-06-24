import { NativeModules, Platform } from 'react-native';

const { DriverServiceModule } = NativeModules;

export class NativeBridgeService {
    static isAndroid = Platform.OS === 'android';

    /**
     * Checks if Draw Over Other Apps (SYSTEM_ALERT_WINDOW) permission is granted.
     * Always returns true on non-Android platforms.
     */
    static async checkDrawOverAppsPermission(): Promise<boolean> {
        if (!this.isAndroid || !DriverServiceModule) return true;
        try {
            return await DriverServiceModule.drawOverAppsPermissionStatus();
        } catch (e) {
            console.error('Error checking draw over apps permission:', e);
            return false;
        }
    }

    /**
     * Requests the Draw Over Other Apps permission by opening settings.
     */
    static requestDrawOverAppsPermission(): void {
        if (!this.isAndroid || !DriverServiceModule) return;
        DriverServiceModule.requestDrawOverAppsPermission();
    }

    /**
     * Brings the app from the background to the foreground.
     */
    static bringAppToForeground(): void {
        if (!this.isAndroid || !DriverServiceModule) return;
        DriverServiceModule.bringAppToForeground();
    }

    /**
     * Starts continuous ringing (using default alarm/ringtone).
     */
    static startRinging(): void {
        if (!this.isAndroid || !DriverServiceModule) return;
        DriverServiceModule.startRinging();
    }

    /**
     * Stops the continuous ringing.
     */
    static stopRinging(): void {
        if (!this.isAndroid || !DriverServiceModule) return;
        DriverServiceModule.stopRinging();
    }
}
