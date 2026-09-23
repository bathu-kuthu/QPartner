import { NativeModules, Platform } from 'react-native';

const { DriverServiceModule } = NativeModules;

export class NativeBridgeService {
    static isAndroid = Platform.OS === 'android';

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

    /**
     * Starts the floating widget foreground service.
     */
    static startFloatingWidget(): void {
        if (!this.isAndroid || !DriverServiceModule) return;
        DriverServiceModule.startFloatingWidget();
    }

    /**
     * Stops the floating widget foreground service.
     */
    static stopFloatingWidget(): void {
        if (!this.isAndroid || !DriverServiceModule) return;
        DriverServiceModule.stopFloatingWidget();
    }

    /**
     * Updates the data displayed in the floating widget.
     */
    static updateFloatingWidgetData(jsonData: string): void {
        if (!this.isAndroid || !DriverServiceModule) return;
        DriverServiceModule.updateFloatingWidgetData(jsonData);
    }

    /**
     * Checks if Draw Over Other Apps (SYSTEM_ALERT_WINDOW) permission is granted.
     */
    static async checkDrawOverAppsPermission(): Promise<boolean> {
        if (!this.isAndroid || !DriverServiceModule) return true;
        return await DriverServiceModule.checkDrawOverAppsPermission();
    }

    /**
     * Opens Android settings to request Draw Over Other Apps permission.
     */
    static requestDrawOverAppsPermission(): void {
        if (!this.isAndroid || !DriverServiceModule) return;
        DriverServiceModule.requestDrawOverAppsPermission();
    }
}
