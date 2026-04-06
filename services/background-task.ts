import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import { DriverService } from './driver.service';
import { NotificationService } from './notification.service';
import * as SecureStore from 'expo-secure-store';

export const BACKGROUND_RIDE_TASK = 'BACKGROUND_RIDE_POLLING';

// Store service types globally or in SecureStore for the background task to access
const SERVICE_TYPES_KEY = 'driver_service_types';
const DRIVER_ID_KEY = 'driver_id';

export async function setBackgroundTaskData(driverId: string, serviceTypes: string[]) {
    await SecureStore.setItemAsync(DRIVER_ID_KEY, driverId);
    await SecureStore.setItemAsync(SERVICE_TYPES_KEY, JSON.stringify(serviceTypes));
}

TaskManager.defineTask(BACKGROUND_RIDE_TASK, async ({ data, error }: any) => {
    if (error) {
        console.error('Background task error:', error);
        return;
    }

    if (data) {
        const { locations } = data;
        const location = locations[0];
        
        try {
            const driverId = await SecureStore.getItemAsync(DRIVER_ID_KEY);
            const serviceTypesStr = await SecureStore.getItemAsync(SERVICE_TYPES_KEY);
            
            if (!driverId || !serviceTypesStr) return;
            
            const serviceTypes = JSON.parse(serviceTypesStr);
            
            // 1. Update location in DB
            await DriverService.setOnlineStatus(
                driverId, 
                true, 
                location.coords.latitude, 
                location.coords.longitude
            );
            
            // 2. Check for new rides
            const rides = await DriverService.getAvailableRides(
                serviceTypes, 
                location.coords.latitude, 
                location.coords.longitude
            );
            
            if (rides.length > 0) {
                // To avoid spamming, we could track notified ride IDs in memory/SecureStore
                const informedRidesStr = await SecureStore.getItemAsync('informed_rides') || '[]';
                const informedRides = JSON.parse(informedRidesStr);
                
                const newRide = rides[0];
                if (!informedRides.includes(newRide.id)) {
                    await NotificationService.notifyNewBooking(newRide);
                    
                    // Track that we notified for this ride
                    informedRides.push(newRide.id);
                    // Keep only last 10
                    const updated = informedRides.slice(-10);
                    await SecureStore.setItemAsync('informed_rides', JSON.stringify(updated));
                }
            }
        } catch (err) {
            console.error('Error in background ride polling:', err);
        }
    }
});
