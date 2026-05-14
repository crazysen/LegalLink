import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

const ENV_API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL?.replace('192.168.1.64', '192.168.1.75');
const AUTH_TOKEN_KEY = 'auth_token';
const API_TIMEOUT_MS = 20000;

function isPrivateIpv4Host(value) {
  const host = String(value || '').trim();
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  const parts = host.split('.').map(segment => Number(segment));
  if (parts.some(part => Number.isNaN(part) || part < 0 || part > 255)) return false;
  if (parts[0] === 10) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  return false;
}

function getExpoHostIp() {
  const hostUri =
    Constants?.expoConfig?.hostUri ||
    Constants?.manifest2?.extra?.expoClient?.hostUri ||
    Constants?.manifest?.debuggerHost ||
    '';

  if (!hostUri) return null;
  const [host] = hostUri.split(':');
  return host || null;
}

function normalizeBaseUrl(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

function resolveApiBaseUrl() {
  const configured = normalizeBaseUrl(ENV_API_BASE_URL);
  const expoHostIp = getExpoHostIp();

  if (configured) {
    if (expoHostIp && /localhost|127\.0\.0\.1/i.test(configured)) {
      return configured.replace(/localhost|127\.0\.0\.1/gi, expoHostIp);
    }
    return configured;
  }

  if (expoHostIp) {
    return `http://${expoHostIp}:8000/api`;
  }

  return '';
}

const API_BASE_URL = resolveApiBaseUrl();

function buildFallbackApiBaseUrl() {
  const expoHostIp = getExpoHostIp();
  if (!isPrivateIpv4Host(expoHostIp)) return '';
  const candidate = `http://${expoHostIp}:8000/api`;
  return normalizeBaseUrl(candidate);
}

const FALLBACK_API_BASE_URL = buildFallbackApiBaseUrl();

function isLoginRequest(path) {
  return String(path || '').trim().toLowerCase() === '/auth/login';
}

function assertApiConfigured() {
  if (!API_BASE_URL) {
    throw new Error(
      'API base URL is missing. Set EXPO_PUBLIC_API_BASE_URL in .env (example: http://192.168.x.x:8000/api) and restart Expo.',
    );
  }
}

export async function setAuthToken(token) {
  if (!token) return;
  await AsyncStorage.setItem(AUTH_TOKEN_KEY, token);
}

export async function clearAuthToken() {
  await AsyncStorage.removeItem(AUTH_TOKEN_KEY);
}

export async function getAuthToken() {
  return AsyncStorage.getItem(AUTH_TOKEN_KEY);
}

export async function apiRequest(path, {method = 'GET', body, auth = false} = {}) {
  assertApiConfigured();

  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };

  if (auth) {
    const token = await getAuthToken();
    if (!token) {
      throw new Error('Not authenticated. Please log in again.');
    }
    headers.Authorization = `Bearer ${token}`;
  }

  const candidateBaseUrls = [API_BASE_URL];
  if (
    isLoginRequest(path) &&
    FALLBACK_API_BASE_URL &&
    FALLBACK_API_BASE_URL !== API_BASE_URL
  ) {
    candidateBaseUrls.push(FALLBACK_API_BASE_URL);
  }

  const timeoutMs = isLoginRequest(path) ? 30000 : API_TIMEOUT_MS;

  let response;
  let lastError = null;
  for (let index = 0; index < candidateBaseUrls.length; index += 1) {
    const baseUrl = candidateBaseUrls[index];
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      response = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      break;
    } catch (error) {
      clearTimeout(timeoutId);
      lastError = error;
      const isAbort = error?.name === 'AbortError';
      const isNetwork = /network request failed|fetch failed|failed to fetch/i.test(
        String(error?.message || ''),
      );
      const canRetry = (isAbort || isNetwork) && index < candidateBaseUrls.length - 1;
      if (!canRetry) {
        if (isAbort) {
          const attempted = candidateBaseUrls.join(', ');
          throw new Error(`Request timed out while contacting ${attempted}. Please check your internet/API server and try again.`);
        }
        if (isNetwork) {
          const attempted = candidateBaseUrls.join(', ');
          throw new Error(`Cannot reach API at ${attempted}. Ensure Laravel is running and your phone is on the same network.`);
        }
        throw error;
      }
    }
  }

  if (!response && lastError) {
    throw lastError;
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch (_) {
    payload = null;
  }

  if (!response.ok) {
    const message =
      payload?.message ||
      payload?.errors?.email?.[0] ||
      payload?.errors?.code?.[0] ||
      'Request failed.';
    throw new Error(message);
  }

  return payload;
}
