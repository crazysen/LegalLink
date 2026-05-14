import React, { useState } from 'react';
import {
  Alert,
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Image,
} from 'react-native';
import { REFERENCE_THEME as T } from '../constants/referenceTheme';
import { ClientScreenShell, ClientFadeInSoft } from '../components/ClientScreenShell';

export default function BookingSummary({navigation, route}) {
  const [paymentMethod, setPaymentMethod] = useState('gcash');
  const serviceData = route?.params?.serviceData || { type: 'Power of Attorney', date: 'February 15, 2026', time: '2:00 PM', amount: '₱2,500' };
  const paymentContext = route?.params?.paymentContext || null;
  const isNotarial = paymentContext?.sourceType === 'notarial';

  const handleProceedToPayment = () => {
    if (isNotarial && !paymentContext?.sourceId) {
      Alert.alert(
        'Request not ready',
        'Your notarial request was not saved. Go back and complete face verification again.',
      );
      return;
    }
    navigation.navigate('Payment', { paymentMethod, serviceData, paymentContext });
  };

  const handleClose = () => {
    navigation.canGoBack() ? navigation.goBack() : null;
  };

  const PaymentOption = ({ id, label, source }) => (
    <TouchableOpacity 
      style={[
        styles.paymentCard, 
        paymentMethod === id && styles.paymentCardActive
      ]}
      onPress={() => setPaymentMethod(id)}
    >
      <View style={styles.paymentIconContainer}>
        <Image source={source} style={styles.paymentLogoImage} resizeMode="contain" />
      </View>
      <Text style={styles.paymentLabel}>{label}</Text>
      <View style={[
        styles.radioCircle, 
        paymentMethod === id && styles.radioCircleActive
      ]}>
        {paymentMethod === id && <View style={styles.radioInner} />}
      </View>
    </TouchableOpacity>
  );

  return (
    <ClientScreenShell>
      {/* ClientFadeInSoft: FadeIn avoids Android Text disappearing inside FadeInDown+Reanimated. */}
      <ClientFadeInSoft style={styles.fill}>
      <View style={styles.overlay}>
      <View style={styles.modalContent}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Booking Summary</Text>
          <TouchableOpacity onPress={handleClose}>
            <Text style={styles.closeIcon}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.scrollBody} showsVerticalScrollIndicator={false}>
          <View style={styles.detailsContainer}>
            <Text style={styles.sectionTitle}>
              {isNotarial ? 'Notarial request details' : 'Appointment details'}
            </Text>
            
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Attorney:</Text>
              <Text style={styles.detailValue}>Notary Public</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Service Type:</Text>
              <Text style={styles.detailValue}>{serviceData.type}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Date & Time:</Text>
              <Text style={styles.detailValue}>{serviceData.date} at {serviceData.time}</Text>
            </View>

            <View style={styles.divider} />

            <View style={styles.detailRow}>
              <Text style={styles.totalLabel}>
                {isNotarial ? 'Service fee:' : 'Consultation fee:'}
              </Text>
              <Text style={styles.feeAmount}>{serviceData.amount}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.totalLabelBold}>Total Amount:</Text>
              <Text style={styles.totalAmount}>{serviceData.amount}</Text>
            </View>
          </View>

          <Text style={styles.selectionTitle}>Select Payment Method</Text>
          
          <PaymentOption id="gcash" label="GCash" source={require('../assets/images/Gcash_logo.png')} />
          <PaymentOption id="maya" label="Maya" source={require('../assets/images/Maya_logo.png')} />
          <PaymentOption id="qrph" label="QR Ph" source={require('../assets/images/QR_Ph_Logo.png')} />

          <TouchableOpacity style={styles.proceedButton} onPress={handleProceedToPayment}>
            <Text style={styles.proceedButtonText}>Proceed to Payment</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
      </View>
      </ClientFadeInSoft>
    </ClientScreenShell>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  overlay: { flex: 1, justifyContent: 'center', padding: 16 },
  modalContent: { 
    backgroundColor: 'rgba(18, 26, 36, 0.95)', 
    borderRadius: 24, 
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.15)',
    elevation: 8,
  },
  header: { 
    backgroundColor: 'rgba(4, 7, 11, 0.6)', 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    padding: 20, 
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(244, 215, 139, 0.1)',
  },
  headerTitle: { color: T.text, fontSize: 18, fontWeight: 'bold' },
  closeIcon: { color: T.textSoft, fontSize: 18 },
  scrollBody: { padding: 20 },
  detailsContainer: { 
    backgroundColor: 'rgba(255,255,255,0.04)', 
    borderRadius: 16, 
    padding: 20, 
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.1)',
  },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: T.gold[0], marginBottom: 16 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  detailLabel: { color: T.textSoft, fontSize: 14 },
  detailValue: { color: T.text, fontSize: 14, fontWeight: '600', textAlign: 'right', flex: 1, marginLeft: 10 },
  divider: { height: 1, backgroundColor: 'rgba(244, 215, 139, 0.1)', marginVertical: 12 },
  totalLabel: { color: T.text, fontSize: 15, fontWeight: '600' },
  totalLabelBold: { color: T.text, fontSize: 16, fontWeight: 'bold' },
  feeAmount: { color: T.gold[0], fontSize: 18, fontWeight: 'bold' },
  totalAmount: { color: T.gold[1], fontSize: 20, fontWeight: 'bold' },
  selectionTitle: { fontSize: 15, fontWeight: 'bold', color: T.text, marginBottom: 16 },
  paymentCard: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    padding: 16, 
    borderRadius: 12, 
    borderWidth: 1, 
    borderColor: 'rgba(244, 215, 139, 0.15)', 
    marginBottom: 12,
    backgroundColor: 'rgba(4, 7, 11, 0.35)',
  },
  paymentCardActive: { borderColor: T.gold[1], borderWidth: 1.5 },
  paymentIconContainer: { marginRight: 16 },
  paymentLogoImage: { width: 40, height: 40, borderRadius: 8, backgroundColor: '#fff' },
  paymentLabel: { flex: 1, fontSize: 15, fontWeight: '600', color: T.text },
  radioCircle: { width: 20, height: 20, borderRadius: 10, borderWidth: 1, borderColor: T.textSoft, justifyContent: 'center', alignItems: 'center' },
  radioCircleActive: { borderColor: T.gold[1] },
  radioInner: { width: 12, height: 12, borderRadius: 6, backgroundColor: T.gold[1] },
  proceedButton: { 
    backgroundColor: T.gold[1], 
    paddingVertical: 16, 
    borderRadius: 12, 
    marginTop: 12,
    alignItems: 'center'
  },
  proceedButtonText: { color: T.base, fontSize: 16, fontWeight: 'bold' },
});

