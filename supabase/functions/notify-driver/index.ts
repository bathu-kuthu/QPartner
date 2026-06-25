/**
 * Supabase Edge Function: notify-driver
 * Uses FCM HTTP v1 API (service account JWT auth — Legacy API is shut down)
 *
 * SETUP:
 * 1. Deploy: supabase functions deploy notify-driver
 * 2. Set secrets:
 *    supabase secrets set FCM_PROJECT_ID=your_project_id
 *    supabase secrets set FCM_CLIENT_EMAIL=firebase-adminsdk-xxx@your-project.iam.gserviceaccount.com
 *    supabase secrets set FCM_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----\n"
 * 3. Create a Database Webhook in Supabase Dashboard:
 *    - Table: rides
 *    - Event: INSERT
 *    - URL: https://<your-project>.supabase.co/functions/v1/notify-driver
 *    - HTTP Method: POST
 *    - Header: Authorization: Bearer <your-service-role-key>
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const FCM_PROJECT_ID = Deno.env.get('FCM_PROJECT_ID')!;
const FCM_CLIENT_EMAIL = Deno.env.get('FCM_CLIENT_EMAIL')!;
const FCM_PRIVATE_KEY = Deno.env.get('FCM_PRIVATE_KEY')!.replace(/\\n/g, '\n');

// ─── Haversine distance (km) ──────────────────────────────────────────────────
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Service type → vehicle category mapping ──────────────────────────────────
function getVehicleCategories(serviceType: string): { category: string; vehicleType: string }[] {
    const map: Record<string, { category: string; vehicleType: string }[]> = {
        taxi_bike: [{ category: 'taxi', vehicleType: 'bike' }],
        bike_taxi: [{ category: 'taxi', vehicleType: 'bike' }],
        taxi_auto: [{ category: 'taxi', vehicleType: 'auto' }],
        taxi_car: [{ category: 'taxi', vehicleType: 'cab' }],
        log_bike: [{ category: 'logistics', vehicleType: 'bike' }, { category: 'taxi', vehicleType: 'bike' }],
        log_mini_truck: [{ category: 'logistics', vehicleType: 'mini_truck' }],
        log_truck: [{ category: 'logistics', vehicleType: 'truck' }],
        parcel: [{ category: 'logistics', vehicleType: 'bike' }],
    };
    return map[serviceType] ?? [];
}

// ─── Build a JWT for Google OAuth2 (service account) ─────────────────────────
async function getGoogleAccessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);

    // JWT Header
    const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
        .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

    // JWT Claim set
    const claim = btoa(JSON.stringify({
        iss: FCM_CLIENT_EMAIL,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
    })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

    const signingInput = `${header}.${claim}`;

    // Import the RSA private key
    const pemBody = FCM_PRIVATE_KEY
        .replace('-----BEGIN RSA PRIVATE KEY-----', '')
        .replace('-----END RSA PRIVATE KEY-----', '')
        .replace('-----BEGIN PRIVATE KEY-----', '')
        .replace('-----END PRIVATE KEY-----', '')
        .replace(/\s/g, '');

    const binaryKey = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));

    const cryptoKey = await crypto.subtle.importKey(
        'pkcs8',
        binaryKey,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['sign']
    );

    // Sign
    const signature = await crypto.subtle.sign(
        'RSASSA-PKCS1-v1_5',
        cryptoKey,
        new TextEncoder().encode(signingInput)
    );

    const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
        .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

    const jwt = `${signingInput}.${sigB64}`;

    // Exchange JWT for access token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
    });

    if (!tokenRes.ok) {
        const err = await tokenRes.text();
        throw new Error(`Failed to get Google access token: ${err}`);
    }

    const { access_token } = await tokenRes.json();
    return access_token;
}

// ─── Send FCM push via HTTP v1 API ────────────────────────────────────────────
async function sendFcmPush(fcmToken: string, ride: any, accessToken: string): Promise<void> {
    const serviceLabel = (ride.service_type ?? 'RIDE').replace(/_/g, ' ').toUpperCase();

    const payload = {
        message: {
            token: fcmToken,
            // Notification block: shown by OS when app is background/killed
            notification: {
                title: '🚖 New Booking Request!',
                body: `${serviceLabel} • ₹${ride.fare} • ${ride.distance_km}km`,
            },
            // Data block: received by JS background handler
            data: {
                type: 'NEW_BOOKING',
                rideId: String(ride.id),
                serviceType: ride.service_type ?? '',
                fare: String(ride.fare ?? ''),
                distanceKm: String(ride.distance_km ?? ''),
                pickupAddress: ride.pickup_address ?? '',
                dropAddress: ride.drop_address ?? '',
                pickupLat: String(ride.pickup_location?.latitude ?? ''),
                pickupLng: String(ride.pickup_location?.longitude ?? ''),
                dropLat: String(ride.drop_location?.latitude ?? ''),
                dropLng: String(ride.drop_location?.longitude ?? ''),
                details: ride.details ?? '',
            },
            // Android specific config
            android: {
                priority: 'HIGH',
                notification: {
                    channel_id: 'bookings',         // Must match channel created in app
                    sound: 'booking_alert',
                    notification_priority: 'PRIORITY_MAX',
                    visibility: 'PUBLIC',
                    vibrate_timings_millis: ['0', '500', '200', '500', '200', '500'],
                    default_vibrate_timings: false,
                    tag: `ride_${ride.id}`,         // Replaces previous notification for same ride
                    click_action: 'OPEN_ACTIVITY',
                    color: '#1565C0',
                    icon: 'ic_notification',
                },
            },
        },
    };

    const url = `https://fcm.googleapis.com/v1/projects/${FCM_PROJECT_ID}/messages:send`;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        const err = await response.text();
        console.error(`FCM v1 send failed for token ${fcmToken.slice(0, 20)}...:`, err);
    } else {
        const result = await response.json();
        console.log(`FCM v1 sent OK:`, result.name);
    }
}

// ─── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
    try {
        if (req.method !== 'POST') {
            return new Response('Method Not Allowed', { status: 405 });
        }

        const body = await req.json();
        const ride = body.record;

        if (!ride || ride.status !== 'pending') {
            return new Response('Not a pending ride', { status: 200 });
        }

        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        const eligibleCategories = getVehicleCategories(ride.service_type);
        if (eligibleCategories.length === 0) {
            return new Response('No eligible vehicle categories', { status: 200 });
        }

        // Fetch online verified drivers with FCM tokens
        const { data: drivers, error } = await supabase
            .from('users')
            .select('id, fcm_token, current_lat, current_lng, vehicle_category, vehicle_type, accept_both')
            .eq('is_driver', true)
            .eq('is_online', true)
            .eq('rider_status', 'verified')
            .not('fcm_token', 'is', null);

        if (error || !drivers) {
            console.error('Failed to fetch drivers:', error);
            return new Response('DB error', { status: 500 });
        }

        const pickupLat = ride.pickup_location?.latitude;
        const pickupLng = ride.pickup_location?.longitude;
        const MAX_RADIUS_KM = 10;

        // Get Google access token once — reuse for all sends in this invocation
        const accessToken = await getGoogleAccessToken();

        const notifyPromises: Promise<void>[] = [];

        for (const driver of drivers) {
            const canHandle = eligibleCategories.some(
                (ec) => ec.category === driver.vehicle_category && ec.vehicleType === driver.vehicle_type
            ) || (driver.accept_both && (
                ride.service_type === 'log_bike' ||
                ride.service_type === 'taxi_bike' ||
                ride.service_type === 'bike_taxi'
            ));

            if (!canHandle) continue;

            if (pickupLat && pickupLng && driver.current_lat && driver.current_lng) {
                const dist = haversineKm(driver.current_lat, driver.current_lng, pickupLat, pickupLng);
                if (dist > MAX_RADIUS_KM) continue;
            }

            if (driver.fcm_token) {
                notifyPromises.push(sendFcmPush(driver.fcm_token, ride, accessToken));
            }
        }

        await Promise.allSettled(notifyPromises);

        console.log(`Notified ${notifyPromises.length} drivers for ride ${ride.id}`);
        return new Response(JSON.stringify({ notified: notifyPromises.length }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (err) {
        console.error('Edge function error:', err);
        return new Response('Internal error', { status: 500 });
    }
});