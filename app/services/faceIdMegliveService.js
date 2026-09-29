import { resolveVideoBackendBaseUrl } from './videoMeetingService';

function getBackendBase() {
  return resolveVideoBackendBaseUrl();
}

function faceIdAuthHeaders() {
  const secret = process.env.EXPO_PUBLIC_FACEID_SHARED_SECRET;
  if (!secret) return {};
  return { Authorization: `Bearer ${secret}` };
}

/** Megvii FaceID (optional native MegLive path — not used by Didit notary flow). */
export async function requestFaceIdBizToken(idBase64, uuid) {
  const base = getBackendBase();
  if (!base) throw new Error('Backend URL is not set. Configure EXPO_PUBLIC_BATASMO_WEB_API_URL.');

  const res = await fetch(`${base}/faceid/biz-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...faceIdAuthHeaders() },
    body: JSON.stringify({ idBase64, uuid }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `FaceID biz-token failed (${res.status}).`);
  if (!body.biz_token) throw new Error('FaceID biz-token response missing biz_token.');
  return { bizToken: body.biz_token, requestId: body.request_id };
}

export async function verifyFaceIdWithMeglive(bizToken, megliveFileUri) {
  const base = getBackendBase();
  if (!base) throw new Error('Backend URL is not set. Configure EXPO_PUBLIC_BATASMO_WEB_API_URL.');

  const form = new FormData();
  form.append('biz_token', bizToken);
  form.append('meglive_data', {
    uri: megliveFileUri,
    name: 'meglive_data',
    type: 'application/octet-stream',
  });

  const res = await fetch(`${base}/faceid/verify`, {
    method: 'POST',
    headers: { ...faceIdAuthHeaders() },
    body: form,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.error || body?.result_message || `FaceID verify failed (${res.status}).`);
  }

  return {
    verified: Boolean(body.verified),
    confidence: Number(body.confidence ?? body.faceMatchConfidence ?? 0),
    isIdentical: Boolean(body.verified),
    raw: body,
  };
}
