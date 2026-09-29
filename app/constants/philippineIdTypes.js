/** Government ID options for notarial identity verification (Philippines). */
export const PHILIPPINE_ID_TYPES = [
  {
    id: 'phillid',
    label: 'PhillID / ePhillID',
    shortLabel: 'PhillID',
    description: 'Philippine national ID (PhilSys).',
    requiresBack: true,
  },
  {
    id: 'passport',
    label: 'Philippines Passport',
    shortLabel: 'Passport',
    description: 'Philippine passport — data page (front), then back cover if available.',
    requiresBack: true,
  },
  {
    id: 'drivers_license',
    label: "Driver's License",
    shortLabel: 'Driver\'s License',
    description: 'LTO driver\'s license.',
    requiresBack: true,
  },
  {
    id: 'umid',
    label: 'UMID',
    shortLabel: 'UMID',
    description: 'Unified Multi-Purpose ID.',
    requiresBack: true,
  },
];

export function getPhilippineIdType(id) {
  return PHILIPPINE_ID_TYPES.find((t) => t.id === id) || null;
}
