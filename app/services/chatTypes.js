/**
 * Shared chat contract (mobile + future web): consultation room = conversation; threadId = appointmentId.
 * @typedef {'text' | 'image' | 'file'} MessageType
 */

export const CHAT_LIMITS = {
  imageMaxBytes: 10 * 1024 * 1024,
  fileMaxBytes: 25 * 1024 * 1024,
  imageMime: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  fileMime: [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
  ],
};

export const CHAT_BUCKETS = {
  image: 'chat-images',
  file: 'chat-files',
};

/** @param {string} mime */
export function bucketForMessageType(mime) {
  if (!mime || mime.startsWith('image/')) {
    return CHAT_BUCKETS.image;
  }
  return CHAT_BUCKETS.file;
}

/**
 * @param {number} sizeBytes
 * @param {string} mime
 * @returns {{ ok: boolean, error?: string }}
 */
export function validateAttachment(sizeBytes, mime) {
  const n = Number(sizeBytes) || 0;
  const m = String(mime || '').toLowerCase();
  if (m.startsWith('image/')) {
    if (!CHAT_LIMITS.imageMime.includes(m)) {
      return {ok: false, error: 'Unsupported image type.'};
    }
    if (n > CHAT_LIMITS.imageMaxBytes) {
      return {ok: false, error: 'Image must be 10 MB or smaller.'};
    }
    return {ok: true};
  }
  if (!CHAT_LIMITS.fileMime.includes(m)) {
    return {ok: false, error: 'Unsupported file type (PDF, DOC/DOCX, TXT).'};
  }
  if (n > CHAT_LIMITS.fileMaxBytes) {
    return {ok: false, error: 'File must be 25 MB or smaller.'};
  }
  return {ok: true};
}
