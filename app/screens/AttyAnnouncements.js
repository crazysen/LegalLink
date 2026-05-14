import React, {useCallback, useEffect, useState} from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {MaterialCommunityIcons} from '@expo/vector-icons';
import {ClientScreenShell} from '../components/ClientScreenShell';
import ClientChevronBack from '../components/ClientChevronBack';
import {REFERENCE_THEME as T} from '../constants/referenceTheme';
import {supabase} from '../services/supabaseClient';
import {fetchAttorneyAnnouncementsData} from '../services/userApi';

export default function AttyAnnouncements({navigation}) {
  const goBack = () => {
    if (navigation?.canGoBack?.()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('AttyLandingPage');
  };
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      setLoading(true);
      const {
        data: {user},
      } = await supabase.auth.getUser();
      if (!user?.id) {
        setRows([]);
        return;
      }
      const data = await fetchAttorneyAnnouncementsData(user.id);
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e?.message || 'Unable to load announcements.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const renderItem = ({item}) => (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <MaterialCommunityIcons name="bullhorn-outline" size={20} color={T.gold[1]} />
        <Text style={styles.title} numberOfLines={2}>
          {item.title || 'Announcement'}
        </Text>
      </View>
      {item.tag ? (
        <View style={styles.tagWrap}>
          <Text style={styles.tag}>{item.tag}</Text>
        </View>
      ) : null}
      <Text style={styles.body}>{item.body || ''}</Text>
      <Text style={styles.meta}>
        {item.date} · {item.time}
      </Text>
    </View>
  );

  return (
    <ClientScreenShell edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <ClientChevronBack style={styles.backHit} onPress={goBack} />
        <View style={styles.headerTextWrap}>
          <Text style={styles.headerTitle}>Announcements</Text>
          <Text style={styles.headerSub}>Updates from BatasMo Admin</Text>
        </View>
      </View>
      {error ? (
        <Text style={styles.errText}>{error}</Text>
      ) : null}
      {loading ? (
        <ActivityIndicator color={T.gold[1]} style={{marginTop: 24}} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={item => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={styles.empty}>No announcements yet.</Text>
          }
        />
      )}
    </ClientScreenShell>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  backHit: {marginRight: 8},
  headerTextWrap: {flex: 1},
  headerTitle: {
    color: T.text,
    fontSize: 22,
    fontWeight: '800',
  },
  headerSub: {
    color: T.textSoft,
    fontSize: 12,
    marginTop: 4,
  },
  errText: {color: '#f87171', paddingHorizontal: 20, marginTop: 8},
  list: {padding: 16, paddingBottom: 32},
  card: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.12)',
  },
  cardTop: {flexDirection: 'row', alignItems: 'flex-start', gap: 10},
  title: {
    flex: 1,
    color: T.text,
    fontSize: 16,
    fontWeight: '700',
  },
  tagWrap: {marginTop: 8},
  tag: {
    alignSelf: 'flex-start',
    color: T.gold[0],
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: 'rgba(245,166,35,0.12)',
  },
  body: {color: T.textMuted, fontSize: 14, marginTop: 10, lineHeight: 20},
  meta: {color: T.textSoft, fontSize: 11, marginTop: 10},
  empty: {color: T.textSoft, textAlign: 'center', marginTop: 32},
});
