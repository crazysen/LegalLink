import { supabase } from './supabaseClient';
import { e164ToPhilippinesLocal11 } from './authService';

export async function getMyProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('profiles')
    .select('*, attorney_profiles(*)')
    .eq('id', user.id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      // Profile doesn't exist yet, return empty standard profile
      return { full_name: user.email, email: user.email, role: 'Client' };
    }
    throw new Error(error.message);
  }

  const isAttorney = data.role?.toLowerCase() === 'attorney';
  const attorneyData = Array.isArray(data.attorney_profiles) ? data.attorney_profiles[0] : data.attorney_profiles;

  if (isAttorney && attorneyData) {
    return { ...data, ...attorneyData };
  }
  return data;
}

export async function updateMyProfile(payload) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  let avatarUrl = payload.avatar_url;
  if (!avatarUrl && payload.avatar_base64) {
      avatarUrl = `data:image/jpeg;base64,${payload.avatar_base64}`;
  }

  let phoneForDb = payload.phone;
  if (phoneForDb !== undefined && phoneForDb !== null) {
    const trimmed = String(phoneForDb).trim();
    if (trimmed === '') {
      phoneForDb = null;
    } else {
      const local = e164ToPhilippinesLocal11(trimmed);
      if (!local) {
        throw new Error('Enter a valid Philippine mobile number (09XXXXXXXXX).');
      }
      phoneForDb = local;
    }
  }

  const profileUpdate = {
    full_name: payload.full_name,
    phone: phoneForDb,
    address: payload.address,
    age: payload.age,
    guardian_name: payload.guardian_name,
    guardian_contact: payload.guardian_contact,
    avatar_url: avatarUrl,
    updated_at: new Date().toISOString(),
  };

  // Remove undefined values
  Object.keys(profileUpdate).forEach(key => profileUpdate[key] === undefined && delete profileUpdate[key]);

  const { error: profileError } = await supabase
    .from('profiles')
    .upsert({ id: user.id, email: user.email, ...profileUpdate }, { onConflict: 'id' });
    
  if (profileError) throw new Error(profileError.message);

  // If attorney, update attorney_profiles too
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  if (profile?.role?.toLowerCase() === 'attorney' || payload.role?.toLowerCase() === 'attorney') {
    let docUrl = payload.credential_document_url;
    if (!docUrl && payload.credential_document_base64) {
        docUrl = `data:application/pdf;base64,${payload.credential_document_base64}`;
    }

    const attorneyUpdate = {
      firm_name: payload.firm_name,
      years_experience: payload.years_experience,
      specialties: payload.specialties,
      bio: payload.bio,
      consultation_fee: payload.consultation_fee,
      is_verified: payload.is_verified,
      updated_at: new Date().toISOString(),
    };

    if (docUrl) {
      attorneyUpdate.bio = `${payload.bio || ''}\nCredential Document: ${docUrl}`;
    }

    Object.keys(attorneyUpdate).forEach(key => attorneyUpdate[key] === undefined && delete attorneyUpdate[key]);

    if (Object.keys(attorneyUpdate).length > 1) { // 1 because updated_at is always there
         const { error: attyError } = await supabase
            .from('attorney_profiles')
            .upsert({ user_id: user.id, ...attorneyUpdate }, { onConflict: 'user_id' });
         if (attyError) throw new Error(attyError.message);
    }
  }

  return await getMyProfile();
}
