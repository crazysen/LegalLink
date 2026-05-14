import React, { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { REFERENCE_THEME as T } from '../constants/referenceTheme';
import {
  formatAppointmentNotesForDisplay,
  getEffectiveAppointmentStatus,
  getMyAppointments,
  isAppointmentCompleted,
  parseAppointmentScheduleMs,
} from '../services/appointmentService';
import { ClientScreenShell, ClientFadeIn } from '../components/ClientScreenShell';
import ClientChevronBack from '../components/ClientChevronBack';

function resolveScheduleValue(item) {
  return (
    item?.scheduled_at ||
    item?.updated_at ||
    item?.created_at ||
    null
  );
}

function formatDateTime(isoDateTime) {
  if (!isoDateTime) {
    return { date: 'No schedule', time: '--:--' };
  }

  const rawValue = String(isoDateTime).trim();
  const hasTimezoneInfo = /([zZ]|[+-]\d{2}:?\d{2})$/.test(rawValue);

  let value;
  if (hasTimezoneInfo) {
    const normalizedValue = rawValue
      .replace(' ', 'T')
      .replace(/\+00$/, 'Z');
    value = new Date(normalizedValue);
  } else {
    const localMatch = rawValue.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
    if (localMatch) {
      value = new Date(
        Number(localMatch[1]),
        Number(localMatch[2]) - 1,
        Number(localMatch[3]),
        Number(localMatch[4]),
        Number(localMatch[5])
      );
    } else {
      value = new Date(rawValue);
    }
  }

  if (!value || Number.isNaN(value.getTime())) {
    return { date: 'No schedule', time: '--:--' };
  }

  return {
    date: value.toLocaleDateString(),
    time: value.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  };
}

function formatAttorneyName(name) {
  return String(name || 'Attorney')
    .replace(/^\s*(atty\.?\s*)+/i, '')
    .trim();
}

function buildRescheduleDraft(appointment, dateLabel, timeLabel) {
  const attorneyName = formatAttorneyName(appointment?.attorney_name);
  const dateText = dateLabel && dateLabel !== 'No schedule' ? ` on ${dateLabel}` : '';
  const timeText = timeLabel && timeLabel !== '--:--' ? ` at ${timeLabel}` : '';
  return (
    `Hi BatasMo Admin, I'd like to request a reschedule for my consultation` +
    `${attorneyName ? ` with Atty. ${attorneyName}` : ''}` +
    `${dateText}${timeText}. Please help me set a new schedule. Thank you!`
  );
}

export default function MyAppointments({ navigation }) {
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [payModalVisible, setPayModalVisible] = useState(false);
  const [pendingPayAppointment, setPendingPayAppointment] = useState(null);
  const [selectedPayMethod, setSelectedPayMethod] = useState('gcash');

  const paymentMethodLabel = (method) => {
    const value = String(method || '').toLowerCase();
    if (value === 'maya' || value === 'paymaya') return 'Maya';
    if (value === 'qrph') return 'QR Ph';
    return 'GCash';
  };

  const getReschedulePolicyState = (appointment) => {
    const status = String(getEffectiveAppointmentStatus(appointment) || '').toLowerCase();
    if (status === 'completed' || status === 'cancelled' || status === 'rejected') {
      return {
        can: false,
        title: 'Reschedule Assistance Needed',
        reason: 'This appointment is already closed and can no longer be rescheduled from your dashboard.',
      };
    }

    const scheduledAtMs = parseAppointmentScheduleMs(appointment);
    const msUntilSchedule = Number(scheduledAtMs || 0) - Date.now();
    if (!Number.isFinite(msUntilSchedule) || msUntilSchedule <= 0) {
      return {
        can: false,
        title: 'Appointment Date Has Passed',
        reason: 'Your consultation schedule has already passed. Please contact BatasMo Admin for further reschedule assistance.',
      };
    }

    const amount = Number(appointment?.amount || 0);
    const isPaid = Boolean(appointment?.payment_is_paid);
    if (amount > 0 && !isPaid) {
      return {
        can: false,
        title: 'Payment Required',
        reason: 'You can reschedule only after your consultation fee is paid. Complete payment first, then try again.',
      };
    }

    if (status === 'rescheduled') {
      return {
        can: false,
        title: 'One-Time Reschedule Used',
        reason: 'You already used your one-time reschedule option. Please contact BatasMo Admin for further changes.',
      };
    }

    try {
      const phDateKey = (date) =>
        new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Manila',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(date);
      const todayKey = phDateKey(new Date());
      const consultationKey = phDateKey(new Date(Number(scheduledAtMs || 0)));
      if (consultationKey <= todayKey) {
        return {
          can: false,
          title: 'Reschedule Window Closed',
          reason: 'Reschedule must be done at least 1 day before the consultation date — same-day reschedules are not allowed.',
        };
      }
    } catch (_e) {
      if (!Number.isFinite(msUntilSchedule) || msUntilSchedule < 24 * 60 * 60 * 1000) {
        return {
          can: false,
          title: 'Reschedule Window Closed',
          reason: 'Reschedule must be done at least 1 day before the consultation date — same-day reschedules are not allowed.',
        };
      }
    }

    return { can: true, title: '', reason: '' };
  };

  const requestRescheduleViaAdmin = (appointment, dateLabel, timeLabel) => {
    const draft = buildRescheduleDraft(appointment, dateLabel, timeLabel);
    navigation.navigate('ClientSupportMessages', { initialDraft: draft });
  };

  const handleReschedulePress = (appointment, dateLabel, timeLabel) => {
    const policy = getReschedulePolicyState(appointment);
    if (!policy.can) {
      Alert.alert(policy.title, policy.reason, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Message Admin',
          onPress: () => requestRescheduleViaAdmin(appointment, dateLabel, timeLabel),
        },
      ]);
      return;
    }
    requestRescheduleViaAdmin(appointment, dateLabel, timeLabel);
  };

  const loadAppointments = useCallback(async () => {
    try {
      setLoading(true);
      const records = await getMyAppointments({ force: true });
      const list = Array.isArray(records) ? records : [];
      // Completed consultations live under Logs only — not in full history
      setAppointments(list.filter(item => !isAppointmentCompleted(item)));
    } catch (error) {
      Alert.alert('Error', error?.message ?? 'Failed to load appointments.');
      setAppointments([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadAppointments();
    }, [loadAppointments]),
  );

  const handleBack = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('HomepageClient');
  };

  const openPaymentMethodModal = (appointment) => {
    setPendingPayAppointment(appointment);
    setSelectedPayMethod('gcash');
    setPayModalVisible(true);
  };

  const closePaymentMethodModal = () => {
    setPayModalVisible(false);
    setPendingPayAppointment(null);
  };

  const handleProceedToPayment = () => {
    if (!pendingPayAppointment) return;
    closePaymentMethodModal();
    navigation.navigate('Payment', {
      paymentMethod: selectedPayMethod,
      serviceData: {
        type: pendingPayAppointment?.title ?? 'Consultation',
        amount: pendingPayAppointment?.amount
          ? `\u20b1${Number(pendingPayAppointment.amount).toLocaleString()}`
          : '\u20b12,500',
      },
      paymentContext: {
        sourceType: 'appointment',
        sourceId: pendingPayAppointment?.id,
        attorneyId: pendingPayAppointment?.attorney_id,
        amount: pendingPayAppointment?.amount != null
          ? Number(pendingPayAppointment.amount)
          : undefined,
      },
    });
  };

  return (
    <>
      <ClientScreenShell>
        <ScrollView contentContainerStyle={styles.content}>
          <ClientFadeIn>
            <ClientChevronBack style={styles.backHit} onPress={handleBack} />

            <Text style={styles.screenTitle}>My Appointments</Text>
            <Text style={styles.screenSubtitle}>
              Active and upcoming bookings. Completed sessions are in Logs.
            </Text>
          </ClientFadeIn>

          {loading ? (
            <View style={styles.emptyCard}>
              <ActivityIndicator color={T.gold[1]} />
              <Text style={styles.emptyText}>Loading appointments...</Text>
            </View>
          ) : appointments.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No active appointments</Text>
              <Text style={styles.emptyText}>
                Completed consultations are saved under Logs in the menu.
              </Text>
            </View>
          ) : (
            appointments.map((item, index) => {
              const effective = getEffectiveAppointmentStatus(item);
              const status = effective.toUpperCase();
              const { date, time } = formatDateTime(resolveScheduleValue(item));
              const canChat = status === 'CONFIRMED' || status === 'RESCHEDULED';
              return (
                <ClientFadeIn key={item.id} delay={60 + index * 55}>
                  <View style={styles.card}>
                    <View style={styles.cardHeader}>
                      <View>
                        <Text style={styles.lawyerName}>{item.attorney_name ?? 'Attorney not assigned'}</Text>
                        <Text style={styles.specialty}>{item.title ?? 'Consultation'}</Text>
                      </View>
                      <View style={styles.badgeRow}>
                        <View style={styles.badgeDark}>
                          <Text style={styles.badgeDarkText}>{status}</Text>
                        </View>
                      </View>
                    </View>

                    <Text style={styles.detailText}>📅 {date}</Text>
                    <Text style={styles.detailText}>🕒 {time}</Text>
                    <Text style={styles.detailText}>
                      📝{' '}
                      {formatAppointmentNotesForDisplay(item.notes) || 'No additional notes'}
                    </Text>

                    {canChat ? (
                      <TouchableOpacity
                        style={styles.primaryButton}
                        onPress={() =>
                          navigation.navigate('EnterConsultationChat', {
                            chatId: item.id,
                            chatName: item.attorney_name ?? 'Attorney',
                            initials: (item.attorney_name ?? 'Attorney')
                              .split(' ')
                              .map(part => part[0])
                              .join('')
                              .slice(0, 2)
                              .toUpperCase(),
                          })
                        }>
                        <Text style={styles.primaryButtonText}>Message Attorney</Text>
                      </TouchableOpacity>
                    ) : status === 'PENDING' ? (
                      <TouchableOpacity
                        style={styles.payNowButton}
                        onPress={() => openPaymentMethodModal(item)}>
                        <Text style={styles.payNowButtonText}>Proceed to Payment</Text>
                      </TouchableOpacity>
                    ) : (
                      <View style={styles.pendingState}>
                        <Text style={styles.pendingStateText}>
                          {status === 'CANCELLED'
                            ? 'Appointment cancelled'
                            : 'Awaiting attorney approval'}
                        </Text>
                      </View>
                    )}

                    {(!['COMPLETED', 'CANCELLED', 'REJECTED'].includes(status)) && (
                      <TouchableOpacity
                        style={[styles.payNowButton, { backgroundColor: '#333', marginTop: 8 }]}
                        onPress={() => handleReschedulePress(item, date, time)}>
                        <Text style={styles.payNowButtonText}>Req. Reschedule (Msg Admin)</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </ClientFadeIn>
              );
            })
          )}
        </ScrollView>
      </ClientScreenShell>

      <Modal
        visible={payModalVisible}
        animationType="slide"
        transparent
        onRequestClose={closePaymentMethodModal}>
        <TouchableOpacity
          style={styles.payModalBackdrop}
          activeOpacity={1}
          onPress={closePaymentMethodModal}
        />
        <View style={styles.paySheet}>
          <View style={styles.paySheetHandle} />
          <Text style={styles.paySheetTitle}>Select Payment Method</Text>

          <TouchableOpacity
            style={[
              styles.payOption,
              selectedPayMethod === 'gcash' && styles.payOptionActive,
            ]}
            onPress={() => setSelectedPayMethod('gcash')}>
            <View style={styles.payOptionIcon}>
              <Text style={styles.payOptionIconText}>📱</Text>
            </View>
            <View style={styles.payOptionInfo}>
              <Text style={styles.payOptionName}>GCash</Text>
              <Text style={styles.payOptionSub}>Pay via GCash e-wallet</Text>
            </View>
            {selectedPayMethod === 'gcash' && (
              <Text style={styles.payCheck}>✓</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.payOption,
              selectedPayMethod === 'maya' && styles.payOptionActive,
            ]}
            onPress={() => setSelectedPayMethod('maya')}>
            <View style={[styles.payOptionIcon, { backgroundColor: 'rgba(124,58,237,0.2)' }]}>
              <Text style={styles.payOptionIconText}>💜</Text>
            </View>
            <View style={styles.payOptionInfo}>
              <Text style={styles.payOptionName}>Maya</Text>
              <Text style={styles.payOptionSub}>Pay via Maya e-wallet</Text>
            </View>
            {selectedPayMethod === 'maya' && (
              <Text style={styles.payCheck}>✓</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.payOption,
              selectedPayMethod === 'qrph' && styles.payOptionActive,
            ]}
            onPress={() => setSelectedPayMethod('qrph')}>
            <View style={[styles.payOptionIcon, { backgroundColor: 'rgba(15, 23, 42, 0.35)' }]}> 
              <Text style={styles.payOptionIconText}>🔳</Text>
            </View>
            <View style={styles.payOptionInfo}>
              <Text style={styles.payOptionName}>QR Ph</Text>
              <Text style={styles.payOptionSub}>Scan QR Ph to pay</Text>
            </View>
            {selectedPayMethod === 'qrph' && (
              <Text style={styles.payCheck}>✓</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.payProceedBtn}
            onPress={handleProceedToPayment}>
            <Text style={styles.payProceedText}>
              Continue with {paymentMethodLabel(selectedPayMethod)}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.payCancelBtn} onPress={closePaymentMethodModal}>
            <Text style={styles.payCancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 32 },
  backHit: { alignSelf: 'flex-start', marginBottom: 10 },
  screenTitle: { fontSize: 28, fontWeight: 'bold', color: T.text },
  screenSubtitle: { color: T.textSoft, marginBottom: 16 },
  card: {
    backgroundColor: 'rgba(18, 26, 36, 0.85)',
    borderRadius: 20,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.12)',
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  lawyerName: { fontSize: 18, fontWeight: '700', color: T.text },
  specialty: { fontSize: 13, color: T.textSoft },
  badgeRow: { flexDirection: 'row' },
  badgeDark: {
    backgroundColor: 'rgba(244, 215, 139, 0.18)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginLeft: 6,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.25)',
  },
  badgeDarkText: { color: T.gold[0], fontSize: 10, fontWeight: '700' },
  detailText: { color: T.textMuted, marginBottom: 4 },
  primaryButton: {
    marginTop: 12,
    backgroundColor: T.gold[1],
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryButtonText: { color: T.base, fontWeight: '700' },
  pendingState: {
    marginTop: 12,
    backgroundColor: 'rgba(251, 191, 36, 0.12)',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(251, 191, 36, 0.25)',
  },
  pendingStateText: { color: T.gold[0], fontWeight: '700' },
  emptyCard: {
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.12)',
    borderRadius: 20,
    backgroundColor: 'rgba(18, 26, 36, 0.62)',
    padding: 20,
    alignItems: 'center',
  },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: T.text, marginBottom: 6 },
  emptyText: { fontSize: 13, color: T.textSoft, textAlign: 'center' },
  payNowButton: {
    marginTop: 12,
    backgroundColor: T.gold[1],
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  payNowButtonText: { color: T.base, fontWeight: '700' },
  payModalBackdrop: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(4,7,11,0.65)',
  },
  paySheet: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(18,26,36,0.98)',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 36,
    borderWidth: 1,
    borderColor: 'rgba(244,215,139,0.15)',
  },
  paySheetHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignSelf: 'center', marginBottom: 20,
  },
  paySheetTitle: {
    fontSize: 18, fontWeight: '700', color: T.text,
    textAlign: 'center', marginBottom: 20,
  },
  payOption: {
    flexDirection: 'row', alignItems: 'center',
    padding: 16, borderRadius: 16, marginBottom: 12,
    borderWidth: 1.5, borderColor: 'rgba(244,215,139,0.1)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  payOptionActive: {
    borderColor: T.gold[1],
    backgroundColor: 'rgba(244,215,139,0.08)',
  },
  payOptionIcon: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: 'rgba(59,130,246,0.2)',
    justifyContent: 'center', alignItems: 'center', marginRight: 14,
  },
  payOptionIconText: { fontSize: 22 },
  payOptionInfo: { flex: 1 },
  payOptionName: { fontSize: 16, fontWeight: '700', color: T.text },
  payOptionSub: { fontSize: 12, color: T.textSoft, marginTop: 2 },
  payCheck: { color: T.gold[0], fontSize: 20, fontWeight: '700' },
  payProceedBtn: {
    backgroundColor: T.gold[1], paddingVertical: 16,
    borderRadius: 14, alignItems: 'center', marginTop: 8,
  },
  payProceedText: { color: T.base, fontWeight: '800', fontSize: 16 },
  payCancelBtn: { paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  payCancelText: { color: T.textSoft, fontWeight: '600', fontSize: 14 },
});
