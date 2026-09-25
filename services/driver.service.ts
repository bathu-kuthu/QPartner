import { supabase } from '@/config/supabase';
import { Ride, DriverEarning, Notification, Review, RideStop, SosAlert, DriverPlatformFee } from '@/types';

// ─── Service type mapping ────────────────────────────────────────────────────
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
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
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

// ─── Rides SELECT columns ────────────────────────────────────────────────────
const RIDE_COLUMNS = 'id, user_id, service_type, pickup_location, drop_location, pickup_address, drop_address, distance_km, fare, base_fare, distance_fare, waiting_charge, status, driver_id, details, is_reviewed, cancel_reason, sender_phone, receiver_phone, is_multi_stop, stop_count, created_at, updated_at';
const RIDE_COLUMNS_WITH_USER = `${RIDE_COLUMNS}, user:users!user_id(phone, name)`;

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
                .select(RIDE_COLUMNS)
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

            if (driverLat == null || driverLng == null) return rawRides;
            
            const rides = [...rawRides];

            rides.sort((a, b) => {
                const dA = haversineKm(driverLat, driverLng, a.pickup_location?.latitude ?? 0, a.pickup_location?.longitude ?? 0);
                const dB = haversineKm(driverLat, driverLng, b.pickup_location?.latitude ?? 0, b.pickup_location?.longitude ?? 0);
                return dA - dB;
            });

            return rides;
        } catch (err: any) {
            if (err.message === 'NETWORK_ERROR') throw err;
            return [];
        }
    }

    // ── Accept a ride (atomic via RPC) ───────────────────────────────────────
    static async acceptRide(rideId: string, driverId: string): Promise<Ride> {
        const { data, error } = await supabase
            .rpc('accept_ride', { p_ride_id: rideId, p_driver_id: driverId });

        if (error) {
            if (error.message?.includes('Failed to fetch') || error.message?.includes('network')) {
                throw new Error('NETWORK_ERROR');
            }
            throw new Error(error.message || 'Ride no longer available');
        }
        if (!data) throw new Error('Ride no longer available');
        return data as Ride;
    }

    // ── Get driver's active ride ─────────────────────────────────────────────
    static async getActiveRide(driverId: string): Promise<Ride | null> {
        try {
            const { data, error } = await supabase
                .from('rides')
                .select(RIDE_COLUMNS_WITH_USER)
                .eq('driver_id', driverId)
                .in('status', ['accepted', 'picked_up', 'on_ride'])
                .maybeSingle();

            if (error) {
                if (error.message?.includes('Failed to fetch') || error.message?.includes('network')) {
                    throw new Error('NETWORK_ERROR');
                }
                return null;
            }
            return (data as unknown as Ride) ?? null;
        } catch (err: any) {
            if (err.message === 'NETWORK_ERROR') throw err;
            return null;
        }
    }

    // ── Update ride status ───────────────────────────────────────────────────
    static async updateRideStatus(
        rideId: string,
        status: 'picked_up' | 'on_ride' | 'completed' | 'cancelled',
        cancelReason?: string
    ): Promise<void> {
        const update: any = { status, updated_at: new Date().toISOString() };
        if (cancelReason) update.cancel_reason = cancelReason;

        const { error } = await supabase
            .from('rides')
            .update(update)
            .eq('id', rideId);

        if (error) {
            if (error.message?.includes('Failed to fetch') || error.message?.includes('network')) {
                throw new Error('NETWORK_ERROR');
            }
            throw new Error('Failed to update ride status');
        }

        if (status === 'completed') {
            const { data: ride, error: rideError } = await supabase
                .from('rides')
                .select('fare, driver_id')
                .eq('id', rideId)
                .single();

            if (rideError) {
                throw new Error(rideError.message || 'Failed to fetch ride details for completion');
            }

            if (ride?.driver_id) {
                const driverAmount = Math.round(ride.fare * 0.8 * 100) / 100;
                const { error: txError } = await supabase.rpc('complete_driver_ride', {
                    p_ride_id: rideId,
                    p_driver_id: ride.driver_id,
                    p_earnings_amount: driverAmount,
                });

                if (txError) {
                    throw new Error(txError.message || 'Failed to complete ride earnings and stats');
                }
            }
        }
    }

    // ── Realtime: pending rides ──────────────────────────────────────────────
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
    static subscribeToRide(rideId: string, callback: (ride: Ride) => void) {
        const channelName = `ride_${rideId}_${Date.now()}`;
        return supabase
            .channel(channelName)
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'rides', filter: `id=eq.${rideId}` },
                async () => {
                    const { data } = await supabase
                        .from('rides')
                        .select(RIDE_COLUMNS_WITH_USER)
                        .eq('id', rideId)
                        .single();
                    if (data) callback(data as unknown as Ride);
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
                .select(RIDE_COLUMNS)
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

    // ── Notifications ────────────────────────────────────────────────────────
    static async getNotifications(driverId: string): Promise<Notification[]> {
        try {
            const { data } = await supabase
                .from('notifications')
                .select('*')
                .eq('user_id', driverId)
                .order('created_at', { ascending: false })
                .limit(50);
            return (data ?? []) as Notification[];
        } catch { return []; }
    }

    static async markNotificationRead(notificationId: string): Promise<void> {
        await supabase
            .from('notifications')
            .update({ is_read: true })
            .eq('id', notificationId);
    }

    static async markAllNotificationsRead(driverId: string): Promise<void> {
        await supabase
            .from('notifications')
            .update({ is_read: true })
            .eq('user_id', driverId)
            .eq('is_read', false);
    }

    static subscribeToNotifications(driverId: string, callback: (n: Notification) => void) {
        return supabase
            .channel(`notifications_${driverId}_${Date.now()}`)
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${driverId}` },
                (payload) => callback(payload.new as Notification)
            )
            .subscribe();
    }

    // ── Reviews ──────────────────────────────────────────────────────────────
    static async getMyReviews(driverId: string): Promise<Review[]> {
        try {
            const { data } = await supabase
                .from('reviews')
                .select('*')
                .eq('driver_id', driverId)
                .eq('review_target', 'driver')
                .order('created_at', { ascending: false });
            return (data ?? []) as Review[];
        } catch { return []; }
    }

    // ── Ride stops (multi-stop rides) ────────────────────────────────────────
    static async getRideStops(rideId: string): Promise<RideStop[]> {
        try {
            const { data } = await supabase
                .from('ride_stops')
                .select('*')
                .eq('ride_id', rideId)
                .order('seq', { ascending: true });
            return (data ?? []) as RideStop[];
        } catch { return []; }
    }

    static async updateStopStatus(
        stopId: string,
        status: 'arrived' | 'completed' | 'skipped'
    ): Promise<void> {
        const update: any = { status, updated_at: new Date().toISOString() };
        if (status === 'arrived') update.arrived_at = new Date().toISOString();
        if (status === 'completed') update.completed_at = new Date().toISOString();
        await supabase.from('ride_stops').update(update).eq('id', stopId);
    }

    // ── SOS Alert ────────────────────────────────────────────────────────────
    static async triggerSOS(
        driverId: string,
        rideId?: string,
        lat?: number,
        lng?: number,
        message?: string
    ): Promise<void> {
        await supabase.from('sos_alerts').insert({
            triggered_by: driverId,
            ride_id: rideId ?? null,
            lat: lat ?? null,
            lng: lng ?? null,
            message: message ?? 'SOS triggered by driver',
            status: 'active',
        });
    }

    // ── Platform Fees ────────────────────────────────────────────────────────
    static async getMyPlatformFees(driverId: string): Promise<DriverPlatformFee[]> {
        try {
            const { data } = await supabase
                .from('driver_platform_fees')
                .select('*')
                .eq('user_id', driverId)
                .order('payment_date', { ascending: false });
            return (data ?? []) as DriverPlatformFee[];
        } catch { return []; }
    }
}