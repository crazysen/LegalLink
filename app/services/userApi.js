import { supabase } from './supabaseClient';
import { signOutCurrentUser } from './authService';
import {
  clearMemoryProfileCache,
  getMemoryProfileCache,
  setMemoryProfileCache,
} from './profileSessionMemory';

export const signOutUser = () => signOutCurrentUser();

const DASHBOARD_CACHE_TTL_MS = 15000

const clientHomeCache = new Map()
const attorneyHomeCache = new Map()

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

const toTwoDigits = (value) => String(value).padStart(2, '0')

const normalizePaymentBackendUrl = (value) =>
  String(value || '').trim().replace(/\/+$/, '')

const PAYMENT_BACKEND_URL = (() => {
  const explicit = normalizePaymentBackendUrl(
    process.env.EXPO_PUBLIC_PAYMENT_API_URL ||
      process.env.EXPO_PUBLIC_PAYMENT_BACKEND_URL ||
      process.env.EXPO_PUBLIC_BATASMO_PAYMENT_API_URL ||
      '',
  )
  if (explicit) return explicit
  const apiBase = normalizePaymentBackendUrl(process.env.EXPO_PUBLIC_API_BASE_URL || '')
  if (!apiBase) return ''
  return apiBase.replace(/\/api$/, '')
})()

/**
 * Parse legacy `availability_slots.date` + `time` (e.g. 09:00 AM) — aligned with web `BookAppointment`.
 */
const parseSlotDateTime = (dateValue, timeValue) => {
  if (!dateValue || !timeValue) return null
  const rawTime = String(timeValue).trim()

  const ampmMatch = rawTime.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i)
  if (ampmMatch) {
    let hour = Number(ampmMatch[1])
    const minute = Number(ampmMatch[2])
    const meridiem = ampmMatch[3].toUpperCase()

    if (meridiem === 'PM' && hour < 12) hour += 12
    if (meridiem === 'AM' && hour === 12) hour = 0

    const parsed = new Date(`${dateValue}T${toTwoDigits(hour)}:${toTwoDigits(minute)}:00`)
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

  const parsed = new Date(`${dateValue}T${toTwoDigits(hour)}:${toTwoDigits(minute)}:00`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const webPublicAssetBase = String(
  process.env.EXPO_PUBLIC_WEB_PUBLIC_URL || process.env.EXPO_PUBLIC_APP_ORIGIN || '',
)
  .trim()
  .replace(/\/$/, '')

// Supabase host (used to build public storage URLs when relative storage paths are returned)
const supabasePublicBase = String(
  process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL || 'https://sjmmyqeqiigmclcgcadr.supabase.co',
)
  .trim()
  .replace(/\/$/, '')

/**
 * CMS image URL, else known attorney photo paths (same logic as web `april_13`), else ui-avatars.
 * Set `EXPO_PUBLIC_WEB_PUBLIC_URL` to your deployed web origin so `/assets/attorneys/...` resolves on device.
 */
export function resolveAttorneyImage(name, preferredImageUrl) {
  const trimmed = String(preferredImageUrl || '').trim()
  if (trimmed) {
    if (/^https?:\/\//i.test(trimmed)) return trimmed

    const normalizedPath = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
    const isWebAssetPath = normalizedPath.startsWith('/assets/')
    if (isWebAssetPath) {
      return webPublicAssetBase ? `${webPublicAssetBase}${normalizedPath}` : null
    }

    if (trimmed.startsWith('/') && webPublicAssetBase) {
      return `${webPublicAssetBase}${trimmed}`
    }

    // If the value looks like a Supabase storage path (e.g. "avatars/xyz.jpg"),
    // construct a public storage URL using the configured Supabase host so
    // React Native Image receives a full absolute URL.
    const possibleStoragePath = trimmed.replace(/^\/+/, '')
    const looksLikeStorage = /\/.+\.[a-z]{2,}$/i.test(possibleStoragePath) || possibleStoragePath.startsWith('avatars') || possibleStoragePath.startsWith('public/') || possibleStoragePath.includes('storage')
    if (looksLikeStorage) {
      return `${supabasePublicBase}/storage/v1/object/public/${possibleStoragePath}`
    }
    return trimmed
  }

  const normalized = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^atty\s+/, '')
    .trim()

  const asset = (path) =>
    webPublicAssetBase ? `${webPublicAssetBase}${path}` : null

  if (normalized.includes('jeanne') && normalized.includes('anarna')) {
    return (
      asset('/assets/attorneys/jeanne-luz-castillo-anarna.jpg') ||
      `https://ui-avatars.com/api/?name=${encodeURIComponent(name || 'Attorney')}&background=f5a623&color=111827`
    )
  }

  if (normalized.includes('alston') && normalized.includes('anarna')) {
    return (
      asset('/assets/attorneys/alston-kevin-anarna.jpg') ||
      `https://ui-avatars.com/api/?name=${encodeURIComponent(name || 'Attorney')}&background=f5a623&color=111827`
    )
  }

  if (normalized.includes('allen') && normalized.includes('anarna')) {
    return (
      asset('/assets/attorneys/allen-kristopher-anarna.png') ||
      `https://ui-avatars.com/api/?name=${encodeURIComponent(name || 'Attorney')}&background=f5a623&color=111827`
    )
  }

  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name || 'Attorney')}&background=f5a623&color=111827`
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
        : String(slot.time || 'TBD')

    return {
      ...slot,
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
    console.warn('[BatasMo] users sync skipped:', usersSync.error.message)
  }
}

export async function fetchClientHomeData(userId) {
  const cached = clientHomeCache.get(userId)
  if (cached && Date.now() - cached.updatedAt < DASHBOARD_CACHE_TTL_MS) {
    return cached.value
  }

  const [profileRes, appointmentsRes, notificationsRes, transactionsRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('*')
      .eq('id', userId),
    supabase
      .from('appointments')
      .select('id, title, scheduled_at, status, attorney:attorney_id(full_name), amount')
      .eq('client_id', userId)
      .order('scheduled_at', { ascending: true }),
    supabase
      .from('notifications')
      .select('id, title, body, type, is_read, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false }),
    supabase
      .from('transactions')
      .select('id, amount, payment_status, created_at')
      .eq('client_id', userId)
      .order('created_at', { ascending: false }),
  ])

  if (profileRes.error) throw profileRes.error
  if (appointmentsRes.error) throw appointmentsRes.error
  if (notificationsRes.error) throw notificationsRes.error
  if (transactionsRes.error) throw transactionsRes.error

  const result = {
    profile: profileRes.data,
    appointments: appointmentsRes.data || [],
    notifications: notificationsRes.data || [],
    transactions: transactionsRes.data || [],
  }

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
    const legacyRows = normalizedSlots.map((slot) => ({
      attorney_id: slot.attorney_id,
      date: String(slot.start_time).slice(0, 10),
      time: slot.start_time,
      is_booked: false,
      updated_at: nowIso,
    }))

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
  if (value === 'gcash') return 'GCash'
  if (value === 'maya' || value === 'paymaya') return 'Maya'
  if (value === 'qrph' || value === 'qr_ph' || value === 'qr ph') return 'QRPh'
  throw new Error('Supported payment methods are GCash, Maya, or QR Ph.')
}

const normalizePaymentMethodKey = (method) => {
  const value = String(method || '').trim().toLowerCase()
  if (value === 'gcash') return 'gcash'
  if (value === 'maya' || value === 'paymaya') return 'paymaya'
  if (value === 'qrph' || value === 'qr_ph' || value === 'qr ph') return 'qrph'
  throw new Error('Supported payment methods are gcash, paymaya, or qrph.')
}

const normalizePaymentMethodTypes = (methodTypes, fallbackMethod) => {
  const rawList = Array.isArray(methodTypes)
    ? methodTypes
    : methodTypes
      ? [methodTypes]
      : []

  const normalized = rawList
    .map((item) => {
      try {
        return normalizePaymentMethodKey(item)
      } catch {
        return null
      }
    })
    .filter(Boolean)

  if (normalized.length > 0) {
    return [...new Set(normalized)]
  }

  return [normalizePaymentMethodKey(fallbackMethod || 'gcash')]
}

const normalizeAppointmentStatus = (status) => {
  const value = (status || '').toLowerCase()
  if (value === 'confirmed') return 'APPROVED'
  if (value === 'rescheduled') return 'PENDING'
  if (value === 'completed') return 'COMPLETED'
  if (value === 'rejected' || value === 'cancelled') return 'REJECTED'
  return 'PENDING'
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
  if (!PAYMENT_BACKEND_URL) {
    throw new Error(
      'Payment backend URL is not configured. Set EXPO_PUBLIC_PAYMENT_API_URL and restart Expo.'
    )
  }

  const response = await fetch(`${PAYMENT_BACKEND_URL}/payments/appointments/create-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      appointmentId,
      clientId,
      attorneyId,
      amount: Number(amount || 0),
      method: paymentMethod,
      paymentMethodTypes,
    }),
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(payload?.error || `Unable to initialize payment (${response.status})`)
  }

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

/**
 * Creates a PayMongo checkout session for a notarial service request.
 * Calls POST /payments/notarial/create-session on the backend.
 */
export async function payForNotarialSession({ notarialRequestId, clientId, amount, method, methodTypes }) {
  const paymentMethod = normalizePaymentMethodKey(method)
  const paymentMethodTypes = normalizePaymentMethodTypes(methodTypes, paymentMethod)
  if (!PAYMENT_BACKEND_URL) {
    throw new Error(
      'Payment backend URL is not configured. Set EXPO_PUBLIC_PAYMENT_API_URL and restart Expo.'
    )
  }

  const response = await fetch(`${PAYMENT_BACKEND_URL}/payments/notarial/create-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      notarialRequestId,
      clientId,
      amount: Number(amount || 0),
      method: paymentMethod,
      paymentMethodTypes,
    }),
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(payload?.error || `Unable to initialize notarial payment (${response.status})`)
  }
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

/**
 * Polls /payments/notarial/status/:transactionId for a notarial payment status.
 */
export async function getNotarialPaymentStatus(transactionId) {
  if (!transactionId) throw new Error('transactionId is required')
  if (!PAYMENT_BACKEND_URL) {
    throw new Error(
      'Payment backend URL is not configured. Set EXPO_PUBLIC_PAYMENT_API_URL and restart Expo.'
    )
  }

  const response = await fetch(
    `${PAYMENT_BACKEND_URL}/payments/notarial/status/${encodeURIComponent(transactionId)}`,
    { method: 'GET' },
  )
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(payload?.error || `Unable to check notarial payment status (${response.status})`)
  }
  return {
    transactionId: payload?.transactionId || transactionId,
    notarialRequestId: payload?.notarialRequestId || null,
    status: String(payload?.status || 'pending').toLowerCase(),
  }
}

export async function getAppointmentPaymentStatus(transactionId) {
  if (!transactionId) throw new Error('transactionId is required')
  if (!PAYMENT_BACKEND_URL) {
    throw new Error(
      'Payment backend URL is not configured. Set EXPO_PUBLIC_PAYMENT_API_URL and restart Expo.'
    )
  }

  const response = await fetch(
    `${PAYMENT_BACKEND_URL}/payments/appointments/status/${encodeURIComponent(transactionId)}`,
    { method: 'GET' },
  )
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(payload?.error || `Unable to check payment status (${response.status})`)
  }
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
    .select('id, attorney_id, client_id, title, scheduled_at, slot_id, slot_date, slot_time, status')
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

  if (!slotIdToFree && appt.attorney_id && appt.slot_date && appt.slot_time) {
    const { data: candidateSlots, error: candidateError } = await supabase
      .from('availability_slots')
      .select('id, time')
      .eq('attorney_id', appt.attorney_id)
      .eq('date', appt.slot_date)

    if (candidateError) {
      console.warn('[booking] cancel cleanup candidate slot fetch failed', candidateError)
    } else if (Array.isArray(candidateSlots) && candidateSlots.length) {
      const targetParsed = parseSlotDateTime(appt.slot_date, appt.slot_time)
      const targetMs = targetParsed?.getTime() || 0
      const matchedSlot = candidateSlots.find((slot) => {
        const slotParsed = parseSlotDateTime(appt.slot_date, slot?.time)
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
  } else if (appt.attorney_id && appt.slot_date && appt.slot_time) {
    const { error: slotByMatchError } = await supabase
      .from('availability_slots')
      .update({ is_booked: false, updated_at: nowIso })
      .eq('attorney_id', appt.attorney_id)
      .eq('date', appt.slot_date)
      .eq('time', appt.slot_time)
    if (slotByMatchError) {
      console.warn('[booking] cancel cleanup slot free (raw match) failed', slotByMatchError)
    }
  }

}

export async function abandonAppointmentCheckout({ appointmentId, clientId, transactionId }) {
  if (!appointmentId) throw new Error('appointmentId is required')
  if (!clientId) throw new Error('clientId is required')

  if (!PAYMENT_BACKEND_URL) {
    await cancelPendingUnpaidBooking({ appointmentId })
    return { ok: true, reason: 'fallback' }
  }

  const response = await fetch(`${PAYMENT_BACKEND_URL}/payments/appointments/abandon`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appointmentId, clientId, transactionId }),
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(payload?.error || `Unable to abandon checkout (${response.status})`)
  }
  return payload || { ok: true }
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
  if (value === 'approved') return 'APPROVED'
  if (value === 'completed') return 'COMPLETED'
  if (value === 'rejected' || value === 'cancelled') return 'REJECTED'
  return 'PENDING'
}

export async function fetchClientNotarialRequests(userId) {
  const [requestsRes, transactionsRes] = await Promise.all([
    supabase
      .from('notarial_requests')
      .select('id, service_type, details, document_url, preferred_date, status, created_at, attorney_id, attorney:attorney_id(full_name)')
      .eq('client_id', userId)
      .order('created_at', { ascending: false }),
    supabase
      .from('transactions')
      .select('notarial_request_id, payment_status')
      .eq('client_id', userId),
  ])

  if (requestsRes.error) throw requestsRes.error
  if (transactionsRes.error) throw transactionsRes.error

  const paymentByRequest = new Map(
    (transactionsRes.data || []).map((tx) => [tx.notarial_request_id, tx.payment_status]),
  )

  return (requestsRes.data || []).map((item) => {
    const status = normalizeNotarialStatus(item.status)
    const datetime = formatDateTime(item.created_at)
    const paymentStatus = (paymentByRequest.get(item.id) || 'unpaid').toLowerCase()
    return {
      id: item.id,
      service: item.service_type || 'Notarial Service',
      description: item.service_type || 'Notarial request',
      date: datetime.date,
      file: item.document_url || 'N/A',
      notes: item.details || '',
      status,
      payment: paymentStatus === 'paid' ? 'PAID' : 'UNPAID',
      fee: 'PHP 0.00',
      amount: 0,
      message: status === 'COMPLETED' ? 'Notarization Completed' : status === 'APPROVED' ? 'Ready for Review' : 'Waiting for Review',
      detail: item.details || 'Request submitted for review.',
      assignedTo: item.attorney?.full_name || null,
      attorneyId: item.attorney_id || null,
    }
  })
}

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
  // attorney_id may be null when admin has not yet assigned one —
  // only include it if present so the DB column default (NULL) is used.
  if (attorneyId) txPayload.attorney_id = attorneyId

  const { data: txRow, error: txError } = await supabase
    .from('transactions')
    .insert(txPayload)
    .select('id')
    .maybeSingle()

  if (txError) throw txError

  const { error: reqError } = await supabase
    .from('notarial_requests')
    .update({ status: 'approved', updated_at: nowIso })
    .eq('id', requestId)

  if (reqError) throw reqError

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

const NOTARIAL_PAYMENT_DEFAULT_AMOUNT = 1 // TEST AMOUNT — change to 4000 before go-live

export async function fetchNotarialPaymentDetails(requestId) {
  const { data, error } = await supabase
    .from('notarial_requests')
    .select('attorney_id')
    .eq('id', requestId)
    .maybeSingle()

  if (error) throw error
  if (!data) throw new Error('Notarial request not found.')
  return {
    attorneyId: data.attorney_id,
    amount: NOTARIAL_PAYMENT_DEFAULT_AMOUNT,
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
      return mapAvailabilitySlots(rows)
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

  return mapAvailabilitySlots(rows)
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
        const start = parseSlotDateTime(slot.date, slot.time)
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

      return {
        id: item.user_id,
        name: cms?.display_name || fullName,
        specialty: normalizeStringArray(cms?.expertise_fields)[0] || primarySpecialty,
        specialties: normalizeStringArray(cms?.expertise_fields || item.specialties),
        practiceAreas: normalizeStringArray(cms?.practice_areas || item.specialties),
        exp:
          experienceYears > 0
            ? `${experienceYears} years experience`
            : 'Experience not set',
        rating: 5,
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

  const activeBookingCount = await fetchClientAttorneyActiveBookingCount({
    clientId: resolvedClientId,
    attorneyId: normalizedPayload.attorney_id,
  })

  if (activeBookingCount >= 2) {
    throw new Error(
      'Booking limit reached. You can only keep up to 2 active bookings with the same attorney.',
    )
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
    const { data: insertedAppointment, error: fallbackInsertError } = await supabase
      .from('appointments')
      .insert({
        client_id: resolvedClientId,
        attorney_id: normalizedPayload.attorney_id,
        slot_id: resolvedSlotId,
        title: normalizedPayload.title,
        notes: normalizedPayload.notes,
        scheduled_at: normalizedPayload.scheduled_at,
        duration_minutes: normalizedPayload.duration_minutes,
        amount: normalizedPayload.amount,
        status: 'confirmed',
        created_at: nowIso,
        updated_at: nowIso,
      })
      .select('id')
      .single()

    if (fallbackInsertError) {
      throw fallbackInsertError
    }
    appointmentId = insertedAppointment?.id || null
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
        status: 'confirmed',
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

      const { error: notificationError } = await supabase.from('notifications').insert({
        user_id: normalizedPayload.attorney_id,
        title: 'New Consultation Booking',
        body: `${rawClientName} booked ${normalizedPayload.title || 'a consultation'} on ${whenLabel}.`,
        type: 'consultation',
        is_read: false,
        created_at: nowIso,
      })

      if (notificationError) {
        console.warn('[booking] failed to create attorney notification', notificationError)
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
}) {
  const requestId =
    globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
  const nowIso = new Date().toISOString()

  const { error } = await supabase
    .from('notarial_requests')
    .insert({
      id: requestId,
      client_id: clientId,
      attorney_id: attorneyId,
      service_type: serviceType,
      preferred_date: preferredDate || null,
      details: details || notes || null,
      document_url: documentUrl || documentName || null,
      status: 'pending',
      created_at: nowIso,
      updated_at: nowIso,
    })

  if (error) throw error
  return {
    id: requestId,
    client_id: clientId,
    attorney_id: attorneyId,
    service_type: serviceType,
    preferred_date: preferredDate || null,
    details: details || notes || null,
    document_url: documentUrl || documentName || null,
    status: 'pending',
    created_at: nowIso,
    updated_at: nowIso,
  }
}

export async function fetchAttorneyUpcomingAppointments(userId) {
  const { data, error } = await supabase
    .from('appointments')
    .select('id, title, scheduled_at, status, notes, client:client_id(full_name)')
    .eq('attorney_id', userId)
    .in('status', ['confirmed', 'rescheduled', 'pending'])
    .order('scheduled_at', { ascending: true })

  if (error) throw error

  return (data || []).map((item) => {
    const dt = new Date(item.scheduled_at)
    const valid = !Number.isNaN(dt.getTime())
    const dateLabel = valid
      ? dt.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })
      : 'TBD'
    const timeLabel = valid
      ? dt.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })
      : 'TBD'

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
      status: item.status,
      color: '#6366f1',
      concern: item.notes || '',
    }
  })
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
    .select('id, title, body, type, created_at')
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
      date: valid ? dt.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Today',
      time: valid ? dt.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' }) : 'Now',
      author: 'BatasMo Admin',
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
  const [apptsRes, paidTxRes] = await Promise.all([
    supabase
      .from('appointments')
      .select('id, title, status, scheduled_at, updated_at, amount')
      .eq('attorney_id', userId),
    supabase
      .from('transactions')
      .select('appointment_id')
      .eq('attorney_id', userId)
      .eq('payment_status', 'paid'),
  ])

  if (apptsRes.error) throw apptsRes.error
  if (paidTxRes.error) throw paidTxRes.error

  const appointments = apptsRes.data || []
  const paidTxRows = paidTxRes.data || []
  const paidIds = new Set(paidTxRows.map((r) => r.appointment_id).filter(Boolean))

  const excludedStatuses = new Set(['rejected', 'cancelled'])
  const countsByType = new Map()

  appointments.forEach((row) => {
    const status = String(row?.status || '').toLowerCase()
    if (excludedStatuses.has(status)) return
    if (!isPaidOrFreeConsultation({ amount: row?.amount, consultationPaid: paidIds.has(row.id) })) return

    const typeLabel = normalizeConsultationTypeLabel(row?.title)
    countsByType.set(typeLabel, Number(countsByType.get(typeLabel) || 0) + 1)
  })

  const rows = Array.from(countsByType.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)

  const total = rows.reduce((sum, item) => sum + Number(item.count || 0), 0)
  const maxCount = rows.length ? rows[0].count : 0

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

  let averageRating = 0
  let ratingCount = 0
  try {
    const fbRes = await supabase
      .from('consultation_feedback')
      .select('rating')
      .eq('attorney_id', userId)
    if (fbRes.error) throw fbRes.error
    const ratings = (fbRes.data || [])
      .map((r) => Number(r?.rating))
      .filter((n) => Number.isFinite(n) && n >= 1 && n <= 5)
    ratingCount = ratings.length
    if (ratingCount) {
      averageRating = ratings.reduce((sum, n) => sum + n, 0) / ratingCount
    }
  } catch (e) {
    console.warn('[analytics] consultation_feedback rating query failed', e)
    averageRating = 0
    ratingCount = 0
  }

  return {
    rows,
    total,
    maxCount,
    gender,
    status,
    averageRating,
    ratingCount,
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

export async function fetchAttorneyProfile(userId) {
  const [profileRes, attorneyRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single(),
    supabase
      .from('attorney_profiles')
      .select('*')
      .eq('user_id', userId)
      .single(),
  ])

  if (profileRes.error) throw profileRes.error
  if (attorneyRes.error && attorneyRes.error.code !== 'PGRST116') throw attorneyRes.error

  return {
    profile: profileRes.data || {},
    attorney: attorneyRes.data || {},
  }
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
