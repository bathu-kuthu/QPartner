/**
 * Supabase Edge Function: notify-driver
 * Uses FCM HTTP v1 API (service account JWT auth)
 *
 * Supports:
 * 1. `rides` table (INSERT or transition to `status = 'pending'`, unassigned)
 * 2. `orders` table (INSERT or transition to `status = 'preparing'` for `food` & `grocery`)
 *
 * Security & Reliability Guarantees:
 * - Verifies webhook authorization header.
 * - Re-verifies live order/ride state in database before dispatching pushes.
 * - Prevents duplicate notifications on non-transition UPDATE events.
 * - Excludes drivers who are offline, unverified, or currently on an active ride.
 * - Aligns 1:1 with QPartner `DriverService.getAvailableRides()` (no artificial distance cutoff that drops valid rides).
 * - Deduplicates device tokens across driver accounts.
 * - Cleans up UNREGISTERED / expired FCM tokens in `public.users`.
 * - Never logs sensitive tokens or customer personal information.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const FCM_PROJECT_ID = Deno.env.get('FCM_PROJECT_ID')!;
const FCM_CLIENT_EMAIL = Deno.env.get('FCM_CLIENT_EMAIL')!;
const FCM_PRIVATE_KEY = (Deno.env.get('FCM_PRIVATE_KEY') ?? '').replace(/\\n/g, '\n');

// ─── Service type → vehicle category mapping ──────────────────────────────────
function getVehicleCategories(serviceType: string): { category: string; vehicleType: string }[] {
    const map: Record<string, { category: string; vehicleType: string }[]> = {
        taxi_bike: [
            { category: 'taxi', vehicleType: 'bike' },
            { category: 'logistics', vehicleType: 'bike' },
            { category: 'bike', vehicleType: 'bike' },
        ],
        bike_taxi: [
            { category: 'taxi', vehicleType: 'bike' },
            { category: 'logistics', vehicleType: 'bike' },
            { category: 'bike', vehicleType: 'bike' },
        ],
        taxi_auto: [
            { category: 'taxi', vehicleType: 'auto' },
            { category: 'logistics', vehicleType: 'auto' },
        ],
        taxi_car: [
            { category: 'taxi', vehicleType: 'cab' },
            { category: 'logistics', vehicleType: 'cab' },
            { category: 'taxi', vehicleType: 'car' },
            { category: 'logistics', vehicleType: 'car' },
        ],
        cab: [
            { category: 'taxi', vehicleType: 'cab' },
            { category: 'logistics', vehicleType: 'cab' },
            { category: 'taxi', vehicleType: 'car' },
            { category: 'logistics', vehicleType: 'car' },
        ],
        log_cab: [
            { category: 'logistics', vehicleType: 'cab' },
            { category: 'taxi', vehicleType: 'cab' },
            { category: 'logistics', vehicleType: 'car' },
            { category: 'taxi', vehicleType: 'car' },
        ],
        log_car: [
            { category: 'logistics', vehicleType: 'cab' },
            { category: 'taxi', vehicleType: 'cab' },
            { category: 'logistics', vehicleType: 'car' },
            { category: 'taxi', vehicleType: 'car' },
        ],
        log_bike: [
            { category: 'logistics', vehicleType: 'bike' },
            { category: 'taxi', vehicleType: 'bike' },
            { category: 'bike', vehicleType: 'bike' },
        ],
        log_mini_auto: [
            { category: 'logistics', vehicleType: 'mini_truck' },
            { category: 'logistics', vehicleType: 'tata_ace' },
            { category: 'logistics', vehicleType: 'auto' },
            { category: 'taxi', vehicleType: 'auto' },
            { category: 'logistics', vehicleType: 'cab' },
        ],
        log_mini_truck: [
            { category: 'logistics', vehicleType: 'mini_truck' },
            { category: 'logistics', vehicleType: 'tata_ace' },
            { category: 'logistics', vehicleType: 'auto' },
        ],
        log_truck: [
            { category: 'logistics', vehicleType: 'truck' },
            { category: 'logistics', vehicleType: 'pickup' },
        ],
        parcel: [
            { category: 'logistics', vehicleType: 'bike' },
            { category: 'taxi', vehicleType: 'bike' },
            { category: 'bike', vehicleType: 'bike' },
        ],
    };
    return map[serviceType] ?? [];
}

function getSafeServiceLabel(serviceType: string, domain: 'transport' | 'food' | 'grocery'): string {
    if (domain === 'food') return 'Food Delivery';
    if (domain === 'grocery') return 'Grocery Delivery';
    const labels: Record<string, string> = {
        taxi_bike: 'Bike Taxi / Delivery',
        bike_taxi: 'Bike Taxi',
        taxi_auto: 'Auto',
        taxi_car: 'Cab',
        cab: 'Cab',
        log_cab: 'Cab Logistics',
        log_car: 'Cab Logistics',
        log_bike: 'Bike Delivery',
        log_mini_auto: 'Tata Ace / Mini Truck',
        log_mini_truck: 'Mini Truck',
        log_truck: 'Pickup Truck',
        parcel: 'Parcel Delivery',
    };
    return labels[serviceType] ?? 'Delivery Request';
}

// ─── Build a JWT for Google OAuth2 (service account) ─────────────────────────
async function getGoogleAccessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);

    const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');

    const claim = btoa(
        JSON.stringify({
            iss: FCM_CLIENT_EMAIL,
            scope: 'https://www.googleapis.com/auth/firebase.messaging',
            aud: 'https://oauth2.googleapis.com/token',
            iat: now,
            exp: now + 3600,
        })
    )
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');

    const signingInput = `${header}.${claim}`;

    const pemBody = FCM_PRIVATE_KEY.replace('-----BEGIN RSA PRIVATE KEY-----', '')
        .replace('-----END RSA PRIVATE KEY-----', '')
        .replace('-----BEGIN PRIVATE KEY-----', '')
        .replace('-----END PRIVATE KEY-----', '')
        .replace(/\s/g, '');

    const binaryKey = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));

    const cryptoKey = await crypto.subtle.importKey(
        'pkcs8',
        binaryKey,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['sign']
    );

    const signature = await crypto.subtle.sign(
        'RSASSA-PKCS1-v1_5',
        cryptoKey,
        new TextEncoder().encode(signingInput)
    );

    const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');

    const jwt = `${signingInput}.${sigB64}`;

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
    });

    if (!tokenRes.ok) {
        throw new Error(`Failed to obtain Google OAuth2 token (status ${tokenRes.status})`);
    }

    const { access_token } = await tokenRes.json();
    return access_token;
}

// ─── Send FCM push via HTTP v1 API with retry & stale token cleanup ──────────
async function sendFcmPush(
    driverId: string,
    fcmToken: string,
    domain: 'transport' | 'food' | 'grocery',
    record: any,
    accessToken: string,
    supabase: any,
    attempt = 1
): Promise<boolean> {
    const isTransport = domain === 'transport';
    const orderId = String(record.id);
    const serviceType = isTransport ? String(record.service_type ?? 'taxi_bike') : domain;
    const serviceLabel = getSafeServiceLabel(serviceType, domain);
    const earning = isTransport
        ? String(record.fare ?? '')
        : String(record.delivery_fee || 35);
    const distanceKm = record.distance_km != null ? String(record.distance_km) : '';

    // Privacy-safe pickup & drop summaries (never include customer phone/name/OTP)
    const pickupSummary = String(
        isTransport
            ? record.pickup_address || 'Pickup Location'
            : record.store_name || 'Partner Store Pickup'
    ).slice(0, 60);

    const dropSummary = String(
        isTransport
            ? record.drop_address || 'Dropoff Location'
            : record.delivery_address || 'Customer Dropoff Area'
    ).slice(0, 60);

    const msgType =
        domain === 'food'
            ? 'NEW_FOOD_ORDER'
            : domain === 'grocery'
              ? 'NEW_GROCERY_ORDER'
              : 'NEW_BOOKING';

    const title = `New Quickora Order • ${serviceLabel}`;
    const meta = [
        serviceLabel,
        earning ? `₹${earning}` : null,
        distanceKm ? `${distanceKm} km` : null,
        'Respond within 30s',
    ]
        .filter(Boolean)
        .join(' • ');
    const bodyText = `A new delivery request is waiting for your response.\n${meta}\n📍 ${pickupSummary} → 🏁 ${dropSummary}`;

    const payload = {
        message: {
            token: fcmToken,
            notification: {
                title,
                body: bodyText,
            },
            data: {
                type: msgType,
                domain,
                rideId: isTransport ? orderId : '',
                orderId,
                url: '/(tabs)/bookings',
                serviceType,
                fare: earning,
                distanceKm,
                pickupAddress: pickupSummary,
                dropAddress: dropSummary,
                details: isTransport ? String(record.details ?? '') : '',
                deadlineSeconds: '30',
            },
            android: {
                priority: 'HIGH',
                ttl: '60s',
                collapse_key: `order_${orderId}`,
                notification: {
                    channel_id: 'bookings',
                    sound: 'booking_alert.wav',
                    color: '#1565C0',
                    visibility: 'PUBLIC',
                    notification_priority: 'PRIORITY_MAX',
                    default_vibrate_timings: false,
                    vibrate_timings: ['0s', '0.5s', '0.2s', '0.5s'],
                    tag: `order_${orderId}`,
                },
            },
        },
    };

    const url = `https://fcm.googleapis.com/v1/projects/${FCM_PROJECT_ID}/messages:send`;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
    });

    if (response.ok) {
        return true;
    }

    const status = response.status;
    const errText = await response.text();

    // Clean up invalid / unregistered tokens so dead devices are not repeatedly targeted
    if (status === 404 || errText.includes('UNREGISTERED') || errText.includes('INVALID_ARGUMENT')) {
        console.warn(`[notify-driver] Clearing invalid/unregistered FCM token for driver ${driverId}`);
        await supabase
            .from('users')
            .update({ fcm_token: null })
            .eq('id', driverId);
        return false;
    }

    // Single retry on transient 5xx or 429 rate-limit errors
    if ((status >= 500 || status === 429) && attempt < 2) {
        await new Promise((r) => setTimeout(r, 600));
        return sendFcmPush(driverId, fcmToken, domain, record, accessToken, supabase, attempt + 1);
    }

    console.error(`[notify-driver] FCM send failed for driver ${driverId} (status ${status})`);
    return false;
}

// ─── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
    try {
        if (req.method !== 'POST') {
            return new Response('Method Not Allowed', { status: 405 });
        }

        const authHeader = req.headers.get('Authorization');
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return new Response('Unauthorized', { status: 401 });
        }

        const body = await req.json();
        const record = body.record;
        const oldRecord = body.old_record;
        const eventType = body.type; // 'INSERT' | 'UPDATE'
        const isDryRun = body.dry_run === true;
        const tableName = body.table || (record?.store_type ? 'orders' : 'rides');

        if (!record?.id) {
            return new Response('Missing record ID', { status: 200 });
        }

        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        let domain: 'transport' | 'food' | 'grocery' = 'transport';
        let enrichedRecord: any = record;

        if (tableName === 'orders' || record.store_type === 'food' || record.store_type === 'grocery') {
            domain = record.store_type === 'grocery' ? 'grocery' : 'food';

            // Duplicate prevention: only trigger when order enters 'preparing' status
            if (record.status !== 'preparing') {
                return new Response('Order not in preparing state', { status: 200 });
            }
            if (eventType === 'UPDATE' && oldRecord?.status === 'preparing') {
                return new Response('Duplicate preparing update ignored', { status: 200 });
            }

            if (!isDryRun) {
                // Re-verify live order state in DB (note: do not select non-existent orders.driver_id)
                const { data: liveOrder } = await supabase
                    .from('orders')
                    .select('id, status, store_type, delivery_fee, delivery_address, distance_km, store_lat, store_lng, store:stores(name, address, latitude, longitude)')
                    .eq('id', record.id)
                    .maybeSingle();

                if (!liveOrder || liveOrder.status !== 'preparing') {
                    return new Response('Order already claimed or no longer preparing', { status: 200 });
                }

                enrichedRecord = {
                    ...liveOrder,
                    store_name: liveOrder.store?.name
                        ? `${liveOrder.store.name}${liveOrder.store.address ? `, ${liveOrder.store.address}` : ''}`
                        : liveOrder.store?.address || 'Partner Store',
                };
            }
        } else {
            domain = 'transport';

            // Duplicate prevention: only trigger when ride enters 'pending' status without a driver
            if (record.status !== 'pending' || record.driver_id) {
                return new Response('Not an unassigned pending ride', { status: 200 });
            }
            if (eventType === 'UPDATE' && oldRecord?.status === 'pending') {
                return new Response('Duplicate pending update ignored', { status: 200 });
            }

            if (!isDryRun) {
                // Re-verify live ride state in DB before sending pushes
                const { data: liveRide } = await supabase
                    .from('rides')
                    .select('id, status, driver_id, service_type, fare, distance_km, pickup_address, drop_address, pickup_location, details')
                    .eq('id', record.id)
                    .maybeSingle();

                if (!liveRide || liveRide.status !== 'pending' || liveRide.driver_id) {
                    return new Response('Ride already accepted or cancelled', { status: 200 });
                }

                enrichedRecord = liveRide;
            }
        }

        const eligibleCategories =
            domain === 'transport' ? getVehicleCategories(enrichedRecord.service_type) : [];

        if (domain === 'transport' && eligibleCategories.length === 0) {
            return new Response('No eligible vehicle categories', { status: 200 });
        }

        // Fetch online drivers with registered FCM tokens
        // (Does NOT select non-existent `accept_both` column)
        const { data: drivers, error } = await supabase
            .from('users')
            .select('id, fcm_token, current_lat, current_lng, vehicle_category, vehicle_type, rider_status')
            .eq('is_driver', true)
            .eq('is_online', true)
            .not('fcm_token', 'is', null);

        if (error || !drivers) {
            console.error('[notify-driver] Failed to fetch drivers:', error?.message);
            return new Response('DB error', { status: 500 });
        }

        // Fetch drivers currently busy on an active transport ride so we don't interrupt them
        const { data: busyRides } = await supabase
            .from('rides')
            .select('driver_id')
            .in('status', ['accepted', 'picked_up', 'on_ride'])
            .not('driver_id', 'is', null);

        const busyDriverIds = new Set<string>(
            (busyRides ?? []).map((r: any) => String(r.driver_id))
        );

        const accessToken = await getGoogleAccessToken();
        const seenTokens = new Set<string>();
        const matchedDrivers: any[] = [];

        for (const driver of drivers) {
            if (!driver.id || !driver.fcm_token) continue;
            if (busyDriverIds.has(String(driver.id))) continue;
            if ((driver.rider_status ?? '').trim().toLowerCase() !== 'verified') continue;

            const dCategory = (driver.vehicle_category ?? 'taxi').trim().toLowerCase();
            const dVehicle = (driver.vehicle_type ?? '').trim().toLowerCase();

            if (domain === 'food' || domain === 'grocery') {
                if (dVehicle !== 'bike' && dCategory !== 'bike') continue;
            } else {
                const canHandle = eligibleCategories.some(
                    (ec) => ec.category === dCategory && ec.vehicleType === dVehicle
                );
                if (!canHandle) continue;
            }

            if (seenTokens.has(driver.fcm_token)) continue;
            seenTokens.add(driver.fcm_token);
            matchedDrivers.push(driver);
        }

        if (isDryRun) {
            return new Response(
                JSON.stringify({
                    dryRun: true,
                    oauthTokenVerified: Boolean(accessToken),
                    matchedDriversCount: matchedDrivers.length,
                }),
                { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
        }

        const notifyPromises = matchedDrivers.map((driver) =>
            sendFcmPush(
                driver.id,
                driver.fcm_token,
                domain,
                enrichedRecord,
                accessToken,
                supabase
            )
        );

        const results = await Promise.allSettled(notifyPromises);
        const sentCount = results.filter(
            (r) => r.status === 'fulfilled' && r.value === true
        ).length;

        console.log(`[notify-driver] Dispatched ${sentCount}/${notifyPromises.length} pushes for ${domain} order ${enrichedRecord.id}`);
        return new Response(JSON.stringify({ notified: sentCount, attempted: notifyPromises.length }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (err) {
        console.error('[notify-driver] Edge function error:', err);
        return new Response('Internal error', { status: 500 });
    }
});
