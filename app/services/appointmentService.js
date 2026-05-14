import { supabase } from './supabaseClient';
import {
  createAppointmentBooking,
  fetchAvailability as fetchAvailabilityFromUserApi,
} from './userApi';

/**
 * Hourly grid labels — must match AttyAvailabilityManager ALL_SLOTS.
 */
export const HOURLY_CONSULTATION_SLOT_LABELS = [
  '08:00 AM',
  '09:00 AM',
  '10:00 AM',
  '11:00 AM',
  '12:00 PM',
  '01:00 PM',
  '02:00 PM',
  '03:00 PM',
  '04:00 PM',
  '05:00 PM',
  '06:00 PM',
];

function parseSlotTimeToMinutes(label) {
  const m = String(label)
    .trim()
    .replace(/\s+/g, ' ')
    .match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) {
    return null;
  }
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ap = m[3].toUpperCase();
  if (ap === 'PM' && h < 12) {
    h += 12;
  }
  if (ap === 'AM' && h === 12) {
    h = 0;
  }
  return h * 60 + min;
}

/**
 * Maps DB / ISO-derived times to one canonical label (e.g. "8:00 AM" → "08:00 AM").
 */
export function normalizeSlotTimeLabel(t) {
  if (t == null || t === '') {
    return '';
  }
  const s = String(t).trim().replace(/\s+/g, ' ');
  const mins = parseSlotTimeToMinutes(s);
  if (mins === null) {
    return s;
  }
  let best = HOURLY_CONSULTATION_SLOT_LABELS[0];
  let bestDiff = Infinity;
  for (const label of HOURLY_CONSULTATION_SLOT_LABELS) {
    const slotMins = parseSlotTimeToMinutes(label);
    if (slotMins === null) {
      continue;
    }
    const d = Math.abs(slotMins - mins);
    if (d < bestDiff) {
      bestDiff = d;
      best = label;
    }
  }
  return best;
}

/**
 * Local calendar date as YYYY-MM-DD (device timezone).
 */
export function formatLocalDateString(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) {
    return '';
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Start of the given slot on `selectedDate` in local time, or null if time is invalid.
 */
export function getLocalDateTimeForSlot(selectedDate, timeStr) {
  if (!(selectedDate instanceof Date) || Number.isNaN(selectedDate.getTime())) {
    return null;
  }
  const normalized = normalizeSlotTimeLabel(String(timeStr));
  const mins = parseSlotTimeToMinutes(normalized);
  if (mins === null) {
    return null;
  }
  const h = Math.floor(mins / 60);
  const min = mins % 60;
  return new Date(
    selectedDate.getFullYear(),
    selectedDate.getMonth(),
    selectedDate.getDate(),
    h,
    min,
    0,
    0,
  );
}

/**
 * True when the slot starts strictly after `now` (filters same-day past hours like 8 AM when it is 10 AM).
 */
export function isConsultationSlotInTheFuture(selectedDate, timeStr, now = new Date()) {
  const slot = getLocalDateTimeForSlot(selectedDate, timeStr);
  if (!slot || Number.isNaN(slot.getTime())) {
    return false;
  }
  return slot.getTime() > now.getTime();
}

async function notifyClientReschedulePush(appointmentId) {
  try {
    const { error } = await supabase.functions.invoke('send-reschedule-push', {
      body: { appointment_id: appointmentId },
    });
    if (error) {
      console.warn('send-reschedule-push:', error.message);
    }
  } catch (e) {
    console.warn('send-reschedule-push:', e?.message ?? e);
  }
}

const APPOINTMENTS_CACHE_TTL_MS = 15000;
let appointmentsCache = {
  data: null,
  updatedAt: 0,
};

function invalidateAppointmentsCache() {
  appointmentsCache = {
    data: null,
    updatedAt: 0,
  };
}

/** Original booking notes without any appended "Reschedule reason:" blocks. */
function stripRescheduleBlocks(notes) {
  if (!notes || typeof notes !== 'string') {
    return '';
  }
  const parts = notes.split('\n\nReschedule reason:');
  return parts[0].trim();
}

/**
 * Replaces previous reschedule reasons with one latest block (avoids duplicate lines in DB).
 */
export function mergeRescheduleNotes(existingNotes, reason) {
  const base = stripRescheduleBlocks(existingNotes);
  const r = String(reason || '').trim();
  if (!r) {
    return base || null;
  }
  const block = `Reschedule reason: ${r}`;
  return base ? `${base}\n\n${block}` : block;
}

/** Collapses legacy duplicate "Reschedule reason:" blocks to base + latest only. */
export function formatAppointmentNotesForDisplay(notes) {
  if (!notes?.trim()) {
    return '';
  }
  const parts = notes.split('\n\nReschedule reason:').map(s => s.trim()).filter(Boolean);
  if (parts.length <= 1) {
    return notes.trim();
  }
  const base = parts[0];
  const latest = parts[parts.length - 1];
  return base ? `${base}\n\nReschedule reason: ${latest}` : `Reschedule reason: ${latest}`;
}

export function getLatestRescheduleReason(notes) {
  if (!notes?.includes('Reschedule reason:')) {
    return '';
  }
  const parts = notes.split('\n\nReschedule reason:');
  return parts.length > 1 ? parts[parts.length - 1].trim() : '';
}

/**
 * Parses ISO / naive local timestamps the same way as list screens.
 * @returns {Date|null}
 */
export function parseScheduleStringToDate(isoDateTime) {
  if (!isoDateTime) {
    return null;
  }
  const rawValue = String(isoDateTime).trim();
  const hasTimezoneInfo = /([zZ]|[+-]\d{2}:?\d{2})$/.test(rawValue);
  let value;
  if (hasTimezoneInfo) {
    const normalizedValue = rawValue.replace(' ', 'T').replace(/\+00$/, 'Z');
    value = new Date(normalizedValue);
  } else {
    const localMatch = rawValue.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
    if (localMatch) {
      value = new Date(
        Number(localMatch[1]),
        Number(localMatch[2]) - 1,
        Number(localMatch[3]),
        Number(localMatch[4]),
        Number(localMatch[5]),
      );
    } else {
      value = new Date(rawValue);
    }
  }
  if (!value || Number.isNaN(value.getTime())) {
    return null;
  }
  return value;
}

export function formatScheduledAtDisplay(isoDateTime) {
  const value = parseScheduleStringToDate(isoDateTime);
  if (!value) {
    return {date: '—', time: '—'};
  }
  return {
    date: value.toLocaleDateString(),
    time: value.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}),
  };
}

/** Paid bookings behave as confirmed (aligned with payment-first flow). */
export function getEffectiveAppointmentStatus(item) {
  const s = (item?.status ?? 'pending').toLowerCase();
  if (s === 'pending' && item?.payment_is_paid) {
    return 'confirmed';
  }
  return s;
}

/** Epoch ms for sorting; uses scheduled_at, then updated_at, then created_at. */
export function parseAppointmentScheduleMs(item) {
  const raw =
    item?.scheduled_at ?? item?.updated_at ?? item?.created_at ?? null;
  if (!raw) {
    return null;
  }
  const d = parseScheduleStringToDate(raw);
  return d ? d.getTime() : null;
}

export function isAppointmentCompleted(item) {
  return getEffectiveAppointmentStatus(item) === 'completed';
}

export function isAppointmentCancelled(item) {
  return getEffectiveAppointmentStatus(item) === 'cancelled';
}

/** Client dashboard queue: active bookings only (not completed, not cancelled). */
export function isClientQueueItem(item) {
  if (isAppointmentCancelled(item)) {
    return false;
  }
  if (isAppointmentCompleted(item)) {
    return false;
  }
  return true;
}

/** Attorney dashboard queue: confirmed or rescheduled (excludes unpaid pending). */
export function isAttorneyQueueItem(item) {
  const e = getEffectiveAppointmentStatus(item);
  return e === 'confirmed' || e === 'rescheduled';
}

/** True when schedule is strictly after `now` (upcoming appointments list + count). */
export function isUpcomingBySchedule(item, now = new Date()) {
  const ms = parseAppointmentScheduleMs(item);
  if (ms == null || Number.isNaN(ms)) {
    return false;
  }
  return ms > now.getTime();
}

/** For consultation chat timer (scheduled start + duration + grace). */
export async function getAppointmentConsultationMeta(appointmentId) {
  const { data, error } = await supabase
    .from('appointments')
    .select('scheduled_at, duration_minutes')
    .eq('id', appointmentId)
    .single();

  if (error) {
    throw new Error(error.message);
  }

  const dm = Number(data?.duration_minutes);
  return {
    scheduled_at: data?.scheduled_at,
    duration_minutes: dm > 0 ? dm : 60,
  };
}

function appointmentTransactionsArePaid(transactions) {
  if (transactions == null) {
    return false;
  }
  const list = Array.isArray(transactions) ? transactions : [transactions];
  return list.some(t => String(t?.payment_status ?? '').toLowerCase() === 'paid');
}

export async function getMyAppointments(options = {}) {
  const force = Boolean(options?.force);
  const cacheIsFresh = Array.isArray(appointmentsCache.data) && Date.now() - appointmentsCache.updatedAt < APPOINTMENTS_CACHE_TTL_MS;

  if (!force && cacheIsFresh) {
    return appointmentsCache.data;
  }

  const {
    data: {session},
  } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) {
    return [];
  }

  const { data, error } = await supabase
    .from('appointments')
    .select(`
      *,
      client:client_id (full_name),
      attorney:attorney_id (full_name),
      transactions (payment_status)
    `)
    .or(`client_id.eq.${user.id},attorney_id.eq.${user.id}`)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  const mapped = (data || []).map(row => {
    const payment_is_paid = appointmentTransactionsArePaid(row.transactions);
    const {transactions: _tx, ...rest} = row;
    return {
      ...rest,
      client_name: Array.isArray(row.client) ? row.client[0]?.full_name : row.client?.full_name,
      attorney_name: Array.isArray(row.attorney) ? row.attorney[0]?.full_name : row.attorney?.full_name,
      payment_is_paid,
    };
  });

  // Web (and other) flows may leave status as pending even after payment; sync so chat room + UI match mobile paid-first behavior.
  const toConfirm = mapped.filter(
    r =>
      r.attorney_id === user.id &&
      String(r.status ?? '').toLowerCase() === 'pending' &&
      r.payment_is_paid,
  );
  let result = mapped;
  if (toConfirm.length > 0) {
    const ids = toConfirm.map(r => r.id);
    const now = new Date().toISOString();
    const {error: syncErr} = await supabase
      .from('appointments')
      .update({
        status: 'confirmed',
        updated_at: now,
      })
      .in('id', ids);
    if (!syncErr) {
      const idSet = new Set(ids);
      result = mapped.map(r =>
        idSet.has(r.id) ? {...r, status: 'confirmed', updated_at: now} : r,
      );
    }
  }

  appointmentsCache = {
    data: result,
    updatedAt: Date.now(),
  };

  return appointmentsCache.data;
}

/**
 * Paid consultation booking — uses the same Supabase path as the web app (`createAppointmentBooking`).
 */
export async function createAppointment(payload) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('Not authenticated');
  }

  if (payload?.slot_date && payload?.slot_time) {
    const parts = String(payload.slot_date)
      .split('-')
      .map(Number);
    if (parts.length === 3 && !parts.some(Number.isNaN)) {
      const day = new Date(parts[0], parts[1] - 1, parts[2]);
      if (!isConsultationSlotInTheFuture(day, payload.slot_time)) {
        throw new Error(
          'This time slot has already passed. Please choose a later time.',
        );
      }
    }
  } else if (payload?.scheduled_at) {
    const inst = new Date(payload.scheduled_at).getTime();
    if (Number.isNaN(inst) || inst <= Date.now()) {
      throw new Error(
        'This time slot has already passed. Please choose a later time.',
      );
    }
  }

  const slotId = payload?.slot_id;
  if (!slotId) {
    throw new Error(
      'Missing time slot. Go back and select an available slot again.',
    );
  }

  const paymentMethod = String(
    payload?.payment_method || 'gcash',
  ).toLowerCase();
  const paymentReference = payload?.payment_reference || null;

  await createAppointmentBooking({
    clientId: user.id,
    attorneyId: payload.attorney_id,
    slotId,
    title: payload.title || 'Legal Consultation',
    notes: payload.notes || null,
    amount: Number(payload.amount || 0),
    paymentMethod,
    paymentCode: paymentReference,
    paymentReference,
    payload: {
      attorney_id: payload.attorney_id,
      title: payload.title || 'Legal Consultation',
      notes: payload.notes ?? null,
      scheduled_at: payload.scheduled_at,
      slot_date: payload.slot_date ?? null,
      slot_time: payload.slot_time ?? null,
      slot_id: slotId,
      amount: Number(payload.amount || 0),
      duration_minutes: Number(payload.duration_minutes || 60),
    },
  });

  invalidateAppointmentsCache();
  return { success: true };
}

/** Local calendar date + slot label to match availability_slots.time (e.g. 08:00 AM). */
export function scheduledAtToLocalSlotDateTime(iso) {
  if (!iso) {
    return { date: null, time: null };
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return { date: null, time: null };
  }
  const y = d.getFullYear();
  const mo = d.getMonth();
  const day = d.getDate();
  const dateStr = `${y}-${String(mo + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const h = d.getHours();
  const min = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  let h12 = h % 12;
  if (h12 === 0) {
    h12 = 12;
  }
  const rawTime = `${String(h12).padStart(2, '0')}:${String(min).padStart(2, '0')} ${ampm}`;
  const timeStr = normalizeSlotTimeLabel(rawTime);
  return { date: dateStr, time: timeStr };
}

async function releaseAvailabilityForAppointment(appt) {
  if (!appt?.attorney_id) {
    return;
  }

  const tryDirectBySlotId = async () => {
    if (!appt.slot_id) {
      return false;
    }
    const { error } = await supabase
      .from('availability_slots')
      .update({ is_booked: false, updated_at: new Date().toISOString() })
      .eq('id', appt.slot_id);
    return !error;
  };

  const tryDirectByDateTime = async (dateStr, ...timeVariants) => {
    const seen = new Set();
    const variants = [];
    for (const tv of timeVariants) {
      const t = typeof tv === 'string' ? tv.trim() : tv;
      if (!t || seen.has(t)) {
        continue;
      }
      seen.add(t);
      variants.push(t);
    }
    for (const time of variants) {
      const { error } = await supabase
        .from('availability_slots')
        .update({ is_booked: false, updated_at: new Date().toISOString() })
        .eq('attorney_id', appt.attorney_id)
        .eq('date', dateStr)
        .eq('time', time);
      if (!error) {
        return true;
      }
    }
    return false;
  };

  try {
    if (await tryDirectBySlotId()) {
      return;
    }

    if (appt.slot_id) {
      const { error: rpcSlotErr } = await supabase.rpc('release_availability_slot_by_id', {
        p_slot_id: appt.slot_id,
      });
      if (!rpcSlotErr) {
        return;
      }
    }

    const { date: slotDate, time: slotTimeNorm } = scheduledAtToLocalSlotDateTime(appt.scheduled_at);
    if (!slotDate || !slotTimeNorm) {
      return;
    }

    const rawFromIso = scheduledAtToLocalSlotDateTimeRaw(appt.scheduled_at);

    if (
      await tryDirectByDateTime(
        slotDate,
        slotTimeNorm,
        rawFromIso?.time,
        normalizeSlotTimeLabel(rawFromIso?.time || ''),
      )
    ) {
      return;
    }

    const { error: rpcErr } = await supabase.rpc('release_slot_booked', {
      p_attorney_id: appt.attorney_id,
      p_date: slotDate,
      p_time: slotTimeNorm,
    });
    if (!rpcErr) {
      return;
    }

    if (rawFromIso?.time && rawFromIso.time !== slotTimeNorm) {
      await supabase.rpc('release_slot_booked', {
        p_attorney_id: appt.attorney_id,
        p_date: slotDate,
        p_time: rawFromIso.time,
      });
    }
  } catch (e) {
    console.warn('releaseAvailabilityForAppointment:', e?.message ?? e);
  }
}

/** Same as scheduledAtToLocalSlotDateTime but without normalizing time (for release fallbacks). */
function scheduledAtToLocalSlotDateTimeRaw(iso) {
  if (!iso) {
    return { date: null, time: null };
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return { date: null, time: null };
  }
  const y = d.getFullYear();
  const mo = d.getMonth();
  const day = d.getDate();
  const dateStr = `${y}-${String(mo + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const h = d.getHours();
  const min = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  let h12 = h % 12;
  if (h12 === 0) {
    h12 = 12;
  }
  const timeStr = `${String(h12).padStart(2, '0')}:${String(min).padStart(2, '0')} ${ampm}`;
  return { date: dateStr, time: timeStr };
}

export async function updateAppointmentStatus(appointmentId, status) {
  const normalized = String(status).toLowerCase();

  const { data: appt, error: fetchErr } = await supabase
    .from('appointments')
    .select('id, attorney_id, slot_id, scheduled_at')
    .eq('id', appointmentId)
    .single();

  if (fetchErr) {
    throw new Error(fetchErr.message);
  }

  const { error } = await supabase
    .from('appointments')
    .update({
      status: normalized,
      updated_at: new Date().toISOString(),
    })
    .eq('id', appointmentId);

  if (error) {
    throw new Error(error.message);
  }

  if (normalized === 'completed' || normalized === 'cancelled') {
    await releaseAvailabilityForAppointment(appt);
  }

  invalidateAppointmentsCache();
  return { success: true };
}

/**
 * When the attorney ends the consultation (chat room closed), mark the booking completed
 * so client "My Appointments" no longer shows CONFIRMED.
 */
/**
 * Time labels (normalized) already used on this calendar day by other non-terminal appointments.
 */
async function fetchTakenSlotTimeLabelsForAttorneyDate(
  attorneyId,
  dateStr,
  excludeAppointmentId,
) {
  if (!attorneyId || !dateStr) {
    return new Set();
  }

  const { data: rows, error } = await supabase
    .from('appointments')
    .select('id, scheduled_at, status')
    .eq('attorney_id', attorneyId);

  if (error) {
    throw new Error(error.message);
  }

  const taken = new Set();
  for (const row of rows || []) {
    if (excludeAppointmentId && row.id === excludeAppointmentId) {
      continue;
    }
    const st = (row.status ?? '').toLowerCase();
    if (st === 'completed' || st === 'cancelled') {
      continue;
    }
    const { date, time } = scheduledAtToLocalSlotDateTime(row.scheduled_at);
    if (date === dateStr && time) {
      taken.add(time);
    }
  }
  return taken;
}

/**
 * Hourly slot labels the attorney can pick for this day when rescheduling `excludeAppointmentId`
 * (excludes slots held by any other active appointment).
 */
export async function getAvailableRescheduleSlotLabels(
  attorneyId,
  excludeAppointmentId,
  dayDate,
) {
  if (
    !attorneyId ||
    !excludeAppointmentId ||
    !(dayDate instanceof Date) ||
    Number.isNaN(dayDate.getTime())
  ) {
    return HOURLY_CONSULTATION_SLOT_LABELS.filter(t =>
      isConsultationSlotInTheFuture(dayDate, t),
    );
  }

  const y = dayDate.getFullYear();
  const mo = String(dayDate.getMonth() + 1).padStart(2, '0');
  const day = String(dayDate.getDate()).padStart(2, '0');
  const dateStr = `${y}-${mo}-${day}`;

  const taken = await fetchTakenSlotTimeLabelsForAttorneyDate(
    attorneyId,
    dateStr,
    excludeAppointmentId,
  );

  return HOURLY_CONSULTATION_SLOT_LABELS.filter(t => {
    if (!isConsultationSlotInTheFuture(dayDate, t)) {
      return false;
    }
    const norm = normalizeSlotTimeLabel(t);
    return !taken.has(norm);
  });
}

export async function completeAppointmentAfterConsultationEnded(appointmentId) {
  const { data: appt, error: fetchErr } = await supabase
    .from('appointments')
    .select('id, attorney_id, slot_id, scheduled_at')
    .eq('id', appointmentId)
    .single();

  if (fetchErr) {
    throw new Error(fetchErr.message);
  }

  const { error } = await supabase
    .from('appointments')
    .update({
      status: 'completed',
      updated_at: new Date().toISOString(),
    })
    .eq('id', appointmentId)
    .in('status', ['confirmed', 'rescheduled']);

  if (error) {
    throw new Error(error.message);
  }

  await releaseAvailabilityForAppointment(appt);

  invalidateAppointmentsCache();
}

export async function rescheduleAppointment(appointmentId, scheduledAt, reason) {
  const scheduledIso =
    typeof scheduledAt === 'string'
      ? scheduledAt
      : new Date(scheduledAt).toISOString();

  const { data: appt, error: fetchErr } = await supabase
    .from('appointments')
    .select('id, attorney_id, slot_id, scheduled_at, notes')
    .eq('id', appointmentId)
    .single();

  if (fetchErr) {
    throw new Error(fetchErr.message);
  }

  const { date: newDateStr, time: newTimeRaw } =
    scheduledAtToLocalSlotDateTime(scheduledIso);
  if (!newDateStr || !newTimeRaw) {
    throw new Error('Invalid date and time for reschedule.');
  }

  const newTimeNorm = normalizeSlotTimeLabel(newTimeRaw);
  const parts = newDateStr.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    throw new Error('Invalid date for reschedule.');
  }
  const newDay = new Date(parts[0], parts[1] - 1, parts[2]);
  if (!isConsultationSlotInTheFuture(newDay, newTimeNorm)) {
    throw new Error('Please choose a future date and time.');
  }

  const taken = await fetchTakenSlotTimeLabelsForAttorneyDate(
    appt.attorney_id,
    newDateStr,
    appointmentId,
  );
  if (taken.has(newTimeNorm)) {
    throw new Error(
      'This time slot is already booked by another client. Please choose a different time.',
    );
  }

  const newNotes = mergeRescheduleNotes(appt?.notes ?? '', reason);

  await releaseAvailabilityForAppointment(appt);

  const { error } = await supabase
    .from('appointments')
    .update({
      status: 'rescheduled',
      scheduled_at: scheduledIso,
      notes: newNotes,
      updated_at: new Date().toISOString(),
    })
    .eq('id', appointmentId);

  if (error) {
    throw new Error(error.message);
  }

  const { error: markErr } = await supabase.rpc('mark_slot_booked', {
    p_attorney_id: appt.attorney_id,
    p_date: newDateStr,
    p_time: newTimeNorm,
  });
  if (markErr) {
    console.warn('mark_slot_booked after reschedule:', markErr.message);
  }

  const { data: slotRow } = await supabase
    .from('availability_slots')
    .select('id')
    .eq('attorney_id', appt.attorney_id)
    .eq('date', newDateStr)
    .eq('time', newTimeNorm)
    .maybeSingle();

  if (slotRow?.id) {
    await supabase
      .from('appointments')
      .update({ slot_id: slotRow.id, updated_at: new Date().toISOString() })
      .eq('id', appointmentId);
  }

  invalidateAppointmentsCache();
  await notifyClientReschedulePush(appointmentId);
  return { success: true };
}

/**
 * Client slot picker — aligned with web `fetchAvailability` (same table + shapes).
 */
export async function getAvailability(attorneyId, date) {
  const rows = await fetchAvailabilityFromUserApi(attorneyId, date);
  return rows
    .map(r => {
      let timeStr = '';
      if (r.time) {
        timeStr = normalizeSlotTimeLabel(String(r.time).trim());
      } else if (r.startTime) {
        const {time} = scheduledAtToLocalSlotDateTime(r.startTime);
        timeStr = time ? normalizeSlotTimeLabel(time) : '';
      }
      return {
        id: r.id,
        date: r.date || date,
        time: timeStr,
      };
    })
    .filter(s => s.id && s.time);
}

function normalizeAvailabilityDate(d) {
  if (d == null || d === '') {
    return '';
  }
  if (d instanceof Date && !Number.isNaN(d.getTime())) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  const s = typeof d === 'string' ? d.trim() : String(d).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) {
    return m[1];
  }
  return s.length >= 10 ? s.slice(0, 10) : s;
}

/**
 * All slots for an attorney calendar (open + booked). Used by attorney availability UI only.
 * @param {string} attorneyId profiles.id
 * @returns {Promise<Array<{ date: string, time: string, is_booked: boolean }>>}
 */
export async function getAttorneyAvailabilitySlots(attorneyId) {
  if (!attorneyId) return [];

  const { data, error } = await supabase
    .from('availability_slots')
    .select('date, time, is_booked')
    .eq('attorney_id', attorneyId)
    .order('date', { ascending: true })
    .order('time', { ascending: true });

  if (error) throw new Error(error.message);
  const rows = data || [];
  return rows.map(r => ({
    ...r,
    date: normalizeAvailabilityDate(r.date),
    time: normalizeSlotTimeLabel(
      typeof r.time === 'string' ? r.time.trim() : String(r.time ?? ''),
    ),
  }));
}

/**
 * `date|time` keys for completed consultations (attorney grid — "Completed" vs "Booked").
 */
export async function getAttorneyCompletedConsultationSlotKeys(attorneyId) {
  if (!attorneyId) {
    return [];
  }

  const { data, error } = await supabase
    .from('appointments')
    .select('scheduled_at')
    .eq('attorney_id', attorneyId)
    .eq('status', 'completed');

  if (error) {
    throw new Error(error.message);
  }

  const keys = [];
  (data || []).forEach(row => {
    const { date, time } = scheduledAtToLocalSlotDateTime(row.scheduled_at);
    if (date && time) {
      keys.push(`${date}|${time}`);
    }
  });
  return keys;
}

export async function setAvailability(date, slots) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const now = new Date();
  const ymd = String(date)
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!ymd) {
    throw new Error('Invalid date.');
  }
  const dayDate = new Date(
    Number(ymd[1]),
    Number(ymd[2]) - 1,
    Number(ymd[3]),
  );
  if (Number.isNaN(dayDate.getTime())) {
    throw new Error('Invalid date.');
  }
  for (const t of slots || []) {
    if (!isConsultationSlotInTheFuture(dayDate, t, now)) {
      throw new Error(
        'You cannot offer availability in the past. Pick today or a later date, and only future hours.',
      );
    }
  }

  // Delete all unbooked slots for this date first
  await supabase
    .from('availability_slots')
    .delete()
    .eq('attorney_id', user.id)
    .eq('date', date)
    .eq('is_booked', false);

  if (!slots || slots.length === 0) return [];

  // Verify which ones are already booked to avoid overwriting them
  const { data: booked } = await supabase
    .from('availability_slots')
    .select('time')
    .eq('attorney_id', user.id)
    .eq('date', date)
    .eq('is_booked', true);

  const bookedTimes = booked?.map(b => b.time) || [];
  
  // Insert slots that are not already booked
  const toInsert = slots
    .filter(t => !bookedTimes.includes(t))
    .map(time => ({
      attorney_id: user.id,
      date: date,
      time: time,
      is_booked: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));

  if (toInsert.length > 0) {
    const { error } = await supabase.from('availability_slots').insert(toInsert);
    if (error) throw new Error(error.message);
  }

  return await getAvailability(user.id, date);
}

export async function setWeeklyAvailability(startDate, endDate, slots) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const now = new Date();

  // Delete all unbooked slots for this week first
  await supabase
    .from('availability_slots')
    .delete()
    .eq('attorney_id', user.id)
    .gte('date', startDate)
    .lte('date', endDate)
    .eq('is_booked', false);

  if (!slots || slots.length === 0) return true;

  // Verify which ones are already booked to avoid overwriting them
  const { data: booked } = await supabase
    .from('availability_slots')
    .select('date, time')
    .eq('attorney_id', user.id)
    .gte('date', startDate)
    .lte('date', endDate)
    .eq('is_booked', true);

  const bookedKeys = (booked || []).map(b => `${b.date}|${b.time}`);

  for (const slot of slots || []) {
    const ds = String(slot?.date ?? '')
      .trim()
      .match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!ds) {
      throw new Error('Invalid date in weekly schedule.');
    }
    const dayDate = new Date(
      Number(ds[1]),
      Number(ds[2]) - 1,
      Number(ds[3]),
    );
    if (Number.isNaN(dayDate.getTime())) {
      throw new Error('Invalid date in weekly schedule.');
    }
    if (!isConsultationSlotInTheFuture(dayDate, slot.time, now)) {
      throw new Error(
        'You cannot offer availability in the past. Pick today or a later date, and only future hours.',
      );
    }
  }

  // Insert slots that are not already booked
  const toInsert = slots
    .filter(slot => !bookedKeys.includes(`${slot.date}|${slot.time}`))
    .map(slot => ({
      attorney_id: user.id,
      date: slot.date,
      time: slot.time,
      is_booked: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));

  if (toInsert.length > 0) {
    const { error } = await supabase.from('availability_slots').insert(toInsert);
    if (error) throw new Error(error.message);
  }

  return true;
}
