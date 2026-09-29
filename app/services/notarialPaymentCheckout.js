import { supabase } from './supabaseClient';
import { requestPaymentApi } from './paymentApiClient';
import { resolveNotarialAmount } from '../constants/notarialFees';

const normalizePaymentMethodKey = () => 'qrph';

const normalizePaymentMethodTypes = () => ['qrph'];

async function fetchNotarialPaymentDetails(requestId) {
  const { data, error } = await supabase
    .from('notarial_requests')
    .select('attorney_id, service_type, amount')
    .eq('id', requestId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error('Notarial request not found.');
  return {
    attorneyId: data.attorney_id,
    serviceType: data.service_type,
    amount: resolveNotarialAmount(data.amount),
  };
}

async function payForAppointment({ appointmentId, clientId, attorneyId, amount, method, methodTypes }) {
  const paymentMethod = normalizePaymentMethodKey(method);
  const paymentMethodTypes = normalizePaymentMethodTypes(methodTypes, paymentMethod);

  const payload = await requestPaymentApi('/payments/appointments/create-session', {
    method: 'POST',
    body: {
      appointmentId,
      clientId,
      attorneyId,
      amount: Number(amount || 0),
      method: paymentMethod,
      paymentMethodTypes,
    },
  });

  if (!payload?.checkoutUrl || !payload?.transactionId) {
    throw new Error('Payment provider returned an invalid session payload.');
  }

  return {
    transactionId: payload.transactionId,
    checkoutUrl: payload.checkoutUrl,
    status: payload.status || 'pending',
    checkoutSessionId: payload.checkoutSessionId || null,
  };
}

const isMissingColumnError = (error, columnName) => {
  const message = String(error?.message || '').toLowerCase();
  return error?.code === '42703' || message.includes(String(columnName || '').toLowerCase());
};

const notarialPaymentAppointmentMarker = (notarialRequestId) =>
  `[notarial:${notarialRequestId}]`;

async function resolveNotarialPaymentAttorneyId(explicitAttorneyId) {
  if (explicitAttorneyId) return explicitAttorneyId;

  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .eq('role', 'Attorney')
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data?.id) {
    throw new Error('No attorney profile is available to route payment. Please try again later.');
  }
  return data.id;
}

async function ensureNotarialPaymentAppointment({
  clientId,
  notarialRequestId,
  attorneyId,
  amount,
  serviceType,
}) {
  const marker = notarialPaymentAppointmentMarker(notarialRequestId);
  const { data: existing, error: existingError } = await supabase
    .from('appointments')
    .select('id, attorney_id, amount, status')
    .eq('client_id', clientId)
    .ilike('notes', `%${marker}%`)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingError) throw existingError;
  if (existing?.id && !['cancelled', 'completed'].includes(String(existing.status || '').toLowerCase())) {
    return {
      appointmentId: existing.id,
      attorneyId: existing.attorney_id,
      amount: resolveNotarialAmount(existing.amount ?? amount),
    };
  }

  const resolvedAttorneyId = await resolveNotarialPaymentAttorneyId(attorneyId);
  const nowIso = new Date().toISOString();
  const { data: created, error: insertError } = await supabase
    .from('appointments')
    .insert({
      client_id: clientId,
      attorney_id: resolvedAttorneyId,
      title: `Notarial — ${serviceType || 'Service'}`,
      notes: `Notarial payment checkout. ${marker}`,
      scheduled_at: nowIso,
      duration_minutes: 30,
      status: 'pending',
      amount: resolveNotarialAmount(amount),
    })
    .select('id, attorney_id, amount')
    .single();

  if (insertError) throw insertError;
  return {
    appointmentId: created.id,
    attorneyId: created.attorney_id,
    amount: resolveNotarialAmount(created.amount ?? amount),
  };
}

async function fetchAdminUserIds() {
  const { data, error } = await supabase.from('profiles').select('id').eq('role', 'Admin');
  if (error) {
    console.warn('[notify] fetchAdminUserIds failed', error);
    return [];
  }
  return (data || []).map((row) => row.id).filter(Boolean);
}

async function resolveClientDisplayName(clientId) {
  const { data } = await supabase
    .from('profiles')
    .select('full_name, email')
    .eq('id', clientId)
    .maybeSingle();
  return data?.full_name || data?.email || 'A client';
}

async function insertNotificationsForUserIds(userIds, { title, body, type = 'general' }) {
  const unique = [...new Set((userIds || []).filter(Boolean))];
  if (!unique.length) return;
  const nowIso = new Date().toISOString();
  const rows = unique.map((user_id) => ({
    user_id,
    title: String(title || 'Notification'),
    body: String(body || ''),
    type: String(type || 'general'),
    is_read: false,
    created_at: nowIso,
  }));
  const { error } = await supabase.from('notifications').insert(rows);
  if (error) throw error;
}

/** PayMongo via /payments/appointments/* (same hosted route as Book Appointment). */
export async function payForNotarialCheckout({
  notarialRequestId,
  clientId,
  attorneyId,
  amount,
  method,
  methodTypes,
  serviceType,
}) {
  let resolvedServiceType = serviceType;
  let resolvedAmount = amount;
  let resolvedAttorneyId = attorneyId;

  if (resolvedAmount == null || resolvedServiceType == null) {
    const row = await fetchNotarialPaymentDetails(notarialRequestId);
    if (resolvedAttorneyId == null) resolvedAttorneyId = row.attorneyId ?? null;
    if (resolvedAmount == null) resolvedAmount = row.amount;
    if (resolvedServiceType == null) resolvedServiceType = row.serviceType ?? null;
  }

  const booking = await ensureNotarialPaymentAppointment({
    clientId,
    notarialRequestId,
    attorneyId: resolvedAttorneyId,
    amount: resolvedAmount,
    serviceType: resolvedServiceType,
  });

  const session = await payForAppointment({
    appointmentId: booking.appointmentId,
    clientId,
    attorneyId: booking.attorneyId,
    amount: booking.amount,
    method,
    methodTypes,
  });

  return {
    ...session,
    appointmentId: booking.appointmentId,
    notarialRequestId,
  };
}

export async function finalizeNotarialAfterPaidCheckout({
  notarialRequestId,
  clientId,
  amount,
  transactionId,
}) {
  const nowIso = new Date().toISOString();

  if (transactionId) {
    const { error: txLinkError } = await supabase
      .from('transactions')
      .update({ notarial_request_id: notarialRequestId, updated_at: nowIso })
      .eq('id', transactionId);
    if (txLinkError && !isMissingColumnError(txLinkError, 'notarial_request_id')) {
      console.warn('[notarial] link transaction failed', txLinkError);
    }
  }

  // DB enum request_status: pending | accepted | rejected | completed | cancelled (no "approved")
  const { error: reqError } = await supabase
    .from('notarial_requests')
    .update({ status: 'accepted', updated_at: nowIso })
    .eq('id', notarialRequestId);

  if (reqError) {
    console.warn('[notarial] status update failed (payment still recorded)', reqError);
  }

  try {
    const { data: row } = await supabase
      .from('notarial_requests')
      .select('service_type')
      .eq('id', notarialRequestId)
      .maybeSingle();
    const adminIds = await fetchAdminUserIds();
    if (adminIds.length) {
      const clientName = await resolveClientDisplayName(clientId);
      const amt = Number(amount || 0);
      const amtLabel = amt > 0 ? `PHP ${amt.toLocaleString()}` : 'the agreed fee';
      const svc = row?.service_type || 'notarial request';
      await insertNotificationsForUserIds(adminIds, {
        title: 'Notarial payment received',
        body: `${clientName} paid ${amtLabel} for ${svc} (request ${String(notarialRequestId).slice(0, 8)}…). [adminnotpaid:${notarialRequestId}]`,
        type: 'admin_general',
      });
    }
  } catch (notifyErr) {
    console.warn('[notarial] payment admin notify failed', notifyErr?.message || notifyErr);
  }
}
