'use strict';

const express = require('express');
const faceplus = require('./faceplusQueue');

function createFacePlusRouter({ checkMobileAuth }) {
  const router = express.Router();

  router.get('/health', (_req, res) => {
    res.json({ ok: true, configured: faceplus.isConfigured() });
  });

  router.post('/detect', async (req, res) => {
    if (!checkMobileAuth(req, res)) return;
    if (!faceplus.isConfigured()) {
      res.status(503).json({
        error: 'Face++ is not configured on the server. Set FACEPLUS_API_KEY and FACEPLUS_API_SECRET.',
      });
      return;
    }

    const { imageBase64, returnAttributes } = req.body || {};
    if (!imageBase64 || typeof imageBase64 !== 'string') {
      res.status(400).json({ error: 'MISSING_ARGUMENTS:imageBase64' });
      return;
    }

    try {
      const { ok, status, body } = await faceplus.detect(
        imageBase64,
        typeof returnAttributes === 'string' ? returnAttributes : '',
      );
      res.status(ok ? 200 : status >= 400 ? status : 502).json(body);
    } catch (e) {
      console.error('[faceplus/detect]', e);
      res.status(500).json({ error: e?.message || 'detect failed' });
    }
  });

  router.post('/compare', async (req, res) => {
    if (!checkMobileAuth(req, res)) return;
    if (!faceplus.isConfigured()) {
      res.status(503).json({
        error: 'Face++ is not configured on the server. Set FACEPLUS_API_KEY and FACEPLUS_API_SECRET.',
      });
      return;
    }

    const { imageBase64_1, imageBase64_2 } = req.body || {};
    if (!imageBase64_1 || !imageBase64_2) {
      res.status(400).json({ error: 'MISSING_ARGUMENTS:imageBase64_1,imageBase64_2' });
      return;
    }

    try {
      const { ok, status, body } = await faceplus.compare(imageBase64_1, imageBase64_2);
      res.status(ok ? 200 : status >= 400 ? status : 502).json(body);
    } catch (e) {
      console.error('[faceplus/compare]', e);
      res.status(500).json({ error: e?.message || 'compare failed' });
    }
  });

  return router;
}

module.exports = { createFacePlusRouter };
