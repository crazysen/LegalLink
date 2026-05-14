import { supabase } from './supabaseClient';

export async function getAvailability() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('availability_slots')
    .select('*')
    .eq('attorney_id', user.id);
  
  if (error) throw new Error(error.message);
  return data || [];
}

export async function createAvailabilitySlot({start_time, end_time}) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  
  try {
    const { data, error } = await supabase
      .from('availability_slots')
      .insert({
        attorney_id: user.id,
        date: start_time.split('T')[0],
        time: start_time,
        is_booked: false
      }).select();

    if (error) throw new Error(error.message);
    return data?.[0];
  } catch (error) {
    throw error;
  }
}

export async function updateAvailabilitySlot(slotId, payload) {
  const { data, error } = await supabase
    .from('availability_slots')
    .update(payload)
    .eq('id', slotId)
    .select();

  if (error) throw new Error(error.message);
  return data?.[0];
}

export async function deleteAvailabilitySlot(slotId) {
  const { error } = await supabase
    .from('availability_slots')
    .delete()
    .eq('id', slotId);

  if (error) throw new Error(error.message);
  return true;
}
