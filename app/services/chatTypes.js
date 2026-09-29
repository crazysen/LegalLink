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

/** Expo DocumentPicker `type` — images use ImagePicker; documents only (no video). */
export const CHAT_DOCUMENT_PICKER_TYPES = [...CHAT_LIMITS.fileMime];

const VIDEO_EXTENSIONS = new Set([
  'mp4',
  'mov',
  'avi',
  'mkv',
  'webm',
  'm4v',
  '3gp',
  'mpeg',
  'mpg',
  'wmv',
  'flv',
]);

/**
 * @param {string} [mime]
 * @param {string} [fileName]
 */
export function isBlockedChatAttachment(mime, fileName) {
  const m = String(mime || '').toLowerCase();
  if (m.startsWith('video/')) {
    return true;
  }
  const ext = String(fileName || '')
    .split('.')
    .pop()
    ?.toLowerCase();
  return Boolean(ext && VIDEO_EXTENSIONS.has(ext));
}

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
 * @param {string} [fileName]
 * @returns {{ ok: boolean, error?: string }}
 */
export function validateAttachment(sizeBytes, mime, fileName) {
  const n = Number(sizeBytes) || 0;
  const m = String(mime || '').toLowerCase();
  if (isBlockedChatAttachment(m, fileName)) {
    return {
      ok: false,
      error: 'Videos cannot be sent in chat. Use images or documents (PDF, DOC, TXT) only.',
    };
  }
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
