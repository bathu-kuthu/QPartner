import { supabase } from '@/config/supabase';
import { Ride, DriverEarning } from '@/types';

// ─── Service type mapping ────────────────────────────────────────────────────
// Rules:
//   taxi + bike    → taxi_bike, bike_taxi        (+ log_bike if acceptBoth=true)
//   taxi + auto    → taxi_auto only
//   taxi + cab     → taxi_car only
//   log  + bike    → log_bike                    (+ taxi_bike, bike_taxi if acceptBoth=true)
//   log  + mini_truck→ log_mini_truck only
//   log  + truck   → log_truck only
export function getServiceTypesForDriver(
    category: 'taxi' | 'logistics',
    vehicleType: string,
    acceptBoth: boolean = false
): string[] {
    if (category === 'taxi') {
        if (vehicleType === 'bike') {
            const base = ['taxi_bike', 'bike_taxi'];
            return acceptBoth ? [...base, 'log_bike'] : base;
        }
        if (vehicleType === 'auto') return ['taxi_auto'];
        if (vehicleType === 'cab') return ['taxi_car'];
    }
    if (category === 'logistics') {
        if (vehicleType === 'bike') {
            const base = ['log_bike'];
            return acceptBoth ? [...base, 'taxi_bike', 'bike_taxi'] : base;
        }
        if (vehicleType === 'mini_truck') return ['log_mini_truck'];
        if (vehicleType === 'truck') return ['log_truck'];
    }
    return [];
}

// ─── Distance helper (Haversine, km) ────────────────────────────────────────
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export class DriverService {
    // ── Fetch available rides, filtered & sorted by proximity ────────────────
    static async getAvailableRides(
        serviceTypes: string[],
        driverLat?: number,
        driverLng?: number
    ): Promise<Ride[]> {
        try {
            if (serviceTypes.length === 0) return [];

            const { data, error } = await supabase
                .from('rides')
                .select('*')
                .eq('status', 'pending')
                .is('driver_id', null)
                .in('service_type', serviceTypes)
                .order('created_at', { ascending: false });

            if (error) {
                if (error.message?.includes('Failed to fetch') || error.message?.includes('network')) {
                    throw new Error('NETWORK_ERROR');
                }
                return [];
            }

            const rawRides = (data ?? []) as Ride[];

            // Filter for rides within 3km of the driver's current position
            if (driverLat == null || driverLng == null) return []; // Cannot satisfy distance check
            
            const rides = rawRides.filter((ride) => {
                const dist = haversineKm(
                    driverLat, driverLng,
                    ride.pickup_location?.latitude ?? 0,
                    ride.pickup_location?.longitude ?? 0
                );
                return dist < 3.0; // Distance < 3 km
            });

            // Sort nearest pickup first
            rides.sort((a, b) => {
                const dA = haversineKm(
                    driverLat, driverLng,
                    a.pickup_location?.latitude ?? 0,
                    a.pickup_location?.longitude ?? 0
                );
                const dB = haversineKm(
                    driverLat, driverLng,
                    b.pickup_location?.latitude ?? 0,
                    b.pickup_location?.longitude ?? 0
                );
                return dA - dB;
            });

            return rides;
        } catch (err: any) {
            if (err.message === 'NETWORK_ERROR') throw err;
            return [];
        }
    }

    // ── Accept a ride (atomic) ───────────────────────────────────────────────
    static async acceptRide(rideId: string, driverId: string): Promise<Ride> {
        const { data: existingRide, error: checkError } = await supabase
            .from('rides')
            .select('id')
            .eq('driver_id', driverId)
            .in('status', ['accepted', 'picked_up', 'on_ride'])
            .maybeSingle();

        if (checkError?.message?.includes('Failed to fetch')) throw new Error('NETWORK_ERROR');
        if (existingRide) throw new Error('You already have an active ride');

        const { data, error } = await supabase
            .from('rides')
            .update({ driver_id: driverId, status: 'accepted', updated_at: new Date().toISOString() })
            .eq('id', rideId)
            .eq('status', 'pending')
            .is('driver_id', null)
            .select('*, user:users!user_id(phone, name)')
            .single();

        if (error) {
            if (error.message?.includes('Failed to fetch') || error.message?.includes('network')) {
                throw new Error('NETWORK_ERROR');
            }
            throw new Error('Ride no longer available');
        }
        if (!data) throw new Error('Ride no longer available');
        return data as Ride;
    }

    // ── Get driver's active ride ─────────────────────────────────────────────
    static async getActiveRide(driverId: string): Promise<Ride | null> {
        try {
            const { data, error } = await supabase
                .from('rides')
                .select('*, user:users!user_id(phone, name)')
                .eq('driver_id', driverId)
                .in('status', ['accepted', 'picked_up', 'on_ride'])
                .maybeSingle();

            if (error) return null;
            return (data as Ride) ?? null;
        } catch {
            return null;
        }
    }

    // ── Update ride status ───────────────────────────────────────────────────
    static async updateRideStatus(
        rideId: string,
        status: 'picked_up' | 'on_ride' | 'completed' | 'cancelled'
    ): Promise<void> {
        const { error } = await supabase
            .from('rides')
            .update({ status, updated_at: new Date().toISOString() })
            .eq('id', rideId);

        if (error) {
            if (error.message?.includes('Failed to fetch') || error.message?.includes('network')) {
                throw new Error('NETWORK_ERROR');
            }
            throw new Error('Failed to update ride status');
        }

        if (status === 'completed') {
            const { data: ride } = await supabase
                .from('rides')
                .select('fare, driver_id')
                .eq('id', rideId)
                .single();

            if (ride?.driver_id) {
                const driverAmount = Math.round(ride.fare * 0.8 * 100) / 100;
                await supabase.from('driver_earnings').insert({
                    driver_id: ride.driver_id,
                    ride_id: rideId,
                    amount: driverAmount,
                });
                await supabase.rpc('increment_driver_rides', { driver_id: ride.driver_id });
            }
        }
    }

    // ── Realtime: pending rides ──────────────────────────────────────────────
    // FIX: Use timestamp in channel name — prevents "cannot add callbacks after subscribe()" error
    static subscribeToPendingRides(
        callback: (rides: Ride[]) => void,
        serviceTypes: string[],
        driverLat?: number,
        driverLng?: number
    ) {
        const channelName = `pending_rides_${Date.now()}`;
        return supabase
            .channel(channelName)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'rides', filter: 'status=eq.pending' },
                async () => {
                    try {
                        const rides = await DriverService.getAvailableRides(serviceTypes, driverLat, driverLng);
                        callback(rides);
                    } catch {
                        // ignore realtime fetch errors silently
                    }
                }
            )
            .subscribe();
    }

    // ── Realtime: specific ride ──────────────────────────────────────────────
    // FIX: timestamp suffix prevents duplicate-channel crash from StrictMode double-mount
    static subscribeToRide(rideId: string, callback: (ride: Ride) => void) {
        const channelName = `ride_${rideId}_${Date.now()}`;
        return supabase
            .channel(channelName)
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'rides', filter: `id=eq.${rideId}` },
                async (payload) => {
                    const { data } = await supabase
                        .from('rides')
                        .select('*, user:users!user_id(phone, name)')
                        .eq('id', rideId)
                        .single();
                    if (data) callback(data as Ride);
                }
            )
            .subscribe();
    }

    // ── Earnings ─────────────────────────────────────────────────────────────
    static async getEarnings(driverId: string): Promise<DriverEarning[]> {
        try {
            const { data, error } = await supabase
                .from('driver_earnings')
                .select('*, ride:rides(*)')
                .eq('driver_id', driverId)
                .order('created_at', { ascending: false });
            if (error) return [];
            return (data ?? []) as DriverEarning[];
        } catch { return []; }
    }

    static async getTodayEarnings(driverId: string): Promise<number> {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        try {
            const { data } = await supabase
                .from('driver_earnings')
                .select('amount')
                .eq('driver_id', driverId)
                .gte('created_at', today.toISOString());
            return (data ?? []).reduce((s: number, e: any) => s + (e.amount || 0), 0);
        } catch { return 0; }
    }

    static async getRideHistory(driverId: string): Promise<Ride[]> {
        try {
            const { data, error } = await supabase
                .from('rides')
                .select('*')
                .eq('driver_id', driverId)
                .in('status', ['completed', 'cancelled'])
                .order('created_at', { ascending: false });
            if (error) return [];
            return (data ?? []) as Ride[];
        } catch { return []; }
    }

    // ── Online status + location ─────────────────────────────────────────────
    static async setOnlineStatus(
        driverId: string,
        isOnline: boolean,
        lat?: number,
        lng?: number
    ): Promise<void> {
        const update: any = { is_online: isOnline };
        if (lat != null && lng != null) {
            update.current_lat = lat;
            update.current_lng = lng;
        }
        await supabase.from('users').update(update).eq('id', driverId);
    }
}