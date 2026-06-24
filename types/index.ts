export interface Driver {
    id: string;
    phone: string;
    name: string;
    email?: string;
    avatar?: string;
    is_driver: boolean;
    rider_status: 'unsubmitted' | 'pending' | 'verified' | 'rejected';
    vehicle_type?: string;
    vehicle_number?: string;
    vehicle_category?: 'taxi' | 'logistics';
    pan_url?: string;
    pan_number?: string;
    aadhaar_url?: string;
    aadhaar_number?: string;
    license_url?: string;
    license_number?: string;
    is_online: boolean;
    current_lat?: number;
    current_lng?: number;
    rating: number;
    driver_rating: number;
    passenger_rating: number;
    total_rides: number;
    total_spent: number;
    google_id?: string;
    created_at: string;
    updated_at: string;
}

export type ServiceType =
    | 'taxi_bike'
    | 'taxi_auto'
    | 'taxi_car'
    | 'log_bike'
    | 'log_mini_truck'
    | 'log_truck'
    | 'parcel'
    | 'bike_taxi'
    | 'custom';

export interface Location {
    address: string;
    latitude: number;
    longitude: number;
    place_id?: string;
    formatted_address?: string | null;
    city?: string | null;
    state?: string | null;
}

export interface Ride {
    id: string;
    user_id: string;
    service_type: ServiceType;
    pickup_location: Location;
    drop_location: Location;
    pickup_address: string;
    drop_address: string;
    distance_km: number;
    fare: number;
    base_fare?: number;
    distance_fare?: number;
    waiting_charge?: number;
    status: 'pending' | 'accepted' | 'picked_up' | 'on_ride' | 'completed' | 'cancelled';
    driver_id?: string;
    details?: string;
    is_reviewed?: boolean;
    cancel_reason?: string;
    otp_code?: string;
    // Parcel / logistics fields
    sender_phone?: string;
    receiver_phone?: string;
    // Multi-stop
    is_multi_stop?: boolean;
    stop_count?: number;
    created_at: string;
    updated_at: string;
    user?: {
        phone: string;
        name: string;
    };
}

export interface DriverEarning {
    id: string;
    driver_id: string;
    ride_id: string;
    amount: number;
    created_at: string;
    ride?: Ride;
}

export type VehicleCategory = 'taxi' | 'logistics';
export type TaxiVehicleType = 'bike' | 'auto' | 'cab';
export type LogisticsVehicleType = 'bike' | 'mini_van' | 'truck';

export interface Message {
    id: string;
    ride_id: string;
    sender_id: string;
    sender_role: 'driver' | 'customer';
    message: string;
    is_read: boolean;
    created_at: string;
}

export interface Notification {
    id: string;
    user_id: string;
    title: string;
    description: string;
    type?: string;
    is_read: boolean;
    created_at: string;
}

export interface Review {
    id: string;
    ride_id: string;
    user_id: string;
    driver_id?: string;
    rating: number;
    comment?: string;
    review_target: 'driver' | 'passenger';
    created_at: string;
}

export interface RideStop {
    id: string;
    ride_id: string;
    seq: number;
    stop_type: 'pickup' | 'drop';
    address: string;
    latitude: number;
    longitude: number;
    contact_phone?: string;
    note?: string;
    status: 'pending' | 'arrived' | 'completed' | 'skipped';
    arrived_at?: string;
    completed_at?: string;
    free_wait_seconds: number;
    waiting_seconds: number;
    waiting_charge: number;
    leg_distance_km: number;
    created_at: string;
    updated_at: string;
}

export interface SosAlert {
    id: string;
    ride_id?: string;
    triggered_by: string;
    lat?: number;
    lng?: number;
    message?: string;
    status: 'active' | 'resolved';
    triggered_at: string;
    resolved_at?: string;
    resolved_by?: string;
}

export interface DriverPlatformFee {
    id: string;
    user_id: string;
    amount: number;
    payment_date: string;
    collected_by?: string;
    payment_note?: string;
    status: string;
}
