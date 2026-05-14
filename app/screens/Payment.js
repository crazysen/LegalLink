import React, { useState, useRef } from 'react';
import {
  Alert,
  ActivityIndicator,
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Image,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { REFERENCE_THEME as T } from '../constants/referenceTheme';
import { ClientScreenShell, ClientFadeInSoft } from '../components/ClientScreenShell';
import ClientChevronBack from '../components/ClientChevronBack';
import {
  getCurrentSessionProfile,
  createAppointmentBooking,
  notifyAttorneyOfPaidBooking,
  abandonAppointmentCheckout,
  cancelPendingUnpaidBooking,
  payForAppointment,
  getAppointmentPaymentStatus,
  payForNotarialSession,
  getNotarialPaymentStatus,
  payForNotarialRequest,
  fetchAppointmentPaymentDetails,
  fetchNotarialPaymentDetails,
} from '../services/userApi';

const PAYMONGO_METHOD_TYPES = ['gcash', 'paymaya', 'qrph'];

function toPayApiMethod(m) {
  const v = String(m || '').trim().toLowerCase();
  if (v === 'maya' || v === 'paymaya') return 'paymaya';
  if (v === 'qrph' || v === 'qr ph' || v === 'qr_ph') return 'qrph';
  return 'gcash';
}

export default function Payment({navigation, route}) {
  const [pin, setPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const paymentMethod = route?.params?.paymentMethod || 'gcash';
  const serviceData = route?.params?.serviceData || { amount: '₱2,500' };
  const paymentContext = route?.params?.paymentContext || null;
  // Notarial requests now go through Paymongo checkout (same as appointments)
  const isPaymongoFlow =
    paymentContext?.sourceType === 'appointment' ||
    paymentContext?.sourceType === 'appointment_booking' ||
    paymentContext?.sourceType === 'notarial';
  const paymentOnceRef = useRef(false);
  const appointmentIdRef = useRef(
    paymentContext?.sourceType === 'appointment' ? paymentContext.sourceId : null,
  );
  const appointmentCreatedRef = useRef(false);
  const bookingPromiseRef = useRef(null);
  const transactionIdRef = useRef(null);
  const clientIdRef = useRef(null);
  const [checkoutSession, setCheckoutSession] = useState(null);
  const [isOpening, setIsOpening] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState('idle');

  const getPaymentMethodLabel = () => {
    const methods = {
      gcash: 'GCash',
      maya: 'Maya',
      paymaya: 'Maya',
      qrph: 'QR Ph',
      paypal: 'PayPal',
      card: 'Credit/Debit Card',
      banktransfer: 'Bank Transfer',
    };
    return methods[String(paymentMethod).toLowerCase()] || 'Payment';
  };

  const getMethodIcon = () => {
    const normalizedMethod = String(paymentMethod).toLowerCase();
    if (normalizedMethod === 'gcash') return '📱';
    if (normalizedMethod === 'maya' || normalizedMethod === 'paymaya') return '💜';
    if (normalizedMethod === 'qrph') return '🔳';
    if (normalizedMethod === 'paypal') return '🏦';
    if (normalizedMethod === 'card') return '💳';
    return '🏧';
  };

  const getMethodLogo = () => {
    const normalizedMethod = String(paymentMethod).toLowerCase();
    if (normalizedMethod === 'gcash') return require('../assets/images/Gcash_logo.png');
    if (normalizedMethod === 'maya' || normalizedMethod === 'paymaya') return require('../assets/images/Maya_logo.png');
    if (normalizedMethod === 'qrph') return require('../assets/images/QR_Ph_Logo.png');
    return null;
  };



  const ensureAppointmentBooking = async () => {
    if (appointmentIdRef.current) {
      return {
        appointmentId: appointmentIdRef.current,
        attorneyId: paymentContext?.attorneyId ?? null,
        amount: paymentContext?.amount ?? null,
      };
    }

    if (paymentContext?.sourceType !== 'appointment_booking') {
      throw new Error('Missing appointment reference.');
    }

    if (bookingPromiseRef.current) {
      return bookingPromiseRef.current;
    }

    bookingPromiseRef.current = (async () => {
      const { profile } = await getCurrentSessionProfile();
      const clientId = profile?.id;
      if (!clientId) {
        throw new Error('You must be signed in to complete payment.');
      }
      clientIdRef.current = clientId;

      const payload = paymentContext.payload || {};
      if (!payload.attorney_id || !payload.slot_id) {
        throw new Error('Missing booking details. Please go back and try again.');
      }

      const bookingResult = await createAppointmentBooking({
        clientId,
        attorneyId: payload.attorney_id,
        slotId: payload.slot_id,
        title: payload.title,
        notes: payload.notes,
        amount: payload.amount,
        payload,
      });

      const appointmentId = bookingResult?.appointmentId || null;
      if (!appointmentId) {
        throw new Error('Appointment was created but could not be referenced.');
      }

      appointmentIdRef.current = appointmentId;
      appointmentCreatedRef.current = true;

      return {
        appointmentId,
        attorneyId: payload.attorney_id,
        amount: Number(payload.amount || 0),
      };
    })();

    try {
      return await bookingPromiseRef.current;
    } finally {
      bookingPromiseRef.current = null;
    }
  };

  const cleanupPendingAppointment = async () => {
    if (!appointmentCreatedRef.current) return;
    const appointmentId = appointmentIdRef.current;
    if (!appointmentId) return;

    let clientId = clientIdRef.current;
    if (!clientId) {
      try {
        const { profile } = await getCurrentSessionProfile();
        clientId = profile?.id || null;
        clientIdRef.current = clientId;
      } catch {
        clientId = null;
      }
    }

    try {
      if (clientId) {
        await abandonAppointmentCheckout({
          appointmentId,
          clientId,
          transactionId: transactionIdRef.current || undefined,
        });
      } else {
        await cancelPendingUnpaidBooking({ appointmentId });
      }
    } catch (error) {
      try {
        await cancelPendingUnpaidBooking({ appointmentId });
      } catch (fallbackError) {
        console.warn('[payment] cleanup failed', fallbackError?.message || fallbackError);
      }
    }
  };

  const completePaidService = async () => {
    if (!paymentContext?.sourceType) {
      return { transactionId: null };
    }

    if (paymentContext.sourceType === 'appointment_booking') {
      const error = new Error('PayMongo checkout is required for appointment payments.');
      error.code = 'PAYMONGO_REQUIRED';
      throw error;
    }

    const { profile } = await getCurrentSessionProfile();
    const clientId = profile?.id;
    if (!clientId) {
      throw new Error('You must be signed in to complete payment.');
    }

    if (!paymentContext?.sourceId) {
      throw new Error('Missing booking reference.');
    }

    if (paymentContext.sourceType === 'appointment') {
      const error = new Error('PayMongo checkout is required for appointment payments.');
      error.code = 'PAYMONGO_REQUIRED';
      throw error;
    }

    if (paymentContext.sourceType === 'notarial') {
      let attorneyId = paymentContext.attorneyId ?? null;
      let amount = paymentContext.amount ?? null;
      if (amount == null) {
        const row = await fetchNotarialPaymentDetails(paymentContext.sourceId);
        if (attorneyId == null) attorneyId = row.attorneyId ?? null;
        if (amount == null) amount = row.amount;
      }
      // Attorney may not be assigned yet — admin will assign after reviewing the request.
      return payForNotarialRequest({
        requestId: paymentContext.sourceId,
        clientId,
        attorneyId,   // null is OK
        amount: Number(amount || 0),
        method: toPayApiMethod(paymentMethod),
      });
    }

    return { transactionId: null };
  };

  const buildPaymongoSession = async () => {
    const { profile } = await getCurrentSessionProfile();
    const clientId = profile?.id;
    if (!clientId) {
      throw new Error('You must be signed in to complete payment.');
    }
    clientIdRef.current = clientId;

    // ── Notarial flow ──────────────────────────────────────────────────────
    if (paymentContext?.sourceType === 'notarial') {
      if (!paymentContext?.sourceId) {
        throw new Error('Missing notarial request reference.');
      }
      let amount = paymentContext?.amount ?? null;
      if (amount == null) {
        const row = await fetchNotarialPaymentDetails(paymentContext.sourceId);
        amount = row.amount;
      }
      const session = await payForNotarialSession({
        notarialRequestId: paymentContext.sourceId,
        clientId,
        amount: Number(amount || 0),
        method: toPayApiMethod(paymentMethod),
        methodTypes: PAYMONGO_METHOD_TYPES,
      });
      setCheckoutSession(session);
      transactionIdRef.current = session.transactionId || null;
      return session;
    }

    // ── Appointment / appointment_booking flow ─────────────────────────────
    let appointmentId = paymentContext?.sourceId || null;
    let attorneyId = paymentContext?.attorneyId ?? null;
    let amount = paymentContext?.amount ?? null;

    if (paymentContext?.sourceType === 'appointment_booking') {
      const booking = await ensureAppointmentBooking();
      appointmentId = booking.appointmentId;
      attorneyId = booking.attorneyId ?? attorneyId;
      amount = booking.amount ?? amount;
    }

    if (!appointmentId) {
      throw new Error('Missing booking reference.');
    }

    appointmentIdRef.current = appointmentId;

    if (attorneyId == null || amount == null) {
      const row = await fetchAppointmentPaymentDetails(appointmentId);
      if (attorneyId == null) attorneyId = row.attorneyId;
      if (amount == null) amount = row.amount;
    }

    const session = await payForAppointment({
      appointmentId,
      clientId,
      attorneyId,
      amount: Number(amount || 0),
      method: toPayApiMethod(paymentMethod),
      methodTypes: PAYMONGO_METHOD_TYPES,
    });

    setCheckoutSession(session);
    transactionIdRef.current = session.transactionId || null;
    return session;
  };

  const openPaymongoCheckout = async () => {
    if (isOpening || isPolling) return;
    try {
      setIsOpening(true);
      setPaymentStatus('pending');

      const session = checkoutSession || await buildPaymongoSession();
      if (!session?.checkoutUrl) {
        throw new Error('Checkout URL is missing. Please try again.');
      }

      await WebBrowser.openBrowserAsync(session.checkoutUrl);
    } catch (error) {
      setPaymentStatus('failed');
      await cleanupPendingAppointment();
      Alert.alert('Payment Failed', error?.message ?? 'Unable to open payment checkout.');
    } finally {
      setIsOpening(false);
    }
  };

  const pollPaymentStatus = async () => {
    if (isPolling) return;
    try {
      setIsPolling(true);
      setPaymentStatus('pending');

      const session = checkoutSession || await buildPaymongoSession();
      if (!session?.transactionId) {
        throw new Error('Missing transaction reference.');
      }

      const startedAt = Date.now();
      const timeoutMs = 5 * 60 * 1000;
      let paid = false;
      let pollDelayMs = 2500;
      const isNotarial = paymentContext?.sourceType === 'notarial';

      while (Date.now() - startedAt < timeoutMs) {
        await new Promise(resolve => setTimeout(resolve, pollDelayMs));

        const statusResult = isNotarial
          ? await getNotarialPaymentStatus(session.transactionId)
          : await getAppointmentPaymentStatus(session.transactionId);
        const status = String(statusResult?.status || 'pending').toLowerCase();

        if (status === 'paid') {
          paid = true;
          break;
        }
        if (status === 'failed') {
          if (!isNotarial) await cleanupPendingAppointment();
          throw new Error('Payment failed. Please try again.');
        }
        pollDelayMs = Math.min(6000, pollDelayMs + 500);
      }

      if (!paid) {
        throw new Error('Payment is still pending. Complete checkout, then try again.');
      }

      // Notify attorney only for appointment flows
      if (!isNotarial) {
        try {
          const appointmentId = appointmentIdRef.current || paymentContext?.sourceId || null;
          await notifyAttorneyOfPaidBooking({ appointmentId });
        } catch (notifyError) {
          console.warn('[payment] notify attorney failed', notifyError?.message || notifyError);
        }
      }

      setPaymentStatus('paid');
      navigation.replace('PaymentSuccessful', {
        amount: serviceData.amount,
        transactionId: session.transactionId,
        paymentContext,
        serviceData,
      });
    } catch (error) {
      setPaymentStatus('failed');
      Alert.alert('Payment Failed', error?.message ?? 'Unable to confirm payment. Please try again.');
    } finally {
      setIsPolling(false);
    }
  };

  const handlePayNow = async () => {
    if (isPaymongoFlow) {
      return;
    }
    if (pin.length !== 4 || submitting || paymentOnceRef.current) {
      return;
    }

    const needsSourceId =
      paymentContext?.sourceType === 'notarial' ||
      paymentContext?.sourceType === 'appointment';
    if (needsSourceId && !paymentContext?.sourceId) {
      Alert.alert(
        'Cannot complete payment',
        'This booking is missing a reference. Go back to the summary and try again, or restart the request.',
      );
      return;
    }

    try {
      paymentOnceRef.current = true;
      setSubmitting(true);
      const result = await completePaidService();
      const fallbackId = `BTMS-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;
      const transactionId = result?.transactionId || fallbackId;
      navigation.replace('PaymentSuccessful', {
        amount: serviceData.amount,
        transactionId,
        paymentContext,
        serviceData,
      });
    } catch (error) {
      paymentOnceRef.current = false;
      Alert.alert('Payment Failed', error?.message ?? 'Unable to complete payment. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async () => {
    if (isPaymongoFlow) {
      await cleanupPendingAppointment();
    }
    navigation.canGoBack() ? navigation.goBack() : null;
  };

  const handleKeyPress = (digit) => {
    if (pin.length < 4) {
      setPin(prev => prev + digit);
    }
  };

  const handleBackspace = () => {
    setPin(prev => prev.slice(0, -1));
  };

  const PinDots = () => (
    <View style={styles.pinContainer}>
      {[1, 2, 3, 4].map((i) => (
        <View 
          key={i} 
          style={[
            styles.dot, 
            i <= pin.length ? styles.dotFilled : styles.dotEmpty
          ]} 
        />
      ))}
    </View>
  );

  const Keypad = () => (
    <View style={styles.keypad}>
      {[['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['', '0', '⌫']].map((row, rowIndex) => (
        <View key={rowIndex} style={styles.keypadRow}>
          {row.map((key, keyIndex) => (
            <TouchableOpacity
              key={keyIndex}
              style={[styles.keypadButton, key === '' && styles.keypadButtonEmpty]}
              onPress={() => {
                if (key === '⌫') handleBackspace();
                else if (key !== '') handleKeyPress(key);
              }}
              disabled={key === ''}
            >
              <Text style={styles.keypadText}>{key}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ))}
    </View>
  );

  return (
    <ClientScreenShell>
      <ClientFadeInSoft style={styles.fill}>
      <View style={styles.header}>
        <ClientChevronBack onPress={handleCancel} style={styles.backButton} />

        <Text style={styles.headerLabel}>{getPaymentMethodLabel()} Payment</Text>
        
        <View style={styles.amountContainer}>
          <Text style={styles.totalAmountLabel}>TOTAL AMOUNT</Text>
          <Text style={styles.amountValue}>{serviceData.amount}</Text>
        </View>
      </View>

      <View style={styles.content}>
        <View style={styles.brandRow}>
          {getMethodLogo() ? (
            <Image 
              source={getMethodLogo()} 
              style={{ width: 48, height: 48, marginRight: 12, borderRadius: 8, backgroundColor: '#fff' }} 
              resizeMode="contain" 
            />
          ) : (
            <View style={styles.gcashIcon}>
              <Text style={styles.gcashIconText}>{getMethodIcon()}</Text>
            </View>
          )}
          <Text style={styles.gcashText}>{getPaymentMethodLabel()}</Text>
        </View>

        {isPaymongoFlow ? (
          <>
            <Text style={styles.instructionText}>
              You will be redirected to the secure PayMongo checkout. Once payment is complete, return here to confirm.
            </Text>

            <View style={styles.statusPill}>
              <Text style={styles.statusLabel}>Status:</Text>
              <Text style={styles.statusValue}>
                {paymentStatus === 'paid'
                  ? 'Paid'
                  : paymentStatus === 'failed'
                    ? 'Failed'
                    : paymentStatus === 'pending'
                      ? 'Pending'
                      : 'Ready'}
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.payButton, (isOpening || isPolling) && styles.payButtonDisabled]}
              onPress={openPaymongoCheckout}
              disabled={isOpening || isPolling}
            >
              {isOpening ? (
                <ActivityIndicator size="small" color={T.base} />
              ) : (
                <Text style={styles.payButtonText}>Open Secure Checkout</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.secondaryButton, isPolling && styles.payButtonDisabled]}
              onPress={pollPaymentStatus}
              disabled={isPolling}
            >
              {isPolling ? (
                <ActivityIndicator size="small" color={T.gold[1]} />
              ) : (
                <Text style={styles.secondaryButtonText}>I Completed Payment</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity style={styles.cancelButton} onPress={handleCancel}>
              <Text style={styles.cancelText}>Cancel and go back</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.instructionText}>
              Please enter your 4-digit PIN to secure your transaction.
            </Text>

            <PinDots />

            <Keypad />

            <TouchableOpacity 
              style={[styles.payButton, (pin.length < 4 || submitting) && styles.payButtonDisabled]} 
              onPress={handlePayNow}
              disabled={pin.length < 4 || submitting}
            >
              {submitting ? (
                <ActivityIndicator size="small" color={T.base} />
              ) : (
                <Text style={styles.payButtonText}>Pay Now</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity style={styles.cancelButton} onPress={handleCancel}>
              <Text style={styles.cancelText}>Cancel and go back</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
      </ClientFadeInSoft>
    </ClientScreenShell>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: {
    backgroundColor: 'rgba(18, 26, 36, 0.95)',
    paddingTop: 20,
    paddingBottom: 40,
    borderBottomLeftRadius: 40,
    borderBottomRightRadius: 40,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.12)',
  },
  backButton: { position: 'absolute', left: 16, top: 18 },
  headerLabel: { color: T.text, fontSize: 18, fontWeight: 'bold', marginTop: 5 },
  amountContainer: { alignItems: 'center', marginTop: 30 },
  totalAmountLabel: { color: T.textSoft, fontSize: 12, fontWeight: 'bold', letterSpacing: 1 },
  amountValue: { color: T.gold[0], fontSize: 48, fontWeight: 'bold', marginTop: 8 },
  
  content: { flex: 1, alignItems: 'center', paddingHorizontal: 30, paddingTop: 40 },
  brandRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  gcashIcon: { 
    backgroundColor: 'rgba(59, 130, 246, 0.35)', 
    width: 44, 
    height: 44, 
    borderRadius: 10, 
    justifyContent: 'center', 
    alignItems: 'center',
    marginRight: 12,
    borderWidth: 1,
    borderColor: 'rgba(96, 165, 250, 0.4)',
  },
  gcashIconText: { fontSize: 24 },
  gcashText: { fontSize: 28, fontWeight: 'bold', color: '#60A5FA' },
  
  instructionText: { 
    textAlign: 'center', 
    color: T.textSoft, 
    lineHeight: 22, 
    fontSize: 15,
    marginBottom: 40,
    paddingHorizontal: 10
  },
  
  pinContainer: { flexDirection: 'row', marginBottom: 30 },
  dot: { width: 16, height: 16, borderRadius: 8, marginHorizontal: 10 },
  dotFilled: { backgroundColor: T.gold[1] },
  dotEmpty: { borderWidth: 2, borderColor: 'rgba(244, 215, 139, 0.35)', backgroundColor: 'transparent' },

  keypad: { width: '100%', marginBottom: 30 },
  keypadRow: { flexDirection: 'row', justifyContent: 'center', marginBottom: 12 },
  keypadButton: { 
    width: 70, 
    height: 50, 
    justifyContent: 'center', 
    alignItems: 'center', 
    marginHorizontal: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.12)',
  },
  keypadButtonEmpty: { backgroundColor: 'transparent', borderWidth: 0 },
  keypadText: { fontSize: 24, fontWeight: '600', color: T.text },
  
  payButton: { 
    backgroundColor: T.gold[1], 
    width: '100%', 
    paddingVertical: 18, 
    borderRadius: 15,
    shadowColor: 'rgba(212, 175, 55, 0.45)',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6
  },
  payButtonText: { textAlign: 'center', color: T.base, fontWeight: 'bold', fontSize: 16 },
  payButtonDisabled: { backgroundColor: 'rgba(148, 163, 184, 0.4)' },
  secondaryButton: {
    marginTop: 12,
    width: '100%',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.4)',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  secondaryButtonText: { color: T.gold[0], fontWeight: '700', fontSize: 14 },
  cancelButton: { marginTop: 25 },
  cancelText: { color: T.textSoft, fontWeight: '600' },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.3)',
    backgroundColor: 'rgba(255,255,255,0.05)',
    marginBottom: 18,
  },
  statusLabel: { color: T.textSoft, fontSize: 12, fontWeight: '600' },
  statusValue: { color: T.text, fontSize: 12, fontWeight: '800', letterSpacing: 0.4 },
});
