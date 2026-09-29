import { supabase } from './supabaseClient';

export const ANNOUNCEMENT_IMAGES_BUCKET = 'announcement-images';
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const sanitizeFilename = (name) =>
  String(name || 'image')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 80) || 'image';

export function validateAnnouncementImageFile({ mimeType, sizeBytes }) {
  if (!mimeType) return 'Please choose an image file.';
  if (!ALLOWED_TYPES.has(String(mimeType || '').toLowerCase())) {
    return 'Use JPG, PNG, WebP, or GIF only.';
  }
  if (Number(sizeBytes) > MAX_BYTES) return 'Image must be 5 MB or smaller.';
  return null;
}

export async function uploadAnnouncementImageFromUri({ uri, fileName, mimeType }) {
  const validationError = validateAnnouncementImageFile({ mimeType, sizeBytes: 0 });
  if (validationError && !mimeType) throw new Error(validationError);

  const ext = String(fileName || '').split('.').pop()?.toLowerCase() || 'jpg';
  const safeExt = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext) ? ext : 'jpg';
  const path = `admin/${Date.now()}_${sanitizeFilename(fileName)}.${safeExt}`;

  const response = await fetch(uri);
  if (!response.ok) {
    throw new Error('Could not read the selected image.');
  }
  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_BYTES) {
    throw new Error('Image must be 5 MB or smaller.');
  }

  const { error: uploadError } = await supabase.storage
    .from(ANNOUNCEMENT_IMAGES_BUCKET)
    .upload(path, arrayBuffer, {
      cacheControl: '3600',
      upsert: false,
      contentType: mimeType || `image/${safeExt === 'jpg' ? 'jpeg' : safeExt}`,
    });

  if (uploadError) {
    throw new Error(uploadError.message || 'Failed to upload image.');
  }

  const { data } = supabase.storage.from(ANNOUNCEMENT_IMAGES_BUCKET).getPublicUrl(path);
  const publicUrl = data?.publicUrl;
  if (!publicUrl) throw new Error('Upload succeeded but public URL was not returned.');
  return { path, publicUrl };
}

export function parseNotificationImageUrl(data) {
  if (!data || typeof data !== 'object') return null;
  const url = String(data.image_url || data.imageUrl || '').trim();
  return url || null;
}

/** Admin / platform announcements (not consultation chat threads). */
export function isAdminAnnouncementNotification(type) {
  const t = String(type || '').toLowerCase();
  if (t === 'notarial_update' || t === 'consultation' || t === 'consultation_summary') {
    return false;
  }
  if (t === 'announcement' || t === 'admin_announcement') return true;
  return t.startsWith('admin_');
}

export function openAnnouncementDetail(navigation, item) {
  if (!navigation || !item) return;
  navigation.navigate('ClientAnnouncementDetail', {
    title: item.title || 'Announcement',
    body: item.body || '',
    imageUrl: item.imageUrl || parseNotificationImageUrl(item.data),
    data: item.data || null,
    createdAt: item.created_at || null,
    type: item.type || 'announcement',
  });
}
