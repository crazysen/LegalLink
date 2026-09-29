'use strict';

const FACEPLUS_API_BASE = (
  process.env.FACEPLUS_API_BASE || 'https://api-us.faceplusplus.com'
).replace(/\/+$/, '');
const FACEPLUS_API_KEY = process.env.FACEPLUS_API_KEY || '';
const FACEPLUS_API_SECRET = process.env.FACEPLUS_API_SECRET || '';

let chain = Promise.resolve();

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isConfigured() {
  return Boolean(FACEPLUS_API_KEY && FACEPLUS_API_SECRET);
}

/** Serialize all Face++ calls so free-tier concurrency limits are not exceeded. */
function enqueue(task) {
  const run = chain.then(() => task());
  chain = run.catch(() => {});
  return run;
}

async function postFacePlus(path, formBody) {
  const maxAttempts = 5;
  let lastBody = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const res = await fetch(`${FACEPLUS_API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody,
    });
    const body = await res.json().catch(() => ({}));
    lastBody = body;

    const msg = body.error_message ? String(body.error_message) : '';
    const retryable = msg.includes('CONCURRENCY_LIMIT_EXCEEDED');

    if (!retryable) {
      return { ok: res.ok, status: res.status, body };
    }

    await delay(800 + attempt * 700);
  }

  return { ok: false, status: 429, body: lastBody };
}

function detectForm(imageBase64, returnAttributes) {
  let form =
    `api_key=${encodeURIComponent(FACEPLUS_API_KEY)}` +
    `&api_secret=${encodeURIComponent(FACEPLUS_API_SECRET)}` +
    `&image_base64=${encodeURIComponent(imageBase64)}`;
  if (returnAttributes) {
    form += `&return_attributes=${encodeURIComponent(returnAttributes)}`;
  }
  return form;
}

function compareForm(imageBase64_1, imageBase64_2) {
  return (
    `api_key=${encodeURIComponent(FACEPLUS_API_KEY)}` +
    `&api_secret=${encodeURIComponent(FACEPLUS_API_SECRET)}` +
    `&image_base64_1=${encodeURIComponent(imageBase64_1)}` +
    `&image_base64_2=${encodeURIComponent(imageBase64_2)}`
  );
}

function detect(imageBase64, returnAttributes) {
  return enqueue(() =>
    postFacePlus('/facepp/v3/detect', detectForm(imageBase64, returnAttributes)),
  );
}

function compare(imageBase64_1, imageBase64_2) {
  return enqueue(() =>
    postFacePlus('/facepp/v3/compare', compareForm(imageBase64_1, imageBase64_2)),
  );
}

module.exports = {
  isConfigured,
  detect,
  compare,
};
