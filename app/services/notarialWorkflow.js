import {REFERENCE_THEME as T} from '../constants/referenceTheme';

/** Matches web ClientNotaryTracking — admin pickup marker in notes/details. */
export const NOTARIAL_CLAIMED_MARKER = '[CLIENT_CLAIMED]';

export const NOTARIAL_FILTERS = ['All', 'Active', 'Ready for Pickup', 'Completed'];

export const NOTARIAL_WORKFLOW_STEPS = [
  {key: 'submitted', label: 'Submitted'},
  {key: 'payment', label: 'Payment'},
  {key: 'processing', label: 'In Process'},
  {key: 'pickup', label: 'Ready for Pickup'},
  {key: 'done', label: 'Completed'},
];

function requestNotes(req) {
  return String(req?.notes || req?.details || '');
}

function isPaid(req) {
  return String(req?.payment || '').toUpperCase() === 'PAID' || req?.payment_is_paid === true;
}

/** fetchClientNotarialRequests normalizes approved/accepted/paid to ACCEPTED. */
function isApproved(status) {
  return status === 'APPROVED' || status === 'ACCEPTED' || status === 'IN PROCESS';
}

/**
 * @param {object} req — row from fetchClientNotarialRequests
 * @param {{ isMobile?: boolean }} options — on mobile, unpaid shows pay CTA instead of "use mobile app"
 */
export function buildNotarialWorkflow(req, options = {}) {
  const isMobile = Boolean(options?.isMobile);
  const paid = isPaid(req);
  const pickedUp = requestNotes(req).includes(NOTARIAL_CLAIMED_MARKER);
  const status = String(req?.status || 'PENDING').toUpperCase();

  if (status === 'REJECTED' || status === 'CANCELLED') {
    return {
      phase: 'rejected',
      label: 'Declined',
      tone: 'danger',
      summary: 'This request was declined or cancelled. Contact support if you need help.',
      stepIndex: 0,
      needsPayment: false,
    };
  }

  if (!paid) {
    // Web parity: the file is saved first and payment opens right away (no approval gate).
    return {
      phase: isMobile ? 'payment' : 'mobile',
      label: isMobile ? 'Payment pending' : 'Continue on mobile',
      tone: 'warn',
      summary: isMobile
        ? 'Your file is saved. Complete payment to move your request into the notarization queue.'
        : 'Finish payment in the LegalLink mobile app.',
      stepIndex: 0,
      needsPayment: isMobile,
    };
  }

  if (status === 'COMPLETED' && pickedUp) {
    return {
      phase: 'done',
      label: 'Completed',
      tone: 'success',
      summary: 'You have picked up your notarized document. Thank you for using LegalLink.',
      stepIndex: 4,
      needsPayment: false,
    };
  }

  if (status === 'COMPLETED') {
    return {
      phase: 'pickup',
      label: 'Ready for Pickup',
      tone: 'success',
      summary: 'Your document is ready. Visit the office to collect your notarized papers.',
      stepIndex: 3,
      needsPayment: false,
    };
  }

  if (isApproved(status)) {
    return {
      phase: 'processing',
      label: 'In Process',
      tone: 'info',
      summary: 'Our team is preparing your notarized document.',
      stepIndex: 2,
      needsPayment: false,
    };
  }

  return {
    phase: 'queued',
    label: 'Payment received',
    tone: 'info',
    summary:
      'Payment confirmed. Your request is in the admin queue and will be processed soon.',
    stepIndex: 1,
    needsPayment: false,
  };
}

export function matchesNotarialFilter(req, filter, options = {}) {
  const flow = buildNotarialWorkflow(req, options);
  if (filter === 'All') return true;
  if (filter === 'Active') {
    return !['done', 'rejected'].includes(flow.phase);
  }
  if (filter === 'Ready for Pickup') return flow.phase === 'pickup';
  if (filter === 'Completed') return flow.phase === 'done';
  return true;
}

export function computeNotarialStats(requests, options = {}) {
  let active = 0;
  let pickup = 0;
  let done = 0;
  (requests || []).forEach(req => {
    const flow = buildNotarialWorkflow(req, options);
    if (flow.phase === 'pickup') pickup += 1;
    else if (flow.phase === 'done') done += 1;
    else if (flow.phase !== 'rejected') active += 1;
  });
  return {active, pickup, done, total: (requests || []).length};
}

export function notarialToneColors(tone) {
  switch (tone) {
    case 'success':
      return {badgeBg: 'rgba(16, 185, 129, 0.2)', badgeText: '#6EE7B7', border: '#22c55e'};
    case 'danger':
      return {badgeBg: 'rgba(239, 68, 68, 0.2)', badgeText: '#FCA5A5', border: '#ef4444'};
    case 'warn':
      return {badgeBg: 'rgba(251, 191, 36, 0.2)', badgeText: T.gold[0], border: '#f59e0b'};
    case 'info':
    default:
      return {badgeBg: 'rgba(59, 130, 246, 0.18)', badgeText: '#93C5FD', border: '#3b82f6'};
  }
}
