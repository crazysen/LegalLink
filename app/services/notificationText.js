/**
 * Notification bodies carry internal tags such as `[support:<id>]` or `[appt:<id>]`
 * (used for dedupe lookups). Strip them for display only; stored text is unchanged.
 */
const NOTIFICATION_MARKER_RE = /\s*\[[a-z_]+:[^\]\s]+\]/gi;

export function stripNotificationMarkers(text) {
  return String(text || '')
    .replace(NOTIFICATION_MARKER_RE, '')
    .trim();
}
