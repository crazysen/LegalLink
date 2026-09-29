'use strict';

/** Map app id_type → Didit OCR document_type strings (fuzzy match). */
const RULES = {
  phillid: {
    requiresBack: true,
    matches: (documentType) =>
      /phil|national\s*id|identification\s*card|philsys/i.test(documentType || ''),
  },
  passport: {
    requiresBack: true,
    matches: (documentType) => /passport/i.test(documentType || ''),
  },
  drivers_license: {
    requiresBack: true,
    matches: (documentType) => /driver|driving|licen/i.test(documentType || ''),
  },
  umid: {
    requiresBack: true,
    matches: (documentType) => /umid|unified|multi[- ]?purpose/i.test(documentType || ''),
  },
};

function getRule(idType) {
  return RULES[idType] || null;
}

function validateSelectedType(idType, documentType, status) {
  const rule = getRule(idType);
  if (!rule) {
    return { ok: false, reason: 'Unknown ID type selected.' };
  }

  const normalizedStatus = String(status || '').toLowerCase();
  if (normalizedStatus !== 'approved') {
    return {
      ok: false,
      reason: `ID could not be verified (status: ${status || 'Declined'}). Use a clear, well-lit photo with all corners visible.`,
    };
  }

  const detected = String(documentType || '').trim();
  if (!detected) {
    return {
      ok: false,
      reason: 'Could not read the document type. Retake photos with the full ID in frame.',
    };
  }

  if (!rule.matches(detected)) {
    return {
      ok: false,
      reason: `This looks like "${detected}", not the ${idType.replace(/_/g, ' ')} you selected. Choose the correct ID type or retake the photos.`,
      detectedType: detected,
    };
  }

  return { ok: true, detectedType: detected };
}

module.exports = { getRule, validateSelectedType, RULES };
