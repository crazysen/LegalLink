import { supabase } from './supabaseClient';

const OTHER_ROLE = {
  client: 'attorney',
  attorney: 'client',
};

const ROOM_RELEASE_DELAY_MS = 3000;

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

/**
 * Peer call sessions this user already rang for, joined, declined, or saw while in the chat.
 * Shared app-wide so leaving the chat/call never re-rings the same call.
 */
const seenCallKeys = new Set();

function callKey(appointmentId, callStartedAt) {
  return `${String(appointmentId)}:${String(callStartedAt)}`;
}

export function markConsultationCallSeen(appointmentId, callStartedAt) {
  if (appointmentId && callStartedAt) seenCallKeys.add(callKey(appointmentId, callStartedAt));
}

export function isConsultationCallSeen(appointmentId, callStartedAt) {
  return seenCallKeys.has(callKey(appointmentId, callStartedAt));
}

function peerLabel(otherRole, otherPartyName) {
  const label = otherRole === 'attorney' ? 'Attorney' : 'Client';
  return String(otherPartyName || '').trim() || label;
}

/** Other party was already in the chatroom when this user arrived. */
export function buildConsultationWaitingCopy({ otherRole, otherPartyName }) {
  const name = peerLabel(otherRole, otherPartyName);
  return {
    title: `${name} is in the consultation chatroom`,
    body:
      otherRole === 'attorney'
        ? 'Your attorney is already in the consultation chatroom and is waiting for you.'
        : 'Your client is already in the consultation chatroom and is waiting for you.',
  };
}

export function buildConsultationIncomingCallCopy({ otherRole, otherPartyName }) {
  const name = peerLabel(otherRole, otherPartyName);
  return {
    title: `${name} is calling you`,
    body: 'Video call for your consultation. Tap Join to connect.',
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

function earliestStamp(entries, field) {
  const stamps = entries
    .map(entry => entry?.[field])
    .filter(Boolean)
    .sort();
  return stamps[0] || null;
}

// Web chat entries carry `inChat` but no call state; current mobile entries always send a
// boolean `inCall`, so `reportsCallState` tells callers whether presence can be trusted for calls.
function summarizePeer(channel, otherRole) {
  const entries = listChannelPresences(channel).filter(entry => entry?.role === otherRole);
  const inChatEntries = entries.filter(entry => entry?.inChat !== false && !entry?.watching);
  const callEntries = entries.filter(entry => entry?.inCall === true);
  return {
    present: inChatEntries.length > 0 || callEntries.length > 0,
    inChat: inChatEntries.length > 0,
    joinedAt: earliestStamp(inChatEntries, 'joinedAt'),
    inCall: callEntries.length > 0,
    callStartedAt: earliestStamp(callEntries, 'callStartedAt'),
    reportsCallState: entries.some(entry => typeof entry?.inCall === 'boolean'),
  };
}

/**
 * One realtime channel per consultation. Supabase returns the same channel object for a
 * repeated topic, so chat screens and the app-wide watcher must share it (ref-counted).
 */
const rooms = new Map();

function trackSelf(room) {
  if (!room.subscribed) return;
  room.channel.track({ ...room.self }).catch(error => {
    console.warn('[chat-presence] track failed', error?.message || error);
  });
}

function emitPeer(room) {
  if (!room.synced) return;
  const peer = summarizePeer(room.channel, room.otherRole);
  room.listeners.forEach(listener => {
    const prev = listener.prevPeer;
    listener.prevPeer = peer;
    listener.onPeerChange?.(peer, prev);
  });
  if (peer.inCall && room.self.inCall) {
    markConsultationCallSeen(room.id, peer.callStartedAt);
  }
}

function createRoom(appointmentId, role, userId, displayName) {
  const normalizedRole = normalizeRole(role);
  const room = {
    id: appointmentId,
    otherRole: OTHER_ROLE[normalizedRole],
    self: {
      role: normalizedRole,
      userId: String(userId),
      displayName:
        String(displayName || '').trim() ||
        (normalizedRole === 'attorney' ? 'Attorney' : 'Client'),
      inChat: false,
      watching: true,
      joinedAt: null,
      inCall: false,
      callStartedAt: null,
    },
    chatRefs: 0,
    listeners: new Set(),
    subscribed: false,
    synced: false,
    releaseTimer: null,
    channel: null,
  };

  room.channel = supabase.channel(`consultation-presence:${appointmentId}`, {
    config: { presence: { key: `${normalizedRole}:${userId}` } },
  });

  room.channel
    .on('presence', { event: 'sync' }, () => {
      room.synced = true;
      emitPeer(room);
    })
    .on('presence', { event: 'join' }, () => emitPeer(room))
    .on('presence', { event: 'leave' }, () => emitPeer(room))
    .on('broadcast', { event: 'call-declined' }, ({ payload }) => {
      if (payload?.toRole !== room.self.role) return;
      room.listeners.forEach(listener => listener.onCallDeclined?.(payload));
    })
    .subscribe(status => {
      if (status !== 'SUBSCRIBED') {
        room.subscribed = false;
        return;
      }
      room.subscribed = true;
      trackSelf(room);
    });

  return room;
}

function destroyRoom(room) {
  rooms.delete(room.id);
  room.subscribed = false;
  room.channel.untrack().catch(() => {});
  supabase.removeChannel(room.channel);
}

function setChatRefs(room, delta) {
  const wasInChat = room.chatRefs > 0;
  room.chatRefs = Math.max(0, room.chatRefs + delta);
  const inChat = room.chatRefs > 0;
  if (inChat === wasInChat) return;
  room.self.inChat = inChat;
  room.self.watching = !inChat;
  room.self.joinedAt = inChat ? new Date().toISOString() : null;
  if (!inChat) {
    room.self.inCall = false;
    room.self.callStartedAt = null;
  }
  trackSelf(room);
}

/**
 * Joins the shared presence room for one consultation.
 * `inChat: true` marks this user as inside the chatroom (chat screens); watchers pass false.
 * `onPeerChange(peer, prevPeer)` fires on every presence change; prevPeer is null on the first call.
 */
export function joinConsultationRoom({
  appointmentId,
  role,
  userId,
  displayName,
  inChat = false,
  onPeerChange,
  onCallDeclined,
}) {
  if (!appointmentId || !userId) {
    return {
      setInCall: () => {},
      sendCallDeclined: () => {},
      release: () => {},
    };
  }

  const id = String(appointmentId);
  let room = rooms.get(id);
  if (room && room.self.userId !== String(userId)) {
    destroyRoom(room);
    room = null;
  }
  if (!room) {
    room = createRoom(id, role, userId, displayName);
    rooms.set(id, room);
  }
  if (room.releaseTimer) {
    clearTimeout(room.releaseTimer);
    room.releaseTimer = null;
  }

  const listener = { onPeerChange, onCallDeclined, prevPeer: null };
  room.listeners.add(listener);
  if (inChat) setChatRefs(room, 1);
  if (room.synced) emitPeer(room);

  const activeRoom = room;
  let released = false;

  return {
    setInCall: inCall => {
      if (released) return;
      const next = Boolean(inCall);
      if (activeRoom.self.inCall === next) return;
      activeRoom.self.inCall = next;
      activeRoom.self.callStartedAt = next ? new Date().toISOString() : null;
      trackSelf(activeRoom);
    },
    sendCallDeclined: () => {
      if (released || !activeRoom.subscribed) return;
      activeRoom.channel
        .send({
          type: 'broadcast',
          event: 'call-declined',
          payload: {
            fromRole: activeRoom.self.role,
            toRole: activeRoom.otherRole,
            name: activeRoom.self.displayName,
          },
        })
        .catch(() => {});
    },
    release: () => {
      if (released) return;
      released = true;
      activeRoom.listeners.delete(listener);
      if (inChat) setChatRefs(activeRoom, -1);
      if (activeRoom.listeners.size > 0 || activeRoom.releaseTimer) return;
      activeRoom.releaseTimer = setTimeout(() => {
        activeRoom.releaseTimer = null;
        if (activeRoom.listeners.size === 0 && rooms.get(activeRoom.id) === activeRoom) {
          destroyRoom(activeRoom);
        }
      }, ROOM_RELEASE_DELAY_MS);
    },
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

export function isOnVideoCallScreen(navigationRef) {
  if (!navigationRef?.isReady?.()) return false;
  return navigationRef.getCurrentRoute?.()?.name === 'ConsultationVideoCall';
}
