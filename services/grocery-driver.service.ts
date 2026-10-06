import { supabase } from '@/config/supabase';
import { GroceryOrder } from '@/types';
import { haversineKm } from '@/services/driver.service';

const ORDER_COLUMNS = 'id, user_id, store_id, store_type, items, subtotal, delivery_fee, total, delivery_address, status, payment_method, payment_status, notes, delivery_lat, delivery_lng, store_lat, store_lng, customer_name, customer_phone, distance_km, created_at, updated_at';
const ORDER_COLUMNS_WITH_STORE = `${ORDER_COLUMNS}, store:stores(id, name, type, address, latitude, longitude, rating, rating_count, image_url, is_active, phone)`;

export class GroceryDriverService {
    /**
     * Fetch available grocery orders ready for delivery pickup.
     * Filters: store_type = 'grocery', status = 'preparing'.
     * Sorts by proximity to driver if coordinates are provided.
     */
    static async getAvailableOrders(driverLat?: number, driverLng?: number): Promise<GroceryOrder[]> {
        try {
            const { data, error } = await supabase
                .from('orders')
                .select(ORDER_COLUMNS_WITH_STORE)
                .eq('store_type', 'grocery')
                .eq('status', 'preparing')
                .order('created_at', { ascending: false });

            if (error) {
                if (error.message?.includes('Failed to fetch') || error.message?.includes('network')) {
                    throw new Error('NETWORK_ERROR');
                }
                return [];
            }

            const rawOrders = (data ?? []) as unknown as GroceryOrder[];

            if (driverLat == null || driverLng == null) return rawOrders;

            const orders = [...rawOrders];
            orders.sort((a, b) => {
                const sLatA = a.store_lat ?? a.store?.latitude ?? 0;
                const sLngA = a.store_lng ?? a.store?.longitude ?? 0;
                const sLatB = b.store_lat ?? b.store?.latitude ?? 0;
                const sLngB = b.store_lng ?? b.store?.longitude ?? 0;

                const dA = (sLatA && sLngA) ? haversineKm(driverLat, driverLng, sLatA, sLngA) : 999;
                const dB = (sLatB && sLngB) ? haversineKm(driverLat, driverLng, sLatB, sLngB) : 999;
                return dA - dB;
            });

            return orders;
        } catch (err: any) {
            if (err.message === 'NETWORK_ERROR') throw err;
            return [];
        }
    }

    /**
     * Optimistic conditional claim attempt with driver ownership.
     * Transitions grocery order from 'preparing' to 'out_for_delivery' atomically.
     */
    static async claimOrder(orderId: string, driverId?: string): Promise<GroceryOrder> {
        try {
            // Attempt atomic RPC if driverId is provided
            if (driverId) {
                try {
                    const { data: rpcData, error: rpcError } = await supabase.rpc('claim_grocery_order', {
                        p_order_id: orderId,
                        p_driver_id: driverId,
                    });
                    if (!rpcError && rpcData) {
                        return rpcData as unknown as GroceryOrder;
                    }
                } catch {
                    // Fall back to direct conditional update if RPC is not deployed yet
                }
            }

            const updatePayload: any = {
                status: 'out_for_delivery',
                updated_at: new Date().toISOString(),
            };
            if (driverId) {
                updatePayload.driver_id = driverId;
            }

            const { data, error } = await supabase
                .from('orders')
                .update(updatePayload)
                .eq('id', orderId)
                .eq('status', 'preparing')
                .select(ORDER_COLUMNS_WITH_STORE)
                .single();

            if (error || !data) {
                if (error?.message?.includes('Failed to fetch') || error?.message?.includes('network')) {
                    throw new Error('NETWORK_ERROR');
                }
                throw new Error('Order is no longer available');
            }

            return data as unknown as GroceryOrder;
        } catch (err: any) {
            if (err.message === 'NETWORK_ERROR') throw err;
            throw new Error(err.message || 'Order is no longer available');
        }
    }

    /**
     * Get active grocery delivery currently claimed by a driver.
     */
    static async getActiveGroceryOrder(driverId: string): Promise<GroceryOrder | null> {
        try {
            const { data, error } = await supabase
                .from('orders')
                .select(ORDER_COLUMNS_WITH_STORE)
                .eq('store_type', 'grocery')
                .eq('driver_id', driverId)
                .eq('status', 'out_for_delivery')
                .maybeSingle();

            if (error) {
                if (error.message?.includes('Failed to fetch') || error.message?.includes('network')) {
                    throw new Error('NETWORK_ERROR');
                }
                return null;
            }

            return (data as unknown as GroceryOrder) ?? null;
        } catch (err: any) {
            if (err.message === 'NETWORK_ERROR') throw err;
            return null;
        }
    }

    /**
     * Get active grocery delivery by ID.
     */
    static async getOrderById(orderId: string): Promise<GroceryOrder | null> {
        try {
            const { data, error } = await supabase
                .from('orders')
                .select(ORDER_COLUMNS_WITH_STORE)
                .eq('id', orderId)
                .maybeSingle();

            if (error) {
                if (error.message?.includes('Failed to fetch') || error.message?.includes('network')) {
                    throw new Error('NETWORK_ERROR');
                }
                return null;
            }

            return data as unknown as GroceryOrder ?? null;
        } catch (err: any) {
            if (err.message === 'NETWORK_ERROR') throw err;
            return null;
        }
    }

    /**
     * Update grocery delivery status with optional driver ownership verification.
     */
    static async updateOrderStatus(
        orderId: string,
        nextStatus: 'out_for_delivery' | 'delivered',
        driverId?: string
    ): Promise<GroceryOrder> {
        try {
            let query = supabase
                .from('orders')
                .update({
                    status: nextStatus,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', orderId);

            if (driverId) {
                query = query.eq('driver_id', driverId);
            }

            const { data, error } = await query
                .select(ORDER_COLUMNS_WITH_STORE)
                .single();

            if (error || !data) {
                if (error?.message?.includes('Failed to fetch') || error?.message?.includes('network')) {
                    throw new Error('NETWORK_ERROR');
                }
                throw new Error(error?.message || 'Failed to update grocery order status');
            }

            return data as unknown as GroceryOrder;
        } catch (err: any) {
            if (err.message === 'NETWORK_ERROR') throw err;
            throw err;
        }
    }

    /**
     * Complete grocery delivery and record earnings.
     */
    static async completeDelivery(
        orderId: string,
        driverId: string,
        deliveryFee: number
    ): Promise<GroceryOrder> {
        // Try atomic RPC first
        try {
            const { error: rpcErr } = await supabase.rpc('complete_grocery_delivery', {
                p_order_id: orderId,
                p_driver_id: driverId,
                p_earnings_amount: deliveryFee,
            });
            if (!rpcErr) {
                const refreshed = await GroceryDriverService.getOrderById(orderId);
                if (refreshed) return refreshed;
            }
        } catch {
            // RPC fallback
        }

        const updated = await GroceryDriverService.updateOrderStatus(orderId, 'delivered', driverId);
        try {
            // Insert driver earnings
            await supabase.from('driver_earnings').insert({
                driver_id: driverId,
                order_id: orderId,
                amount: deliveryFee,
                created_at: new Date().toISOString(),
            });
            // Increment total rides in users profile
            const { data: userData } = await supabase.from('users').select('total_rides').eq('id', driverId).single();
            if (userData) {
                await supabase.from('users').update({
                    total_rides: (userData.total_rides || 0) + 1,
                    updated_at: new Date().toISOString(),
                }).eq('id', driverId);
            }
        } catch (earningsErr) {
            console.warn('[GroceryDriverService] Failed to record earnings row:', earningsErr);
        }
        return updated;
    }

    /**
     * Fetch completed or cancelled grocery order history, scoped by driver if provided.
     */
    static async getOrderHistory(driverId?: string): Promise<GroceryOrder[]> {
        try {
            let query = supabase
                .from('orders')
                .select(ORDER_COLUMNS_WITH_STORE)
                .eq('store_type', 'grocery')
                .in('status', ['delivered', 'cancelled']);

            if (driverId) {
                query = query.eq('driver_id', driverId);
            }

            const { data, error } = await query
                .order('created_at', { ascending: false })
                .limit(50);

            if (error) return [];
            return (data ?? []) as unknown as GroceryOrder[];
        } catch {
            return [];
        }
    }

    /**
     * Realtime subscription for incoming grocery orders in 'preparing' state.
     */
    static subscribeToPendingOrders(
        onUpdate: (orders: GroceryOrder[]) => void,
        driverLatOrGetter?: number | (() => { lat?: number; lng?: number } | undefined),
        driverLng?: number
    ) {
        const instanceId = Math.random().toString(36).slice(2, 9);
        const channel = supabase
            .channel(`grocery_orders_pending_${instanceId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'orders',
                    filter: `store_type=eq.grocery`,
                },
                async () => {
                    try {
                        let lat: number | undefined;
                        let lng: number | undefined;

                        if (typeof driverLatOrGetter === 'function') {
                            const resolved = driverLatOrGetter();
                            lat = resolved?.lat;
                            lng = resolved?.lng;
                        } else {
                            lat = driverLatOrGetter;
                            lng = driverLng;
                        }

                        const orders = await GroceryDriverService.getAvailableOrders(lat, lng);
                        onUpdate(orders);
                    } catch (e) {
                        console.warn('[GroceryDriverService] Realtime update error:', e);
                    }
                }
            )
            .subscribe();

        return channel;
    }

    /**
     * Realtime subscription for a single active grocery order.
     */
    static subscribeToOrder(orderId: string, onUpdate: (order: GroceryOrder) => void) {
        const instanceId = Math.random().toString(36).slice(2, 9);
        const channel = supabase
            .channel(`grocery_order_${orderId}_${instanceId}`)
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'orders',
                    filter: `id=eq.${orderId}`,
                },
                (payload) => {
                    if (payload.new) {
                        GroceryDriverService.getOrderById(orderId).then((fullOrder) => {
                            if (fullOrder) onUpdate(fullOrder);
                        });
                    }
                }
            )
            .subscribe();

        return channel;
    }
}
