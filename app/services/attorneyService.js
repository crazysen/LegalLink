import {fetchBookableAttorneys} from './userApi';

/**
 * Attorney directory for Book Appointment — maps `fetchBookableAttorneys` into the
 * raw row shape expected by `BookAppointment` (`mapRecords`).
 */
export async function getAttorneys() {
  const rows = await fetchBookableAttorneys({ concern: '', onlyVerified: false });
  return (Array.isArray(rows) ? rows : []).map(row => {
    const expMatch = String(row.exp || '').match(/(\d+)/);
    const years = expMatch ? Number(expMatch[1]) : 0;
    return {
      id: row.id,
      cms_display_name: row.name,
      full_name: row.name,
      cms_profile_image_url: row.img,
      avatar_url: row.img,
      avg_rating: row.rating,
      open_slots_count: Array.isArray(row.availableSlots) ? row.availableSlots.length : 0,
      specialties: row.specialties,
      years_experience: years,
      consultation_fee: row.amount,
      is_verified: row.verified,
    };
  });
}
