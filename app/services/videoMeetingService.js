import Constants from 'expo-constants';
import { supabase } from './supabaseClient';

/** Production Node API (same as web): VideoSDK JWT + room creation. */
const DEFAULT_BATASMO_WEB_API_BASE = 'https://batasmo-web.onrender.com';

function normalizeBaseUrl(url) {
  return String(url || '')
    .trim()
    .replace(/\/+$/, '');
}

function getExpoHostIp() {
  const hostUri =
    Constants?.expoConfig?.hostUri ||
    Constants?.manifest2?.extra?.expoClient?.hostUri ||
    Constants?.manifest?.debuggerHost ||
    '';
  if (!hostUri) {
    return null;
  }
  const [host] = hostUri.split(':');
  return host || null;
}

/**
 * Base URL for VideoSDK routes (`/videosdk-token`, `/videosdk-create-room`).
 * Prefer EXPO_PUBLIC_VIDEOSDK_API_BASE_URL (local Node — often port 4000).
 * Then EXPO_PUBLIC_BATASMO_WEB_API_URL / EXPO_PUBLIC_BATASMO_API_BASE_URL for the hosted API.
 * Defaults to production Render (`DEFAULT_BATASMO_WEB_API_BASE`) so mobile joins the same meetings as web.
 */
export function resolveVideoBackendBaseUrl() {
  const fromEnv = normalizeBaseUrl(
    process.env.EXPO_PUBLIC_VIDEOSDK_API_BASE_URL ||
      process.env.EXPO_PUBLIC_MEETING_API_URL ||
      process.env.EXPO_PUBLIC_BATASMO_WEB_API_URL ||
      process.env.EXPO_PUBLIC_BATASMO_API_BASE_URL ||
      process.env.EXPO_PUBLIC_CHATBOT_API_URL ||
      process.env.REACT_APP_CHATBOT_API_URL ||
      '',
  );
  const expoHostIp = getExpoHostIp();
  if (fromEnv) {
    if (expoHostIp && /localhost|127\.0\.0\.1/i.test(fromEnv)) {
      return fromEnv.replace(/localhost|127\.0\.0\.1/gi, expoHostIp);
    }
    return fromEnv;
  }
  if (expoHostIp) {
    return `http://${expoHostIp}:4000`;
  }
  return DEFAULT_BATASMO_WEB_API_BASE;
}

export function isVideoBackendConfigured() {
  return Boolean(resolveVideoBackendBaseUrl());
}

let cachedVideoSdkToken = null;
let cachedVideoSdkTokenTimer = null;

/**
 * Same contract as web — server exposes GET /videosdk-token (JWT from VIDEOSDK_API_KEY/SECRET).
 */
export async function getVideoSdkToken() {
  const base = resolveVideoBackendBaseUrl();
  if (!base) {
    throw new Error(
      'Video server URL is not set. Add EXPO_PUBLIC_VIDEOSDK_API_BASE_URL (e.g. http://192.168.x.x:4000) — same host as your web Node server with /videosdk-token.',
    );
  }

  if (cachedVideoSdkToken) {
    return cachedVideoSdkToken;
  }

  const res = await fetch(`${base}/videosdk-token`);
  if (!res.ok) {
    throw new Error('Failed to fetch VideoSDK token from server.');
  }
  const body = await res.json();
  const token = body?.token;
  if (!token) {
    throw new Error('Video token response was empty.');
  }

  cachedVideoSdkToken = token;
  if (cachedVideoSdkTokenTimer) {
    clearTimeout(cachedVideoSdkTokenTimer);
  }
  cachedVideoSdkTokenTimer = setTimeout(() => {
    cachedVideoSdkToken = null;
    cachedVideoSdkTokenTimer = null;
  }, 110 * 60 * 1000);

  return token;
}

/**
 * @param {string} appointmentId
 * @returns {Promise<{ meetingId: string, roomId: string, token: string }>}
 */
export async function getOrCreateVideoMeeting(appointmentId) {
  if (!appointmentId) {
    throw new Error('appointmentId is required');
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('Not authenticated');
  }

  const base = resolveVideoBackendBaseUrl();
  const res = await fetch(`${base}/videosdk-meeting-for-appointment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ appointmentId }),
  });

  const body = await res.text();
  let payload = null;
  try {
    payload = body ? JSON.parse(body) : null;
  } catch {
    payload = null;
  }

  if (!res.ok) {
    throw new Error(payload?.error || `Video meeting setup failed (${res.status})`);
  }

  const { meetingId, roomId, token } = payload || {};
  if (!meetingId || !roomId || !token) {
    throw new Error('Video meeting response was incomplete.');
  }

  return { meetingId, roomId, token };
}
