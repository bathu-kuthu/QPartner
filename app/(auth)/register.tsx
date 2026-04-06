import React, { useState } from 'react';
import {
    View, Text, TextInput, TouchableOpacity, StyleSheet,
    KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { colors, Fonts } from '@/constants/colors';
import { AuthService } from '@/services/auth.service';
import { useAuth } from '@/contexts/auth-context';
import { useTranslation } from 'react-i18next';
import { Driver } from '@/types';

export default function RegisterScreen() {
    const insets = useSafeAreaInsets();
    const { phone } = useLocalSearchParams<{ phone: string }>();
    const { setDriverData } = useAuth();
    const { t } = useTranslation();
    const [name, setName] = useState('');
    const [loading, setLoading] = useState(false);

    const handleRegister = async () => {
        if (name.trim().length < 2) {
            Alert.alert(t('common.error'), t('common.invalidName'));
            return;
        }
        setLoading(true);
        try {
            const driver = await AuthService.createDriver(phone!, name);
            await setDriverData(driver as Driver);
            router.replace('/(auth)/onboarding');
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
                contentContainerStyle={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom + 20 }]}
                keyboardShouldPersistTaps="handled"
            >
                <TouchableOpacity style={styles.back} onPress={() => router.back()}>
                    <Feather name="arrow-left" size={22} color={colors.text} />
                </TouchableOpacity>

                <View style={styles.content}>
                    <View style={styles.iconBox}>
                        <Feather name="user-plus" size={28} color={colors.primary} />
                    </View>
                    <Text style={styles.title}>{t('register.title')}</Text>
                    <Text style={styles.subtitle}>
                        {t('register.subtitle')}{'\n'}
                        <Text style={styles.phone}>{phone}</Text>
                    </Text>

                    <Text style={styles.label}>{t('register.label')}</Text>
                    <TextInput
                        style={styles.input}
                        placeholder={t('register.placeholder')}
                        placeholderTextColor={colors.textMuted}
                        value={name}
                        onChangeText={setName}
                        autoCapitalize="words"
                        returnKeyType="done"
                        onSubmitEditing={handleRegister}
                    />

                    <View style={styles.infoCard}>
                        <Feather name="info" size={16} color={colors.primary} style={{ marginTop: 2 }} />
                        <Text style={styles.infoText}>
                            {t('register.info')}
                        </Text>
                    </View>

                    <TouchableOpacity
                        style={[styles.btn, loading && styles.btnDisabled]}
                        onPress={handleRegister}
                        disabled={loading}
                        activeOpacity={0.85}
                    >
                        {loading ? (
                            <ActivityIndicator color={colors.white} />
                        ) : (
                            <>
                                <Text style={styles.btnText}>{t('common.continue')}</Text>
                                <Feather name="arrow-right" size={18} color={colors.white} />
                            </>
                        )}
                    </TouchableOpacity>
                </View>
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    flex: { flex: 1, backgroundColor: colors.background },
    container: { flexGrow: 1, paddingHorizontal: 24 },
    back: {
        marginTop: 12, marginBottom: 24, width: 44, height: 44,
        borderRadius: 12, backgroundColor: colors.surface,
        alignItems: 'center', justifyContent: 'center',
    },
    content: { flex: 1 },
    iconBox: {
        width: 64, height: 64, borderRadius: 20,
        backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center',
        marginBottom: 20,
    },
    title: { fontFamily: Fonts.black, fontSize: 26, color: colors.text, marginBottom: 8 },
    subtitle: { fontFamily: Fonts.regular, fontSize: 15, color: colors.textSecondary, lineHeight: 22, marginBottom: 32 },
    phone: { fontFamily: Fonts.bold, color: colors.text },
    label: { fontFamily: Fonts.medium, fontSize: 13, color: colors.textSecondary, marginBottom: 8, marginLeft: 2 },
    input: {
        backgroundColor: colors.surface, borderRadius: 14,
        borderWidth: 1.5, borderColor: colors.border,
        paddingHorizontal: 16, paddingVertical: 15,
        fontFamily: Fonts.medium, fontSize: 16, color: colors.text,
        marginBottom: 20,
    },
    infoCard: {
        flexDirection: 'row', gap: 10, backgroundColor: colors.primaryLight,
        borderRadius: 14, padding: 16, marginBottom: 28,
    },
    infoText: { flex: 1, fontFamily: Fonts.regular, fontSize: 13, color: colors.primary, lineHeight: 20 },
    btn: {
        backgroundColor: colors.primary, borderRadius: 14,
        paddingVertical: 16, alignItems: 'center', flexDirection: 'row',
        justifyContent: 'center', gap: 8,
        shadowColor: colors.primary, shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
    },
    btnDisabled: { opacity: 0.6 },
    btnText: { fontFamily: Fonts.bold, fontSize: 16, color: colors.white },
});
