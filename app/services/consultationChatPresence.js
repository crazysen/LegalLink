import { supabase } from './supabaseClient';

const OTHER_ROLE = {
  client: 'attorney',
  attorney: 'client',
};

/** @type {Set<string>} */
const dismissedPeerEntryKeys = new Set();

function peerEntryKey(appointmentId, joinedAt) {
  return `${String(appointmentId)}:${String(joinedAt || 'unknown')}`;
}

export function dismissConsultationPeerEntry(appointmentId, otherJoinedAt) {
  dismissedPeerEntryKeys.add(peerEntryKey(appointmentId, otherJoinedAt));
}

export function isConsultationPeerEntryDismissed(appointmentId, otherJoinedAt) {
  return dismissedPeerEntryKeys.has(peerEntryKey(appointmentId, otherJoinedAt));
}

function clearDismissalsForAppointment(appointmentId) {
  const prefix = `${String(appointmentId)}:`;
  for (const key of dismissedPeerEntryKeys) {
    if (key.startsWith(prefix)) {
      dismissedPeerEntryKeys.delete(key);
    }
  }
}

export function buildConsultationWaitingCopy({ otherRole, otherPartyName }) {
  const label = otherRole === 'attorney' ? 'Attorney' : 'Client';
  const name = String(otherPartyName || '').trim() || label;
  if (otherRole === 'attorney') {
    return {
      title: `${name} is in the consultation chatroom`,
      body: 'Your attorney entered the consultation chatroom first and is waiting for you to join.',
    };
  }
  return {
    title: `${name} is in the consultation chatroom`,
    body: 'Your client entered the consultation chatroom first and is waiting for you to join.',
  };
}

function normalizeRole(role) {
  return role === 'attorney' ? 'attorney' : 'client';
}

function listChannelPresences(channel) {
  const state = channel.presenceState();
  const all = [];
  Object.values(state || {}).forEach(entries => {
    (entries || []).forEach(entry => all.push(entry));
  });
  return all;
}

function findOtherInChat(presences, otherRole) {
  return presences.find(
    entry => entry?.role === otherRole && entry?.inChat === true,
  );
}

/**
 * User is inside the consultation chat screen for this appointment.
 */
export function attachConsultationChatPresence({
  appointmentId,
  role,
  userId,
  displayName,
  otherPartyName,
  onWaitingPopup,
}) {
  if (!appointmentId || !userId) {
    return () => {};
  }

  const normalizedRole = normalizeRole(role);
  const otherRole = OTHER_ROLE[normalizedRole];
  let selfTracked = false;
  let hasShownWaitingPopup = false;
  let lastOtherJoinedAt = null;

  const channel = supabase.channel(`consultation-presence:${appointmentId}`, {
    config: { presence: { key: `${normalizedRole}:${userId}` } },
  });

  const notifyIfOtherAlreadyWaiting = () => {
    if (!selfTracked || hasShownWaitingPopup) {
      return;
    }
    const other = findOtherInChat(listChannelPresences(channel), otherRole);
    if (!other) {
      return;
    }
    const joinedAt = other.joinedAt || other.userId || 'unknown';
    if (isConsultationPeerEntryDismissed(appointmentId, joinedAt)) {
      hasShownWaitingPopup = true;
      return;
    }
    hasShownWaitingPopup = true;
    lastOtherJoinedAt = joinedAt;
    if (typeof onWaitingPopup === 'function') {
      onWaitingPopup({
        ...buildConsultationWaitingCopy({ otherRole, otherPartyName }),
        appointmentId: String(appointmentId),
        otherJoinedAt: joinedAt,
      });
    }
  };

  const handlePresenceChange = () => {
    const other = findOtherInChat(listChannelPresences(channel), otherRole);
    if (!other) {
      if (lastOtherJoinedAt) {
        clearDismissalsForAppointment(appointmentId);
      }
      lastOtherJoinedAt = null;
      return;
    }
    notifyIfOtherAlreadyWaiting();
  };

  channel
    .on('presence', { event: 'sync' }, handlePresenceChange)
    .on('presence', { event: 'join' }, handlePresenceChange)
    .on('presence', { event: 'leave' }, handlePresenceChange)
    .subscribe(async status => {
      if (status !== 'SUBSCRIBED') {
        return;
      }
      try {
        await channel.track({
          role: normalizedRole,
          userId: String(userId),
          displayName:
            String(displayName || '').trim() ||
            (normalizedRole === 'attorney' ? 'Attorney' : 'Client'),
          inChat: true,
          joinedAt: new Date().toISOString(),
        });
        selfTracked = true;
        notifyIfOtherAlreadyWaiting();
      } catch (error) {
        console.warn('[chat-presence] track failed', error?.message || error);
      }
    });

  return () => {
    selfTracked = false;
    channel.untrack().catch(() => {});
    supabase.removeChannel(channel);
  };
}

/**
 * Listen for the other party entering the chat while the current user is elsewhere.
 */
export function subscribeConsultationPeerEntry({
  appointmentId,
  role,
  userId,
  otherPartyName,
  isViewingChat,
  onPeerEntered,
}) {
  if (!appointmentId || !userId) {
    return () => {};
  }

  const normalizedRole = normalizeRole(role);
  const otherRole = OTHER_ROLE[normalizedRole];
  let cancelled = false;
  let lastNotifiedJoinKey = null;

  const channel = supabase.channel(`consultation-presence:${appointmentId}`, {
    config: { presence: { key: `watcher:${normalizedRole}:${userId}` } },
  });

  const evaluate = () => {
    if (cancelled) {
      return;
    }
    if (typeof isViewingChat === 'function' && isViewingChat()) {
      return;
    }

    const other = findOtherInChat(listChannelPresences(channel), otherRole);
    if (!other) {
      if (lastNotifiedJoinKey) {
        clearDismissalsForAppointment(appointmentId);
      }
      lastNotifiedJoinKey = null;
      return;
    }

    const joinedAt = other.joinedAt || other.userId || 'unknown';
    const notifyKey = peerEntryKey(appointmentId, joinedAt);
    if (notifyKey === lastNotifiedJoinKey) {
      return;
    }
    if (isConsultationPeerEntryDismissed(appointmentId, joinedAt)) {
      lastNotifiedJoinKey = notifyKey;
      return;
    }

    lastNotifiedJoinKey = notifyKey;
    if (typeof onPeerEntered === 'function') {
      onPeerEntered({
        ...buildConsultationWaitingCopy({ otherRole, otherPartyName }),
        appointmentId: String(appointmentId),
        otherJoinedAt: joinedAt,
        otherPartyName,
      });
    }
  };

  channel
    .on('presence', { event: 'sync' }, evaluate)
    .on('presence', { event: 'join' }, evaluate)
    .on('presence', { event: 'leave' }, evaluate)
    .subscribe(async status => {
      if (status !== 'SUBSCRIBED' || cancelled) {
        return;
      }
      try {
        await channel.track({
          role: normalizedRole,
          userId: String(userId),
          inChat: false,
          watching: true,
        });
      } catch {
        /* watcher may still receive presence events */
      }
      evaluate();
    });

  return () => {
    cancelled = true;
    channel.untrack().catch(() => {});
    supabase.removeChannel(channel);
  };
}

export function getConsultationChatFocusedAppointmentId(navigationRef) {
  if (!navigationRef?.isReady?.()) {
    return null;
  }
  const route = navigationRef.getCurrentRoute?.();
  if (!route) {
    return null;
  }
  if (route.name === 'EnterConsultationChat' || route.name === 'AttyConsultationMessage') {
    const id = route.params?.chatId;
    return id ? String(id) : null;
  }
  return null;
}
