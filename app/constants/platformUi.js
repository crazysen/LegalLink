import * as RN from 'react-native';

/**
 * Resolve OS without destructuring `Platform` from react-native (some Hermes builds throw
 * ReferenceError: Property 'Platform' doesn't exist when using named imports).
 */
const OS = RN.Platform?.OS ?? 'android';

export const IS_IOS = OS === 'ios';
export const IS_ANDROID = OS === 'android';

/** Marketing / auth display titles (Georgia on iOS, generic serif on Android). */
export const FONT_SERIF_DISPLAY = IS_IOS ? 'Georgia' : 'serif';

/** Multiline chat input padding (keyboard screens). */
export const CHAT_INPUT_PADDING_VERTICAL = IS_IOS ? 12 : 10;

/** Account-created header offset on Android status bar. */
export const ACCOUNT_CREATED_HEADER_MARGIN_TOP = IS_ANDROID ? 10 : 0;
