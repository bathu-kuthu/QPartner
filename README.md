# Quickora Driver App

React Native (Expo SDK 54 + TypeScript) driver-side app for the Quickora taxi & logistics platform.

---

## Setup

```bash
# 1. Copy this folder into your blank Expo SDK 54 project
# 2. Install dependencies
npm install

# 3. Copy your font files (from the customer app) into assets/fonts/
#    Required: Satoshi-Regular.otf, Satoshi-Medium.otf, Satoshi-Bold.otf, Satoshi-Black.otf

# 4. Start
npx expo start
```

---

## App Flow

```
Launch
  └── Splash (index.tsx)
        ├── No session → Login
        │     └── OTP → New user → Register → Onboarding
        │                         Existing → Onboarding (if unsubmitted)
        │                                    Bookings  (if verified)
        │
        └── Session exists
              ├── rider_status: unsubmitted → Onboarding (select vehicle)
              ├── rider_status: pending     → Pending screen
              ├── rider_status: rejected    → Rejected + re-submit
              └── rider_status: verified    → Bookings tab
```

---

## Screens

### Auth
| File | Screen |
|------|--------|
| `(auth)/login.tsx` | Phone number entry |
| `(auth)/otp.tsx` | 6-digit OTP verification |
| `(auth)/register.tsx` | Name input for new drivers |
| `(auth)/onboarding.tsx` | Vehicle category + type selection / pending state |
| `(auth)/documents.tsx` | Upload Aadhaar, PAN, Driving Licence + vehicle number |

### Main Tabs (only for verified drivers)
| File | Screen |
|------|--------|
| `(tabs)/bookings.tsx` | Online/offline toggle, shows 1 pending ride at a time |
| `(tabs)/history.tsx` | Completed & cancelled ride history with earnings |
| `(tabs)/profile.tsx` | Earnings, stats, documents, help, logout |

### Active Ride
| File | Screen |
|------|--------|
| `active-ride/[id].tsx` | Full-screen ride management — back button BLOCKED until complete |

---

## Key Business Rules Implemented

1. **One booking at a time** — `acceptRide()` checks for existing active rides before accepting
2. **Show only 1 pending ride** — `availableRides.slice(0, 1)` in bookings screen
3. **App locked during active ride** — `BackHandler` blocks hardware back, no tab navigation
4. **Unverified drivers blocked** — Tab layout redirects to onboarding if `rider_status !== 'verified'`
5. **Realtime updates** — Supabase realtime channels for new bookings + ride status changes
6. **Driver earnings** — 80% of fare, recorded in `driver_earnings` table on completion

---

## Supabase Requirements

### Storage Bucket
Create a bucket called `driver-documents` (public read, authenticated write):
```sql
INSERT INTO storage.buckets (id, name, public) VALUES ('driver-documents', 'driver-documents', true);
```

### RPC Function for incrementing total_rides
```sql
CREATE OR REPLACE FUNCTION increment_driver_rides(driver_id uuid)
RETURNS void AS $$
  UPDATE public.users
  SET total_rides = total_rides + 1, updated_at = NOW()
  WHERE id = driver_id;
$$ LANGUAGE sql;
```

### RLS Policies needed on `rides` table
```sql
-- Drivers can read pending rides
CREATE POLICY "Drivers read pending rides" ON rides
  FOR SELECT USING (status = 'pending' AND driver_id IS NULL);

-- Drivers can update their own rides
CREATE POLICY "Drivers update own rides" ON rides
  FOR UPDATE USING (driver_id = auth.uid());
```

---

## Demo Credentials
- Any phone number works
- OTP: `123456`

---

## Folder Structure
```
DriverApp/
├── app/
│   ├── _layout.tsx          # Root layout with AuthProvider
│   ├── index.tsx             # Splash/redirect
│   ├── (auth)/
│   │   ├── login.tsx
│   │   ├── otp.tsx
│   │   ├── register.tsx
│   │   ├── onboarding.tsx
│   │   └── documents.tsx
│   ├── (tabs)/
│   │   ├── bookings.tsx      # Main screen
│   │   ├── history.tsx
│   │   └── profile.tsx
│   └── active-ride/
│       └── [id].tsx          # Locked ride screen
├── config/
│   └── supabase.ts
├── constants/
│   └── colors.ts
├── contexts/
│   └── auth-context.tsx
├── services/
│   ├── auth.service.ts
│   └── driver.service.ts
└── types/
    └── index.ts
```
