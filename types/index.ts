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
    total_rides: number;
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
    status: 'pending' | 'accepted' | 'picked_up' | 'on_ride' | 'completed' | 'cancelled';
    driver_id?: string;
    details?: string;
    is_reviewed?: boolean;
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
