import React, { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { IS_ANDROID, IS_IOS } from '../constants/platformUi';
import { REFERENCE_THEME as T } from '../constants/referenceTheme';
import { DEFAULT_PAYMENT_METHOD } from '../constants/paymentConfig';
import { warmPaymentBackend } from '../services/paymentApiClient';
import {
  getAvailability,
  getEffectiveAppointmentStatus,
  invalidateAppointmentsCache,
  normalizeSlotTimeLabel,
  parseAppointmentScheduleMs,
} from '../services/appointmentService';
import {
  ensureAppConfigLoaded,
  fetchClientConsultationQueue,
  parseReschedulePendingFromNotes,
  rescheduleClientAppointment,
  subscribeToClientAppointments,
} from '../services/userApi';
import { getMyProfile } from '../services/profileService';
import ClientConsultationQueue from '../components/ClientConsultationQueue';
import { ClientScreenShell, ClientFadeIn } from '../components/ClientScreenShell';
import ClientChevronBack from '../components/ClientChevronBack';

function formatDateTime(isoDateTime) {
  if (!isoDateTime) {
    return { date: 'No schedule', time: '--:--' };
  }

  const rawValue = String(isoDateTime).trim();
  const hasTimezoneInfo = /([zZ]|[+-]\d{2}:?\d{2})$/.test(rawValue);

  let value;
  if (hasTimezoneInfo) {
    const normalizedValue = rawValue.replace(' ', 'T').replace(/\+00$/, 'Z');
    value = new Date(normalizedValue);
  } else {
    const localMatch = rawValue.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
    if (localMatch) {
      value = new Date(
        Number(localMatch[1]),
        Number(localMatch[2]) - 1,
        Number(localMatch[3]),
        Number(localMatch[4]),
        Number(localMatch[5]),
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

function queueItemToAppointment(item) {
  return {
    id: item.id,
    status: item.status,
    scheduled_at: item.scheduledAt || item.date,
    slot_date: item.slotDate,
    slot_time: item.slotTime,
    amount: item.amount,
    payment_is_paid: item.payment_is_paid ?? item.payment === 'Paid',
    attorney_name: item.name,
    title: item.area,
    notes: item.notes,
    attorney_id: item.attorney_id,
  };
}

function buildRescheduleDraft(appointment, dateLabel, timeLabel) {
  const attorneyName = formatAttorneyName(appointment?.attorney_name);
  const dateText = dateLabel && dateLabel !== 'No schedule' ? ` on ${dateLabel}` : '';
  const timeText = timeLabel && timeLabel !== '--:--' ? ` at ${timeLabel}` : '';
  return (
    `Hi LegalLink Admin, I'd like to request a reschedule for my consultation` +
    `${attorneyName ? ` with Atty. ${attorneyName}` : ''}` +
    `${dateText}${timeText}. Please help me set a new schedule. Thank you!`
  );
}

export default function MyAppointments({ navigation }) {
  const [queueItems, setQueueItems] = useState([]);
  const [clientId, setClientId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [rescheduleModalVisible, setRescheduleModalVisible] = useState(false);
  const [rescheduleTarget, setRescheduleTarget] = useState(null);
  const [rescheduleDate, setRescheduleDate] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 1);
    return d;
  });
  const [rescheduleTime, setRescheduleTime] = useState('');
  const [rescheduleReason, setRescheduleReason] = useState('');
  const [rescheduleSlots, setRescheduleSlots] = useState([]);
  const [rescheduleSlotsLoading, setRescheduleSlotsLoading] = useState(false);
  const [rescheduleSubmitting, setRescheduleSubmitting] = useState(false);
  const [rescheduleError, setRescheduleError] = useState('');
  const [showRescheduleDatePicker, setShowRescheduleDatePicker] = useState(false);

  const rescheduleDateKey = `${rescheduleDate.getFullYear()}-${String(rescheduleDate.getMonth() + 1).padStart(2, '0')}-${String(rescheduleDate.getDate()).padStart(2, '0')}`;

  useEffect(() => {
    let cancelled = false;
    if (!rescheduleModalVisible || !rescheduleTarget?.attorney_id) {
      setRescheduleSlots([]);
      return undefined;
    }
    (async () => {
      try {
        setRescheduleSlotsLoading(true);
        const slots = await getAvailability(rescheduleTarget.attorney_id, rescheduleDateKey, {
          force: true,
        });
        if (cancelled) return;
        const unique = Array.from(
          new Set((slots || []).map(s => String(s.time || '').trim()).filter(Boolean)),
        );
        setRescheduleSlots(unique);
        setRescheduleTime(prev => (unique.includes(prev) ? prev : ''));
      } catch (e) {
        if (!cancelled) {
          setRescheduleSlots([]);
          setRescheduleError(e?.message || 'Unable to load available slots.');
        }
      } finally {
        if (!cancelled) setRescheduleSlotsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rescheduleModalVisible, rescheduleTarget, rescheduleDateKey]);

  const openRescheduleModal = (item) => {
    setRescheduleTarget(item);
    setRescheduleReason('');
    setRescheduleError('');
    setRescheduleTime('');
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 1);
    setRescheduleDate(d);
    setRescheduleModalVisible(true);
  };

  const closeRescheduleModal = () => {
    if (rescheduleSubmitting) return;
    setRescheduleModalVisible(false);
    setRescheduleTarget(null);
    setRescheduleError('');
  };

  const submitRescheduleRequest = async () => {
    if (!rescheduleTarget?.id) return;
    if (!rescheduleDateKey || !rescheduleTime) {
      setRescheduleError('Please select a new date and time.');
      return;
    }
    setRescheduleSubmitting(true);
    setRescheduleError('');
    try {
      const normalizedTime = normalizeSlotTimeLabel(rescheduleTime);
      const nextSchedule = new Date(`${rescheduleDateKey}T${normalizedTime}`);
      if (Number.isNaN(nextSchedule.getTime())) {
        throw new Error('Invalid schedule selected.');
      }
      await rescheduleClientAppointment({
        appointmentId: rescheduleTarget.id,
        scheduledAt: nextSchedule.toISOString(),
        note: rescheduleReason.trim(),
      });
      invalidateAppointmentsCache();
      const profile = await getMyProfile();
      if (profile?.id) {
        const rows = await fetchClientConsultationQueue(profile.id, { force: true });
        setQueueItems(rows);
      }
      closeRescheduleModal();
      Alert.alert(
        'Request submitted',
        'LegalLink Admin will review your chosen date and time. Your queue updates after approval.',
      );
    } catch (e) {
      setRescheduleError(e?.message || 'Unable to submit reschedule request.');
    } finally {
      setRescheduleSubmitting(false);
    }
  };

  const getReschedulePolicyState = (item) => {
    const appointment = queueItemToAppointment(item);
    const pending = parseReschedulePendingFromNotes(appointment.notes);
    if (pending?.requestedScheduledAt) {
      return {
        can: false,
        title: 'Reschedule pending approval',
        reason:
          'You already submitted a reschedule request. LegalLink Admin is reviewing your chosen date and time.',
      };
    }
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
        reason:
          'Your consultation schedule has already passed. Please contact LegalLink Admin for further reschedule assistance.',
      };
    }

    const amount = Number(appointment?.amount || 0);
    const isPaid = Boolean(appointment?.payment_is_paid);
    if (amount > 0 && !isPaid) {
      return {
        can: false,
        title: 'Payment Required',
        reason:
          'You can reschedule only after your consultation fee is paid. Complete payment first, then try again.',
      };
    }

    if (status === 'rescheduled') {
      return {
        can: false,
        title: 'One-Time Reschedule Used',
        reason:
          'You already used your one-time reschedule option. Please contact LegalLink Admin for further changes.',
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
          reason:
            'Reschedule must be done at least 1 day before the consultation date — same-day reschedules are not allowed.',
        };
      }
    } catch (_e) {
      if (!Number.isFinite(msUntilSchedule) || msUntilSchedule < 24 * 60 * 60 * 1000) {
        return {
          can: false,
          title: 'Reschedule Window Closed',
          reason:
            'Reschedule must be done at least 1 day before the consultation date — same-day reschedules are not allowed.',
        };
      }
    }

    return { can: true, title: '', reason: '' };
  };

  const requestRescheduleViaAdmin = (item, dateLabel, timeLabel) => {
    const appointment = queueItemToAppointment(item);
    const draft = buildRescheduleDraft(appointment, dateLabel, timeLabel);
    navigation.navigate('ClientSupportMessages', { initialDraft: draft });
  };

  const handleReschedulePress = (item) => {
    const { date, time } = formatDateTime(item.scheduledAt || item.date);
    const policy = getReschedulePolicyState(item);
    if (!policy.can) {
      Alert.alert(policy.title, policy.reason, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Message Admin',
          onPress: () => requestRescheduleViaAdmin(item, date, time),
        },
      ]);
      return;
    }
    openRescheduleModal(item);
  };

  const loadQueue = useCallback(async (options = {}) => {
    const force = Boolean(options?.force);
    try {
      if (!force) setLoading(true);
      await ensureAppConfigLoaded();

      let userId = clientId;
      if (!userId) {
        const profile = await getMyProfile();
        userId = profile?.id;
        if (userId) setClientId(userId);
      }
      if (!userId) {
        setQueueItems([]);
        return;
      }

      const rows = await fetchClientConsultationQueue(userId, { force: true });
      setQueueItems(Array.isArray(rows) ? rows : []);
    } catch (error) {
      Alert.alert('Error', error?.message ?? 'Failed to load consultation queue.');
      setQueueItems([]);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      let unsubscribe = () => {};

      (async () => {
        await loadQueue({ force: true });
        if (cancelled) return;

        try {
          const profile = await getMyProfile();
          if (cancelled || !profile?.id) return;
          setClientId(profile.id);
          unsubscribe = subscribeToClientAppointments(profile.id, () => {
            invalidateAppointmentsCache();
            loadQueue({ force: true });
          });
        } catch {
          // ignore
        }
      })();

      return () => {
        cancelled = true;
        unsubscribe();
      };
    }, [loadQueue]),
  );

  const handleBack = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('HomepageClient');
  };

  const handlePayForAppointment = (item) => {
    if (!item?.id) {
      return;
    }
    warmPaymentBackend().catch(() => {});
    navigation.navigate('Payment', {
      paymentMethod: DEFAULT_PAYMENT_METHOD,
      serviceData: {
        type: item?.area ?? 'Consultation',
        amount: item?.amount
          ? `\u20b1${Number(item.amount).toLocaleString()}`
          : '\u20b12,500',
      },
      paymentContext: {
        sourceType: 'appointment',
        sourceId: item.id,
        attorneyId: item?.attorney_id,
        amount: item?.amount != null ? Number(item.amount) : undefined,
      },
    });
  };

  const handleEnterRoom = (item) => {
    if (!item?.payment_is_paid && String(item?.payment || '').toLowerCase() !== 'paid') {
      Alert.alert('Payment required', 'Complete payment before entering the consultation room.');
      return;
    }
    if (item?.chatAccessible === false) {
      Alert.alert(
        'Consultation not available yet',
        'Chat opens on your consultation day (any time that day).',
      );
      return;
    }
    const name = item?.name ?? 'Attorney';
    navigation.navigate('EnterConsultationChat', {
      chatId: item.id,
      chatName: name,
      initials: name
        .split(' ')
        .map((part) => part[0])
        .join('')
        .slice(0, 2)
        .toUpperCase(),
    });
  };

  const renderItemFooter = (item) => {
    const status = String(getEffectiveAppointmentStatus(queueItemToAppointment(item)) || '').toUpperCase();
    if (['COMPLETED', 'CANCELLED', 'REJECTED'].includes(status)) {
      return null;
    }
    if (item.pendingReschedule?.requestedScheduledAt) {
      return (
        <View style={styles.pendingRescheduleBadge}>
          <Text style={styles.pendingRescheduleText}>Reschedule pending approval</Text>
        </View>
      );
    }
    return (
      <TouchableOpacity
        style={styles.rescheduleBtn}
        onPress={() => handleReschedulePress(item)}>
        <Text style={styles.rescheduleBtnText}>Reschedule</Text>
      </TouchableOpacity>
    );
  };

  return (
    <>
      <ClientScreenShell>
        <ScrollView contentContainerStyle={styles.content}>
          <ClientFadeIn>
            <ClientChevronBack style={styles.backHit} onPress={handleBack} />

            <Text style={styles.screenTitle}>Consultation Queue</Text>
            <Text style={styles.screenSubtitle}>
              Your upcoming consultations sorted by date. Completed sessions are in Logs.
            </Text>
          </ClientFadeIn>

          <ClientConsultationQueue
            items={queueItems}
            loading={loading}
            emptyTitle="No consultations in queue"
            emptySubtitle="Book a consultation from the home screen. Completed sessions are in Logs."
            onEnterRoom={handleEnterRoom}
            onPay={handlePayForAppointment}
            renderItemFooter={renderItemFooter}
          />
        </ScrollView>
      </ClientScreenShell>

      <Modal
        visible={rescheduleModalVisible}
        animationType="slide"
        transparent
        onRequestClose={closeRescheduleModal}>
        <TouchableOpacity
          style={styles.payModalBackdrop}
          activeOpacity={1}
          onPress={closeRescheduleModal}
        />
        <View style={styles.paySheet}>
          <View style={styles.paySheetHandle} />
          <Text style={styles.paySheetTitle}>Request reschedule</Text>
          <Text style={styles.rescheduleModalSub}>
            Choose a new date and time. Admin approval is required before your schedule changes.
          </Text>

          <TouchableOpacity
            style={styles.rescheduleDateBtn}
            onPress={() => setShowRescheduleDatePicker(true)}>
            <Text style={styles.rescheduleDateBtnLabel}>Date</Text>
            <Text style={styles.rescheduleDateBtnValue}>{rescheduleDateKey}</Text>
          </TouchableOpacity>

          {showRescheduleDatePicker && (
            <DateTimePicker
              value={rescheduleDate}
              mode="date"
              display={IS_IOS ? 'spinner' : 'default'}
              minimumDate={new Date(Date.now() + 86400000)}
              onChange={(_, selected) => {
                if (IS_ANDROID) setShowRescheduleDatePicker(false);
                if (selected) setRescheduleDate(selected);
              }}
            />
          )}

          <Text style={styles.rescheduleSlotsLabel}>Available times</Text>
          {rescheduleSlotsLoading ? (
            <ActivityIndicator color={T.gold[1]} style={{ marginVertical: 12 }} />
          ) : rescheduleSlots.length === 0 ? (
            <Text style={styles.rescheduleEmptySlots}>No open slots on this date.</Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.slotScroll}>
              {rescheduleSlots.map(slot => (
                <TouchableOpacity
                  key={slot}
                  style={[
                    styles.slotChip,
                    rescheduleTime === slot && styles.slotChipActive,
                  ]}
                  onPress={() => setRescheduleTime(slot)}>
                  <Text
                    style={[
                      styles.slotChipText,
                      rescheduleTime === slot && styles.slotChipTextActive,
                    ]}>
                    {slot}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          <TextInput
            style={styles.rescheduleReasonInput}
            placeholder="Reason (optional)"
            placeholderTextColor={T.textSoft}
            value={rescheduleReason}
            onChangeText={setRescheduleReason}
            multiline
            maxLength={500}
          />

          {rescheduleError ? (
            <Text style={styles.rescheduleErrorText}>{rescheduleError}</Text>
          ) : null}

          <TouchableOpacity
            style={[styles.payProceedBtn, rescheduleSubmitting && styles.payProceedBtnDisabled]}
            onPress={submitRescheduleRequest}
            disabled={rescheduleSubmitting}>
            {rescheduleSubmitting ? (
              <ActivityIndicator color={T.base} />
            ) : (
              <Text style={styles.payProceedText}>Submit request</Text>
            )}
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
  screenSubtitle: { color: T.textSoft, marginBottom: 16, lineHeight: 20 },
  rescheduleBtn: {
    backgroundColor: 'rgba(51, 51, 51, 0.9)',
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.15)',
  },
  rescheduleBtnText: { color: T.text, fontWeight: '700', fontSize: 12 },
  pendingRescheduleBadge: {
    backgroundColor: 'rgba(234, 179, 8, 0.15)',
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(234, 179, 8, 0.35)',
  },
  pendingRescheduleText: { color: '#FCD34D', fontWeight: '700', fontSize: 12 },
  rescheduleModalSub: {
    color: T.textSoft,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 16,
    textAlign: 'center',
  },
  rescheduleDateBtn: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(244,215,139,0.2)',
    marginBottom: 12,
  },
  rescheduleDateBtnLabel: { color: T.textSoft, fontSize: 13 },
  rescheduleDateBtnValue: { color: T.text, fontWeight: '700', fontSize: 14 },
  rescheduleSlotsLabel: { color: T.textSoft, fontSize: 12, marginBottom: 8 },
  rescheduleEmptySlots: { color: T.textSoft, fontSize: 13, marginBottom: 12 },
  slotScroll: { marginBottom: 12, maxHeight: 44 },
  slotChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(244,215,139,0.25)',
    marginRight: 8,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  slotChipActive: { borderColor: T.gold[1], backgroundColor: 'rgba(244,215,139,0.15)' },
  slotChipText: { color: T.textSoft, fontSize: 13, fontWeight: '600' },
  slotChipTextActive: { color: T.gold[0] },
  rescheduleReasonInput: {
    borderWidth: 1,
    borderColor: 'rgba(244,215,139,0.2)',
    borderRadius: 12,
    padding: 12,
    color: T.text,
    minHeight: 72,
    marginBottom: 8,
    textAlignVertical: 'top',
  },
  rescheduleErrorText: { color: '#FCA5A5', fontSize: 13, marginBottom: 8 },
  payProceedBtnDisabled: { opacity: 0.6 },
  payModalBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(4,7,11,0.65)',
  },
  paySheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(18,26,36,0.98)',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 36,
    borderWidth: 1,
    borderColor: 'rgba(244,215,139,0.15)',
  },
  paySheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignSelf: 'center',
    marginBottom: 20,
  },
  paySheetTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: T.text,
    textAlign: 'center',
    marginBottom: 20,
  },
  payOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    marginBottom: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(244,215,139,0.1)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  payOptionActive: {
    borderColor: T.gold[1],
    backgroundColor: 'rgba(244,215,139,0.08)',
  },
  payOptionIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(59,130,246,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  payOptionIconText: { fontSize: 22 },
  payOptionInfo: { flex: 1 },
  payOptionName: { fontSize: 16, fontWeight: '700', color: T.text },
  payOptionSub: { fontSize: 12, color: T.textSoft, marginTop: 2 },
  payCheck: { color: T.gold[0], fontSize: 20, fontWeight: '700' },
  payProceedBtn: {
    backgroundColor: T.gold[1],
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  payProceedText: { color: T.base, fontWeight: '800', fontSize: 16 },
  payCancelBtn: { paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  payCancelText: { color: T.textSoft, fontWeight: '600', fontSize: 14 },
});
