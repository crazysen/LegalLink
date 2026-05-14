/**
 * Supabase Auth — Send SMS Hook → IPROG SMS (send_bulk).
 *
 * Error responses must follow:
 * https://supabase.com/docs/guides/auth/auth-hooks#error-handling
 * { "error": { "http_code": number, "message": string } }
 */
import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

const IPROG_DEFAULT_URL =
  "https://www.iprogsms.com/api/v1/sms_messages/send_bulk";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, webhook-id, webhook-timestamp, webhook-signature",
};

function jsonHeaders(): Record<string, string> {
  return { ...corsHeaders, "Content-Type": "application/json" };
}

/** Supabase Auth expects this shape for hook errors. */
function hookErrorResponse(status: number, message: string, httpCode?: number) {
  return new Response(
    JSON.stringify({
      error: {
        http_code: httpCode ?? status,
        message,
      },
    }),
    { status, headers: jsonHeaders() },
  );
}

/** Ensure Standard Webhooks header names (verify is picky on some runtimes). */
function normalizeStandardWebhookHeaders(
  raw: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = { ...raw };
  for (const [k, v] of Object.entries(raw)) {
    const lower = k.toLowerCase();
    if (lower === "webhook-id") out["webhook-id"] = v;
    if (lower === "webhook-timestamp") out["webhook-timestamp"] = v;
    if (lower === "webhook-signature") out["webhook-signature"] = v;
  }
  return out;
}

function toIprogPhoneNumber(input: string): string {
  const d = input.replace(/\s/g, "");
  if (d.startsWith("+63")) {
    return "0" + d.slice(4);
  }
  if (d.startsWith("63") && d.length === 12) {
    return "0" + d.slice(2);
  }
  if (d.startsWith("09")) {
    return d;
  }
  if (/^9\d{9}$/.test(d)) {
    return "0" + d;
  }
  return d;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const secretRaw = Deno.env.get("SEND_SMS_HOOK_SECRET");
  const iprogUrl = Deno.env.get("IPROG_SMS_URL") || IPROG_DEFAULT_URL;
  const iprogApiToken = Deno.env.get("IPROG_API_KEY");

  if (!secretRaw) {
    return hookErrorResponse(500, "SEND_SMS_HOOK_SECRET is not set");
  }

  try {
    const payload = await req.text();
    const headerObj = normalizeStandardWebhookHeaders(
      Object.fromEntries(req.headers),
    );
    const base64Secret = secretRaw.replace(/^v1,whsec_/, "").replace(/^whsec_/, "");
    const wh = new Webhook(base64Secret);

    let user: { phone?: string };
    /** Auth puts the destination in sms.phone (see supabase/auth sendPhoneConfirmation). */
    let sms: { otp?: string; phone?: string };
    try {
      const verified = wh.verify(payload, headerObj) as {
        user?: { phone?: string };
        sms?: { otp?: string; phone?: string };
      };
      user = verified.user ?? {};
      sms = verified.sms ?? {};
    } catch (verifyErr) {
      console.error("send-sms-hook verify failed:", verifyErr);
      return hookErrorResponse(
        500,
        `Webhook signature verification failed: ${verifyErr instanceof Error ? verifyErr.message : String(verifyErr)}`,
      );
    }

    const to = user?.phone || sms?.phone;
    const otp = sms?.otp;
    if (!to || !otp) {
      return hookErrorResponse(
        400,
        "Missing phone or otp in hook payload after verification",
      );
    }

    if (!iprogApiToken) {
      console.warn("send-sms-hook: IPROG_API_KEY not set — OTP not sent.");
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: jsonHeaders(),
      });
    }

    const phoneNumber = toIprogPhoneNumber(to);
    const message = `Your BatasMo verification code is: ${otp}`;

    const res = await fetch(iprogUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        api_token: iprogApiToken,
        phone_number: phoneNumber,
        message,
      }),
    });

    if (!res.ok) {
      const t = await res.text();
      return hookErrorResponse(
        502,
        `IPROG send failed: ${res.status} ${t}`,
        502,
      );
    }

    return new Response(JSON.stringify({}), {
      status: 200,
      headers: jsonHeaders(),
    });
  } catch (e) {
    console.error(e);
    return hookErrorResponse(
      500,
      e instanceof Error ? e.message : String(e),
    );
  }
});
