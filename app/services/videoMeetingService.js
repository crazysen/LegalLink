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

  const { data: room, error: roomError } = await supabase
    .from('consultation_rooms')
    .select('id, video_meeting_id')
    .eq('appointment_id', appointmentId)
    .maybeSingle();

  if (roomError) {
    throw roomError;
  }
  if (!room) {
    throw new Error('Consultation room not found for this appointment.');
  }

  if (room.video_meeting_id) {
    const videoToken = await getVideoSdkToken();
    return { meetingId: room.video_meeting_id, roomId: room.id, token: videoToken };
  }

  const base = resolveVideoBackendBaseUrl();

  const createRes = await fetch(`${base}/videosdk-create-room`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: '{}',
  });

  if (!createRes.ok) {
    const text = await createRes.text();
    let message = `VideoSDK room creation failed (${createRes.status})`;
    try {
      const j = JSON.parse(text);
      if (j?.error) {
        message = String(j.error);
      }
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }

  const { roomId: newMeetingId, token: videoToken } = await createRes.json();
  if (!newMeetingId || !videoToken) {
    throw new Error('Invalid response from videosdk-create-room.');
  }

  const { error: updateError } = await supabase
    .from('consultation_rooms')
    .update({ video_meeting_id: newMeetingId })
    .eq('id', room.id);

  if (updateError) {
    throw updateError;
  }

  return { meetingId: newMeetingId, roomId: room.id, token: videoToken };
}

export async function clearVideoMeetingId(consultationRoomId) {
  if (!consultationRoomId) {
    return;
  }
  const { error } = await supabase
    .from('consultation_rooms')
    .update({ video_meeting_id: null })
    .eq('id', consultationRoomId);
  if (error) {
    console.warn('[video] clearVideoMeetingId', error.message);
  }
}
