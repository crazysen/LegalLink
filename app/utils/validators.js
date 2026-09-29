export const VALID_EMAIL_MESSAGE = 'Please enter a valid email address (example: name@domain.com).';
export const GMAIL_REQUIRED_MESSAGE = 'Please enter a valid Gmail address ending with @gmail.com.';
export const VALID_PHONE_MESSAGE = 'Please enter a valid contact number.';
export const PH_MOBILE_REQUIRED_MESSAGE =
  'Please enter a valid 11-digit Philippine mobile number (09XXXXXXXXX).';
export const VALID_PASSWORD_MESSAGE =
  'Password must be at least 8 characters and include a number and a special character.';
export const NUMBERS_ONLY_MESSAGE = 'Phone number must contain digits only.';

export function normalizeAuthEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function isGmailEmail(value) {
  const email = normalizeAuthEmail(value);
  return isValidEmail(email) && email.endsWith('@gmail.com');
}

export function isValidEmail(value) {
  const email = String(value || '').trim();
  return /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(email);
}

export function isValidPhoneNumber(value) {
  const phone = String(value || '').trim();
  return /^\d{11}$/.test(phone);
}

/** Matches web `isPhilippineMobile` — 11 digits starting with 09. */
export function isPhilippineMobile(value) {
  const digits = sanitizePhoneInput(value);
  return /^09\d{9}$/.test(digits);
}

export function isStrongPassword(value) {
  const password = String(value || '');
  return (
    password.length >= 8 &&
    /\d/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
}

export function sanitizePhoneInput(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 11);
}

/** User-facing login error (client, admin, attorney share login screens). */
export function mapLoginErrorMessage(error) {
  const raw = String(error?.message || error || '').trim();
  if (!raw) return 'Login failed. Please try again.';
  if (raw.startsWith('LOCKOUT:')) return raw;

  const normalized = raw.toLowerCase();
  if (
    normalized.includes('invalid login credentials') ||
    normalized.includes('invalid email or password') ||
    normalized.includes('invalid credentials') ||
    normalized.includes('wrong password') ||
    normalized.includes('incorrect password')
  ) {
    return 'Incorrect password.';
  }
  if (normalized.includes('user not found')) {
    return 'Incorrect password.';
  }
  if (normalized.includes('email not confirmed') || normalized.includes('email not verified')) {
    return raw;
  }
  if (normalized.includes('too many requests') || normalized.includes('rate limit')) {
    return 'Too many login attempts. Please wait a moment and try again.';
  }
  return raw;
}

export function formatLockoutMessage(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const min = Math.floor(total / 60);
  const sec = total % 60;
  const clock = `${min}:${sec < 10 ? '0' : ''}${sec}`;
  return `Too many failed attempts. Account locked. Try again in ${clock}.`;
}
