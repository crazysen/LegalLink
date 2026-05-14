import { NativeModules } from 'react-native';

/**
 * Megvii MegLive must be implemented as a native module (MegLiveStill SDK).
 * Expected native API (you wire this in Android/iOS using Megvii’s SDK):
 *
 *   NativeModules.BatasMoMegLive.startLiveness(bizToken: string): Promise<{
 *     megliveFileUri: string   // file:// path to the SDK output bundle for POST /faceid/verify
 *   }>
 *
 * Until linked, `isMegLiveNativeAvailable()` is false and the app uses legacy camera + /verify-identity
 * when EXPO_PUBLIC_FACEID_ALLOW_LEGACY_FALLBACK is true.
 */
const Native = NativeModules.BatasMoMegLive;

export function isMegLiveNativeAvailable() {
  return Native != null && typeof Native.startLiveness === 'function';
}

/**
 * @param {string} bizToken From POST /faceid/biz-token
 * @returns {Promise<{ megliveFileUri: string }>}
 */
export async function startMegLiveSession(bizToken) {
  if (!isMegLiveNativeAvailable()) {
    const err = new Error('MEGLIVE_NATIVE_UNAVAILABLE');
    err.code = 'MEGLIVE_NATIVE_UNAVAILABLE';
    throw err;
  }
  const out = await Native.startLiveness(bizToken);
  const megliveFileUri = out?.megliveFileUri ?? out?.uri ?? out?.path;
  if (!megliveFileUri || typeof megliveFileUri !== 'string') {
    throw new Error('Native MegLive module returned no megliveFileUri');
  }
  return { megliveFileUri };
}
