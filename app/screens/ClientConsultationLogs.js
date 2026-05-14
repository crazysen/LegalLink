import React, {useCallback, useMemo, useState} from 'react';
import {useFocusEffect} from '@react-navigation/native';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {LinearGradient} from 'expo-linear-gradient';
import {MaterialCommunityIcons} from '@expo/vector-icons';
import {
  getMyAppointments,
  isAppointmentCompleted,
  parseAppointmentScheduleMs,
} from '../services/appointmentService';
import {ClientScreenShell, ClientFadeIn} from '../components/ClientScreenShell';
import ClientChevronBack from '../components/ClientChevronBack';
import {REFERENCE_THEME as T} from '../constants/referenceTheme';

function formatDateTime(isoDateTime) {
  if (!isoDateTime) {
    return {date: 'No schedule', time: '--:--'};
  }
  const rawValue = String(isoDateTime).trim();
  const hasTimezoneInfo = /([zZ]|[+-]\d{2}:?\d{2})$/.test(rawValue);
  let dateValue;
  if (hasTimezoneInfo) {
    dateValue = new Date(rawValue.replace(' ', 'T').replace(/\+00$/, 'Z'));
  } else {
    const localMatch = rawValue.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
    if (localMatch) {
      dateValue = new Date(
        Number(localMatch[1]),
        Number(localMatch[2]) - 1,
        Number(localMatch[3]),
        Number(localMatch[4]),
        Number(localMatch[5]),
      );
    } else {
      dateValue = new Date(rawValue);
    }
  }
  if (!dateValue || Number.isNaN(dateValue.getTime())) {
    return {date: 'No schedule', time: '--:--'};
  }
  return {
    date: dateValue.toLocaleDateString(),
    time: dateValue.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}),
  };
}

export default function ClientConsultationLogs({navigation}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const records = await getMyAppointments({force: true});
      const list = Array.isArray(records) ? records : [];
      const completed = list.filter(isAppointmentCompleted);
      completed.sort((a, b) => {
        const ma = parseAppointmentScheduleMs(a);
        const mb = parseAppointmentScheduleMs(b);
        return (mb ?? 0) - (ma ?? 0);
      });
      setItems(completed);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const initialsFor = useMemo(
    () => name =>
      String(name || '?')
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map(p => p[0]?.toUpperCase())
        .join('')
        .slice(0, 2) || '?',
    [],
  );

  return (
    <ClientScreenShell>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ClientFadeIn>
          <ClientChevronBack
            style={styles.backHit}
            onPress={() => (navigation.canGoBack() ? navigation.goBack() : null)}
          />
          <Text style={styles.title}>Logs</Text>
          <Text style={styles.subtitle}>Completed consultations</Text>
        </ClientFadeIn>

        {loading ? (
          <View style={styles.emptyCard}>
            <ActivityIndicator color={T.gold[1]} />
            <Text style={styles.emptyText}>Loading...</Text>
          </View>
        ) : items.length === 0 ? (
          <View style={styles.emptyCard}>
            <MaterialCommunityIcons name="clipboard-text-outline" size={40} color="rgba(255,255,255,0.2)" />
            <Text style={styles.emptyTitle}>No completed consultations yet</Text>
            <Text style={styles.emptyText}>Finished sessions will appear here with a transcript.</Text>
          </View>
        ) : (
          items.map((item, index) => {
            const {date, time} = formatDateTime(item.scheduled_at);
            const attorneyName = item.attorney_name ?? 'Attorney';
            return (
              <ClientFadeIn key={item.id} delay={60 + index * 40}>
                <View style={styles.card}>
                  <View style={styles.cardRow}>
                    <View style={styles.dateBox}>
                      <MaterialCommunityIcons name="calendar" size={20} color={T.gold[1]} />
                      <Text style={styles.dateBoxText}>{date}</Text>
                    </View>
                    <View style={styles.cardMain}>
                      <Text style={styles.cardTitle}>{item.title ?? 'Consultation'}</Text>
                      <Text style={styles.cardSub}>{attorneyName}</Text>
                      <View style={styles.metaRow}>
                        <MaterialCommunityIcons name="clock-outline" size={14} color={T.textSoft} />
                        <Text style={styles.metaText}>{time}</Text>
                      </View>
                      <TouchableOpacity
                        activeOpacity={0.9}
                        onPress={() =>
                          navigation.navigate('ConsultationTranscript', {
                            appointmentId: item.id,
                            title: attorneyName,
                            initials: initialsFor(attorneyName),
                          })
                        }>
                        <LinearGradient colors={[T.gold[0], T.gold[1]]} style={styles.transcriptBtn}>
                          <Text style={styles.transcriptBtnText}>View Transcript</Text>
                        </LinearGradient>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              </ClientFadeIn>
            );
          })
        )}
      </ScrollView>
    </ClientScreenShell>
  );
}

const styles = StyleSheet.create({
  content: {padding: 20, paddingBottom: 40},
  backHit: {alignSelf: 'flex-start', marginBottom: 10},
  title: {fontSize: 28, fontWeight: '800', color: T.text},
  subtitle: {color: T.textSoft, marginBottom: 18, fontSize: 14},
  emptyCard: {
    borderRadius: 24,
    paddingVertical: 36,
    alignItems: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(244, 215, 139, 0.10)',
    backgroundColor: 'rgba(18, 26, 36, 0.62)',
  },
  emptyTitle: {marginTop: 10, color: T.text, fontSize: 16, fontWeight: '700'},
  emptyText: {marginTop: 6, color: T.textSoft, fontSize: 13, textAlign: 'center', paddingHorizontal: 16},
  card: {
    backgroundColor: 'rgba(18, 26, 36, 0.85)',
    borderRadius: 24,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.12)',
  },
  cardRow: {flexDirection: 'row'},
  dateBox: {
    width: 64,
    height: 72,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    marginRight: 12,
  },
  dateBoxText: {fontSize: 9, color: T.textSoft, marginTop: 4, textAlign: 'center'},
  cardMain: {flex: 1},
  cardTitle: {fontWeight: '700', fontSize: 15, color: T.text},
  cardSub: {fontSize: 11, color: T.textSoft, marginTop: 4},
  metaRow: {flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8, marginBottom: 10},
  metaText: {fontSize: 10, color: T.textMuted, fontWeight: '600'},
  transcriptBtn: {
    borderRadius: 14,
    paddingVertical: 10,
    alignItems: 'center',
  },
  transcriptBtnText: {color: T.base, fontWeight: '800', fontSize: 12},
});
