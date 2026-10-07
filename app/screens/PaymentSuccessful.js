import React from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  } from 'react-native';
import { REFERENCE_THEME as T } from '../constants/referenceTheme';
import { ClientScreenShell, ClientFadeInSoft } from '../components/ClientScreenShell';

export default function PaymentSuccessful({navigation, route}) {
  const amount = route?.params?.amount || '₱2,500.00';
  const transactionId = route?.params?.transactionId || 'BTMS-UNKNOWN';
  const paymentContext = route?.params?.paymentContext || null;
  const paymentMethodLabel = route?.params?.paymentMethodLabel || null;
  const isStandaloneNotarial = paymentContext?.sourceType === 'notarial';
  // Determine if the user already bundled a notarial request
  const includeNotarial =
    Boolean(paymentContext?.payload?.includeNotarial) || isStandaloneNotarial;

  const handleBackToDashboard = () => {
    navigation.reset({
      index: 0,
      routes: [{name: 'HomepageClient'}],
    });
  };

  const handleGoToNotarial = () => {
    navigation.reset({
      index: 0,
      routes: [{name: 'HomepageClient'}],
    });
    // Defer navigation to avoid reset race
    setTimeout(() => {
      navigation.navigate('ClientNotarial');
    }, 100);
  };

  return (
    <ClientScreenShell>
      <ClientFadeInSoft style={styles.fill}>
      <View style={styles.overlay}>
      <View style={styles.card}>
        <View style={styles.iconCircle}>
          <Text style={styles.checkMark}>✓</Text>
        </View>

        <Text style={styles.title}>Payment Successful</Text>
        <Text style={styles.transactionId}>TRANSACTION ID: {transactionId}</Text>

        <View style={styles.completedPill}>
          <Text style={styles.completedPillText}>PAYMENT COMPLETE</Text>
        </View>

        <View style={styles.amountCard}>
          <Text style={styles.amountLabel}>AMOUNT PAID</Text>
          <Text style={styles.amountValue}>{amount}</Text>
          {paymentMethodLabel ? (
            <Text style={styles.methodText}>Paid via {paymentMethodLabel}</Text>
          ) : null}
        </View>

        <Text style={styles.infoText}>
          A digital receipt has been sent to your email and is available in your 
          <Text style={styles.boldText}> Documents vault</Text>.
        </Text>

        {/* ── Combined booking badge (shown when notarial was bundled) ── */}
        {includeNotarial ? (
          <View style={styles.notarialBadge}>
            <Text style={styles.notarialBadgeIcon}>📄</Text>
            <View style={styles.notarialBadgeTextGroup}>
              <Text style={styles.notarialBadgeTitle}>
                {isStandaloneNotarial ? 'Notarial Payment Received' : 'Notarial Request Submitted'}
              </Text>
              <Text style={styles.notarialBadgeHint}>
                {isStandaloneNotarial
                  ? 'Your notarial request is now in the notary queue. Track it under Menu → Notary Status.'
                  : 'Your notarization request has been bundled with this booking. Track it under Menu → Notary Status.'}
              </Text>
            </View>
          </View>
        ) : (
          /* ── Nudge banner for standalone booking (Directive 5) ── */
          <View style={styles.notarialNudge}>
            <Text style={styles.notarialNudgeTitle}>
              📋 Also need a document notarized?
            </Text>
            <Text style={styles.notarialNudgeHint}>
              Submit a notarial service request and have it handled by your attorney.
            </Text>
            <TouchableOpacity
              style={styles.notarialNudgeBtn}
              onPress={handleGoToNotarial}
              activeOpacity={0.85}>
              <Text style={styles.notarialNudgeBtnText}>
                Request Notary Service →
              </Text>
            </TouchableOpacity>
          </View>
        )}

        <TouchableOpacity style={styles.dashboardButton} onPress={handleBackToDashboard}>
          <Text style={styles.buttonText}>Go back to dashboard</Text>
        </TouchableOpacity>
      </View>
      </View>
      </ClientFadeInSoft>
    </ClientScreenShell>
  );
}

const styles = StyleSheet.create({
  fill: {flex: 1},
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: 'rgba(18, 26, 36, 0.95)',
    borderRadius: 32,
    padding: 32,
    width: '100%',
    alignItems: 'center',
    elevation: 8,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.2)',
    shadowColor: 'rgba(212, 175, 55, 0.45)',
    shadowOpacity: 0.25,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: T.gold[1],
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  checkMark: {
    color: T.base,
    fontSize: 40,
    fontWeight: 'bold',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: T.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  transactionId: {
    fontSize: 10,
    color: T.textSoft,
    fontWeight: 'bold',
    letterSpacing: 1.5,
    marginBottom: 12,
  },
  completedPill: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.35)',
  },
  completedPillText: {
    color: '#6EE7B7',
    fontWeight: '700',
    fontSize: 12,
  },
  amountCard: {
    backgroundColor: 'rgba(4, 7, 11, 0.5)',
    width: '100%',
    paddingVertical: 24,
    borderRadius: 20,
    alignItems: 'center',
    marginBottom: 30,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.12)',
  },
  amountLabel: {
    color: T.textSoft,
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 1,
    marginBottom: 8,
  },
  amountValue: {
    color: T.gold[0],
    fontSize: 36,
    fontWeight: 'bold',
  },
  methodText: {
    color: T.textSoft,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 6,
  },
  infoText: {
    fontSize: 14,
    color: T.textMuted,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
    paddingHorizontal: 10,
  },
  boldText: {
    fontWeight: 'bold',
    color: T.gold[0],
  },
  dashboardButton: {
    backgroundColor: T.gold[1],
    paddingVertical: 18,
    borderRadius: 16,
    width: '100%',
    shadowColor: 'rgba(212, 175, 55, 0.45)',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  buttonText: {
    color: T.base,
    textAlign: 'center',
    fontWeight: 'bold',
    fontSize: 16,
  },

  // ── Notarial nudge banner — standalone booking (Directive 5) ──────────────
  notarialNudge: {
    width: '100%',
    backgroundColor: 'rgba(244, 215, 139, 0.07)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.25)',
    padding: 18,
    marginBottom: 20,
    alignItems: 'center',
  },
  notarialNudgeTitle: {
    color: T.gold[0],
    fontWeight: '700',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 6,
  },
  notarialNudgeHint: {
    color: T.textSoft,
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 14,
  },
  notarialNudgeBtn: {
    backgroundColor: 'rgba(244, 215, 139, 0.15)',
    borderWidth: 1,
    borderColor: T.gold[0],
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  notarialNudgeBtnText: {
    color: T.gold[0],
    fontWeight: '700',
    fontSize: 13,
  },

  // ── Combined booking confirmation badge ──────────────────────────────────
  notarialBadge: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
    padding: 16,
    marginBottom: 20,
  },
  notarialBadgeIcon: { fontSize: 22 },
  notarialBadgeTextGroup: { flex: 1 },
  notarialBadgeTitle: {
    color: '#6EE7B7',
    fontWeight: '700',
    fontSize: 13,
    marginBottom: 4,
  },
  notarialBadgeHint: {
    color: T.textSoft,
    fontSize: 12,
    lineHeight: 17,
  },
});


