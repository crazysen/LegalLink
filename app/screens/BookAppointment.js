import React, {useCallback, useEffect, useState, useMemo, useRef} from 'react';
import {useFocusEffect} from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {MaterialCommunityIcons} from '@expo/vector-icons';
import {
  fetchBookableAttorneys,
  getCurrentSessionProfile,
  subscribeToAvailabilitySlots,
} from '../services/userApi';
import {getBundledAttorneyPhotoSource} from '../constants/attorneyPhotos';
import {REFERENCE_THEME as T} from '../constants/referenceTheme';
import {ClientScreenShell, ClientFadeIn, ClientFadeInSoft} from '../components/ClientScreenShell';
import ClientChevronBack from '../components/ClientChevronBack';

const ATTORNEYS_CACHE_KEY = 'book_attorneys_cache_v8';
const ATTORNEYS_CACHE_TTL_MS = 5 * 60 * 1000;
const ATTORNEYS_POLL_MS = 10 * 1000;

const HEADER_BACK_COL = 28;
const HEADER_BACK_GAP = 8;
const SUBTITLE_INDENT = HEADER_BACK_COL + HEADER_BACK_GAP;

function initialsFromName(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .filter(p => !/^atty\.?$/i.test(p));
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function isPreventDoubleBookingFlagOn(raw, fallback = true) {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw !== 0;
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
  }
  return fallback;
}

/** Web `ba-card__photo` — bundled roster images first, then remote `img` URL. */
function AttorneyPhoto({uri, name, size = 88}) {
  const initials = useMemo(() => initialsFromName(name), [name]);
  const bundledSource = useMemo(() => getBundledAttorneyPhotoSource(name), [name]);
  const [failed, setFailed] = useState(false);
  const photoUri = uri && !failed && !bundledSource ? uri : null;
  const radius = size / 2;
  const frameStyle = [
    styles.avatar,
    {width: size, height: size, borderRadius: radius},
  ];

  if (bundledSource) {
    return (
      <Image
        source={bundledSource}
        style={frameStyle}
        resizeMode="cover"
        accessibilityLabel={`${name || 'Attorney'} photo`}
      />
    );
  }

  if (photoUri) {
    return (
      <Image
        source={{uri: photoUri}}
        style={frameStyle}
        resizeMode="cover"
        onError={() => setFailed(true)}
        accessibilityLabel={`${name || 'Attorney'} photo`}
      />
    );
  }

  return (
    <View style={[frameStyle, styles.avatarPlaceholder]}>
      <Text style={[styles.avatarInitials, size < 72 && {fontSize: 22}]}>{initials}</Text>
    </View>
  );
}

/** Web-aligned attorney card (mayy16 / BookAppointment.js). */
const AttorneyCard = ({item, navigation, onBookNow}) => {
  const slotCount = Array.isArray(item.availableSlots) ? item.availableSlots.length : 0;
  const zeroSlots = slotCount === 0;

  return (
    <View style={styles.card}>
      <AttorneyPhoto uri={item.img} name={item.name} size={88} />

      <View style={styles.nameRow}>
        <Text style={styles.nameText} numberOfLines={2}>
          {item.name}
        </Text>
        <MaterialCommunityIcons
          name="check-decagram"
          size={17}
          color={T.gold[0]}
          style={styles.nameStar}
        />
      </View>

      <View style={styles.specialtyRow}>
        <MaterialCommunityIcons name="scale-balance" size={15} color={T.textSoft} />
        <Text style={styles.specialtyText} numberOfLines={2}>
          {item.specialty}
        </Text>
      </View>

      <Text style={styles.experienceText}>{item.exp}</Text>

      <Text style={styles.ratingLine}>
        {slotCount} slot{slotCount === 1 ? '' : 's'} open
      </Text>

      <Text style={styles.priceText}>{item.price}</Text>

      <TouchableOpacity
        style={styles.bookButton}
        activeOpacity={0.88}
        onPress={() => onBookNow(item)}
        accessibilityHint={
          zeroSlots
            ? 'Open to check available dates and slots.'
            : 'Book a consultation with this attorney.'
        }>
        <Text style={styles.bookButtonText}>Book Now</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.profileButton}
        activeOpacity={0.88}
        onPress={() =>
          navigation.navigate('AttorneyProfile', {
            attorney: item,
          })
        }>
        <Text style={styles.profileButtonText}>View Profile</Text>
      </TouchableOpacity>
    </View>
  );
};

export default function BookAppointment({navigation}) {
  const [attorneys, setAttorneys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const disposedRef = useRef(false);

  const mapWebAttorneys = useCallback(rows => {
    return (Array.isArray(rows) ? rows : []).map(row => ({
      ...row,
      specialty: row.specialty || row.specialties?.[0] || 'General Practice',
      img: row.img,
      image: row.img,
      avatarUri: row.img,
      verified: Boolean(row.verified),
      isVerified: Boolean(row.verified),
    }));
  }, []);

  const loadAttorneys = useCallback(async (options = {}) => {
    const silent = Boolean(options?.silent);
    let usedCache = false;

    try {
      if (!silent) {
        setLoading(true);
      }

      if (!silent) {
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
      }

      const rows = await fetchBookableAttorneys({concern: '', onlyVerified: false});
      if (disposedRef.current) return;

      const mapped = mapWebAttorneys(rows);
      setAttorneys(mapped);
      setLoadError('');
      await AsyncStorage.setItem(
        ATTORNEYS_CACHE_KEY,
        JSON.stringify({ts: Date.now(), data: mapped}),
      );
    } catch (error) {
      if (disposedRef.current) return;
      const message = error?.message ?? 'Unable to load attorneys.';
      setLoadError(message);
      if (!silent && !usedCache) {
        setAttorneys([]);
      }
    } finally {
      if (!disposedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [mapWebAttorneys]);

  useEffect(() => {
    disposedRef.current = false;
    loadAttorneys();

    const pollId = setInterval(() => {
      loadAttorneys({silent: true});
    }, ATTORNEYS_POLL_MS);

    const unsubscribeSlots = subscribeToAvailabilitySlots(() => {
      loadAttorneys({silent: true});
    });

    return () => {
      disposedRef.current = true;
      clearInterval(pollId);
      unsubscribeSlots();
    };
  }, [loadAttorneys]);

  useFocusEffect(
    useCallback(() => {
      loadAttorneys({silent: true});
    }, [loadAttorneys]),
  );

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    loadAttorneys({silent: true});
  }, [loadAttorneys]);

  const handleBookNow = useCallback(
    async item => {
      try {
        navigation.navigate('BookNow', {attorney: item});
      } catch (e) {
        Alert.alert('Error', e?.message ?? 'Could not start booking.');
      }
    },
    [navigation],
  );

  const listHeader = (
    <>
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

      {loadError ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{loadError}</Text>
        </View>
      ) : null}

      {loading && attorneys.length === 0 ? (
        <View style={styles.inlineLoading}>
          <ActivityIndicator color={T.gold[1]} size="small" />
          <Text style={styles.inlineLoadingText}>Loading attorneys...</Text>
        </View>
      ) : null}
    </>
  );

  const listEmpty =
    !loading && !loadError ? (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>No attorneys found yet.</Text>
      </View>
    ) : null;

  return (
    <ClientScreenShell>
      <FlatList
        style={styles.listFlex}
        data={attorneys}
        keyExtractor={item => String(item.id)}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={listEmpty}
        renderItem={({item, index}) => (
          <ClientFadeInSoft delay={80 + index * 50}>
            <AttorneyCard item={item} navigation={navigation} onBookNow={handleBookNow} />
          </ClientFadeInSoft>
        )}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        initialNumToRender={6}
        maxToRenderPerBatch={8}
        windowSize={7}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={T.gold[1]}
            colors={[T.gold[1]]}
          />
        }
      />
    </ClientScreenShell>
  );
}

const styles = StyleSheet.create({
  listFlex: {flex: 1},
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
  errorBanner: {
    marginHorizontal: 20,
    marginBottom: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.35)',
  },
  errorBannerText: {
    color: '#FCA5A5',
    fontSize: 13,
    lineHeight: 18,
  },
  inlineLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 12,
    marginBottom: 8,
  },
  inlineLoadingText: {
    color: T.textSoft,
    fontSize: 14,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 24,
    flexGrow: 1,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 20,
  },
  emptyText: {color: T.textSoft, fontSize: 14, textAlign: 'center'},
  card: {
    backgroundColor: 'rgba(18, 26, 36, 0.92)',
    borderRadius: 16,
    paddingVertical: 24,
    paddingHorizontal: 20,
    marginBottom: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.14)',
  },
  avatar: {
    borderWidth: 3,
    borderColor: 'rgba(244, 215, 139, 0.35)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginBottom: 12,
  },
  avatarPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(30, 58, 138, 0.35)',
  },
  avatarInitials: {
    color: T.gold[0],
    fontSize: 28,
    fontWeight: '800',
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
    maxWidth: '100%',
  },
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
    marginBottom: 8,
    fontWeight: '500',
  },
  ratingLine: {
    fontSize: 14,
    fontWeight: '700',
    color: T.gold[0],
    marginBottom: 12,
    letterSpacing: 0.2,
  },
  priceText: {
    fontSize: 22,
    fontWeight: '800',
    color: T.text,
    marginBottom: 16,
  },
  bookButton: {
    backgroundColor: T.gold[1],
    width: '100%',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 10,
  },
  bookButtonText: {
    color: T.base,
    fontWeight: '800',
    fontSize: 16,
  },
  profileButton: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: 'rgba(244, 215, 139, 0.35)',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  profileButtonText: {
    color: T.text,
    fontWeight: '700',
    fontSize: 16,
  },
});
