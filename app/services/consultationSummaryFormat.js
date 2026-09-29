/** Structured attorney session summary — serialized as `[Section title]\nbody` blocks. */

export const CONSULTATION_SUMMARY_SECTIONS = [
  {
    key: 'topics',
    title: 'Topics discussed',
    subtitle: 'Main concerns and issues covered during the consultation',
    placeholder: 'e.g. Title transfer timeline, missing documents on the title...',
  },
  {
    key: 'advice',
    title: 'Legal advice & recommendations',
    subtitle: 'Guidance and options you explained to the client',
    placeholder: 'e.g. Recommended filing with RD, possible remedies...',
  },
  {
    key: 'nextSteps',
    title: 'Next steps',
    subtitle: 'Actions the client should take after this session',
    placeholder: 'e.g. Secure certified true copy of title within 2 weeks...',
  },
  {
    key: 'documents',
    title: 'Documents to prepare',
    subtitle: 'Paperwork, IDs, or evidence the client should gather',
    placeholder: 'e.g. TCT, tax declarations, valid government ID...',
  },
];

const titleToKey = new Map(
  CONSULTATION_SUMMARY_SECTIONS.map((section) => [section.title.toLowerCase(), section.key]),
);

const emptySections = () =>
  Object.fromEntries(CONSULTATION_SUMMARY_SECTIONS.map((section) => [section.key, '']));

export function serializeConsultationSummary(sections) {
  return CONSULTATION_SUMMARY_SECTIONS.map((section) => {
    const body = String(sections?.[section.key] || '').trim();
    if (!body) return '';
    return `[${section.title}]\n${body}`;
  })
    .filter(Boolean)
    .join('\n\n');
}

export function parseConsultationSummary(raw) {
  const text = String(raw || '').trim();
  if (!text) {
    return { sections: emptySections(), hasStructure: false, legacyText: '' };
  }

  const sections = emptySections();
  let hasStructure = false;
  const pattern = /\[([^\]]+)\]\s*\n([\s\S]*?)(?=\n\[|$)/g;
  let match = pattern.exec(text);

  while (match) {
    const key = titleToKey.get(match[1].trim().toLowerCase());
    if (key) {
      sections[key] = match[2].trim();
      hasStructure = true;
    }
    match = pattern.exec(text);
  }

  if (!hasStructure) {
    return { sections: { ...emptySections(), topics: text }, hasStructure: false, legacyText: text };
  }

  return { sections, hasStructure: true, legacyText: '' };
}

export function consultationSummaryHasContent(sections) {
  return CONSULTATION_SUMMARY_SECTIONS.some((section) =>
    String(sections?.[section.key] || '').trim(),
  );
}
