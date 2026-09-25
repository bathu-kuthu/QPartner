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
     * Optimistic conditional claim attempt.
     * Transitions grocery order from 'preparing' to 'out_for_delivery' if available.
     */
    static async claimOrder(orderId: string): Promise<GroceryOrder> {
        try {
            const { data, error } = await supabase
                .from('orders')
                .update({
                    status: 'out_for_delivery',
                    updated_at: new Date().toISOString(),
                })
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
     * Update grocery delivery status ('out_for_delivery' -> 'delivered').
     */
    static async updateOrderStatus(
        orderId: string,
        nextStatus: 'out_for_delivery' | 'delivered'
    ): Promise<GroceryOrder> {
        try {
            const { data, error } = await supabase
                .from('orders')
                .update({
                    status: nextStatus,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', orderId)
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
     * Fetch completed or cancelled grocery order history.
     */
    static async getOrderHistory(): Promise<GroceryOrder[]> {
        try {
            const { data, error } = await supabase
                .from('orders')
                .select(ORDER_COLUMNS_WITH_STORE)
                .eq('store_type', 'grocery')
                .in('status', ['delivered', 'cancelled'])
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
        driverLat?: number,
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
                        const orders = await GroceryDriverService.getAvailableOrders(driverLat, driverLng);
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
