import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getAppointmentMessages,
  sendAppointmentMessage,
  subscribeToConsultationRoom,
  uploadAndSendChatAttachment,
} from './messageService';

const CHAT_PREFIX = 'chat_thread_';

function buildThreadKey(threadId) {
  return `${CHAT_PREFIX}${String(threadId || 'general').trim()}`;
}

function nowTimeLabel() {
  return new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
}

function normalizeIsMine(value) {
  if (value === true || value === 1 || value === '1') return true;
  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase();
    return lowered === 'true' || lowered === 'yes';
  }
  return false;
}

export function mapApiMessage(item) {
  const createdAt = item?.created_at || new Date().toISOString();
  const isMine = normalizeIsMine(item?.is_mine);
  const type = item?.message_type || 'text';
  return {
    id: String(item?.id || `${Date.now()}-${Math.floor(Math.random() * 1000)}`),
    text: String(item?.message || item?.text || ''),
    is_closed: Boolean(item?.is_closed),
    message_type: type,
    file_bucket: item?.file_bucket ?? null,
    file_path: item?.file_path ?? null,
    file_name: item?.file_name ?? null,
    mime_type: item?.mime_type ?? null,
    file_size_bytes: item?.file_size_bytes ?? null,
    sender: isMine ? 'me' : 'client',
    time: new Date(createdAt).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}),
    created_at: createdAt,
  };
}

async function getLocalThreadMessages(threadId) {
  const key = buildThreadKey(threadId);
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

async function appendLocalThreadMessage(threadId, payload) {
  const key = buildThreadKey(threadId);
  const current = await getLocalThreadMessages(threadId);

  const message = {
    id: `${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    text: String(payload?.text || '').trim(),
    message_type: 'text',
    sender: payload?.sender === 'me' ? 'me' : 'client',
    time: payload?.time || nowTimeLabel(),
    created_at: new Date().toISOString(),
  };

  if (!message.text) {
    return current;
  }

  const next = [...current, message];
  await AsyncStorage.setItem(key, JSON.stringify(next));
  return next;
}

function mergeById(existing, incoming) {
  const byId = new Map(existing.map(m => [m.id, m]));
  byId.set(incoming.id, incoming);
  return Array.from(byId.values()).sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
}

export async function getThreadMessages(threadId) {
  try {
    const result = await getAppointmentMessages(threadId);
    if (result && Array.isArray(result.rows)) {
      const messages = result.rows.map(mapApiMessage);
      return {
        messages,
        isClosed: Boolean(result.isClosed),
      };
    }
    return {messages: [], isClosed: false};
  } catch (_) {
    const local = await getLocalThreadMessages(threadId);
    return {messages: local, isClosed: false};
  }
}

export async function appendThreadMessage(threadId, payload) {
  const text = String(payload?.text || '').trim();
  if (!text) {
    return getThreadMessages(threadId);
  }

  try {
    await sendAppointmentMessage(threadId, text);
    return getThreadMessages(threadId);
  } catch (_) {
    await appendLocalThreadMessage(threadId, payload);
    return getThreadMessages(threadId);
  }
}

/**
 * @param {string} threadId appointment id
 * @param {{ uri: string, fileName: string, mime: string, size: number, caption?: string }} asset
 */
export async function appendThreadAttachment(threadId, asset) {
  try {
    await uploadAndSendChatAttachment(threadId, asset);
    return getThreadMessages(threadId);
  } catch (e) {
    throw e;
  }
}

/**
 * Live updates: merge new messages; when the room is closed/updated, refresh isClosed and message flags.
 * @param {string} threadId
 * @param {React.Dispatch<React.SetStateAction<any[]>>} setMessages
 * @param {React.Dispatch<React.SetStateAction<boolean>>} [setIsClosed]
 * @returns {Promise<() => void>}
 */
export async function attachThreadRealtime(threadId, setMessages, setIsClosed) {
  const unsub = await subscribeToConsultationRoom(threadId, {
    onMessageInsert: mapped => {
      const ui = mapApiMessage(mapped);
      setMessages(prev => mergeById(prev, ui));
    },
    onRoomUpdate: ({is_closed}) => {
      const closed = Boolean(is_closed);
      if (setIsClosed) {
        setIsClosed(closed);
      }
      setMessages(prev =>
        prev.map(m => ({...m, is_closed: closed})),
      );
    },
  });
  return unsub;
}

export async function ensureThreadSeed(threadId, seedMessages) {
  try {
    return await getThreadMessages(threadId);
  } catch (_) {
    const existing = await getLocalThreadMessages(threadId);
    if (existing.length > 0) {
      return {messages: existing, isClosed: false};
    }

    const normalizedSeed = (Array.isArray(seedMessages) ? seedMessages : []).map(
      (item, index) => ({
        id: item?.id || `seed-${index + 1}`,
        text: String(item?.text || ''),
        message_type: 'text',
        sender: item?.sender === 'me' ? 'me' : 'client',
        time: item?.time || nowTimeLabel(),
        created_at: item?.created_at || new Date().toISOString(),
      }),
    );

    const key = buildThreadKey(threadId);
    await AsyncStorage.setItem(key, JSON.stringify(normalizedSeed));
    return {messages: normalizedSeed, isClosed: false};
  }
}
