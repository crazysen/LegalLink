import {parseScheduleStringToDate} from './appointmentService';

export const DEFAULT_CONSULTATION_DURATION_MINUTES = 60;
export const CONSULTATION_GRACE_PERIOD_MINUTES = 15;
export const CONSULTATION_WARNING_WINDOW_MINUTES = 10;

/**
 * Session window from scheduled start: nominal duration + grace. Does not auto-end the chat.
 * @returns {{ startMs: number, sessionEndMs: number, graceEndMs: number } | null}
 */
export function getConsultationSessionBounds(
  scheduledAtIso,
  durationMinutes = DEFAULT_CONSULTATION_DURATION_MINUTES,
  graceMinutes = CONSULTATION_GRACE_PERIOD_MINUTES,
) {
  const start = parseScheduleStringToDate(scheduledAtIso);
  if (!start) {
    return null;
  }
  const startMs = start.getTime();
  const dur =
    Number(durationMinutes) > 0 ? Number(durationMinutes) : DEFAULT_CONSULTATION_DURATION_MINUTES;
  const g =
    Number(graceMinutes) >= 0 ? Number(graceMinutes) : CONSULTATION_GRACE_PERIOD_MINUTES;
  const sessionEndMs = startMs + dur * 60 * 1000;
  const graceEndMs = sessionEndMs + g * 60 * 1000;
  return {startMs, sessionEndMs, graceEndMs};
}

export function formatDurationMs(ms) {
  if (ms == null || Number.isNaN(ms) || ms <= 0) {
    return '0:00';
  }
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * @returns {{
 *   phase: 'before_start' | 'in_session' | 'in_grace' | 'after_grace',
 *   primaryLabel: string,
 *   secondaryLabel: string,
 * }}
 */
export function getConsultationTimerDisplay(nowMs, bounds) {
  if (!bounds) {
    return {phase: 'before_start', primaryLabel: '', secondaryLabel: ''};
  }

  if (nowMs < bounds.startMs) {
    return {
      phase: 'before_start',
      primaryLabel: `Starts in ${formatDurationMs(bounds.startMs - nowMs)}`,
      secondaryLabel: 'Timer runs from scheduled start',
    };
  }

  if (nowMs < bounds.sessionEndMs) {
    const elapsed = nowMs - bounds.startMs;
    const remaining = bounds.sessionEndMs - nowMs;
    const warningWindowMs = CONSULTATION_WARNING_WINDOW_MINUTES * 60 * 1000;
    if (remaining <= warningWindowMs) {
      return {
        phase: 'warning',
        primaryLabel: `Ends in ${formatDurationMs(remaining)}`,
        secondaryLabel: '10-minute warning — scheduled hour ends soon',
      };
    }
    return {
      phase: 'in_session',
      primaryLabel: `Elapsed ${formatDurationMs(elapsed)}`,
      secondaryLabel: `${formatDurationMs(remaining)} left in scheduled hour`,
    };
  }

  if (nowMs < bounds.graceEndMs) {
    return {
      phase: 'in_grace',
      primaryLabel: `Grace: ${formatDurationMs(bounds.graceEndMs - nowMs)} remaining`,
      secondaryLabel: 'Hour complete — session still active',
    };
  }

  return {
    phase: 'after_grace',
    primaryLabel: `Past grace (+${formatDurationMs(nowMs - bounds.graceEndMs)})`,
    secondaryLabel: 'End consultation when ready (attorney only)',
  };
}
