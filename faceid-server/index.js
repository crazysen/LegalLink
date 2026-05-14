'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const FormData = require('form-data');
const { createFaceIdSign } = require('./faceidSign');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const app = express();
const PORT = Number(process.env.PORT || 4001);

const FACEID_API_BASE =
  process.env.FACEID_API_BASE || 'https://api.megvii.com';
const FACEID_API_KEY = process.env.FACEID_API_KEY || '';
const FACEID_API_SECRET = process.env.FACEID_API_SECRET || '';
const MOBILE_SHARED_SECRET = process.env.FACEID_MOBILE_SHARED_SECRET || '';

app.use(cors());
app.use(express.json({ limit: '25mb' }));

function requireFaceIdCreds(res) {
  if (!FACEID_API_KEY || !FACEID_API_SECRET) {
    res.status(503).json({
      error:
        'FaceID is not configured. Set FACEID_API_KEY and FACEID_API_SECRET (FaceID console, not only Face++ Open Platform).',
    });
    return false;
  }
  return true;
}

function checkMobileAuth(req, res) {
  if (!MOBILE_SHARED_SECRET) return true;
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (token !== MOBILE_SHARED_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

/**
 * POST /faceid/biz-token
 * Body: { idBase64: string (no data URL prefix), uuid: string }
 * Uses comparison_type=0: liveness result vs uploaded ID image (image_ref1).
 */
app.post('/faceid/biz-token', async (req, res) => {
  if (!checkMobileAuth(req, res)) return;
  if (!requireFaceIdCreds(res)) return;

  const { idBase64, uuid } = req.body || {};
  if (!idBase64 || typeof idBase64 !== 'string') {
    res.status(400).json({ error: 'MISSING_ARGUMENTS:idBase64' });
    return;
  }
  if (!uuid || typeof uuid !== 'string' || uuid.length > 128) {
    res.status(400).json({ error: 'MISSING_ARGUMENTS:uuid (max 128 chars)' });
    return;
  }

  try {
    const sign = createFaceIdSign(FACEID_API_KEY, FACEID_API_SECRET);
    const imageBuffer = Buffer.from(idBase64, 'base64');

    const form = new FormData();
    form.append('sign', sign);
    form.append('sign_version', 'hmac_sha1');
    form.append('liveness_type', process.env.FACEID_LIVENESS_TYPE || 'meglive');
    form.append('comparison_type', '0');
    form.append('uuid', uuid);
    form.append('image_ref1', imageBuffer, {
      filename: 'id.jpg',
      contentType: 'image/jpeg',
    });
    if (process.env.FACEID_BIZ_NO) {
      form.append('biz_no', process.env.FACEID_BIZ_NO);
    }
    const verbose = process.env.FACEID_VERBOSE;
    if (verbose === '0' || verbose === '1') {
      form.append('verbose', verbose);
    }
    const securityLevel = process.env.FACEID_SECURITY_LEVEL;
    if (securityLevel === '1' || securityLevel === '2' || securityLevel === '3') {
      form.append('security_level', securityLevel);
    }

    const url = `${FACEID_API_BASE}/faceid/v3/sdk/get_biz_token`;
    const upstream = await fetch(url, {
      method: 'POST',
      headers: form.getHeaders(),
      body: form,
    });

    const text = await upstream.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      res.status(502).json({ error: 'FaceID get_biz_token returned non-JSON', raw: text.slice(0, 200) });
      return;
    }

    if (!upstream.ok || json.error) {
      res.status(upstream.status >= 400 ? upstream.status : 400).json(json);
      return;
    }

    res.json({
      biz_token: json.biz_token,
      request_id: json.request_id,
      time_used: json.time_used,
    });
  } catch (e) {
    console.error('[faceid/biz-token]', e);
    res.status(500).json({ error: e?.message || 'get_biz_token failed' });
  }
});

/**
 * POST /faceid/verify
 * multipart: biz_token (field), meglive_data (file from MegLive SDK)
 */
app.post('/faceid/verify', upload.single('meglive_data'), async (req, res) => {
  if (!checkMobileAuth(req, res)) return;
  if (!requireFaceIdCreds(res)) return;

  const bizToken = req.body?.biz_token || req.body?.bizToken;
  if (!bizToken || typeof bizToken !== 'string') {
    res.status(400).json({ error: 'MISSING_ARGUMENTS:biz_token' });
    return;
  }
  if (!req.file?.buffer) {
    res.status(400).json({ error: 'MISSING_ARGUMENTS:meglive_data file' });
    return;
  }

  try {
    const sign = createFaceIdSign(FACEID_API_KEY, FACEID_API_SECRET);

    const form = new FormData();
    form.append('sign', sign);
    form.append('sign_version', 'hmac_sha1');
    form.append('biz_token', bizToken);
    form.append('meglive_data', req.file.buffer, {
      filename: 'meglive_data',
      contentType: 'application/octet-stream',
    });

    const url = `${FACEID_API_BASE}/faceid/v3/sdk/verify`;
    const upstream = await fetch(url, {
      method: 'POST',
      headers: form.getHeaders(),
      body: form,
    });

    const text = await upstream.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      res.status(502).json({ error: 'FaceID verify returned non-JSON', raw: text.slice(0, 200) });
      return;
    }

    if (!upstream.ok) {
      res.status(upstream.status).json(json);
      return;
    }

    const resultCode = json.result_code;
    const attack = json.attack_result;
    const attackBad = attack?.result === true;

    const ref1 = json.verification?.ref1;
    const confidence = ref1?.confidence != null ? Number(ref1.confidence) : 0;

    const verified =
      resultCode === 1000 && !attackBad;

    res.json({
      ...json,
      verified,
      confidence,
      faceMatchConfidence: confidence,
    });
  } catch (e) {
    console.error('[faceid/verify]', e);
    res.status(500).json({ error: e?.message || 'verify failed' });
  }
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, faceidConfigured: Boolean(FACEID_API_KEY && FACEID_API_SECRET) });
});

app.listen(PORT, () => {
  console.log(`FaceID proxy listening on http://0.0.0.0:${PORT}`);
});
