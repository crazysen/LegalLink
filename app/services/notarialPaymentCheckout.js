import { supabase } from './supabaseClient';
import { requestPaymentApi } from './paymentApiClient';
import { resolveNotarialAmount } from '../constants/notarialFees';
import { DEFAULT_PAYMENT_METHOD } from '../constants/paymentConfig';

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

const isMissingColumnError = (error, columnName) => {
  const message = String(error?.message || '').toLowerCase();
  return error?.code === '42703' || message.includes(String(columnName || '').toLowerCase());
};

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

/**
 * Web parity: PayMongo via POST /payments/notarial/create-session. The backend records the
 * transaction against the notarial request and, once paid (status poll on
 * /payments/appointments/status/:id), notifies admins/attorney and the client.
 */
export async function payForNotarialCheckout({
  notarialRequestId,
  clientId,
  attorneyId,
  amount,
}) {
  if (!notarialRequestId || !clientId) {
    throw new Error('Missing notarial request or client reference.');
  }

  let resolvedAmount = amount;
  let resolvedAttorneyId = attorneyId ?? null;

  if (resolvedAmount == null || resolvedAttorneyId == null) {
    const row = await fetchNotarialPaymentDetails(notarialRequestId);
    if (resolvedAttorneyId == null) resolvedAttorneyId = row.attorneyId ?? null;
    if (resolvedAmount == null) resolvedAmount = row.amount;
  }

  const finalAmount = resolveNotarialAmount(resolvedAmount);
  if (!(finalAmount > 0)) {
    throw new Error('Invalid notarial payment amount.');
  }

  const payload = await requestPaymentApi('/payments/notarial/create-session', {
    method: 'POST',
    body: {
      requestId: notarialRequestId,
      clientId,
      attorneyId: resolvedAttorneyId,
      amount: finalAmount,
      method: DEFAULT_PAYMENT_METHOD,
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
    notarialRequestId,
  };
}

/** Bundled consultation + notarial: link the paid consultation transaction to the new notarial request. */
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
