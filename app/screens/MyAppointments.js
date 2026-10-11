import React, { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { REFERENCE_THEME as T } from '../constants/referenceTheme';
import { DEFAULT_PAYMENT_METHOD } from '../constants/paymentConfig';
import { warmPaymentBackend } from '../services/paymentApiClient';
import {
  getEffectiveAppointmentStatus,
  invalidateAppointmentsCache,
} from '../services/appointmentService';
import {
  ensureAppConfigReady,
  fetchClientConsultationQueue,
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

  const requestRescheduleViaAdmin = (item, dateLabel, timeLabel) => {
    const appointment = queueItemToAppointment(item);
    const draft = buildRescheduleDraft(appointment, dateLabel, timeLabel);
    navigation.navigate('ClientSupportMessages', { initialDraft: draft });
  };

  const handleReschedulePress = (item) => {
    const { date, time } = formatDateTime(item.scheduledAt || item.date);
    Alert.alert(
      'Reschedule Consultation',
      "Your schedule will be set by LegalLink Admin. Send them a message and they'll arrange a new date and time for you.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Message Admin',
          onPress: () => requestRescheduleViaAdmin(item, date, time),
        },
      ],
    );
  };

  const loadQueue = useCallback(async (options = {}) => {
    const force = Boolean(options?.force);
    try {
      if (!force) setLoading(true);
      await ensureAppConfigReady();

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
});
