import {Image} from 'react-native';

/** Bundled roster photos (same files as web `/assets/attorneys/*` on LegalLink-web.vercel.app). */
const BUNDLED = {
  jeanne: require('../assets/attorneys/jeanne-luz-castillo-anarna.jpg'),
  alston: require('../assets/attorneys/alston-kevin-anarna.jpg'),
  allen: require('../assets/attorneys/allen-kristopher-anarna.png'),
};

function normalizeAttorneyName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^atty\s+/, '')
    .trim();
}

export function matchBundledAttorneyKey(name) {
  const normalized = normalizeAttorneyName(name);
  if (
    normalized.includes('jeanne') &&
    (normalized.includes('castillo') ||
      normalized.includes('luz') ||
      normalized.includes('anarna'))
  ) {
    return 'jeanne';
  }
  if (
    normalized.includes('alston') &&
    (normalized.includes('kevin') || normalized.includes('anarna'))
  ) {
    return 'alston';
  }
  if (
    normalized.includes('allen') &&
    (normalized.includes('kristopher') || normalized.includes('anarna'))
  ) {
    return 'allen';
  }
  return null;
}

/** @returns {number | null} React Native `require()` module id */
export function getBundledAttorneyPhotoSource(name) {
  const key = matchBundledAttorneyKey(name);
  return key ? BUNDLED[key] : null;
}

/** @returns {string | null} `file://` or packager URI for `<Image source={{ uri }} />` */
export function getBundledAttorneyPhotoUri(name) {
  const source = getBundledAttorneyPhotoSource(name);
  if (!source) return null;
  const resolved = Image.resolveAssetSource(source);
  return resolved?.uri || null;
}
