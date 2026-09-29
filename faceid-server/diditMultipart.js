'use strict';

const { Blob } = require('buffer');

const DIDIT_API_BASE = (
  process.env.DIDIT_API_BASE || 'https://verification.didit.me'
).replace(/\/+$/, '');
const DIDIT_API_KEY = process.env.DIDIT_API_KEY || '';

/** Didit requires each image file to be strictly larger than 250 KB. */
const MIN_IMAGE_BYTES = 250 * 1024 + 1;

function stripBase64(input) {
  return String(input || '').replace(/^data:[^;]+;base64,/i, '').replace(/\s/g, '');
}

function bufferFromBase64(input, filename, contentType) {
  const clean = stripBase64(input);
  const buffer = Buffer.from(clean, 'base64');
  return { buffer, filename, contentType };
}

function appendImageField(form, fieldName, { buffer, filename, contentType }) {
  form.append(
    fieldName,
    new Blob([buffer], { type: contentType || 'image/jpeg' }),
    filename,
  );
}

function assertMinImageSize(buffer, label) {
  if (buffer.length < MIN_IMAGE_BYTES) {
    const kb = Math.round(buffer.length / 1024);
    const err = new Error(
      `${label} is too small (${kb} KB). Each photo must be over 250 KB — retake closer with good lighting.`,
    );
    err.code = 'IMAGE_TOO_SMALL';
    throw err;
  }
}

function extractDiditError(body, status) {
  if (typeof body === 'string' && body.trim()) return body.trim();
  if (!body || typeof body !== 'object') {
    return `Verification failed (${status}). Check image size (>250 KB) and that the full ID is in frame.`;
  }
  if (body.error) return String(body.error);
  if (body.detail) return String(body.detail);
  if (body.message) return String(body.message);
  if (body.raw) return String(body.raw);
  const warn = body.id_verification?.warnings?.[0]?.message;
  if (warn) return String(warn);
  return `Verification failed (${status}). Check image size (>250 KB) and that the full ID is in frame.`;
}

async function diditMultipartPost(path, buildForm) {
  const form = buildForm(new FormData());
  const res = await fetch(`${DIDIT_API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'x-api-key': DIDIT_API_KEY,
    },
    body: form,
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 400) };
  }
  return { res, body };
}

module.exports = {
  stripBase64,
  bufferFromBase64,
  appendImageField,
  assertMinImageSize,
  extractDiditError,
  diditMultipartPost,
  hasDiditApiKey: () => Boolean(DIDIT_API_KEY),
  MIN_IMAGE_BYTES,
};
