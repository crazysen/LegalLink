import React from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {REFERENCE_THEME as T} from '../constants/referenceTheme';
import {ClientScreenShell, ClientFadeIn} from '../components/ClientScreenShell';
import ClientChevronBack from '../components/ClientChevronBack';

export default function PaymentTranscript({navigation, route}) {
  const transactionId = route?.params?.transactionId || 'BTMS-UNKNOWN';
  const amount = route?.params?.amount || '₱0.00';
  const paymentContext = route?.params?.paymentContext || null;
  const serviceData = route?.params?.serviceData || null;

  const sourceType = paymentContext?.sourceType === 'notarial' ? 'Notarial Request' : 'Appointment';
  const sourceId = paymentContext?.sourceId || 'N/A';

  return (
    <ClientScreenShell>
      <ScrollView contentContainerStyle={styles.content}>
        <ClientFadeIn>
        <ClientChevronBack
          style={styles.backHit}
          onPress={() => (navigation.canGoBack() ? navigation.goBack() : null)}
        />

        <Text style={styles.title}>Payment Transcript</Text>
        <Text style={styles.subtitle}>Your payment is recorded and the service is now completed.</Text>

        <View style={styles.card}>
          <Row label="Status" value="Completed" />
          <Row label="Transaction ID" value={transactionId} />
          <Row label="Amount" value={amount} />
          <Row label="Service" value={serviceData?.type || sourceType} />
          <Row label="Reference Type" value={sourceType} />
          <Row label="Reference ID" value={String(sourceId)} />
        </View>

        <TouchableOpacity
          style={styles.dashboardButton}
          onPress={() => navigation.reset({index: 0, routes: [{name: 'HomepageClient'}]})}>
          <Text style={styles.dashboardText}>Back to Dashboard</Text>
        </TouchableOpacity>
        </ClientFadeIn>
      </ScrollView>
    </ClientScreenShell>
  );
}

function Row({label, value}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 20,
    paddingBottom: 32,
  },
  backHit: {
    alignSelf: 'flex-start',
    marginBottom: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: T.text,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: T.textSoft,
    marginBottom: 20,
  },
  card: {
    backgroundColor: 'rgba(18, 26, 36, 0.85)',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.12)',
    marginBottom: 18,
  },
  row: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(244, 215, 139, 0.08)',
  },
  rowLabel: {
    fontSize: 12,
    color: T.textSoft,
    marginBottom: 2,
  },
  rowValue: {
    fontSize: 15,
    color: T.text,
    fontWeight: '700',
  },
  dashboardButton: {
    backgroundColor: T.gold[1],
    borderRadius: 12,
    paddingVertical: 14,
  },
  dashboardText: {
    color: T.base,
    textAlign: 'center',
    fontWeight: '700',
    fontSize: 16,
  },
});
