/** Live notarial service fee — same value used for bundled booking add-on and standalone requests. */
export const NOTARIAL_SERVICE_FEE = 1;

/** Prefer admin-set `notarial_requests.amount`; otherwise use the standard fee. */
export function resolveNotarialAmount(storedAmount) {
  const value = Number(storedAmount);
  return Number.isFinite(value) && value > 0 ? value : NOTARIAL_SERVICE_FEE;
}

export function formatNotarialFeePhp(amount) {
  return `PHP ${resolveNotarialAmount(amount).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
