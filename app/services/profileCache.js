import AsyncStorage from '@react-native-async-storage/async-storage';

const CACHE_KEY = 'batasmo_user_profile_v1';

/**
 * Persisted profile slice for instant greeting after cold start (until Supabase hydrates).
 */
export async function loadCachedProfile() {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

export async function saveCachedProfile(profile) {
  try {
    if (!profile || typeof profile !== 'object') return;
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(profile));
  } catch {
    // ignore
  }
}

export async function clearCachedProfile() {
  try {
    await AsyncStorage.removeItem(CACHE_KEY);
  } catch {
    // ignore
  }
}
