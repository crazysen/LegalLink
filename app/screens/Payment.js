import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Alert,
  ActivityIndicator,
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Image,
  ScrollView,
  BackHandler,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { REFERENCE_THEME as T } from '../constants/referenceTheme';
import { ClientScreenShell, ClientFadeInSoft } from '../components/ClientScreenShell';
import ClientChevronBack from '../components/ClientChevronBack';
import {
  getCurrentSessionProfile,
  createAppointmentBooking,
  createNotarialRequest,
  markNotarialRequestPaid,
  notifyAttorneyOfPaidBooking,
  abandonAppointmentCheckout,
  cancelPendingUnpaidBooking,
  payForAppointment,
  getAppointmentPaymentStatus,
  fetchAppointmentPaymentDetails,
  fetchNotarialPaymentDetails,
} from '../services/userApi';
import {
  payForNotarialCheckout,
  finalizeNotarialAfterPaidCheckout,
} from '../services/notarialPaymentCheckout';
import { warmPaymentBackend } from '../services/paymentApiClient';
import {
  DEFAULT_PAYMENT_METHOD,
  PAYMONGO_PAYMENT_METHOD_TYPES,
} from '../constants/paymentConfig';

const QR_PH_LOGO = require('../assets/images/QR_Ph_Logo.png');
const PAYMENT_POLL_INITIAL_MS = 800;
const PAYMENT_POLL_MAX_MS = 5000;
const PAYMENT_POLL_BACKOFF_MS = 400;

function toPayApiMethod(m) {
  const v = String(m || '').trim().toLowerCase();
  if (v === 'qrph' || v === 'qr ph' || v === 'qr_ph') {
    return DEFAULT_PAYMENT_METHOD;
  }
  return DEFAULT_PAYMENT_METHOD;
}

export default function Payment({navigation, route}) {
  const [pin, setPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const paymentMethod = route?.params?.paymentMethod || DEFAULT_PAYMENT_METHOD;
  const serviceData = route?.params?.serviceData || { amount: '₱2,500' };
  const paymentContext = route?.params?.paymentContext || null;
  // PayMongo via /payments/appointments/* (Book Appointment + notarial on hosted API).
  const isPaymongoFlow =
    paymentContext?.sourceType === 'appointment' ||
    paymentContext?.sourceType === 'appointment_booking' ||
    paymentContext?.sourceType === 'notarial';
  const isWebStyleConsultationPay =
    paymentContext?.sourceType === 'appointment' ||
    paymentContext?.sourceType === 'appointment_booking';
  const isNotarialPay = paymentContext?.sourceType === 'notarial';
  const isNewNotarialRequest = isNotarialPay && Boolean(paymentContext?.fromNewRequest);
  const canPrefetchCheckoutSession =
    Boolean(paymentContext?.sourceId) && paymentContext?.sourceType === 'appointment';
  const notarialRequestIdRef = useRef(
    paymentContext?.sourceType === 'notarial' ? paymentContext.sourceId : null,
  );
  // Holds notarial request ID created as part of a bundled booking+notarial payment
  const notarialCreatedIdRef = useRef(null);
  const paymentOnceRef = useRef(false);
  const appointmentIdRef = useRef(
    paymentContext?.sourceType === 'appointment' ? paymentContext.sourceId : null,
  );
  const appointmentCreatedRef = useRef(false);
  const bookingPromiseRef = useRef(null);
  const transactionIdRef = useRef(null);
  const clientIdRef = useRef(null);
  const [checkoutSession, setCheckoutSession] = useState(null);
  const [isPaying, setIsPaying] = useState(false);
  const [sessionPreparing, setSessionPreparing] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState('idle');
  const cancelPaymentRef = useRef(false);
  const prefetchStartedRef = useRef(false);
  const autoOpenedCheckoutRef = useRef(false);

  const getPaymentMethodLabel = () => 'QR Ph';


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
        attachmentUrl: payload.attachment_url,
        attachmentName: payload.attachment_name,
        payload,
      });

      const appointmentId = bookingResult?.appointmentId || null;
      if (!appointmentId) {
        throw new Error('Appointment was created but could not be referenced.');
      }

      appointmentIdRef.current = appointmentId;
      appointmentCreatedRef.current = true;

      // Bundled notarial is created AFTER successful payment (completePaidCheckout)
      // so abandoned checkouts do not leave orphan "Payment pending" requests.

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

  const resetBookingCheckoutState = () => {
    appointmentIdRef.current = null;
    appointmentCreatedRef.current = false;
    transactionIdRef.current = null;
    setCheckoutSession(null);
    bookingPromiseRef.current = null;
  };

  const releaseUnpaidConsultationBooking = async () => {
    const isConsultation =
      paymentContext?.sourceType === 'appointment' ||
      paymentContext?.sourceType === 'appointment_booking';
    if (!isConsultation) return;

    const appointmentId =
      appointmentIdRef.current ||
      (paymentContext?.sourceType === 'appointment' ? paymentContext?.sourceId : null);
    if (!appointmentId) {
      resetBookingCheckoutState();
      return;
    }

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
    } catch {
      try {
        await cancelPendingUnpaidBooking({ appointmentId });
      } catch (fallbackError) {
        console.warn('[payment] cleanup failed', fallbackError?.message || fallbackError);
      }
    } finally {
      resetBookingCheckoutState();
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
      const error = new Error('PayMongo checkout is required for notarial payments.');
      error.code = 'PAYMONGO_REQUIRED';
      throw error;
    }

    return { transactionId: null };
  };

  const buildPaymongoSession = async () => {
    const profilePromise = getCurrentSessionProfile();
    const { profile } = await profilePromise;
    const clientId = profile?.id;
    if (!clientId) {
      throw new Error('You must be signed in to complete payment.');
    }
    clientIdRef.current = clientId;

    if (paymentContext?.sourceType === 'notarial') {
      if (!paymentContext?.sourceId) {
        throw new Error('Missing notarial request reference.');
      }
      let attorneyId = paymentContext.attorneyId ?? null;
      let amount = paymentContext.amount ?? null;
      if (amount == null) {
        const row = await fetchNotarialPaymentDetails(paymentContext.sourceId);
        if (attorneyId == null) attorneyId = row.attorneyId ?? null;
        amount = row.amount;
      }
      await warmPaymentBackend();

      const session = await payForNotarialCheckout({
        notarialRequestId: paymentContext.sourceId,
        clientId,
        attorneyId,
        amount: Number(amount || 0),
      });
      notarialRequestIdRef.current = paymentContext.sourceId;
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

    await warmPaymentBackend();

    const session = await payForAppointment({
      appointmentId,
      clientId,
      attorneyId,
      amount: Number(amount || 0),
      method: toPayApiMethod(paymentMethod),
      methodTypes: PAYMONGO_PAYMENT_METHOD_TYPES,
    });

    setCheckoutSession(session);
    transactionIdRef.current = session.transactionId || null;
    return session;
  };

  const completePaidCheckout = async (session) => {
    // Standalone notarial: the backend status poll already linked the transaction
    // and sent the admin/attorney/client notifications (web parity).
    if (!isNotarialPay) {
      try {
        const appointmentId = appointmentIdRef.current || paymentContext?.sourceId || null;
        await notifyAttorneyOfPaidBooking({ appointmentId });
      } catch (notifyError) {
        console.warn('[payment] notify attorney failed', notifyError?.message || notifyError);
      }

      // ── Bundled notarial: create after pay, then link the paid transaction ──
      const payload = paymentContext?.payload || {};
      if (payload.includeNotarial && clientIdRef.current) {
        try {
          const documentUrl = payload.notarialDocumentUrl || null;
          const documentName = payload.notarialDocumentName || null;
          if (!documentUrl && !documentName) {
            throw new Error(
              'Notarial document is missing. The consultation was paid, but the notarial request could not be created.',
            );
          }

          const appointmentId =
            appointmentIdRef.current || paymentContext?.sourceId || null;
          const bundledNote = appointmentId
            ? `Bundled with consultation appointment ${appointmentId}.`
            : 'Bundled with consultation booking.';
          const finalNotes = payload.notarialNotes
            ? `${bundledNote}\n\nClient notes: ${payload.notarialNotes}`
            : bundledNote;

          let notarialId = notarialCreatedIdRef.current;
          if (!notarialId) {
            const notarialResult = await createNotarialRequest({
              clientId: clientIdRef.current,
              attorneyId: payload.attorney_id || null,
              serviceType: payload.notarialServiceType || 'Affidavit of Loss',
              notes: finalNotes,
              documentUrl,
              documentName,
              amount: payload.notarialAddOnFee,
            });
            notarialId = notarialResult?.id || null;
            notarialCreatedIdRef.current = notarialId;
          }

          if (!notarialId) {
            throw new Error('Notarial request was not created.');
          }

          // Link the PayMongo-paid appointment transaction so Notary Status
          // sees payment_status=paid (same as standalone notarial checkout).
          await finalizeNotarialAfterPaidCheckout({
            notarialRequestId: notarialId,
            clientId: clientIdRef.current,
            amount: payload.notarialAddOnFee || 0,
            transactionId: session?.transactionId || transactionIdRef.current,
          });

          // Also record an explicit notarial transaction row (belt-and-suspenders).
          try {
            await markNotarialRequestPaid({
              requestId: notarialId,
              clientId: clientIdRef.current,
              attorneyId: payload.attorney_id || null,
              amount: payload.notarialAddOnFee || 0,
              method: toPayApiMethod(paymentMethod),
            });
          } catch (markErr) {
            console.warn(
              '[payment] bundled notarial markPaid fallback failed',
              markErr?.message || markErr,
            );
          }
        } catch (notarialErr) {
          console.warn(
            '[payment] bundled notarial after-pay failed',
            notarialErr?.message || notarialErr,
          );
          Alert.alert(
            'Notarial request',
            notarialErr?.message ||
              'Consultation payment succeeded, but the notarial request could not be finalized. Open Notary Status to retry payment if needed.',
          );
        }
      }
    }

    setPaymentStatus('paid');
    navigation.replace('PaymentSuccessful', {
      amount: serviceData.amount,
      transactionId: session.transactionId,
      paymentContext,
      serviceData,
      paymentMethodLabel: getPaymentMethodLabel(),
    });
  };

  const waitForPaidCheckout = async (session) => {
    if (!session?.transactionId) {
      throw new Error('Missing transaction reference.');
    }

    const startedAt = Date.now();
    const timeoutMs = 5 * 60 * 1000;
    let paid = false;
    let pollDelayMs = PAYMENT_POLL_INITIAL_MS;

    while (Date.now() - startedAt < timeoutMs) {
      if (cancelPaymentRef.current) {
        throw new Error('Payment was cancelled. Your booking has been released.');
      }

      const statusResult = await getAppointmentPaymentStatus(session.transactionId);
      const status = String(statusResult?.status || 'pending').toLowerCase();

      if (status === 'paid') {
        paid = true;
        break;
      }
      if (status === 'failed') {
        throw new Error('Payment failed. Please try again.');
      }

      if (cancelPaymentRef.current) {
        throw new Error('Payment was cancelled. Your booking has been released.');
      }

      await new Promise((resolve) => setTimeout(resolve, pollDelayMs));
      pollDelayMs = Math.min(PAYMENT_POLL_MAX_MS, pollDelayMs + PAYMENT_POLL_BACKOFF_MS);
    }

    if (!paid) {
      throw new Error(
        'Payment is still pending. Complete checkout, then try again in a few seconds.',
      );
    }

    await completePaidCheckout(session);
  };

  const handlePaymongoPayNow = async () => {
    if (isPaying || sessionPreparing) return;

    cancelPaymentRef.current = false;
    let succeeded = false;

    try {
      setIsPaying(true);
      setPaymentStatus('pending');

      const { profile } = await getCurrentSessionProfile();
      const clientId = profile?.id;
      if (!clientId) {
        throw new Error('You must be signed in to complete payment.');
      }
      clientIdRef.current = clientId;

      await warmPaymentBackend();

      // Notarial: fresh session per attempt so a retry never reuses a cancelled checkout.
      const session =
        (!isNotarialPay && checkoutSession) || (await buildPaymongoSession());
      if (!session?.checkoutUrl) {
        throw new Error('Checkout URL is missing. Please try again.');
      }

      await WebBrowser.openBrowserAsync(session.checkoutUrl, {
        dismissButtonStyle: 'close',
        enableBarCollapsing: true,
      });
      await waitForPaidCheckout(session);
      succeeded = true;
    } catch (error) {
      setPaymentStatus('failed');
      if (!cancelPaymentRef.current) {
        if (isNotarialPay) {
          Alert.alert(
            'Payment not completed',
            `${error?.message ?? 'Payment was not confirmed.'} Your file is saved — tap Pay Now to open PayMongo again.`,
          );
        } else {
          Alert.alert('Payment Failed', error?.message ?? 'Unable to complete payment. Please try again.');
        }
      }
    } finally {
      if (!succeeded && isWebStyleConsultationPay) {
        await releaseUnpaidConsultationBooking();
      }
      cancelPaymentRef.current = false;
      setIsPaying(false);
    }
  };

  const prefetchCheckoutSession = useCallback(async () => {
    if (!canPrefetchCheckoutSession || checkoutSession || prefetchStartedRef.current) {
      return;
    }
    prefetchStartedRef.current = true;
    setSessionPreparing(true);
    try {
      await warmPaymentBackend();
      await buildPaymongoSession();
    } catch (error) {
      console.warn('[payment] prefetch session failed', error?.message || error);
    } finally {
      setSessionPreparing(false);
    }
  }, [canPrefetchCheckoutSession, checkoutSession]);

  useEffect(() => {
    let cancelled = false;

    warmPaymentBackend().catch(() => {});

    (async () => {
      if (cancelled) return;

      if (canPrefetchCheckoutSession) {
        await prefetchCheckoutSession();
        return;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [canPrefetchCheckoutSession, paymentContext?.sourceType, prefetchCheckoutSession]);

  const handlePaymongoPayNowRef = useRef(handlePaymongoPayNow);
  handlePaymongoPayNowRef.current = handlePaymongoPayNow;

  // Web parity: notarial checkout opens PayMongo (QR Ph) immediately, no extra tap.
  useEffect(() => {
    if (!isNotarialPay || autoOpenedCheckoutRef.current) return;
    autoOpenedCheckoutRef.current = true;
    handlePaymongoPayNowRef.current();
  }, [isNotarialPay]);

  const leaveUnpaidNotarial = (prefix = '') => {
    Alert.alert(
      'Payment not completed',
      `${prefix}Your file is saved — open PayMongo again from Notary Status to finish payment.`,
    );
    if (isNewNotarialRequest) {
      navigation.replace('ClientNotaryStatus');
    } else if (navigation.canGoBack()) {
      navigation.goBack();
    }
  };

  const handleCancelPayment = async () => {
    cancelPaymentRef.current = true;
    setIsPaying(false);
    setPaymentStatus('failed');
    if (isNotarialPay) {
      leaveUnpaidNotarial('Payment cancelled. ');
      return;
    }
    await releaseUnpaidConsultationBooking();
    if (navigation.canGoBack()) {
      navigation.goBack();
    }
  };

  const handlePayNow = async () => {
    if (isPaymongoFlow) {
      return;
    }
    if (pin.length !== 4 || submitting || paymentOnceRef.current) {
      return;
    }

    const needsSourceId = paymentContext?.sourceType === 'appointment';
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
    if (isPaying) {
      await handleCancelPayment();
      return;
    }
    if (isNewNotarialRequest) {
      leaveUnpaidNotarial();
      return;
    }
    if (isWebStyleConsultationPay) {
      await releaseUnpaidConsultationBooking();
    }
    if (navigation.canGoBack()) {
      navigation.goBack();
    }
  };

  const handleCancelRef = useRef(handleCancel);
  handleCancelRef.current = handleCancel;

  useEffect(() => {
    if (!isNewNotarialRequest) return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      handleCancelRef.current();
      return true;
    });
    return () => subscription.remove();
  }, [isNewNotarialRequest]);

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

      <ScrollView
        style={styles.fill}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled">
        <View style={styles.brandRow}>
          <Image 
            source={QR_PH_LOGO} 
            style={{ width: 48, height: 48, marginRight: 12, borderRadius: 8, backgroundColor: '#fff' }} 
            resizeMode="contain" 
          />
          <Text style={styles.gcashText}>{getPaymentMethodLabel()}</Text>
        </View>

        {isPaymongoFlow ? (
          <>
            <Text style={styles.instructionText}>
              {isPaying
                ? 'Waiting for payment confirmation… For QR Ph, finish in your banking app, then return here. Use Cancel Payment to stop.'
                : sessionPreparing
                  ? 'Preparing secure checkout…'
                  : checkoutSession
                    ? 'Checkout is ready. Tap Pay Now to open PayMongo and complete payment.'
                    : 'You will be redirected to secure PayMongo checkout. Payment is confirmed automatically when complete.'}
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

            {isPaying ? (
              <>
                <ActivityIndicator size="small" color={T.gold[1]} style={{ marginBottom: 16 }} />
                <TouchableOpacity style={styles.secondaryButton} onPress={handleCancelPayment}>
                  <Text style={styles.secondaryButtonText}>Cancel Payment</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <TouchableOpacity
                  style={[
                    styles.payButton,
                    (isPaying || sessionPreparing) && styles.payButtonDisabled,
                  ]}
                  onPress={handlePaymongoPayNow}
                  disabled={isPaying || sessionPreparing}>
                  {isPaying || sessionPreparing ? (
                    <ActivityIndicator size="small" color={T.base} />
                  ) : (
                    <Text style={styles.payButtonText}>Pay Now</Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity style={styles.cancelButton} onPress={handleCancel}>
                  <Text style={styles.cancelText}>← Back</Text>
                </TouchableOpacity>
              </>
            )}
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
      </ScrollView>
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
  
  content: { flexGrow: 1, alignItems: 'center', paddingHorizontal: 30, paddingTop: 40, paddingBottom: 30 },
  brandRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
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
