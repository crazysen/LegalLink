import {Vibration} from 'react-native';

export const CALL_RING_TIMEOUT_MS = 30000;
const RING_PATTERN = [0, 1000, 800];
// Android reclassifies short one-shot vibrations as touch feedback, which is muted when the
// user turns off touch haptics; a >1s multi-step pattern is treated as a real alert.
const NOTICE_PATTERN = [0, 400, 200, 450];

let ringTimer = null;

/** Repeating vibration for an incoming call; stops by itself after CALL_RING_TIMEOUT_MS. */
export function startCallRinging(onTimeout) {
  stopCallRinging();
  Vibration.vibrate(RING_PATTERN, true);
  ringTimer = setTimeout(() => {
    ringTimer = null;
    Vibration.cancel();
    onTimeout?.();
  }, CALL_RING_TIMEOUT_MS);
}

export function stopCallRinging() {
  if (ringTimer) {
    clearTimeout(ringTimer);
    ringTimer = null;
  }
  Vibration.cancel();
}

export function vibrateNotice() {
  Vibration.vibrate(NOTICE_PATTERN);
}
