import React, {useEffect, useMemo, useState} from 'react';
import {
  Alert,
  ActivityIndicator,
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import {REFERENCE_THEME as T} from '../constants/referenceTheme';
import {IS_ANDROID, IS_IOS} from '../constants/platformUi';
import {ClientScreenShell, ClientFadeIn} from '../components/ClientScreenShell';
import {
  rescheduleAppointment,
  getAvailableRescheduleSlotLabels,
  HOURLY_CONSULTATION_SLOT_LABELS,
  isConsultationSlotInTheFuture,
  scheduledAtToLocalSlotDateTime,
} from '../services/appointmentService';

function parseSlotToParts(slotStr) {
  const [time, modifier] = slotStr.split(' ');
  const [rawHour, rawMinute] = time.split(':');
  let hour = Number(rawHour);
  if (modifier === 'PM' && hour < 12) hour += 12;
  if (modifier === 'AM' && hour === 12) hour = 0;
  return {hour, minute: Number(rawMinute)};
}

function findMatchingSlot(date, slots) {
  const h = date.getHours();
  const m = date.getMinutes();
  for (const slot of slots) {
    const {hour, minute} = parseSlotToParts(slot);
    if (hour === h && minute === m) {
      return slot;
    }
  }
  return null;
}

function parseInitialSchedule(appointment) {
  const raw = appointment?.scheduled_at;
  if (raw) {
    const d = new Date(String(raw).trim());
    if (!Number.isNaN(d.getTime())) {
      return d;
    }
  }
  const d = new Date();
  d.setHours(10, 0, 0, 0);
  return d;
}

export default function RescheduleAppointment({navigation, route}) {
  const appointment = route?.params?.appointment || {name: 'Client', date: 'N/A', time: 'N/A'};
  const returnRoute = route?.params?.returnRoute || 'AttyMyAppointments';

  const [scheduleAt, setScheduleAt] = useState(() => {
    const initial = parseInitialSchedule(appointment);
    const allowed = HOURLY_CONSULTATION_SLOT_LABELS.filter(t =>
      isConsultationSlotInTheFuture(initial, t),
    );
    const pool = allowed.length ? allowed : HOURLY_CONSULTATION_SLOT_LABELS;
    const match = findMatchingSlot(initial, pool);
    if (match) {
      const {hour, minute} = parseSlotToParts(match);
      const d = new Date(initial);
      d.setHours(hour, minute, 0, 0);
      return d;
    }
    const d = new Date(initial);
    const {hour, minute} = parseSlotToParts(pool[0]);
    d.setHours(hour, minute, 0, 0);
    return d;
  });

  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [availableSlots, setAvailableSlots] = useState(null);
  const [slotsLoading, setSlotsLoading] = useState(false);

  const attorneyId = appointment?.attorney_id;
  const appointmentId = appointment?.id;

  const scheduleDayKey = `${scheduleAt.getFullYear()}-${scheduleAt.getMonth()}-${scheduleAt.getDate()}`;

  useEffect(() => {
    let cancelled = false;
    if (!attorneyId || !appointmentId) {
      setAvailableSlots(null);
      return;
    }
    const dk = scheduleDayKey.split('-').map(Number);
    const dayOnly = new Date(dk[0], dk[1], dk[2], 12, 0, 0);
    (async () => {
      try {
        setSlotsLoading(true);
        const slots = await getAvailableRescheduleSlotLabels(
          attorneyId,
          appointmentId,
          dayOnly,
        );
        if (!cancelled) {
          setAvailableSlots(slots);
        }
      } catch {
        if (!cancelled) {
          setAvailableSlots(null);
        }
      } finally {
        if (!cancelled) {
          setSlotsLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attorneyId, appointmentId, scheduleDayKey]);

  const selectableSlots = useMemo(() => {
    if (attorneyId && slotsLoading) {
      return [];
    }
    if (availableSlots != null) {
      return availableSlots;
    }
    return HOURLY_CONSULTATION_SLOT_LABELS.filter(t =>
      isConsultationSlotInTheFuture(scheduleAt, t),
    );
  }, [scheduleAt, availableSlots, slotsLoading, attorneyId]);

  const matchingSlot = useMemo(
    () => findMatchingSlot(scheduleAt, selectableSlots),
    [scheduleAt, selectableSlots],
  );

  useEffect(() => {
    if (slotsLoading || !selectableSlots?.length) {
      return;
    }
    if (findMatchingSlot(scheduleAt, selectableSlots)) {
      return;
    }
    const {hour, minute} = parseSlotToParts(selectableSlots[0]);
    setScheduleAt(prev => {
      const next = new Date(prev);
      next.setHours(hour, minute, 0, 0);
      return next;
    });
  }, [slotsLoading, selectableSlots, scheduleAt]);

  const appointmentTitle = useMemo(
    () => `With ${appointment.name} • ${appointment.date}, ${appointment.time}`,
    [appointment.date, appointment.name, appointment.time],
  );

  const dateLabel = useMemo(
    () =>
      scheduleAt.toLocaleDateString(undefined, {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }),
    [scheduleAt],
  );

  const buildScheduleIsoUtc = () => scheduleAt.toISOString();

  const applyTimeSlot = slotStr => {
    const {hour, minute} = parseSlotToParts(slotStr);
    setScheduleAt(prev => {
      const next = new Date(prev);
      next.setHours(hour, minute, 0, 0);
      return next;
    });
  };

  const onDateChange = (event, date) => {
    if (IS_ANDROID) {
      setShowDatePicker(false);
    }
    if (event?.type === 'dismissed' && IS_ANDROID) {
      return;
    }
    if (date) {
      setScheduleAt(prev => {
        const next = new Date(prev);
        next.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
        const allowed = HOURLY_CONSULTATION_SLOT_LABELS.filter(t =>
          isConsultationSlotInTheFuture(next, t),
        );
        if (allowed.length === 0) {
          return next;
        }
        const stillOk = allowed.some(t => {
          const {hour, minute} = parseSlotToParts(t);
          return next.getHours() === hour && next.getMinutes() === minute;
        });
        if (!stillOk) {
          const {hour, minute} = parseSlotToParts(allowed[0]);
          next.setHours(hour, minute, 0, 0);
        }
        return next;
      });
    }
  };

  const handleConfirm = async () => {
    if (!appointment?.id) {
      Alert.alert('Error', 'Missing appointment reference.');
      return;
    }

    const scheduledAt = buildScheduleIsoUtc();
    const {date: dStr, time: tStr} = scheduledAtToLocalSlotDateTime(scheduledAt);
    if (dStr && tStr) {
      const dp = dStr.split('-').map(Number);
      const day = new Date(dp[0], dp[1] - 1, dp[2]);
      if (!isConsultationSlotInTheFuture(day, tStr)) {
        Alert.alert(
          'Invalid time',
          'That time has already passed. Please pick a later slot.',
        );
        return;
      }
    }

    try {
      setSubmitting(true);
      await rescheduleAppointment(appointment.id, scheduledAt, reason.trim());
      const whenLabel = `${scheduleAt.toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })}\n${scheduleAt.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}`;
      const reasonLine = reason.trim()
        ? `\n\nMessage to client:\n${reason.trim()}`
        : '';
      Alert.alert('Reschedule successful', `The new schedule is:\n\n${whenLabel}${reasonLine}`, [
        {
          text: 'Go to dashboard',
          onPress: () =>
            navigation.reset({
              index: 0,
              routes: [{name: 'AttyLandingPage'}],
            }),
        },
      ]);
    } catch (error) {
      Alert.alert('Error', error?.message ?? 'Unable to reschedule appointment.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    }
  };

  return (
    <ClientScreenShell>
      <View style={styles.overlay}>
      <ClientFadeIn>
      <View style={styles.modalContainer}>
        <View style={styles.dragHandle} />

        <ScrollView showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>Reschedule Appointment</Text>

          <View style={styles.infoBanner}>
            <Text style={styles.infoIcon}>ⓘ</Text>
            <Text style={styles.infoBannerText}>{appointmentTitle}</Text>
          </View>

          <Text style={styles.sectionLabel}>Select New Date</Text>
          <TouchableOpacity
            style={styles.datePicker}
            onPress={() => setShowDatePicker(true)}
            activeOpacity={0.85}>
            <Text style={styles.dateText}>{dateLabel}</Text>
            <Text style={styles.calendarIcon}>📅</Text>
          </TouchableOpacity>

          {showDatePicker && (
            <>
              <DateTimePicker
                value={scheduleAt}
                mode="date"
                display={IS_IOS ? 'spinner' : 'default'}
                onChange={onDateChange}
              />
              {IS_IOS && (
                <TouchableOpacity
                  style={styles.dateDoneBtn}
                  onPress={() => setShowDatePicker(false)}>
                  <Text style={styles.dateDoneText}>Done</Text>
                </TouchableOpacity>
              )}
            </>
          )}

          <Text style={styles.sectionLabel}>Select New Time Slot</Text>
          {attorneyId ? (
            <Text style={styles.timePolicy}>
              Only open times are shown — slots already booked by other clients are hidden.
            </Text>
          ) : null}
          <Text style={styles.timeHint}>
            {scheduleAt.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}
            {!matchingSlot ? ' (not on hourly grid — pick a slot below)' : ''}
          </Text>
          {slotsLoading && attorneyId ? (
            <ActivityIndicator color={T.gold[1]} style={{marginBottom: 16}} />
          ) : null}
          {selectableSlots.length === 0 ? (
            <Text style={styles.noSlotsText}>
              {slotsLoading
                ? 'Loading available times...'
                : 'No open times on this date. Choose another day or wait for availability.'}
            </Text>
          ) : (
            <View style={styles.timeGrid}>
              {selectableSlots.map(time => (
                <TouchableOpacity
                  key={time}
                  onPress={() => applyTimeSlot(time)}
                  style={[
                    styles.timeChip,
                    matchingSlot === time && styles.timeChipSelected,
                  ]}>
                  <Text
                    style={[
                      styles.timeChipText,
                      matchingSlot === time && styles.timeChipTextSelected,
                    ]}>
                    {time}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <Text style={styles.sectionLabel}>Reason for Rescheduling (Optional)</Text>
          <TextInput
            style={styles.textArea}
            placeholder="e.g. Schedule conflict, family emergency..."
            placeholderTextColor={T.textSoft}
            multiline
            numberOfLines={4}
            value={reason}
            onChangeText={setReason}
          />

          <View style={styles.policyBox}>
            <Text style={styles.policyIcon}>ⓘ</Text>
            <Text style={styles.policyText}>
              Note: Rescheduling is subject to attorney availability and may require 24h notice.
            </Text>
          </View>

          <TouchableOpacity
            style={styles.confirmButton}
            onPress={handleConfirm}
            disabled={submitting || selectableSlots.length === 0 || slotsLoading}>
            {submitting ? (
              <ActivityIndicator color={T.base} />
            ) : (
              <Text style={styles.confirmButtonText}>Confirm Reschedule</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.cancelButton} onPress={handleCancel}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
      </ClientFadeIn>
      </View>
    </ClientScreenShell>
  );
}

const styles = StyleSheet.create({
  overlay: {flex: 1, justifyContent: 'flex-end'},
  modalContainer: {
    backgroundColor: 'rgba(18, 26, 36, 0.98)',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingBottom: 40,
    maxHeight: '90%',
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.15)',
  },
  dragHandle: {
    width: 45,
    height: 5,
    backgroundColor: 'rgba(244, 215, 139, 0.25)',
    borderRadius: 3,
    alignSelf: 'center',
    marginVertical: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: T.text,
    marginBottom: 16,
  },
  infoBanner: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.05)',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.12)',
    alignItems: 'center',
    marginBottom: 24,
  },
  infoIcon: {marginRight: 8, color: T.textSoft},
  infoBannerText: {color: T.textMuted, fontSize: 14, flex: 1},
  sectionLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: T.gold[0],
    marginBottom: 12,
  },
  timeHint: {
    fontSize: 13,
    color: T.textSoft,
    marginBottom: 10,
  },
  timePolicy: {
    fontSize: 12,
    color: T.textMuted,
    marginBottom: 8,
    lineHeight: 17,
  },
  noSlotsText: {
    fontSize: 14,
    color: '#F87171',
    fontWeight: '600',
    marginBottom: 16,
  },
  datePicker: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.2)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
  },
  dateText: {fontSize: 16, color: '#93C5FD', flex: 1},
  dateDoneBtn: {
    alignSelf: 'flex-end',
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  dateDoneText: {fontSize: 16, fontWeight: '700', color: T.gold[0]},
  calendarIcon: {fontSize: 16},
  timeGrid: {flexDirection: 'row', flexWrap: 'wrap', marginBottom: 24},
  timeChip: {
    width: '31%',
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.15)',
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 10,
    marginRight: '2%',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  timeChipSelected: {backgroundColor: T.gold[1], borderColor: T.gold[1]},
  timeChipText: {color: T.text, fontWeight: '500'},
  timeChipTextSelected: {color: T.base},
  textArea: {
    backgroundColor: 'rgba(4, 7, 11, 0.45)',
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.15)',
    borderRadius: 12,
    padding: 16,
    height: 100,
    textAlignVertical: 'top',
    marginBottom: 24,
    color: T.text,
  },
  policyBox: {
    flexDirection: 'row',
    backgroundColor: 'rgba(59, 130, 246, 0.12)',
    padding: 16,
    borderRadius: 12,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(96, 165, 250, 0.2)',
  },
  policyIcon: {color: '#93C5FD', fontWeight: 'bold', marginRight: 10},
  policyText: {color: '#93C5FD', fontSize: 13, flex: 1, fontWeight: '600', lineHeight: 18},
  confirmButton: {
    backgroundColor: T.gold[1],
    paddingVertical: 18,
    borderRadius: 12,
    marginBottom: 12,
    shadowColor: 'rgba(212, 175, 55, 0.45)',
    shadowOpacity: 0.35,
    shadowOffset: {width: 0, height: 4},
    shadowRadius: 8,
  },
  confirmButtonText: {color: T.base, textAlign: 'center', fontWeight: 'bold', fontSize: 16},
  cancelButton: {
    paddingVertical: 18,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.2)',
  },
  cancelButtonText: {color: T.textSoft, textAlign: 'center', fontWeight: '600'},
});
