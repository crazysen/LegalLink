import React, {useCallback, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {LinearGradient} from 'expo-linear-gradient';
import AttorneyScreenHeader from '../components/AttorneyScreenHeader';
import {ClientScreenShell} from '../components/ClientScreenShell';
import {REFERENCE_THEME as T} from '../constants/referenceTheme';
import {
  fetchAttorneyUpcomingAppointments,
  getCurrentSessionProfile,
  isConsultationChatWindowOpen,
} from '../services/userApi';
import {useAttorneyLiveRefresh} from '../hooks/useAttorneyLiveRefresh';

const accentGold = T.gold[1];

function groupAppointments(appointments) {
  const now = new Date();
  const todayDate = now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const tomorrowDate = tomorrow.toDateString();
  const currentYear = now.getFullYear();

  const today = [];
  const nextDay = [];
  const week = [];

  appointments.forEach(appointment => {
    const parsed = new Date(appointment.scheduledAt || `${appointment.date} ${currentYear}`);
    if (Number.isNaN(parsed.getTime())) {
      week.push(appointment);
      return;
    }
    const apptDate = parsed.toDateString();
    if (apptDate === todayDate) {
      today.push(appointment);
    } else if (apptDate === tomorrowDate) {
      nextDay.push(appointment);
    } else {
      week.push(appointment);
    }
  });

  const sortBySchedule = rows =>
    rows.slice().sort((a, b) => {
      const aTime = new Date(a.scheduledAt || 0).getTime() || 0;
      const bTime = new Date(b.scheduledAt || 0).getTime() || 0;
      return aTime - bTime;
    });

  return {
    todayAppts: today,
    tomorrowAppts: sortBySchedule(nextDay),
    weekAppts: sortBySchedule(week),
  };
}

export default function AttyMyAppointments({navigation}) {
  const [attorneyId, setAttorneyId] = useState(null);
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);

  const loadAppointments = useCallback(async (options = {}) => {
    const silent = Boolean(options?.silent);
    if (!silent) setLoading(true);
    try {
      const {profile} = await getCurrentSessionProfile();
      const userId = profile?.id;
      setAttorneyId(userId || null);
      if (!userId) {
        setAppointments([]);
        return;
      }
      const rows = await fetchAttorneyUpcomingAppointments(userId, options);
      setAppointments(Array.isArray(rows) ? rows : []);
      setLastUpdatedAt(new Date());
    } catch (error) {
      if (!silent) {
        Alert.alert('Error', error?.message ?? 'Failed to load appointments.');
      }
      setAppointments([]);
    } finally {
      if (!silent) setLoading(false);
      if (silent) setRefreshing(false);
    }
  }, []);

  useAttorneyLiveRefresh({attorneyId, reload: loadAppointments, pollMs: 10000});

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadAppointments({force: true, silent: true});
  }, [loadAppointments]);

  const lastUpdatedLabel = lastUpdatedAt
    ? lastUpdatedAt.toLocaleTimeString('en-PH', {hour: 'numeric', minute: '2-digit'})
    : null;

  const {todayAppts, tomorrowAppts, weekAppts} = useMemo(
    () => groupAppointments(appointments),
    [appointments],
  );

  const renderCard = item => {
    const canEnter = isConsultationChatWindowOpen({
      status: item.status,
      scheduledAt: item.scheduledAt,
      slotDate: item.slotDate,
      slotTime: item.slotTime,
      paymentStatus: item.paymentStatus || 'unpaid',
    });

    return (
      <View key={item.id} style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={[styles.initialsBox, {backgroundColor: item.color || 'rgba(99,102,241,0.35)'}]}>
            <Text style={styles.initialsText}>{item.initials}</Text>
          </View>
          <View style={styles.cardMain}>
            <Text style={styles.name}>{item.name}</Text>
            <Text style={styles.specialty}>{item.area}</Text>
            <Text style={styles.scheduleText}>
              {item.date ? `${item.date} • ${item.time}` : item.time}
            </Text>
          </View>
          <View style={styles.statusBadge}>
            <Text style={styles.statusBadgeText}>{String(item.status || '').toUpperCase()}</Text>
          </View>
        </View>

        {item.concern ? <Text style={styles.notesText}>{item.concern}</Text> : null}

        <View style={styles.confirmedActionRow}>
          {item.attachmentUrl ? (
            <TouchableOpacity
              style={styles.fileBtn}
              onPress={() => Linking.openURL(item.attachmentUrl).catch(() => {})}>
              <Text style={styles.fileBtnText}>View file</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            style={styles.rescheduleBtn}
            onPress={() =>
              navigation.navigate('RescheduleAppointment', {
                appointment: {
                  id: item.id,
                  attorney_id: attorneyId,
                  name: item.name,
                  date: item.date,
                  time: item.time,
                  scheduled_at: item.scheduledAt,
                },
                returnRoute: 'AttyMyAppointments',
              })
            }>
            <Text style={styles.rescheduleBtnText}>Reschedule</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.consultBtn, !canEnter && styles.consultBtnDisabled]}
            disabled={!canEnter}
            onPress={() =>
              navigation.navigate('AttyConsultationMessage', {
                chatId: item.id,
                clientName: item.name,
                clientInitials: item.initials,
              })
            }>
            <LinearGradient
              colors={canEnter ? [T.gold[0], T.gold[1]] : ['#4B5563', '#374151']}
              style={styles.gradBtn}>
              <Text style={styles.gradBtnText}>Enter Consultation</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderSection = (title, items) => (
    <View key={title} style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.sectionCount}>{items.length}</Text>
      </View>
      {items.length ? items.map(renderCard) : (
        <Text style={styles.sectionEmpty}>No appointments in this group.</Text>
      )}
    </View>
  );

  return (
    <ClientScreenShell edges={['top']}>
      <AttorneyScreenHeader
        navigation={navigation}
        title="Consultation Management"
        subtitle="My Appointments"
        activeRoute="AttyMyAppointments"
      />

      <View style={styles.subHeader}>
        <Text style={styles.subTitle}>Upcoming client consultations sorted by date.</Text>
        {lastUpdatedLabel ? (
          <Text style={styles.syncText}>Last synced {lastUpdatedLabel}</Text>
        ) : null}
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={accentGold} />
        }>
        {loading ? (
          <View style={styles.emptyCard}>
            <ActivityIndicator color={accentGold} />
            <Text style={styles.emptyText}>Loading appointments...</Text>
          </View>
        ) : !appointments.length ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No upcoming appointments</Text>
            <Text style={styles.emptyText}>Confirmed consultations will appear here.</Text>
          </View>
        ) : (
          <>
            {renderSection('Today', todayAppts)}
            {renderSection('Tomorrow', tomorrowAppts)}
            {renderSection('This week', weekAppts)}
          </>
        )}
      </ScrollView>
    </ClientScreenShell>
  );
}

const styles = StyleSheet.create({
  subHeader: {paddingHorizontal: 20, marginTop: 4, marginBottom: 12},
  subTitle: {color: T.textMuted, fontSize: 14, lineHeight: 20},
  syncText: {color: T.textSoft, fontSize: 11, marginTop: 4},
  scrollContent: {paddingHorizontal: 20, paddingBottom: 30},
  section: {marginBottom: 20},
  sectionHeader: {flexDirection: 'row', alignItems: 'center', marginBottom: 10},
  sectionTitle: {fontSize: 16, fontWeight: '900', color: T.text, flex: 1},
  sectionCount: {color: accentGold, fontWeight: '800', fontSize: 12},
  sectionEmpty: {color: T.textMuted, fontSize: 13, marginBottom: 8},
  card: {
    backgroundColor: 'rgba(12, 19, 30, 0.92)',
    borderRadius: 20,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.12)',
  },
  cardHeader: {flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8},
  initialsBox: {
    width: 44,
    height: 44,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  initialsText: {color: '#fff', fontWeight: '900'},
  cardMain: {flex: 1, marginLeft: 12, marginRight: 8},
  name: {fontSize: 18, fontWeight: '800', color: T.text},
  specialty: {fontSize: 12, color: T.textMuted, marginTop: 2},
  scheduleText: {fontSize: 12, color: T.textSoft, marginTop: 4},
  statusBadge: {
    backgroundColor: 'rgba(215, 177, 74, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusBadgeText: {color: accentGold, fontSize: 9, fontWeight: '800'},
  notesText: {color: T.textSoft, fontSize: 13, marginBottom: 8},
  confirmedActionRow: {flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginTop: 8, gap: 8},
  fileBtn: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.25)',
  },
  fileBtnText: {color: accentGold, fontWeight: '800', fontSize: 11},
  rescheduleBtn: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(234, 179, 8, 0.95)',
  },
  rescheduleBtnText: {color: '#1E293B', fontWeight: '800', fontSize: 11},
  consultBtn: {flex: 1, minWidth: 140, borderRadius: 12, overflow: 'hidden'},
  consultBtnDisabled: {opacity: 0.7},
  gradBtn: {height: 44, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 12},
  gradBtnText: {color: '#101B2C', fontWeight: '800', fontSize: 12},
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
