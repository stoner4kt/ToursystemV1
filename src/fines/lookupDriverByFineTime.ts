import type { SupabaseClient } from '@supabase/supabase-js';

export type DriverFineLookupSuccess = {
  success: true;
  booking_id: string;
  driver_id: string;
  vehicle_reg: string;
  invoice_no: string | null;
  client_name: string | null;
  rental_period: string | null;
  driver: {
    full_name: string | null;
    phone: string | null;
    email: string | null;
  };
};

export type DriverFineLookupFailure = {
  success: false;
  reason: 'not_found' | 'invalid_input' | 'error';
  message: string;
};

export type DriverFineLookupResult = DriverFineLookupSuccess | DriverFineLookupFailure;

type LookupDriverRpcRow = {
  booking_id: string;
  driver_id: string;
  driver_name: string | null;
  driver_phone: string | null;
  driver_email: string | null;
  vehicle_reg: string;
  invoice_no: string | null;
  client_name: string | null;
  rental_period: string | null;
};

/**
 * Finds the single booking/driver responsible for a vehicle at the exact fine time.
 *
 * The backing SQL function uses the indexed bookings.rental_period tstzrange with
 * Postgres' range containment operator (@>) for microsecond-accurate lookup. The
 * vehicleId may be either the existing vehicle registration number or vehicles.id.
 */
export async function lookupDriverByFineTime(
  supabase: SupabaseClient,
  vehicleId: string,
  fineTimestamp: string,
): Promise<DriverFineLookupResult> {
  const trimmedVehicleId = vehicleId?.trim();
  const parsedFineDate = new Date(fineTimestamp);

  if (!trimmedVehicleId || Number.isNaN(parsedFineDate.getTime())) {
    return {
      success: false,
      reason: 'invalid_input',
      message: 'A vehicle id/registration and valid ISO 8601 fine timestamp are required.',
    };
  }

  const { data, error } = await supabase.rpc('lookup_driver_by_fine_time', {
    p_vehicle_id: trimmedVehicleId,
    p_fine_timestamp: parsedFineDate.toISOString(),
  });

  if (error) {
    return {
      success: false,
      reason: 'error',
      message: error.message,
    };
  }

  const match = (data?.[0] ?? null) as LookupDriverRpcRow | null;
  if (!match) {
    return {
      success: false,
      reason: 'not_found',
      message: 'No active, assigned booking matched that vehicle at the supplied timestamp.',
    };
  }

  return {
    success: true,
    booking_id: match.booking_id,
    driver_id: match.driver_id,
    vehicle_reg: match.vehicle_reg,
    invoice_no: match.invoice_no,
    client_name: match.client_name,
    rental_period: match.rental_period,
    driver: {
      full_name: match.driver_name,
      phone: match.driver_phone,
      email: match.driver_email,
    },
  };
}


export type LogTrafficFineInput = {
  booking_id: string;
  vehicle_reg: string;
  driver_id: string;
  fine_timestamp: string;
  fine_reference?: string | null;
  location?: string | null;
  description?: string | null;
  amount?: number | null;
  /** Optional extra/admin-entered email. Profile email can also satisfy the DB requirement. */
  notification_email?: string | null;
};

export type LogTrafficFineResult =
  | { success: true; traffic_fine_id: string; notification_warning?: string }
  | { success: false; reason: 'insert_failed' | 'notify_failed'; message: string };

/**
 * Inserts a fine as the current admin and invokes the Supabase Edge Function
 * that emails the driver/profile recipient. RLS ensures drivers cannot insert
 * or see another driver's fines.
 */
export async function logTrafficFineAndNotify(
  supabase: SupabaseClient,
  fine: LogTrafficFineInput,
  notifyFunctionUrl: string,
): Promise<LogTrafficFineResult> {
  const { data: inserted, error: insertError } = await supabase
    .from('traffic_fines')
    .insert({
      booking_id: fine.booking_id,
      vehicle_reg: fine.vehicle_reg,
      driver_id: fine.driver_id,
      fine_timestamp: new Date(fine.fine_timestamp).toISOString(),
      fine_reference: fine.fine_reference ?? null,
      location: fine.location ?? null,
      description: fine.description ?? null,
      amount: fine.amount ?? null,
      notification_email: fine.notification_email?.trim() || null,
    })
    .select('id')
    .single();

  if (insertError || !inserted) {
    return {
      success: false,
      reason: 'insert_failed',
      message: insertError?.message ?? 'Fine insert did not return an id.',
    };
  }

  const { data: sessionResult } = await supabase.auth.getSession();
  const accessToken = sessionResult.session?.access_token;
  const notifyResponse = await fetch(notifyFunctionUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ traffic_fine_id: inserted.id }),
  });

  const notifyBody = await notifyResponse.json().catch(() => ({}));
  if (!notifyResponse.ok) {
    return {
      success: false,
      reason: 'notify_failed',
      message: notifyBody.error ?? 'Fine was logged, but notification failed.',
    };
  }

  return {
    success: true,
    traffic_fine_id: inserted.id,
    notification_warning: notifyBody.warning,
  };
}
