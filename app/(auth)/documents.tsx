import ImageEditorModal from '@/components/ImageEditorModal';
import { supabase } from '@/config/supabase';
import { colors, Fonts } from '@/constants/colors';
import { useAuth } from '@/contexts/auth-context';
import { AuthService } from '@/services/auth.service';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    ActivityIndicator,
    Alert,
    Image,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
interface DocField {
    key: string;
    label: string;
    numberKey: string;
    numberLabel: string;
    numberPlaceholder: string;
}



export default function DocumentsScreen() {
    const insets = useSafeAreaInsets();
    const { category, vehicleType } = useLocalSearchParams<{ category: string; vehicleType: string }>();
    const { driver, refreshDriver } = useAuth();
    const { t } = useTranslation();

    const isFromProfile = !category;
    const currentCategory = category || driver?.vehicle_category || 'taxi';
    const currentType = vehicleType || driver?.vehicle_type || 'bike';

    const hasMissingDocs = isFromProfile && (
        !driver?.name ||
        !driver?.avatar ||
        !driver?.vehicle_number ||
        !driver?.aadhaar_url || !driver?.aadhaar_number ||
        !driver?.pan_url || !driver?.pan_number ||
        !driver?.license_url || !driver?.license_number
    );

    const DOC_FIELDS: DocField[] = [
        { key: 'aadhaar_url', label: t('documents.aadhaar'), numberKey: 'aadhaar_number', numberLabel: t('documents.aadhaarNum'), numberPlaceholder: t('documents.aadhaarPlaceholder') },
        { key: 'pan_url', label: t('documents.pan'), numberKey: 'pan_number', numberLabel: t('documents.panNum'), numberPlaceholder: t('documents.panPlaceholder') },
        { key: 'license_url', label: t('documents.license'), numberKey: 'license_number', numberLabel: t('documents.licenseNum'), numberPlaceholder: t('documents.licensePlaceholder') },
    ];

    const [name, setName] = useState(driver?.name ?? '');
    const [vehicleNumber, setVehicleNumber] = useState(driver?.vehicle_number ?? '');
    const [docs, setDocs] = useState<Record<string, string>>({
        avatar: driver?.avatar ?? '',
        aadhaar_url: driver?.aadhaar_url ?? '',
        aadhaar_number: driver?.aadhaar_number ?? '',
        pan_url: driver?.pan_url ?? '',
        pan_number: driver?.pan_number ?? '',
        license_url: driver?.license_url ?? '',
        license_number: driver?.license_number ?? '',
    });
    const [uploading, setUploading] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    // Crop state
    const [cropDocKey, setCropDocKey] = useState<string | null>(null);
    const [cropImageUri, setCropImageUri] = useState<string | null>(null);

    const pickAndUpload = async (docKey: string) => {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
            Alert.alert(t('common.error'), t('documents.permissionNeeded'));
            return;
        }

        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            quality: 1,
            allowsEditing: false, // DO NOT use native crop, use ImageEditorModal
        });

        if (result.canceled || !result.assets || !result.assets[0] || !result.assets[0].uri) return;

        const asset = result.assets[0];

        if (typeof asset.uri !== 'string') {
            Alert.alert(t('common.error'), 'Selected image is missing a valid URI.');
            return;
        }

        const ext = asset.uri.split('.').pop()?.toLowerCase();
        if (ext !== 'jpg' && ext !== 'jpeg' && ext !== 'png') {
            Alert.alert(t('common.error'), 'Only JPG and PNG images are supported.');
            return;
        }

        // Initial size validation
        if (asset.fileSize && asset.fileSize > 2 * 1024 * 1024) {
            Alert.alert(t('common.error'), 'Image size must not exceed 2 MB.');
            return;
        }

        setCropDocKey(docKey);
        setCropImageUri(asset.uri);
    };

    const handleCropApply = async (docKey: string, uri: string, size: number) => {
        setCropImageUri(null);
        setCropDocKey(null);

        if (!uri || typeof uri !== 'string') {
            Alert.alert(t('common.error'), 'Cropped image is missing a valid URI.');
            return;
        }

        if (size > 2 * 1024 * 1024) {
            Alert.alert(t('common.error'), 'Cropped image size must not exceed 2 MB.');
            return;
        }

        setUploading(docKey);

        try {
            const driverId = driver?.id ?? 'unknown';
            const ext = uri.split('.').pop()?.toLowerCase() || 'jpg';
            const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';
            const fileName = `${driverId}/${docKey}_${Date.now()}.${ext}`;

            // Diagnostic: Check if we actually have an active Supabase session
            const { data: sessionData } = await supabase.auth.getSession();
            const session = sessionData?.session;
            const uid = session?.user?.id;
            console.log(`[Diagnostic] Uploading file to path: ${fileName}`);
            console.log(`[Diagnostic] Supabase Auth Session active: ${!!session}`);
            console.log(`[Diagnostic] Supabase auth.uid(): ${uid || 'null'}`);
            console.log(`[Diagnostic] Driver ID from context: ${driverId}`);

            console.log(`[Upload] Starting upload for ${docKey} (Type: ${mimeType}, Size: ${size} bytes)`);

            // Use FormData for React Native instead of raw Blob to prevent Network request failed
            const formData = new FormData();
            formData.append('file', {
                uri,
                name: fileName,
                type: mimeType,
            } as any);

            const { error } = await supabase.storage
                .from('driver-documents')
                .upload(fileName, formData, { upsert: true });

            if (error) {
                console.error("[Upload] Error during Supabase upload:");
                console.error(`- message: ${error.message}`);
                console.error(`- name: ${error.name}`);
                console.error(`- stack: ${error.stack}`);
                Alert.alert(t('common.error'), 'Failed to upload document: ' + error.message);
                return;
            }

            const { data: urlData, error: urlError } = await supabase.storage.from('driver-documents').createSignedUrl(fileName, 60 * 60 * 24 * 365); // 1 year

            if (urlError || !urlData) {
                console.error("Signed URL error:", urlError);
                Alert.alert(t('common.error'), 'Failed to generate secure document URL.');
                return;
            }

            setDocs(prev => ({ ...prev, [docKey]: urlData.signedUrl }));
            console.log(`[Upload] Successfully uploaded and generated Signed URL for ${docKey}`);
        } catch (e: any) {
            console.error("[Upload] Exception during file processing/upload:", e);
            Alert.alert(t('common.error'), e.message || 'An unexpected error occurred during upload.');
        } finally {
            setUploading(null);
        }
    };

    const isComplete = () => {
        if (!name.trim()) return false;
        if (!docs.avatar) return false;
        if (!vehicleNumber.trim()) return false;
        for (const field of DOC_FIELDS) {
            if (!docs[field.key] || !docs[field.numberKey]?.trim()) return false;
        }
        return true;
    };

    const validateForm = (): string | null => {
        if (!name.trim()) return 'Full Name is required.';
        if (!/^[a-zA-Z\s.']{2,}$/.test(name.trim())) return 'Please enter a valid Name (letters and spaces only).';
        if (!docs.avatar) return 'Profile Photo is required.';
        if (!vehicleNumber.trim()) return 'Vehicle Registration Number is required.';

        // Indian Vehicle Number format: e.g. MH 01 AB 1234 or MH01AB1234
        if (!/^[A-Z]{2}[0-9]{1,2}[A-Z]{1,3}[0-9]{4}$/i.test(vehicleNumber.trim().replace(/[\s-]/g, ''))) {
            return 'Please enter a valid Vehicle Registration Number.';
        }

        for (const field of DOC_FIELDS) {
            if (!docs[field.key]) return `${field.label} image is required.`;
            const val = docs[field.numberKey]?.trim();
            if (!val) return `${field.numberLabel} is required.`;

            if (field.numberKey === 'aadhaar_number' && !/^\d{12}$/.test(val.replace(/\s/g, ''))) {
                return 'Aadhaar Number must be exactly 12 digits.';
            }
            if (field.numberKey === 'pan_number' && !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/i.test(val)) {
                return 'Please enter a valid PAN Number (e.g., ABCDE1234F).';
            }
            if (field.numberKey === 'license_number') {
                // Generic Indian DL regex: State code + 2 digits + Year + 7 digits
                if (!/^[A-Z]{2}[0-9]{2}[0-9]{4}[0-9]{7}$/i.test(val.replace(/[\s-]/g, ''))) {
                    return 'Please enter a valid Driving Licence Number (e.g., MH0120110012345).';
                }
            }
        }
        return null;
    };

    const handleSubmit = async () => {
        const errorMsg = validateForm();
        if (errorMsg) {
            Alert.alert(t('common.error'), errorMsg);
            return;
        }
        if (!driver?.id) return;

        setSubmitting(true);
        try {
            await AuthService.submitDocuments(driver.id, {
                name: name.trim(),
                avatar: docs.avatar,
                vehicle_category: (currentCategory as 'taxi' | 'logistics'),
                vehicle_type: currentType,
                vehicle_number: vehicleNumber.trim().toUpperCase(),
                pan_url: docs.pan_url,
                pan_number: docs.pan_number.trim().toUpperCase(),
                aadhaar_url: docs.aadhaar_url,
                aadhaar_number: docs.aadhaar_number.trim(),
                license_url: docs.license_url,
                license_number: docs.license_number.trim().toUpperCase(),
            }, !isFromProfile);
            await refreshDriver();
            if (isFromProfile) {
                Alert.alert(t('common.success') || 'Success', t('documents.updateSuccess') || 'Documents updated successfully!');
                router.back();
            }
            // If onboarding, do nothing. _layout.tsx will automatically detect rider_status change and route appropriately.
        } catch (e: any) {
            Alert.alert(t('common.error'), e.message ?? t('common.error'));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <View style={[styles.container, { paddingTop: insets.top }]}>
            {/* Header */}
            <View style={styles.headerBar}>
                <TouchableOpacity style={styles.back} onPress={() => router.back()}>
                    <Feather name="arrow-left" size={20} color={colors.text} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>{t('documents.title')}</Text>
                <View style={{ width: 36 }} />
            </View>

            <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
                {/* Vehicle info */}
                <View style={styles.vehicleBadge}>
                    <Text style={styles.vehicleBadgeText}>
                        {currentCategory === 'taxi' ? '🚖' : '📦'} {currentCategory.charAt(0).toUpperCase()}{currentCategory.slice(1)} · {currentType.toUpperCase()}
                    </Text>
                </View>

                <View style={styles.avatarContainer}>
                    <TouchableOpacity
                        style={styles.avatarUpload}
                        onPress={() => pickAndUpload('avatar')}
                        disabled={uploading === 'avatar' || (isFromProfile && !!driver?.avatar)}
                        activeOpacity={0.8}
                    >
                        {uploading === 'avatar' ? (
                            <ActivityIndicator color={colors.primary} />
                        ) : docs.avatar ? (
                            <Image source={{ uri: docs.avatar }} style={styles.avatarImage} />
                        ) : (
                            <View style={styles.avatarPlaceholder}>
                                <Feather name="camera" size={24} color={colors.textMuted} />
                            </View>
                        )}
                        {(!isFromProfile || !driver?.avatar) && (
                            <View style={styles.avatarEditBadge}>
                                <Feather name="edit-2" size={12} color={colors.white} />
                            </View>
                        )}
                    </TouchableOpacity>
                    <Text style={styles.avatarLabel}>{t('common.labelName') || 'Driver Photo'}</Text>
                </View>

                <Text style={styles.sectionLabel}>{t('register.label') || 'Full Name'}</Text>
                <TextInput
                    placeholder="Enter your full name"
                    placeholderTextColor={colors.textMuted}
                    value={name}
                    onChangeText={setName}
                    editable={!isFromProfile || !driver?.name}
                    style={[styles.input, (isFromProfile && !!driver?.name) && { opacity: 0.7 }]}
                />

                <Text style={[styles.sectionLabel, { marginTop: 16 }]}>{t('documents.vehicleReg')}</Text>
                <TextInput
                    placeholder="e.g. TN01AB1234"
                    placeholderTextColor={colors.textMuted}
                    value={vehicleNumber}
                    onChangeText={setVehicleNumber}
                    autoCapitalize="characters"
                    editable={!isFromProfile || !driver?.vehicle_number}
                    style={[styles.input, (isFromProfile && !!driver?.vehicle_number) && { opacity: 0.7 }]}
                />

                {/* Document fields */}
                {DOC_FIELDS.map((field) => (
                    <View key={field.key} style={styles.docSection}>
                        <Text style={styles.docTitle}>{field.label}</Text>

                        {/* Photo upload */}
                        <TouchableOpacity
                            style={styles.uploadBox}
                            onPress={() => pickAndUpload(field.key)}
                            disabled={uploading === field.key || (isFromProfile && !!driver?.[field.key as keyof typeof driver])}
                            activeOpacity={0.8}
                        >
                            {uploading === field.key ? (
                                <ActivityIndicator color={colors.primary} />
                            ) : docs[field.key] ? (
                                <View style={styles.uploadedRow}>
                                    {docs[field.key].startsWith('http') || docs[field.key].startsWith('file') ? (
                                        <Image source={{ uri: docs[field.key] }} style={styles.thumb} />
                                    ) : (
                                        <View style={styles.uploadedIcon}>
                                            <Feather name="check-circle" size={20} color={colors.success} />
                                        </View>
                                    )}
                                    <Text style={styles.uploadedText}>{t('documents.uploaded')}</Text>
                                    {(!isFromProfile || !driver?.[field.key as keyof typeof driver]) && <Text style={styles.reuploadText}>{t('documents.tapToChange')}</Text>}
                                </View>
                            ) : (
                                <View style={styles.uploadPlaceholder}>
                                    <Feather name="camera" size={22} color={colors.primary} />
                                    <Text style={styles.uploadText}>{t('documents.uploadPhoto')}</Text>
                                    <Text style={styles.uploadHint}>{t('documents.uploadHint')}</Text>
                                </View>
                            )}
                        </TouchableOpacity>

                        {/* Number input */}
                        <Text style={styles.label}>{field.numberLabel}</Text>
                        <TextInput
                            placeholder={field.numberPlaceholder}
                            placeholderTextColor={colors.textMuted}
                            value={docs[field.numberKey]}
                            onChangeText={(v) => setDocs(prev => ({ ...prev, [field.numberKey]: v }))}
                            autoCapitalize="characters"
                            editable={!isFromProfile || !driver?.[field.numberKey as keyof typeof driver]}
                            style={[styles.input, (isFromProfile && !!driver?.[field.numberKey as keyof typeof driver]) && { opacity: 0.7 }]}
                        />
                    </View>
                ))}

                <View style={styles.noteCard}>
                    <Feather name="shield" size={16} color={colors.primary} />
                    <Text style={styles.noteText}>
                        {t('documents.note')}
                    </Text>
                </View>

                {(!isFromProfile || hasMissingDocs) && (
                    <TouchableOpacity
                        style={[styles.submitBtn, (!isComplete() || submitting) && styles.submitBtnDisabled]}
                        onPress={handleSubmit}
                        disabled={!isComplete() || submitting}
                        activeOpacity={0.85}
                    >
                        {submitting ? (
                            <ActivityIndicator color={colors.white} />
                        ) : (
                            <>
                                <Feather name="send" size={18} color={colors.white} />
                                <Text style={styles.submitText}>{t('documents.submit')}</Text>
                            </>
                        )}
                    </TouchableOpacity>
                )}

                <View style={{ height: 40 }} />
            </ScrollView>

            {/* Image Editor Modal for Cropping */}
            <ImageEditorModal
                visible={!!cropImageUri && !!cropDocKey}
                imageUri={cropImageUri || ''}
                onCancel={() => {
                    setCropImageUri(null);
                    setCropDocKey(null);
                }}
                onApply={(uri, size) => {
                    if (cropDocKey) {
                        handleCropApply(cropDocKey, uri, size);
                    }
                }}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    headerBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
    back: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { fontFamily: Fonts.bold, fontSize: 17, color: colors.text },
    scroll: { paddingHorizontal: 20, paddingTop: 8 },
    vehicleBadge: {
        alignSelf: 'flex-start', backgroundColor: colors.primaryLight,
        borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6, marginBottom: 20,
    },
    vehicleBadgeText: { fontFamily: Fonts.medium, fontSize: 13, color: colors.primary },
    avatarContainer: { alignItems: 'center', marginBottom: 24, marginTop: 10 },
    avatarUpload: { width: 90, height: 90, borderRadius: 45, backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', overflow: 'visible' },
    avatarImage: { width: '100%', height: '100%', borderRadius: 45 },
    avatarPlaceholder: { width: '100%', height: '100%', borderRadius: 45, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
    avatarEditBadge: { position: 'absolute', bottom: 0, right: 0, backgroundColor: colors.primary, width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.background },
    avatarLabel: { fontFamily: Fonts.medium, fontSize: 13, color: colors.textSecondary, marginTop: 10 },
    sectionLabel: { fontFamily: Fonts.bold, fontSize: 13, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 },
    label: { fontFamily: Fonts.medium, fontSize: 13, color: colors.textSecondary, marginBottom: 6, marginTop: 12 },
    input: {
        backgroundColor: colors.surface, borderRadius: 12,
        borderWidth: 1.5, borderColor: colors.border,
        paddingHorizontal: 14, paddingVertical: 13,
        fontFamily: Fonts.medium, fontSize: 15, color: colors.text, marginBottom: 4,
    },
    docSection: {
        backgroundColor: colors.surface, borderRadius: 16,
        padding: 16, marginTop: 16, borderWidth: 1, borderColor: colors.border,
    },
    docTitle: { fontFamily: Fonts.bold, fontSize: 15, color: colors.text, marginBottom: 12 },
    uploadBox: {
        borderWidth: 1.5, borderColor: colors.border, borderStyle: 'dashed',
        borderRadius: 12, overflow: 'hidden', minHeight: 90, justifyContent: 'center',
        backgroundColor: colors.background,
    },
    uploadPlaceholder: { alignItems: 'center', padding: 20, gap: 6 },
    uploadText: { fontFamily: Fonts.medium, fontSize: 14, color: colors.primary },
    uploadHint: { fontFamily: Fonts.regular, fontSize: 12, color: colors.textMuted },
    uploadedRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
    thumb: { width: 56, height: 44, borderRadius: 8 },
    uploadedIcon: { width: 56, height: 44, borderRadius: 8, backgroundColor: colors.successLight, alignItems: 'center', justifyContent: 'center' },
    uploadedText: { flex: 1, fontFamily: Fonts.medium, fontSize: 14, color: colors.success },
    reuploadText: { fontFamily: Fonts.regular, fontSize: 12, color: colors.textMuted },
    noteCard: {
        flexDirection: 'row', gap: 10, backgroundColor: colors.primaryLight,
        borderRadius: 14, padding: 14, marginTop: 20, alignItems: 'flex-start',
    },
    noteText: { flex: 1, fontFamily: Fonts.regular, fontSize: 13, color: colors.primary, lineHeight: 19 },
    submitBtn: {
        backgroundColor: colors.primary, borderRadius: 14, marginTop: 20,
        paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
        shadowColor: colors.primary, shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
    },
    submitBtnDisabled: { opacity: 0.4 },
    submitText: { fontFamily: Fonts.bold, fontSize: 16, color: colors.white },
});
