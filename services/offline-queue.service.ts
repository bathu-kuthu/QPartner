import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { supabase } from '@/config/supabase';

export interface QueuedAction {
    id: string;
    type: 'ride_status' | 'food_status' | 'grocery_status' | 'complete_delivery';
    targetId: string;
    payload: Record<string, any>;
    createdAt: number;
    retryCount: number;
}

const QUEUE_STORAGE_KEY = '@quickora_offline_queue';

class OfflineQueueServiceImpl {
    private isProcessing = false;
    private initialized = false;

    init() {
        if (this.initialized) return;
        this.initialized = true;

        NetInfo.addEventListener((state) => {
            if (state.isConnected && state.isInternetReachable !== false) {
                this.processQueue();
            }
        });
    }

    async enqueue(type: QueuedAction['type'], targetId: string, payload: Record<string, any>): Promise<void> {
        try {
            const queue = await this.getQueue();
            const action: QueuedAction = {
                id: `${type}_${targetId}_${Date.now()}`,
                type,
                targetId,
                payload,
                createdAt: Date.now(),
                retryCount: 0,
            };
            queue.push(action);
            await AsyncStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
            console.log(`[OfflineQueue] Enqueued action ${action.id}`);
            // Attempt processing immediately if online
            this.processQueue();
        } catch (e) {
            console.error('[OfflineQueue] Failed to enqueue action:', e);
        }
    }

    async getQueue(): Promise<QueuedAction[]> {
        try {
            const data = await AsyncStorage.getItem(QUEUE_STORAGE_KEY);
            return data ? JSON.parse(data) : [];
        } catch {
            return [];
        }
    }

    async processQueue(): Promise<void> {
        if (this.isProcessing) return;
        this.isProcessing = true;

        try {
            const queue = await this.getQueue();
            if (queue.length === 0) {
                this.isProcessing = false;
                return;
            }

            console.log(`[OfflineQueue] Processing ${queue.length} pending actions...`);
            const remaining: QueuedAction[] = [];

            // Authoritative Authenticated Driver Identity Resolution
            // Strictly resolve current authenticated Supabase user via supabase.auth.getUser()
            // and map through existing user-to-driver schema (public.users where is_driver = true).
            // Never trust action.payload.driverId as an authenticated identity.
            let authenticatedDriverId: string | null = null;
            try {
                const { data: authData, error: authError } = await supabase.auth.getUser();
                if (!authError && authData?.user?.id) {
                    const authUserId = authData.user.id;
                    const { data: driverRow, error: driverErr } = await supabase
                        .from('users')
                        .select('id, is_driver')
                        .or(`auth_id.eq.${authUserId},id.eq.${authUserId}`)
                        .eq('is_driver', true)
                        .maybeSingle();

                    if (!driverErr && driverRow?.id && driverRow.is_driver) {
                        authenticatedDriverId = driverRow.id;
                    }
                }
            } catch (authErr) {
                console.warn('[OfflineQueue] Exception resolving authenticated driver identity:', authErr);
            }

            // If authentication or driver mapping is unavailable, do not execute the queued action.
            // Retain it for safe retry.
            if (!authenticatedDriverId) {
                console.warn('[OfflineQueue] Driver authentication or mapping unavailable. Retaining all queued actions for safe retry.');
                this.isProcessing = false;
                return;
            }

            for (const action of queue) {
                try {
                    let success = false;

                    switch (action.type) {
                        case 'ride_status': {
                            // 1. Fetch authoritative ride record to verify driver ownership and current status
                            const { data: existingRide, error: fetchErr } = await supabase
                                .from('rides')
                                .select('id, status, driver_id')
                                .eq('id', action.targetId)
                                .maybeSingle();

                            if (fetchErr) {
                                // Network / transient database error: retry action
                                success = false;
                                break;
                            }

                            if (!existingRide) {
                                console.warn(`[OfflineQueue] Ride ${action.targetId} not found in DB. Discarding action.`);
                                success = true; // Drop non-existent ride
                                break;
                            }

                            // 2. Ownership Security Check: verify ride is assigned to the authenticated driver
                            if (existingRide.driver_id !== authenticatedDriverId) {
                                console.warn(`[OfflineQueue] Ride ${action.targetId} is assigned to driver ${existingRide.driver_id}, not authenticated driver ${authenticatedDriverId}. Discarding unauthorized status update.`);
                                success = true; // Drop unauthorized action to avoid invalid retries
                                break;
                            }

                            // 3. Idempotent check: if already at target status, resolve successfully
                            if (existingRide.status === action.payload.status) {
                                console.log(`[OfflineQueue] Ride ${action.targetId} is already at status ${action.payload.status}. Idempotent success.`);
                                success = true;
                                break;
                            }

                            // 4. Lifecycle integrity: if already completed or cancelled, prevent status regression
                            if (['completed', 'cancelled'].includes(existingRide.status)) {
                                console.warn(`[OfflineQueue] Ride ${action.targetId} is already finalized (${existingRide.status}). Cannot transition to ${action.payload.status}.`);
                                success = true; // Finalized state preserved
                                break;
                            }

                            // 5. Update only with authenticated driver filter
                            const { data: updatedRows, error: updateErr } = await supabase
                                .from('rides')
                                .update({
                                    status: action.payload.status,
                                    updated_at: new Date().toISOString(),
                                })
                                .eq('id', action.targetId)
                                .eq('driver_id', authenticatedDriverId)
                                .select('id');

                            if (updateErr) {
                                console.error(`[OfflineQueue] Error updating ride status for ${action.targetId}:`, updateErr);
                                success = false;
                                break;
                            }

                            // 6. Check zero-row updates: ensure update actually affected the targeted row
                            if (updatedRows && updatedRows.length > 0) {
                                success = true;
                            } else {
                                console.warn(`[OfflineQueue] Zero rows updated for ride ${action.targetId}.`);
                                success = false;
                            }
                            break;
                        }
                        case 'food_status':
                        case 'grocery_status': {
                            // 1. Fetch authoritative order to verify ownership before update
                            const { data: existingOrder, error: fetchErr } = await supabase
                                .from('orders')
                                .select('id, status, driver_id')
                                .eq('id', action.targetId)
                                .maybeSingle();

                            if (fetchErr) {
                                success = false;
                                break;
                            }

                            if (!existingOrder) {
                                console.warn(`[OfflineQueue] Order ${action.targetId} not found in DB. Discarding action.`);
                                success = true;
                                break;
                            }

                            // 2. Ownership Security Check: verify order is assigned to authenticated driver
                            if (existingOrder.driver_id !== authenticatedDriverId) {
                                console.warn(`[OfflineQueue] Order ${action.targetId} is assigned to driver ${existingOrder.driver_id}, not authenticated driver ${authenticatedDriverId}. Discarding unauthorized status update.`);
                                success = true;
                                break;
                            }

                            // 3. Idempotent check
                            if (existingOrder.status === action.payload.status) {
                                success = true;
                                break;
                            }

                            // 4. Lifecycle integrity: prevent regression if already delivered or cancelled
                            if (['delivered', 'cancelled'].includes(existingOrder.status)) {
                                console.warn(`[OfflineQueue] Order ${action.targetId} is already finalized (${existingOrder.status}). Cannot transition to ${action.payload.status}.`);
                                success = true;
                                break;
                            }

                            const { data: updatedRows, error: updateErr } = await supabase
                                .from('orders')
                                .update({ status: action.payload.status, updated_at: new Date().toISOString() })
                                .eq('id', action.targetId)
                                .eq('driver_id', authenticatedDriverId)
                                .select('id');

                            success = !updateErr && Boolean(updatedRows && updatedRows.length > 0);
                            break;
                        }
                        case 'complete_delivery': {
                            // 1. Fetch current order state to verify assignment and handle already-delivered idempotently
                            const { data: existingOrder, error: fetchErr } = await supabase
                                .from('orders')
                                .select('id, status, driver_id')
                                .eq('id', action.targetId)
                                .maybeSingle();

                            if (fetchErr) {
                                // Network / transient database error: retry action
                                success = false;
                                break;
                            }

                            if (!existingOrder) {
                                // Order no longer exists: discard to avoid infinite retry loop
                                console.warn(`[OfflineQueue] Order ${action.targetId} does not exist. Discarding action.`);
                                success = true;
                                break;
                            }

                            // 2. Security: Verify order is assigned to authenticated driver
                            if (existingOrder.driver_id !== authenticatedDriverId) {
                                console.warn(`[OfflineQueue] Order ${action.targetId} is assigned to driver ${existingOrder.driver_id}, not authenticated driver ${authenticatedDriverId}. Discarding unauthorized completion.`);
                                success = true; // Drop unauthorized action
                                break;
                            }

                            // 3. Idempotent check: Handles already-delivered orders safely without duplicate updates or earnings
                            if (existingOrder.status === 'delivered') {
                                console.log(`[OfflineQueue] Order ${action.targetId} is already marked delivered. Idempotently resolved.`);
                                success = true;
                                break;
                            }

                            // 4. Update status to delivered only for the authenticated driver
                            const { data: updatedRows, error: updateErr } = await supabase
                                .from('orders')
                                .update({
                                    status: 'delivered',
                                    updated_at: new Date().toISOString(),
                                })
                                .eq('id', action.targetId)
                                .eq('driver_id', authenticatedDriverId)
                                .select('id');

                            if (updateErr) {
                                console.error(`[OfflineQueue] Failed to update delivery status for order ${action.targetId}:`, updateErr);
                                success = false;
                                break;
                            }

                            // 5. Verification: Do not falsely report success when zero rows were updated
                            if (updatedRows && updatedRows.length > 0) {
                                success = true;
                            } else {
                                console.warn(`[OfflineQueue] Zero rows updated for order ${action.targetId}.`);
                                success = false;
                            }
                            break;
                        }
                    }

                    if (!success) {
                        action.retryCount += 1;
                        if (action.retryCount < 5) {
                            remaining.push(action);
                        } else {
                            console.warn(`[OfflineQueue] Discarding action ${action.id} after 5 failed retries.`);
                        }
                    } else {
                        console.log(`[OfflineQueue] Successfully flushed action ${action.id}`);
                    }
                } catch (actionErr) {
                    console.error(`[OfflineQueue] Error running action ${action.id}:`, actionErr);
                    action.retryCount += 1;
                    if (action.retryCount < 5) remaining.push(action);
                }
            }

            await AsyncStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(remaining));
        } catch (e) {
            console.error('[OfflineQueue] Queue process loop error:', e);
        } finally {
            this.isProcessing = false;
        }
    }
}

export const OfflineQueueService = new OfflineQueueServiceImpl();
