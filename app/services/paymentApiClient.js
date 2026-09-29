import Constants from 'expo-constants';
import { supabase } from './supabaseClient';

/** Hosted Node API that serves /payments/* (PayMongo). Verified live on Render. */
export const DEFAULT_PAYMENT_API_BASE = 'https://batasmo-web.onrender.com';

const trimTrailingSlash = (value) => String(value || '').trim().replace(/\/+$/, '');

const PAYMENT_FETCH_RETRIES = 3;
const PAYMENT_RETRY_DELAY_MS = 800;
const PAYMENT_WARMUP_TIMEOUT_MS = 8000;

const isNetworkFailure = (error) =>
  String(error?.message || error || '')
    .toLowerCase()
    .includes('network request failed');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithPaymentRetries(url, options) {
  let lastError;
  for (let attempt = 1; attempt <= PAYMENT_FETCH_RETRIES; attempt += 1) {
    try {
      return await fetch(url, options);
    } catch (error) {
      lastError = error;
      if (!isNetworkFailure(error) || attempt >= PAYMENT_FETCH_RETRIES) break;
      await sleep(PAYMENT_RETRY_DELAY_MS * attempt);
    }
  }
  throw lastError;
}

/**
 * Metro LAN host in dev (e.g. 192.168.1.13) so localhost in .env works on a physical device.
 */
const getDevLanHost = () => {
  if (!__DEV__) return null;
  const debuggerHost =
    Constants.expoGoConfig?.debuggerHost ||
    Constants.expoConfig?.hostUri ||
    '';
  const host = String(debuggerHost).split(':')[0]?.trim();
  return host || null;
};

const rewriteLocalhostForDevice = (url) => {
  const lanHost = getDevLanHost();
  if (!lanHost) return url;
  return url
    .replace(/\/\/127\.0\.0\.1(?=[:/])/g, `//${lanHost}`)
    .replace(/\/\/localhost(?=[:/])/gi, `//${lanHost}`);
};

/**
 * Resolves the Express backend that handles PayMongo checkout.
 * Mirrors web `resolvePaymentApiBaseUrl` with mobile env names + production default.
 */
export const resolvePaymentBackendUrl = () => {
  const candidates = [
    process.env.EXPO_PUBLIC_PAYMENT_API_URL,
    process.env.EXPO_PUBLIC_PAYMENT_BACKEND_URL,
    process.env.EXPO_PUBLIC_BATASMO_PAYMENT_API_URL,
    process.env.EXPO_PUBLIC_CHATBOT_API_URL,
    process.env.EXPO_PUBLIC_VIDEOSDK_API_BASE_URL,
    process.env.EXPO_PUBLIC_BATASMO_WEB_API_URL,
    process.env.EXPO_PUBLIC_BATASMO_API_BASE_URL,
  ];

  let base = '';
  for (const candidate of candidates) {
    const normalized = trimTrailingSlash(candidate);
    if (normalized) {
      base = normalized;
      break;
    }
  }

  if (!base) {
    const apiBase = trimTrailingSlash(process.env.EXPO_PUBLIC_API_BASE_URL || '');
    if (apiBase) base = apiBase.replace(/\/api$/i, '');
  }

  if (!base) base = DEFAULT_PAYMENT_API_BASE;

  return rewriteLocalhostForDevice(base);
};

const formatPaymentNetworkError = (error, baseUrl) => {
  const raw = String(error?.message || error || '');
  if (raw.toLowerCase().includes('network request failed')) {
    return (
      'Cannot reach the payment server. ' +
      `Check that the backend is running and EXPO_PUBLIC_PAYMENT_API_URL is reachable from your phone ` +
      `(current: ${baseUrl}). For local dev use your PC LAN IP on port 4000, or use ${DEFAULT_PAYMENT_API_BASE}.`
    );
  }
  return raw || 'Payment request failed.';
};

const NOTARIAL_HTTP_PATHS = new Set([
  '/payments/notarial/create-session',
]);

const isNotarialPaymentPath = (path) =>
  NOTARIAL_HTTP_PATHS.has(path) || String(path || '').startsWith('/payments/notarial/');

const NOTARIAL_EDGE_ACTION_BY_PATH = {
  '/payments/notarial/create-session': 'create-session',
};

const mapNotarialPathToEdgeAction = (path, method = 'GET') => {
  if (path === '/payments/notarial/create-session' && method === 'POST') {
    return 'create-session';
  }
  const statusMatch = String(path || '').match(/^\/payments\/notarial\/status\/(.+)$/);
  if (statusMatch && method === 'GET') {
    return { action: 'status', transactionId: decodeURIComponent(statusMatch[1]) };
  }
  return null;
};

const addUniquePaymentBase = (bases, seen, url) => {
  const normalized = trimTrailingSlash(url);
  if (!normalized || seen.has(normalized)) return;
  seen.add(normalized);
  bases.push(rewriteLocalhostForDevice(normalized));
};

const buildPaymentLanFallbackUrl = () => {
  const explicit = trimTrailingSlash(process.env.EXPO_PUBLIC_PAYMENT_LAN_FALLBACK_URL || '');
  if (explicit) return explicit;
  if (!__DEV__) return '';
  const lanHost = getDevLanHost();
  return lanHost ? `http://${lanHost}:4000` : '';
};

/** Primary hosted URL + optional LAN fallback (dev or EXPO_PUBLIC_PAYMENT_LAN_FALLBACK_URL). */
const buildPaymentBaseUrls = () => {
  const bases = [];
  const seen = new Set();

  addUniquePaymentBase(bases, seen, process.env.EXPO_PUBLIC_NOTARIAL_PAYMENT_API_URL);
  addUniquePaymentBase(bases, seen, resolvePaymentBackendUrl());
  addUniquePaymentBase(bases, seen, buildPaymentLanFallbackUrl());

  return bases;
};

const buildNotarialPaymentBaseUrls = () => buildPaymentBaseUrls();

const notarialPaymentSetupHint = () => {
  const lan = getDevLanHost() || 'YOUR_PC_IP';
  return (
    'Start the Node payment API on your PC (reference Web/backend): cd Web/backend && npm start. ' +
    `Then add to Mobile/app/.env: EXPO_PUBLIC_NOTARIAL_PAYMENT_API_URL=http://${lan}:4000 and restart Expo (npx expo start -c).`
  );
};

/**
 * Optional Supabase Edge fallback — only when EXPO_PUBLIC_NOTARIAL_PAYMENT_USE_EDGE=1.
 */
async function requestNotarialPaymentViaEdge(path, { method = 'GET', body } = {}) {
  const mapped = mapNotarialPathToEdgeAction(path, method);
  if (!mapped) {
    throw new Error(`Unsupported notarial payment path: ${path}`);
  }

  const edgeBody =
    typeof mapped === 'string'
      ? { action: mapped, ...(body || {}) }
      : { ...mapped };

  const { data, error } = await supabase.functions.invoke('payments-notarial', {
    body: edgeBody,
  });

  if (error) {
    let detail = error.message || 'Notarial payment function failed';
    try {
      const ctx = error.context;
      if (ctx && typeof ctx.json === 'function') {
        const parsed = await ctx.json();
        if (parsed?.error) detail = String(parsed.error);
      } else if (ctx?.body) {
        const parsed = typeof ctx.body === 'string' ? JSON.parse(ctx.body) : ctx.body;
        if (parsed?.error) detail = String(parsed.error);
      }
    } catch {
      // ignore parse errors
    }
    throw new Error(`${detail}. ${notarialPaymentSetupHint()}`);
  }

  if (data?.error) {
    throw new Error(String(data.error));
  }

  return data || {};
}

/**
 * POST/GET helper for /payments/* routes on the Node backend.
 * Notarial routes fall back to Supabase Edge when the host returns 404 (stale Render deploy).
 */
async function requestPaymentApiHttpOnBase(baseUrl, path, { method = 'GET', body } = {}) {
  const url = `${baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
  let response;
  try {
    response = await fetchWithPaymentRetries(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    throw new Error(formatPaymentNetworkError(error, baseUrl));
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const err = new Error(
      payload?.error || payload?.message || `Payment service error (HTTP ${response.status}).`,
    );
    err.status = response.status;
    throw err;
  }
  return payload || {};
}

let paymentWarmupPromise = null;

/**
 * Wake Render / local payment API before create-session (reduces cold-start delay).
 * Safe to call multiple times; concurrent callers share one in-flight request.
 */
export async function warmPaymentBackend() {
  if (paymentWarmupPromise) return paymentWarmupPromise;

  paymentWarmupPromise = (async () => {
    const bases = buildPaymentBaseUrls();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PAYMENT_WARMUP_TIMEOUT_MS);

    try {
      await Promise.all(
        bases.map(async (baseUrl) => {
          try {
            await fetch(`${baseUrl}/health`, {
              method: 'GET',
              signal: controller.signal,
            });
          } catch {
            // ignore — warmup is best-effort
          }
        }),
      );
    } finally {
      clearTimeout(timeoutId);
    }
  })();

  try {
    await paymentWarmupPromise;
  } finally {
    paymentWarmupPromise = null;
  }
}

export async function requestPaymentApi(path, { method = 'GET', body } = {}) {
  const notarial = isNotarialPaymentPath(path);
  const bases = buildPaymentBaseUrls();

  let lastError = null;
  for (let i = 0; i < bases.length; i += 1) {
    const baseUrl = bases[i];
    const isLastBase = i === bases.length - 1;
    try {
      return await requestPaymentApiHttpOnBase(baseUrl, path, { method, body });
    } catch (error) {
      lastError = error;
      const is404 = error?.status === 404 || String(error?.message || '').includes('HTTP 404');
      const canTryNextBase =
        !isLastBase && (is404 || isNetworkFailure(error) || isNetworkFailure({ message: error?.message }));
      if (!canTryNextBase) {
        throw error;
      }
    }
  }

  if (notarial) {
    const useEdge = String(process.env.EXPO_PUBLIC_NOTARIAL_PAYMENT_USE_EDGE || '').trim() === '1';
    if (useEdge) {
      try {
        return await requestNotarialPaymentViaEdge(path, { method, body });
      } catch (edgeError) {
        throw edgeError;
      }
    }
    throw new Error(
      `Notarial payment is not available on the hosted API (HTTP 404). ${notarialPaymentSetupHint()}`,
    );
  }

  throw lastError || new Error('Payment request failed.');
}
