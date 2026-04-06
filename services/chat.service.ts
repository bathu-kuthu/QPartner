import { supabase } from '@/config/supabase';
import { Message } from '@/types';

export class ChatService {
    // ── Fetch all messages for a ride, oldest first ──────────────────────────
    static async getMessages(rideId: string): Promise<Message[]> {
        try {
            const { data, error } = await supabase
                .from('messages')
                .select('*')
                .eq('ride_id', rideId)
                .order('created_at', { ascending: true });

            if (error) return [];
            return (data ?? []) as Message[];
        } catch {
            return [];
        }
    }

    // ── Send a message ────────────────────────────────────────────────────────
    static async sendMessage(
        rideId: string,
        senderId: string,
        senderRole: 'driver' | 'customer',
        message: string
    ): Promise<Message | null> {
        const { data, error } = await supabase
            .from('messages')
            .insert({
                ride_id: rideId,
                sender_id: senderId,
                sender_role: senderRole,
                message: message.trim(),
                is_read: false,
            })
            .select()
            .single();

        if (error) {
            console.error('ChatService.sendMessage error:', error.message);
            return null;
        }
        return data as Message;
    }

    // ── Mark all unread messages as read (messages NOT sent by current user) ──
    static async markAllRead(rideId: string, senderId: string): Promise<void> {
        await supabase
            .from('messages')
            .update({ is_read: true })
            .eq('ride_id', rideId)
            .neq('sender_id', senderId)
            .eq('is_read', false);
    }

    // ── Count unread messages for driver (sent by customer) ──────────────────
    static async getUnreadCount(rideId: string, driverId: string): Promise<number> {
        try {
            const { count, error } = await supabase
                .from('messages')
                .select('id', { count: 'exact', head: true })
                .eq('ride_id', rideId)
                .neq('sender_id', driverId)
                .eq('is_read', false);

            if (error) return 0;
            return count ?? 0;
        } catch {
            return 0;
        }
    }

    // ── Typing Indicator (Presence) ───────────────────────────────────────────
    static async trackTyping(channel: any, typing: boolean) {
        if (!channel) return;
        await channel.track({ typing });
    }

    static subscribeToTyping(
        channel: any,
        callback: (typingMap: Record<string, boolean>) => void
    ) {
        if (!channel) return;
        channel.on('presence', { event: 'sync' }, () => {
            const state = channel.presenceState();
            const typingMap: Record<string, boolean> = {};
            
            Object.keys(state).forEach((key) => {
                const presence = state[key][0];
                if (presence.typing) {
                    typingMap[key] = true;
                }
            });
            
            callback(typingMap);
        });
    }

    // ── Realtime subscription to new messages ─────────────────────────────────
    static subscribeToMessages(
        rideId: string,
        callback: (message: Message) => void
    ) {
        const channelName = `messages_${rideId}_${Date.now()}`;
        return supabase
            .channel(channelName)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'messages',
                    filter: `ride_id=eq.${rideId}`,
                },
                (payload) => callback(payload.new as Message)
            )
            .subscribe();
    }
}
