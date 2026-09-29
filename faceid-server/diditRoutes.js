'use strict';

const express = require('express');
const { getRule, validateSelectedType } = require('./diditDocumentTypes');
const {
  bufferFromBase64,
  appendImageField,
  assertMinImageSize,
  extractDiditError,
  diditMultipartPost,
  hasDiditApiKey,
} = require('./diditMultipart');

const DIDIT_API_BASE = (
  process.env.DIDIT_API_BASE || 'https://verification.didit.me'
).replace(/\/+$/, '');
const DIDIT_API_KEY = process.env.DIDIT_API_KEY || '';
const DIDIT_WORKFLOW_ID = process.env.DIDIT_WORKFLOW_ID || '';
const DIDIT_CALLBACK_URL =
  process.env.DIDIT_CALLBACK_URL || 'batasmoapp://didit-callback';
const FACE_MATCH_THRESHOLD = Number(process.env.DIDIT_FACE_MATCH_THRESHOLD || 70);

function isConfigured() {
  return Boolean(DIDIT_API_KEY && DIDIT_WORKFLOW_ID);
}

function isApiKeyConfigured() {
  return hasDiditApiKey();
}

async function diditFetch(path, options = {}) {
  const res = await fetch(`${DIDIT_API_BASE}${path}`, {
    ...options,
    headers: {
      'x-api-key': DIDIT_API_KEY,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 300) };
  }
  return { res, body };
}

function createDiditRouter({ checkMobileAuth }) {
  const router = express.Router();

  router.get('/health', (_req, res) => {
    res.json({
      ok: true,
      configured: isApiKeyConfigured(),
      sessionReady: isConfigured(),
      hasWorkflow: Boolean(DIDIT_WORKFLOW_ID),
    });
  });

  /** POST /didit/verify-document — front/back images + selected PH id type */
  router.post('/verify-document', async (req, res) => {
    if (!checkMobileAuth(req, res)) return;
    if (!isApiKeyConfigured()) {
      res.status(503).json({ error: 'DIDIT_API_KEY is not set on the server.' });
      return;
    }

    const { id_type: idType, front_base64: frontBase64, back_base64: backBase64 } =
      req.body || {};

    if (!idType || typeof idType !== 'string') {
      res.status(400).json({ error: 'MISSING_ARGUMENTS:id_type' });
      return;
    }
    if (!frontBase64 || typeof frontBase64 !== 'string') {
      res.status(400).json({ error: 'MISSING_ARGUMENTS:front_base64' });
      return;
    }

    const rule = getRule(idType);
    if (!rule) {
      res.status(400).json({ error: 'INVALID_ID_TYPE' });
      return;
    }
    if (rule.requiresBack && !backBase64) {
      res.status(400).json({ error: 'MISSING_ARGUMENTS:back_base64' });
      return;
    }

    try {
      const front = bufferFromBase64(frontBase64, 'id-front.jpg', 'image/jpeg');
      assertMinImageSize(front.buffer, 'Front photo');
      let back;
      if (backBase64) {
        back = bufferFromBase64(backBase64, 'id-back.jpg', 'image/jpeg');
        assertMinImageSize(back.buffer, 'Back photo');
      }

      const { res: upstream, body } = await diditMultipartPost('/v3/id-verification/', (form) => {
        appendImageField(form, 'front_image', front);
        if (back) appendImageField(form, 'back_image', back);
        form.append('perform_document_liveness', 'true');
        form.append('vendor_data', `notarial-id-${idType}-${Date.now()}`);
        return form;
      });

      if (!upstream.ok) {
        res.status(upstream.status >= 400 ? upstream.status : 502).json({
          ...body,
          error: extractDiditError(body, upstream.status),
        });
        return;
      }

      const idv = body.id_verification || {};
      const typeCheck = validateSelectedType(idType, idv.document_type, idv.status);

      res.json({
        verified: typeCheck.ok,
        reason: typeCheck.reason,
        detected_document_type: typeCheck.detectedType || idv.document_type,
        selected_id_type: idType,
        status: idv.status,
        full_name: idv.full_name,
        document_number: idv.document_number,
        raw: body,
      });
    } catch (e) {
      console.error('[didit/verify-document]', e);
      const status = e?.code === 'IMAGE_TOO_SMALL' ? 400 : 500;
      res.status(status).json({ error: e?.message || 'verify-document failed' });
    }
  });

  /** POST /didit/verify-face — selfie vs ID front (liveness + face match) */
  router.post('/verify-face', async (req, res) => {
    if (!checkMobileAuth(req, res)) return;
    if (!isApiKeyConfigured()) {
      res.status(503).json({ error: 'DIDIT_API_KEY is not set on the server.' });
      return;
    }

    const { selfie_base64: selfieBase64, id_front_base64: idFrontBase64 } = req.body || {};
    if (!selfieBase64 || !idFrontBase64) {
      res.status(400).json({ error: 'MISSING_ARGUMENTS:selfie_base64,id_front_base64' });
      return;
    }

    try {
      const selfieBuf = bufferFromBase64(selfieBase64, 'selfie.jpg', 'image/jpeg');
      const idFrontBuf = bufferFromBase64(idFrontBase64, 'id-front.jpg', 'image/jpeg');
      assertMinImageSize(selfieBuf.buffer, 'Selfie');
      assertMinImageSize(idFrontBuf.buffer, 'ID front photo');

      const { res: liveRes, body: liveBody } = await diditMultipartPost(
        '/v3/passive-liveness/',
        (form) => {
          appendImageField(form, 'user_image', selfieBuf);
          form.append('vendor_data', `notarial-live-${Date.now()}`);
          return form;
        },
      );

      if (!liveRes.ok) {
        res.status(liveRes.status >= 400 ? liveRes.status : 502).json({
          ...liveBody,
          error: extractDiditError(liveBody, liveRes.status),
        });
        return;
      }

      const liveness = liveBody.liveness || {};
      if (String(liveness.status || '').toLowerCase() !== 'approved') {
        res.json({
          verified: false,
          confidence: Number(liveness.score ?? 0),
          reason: 'Liveness check failed. Use your live face in good lighting.',
          liveness_status: liveness.status,
        });
        return;
      }

      const { res: matchRes, body: matchBody } = await diditMultipartPost(
        '/v3/face-match/',
        (form) => {
          appendImageField(form, 'user_image', selfieBuf);
          appendImageField(form, 'ref_image', idFrontBuf);
          form.append('face_match_score_decline_threshold', String(FACE_MATCH_THRESHOLD));
          form.append('vendor_data', `notarial-match-${Date.now()}`);
          return form;
        },
      );

      if (!matchRes.ok) {
        res.status(matchRes.status >= 400 ? matchRes.status : 502).json({
          ...matchBody,
          error: extractDiditError(matchBody, matchRes.status),
        });
        return;
      }

      const faceMatch = matchBody.face_match || {};
      const score = Number(faceMatch.score ?? 0);
      const approved = String(faceMatch.status || '').toLowerCase() === 'approved';

      res.json({
        verified: approved,
        confidence: score,
        reason: approved
          ? undefined
          : `Face does not match your ID (${score}% similarity). Try again with better lighting.`,
        liveness_status: liveness.status,
        face_match_status: faceMatch.status,
        raw: { liveness: liveBody, face_match: matchBody },
      });
    } catch (e) {
      console.error('[didit/verify-face]', e);
      const status = e?.code === 'IMAGE_TOO_SMALL' ? 400 : 500;
      res.status(status).json({ error: e?.message || 'verify-face failed' });
    }
  });

  router.post('/session', async (req, res) => {
    if (!checkMobileAuth(req, res)) return;
    if (!isConfigured()) {
      res.status(503).json({
        error:
          'Didit is not configured. Set DIDIT_API_KEY and DIDIT_WORKFLOW_ID in faceid-server/.env',
      });
      return;
    }

    const { vendor_data: vendorData } = req.body || {};
    const vendor =
      typeof vendorData === 'string' && vendorData.trim()
        ? vendorData.trim().slice(0, 128)
        : `notarial-${Date.now()}`;

    try {
      const { res: upstream, body } = await diditFetch('/v3/session/', {
        method: 'POST',
        body: JSON.stringify({
          workflow_id: DIDIT_WORKFLOW_ID,
          vendor_data: vendor,
          callback: DIDIT_CALLBACK_URL,
          callback_method: 'both',
        }),
      });

      if (!upstream.ok) {
        res.status(upstream.status >= 400 ? upstream.status : 502).json(body);
        return;
      }

      res.json({
        session_id: body.session_id,
        session_token: body.session_token,
        url: body.verification_url || body.url,
        status: body.status,
        callback_url: DIDIT_CALLBACK_URL,
      });
    } catch (e) {
      console.error('[didit/session]', e);
      res.status(500).json({ error: e?.message || 'create session failed' });
    }
  });

  router.get('/session/:sessionId', async (req, res) => {
    if (!checkMobileAuth(req, res)) return;
    if (!DIDIT_API_KEY) {
      res.status(503).json({ error: 'DIDIT_API_KEY is not set.' });
      return;
    }

    const sessionId = req.params.sessionId;
    if (!sessionId) {
      res.status(400).json({ error: 'MISSING_ARGUMENTS:sessionId' });
      return;
    }

    try {
      const { res: upstream, body } = await diditFetch(
        `/v3/session/${encodeURIComponent(sessionId)}/decision/`,
        { method: 'GET' },
      );

      if (!upstream.ok) {
        res.status(upstream.status >= 400 ? upstream.status : 502).json(body);
        return;
      }

      const status = String(
        body.status ||
          body.decision?.status ||
          body.final_status ||
          body.decision ||
          '',
      ).trim();
      const approved =
        status.toLowerCase() === 'approved' ||
        body.decision?.status?.toLowerCase() === 'approved' ||
        body.final_status?.toLowerCase() === 'approved';

      const idv =
        body.decision?.id_verifications?.[0] ||
        body.id_verifications?.[0] ||
        body.id_verification ||
        (Array.isArray(body.id_verifications) ? body.id_verifications[0] : null);

      res.json({
        session_id: body.session_id || sessionId,
        status,
        approved,
        verified: approved,
        full_name: idv?.full_name,
        raw: body,
      });
    } catch (e) {
      console.error('[didit/session/:id]', e);
      res.status(500).json({ error: e?.message || 'get session failed' });
    }
  });

  return router;
}

module.exports = { createDiditRouter, isConfigured, isApiKeyConfigured };
