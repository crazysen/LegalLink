import React, {useCallback, useState} from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {LinearGradient} from 'expo-linear-gradient';
import AttorneyScreenHeader from '../components/AttorneyScreenHeader';
import {fetchAttorneyConsultationLogs, getCurrentSessionProfile} from '../services/userApi';
import {useAttorneyLiveRefresh} from '../hooks/useAttorneyLiveRefresh';
import {ClientScreenShell} from '../components/ClientScreenShell';
import {REFERENCE_THEME as T} from '../constants/referenceTheme';

const accentGold = T.gold[1];

export default function AttorneyConsultationLogs({navigation}) {
  const [attorneyId, setAttorneyId] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async (options = {}) => {
    const silent = Boolean(options?.silent);
    if (!silent) setLoading(true);
    setLoadError('');
    try {
      const {profile} = await getCurrentSessionProfile();
      const userId = profile?.id;
      setAttorneyId(userId || null);
      if (!userId) {
        setItems([]);
        return;
      }
      const rows = await fetchAttorneyConsultationLogs(userId, {force: true, ...options});
      setItems(Array.isArray(rows) ? rows : []);
    } catch (error) {
      setItems([]);
      setLoadError(error?.message || 'Unable to load consultation logs.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useAttorneyLiveRefresh({attorneyId, reload: load, pollMs: 15000});

  const openTranscript = item => {
    const name = item.clientName ?? 'Client';
    navigation.navigate('ConsultationTranscript', {
      appointmentId: item.id,
      title: name,
      attorneyReviewMode: true,
      logTitle: item.title,
      initials: String(name)
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map((p) => p[0]?.toUpperCase())
        .join('')
        .slice(0, 2) || 'C',
    });
  };

  return (
    <ClientScreenShell edges={['top']}>
      <AttorneyScreenHeader
        navigation={navigation}
        title="Logs"
        subtitle="Completed consultations"
        activeRoute="AttorneyConsultationLogs"
      />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {loadError ? <Text style={styles.errorText}>{loadError}</Text> : null}

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
          items.map((item) => {
            const name = item.clientName ?? 'Client';
            return (
              <View key={item.id} style={styles.consultItem}>
                <View style={styles.consultAvatar}>
                  <Text style={styles.avatarTxt}>
                    {String(name).trim()[0]?.toUpperCase() || 'C'}
                  </Text>
                </View>
                <View style={styles.consultMain}>
                  <Text style={styles.consultName} numberOfLines={1}>
                    {name}
                  </Text>
                  <Text style={styles.consultSub}>{String(item.title ?? 'Consultation').toUpperCase()}</Text>
                  <Text style={styles.consultDate}>{item.dateLabel || 'No schedule'}</Text>
                  <TouchableOpacity activeOpacity={0.9} style={styles.transcriptWrap} onPress={() => openTranscript(item)}>
                    <LinearGradient colors={[T.gold[0], T.gold[1]]} style={styles.transcriptBtn}>
                      <Text style={styles.transcriptBtnText}>View Transcript</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                </View>
                <View style={styles.consultMeta}>
                  <View style={styles.statusPill}>
                    <Text style={styles.statusText}>COMPLETED</Text>
                  </View>
                  <Text style={styles.consultTime}>{item.timeLabel || '--:--'}</Text>
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
  scrollContent: {padding: 20, paddingBottom: 40},
  errorText: {color: '#FCA5A5', marginBottom: 12},
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
  transcriptBtn: {paddingVertical: 10, alignItems: 'center', borderRadius: 12},
  transcriptBtnText: {color: '#101B2C', fontWeight: '800', fontSize: 12},
});
