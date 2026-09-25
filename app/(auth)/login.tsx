import React, { useState } from 'react';
import {
    View, Text, TextInput, TouchableOpacity, StyleSheet,
    KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { colors, Fonts } from '@/constants/colors';
import { AuthService } from '@/services/auth.service';
import { useTranslation } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function LoginScreen() {
    const insets = useSafeAreaInsets();
    const { t, i18n } = useTranslation();
    const [phone, setPhone] = useState('');
    const [loading, setLoading] = useState(false);

    const toggleLanguage = async () => {
        const newLang = i18n.language === 'en' ? 'ta' : 'en';
        await i18n.changeLanguage(newLang);
        await AsyncStorage.setItem('user-language', newLang);
    };

    const handleSendOTP = async () => {
        const cleaned = phone.replace(/\D/g, '');
        if (cleaned.length < 10) {
            Alert.alert(t('common.error'), t('common.invalidPhone'));
            return;
        }

        const formattedPhone = cleaned.startsWith('91') ? `+${cleaned}` : `+91${cleaned}`;

        setLoading(true);
        try {
            await AuthService.sendOTP(formattedPhone);
            router.push({ pathname: '/(auth)/otp', params: { phone: formattedPhone } });
        } catch (e: any) {
            Alert.alert(t('common.error'), e.message ?? t('common.error'));
        } finally {
            setLoading(false);
        }
    };

    return (
        <KeyboardAvoidingView
            style={styles.flex}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
            <ScrollView
                contentContainerStyle={[
                    styles.container,
                    { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 },
                ]}
                keyboardShouldPersistTaps="handled"
            >
                {/* Language Toggle */}
                <TouchableOpacity
                    style={[styles.langToggle, { top: insets.top + 10 }]}
                    onPress={toggleLanguage}
                    activeOpacity={0.7}
                >
                    <Feather name="globe" size={16} color={colors.white} />
                    <Text style={styles.langText}>{i18n.language === 'en' ? 'தமிழ்' : 'English'}</Text>
                </TouchableOpacity>

                {/* Header */}
                <View style={styles.header}>
                    <View style={styles.logoContainer}>
                        <Feather name="truck" size={36} color={colors.white} />
                    </View>
                    <Text style={styles.appName}>{t('common.appName')}</Text>
                    <Text style={styles.tagline}>{t('common.tagline')}</Text>
                </View>

                {/* Card */}
                <View style={styles.card}>
                    <Text style={styles.title}>{t('login.welcome')}</Text>
                    <Text style={styles.subtitle}>{t('login.subtitle')}</Text>

                    <View style={styles.inputContainer}>
                        <View style={styles.prefixBox}>
                            <Text style={styles.prefix}>🇮🇳 +91</Text>
                        </View>
                        <TextInput
                            style={styles.input}
                            placeholder={t('login.placeholder')}
                            placeholderTextColor={colors.textMuted}
                            keyboardType="phone-pad"
                            maxLength={10}
                            value={phone}
                            onChangeText={setPhone}
                            returnKeyType="done"
                            onSubmitEditing={handleSendOTP}
                        />
                    </View>

                    <TouchableOpacity
                        style={[styles.btn, loading && styles.btnDisabled]}
                        onPress={handleSendOTP}
                        disabled={loading}
                        activeOpacity={0.85}
                    >
                        {loading ? (
                            <ActivityIndicator color={colors.white} />
                        ) : (
                            <Text style={styles.btnText}>{t('common.getOTP')}</Text>
                        )}
                    </TouchableOpacity>

                    <Text style={styles.demoNote}>{t('login.demoNote')}</Text>
                </View>

                {/* Footer — Terms link opens embedded screen */}
                <Text style={styles.footerText}>
                    {t('login.termsNote')}{' '}
                    <Text
                        style={styles.link}
                        // ✅ Navigates to the embedded Terms & Conditions screen
                        onPress={() => router.push('../terms')}
                    >
                        {t('login.termsLink')}
                    </Text>
                </Text>
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    flex: { flex: 1, backgroundColor: colors.navy },
    container: { flexGrow: 1, paddingHorizontal: 24 },
    header: { alignItems: 'center', marginBottom: 40, marginTop: 20 },
    logoContainer: {
        width: 80, height: 80, borderRadius: 24,
        backgroundColor: colors.primary,
        alignItems: 'center', justifyContent: 'center',
        marginBottom: 16,
        shadowColor: colors.primary,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.4, shadowRadius: 16,
        elevation: 10,
    },
    appName: { fontFamily: Fonts.black, fontSize: 28, color: colors.white, letterSpacing: -0.5 },
    tagline: { fontFamily: Fonts.regular, fontSize: 14, color: colors.textMuted, marginTop: 4 },
    card: {
        backgroundColor: colors.surface,
        borderRadius: 24, padding: 28,
        shadowColor: '#000', shadowOffset: { width: 0, height: 20 },
        shadowOpacity: 0.15, shadowRadius: 40, elevation: 10,
    },
    title: { fontFamily: Fonts.bold, fontSize: 22, color: colors.text, marginBottom: 6 },
    subtitle: { fontFamily: Fonts.regular, fontSize: 14, color: colors.textSecondary, marginBottom: 28 },
    inputContainer: {
        flexDirection: 'row', alignItems: 'center',
        borderWidth: 1.5, borderColor: colors.border,
        borderRadius: 14, overflow: 'hidden', marginBottom: 20,
    },
    prefixBox: {
        backgroundColor: colors.background, paddingHorizontal: 14,
        paddingVertical: 16, borderRightWidth: 1.5, borderRightColor: colors.border,
    },
    prefix: { fontFamily: Fonts.medium, fontSize: 15, color: colors.text },
    input: {
        flex: 1, paddingHorizontal: 14, paddingVertical: 16,
        fontFamily: Fonts.medium, fontSize: 16, color: colors.text,
    },
    btn: {
        backgroundColor: colors.primary, borderRadius: 14,
        paddingVertical: 16, alignItems: 'center',
        shadowColor: colors.primary, shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
    },
    btnDisabled: { opacity: 0.6 },
    btnText: { fontFamily: Fonts.bold, fontSize: 16, color: colors.white },
    demoNote: {
        textAlign: 'center', marginTop: 12,
        fontFamily: Fonts.regular, fontSize: 12, color: colors.textMuted,
    },
    footerText: {
        textAlign: 'center', marginTop: 24,
        fontFamily: Fonts.regular, fontSize: 13, color: colors.textMuted,
    },
    link: { color: colors.primary, fontFamily: Fonts.medium },
    langToggle: {
        position: 'absolute', right: 0,
        backgroundColor: 'rgba(255,255,255,0.15)',
        flexDirection: 'row', alignItems: 'center', gap: 6,
        paddingHorizontal: 12, paddingVertical: 8,
        borderRadius: 20, zIndex: 10,
    },
    langText: { fontFamily: Fonts.bold, fontSize: 13, color: colors.white },
});