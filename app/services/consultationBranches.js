/** Practice-area branches — attorney selects after consultation (Allen/Alston, Jeanne, etc.). */

export const REAL_ESTATE_CONSULTATION_BRANCHES = [
  'Land Title Issues',
  'Transfer of Title',
  'Land Registration',
  'Deed of Sale',
  'Property Disputes',
  'Boundary Disputes',
  'Partition of Property',
  'Lease/Rental Concerns',
  'Mortgage Concerns',
  'Ejectment / Eviction',
  'Condominium Concerns',
  'Real Property Tax Issues',
  'Inheritance of Property',
  'Adverse Claim / Encumbrances',
  'Foreclosure Issues',
];

export const FAMILY_LAW_CONSULTATION_BRANCHES = [
  'Annulment',
  'Declaration of Nullity of Marriage',
  'Legal Separation',
  'Child Custody',
  'Child Support',
  'Adoption',
  'Domestic Violence / VAWC',
  'Property Relations of Spouses',
  'Guardianship',
  'Visitation Rights',
  'Paternity / Filiation',
  'Probate and Settlement of Estate',
  'Prenuptial Agreements',
  'Recognition of Foreign Divorce',
];

const normalizeText = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

const attorneyHaystack = (attorney) => {
  const chunks = [
    attorney?.name,
    attorney?.specialty,
    ...(Array.isArray(attorney?.specialties) ? attorney.specialties : []),
    ...(Array.isArray(attorney?.practiceAreas) ? attorney.practiceAreas : []),
  ];
  return chunks.map(normalizeText).filter(Boolean).join(' | ');
};

const nameMatches = (name, patterns) => {
  const n = normalizeText(name);
  return patterns.some((pattern) => pattern.test(n));
};

/** Parse branch label from appointment title (`Consultation - ...`). */
export function parseConsultationBranchFromTitle(title) {
  const raw = String(title || '').trim();
  const prefix = /^consultation\s*[-–:]\s*/i;
  if (!prefix.test(raw)) return '';
  return raw.replace(prefix, '').trim();
}

/**
 * Returns dropdown options for the logged-in attorney, or [] if no mapped list applies.
 */
export function getConsultationBranchesForAttorney(attorney) {
  if (!attorney) return [];

  const hay = attorneyHaystack(attorney);
  const name = attorney?.name || '';

  if (
    nameMatches(name, [/\bjeanne\b/]) ||
    hay.includes('family law')
  ) {
    return FAMILY_LAW_CONSULTATION_BRANCHES;
  }

  if (
    nameMatches(name, [/\ballen\b/, /\balston\b/, /\bkevin\b/]) ||
    hay.includes('real estate') ||
    hay.includes('land registration')
  ) {
    return REAL_ESTATE_CONSULTATION_BRANCHES;
  }

  return [];
}
