import { supabase } from '@/config/supabase';
import { Driver } from '@/types';

export class AuthService {
    static async sendOTP(phone: string): Promise<string> {
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
                .eq('phone', phone)
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
                phone, 
                otp: otpCode, 
                driver_id: driverId, 
                expires_at: expiresAt.toISOString() 
            }, { onConflict: 'phone' });

        if (error) {
            console.error('Supabase OTP Error:', error);
            throw new Error('Failed to generate and send OTP: ' + error.message);
        }

        return otpCode;
    }

    static async verifyOTP(phone: string, otp: string): Promise<Driver | null> {
        try {
            // 1. Get an Anonymous Session (Requires Anonymous Sign-ins enabled in Supabase Auth)
            const { data: authData, error: authError } = await supabase.auth.signInAnonymously();
            
            if (authError || !authData?.user) {
                console.error('Anonymous Auth Error:', authError);
                throw new Error('Failed to create secure session. Ensure Anonymous Sign-ins are enabled in Supabase.');
            }

            // 2. Call the secure RPC to verify OTP and link the anonymous auth_id
            const { data: userData, error: rpcError } = await supabase.rpc('secure_driver_login', {
                p_phone: phone,
                p_otp: otp,
                p_auth_id: authData.user.id
            });

            if (rpcError) {
                console.error('RPC Verification Error:', rpcError);
                // Map known errors
                if (rpcError.message.includes('Invalid or expired OTP')) {
                    throw new Error('Invalid or expired OTP');
                }
                throw new Error('Verification failed.');
            }

            return userData as Driver;
        } catch (err: any) {
            throw new Error(err.message || 'Invalid or expired OTP');
        }
    }

    static async createDriver(phone: string, name: string): Promise<Driver> {
        const { data: authData } = await supabase.auth.getSession();
        const authId = authData?.session?.user?.id;

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
                auth_id: authId,
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
