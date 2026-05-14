import 'react-native-url-polyfill/auto'; // Required for Supabase in React Native
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

/** Same fallbacks as `batasmo_web` `supabaseClient.js` — prefer `.env` for production. */
const FALLBACK_SUPABASE_URL = 'https://sjmmyqeqiigmclcgcadr.supabase.co';
const FALLBACK_SUPABASE_ANON_KEY =
  'sb_publishable_iWOdzcbgaRwBnpkLo_HVUA_fPgC1UuZ';

const supabaseUrl = (
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  process.env.REACT_APP_SUPABASE_URL ||
  FALLBACK_SUPABASE_URL
).trim();
const supabaseAnonKey = (
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.REACT_APP_SUPABASE_ANON_KEY ||
  FALLBACK_SUPABASE_ANON_KEY
).trim();

/** False only if URL/key resolve empty (should not happen with fallbacks). */
export function isSupabaseConfigured() {
  return Boolean(supabaseUrl && supabaseAnonKey);
}

/**
 * Hostname + whether URL/anon key came from env (inlined at Metro bundle time).
 * Use in login errors so users can confirm the app points at the same Supabase project as web.
 */
export function getSupabaseEnvDebug() {
  const urlFromEnv = Boolean(
    process.env.EXPO_PUBLIC_SUPABASE_URL ||
      process.env.REACT_APP_SUPABASE_URL,
  );
  const keyFromEnv = Boolean(
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.REACT_APP_SUPABASE_ANON_KEY,
  );
  let hostname = '';
  try {
    hostname = new URL(supabaseUrl).hostname;
  } catch {
    hostname = '';
  }
  return {hostname, urlFromEnv, keyFromEnv};
}

if (!process.env.EXPO_PUBLIC_SUPABASE_URL && !process.env.REACT_APP_SUPABASE_URL) {
  console.warn(
    '[BatasMo] Using fallback Supabase URL. Set EXPO_PUBLIC_SUPABASE_URL (same as web REACT_APP_SUPABASE_URL).',
  );
}
if (!process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY && !process.env.REACT_APP_SUPABASE_ANON_KEY) {
  console.warn(
    '[BatasMo] Using fallback Supabase anon key. Set EXPO_PUBLIC_SUPABASE_ANON_KEY for production.',
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

/**
 * True when stored session cannot be refreshed (wrong project, revoked session, or corrupt storage).
 * @see https://github.com/supabase/supabase-js/issues — clear local session and re-login.
 */
export function isInvalidRefreshTokenError(err) {
  if (!err) {
    return false;
  }
  const msg = String(err.message ?? err).toLowerCase();
  const code = String(err.code ?? '').toLowerCase();
  if (code === 'refresh_token_not_found') {
    return true;
  }
  if (msg.includes('refresh token not found')) {
    return true;
  }
  if (msg.includes('invalid refresh token')) {
    return true;
  }
  if (String(err.name ?? '') === 'AuthApiError' && msg.includes('refresh token')) {
    return true;
  }
  return false;
}

/**
 * Clears invalid Supabase session from AsyncStorage (sb-* keys) after local sign-out.
 * Call when refresh token errors appear so the user can sign in again cleanly.
 */
export async function recoverFromInvalidAuthSession() {
  try {
    await supabase.auth.signOut({scope: 'local'});
  } catch {
    /* ignore */
  }
  try {
    const keys = await AsyncStorage.getAllKeys();
    const stale = keys.filter(k => typeof k === 'string' && k.startsWith('sb-'));
    if (stale.length > 0) {
      await AsyncStorage.multiRemove(stale);
    }
  } catch {
    /* ignore */
  }
}
