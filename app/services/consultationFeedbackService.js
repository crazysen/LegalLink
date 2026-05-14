import {supabase} from './supabaseClient';

/**
 * @param {string} appointmentId
 * @returns {Promise<boolean>} true if a feedback row exists for this appointment
 */
export async function hasFeedbackForAppointment(appointmentId) {
  const {data, error} = await supabase
    .from('consultation_feedback')
    .select('id')
    .eq('appointment_id', appointmentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data?.id);
}

/**
 * Client-only: inserts rating/comment after consultation room is closed (RLS).
 * @param {string} appointmentId
 * @param {{ rating: number, comment?: string }} payload
 */
export async function submitConsultationFeedback(appointmentId, payload) {
  const {data: {user}} = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const rating = Number(payload?.rating);
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    throw new Error('Rating must be between 1 and 5.');
  }

  const {data: appt, error: apptErr} = await supabase
    .from('appointments')
    .select('id, client_id, attorney_id')
    .eq('id', appointmentId)
    .single();

  if (apptErr || !appt) {
    throw new Error(apptErr?.message || 'Appointment not found.');
  }
  if (appt.client_id !== user.id) {
    throw new Error('Only the client can submit feedback.');
  }

  const comment =
    typeof payload?.comment === 'string' && payload.comment.trim()
      ? payload.comment.trim()
      : null;

  const {data: prof} = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', user.id)
    .single();

  const clientDisplayName = formatReviewerDisplayName(prof?.full_name);

  const {error} = await supabase.from('consultation_feedback').insert({
    appointment_id: appointmentId,
    client_id: appt.client_id,
    attorney_id: appt.attorney_id,
    rating,
    comment,
    client_display_name: clientDisplayName,
  });

  if (error) throw new Error(error.message);
}

/** "Firstname L." for profile cards; falls back if name missing */
function formatReviewerDisplayName(fullName) {
  const s = String(fullName || '').trim();
  if (!s) return 'Verified client';
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0];
  const first = parts[0];
  const last = parts[parts.length - 1];
  const initial = last[0] ? `${last[0]}.` : '';
  return `${first} ${initial}`;
}

/**
 * Public attorney profile: recent consultation feedback (RLS: authenticated).
 * @param {string} attorneyId profiles.id of the attorney
 * @param {{ limit?: number }} opts
 * @returns {Promise<Array<{ id: string, rating: number, comment: string | null, created_at: string, client_display_name: string | null }>>}
 */
export async function getFeedbackForAttorney(attorneyId, opts = {}) {
  const limit = Number(opts.limit) > 0 ? Math.min(Number(opts.limit), 50) : 20;
  if (!attorneyId) return [];

  const {data, error} = await supabase
    .from('consultation_feedback')
    .select('id, rating, comment, created_at, client_display_name')
    .eq('attorney_id', attorneyId)
    .order('created_at', {ascending: false})
    .limit(limit);

  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data : [];
}
