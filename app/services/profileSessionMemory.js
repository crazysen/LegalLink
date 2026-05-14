/**
 * In-memory profile mirror (web uses sessionStorage; RN uses this + AsyncStorage elsewhere).
 * Cleared on sign-out alongside Supabase session.
 */
let cached = null;

export function getMemoryProfileCache() {
  return cached;
}

export function setMemoryProfileCache(profile) {
  cached = profile && typeof profile === 'object' ? {...profile} : null;
}

export function clearMemoryProfileCache() {
  cached = null;
}
