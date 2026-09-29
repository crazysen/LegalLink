import { resolveDiditProxyBaseUrl } from './resolveDiditProxyUrl';

function authHeaders() {
  const secret = process.env.EXPO_PUBLIC_FACEID_SHARED_SECRET;
  if (!secret) return {};
  return { Authorization: `Bearer ${secret}` };
}

function networkErrorMessage(base, err) {
  const host = base.replace(/^https?:\/\//, '');
  return (
    `Cannot reach the verification server at ${host}. ` +
    `Start faceid-server (npm start in Mobile/faceid-server). ` +
    `On the same Wi‑Fi use "npx expo start --lan" (not tunnel). ` +
    `If using Expo tunnel, expose port 4001 or deploy /didit routes to Render. ` +
    `(${err?.message || 'network failed'})`
  );
}

async function diditFetch(path, body) {
  const base = resolveDiditProxyBaseUrl();
  if (!base) {
    throw new Error(
      'Verification server URL is not set. Run faceid-server locally or set EXPO_PUBLIC_DIDIT_PROXY_URL.',
    );
  }

  let res;
  try {
    res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(networkErrorMessage(base, err));
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      json?.error ||
        json?.detail ||
        json?.message ||
        json?.reason ||
        json?.id_verification?.warnings?.[0]?.message ||
        `Request failed (${res.status}).`,
    );
  }
  return json;
}

/**
 * Verify front/back ID images match the user's selected Philippine ID type (Didit).
 */
export async function verifyPhilippineIdDocument({
  idType,
  frontBase64,
  backBase64,
}) {
  const body = await diditFetch('/didit/verify-document', {
    id_type: idType,
    front_base64: frontBase64,
    back_base64: backBase64 || undefined,
  });

  return {
    verified: Boolean(body.verified),
    reason: body.reason,
    detectedDocumentType: body.detected_document_type,
    fullName: body.full_name,
    documentNumber: body.document_number,
    status: body.status,
    raw: body,
  };
}

/**
 * Passive liveness + face match (selfie vs ID front portrait).
 */
export async function verifySelfieMatchesId({ selfieBase64, idFrontBase64 }) {
  const body = await diditFetch('/didit/verify-face', {
    selfie_base64: selfieBase64,
    id_front_base64: idFrontBase64,
  });

  return {
    verified: Boolean(body.verified),
    confidence: Number(body.confidence ?? 0),
    reason: body.reason,
    raw: body,
  };
}

/** Quick check that faceid-server is reachable (optional UI use). */
export async function pingDiditProxy() {
  const base = resolveDiditProxyBaseUrl();
  if (!base) return { ok: false, error: 'No proxy URL' };
  try {
    const res = await fetch(`${base}/didit/health`);
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, base, ...json };
  } catch (err) {
    return { ok: false, base, error: err?.message };
  }
}
