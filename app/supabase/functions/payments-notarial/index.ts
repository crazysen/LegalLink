import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const normalizePaymentMethod = (method: string) => {
  const normalized = String(method || '').trim().toLowerCase();
  if (normalized === 'qrph' || normalized === 'qr_ph' || normalized === 'qr ph') {
    return 'qrph';
  }
  return 'qrph';
};

const isPaymentMethodSupported = (method: string) => normalizePaymentMethod(method) === 'qrph';

const paymongoAuthHeader = (secret: string) =>
  `Basic ${btoa(`${secret}:`)}`;

const mapPaymongoToInternalStatus = (attributes: Record<string, unknown> = {}) => {
  const paymentIntent = attributes?.payment_intent as { attributes?: { status?: string } } | undefined;
  const checkoutStatus = String(paymentIntent?.attributes?.status || '').toLowerCase();
  if (checkoutStatus === 'succeeded') return 'paid';
  if (checkoutStatus === 'awaiting_next_action' || checkoutStatus === 'awaiting_payment_method') {
    return 'pending';
  }
  if (checkoutStatus === 'processing') return 'pending';
  if (checkoutStatus === 'canceled' || checkoutStatus === 'cancelled') return 'failed';
  const checkoutSessionStatus = String(attributes?.status || '').toLowerCase();
  if (checkoutSessionStatus === 'paid') return 'paid';
  if (checkoutSessionStatus === 'active') return 'pending';
  return 'pending';
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    const paymongoSecret = Deno.env.get('PAYMONGO_SECRET_KEY')?.trim() || '';
    const supabaseUrl = Deno.env.get('SUPABASE_URL')?.trim() || '';
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim() || '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')?.trim() || '';

    if (!paymongoSecret || !supabaseUrl || !serviceRole) {
      return json(
        {
          error:
            'Payment function is not configured. Set PAYMONGO_SECRET_KEY, SUPABASE_URL, and SUPABASE_SERVICE_ROLE_KEY on the Edge Function.',
        },
        500,
      );
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ error: 'Missing authorization' }, 401);
    }

    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userError,
    } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      return json({ error: 'Unauthorized' }, 401);
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRole);
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || 'create-session').trim();

    const successUrl =
      Deno.env.get('PAYMENT_SUCCESS_URL')?.trim() || 'https://batasmo-web.onrender.com/';
    const cancelUrl =
      Deno.env.get('PAYMENT_CANCEL_URL')?.trim() ||
      'https://batasmo-web.onrender.com/my-appointments';

    if (action === 'create-session') {
      const notarialRequestId = String(body?.notarialRequestId || '').trim();
      const clientId = String(body?.clientId || '').trim();
      const amount = Number(body?.amount || 0);
      const paymentMethod = normalizePaymentMethod(body?.method || 'qrph');
      const paymentMethodTypes = ['qrph'];

      if (clientId !== user.id) {
        return json({ error: 'clientId does not match signed-in user' }, 403);
      }
      if (!notarialRequestId) {
        return json({ error: 'notarialRequestId is required' }, 400);
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        return json({ error: 'amount must be greater than 0' }, 400);
      }
      if (!isPaymentMethodSupported(paymentMethod)) {
        return json({ error: 'Only qrph is supported' }, 400);
      }

      const paymentMethodLabel = 'QRPh';

      const { data: txRows, error: txError } = await supabaseAdmin
        .from('transactions')
        .insert({
          notarial_request_id: notarialRequestId,
          client_id: clientId,
          attorney_id: body?.attorneyId || null,
          amount,
          currency: 'PHP',
          payment_status: 'pending',
          payment_method: paymentMethodLabel,
          provider_reference: null,
        })
        .select('id')
        .single();

      if (txError || !txRows?.id) {
        return json({ error: txError?.message || 'Failed to create transaction' }, 500);
      }

      const transactionId = txRows.id;
      const lineAmount = Math.max(1, Math.round(amount * 100));
      const refParam = `notarialRequestId=${notarialRequestId}`;

      const checkoutRes = await fetch('https://api.paymongo.com/v1/checkout_sessions', {
        method: 'POST',
        headers: {
          Authorization: paymongoAuthHeader(paymongoSecret),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          data: {
            attributes: {
              billing: { name: 'LegalLink Client' },
              send_email_receipt: false,
              show_description: true,
              show_line_items: true,
              line_items: [
                {
                  currency: 'PHP',
                  amount: lineAmount,
                  name: 'LegalLink Notarial Service',
                  quantity: 1,
                },
              ],
              payment_method_types: paymentMethodTypes,
              description: `Notarial payment for request ${notarialRequestId}`,
              success_url: `${successUrl}?payment=success&tx=${transactionId}&${refParam}`,
              cancel_url: `${cancelUrl}?payment=cancelled&tx=${transactionId}&${refParam}`,
              metadata: {
                transaction_id: String(transactionId),
                notarial_request_id: String(notarialRequestId),
              },
            },
          },
        }),
      });

      const checkoutPayload = await checkoutRes.json().catch(() => null);
      if (!checkoutRes.ok) {
        const detail =
          checkoutPayload?.errors?.[0]?.detail ||
          checkoutPayload?.error ||
          `PayMongo create session failed (${checkoutRes.status})`;
        return json({ error: detail }, 500);
      }

      const checkoutSessionId = checkoutPayload?.data?.id;
      const checkoutUrl = checkoutPayload?.data?.attributes?.checkout_url;
      if (!checkoutSessionId || !checkoutUrl) {
        return json({ error: 'PayMongo returned an invalid checkout session' }, 500);
      }

      await supabaseAdmin
        .from('transactions')
        .update({
          payment_status: 'pending',
          provider_reference: checkoutSessionId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', transactionId);

      return json({
        transactionId,
        checkoutSessionId,
        checkoutUrl,
        status: 'pending',
      });
    }

    if (action === 'status') {
      const transactionId = String(body?.transactionId || '').trim();
      if (!transactionId) {
        return json({ error: 'transactionId is required' }, 400);
      }

      const { data: tx, error: txError } = await supabaseAdmin
        .from('transactions')
        .select('id, client_id, notarial_request_id, payment_status, provider_reference')
        .eq('id', transactionId)
        .maybeSingle();

      if (txError) return json({ error: txError.message }, 500);
      if (!tx) return json({ error: 'Transaction not found' }, 404);
      if (String(tx.client_id) !== user.id) {
        return json({ error: 'Forbidden' }, 403);
      }

      let effectiveStatus = String(tx.payment_status || 'pending').toLowerCase();
      const checkoutSessionId = String(tx.provider_reference || '').trim();

      if (checkoutSessionId) {
        const statusRes = await fetch(
          `https://api.paymongo.com/v1/checkout_sessions/${encodeURIComponent(checkoutSessionId)}`,
          {
            headers: {
              Authorization: paymongoAuthHeader(paymongoSecret),
              'Content-Type': 'application/json',
            },
          },
        );
        const statusPayload = await statusRes.json().catch(() => null);
        if (statusRes.ok) {
          effectiveStatus = mapPaymongoToInternalStatus(statusPayload?.data?.attributes || {});
          if (effectiveStatus !== String(tx.payment_status || '').toLowerCase()) {
            await supabaseAdmin
              .from('transactions')
              .update({
                payment_status: effectiveStatus,
                provider_reference: checkoutSessionId,
                updated_at: new Date().toISOString(),
              })
              .eq('id', transactionId);
          }
          if (effectiveStatus === 'paid' && tx.notarial_request_id) {
            await supabaseAdmin
              .from('notarial_requests')
              .update({ payment_status: 'paid', updated_at: new Date().toISOString() })
              .eq('id', tx.notarial_request_id);
          }
        }
      }

      return json({
        transactionId,
        notarialRequestId: tx.notarial_request_id,
        status: effectiveStatus,
      });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Payment function failed' }, 500);
  }
});
