import React from 'react';
import {View, Text, StyleSheet} from 'react-native';
import {REFERENCE_THEME as T} from '../constants/referenceTheme';
import {getConsultationTimerDisplay} from '../services/consultationSession';

/** Timer + banners for consultation status (both client and attorney). */
export function ConsultationSessionAlerts({bounds, nowMs, isClosed}) {
  if (isClosed || !bounds) {
    return null;
  }
  const timer = getConsultationTimerDisplay(nowMs, bounds);
  const {phase} = timer;

  if (phase === 'before_start') {
    return (
      <View style={[styles.alertBanner, styles.alertBannerMuted]}>
        <Text style={styles.alertTitle}>Consultation scheduled</Text>
        <Text style={styles.alertBody}>{timer.primaryLabel || 'Waiting for the scheduled start.'}</Text>
        {timer.secondaryLabel ? <Text style={styles.alertMeta}>{timer.secondaryLabel}</Text> : null}
      </View>
    );
  }

  if (phase === 'warning') {
    return (
      <View style={[styles.alertBanner, styles.alertBannerWarning]}>
        <Text style={styles.alertTitle}>10-minute warning</Text>
        <Text style={styles.alertBody}>{timer.primaryLabel}</Text>
        {timer.secondaryLabel ? <Text style={styles.alertMeta}>{timer.secondaryLabel}</Text> : null}
      </View>
    );
  }

  if (phase === 'in_session') {
    return (
      <View style={[styles.alertBanner, styles.alertBannerMuted]}>
        <Text style={styles.alertTitle}>Consultation active</Text>
        <Text style={styles.alertBody}>{timer.primaryLabel}</Text>
        {timer.secondaryLabel ? <Text style={styles.alertMeta}>{timer.secondaryLabel}</Text> : null}
      </View>
    );
  }

  if (phase === 'in_grace') {
    return (
      <View style={[styles.alertBanner, styles.alertBannerGrace]}>
        <Text style={styles.alertTitle}>Scheduled hour complete</Text>
        <Text style={styles.alertBody}>{timer.primaryLabel}</Text>
        {timer.secondaryLabel ? <Text style={styles.alertMeta}>{timer.secondaryLabel}</Text> : null}
      </View>
    );
  }

  if (phase === 'after_grace') {
    return (
      <View style={[styles.alertBanner, styles.alertBannerStrong]}>
        <Text style={styles.alertTitle}>Grace period ended</Text>
        <Text style={styles.alertBody}>{timer.primaryLabel}</Text>
        {timer.secondaryLabel ? <Text style={styles.alertMeta}>{timer.secondaryLabel}</Text> : null}
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  alertBanner: {
    backgroundColor: 'rgba(251, 191, 36, 0.10)',
    padding: 12,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(251, 191, 36, 0.28)',
  },
  alertBannerMuted: {
    backgroundColor: 'rgba(18, 26, 36, 0.92)',
    borderColor: 'rgba(244, 215, 139, 0.18)',
  },
  alertBannerWarning: {
    backgroundColor: 'rgba(245, 158, 11, 0.14)',
    borderColor: 'rgba(245, 158, 11, 0.3)',
  },
  alertBannerGrace: {
    backgroundColor: 'rgba(251, 191, 36, 0.12)',
    borderColor: 'rgba(251, 191, 36, 0.28)',
  },
  alertBannerStrong: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderColor: 'rgba(244, 114, 182, 0.35)',
  },
  alertTitle: {
    color: T.gold[0],
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 4,
  },
  alertBody: {
    color: T.textSoft,
    fontSize: 11,
    lineHeight: 16,
  },
  alertMeta: {
    color: T.textMuted,
    fontSize: 10,
    marginTop: 4,
    lineHeight: 14,
  },
});
