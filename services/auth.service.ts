import { supabase } from '@/config/supabase';
import { Driver } from '@/types';

/**
 * Strict Indian mobile number validator & normalizer.
 * Supports:
 * - 9876543210 (10 digits)
 * - +91 9876543210 / +919876543210 (+91 with 10 digits)
 * - 919876543210 (12 digits)
 * - 09876543210 (11 digits with leading 0)
 *
 * Rejects invalid prefixes, non-digit noise, length mismatches, and numbers not starting with 6-9.
 */
export function normalizeIndianPhone(input: string): { isValid: boolean; formatted: string; nationalNumber: string; error?: string } {
    if (!input || typeof input !== 'string') {
        return { isValid: false, formatted: '', nationalNumber: '', error: 'Phone number is required' };
    }

    const trimmed = input.trim();
    if (!trimmed) {
        return { isValid: false, formatted: '', nationalNumber: '', error: 'Phone number is required' };
    }

    // Only allow digits, spaces, hyphens, and a single leading '+'
    if (!/^\+?[\d\s\-()]+$/.test(trimmed)) {
        return { isValid: false, formatted: '', nationalNumber: '', error: 'Phone number contains invalid characters' };
    }

    let cleaned = trimmed.replace(/[^\d+]/g, '');

    if (cleaned.startsWith('+')) {
        cleaned = cleaned.substring(1);
    }

    if (cleaned.startsWith('91') && cleaned.length === 12) {
        cleaned = cleaned.substring(2);
    } else if (cleaned.startsWith('0') && cleaned.length === 11) {
        cleaned = cleaned.substring(1);
    }

    if (!/^\d{10}$/.test(cleaned)) {
        return { isValid: false, formatted: '', nationalNumber: '', error: 'Please enter a valid 10-digit mobile number' };
    }

    if (!/^[6-9]\d{9}$/.test(cleaned)) {
        return { isValid: false, formatted: '', nationalNumber: '', error: 'Mobile number must start with 6, 7, 8, or 9' };
    }

    return {
        isValid: true,
        formatted: `+91${cleaned}`,
        nationalNumber: cleaned,
    };
}

async function withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number = 10000,
    errorMsg: string = 'Request timed out. Please check your connection and try again.'
): Promise<T> {
    let timer: any;
    const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(errorMsg)), timeoutMs);
    });
    try {
        const result = await Promise.race([promise, timeoutPromise]);
        clearTimeout(timer);
        return result;
    } catch (err) {
        clearTimeout(timer);
        throw err;
    }
}

export class AuthService {
    static async sendOTP(rawPhone: string): Promise<string> {
        const norm = normalizeIndianPhone(rawPhone);
        if (!norm.isValid) {
            throw new Error(norm.error || 'Invalid phone number');
        }
        const cleanPhone = norm.formatted;

        return withTimeout(
            (async () => {
                // Generate a random 6-digit OTP
                const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
                const expiresAt = new Date();
                expiresAt.setMinutes(expiresAt.getMinutes() + 2); // 2 minutes validation

                // Retrieve driver_id if driver exists
                let driverId: string | null = null;
                try {
                    const { data: user } = await supabase
                        .from('users')
                        .select('id')
                        .eq('phone', cleanPhone)
                        .eq('is_driver', true)
                        .maybeSingle();
                    if (user) {
                        driverId = user.id;
                    }
                } catch {
                    // Safe fallback
                }

                const { error } = await supabase
                    .from('otp')
                    .upsert({ 
                        phone: cleanPhone, 
                        otp: otpCode, 
                        driver_id: driverId, 
                        expires_at: expiresAt.toISOString() 
                    }, { onConflict: 'phone' });

                if (error) {
                    console.error('Supabase OTP Error:', error);
                    throw new Error('Failed to generate and send OTP: ' + error.message);
                }

                return otpCode;
            })(),
            10000,
            'OTP request timed out. Please check your connection and try again.'
        );
    }

    static async verifyOTP(rawPhone: string, rawOtp: string): Promise<Driver | null> {
        const norm = normalizeIndianPhone(rawPhone);
        if (!norm.isValid) {
            throw new Error(norm.error || 'Invalid phone number');
        }
        const cleanPhone = norm.formatted;
        const cleanOtp = rawOtp.trim();

        if (!/^\d{6}$/.test(cleanOtp)) {
            throw new Error('Please enter a valid 6-digit OTP');
        }

        return withTimeout(
            (async () => {
                const { data: otpData, error: otpError } = await supabase
                    .from('otp')
                    .select('*')
                    .eq('phone', cleanPhone)
                    .eq('otp', cleanOtp)
                    .single();

                if (otpError || !otpData) {
                    throw new Error('Invalid or expired OTP');
                }

                if (new Date(otpData.expires_at) < new Date()) {
                    throw new Error('OTP has expired');
                }

                // REPLAY PROTECTION: Invalidate used OTP immediately after successful check
                try {
                    await supabase.from('otp').delete().eq('phone', cleanPhone);
                } catch (delErr) {
                    console.warn('[AuthService] Could not clear used OTP record:', delErr);
                }

                try {
                    const { data: userData, error: userError } = await supabase
                        .from('users')
                        .select('*')
                        .eq('phone', cleanPhone)
                        .eq('is_driver', true)
                        .single();

                    if (userError && userError.code !== 'PGRST116') {
                        return null;
                    }

                    return (userData as Driver) ?? null;
                } catch {
                    return null;
                }
            })(),
            10000,
            'Verification timed out. Please check your connection and try again.'
        );
    }

    static async createDriver(phone: string, name: string): Promise<Driver> {
        const { data, error } = await supabase
            .from('users')
            .insert([{
                phone,
                name: name.trim(),
                is_driver: true,
                rider_status: 'unsubmitted',
                is_online: false,
                rating: 5.0,
                total_rides: 0,
                total_spent: 0,
            }])
            .select()
            .single();

        if (error) throw new Error('account_create_failed');
        return data as Driver;
    }

    static async uploadDocument(
        driverId: string,
        file: { uri: string; type: string; name: string },
        bucket: string
    ): Promise<string> {
        const fileExt = file.name.split('.').pop();
        const fileName = `${driverId}/${bucket}_${Date.now()}.${fileExt}`;

        const formData = new FormData();
        formData.append('file', {
            uri: file.uri,
            type: file.type,
            name: file.name,
        } as any);

        const { data, error } = await supabase.storage
            .from('driver-documents')
            .upload(fileName, formData, { upsert: true });

        if (error) throw new Error('Upload failed: ' + error.message);

        const { data: urlData } = supabase.storage
            .from('driver-documents')
            .getPublicUrl(fileName);

        return urlData.publicUrl;
    }

    static async submitDocuments(
        driverId: string,
        docs: {
            name?: string;
            avatar?: string;
            vehicle_category?: 'taxi' | 'logistics';
            vehicle_type?: string;
            vehicle_number?: string;
            pan_url?: string;
            pan_number?: string;
            aadhaar_url?: string;
            aadhaar_number?: string;
            license_url?: string;
            license_number?: string;
        },
        updateStatusToPending: boolean = true
    ): Promise<void> {
        const updatePayload: any = {
            ...docs,
            is_driver: true,
        };

        if (updateStatusToPending) {
            updatePayload.rider_status = 'pending';
        }

        const { error } = await supabase
            .from('users')
            .update(updatePayload)
            .eq('id', driverId);

        if (error) throw new Error('Failed to submit documents');
    }
}
