import { readAsStringAsync } from 'expo-file-system/legacy';
import { supabase } from './supabaseClient';
import { signOutCurrentUser } from './authService';
import {
  clearMemoryProfileCache,
  getMemoryProfileCache,
  setMemoryProfileCache,
} from './profileSessionMemory';
import {
  getConsultationBranchesForAttorney,
  parseConsultationBranchFromTitle,
} from './consultationBranches';
import { requestPaymentApi } from './paymentApiClient';
import { getBundledAttorneyPhotoUri } from '../constants/attorneyPhotos';
import { resolveNotarialAmount } from '../constants/notarialFees';
import { parseNotificationImageUrl } from './announcementImages';
import {
  formatHourLabel,
  sortAvailabilitySlotsChronologically,
  toDateKey,
  getTodayDateKey,
} from './availabilityScheduleUtils';

export const signOutUser = () => signOutCurrentUser();

const DASHBOARD_CACHE_TTL_MS = 15000
const ATTORNEY_PROFILE_CACHE_TTL_MS = 120000

const clientHomeCache = new Map()
const attorneyHomeCache = new Map()
const attorneyProfileCache = new Map()

export function getCachedAttorneyProfile(userId) {
  if (!userId) return null
  const entry = attorneyProfileCache.get(userId)
  if (!entry) return null
  if (Date.now() - entry.updatedAt > ATTORNEY_PROFILE_CACHE_TTL_MS) return null
  return entry.value
}

export function setCachedAttorneyProfile(userId, value) {
  if (!userId || !value) return
  attorneyProfileCache.set(userId, { value, updatedAt: Date.now() })
}

export function invalidateAttorneyProfileCache(userId) {
  if (userId) attorneyProfileCache.delete(userId)
  else attorneyProfileCache.clear()
}

const isMissingRelationError = (error) =>
  error?.code === '42P01' || String(error?.message || '').toLowerCase().includes('does not exist')

const normalizeStringArray = (value) =>
  (Array.isArray(value) ? value : String(value || '').split(','))
    .map((item) => String(item || '').trim())
    .filter(Boolean)

const isMissingAvailabilityColumnError = (error) => {
  const message = String(error?.message || '').toLowerCase()
  return message.includes('start_time') || message.includes('end_time') || message.includes('column')
}

/** Postgres undefined_column — matches web `userApi` slot fallbacks. */
const isMissingColumnError = (error, columnName) =>
  error?.code === '42703' &&
  String(error?.message || '')
    .toLowerCase()
    .includes(String(columnName || '').toLowerCase())

/** Production schema (LegalLink-SQL): no slot_date/slot_time on appointments. */
const APPOINTMENT_ATTORNEY_LIST_SELECT =
  'id, title, scheduled_at, status, notes, attachment_url, attachment_name, amount, client:client_id(full_name)'

/** Valid `appointment_status` enum values in the deployed database. */
const APPOINTMENT_STATUS_UPCOMING = ['pending', 'confirmed', 'rescheduled']
const APPOINTMENT_STATUS_MY_APPOINTMENTS = ['confirmed', 'rescheduled']

function deriveSlotFieldsFromScheduledAt(scheduledAt) {
  if (!scheduledAt) return { slotDate: null, slotTime: null }
  const scheduled = new Date(scheduledAt)
  if (Number.isNaN(scheduled.getTime())) return { slotDate: null, slotTime: null }
  return {
    slotDate: scheduled.toISOString().slice(0, 10),
    slotTime: formatSlotTimeFromDate(scheduled),
  }
}

/** Read a picked file into an ArrayBuffer (Android-safe for content:// URIs). */
async function readLocalFileAsArrayBuffer(uri) {
  const u = String(uri || '')
  if (u.startsWith('http://') || u.startsWith('https://')) {
    const response = await fetch(u)
    if (!response.ok) {
      throw new Error('Could not download file.')
    }
    const buf = await response.arrayBuffer()
    if (!buf?.byteLength) {
      throw new Error('Downloaded file was empty.')
    }
    return buf
  }

  const base64 = await readAsStringAsync(u, { encoding: 'base64' })
  if (!base64?.length) {
    throw new Error('Could not read the selected file from this device.')
  }
  const binaryString = global.atob(base64)
  const len = binaryString.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i += 1) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return bytes.buffer
}

const sanitizeFilename = (value) =>
  String(value || 'attachment').replace(/[^a-zA-Z0-9._-]/g, '_')

const toTwoDigits = (value) => String(value).padStart(2, '0')

const normalizeSlotDateValue = (dateValue) => {
  if (dateValue instanceof Date && !Number.isNaN(dateValue.getTime())) {
    const y = dateValue.getFullYear()
    const m = String(dateValue.getMonth() + 1).padStart(2, '0')
    const day = String(dateValue.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }
  const s = String(dateValue || '').trim()
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/)
  if (m) return m[1]
  return s.length >= 10 ? s.slice(0, 10) : s
}

/**
 * Parse legacy `availability_slots.date` + `time` (e.g. 09:00 AM) — aligned with web `BookAppointment`.
 */
const parseSlotDateTime = (dateValue, timeValue) => {
  if (!timeValue) return null
  const rawTime = String(timeValue).trim()
  if (!rawTime) return null

  if (/[tT]/.test(rawTime) || rawTime.endsWith('Z')) {
    const isoParsed = new Date(rawTime)
    if (!Number.isNaN(isoParsed.getTime())) return isoParsed
  }

  const dateStr = normalizeSlotDateValue(dateValue)
  if (!dateStr) return null

  const ampmMatch = rawTime.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i)
  if (ampmMatch) {
    let hour = Number(ampmMatch[1])
    const minute = Number(ampmMatch[2])
    const meridiem = ampmMatch[3].toUpperCase()

    if (meridiem === 'PM' && hour < 12) hour += 12
    if (meridiem === 'AM' && hour === 12) hour = 0

    const parsed = new Date(`${dateStr}T${toTwoDigits(hour)}:${toTwoDigits(minute)}:00`)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  const twentyFourHourMatch = rawTime.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/)
  if (!twentyFourHourMatch) return null

  const hour = Number(twentyFourHourMatch[1])
  const minute = Number(twentyFourHourMatch[2])
  if (
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null
  }

  const parsed = new Date(`${dateStr}T${toTwoDigits(hour)}:${toTwoDigits(minute)}:00`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/** Canonical `08:00 AM` label for client booking grids (from DB row or ISO). */
const canonicalAvailabilitySlotTime = (slot, startIso) => {
  if (startIso) {
    const start = new Date(startIso)
    if (!Number.isNaN(start.getTime())) {
      const time24 = `${toTwoDigits(start.getHours())}:${toTwoDigits(start.getMinutes())}`
      return formatHourLabel(time24)
    }
  }

  const raw = String(slot?.time || '').trim()
  if (!raw) return ''

  const parsed = parseSlotDateTime(slot?.date, raw)
  if (parsed && !Number.isNaN(parsed.getTime())) {
    const time24 = `${toTwoDigits(parsed.getHours())}:${toTwoDigits(parsed.getMinutes())}`
    return formatHourLabel(time24)
  }

  return raw
}

const webPublicAssetBase = String(
  process.env.EXPO_PUBLIC_WEB_PUBLIC_URL ||
    process.env.EXPO_PUBLIC_APP_ORIGIN ||
    'https://LegalLink-web.vercel.app',
)
  .trim()
  .replace(/\/$/, '')

// Supabase host (used to build public storage URLs when relative storage paths are returned)
const supabasePublicBase = String(
  process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL || 'https://sjmmyqeqiigmclcgcadr.supabase.co',
)
  .trim()
  .replace(/\/$/, '')

function uiAvatarsFallback(name) {
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name || 'Attorney')}&background=f5a623&color=111827`
}

/** Same display string as mayy16 / web `BookAppointment` cards (`exp: '3 years experience'`). */
export function formatAttorneyExperienceLabel(_yearsExperience, _biography = '') {
  return '3 years experience'
}

/** Known roster photos (web `/assets/attorneys/*`) — always returns an absolute URL for React Native Image. */
function resolveAttorneyImageByName(name) {
  const normalized = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^atty\s+/, '')
    .trim()

  const asset = (path) =>
    webPublicAssetBase ? `${webPublicAssetBase}${path}` : null

  const jeannePhoto =
    normalized.includes('jeanne') &&
    (normalized.includes('castillo') ||
      normalized.includes('luz') ||
      normalized.includes('anarna'))
  if (jeannePhoto) {
    return asset('/assets/attorneys/jeanne-luz-castillo-anarna.jpg') || uiAvatarsFallback(name)
  }

  const alstonPhoto =
    normalized.includes('alston') &&
    (normalized.includes('kevin') || normalized.includes('anarna'))
  if (alstonPhoto) {
    return asset('/assets/attorneys/alston-kevin-anarna.jpg') || uiAvatarsFallback(name)
  }

  const allenPhoto =
    normalized.includes('allen') &&
    (normalized.includes('kristopher') || normalized.includes('anarna'))
  if (allenPhoto) {
    return asset('/assets/attorneys/allen-kristopher-anarna.png') || uiAvatarsFallback(name)
  }

  return uiAvatarsFallback(name)
}

/**
 * CMS image URL, else known attorney photo paths (same logic as web), else ui-avatars.
 * Set `EXPO_PUBLIC_WEB_PUBLIC_URL` to your deployed web origin so `/assets/attorneys/...` resolves on device.
 */
export function resolveAttorneyImage(name, preferredImageUrl) {
  const trimmed = String(preferredImageUrl || '').trim()
  const bundledUri = getBundledAttorneyPhotoUri(name)

  // Known roster: bundled files (work offline; same photos as web).
  if (bundledUri) {
    return bundledUri
  }

  if (trimmed) {
    if (/^https?:\/\//i.test(trimmed)) return trimmed

    const normalizedPath = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
    if (normalizedPath.startsWith('/assets/') && webPublicAssetBase) {
      return `${webPublicAssetBase}${normalizedPath}`
    }

    if (trimmed.startsWith('/') && webPublicAssetBase) {
      return `${webPublicAssetBase}${normalizedPath}`
    }

    const possibleStoragePath = trimmed.replace(/^\/+/, '')
    const looksLikeStorage =
      /\/.+\.[a-z]{2,}$/i.test(possibleStoragePath) ||
      possibleStoragePath.startsWith('avatars') ||
      possibleStoragePath.startsWith('public/') ||
      possibleStoragePath.includes('storage')
    if (looksLikeStorage) {
      return `${supabasePublicBase}/storage/v1/object/public/${possibleStoragePath}`
    }

    // Relative CMS path without web origin — match roster / ui-avatars (never return null).
    if (trimmed.startsWith('/') || !trimmed.includes('://')) {
      return resolveAttorneyImageByName(name)
    }

    return trimmed
  }

  return resolveAttorneyImageByName(name)
}

const isMissingGuardianColumnError = (error) => {
  const message = String(error?.message || '').toLowerCase()
  return (
    message.includes('guardian_name') ||
    message.includes('guardian_contact') ||
    message.includes('guardian_details')
  )
}

const combineDateAndTimeToIso = (dateValue, timeValue) => {
  if (!dateValue && !timeValue) return null
  const raw = String(timeValue || '').trim()
  const hasIsoDate = raw.includes('t')
  const candidate = hasIsoDate
    ? raw
    : `${String(dateValue || '').trim()}T${raw.length === 5 ? `${raw}:00` : raw}`
  const parsed = new Date(candidate)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

const resolveSlotStartIso = (slot) => {
  if (slot?.start_time) return slot.start_time
  if (slot?.date && slot?.time) {
    const parsed = parseSlotDateTime(slot.date, slot.time)
    if (parsed && !Number.isNaN(parsed.getTime())) {
      return parsed.toISOString()
    }
  }
  if (slot?.time) {
    return combineDateAndTimeToIso(slot?.date, slot?.time)
  }
  return null
}

/** Map DB rows to UI rows (labels + canonical startTime ISO). */
function mapAvailabilitySlots(data) {
  return (data || []).map((slot) => {
    const startIso = resolveSlotStartIso(slot)
    const start = new Date(startIso || '')
    const hasValidStart = !Number.isNaN(start.getTime())
    const canonicalTime = canonicalAvailabilitySlotTime(slot, startIso)
    const canonicalDate = hasValidStart
      ? normalizeSlotDateValue(start)
      : normalizeSlotDateValue(slot.date)

    const dateLabel = hasValidStart
      ? start.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
      : String(slot.date || 'TBD')

    const endForLabel = slot.end_time
      ? new Date(slot.end_time)
      : hasValidStart
        ? new Date(start.getTime() + 60 * 60 * 1000)
        : null
    const timeLabel =
      hasValidStart && endForLabel && !Number.isNaN(endForLabel.getTime())
        ? `${start.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })} - ${endForLabel.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}`
        : canonicalTime || 'TBD'

    return {
      ...slot,
      date: canonicalDate || slot.date,
      time: canonicalTime || slot.time,
      startTime: startIso,
      dateLabel,
      timeLabel,
    }
  })
}

/**
 * Open slots for one calendar day when `availability_slots` uses `start_time` (modern schema).
 */
async function fetchAvailabilitySlotsByStartTimeDay(attorneyId, dateStr) {
  const parts = String(dateStr || '')
    .trim()
    .split('-')
    .map((n) => Number(n))
  if (parts.length !== 3 || parts.some((x) => !Number.isFinite(x))) {
    return []
  }
  const [y, m, d] = parts
  const dayStart = new Date(y, m - 1, d, 0, 0, 0, 0)
  const dayEnd = new Date(y, m - 1, d + 1, 0, 0, 0, 0)

  const { data, error } = await supabase
    .from('availability_slots')
    .select('id, attorney_id, start_time, end_time, date, time, is_booked')
    .eq('attorney_id', attorneyId)
    .eq('is_booked', false)
    .gte('start_time', dayStart.toISOString())
    .lt('start_time', dayEnd.toISOString())
    .order('start_time', { ascending: true })

  if (error) {
    if (isMissingColumnError(error, 'start_time') || isMissingAvailabilityColumnError(error)) {
      return []
    }
    throw error
  }
  return data || []
}

const LANDING_CONTENT_DEFAULTS = {
  hero_title: 'Legal & Notarial Services Now in Your Pocket',
  hero_subtitle:
    'Experience the convenience of managing all your legal matters on the go. Expert advice and certified notarial services are now just a tap away.',
  services_title: 'Our Services',
  services_subtitle: 'Comprehensive legal solutions tailored for your business and personal needs.',
  attorneys_title: 'Meet Our Attorneys',
  attorneys_subtitle: 'Browse verified legal experts and choose the attorney that best matches your concern.',
}

export function normalizeRole(roleText) {
  const role = (roleText || '').toLowerCase()
  if (role === 'admin') return 'Admin'
  if (role === 'attorney') return 'Attorney'
  return 'Client'
}

export function pageFromRole(roleText) {
  const role = normalizeRole(roleText)
  if (role === 'Admin') return 'admin-home'
  if (role === 'Attorney') return 'attorney-home'
  return 'home-logged'
}

export function getCachedProfile() {
  return getMemoryProfileCache();
}

export function setCachedProfile(profile) {
  setMemoryProfileCache(profile);
}

export function clearCachedProfile() {
  clearMemoryProfileCache();
  invalidateAttorneyProfileCache();
}

export async function getCurrentSessionProfile() {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession()

  if (sessionError) throw sessionError
  if (!session?.user) {
    clearCachedProfile()
    return { session: null, profile: null }
  }

  let profileQuery = await supabase
    .from('profiles')
    .select('id, full_name, email, phone, address, role, age, guardian_name, guardian_contact, guardian_details')
    .eq('id', session.user.id)
    .maybeSingle()

  if (profileQuery.error && isMissingGuardianColumnError(profileQuery.error)) {
    profileQuery = await supabase
      .from('profiles')
      .select('id, full_name, email, phone, address, role, age')
      .eq('id', session.user.id)
      .maybeSingle()
  }

  const { data: profile, error: profileError } = profileQuery

  if (profileError) throw profileError

  let resolvedProfile = profile || {
    id: session.user.id,
    full_name: session.user.user_metadata?.full_name || '',
    email: session.user.email || '',
    phone: '',
    address: '',
    role: normalizeRole(session.user.user_metadata?.role || 'Client'),
    age: null,
    guardian_name: '',
    guardian_contact: '',
    guardian_details: '',
  }

  // Compatibility fallback: some environments store contact/address in `users`.
  if (!resolvedProfile.phone || !resolvedProfile.address) {
    const { data: usersRow, error: usersError } = await supabase
      .from('users')
      .select('id, first_name, last_name, email, phone, address, role')
      .eq('id', session.user.id)
      .maybeSingle()

    if (!usersError && usersRow) {
      const usersFullName = String(
        [usersRow.first_name, usersRow.last_name].filter(Boolean).join(' ') ||
          resolvedProfile.full_name ||
          '',
      ).trim()

      resolvedProfile = {
        ...resolvedProfile,
        full_name: usersFullName || resolvedProfile.full_name,
        email: usersRow.email || resolvedProfile.email,
        phone: usersRow.phone || resolvedProfile.phone,
        address: usersRow.address || resolvedProfile.address,
        role: normalizeRole(usersRow.role || resolvedProfile.role),
      }
    }
  }

  resolvedProfile = {
    ...resolvedProfile,
    role: normalizeRole(resolvedProfile?.role || session.user.user_metadata?.role || 'Client'),
    guardian_name: resolvedProfile?.guardian_name || '',
    guardian_contact: resolvedProfile?.guardian_contact || '',
    guardian_details:
      resolvedProfile?.guardian_details ||
      [resolvedProfile?.guardian_name, resolvedProfile?.guardian_contact].filter(Boolean).join(' | ') ||
      '',
  }

  setCachedProfile(resolvedProfile)

  return {
    session,
    profile: resolvedProfile,
  }
}

export async function upsertProfile(profile) {
  const profileId = profile?.id
  if (!profileId) throw new Error('Profile id is required.')

  const { data: updated, error: updateError } = await supabase
    .from('profiles')
    .update(profile)
    .eq('id', profileId)
    .select('id')
    .maybeSingle()

  if (updateError) throw updateError
  if (!updated?.id) {
    const { error: insertError } = await supabase.from('profiles').insert(profile)
    if (insertError) throw insertError
  }

  // Compatibility write-through: keep `users` in sync when that table exists.
  const fullName = String(profile.full_name || '').trim()
  const [firstName = '', ...lastNameParts] = fullName.split(' ').filter(Boolean)
  const lastName = lastNameParts.join(' ')

  const usersSync = await supabase.from('users').upsert(
    {
      id: profileId,
      email: profile.email || null,
      first_name: firstName || null,
      last_name: lastName || null,
      phone: profile.phone || null,
      address: profile.address || null,
      role: String(profile.role || 'Client').toLowerCase(),
    },
    { onConflict: 'id' },
  )

  // Ignore compatibility sync failures (e.g., users table missing in some setups).
  if (usersSync?.error) {
    console.warn('[LegalLink] users sync skipped:', usersSync.error.message)
  }
}

const CLIENT_CONSULTATION_QUEUE_STATUSES = new Set([
  'pending',
  'confirmed',
  'rescheduled',
])

function formatSlotTimeFromDate(date) {
  const parsed = new Date(date)
  if (Number.isNaN(parsed.getTime())) return null
  const hour = parsed.getHours()
  const minute = parsed.getMinutes()
  const period = hour >= 12 ? 'PM' : 'AM'
  const normalizedHour = hour % 12 || 12
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(normalizedHour)}:${pad(minute)} ${period}`
}

export function calendarDaysFromTodayLocal(value) {
  if (!value) return null

  let target
  if (value instanceof Date) {
    target = new Date(value)
  } else {
    const str = String(value).trim()
    const ymd = str.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (ymd) {
      target = new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]))
    } else {
      target = new Date(str)
    }
  }

  if (!target || Number.isNaN(target.getTime())) return null

  const today = new Date()
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const startOfTarget = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime()
  const msPerDay = 24 * 60 * 60 * 1000
  return Math.round((startOfTarget - startOfToday) / msPerDay)
}

function mapRowToClientConsultationQueueItem(item, paymentStatus) {
  const scheduled = item.scheduled_at ? new Date(item.scheduled_at) : null
  const hasScheduled = scheduled && !Number.isNaN(scheduled.getTime())
  const derivedSlotDate = hasScheduled ? scheduled.toISOString().slice(0, 10) : null
  const derivedSlotTime = hasScheduled ? formatSlotTimeFromDate(scheduled) : null
  const paid = String(paymentStatus || '').toLowerCase() === 'paid'

  return {
    id: item.id,
    name: item.attorney?.full_name || 'Attorney',
    area: item.title || 'Consultation',
    date: item.scheduled_at,
    time: item.scheduled_at,
    scheduledAt: item.scheduled_at || null,
    slotDate: derivedSlotDate,
    slotTime: derivedSlotTime,
    status: item.status || 'pending',
    payment: paid ? 'Paid' : 'Unpaid',
    amount: Number(item.amount || 0),
    attorney_id: item.attorney_id,
    notes: item.notes || '',
    pendingReschedule: parseReschedulePendingFromNotes(item.notes),
    payment_is_paid: paid,
    chatAccessible: isConsultationChatWindowOpen({
      status: item.status,
      scheduledAt: item.scheduled_at,
      slotDate: derivedSlotDate,
      slotTime: derivedSlotTime,
    }),
  }
}

export function invalidateClientHomeCache(userId) {
  if (userId) {
    clientHomeCache.delete(userId)
    clientHomeCache.delete(`queue:${userId}`)
    return
  }
  clientHomeCache.clear()
}

export async function fetchClientConsultationQueue(userId, options = {}) {
  if (!userId) return []

  const force = Boolean(options?.force)
  const cacheKey = `queue:${userId}`
  const cached = clientHomeCache.get(cacheKey)
  if (!force && cached && Date.now() - cached.updatedAt < DASHBOARD_CACHE_TTL_MS) {
    return cached.value
  }

  const [appointmentsRes, transactionsRes] = await Promise.all([
    supabase
      .from('appointments')
      .select('id, title, notes, scheduled_at, status, attorney_id, amount, attorney:attorney_id(full_name)')
      .eq('client_id', userId)
      .order('scheduled_at', { ascending: true }),
    supabase
      .from('transactions')
      .select('appointment_id, payment_status')
      .eq('client_id', userId),
  ])

  if (appointmentsRes.error) throw appointmentsRes.error
  if (transactionsRes.error) throw transactionsRes.error

  const paymentByAppointment = new Map(
    (transactionsRes.data || []).map((tx) => [tx.appointment_id, tx.payment_status]),
  )

  const appointments = (appointmentsRes.data || [])
    .filter((item) => {
      const status = String(item.status || '').toLowerCase()
      return CLIENT_CONSULTATION_QUEUE_STATUSES.has(status)
    })
    .map((item) => mapRowToClientConsultationQueueItem(item, paymentByAppointment.get(item.id)))

  clientHomeCache.set(cacheKey, { value: appointments, updatedAt: Date.now() })
  return appointments
}

export async function fetchClientHomeData(userId) {
  const cached = clientHomeCache.get(userId)
  if (cached && Date.now() - cached.updatedAt < DASHBOARD_CACHE_TTL_MS) {
    return cached.value
  }

  const [appointments, notificationsRes] = await Promise.all([
    fetchClientConsultationQueue(userId, { force: true }),
    supabase
      .from('notifications')
      .select('id, title, body, type, is_read, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  if (notificationsRes.error) throw notificationsRes.error

  const notifications = (notificationsRes.data || []).map((n) => ({
    id: n.id,
    type: n.type || 'general',
    title: n.title,
    desc: n.body,
    time: n.created_at ? new Date(n.created_at).toLocaleString() : 'Now',
    read: n.is_read,
  }))

  const result = { appointments, notifications }
  clientHomeCache.set(userId, { value: result, updatedAt: Date.now() })
  return result
}


export async function saveAttorneyProfile(userId, values) {
  await upsertProfile({
    id: userId,
    full_name: values.fullName,
    email: values.email,
    phone: values.phone,
    address: values.location,
    role: 'Attorney',
    updated_at: new Date().toISOString(),
  })

  const { error } = await supabase.from('attorney_profiles').upsert(
    {
      user_id: userId,
      firm_name: values.role,
      bio: values.bio,
      prc_id: values.ibpNumber,
      specialties: values.specializations,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  )

  if (error) throw error
  invalidateAttorneyProfileCache(userId)
}

export async function upsertClientProfiling(userId, values) {
  let { error } = await supabase
    .from('profiles')
    .update({
      age: Number(values.age || 0),
      address: values.address,
      guardian_name: values.guardianName || null,
      guardian_contact: values.guardianContact || null,
      guardian_details: values.guardianDetails || values.guardianName || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId)

  if (error && isMissingGuardianColumnError(error)) {
    const retry = await supabase
      .from('profiles')
      .update({
        age: Number(values.age || 0),
        address: values.address,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId)

    error = retry.error
  }

  if (error) throw error
}

const formatDateTime = (value) => {
  if (!value) return { date: 'TBD', time: 'TBD' }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return { date: 'TBD', time: 'TBD' }
  return {
    date: parsed.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }),
    time: parsed.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' }),
  }
}

const toIso = (value) => {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

const matchConcernToSpecialties = (specialties, concern) => {
  const normalizedConcern = String(concern || '').trim().toLowerCase()
  if (!normalizedConcern) return true

  const normalized = (Array.isArray(specialties) ? specialties : [])
    .map((item) => String(item || '').toLowerCase())

  return normalized.some((specialty) => specialty.includes(normalizedConcern))
}

export async function fetchAttorneyAvailabilitySlots(userId) {
  const nowIso = new Date().toISOString()
  const today = nowIso.slice(0, 10)

  let data = []
  let error = null

  const defaultShapeQuery = await supabase
    .from('availability_slots')
    .select('id, start_time, end_time, is_booked')
    .eq('attorney_id', userId)
    .eq('is_booked', false)
    .gte('start_time', nowIso)
    .order('start_time', { ascending: true })

  if (!defaultShapeQuery.error) {
    data = defaultShapeQuery.data || []
  } else if (isMissingAvailabilityColumnError(defaultShapeQuery.error)) {
    const legacyShapeQuery = await supabase
      .from('availability_slots')
      .select('id, date, time, is_booked')
      .eq('attorney_id', userId)
      .eq('is_booked', false)
      .gte('date', today)
      .order('date', { ascending: true })

    if (legacyShapeQuery.error) {
      error = legacyShapeQuery.error
    } else {
      data = legacyShapeQuery.data || []
    }
  } else {
    error = defaultShapeQuery.error
  }

  if (error) throw error

  return (data || []).map((slot) => {
    const startIso = resolveSlotStartIso(slot)
    const endIso = slot.end_time || startIso
    const start = new Date(startIso || '')
    const end = new Date(endIso || '')
    return {
      id: slot.id,
      startTime: startIso,
      endTime: endIso,
      date: Number.isNaN(start.getTime()) ? '' : start.toISOString().slice(0, 10),
      startLabel: Number.isNaN(start.getTime()) ? 'TBD' : start.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' }),
      endLabel: Number.isNaN(end.getTime()) ? 'TBD' : end.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' }),
    }
  })
}

export async function saveAttorneyAvailabilitySlots({ attorneyId, slots }) {
  const nowIso = new Date().toISOString()
  const today = nowIso.slice(0, 10)
  const normalizedSlots = (Array.isArray(slots) ? slots : [])
    .map((slot) => {
      const startIso = toIso(slot.startTime)
      const endIso = toIso(slot.endTime)
      if (!startIso || !endIso) return null
      if (new Date(endIso) <= new Date(startIso)) return null
      return {
        attorney_id: attorneyId,
        start_time: startIso,
        end_time: endIso,
        is_booked: false,
        updated_at: nowIso,
      }
    })
    .filter(Boolean)

  const clearDefault = await supabase
    .from('availability_slots')
    .delete()
    .eq('attorney_id', attorneyId)
    .eq('is_booked', false)
    .gte('start_time', nowIso)

  let usingLegacySchema = false
  if (clearDefault.error && isMissingAvailabilityColumnError(clearDefault.error)) {
    usingLegacySchema = true
    const clearLegacy = await supabase
      .from('availability_slots')
      .delete()
      .eq('attorney_id', attorneyId)
      .eq('is_booked', false)
      .gte('date', today)

    if (clearLegacy.error) throw clearLegacy.error
  } else if (clearDefault.error) {
    throw clearDefault.error
  }

  if (normalizedSlots.length === 0) return []

  if (usingLegacySchema) {
    const legacyRows = normalizedSlots
      .map((slot) => {
        const start = new Date(slot.start_time)
        if (Number.isNaN(start.getTime())) return null
        const time24 = `${toTwoDigits(start.getHours())}:${toTwoDigits(start.getMinutes())}`
        return {
          attorney_id: slot.attorney_id,
          date: normalizeSlotDateValue(start),
          time: formatHourLabel(time24),
          is_booked: false,
          updated_at: nowIso,
        }
      })
      .filter(Boolean)

    const inserted = await supabase
      .from('availability_slots')
      .insert(legacyRows)
      .select('id, date, time, is_booked')

    if (inserted.error) throw inserted.error

    return (inserted.data || []).map((row) => ({
      id: row.id,
      start_time: combineDateAndTimeToIso(row.date, row.time),
      end_time: combineDateAndTimeToIso(row.date, row.time),
      is_booked: row.is_booked,
    }))
  }

  const inserted = await supabase
    .from('availability_slots')
    .insert(normalizedSlots)
    .select('id, start_time, end_time, is_booked')

  if (inserted.error) throw inserted.error
  return inserted.data || []
}

const normalizeDigitalPaymentMethod = (method) => {
  const value = String(method || '').trim().toLowerCase()
  if (value === 'qrph' || value === 'qr_ph' || value === 'qr ph') return 'QRPh'
  throw new Error('Only QR Ph payments are supported.')
}

const normalizePaymentMethodKey = (method) => {
  const value = String(method || '').trim().toLowerCase()
  if (value === 'qrph' || value === 'qr_ph' || value === 'qr ph') return 'qrph'
  throw new Error('Only qrph payments are supported.')
}

const normalizePaymentMethodTypes = (_methodTypes, _fallbackMethod) => ['qrph']

const normalizeAppointmentStatus = (status) => {
  const value = (status || '').toLowerCase()
  if (value === 'confirmed') return 'APPROVED'
  if (value === 'rescheduled') return 'PENDING'
  if (value === 'completed') return 'COMPLETED'
  if (value === 'rejected' || value === 'cancelled') return 'REJECTED'
  return 'PENDING'
}

const CHAT_ACTIVE_APPOINTMENT_STATUSES = new Set(['confirmed', 'rescheduled'])

const CHAT_ACCESS_BLOCKED_MESSAGE =
  'Consultation chat is unavailable until the appointment status is marked as started/active.'

const parseChatScheduleDate = ({ scheduledAt, slotDate, slotTime } = {}) => {
  if (slotDate && slotTime) {
    const fromSlot = parseSlotDateTime(slotDate, slotTime)
    if (fromSlot && !Number.isNaN(fromSlot.getTime())) return fromSlot
  }

  const raw = String(scheduledAt || '').trim()
  if (!raw) return null

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw) && slotTime) {
    const fromDateAndTime = parseSlotDateTime(raw, slotTime)
    if (fromDateAndTime && !Number.isNaN(fromDateAndTime.getTime())) return fromDateAndTime
  }

  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const PH_TZ = 'Asia/Manila'

const toPhDateKey = (value) => {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: PH_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

export const buildChatScheduleBlockedMessage = ({ scheduledAt, slotDate, slotTime } = {}) => {
  const parsed = parseChatScheduleDate({ scheduledAt, slotDate, slotTime })
  if (!parsed) return CHAT_ACCESS_BLOCKED_MESSAGE

  const date = parsed.toLocaleDateString('en-PH', {
    timeZone: PH_TZ,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  return `Consultation chat opens on ${date} (any time that day, PH time).`
}

export const isConsultationChatActiveStatus = (status) =>
  CHAT_ACTIVE_APPOINTMENT_STATUSES.has(String(status || '').toLowerCase())

/**
 * Web parity for testing: room opens any hour on the scheduled calendar day
 * (Asia/Manila), not only at the exact slot time. Blocked on earlier days.
 */
export const isConsultationChatWindowOpen = ({ status, scheduledAt, slotDate, slotTime, nowValue } = {}) => {
  if (!isConsultationChatActiveStatus(status)) return false

  const scheduled = parseChatScheduleDate({ scheduledAt, slotDate, slotTime })
  if (!scheduled) return false

  const now = nowValue instanceof Date ? nowValue : new Date(nowValue || Date.now())
  if (Number.isNaN(now.getTime())) return false

  const todayKey = toPhDateKey(now)
  const consultationKey = toPhDateKey(scheduled)
  if (!todayKey || !consultationKey) return false

  // Open from the start of the scheduled day onward (same-day early entry OK).
  return todayKey >= consultationKey
}

export async function fetchClientAppointmentsData(userId) {
  const [appointmentsRes, transactionsRes] = await Promise.all([
    supabase
      .from('appointments')
      .select('id, title, notes, scheduled_at, status, amount, attorney_id, attorney:attorney_id(full_name)')
      .eq('client_id', userId)
      .order('scheduled_at', { ascending: false }),
    supabase
      .from('transactions')
      .select('appointment_id, payment_status')
      .eq('client_id', userId),
  ])

  if (appointmentsRes.error) throw appointmentsRes.error
  if (transactionsRes.error) throw transactionsRes.error

  const paymentByAppointment = new Map(
    (transactionsRes.data || []).map((tx) => [tx.appointment_id, tx.payment_status]),
  )

  return (appointmentsRes.data || []).map((item) => {
    const datetime = formatDateTime(item.scheduled_at)
    const status = normalizeAppointmentStatus(item.status)
    const paymentStatus = (paymentByAppointment.get(item.id) || 'unpaid').toLowerCase()

    return {
      id: item.id,
      attorney: item.attorney?.full_name || 'Attorney',
      attorneyId: item.attorney_id,
      specialty: item.title || 'Legal Consultation',
      date: datetime.date,
      time: datetime.time,
      type: 'Online Consultation',
      fee: `PHP ${Number(item.amount || 0).toFixed(2)}`,
      amount: Number(item.amount || 0),
      status,
      payment: paymentStatus === 'paid' ? 'PAID' : 'UNPAID',
      message:
        status === 'COMPLETED'
          ? 'Consultation Completed'
          : status === 'APPROVED'
            ? 'Ready for Payment'
            : status === 'REJECTED'
              ? 'Request Closed'
              : 'Waiting for Attorney Approval',
      description:
        item.notes ||
        (status === 'COMPLETED'
          ? 'This consultation has been completed.'
          : status === 'APPROVED'
            ? 'Your request is approved and pending payment confirmation.'
            : status === 'REJECTED'
              ? 'This request was declined or cancelled.'
              : 'Your request is still under review.'),
    }
  })
}

export async function payForAppointment({ appointmentId, clientId, attorneyId, amount, method, methodTypes }) {
  const paymentMethod = normalizePaymentMethodKey(method)
  const paymentMethodTypes = normalizePaymentMethodTypes(methodTypes, paymentMethod)

  const payload = await requestPaymentApi('/payments/appointments/create-session', {
    method: 'POST',
    body: {
      appointmentId,
      clientId,
      attorneyId,
      amount: Number(amount || 0),
      method: paymentMethod,
      paymentMethodTypes,
    },
  })

  if (!payload?.checkoutUrl || !payload?.transactionId) {
    throw new Error('Payment provider returned an invalid session payload.')
  }

  return {
    transactionId: payload.transactionId,
    checkoutUrl: payload.checkoutUrl,
    status: payload.status || 'pending',
    checkoutSessionId: payload.checkoutSessionId || null,
  }
}

export async function getAppointmentPaymentStatus(transactionId) {
  if (!transactionId) throw new Error('transactionId is required')

  const payload = await requestPaymentApi(
    `/payments/appointments/status/${encodeURIComponent(transactionId)}`,
  )
  return {
    transactionId: payload?.transactionId || transactionId,
    appointmentId: payload?.appointmentId || null,
    status: String(payload?.status || 'pending').toLowerCase(),
    referenceNo: payload?.referenceNo || null,
  }
}

const findAttorneyAppointmentNotifications = async ({ attorneyId, appointmentId }) => {
  if (!attorneyId || !appointmentId) return []
  const dedupeMarker = `[appt:${appointmentId}]`
  const { data, error } = await supabase
    .from('notifications')
    .select('id')
    .eq('user_id', attorneyId)
    .eq('type', 'consultation')
    .ilike('body', `%${dedupeMarker}%`)

  if (error) {
    console.warn('[booking] notification lookup failed', error)
    return []
  }

  return (data || []).map((row) => row.id)
}

const resolveClientDisplayName = async (clientId) => {
  if (!clientId) return 'A client'
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, email')
      .eq('id', clientId)
      .maybeSingle()
    return (
      String(profile?.full_name || '').trim() ||
      String(profile?.email || '').trim() ||
      'A client'
    )
  } catch (lookupError) {
    console.warn('[booking] failed to resolve client name', lookupError)
    return 'A client'
  }
}

async function fetchAdminUserIds() {
  const { data, error } = await supabase.from('profiles').select('id').eq('role', 'Admin')
  if (error) {
    console.warn('[notify] fetchAdminUserIds failed', error)
    return []
  }
  return (data || []).map((row) => row?.id).filter(Boolean)
}

/** Notarial requests are reviewed on the admin console (web), not by attorneys. */
export async function notifyAdminsOfNewNotarialRequest({
  clientId,
  serviceType,
  preferredDate,
}) {
  try {
    const adminIds = await fetchAdminUserIds()
    if (!adminIds.length) return

    const clientName = await resolveClientDisplayName(clientId)
    const preferredLabel = preferredDate
      ? new Date(preferredDate).toLocaleDateString('en-PH', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })
      : 'an unspecified date'

    await insertNotificationsForUserIds(adminIds, {
      title: 'New notarial request',
      body: `${clientName} submitted a ${serviceType || 'notarial'} request for ${preferredLabel}. [adminnewnot:${clientId}:${Date.now()}]`,
      type: 'admin_general',
    })
  } catch (notifyError) {
    console.warn('[notarial] admin notify failed', notifyError)
  }
}

async function insertNotificationsForUserIds(userIds, { title, body, type = 'general' }) {
  const unique = [...new Set((userIds || []).filter(Boolean))]
  if (!unique.length) return
  const nowIso = new Date().toISOString()
  const chunkSize = 80
  for (let i = 0; i < unique.length; i += chunkSize) {
    const slice = unique.slice(i, i + chunkSize)
    const rows = slice.map((user_id) => ({
      user_id,
      title: String(title || 'Notification'),
      body: String(body || ''),
      type: String(type || 'general'),
      is_read: false,
      created_at: nowIso,
    }))
    const { error } = await supabase.from('notifications').insert(rows)
    if (error) console.warn('[notify] insertNotificationsForUserIds failed', error)
  }
}

const SUPPORT_TABLE = 'support_messages'

const mapSupportMessage = (row) => ({
  id: row.id,
  clientId: row.client_id,
  senderId: row.sender_id,
  senderRole: row.sender_role,
  message: row.message || '',
  isRead: Boolean(row.is_read),
  createdAt: row.created_at || null,
})

export async function fetchClientSupportThread(clientId, options = {}) {
  if (!clientId) return []
  const limit = Number(options?.limit || 200)

  const { data, error } = await supabase
    .from(SUPPORT_TABLE)
    .select('id, client_id, sender_id, sender_role, message, is_read, created_at')
    .eq('client_id', clientId)
    .order('created_at', { ascending: true })
    .limit(Number.isFinite(limit) ? limit : 200)

  if (error) {
    if (isMissingRelationError(error)) return []
    throw error
  }

  return (data || []).map(mapSupportMessage)
}

export async function fetchClientSupportUnreadCount(clientId) {
  if (!clientId) return 0
  const { count, error } = await supabase
    .from(SUPPORT_TABLE)
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('sender_role', 'admin')
    .eq('is_read', false)
  if (error) {
    if (isMissingRelationError(error)) return 0
    console.warn('[support] fetchClientSupportUnreadCount failed', error)
    return 0
  }
  return Number(count || 0)
}

export async function sendClientSupportMessage({ clientId, message }) {
  if (!clientId) throw new Error('clientId is required.')
  const body = String(message || '').trim()
  if (!body) throw new Error('Message cannot be empty.')

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.id) throw new Error('Not authenticated.')
  if (String(user.id) !== String(clientId)) {
    throw new Error('You can only send messages from your own account.')
  }

  const { data, error } = await supabase
    .from(SUPPORT_TABLE)
    .insert({
      client_id: clientId,
      sender_id: user.id,
      sender_role: 'client',
      message: body,
      is_read: false,
    })
    .select('id, client_id, sender_id, sender_role, message, is_read, created_at')
    .single()

  if (error) throw error

  try {
    const clientName = await resolveClientDisplayName(clientId)
    const adminIds = await fetchAdminUserIds()
    await insertNotificationsForUserIds(adminIds, {
      title: 'New support message',
      body: `${clientName}: ${body.slice(0, 140)} [support:${clientId}]`,
      type: 'admin_general',
    })
  } catch (notifyError) {
    console.warn('[support] admin notify after client send failed', notifyError)
  }

  return mapSupportMessage(data)
}

export async function markClientSupportMessagesAsRead(clientId) {
  if (!clientId) return
  const { error } = await supabase
    .from(SUPPORT_TABLE)
    .update({ is_read: true })
    .eq('client_id', clientId)
    .eq('sender_role', 'admin')
    .eq('is_read', false)
  if (error && !isMissingRelationError(error)) {
    console.warn('[support] markClientSupportMessagesAsRead failed', error)
  }
}

export function subscribeToClientSupport(clientId, onChange) {
  if (!clientId) return () => {}
  const channel = supabase
    .channel(`support_client_${clientId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: SUPPORT_TABLE,
        filter: `client_id=eq.${clientId}`,
      },
      () => {
        try {
          onChange?.()
        } catch (err) {
          console.warn('[support] client subscriber callback error', err)
        }
      },
    )
    .subscribe()

  return () => {
    try {
      supabase.removeChannel(channel)
    } catch {
      // ignore
    }
  }
}

export async function notifyAttorneyOfPaidBooking({ appointmentId }) {
  if (!appointmentId) return

  const { data: appt, error: apptError } = await supabase
    .from('appointments')
    .select('id, attorney_id, client_id, title, scheduled_at')
    .eq('id', appointmentId)
    .maybeSingle()

  if (apptError) {
    console.warn('[booking] notifyAttorneyOfPaidBooking lookup failed', apptError)
    return
  }
  if (!appt?.attorney_id) return

  const dedupeMarker = `[appt:${appointmentId}]`
  const clientName = await resolveClientDisplayName(appt.client_id)
  const whenLabel = appt.scheduled_at
    ? new Date(appt.scheduled_at).toLocaleString('en-PH', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : 'the scheduled time'

  const newTitle = 'Booking Confirmed'
  const newBody = `${clientName} paid for ${appt.title || 'a consultation'} on ${whenLabel}. ${dedupeMarker}`
  const nowIso = new Date().toISOString()

  try {
    const { data: currentAppt } = await supabase
      .from('appointments')
      .select('status')
      .eq('id', appointmentId)
      .maybeSingle()
    const currentStatus = String(currentAppt?.status || '').toLowerCase()
    if (currentStatus === 'pending' || currentStatus === '') {
      const { error: statusError } = await supabase
        .from('appointments')
        .update({ status: 'confirmed', updated_at: nowIso })
        .eq('id', appointmentId)
      if (statusError) {
        console.warn('[booking] failed to flip status to confirmed', statusError)
      }
    }
  } catch (statusFlipError) {
    console.warn('[booking] confirmed status flip step failed', statusFlipError)
  }

  const existingIds = await findAttorneyAppointmentNotifications({
    attorneyId: appt.attorney_id,
    appointmentId,
  })

  if (existingIds.length > 0) {
    const { error: updateError } = await supabase
      .from('notifications')
      .update({
        title: newTitle,
        body: newBody,
        is_read: false,
        updated_at: nowIso,
      })
      .in('id', existingIds)
    if (updateError) {
      console.warn('[booking] failed to update attorney notification to confirmed', updateError)
    }
  } else {
    const { error: insertError } = await supabase.from('notifications').insert({
      user_id: appt.attorney_id,
      title: newTitle,
      body: newBody,
      type: 'consultation',
      is_read: false,
      created_at: nowIso,
    })
    if (insertError) {
      console.warn('[booking] failed to create attorney confirmed notification', insertError)
    }
  }
}

export async function cancelPendingUnpaidBooking({ appointmentId }) {
  if (!appointmentId) return

  const { data: paidTx, error: txError } = await supabase
    .from('transactions')
    .select('id')
    .eq('appointment_id', appointmentId)
    .eq('payment_status', 'paid')
    .limit(1)

  if (txError) {
    console.warn('[booking] cancel cleanup tx check failed', txError)
    return
  }
  if (paidTx && paidTx.length > 0) return

  const { data: appt, error: apptError } = await supabase
    .from('appointments')
    .select('id, attorney_id, client_id, title, scheduled_at, slot_id, status')
    .eq('id', appointmentId)
    .maybeSingle()

  if (apptError) {
    console.warn('[booking] cancel cleanup appt lookup failed', apptError)
    return
  }
  if (!appt) return

  const currentStatus = String(appt.status || '').toLowerCase()
  if (currentStatus === 'cancelled' || currentStatus === 'completed') return

  const nowIso = new Date().toISOString()

  const { error: updateError } = await supabase
    .from('appointments')
    .update({ status: 'cancelled', updated_at: nowIso })
    .eq('id', appointmentId)

  if (updateError) {
    console.warn('[booking] cancel cleanup status update failed', updateError)
  }

  try {
    const dedupeMarker = `[appt:${appointmentId}]`
    const clientName = await resolveClientDisplayName(appt.client_id)
    const whenLabel = appt.scheduled_at
      ? new Date(appt.scheduled_at).toLocaleString('en-PH', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        })
      : 'the scheduled time'

    const existingIds = await findAttorneyAppointmentNotifications({
      attorneyId: appt.attorney_id,
      appointmentId,
    })

    const cancelTitle = 'Booking Cancelled'
    const cancelBody = `${clientName} cancelled their booking for ${appt.title || 'a consultation'} on ${whenLabel}. ${dedupeMarker}`

    if (existingIds.length > 0) {
      const { error: notifUpdateError } = await supabase
        .from('notifications')
        .update({
          title: cancelTitle,
          body: cancelBody,
          is_read: false,
          updated_at: nowIso,
        })
        .in('id', existingIds)
      if (notifUpdateError) {
        console.warn('[booking] failed to update attorney notification to cancelled', notifUpdateError)
      }
    } else if (appt.attorney_id) {
      const { error: notifInsertError } = await supabase.from('notifications').insert({
        user_id: appt.attorney_id,
        title: cancelTitle,
        body: cancelBody,
        type: 'consultation',
        is_read: false,
        created_at: nowIso,
      })
      if (notifInsertError) {
        console.warn('[booking] failed to insert attorney cancellation notification', notifInsertError)
      }
    }
  } catch (notifError) {
    console.warn('[booking] cancel notification flip failed', notifError)
  }

  let slotIdToFree = appt.slot_id || null
  const { slotDate, slotTime } = deriveSlotFieldsFromScheduledAt(appt.scheduled_at)

  if (!slotIdToFree && appt.attorney_id && slotDate && slotTime) {
    const { data: candidateSlots, error: candidateError } = await supabase
      .from('availability_slots')
      .select('id, time')
      .eq('attorney_id', appt.attorney_id)
      .eq('date', slotDate)

    if (candidateError) {
      console.warn('[booking] cancel cleanup candidate slot fetch failed', candidateError)
    } else if (Array.isArray(candidateSlots) && candidateSlots.length) {
      const targetParsed = parseSlotDateTime(slotDate, slotTime)
      const targetMs = targetParsed?.getTime() || 0
      const matchedSlot = candidateSlots.find((slot) => {
        const slotParsed = parseSlotDateTime(slotDate, slot?.time)
        return slotParsed && slotParsed.getTime() === targetMs
      })
      slotIdToFree = matchedSlot?.id || null
    }
  }

  if (slotIdToFree) {
    const { error: slotByIdError } = await supabase
      .from('availability_slots')
      .update({ is_booked: false, updated_at: nowIso })
      .eq('id', slotIdToFree)
    if (slotByIdError) {
      console.warn('[booking] cancel cleanup slot free (by id) failed', slotByIdError)
    }
  } else if (appt.attorney_id && slotDate && slotTime) {
    const { error: slotByMatchError } = await supabase
      .from('availability_slots')
      .update({ is_booked: false, updated_at: nowIso })
      .eq('attorney_id', appt.attorney_id)
      .eq('date', slotDate)
      .eq('time', slotTime)
    if (slotByMatchError) {
      console.warn('[booking] cancel cleanup slot free (raw match) failed', slotByMatchError)
    }
  }

}

export async function abandonAppointmentCheckout({ appointmentId, clientId, transactionId }) {
  if (!appointmentId) throw new Error('appointmentId is required')
  if (!clientId) throw new Error('clientId is required')

  try {
    const payload = await requestPaymentApi('/payments/appointments/abandon', {
      method: 'POST',
      body: { appointmentId, clientId, transactionId },
    })
    return payload || { ok: true }
  } catch {
    await cancelPendingUnpaidBooking({ appointmentId })
    return { ok: true, reason: 'fallback' }
  }
}

export async function requestAppointmentReschedule({ appointmentId, scheduledAt, note }) {
  const { error } = await supabase
    .from('appointments')
    .update({ status: 'rescheduled', scheduled_at: scheduledAt, notes: note, updated_at: new Date().toISOString() })
    .eq('id', appointmentId)

  if (error) throw error
}

const normalizeNotarialStatus = (status) => {
  const value = (status || '').toLowerCase()
  if (value === 'accepted' || value === 'approved' || value === 'paid') return 'ACCEPTED'
  if (value === 'completed') return 'COMPLETED'
  if (value === 'rejected' || value === 'cancelled') return 'REJECTED'
  return 'PENDING'
}

const BUNDLED_APPOINTMENT_NOTE_RE =
  /Bundled with consultation appointment\s+([0-9a-f-]{36})/i

function isPaymentStatusPaid(raw) {
  const paymentNorm = String(raw || '').toLowerCase()
  return (
    paymentNorm === 'paid' ||
    paymentNorm === 'succeeded' ||
    paymentNorm === 'success'
  )
}

/**
 * Heal orphan bundled notarial rows that were created before PayMongo pay
 * but never linked to the paid appointment transaction.
 */
async function healBundledNotarialPayments(userId, requests, paymentByRequest) {
  const orphans = (requests || []).filter((item) => {
    if (isPaymentStatusPaid(paymentByRequest.get(item.id))) return false
    const noteText = String(item.notes || item.details || '')
    return BUNDLED_APPOINTMENT_NOTE_RE.test(noteText)
  })
  if (!orphans.length) return paymentByRequest

  const appointmentIds = orphans
    .map((item) => {
      const noteText = String(item.notes || item.details || '')
      const match = noteText.match(BUNDLED_APPOINTMENT_NOTE_RE)
      return match?.[1] || null
    })
    .filter(Boolean)

  if (!appointmentIds.length) return paymentByRequest

  const { data: paidApptTxs, error } = await supabase
    .from('transactions')
    .select('id, appointment_id, payment_status')
    .eq('client_id', userId)
    .in('appointment_id', appointmentIds)

  if (error || !paidApptTxs?.length) return paymentByRequest

  const paidTxByAppointment = new Map()
  for (const tx of paidApptTxs) {
    if (isPaymentStatusPaid(tx.payment_status) && tx.appointment_id) {
      paidTxByAppointment.set(tx.appointment_id, tx)
    }
  }

  const nextMap = new Map(paymentByRequest)
  const nowIso = new Date().toISOString()

  await Promise.all(
    orphans.map(async (item) => {
      const noteText = String(item.notes || item.details || '')
      const match = noteText.match(BUNDLED_APPOINTMENT_NOTE_RE)
      const appointmentId = match?.[1]
      const paidTx = appointmentId ? paidTxByAppointment.get(appointmentId) : null
      if (!paidTx?.id) return

      nextMap.set(item.id, 'paid')

      try {
        await supabase
          .from('transactions')
          .update({ notarial_request_id: item.id, updated_at: nowIso })
          .eq('id', paidTx.id)
      } catch (linkErr) {
        console.warn('[notarial] heal link tx failed', linkErr?.message || linkErr)
      }

      try {
        await supabase
          .from('notarial_requests')
          .update({ status: 'accepted', updated_at: nowIso })
          .eq('id', item.id)
      } catch (statusErr) {
        console.warn('[notarial] heal status failed', statusErr?.message || statusErr)
      }
    }),
  )

  return nextMap
}

export async function fetchClientNotarialRequests(userId) {
  const [requestsRes, transactionsRes] = await Promise.all([
    supabase
      .from('notarial_requests')
      .select(
        'id, service_type, document_url, details, notes, status, created_at, amount, attorney_id, attorney:attorney_id(full_name)',
      )
      .eq('client_id', userId)
      .order('created_at', { ascending: false }),
    supabase
      .from('transactions')
      .select('notarial_request_id, payment_status, appointment_id')
      .eq('client_id', userId),
  ])

  if (requestsRes.error) throw requestsRes.error
  if (transactionsRes.error) throw transactionsRes.error

  // A request can have several attempts (pending/failed + paid); paid wins.
  let paymentByRequest = new Map()
  for (const tx of transactionsRes.data || []) {
    if (!tx.notarial_request_id) continue
    if (isPaymentStatusPaid(paymentByRequest.get(tx.notarial_request_id))) continue
    paymentByRequest.set(tx.notarial_request_id, tx.payment_status)
  }

  paymentByRequest = await healBundledNotarialPayments(
    userId,
    requestsRes.data || [],
    paymentByRequest,
  )

  return (requestsRes.data || []).map((item) => {
    const status = normalizeNotarialStatus(item.status)
    const datetime = formatDateTime(item.created_at)
    const paymentRaw = paymentByRequest.get(item.id) || 'unpaid'
    const isPaid = isPaymentStatusPaid(paymentRaw)
    const noteText = item.notes || item.details || ''
    // If we just healed this row, surface ACCEPTED instead of PENDING.
    const displayStatus =
      isPaid && status === 'PENDING' ? 'ACCEPTED' : status
    const resolvedAmount = resolveNotarialAmount(item.amount)
    return {
      id: item.id,
      service: item.service_type || 'Notarial Service',
      description: item.service_type || 'Notarial request',
      date: datetime.date,
      file: item.document_url || 'N/A',
      notes: noteText,
      details: noteText,
      status: displayStatus,
      payment: isPaid ? 'PAID' : 'UNPAID',
      payment_is_paid: isPaid,
      fee: `PHP ${resolvedAmount.toFixed(2)}`,
      amount: resolvedAmount,
      message:
        displayStatus === 'COMPLETED'
          ? 'Notarization Completed'
          : displayStatus === 'ACCEPTED' || displayStatus === 'APPROVED'
            ? 'Ready for Review'
            : 'Waiting for Review',
      detail: noteText || 'Request submitted for review.',
      assignedTo: item.attorney?.full_name || null,
      attorneyId: item.attorney_id || null,
    }
  })
}

/** Realtime updates when admin changes notary status (web ClientNotaryTracking parity). */
export function subscribeToClientNotarialRequests(clientId, onChange) {
  if (!clientId) return () => {}

  const { schedule, dispose } = createDebouncedRealtimeHandler(() => {
    onChange?.()
  })

  const channel = supabase
    .channel(`client-notary:${clientId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'notarial_requests',
        filter: `client_id=eq.${clientId}`,
      },
      () => schedule(),
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'transactions',
        filter: `client_id=eq.${clientId}`,
      },
      () => schedule(),
    )
    .subscribe()

  return () => {
    dispose()
    try {
      supabase.removeChannel(channel)
    } catch {
      // ignore
    }
  }
}

/** Records a paid notarial transaction directly (bundled consultation checkout only). */
export async function payForNotarialRequest({ requestId, clientId, attorneyId, amount, method }) {
  const paymentMethod = normalizeDigitalPaymentMethod(method)

  const nowIso = new Date().toISOString()
  const txPayload = {
    notarial_request_id: requestId,
    client_id: clientId,
    amount: Number(amount || 0),
    payment_status: 'paid',
    payment_method: paymentMethod,
    created_at: nowIso,
    updated_at: nowIso,
  }
  if (attorneyId) txPayload.attorney_id = attorneyId

  const { data: txRow, error: txError } = await supabase
    .from('transactions')
    .insert(txPayload)
    .select('id')
    .maybeSingle()

  if (txError) throw txError

  const { error: reqError } = await supabase
    .from('notarial_requests')
    .update({ status: 'accepted', updated_at: nowIso })
    .eq('id', requestId)

  if (reqError) throw reqError

  try {
    const { data: row } = await supabase
      .from('notarial_requests')
      .select('service_type')
      .eq('id', requestId)
      .maybeSingle()
    const adminIds = await fetchAdminUserIds()
    if (adminIds.length) {
      const clientName = await resolveClientDisplayName(clientId)
      const amt = Number(amount || 0)
      const amtLabel = amt > 0 ? `PHP ${amt.toLocaleString()}` : 'the agreed fee'
      const svc = row?.service_type || 'notarial request'
      await insertNotificationsForUserIds(adminIds, {
        title: 'Notarial payment received',
        body: `${clientName} paid ${amtLabel} for ${svc} (request ${String(requestId).slice(0, 8)}…). [adminnotpaid:${requestId}]`,
        type: 'admin_general',
      })
    }
  } catch (notifyErr) {
    console.warn('[notarial] payment admin notify failed', notifyErr?.message || notifyErr)
  }

  return { transactionId: txRow?.id ?? null }
}

export async function cancelNotarialRequest(requestId) {
  const { error } = await supabase
    .from('notarial_requests')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', requestId)

  if (error) throw error
}

export async function fetchAppointmentPaymentDetails(appointmentId) {
  const { data, error } = await supabase
    .from('appointments')
    .select('attorney_id, amount')
    .eq('id', appointmentId)
    .maybeSingle()

  if (error) throw error
  if (!data) throw new Error('Appointment not found.')
  return {
    attorneyId: data.attorney_id,
    amount: Number(data.amount || 0),
  }
}

export async function fetchNotarialPaymentDetails(requestId) {
  const { data, error } = await supabase
    .from('notarial_requests')
    .select('attorney_id, service_type, amount')
    .eq('id', requestId)
    .maybeSingle()

  if (error) throw error
  if (!data) throw new Error('Notarial request not found.')
  return {
    attorneyId: data.attorney_id,
    serviceType: data.service_type,
    amount: resolveNotarialAmount(data.amount),
  }
}

export async function fetchClientTransactions(userId) {
  const { data, error } = await supabase
    .from('transactions')
    .select('id, amount, payment_method, payment_status, provider_reference, created_at, appointment_id, attorney:attorney_id(full_name), appointment:appointment_id(title)')
    .eq('client_id', userId)
    .order('created_at', { ascending: false })

  if (error) throw error

  return (data || []).map((tx) => {
    const datetime = formatDateTime(tx.created_at)
    const isConsultation = Boolean(tx.appointment_id)
    const rawMethod = String(tx.payment_method || '')
      .trim()
      .toLowerCase()
    const paymentMethod =
      rawMethod === 'maya' || rawMethod === 'paymaya'
        ? 'Maya'
        : rawMethod === 'qrph'
          ? 'QR Ph'
          : 'GCash'
    return {
      id: tx.id,
      type: isConsultation ? 'consultation' : 'notarial',
      description: isConsultation
        ? `Legal Consultation - ${tx.appointment?.title || 'General'}`
        : `Payment - ${tx.attorney?.full_name || 'Service'}`,
      detail: `With ${tx.attorney?.full_name || 'Attorney'}`,
      amount: `PHP ${Number(tx.amount || 0).toFixed(2)}`,
      date: datetime.date,
      time: datetime.time,
      method: paymentMethod,
      status: (tx.payment_status || 'pending').toLowerCase(),
      refNo: tx.provider_reference || tx.id,
      createdAt: tx.created_at,
    }
  })
}

export async function fetchAttorneyConsultationRequests(userId) {
  const [requestsRes, notificationsRes] = await Promise.all([
    supabase
      .from('appointments')
      .select('id, title, scheduled_at, status, notes, client_id, client:client_id(full_name), amount')
      .eq('attorney_id', userId)
      .in('status', ['pending', 'rescheduled', 'confirmed'])
      .order('scheduled_at', { ascending: true }),
    supabase
      .from('notifications')
      .select('id, title, body, is_read, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(6),
  ])

  if (requestsRes.error) throw requestsRes.error
  if (notificationsRes.error) throw notificationsRes.error

  const requests = (requestsRes.data || []).map((item) => {
    const datetime = formatDateTime(item.scheduled_at)
    const status = normalizeAppointmentStatus(item.status)
    return {
      id: item.id,
      clientId: item.client_id,
      name: item.client?.full_name || 'Client',
      initials: (item.client?.full_name || 'CL')
        .split(' ')
        .map((part) => part[0])
        .slice(0, 2)
        .join('')
        .toUpperCase(),
      area: item.title || 'Consultation',
      date: datetime.date,
      time: datetime.time,
      payment: Number(item.amount || 0) > 0 ? 'Paid' : 'Unpaid',
      status: status === 'APPROVED' ? 'Approved' : status === 'REJECTED' ? 'Rejected' : 'Pending',
      concern: item.notes || 'No additional notes provided.',
    }
  })

  const notifications = (notificationsRes.data || []).map((item) => ({
    id: item.id,
    text: `${item.title}: ${item.body}`,
    time: item.created_at ? new Date(item.created_at).toLocaleString() : 'Now',
    unread: !item.is_read,
  }))

  return { requests, notifications }
}

export async function updateAttorneyConsultationRequestStatus({ appointmentId, status, scheduledAt, note }) {
  const payload = {
    status,
    updated_at: new Date().toISOString(),
  }
  if (scheduledAt) payload.scheduled_at = scheduledAt
  if (note) payload.notes = note

  const { error } = await supabase.from('appointments').update(payload).eq('id', appointmentId)
  if (error) throw error
}

export async function fetchAvailability(attorneyId, date) {
  if (!attorneyId) {
    return []
  }

  const legacySelect = 'id, attorney_id, date, time, is_booked'
  let query = supabase
    .from('availability_slots')
    .select(legacySelect)
    .eq('attorney_id', attorneyId)
    .eq('is_booked', false)

  if (date) {
    query = query.eq('date', date)
  }

  const { data, error } = await query
    .order('date', { ascending: true })
    .order('time', { ascending: true })

  if (error) {
    if (
      date &&
      (isMissingColumnError(error, 'date') ||
        isMissingColumnError(error, 'time') ||
        isMissingAvailabilityColumnError(error))
    ) {
      const rows = await fetchAvailabilitySlotsByStartTimeDay(attorneyId, date)
      return sortAvailabilitySlotsChronologically(mapAvailabilitySlots(rows))
    }
    throw error
  }

  let rows = data || []
  if (date && rows.length === 0) {
    const viaStart = await fetchAvailabilitySlotsByStartTimeDay(attorneyId, date)
    if (viaStart.length > 0) {
      rows = viaStart
    }
  }

  return sortAvailabilitySlotsChronologically(mapAvailabilitySlots(rows))
}

export async function fetchBookableAttorneys({ concern = '', onlyVerified = true } = {}) {
  let profilesQuery = supabase
    .from('attorney_profiles')
    .select('user_id, years_experience, specialties, consultation_fee, bio, is_verified, prc_id, profile:user_id(full_name, email)')
    .order('updated_at', { ascending: false })

  if (onlyVerified) {
    profilesQuery = profilesQuery.eq('is_verified', true)
  }

  let { data, error } = await profilesQuery

  if (error) throw error

  let attorneys = data || []

  if (onlyVerified && attorneys.length === 0) {
    const { data: fallbackData, error: fallbackError } = await supabase
      .from('attorney_profiles')
      .select('user_id, years_experience, specialties, consultation_fee, bio, is_verified, prc_id, profile:user_id(full_name, email)')
      .order('updated_at', { ascending: false })

    if (!fallbackError) {
      attorneys = fallbackData || []
    }
  }

  if (!attorneys.length) {
    const profileFallback = await supabase
      .from('profiles')
      .select('id, full_name, email, role')
      .ilike('role', 'attorney')

    if (profileFallback.error) throw profileFallback.error

    attorneys = (profileFallback.data || []).map((row) => ({
      user_id: row.id,
      years_experience: 0,
      specialties: [],
      consultation_fee: 0,
      bio: null,
      is_verified: true,
      prc_id: null,
      profile: {
        full_name: row.full_name,
        email: row.email,
      },
    }))
  }

  if (!attorneys.length) {
    const usersFallback = await supabase
      .from('users')
      .select('id, first_name, last_name, email, role')
      .ilike('role', 'attorney')

    if (usersFallback.error && !isMissingRelationError(usersFallback.error)) {
      throw usersFallback.error
    }

    if (!usersFallback.error) {
      attorneys = (usersFallback.data || []).map((row) => ({
        user_id: row.id,
        years_experience: 0,
        specialties: [],
        consultation_fee: 0,
        bio: null,
        is_verified: true,
        prc_id: null,
        profile: {
          full_name: String([row.first_name, row.last_name].filter(Boolean).join(' ')).trim() || 'Attorney',
          email: row.email,
        },
      }))
    }
  }

  const merged = [...attorneys]

  const profileSupplement = await supabase
    .from('profiles')
    .select('id, full_name, email, role')
    .ilike('role', 'attorney')

  if (!profileSupplement.error) {
    const existingIds = new Set(merged.map((item) => item.user_id).filter(Boolean))
    for (const row of profileSupplement.data || []) {
      if (!row?.id || existingIds.has(row.id)) continue
      merged.push({
        user_id: row.id,
        years_experience: 0,
        specialties: [],
        consultation_fee: 0,
        bio: null,
        is_verified: true,
        prc_id: null,
        profile: {
          full_name: row.full_name,
          email: row.email,
        },
      })
      existingIds.add(row.id)
    }
  }

  const attorneyIds = merged.map((item) => item.user_id).filter(Boolean)

  let cmsByAttorney = new Map()
  if (attorneyIds.length > 0) {
    const { data: cmsRows, error: cmsError } = await supabase
      .from('cms_attorney_directory')
      .select('user_id, display_name, profile_image_url, expertise_fields, practice_areas, biography, is_published')
      .in('user_id', attorneyIds)

    if (!cmsError) {
      cmsByAttorney = new Map((cmsRows || []).map((row) => [row.user_id, row]))
    } else if (!isMissingRelationError(cmsError)) {
      throw cmsError
    }
  }

  let availabilityByAttorney = new Map()
  if (attorneyIds.length > 0) {
    const todayDate = new Date().toISOString().slice(0, 10)
    let slots = []
    let slotsError = null

    const dateTimeSlotsRes = await supabase
      .from('availability_slots')
      .select('id, attorney_id, date, time, is_booked')
      .in('attorney_id', attorneyIds)
      .eq('is_booked', false)
      .gte('date', todayDate)
      .order('date', { ascending: true })
      .order('time', { ascending: true })

    slots = dateTimeSlotsRes.data || []
    slotsError = dateTimeSlotsRes.error || null

    if (
      slotsError &&
      (isMissingColumnError(slotsError, 'date') ||
        isMissingColumnError(slotsError, 'time') ||
        isMissingAvailabilityColumnError(slotsError))
    ) {
      const fallbackSlotsRes = await supabase
        .from('availability_slots')
        .select('id, attorney_id, start_time, end_time, is_booked')
        .in('attorney_id', attorneyIds)
        .eq('is_booked', false)
        .gte('start_time', new Date().toISOString())
        .order('start_time', { ascending: true })

      if (fallbackSlotsRes.error) throw fallbackSlotsRes.error

      availabilityByAttorney = (fallbackSlotsRes.data || []).reduce((map, slot) => {
        const list = map.get(slot.attorney_id) || []
        const start = slot.start_time ? new Date(slot.start_time) : null
        const end = slot.end_time ? new Date(slot.end_time) : null

        if (!start || Number.isNaN(start.getTime()) || start <= new Date()) {
          map.set(slot.attorney_id, list)
          return map
        }

        const safeEnd =
          end && !Number.isNaN(end.getTime()) ? end : new Date(start.getTime() + 60 * 60 * 1000)
        list.push({
          id: slot.id,
          startTime: start.toISOString(),
          endTime: safeEnd.toISOString(),
          rawDate: start.toISOString().slice(0, 10),
          rawTime: `${toTwoDigits(((start.getHours() + 11) % 12) + 1)}:${toTwoDigits(start.getMinutes())} ${start.getHours() >= 12 ? 'PM' : 'AM'}`,
          dateLabel: start.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }),
          timeLabel: `${start.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })} - ${safeEnd.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}`,
        })
        map.set(slot.attorney_id, list)
        return map
      }, new Map())
    } else {
      if (slotsError) throw slotsError

      availabilityByAttorney = (slots || []).reduce((map, slot) => {
        const list = map.get(slot.attorney_id) || []
        let start = parseSlotDateTime(slot.date, slot.time)
        if (!start) {
          const startIso = resolveSlotStartIso(slot)
          if (startIso) {
            const parsed = new Date(startIso)
            if (!Number.isNaN(parsed.getTime())) start = parsed
          }
        }
        if (!start || start <= new Date()) {
          map.set(slot.attorney_id, list)
          return map
        }

        const end = new Date(start.getTime() + 60 * 60 * 1000)
        list.push({
          id: slot.id,
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          rawDate: slot.date,
          rawTime: slot.time,
          dateLabel: Number.isNaN(start.getTime())
            ? 'TBD'
            : start.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }),
          timeLabel: Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())
            ? 'TBD'
            : `${start.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })} - ${end.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}`,
        })
        map.set(slot.attorney_id, list)
        return map
      }, new Map())
    }
  }

  return merged
    .filter((item) => {
      const cms = cmsByAttorney.get(item.user_id)
      if (cms && cms.is_published === false) return false
      const concernPool = [
        ...normalizeStringArray(item.specialties),
        ...normalizeStringArray(cms?.expertise_fields),
        ...normalizeStringArray(cms?.practice_areas),
      ]
      return matchConcernToSpecialties(concernPool, concern)
    })
    .map((item) => {
      const cms = cmsByAttorney.get(item.user_id)
      const fullName = item.profile?.full_name || 'Attorney'
      const primarySpecialty =
        Array.isArray(item.specialties) && item.specialties.length
          ? item.specialties[0]
          : 'General Practice'
      const experienceYears = Number(item.years_experience || 0)
      const fee = Number(item.consultation_fee || 2000)
      const availableSlots = availabilityByAttorney.get(item.user_id) || []
      const biography = cms?.biography || item.bio || ''

      return {
        id: item.user_id,
        name: cms?.display_name || fullName,
        specialty: normalizeStringArray(cms?.expertise_fields)[0] || primarySpecialty,
        specialties: normalizeStringArray(cms?.expertise_fields || item.specialties),
        practiceAreas: normalizeStringArray(cms?.practice_areas || item.specialties),
        // Match mayy16 / web Book Appointment card label (not raw DB test values like 5).
        exp: '3 years experience',
        yearsExperience: experienceYears,
        price: `PHP ${fee.toFixed(2)}`,
        amount: fee,
        bio: cms?.biography || item.bio || 'No biography available yet.',
        details: cms?.biography || item.bio || 'No additional profile details provided.',
        prcId: item.prc_id || '',
        verified: Boolean(item.is_verified),
        availableSlots,
        img: resolveAttorneyImage(cms?.display_name || fullName, cms?.profile_image_url),
      }
    })
}

export async function fetchPublicLandingData() {
  let content = { ...LANDING_CONTENT_DEFAULTS }

  const { data: siteRows, error: siteError } = await supabase
    .from('cms_site_content')
    .select('content_key, content_value')

  if (!siteError) {
    content = (siteRows || []).reduce(
      (acc, row) => {
        acc[row.content_key] = row.content_value
        return acc
      },
      { ...LANDING_CONTENT_DEFAULTS },
    )
  } else if (!isMissingRelationError(siteError)) {
    throw siteError
  }

  const { data: attorneys, error: attorneyError } = await supabase
    .from('attorney_profiles')
    .select('user_id, consultation_fee, specialties, bio, is_verified, prc_id, profiles:user_id(full_name)')
    .eq('is_verified', true)
    .order('updated_at', { ascending: false })

  if (attorneyError) throw attorneyError

  let cmsByAttorney = new Map()
  const { data: cmsRows, error: cmsError } = await supabase
    .from('cms_attorney_directory')
    .select('user_id, display_name, profile_image_url, expertise_fields, practice_areas, biography, is_published')
    .eq('is_published', true)

  if (!cmsError) {
    cmsByAttorney = new Map((cmsRows || []).map((row) => [row.user_id, row]))
  } else if (!isMissingRelationError(cmsError)) {
    throw cmsError
  }

  const shouldRestrictToCms = cmsByAttorney.size > 0

  const gallery = (attorneys || [])
    .filter((row) => (!shouldRestrictToCms ? true : cmsByAttorney.has(row.user_id)))
    .map((row) => {
      const cms = cmsByAttorney.get(row.user_id)
      const fullName = row.profiles?.full_name || 'Attorney'
      return {
        id: row.user_id,
        name: cms?.display_name || fullName,
        image: resolveAttorneyImage(cms?.display_name || fullName, cms?.profile_image_url),
        expertiseFields: normalizeStringArray(cms?.expertise_fields || row.specialties),
        practiceAreas: normalizeStringArray(cms?.practice_areas || row.specialties),
        biography: cms?.biography || row.bio || 'No biography available yet.',
        consultationFee: Number(row.consultation_fee || 0),
        prcId: row.prc_id || '',
      }
    })

  return { content, attorneys: gallery }
}

/**
 * Uploads an optional client-provided file that should accompany a new
 * consultation booking. Uses the public `appointment-attachments` bucket and
 * returns `{ url, name }` so the caller can persist it onto the appointment.
 */
export async function uploadAppointmentAttachment({ clientId, file }) {
  if (!file?.uri) return null
  if (!clientId) throw new Error('clientId is required to upload an attachment.')

  const originalName = String(file.name || file.fileName || '').trim()
  const safeName = sanitizeFilename(originalName || 'attachment')
  const filePath = `${clientId}/${Date.now()}_${safeName}`
  const ext = safeName.split('.').pop() || 'bin'

  const buffer = await readLocalFileAsArrayBuffer(file.uri)

  const { error: uploadError } = await supabase.storage
    .from('appointment-attachments')
    .upload(filePath, buffer, {
      contentType: file.mimeType || file.type || `application/${ext}`,
      upsert: false,
    })

  if (uploadError) {
    const rlsHint =
      /row-level security|violates row-level security/i.test(String(uploadError.message || ''))
        ? ' In Supabase, run database/20260514_appointment_attachments_storage_rls.sql (SQL Editor).'
        : ''

    const { error: fallbackUploadError } = await supabase.storage
      .from('notarial-documents')
      .upload(filePath, buffer, {
        contentType: file.mimeType || file.type || `application/${ext}`,
        upsert: false,
      })

    if (fallbackUploadError) {
      throw new Error(
        `${uploadError.message || 'Could not upload attachment.'}${rlsHint}`.trim(),
      )
    }

    const { data: fallbackUrlData } = supabase.storage
      .from('notarial-documents')
      .getPublicUrl(filePath)

    return {
      url: fallbackUrlData?.publicUrl || filePath,
      name: originalName || safeName,
    }
  }

  const { data: urlData } = supabase.storage
    .from('appointment-attachments')
    .getPublicUrl(filePath)

  return {
    url: urlData?.publicUrl || filePath,
    name: originalName || safeName,
  }
}

/**
 * Web BookAppointment pre-check — blocks checkout when client already has active appointment(s).
 */
export async function assertNoActiveAppointmentForClient(clientId) {
  if (!clientId) return

  const flag = await getAppConfig('prevent_double_booking', true)
  const enforce =
    flag === true ||
    flag === 'true' ||
    flag === 1 ||
    (typeof flag === 'string' && flag.trim().toLowerCase() === 'true')

  if (!enforce) return

  const { data, error } = await supabase
    .from('appointments')
    .select('id, status')
    .eq('client_id', clientId)

  if (error) throw error

  const FINALIZED_STATUSES = new Set(['completed', 'cancelled', 'rejected'])
  const activeRows = (data || []).filter(
    (row) => !FINALIZED_STATUSES.has(String(row?.status || '').toLowerCase()),
  )

  const activeCount = activeRows.length
  if (activeCount === 0) return

  if (activeCount >= 2) {
    throw new Error(
      'You already have two active appointments. Please finish or cancel one before booking again.',
    )
  }

  const confirmError = new Error(
    'You already have an active consultation. Are you sure you want to book another one?',
  )
  confirmError.code = 'DOUBLE_BOOKING_NEEDS_CONFIRMATION'
  throw confirmError
}

/** Same cap as web BookAppointment (max 2 active per client–attorney). */
export async function fetchClientAttorneyActiveBookingCount({ clientId, attorneyId }) {
  if (!clientId || !attorneyId) {
    return 0
  }

  const ACTIVE_LIMIT_STATUSES = new Set([
    'pending',
    'confirmed',
    'rescheduled',
    'started',
    'in_progress',
    'in-progress',
    'active',
    'approved',
  ])

  const { data, error } = await supabase
    .from('appointments')
    .select('id, status')
    .eq('client_id', clientId)
    .eq('attorney_id', attorneyId)

  if (error) {
    throw error
  }

  return (data || []).filter((item) =>
    ACTIVE_LIMIT_STATUSES.has(String(item?.status || '').toLowerCase()),
  ).length
}

/**
 * Paid consultation — aligned with web `src/lib/userApi.js`: Supabase RPC
 * `book_appointment` (+ legacy signature), `mark_slot_booked`, finalize row, room, tx, notifications.
 * Does not use `claim_availability_slot_by_id` (optional DB migration not required for this path).
 */
export async function createAppointmentBooking({
  clientId,
  attorneyId,
  slotId,
  title,
  notes,
  amount,
  paymentMethod,
  paymentCode,
  paymentReference,
  attachmentUrl,
  attachmentName,
  payload,
}) {
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user?.id) {
    throw new Error('Not authenticated')
  }

  const resolvedClientId = user.id
  if (clientId && clientId !== resolvedClientId) {
    console.warn('[booking] client payload id mismatch, using authenticated id', {
      providedClientId: clientId,
      authClientId: resolvedClientId,
    })
  }

  const nowIso = new Date().toISOString()
  const resolvedPaymentCode =
    paymentCode != null && paymentCode !== ''
      ? paymentCode
      : paymentReference != null && paymentReference !== ''
        ? paymentReference
        : null

  const normalizedPayload = {
    attorney_id: payload?.attorney_id || attorneyId,
    title: payload?.title || title || 'Legal Consultation',
    notes: payload?.notes ?? notes ?? null,
    scheduled_at: payload?.scheduled_at || null,
    slot_date: payload?.slot_date || null,
    slot_time: payload?.slot_time || null,
    amount: Number(payload?.amount ?? amount ?? 0),
    duration_minutes: Number(payload?.duration_minutes || 60),
    attachment_url: payload?.attachment_url ?? attachmentUrl ?? null,
    attachment_name: payload?.attachment_name ?? attachmentName ?? null,
  }

  let resolvedSlotId = slotId || payload?.slot_id || null

  if (
    resolvedSlotId &&
    (!normalizedPayload.slot_date ||
      !normalizedPayload.slot_time ||
      !normalizedPayload.scheduled_at)
  ) {
    const slotRes = await supabase
      .from('availability_slots')
      .select('id, attorney_id, date, time, is_booked')
      .eq('id', resolvedSlotId)
      .maybeSingle()

    let selectedSlot = slotRes.data
    let selectedSlotError = slotRes.error

    if (
      selectedSlotError &&
      (isMissingAvailabilityColumnError(selectedSlotError) ||
        isMissingColumnError(selectedSlotError, 'date'))
    ) {
      const alt = await supabase
        .from('availability_slots')
        .select('id, attorney_id, start_time, is_booked')
        .eq('id', resolvedSlotId)
        .maybeSingle()
      if (alt.error) {
        selectedSlotError = alt.error
      } else {
        selectedSlot = alt.data
        selectedSlotError = null
      }
    }

    if (selectedSlotError) {
      throw selectedSlotError
    }
    if (!selectedSlot) {
      throw new Error('Selected slot is no longer available.')
    }
    if (selectedSlot.is_booked) {
      throw new Error('Selected slot has already been booked.')
    }
    if (selectedSlot.attorney_id !== normalizedPayload.attorney_id) {
      throw new Error('Selected slot does not belong to this attorney.')
    }

    if (selectedSlot.date && selectedSlot.time) {
      const slotDateTime = parseSlotDateTime(selectedSlot.date, selectedSlot.time)
      normalizedPayload.slot_date = normalizedPayload.slot_date || selectedSlot.date
      normalizedPayload.slot_time = normalizedPayload.slot_time || selectedSlot.time
      normalizedPayload.scheduled_at =
        normalizedPayload.scheduled_at ||
        (slotDateTime ? slotDateTime.toISOString() : null)
    } else if (selectedSlot.start_time) {
      const resolved = resolveSlotStartIso(selectedSlot)
      normalizedPayload.scheduled_at = normalizedPayload.scheduled_at || resolved
      const d = new Date(selectedSlot.start_time)
      if (!Number.isNaN(d.getTime())) {
        const y = d.getFullYear()
        const m = String(d.getMonth() + 1).padStart(2, '0')
        const da = String(d.getDate()).padStart(2, '0')
        normalizedPayload.slot_date = normalizedPayload.slot_date || `${y}-${m}-${da}`
      }
    }
  }

  const scheduledIso = toIso(normalizedPayload.scheduled_at)
  if (!resolvedClientId || !normalizedPayload.attorney_id || !scheduledIso) {
    throw new Error('Missing appointment payload details.')
  }

  // Respect the admin "Prevent Multiple Active Bookings" toggle.
  const doubleBookingFlag = await getAppConfig('prevent_double_booking', true)
  if (coerceFlag(doubleBookingFlag, true)) {
    const activeBookingCount = await fetchClientAttorneyActiveBookingCount({
      clientId: resolvedClientId,
      attorneyId: normalizedPayload.attorney_id,
    })

    if (activeBookingCount >= 2) {
      throw new Error(
        'Booking limit reached. You can only keep up to 2 active bookings with the same attorney.',
      )
    }
  }

  normalizedPayload.scheduled_at = scheduledIso

  let appointmentId = null

  const rpcExtended = await supabase.rpc('book_appointment', {
    client_uuid: resolvedClientId,
    attorney_uuid: normalizedPayload.attorney_id,
    scheduled_time: normalizedPayload.scheduled_at,
    title_text: normalizedPayload.title,
    notes_text: normalizedPayload.notes,
    slot_date: normalizedPayload.slot_date,
    slot_time: normalizedPayload.slot_time,
    amount_value: normalizedPayload.amount,
    duration_minutes_value: normalizedPayload.duration_minutes,
  })

  let rpcSucceeded = false

  if (!rpcExtended.error) {
    rpcSucceeded = true
    appointmentId = rpcExtended.data || null
  }

  if (rpcExtended.error) {
    const rpcLegacy = await supabase.rpc('book_appointment', {
      client_uuid: resolvedClientId,
      attorney_uuid: normalizedPayload.attorney_id,
      scheduled_time: normalizedPayload.scheduled_at,
      title_text: normalizedPayload.title,
    })

    if (!rpcLegacy.error) {
      rpcSucceeded = true
      appointmentId = rpcLegacy.data || null
    }
  }

  if (!appointmentId && !rpcSucceeded) {
    const insertPayload = {
      client_id: resolvedClientId,
      attorney_id: normalizedPayload.attorney_id,
      slot_id: resolvedSlotId,
      title: normalizedPayload.title,
      notes: normalizedPayload.notes,
      scheduled_at: normalizedPayload.scheduled_at,
      duration_minutes: normalizedPayload.duration_minutes,
      amount: normalizedPayload.amount,
      // 'pending' until PayMongo succeeds — notifyAttorneyOfPaidBooking() sets 'confirmed'.
      status: 'pending',
      created_at: nowIso,
      updated_at: nowIso,
    }
    if (normalizedPayload.attachment_url) insertPayload.attachment_url = normalizedPayload.attachment_url
    if (normalizedPayload.attachment_name) insertPayload.attachment_name = normalizedPayload.attachment_name

    let insertResult = await supabase
      .from('appointments')
      .insert(insertPayload)
      .select('id')
      .single()

    if (
      insertResult.error &&
      (isMissingColumnError(insertResult.error, 'attachment_url') ||
        isMissingColumnError(insertResult.error, 'attachment_name'))
    ) {
      const { attachment_url, attachment_name, ...rest } = insertPayload
      insertResult = await supabase
        .from('appointments')
        .insert(rest)
        .select('id')
        .single()
    }

    if (insertResult.error) {
      throw insertResult.error
    }
    appointmentId = insertResult.data?.id || null
  }

  if (appointmentId && (normalizedPayload.attachment_url || normalizedPayload.attachment_name)) {
    const attachmentPatch = {}
    if (normalizedPayload.attachment_url) attachmentPatch.attachment_url = normalizedPayload.attachment_url
    if (normalizedPayload.attachment_name) attachmentPatch.attachment_name = normalizedPayload.attachment_name
    const { error: attachUpdateError } = await supabase
      .from('appointments')
      .update(attachmentPatch)
      .eq('id', appointmentId)

    if (
      attachUpdateError &&
      !isMissingColumnError(attachUpdateError, 'attachment_url') &&
      !isMissingColumnError(attachUpdateError, 'attachment_name')
    ) {
      console.warn('[booking] persist attachment metadata failed', attachUpdateError)
    }
  }

  if (normalizedPayload.slot_date && normalizedPayload.slot_time) {
    const rpcSlotBook = await supabase.rpc('mark_slot_booked', {
      p_attorney_id: normalizedPayload.attorney_id,
      p_date: normalizedPayload.slot_date,
      p_time: normalizedPayload.slot_time,
    })

    if (rpcSlotBook.error) {
      console.warn('[booking] mark_slot_booked RPC failed', rpcSlotBook.error)
    }
  }

  if (resolvedSlotId && !normalizedPayload.slot_date && !normalizedPayload.slot_time) {
    const { error: updateSlotError } = await supabase
      .from('availability_slots')
      .update({ is_booked: true, updated_at: nowIso })
      .eq('id', resolvedSlotId)
      .eq('is_booked', false)

    if (updateSlotError) {
      console.warn('[booking] fallback slot update failed', updateSlotError)
    }
  }

  if (!appointmentId) {
    const { data: latestAppointment, error: latestError } = await supabase
      .from('appointments')
      .select('id')
      .eq('client_id', resolvedClientId)
      .eq('attorney_id', normalizedPayload.attorney_id)
      .eq('scheduled_at', normalizedPayload.scheduled_at)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (latestError) {
      throw latestError
    }
    appointmentId = latestAppointment?.id || null
  }

  if (!appointmentId) {
    const { data: fallbackLatest } = await supabase
      .from('appointments')
      .select('id')
      .eq('client_id', resolvedClientId)
      .eq('attorney_id', normalizedPayload.attorney_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    appointmentId = fallbackLatest?.id || null
  }

  if (appointmentId) {
    const { error: finalizeError } = await supabase
      .from('appointments')
      .update({
        notes: normalizedPayload.notes,
        duration_minutes: normalizedPayload.duration_minutes,
        amount: normalizedPayload.amount,
        status: 'pending',
        slot_id: resolvedSlotId,
        updated_at: nowIso,
      })
      .eq('id', appointmentId)

    if (finalizeError) {
      throw finalizeError
    }

    const { error: roomInsertError } = await supabase
      .from('consultation_rooms')
      .insert({ appointment_id: appointmentId })

    const roomInsertMsg = String(roomInsertError?.message || '').toLowerCase()
    const isDuplicateRoom =
      roomInsertMsg.includes('duplicate') ||
      roomInsertMsg.includes('already exists') ||
      roomInsertMsg.includes('unique')

    if (roomInsertError && !isDuplicateRoom) {
      console.warn('[booking] consultation room ensure failed', roomInsertError)
    }
  }

  if (paymentMethod && appointmentId) {
    const normalizedPaymentMethod = normalizeDigitalPaymentMethod(paymentMethod)

    const { data: existingTx } = await supabase
      .from('transactions')
      .select('id')
      .eq('appointment_id', appointmentId)
      .eq('client_id', resolvedClientId)
      .eq('payment_status', 'paid')
      .limit(1)
      .maybeSingle()

    if (!existingTx?.id) {
      let txRes = await supabase.from('transactions').insert({
        appointment_id: appointmentId,
        client_id: resolvedClientId,
        attorney_id: normalizedPayload.attorney_id,
        amount: normalizedPayload.amount,
        payment_status: 'paid',
        payment_method: normalizedPaymentMethod,
        provider_reference: resolvedPaymentCode,
        created_at: nowIso,
        updated_at: nowIso,
      })

      if (
        txRes.error &&
        String(txRes.error.message || '').toLowerCase().includes('provider_reference')
      ) {
        txRes = await supabase.from('transactions').insert({
          appointment_id: appointmentId,
          client_id: resolvedClientId,
          attorney_id: normalizedPayload.attorney_id,
          amount: normalizedPayload.amount,
          payment_status: 'paid',
          payment_method: normalizedPaymentMethod,
          reference_no: resolvedPaymentCode,
          created_at: nowIso,
          updated_at: nowIso,
        })
      }

      if (txRes.error) {
        throw txRes.error
      }

      try {
        const whenLabel = new Date(normalizedPayload.scheduled_at).toLocaleString('en-PH', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        })

        const { error: paymentNotificationError } = await supabase.from('notifications').insert({
          user_id: resolvedClientId,
          title: 'Payment Confirmed',
          body: `Your payment for ${normalizedPayload.title || 'your consultation'} on ${whenLabel} has been received.`,
          type: 'payment',
          is_read: false,
          created_at: nowIso,
        })

        if (paymentNotificationError) {
          console.warn('[booking] failed to create client payment notification', paymentNotificationError)
        }
      } catch (paymentNotificationFailure) {
        console.warn('[booking] client payment notification step failed', paymentNotificationFailure)
      }
    }
  }

  if (appointmentId) {
    try {
      const rawClientName =
        String(user.user_metadata?.full_name || '').trim() ||
        String(user.email || '').trim() ||
        'A client'
      const whenLabel = new Date(normalizedPayload.scheduled_at).toLocaleString('en-PH', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })

      const dedupeMarker = `[appt:${appointmentId}]`
      const { error: notificationError } = await supabase.from('notifications').insert({
        user_id: normalizedPayload.attorney_id,
        title: 'Pending Consultation Booking',
        body: `${rawClientName} is booking ${normalizedPayload.title || 'a consultation'} on ${whenLabel}. Waiting for payment. ${dedupeMarker}`,
        type: 'consultation',
        is_read: false,
        created_at: nowIso,
      })

      if (notificationError) {
        console.warn('[booking] failed to create attorney pending notification', notificationError)
      }

      const { error: clientBookingNotificationError } = await supabase.from('notifications').insert({
        user_id: resolvedClientId,
        title: 'Booking Submitted',
        body: `Your booking for ${normalizedPayload.title || 'a consultation'} on ${whenLabel} was submitted successfully.`,
        type: 'consultation',
        is_read: false,
        created_at: nowIso,
      })

      if (clientBookingNotificationError) {
        console.warn('[booking] failed to create client booking notification', clientBookingNotificationError)
      }
    } catch (notificationFailure) {
      console.warn('[booking] notification step failed', notificationFailure)
    }
  }

  return { success: true, appointmentId, payload: normalizedPayload }
}

export async function createNotarialRequest({
  clientId,
  attorneyId = null,
  serviceType,
  preferredDate,
  details,
  notes,
  documentUrl,
  documentName,
  amount,
}) {
  const nowIso = new Date().toISOString()

  const { data, error } = await supabase
    .from('notarial_requests')
    .insert({
      client_id: clientId,
      attorney_id: attorneyId,
      service_type: serviceType,
      preferred_date: preferredDate || null,
      details: details || notes || null,
      document_url: documentUrl || documentName || null,
      amount: resolveNotarialAmount(amount),
      status: 'pending',
      created_at: nowIso,
      updated_at: nowIso,
    })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function fetchAttorneyUpcomingAppointments(userId, options = {}) {
  const force = Boolean(options?.force)
  const nowIso = new Date().toISOString()

  let query = supabase
    .from('appointments')
    .select(APPOINTMENT_ATTORNEY_LIST_SELECT)
    .eq('attorney_id', userId)
    .in('status', APPOINTMENT_STATUS_UPCOMING)
    .gte('scheduled_at', nowIso)
    .order('scheduled_at', { ascending: true })

  if (!force) {
    query = query.limit(120)
  }

  let { data, error } = await query

  if (error && isMissingColumnError(error, 'attachment_url')) {
    const fallback = await supabase
      .from('appointments')
      .select('id, title, scheduled_at, status, notes, amount, client:client_id(full_name)')
      .eq('attorney_id', userId)
      .in('status', APPOINTMENT_STATUS_UPCOMING)
      .gte('scheduled_at', nowIso)
      .order('scheduled_at', { ascending: true })
    data = fallback.data
    error = fallback.error
  }

  if (error) throw error

  const appointmentIds = (data || []).map((row) => row.id).filter(Boolean)
  let paidAppointmentIds = new Set()
  if (appointmentIds.length) {
    const { data: txRows, error: txError } = await supabase
      .from('transactions')
      .select('appointment_id, payment_status')
      .eq('attorney_id', userId)
      .in('appointment_id', appointmentIds)
    if (!txError) {
      paidAppointmentIds = new Set(
        (txRows || [])
          .filter((tx) => String(tx.payment_status || '').toLowerCase() === 'paid')
          .map((tx) => tx.appointment_id),
      )
    }
  }

  return mapAttorneyUpcomingAppointments(data || [], paidAppointmentIds)
}

function mapAttorneyUpcomingAppointments(rows, paidAppointmentIds) {
  const paidIds = paidAppointmentIds || new Set()
  return (rows || []).map((item) => {
    const dt = new Date(item.scheduled_at)
    const valid = !Number.isNaN(dt.getTime())
    const dateLabel = valid
      ? dt.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })
      : 'TBD'
    const timeLabel = valid
      ? dt.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })
      : 'TBD'
    const derivedSlot = deriveSlotFieldsFromScheduledAt(item.scheduled_at)
    const consultationPaid =
      paidIds.has(item.id) || Number(item.amount || 0) > 0

    return {
      id: item.id,
      name: item.client?.full_name || 'Client',
      initials: (item.client?.full_name || 'CL')
        .split(' ')
        .map((part) => part[0])
        .slice(0, 2)
        .join('')
        .toUpperCase(),
      area: (item.title || 'Consultation').toUpperCase(),
      date: dateLabel,
      time: timeLabel,
      scheduledAt: item.scheduled_at,
      slotDate: item.slot_date || derivedSlot.slotDate,
      slotTime: item.slot_time || derivedSlot.slotTime,
      status: item.status,
      paymentStatus: consultationPaid ? 'paid' : 'unpaid',
      color: '#6366f1',
      concern: item.notes || '',
      attachmentUrl: item.attachment_url || '',
      attachmentName: item.attachment_name || '',
    }
  })
}

export async function fetchAttorneyDashboardSnapshot(userId, options = {}) {
  if (!userId) {
    return {
      appointments: [],
      unreadNotificationCount: 0,
      pendingRequestCount: 0,
      upcomingCount: 0,
      myAppointmentCount: 0,
    }
  }

  const nowIso = new Date().toISOString()

  const [appointmentsRes, unreadRes, pendingRes, upcomingCountRes, myCountRes] = await Promise.all([
    supabase
      .from('appointments')
      .select(APPOINTMENT_ATTORNEY_LIST_SELECT)
      .eq('attorney_id', userId)
      .in('status', APPOINTMENT_STATUS_UPCOMING)
      .gte('scheduled_at', nowIso)
      .order('scheduled_at', { ascending: true })
      .limit(3),
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false),
    supabase
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('attorney_id', userId)
      .eq('status', 'pending'),
    supabase
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('attorney_id', userId)
      .in('status', APPOINTMENT_STATUS_UPCOMING)
      .gte('scheduled_at', nowIso),
    supabase
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('attorney_id', userId)
      .in('status', APPOINTMENT_STATUS_MY_APPOINTMENTS)
      .gte('scheduled_at', nowIso),
  ])

  if (appointmentsRes.error) {
    if (isMissingColumnError(appointmentsRes.error, 'attachment_url')) {
      const retry = await supabase
        .from('appointments')
        .select('id, title, scheduled_at, status, notes, amount, client:client_id(full_name)')
        .eq('attorney_id', userId)
        .in('status', APPOINTMENT_STATUS_UPCOMING)
        .gte('scheduled_at', nowIso)
        .order('scheduled_at', { ascending: true })
        .limit(3)
      if (retry.error) throw retry.error
      appointmentsRes.data = retry.data
      appointmentsRes.error = null
    } else {
      throw appointmentsRes.error
    }
  }
  if (unreadRes.error) throw unreadRes.error
  if (pendingRes.error) throw pendingRes.error
  if (upcomingCountRes.error) throw upcomingCountRes.error
  if (myCountRes.error) throw myCountRes.error

  const appointmentIds = (appointmentsRes.data || []).map((row) => row.id).filter(Boolean)
  let paidAppointmentIds = new Set()
  if (appointmentIds.length) {
    const { data: txRows, error: txError } = await supabase
      .from('transactions')
      .select('appointment_id, payment_status')
      .eq('attorney_id', userId)
      .in('appointment_id', appointmentIds)
    if (!txError) {
      paidAppointmentIds = new Set(
        (txRows || [])
          .filter((tx) => String(tx.payment_status || '').toLowerCase() === 'paid')
          .map((tx) => tx.appointment_id),
      )
    }
  }

  return {
    appointments: mapAttorneyUpcomingAppointments(appointmentsRes.data || [], paidAppointmentIds),
    unreadNotificationCount: Number(unreadRes.count || 0),
    pendingRequestCount: Number(pendingRes.count || 0),
    upcomingCount: Number(upcomingCountRes.count || 0),
    myAppointmentCount: Number(myCountRes.count || 0),
  }
}

export async function fetchAttorneyConsultationLogs(userId, options = {}) {
  const force = Boolean(options?.force)
  let query = supabase
    .from('appointments')
    .select('id, title, scheduled_at, status, updated_at, client:client_id(full_name)')
    .eq('attorney_id', userId)
    .eq('status', 'completed')
    .order('scheduled_at', { ascending: false })

  if (!force) {
    query = query.limit(100)
  }

  const { data, error } = await query
  if (error) throw error

  return (data || []).map((item) => {
    const dt = new Date(item.scheduled_at || item.updated_at)
    const valid = !Number.isNaN(dt.getTime())
    return {
      id: item.id,
      clientName: item.client?.full_name || 'Client',
      title: item.title || 'Consultation',
      scheduledAt: item.scheduled_at,
      dateLabel: valid
        ? dt.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
        : 'TBD',
      timeLabel: valid
        ? dt.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })
        : 'TBD',
      status: String(item.status || '').toLowerCase(),
    }
  })
}

export async function markAttorneyNotificationsAsRead(attorneyId) {
  if (!attorneyId) return
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('user_id', attorneyId)
    .eq('is_read', false)
  if (error) throw error
}

function createDebouncedRealtimeHandler(callback, delayMs = 400) {
  let timer = null
  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      callback?.()
    }, delayMs)
  }
  const dispose = () => {
    if (timer) clearTimeout(timer)
    timer = null
  }
  return { schedule, dispose }
}

export function subscribeToClientAppointments(clientId, onChange) {
  if (!clientId) return () => {}

  const { schedule, dispose } = createDebouncedRealtimeHandler(() => {
    invalidateClientHomeCache(clientId)
    onChange?.()
  })

  const channel = supabase
    .channel(`client-appointments:${clientId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'appointments',
        filter: `client_id=eq.${clientId}`,
      },
      () => schedule(),
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'transactions',
        filter: `client_id=eq.${clientId}`,
      },
      () => schedule(),
    )
    .subscribe()

  return () => {
    dispose()
    try {
      supabase.removeChannel(channel)
    } catch {
      // ignore
    }
  }
}

export function subscribeToAttorneyAppointments(attorneyId, onChange) {
  if (!attorneyId) return () => {}
  const channel = supabase
    .channel(`attorney-appointments:${attorneyId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'appointments',
        filter: `attorney_id=eq.${attorneyId}`,
      },
      () => onChange?.(),
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'transactions',
        filter: `attorney_id=eq.${attorneyId}`,
      },
      () => onChange?.(),
    )
    .subscribe()

  return () => {
    try {
      supabase.removeChannel(channel)
    } catch {
      // ignore
    }
  }
}

export function subscribeToAttorneyNotifications(attorneyId, onChange) {
  if (!attorneyId) return () => {}
  const channel = supabase
    .channel(`attorney_notifications_${attorneyId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${attorneyId}`,
      },
      () => onChange?.(),
    )
    .subscribe()

  return () => {
    try {
      supabase.removeChannel(channel)
    } catch {
      // ignore
    }
  }
}

export const getAvailability = fetchAvailability

/** Realtime availability updates (web BookAppointment parity). */
export function subscribeToAvailabilitySlots(onChange) {
  const channel = supabase
    .channel('availability-slots:realtime')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'availability_slots',
      },
      (payload) => {
        if (typeof onChange === 'function') {
          onChange(payload)
        }
      },
    )
    .subscribe()

  return () => {
    try {
      supabase.removeChannel(channel)
    } catch {
      // ignore
    }
  }
}

export async function rescheduleAttorneyAppointment({ appointmentId, scheduledAt, note }) {
  const { error } = await supabase
    .from('appointments')
    .update({ status: 'rescheduled', scheduled_at: scheduledAt, notes: note, updated_at: new Date().toISOString() })
    .eq('id', appointmentId)

  if (error) throw error
}

export async function fetchAttorneyNotarialRequests(userId) {
  const { data, error } = await supabase
    .from('notarial_requests')
    .select('id, service_type, status, document_url, preferred_date, created_at, notes, client:client_id(full_name)')
    .eq('attorney_id', userId)
    .order('created_at', { ascending: false })

  if (error) throw error

  return (data || []).map((item) => {
    const dt = new Date(item.created_at)
    const valid = !Number.isNaN(dt.getTime())
    return {
      id: item.id,
      docType: item.service_type || 'Notarial Request',
      status:
        (item.status || '').toLowerCase() === 'accepted' || (item.status || '').toLowerCase() === 'approved'
          ? 'Approved'
          : (item.status || '').toLowerCase() === 'rejected' || (item.status || '').toLowerCase() === 'cancelled'
            ? 'Rejected'
            : 'Pending',
      submittedBy: item.client?.full_name || 'Client',
      fileName: item.document_url || 'N/A',
      date: valid ? dt.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : 'TBD',
      time: valid ? dt.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' }) : 'TBD',
      detailNote: item.notes || '',
      preferredDate: item.preferred_date || '',
    }
  })
}

export async function updateAttorneyNotarialRequestStatus({ requestId, status, note }) {
  const payload = { status, updated_at: new Date().toISOString() }
  if (note) payload.notes = note
  const { error } = await supabase.from('notarial_requests').update(payload).eq('id', requestId)
  if (error) throw error
}

export async function fetchAttorneyAnnouncementsData(userId) {
  const { data, error } = await supabase
    .from('notifications')
    .select('id, title, body, type, data, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) throw error

  return (data || []).map((item) => {
    const dt = new Date(item.created_at)
    const valid = !Number.isNaN(dt.getTime())
    const type = item.type || 'general'
    return {
      id: item.id,
      title: item.title || 'Announcement',
      body: item.body || '',
      imageUrl: parseNotificationImageUrl(item.data),
      date: valid ? dt.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Today',
      time: valid ? dt.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' }) : 'Now',
      author: 'LegalLink Admin',
      pinned: type.includes('important') || type.includes('admin'),
      tag: type.includes('maintenance') ? 'Maintenance' : type.includes('important') ? 'Important' : 'General',
    }
  })
}

const normalizeConsultationTypeLabel = (title) => {
  const raw = String(title || '').trim()
  if (!raw) return 'General Consultation'
  return raw
    .replace(/consultation/gi, '')
    .replace(/legal/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[-:]+$/g, '')
    .trim() || 'General Consultation'
}

const GENDER_MOCK_BASELINE_MALE = 2
const GENDER_MOCK_BASELINE_FEMALE = 4

const bucketClientProfileGender = (raw) => {
  const v = String(raw ?? '').trim().toLowerCase()
  if (!v) return null
  if (v === 'male') return 'male'
  if (v === 'female') return 'female'
  if (v === 'other' || v === 'others') return 'other'
  return null
}

const buildGenderAnalyticsWithBaseline = (profileRows) => {
  let male = GENDER_MOCK_BASELINE_MALE
  let female = GENDER_MOCK_BASELINE_FEMALE
  let other = 0
  ;(profileRows || []).forEach((row) => {
    const raw = row?.gender ?? row?.sex
    const k = bucketClientProfileGender(raw)
    if (k === 'male') male += 1
    else if (k === 'female') female += 1
    else if (k === 'other') other += 1
  })
  const baseRows = [
    { key: 'male', label: 'Male', count: male, percent: 0 },
    { key: 'female', label: 'Female', count: female, percent: 0 },
  ]
  if (other > 0) {
    baseRows.push({ key: 'other', label: 'Other', count: other, percent: 0 })
  }
  const genderTotal = baseRows.reduce((sum, r) => sum + Number(r.count || 0), 0)
  baseRows.forEach((r) => {
    r.percent = genderTotal > 0 ? Math.round((r.count / genderTotal) * 100) : 0
  })
  return { rows: baseRows, total: genderTotal }
}

const normalizeAttorneyAppointmentStatusBucket = (statusRaw) => {
  const s = String(statusRaw || '').trim().toLowerCase()
  if (s === 'completed') return 'Completed'
  if (s === 'cancelled' || s === 'rejected') return 'Cancelled'
  if (s === 'confirmed' || s === 'paid' || s === 'pending' || s === 'rescheduled') return 'Upcoming'
  return 'Upcoming'
}

const isPaidOrFreeConsultation = ({ amount, consultationPaid }) => {
  const fee = Number(amount ?? 0)
  if (!Number.isFinite(fee) || fee <= 0) return true
  return Boolean(consultationPaid)
}

export async function fetchAttorneyConsultationAnalyticsData(userId) {
  const [apptsRes, paidTxRes, profileRes, attorneyRes] = await Promise.all([
    supabase
      .from('appointments')
      .select('id, title, status, scheduled_at, updated_at, amount')
      .eq('attorney_id', userId),
    supabase
      .from('transactions')
      .select('appointment_id')
      .eq('attorney_id', userId)
      .eq('payment_status', 'paid'),
    supabase.from('profiles').select('full_name').eq('id', userId).maybeSingle(),
    supabase.from('attorney_profiles').select('specialties').eq('user_id', userId).maybeSingle(),
  ])

  if (apptsRes.error) throw apptsRes.error
  if (paidTxRes.error) throw paidTxRes.error

  const appointments = apptsRes.data || []
  const paidTxRows = paidTxRes.data || []
  const paidIds = new Set(paidTxRows.map((r) => r.appointment_id).filter(Boolean))

  const branchOptions = getConsultationBranchesForAttorney({
    name: profileRes.data?.full_name || '',
    specialties: normalizeStringArray(attorneyRes.data?.specialties),
  })

  const excludedStatuses = new Set(['rejected', 'cancelled'])
  const branchCounts = new Map(branchOptions.map((label) => [label, 0]))
  let classifiedTotal = 0
  let total = 0

  appointments.forEach((row) => {
    const status = String(row?.status || '').toLowerCase()
    if (excludedStatuses.has(status)) return

    total += 1
    if (!isPaidOrFreeConsultation({ amount: row?.amount, consultationPaid: paidIds.has(row.id) })) return

    const branch = parseConsultationBranchFromTitle(row?.title)
    if (!branch || !branchCounts.has(branch)) return

    branchCounts.set(branch, Number(branchCounts.get(branch) || 0) + 1)
    classifiedTotal += 1
  })

  const branchRows = branchOptions.map((label) => ({
    label,
    count: Number(branchCounts.get(label) || 0),
  }))
  const branchMaxCount = branchRows.reduce((max, row) => Math.max(max, row.count), 0)

  const statusCounts = new Map()
  appointments.forEach((row) => {
    const label = normalizeAttorneyAppointmentStatusBucket(row?.status)
    statusCounts.set(label, Number(statusCounts.get(label) || 0) + 1)
  })
  const status = Array.from(statusCounts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)

  let gender = buildGenderAnalyticsWithBaseline([])
  try {
    let profilesRes = await supabase.from('profiles').select('id, sex, gender').eq('role', 'Client')
    if (profilesRes.error && isMissingColumnError(profilesRes.error, 'gender')) {
      profilesRes = await supabase.from('profiles').select('id, sex').eq('role', 'Client')
    }
    if (profilesRes.error) throw profilesRes.error
    gender = buildGenderAnalyticsWithBaseline(profilesRes.data || [])
  } catch (e) {
    console.warn('[analytics] gender profiles query failed; using mock baseline only', e)
    gender = buildGenderAnalyticsWithBaseline([])
  }

  return {
    rows: branchRows,
    total,
    maxCount: branchMaxCount,
    branches: {
      rows: branchRows,
      total: classifiedTotal,
      maxCount: branchMaxCount,
    },
    status,
    gender,
  }
}

export async function fetchAttorneyEarningsData(userId) {
  const [transactionsRes, payoutRes] = await Promise.all([
    supabase
      .from('transactions')
      .select('id, amount, payment_status, created_at, client:client_id(full_name), appointment_id')
      .eq('attorney_id', userId)
      .eq('payment_status', 'paid')
      .order('created_at', { ascending: false }),
    supabase
      .from('payout_requests')
      .select('id, amount, status, requested_at')
      .eq('attorney_id', userId)
      .order('requested_at', { ascending: false }),
  ])

  if (transactionsRes.error) throw transactionsRes.error
  if (payoutRes.error) throw payoutRes.error

  const rows = (transactionsRes.data || []).map((tx) => {
    const amount = Number(tx.amount || 0)
    const fee = amount * 0.1
    const net = amount - fee
    const dt = new Date(tx.created_at)
    const valid = !Number.isNaN(dt.getTime())
    return {
      id: tx.id,
      client: tx.client?.full_name || 'Client',
      service: tx.appointment_id ? 'Consultation' : 'Notarial',
      date: valid ? dt.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : 'TBD',
      amount: `PHP ${amount.toFixed(2)}`,
      fee: `-PHP ${fee.toFixed(2)}`,
      net: `PHP ${net.toFixed(2)}`,
      rawAmount: amount,
      rawNet: net,
      status: 'Released',
    }
  })

  const totalNet = rows.reduce((sum, row) => sum + row.rawNet, 0)
  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)
  const monthNet = rows
    .filter((row) => {
      const parsed = new Date(row.date)
      return !Number.isNaN(parsed.getTime()) && parsed >= monthStart
    })
    .reduce((sum, row) => sum + row.rawNet, 0)

  const pendingPayout = (payoutRes.data || [])
    .filter((row) => (row.status || '').toLowerCase() === 'pending')
    .reduce((sum, row) => sum + Number(row.amount || 0), 0)

  return {
    rows,
    totalNet,
    monthNet,
    pendingPayout,
  }
}

export async function fetchAttorneyHomeData(userId) {
  const cached = attorneyHomeCache.get(userId)
  if (cached && Date.now() - cached.updatedAt < DASHBOARD_CACHE_TTL_MS) {
    return cached.value
  }

  const [profileRes, attorneyRes, appointmentsRes, earningsRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('*')
      .eq('id', userId),
    supabase
      .from('attorney_profiles')
      .select('*')
      .eq('user_id', userId),
    supabase
      .from('appointments')
      .select('id, title, scheduled_at, status, client_id')
      .eq('attorney_id', userId)
      .order('scheduled_at', { ascending: true }),
    supabase
      .from('transactions')
      .select('amount, payment_status')
      .eq('attorney_id', userId)
      .eq('payment_status', 'paid'),
  ])

  if (profileRes.error) throw profileRes.error
  if (attorneyRes.error) throw attorneyRes.error
  if (appointmentsRes.error) throw appointmentsRes.error
  if (earningsRes.error) throw earningsRes.error

  const totalEarnings = (earningsRes.data || []).reduce((sum, t) => sum + parseFloat(t.amount || 0), 0)

  const result = {
    profile: profileRes.data,
    attorney: attorneyRes.data,
    appointments: appointmentsRes.data || [],
    totalEarnings,
  }

  attorneyHomeCache.set(userId, { value: result, updatedAt: Date.now() })
  return result
}

async function fetchAttorneyProfileStats(userId) {
  const [consultationsRes, notarialRes, paidTxRes] = await Promise.all([
    supabase.from('appointments').select('id, amount').eq('attorney_id', userId),
    supabase.from('notarial_requests').select('id').eq('attorney_id', userId),
    supabase
      .from('transactions')
      .select('appointment_id')
      .eq('attorney_id', userId)
      .eq('payment_status', 'paid')
      .not('appointment_id', 'is', null),
  ])

  if (consultationsRes.error) throw consultationsRes.error
  if (notarialRes.error) throw notarialRes.error
  if (paidTxRes.error) throw paidTxRes.error

  const paidIds = new Set((paidTxRes.data || []).map((r) => r.appointment_id).filter(Boolean))
  const consultationCount = (consultationsRes.data || []).filter((row) =>
    isPaidOrFreeConsultation({ amount: row?.amount, consultationPaid: paidIds.has(row.id) }),
  ).length

  return {
    consultationCount,
    notarialCount: (notarialRes.data || []).length,
  }
}

async function fetchAttorneyProfileCore(userId) {
  const [profileRes, attorneyRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name, email, phone, address, avatar_url, role')
      .eq('id', userId)
      .maybeSingle(),
    supabase
      .from('attorney_profiles')
      .select('firm_name, years_experience, specialties, bio, consultation_fee, prc_id, is_verified')
      .eq('user_id', userId)
      .maybeSingle(),
  ])

  if (profileRes.error) throw profileRes.error
  if (attorneyRes.error) throw attorneyRes.error

  const specialties = normalizeStringArray(attorneyRes.data?.specialties)
  const prior = getCachedAttorneyProfile(userId)

  return {
    profile: profileRes.data || {},
    attorney: attorneyRes.data || {},
    specialties,
    consultationCount: prior?.consultationCount ?? 0,
    notarialCount: prior?.notarialCount ?? 0,
  }
}

/** Cached attorney profile; `includeStats: false` returns after 2 queries (fast paint). */
export async function fetchAttorneyProfile(userId, options = {}) {
  const force = Boolean(options?.force)
  const includeStats = options?.includeStats !== false

  if (!force) {
    const cached = getCachedAttorneyProfile(userId)
    if (cached) {
      if (!includeStats || cached.statsLoaded) return cached
      const stats = await fetchAttorneyProfileStats(userId)
      const merged = {...cached, ...stats, statsLoaded: true}
      setCachedAttorneyProfile(userId, merged)
      return merged
    }
  }

  const core = await fetchAttorneyProfileCore(userId)
  let result = {...core, statsLoaded: false}
  setCachedAttorneyProfile(userId, result)

  if (!includeStats) return result

  const stats = await fetchAttorneyProfileStats(userId)
  result = {...result, ...stats, statsLoaded: true}
  setCachedAttorneyProfile(userId, result)
  return result
}

/** Refresh consultation/notarial counts without reloading profile rows. */
export function prefetchAttorneyProfileStats(userId) {
  if (!userId) return Promise.resolve(null)
  return fetchAttorneyProfileStats(userId)
    .then((stats) => {
      const cached = getCachedAttorneyProfile(userId) || {}
      const merged = {...cached, ...stats, statsLoaded: true}
      setCachedAttorneyProfile(userId, merged)
      return merged
    })
    .catch(() => null)
}

/**
 * @param {string} appointmentId
 * @param {{ includeMessages?: boolean }} [options] — set includeMessages: false for summary-only views
 */
export async function fetchConsultationTranscriptForAppointment(appointmentId, options = {}) {
  const includeMessages = options.includeMessages !== false
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) throw new Error('Not authenticated')
  if (!appointmentId) throw new Error('Appointment is required.')

  let appointment = null
  let appointmentError = null
  const richAppointmentRes = await supabase
    .from('appointments')
    .select('id, attorney_id, client_id, attorney_consultation_summary, title')
    .eq('id', appointmentId)
    .maybeSingle()

  if (richAppointmentRes.error && isMissingColumnError(richAppointmentRes.error, 'attorney_consultation_summary')) {
    const minAppointmentRes = await supabase
      .from('appointments')
      .select('id, attorney_id, client_id, title')
      .eq('id', appointmentId)
      .maybeSingle()
    appointment = minAppointmentRes.data || null
    appointmentError = minAppointmentRes.error || null
  } else {
    appointment = richAppointmentRes.data || null
    appointmentError = richAppointmentRes.error || null
  }

  if (appointmentError) throw new Error(appointmentError.message)
  if (!appointment) throw new Error('Appointment not found.')

  const canView =
    String(user.id) === String(appointment.attorney_id) ||
    String(user.id) === String(appointment.client_id)

  if (!canView) {
    throw new Error('You do not have access to this transcript.')
  }

  const roomSelect = includeMessages
    ? `
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
    `
    : 'id, is_closed'

  const { data, error } = await supabase
    .from('consultation_rooms')
    .select(roomSelect)
    .eq('appointment_id', appointmentId)
    .maybeSingle()

  if (error) throw new Error(error.message)

  const attorneyConsultationSummary = String(appointment.attorney_consultation_summary || '')

  if (!includeMessages) {
    return {
      messages: [],
      isClosed: Boolean(data?.is_closed),
      roomId: data?.id ?? null,
      attorneyConsultationSummary,
      title: appointment.title || '',
    }
  }

  if (!data?.id) {
    return {
      messages: [],
      isClosed: true,
      roomId: null,
      attorneyConsultationSummary,
      title: appointment.title || '',
    }
  }

  const sorted = (data.messages || [])
    .slice()
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

  const messages = sorted.map((row) => {
    const isMe = String(row.sender_id) === String(user.id)
    const dt = new Date(row.created_at)
    return {
      id: row.id,
      sender: isMe ? 'me' : 'them',
      text: row.message || '',
      message_type: row.message_type || 'text',
      file_bucket: row.file_bucket,
      file_path: row.file_path,
      file_name: row.file_name,
      mime_type: row.mime_type,
      time: Number.isNaN(dt.getTime())
        ? ''
        : dt.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' }),
    }
  })

  return {
    messages,
    isClosed: Boolean(data.is_closed),
    roomId: data.id,
    attorneyConsultationSummary,
    title: appointment.title || '',
  }
}

// Admin-controlled feature flags backed by public.app_config (Supabase).
// We keep an in-memory cache so reads are instant after the first warmup,
// and a single realtime subscription keeps the cache in sync when an admin
// toggles a value in the Settings page.

const APP_CONFIG_KNOWN_KEYS = ['prevent_double_booking', 'enforce_schedule_window']
const APP_CONFIG_LOAD_TIMEOUT_MS = 8000
const appConfigCache = new Map()
let appConfigLoadPromise = null
let appConfigChannel = null

const withAppConfigTimeout = (promise, label) =>
  Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(
        () => reject(new Error(`${label} timed out after ${APP_CONFIG_LOAD_TIMEOUT_MS}ms`)),
        APP_CONFIG_LOAD_TIMEOUT_MS,
      )
    }),
  ])

// Coerces typical Postgres jsonb representations (true/false, "true"/"false",
// 1/0) into a strict boolean. Used by the admin toggles.
const coerceFlag = (value, fallback = true) => {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true' || normalized === '1') return true
    if (normalized === 'false' || normalized === '0') return false
  }
  return fallback
}

// Synchronous, cache-only read of an admin feature flag.
export const isAppConfigFlagOn = (key, fallback = true) => {
  if (!appConfigCache.has(key)) return fallback
  return coerceFlag(appConfigCache.get(key), fallback)
}

const fetchAppConfigValue = async (key) => {
  const { data, error } = await supabase.rpc('get_app_config', { p_key: key })
  if (!error) return data ?? null

  const isMissingFunction =
    error?.code === '42883' ||
    String(error?.message || '').toLowerCase().includes('does not exist')
  if (!isMissingFunction) throw error

  const { data: row, error: tableError } = await supabase
    .from('app_config')
    .select('value')
    .eq('key', key)
    .maybeSingle()
  if (tableError) throw tableError
  return row?.value ?? null
}

// Pre-fetches the known feature flags into the cache.
export function ensureAppConfigLoaded() {
  if (appConfigLoadPromise) return appConfigLoadPromise

  appConfigLoadPromise = (async () => {
    await Promise.all(
      APP_CONFIG_KNOWN_KEYS.map(async (key) => {
        try {
          const value = await withAppConfigTimeout(
            fetchAppConfigValue(key),
            `app_config:${key}`,
          )
          appConfigCache.set(key, value)
        } catch (err) {
          console.warn(`[app_config] failed to warm "${key}":`, err?.message || err)
        }
      }),
    )
  })()

  appConfigLoadPromise.finally(() => {
    appConfigLoadPromise = null
  })

  return appConfigLoadPromise
}

// Subscribes once to changes on public.app_config so the cache stays current.
export function subscribeToAppConfigChanges() {
  if (appConfigChannel) return appConfigChannel

  try {
    appConfigChannel = supabase
      .channel('app_config_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'app_config' },
        (payload) => {
          const row = payload?.new || payload?.old
          if (!row?.key) return
          if (payload?.eventType === 'DELETE') {
            appConfigCache.delete(row.key)
          } else {
            appConfigCache.set(row.key, row.value ?? null)
          }
        },
      )
      .subscribe()
  } catch (err) {
    console.warn('[app_config] realtime subscribe failed:', err?.message || err)
    appConfigChannel = null
  }

  return appConfigChannel
}

// Reads a single key from public.app_config.
export async function getAppConfig(key, fallbackValue = null) {
  if (!key) return fallbackValue

  if (appConfigCache.has(key)) {
    const cached = appConfigCache.get(key)
    return cached === null || cached === undefined ? fallbackValue : cached
  }

  try {
    const value = await fetchAppConfigValue(key)
    appConfigCache.set(key, value)
    return value === null || value === undefined ? fallbackValue : value
  } catch (err) {
    console.warn(`[app_config] getAppConfig("${key}") failed:`, err?.message || err)
    return fallbackValue
  }
}

// Writes a single key in public.app_config via the set_app_config RPC.
export async function setAppConfig(key, value) {
  if (!key) throw new Error('setAppConfig requires a key')

  const { data, error } = await supabase.rpc('set_app_config', {
    p_key: key,
    p_value: value,
  })
  if (error) throw error

  appConfigCache.set(key, data ?? value)
  return data
}

// ─── Client-led reschedule (pending admin approval — matches web) ─────────────

const RESCHEDULE_PENDING_PIPE_RE =
  /\[RESCHEDULE_PENDING\|([^|\]]+)\|([^\]]*)\]/i
const RESCHEDULE_PENDING_LEGACY_RE = /\[RESCHEDULE_PENDING:[^\]]+\]/i
const RESCHEDULE_PENDING_ISO_TAIL_RE =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z):?(.*)$/i

const decodeRescheduleReason = (raw) => {
  const trimmed = String(raw || '').trim()
  if (!trimmed) return ''
  try {
    return decodeURIComponent(trimmed)
  } catch {
    return trimmed
  }
}

const isGarbageRescheduleReason = (reason) => {
  const text = String(reason || '').trim()
  if (!text) return true
  if (/^\d{2}:\d{2}/.test(text)) return true
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return true
  if (/^00:00\.000Z:?$/i.test(text)) return true
  return false
}

export function parseReschedulePendingFromNotes(notes) {
  const text = String(notes || '')

  const pipeMatch = text.match(RESCHEDULE_PENDING_PIPE_RE)
  if (pipeMatch) {
    const requestedScheduledAt = String(pipeMatch[1] || '').trim()
    if (!requestedScheduledAt) return null
    const reason = decodeRescheduleReason(pipeMatch[2])
    return {
      requestedScheduledAt,
      reason: isGarbageRescheduleReason(reason) ? '' : reason,
    }
  }

  const legacyMatch = text.match(RESCHEDULE_PENDING_LEGACY_RE)
  if (!legacyMatch) return null

  const inner = legacyMatch[0]
    .replace(/^\[RESCHEDULE_PENDING:/i, '')
    .replace(/\]$/, '')

  const isoTail = inner.match(RESCHEDULE_PENDING_ISO_TAIL_RE)
  if (isoTail) {
    const requestedScheduledAt = String(isoTail[1] || '').trim()
    const reason = decodeRescheduleReason(isoTail[2])
    return {
      requestedScheduledAt,
      reason: isGarbageRescheduleReason(reason) ? '' : reason,
    }
  }

  return null
}

export function stripReschedulePendingMarker(notes) {
  return String(notes || '')
    .replace(RESCHEDULE_PENDING_PIPE_RE, '')
    .replace(RESCHEDULE_PENDING_LEGACY_RE, '')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

export function buildReschedulePendingNotes(existingNotes, { scheduledAt, reason }) {
  const base = stripReschedulePendingMarker(existingNotes)
  const encodedReason = encodeURIComponent(String(reason || '').slice(0, 500))
  const marker = `[RESCHEDULE_PENDING|${scheduledAt}|${encodedReason}]`
  return base ? `${base}\n${marker}` : marker
}

const formatScheduleLabelFromIso = (iso) => {
  const parsed = iso ? new Date(iso) : null
  if (!parsed || Number.isNaN(parsed.getTime())) return 'a new schedule'
  return parsed.toLocaleString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

const phDateKeyFromIso = (iso) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso))

const phTimeLabelFromIso = (iso) =>
  new Date(iso).toLocaleTimeString('en-US', {
    timeZone: 'Asia/Manila',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })

function invalidateAvailabilityCache(attorneyId, _dateKey) {
  if (attorneyId) {
    attorneyHomeCache.delete(attorneyId)
  }
}

function invalidateAttorneyAppointmentsCache(attorneyId) {
  if (attorneyId) {
    attorneyHomeCache.delete(attorneyId)
  }
}

async function notifyAdminsWithBodyMarker({ title, body, type = 'admin_general', marker }) {
  if (!marker) return
  const adminIds = await fetchAdminUserIds()
  for (const uid of adminIds) {
    try {
      const { data: existing } = await supabase
        .from('notifications')
        .select('id')
        .eq('user_id', uid)
        .ilike('body', `%${marker}%`)
        .limit(1)
      if (existing?.length) continue
      await insertNotificationsForUserIds([uid], {
        title,
        body: `${body} ${marker}`.trim(),
        type,
      })
    } catch (e) {
      console.warn('[notify] admin marker notify failed', e)
    }
  }
}

export async function findAttorneyAvailabilitySlotId(attorneyId, scheduledAtIso) {
  if (!attorneyId || !scheduledAtIso) return null
  const dateKey = phDateKeyFromIso(scheduledAtIso)
  const targetLabel = phTimeLabelFromIso(scheduledAtIso)
  const targetMs = new Date(scheduledAtIso).getTime()

  const { data, error } = await supabase
    .from('availability_slots')
    .select('id, date, time, is_booked')
    .eq('attorney_id', attorneyId)
    .eq('date', dateKey)
    .eq('is_booked', false)

  if (error) throw error

  const rows = data || []
  const byLabel = rows.find((row) => String(row.time || '').trim() === targetLabel)
  if (byLabel?.id) return byLabel.id

  const byParse = rows.find((row) => {
    const parsed = parseSlotDateTime(row.date, row.time)
    return parsed && parsed.getTime() === targetMs
  })
  return byParse?.id || null
}

export async function rescheduleClientAppointment({ appointmentId, scheduledAt, note }) {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.id) throw new Error('Not authenticated.')

  const { data: appt, error: fetchErr } = await supabase
    .from('appointments')
    .select('id, client_id, attorney_id, title, scheduled_at, status, amount, notes')
    .eq('id', appointmentId)
    .maybeSingle()

  if (fetchErr) throw fetchErr
  if (!appt) throw new Error('Appointment not found.')
  if (String(appt.client_id) !== String(user.id)) {
    throw new Error('You can only reschedule your own appointments.')
  }

  const rawStatus = String(appt.status || '').toLowerCase()
  if (rawStatus === 'completed' || rawStatus === 'cancelled' || rawStatus === 'rejected') {
    throw new Error('This appointment can no longer be rescheduled.')
  }
  if (rawStatus === 'rescheduled') {
    throw new Error('This appointment was already rescheduled once. Contact admin for further changes.')
  }

  if (parseReschedulePendingFromNotes(appt.notes)) {
    throw new Error('You already have a reschedule request waiting for admin approval.')
  }

  const schedDate = appt.scheduled_at ? new Date(appt.scheduled_at) : null
  if (!schedDate || Number.isNaN(schedDate.getTime())) throw new Error('Invalid appointment schedule.')
  if (schedDate.getTime() - Date.now() <= 0) {
    throw new Error('This consultation date has already passed.')
  }

  const phDateKey = (date) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date)
  const todayKey = phDateKey(new Date())
  const consultationKey = phDateKey(schedDate)
  if (consultationKey <= todayKey) {
    throw new Error(
      'Reschedule must be done at least 1 day before the consultation date — not on the same day.',
    )
  }

  const amount = Number(appt.amount || 0)
  if (amount > 0) {
    const { data: txs, error: txErr } = await supabase
      .from('transactions')
      .select('payment_status')
      .eq('appointment_id', appointmentId)
    if (txErr) throw txErr
    const paid = (txs || []).some((t) => String(t.payment_status || '').toLowerCase() === 'paid')
    if (!paid) {
      throw new Error('Pay your consultation fee first before rescheduling.')
    }
  }

  const slotId = await findAttorneyAvailabilitySlotId(appt.attorney_id, scheduledAt)
  if (!slotId) {
    throw new Error('That time slot is no longer available. Please pick another date or time.')
  }

  const nowIso = new Date().toISOString()
  const nextNotes = buildReschedulePendingNotes(appt.notes, {
    scheduledAt,
    reason: note,
  })

  const { error: updateErr } = await supabase
    .from('appointments')
    .update({ notes: nextNotes, updated_at: nowIso })
    .eq('id', appointmentId)

  if (updateErr) throw updateErr

  invalidateAvailabilityCache(appt.attorney_id, phDateKeyFromIso(scheduledAt))
  invalidateClientHomeCache(appt.client_id)

  try {
    const clientName = await resolveClientDisplayName(appt.client_id)
    const whenLabel = formatScheduleLabelFromIso(scheduledAt)
    const currentLabel = formatScheduleLabelFromIso(appt.scheduled_at)

    await notifyAdminsWithBodyMarker({
      title: 'Reschedule approval needed',
      body: `${clientName} requested to move ${appt.title || 'a consultation'} from ${currentLabel} to ${whenLabel}. Review and accept in Admin Dashboard.`,
      type: 'reschedule_request',
      marker: `[reschedreq:${appointmentId}:${String(scheduledAt || '').slice(0, 24)}]`,
    })

    if (appt.client_id) {
      await supabase.from('notifications').insert({
        user_id: appt.client_id,
        title: 'Reschedule request submitted',
        body: `Your request to move this consultation to ${whenLabel} was sent to LegalLink Admin for approval.`,
        type: 'reschedule',
        is_read: false,
        created_at: nowIso,
      })
    }
  } catch (notifyError) {
    console.warn('[reschedule] notify step failed', notifyError)
  }
}

export async function adminRescheduleAppointment({ appointmentId, newSlotId }) {
  const { resolvePaymentBackendUrl } = await import('./paymentApiClient')
  const session = (await supabase.auth.getSession())?.data?.session
  if (session?.access_token) {
    try {
      const baseUrl = resolvePaymentBackendUrl()
      const response = await fetch(`${baseUrl}/admin/appointments/reschedule`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ appointmentId, newSlotId }),
      })
      const payload = await response.json().catch(() => ({}))
      if (response.ok) {
        return {
          newScheduledIso: payload.newScheduledIso,
          slotId: payload.slotId,
        }
      }
      if (response.status === 401 || response.status === 403) {
        throw new Error(payload?.error || payload?.message || 'Not authorized to reschedule.')
      }
      console.warn('[admin-schedule] backend reschedule HTTP', response.status, payload?.error || payload)
    } catch (e) {
      if (e?.message && (e.message.includes('Not authorized') || e.message.includes('Invalid session'))) {
        throw e
      }
      console.warn('[admin-schedule] backend reschedule request failed, using direct Supabase', e?.message || e)
    }
  }

  if (!appointmentId) throw new Error('appointmentId required')
  if (!newSlotId) throw new Error('newSlotId required')

  const { data: appt, error: apptErr } = await supabase
    .from('appointments')
    .select('id, attorney_id, client_id, title, slot_id, slot_date, slot_time, scheduled_at, status')
    .eq('id', appointmentId)
    .maybeSingle()
  if (apptErr) throw apptErr
  if (!appt) throw new Error('Appointment not found.')

  const { data: newSlot, error: newSlotErr } = await supabase
    .from('availability_slots')
    .select('*')
    .eq('id', newSlotId)
    .maybeSingle()
  if (newSlotErr) throw newSlotErr
  if (!newSlot) throw new Error('Selected slot no longer exists.')
  if (newSlot.is_booked) throw new Error('Selected slot is already booked.')
  if (appt.attorney_id && newSlot.attorney_id && appt.attorney_id !== newSlot.attorney_id) {
    throw new Error('Selected slot belongs to a different attorney than this appointment.')
  }

  let parsedStart = parseSlotDateTime(newSlot.date, newSlot.time)
  if (!parsedStart && newSlot.start_time) {
    const d = new Date(newSlot.start_time)
    parsedStart = Number.isNaN(d.getTime()) ? null : d
  }
  if (!parsedStart) throw new Error('Selected slot has invalid date/time.')
  const newScheduledIso = parsedStart.toISOString()
  const nowIso = new Date().toISOString()

  const slotDateForUpdate =
    newSlot.date || (newSlot.start_time ? newScheduledIso.slice(0, 10) : null)
  const slotTimeForUpdate =
    newSlot.time ||
    (newSlot.start_time ? formatSlotTimeFromDate(new Date(newSlot.start_time)) : null)

  let oldSlotIdToFree = appt.slot_id || null
  if (!oldSlotIdToFree && appt.attorney_id && appt.slot_date && appt.slot_time) {
    const { data: candidates } = await supabase
      .from('availability_slots')
      .select('id, time')
      .eq('attorney_id', appt.attorney_id)
      .eq('date', appt.slot_date)
    if (Array.isArray(candidates) && candidates.length) {
      const targetMs = parseSlotDateTime(appt.slot_date, appt.slot_time)?.getTime() || 0
      const match = candidates.find((row) => {
        const parsed = parseSlotDateTime(appt.slot_date, row.time)
        return parsed && parsed.getTime() === targetMs
      })
      oldSlotIdToFree = match?.id || null
    }
  }
  if (oldSlotIdToFree && oldSlotIdToFree !== newSlot.id) {
    const { error: freeErr } = await supabase
      .from('availability_slots')
      .update({ is_booked: false, updated_at: nowIso })
      .eq('id', oldSlotIdToFree)
    if (freeErr) console.warn('[admin-schedule] free old slot failed', freeErr)
  }

  const { error: bookErr } = await supabase
    .from('availability_slots')
    .update({ is_booked: true, updated_at: nowIso })
    .eq('id', newSlot.id)
    .eq('is_booked', false)
  if (bookErr) {
    console.warn('[admin-schedule] new slot booking failed', bookErr)
    throw new Error('Failed to reserve the new slot. It may have just been booked.')
  }

  const richUpdate = {
    scheduled_at: newScheduledIso,
    slot_id: newSlot.id,
    slot_date: slotDateForUpdate,
    slot_time: slotTimeForUpdate,
    status: 'rescheduled',
    updated_at: nowIso,
  }

  let { error: updateErr } = await supabase
    .from('appointments')
    .update(richUpdate)
    .eq('id', appointmentId)

  if (updateErr) {
    console.warn('[admin-schedule] full update failed, retrying minimal', updateErr)
    const minimalUpdate = {
      scheduled_at: newScheduledIso,
      status: 'rescheduled',
      updated_at: nowIso,
    }
    const retry = await supabase.from('appointments').update(minimalUpdate).eq('id', appointmentId)
    if (retry.error) {
      await supabase
        .from('availability_slots')
        .update({ is_booked: false, updated_at: nowIso })
        .eq('id', newSlot.id)
      throw retry.error
    }
  }

  invalidateAvailabilityCache(appt.attorney_id, appt.slot_date)
  invalidateAvailabilityCache(newSlot.attorney_id || appt.attorney_id, newSlot.date || slotDateForUpdate)
  invalidateAttorneyAppointmentsCache(appt.attorney_id)
  invalidateClientHomeCache(appt.client_id)

  return { newScheduledIso, slotId: newSlot.id }
}

export async function acceptClientRescheduleRequest({ appointmentId }) {
  if (!appointmentId) throw new Error('appointmentId is required.')

  const { data: appt, error: fetchErr } = await supabase
    .from('appointments')
    .select('id, notes, attorney_id, client_id, title, scheduled_at')
    .eq('id', appointmentId)
    .maybeSingle()

  if (fetchErr) throw fetchErr
  if (!appt) throw new Error('Appointment not found.')

  const pending = parseReschedulePendingFromNotes(appt.notes)
  if (!pending?.requestedScheduledAt) {
    throw new Error('No pending reschedule request found for this appointment.')
  }

  const newSlotId = await findAttorneyAvailabilitySlotId(appt.attorney_id, pending.requestedScheduledAt)
  if (!newSlotId) {
    throw new Error('The requested time slot is no longer available. Ask the client to pick another slot.')
  }

  await adminRescheduleAppointment({ appointmentId, newSlotId })

  const cleanedNotes = stripReschedulePendingMarker(appt.notes)
  const reasonLine = pending.reason ? `Client reason: ${pending.reason}` : ''
  const finalNotes = [cleanedNotes, reasonLine].filter(Boolean).join('\n').trim()

  await supabase
    .from('appointments')
    .update({
      notes: finalNotes || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', appointmentId)

  return { requestedScheduledAt: pending.requestedScheduledAt, newSlotId }
}

export async function rejectClientRescheduleRequest({ appointmentId, adminNote }) {
  if (!appointmentId) throw new Error('appointmentId is required.')

  const { data: appt, error: fetchErr } = await supabase
    .from('appointments')
    .select('id, notes, client_id, title, scheduled_at')
    .eq('id', appointmentId)
    .maybeSingle()

  if (fetchErr) throw fetchErr
  if (!appt) throw new Error('Appointment not found.')

  const pending = parseReschedulePendingFromNotes(appt.notes)
  if (!pending) throw new Error('No pending reschedule request found for this appointment.')

  const cleanedNotes = stripReschedulePendingMarker(appt.notes)
  const nowIso = new Date().toISOString()

  await supabase
    .from('appointments')
    .update({ notes: cleanedNotes || null, updated_at: nowIso })
    .eq('id', appointmentId)

  if (appt.client_id) {
    const whenLabel = formatScheduleLabelFromIso(pending.requestedScheduledAt)
    const body = adminNote?.trim()
      ? `Your reschedule request for ${whenLabel} was declined. ${adminNote.trim()}`
      : `Your reschedule request for ${whenLabel} was declined. Your original schedule stays in place.`

    await supabase.from('notifications').insert({
      user_id: appt.client_id,
      title: 'Reschedule request declined',
      body,
      type: 'reschedule',
      is_read: false,
      created_at: nowIso,
    })
  }

  invalidateClientHomeCache(appt.client_id)
  return { ok: true }
}

// Mobile-to-web compatibility aliases: keeps backend calls consistent across both app variants.
export const getHomepageClientData = fetchClientHomeData
export const getAttyLandingPageData = fetchAttorneyHomeData
export const getAttyConsultationRequestData = fetchAttorneyConsultationRequests
export const updateAttyConsultationRequestStatus = updateAttorneyConsultationRequestStatus
export const getAttyAvailabilityManagerData = fetchAttorneyAvailabilitySlots
export const saveAttyAvailabilityManagerData = saveAttorneyAvailabilitySlots
export const getAttyMyAppointmentsData = fetchAttorneyUpcomingAppointments
export const rescheduleAttyMyAppointment = rescheduleAttorneyAppointment
export const getAttyNotarialServicesData = fetchAttorneyNotarialRequests
export const updateAttyNotarialServicesStatus = updateAttorneyNotarialRequestStatus
export const getAttyMyEarningsData = fetchAttorneyEarningsData
export const getAttyAnnouncementsData = fetchAttorneyAnnouncementsData

export const getMyAppointments = fetchClientAppointmentsData
export const rescheduleAppointment = requestAppointmentReschedule
export const getNotarialRequests = fetchClientNotarialRequests
export const updateNotarialRequestStatus = updateAttorneyNotarialRequestStatus

export {
  isOngoingVideoCallRoom,
  countOngoingVideoCallRooms,
  getConsultationSessionStatus,
  getQueueRequestDisplayStatus,
} from './consultationStatus'

/**
 * Admin announcements (web AdminReports parity). Use from an admin screen when added.
 */
export async function sendAdminAnnouncement({
  title,
  body,
  imageUrl,
  targetClientIds,
  type = 'announcement',
}) {
  const trimmedTitle = String(title || '').trim()
  const trimmedBody = String(body || '').trim()
  const trimmedImage = String(imageUrl || '').trim()

  if (!trimmedTitle) throw new Error('Title is required.')
  if (!trimmedBody && !trimmedImage) {
    throw new Error('Add a message, an image, or both.')
  }
  const ids = (targetClientIds || []).map((id) => String(id).trim()).filter(Boolean)
  if (!ids.length) throw new Error('Select at least one client recipient.')

  const nowIso = new Date().toISOString()
  const notificationData = trimmedImage ? { image_url: trimmedImage } : {}
  const annType = String(type || 'announcement').toLowerCase()

  const payload = ids.map((clientId) => ({
    user_id: clientId,
    title: trimmedTitle,
    body: trimmedBody || (trimmedImage ? 'See attached announcement image.' : ''),
    type: annType,
    is_read: false,
    created_at: nowIso,
    data: notificationData,
  }))

  const { error } = await supabase.from('notifications').insert(payload)
  if (error) throw error
  return { sent: payload.length }
}

// ============================================================================
// CALENDAR AVAILABILITY — ported from Web ClientAvailabilityCalendar
// ============================================================================

/**
 * Fetches a per-day availability summary for the given attorney and month.
 * Returns an object keyed by date string (YYYY-MM-DD), each value:
 *   { open: number, booked: number, total: number }
 *
 * Mirrors Web `fetchClientAttorneyAvailabilityCalendar` (Web userApi.js).
 */
export async function fetchClientAttorneyAvailabilityCalendar(attorneyId, monthCursor) {
  if (!attorneyId || !monthCursor) return {};

  const year = monthCursor.getFullYear();
  const month = monthCursor.getMonth();
  const monthStart = toDateKey(new Date(year, month, 1));
  const monthEnd = toDateKey(new Date(year, month + 1, 0));
  const today = getTodayDateKey();
  const fromDate = monthStart < today ? today : monthStart;

  if (fromDate > monthEnd) return {};

  const { data, error } = await supabase.rpc('get_attorney_availability_by_day', {
    p_attorney_id: attorneyId,
    p_from_date: fromDate,
    p_to_date: monthEnd,
  });

  const isMissingRpc =
    error?.code === '42883' ||
    String(error?.message || '').toLowerCase().includes('does not exist');

  if (!error && Array.isArray(data)) {
    return data.reduce((acc, row) => {
      const key = String(row.slot_date || '').slice(0, 10);
      if (!key) return acc;
      acc[key] = {
        open: Number(row.open_count) || 0,
        booked: Number(row.booked_count) || 0,
        total: Number(row.total_count) || 0,
      };
      return acc;
    }, {});
  }

  if (!isMissingRpc && error) throw error;

  // Fallback: query availability_slots directly and count open slots per date
  const { data: slotsData, error: slotsError } = await supabase
    .from('availability_slots')
    .select('date, is_booked')
    .eq('attorney_id', attorneyId)
    .gte('date', fromDate)
    .lte('date', monthEnd);

  if (slotsError) return {};

  const byDate = {};
  (slotsData || []).forEach((slot) => {
    const key = String(slot.date || '').trim().slice(0, 10);
    if (!key) return;
    if (!byDate[key]) byDate[key] = { open: 0, booked: 0, total: 0 };
    byDate[key].total += 1;
    if (slot.is_booked) {
      byDate[key].booked += 1;
    } else {
      byDate[key].open += 1;
    }
  });
  return byDate;
}

/**
 * Pure helper — derives calendar day status from summary object.
 * Returns: 'past' | 'no_schedule' | 'available' | 'fully_booked'
 *
 * Mirrors Web `getClientDayAvailabilityStatus` (Web userApi.js).
 */
export const getClientDayAvailabilityStatus = (dateKey, summary, todayKey = getTodayDateKey()) => {
  if (!dateKey || dateKey < todayKey) return 'past';
  const row = summary?.[dateKey];
  if (!row || row.total <= 0) return 'no_schedule';
  if (row.open > 0) return 'available';
  return 'fully_booked';
};

// ============================================================================
// NOTARIAL PAYMENT — markNotarialRequestPaid (ported from Web)
// ============================================================================

/**
 * Marks a notarial request as paid after a successful bundled checkout.
 * Must insert a `transactions` row — Client Notary Status reads payment from
 * transactions.payment_status, not notarial_requests.status alone.
 */
export async function markNotarialRequestPaid({
  requestId,
  clientId,
  attorneyId,
  amount,
  method,
}) {
  if (!requestId || !clientId) return null;

  try {
    // Reuse standalone notarial payment path so Notary Status shows PAID.
    return await payForNotarialRequest({
      requestId,
      clientId,
      attorneyId: attorneyId || null,
      amount: Number(amount || 0),
      method: method || 'qrph',
    });
  } catch (error) {
    console.warn('[notarial] markNotarialRequestPaid failed', error?.message || error);
    throw error;
  }
}

