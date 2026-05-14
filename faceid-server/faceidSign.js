'use strict';

const crypto = require('crypto');

/**
 * FaceID API auth (same as Megvii SDK init / REST).
 * @see https://faceid.com/faceid-open-doc/docs/sdkauth.html
 */
function createFaceIdSign(apiKey, apiSecret) {
  const currentTime = Math.floor(Date.now() / 1000);
  const expireTime = currentTime + 100;
  let rdm = '';
  for (let i = 0; i < 10; i += 1) {
    rdm += String(Math.floor(Math.random() * 10));
  }
  const raw = `a=${apiKey}&b=${expireTime}&c=${currentTime}&d=${rdm}`;
  const signTmp = crypto.createHmac('sha1', apiSecret).update(raw, 'utf8').digest();
  const sign = Buffer.concat([signTmp, Buffer.from(raw, 'utf8')]).toString('base64');
  return sign;
}

module.exports = { createFaceIdSign };
