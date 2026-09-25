import { Driver, FoodOrder, GroceryOrder, Ride, UnifiedWorkItem } from '@/types';
import { DriverService, getServiceTypesForDriver } from '@/services/driver.service';
import { FoodDriverService } from '@/services/food-driver.service';
import { GroceryDriverService } from '@/services/grocery-driver.service';

export type UnifiedListener = (item: UnifiedWorkItem | null) => void;

export class UnifiedInboxService {
    private static currentAlert: UnifiedWorkItem | null = null;
    private static listeners: Set<UnifiedListener> = new Set();
    private static channels: any[] = [];
    private static isInitialized = false;

    /**
     * Subscribe to unified incoming work alerts.
     */
    static subscribe(listener: UnifiedListener): () => void {
        this.listeners.add(listener);
        listener(this.currentAlert);

        return () => {
            this.listeners.delete(listener);
        };
    }

    private static emitAlert(item: UnifiedWorkItem | null) {
        this.currentAlert = item;
        this.listeners.forEach((listener) => {
            try {
                listener(item);
            } catch (err) {
                console.warn('[UnifiedInboxService] Listener error:', err);
            }
        });
    }

    /**
     * Clear the current alert (e.g. driver declined or accepted).
     */
    static clearAlert() {
        this.emitAlert(null);
    }

    /**
     * Start unified listeners for online driver.
     */
    static start(driver: Driver, acceptBoth: boolean = false) {
        if (!driver?.id || !driver.is_online) {
            this.stop();
            return;
        }

        this.stop(); // Clean up existing channels
        this.isInitialized = true;

        const isBike = driver.vehicle_type === 'bike';
        const serviceTypes = getServiceTypesForDriver(
            driver.vehicle_category ?? 'taxi',
            driver.vehicle_type ?? 'bike',
            acceptBoth
        );

        // 1. Transport Realtime Channel
        const rideChannel = DriverService.subscribeToPendingRides(
            async () => {
                if (!this.isInitialized) return;
                await this.pollNextWork(driver, serviceTypes, isBike);
            },
            serviceTypes,
            driver.current_lat,
            driver.current_lng
        );
        this.channels.push(rideChannel);

        // 2. Food Realtime Channel (Eligible for bike partners)
        if (isBike) {
            const foodChannel = FoodDriverService.subscribeToPendingOrders(
                async () => {
                    if (!this.isInitialized) return;
                    await this.pollNextWork(driver, serviceTypes, isBike);
                },
                driver.current_lat,
                driver.current_lng
            );
            this.channels.push(foodChannel);

            // 3. Grocery Realtime Channel
            const groceryChannel = GroceryDriverService.subscribeToPendingOrders(
                async () => {
                    if (!this.isInitialized) return;
                    await this.pollNextWork(driver, serviceTypes, isBike);
                },
                driver.current_lat,
                driver.current_lng
            );
            this.channels.push(groceryChannel);
        }

        // Initial check
        this.pollNextWork(driver, serviceTypes, isBike);
    }

    /**
     * Check for active work, then poll available work across domains in order of priority.
     */
    static async pollNextWork(driver: Driver, serviceTypes: string[], isBike: boolean) {
        try {
            // Guard: If driver already has active ride, don't show new incoming alerts
            const activeRide = await DriverService.getActiveRide(driver.id);
            if (activeRide) {
                this.emitAlert(null);
                return;
            }

            // 1. Check Transport Rides
            const rides = await DriverService.getAvailableRides(serviceTypes, driver.current_lat, driver.current_lng);
            if (rides && rides.length > 0) {
                const topRide = rides[0];
                this.emitAlert({
                    domain: 'transport',
                    id: topRide.id,
                    ride: topRide,
                });
                return;
            }

            // 2. If Bike, check Food Orders
            if (isBike) {
                const foodOrders = await FoodDriverService.getAvailableOrders(driver.current_lat, driver.current_lng);
                if (foodOrders && foodOrders.length > 0) {
                    const topFood = foodOrders[0];
                    this.emitAlert({
                        domain: 'food',
                        id: topFood.id,
                        order: topFood,
                    });
                    return;
                }

                // 3. If Bike, check Grocery Orders
                const groceryOrders = await GroceryDriverService.getAvailableOrders(driver.current_lat, driver.current_lng);
                if (groceryOrders && groceryOrders.length > 0) {
                    const topGrocery = groceryOrders[0];
                    this.emitAlert({
                        domain: 'grocery',
                        id: topGrocery.id,
                        order: topGrocery,
                    });
                    return;
                }
            }

            // No work available
            this.emitAlert(null);
        } catch (e) {
            console.warn('[UnifiedInboxService] pollNextWork error:', e);
        }
    }

    /**
     * Stop all unified listeners and channels.
     */
    static stop() {
        this.isInitialized = false;
        this.channels.forEach((channel) => {
            try {
                channel?.unsubscribe?.();
            } catch { /* ignore */ }
        });
        this.channels = [];
        this.emitAlert(null);
    }
}
