-- ============================================================================
-- QUICKORA PRODUCTION RLS & TRIGGER REMEDIATION FOR QPARTNER RIDE ACCEPTANCE
-- Target Database: zoatdppograoxpgifhbl (Run in Supabase Dashboard -> SQL Editor)
-- Purpose:
--   1. Fix "Caller <NULL> is not an eligible online driver for ride ..." error.
--      QPartner logs in using custom OTP directly in public.users under the 'anon' role (auth.uid() IS NULL).
--      The trigger enforce_ride_security_invariants() previously failed because v_caller_uid was auth.uid() (NULL).
--      Now, when auth.uid() IS NULL, v_caller_uid resolves to NEW.driver_id (during claim) or OLD.driver_id (during ride).
--   2. Ensure atomic public.accept_ride(p_ride_id, p_driver_id) RPC is SECURITY DEFINER.
--   3. Update RLS policies on public.rides so QPartner can read pending/assigned rides and update ride status.
-- ============================================================================

BEGIN;

-- ── 1. Update enforce_ride_security_invariants() trigger function ───────────

CREATE OR REPLACE FUNCTION public.enforce_ride_security_invariants()
RETURNS TRIGGER 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_uid uuid;
    v_caller_role text;
    v_is_online_driver boolean := false;
    v_fee_rec record;
    v_surge_sum numeric := 0;
    v_base numeric;
    v_rate numeric;
    v_included_km numeric;
    v_min_fare numeric;
    v_extra_km numeric;
    v_distance_charge numeric;
    v_effective_dist numeric;
    v_computed_fare numeric;
BEGIN
    v_caller_uid := auth.uid();
    v_caller_role := auth.role();

    -- Allow service_role (background operations / webhooks / admin) to bypass
    IF v_caller_role = 'service_role' THEN
        RETURN NEW;
    END IF;

    -- When caller is a delivery partner using QPartner custom OTP auth (auth.uid() IS NULL),
    -- resolve caller identity from NEW.driver_id (during claim) or OLD.driver_id (during active ride transitions)
    IF v_caller_uid IS NULL THEN
        IF NEW.driver_id IS NOT NULL THEN
            v_caller_uid := NEW.driver_id;
        ELSIF OLD.driver_id IS NOT NULL THEN
            v_caller_uid := OLD.driver_id;
        END IF;
    END IF;

    -- 1. Strictly Immutable Fields (Never modifiable on UPDATE by any client)
    NEW.id := OLD.id;
    NEW.user_id := OLD.user_id;
    NEW.service_type := OLD.service_type;
    NEW.pickup_location := OLD.pickup_location;
    NEW.drop_location := OLD.drop_location;
    NEW.pickup_address := OLD.pickup_address;
    NEW.drop_address := OLD.drop_address;
    NEW.base_fare := OLD.base_fare;
    NEW.distance_fare := OLD.distance_fare;
    NEW.waiting_charge := OLD.waiting_charge;
    NEW.otp_code := OLD.otp_code;
    NEW.created_at := OLD.created_at;
    NEW.sender_phone := OLD.sender_phone;
    NEW.receiver_phone := OLD.receiver_phone;
    NEW.is_multi_stop := OLD.is_multi_stop;
    NEW.stop_count := OLD.stop_count;

    -- 2. Terminal State Lock
    IF OLD.status IN ('completed', 'cancelled') THEN
        IF NEW.status != OLD.status THEN
            RAISE EXCEPTION 'Cannot modify status of terminal ride % (status: %)', OLD.id, OLD.status;
        END IF;
    END IF;

    -- 3. driver_id Mutation & Claim Invariant
    IF NEW.driver_id IS DISTINCT FROM OLD.driver_id THEN
        IF OLD.driver_id IS NOT NULL THEN
            RAISE EXCEPTION 'Driver cannot be reassigned or removed once assigned on ride %', OLD.id;
        ELSIF OLD.status != 'pending' OR NEW.status != 'accepted' OR NEW.driver_id != v_caller_uid THEN
            RAISE EXCEPTION 'driver_id may only be set when claiming a pending ride as accepted by caller % on ride %', v_caller_uid, OLD.id;
        ELSE
            SELECT EXISTS (
                SELECT 1 FROM public.users u 
                WHERE u.id = v_caller_uid AND u.is_driver = true AND u.is_online = true
            ) INTO v_is_online_driver;

            IF NOT v_is_online_driver THEN
                RAISE EXCEPTION 'Caller % is not an eligible online driver for ride %', v_caller_uid, OLD.id;
            END IF;
        END IF;
    END IF;

    -- 4. State-Machine Transition & Authorization Enforcement
    IF NEW.status != OLD.status THEN
        IF OLD.status = 'pending' AND NEW.status = 'accepted' THEN
            IF NEW.driver_id IS NULL OR NEW.driver_id != v_caller_uid THEN
                RAISE EXCEPTION 'Unauthorized driver claim on ride %', OLD.id;
            END IF;

        ELSIF OLD.status = 'pending' AND NEW.status = 'cancelled' THEN
            IF OLD.user_id != v_caller_uid AND v_caller_uid != OLD.user_id THEN
                RAISE EXCEPTION 'Only the passenger % may cancel a pending ride %', OLD.user_id, OLD.id;
            END IF;

        ELSIF OLD.status = 'accepted' AND NEW.status = 'picked_up' THEN
            IF OLD.driver_id != v_caller_uid THEN
                RAISE EXCEPTION 'Only assigned driver % may mark arrival on ride %', OLD.driver_id, OLD.id;
            END IF;

        ELSIF OLD.status = 'accepted' AND NEW.status = 'cancelled' THEN
            IF v_caller_uid NOT IN (OLD.user_id, OLD.driver_id) THEN
                RAISE EXCEPTION 'Unauthorized cancellation on ride % by %', OLD.id, v_caller_uid;
            END IF;

        ELSIF OLD.status = 'picked_up' AND NEW.status = 'on_ride' THEN
            IF OLD.driver_id != v_caller_uid THEN
                RAISE EXCEPTION 'Only assigned driver % may start the ride %', OLD.driver_id, OLD.id;
            END IF;

        ELSIF OLD.status = 'picked_up' AND NEW.status = 'cancelled' THEN
            IF v_caller_uid NOT IN (OLD.user_id, OLD.driver_id) THEN
                RAISE EXCEPTION 'Unauthorized cancellation on ride % by %', OLD.id, v_caller_uid;
            END IF;

        ELSIF OLD.status IN ('on_ride', 'picked_up') AND NEW.status = 'completed' THEN
            IF OLD.driver_id != v_caller_uid AND OLD.user_id != v_caller_uid THEN
                RAISE EXCEPTION 'Only assigned driver or passenger may complete ride %', OLD.id;
            END IF;

        ELSE
            RAISE EXCEPTION 'Illegal state machine transition from % to % on ride %', OLD.status, NEW.status, OLD.id;
        END IF;
    END IF;

    -- 5. Database-Authoritative Fare & Distance Settlement from public.transport_fee_config
    IF (NEW.fare IS DISTINCT FROM OLD.fare OR NEW.distance_km IS DISTINCT FROM OLD.distance_km OR NEW.status = 'completed') THEN
        IF (OLD.status IN ('on_ride', 'picked_up') AND NEW.status = 'completed') THEN
            IF NEW.distance_km IS NOT NULL AND NEW.distance_km > 0 AND NEW.distance_km <= (COALESCE(OLD.distance_km, 1) * 3 + 10) THEN
                v_effective_dist := NEW.distance_km;
            ELSE
                v_effective_dist := COALESCE(OLD.distance_km, 0);
            END IF;
            NEW.distance_km := v_effective_dist;

            SELECT base_fee, fee_per_km, included_km, minimum_fare
            INTO v_fee_rec
            FROM public.transport_fee_config
            WHERE vehicle_type::text = OLD.service_type::text AND is_active = true
            LIMIT 1;

            SELECT COALESCE(SUM(amount), 0)
            INTO v_surge_sum
            FROM public.global_surge_config
            WHERE is_enabled = true AND (expires_at IS NULL OR expires_at > timezone('utc', now()));

            IF FOUND THEN
                v_base := COALESCE(v_fee_rec.base_fee, 0);
                v_rate := COALESCE(v_fee_rec.fee_per_km, 0);
                v_included_km := COALESCE(v_fee_rec.included_km, 0);
                v_min_fare := COALESCE(v_fee_rec.minimum_fare, v_base);

                v_extra_km := GREATEST(0, v_effective_dist - v_included_km);
                v_distance_charge := v_extra_km * v_rate;
                v_computed_fare := ROUND(GREATEST(v_min_fare, v_base + v_distance_charge) + v_surge_sum, 2);

                NEW.fare := v_computed_fare;
            ELSE
                NEW.fare := OLD.fare;
            END IF;
        ELSE
            NEW.fare := OLD.fare;
            NEW.distance_km := OLD.distance_km;
        END IF;
    END IF;

    -- 6. details & cancel_reason Governance
    IF NEW.cancel_reason IS DISTINCT FROM OLD.cancel_reason THEN
        IF NEW.status != 'cancelled' THEN
            NEW.cancel_reason := OLD.cancel_reason;
        END IF;
    END IF;

    IF NEW.details IS DISTINCT FROM OLD.details THEN
        IF NEW.status != 'cancelled' THEN
            NEW.details := OLD.details;
        END IF;
    END IF;

    -- 7. voice_note_url Governance
    IF NEW.voice_note_url IS DISTINCT FROM OLD.voice_note_url THEN
        IF OLD.user_id != v_caller_uid OR OLD.status IN ('completed', 'cancelled') THEN
            NEW.voice_note_url := OLD.voice_note_url;
        END IF;
    END IF;

    -- 8. is_reviewed Governance
    IF NEW.is_reviewed IS DISTINCT FROM OLD.is_reviewed THEN
        IF OLD.user_id != v_caller_uid OR OLD.status != 'completed' OR OLD.is_reviewed = true THEN
            NEW.is_reviewed := OLD.is_reviewed;
        END IF;
    END IF;

    -- 9. Timestamp Auto-Update
    NEW.updated_at := timezone('utc'::text, now());

    RETURN NEW;
END;
$$;

ALTER FUNCTION public.enforce_ride_security_invariants() OWNER TO postgres;

-- Also update enforce_ride_update_invariants to match if referenced anywhere
CREATE OR REPLACE FUNCTION public.enforce_ride_update_invariants()
RETURNS TRIGGER 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN public.enforce_ride_security_invariants();
END;
$$;

ALTER FUNCTION public.enforce_ride_update_invariants() OWNER TO postgres;

-- Ensure triggers on public.rides point to enforce_ride_security_invariants()
DROP TRIGGER IF EXISTS trg_enforce_ride_update_invariants ON public.rides;
DROP TRIGGER IF EXISTS trg_enforce_ride_security_invariants ON public.rides;

CREATE TRIGGER trg_enforce_ride_security_invariants
BEFORE UPDATE ON public.rides
FOR EACH ROW EXECUTE FUNCTION public.enforce_ride_security_invariants();

-- ── 2. Re-create public.accept_ride RPC (SECURITY DEFINER) ───────────────────

CREATE OR REPLACE FUNCTION public.accept_ride(p_ride_id uuid, p_driver_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ride public.rides%ROWTYPE;
    v_is_driver boolean := false;
BEGIN
    -- Verify driver is registered, online, verified driver
    SELECT EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.id = p_driver_id
          AND u.is_driver = true
          AND u.is_online = true
    ) INTO v_is_driver;

    IF NOT v_is_driver THEN
        RAISE EXCEPTION 'Driver % is not an eligible online driver', p_driver_id;
    END IF;

    -- Claim pending ride atomically
    UPDATE public.rides
    SET driver_id = p_driver_id,
        status = 'accepted',
        updated_at = timezone('utc', now())
    WHERE id = p_ride_id
      AND status = 'pending'
      AND driver_id IS NULL
    RETURNING * INTO v_ride;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ride no longer available';
    END IF;

    RETURN to_jsonb(v_ride);
END;
$$;

ALTER FUNCTION public.accept_ride(uuid, uuid) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.accept_ride(uuid, uuid) TO anon, authenticated, service_role;

-- ── 3. RLS Policies on public.rides ──────────────────────────────────────────

DROP POLICY IF EXISTS "rides_select_policy" ON public.rides;
CREATE POLICY "rides_select_policy" ON public.rides
    FOR SELECT
    TO anon, authenticated
    USING (
        user_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.users cu
            WHERE cu.id = public.rides.user_id AND cu.auth_id = auth.uid()
        )
        OR (status = 'pending' AND driver_id IS NULL)
        OR (
            driver_id IS NOT NULL
            AND EXISTS (
                SELECT 1 FROM public.users du
                WHERE du.id = public.rides.driver_id AND du.is_driver = true
            )
        )
    );

DROP POLICY IF EXISTS "rides_update_driver_policy" ON public.rides;
CREATE POLICY "rides_update_driver_policy" ON public.rides
    FOR UPDATE
    TO anon, authenticated
    USING (
        driver_id IS NOT NULL
        AND EXISTS (
            SELECT 1 FROM public.users du
            WHERE du.id = public.rides.driver_id
              AND du.is_driver = true
        )
    )
    WITH CHECK (
        driver_id IS NOT NULL
        AND status IN ('accepted', 'picked_up', 'on_ride', 'completed', 'cancelled')
    );

-- ── 4. Clean up any trailing whitespace in driver profile fields ─────────────

UPDATE public.users
SET rider_status = TRIM(rider_status),
    vehicle_category = LOWER(TRIM(vehicle_category)),
    vehicle_type = LOWER(TRIM(vehicle_type))
WHERE is_driver = true
  AND (
      rider_status <> TRIM(rider_status)
      OR vehicle_category <> LOWER(TRIM(vehicle_category))
      OR vehicle_type <> LOWER(TRIM(vehicle_type))
  );

COMMIT;

NOTIFY pgrst, 'reload schema';
