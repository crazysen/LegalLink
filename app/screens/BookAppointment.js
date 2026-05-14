import React, {useCallback, useEffect, useState, useMemo} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {MaterialCommunityIcons} from '@expo/vector-icons';
import {getAttorneys} from '../services/attorneyService';
import {REFERENCE_THEME as T} from '../constants/referenceTheme';
import {ClientScreenShell, ClientFadeIn} from '../components/ClientScreenShell';
import ClientChevronBack from '../components/ClientChevronBack';

const ATTORNEYS_CACHE_KEY = 'book_attorneys_cache_v3';
const ATTORNEYS_CACHE_TTL_MS = 5 * 60 * 1000;

/** Back column + gap so subtitle aligns with title text, not the chevron. */
const HEADER_BACK_COL = 28;
const HEADER_BACK_GAP = 8;
const SUBTITLE_INDENT = HEADER_BACK_COL + HEADER_BACK_GAP;

function initialsFromName(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) {
    return '?';
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatSpecialties(raw) {
  if (Array.isArray(raw)) {
    const s = raw.map(x => String(x || '').trim()).filter(Boolean);
    return s.length ? s.join(', ') : 'General Practice';
  }
  if (typeof raw === 'string' && raw.trim()) {
    return raw.trim();
  }
  return 'General Practice';
}

function AttorneyAvatar({uri, name}) {
  const initials = useMemo(() => initialsFromName(name), [name]);
  const [failed, setFailed] = useState(false);
  const showPlaceholder = !uri || failed;

  if (showPlaceholder) {
    return (
      <View style={[styles.avatar, styles.avatarPlaceholder]}>
        <Text style={styles.avatarInitials}>{initials}</Text>
      </View>
    );
  }

  return (
    <Image
      source={{uri}}
      style={styles.avatar}
      onError={() => setFailed(true)}
    />
  );
}

/** Matches web Book Appointment: dark card, photo, name + star, scales + specialty, rating line, white price, dark Book / outline View. */
const AttorneyCard = ({item, navigation}) => (
  <View style={styles.card}>
    <View style={styles.profileContainer}>
      <AttorneyAvatar uri={item.avatarUri} name={item.name} />
    </View>

    <View style={styles.infoContainer}>
      <View style={styles.nameRow}>
        <Text style={styles.nameText} numberOfLines={2}>
          {item.name}
        </Text>
        {item.isVerified ? (
          <MaterialCommunityIcons
            name="check-decagram"
            size={17}
            color={T.gold[0]}
            style={styles.nameStar}
            accessibilityLabel="Verified attorney"
          />
        ) : null}
      </View>

      <View style={styles.specialtyRow}>
        <MaterialCommunityIcons
          name="scale-balance"
          size={15}
          color={T.textSoft}
          style={styles.specialtyIcon}
        />
        <Text style={styles.specialtyText}>{item.specialty}</Text>
      </View>

      <Text style={styles.experienceText}>{item.experience}</Text>

      <Text style={styles.ratingLine}>{item.ratingLine}</Text>

      <Text style={styles.priceText}>{item.price}</Text>

      <TouchableOpacity
        style={styles.bookButton}
        activeOpacity={0.88}
        onPress={() => navigation.navigate('BookNow', {attorney: item})}>
        <Text style={styles.bookButtonText}>Book Now</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.profileButton}
        activeOpacity={0.88}
        onPress={() =>
          navigation.navigate('AttorneyProfile', {
            attorney: {
              ...item,
              reviews: '128',
              isVerified: item.isVerified,
            },
          })
        }>
        <Text style={styles.profileButtonText}>View Profile</Text>
      </TouchableOpacity>
    </View>
  </View>
);

export default function BookAppointment({navigation}) {
  const [attorneys, setAttorneys] = useState([]);
  const [loading, setLoading] = useState(true);

  const mapRecords = useCallback(records => {
    return (Array.isArray(records) ? records : []).map(record => {
      const name =
        (record.cms_display_name && String(record.cms_display_name).trim()) ||
        record.full_name ||
        record.email ||
        'Attorney';
      const rawUrl = String(
        record.cms_profile_image_url || record.avatar_url || '',
      ).trim();
      const avg = record.avg_rating;
      const ratingNum =
        avg != null && Number.isFinite(Number(avg)) ? Number(avg) : null;
      const slots = Number(record.open_slots_count) || 0;
      const ratingLine = `★ ${ratingNum != null ? ratingNum.toFixed(1) : '5.0'} - ${slots} slot${slots === 1 ? '' : 's'} open`;
      const feeNum = Number(record.consultation_fee);
      const price = Number.isFinite(feeNum)
        ? `PHP ${feeNum.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}`
        : 'PHP 2,500.00';

      return {
        id: record.id,
        name,
        specialty: formatSpecialties(record.specialties),
        experience: record.years_experience
          ? `${record.years_experience} years experience`
          : 'Experience not set',
        ratingLine,
        price,
        avatarUri: rawUrl || null,
        /** Alias for screens expecting `image` (e.g. AttorneyProfile). */
        image: rawUrl || null,
        isVerified: Boolean(record.is_verified),
      };
    });
  }, []);

  const loadAttorneys = useCallback(async () => {
    let usedCache = false;
    try {
      const raw = await AsyncStorage.getItem(ATTORNEYS_CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (
          parsed?.data &&
          Array.isArray(parsed.data) &&
          parsed.data.length > 0 &&
          Date.now() - (parsed.ts || 0) < ATTORNEYS_CACHE_TTL_MS
        ) {
          setAttorneys(parsed.data);
          setLoading(false);
          usedCache = true;
        }
      }
      if (!usedCache) {
        setLoading(true);
      }

      const records = await getAttorneys();
      const mapped = mapRecords(records);
      setAttorneys(mapped);
      await AsyncStorage.setItem(
        ATTORNEYS_CACHE_KEY,
        JSON.stringify({ts: Date.now(), data: mapped}),
      );
    } catch (error) {
      if (!usedCache) {
        Alert.alert('Error', error?.message ?? 'Failed to load attorneys.');
        setAttorneys([]);
      }
    } finally {
      setLoading(false);
    }
  }, [mapRecords]);

  useEffect(() => {
    loadAttorneys();
  }, [loadAttorneys]);

  return (
    <ClientScreenShell>
      <ClientFadeIn>
        <View style={styles.header}>
          <View style={styles.titleRow}>
            <View style={styles.backColumn}>
              <ClientChevronBack
                onPress={() => (navigation.canGoBack() ? navigation.goBack() : null)}
              />
            </View>
            <Text style={styles.mainTitle} numberOfLines={2}>
              Book an Appointment
            </Text>
          </View>
          <Text style={styles.subtitle}>
            Select an attorney and book from their available time slots.
          </Text>
        </View>
      </ClientFadeIn>

      {loading ? (
        <View style={styles.emptyContainer}>
          <ActivityIndicator color={T.gold[1]} />
          <Text style={styles.emptyText}>Loading attorney directory...</Text>
        </View>
      ) : attorneys.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>No attorneys found yet.</Text>
        </View>
      ) : (
        <FlatList
          style={styles.listFlex}
          data={attorneys}
          keyExtractor={item => item.id}
          renderItem={({item, index}) => (
            <ClientFadeIn delay={80 + index * 50}>
              <AttorneyCard item={item} navigation={navigation} />
            </ClientFadeIn>
          )}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          initialNumToRender={8}
          maxToRenderPerBatch={10}
          windowSize={7}
          removeClippedSubviews
        />
      )}
    </ClientScreenShell>
  );
}

const styles = StyleSheet.create({
  listFlex: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backColumn: {
    width: HEADER_BACK_COL,
    marginRight: HEADER_BACK_GAP,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  mainTitle: {
    flex: 1,
    fontSize: 28,
    fontWeight: '800',
    color: T.text,
    lineHeight: 34,
  },
  subtitle: {
    fontSize: 14,
    color: T.textSoft,
    marginTop: 6,
    marginLeft: SUBTITLE_INDENT,
    lineHeight: 20,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  emptyText: {marginTop: 8, color: T.textSoft, fontSize: 14, textAlign: 'center'},
  card: {
    backgroundColor: 'rgba(15, 23, 42, 0.92)',
    borderRadius: 16,
    paddingVertical: 22,
    paddingHorizontal: 20,
    marginBottom: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.18)',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 8},
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 4,
  },
  profileContainer: {
    marginBottom: 14,
  },
  avatar: {
    width: 108,
    height: 108,
    borderRadius: 54,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 2,
    borderColor: 'rgba(148, 163, 184, 0.25)',
  },
  avatarPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(30, 58, 138, 0.35)',
  },
  avatarInitials: {
    color: T.gold[0],
    fontSize: 32,
    fontWeight: '800',
  },
  infoContainer: {
    alignItems: 'center',
    width: '100%',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    marginBottom: 8,
    paddingHorizontal: 4,
    gap: 6,
  },
  nameText: {
    fontSize: 17,
    fontWeight: '800',
    color: T.text,
    textAlign: 'center',
    flexShrink: 1,
  },
  nameStar: {marginTop: 2},
  specialtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
    paddingHorizontal: 8,
    gap: 6,
  },
  specialtyIcon: {marginTop: 1},
  specialtyText: {
    fontSize: 13,
    color: T.textMuted,
    fontWeight: '500',
    flexShrink: 1,
    textAlign: 'center',
  },
  experienceText: {
    fontSize: 12,
    color: T.textSoft,
    marginBottom: 10,
    fontWeight: '500',
  },
  ratingLine: {
    fontSize: 14,
    fontWeight: '600',
    color: T.text,
    marginBottom: 14,
    letterSpacing: 0.2,
  },
  priceText: {
    fontSize: 26,
    fontWeight: '800',
    color: T.text,
    marginBottom: 18,
    letterSpacing: 0.3,
  },
  bookButton: {
    backgroundColor: '#0f172a',
    width: '100%',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  bookButtonText: {
    color: T.text,
    fontWeight: '700',
    fontSize: 16,
    letterSpacing: 0.3,
  },
  profileButton: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.42)',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  profileButtonText: {
    color: T.text,
    fontWeight: '700',
    fontSize: 16,
    letterSpacing: 0.2,
  },
});
