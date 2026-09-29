import {
  resolveDiditProxyBaseUrl,
  getDiditProxySetupHint,
} from './resolveDiditProxyUrl';

import { Camera } from 'expo-camera';

export const DIDIT_CALLBACK_PREFIX = 'legallinkapp://didit-callback';

/**
 * Didit runs in a WebView (getUserMedia). OS permissions must be granted to the host app
 * before the WebView can open the camera — granting only inside Didit's page is not enough.
 */
export async function ensureDiditMediaPermissions() {
  const camera = await Camera.requestCameraPermissionsAsync();
  if (!camera.granted) {
    const err = new Error(
      'Camera access is required for ID verification. Allow camera for Expo Go (or LegalLink) in Settings, then try again.',
    );
    err.code = 'CAMERA_DENIED';
    throw err;
  }

  const microphone = await Camera.requestMicrophonePermissionsAsync();
  if (!microphone.granted) {
    const err = new Error(
      'Microphone access may be required for liveness checks. Allow microphone in Settings, then try again.',
    );
    err.code = 'MIC_DENIED';
    throw err;
  }

  return { camera: true, microphone: true };
}

function getProxyBase() {
  return resolveDiditProxyBaseUrl();
}

function authHeaders() {
  const secret = process.env.EXPO_PUBLIC_FACEID_SHARED_SECRET;
  if (!secret) return {};
  return { Authorization: `Bearer ${secret}` };
}

export function isDiditCallbackUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return url.startsWith(DIDIT_CALLBACK_PREFIX) || url.includes('didit-callback');
}

export function parseDiditCallbackUrl(url) {
  try {
    const q = url.indexOf('?');
    const query = q >= 0 ? url.slice(q + 1) : '';
    const params = new URLSearchParams(query);
    return {
      sessionId:
        params.get('verificationSessionId') ||
        params.get('session_id') ||
        params.get('sessionId') ||
        '',
      status: params.get('status') || '',
    };
  } catch {
    return { sessionId: '', status: '' };
  }
}

export function isDiditApprovedStatus(status) {
  return String(status || '').toLowerCase() === 'approved';
}

/** Health check for free Workflow path (needs DIDIT_WORKFLOW_ID on server). */
export async function pingDiditWorkflow() {
  const base = getProxyBase();
  if (!base) {
    return {
      ok: false,
      error: getDiditProxySetupHint() || 'No proxy URL configured.',
    };
  }
  try {
    const res = await fetch(`${base}/didit/health`);
    const json = await res.json().catch(() => ({}));
    return {
      ok: res.ok && Boolean(json.configured),
      base,
      sessionReady: Boolean(json.sessionReady),
      hasWorkflow: Boolean(json.hasWorkflow),
      ...json,
    };
  } catch (err) {
    const hint = getDiditProxySetupHint();
    const msg = err?.message || 'network failed';
    return {
      ok: false,
      base,
      error: hint
        ? `${msg} — tried ${base}. ${hint}`
        : `${msg} — tried ${base}. Is faceid-server running? For remote testers use ngrok on port 4001.`,
    };
  }
}

export async function createDiditVerificationSession(vendorData) {
  const base = getProxyBase();
  if (!base) {
    throw new Error(
      'Verification server URL is not set. Run faceid-server locally or set EXPO_PUBLIC_DIDIT_PROXY_URL.',
    );
  }

  let res;
  try {
    res = await fetch(`${base}/didit/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ vendor_data: vendorData }),
    });
  } catch (err) {
    throw new Error(`Cannot reach ${base}: ${err?.message || 'network failed'}`);
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      body?.error ||
        body?.detail ||
        body?.message ||
        `Didit session failed (${res.status}).`,
    );
  }
  const url = body.url || body.verification_url;
  if (!url) {
    throw new Error('Didit session response missing verification URL.');
  }
  return {
    sessionId: body.session_id,
    url,
    status: body.status,
    callbackUrl: body.callback_url || DIDIT_CALLBACK_PREFIX,
  };
}

export async function fetchDiditSessionStatus(sessionId) {
  const base = getProxyBase();
  if (!base) throw new Error('Verification server URL is not set.');
  if (!sessionId) throw new Error('Missing Didit session id.');

  const res = await fetch(`${base}/didit/session/${encodeURIComponent(sessionId)}`, {
    headers: { ...authHeaders() },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      body?.error ||
        body?.detail ||
        body?.message ||
        `Didit status failed (${res.status}).`,
    );
  }

  const status = body.status || '';
  const approved = Boolean(body.approved ?? body.verified ?? isDiditApprovedStatus(status));
  const idv =
    body.raw?.decision?.id_verifications?.[0] ||
    body.raw?.id_verifications?.[0] ||
    body.raw?.id_verification;

  return {
    sessionId: body.session_id || sessionId,
    status,
    approved,
    verified: approved,
    confidence: approved ? 100 : 0,
    fullName: idv?.full_name || body.full_name,
  };
}

/** Poll Didit until Approved (or terminal status). */
export async function waitForDiditApproval(sessionId, { maxAttempts = 20, intervalMs = 2000 } = {}) {
  let last = null;
  for (let i = 0; i < maxAttempts; i += 1) {
    last = await fetchDiditSessionStatus(sessionId);
    if (last.approved) return last;
    const s = String(last.status || '').toLowerCase();
    if (s === 'declined' || s === 'rejected' || s === 'expired' || s === 'abandoned') {
      return last;
    }
    if (i < maxAttempts - 1) {
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
  return last;
}
