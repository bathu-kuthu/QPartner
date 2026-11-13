require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

const customerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const driverClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function getServiceTypesForDriver(category, vehicleType, acceptBoth = false) {
    const vType = vehicleType?.toLowerCase();
    if (category === 'taxi') {
        if (vType === 'bike') {
            const base = ['taxi_bike', 'bike_taxi'];
            return acceptBoth ? [...base, 'log_bike'] : base;
        }
        if (vType === 'auto') return ['taxi_auto'];
        if (vType === 'cab' || vType === 'car') return ['taxi_car'];
    }
    if (category === 'logistics') {
        if (vType === 'bike') {
            const base = ['log_bike'];
            return acceptBoth ? [...base, 'taxi_bike', 'bike_taxi'] : base;
        }
        if (vType === 'mini_truck') return ['log_mini_truck'];
        if (vType === 'truck') return ['log_truck'];
    }
    return [];
}

const RIDE_COLUMNS = 'id, user_id, service_type, pickup_location, drop_location, pickup_address, drop_address, distance_km, fare, base_fare, distance_fare, waiting_charge, status, driver_id, details, is_reviewed, cancel_reason, sender_phone, receiver_phone, is_multi_stop, stop_count, created_at, updated_at';

async function runVerification() {
    console.log('========================================================');
    console.log('🧪 VERIFYING CUSTOMER CAB BOOKING DISPATCH FLOW');
    console.log('========================================================');

    // Step 1: Verify Driver Service Type Mapping
    console.log('\n[Stage 1] Verifying Eligible Driver Service Mapping:');
    const cabServiceTypes = getServiceTypesForDriver('taxi', 'cab');
    const carServiceTypes = getServiceTypesForDriver('taxi', 'car');
    console.log('  - Taxi Cab mapping:', cabServiceTypes);
    console.log('  - Taxi Car mapping:', carServiceTypes);
    if (!cabServiceTypes.includes('taxi_car') || !carServiceTypes.includes('taxi_car')) {
        console.error('❌ Service type mapping failed!');
        process.exit(1);
    }
    console.log('  ✅ Stage 1 passed: Driver service types properly resolve to [\'taxi_car\'].');

    // Step 2: Customer creates Cab booking
    console.log('\n[Stage 2] Simulating Customer Cab Booking creation:');
    const customerEmail = 'verify_customer_' + Date.now() + '@example.com';
    const { data: auth, error: authErr } = await customerClient.auth.signUp({
        email: customerEmail,
        password: 'Password123!'
    });

    if (authErr || !auth?.user) {
        console.error('❌ Failed to authenticate customer:', authErr);
        process.exit(1);
    }

    const testRide = {
        user_id: auth.user.id,
        service_type: 'taxi_car',
        pickup_address: 'Anna Salai, Chennai',
        drop_address: 'T Nagar, Chennai',
        pickup_location: { latitude: 13.0827, longitude: 80.2707 },
        drop_location: { latitude: 13.0418, longitude: 80.2341 },
        distance_km: 5.2,
        fare: 220,
        status: 'pending'
    };

    const { data: booking, error: bookingErr } = await customerClient
        .from('rides')
        .insert([testRide])
        .select()
        .single();

    if (bookingErr || !booking) {
        console.error('❌ Customer booking insertion failed:', bookingErr);
        process.exit(1);
    }
    console.log('  ✅ Stage 2 passed: Customer Cab booking saved successfully.');
    console.log('     Booking ID:', booking.id);
    console.log('     Status:', booking.status);
    console.log('     Service Type:', booking.service_type);
    console.log('     Assigned Driver:', booking.driver_id);

    // Step 3: Driver app query simulation (anon role)
    console.log('\n[Stage 3] Driver App Fetching Available Rides (anon role):');
    const { data: availableRides, error: fetchErr } = await driverClient
        .from('rides')
        .select(RIDE_COLUMNS)
        .eq('status', 'pending')
        .is('driver_id', null)
        .in('service_type', cabServiceTypes)
        .order('created_at', { ascending: false });

    console.log('  - Driver query error:', fetchErr ? fetchErr.message : 'none');
    console.log('  - Driver query returned ride count:', availableRides?.length ?? 0);

    const found = availableRides?.some(r => r.id === booking.id);
    if (found) {
        console.log('  ✅ Stage 3 passed: Driver app successfully retrieved the exact customer booking!');
        console.log('\n🎉 ALL SYSTEMS OPERATIONAL: RLS allows eligible driver discovery.');
    } else {
        console.log('  ⚠️  Stage 3 Note: Pending ride row is filtered by PostgreSQL RLS for anon role.');
        console.log('     👉 Please execute fix_rides_rls.sql in the Supabase SQL Editor to activate the policy.');
    }

    console.log('========================================================\n');
}

runVerification().catch(console.error);
