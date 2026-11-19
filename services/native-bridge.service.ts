import { NativeModules, Platform } from 'react-native';

const { DriverServiceModule } = NativeModules;

export interface PendingNativeOrderAction {
    orderId: string;
    domain: 'transport' | 'food' | 'grocery';
    action: 'accept' | 'view';
}

export class NativeBridgeService {
    static isAndroid = Platform.OS === 'android';

    /**
     * Returns true when the native Kotlin DriverServiceModule is linked in this APK build.
     */
    static isNativeModuleAvailable(): boolean {
        return this.isAndroid && Boolean(DriverServiceModule);
    }

    /**
     * Starts continuous ringing (using bundled booking_alert or default alarm/ringtone).
     */
    static startRinging(): void {
        if (!this.isAndroid || !DriverServiceModule) return;
        try {
            DriverServiceModule.startRinging();
        } catch {
            // Ignore
        }
    }

    /**
     * Stops the continuous ringing.
     */
    static stopRinging(): void {
        if (!this.isAndroid || !DriverServiceModule) return;
        try {
            DriverServiceModule.stopRinging();
        } catch {
            // Ignore
        }
    }

    /**
     * Starts the floating widget foreground service.
     */
    static startFloatingWidget(): void {
        if (!this.isAndroid || !DriverServiceModule) return;
        try {
            DriverServiceModule.startFloatingWidget();
        } catch {
            // Ignore
        }
    }

    /**
     * Stops the floating widget foreground service.
     */
    static stopFloatingWidget(): void {
        if (!this.isAndroid || !DriverServiceModule) return;
        try {
            DriverServiceModule.stopFloatingWidget();
        } catch {
            // Ignore
        }
    }

    /**
     * Updates the data displayed in the floating widget / order receiver overlay card.
     */
    static updateFloatingWidgetData(jsonData: string): void {
        if (!this.isAndroid || !DriverServiceModule) return;
        try {
            DriverServiceModule.updateFloatingWidgetData(jsonData);
        } catch {
            // Ignore
        }
    }

    /**
     * Notifies the native overlay service whether QPartner is currently visible in the foreground
     * or minimized/backgrounded so the floating pill hides while using the app and shows when minimized.
     */
    static setAppForegroundState(inForeground: boolean): void {
        if (!this.isAndroid || !DriverServiceModule?.setAppForegroundState) return;
        try {
            DriverServiceModule.setAppForegroundState(inForeground);
        } catch {
            // Ignore
        }
    }

    /**
     * Syncs Supabase endpoint, anon key, driver ID, eligible service types, and online status
     * into native SharedPreferences so DriverOverlayService can poll Supabase every 5s in native Kotlin
     * even when the React Native app is completely closed / swiped from Recents.
     */
    static syncDriverSession(
        driverId: string,
        serviceTypes: string[],
        isBike: boolean,
        isOnline: boolean
    ): void {
        if (!this.isAndroid || !DriverServiceModule?.syncDriverSession) return;
        try {
            const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
            const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
            DriverServiceModule.syncDriverSession(
                supabaseUrl,
                supabaseKey,
                driverId,
                JSON.stringify(serviceTypes),
                Boolean(isBike),
                Boolean(isOnline)
            );
        } catch {
            // Ignore
        }
    }

    /**
     * Marks an order ID as handled in native SharedPreferences and dismisses any active floating order card.
     */
    static markOrderHandled(orderId?: string | null): void {
        if (!orderId || !this.isAndroid || !DriverServiceModule?.markOrderHandled) return;
        try {
            DriverServiceModule.markOrderHandled(String(orderId));
        } catch {
            // Ignore
        }
    }

    /**
     * Retrieves and clears any pending order Accept/View action triggered from the native
     * Floating Order Receiver Card while the app was in background or closed.
     */
    static async consumePendingOrderAction(): Promise<PendingNativeOrderAction | null> {
        if (!this.isAndroid || !DriverServiceModule?.consumePendingOrderAction) return null;
        try {
            const res = await DriverServiceModule.consumePendingOrderAction();
            if (!res || !res.orderId) return null;
            return {
                orderId: String(res.orderId),
                domain: (res.domain as 'transport' | 'food' | 'grocery') || 'transport',
                action: (res.action as 'accept' | 'view') || 'view',
            };
        } catch {
            return null;
        }
    }

    /**
     * Checks if Draw Over Other Apps (SYSTEM_ALERT_WINDOW) permission is granted.
     */
    static async checkDrawOverAppsPermission(): Promise<boolean> {
        if (!this.isAndroid || !DriverServiceModule) return true;
        try {
            return await DriverServiceModule.checkDrawOverAppsPermission();
        } catch {
            return true;
        }
    }

    /**
     * Opens Android settings to request Draw Over Other Apps permission.
     */
    static requestDrawOverAppsPermission(): void {
        if (!this.isAndroid || !DriverServiceModule) return;
        try {
            DriverServiceModule.requestDrawOverAppsPermission();
        } catch {
            // Ignore
        }
    }
}
