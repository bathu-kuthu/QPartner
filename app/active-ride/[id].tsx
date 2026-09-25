import React, { useState, useEffect, useRef } from 'react';
import {
    View, Text, TouchableOpacity, StyleSheet, Alert,
    Linking, ActivityIndicator, BackHandler, AppState, AppStateStatus,
    TextInput, ScrollView
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase } from '@/config/supabase';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { colors, Fonts } from '@/constants/colors';
import { DriverService } from '@/services/driver.service';
import { ChatService } from '@/services/chat.service';
import { useAuth } from '@/contexts/auth-context';
import { Ride } from '@/types';
import { useTranslation } from 'react-i18next';
import { NotificationService } from '@/services/notification.service';


export default function ActiveRideScreen() {
    const insets = useSafeAreaInsets();
    const { id } = useLocalSearchParams<{ id: string }>();
    const { driver, setDriverData } = useAuth();
    const { t } = useTranslation();

    const [ride, setRide] = useState<Ride | null>(null);
    const [loading, setLoading] = useState(true);
    const [updating, setUpdating] = useState(false);
    const [netError, setNetError] = useState(false);
    const [unreadCount, setUnreadCount] = useState(0);
    const [showCompletionModal, setShowCompletionModal] = useState(false);

    const channelRef = useRef<any>(null);
    const chatChannelRef = useRef<any>(null);

    const STATUS_STEPS = [
        { key: 'accepted', label: t('activeRide.steps.accepted'), icon: 'navigation', action: t('activeRide.actions.confirm_pickup'), nextStatus: 'picked_up' as const },
        { key: 'picked_up', label: t('activeRide.steps.picked_up'), icon: 'user-check', action: t('activeRide.actions.start_ride'), nextStatus: 'on_ride' as const },
        { key: 'on_ride', label: t('activeRide.steps.on_ride'), icon: 'truck', action: t('activeRide.actions.complete_ride'), nextStatus: 'completed' as const },
    ];

    // ── OTP state ─────────────────────────────────────────────────────────
    const [otpDigits, setOtpDigits] = useState(['', '', '', '']);
    const [otpError, setOtpError] = useState<string | null>(null);
    const [verifyingOTP, setVerifyingOTP] = useState(false);
    const otpInputRefs = [useRef<any>(null), useRef<any>(null), useRef<any>(null), useRef<any>(null)];

    // ── Block hardware back — driver cannot leave mid-ride ─────────────────
    useEffect(() => {
        const handler = BackHandler.addEventListener('hardwareBackPress', () => {
            Alert.alert(
                'Ride in Progress',
                'You cannot go back during an active ride. Complete or cancel the ride first.',
                [{ text: 'OK' }]
            );
            return true; // blocks default back action
        });
        return () => handler.remove();
    }, []);

    // ── Reload when app comes back to foreground ───────────────────────────
    useEffect(() => {
        const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
            if (state === 'active') loadRide();
        });
        return () => sub.remove();
    }, []);

    // ── Load ride ──────────────────────────────────────────────────────────
    const loadRide = async () => {
        if (!id || !driver?.id) return;
        setNetError(false);
        try {
            const active = await DriverService.getActiveRide(driver.id);
            setRide(active);
        } catch (e: any) {
            if (e.message === 'NETWORK_ERROR') setNetError(true);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { loadRide(); }, [id]);

    // ── Realtime subscribe AFTER ride is loaded ────────────────────────────
    useEffect(() => {
        if (!ride?.id) return;

        // Clean up any previous channel first
        channelRef.current?.unsubscribe?.();

        channelRef.current = DriverService.subscribeToRide(ride.id, (updated) => {
            setRide(updated);
            if (updated.status === 'completed') {
                setShowCompletionModal(true);
            } else if (updated.status === 'cancelled') {
                router.replace('/(tabs)/bookings');
            }
        });

        return () => {
            channelRef.current?.unsubscribe?.();
            channelRef.current = null;
        };
    }, [ride?.id]);

    // ── Unread message count + realtime badge ──────────────────────────────
    useEffect(() => {
        if (!ride?.id || !driver?.id) return;
        const isActive = ['accepted', 'picked_up', 'on_ride'].includes(ride.status);
        if (!isActive) return;

        // Initial unread count
        ChatService.getUnreadCount(ride.id, driver.id).then(setUnreadCount);

        // Subscribe to new messages to bump badge in real-time
        chatChannelRef.current?.unsubscribe?.();
        chatChannelRef.current = ChatService.subscribeToMessages(ride.id, (msg) => {
            if (msg.sender_id !== driver.id) {
                setUnreadCount((c) => c + 1);
            }
        });

        return () => {
            chatChannelRef.current?.unsubscribe?.();
            chatChannelRef.current = null;
        };
    }, [ride?.id, ride?.status, driver?.id]);

    // ── Open chat ─────────────────────────────────────────────────────────
    const handleOpenChat = () => {
        if (!ride?.id) return;
        setUnreadCount(0); // clear badge optimistically
        router.push(`/chat/${ride.id}` as any);
    };

    // ── Status update ──────────────────────────────────────────────────────
    const handleStatusUpdate = async () => {
        if (!ride) return;
        const step = STATUS_STEPS.find((s) => s.key === ride.status);
        if (!step) return;

        if (step.nextStatus === 'completed') {
            Alert.alert(
                t('activeRide.completeRide'),
                t('activeRide.completeConfirm'),
                [
                    { text: t('common.cancel'), style: 'cancel' },
                    { text: 'Complete', style: 'default', onPress: () => doUpdate(step.nextStatus) },
                ]
            );
        } else {
            doUpdate(step.nextStatus);
        }
    };

    const doUpdate = async (newStatus: 'picked_up' | 'on_ride' | 'completed') => {
        if (!ride?.id || updating) return;
        setUpdating(true);
        setNetError(false);
        try {
            await DriverService.updateRideStatus(ride.id, newStatus);
            if (newStatus === 'completed') {
                if (driver) {
                    await setDriverData({ ...driver, total_rides: (driver.total_rides ?? 0) + 1 });
                }
                setShowCompletionModal(true);
            } else {
                setRide((prev) => prev ? { ...prev, status: newStatus } : null);

                // Trigger Milestone Notification ─────────
                let title = '';
                let body = '';
                if (newStatus === 'picked_up') {
                    title = 'Arrived at Pickup 📍';
                    body = 'You have reached the passenger. Start the ride once they are on board.';
                } else if (newStatus === 'on_ride') {
                    title = 'Ride Started 🚀';
                    body = 'Heading to the destination now.';
                }
                if (title) NotificationService.notifyRideStatus(title, body, ride.id);
            }
        } catch (e: any) {
            if (e.message === 'NETWORK_ERROR') {
                setNetError(true);
                Alert.alert('No Internet', 'Status not updated. Check your connection and try again.');
            } else {
                Alert.alert(t('common.error'), e.message ?? 'Failed to update status');
            }
        } finally {
            setUpdating(false);
        }
    };

    // ── OTP Verification ───────────────────────────────────────────────────
    const verifyOTPDirectly = async (enteredOTP: string) => {
        if (!ride?.id) return;
        setVerifyingOTP(true);
        setOtpError(null);
        try {
            const { data: matched, error } = await supabase
                .rpc('verify_ride_otp', { p_ride_id: ride.id, p_entered_otp: enteredOTP });

            if (error) throw new Error('Could not verify OTP. Please try again.');

            if (!matched) {
                setOtpError('Incorrect OTP.');
                setOtpDigits(['', '', '', '']);
                otpInputRefs[0].current?.focus();
                return;
            }

            // OTP is correct! Automatically start ride.
            await doUpdate('on_ride');
        } catch (e: any) {
            setOtpError(e.message);
        } finally {
            setVerifyingOTP(false);
        }
    };

    const handleOtpChange = (value: string, index: number) => {
        setOtpError(null);
        const digit = value.replace(/[^0-9]/g, '').slice(-1);
        const next = [...otpDigits];
        next[index] = digit;
        setOtpDigits(next);

        if (digit && index < 3) {
            otpInputRefs[index + 1].current?.focus();
        }

        // Auto-verify if all 4 digits are present
        if (digit && index === 3 && next.every(d => d !== '')) {
            verifyOTPDirectly(next.join(''));
        }
    };

    // ── Cancel ride ────────────────────────────────────────────────────────
    const handleCancel = () => {
        Alert.alert(
            t('activeRide.cancelRide'),
            t('activeRide.cancelConfirm'),
            [
                { text: t('common.no'), style: 'cancel' },
                {
                    text: t('activeRide.cancelRide'),
                    style: 'destructive',
                    onPress: () => {
                        Alert.alert(
                            'Cancel Reason',
                            'Why are you cancelling?',
                            [
                                { text: 'Passenger is not at pickup', onPress: () => doCancelWithReason('Passenger is not at pickup location') },
                                { text: 'Vehicle issue', onPress: () => doCancelWithReason('Vehicle broke down') },
                                { text: 'Passenger requested', onPress: () => doCancelWithReason('Passenger requested to cancel') },
                                { text: 'Other', onPress: () => doCancelWithReason('Other') },
                                { text: t('common.no'), style: 'cancel' },
                            ]
                        );
                    },
                },
            ]
        );
    };

    const doCancelWithReason = async (reason: string) => {
        if (!ride?.id) return;
        try {
            await DriverService.updateRideStatus(ride.id, 'cancelled', reason);
            NotificationService.notifyRideStatus('Ride Cancelled ❌', 'The ride has been cancelled successfully.');
            router.replace('/(tabs)/bookings');
        } catch (e: any) {
            if (e.message === 'NETWORK_ERROR') {
                Alert.alert('No Internet', 'Could not cancel. Check your connection.');
            } else {
                Alert.alert('Error', 'Failed to cancel ride.');
            }
        }
    };

    // ── SOS ───────────────────────────────────────────────────────────────────
    const handleSOS = () => {
        Alert.alert(
            '🆘 Emergency SOS',
            'This will alert Quickora support immediately. Proceed?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Send SOS',
                    style: 'destructive',
                    onPress: async () => {
                        if (!driver?.id) return;
                        await DriverService.triggerSOS(driver.id, ride?.id);
                        Alert.alert('SOS Sent', 'Support has been alerted. Stay safe.');
                    },
                },
            ]
        );
    };

    // ── Open maps ──────────────────────────────────────────────────────────
    const openMaps = (lat: number, lng: number) => {
        Linking.openURL(`https://maps.google.com/?q=${lat},${lng}`).catch(() =>
            Alert.alert(t('common.error'), t('activeRide.mapsError'))
        );
    };

    // ── Call customer ──────────────────────────────────────────────────────
    const handleCall = () => {
        const phone = "9715749855"; // Customer care number replacing actual user phone
        if (phone) {
            Linking.openURL(`tel:${phone}`).catch(() =>
                Alert.alert('Error', 'Unable to open phone dialer')
            );
        } else {
            Alert.alert('Not Available', 'Customer phone number is not available.');
        }
    };

    if (loading) {
        return (
            <View style={[styles.container, styles.center, { paddingTop: insets.top }]}>
                <ActivityIndicator size="large" color={colors.primary} />
            </View>
        );
    }

    if (!ride) {
        return (
            <View style={[styles.container, styles.center, { paddingTop: insets.top }]}>
                <Feather name="alert-circle" size={40} color={colors.error} />
                <Text style={styles.errorTitle}>Ride Not Found</Text>
                <Text style={styles.errorSubtitle}>
                    {netError ? 'No internet connection. Pull down to retry.' : 'This ride may have been cancelled.'}
                </Text>
                <TouchableOpacity style={styles.retryBtn} onPress={loadRide}>
                    <Text style={styles.retryBtnText}>Retry</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.backBtn} onPress={() => router.replace('/(tabs)/bookings')}>
                    <Text style={styles.backBtnText}>Back to Bookings</Text>
                </TouchableOpacity>
            </View>
        );
    }

    const step = STATUS_STEPS.find((s) => s.key === ride.status);
    const stepIdx = STATUS_STEPS.findIndex((s) => s.key === ride.status);

    return (
        <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
            {/* Header — intentionally no back button */}
            <View style={styles.header}>
                <View>
                    <Text style={styles.headerTitle}>{t('activeRide.title')}</Text>
                    <Text style={styles.rideId}>#{ride.id.slice(-6).toUpperCase()}</Text>
                </View>
                <View style={styles.fareBadge}>
                    <Text style={styles.fareLabel}>{t('activeRide.fare')}</Text>
                    <Text style={styles.fareValue}>₹{ride.fare}</Text>
                </View>
            </View>

            {/* Network error banner */}
            {netError && (
                <View style={styles.netBanner}>
                    <Feather name="wifi-off" size={14} color={colors.white} />
                    <Text style={styles.netBannerText}>No internet — changes may not save</Text>
                    <TouchableOpacity onPress={loadRide}>
                        <Text style={styles.netRetry}>Retry</Text>
                    </TouchableOpacity>
                </View>
            )}

            <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ paddingBottom: 16 }}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
            >
                {/* Progress steps */}
                <View style={styles.progressBar}>
                    {STATUS_STEPS.map((s, i) => (
                        <React.Fragment key={s.key}>
                            <View style={styles.progressStep}>
                                <View style={[
                                    styles.progressDot,
                                    i <= stepIdx && styles.progressDotActive,
                                    i < stepIdx && styles.progressDotDone,
                                ]}>
                                    {i < stepIdx ? (
                                        <Feather name="check" size={10} color={colors.white} />
                                    ) : (
                                        <View style={i === stepIdx ? styles.progressDotCenter : undefined} />
                                    )}
                                </View>
                                <Text style={[styles.progressLabel, i <= stepIdx && styles.progressLabelActive]}>
                                    {s.label.split(' ')[0]}
                                </Text>
                            </View>
                            {i < STATUS_STEPS.length - 1 && (
                                <View style={[styles.progressLine, i < stepIdx && styles.progressLineDone]} />
                            )}
                        </React.Fragment>
                    ))}
                </View>

                {/* Status card */}
                <View style={styles.statusCard}>
                    <View style={styles.statusIconBox}>
                        <Feather name={(step?.icon ?? 'truck') as any} size={28} color={colors.primary} />
                    </View>
                    <Text style={styles.statusTitle}>{step?.label}</Text>
                    <Text style={styles.distanceText}>{t('activeRide.tripDistance', { distance: ride.distance_km })}</Text>
                </View>

                {/* Route */}
                <View style={styles.routeCard}>
                    <TouchableOpacity
                        style={styles.locationRow}
                        onPress={() => openMaps(ride.pickup_location.latitude, ride.pickup_location.longitude)}
                        activeOpacity={0.7}
                    >
                        <View style={[styles.locationDot, { backgroundColor: colors.success }]} />
                        <View style={styles.locationInfo}>
                            <Text style={styles.locationLabel}>{t('activeRide.pickup')}</Text>
                            <Text style={styles.locationAddress} numberOfLines={2}>{ride.pickup_address}</Text>
                        </View>
                        <Feather name="navigation" size={18} color={colors.primary} />
                    </TouchableOpacity>

                    {ride.status === 'on_ride' ? (
                        <>
                            <View style={styles.routeConnector}>
                                <View style={styles.routeConnectorLine} />
                            </View>

                            <TouchableOpacity
                                style={styles.locationRow}
                                onPress={() => openMaps(ride.drop_location.latitude, ride.drop_location.longitude)}
                                activeOpacity={0.7}
                            >
                                <View style={[styles.locationDot, { backgroundColor: colors.error }]} />
                                <View style={styles.locationInfo}>
                                    <Text style={styles.locationLabel}>{t('activeRide.dropoff')}</Text>
                                    <Text style={styles.locationAddress} numberOfLines={2}>{ride.drop_address}</Text>
                                </View>
                                <Feather name="navigation" size={18} color={colors.primary} />
                            </TouchableOpacity>
                        </>
                    ) : (
                        <View style={styles.dropoffHidden}>
                            <Feather name="lock" size={14} color={colors.textMuted} />
                            <Text style={styles.dropoffHiddenText}>Drop-off will be revealed after OTP verification</Text>
                        </View>
                    )}
                </View>

                {/* Fare breakdown */}
                {(ride.base_fare != null || ride.waiting_charge != null) && (
                    <View style={styles.fareBreakdown}>
                        <Text style={styles.fareBreakdownTitle}>Fare Breakdown</Text>
                        {ride.base_fare != null && (
                            <View style={styles.fareRow}>
                                <Text style={styles.fareKey}>Base Fare</Text>
                                <Text style={styles.fareVal}>₹{ride.base_fare}</Text>
                            </View>
                        )}
                        {ride.distance_fare != null && (
                            <View style={styles.fareRow}>
                                <Text style={styles.fareKey}>Distance ({ride.distance_km} km)</Text>
                                <Text style={styles.fareVal}>₹{ride.distance_fare}</Text>
                            </View>
                        )}
                        {(ride.waiting_charge ?? 0) > 0 && (
                            <View style={styles.fareRow}>
                                <Text style={styles.fareKey}>Waiting</Text>
                                <Text style={[styles.fareVal, { color: colors.warning }]}>₹{ride.waiting_charge}</Text>
                            </View>
                        )}
                        <View style={[styles.fareRow, { borderTopWidth: 1, borderTopColor: colors.border, marginTop: 6, paddingTop: 6 }]}>
                            <Text style={[styles.fareKey, { fontFamily: Fonts.bold, color: colors.text }]}>Total</Text>
                            <Text style={[styles.fareVal, { fontFamily: Fonts.bold, color: colors.primary }]}>₹{ride.fare}</Text>
                        </View>
                    </View>
                )}

                {/* Multi-stop indicator */}
                {ride.is_multi_stop && (
                    <View style={styles.multiStopBadge}>
                        <Feather name="layers" size={14} color={colors.primary} />
                        <Text style={styles.multiStopText}>Multi-stop ride · {ride.stop_count ?? '?'} stops</Text>
                    </View>
                )}

                {/* Parcel contact info */}
                {(ride.sender_phone || ride.receiver_phone) && (
                    <View style={styles.parcelCard}>
                        <Text style={styles.parcelTitle}>📦 Parcel Contacts</Text>
                        {ride.sender_phone && (
                            <TouchableOpacity style={styles.parcelRow} onPress={() => Linking.openURL(`tel:9715749855`)}>
                                <Feather name="user" size={14} color={colors.textMuted} />
                                <Text style={styles.parcelLabel}>Sender</Text>
                                <Text style={styles.parcelPhone}>9715749855</Text>
                                <Feather name="phone" size={14} color={colors.success} />
                            </TouchableOpacity>
                        )}
                        {ride.receiver_phone && (
                            <TouchableOpacity style={styles.parcelRow} onPress={() => Linking.openURL(`tel:9715749855`)}>
                                <Feather name="user-check" size={14} color={colors.textMuted} />
                                <Text style={styles.parcelLabel}>Receiver</Text>
                                <Text style={styles.parcelPhone}>9715749855</Text>
                                <Feather name="phone" size={14} color={colors.success} />
                            </TouchableOpacity>
                        )}
                    </View>
                )}

                {/* Actions */}
                <View style={styles.actions}>
                    {ride.status === 'picked_up' ? (
                        <View style={styles.otpContainer}>
                            <Text style={styles.otpTitle}>Enter Passenger OTP</Text>
                            <Text style={styles.otpSubtitle}>Ask the passenger for the 4-digit code to start the ride</Text>
                            <View style={styles.otpInputContainer}>
                                {otpDigits.map((digit, index) => (
                                    <TextInput
                                        key={index}
                                        ref={otpInputRefs[index]}
                                        style={[styles.otpInput, otpError ? styles.otpInputError : null]}
                                        keyboardType="number-pad"
                                        maxLength={1}
                                        value={digit}
                                        onChangeText={(val) => handleOtpChange(val, index)}
                                        onKeyPress={({ nativeEvent }) => {
                                            if (nativeEvent.key === 'Backspace' && !digit && index > 0) {
                                                otpInputRefs[index - 1].current?.focus();
                                                const next = [...otpDigits];
                                                next[index - 1] = '';
                                                setOtpDigits(next);
                                                setOtpError(null);
                                            }
                                        }}
                                        editable={!verifyingOTP}
                                    />
                                ))}
                            </View>
                            {otpError && <Text style={styles.otpErrorText}>{otpError}</Text>}
                            {verifyingOTP && <ActivityIndicator color={colors.primary} style={{ marginTop: 10 }} />}
                        </View>
                    ) : (
                        step && (
                            <TouchableOpacity
                                style={[styles.actionBtn, updating && styles.actionBtnLoading]}
                                onPress={handleStatusUpdate}
                                disabled={updating}
                                activeOpacity={0.85}
                            >
                                {updating ? (
                                    <ActivityIndicator color={colors.white} />
                                ) : (
                                    <>
                                        <Feather name="check-circle" size={20} color={colors.white} />
                                        <Text style={styles.actionBtnText}>{step.action}</Text>
                                    </>
                                )}
                            </TouchableOpacity>
                        )
                    )}

                    {/* Secondary Actions Row: Chat, Cancel, Call */}
                    <View style={styles.secondaryActionRow}>
                        <TouchableOpacity style={styles.smallActionBtn} onPress={handleOpenChat}>
                            <View style={styles.fabIconWrapper}>
                                <Feather name="message-circle" size={20} color={colors.primary} />
                                {unreadCount > 0 && (
                                    <View style={styles.smallBadge}>
                                        <Text style={styles.smallBadgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
                                    </View>
                                )}
                            </View>
                            <Text style={styles.smallActionText}>Chat</Text>
                        </TouchableOpacity>

                        {ride.status === 'accepted' && (
                            <TouchableOpacity style={[styles.smallActionBtn, styles.cancelAction]} onPress={handleCancel}>
                                <Feather name="x-circle" size={20} color={colors.error} />
                                <Text style={[styles.smallActionText, { color: colors.error }]}>Cancel</Text>
                            </TouchableOpacity>
                        )}

                        <TouchableOpacity style={styles.smallActionBtn} onPress={handleCall}>
                            <Feather name="phone" size={20} color={colors.success} />
                            <Text style={[styles.smallActionText, { color: colors.success }]}>Call</Text>
                        </TouchableOpacity>

                        {/* SOS Button */}
                        <TouchableOpacity style={[styles.smallActionBtn, { borderColor: colors.error + '60' }]} onPress={handleSOS}>
                            <Feather name="alert-triangle" size={20} color={colors.error} />
                            <Text style={[styles.smallActionText, { color: colors.error }]}>SOS</Text>
                        </TouchableOpacity>
                    </View>
                </View>

                {/* Lock note */}
                <View style={styles.lockNote}>
                    <Feather name="lock" size={12} color={colors.textMuted} />
                    <Text style={styles.lockText}>{t('activeRide.lockNote')}</Text>
                </View>
            </ScrollView>

            {/* Completion Fare Summary Modal Overlay */}
            {showCompletionModal && (
                <View style={StyleSheet.absoluteFillObject}>
                    <View style={styles.modalOverlay}>
                        <View style={styles.modalContainer}>
                            <View style={styles.successIconCircle}>
                                <Feather name="check" size={40} color={colors.white} />
                            </View>
                            
                            <Text style={styles.modalTitle}>Ride Completed!</Text>
                            <Text style={styles.modalSubtitle}>Here is the fare breakdown for this trip</Text>
                            
                            <View style={styles.modalTotalContainer}>
                                <Text style={styles.modalTotalLabel}>TOTAL CHARGE</Text>
                                <Text style={styles.modalTotalValue}>₹{ride?.fare}</Text>
                            </View>
                            
                            <View style={styles.modalDetailsCard}>
                                <View style={styles.modalDetailRow}>
                                    <Text style={styles.modalDetailKey}>Trip Distance</Text>
                                    <Text style={styles.modalDetailVal}>{ride?.distance_km} km</Text>
                                </View>
                                {ride?.base_fare != null && (
                                    <View style={styles.modalDetailRow}>
                                        <Text style={styles.modalDetailKey}>Base Fare</Text>
                                        <Text style={styles.modalDetailVal}>₹{ride.base_fare}</Text>
                                    </View>
                                )}
                                {ride?.distance_fare != null && (
                                    <View style={styles.modalDetailRow}>
                                        <Text style={styles.modalDetailKey}>Distance Fare</Text>
                                        <Text style={styles.modalDetailVal}>₹{ride.distance_fare}</Text>
                                    </View>
                                )}
                                {(ride?.waiting_charge ?? 0) > 0 && (
                                    <View style={styles.modalDetailRow}>
                                        <Text style={styles.modalDetailKey}>Waiting Charge</Text>
                                        <Text style={[styles.modalDetailVal, { color: colors.warning }]}>₹{ride.waiting_charge}</Text>
                                    </View>
                                )}
                            </View>
                            
                            <TouchableOpacity 
                                style={styles.modalDoneBtn} 
                                onPress={() => router.replace('/(tabs)/bookings')}
                                activeOpacity={0.8}
                            >
                                <Text style={styles.modalDoneBtnText}>Done</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            )}
        </View>
    );
}


const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    center: { justifyContent: 'center', alignItems: 'center', padding: 24 },

    // Error state
    errorTitle: { fontFamily: Fonts.bold, fontSize: 18, color: colors.text, marginTop: 16, marginBottom: 8 },
    errorSubtitle: { fontFamily: Fonts.regular, fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
    retryBtn: { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 28, marginBottom: 12 },
    retryBtnText: { fontFamily: Fonts.bold, fontSize: 15, color: colors.white },
    backBtn: { borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 28 },
    backBtnText: { fontFamily: Fonts.medium, fontSize: 15, color: colors.textSecondary },

    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 20, paddingVertical: 16,
        backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    headerTitle: { fontFamily: Fonts.bold, fontSize: 18, color: colors.text },
    rideId: { fontFamily: Fonts.medium, fontSize: 13, color: colors.textMuted, marginTop: 2 },
    fareBadge: { backgroundColor: colors.primaryLight, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8, alignItems: 'center' },
    fareLabel: { fontFamily: Fonts.regular, fontSize: 11, color: colors.primary },
    fareValue: { fontFamily: Fonts.black, fontSize: 22, color: colors.primary },

    // Network banner
    netBanner: {
        flexDirection: 'row', alignItems: 'center', gap: 8,
        backgroundColor: colors.error, paddingHorizontal: 16, paddingVertical: 8,
    },
    netBannerText: { flex: 1, fontFamily: Fonts.medium, fontSize: 12, color: colors.white },
    netRetry: { fontFamily: Fonts.bold, fontSize: 12, color: colors.white, textDecorationLine: 'underline' },

    progressBar: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        paddingHorizontal: 20, paddingVertical: 16,
        backgroundColor: colors.surface, marginBottom: 2,
    },
    progressStep: { alignItems: 'center', gap: 4 },
    progressDot: {
        width: 24, height: 24, borderRadius: 12, borderWidth: 2,
        borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
    },
    progressDotActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
    progressDotDone: { borderColor: colors.success, backgroundColor: colors.success },
    progressDotCenter: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
    progressLine: { flex: 1, height: 2, backgroundColor: colors.border, marginBottom: 16 },
    progressLineDone: { backgroundColor: colors.success },
    progressLabel: { fontFamily: Fonts.medium, fontSize: 10, color: colors.textMuted },
    progressLabelActive: { color: colors.primary },

    statusCard: {
        backgroundColor: colors.primary, marginHorizontal: 16, marginTop: 12,
        borderRadius: 20, padding: 20, alignItems: 'center', gap: 6,
        shadowColor: colors.primary, shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3, shadowRadius: 8, elevation: 5,
    },
    statusIconBox: {
        width: 52, height: 52, borderRadius: 26,
        backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center',
        marginBottom: 6,
    },
    statusTitle: { fontFamily: Fonts.bold, fontSize: 18, color: colors.white },
    distanceText: { fontFamily: Fonts.regular, fontSize: 14, color: 'rgba(255,255,255,0.75)' },

    routeCard: {
        backgroundColor: colors.surface, marginHorizontal: 16, marginTop: 12,
        borderRadius: 18, padding: 16, borderWidth: 1, borderColor: colors.border,
    },
    locationRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    locationDot: { width: 12, height: 12, borderRadius: 6, flexShrink: 0 },
    locationInfo: { flex: 1 },
    locationLabel: { fontFamily: Fonts.medium, fontSize: 12, color: colors.textMuted, marginBottom: 2 },
    locationAddress: { fontFamily: Fonts.medium, fontSize: 14, color: colors.text, lineHeight: 20 },
    routeConnector: { paddingLeft: 5, paddingVertical: 4 },
    routeConnectorLine: { width: 1.5, height: 16, backgroundColor: colors.border },
    dropoffHidden: {
        flexDirection: 'row', alignItems: 'center', gap: 8,
        marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border,
    },
    dropoffHiddenText: { fontFamily: Fonts.regular, fontSize: 13, color: colors.textMuted, fontStyle: 'italic' },

    detailsCard: {
        flexDirection: 'row', gap: 8, backgroundColor: colors.primaryLight,
        marginHorizontal: 16, marginTop: 10, borderRadius: 12, padding: 12, alignItems: 'flex-start',
    },
    detailsText: { flex: 1, fontFamily: Fonts.regular, fontSize: 13, color: colors.primary, lineHeight: 18 },

    actions: { marginHorizontal: 16, marginTop: 14, gap: 12 },
    actionBtn: {
        backgroundColor: colors.success, borderRadius: 16, paddingVertical: 16,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
        shadowColor: colors.success, shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
    },
    actionBtnLoading: { opacity: 0.7 },
    actionBtnText: { fontFamily: Fonts.bold, fontSize: 17, color: colors.white },

    secondaryActionRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 4,
        gap: 10,
    },
    smallActionBtn: {
        flex: 1,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 14,
        paddingVertical: 12,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
    },
    cancelAction: {
        borderColor: colors.error + '40',
    },
    smallActionText: {
        fontFamily: Fonts.bold,
        fontSize: 12,
        color: colors.primary,
    },
    fabIconWrapper: {
        position: 'relative',
    },
    smallBadge: {
        position: 'absolute',
        top: -6,
        right: -10,
        backgroundColor: colors.error,
        minWidth: 16,
        height: 16,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 3,
        borderWidth: 1,
        borderColor: colors.white,
    },
    smallBadgeText: {
        color: colors.white,
        fontFamily: Fonts.black,
        fontSize: 8,
    },

    lockNote: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        gap: 6, marginTop: 12,
    },
    lockText: { fontFamily: Fonts.regular, fontSize: 12, color: colors.textMuted },

    // OTP Styles
    otpContainer: {
        backgroundColor: colors.surface,
        borderRadius: 16,
        padding: 20,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: colors.border,
        marginBottom: 8,
    },
    otpTitle: { fontFamily: Fonts.bold, fontSize: 18, color: colors.text, marginBottom: 4 },
    otpSubtitle: { fontFamily: Fonts.regular, fontSize: 13, color: colors.textSecondary, textAlign: 'center', marginBottom: 16 },
    otpInputContainer: { flexDirection: 'row', gap: 12, justifyContent: 'center' },
    otpInput: {
        width: 50, height: 60,
        borderRadius: 12, borderWidth: 1.5, borderColor: colors.border,
        backgroundColor: colors.background,
        fontFamily: Fonts.bold, fontSize: 24, color: colors.text,
        textAlign: 'center',
    },
    otpInputError: { borderColor: colors.error, color: colors.error },
    otpErrorText: { fontFamily: Fonts.medium, fontSize: 13, color: colors.error, marginTop: 12 },

    // Fare breakdown
    fareBreakdown: {
        backgroundColor: colors.surface, marginHorizontal: 16, marginTop: 10,
        borderRadius: 14, padding: 14, borderWidth: 1, borderColor: colors.border,
    },
    fareBreakdownTitle: { fontFamily: Fonts.bold, fontSize: 13, color: colors.textMuted, marginBottom: 10, letterSpacing: 0.5, textTransform: 'uppercase' },
    fareRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
    fareKey: { fontFamily: Fonts.regular, fontSize: 13, color: colors.textSecondary },
    fareVal: { fontFamily: Fonts.medium, fontSize: 13, color: colors.text },

    // Multi-stop badge
    multiStopBadge: {
        flexDirection: 'row', alignItems: 'center', gap: 6,
        backgroundColor: colors.primaryLight, marginHorizontal: 16, marginTop: 8,
        borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
    },
    multiStopText: { fontFamily: Fonts.medium, fontSize: 13, color: colors.primary },

    // Parcel contacts
    parcelCard: {
        backgroundColor: colors.surface, marginHorizontal: 16, marginTop: 10,
        borderRadius: 14, padding: 14, borderWidth: 1, borderColor: colors.border,
    },
    parcelTitle: { fontFamily: Fonts.bold, fontSize: 13, color: colors.text, marginBottom: 10 },
    parcelRow: {
        flexDirection: 'row', alignItems: 'center', gap: 8,
        paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border,
    },
    parcelLabel: { fontFamily: Fonts.medium, fontSize: 13, color: colors.textSecondary, flex: 0, width: 60 },
    parcelPhone: { flex: 1, fontFamily: Fonts.bold, fontSize: 14, color: colors.text },

    // Modal completion styling
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.6)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
    },
    modalContainer: {
        width: '100%',
        backgroundColor: colors.surface,
        borderRadius: 24,
        padding: 24,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.25,
        shadowRadius: 10,
        elevation: 10,
    },
    successIconCircle: {
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: colors.success,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 16,
    },
    modalTitle: {
        fontFamily: Fonts.bold,
        fontSize: 22,
        color: colors.text,
        marginBottom: 4,
    },
    modalSubtitle: {
        fontFamily: Fonts.regular,
        fontSize: 14,
        color: colors.textSecondary,
        textAlign: 'center',
        marginBottom: 20,
    },
    modalTotalContainer: {
        backgroundColor: colors.primaryLight,
        width: '100%',
        paddingVertical: 16,
        borderRadius: 16,
        alignItems: 'center',
        marginBottom: 16,
    },
    modalTotalLabel: {
        fontFamily: Fonts.bold,
        fontSize: 12,
        color: colors.primary,
        letterSpacing: 1,
        marginBottom: 4,
    },
    modalTotalValue: {
        fontFamily: Fonts.black,
        fontSize: 32,
        color: colors.primary,
    },
    modalDetailsCard: {
        width: '100%',
        backgroundColor: colors.background,
        borderRadius: 16,
        padding: 16,
        gap: 12,
        marginBottom: 20,
        borderWidth: 1,
        borderColor: colors.border,
    },
    modalDetailRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    modalDetailKey: {
        fontFamily: Fonts.medium,
        fontSize: 14,
        color: colors.textSecondary,
    },
    modalDetailVal: {
        fontFamily: Fonts.bold,
        fontSize: 14,
        color: colors.text,
    },
    modalDoneBtn: {
        backgroundColor: colors.primary,
        width: '100%',
        paddingVertical: 16,
        borderRadius: 16,
        alignItems: 'center',
        shadowColor: colors.primary,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 4,
    },
    modalDoneBtnText: {
        fontFamily: Fonts.bold,
        fontSize: 16,
        color: colors.white,
    },
});