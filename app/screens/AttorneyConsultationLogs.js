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
  formatScheduledAtDisplay,
  getMyAppointments,
  isAppointmentCompleted,
  parseAppointmentScheduleMs,
} from '../services/appointmentService';
import {ClientScreenShell} from '../components/ClientScreenShell';
import {REFERENCE_THEME as T} from '../constants/referenceTheme';

const accentGold = T.gold[1];

export default function AttorneyConsultationLogs({navigation}) {
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
      String(name || 'C')
        .trim()[0]?.toUpperCase() || 'C',
    [],
  );

  return (
    <ClientScreenShell edges={['top']}>
      <View style={styles.navHeader}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => (navigation.canGoBack() ? navigation.goBack() : null)}>
          <MaterialCommunityIcons name="chevron-left" size={28} color={T.text} />
        </TouchableOpacity>
        <Text style={styles.navTitle}>Logs</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.subTitle}>Completed consultations</Text>

        {loading ? (
          <View style={styles.centerBox}>
            <ActivityIndicator color={accentGold} />
            <Text style={styles.muted}>Loading...</Text>
          </View>
        ) : items.length === 0 ? (
          <View style={styles.centerBox}>
            <Text style={styles.muted}>No completed consultations yet.</Text>
          </View>
        ) : (
          items.map(item => {
            const {date, time} = formatScheduledAtDisplay(
              item.scheduled_at || item.updated_at || item.created_at,
            );
            const name = item.client_name ?? 'Client';
            const displayTime = time === '—' ? '--:--' : time;
            const displayDate = date === '—' ? 'No schedule' : date;
            return (
              <View key={item.id} style={styles.consultItem}>
                <View style={styles.consultAvatar}>
                  <Text style={styles.avatarTxt}>{initialsFor(name)}</Text>
                </View>
                <View style={styles.consultMain}>
                  <Text style={styles.consultName} numberOfLines={1}>
                    {name}
                  </Text>
                  <Text style={styles.consultSub}>{String(item.title ?? 'Consultation').toUpperCase()}</Text>
                  <Text style={styles.consultDate}>{displayDate}</Text>
                  <TouchableOpacity
                    activeOpacity={0.9}
                    style={styles.transcriptWrap}
                    onPress={() =>
                      navigation.navigate('ConsultationTranscript', {
                        appointmentId: item.id,
                        title: name,
                        initials: String(name)
                          .split(' ')
                          .filter(Boolean)
                          .slice(0, 2)
                          .map(p => p[0]?.toUpperCase())
                          .join('')
                          .slice(0, 2) || 'C',
                      })
                    }>
                    <LinearGradient colors={[T.gold[0], T.gold[1]]} style={styles.transcriptBtn}>
                      <Text style={styles.transcriptBtnText}>View Transcript</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                </View>
                <View style={styles.consultMeta}>
                  <View style={styles.statusPill}>
                    <Text style={styles.statusText}>COMPLETED</Text>
                  </View>
                  <Text style={styles.consultTime}>{displayTime}</Text>
                </View>
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
  scrollContent: {padding: 20, paddingBottom: 40},
  subTitle: {color: T.textMuted, fontSize: 14, marginBottom: 16},
  centerBox: {paddingVertical: 28, alignItems: 'center'},
  muted: {color: T.textMuted, fontSize: 13, marginTop: 8},
  consultItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(12, 19, 30, 0.86)',
    padding: 16,
    borderRadius: 20,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.04)',
  },
  consultAvatar: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.05)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarTxt: {color: T.text, fontWeight: '900', fontSize: 18},
  consultMain: {flex: 1, marginLeft: 14, minWidth: 0},
  consultName: {color: T.text, fontSize: 15, fontWeight: '800'},
  consultSub: {color: T.textSoft, fontSize: 9, marginTop: 2},
  consultDate: {color: T.textMuted, fontSize: 10, marginTop: 4},
  consultMeta: {alignItems: 'flex-end'},
  statusPill: {
    backgroundColor: 'rgba(215, 177, 74, 0.1)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusText: {color: accentGold, fontSize: 9, fontWeight: '900'},
  consultTime: {color: T.textMuted, fontSize: 10, marginTop: 8},
  transcriptWrap: {marginTop: 10, borderRadius: 12, overflow: 'hidden', alignSelf: 'stretch'},
  transcriptBtn: {
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 12,
  },
  transcriptBtnText: {color: '#101B2C', fontWeight: '800', fontSize: 12},
});
