import {
  supabase,
  isSupabaseConfigured,
  recoverFromInvalidAuthSession,
  getSupabaseEnvDebug,
} from './supabaseClient';
import { clearCachedProfile } from './profileCache';
import { clearMemoryProfileCache } from './profileSessionMemory';
import {
  isValidEmail,
  isGmailEmail,
  isPhilippineMobile,
  isStrongPassword,
  GMAIL_REQUIRED_MESSAGE,
  PH_MOBILE_REQUIRED_MESSAGE,
  VALID_PASSWORD_MESSAGE,
  normalizeAuthEmail,
} from '../utils/validators';
import {
  isSignupVerificationComplete,
  signOutIfSignupIncomplete,
} from './signupVerification';
import { resolvePaymentBackendUrl } from './paymentApiClient';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const PENDING_SIGNUP_ID_KEY = '@legallink/pending_signup_id';
export const OTP_RESUME_SIGNUP_KEY = '@legallink/otp_resume_signup';

const getBackendApiBase = () => resolvePaymentBackendUrl();

/** Philippine mobile → E.164 (+639XXXXXXXXX). */
export function normalizePhilippinesToE164(input) {
  if (!input || typeof input !== 'string') {
    throw new Error('Phone number is required');
  }
  let d = input.replace(/\s/g, '').replace(/-/g, '');
  if (d.startsWith('+63')) {
    if (!/^\+63\d{10}$/.test(d)) {
      throw new Error('Enter a valid Philippine mobile number');
    }
    return d;
  }
  if (d.startsWith('63') && d.length === 12) {
    return `+${d}`;
  }
  if (d.startsWith('0')) {
    d = `63${d.slice(1)}`;
  } else if (/^9\d{9}$/.test(d)) {
    d = `63${d}`;
  }
  if (!/^63\d{10}$/.test(d)) {
    throw new Error('Enter a valid Philippine mobile number');
  }
  return `+${d}`;
}

/**
 * DB `profiles.phone` uses Philippine local format (11 digits, e.g. 09XXXXXXXXX).
 * Auth APIs use E.164 (+63…); convert before writing to `profiles`.
 */
export function e164ToPhilippinesLocal11(input) {
  if (!input || typeof input !== 'string') return null;
  const t = input.replace(/\s/g, '');
  if (/^09\d{9}$/.test(t)) return t;
  try {
    const e164 = normalizePhilippinesToE164(t);
    const m = e164.match(/^\+63(\d{10})$/);
    if (m) return `0${m[1]}`;
  } catch (_) {
    /* ignore */
  }
  return null;
}

export function maskPhilippinesPhone(e164) {
  if (!e164 || typeof e164 !== 'string' || e164.length < 4) {
    return 'your phone';
  }
  return `***${e164.slice(-4)}`;
}

export function isPhoneVerified(user) {
  return Boolean(user?.phone_confirmed_at);
}

/** True when Supabase has marked the email as confirmed (password signups, OAuth/Gmail, etc.). */
export function isEmailVerified(user) {
  return Boolean(user?.email_confirmed_at);
}

function toE164OrNull(raw) {
  if (!raw) return null;
  try { return normalizePhilippinesToE164(String(raw)); } catch { return null; }
}

export async function signUpWithEmail({
  email,
  password,
  fullName,
  role,
  phone,
}) {
  const normalizedEmail = normalizeAuthEmail(email);
  const normalizedRole = String(role || 'Client').toLowerCase();
  const roleValue =
    normalizedRole === 'attorney'
      ? 'Attorney'
      : normalizedRole === 'admin'
        ? 'Admin'
        : 'Client';

  if (!String(fullName || '').trim()) {
    throw new Error('Full name is required.');
  }
  if (!isGmailEmail(normalizedEmail)) {
    throw new Error(GMAIL_REQUIRED_MESSAGE);
  }
  if (!isPhilippineMobile(phone)) {
    throw new Error(PH_MOBILE_REQUIRED_MESSAGE);
  }
  if (!isStrongPassword(password)) {
    throw new Error(VALID_PASSWORD_MESSAGE);
  }



  const base = getBackendApiBase();
  if (!base) {
    throw new Error(
      'Signup is not configured. Set EXPO_PUBLIC_PAYMENT_API_URL to your Render backend URL.',
    );
  }

  const response = await fetch(`${base}/auth/signup-start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: normalizedEmail,
      password,
      fullName: String(fullName).trim(),
      role: roleValue,
      phone: String(phone).trim(),
      preferredOtpChannel: 'email',
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || 'Failed to start signup.');
  }

  const pendingId = payload?.pendingId ? String(payload.pendingId) : '';
  if (pendingId) {
    await AsyncStorage.setItem(PENDING_SIGNUP_ID_KEY, pendingId);
  }
  await AsyncStorage.setItem(
    OTP_RESUME_SIGNUP_KEY,
    JSON.stringify({
      email: normalizedEmail,
      password: String(password || ''),
    }),
  );

  let phoneE164 = null;
  try {
    phoneE164 = normalizePhilippinesToE164(phone);
  } catch {
    phoneE164 = null;
  }

  return {
    pendingId,
    email: payload?.email || normalizedEmail,
    phoneE164,
    preferredOtpChannel: 'email',
  };
}

export async function sendSignupVerificationEmail({ email, pendingId }) {
  const normalizedEmail = normalizeAuthEmail(email);
  if (!normalizedEmail && !pendingId) throw new Error('Email is required.');

  const base = getBackendApiBase();
  if (!base) {
    throw new Error('Signup service is not configured (EXPO_PUBLIC_PAYMENT_API_URL).');
  }

  const body = {};
  if (normalizedEmail) body.email = normalizedEmail;
  if (pendingId) body.pendingId = String(pendingId).trim();

  const response = await fetch(`${base}/auth/signup-resend-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || 'Failed to send verification email.');
  }
  return payload;
}

export async function completePendingSignup({ email, pendingId, otp, password }) {
  const base = getBackendApiBase();
  if (!base) {
    throw new Error('Signup service is not configured (EXPO_PUBLIC_PAYMENT_API_URL).');
  }

  const response = await fetch(`${base}/auth/signup-complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: normalizeAuthEmail(email),
      pendingId: pendingId ? String(pendingId).trim() : undefined,
      otp: String(otp || '').replace(/\D/g, ''),
      password: String(password || ''),
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || 'Verification failed.');
  }
  return payload;
}

/**
 * When EXPO_PUBLIC_SKIP_LOGIN_LOCKOUT=1|true|yes, the app does not call the server lockout RPC.
 * Use only for local/dev while fixing env or password; remove before production store builds.
 */
function shouldSkipLoginLockout() {
  const v = process.env.EXPO_PUBLIC_SKIP_LOGIN_LOCKOUT;
  if (typeof v !== 'string') {
    return false;
  }
  return ['1', 'true', 'yes'].includes(v.toLowerCase().trim());
}

export async function checkEmailLockout(email) {
  if (shouldSkipLoginLockout()) {
    return 0;
  }
  try {
    const { data } = await supabase.rpc('check_login_lockout', { user_email: email });
    if (typeof data === 'boolean') {
      return data ? 600 : 0;
    }
    return Math.max(0, Math.floor(Number(data) || 0));
  } catch (error) {
    return 0;
  }
}

/**
 * Only count obvious wrong-email/password failures toward lockout.
 * Avoid matching any error that merely contains "invalid" (can false-trigger lockout).
 */
function shouldLogFailedPasswordAttempt(message) {
  const m = String(message || '').toLowerCase();
  if (
    m.includes('email not confirmed') ||
    m.includes('email not verified') ||
    m.includes('email address not confirmed')
  ) {
    return false;
  }
  if (m.includes('invalid login credentials')) {
    return true;
  }
  if (m.includes('invalid email or password')) {
    return true;
  }
  if (m.includes('invalid') && m.includes('credential')) {
    return true;
  }
  return false;
}

export async function signInWithEmail({ email, password }) {
  if (!isSupabaseConfigured()) {
    throw new Error(
      'This app is not pointed at Supabase. Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to .env (use the same values as your working web app), then restart Expo with: npx expo start -c',
    );
  }

  const normalizedEmail = String(email || '')
    .trim()
    .toLowerCase();

  if (!normalizedEmail || !password) {
    throw new Error('Email and password are required.');
  }
  if (!isValidEmail(normalizedEmail)) {
    throw new Error('Please enter a valid email address.');
  }

  const lockoutTime = await checkEmailLockout(normalizedEmail);
  if (lockoutTime > 0) {
    throw new Error(`LOCKOUT:${lockoutTime}`);
  }

  // Clear any stale sb-* session keys so password login is not affected by corrupt tokens.
  try {
    await recoverFromInvalidAuthSession();
  } catch {
    /* non-fatal */
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email: normalizedEmail,
    password,
  });

  if (error) {
    const rawMsg = String(error.message || '');
    const low = rawMsg.toLowerCase();
    const code = String(error.code ?? '').toLowerCase();
    console.warn('[LegalLink] signInWithPassword', {
      message: rawMsg,
      status: error.status,
      code: code || undefined,
      name: error.name,
    });

    const normalizedErr = low;
    if (
      normalizedErr.includes('credential') ||
      normalizedErr.includes('invalid login') ||
      normalizedErr.includes('invalid email or password') ||
      shouldLogFailedPasswordAttempt(rawMsg)
    ) {
      try {
        await supabase.rpc('log_failed_login', { user_email: normalizedEmail });
      } catch (e) {
        console.warn('log_failed_login:', e?.message || e);
      }
    }

    const lockoutAfter = await checkEmailLockout(normalizedEmail);
    if (lockoutAfter > 0) {
      throw new Error(`LOCKOUT:${lockoutAfter}`);
    }

    if (
      low.includes('email not confirmed') ||
      low.includes('email address not confirmed') ||
      low.includes('email not verified') ||
      code === 'email_not_confirmed'
    ) {
      throw new Error(
        rawMsg ||
        'Email not confirmed. Open the confirmation link from your inbox, or ask an admin to confirm the user in Supabase.',
      );
    }

    const showRaw =
      typeof process.env.EXPO_PUBLIC_AUTH_DEBUG === 'string' &&
      ['1', 'true', 'yes'].includes(process.env.EXPO_PUBLIC_AUTH_DEBUG.toLowerCase().trim());
    if (showRaw && (low.includes('invalid') || low.includes('credential'))) {
      throw new Error(`Incorrect password. Raw: ${rawMsg}`);
    }
    if (
      low.includes('invalid login credentials') ||
      low.includes('invalid email or password') ||
      (low.includes('invalid') && low.includes('credential'))
    ) {
      throw new Error('Incorrect password.');
    }
    throw new Error(rawMsg);
  }

  try {
    await supabase.rpc('clear_failed_logins', { user_email: normalizedEmail });
  } catch (rpcError) {
    console.warn('Failed to clear failed login attempts:', rpcError?.message || rpcError);
  }

  const { data: freshAuth } = await supabase.auth.getUser();
  const authedUser = freshAuth?.user || data?.user;

  if (authedUser && !isSignupVerificationComplete(authedUser)) {
    await signOutIfSignupIncomplete(authedUser);
    const err = new Error('SIGNUP_OTP_REQUIRED');
    err.code = 'SIGNUP_OTP_REQUIRED';
    err.email = normalizedEmail;
    throw err;
  }

  if (authedUser) {
    const meta = authedUser.user_metadata || {};

    let existingProfile = null;
    try {
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('role, full_name, phone, address')
        .eq('id', authedUser.id)
        .maybeSingle();

      if (profileError) {
        console.warn('Failed to fetch profile during sign-in:', profileError.message);
      }
      existingProfile = profileData;
    } catch (profileFetchError) {
      console.warn('Profile fetch exception during sign-in:', profileFetchError?.message || profileFetchError);
    }

    const appMeta = authedUser.app_metadata || {};
    const dbRole =
      existingProfile?.role ||
      meta.role ||
      appMeta.role ||
      'Client';
    const dbName = existingProfile?.full_name || meta.full_name || normalizedEmail;

    authedUser.role = dbRole;
    authedUser.name = dbName;
    authedUser.phone = existingProfile?.phone;
    authedUser.address = existingProfile?.address;

    const phoneE164ForVerification = toE164OrNull(authedUser.new_phone)
      || toE164OrNull(authedUser.phone)
      || toE164OrNull(existingProfile?.phone);

    const isAttorney = String(dbRole).toLowerCase() === 'attorney';
    // Require SMS only when phone is not confirmed AND email is not verified (web may use Gmail/email only).
    const needsPhoneVerification =
      !isAttorney &&
      !isPhoneVerified(authedUser) &&
      !isEmailVerified(authedUser);

    return {
      user: authedUser,
      token: data.session?.access_token,
      needsPhoneVerification,
      phoneE164ForVerification,
    };
  }

  return {
    user: data.user,
    token: data.session?.access_token,
    needsPhoneVerification: false,
    phoneE164ForVerification: null,
  };
}

export async function signOutCurrentUser() {
  await clearCachedProfile();
  clearMemoryProfileCache();
  const { error } = await supabase.auth.signOut();
  if (error) {
    // non-fatal
  }
}

export async function resendSignUpOtp({ email, pendingId }) {
  return sendSignupVerificationEmail({ email, pendingId });
}

/** Triggers or re-sends SMS OTP for the current session (e.g. phone change / verification). */
export async function requestPhoneVerificationSms(phoneE164) {
  const { error } = await supabase.auth.updateUser({ phone: phoneE164 });
  if (error) {
    throw new Error(error.message);
  }
  return { success: true };
}

/**
 * GoTrue stores the pending number in `auth.users.phone_change`, exposed in the API as
 * `user.new_phone` (digits-only E.164, no "+"). Until verified, `user.phone` is often empty.
 * `verifyOtp` must use type `phone_change` for updateUser({ phone }) — type `sms` checks
 * `confirmation_token` and `user.phone`, which is the wrong row for this flow.
 *
 * See: supabase/auth internal verifyUserAndToken + sendPhoneConfirmation(phoneChangeVerification).
 */
function buildPhoneVerifyCandidates(primary, user) {
  const out = [];
  const push = (v) => {
    if (!v || typeof v !== 'string') return;
    const t = v.trim().replace(/\s/g, '');
    if (t && !out.includes(t)) out.push(t);
  };

  if (user?.new_phone) push(String(user.new_phone));
  if (user?.phone) push(String(user.phone));
  push(primary);

  for (const raw of [user?.new_phone, user?.phone, primary]) {
    if (!raw) continue;
    try {
      const e164 = normalizePhilippinesToE164(String(raw));
      push(e164);
      push(e164.replace(/^\+/, ''));
    } catch {
      /* ignore */
    }
  }

  return out;
}

export async function verifyPhoneOtp({ phone, token }) {
  const cleanToken = String(token ?? '').replace(/\s/g, '');
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const candidates = buildPhoneVerifyCandidates(phone, user);

  if (candidates.length === 0) {
    throw new Error('No phone number on file for verification.');
  }

  let lastErr = null;

  for (const p of candidates) {
    const { data, error } = await supabase.auth.verifyOtp({
      phone: p,
      token: cleanToken,
      type: 'phone_change',
    });
    if (!error && data?.session) {
      return { session: data.session, user: data.user };
    }
    lastErr = error;
  }

  throw new Error(lastErr?.message || 'Invalid or expired code.');
}

export async function resendPhoneVerificationOtp({ phone }) {
  const { error } = await supabase.auth.resend({
    type: 'phone_change',
    phone,
  });
  if (!error) {
    return { success: true };
  }
  const { error: retry } = await supabase.auth.updateUser({ phone });
  if (retry) {
    throw new Error(error.message || retry.message);
  }
  return { success: true };
}

export async function startPasswordRecovery({ email }) {
  const { error } = await supabase.auth.resetPasswordForEmail(email);

  if (error) {
    throw new Error(error.message);
  }

  return { success: true };
}

export async function verifyRecoveryOtp({ email, token }) {
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: 'recovery',
  });

  if (error) {
    throw new Error(error.message);
  }

  return { success: true };
}

export async function updatePasswordForCurrentUser({ newPassword }) {
  const { error } = await supabase.auth.updateUser({
    password: newPassword,
  });

  if (error) {
    throw new Error(error.message);
  }

  return { success: true };
}

/**
 * After SMS OTP success, persist verified E.164 phone (and optional full profile from signup).
 * When profilePayload is null, only phone + email sync from auth user are applied.
 */
export async function upsertProfileFromVerificationPayload(phoneE164, profilePayload) {
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) {
    throw new Error(userErr?.message || 'Not signed in');
  }

  const { data: existing } = await supabase
    .from('profiles')
    .select('full_name, role, age, address, guardian_name, guardian_contact')
    .eq('id', user.id)
    .maybeSingle();

  const roleRaw = profilePayload?.role || existing?.role || user.user_metadata?.role || 'Client';
  const roleValue =
    String(roleRaw).toLowerCase() === 'attorney'
      ? 'Attorney'
      : String(roleRaw).toLowerCase() === 'admin'
        ? 'Admin'
        : 'Client';

  const phoneLocal = e164ToPhilippinesLocal11(phoneE164);
  if (!phoneLocal) {
    throw new Error('Could not save phone to profile. Check the number format.');
  }

  const row = {
    id: user.id,
    email: profilePayload?.email ?? user.email,
    phone: phoneLocal,
    full_name:
      profilePayload?.fullName ??
      existing?.full_name ??
      user.user_metadata?.full_name ??
      '',
    role: roleValue,
    age: profilePayload ? profilePayload.age ?? null : existing?.age ?? null,
    address: profilePayload ? profilePayload.address ?? null : existing?.address ?? null,
    guardian_name: profilePayload
      ? profilePayload.guardianName ?? null
      : existing?.guardian_name ?? null,
    guardian_contact: profilePayload
      ? profilePayload.guardianContact ?? null
      : existing?.guardian_contact ?? null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from('profiles').upsert(row, { onConflict: 'id' });
  if (error) {
    console.error('upsertProfileFromVerificationPayload:', error);
    throw new Error(error.message);
  }
}
