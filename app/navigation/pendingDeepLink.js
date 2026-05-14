import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  normalizeRole,
  pathFromDeepLinkUrl,
  resolveNavigationTargetFromPath,
} from '../constants/routeAlignment';
import {supabase} from '../services/supabaseClient';

export const PENDING_DEEP_LINK_KEY = 'batasmo_pending_deep_link_v1';
const STORAGE_KEY = PENDING_DEEP_LINK_KEY;

/**
 * Persist URL for post-login navigation when there is no Supabase session.
 * @returns {Promise<boolean>} true if stashed (no session)
 */
export async function stashPendingDeepLinkIfNeeded(url, hasSession) {
  if (!url || hasSession) {
    return false;
  }
  await AsyncStorage.setItem(STORAGE_KEY, String(url));
  return true;
}

/**
 * @param {import('@react-navigation/native').NavigationContainerRef<any>} navigationRef
 */
export async function flushPendingDeepLink(navigationRef) {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw || !navigationRef.isReady()) {
    return;
  }

  const {
    data: {session},
  } = await supabase.auth.getSession();
  if (!session?.user) {
    return;
  }

  await AsyncStorage.removeItem(STORAGE_KEY);

  let role = normalizeRole(session.user.user_metadata?.role || 'Client');
  const {data: prof} = await supabase
    .from('profiles')
    .select('role')
    .eq('id', session.user.id)
    .maybeSingle();
  if (prof?.role) {
    role = normalizeRole(prof.role);
  }

  const path = pathFromDeepLinkUrl(raw);
  const target = resolveNavigationTargetFromPath(path, raw, role);
  if (!target) {
    return;
  }

  navigationRef.navigate(target.name, target.params);
}
