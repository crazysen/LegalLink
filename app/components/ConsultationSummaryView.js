import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {REFERENCE_THEME as T} from '../constants/referenceTheme';
import {
  CONSULTATION_SUMMARY_SECTIONS,
  parseConsultationSummary,
} from '../services/consultationSummaryFormat';

export default function ConsultationSummaryView({summary, style}) {
  const text = String(summary || '').trim();
  if (!text) return null;

  const {sections, hasStructure, legacyText} = parseConsultationSummary(text);

  if (!hasStructure) {
    return (
      <View style={[styles.wrap, style]}>
        <Text style={styles.body}>{legacyText || text}</Text>
      </View>
    );
  }

  const filledSections = CONSULTATION_SUMMARY_SECTIONS.filter(section =>
    String(sections[section.key] || '').trim(),
  );

  if (!filledSections.length) return null;

  return (
    <View style={[styles.wrap, style]}>
      {filledSections.map(section => (
        <View key={section.key} style={styles.block}>
          <Text style={styles.header}>{section.title}</Text>
          <Text style={styles.subheader}>{section.subtitle}</Text>
          <Text style={styles.body}>{sections[section.key]}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {gap: 14},
  block: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(4, 7, 11, 0.45)',
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.15)',
  },
  header: {fontSize: 14, fontWeight: '800', color: T.gold[0]},
  subheader: {fontSize: 11, color: T.textMuted, marginTop: 2, marginBottom: 8},
  body: {fontSize: 14, color: T.text, lineHeight: 21},
});
