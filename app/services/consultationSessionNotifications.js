/**
 * Schedule local reminders at end of scheduled hour and end of grace (optional).
 * Uses dynamic import so Expo Go does not break on missing native module setup.
 */

import {CONSULTATION_WARNING_WINDOW_MINUTES} from './consultationSession';

export async function scheduleConsultationSessionNotifications(appointmentId, bounds, previousIds) {
  await cancelConsultationSessionNotifications(previousIds);
  if (!bounds || !appointmentId) {
    return [];
  }

  const now = Date.now();
  const ids = [];

  try {
    const Notifications = await import('expo-notifications');
    const {SchedulableTriggerInputTypes} = Notifications;
    const { status } = await Notifications.getPermissionsAsync();
    let finalStatus = status;
    if (status !== 'granted') {
      const req = await Notifications.requestPermissionsAsync();
      finalStatus = req.status;
    }
    if (finalStatus !== 'granted') {
      return [];
    }

    if (bounds.sessionEndMs > now + 2000) {
      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Consultation hour complete',
          body:
            'The scheduled hour has ended. A 15-minute grace period is in progress. The session continues until your attorney ends it.',
        },
        trigger: {
          type: SchedulableTriggerInputTypes.DATE,
          date: new Date(bounds.sessionEndMs),
        },
      });
      ids.push(id);
    }

    const warningMs = CONSULTATION_WARNING_WINDOW_MINUTES * 60 * 1000;
    const warningAt = bounds.sessionEndMs - warningMs;
    if (warningAt > now + 2000) {
      const idWarning = await Notifications.scheduleNotificationAsync({
        content: {
          title: '10-minute consultation warning',
          body:
            'The scheduled hour is almost over. Please prepare to wrap up or continue into the grace period if needed.',
        },
        trigger: {
          type: SchedulableTriggerInputTypes.DATE,
          date: new Date(warningAt),
        },
      });
      ids.push(idWarning);
    }

    if (bounds.graceEndMs > now + 2000) {
      const id2 = await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Grace period ended',
          body:
            'The grace period has ended. The attorney can end the consultation when you are finished.',
        },
        trigger: {
          type: SchedulableTriggerInputTypes.DATE,
          date: new Date(bounds.graceEndMs),
        },
      });
      ids.push(id2);
    }
  } catch (e) {
    console.warn('scheduleConsultationSessionNotifications:', e?.message ?? e);
  }

  return ids;
}

export async function cancelConsultationSessionNotifications(ids) {
  if (!ids?.length) {
    return;
  }
  try {
    const Notifications = await import('expo-notifications');
    await Promise.all(
      ids.filter(Boolean).map(id => Notifications.cancelScheduledNotificationAsync(id)),
    );
  } catch (e) {
    console.warn('cancelConsultationSessionNotifications:', e?.message ?? e);
  }
}
