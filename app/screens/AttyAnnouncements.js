import React, {useCallback, useEffect, useState} from 'react';
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {MaterialCommunityIcons} from '@expo/vector-icons';
import AttorneyScreenHeader from '../components/AttorneyScreenHeader';
import {ClientScreenShell} from '../components/ClientScreenShell';
import {REFERENCE_THEME as T} from '../constants/referenceTheme';
import {fetchAttorneyAnnouncementsData, getCurrentSessionProfile} from '../services/userApi';

const accentGold = T.gold[1];

const tagStyle = (tag) => {
  const t = String(tag || '').toLowerCase();
  if (t.includes('important')) return {bg: 'rgba(220, 38, 38, 0.15)', color: '#FCA5A5'};
  if (t.includes('maintenance')) return {bg: 'rgba(202, 138, 4, 0.15)', color: '#FDE047'};
  if (t.includes('feature')) return {bg: 'rgba(37, 99, 235, 0.15)', color: '#93C5FD'};
  if (t.includes('reminder')) return {bg: 'rgba(168, 85, 247, 0.15)', color: '#D8B4FE'};
  return {bg: 'rgba(22, 163, 74, 0.15)', color: '#86EFAC'};
};

export default function AttyAnnouncements({navigation}) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState(null);

  const load = useCallback(async () => {
    setError('');
    try {
      setLoading(true);
      const {profile} = await getCurrentSessionProfile();
      if (!profile?.id) {
        setRows([]);
        return;
      }
      const data = await fetchAttorneyAnnouncementsData(profile.id);
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

  return (
    <ClientScreenShell edges={['top']}>
      <AttorneyScreenHeader
        navigation={navigation}
        title="Announcement"
        subtitle="Updates from LegalLink Admin"
        activeRoute="AttyAnnouncements"
      />

      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        <View style={styles.intro}>
          <MaterialCommunityIcons name="bullhorn-outline" size={22} color={accentGold} />
          <Text style={styles.introTitle}>Announcements</Text>
        </View>
        <Text style={styles.introSub}>
          Stay updated with the latest news and updates from LegalLink Admin.
        </Text>

        {error ? <Text style={styles.errText}>{error}</Text> : null}

        {loading ? (
          <ActivityIndicator color={accentGold} style={{marginTop: 24}} />
        ) : rows.length === 0 ? (
          <Text style={styles.empty}>No announcements yet.</Text>
        ) : (
          rows.map((item) => {
            const tc = tagStyle(item.tag);
            const isExpanded = expandedId === item.id;
            const body = item.body || '';
            const canToggle = body.length > 150;

            return (
              <View
                key={item.id}
                style={[styles.card, item.pinned && styles.cardPinned]}>
                <View style={styles.cardTop}>
                  <View style={styles.tagRow}>
                    {item.pinned ? (
                      <View style={styles.pinnedTag}>
                        <MaterialCommunityIcons name="pin" size={12} color="#F87171" />
                        <Text style={styles.pinnedTagText}>Pinned</Text>
                      </View>
                    ) : null}
                    {item.tag ? (
                      <View style={[styles.tag, {backgroundColor: tc.bg}]}>
                        <Text style={[styles.tagText, {color: tc.color}]}>{item.tag}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.meta}>
                    {item.date} · {item.time}
                  </Text>
                </View>
                <Text style={styles.title}>{item.title || 'Announcement'}</Text>
                {item.imageUrl ? (
                  <Image
                    source={{uri: item.imageUrl}}
                    style={styles.announcementImage}
                    resizeMode="cover"
                  />
                ) : null}
                <Text style={styles.body} numberOfLines={isExpanded ? undefined : 4}>
                  {body}
                </Text>
                {canToggle ? (
                  <TouchableOpacity
                    onPress={() => setExpandedId(isExpanded ? null : item.id)}
                    activeOpacity={0.85}>
                    <Text style={styles.toggle}>{isExpanded ? 'Show Less' : 'Read More'}</Text>
                  </TouchableOpacity>
                ) : null}
                <Text style={styles.author}>
                  Posted by <Text style={styles.authorStrong}>{item.author || 'LegalLink Admin'}</Text>
                </Text>
              </View>
            );
          })
        )}
      </ScrollView>
    </ClientScreenShell>
  );
}

const styles = StyleSheet.create({
  list: {padding: 20, paddingBottom: 32},
  intro: {flexDirection: 'row', alignItems: 'center', gap: 8},
  introTitle: {fontSize: 22, fontWeight: '900', color: T.text},
  introSub: {color: T.textMuted, fontSize: 13, marginTop: 6, marginBottom: 16, lineHeight: 20},
  errText: {color: '#FCA5A5', marginBottom: 12},
  empty: {color: T.textMuted, textAlign: 'center', marginTop: 24},
  card: {
    backgroundColor: 'rgba(12, 19, 30, 0.92)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.12)',
  },
  cardPinned: {borderColor: 'rgba(248, 113, 113, 0.35)'},
  cardTop: {marginBottom: 10},
  tagRow: {flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8},
  pinnedTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(248, 113, 113, 0.12)',
  },
  pinnedTagText: {color: '#F87171', fontSize: 10, fontWeight: '800'},
  tag: {paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8},
  tagText: {fontSize: 10, fontWeight: '800'},
  meta: {color: T.textMuted, fontSize: 11},
  title: {fontSize: 17, fontWeight: '800', color: T.text, marginBottom: 8},
  announcementImage: {
    width: '100%',
    height: 160,
    borderRadius: 12,
    marginBottom: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  body: {color: T.textSoft, fontSize: 14, lineHeight: 21},
  toggle: {color: accentGold, fontWeight: '800', fontSize: 12, marginTop: 8},
  author: {color: T.textMuted, fontSize: 11, marginTop: 12},
  authorStrong: {color: T.text, fontWeight: '800'},
});
