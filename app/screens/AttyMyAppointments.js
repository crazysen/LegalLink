import React, {useCallback, useState} from 'react';
import {useFocusEffect} from '@react-navigation/native';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {LinearGradient} from 'expo-linear-gradient';
import {MaterialCommunityIcons} from '@expo/vector-icons';
import {
  formatAppointmentNotesForDisplay,
  getEffectiveAppointmentStatus,
  getMyAppointments,
  isAppointmentCompleted,
  isUpcomingBySchedule,
  parseAppointmentScheduleMs,
  updateAppointmentStatus,
} from '../services/appointmentService';
import {ClientScreenShell} from '../components/ClientScreenShell';
import {REFERENCE_THEME as T} from '../constants/referenceTheme';

const accentGold = T.gold[1];

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
    return {date: 'No schedule', time: '--:--'};
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
        Number(localMatch[5]),
      );
    } else {
      value = new Date(rawValue);
    }
  }

  if (!value || Number.isNaN(value.getTime())) {
    return {date: 'No schedule', time: '--:--'};
  }

  return {
    date: value.toLocaleDateString(),
    time: value.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}),
  };
}

function sortUpcomingNearestFirst(list) {
  return [...list].sort((a, b) => {
    const ma = parseAppointmentScheduleMs(a);
    const mb = parseAppointmentScheduleMs(b);
    const fa = ma ?? Number.MAX_SAFE_INTEGER;
    const fb = mb ?? Number.MAX_SAFE_INTEGER;
    return fa - fb;
  });
}

export default function AttyMyAppointments({navigation}) {
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadAppointments = useCallback(async () => {
    try {
      setLoading(true);
      const records = await getMyAppointments();
      const raw = Array.isArray(records) ? records : [];
      const upcoming = raw.filter(
        item =>
          !isAppointmentCompleted(item) && isUpcomingBySchedule(item),
      );
      setAppointments(sortUpcomingNearestFirst(upcoming));
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

  const handleStatusUpdate = async (appointmentId, status) => {
    try {
      await updateAppointmentStatus(appointmentId, status);
      await loadAppointments();
    } catch (error) {
      Alert.alert('Error', error?.message ?? 'Unable to update appointment status.');
    }
  };

  return (
    <ClientScreenShell edges={['top']}>
      <View style={styles.navHeader}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => (navigation.canGoBack() ? navigation.goBack() : null)}>
          <MaterialCommunityIcons name="chevron-left" size={28} color={T.text} />
        </TouchableOpacity>
        <Text style={styles.navTitle}>My Appointments</Text>
      </View>

      <View style={styles.subHeader}>
        <Text style={styles.subTitle}>Manage and track all your legal appointments</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {loading ? (
          <View style={styles.emptyCard}>
            <ActivityIndicator color={accentGold} />
            <Text style={styles.emptyText}>Loading appointments...</Text>
          </View>
        ) : appointments.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No appointment requests yet</Text>
            <Text style={styles.emptyText}>Paid and scheduled consultations will appear here.</Text>
          </View>
        ) : (
          appointments.map(item => {
            const effective = getEffectiveAppointmentStatus(item);
            const status = effective.toUpperCase();
            const {date, time} = formatDateTime(resolveScheduleValue(item));
            return (
              <View key={item.id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <View>
                    <Text style={styles.name}>{item.client_name ?? 'Client'}</Text>
                    <Text style={styles.specialty}>{item.title ?? 'Consultation'}</Text>
                  </View>
                  <View style={styles.statusBadge}>
                    <Text style={styles.statusBadgeText}>{status}</Text>
                  </View>
                </View>

                <View style={styles.metaRow}>
                  <Text style={styles.metaText}>
                    <MaterialCommunityIcons name="calendar" size={14} color={T.textMuted} /> {date}
                  </Text>
                  <Text style={[styles.metaText, {marginLeft: 16}]}>
                    <MaterialCommunityIcons name="clock-outline" size={14} color={T.textMuted} /> {time}
                  </Text>
                </View>

                <Text style={styles.notesText}>
                  {formatAppointmentNotesForDisplay(item.notes) || 'No notes provided'}
                </Text>

                {effective === 'pending' && (
                  <View style={styles.actionRow}>
                    <TouchableOpacity
                      style={[styles.actionButton, styles.rejectButton]}
                      onPress={() => handleStatusUpdate(item.id, 'CANCELLED')}>
                      <Text style={styles.rejectButtonText}>Reject</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.actionButton, styles.approveButton]}
                      onPress={() => handleStatusUpdate(item.id, 'CONFIRMED')}>
                      <Text style={styles.approveButtonText}>Approve</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {status === 'CONFIRMED' && (
                  <View style={styles.confirmedActionRow}>
                    <TouchableOpacity
                      style={[styles.consultBtn, styles.consultBtnHalf]}
                      onPress={() =>
                        navigation.navigate('AttyConsultationMessage', {
                          chatId: item.id,
                          clientName: item.client_name ?? 'Client',
                          clientInitials: (item.client_name ?? 'Client')
                            .split(' ')
                            .map(part => part[0])
                            .join('')
                            .slice(0, 2)
                            .toUpperCase(),
                        })
                      }>
                      <LinearGradient colors={[T.gold[0], T.gold[1]]} style={styles.gradBtn}>
                        <Text style={styles.gradBtnText}>Enter Consultation</Text>
                      </LinearGradient>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.rescheduleBtn}
                      onPress={() =>
                        navigation.navigate('RescheduleAppointment', {
                          appointment: {
                            id: item.id,
                            attorney_id: item.attorney_id,
                            name: item.client_name ?? 'Client',
                            date,
                            time,
                            scheduled_at: item.scheduled_at,
                          },
                          returnRoute: 'AttyMyAppointments',
                        })
                      }>
                      <Text style={styles.rescheduleBtnText}>Reschedule</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {status === 'RESCHEDULED' && (
                  <TouchableOpacity
                    style={styles.consultBtn}
                    onPress={() =>
                      navigation.navigate('AttyConsultationMessage', {
                        chatId: item.id,
                        clientName: item.client_name ?? 'Client',
                        clientInitials: (item.client_name ?? 'Client')
                          .split(' ')
                          .map(part => part[0])
                          .join('')
                          .slice(0, 2)
                          .toUpperCase(),
                      })
                    }>
                    <LinearGradient colors={[T.gold[0], T.gold[1]]} style={styles.gradBtn}>
                      <Text style={styles.gradBtnText}>View Messages</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                )}
              </View>
            );
          })
        )}
      </ScrollView>
    </ClientScreenShell>
  );
}

const styles = StyleSheet.create({
  navHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(244, 215, 139, 0.08)',
  },
  backBtn: {width: 44, height: 44, justifyContent: 'center'},
  navTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: T.text,
    marginLeft: 4,
  },
  subHeader: {paddingHorizontal: 20, marginTop: 8, marginBottom: 16},
  subTitle: {color: T.textMuted, fontSize: 14},
  scrollContent: {paddingHorizontal: 20, paddingBottom: 30},
  card: {
    backgroundColor: 'rgba(12, 19, 30, 0.92)',
    borderRadius: 20,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.12)',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  name: {fontSize: 18, fontWeight: '800', color: T.text},
  specialty: {fontSize: 14, color: T.textMuted, marginTop: 2},
  statusBadge: {
    backgroundColor: 'rgba(215, 177, 74, 0.15)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusBadgeText: {color: accentGold, fontSize: 10, fontWeight: '800'},
  metaRow: {flexDirection: 'row', flexWrap: 'wrap', marginBottom: 10},
  metaText: {color: T.textMuted, fontSize: 13},
  notesText: {color: T.textSoft, fontSize: 13},
  actionRow: {flexDirection: 'row', marginTop: 14},
  actionButton: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rejectButton: {backgroundColor: 'rgba(254, 226, 226, 0.95)', marginRight: 8},
  approveButton: {backgroundColor: 'rgba(220, 252, 231, 0.95)'},
  rejectButtonText: {color: '#B91C1C', fontWeight: '800'},
  approveButtonText: {color: '#166534', fontWeight: '800'},
  consultBtn: {
    marginTop: 14,
    borderRadius: 12,
    overflow: 'hidden',
  },
  gradBtn: {
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  gradBtnText: {color: '#101B2C', fontWeight: '800'},
  confirmedActionRow: {flexDirection: 'row', marginTop: 14},
  consultBtnHalf: {flex: 1, marginTop: 0, marginRight: 8},
  rescheduleBtn: {
    flex: 1,
    backgroundColor: 'rgba(234, 179, 8, 0.95)',
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rescheduleBtnText: {color: '#1E293B', fontWeight: '800'},
  emptyCard: {
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.15)',
    borderRadius: 16,
    backgroundColor: 'rgba(12, 19, 30, 0.6)',
    padding: 24,
    alignItems: 'center',
  },
  emptyTitle: {fontSize: 16, fontWeight: '800', color: T.text, marginBottom: 6},
  emptyText: {fontSize: 13, color: T.textMuted, textAlign: 'center'},
});
