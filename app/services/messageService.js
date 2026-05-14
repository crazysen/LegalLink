import { readAsStringAsync } from 'expo-file-system/legacy';
import { supabase } from './supabaseClient';
import { completeAppointmentAfterConsultationEnded } from './appointmentService';
import { bucketForMessageType, validateAttachment } from './chatTypes';

/**
 * Read a picked file into an ArrayBuffer. `fetch(uri)` is unreliable for Android
 * `content://` URIs and can return an empty body, which uploads as a blank image.
 */
async function readLocalFileAsArrayBuffer(uri) {
  const u = String(uri || '');
  if (u.startsWith('http://') || u.startsWith('https://')) {
    const response = await fetch(u);
    if (!response.ok) {
      throw new Error('Could not download file.');
    }
    const buf = await response.arrayBuffer();
    if (!buf?.byteLength) {
      throw new Error('Downloaded file was empty.');
    }
    return buf;
  }

  const base64 = await readAsStringAsync(u, {
    encoding: 'base64',
  });
  if (!base64?.length) {
    throw new Error('Could not read the selected file from this device.');
  }
  const binaryString = global.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Web/mobile contract: one `consultation_rooms` row per appointment; create open room if missing.
 * @returns {Promise<{ id: string, is_closed: boolean, video_meeting_id: string | null }>}
 */
async function getOrCreateRoom(appointmentId) {
  const { data: room, error: roomError } = await supabase
    .from('consultation_rooms')
    .select('id, is_closed, video_meeting_id')
    .eq('appointment_id', appointmentId)
    .maybeSingle();

  if (roomError) {
    throw new Error(roomError.message);
  }
  if (room?.id) {
    return {
      id: room.id,
      is_closed: Boolean(room.is_closed),
      video_meeting_id: room.video_meeting_id ?? null,
    };
  }

  const { data: newRoom, error: createError } = await supabase
    .from('consultation_rooms')
    .insert({appointment_id: appointmentId, is_closed: false})
    .select('id, is_closed, video_meeting_id')
    .single();

  if (createError || !newRoom?.id) {
    throw new Error(
      createError?.message || 'No consultation room available for this appointment.',
    );
  }
  return {
    id: newRoom.id,
    is_closed: Boolean(newRoom.is_closed),
    video_meeting_id: newRoom.video_meeting_id ?? null,
  };
}

/**
 * Handoff contract `get_or_create_consultation_room`.
 * @param {string} appointmentId
 * @returns {Promise<{ roomId: string, isClosed: boolean, videoMeetingId: string | null }>}
 */
export async function getOrCreateConsultationRoom(appointmentId) {
  const row = await getOrCreateRoom(appointmentId);
  return {
    roomId: row.id,
    isClosed: row.is_closed,
    videoMeetingId: row.video_meeting_id,
  };
}

function mapRow(row, roomId, isClosed, userId) {
  return {
    id: row.id,
    room_id: roomId,
    is_closed: isClosed,
    sender_id: row.sender_id,
    sender_name: Array.isArray(row.sender) ? row.sender[0]?.full_name : row.sender?.full_name,
    is_mine: row.sender_id === userId,
    message: row.message ?? '',
    message_type: row.message_type || 'text',
    file_bucket: row.file_bucket ?? null,
    file_path: row.file_path ?? null,
    file_name: row.file_name ?? null,
    mime_type: row.mime_type ?? null,
    file_size_bytes: row.file_size_bytes ?? null,
    created_at: row.created_at,
  };
}

/**
 * @returns {Promise<{ rows: ReturnType<typeof mapRow>[], isClosed: boolean }>}
 */
export async function getAppointmentMessages(appointmentId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('consultation_rooms')
    .select(`
      id,
      is_closed,
      messages (
        id,
        sender_id,
        message,
        message_type,
        file_bucket,
        file_path,
        file_name,
        mime_type,
        file_size_bytes,
        created_at,
        sender:sender_id(full_name)
      )
    `)
    .eq('appointment_id', appointmentId)
    .single();

  if (error || !data) {
    const room = await getOrCreateRoom(appointmentId);
    return {rows: [], isClosed: Boolean(room.is_closed)};
  }

  const list = (data.messages || []).slice().sort((a, b) =>
    String(a.created_at).localeCompare(String(b.created_at)),
  );

  const isClosed = Boolean(data.is_closed);
  const rows = list.map(row => mapRow(row, data.id, isClosed, user.id));
  return {rows, isClosed};
}

/**
 * Attorney-only (enforced by RLS). Sets consultation room to closed; no new messages allowed.
 * If no row exists yet, inserts a closed room (same as web end-session flow).
 */
export async function closeConsultationRoom(appointmentId) {
  const {data: existing, error: selErr} = await supabase
    .from('consultation_rooms')
    .select('id')
    .eq('appointment_id', appointmentId)
    .maybeSingle();

  if (selErr) {
    throw new Error(selErr.message);
  }

  if (!existing?.id) {
    const {error} = await supabase
      .from('consultation_rooms')
      .insert({appointment_id: appointmentId, is_closed: true})
      .select('id')
      .single();
    if (error) {
      throw new Error(error.message);
    }
  } else {
    const {error} = await supabase
      .from('consultation_rooms')
      .update({is_closed: true})
      .eq('id', existing.id);
    if (error) {
      throw new Error(error.message);
    }
  }

  await completeAppointmentAfterConsultationEnded(appointmentId);
}

/**
 * Attorney-only: persist post-consultation summary (Supabase RPC; enforced server-side).
 * @param {string} appointmentId
 * @param {string} summary
 */
export async function saveAttorneyConsultationSummary(appointmentId, summary) {
  if (!appointmentId) {
    throw new Error('appointmentId is required');
  }
  const text = String(summary ?? '').trim();
  const {error} = await supabase.rpc('set_attorney_consultation_summary', {
    p_appointment_id: appointmentId,
    p_summary: text,
  });
  if (error) {
    throw new Error(error.message);
  }
}

export async function sendAppointmentMessage(appointmentId, text) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const room = await getOrCreateRoom(appointmentId);
  if (room.is_closed) throw new Error('This consultation is closed.');

  const body = String(text ?? '').trim();
  if (!body) throw new Error('Message cannot be empty.');

  const { data, error } = await supabase
    .from('messages')
    .insert({
      room_id: room.id,
      sender_id: user.id,
      message: body,
      message_type: 'text',
    })
    .select('*, sender:sender_id(full_name)')
    .single();

  if (error) throw new Error(error.message);

  return mapRow(data, room.id, room.is_closed, user.id);
}

/**
 * Upload file from device URI then insert message row.
 * @param {string} appointmentId
 * @param {{ uri: string, fileName: string, mime: string, size: number, caption?: string }} asset
 */
export async function uploadAndSendChatAttachment(appointmentId, asset) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const mime = String(asset.mime || 'application/octet-stream').toLowerCase();
  const size = Number(asset.size) || 0;
  const v = validateAttachment(size, mime);
  if (!v.ok) throw new Error(v.error);

  const room = await getOrCreateRoom(appointmentId);
  if (room.is_closed) throw new Error('This consultation is closed.');

  const bucket = bucketForMessageType(mime);
  const messageType = mime.startsWith('image/') ? 'image' : 'file';
  const ext =
    asset.fileName?.split('.').pop() ||
    (messageType === 'image' ? 'jpg' : 'bin');
  const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
  const path = `${appointmentId}/${user.id}/${safeName}`;

  const arrayBuffer = await readLocalFileAsArrayBuffer(asset.uri);
  const actualSize = arrayBuffer.byteLength;
  if (actualSize === 0) {
    throw new Error('The selected file is empty or unreadable.');
  }
  const vSize = validateAttachment(actualSize, mime);
  if (!vSize.ok) {
    throw new Error(vSize.error);
  }

  const { error: upErr } = await supabase.storage
    .from(bucket)
    .upload(path, arrayBuffer, {
      contentType: mime,
      upsert: false,
    });

  if (upErr) throw new Error(upErr.message);

  const caption = String(asset.caption ?? '').trim();

  const { data, error } = await supabase
    .from('messages')
    .insert({
      room_id: room.id,
      sender_id: user.id,
      message: caption || (messageType === 'image' ? 'Photo' : 'Attachment'),
      message_type: messageType,
      file_bucket: bucket,
      file_path: path,
      file_name: asset.fileName || safeName,
      mime_type: mime,
      file_size_bytes: actualSize,
    })
    .select('*, sender:sender_id(full_name)')
    .single();

  if (error) throw new Error(error.message);

  return mapRow(data, room.id, room.is_closed, user.id);
}

export async function getSignedUrlForMessage(msg) {
  if (!msg?.file_bucket || !msg?.file_path) return null;
  const { data, error } = await supabase.storage
    .from(msg.file_bucket)
    .createSignedUrl(msg.file_path, 3600);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

/**
 * Subscribe to new messages and room closure updates.
 * @param {string} appointmentId
 * @param {{ onMessageInsert?: (mapped: ReturnType<typeof mapRow>) => void, onRoomUpdate?: (payload: { is_closed: boolean }) => void }} callbacks
 * @returns {Promise<() => void>}
 */
export async function subscribeToConsultationRoom(appointmentId, callbacks) {
  const {data: {user}} = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const room = await getOrCreateRoom(appointmentId);
  const onMessageInsert = callbacks?.onMessageInsert;
  const onRoomUpdate = callbacks?.onRoomUpdate;

  /** Matches web: messages on `chat-room:<room_id>`, room + video on `consultation-room-status:<appointment_id>`. */
  const messagesChannel = supabase
    .channel(`chat-room:${room.id}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `room_id=eq.${room.id}`,
      },
      async payload => {
        const row = payload.new;
        if (!row?.id || !onMessageInsert) return;

        const {data: prof} = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', row.sender_id)
          .single();

        const {data: roomRow} = await supabase
          .from('consultation_rooms')
          .select('is_closed')
          .eq('id', room.id)
          .single();

        const mapped = mapRow(
          {
            ...row,
            sender: prof ? {full_name: prof.full_name} : null,
          },
          room.id,
          Boolean(roomRow?.is_closed ?? room.is_closed),
          user.id,
        );
        onMessageInsert(mapped);
      },
    )
    .subscribe();

  const statusChannel = supabase
    .channel(`consultation-room-status:${appointmentId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'consultation_rooms',
        filter: `appointment_id=eq.${appointmentId}`,
      },
      payload => {
        if (!onRoomUpdate) return;
        const next = payload.new;
        if (!next) return;
        if (typeof next.is_closed === 'boolean') {
          onRoomUpdate({
            is_closed: next.is_closed,
            video_meeting_id:
              next.video_meeting_id === undefined
                ? undefined
                : next.video_meeting_id,
          });
        }
      },
    )
    .subscribe();

  return () => {
    supabase.removeChannel(messagesChannel);
    supabase.removeChannel(statusChannel);
  };
}

/** @deprecated Use subscribeToConsultationRoom */
export async function subscribeToRoomMessages(appointmentId, onInsert) {
  return subscribeToConsultationRoom(appointmentId, {onMessageInsert: onInsert});
}
