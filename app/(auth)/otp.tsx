import React, { useState, useRef, useEffect } from 'react';
import {
    View, Text, TextInput, TouchableOpacity, StyleSheet,
    ActivityIndicator, Alert, Keyboard,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { colors, Fonts } from '@/constants/colors';
import { AuthService } from '@/services/auth.service';
import { useAuth } from '@/contexts/auth-context';
import { useTranslation } from 'react-i18next';

export default function OTPScreen() {
    const insets = useSafeAreaInsets();
    const { phone } = useLocalSearchParams<{ phone: string }>();
    const { setDriverData } = useAuth();
    const { t } = useTranslation();
    const [otp, setOtp] = useState(['', '', '', '', '', '']);
    const [loading, setLoading] = useState(false);
    const [resendTimer, setResendTimer] = useState(30);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const isVerifyingRef = useRef(false);
    const inputs = useRef<TextInput[]>([]);

    useEffect(() => {
        const interval = setInterval(() => {
            setResendTimer((t) => (t > 0 ? t - 1 : 0));
        }, 1000);
        return () => clearInterval(interval);
    }, []);

    const handleChange = (val: string, idx: number) => {
        setErrorMessage(null);
        const digitsOnly = val.replace(/[^0-9]/g, '');

        // Handle Paste of full 6-digit OTP
        if (digitsOnly.length === 6) {
            const pastedOtp = digitsOnly.split('');
            setOtp(pastedOtp);
            Keyboard.dismiss();
            verifyCode(digitsOnly);
            return;
        }

        const newOtp = [...otp];
        newOtp[idx] = digitsOnly.slice(-1); // Only take latest single digit
        setOtp(newOtp);

        if (digitsOnly && idx < 5) {
            inputs.current[idx + 1]?.focus();
        }

        if (newOtp.every((d) => d !== '') && newOtp.join('').length === 6) {
            Keyboard.dismiss();
            verifyCode(newOtp.join(''));
        }
    };

    const handleKeyPress = (e: any, idx: number) => {
        if (e.nativeEvent.key === 'Backspace' && !otp[idx] && idx > 0) {
            inputs.current[idx - 1]?.focus();
        }
    };

    const verifyCode = async (code: string) => {
        if (loading || isVerifyingRef.current) return;
        if (!code || code.length !== 6) return;

        isVerifyingRef.current = true;
        setLoading(true);
        setErrorMessage(null);

        try {
            const driver = await AuthService.verifyOTP(phone!, code);
            if (driver) {
                // Existing driver
                await setDriverData(driver);
                if (driver.rider_status === 'unsubmitted' || driver.rider_status === 'pending' || driver.rider_status === 'rejected') {
                    router.replace('/(auth)/onboarding');
                } else {
                    router.replace('/(tabs)/bookings');
                }
            } else {
                // New driver — proceed to profile registration
                router.push({ pathname: '/(auth)/register', params: { phone } });
            }
        } catch (e: any) {
            const msg = e.message?.includes('timed out')
                ? 'Verification timed out. Please check your internet connection and try again.'
                : (e.message ?? t('common.error'));
            setErrorMessage(msg);
            Alert.alert(t('common.error'), msg);
            setOtp(['', '', '', '', '', '']);
            inputs.current[0]?.focus();
        } finally {
            setLoading(false);
            isVerifyingRef.current = false;
        }
    };

    const handleResend = async () => {
        if (resendTimer > 0 || loading || isVerifyingRef.current) return;
        setErrorMessage(null);
        try {
            await AuthService.sendOTP(phone!);
            setResendTimer(30);
            setOtp(['', '', '', '', '', '']);
            inputs.current[0]?.focus();
            Alert.alert(t('common.done'), t('otp.resendSuccess') || 'A new verification code has been sent.');
        } catch (e: any) {
            const msg = e.message ?? t('otp.resendError');
            setErrorMessage(msg);
            Alert.alert(t('common.error'), msg);
        }
    };

    return (
        <View style={[styles.container, { paddingTop: insets.top }]}>
            <TouchableOpacity style={styles.back} onPress={() => router.back()}>
                <Feather name="arrow-left" size={22} color={colors.text} />
            </TouchableOpacity>

            <View style={styles.content}>
                <View style={styles.iconBox}>
                    <Feather name="message-square" size={28} color={colors.primary} />
                </View>
                <Text style={styles.title}>{t('otp.title')}</Text>
                <Text style={styles.subtitle}>
                    {t('otp.subtitle')}{'\n'}
                    <Text style={styles.phone}>{phone}</Text>
                </Text>

                <View style={styles.otpRow}>
                    {otp.map((digit, idx) => (
                        <TextInput
                            key={idx}
                            ref={(r) => { if (r) inputs.current[idx] = r; }}
                            style={[styles.otpInput, digit && styles.otpFilled, loading && styles.otpDisabled]}
                            maxLength={1}
                            keyboardType="number-pad"
                            value={digit}
                            onChangeText={(v) => handleChange(v, idx)}
                            onKeyPress={(e) => handleKeyPress(e, idx)}
                            editable={!loading}
                            selectTextOnFocus
                        />
                    ))}
                </View>

                {errorMessage && (
                    <View style={styles.errorBanner}>
                        <Feather name="alert-circle" size={14} color={colors.error} />
                        <Text style={styles.errorBannerText}>{errorMessage}</Text>
                    </View>
                )}

                {loading && (
                    <View style={styles.loadingRow}>
                        <ActivityIndicator size="small" color={colors.primary} />
                        <Text style={styles.loadingText}>{t('common.loading')}</Text>
                    </View>
                )}

                <TouchableOpacity
                    style={[styles.verifyBtn, (loading || otp.join('').length < 6) && styles.btnDisabled]}
                    onPress={() => verifyCode(otp.join(''))}
                    disabled={loading || otp.join('').length < 6}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityLabel={t('otp.verify')}
                >
                    <Text style={styles.verifyText}>{t('otp.verify')}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    onPress={handleResend}
                    disabled={resendTimer > 0 || loading}
                    style={styles.resendRow}
                    accessibilityRole="button"
                    accessibilityLabel={t('otp.resend')}
                >
                    <Text style={[styles.resendText, resendTimer > 0 && styles.resendDisabled]}>
                        {resendTimer > 0 ? t('otp.resendIn', { seconds: resendTimer }) : t('otp.resend')}
                    </Text>
                </TouchableOpacity>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    back: { margin: 20, width: 44, height: 44, borderRadius: 12, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
    content: { flex: 1, paddingHorizontal: 28, paddingTop: 20 },
    iconBox: {
        width: 64, height: 64, borderRadius: 20,
        backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center',
        marginBottom: 20,
    },
    title: { fontFamily: Fonts.black, fontSize: 26, color: colors.text, marginBottom: 8 },
    subtitle: { fontFamily: Fonts.regular, fontSize: 15, color: colors.textSecondary, lineHeight: 22, marginBottom: 36 },
    phone: { fontFamily: Fonts.bold, color: colors.text },
    otpRow: { flexDirection: 'row', gap: 10, marginBottom: 32 },
    otpInput: {
        flex: 1, height: 56, borderRadius: 14, textAlign: 'center',
        fontSize: 22, fontFamily: Fonts.bold, color: colors.text,
        backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border,
    },
    otpFilled: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
    otpDisabled: { opacity: 0.6 },
    loadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 16 },
    loadingText: { fontFamily: Fonts.medium, fontSize: 14, color: colors.primary },
    errorBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: colors.errorLight || '#FEE2E2',
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 10,
        marginBottom: 20,
    },
    errorBannerText: {
        flex: 1,
        fontFamily: Fonts.medium,
        fontSize: 13,
        color: colors.error,
    },
    verifyBtn: {
        backgroundColor: colors.primary, borderRadius: 14,
        paddingVertical: 16, alignItems: 'center', marginBottom: 16,
    },
    btnDisabled: { opacity: 0.5 },
    verifyText: { fontFamily: Fonts.bold, fontSize: 16, color: colors.white },
    resendRow: { alignItems: 'center', paddingVertical: 12 },
    resendText: { fontFamily: Fonts.medium, fontSize: 14, color: colors.primary },
    resendDisabled: { color: colors.textMuted },
});
