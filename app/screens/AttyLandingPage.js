import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Pressable,
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {LinearGradient} from 'expo-linear-gradient';
import {MaterialCommunityIcons} from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {useUserProfile} from '../context/UserProfileContext';
import {
  fetchAttorneyDashboardSnapshot,
  fetchAttorneyProfile,
  getCurrentSessionProfile,
  isConsultationChatWindowOpen,
  prefetchAttorneyProfileStats,
} from '../services/userApi';
import {getMyProfile} from '../services/profileService';
import {useAttorneyLiveRefresh} from '../hooks/useAttorneyLiveRefresh';
import {getGreetingName} from '../utils/userDisplayName';
import {ClientScreenShell} from '../components/ClientScreenShell';
import {REFERENCE_THEME as T} from '../constants/referenceTheme';

const glassBorder = 'rgba(244, 215, 139, 0.2)';
const accentGold = T.gold[1];

const AttorneyDashboard = ({navigation}) => {
  const {width} = useWindowDimensions();
  const isSmallScreen = width < 380;
  const {profile, updateProfile} = useUserProfile();

  const [attorneyId, setAttorneyId] = useState(null);
  const [appointments, setAppointments] = useState([]);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const [pendingRequestCount, setPendingRequestCount] = useState(0);
  const [upcomingCount, setUpcomingCount] = useState(0);
  const [myAppointmentCount, setMyAppointmentCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const upcomingPulseAnim = useRef(new Animated.Value(1)).current;
  const upcomingPressScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(350),
        Animated.timing(upcomingPulseAnim, {
          toValue: 1.06,
          duration: 1300,
          useNativeDriver: true,
        }),
        Animated.timing(upcomingPulseAnim, {
          toValue: 1,
          duration: 1300,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [upcomingPulseAnim]);

  const handleUpcomingPressIn = () => {
    Animated.spring(upcomingPressScale, {
      toValue: 0.96,
      speed: 35,
      bounciness: 6,
      useNativeDriver: true,
    }).start();
  };

  const handleUpcomingPressOut = () => {
    Animated.spring(upcomingPressScale, {
      toValue: 1,
      speed: 25,
      bounciness: 8,
      useNativeDriver: true,
    }).start();
  };

  const upcomingCombinedScale = Animated.multiply(
    upcomingPulseAnim,
    upcomingPressScale,
  );

  const loadDashboard = useCallback(async (options = {}) => {
    const silent = Boolean(options?.silent);
    if (!silent) setLoading(true);
    try {
      const {profile} = await getCurrentSessionProfile();
      const userId = profile?.id;
      setAttorneyId(userId || null);
      if (userId) {
        void fetchAttorneyProfile(userId, {includeStats: false}).then(() => {
          void prefetchAttorneyProfileStats(userId);
        });
      }
      if (!userId) {
        setAppointments([]);
        setUnreadNotificationCount(0);
        setPendingRequestCount(0);
        return;
      }
      const snapshot = await fetchAttorneyDashboardSnapshot(userId, options);
      setAppointments(Array.isArray(snapshot.appointments) ? snapshot.appointments : []);
      setUnreadNotificationCount(snapshot.unreadNotificationCount || 0);
      setPendingRequestCount(snapshot.pendingRequestCount || 0);
      setUpcomingCount(snapshot.upcomingCount || 0);
      setMyAppointmentCount(snapshot.myAppointmentCount || 0);
    } catch (error) {
      if (!silent) {
        Alert.alert('Error', error?.message ?? 'Failed to load dashboard data.');
      }
      setAppointments([]);
      setUnreadNotificationCount(0);
      setPendingRequestCount(0);
      setUpcomingCount(0);
      setMyAppointmentCount(0);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useAttorneyLiveRefresh({attorneyId, reload: loadDashboard});

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          const data = await getMyProfile();
          if (cancelled || !data) return;
          updateProfile({
            name: data.full_name || '',
            email: data.email || '',
            phone: data.phone || '',
            address: data.address || '',
            age: data.age,
            guardian_name: data.guardian_name,
            guardian_contact: data.guardian_contact,
            role:
              String(data.role || '').toLowerCase() === 'attorney'
                ? 'Attorney'
                : 'Client',
          });
        } catch {
          // ignore
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [updateProfile]),
  );

  const {nextConsultation, recentConsultations} = useMemo(() => {
    const now = Date.now();
    const futureAppointments = appointments.filter(item => {
      const scheduledMs = new Date(item.scheduledAt || 0).getTime();
      return Number.isFinite(scheduledMs) && scheduledMs >= now;
    });
    const sorted = [...futureAppointments].sort((a, b) => {
      const aTime = new Date(a.scheduledAt || 0).getTime() || 0;
      const bTime = new Date(b.scheduledAt || 0).getTime() || 0;
      return aTime - bTime;
    });
    const recent = sorted.slice(0, 3).map(item => ({
      id: item.id,
      name: item.name || 'Client',
      type: item.area || 'Consultation',
      time: item.time || '--:--',
      date: item.date || 'No schedule',
      status: String(item.status || 'pending').toUpperCase(),
      initial: (item.initials || 'C').trim()[0]?.toUpperCase() || 'C',
      scheduledAt: item.scheduledAt,
      slotDate: item.slotDate,
      slotTime: item.slotTime,
      paymentStatus: item.paymentStatus,
    }));
    return {
      nextConsultation: sorted[0] || null,
      recentConsultations: recent,
    };
  }, [appointments]);

  const greetingName = getGreetingName(profile);

  const onMenu = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigation.navigate('AttyMenu');
  };

  const onProfile = () => {
    Haptics.selectionAsync();
    navigation.navigate('AttyProfileSettings');
  };

  return (
    <ClientScreenShell edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconCircle} onPress={onMenu} accessibilityLabel="Open menu">
          <MaterialCommunityIcons name="menu" size={22} color={T.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, isSmallScreen && styles.headerTitleSmall]} numberOfLines={1}>
          ATTORNEY DASHBOARD
        </Text>
        <TouchableOpacity style={styles.iconCircle} onPress={onProfile} accessibilityLabel="Profile settings">
          <LinearGradient
            colors={['rgba(212,175,55,0.35)', 'rgba(18,26,36,0.9)']}
            style={styles.profileGradient}>
            <MaterialCommunityIcons name="account" size={20} color={accentGold} />
          </LinearGradient>
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, isSmallScreen && styles.scrollContentSmall]}>
        <View style={styles.heroGrid}>
          <View style={styles.welcomeBox}>
            <Text style={styles.kicker}>LEGAL OPERATIONS OVERVIEW</Text>
            <Text style={[styles.welcomeText, isSmallScreen && styles.welcomeTextSmall]} numberOfLines={2}>
              {greetingName
                ? `Welcome back, Atty. ${greetingName}`
                : 'Welcome back, Attorney'}
            </Text>
            <Text style={styles.subtitle}>
              Monitor consultations, respond faster, and keep your schedule aligned in one focused dashboard.
            </Text>
            <View style={styles.heroChips}>
              <View style={styles.heroChip}>
                <Text style={styles.heroChipText}>
                  {loading ? '--' : upcomingCount} upcoming consultations
                </Text>
              </View>
              <View style={styles.heroChip}>
                <Text style={styles.heroChipText}>
                  {loading ? '--' : unreadNotificationCount} unread notifications
                </Text>
              </View>
              {pendingRequestCount > 0 ? (
                <TouchableOpacity
                  style={[styles.heroChip, styles.heroChipAction]}
                  onPress={() => {
                    Haptics.selectionAsync();
                    navigation.navigate('AttyConsultationRequests');
                  }}>
                  <Text style={styles.heroChipActionText}>
                    {pendingRequestCount} pending request{pendingRequestCount === 1 ? '' : 's'}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>

          <LinearGradient
            colors={['rgba(18,28,44,0.95)', 'rgba(12,19,30,0.88)']}
            style={styles.spotlightCard}>
            <View style={styles.spotlightHeader}>
              <Text style={styles.spotlightTitle}>Next Consultation</Text>
              <MaterialCommunityIcons name="scale-balance" size={20} color={accentGold} />
            </View>
            {nextConsultation ? (
              <>
                <Text style={styles.spotlightName} numberOfLines={1}>
                  {nextConsultation.name || 'Client'}
                </Text>
                <Text style={styles.spotlightMeta} numberOfLines={2}>
                  {nextConsultation.area || 'Consultation'}
                </Text>
                <Text style={styles.spotlightMeta}>
                  {nextConsultation.date || 'No date'} at {nextConsultation.time || '--:--'}
                </Text>
              </>
            ) : (
              <Text style={styles.spotlightEmpty}>No scheduled consultation yet.</Text>
            )}
          </LinearGradient>
        </View>

        <View style={styles.statsRow}>
          <Pressable
            onPressIn={handleUpcomingPressIn}
            onPressOut={handleUpcomingPressOut}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              navigation.navigate('AttyMyAppointments');
            }}
            style={styles.statCardWrap}>
            <Animated.View style={{transform: [{scale: upcomingCombinedScale}], flex: 1}}>
              <LinearGradient
                colors={['rgba(18,28,44,0.95)', 'rgba(12,19,30,0.88)']}
                style={styles.statCard}>
                <View style={[styles.gridIcon, {backgroundColor: 'rgba(54, 74, 110, 0.35)'}]}>
                  <MaterialCommunityIcons name="calendar-check" size={22} color="#60A5FA" />
                </View>
                <Text style={styles.gridLabel}>MY APPOINTMENTS</Text>
                <Text style={[styles.gridValue, isSmallScreen && styles.gridValueSmall]}>
                  {loading ? '--' : myAppointmentCount}
                </Text>
              </LinearGradient>
            </Animated.View>
          </Pressable>

          <TouchableOpacity
            activeOpacity={0.88}
            onPress={() => {
              Haptics.selectionAsync();
              navigation.navigate('AttyAnalytics');
            }}
            style={styles.statCardWrap}>
            <LinearGradient
              colors={['rgba(14,26,22,0.95)', 'rgba(12,19,30,0.88)']}
              style={styles.statCard}>
              <View style={[styles.gridIcon, {backgroundColor: 'rgba(16, 185, 129, 0.2)'}]}>
                <MaterialCommunityIcons name="chart-bar" size={22} color="#34D399" />
              </View>
              <Text style={styles.gridLabel}>ANALYTICS</Text>
              <Text style={styles.analyticsValue}>View Graph</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>

        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Consultation Queue</Text>
            <TouchableOpacity
              onPress={() => {
                Haptics.selectionAsync();
                navigation.navigate('AttyMyAppointments');
              }}>
              <Text style={styles.viewAll}>VIEW ALL ›</Text>
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.centerBox}>
              <ActivityIndicator color={accentGold} />
            </View>
          ) : recentConsultations.length === 0 ? (
            <View style={styles.centerBox}>
              <Text style={styles.emptyText}>No consultations yet.</Text>
            </View>
          ) : (
            recentConsultations.map(item => {
              const canEnter = isConsultationChatWindowOpen({
                status: item.status,
                scheduledAt: item.scheduledAt,
                slotDate: item.slotDate,
                slotTime: item.slotTime,
                paymentStatus: item.paymentStatus || 'unpaid',
              });
              return (
              <TouchableOpacity
                key={item.id}
                style={styles.consultItem}
                activeOpacity={0.88}
                disabled={!canEnter}
                onPress={() => {
                  if (!canEnter) return;
                  Haptics.selectionAsync();
                  navigation.navigate('AttyConsultationMessage', {
                    chatId: item.id,
                    clientName: item.name,
                    clientInitials: (item.name || 'Client')
                      .split(' ')
                      .filter(Boolean)
                      .map(part => part[0])
                      .join('')
                      .slice(0, 2)
                      .toUpperCase(),
                  });
                }}>
                <View style={styles.consultAvatar}>
                  <Text style={styles.avatarTxt}>{item.initial}</Text>
                </View>
                <View style={styles.consultMain}>
                  <Text style={styles.consultName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={styles.consultSub}>{String(item.type).toUpperCase()}</Text>
                  <Text style={styles.consultDate}>{item.date}</Text>
                </View>
                <View style={styles.consultMeta}>
                  <View style={styles.statusPill}>
                    <Text style={styles.statusText}>{item.status}</Text>
                  </View>
                  <Text style={styles.consultTime}>{item.time}</Text>
                </View>
              </TouchableOpacity>
            );
            })
          )}
        </View>

      </ScrollView>
    </ClientScreenShell>
  );
};

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    height: 56,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(244, 215, 139, 0.08)',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    color: T.text,
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 2,
  },
  headerTitleSmall: {fontSize: 11, letterSpacing: 1},
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.05)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  profileGradient: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: glassBorder,
  },
  scrollContent: {padding: 20, paddingBottom: 40},
  scrollContentSmall: {paddingHorizontal: 14},
  heroGrid: {gap: 14, marginBottom: 16},
  welcomeBox: {
    padding: 18,
    borderRadius: 18,
    backgroundColor: 'rgba(14, 20, 31, 0.55)',
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.08)',
  },
  kicker: {
    color: accentGold,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  welcomeText: {color: T.text, fontSize: 24, fontWeight: '900'},
  welcomeTextSmall: {fontSize: 21},
  subtitle: {color: T.textMuted, fontSize: 14, marginTop: 6, lineHeight: 20},
  heroChips: {flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14},
  heroChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.12)',
  },
  heroChipText: {color: T.textSoft, fontSize: 11, fontWeight: '700'},
  heroChipAction: {
    borderColor: 'rgba(244, 215, 139, 0.35)',
    backgroundColor: 'rgba(215, 177, 74, 0.12)',
  },
  heroChipActionText: {color: accentGold, fontSize: 11, fontWeight: '800'},
  spotlightCard: {
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: glassBorder,
  },
  spotlightHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  spotlightTitle: {color: T.text, fontSize: 14, fontWeight: '900'},
  spotlightName: {color: T.text, fontSize: 18, fontWeight: '900'},
  spotlightMeta: {color: T.textMuted, fontSize: 13, marginTop: 4},
  spotlightEmpty: {color: T.textMuted, fontSize: 13},
  statsRow: {flexDirection: 'row', gap: 12, marginBottom: 8},
  statCardWrap: {flex: 1},
  statCard: {
    flex: 1,
    borderRadius: 24,
    padding: 22,
    borderWidth: 1,
    borderColor: glassBorder,
    minHeight: 150,
  },
  gridIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  gridLabel: {
    color: T.textSoft,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  gridValue: {color: T.text, fontSize: 36, fontWeight: '900', marginTop: 6},
  gridValueSmall: {fontSize: 30},
  analyticsValue: {color: T.text, fontSize: 18, fontWeight: '900', marginTop: 10},
  sectionCard: {
    marginTop: 18,
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(190, 157, 95, 0.18)',
    backgroundColor: 'rgba(12, 19, 30, 0.86)',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {color: T.text, fontSize: 18, fontWeight: '900'},
  viewAll: {color: accentGold, fontSize: 11, fontWeight: '900'},
  centerBox: {paddingVertical: 20, alignItems: 'center'},
  emptyText: {fontSize: 13, color: T.textMuted},
  consultItem: {
    flexDirection: 'row',
    alignItems: 'center',
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
  consultMain: {flex: 1, marginLeft: 14},
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
});

export default AttorneyDashboard;
