/** PayMongo checkout — consultation checkout is QR Ph only on mobile. */
export const DEFAULT_PAYMENT_METHOD = 'qrph';

export const PAYMONGO_PAYMENT_METHOD_TYPES = ['qrph'];

/** Request Notary checkout — same choices as the web notarial payment modal. */
export const NOTARIAL_PAYMENT_METHODS = [
  { key: 'gcash', label: 'GCash', description: 'Pay with GCash e-wallet' },
  { key: 'maya', label: 'Maya', description: 'Pay with Maya e-wallet' },
  { key: 'qrph', label: 'QR Ph', description: 'Pay via any QR Ph–enabled bank or e-wallet' },
];

export function normalizeNotarialPaymentMethod(method) {
  const value = String(method || '').trim().toLowerCase().replace(/[\s_-]/g, '');
  if (value === 'paymaya') return 'maya';
  return NOTARIAL_PAYMENT_METHODS.some((m) => m.key === value) ? value : DEFAULT_PAYMENT_METHOD;
}

export function getNotarialPaymentMethodLabel(method) {
  const key = normalizeNotarialPaymentMethod(method);
  return NOTARIAL_PAYMENT_METHODS.find((m) => m.key === key)?.label || 'QR Ph';
}
