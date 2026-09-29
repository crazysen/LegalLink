import React, { useState, useEffect } from 'react';
import { warmPaymentBackend } from '../services/paymentApiClient';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Image,
} from 'react-native';
import { REFERENCE_THEME as T } from '../constants/referenceTheme';
import { DEFAULT_PAYMENT_METHOD } from '../constants/paymentConfig';
import { ClientScreenShell, ClientFadeIn } from '../components/ClientScreenShell';
import ClientChevronBack from '../components/ClientChevronBack';

export default function PaymentMethod({navigation, route}) {
  const [selectedMethod, setSelectedMethod] = useState(DEFAULT_PAYMENT_METHOD);
  const serviceData = route?.params?.serviceData || { type: 'Consultation', amount: '₱2,500' };
  const paymentContext = route?.params?.paymentContext || null;

  useEffect(() => {
    warmPaymentBackend().catch(() => {});
  }, []);

  const paymentMethods = [
    {
      id: DEFAULT_PAYMENT_METHOD,
      name: 'QR Ph',
      icon: require('../assets/images/QR_Ph_Logo.png'),
      description: 'Scan QR Ph to pay',
    },
  ];

  const handleContinue = () => {
    if (selectedMethod) {
      navigation.navigate('Payment', {
        paymentMethod: selectedMethod,
        serviceData,
        paymentContext,
      });
    }
  };

  const handleCancel = () => {
    navigation.canGoBack() ? navigation.goBack() : null;
  };

  return (
    <ClientScreenShell>
      <ScrollView contentContainerStyle={styles.scrollPad}>
        <ClientFadeIn>
        <View style={styles.header}>
          <ClientChevronBack style={styles.backHit} onPress={handleCancel} />
          <Text style={styles.headerTitle}>Choose Payment Method</Text>
          <Text style={styles.headerSubtitle}>Pay with QR Ph</Text>
        </View>

        <View style={styles.amountBox}>
          <Text style={styles.amountLabel}>Total Amount</Text>
          <Text style={styles.amountValue}>{serviceData.amount}</Text>
        </View>
        </ClientFadeIn>

        <View style={styles.methodsContainer}>
          {paymentMethods.map((method, index) => (
            <ClientFadeIn key={method.id} delay={100 + index * 50}>
            <TouchableOpacity
              style={[
                styles.methodCard,
                selectedMethod === method.id && styles.methodCardSelected,
              ]}
              onPress={() => setSelectedMethod(method.id)}
            >
              <View style={styles.methodContent}>
                <Image source={method.icon} style={styles.methodIconImage} resizeMode="contain" />
                <View style={styles.methodInfo}>
                  <Text style={styles.methodName}>{method.name}</Text>
                  <Text style={styles.methodDescription}>{method.description}</Text>
                </View>
              </View>
              <View
                style={[
                  styles.radioButton,
                  selectedMethod === method.id && styles.radioButtonSelected,
                ]}
              >
                {selectedMethod === method.id && <Text style={styles.radioCheck}>✓</Text>}
              </View>
            </TouchableOpacity>
            </ClientFadeIn>
          ))}
        </View>

        <ClientFadeIn delay={200}>
        <View style={styles.bottomSection}>
          <TouchableOpacity
            style={[styles.continueButton, !selectedMethod && styles.continueButtonDisabled]}
            onPress={handleContinue}
            disabled={!selectedMethod}
          >
            <Text style={styles.continueButtonText}>Continue to Payment</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.cancelButton} onPress={handleCancel}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
        </ClientFadeIn>
      </ScrollView>
    </ClientScreenShell>
  );
}

const styles = StyleSheet.create({
  scrollPad: { paddingBottom: 36 },
  header: {
    padding: 20,
    paddingTop: 10,
  },
  backHit: {
    marginBottom: 10,
    alignSelf: 'flex-start',
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: T.text,
    marginBottom: 8,
  },
  headerSubtitle: {
    fontSize: 14,
    color: T.textSoft,
  },
  amountBox: {
    marginHorizontal: 20,
    marginBottom: 30,
    backgroundColor: 'rgba(18, 26, 36, 0.9)',
    padding: 20,
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.2)',
  },
  amountLabel: {
    color: T.textSoft,
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  amountValue: {
    color: T.gold[0],
    fontSize: 32,
    fontWeight: 'bold',
    marginTop: 8,
  },
  methodsContainer: {
    paddingHorizontal: 20,
    marginBottom: 30,
  },
  methodCard: {
    flexDirection: 'row',
    backgroundColor: 'rgba(18, 26, 36, 0.85)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: 'rgba(244, 215, 139, 0.12)',
    alignItems: 'center',
  },
  methodCardSelected: {
    borderColor: T.gold[1],
    backgroundColor: 'rgba(244, 215, 139, 0.08)',
  },
  methodContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  methodIconImage: {
    width: 40,
    height: 40,
    marginRight: 16,
    borderRadius: 8,
    backgroundColor: '#fff', // for transparent logos
  },
  methodInfo: {
    flex: 1,
  },
  methodName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: T.text,
    marginBottom: 4,
  },
  methodDescription: {
    fontSize: 12,
    color: T.textSoft,
  },
  radioButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'rgba(244, 215, 139, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioButtonSelected: {
    backgroundColor: T.gold[1],
    borderColor: T.gold[1],
  },
  radioCheck: {
    color: T.base,
    fontWeight: 'bold',
    fontSize: 14,
  },
  bottomSection: {
    paddingHorizontal: 20,
    paddingBottom: 30,
  },
  continueButton: {
    backgroundColor: T.gold[1],
    paddingVertical: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  continueButtonDisabled: {
    backgroundColor: 'rgba(148, 163, 184, 0.4)',
  },
  continueButtonText: {
    color: T.base,
    textAlign: 'center',
    fontWeight: 'bold',
    fontSize: 16,
  },
  cancelButton: {
    paddingVertical: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.2)',
  },
  cancelText: {
    color: T.textSoft,
    textAlign: 'center',
    fontWeight: '600',
  },
});
