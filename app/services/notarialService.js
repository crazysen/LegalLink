import { supabase } from './supabaseClient';

/** Must match a public bucket with upload policies for authenticated users (see Supabase Storage). */
const STORAGE_BUCKET = 'documents';

const isMissingColumnError = (error, columnName) => {
  const message = String(error?.message || '').toLowerCase();
  return error?.code === '42703' || message.includes(String(columnName || '').toLowerCase());
};

export function resolveNotarialDocumentUrl(documentUrl) {
  const rawUrl = String(documentUrl || '').trim();
  if (!rawUrl) return '';
  if (/^https?:\/\//i.test(rawUrl)) return rawUrl;

  // For Supabase storage, get the public URL
  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(rawUrl);
  return data?.publicUrl || rawUrl;
}

function stripDataUriBase64(input) {
  const s = String(input || '');
  const m = s.match(/^data:[^;]+;base64,(.+)$/i);
  return m ? m[1] : s.replace(/\s/g, '');
}

function base64ToArrayBuffer(base64) {
  const clean = stripDataUriBase64(base64);
  const atobFn = globalThis.atob;
  if (typeof atobFn !== 'function') {
    throw new Error('This build cannot decode base64; update the app or use a device with atob support.');
  }
  const binary = atobFn(clean);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function mimeFromFilename(filename) {
  const ext = String(filename || '')
    .split('.')
    .pop()
    ?.toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  const map = {
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
  return map[ext] || 'application/octet-stream';
}

function safePathSegment(name) {
  return String(name || 'file')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 120) || 'file';
}

async function uploadBase64ToDocuments(userId, base64, filename, role) {
  const ext = String(filename || '').split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
  const path = `${userId}/${Date.now()}_${role}_${safePathSegment(filename)}.${ext}`;
  const buffer = base64ToArrayBuffer(base64);
  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, buffer, {
      contentType: mimeFromFilename(filename),
      upsert: false,
    });

  if (uploadError) {
    throw new Error(
      uploadError.message ||
        `Could not upload ${role} to storage. Create the "${STORAGE_BUCKET}" bucket and allow authenticated uploads.`,
    );
  }

  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  return data?.publicUrl || path;
}

export async function getNotarialRequests() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('notarial_requests')
    .select(`
      *,
      client:client_id (full_name),
      attorney:attorney_id (full_name)
    `)
    .or(`client_id.eq.${user.id},attorney_id.eq.${user.id}`)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);

  const requestIds = (data || []).map((row) => row.id).filter(Boolean);
  let paymentByRequest = new Map();

  if (requestIds.length > 0) {
    const { data: txRows, error: txError } = await supabase
      .from('transactions')
      .select('notarial_request_id, payment_status')
      .in('notarial_request_id', requestIds);

    if (txError && !isMissingColumnError(txError, 'notarial_request_id')) {
      throw new Error(txError.message || 'Failed to load payment status.');
    }

    paymentByRequest = new Map(
      (txRows || []).map((row) => [row.notarial_request_id, row.payment_status]),
    );
  }

  return (data || []).map(row => {
    const paymentStatus = String(paymentByRequest.get(row.id) || '').toLowerCase();
    return {
      ...row,
      client_name: Array.isArray(row.client) ? row.client[0]?.full_name : row.client?.full_name,
      attorney_name: Array.isArray(row.attorney) ? row.attorney[0]?.full_name : row.attorney?.full_name,
      payment_status: paymentStatus || null,
      payment_is_paid: paymentStatus === 'paid',
    };
  });
}

export async function createNotarialRequest(payload) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  let documentUrl = payload.document_url ? String(payload.document_url).trim() : '';

  // Run both uploads in parallel to cut wait time roughly in half
  const [mainUrl, idUrl] = await Promise.all([
    documentUrl || !payload.document_base64
      ? Promise.resolve(documentUrl)
      : uploadBase64ToDocuments(
          user.id,
          payload.document_base64,
          payload.document_name || 'notarial-document.pdf',
          'main',
        ),
    payload.id_base64
      ? uploadBase64ToDocuments(
          user.id,
          payload.id_base64,
          payload.id_name || 'government-id',
          'id',
        )
      : Promise.resolve(null),
  ]);

  documentUrl = mainUrl;
  if (!documentUrl) {
    throw new Error('No document to submit. Please upload your file again.');
  }

  let detailsText = payload.details?.trim() || null;
  if (idUrl) {
    const idLine = `[Government ID on file: ${idUrl}]`;
    detailsText = detailsText ? `${detailsText}\n\n${idLine}` : idLine;
  }

  const { data, error } = await supabase
    .from('notarial_requests')
    .insert({
      client_id: user.id,
      attorney_id: payload.attorney_id || null,
      service_type: payload.service_type,
      details: detailsText,
      document_url: documentUrl,
      status: 'pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function updateNotarialRequestStatus(requestId, status) {
  const { data, error } = await supabase
    .from('notarial_requests')
    .update({ 
      status: String(status).toLowerCase(), 
      updated_at: new Date().toISOString() 
    })
    .eq('id', requestId)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}
