import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { resolveVideoBackendBaseUrl } from './videoMeetingService';

const FACEPLUS_API_KEY = process.env.EXPO_PUBLIC_FACEPLUS_API_KEY || '';
const FACEPLUS_API_SECRET = process.env.EXPO_PUBLIC_FACEPLUS_API_SECRET || '';
const FACEPLUS_API_BASE = (
  process.env.EXPO_PUBLIC_FACEPLUS_API_BASE || 'https://api-us.faceplusplus.com'
).replace(/\/+$/, '');
const MIN_CONFIDENCE = Number(process.env.EXPO_PUBLIC_FACE_VERIFY_MIN_CONFIDENCE || 75);

// Face++ free tier: 2 MB decoded per image. Target 1.5 MB to stay safe.
const MAX_IMAGE_BYTES = 1.75 * 1024 * 1024;

function getBackendBase() {
  return resolveVideoBackendBaseUrl();
}

function faceIdAuthHeaders() {
  const secret = process.env.EXPO_PUBLIC_FACEID_SHARED_SECRET;
  if (!secret) return {};
  return { Authorization: `Bearer ${secret}` };
}

// ─── Image compression ───────────────────────────────────────────────────────

/**
 * Resize + compress a file URI or base64 image so it stays under Face++'s 2 MB limit.
 * Returns raw base64 (no data-URI prefix).
 */
async function compressImage(input) {
  if (!input) return '';
  let source;
  if (input.startsWith('file://')) {
    source = input;
  } else {
    const clean = input.replace(/^data:[^;]+;base64,/i, '').replace(/\s/g, '');
    source = `data:image/jpeg;base64,${clean}`;
  }

  try {
    // Unconditionally resize to width 800 to ensure Face++ dimension limits
    // (max 4096x4096) are never exceeded, even if the file size is small.
    const result = await manipulateAsync(
      source,
      [{ resize: { width: 800 } }],
      { compress: 0.7, format: SaveFormat.JPEG, base64: true },
    );
    return (result.base64 || '').replace(/^data:[^;]+;base64,/i, '');
  } catch (err) {
    console.error('compressImage error:', err);
    if (!input.startsWith('file://')) {
      return input.replace(/^data:[^;]+;base64,/i, '').replace(/\s/g, '');
    }
    return '';
  }
}

// ─── FaceID / MegLive (kept for future native module) ────────────────────────

export async function requestFaceIdBizToken(idBase64, uuid) {
  const base = getBackendBase();
  if (!base) throw new Error('Backend URL is not set. Configure EXPO_PUBLIC_BATASMO_WEB_API_URL.');

  const res = await fetch(`${base}/faceid/biz-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...faceIdAuthHeaders() },
    body: JSON.stringify({ idBase64, uuid }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `FaceID biz-token failed (${res.status}).`);
  if (!body.biz_token) throw new Error('FaceID biz-token response missing biz_token.');
  return { bizToken: body.biz_token, requestId: body.request_id };
}

export async function verifyFaceIdWithMeglive(bizToken, megliveFileUri) {
  const base = getBackendBase();
  if (!base) throw new Error('Backend URL is not set. Configure EXPO_PUBLIC_BATASMO_WEB_API_URL.');

  const form = new FormData();
  form.append('biz_token', bizToken);
  form.append('meglive_data', { uri: megliveFileUri, name: 'meglive_data', type: 'application/octet-stream' });

  const res = await fetch(`${base}/faceid/verify`, {
    method: 'POST',
    headers: { ...faceIdAuthHeaders() },
    body: form,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || body?.result_message || `FaceID verify failed (${res.status}).`);

  return {
    verified: Boolean(body.verified),
    confidence: Number(body.confidence ?? body.faceMatchConfidence ?? 0),
    isIdentical: Boolean(body.verified),
    raw: body,
  };
}

// ─── Liveness detection ───────────────────────────────────────────────────────

/**
 * Calls Face++ /detection/detect and returns structured info about the frame.
 *
 * Returns:
 *   faceDetected   – at least one face was found in the image
 *   faceSizeRatio  – face_rectangle.width / image_cols (0–1), indicates distance
 *   challengePassed – whether the requested liveness challenge was completed
 *   passed          – faceDetected AND challengePassed
 *   reason          – human-readable reason when passed = false
 *
 * @param {string} selfieInput - Raw base64 or file URI
 * @param {'blink'|'turn_left'|'turn_right'|null} challengeId – null = face-detect only
 * @returns {Promise<{ faceDetected: boolean, faceSizeRatio: number, challengePassed: boolean, passed: boolean, reason?: string }>}
 */
export async function checkFaceLiveness(selfieInput, challengeId) {
  const noResult = (reason) => ({ faceDetected: false, faceSizeRatio: 0, challengePassed: false, passed: false, reason });

  if (!FACEPLUS_API_KEY || !FACEPLUS_API_SECRET) {
    // Keys not set — do not proceed automatically (prevents false "faces").
    return noResult('Face++ API keys are not set. Configure EXPO_PUBLIC_FACEPLUS_API_KEY / EXPO_PUBLIC_FACEPLUS_API_SECRET.');
  }

  const clean = await compressImage(selfieInput);

  // Step 1 (no challenge) only needs face rectangles.
  // Request fewer attributes to reduce chances of partial responses.
  let returnAttributes = '';
  if (challengeId === 'blink') returnAttributes = 'eyestatus';
  else if (challengeId === 'turn_left' || challengeId === 'turn_right') returnAttributes = 'headpose';

  const formBody =
    `api_key=${encodeURIComponent(FACEPLUS_API_KEY)}` +
    `&api_secret=${encodeURIComponent(FACEPLUS_API_SECRET)}` +
    `&image_base64=${encodeURIComponent(clean)}` +
    (returnAttributes ? `&return_attributes=${encodeURIComponent(returnAttributes)}` : '');

  let res;
  try {
    res = await fetch(`${FACEPLUS_API_BASE}/facepp/v3/detect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody,
    });
  } catch (e) {
    return noResult(`Network error — check your connection. (${e?.message})`);
  }

  const body = await res.json().catch(() => ({}));
  if (body.error_message) return noResult(`Face++ error: ${body.error_message}`);

  const faces = body.faces || [];
  if (faces.length === 0) {
    return noResult('No face detected. Make sure your face is centred and well-lit.');
  }

  if (faces.length > 1) {
    return { faceDetected: true, faceCount: faces.length, faceSizeRatio: 0, challengePassed: false, passed: false,
      reason: 'Multiple faces detected. Please make sure only your face is in the frame.' };
  }

  const face          = faces[0];
  const rect          = face.face_rectangle || {};
  const faceSizeRatio = rect.width ? rect.width / (rect.width + rect.left * 2 + 20) : 0.3;

  // No challenge needed — just confirm face presence (step 1)
  if (!challengeId) {
    return { faceDetected: true, faceCount: 1, faceSizeRatio, challengePassed: true, passed: true };
  }

  const attrs     = face.attributes || {};
  const headpose  = attrs.headpose  || {};
  const eyestatus = attrs.eyestatus || {};
  let eyesOpen = null;
  let eyesClosed = null;

  if (challengeId === 'blink') {
    const leftClosedRaw  = eyestatus.left_eye_status?.no_glass_eye_closed;
    const rightClosedRaw = eyestatus.right_eye_status?.no_glass_eye_closed;
    const leftOpenRaw    = eyestatus.left_eye_status?.no_glass_eye_open;
    const rightOpenRaw   = eyestatus.right_eye_status?.no_glass_eye_open;

    // Values may be numbers or strings; normalize.
    const leftClosed  = typeof leftClosedRaw  === 'number' ? leftClosedRaw  : (leftClosedRaw  == null ? null : Number(leftClosedRaw));
    const rightClosed = typeof rightClosedRaw === 'number' ? rightClosedRaw : (rightClosedRaw == null ? null : Number(rightClosedRaw));
    const leftOpen    = typeof leftOpenRaw    === 'number' ? leftOpenRaw    : (leftOpenRaw    == null ? null : Number(leftOpenRaw));
    const rightOpen   = typeof rightOpenRaw   === 'number' ? rightOpenRaw   : (rightOpenRaw   == null ? null : Number(rightOpenRaw));

    // Face++ often returns 0..1 scores. Blink is detected when eyes are clearly closed.
    // Prefer using `*_eye_closed` if present; otherwise fall back to `*_eye_open`.
    // Lowered thresholds for real mobile-camera / indoor-lighting conditions:
    //   CLOSE_TH 0.20 — phone front cameras rarely push no_glass_eye_closed above 0.40 during a blink.
    //   OPEN_TH  0.45 — sufficiently distinct from closed to confirm "eyes are open" before the gate fires.
    const CLOSE_TH = 0.20;
    const OPEN_TH  = 0.45;

    const avgClosed =
      (typeof leftClosed === 'number' && typeof rightClosed === 'number')
        ? (leftClosed + rightClosed) / 2
        : null;
    const avgOpen =
      (typeof leftOpen === 'number' && typeof rightOpen === 'number')
        ? (leftOpen + rightOpen) / 2
        : null;

    eyesClosed = avgClosed !== null
      ? avgClosed >= CLOSE_TH
      : (avgOpen !== null ? avgOpen <= 0.45 : false);
    eyesOpen = avgOpen !== null
      ? avgOpen >= OPEN_TH
      : (avgClosed !== null ? avgClosed <= 0.45 : false);

    const isBlink = eyesClosed;

    if (!isBlink) {
      return {
        faceDetected: true,
        faceCount: 1,
        faceSizeRatio,
        challengePassed: false,
        passed: false,
        eyesOpen,
        eyesClosed,
        reason: eyesOpen
          ? 'Blink not detected yet — close both eyes briefly.'
          : 'Hold steady with eyes open, then blink once.',
      };
    }
  } else if (challengeId === 'turn_left') {
    if ((headpose.yaw_angle ?? 0) > -12) {
      return { faceDetected: true, faceCount: 1, faceSizeRatio, challengePassed: false, passed: false,
        reason: 'Keep turning your head to the left.' };
    }
  } else if (challengeId === 'turn_right') {
    if ((headpose.yaw_angle ?? 0) < 12) {
      return { faceDetected: true, faceCount: 1, faceSizeRatio, challengePassed: false, passed: false,
        reason: 'Keep turning your head to the right.' };
    }
  }

  return {
    faceDetected: true,
    faceCount: 1,
    faceSizeRatio,
    challengePassed: true,
    passed: true,
    eyesOpen,
    eyesClosed,
  };
}

// ─── Face comparison ──────────────────────────────────────────────────────────

/**
 * Compares selfie vs government-ID image using Face++ directly from mobile.
 * Both images are compressed to ≤ 1.5 MB before the request.
 *
 * @param {string} selfieInput - Raw base64 or file URI
 * @param {string} idInput     - Raw base64 or file URI
 * @returns {Promise<{ verified: boolean, confidence: number, isIdentical: boolean }>}
 */
export async function verifyFaceAgainstId(selfieInput, idInput) {
  if (!FACEPLUS_API_KEY || !FACEPLUS_API_SECRET) {
    throw new Error(
      'Face++ keys are not set. Add EXPO_PUBLIC_FACEPLUS_API_KEY and EXPO_PUBLIC_FACEPLUS_API_SECRET to .env, then restart with: npx expo start -c',
    );
  }

  const [clean1, clean2] = await Promise.all([
    compressImage(selfieInput),
    compressImage(idInput),
  ]);

  const formBody =
    `api_key=${encodeURIComponent(FACEPLUS_API_KEY)}` +
    `&api_secret=${encodeURIComponent(FACEPLUS_API_SECRET)}` +
    `&image_base64_1=${encodeURIComponent(clean1)}` +
    `&image_base64_2=${encodeURIComponent(clean2)}`;

  let res;
  try {
    res = await fetch(`${FACEPLUS_API_BASE}/facepp/v3/compare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody,
    });
  } catch (e) {
    throw new Error(`Network error reaching Face++ — check your internet connection. (${e?.message})`);
  }

  const body = await res.json().catch(() => ({}));

  if (body.error_message) throw new Error(`Face++ error: ${body.error_message}`);
  if (!res.ok) throw new Error(`Face++ returned status ${res.status}. Please try again.`);

  const confidence = Math.round(Number(body.confidence ?? 0));
  const verified = confidence >= MIN_CONFIDENCE;

  return { verified, confidence, isIdentical: verified };
}
