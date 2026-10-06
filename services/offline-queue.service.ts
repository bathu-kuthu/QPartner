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

            for (const action of queue) {
                try {
                    let success = false;

                    switch (action.type) {
                        case 'ride_status': {
                            const { error } = await supabase
                                .from('rides')
                                .update({ status: action.payload.status })
                                .eq('id', action.targetId);
                            success = !error;
                            break;
                        }
                        case 'food_status':
                        case 'grocery_status': {
                            const { error } = await supabase
                                .from('orders')
                                .update({ status: action.payload.status })
                                .eq('id', action.targetId)
                                .eq('driver_id', action.payload.driverId);
                            success = !error;
                            break;
                        }
                        case 'complete_delivery': {
                            const { error } = await supabase
                                .from('driver_earnings')
                                .insert({
                                    driver_id: action.payload.driverId,
                                    order_id: action.targetId,
                                    domain: action.payload.domain,
                                    amount: action.payload.amount,
                                    status: 'credited',
                                });
                            success = !error;
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
