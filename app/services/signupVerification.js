import { supabase } from './supabaseClient';

const isClientAccount = (user) => {
  const role = String(user?.user_metadata?.role || 'Client').trim().toLowerCase();
  return role !== 'attorney' && role !== 'admin';
};

export function isSignupVerificationComplete(user) {
  if (!user) return false;

  const meta = user.user_metadata || {};
  if (meta.signup_otp_completed === true) return true;
  if (meta.signup_otp_completed === false) return false;

  if (isClientAccount(user)) {
    return Boolean(user.email_confirmed_at);
  }

  return Boolean(user.email_confirmed_at);
}

export async function markSignupOtpCompleted() {
  const { error } = await supabase.auth.updateUser({
    data: { signup_otp_completed: true },
  });
  if (error) {
    throw new Error(error.message || 'Could not finalize account verification.');
  }
}

export async function signOutIfSignupIncomplete(user) {
  if (!user || isSignupVerificationComplete(user)) {
    return false;
  }
  await supabase.auth.signOut();
  return true;
}
