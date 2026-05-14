/**
 * Best-effort display name for greetings: DB name first, then friendly email local-part.
 */
export function getGreetingName(profile) {
  const fromName = String(profile?.name || profile?.full_name || '').trim();
  if (fromName) {
    return fromName;
  }
  const email = String(profile?.email || '').trim();
  if (!email.includes('@')) {
    return '';
  }
  const local = email.split('@')[0];
  if (!local) {
    return '';
  }
  const words = local
    .replace(/[._]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) {
    return '';
  }
  return words
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}
