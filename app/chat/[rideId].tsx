import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    View, Text, TouchableOpacity, StyleSheet, FlatList,
    TextInput, KeyboardAvoidingView, Platform, ActivityIndicator,
    Alert, Linking,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { colors, Fonts } from '@/constants/colors';
import { useAuth } from '@/contexts/auth-context';
import { ChatService } from '@/services/chat.service';
import { Message, Ride } from '@/types';
import { supabase } from '@/config/supabase';

// ─── Quick-reply suggestions for drivers ─────────────────────────────────────
const QUICK_REPLIES = [
    "I'm on my way 🚗",
    "Reached pickup point 📍",
    "Please come down",
    "I'll be there in 2 min",
    "Wait, stuck in traffic",
    "Calling you now 📞",
];

function formatTime(isoString: string) {
    const d = new Date(isoString);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function ChatScreen() {
    const insets = useSafeAreaInsets();
    const { rideId } = useLocalSearchParams<{ rideId: string }>();
    const { driver } = useAuth();

    const [messages, setMessages] = useState<Message[]>([]);
    const [inputText, setInputText] = useState('');
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [ride, setRide] = useState<Ride | null>(null);
    const [showQuickReplies, setShowQuickReplies] = useState(true);
    const [isTyping, setIsTyping] = useState(false);
    const [othersTyping, setOthersTyping] = useState(false);

    const flatListRef = useRef<FlatList>(null);
    const channelRef = useRef<any>(null);
    const typingTimeoutRef = useRef<any>(null);

    // ── Load ride info ────────────────────────────────────────────────────────
    const loadRide = useCallback(async () => {
        if (!rideId) return;
        const { data } = await supabase
            .from('rides')
            .select('*, user:users!user_id(phone, name)')
            .eq('id', rideId)
            .single();
        if (data) setRide(data as Ride);
    }, [rideId]);

    // ── Load messages ─────────────────────────────────────────────────────────
    const loadMessages = useCallback(async () => {
        if (!rideId || !driver?.id) return;
        const msgs = await ChatService.getMessages(rideId);
        setMessages(msgs);
        setLoading(false);
        // Mark all as read
        await ChatService.markAllRead(rideId, driver.id);
    }, [rideId, driver?.id]);

    useEffect(() => {
        loadRide();
        loadMessages();
    }, [loadRide, loadMessages]);

    // ── Realtime subscription ─────────────────────────────────────────────────
    useEffect(() => {
        if (!rideId || !driver?.id) return;

        channelRef.current?.unsubscribe?.();
        
        // Create channel for both messages and presence
        channelRef.current = supabase.channel(`chat_${rideId}`);

        // 1. Subscribe to Messages
        channelRef.current.on(
            'postgres_changes',
            {
                event: 'INSERT',
                schema: 'public',
                table: 'messages',
                filter: `ride_id=eq.${rideId}`,
            },
            async (payload: { new: Message }) => {
                const newMsg = payload.new;
                setMessages((prev) => {
                    // 1. Exact ID match (already handled/promoted)
                    if (prev.some((m) => m.id === newMsg.id)) return prev;

                    // 2. Proactive Deduplication for messages sent by the driver
                    if (newMsg.sender_id === driver.id) {
                        const trimmedMsg = newMsg.message.trim();
                        
                        // Check if we have an optimistic match (temp_ ID + same text)
                        const optIndex = prev.findIndex(
                            (m) => m.id.startsWith('temp_') && m.message.trim() === trimmedMsg
                        );
                        if (optIndex !== -1) {
                            const next = [...prev];
                            next[optIndex] = newMsg; // Replace temp with real
                            return next;
                        }

                        // Check if we already have a real match with same content (prevents echoes)
                        if (prev.some((m) => m.sender_id === driver.id && m.message.trim() === trimmedMsg)) {
                            return prev;
                        }
                    }

                    // 3. New message from customer or unmatched driver message
                    return [...prev, newMsg];
                });
                if (newMsg.sender_id !== driver.id) {
                    await ChatService.markAllRead(rideId, driver.id);
                }
                setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
            }
        );

        // 2. Subscribe to Presence (Typing indicators)
        ChatService.subscribeToTyping(channelRef.current, (typingMap) => {
            // Check if any other user is typing
            const isAnyOtherTyping = Object.keys(typingMap).some(
                (key) => key !== driver.id && typingMap[key] === true
            );
            setOthersTyping(isAnyOtherTyping);
        });

        channelRef.current.subscribe(async (status: string) => {
            if (status === 'SUBSCRIBED') {
                await ChatService.trackTyping(channelRef.current, false);
            }
        });

        return () => {
            channelRef.current?.unsubscribe?.();
            channelRef.current = null;
        };
    }, [rideId, driver?.id]);

    // ── Scroll to bottom on first load ────────────────────────────────────────
    useEffect(() => {
        if (!loading && messages.length > 0) {
            setTimeout(() => flatListRef.current?.scrollToEnd({ animated: false }), 200);
        }
    }, [loading]);

    // ── Derive chat state ─────────────────────────────────────────────────────
    const isClosed = ride?.status === 'completed' || ride?.status === 'cancelled';

    // ── Send message ──────────────────────────────────────────────────────────
    const handleSend = async (text?: string) => {
        const msgText = (text ?? inputText).trim();
        if (!msgText || !rideId || !driver?.id || sending || isClosed) return;

        setInputText('');
        setSending(true);
        setShowQuickReplies(false);
        updateTyping(false);

        // Optimistic UI
        const optimistic: Message = {
            id: `temp_${Date.now()}`,
            ride_id: rideId,
            sender_id: driver.id,
            sender_role: 'driver',
            message: msgText,
            is_read: false,
            created_at: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, optimistic]);
        setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);

        const sent = await ChatService.sendMessage(rideId, driver.id, 'driver', msgText);
        if (sent) {
            // Success: Promote the optimistic message to real one (updates ID and status)
            setMessages((prev) => prev.map((m) => (m.id === optimistic.id ? sent : m)));
        } else {
            // Failure: Remove only the optimistic one
            setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
            Alert.alert('Failed', 'Message could not be sent. Please try again.');
        }
        setSending(false);
    };

    // ── Typing Logic ─────────────────────────────────────────────────────────
    const updateTyping = (typing: boolean) => {
        if (isTyping === typing) return;
        setIsTyping(typing);
        ChatService.trackTyping(channelRef.current, typing);
    };

    const handleInputChange = (text: string) => {
        setInputText(text);
        if (isClosed) return;

        updateTyping(true);
        
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => {
            updateTyping(false);
        }, 3000);
    };

    const handleCall = () => {
        const phone = ride?.user?.phone;
        if (phone) {
            Linking.openURL(`tel:${phone}`).catch(() => Alert.alert('Error', 'Unable to call'));
        } else {
            Alert.alert('Not Available', 'Phone number not found.');
        }
    };

    // ── Render a single message bubble ────────────────────────────────────────
    const renderMessage = ({ item, index }: { item: Message; index: number }) => {
        const isMe = item.sender_id === driver?.id;
        const prevItem = messages[index - 1];
        const showTimestamp =
            !prevItem ||
            new Date(item.created_at).getTime() - new Date(prevItem.created_at).getTime() > 5 * 60 * 1000;

        return (
            <View>
                {showTimestamp && (
                    <Text style={styles.timestamp}>{formatTime(item.created_at)}</Text>
                )}
                <View style={[styles.bubbleRow, isMe ? styles.bubbleRowMe : styles.bubbleRowThem]}>
                    {!isMe && (
                        <View style={styles.avatar}>
                            <Feather name="user" size={14} color={colors.primary} />
                        </View>
                    )}
                    <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem]}>
                        <Text style={[styles.bubbleText, isMe ? styles.bubbleTextMe : styles.bubbleTextThem]}>
                            {item.message}
                        </Text>
                        {isMe && (
                            <Feather
                                name={item.is_read ? 'check-circle' : 'check'}
                                size={11}
                                color={item.is_read ? '#a8e6cf' : 'rgba(255,255,255,0.5)'}
                                style={styles.readTick}
                            />
                        )}
                    </View>
                </View>
            </View>
        );
    };

    // ── Header ────────────────────────────────────────────────────────────────
    const renderHeader = () => (
        <View style={[styles.header, { paddingTop: insets.top }]}>
            <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
                <Feather name="arrow-left" size={22} color={colors.text} />
            </TouchableOpacity>
            <View style={styles.headerInfo}>
                <View style={styles.customerAvatar}>
                    <Feather name="user" size={18} color={colors.white} />
                </View>
                <View style={{ flex: 1 }}>
                    <Text style={styles.headerName}>{ride?.user?.name || 'Customer'}</Text>
                    <Text style={styles.headerSub}>
                        {isClosed
                            ? '🔒 Chat closed'
                            : othersTyping ? 'typing...' : 'Active now'}
                    </Text>
                </View>
                {!isClosed && (
                    <TouchableOpacity style={styles.callBtnHeader} onPress={handleCall}>
                        <Feather name="phone" size={18} color={colors.success} />
                    </TouchableOpacity>
                )}
            </View>
        </View>
    );

    if (loading) {
        return (
            <View style={[styles.container, styles.center]}>
                {renderHeader()}
                <ActivityIndicator size="large" color={colors.primary} style={{ flex: 1 }} />
            </View>
        );
    }

    return (
        <KeyboardAvoidingView
            style={styles.container}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={0}
        >
            {renderHeader()}

            {/* Closed ride banner */}
            {isClosed && (
                <View style={styles.closedBanner}>
                    <Feather name="lock" size={14} color={colors.textMuted} />
                    <Text style={styles.closedBannerText}>
                        This ride has ended. Chat is now read-only.
                    </Text>
                </View>
            )}

            {/* Messages list */}
            <FlatList
                ref={flatListRef}
                data={messages}
                keyExtractor={(item) => item.id}
                renderItem={renderMessage}
                contentContainerStyle={styles.messagesList}
                showsVerticalScrollIndicator={false}
                ListHeaderComponent={othersTyping ? (
                    <View style={styles.typingIndicatorInline}>
                        <Text style={styles.typingText}>Customer is typing...</Text>
                    </View>
                ) : null}
                ListEmptyComponent={
                    <View style={styles.emptyState}>
                        <View style={styles.emptyIcon}>
                            <Feather name="message-circle" size={32} color={colors.primary} />
                        </View>
                        <Text style={styles.emptyTitle}>No messages yet</Text>
                        <Text style={styles.emptySub}>
                            Start the conversation with your customer
                        </Text>
                    </View>
                }
            />

            {/* Quick replies */}
            {!isClosed && showQuickReplies && messages.length === 0 && (
                <View style={styles.quickRepliesContainer}>
                    <Text style={styles.quickRepliesLabel}>Quick Replies</Text>
                    <FlatList
                        horizontal
                        data={QUICK_REPLIES}
                        keyExtractor={(item) => item}
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.quickRepliesScroll}
                        renderItem={({ item }) => (
                            <TouchableOpacity
                                style={styles.quickReplyChip}
                                onPress={() => handleSend(item)}
                            >
                                <Text style={styles.quickReplyText}>{item}</Text>
                            </TouchableOpacity>
                        )}
                    />
                </View>
            )}

            {/* Input area */}
            {!isClosed && (
                <View style={[styles.inputRow, { paddingBottom: insets.bottom + 8 }]}>
                    <TouchableOpacity
                        style={styles.quickBtn}
                        onPress={() => setShowQuickReplies((v) => !v)}
                    >
                        <Feather name="zap" size={18} color={showQuickReplies ? colors.primary : colors.textMuted} />
                    </TouchableOpacity>
                    <TextInput
                        style={styles.input}
                        value={inputText}
                        onChangeText={handleInputChange}
                        onBlur={() => updateTyping(false)}
                        placeholder="Type a message..."
                        placeholderTextColor={colors.textMuted}
                        multiline
                        maxLength={500}
                        returnKeyType="default"
                        onFocus={() => {
                            setShowQuickReplies(false);
                            updateTyping(true);
                        }}
                        onSubmitEditing={() => handleSend()}
                    />
                    <TouchableOpacity
                        style={[
                            styles.sendBtn,
                            (!inputText.trim() || sending) && styles.sendBtnDisabled,
                        ]}
                        onPress={() => handleSend()}
                        disabled={!inputText.trim() || sending}
                    >
                        {sending ? (
                            <ActivityIndicator size="small" color={colors.white} />
                        ) : (
                            <Feather name="send" size={18} color={colors.white} />
                        )}
                    </TouchableOpacity>
                </View>
            )}

            {/* Quick replies drawer — shown when user taps ⚡ */}
            {!isClosed && showQuickReplies && messages.length > 0 && (
                <View style={[styles.quickRepliesContainer, { paddingBottom: insets.bottom + 4 }]}>
                    <Text style={styles.quickRepliesLabel}>Quick Replies</Text>
                    <FlatList
                        horizontal
                        data={QUICK_REPLIES}
                        keyExtractor={(item) => item}
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.quickRepliesScroll}
                        renderItem={({ item }) => (
                            <TouchableOpacity
                                style={styles.quickReplyChip}
                                onPress={() => handleSend(item)}
                            >
                                <Text style={styles.quickReplyText}>{item}</Text>
                            </TouchableOpacity>
                        )}
                    />
                </View>
            )}
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    center: { justifyContent: 'center', alignItems: 'center' },

    // Header
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        backgroundColor: colors.surface,
        paddingHorizontal: 16,
        paddingBottom: 14,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    backBtn: {
        width: 38, height: 38,
        borderRadius: 19,
        backgroundColor: colors.background,
        alignItems: 'center', justifyContent: 'center',
    },
    headerInfo: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
    customerAvatar: {
        width: 38, height: 38, borderRadius: 19,
        backgroundColor: colors.primary,
        alignItems: 'center', justifyContent: 'center',
    },
    headerName: { fontFamily: Fonts.bold, fontSize: 15, color: colors.text },
    headerSub: { fontFamily: Fonts.regular, fontSize: 12, color: colors.success, marginTop: 1 },
    callBtnHeader: {
        width: 38, height: 38, borderRadius: 19,
        backgroundColor: colors.successLight,
        alignItems: 'center', justifyContent: 'center',
    },
    closedBadge: {
        backgroundColor: colors.border,
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 4,
    },
    closedBadgeText: { fontFamily: Fonts.bold, fontSize: 11, color: colors.textSecondary },

    // Closed banner
    closedBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: colors.warningLight,
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    closedBannerText: { fontFamily: Fonts.medium, fontSize: 13, color: colors.textSecondary },

    // Messages list
    messagesList: { padding: 16, paddingBottom: 8, flexGrow: 1 },

    // Timestamp
    timestamp: {
        textAlign: 'center',
        fontFamily: Fonts.regular,
        fontSize: 11,
        color: colors.textMuted,
        marginVertical: 10,
    },

    // Bubble
    bubbleRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginBottom: 6 },
    bubbleRowMe: { justifyContent: 'flex-end' },
    bubbleRowThem: { justifyContent: 'flex-start' },
    avatar: {
        width: 28, height: 28, borderRadius: 14,
        backgroundColor: colors.primaryLight,
        alignItems: 'center', justifyContent: 'center',
        marginBottom: 2,
    },
    bubble: {
        maxWidth: '78%',
        borderRadius: 18,
        paddingVertical: 10,
        paddingHorizontal: 14,
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: 6,
    },
    bubbleMe: {
        backgroundColor: colors.primary,
        borderBottomRightRadius: 4,
        shadowColor: colors.primary,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
        elevation: 3,
    },
    bubbleThem: {
        backgroundColor: colors.surface,
        borderBottomLeftRadius: 4,
        borderWidth: 1,
        borderColor: colors.border,
    },
    bubbleText: { fontFamily: Fonts.medium, fontSize: 14, lineHeight: 20, flex: 1 },
    bubbleTextMe: { color: colors.white },
    bubbleTextThem: { color: colors.text },
    readTick: { alignSelf: 'flex-end', marginBottom: 1 },

    // Typing
    typingIndicatorInline: {
        paddingVertical: 4,
        paddingHorizontal: 8,
        marginBottom: 10,
    },
    typingText: {
        fontFamily: Fonts.medium,
        fontSize: 12,
        color: colors.textSecondary,
        fontStyle: 'italic',
    },

    // Empty state
    emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
    emptyIcon: {
        width: 68, height: 68, borderRadius: 34,
        backgroundColor: colors.primaryLight,
        alignItems: 'center', justifyContent: 'center',
        marginBottom: 16,
    },
    emptyTitle: { fontFamily: Fonts.bold, fontSize: 17, color: colors.text, marginBottom: 6 },
    emptySub: { fontFamily: Fonts.regular, fontSize: 14, color: colors.textMuted, textAlign: 'center' },

    // Input row
    inputRow: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: 10,
        paddingHorizontal: 12,
        paddingTop: 10,
        backgroundColor: colors.surface,
        borderTopWidth: 1,
        borderTopColor: colors.border,
    },
    quickBtn: {
        width: 40, height: 40,
        borderRadius: 20,
        backgroundColor: colors.background,
        alignItems: 'center', justifyContent: 'center',
        marginBottom: 2,
    },
    input: {
        flex: 1,
        fontFamily: Fonts.regular,
        fontSize: 15,
        color: colors.text,
        backgroundColor: colors.background,
        borderRadius: 22,
        paddingHorizontal: 16,
        paddingVertical: 10,
        maxHeight: 110,
        borderWidth: 1,
        borderColor: colors.border,
    },
    sendBtn: {
        width: 44, height: 44,
        borderRadius: 22,
        backgroundColor: colors.primary,
        alignItems: 'center', justifyContent: 'center',
        marginBottom: 2,
        shadowColor: colors.primary,
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.35,
        shadowRadius: 6,
        elevation: 4,
    },
    sendBtnDisabled: { backgroundColor: colors.border, shadowOpacity: 0 },

    // Quick replies
    quickRepliesContainer: {
        backgroundColor: colors.surface,
        borderTopWidth: 1,
        borderTopColor: colors.border,
        paddingTop: 10,
        paddingHorizontal: 12,
        paddingBottom: 4,
    },
    quickRepliesLabel: {
        fontFamily: Fonts.medium,
        fontSize: 11,
        color: colors.textMuted,
        letterSpacing: 0.5,
        marginBottom: 8,
        textTransform: 'uppercase',
    },
    quickRepliesScroll: { gap: 8, paddingBottom: 4 },
    quickReplyChip: {
        backgroundColor: colors.primaryLight,
        borderRadius: 20,
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderWidth: 1,
        borderColor: colors.primary + '30',
    },
    quickReplyText: { fontFamily: Fonts.medium, fontSize: 13, color: colors.primary },
});
