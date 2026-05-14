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
  formatScheduledAtDisplay,
  getEffectiveAppointmentStatus,
  getMyAppointments,
  isAppointmentCompleted,
  isAttorneyQueueItem,
  isUpcomingBySchedule,
  parseAppointmentScheduleMs,
} from '../services/appointmentService';
import {getMyProfile} from '../services/profileService';
import {getGreetingName} from '../utils/userDisplayName';
import {ClientScreenShell} from '../components/ClientScreenShell';
import {REFERENCE_THEME as T} from '../constants/referenceTheme';

function resolveScheduleValue(item) {
  return (
    item?.scheduled_at ||
    item?.updated_at ||
    item?.created_at ||
    null
  );
}

const glassBorder = 'rgba(244, 215, 139, 0.2)';
const accentGold = T.gold[1];

const AttorneyDashboard = ({navigation}) => {
  const {width} = useWindowDimensions();
  const isSmallScreen = width < 380;
  const {profile, updateProfile} = useUserProfile();

  const [appointments, setAppointments] = useState([]);
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

  const loadDashboard = useCallback(async () => {
    try {
      setLoading(true);
      const rows = await getMyAppointments();
      setAppointments(Array.isArray(rows) ? rows : []);
    } catch (error) {
      Alert.alert('Error', error?.message ?? 'Failed to load dashboard data.');
      setAppointments([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadDashboard();
    }, [loadDashboard]),
  );

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

  const {upcomingCount, recentConsultations} = useMemo(() => {
    const now = new Date();
    const upcomingList = appointments.filter(
      item =>
        !isAppointmentCompleted(item) &&
        isAttorneyQueueItem(item) &&
        isUpcomingBySchedule(item, now),
    );
    upcomingList.sort((a, b) => {
      const ma = parseAppointmentScheduleMs(a);
      const mb = parseAppointmentScheduleMs(b);
      const fa = ma ?? Number.MAX_SAFE_INTEGER;
      const fb = mb ?? Number.MAX_SAFE_INTEGER;
      return fa - fb;
    });
    const recent = upcomingList.slice(0, 3).map(item => {
      const {date, time} = formatScheduledAtDisplay(resolveScheduleValue(item));
      const s = getEffectiveAppointmentStatus(item);
      return {
        id: item.id,
        name: item.client_name || 'Client',
        type: item.title || 'Consultation',
        time: time === '—' ? '--:--' : time,
        date: date === '—' ? 'No schedule' : date,
        status: s.toUpperCase(),
        initial: (item.client_name || 'C').trim()[0]?.toUpperCase() || 'C',
      };
    });
    return {upcomingCount: upcomingList.length, recentConsultations: recent};
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
        <View style={styles.welcomeBox}>
          <Text style={[styles.welcomeText, isSmallScreen && styles.welcomeTextSmall]} numberOfLines={2}>
            {greetingName
              ? `Welcome back, Atty. ${greetingName}`
              : 'Welcome back, Attorney'}
          </Text>
          <Text style={styles.subtitle}>
            Here&apos;s what&apos;s happening with your practice today.
          </Text>
        </View>

        <TouchableOpacity
          activeOpacity={0.88}
          onPress={() => {
            Haptics.selectionAsync();
            navigation.navigate('AttyAvailabilityManager');
          }}
          style={styles.actionCard}>
          <LinearGradient
            colors={['rgba(14,20,30,0.92)', 'rgba(18,26,36,0.75)']}
            style={styles.actionGradient}>
            <View style={styles.actionIconBox}>
              <MaterialCommunityIcons name="calendar-clock" size={22} color={accentGold} />
            </View>
            <Text style={styles.actionText}>Manage Availability</Text>
            <MaterialCommunityIcons name="chevron-right" size={22} color={T.textMuted} />
          </LinearGradient>
        </TouchableOpacity>

        <Pressable
          onPressIn={handleUpcomingPressIn}
          onPressOut={handleUpcomingPressOut}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            navigation.navigate('AttyMyAppointments');
          }}
          style={styles.singleStatWrap}>
          <Animated.View
            style={[
              styles.upcomingAnimatedOuter,
              {transform: [{scale: upcomingCombinedScale}]},
            ]}>
            <LinearGradient
              colors={['rgba(18,28,44,0.95)', 'rgba(12,19,30,0.88)']}
              style={styles.singleStatCard}>
              <View style={[styles.gridIcon, {backgroundColor: 'rgba(54, 74, 110, 0.35)'}]}>
                <MaterialCommunityIcons name="calendar-month" size={22} color={accentGold} />
              </View>
              <Text style={styles.gridLabel}>UPCOMING APPOINTMENTS</Text>
              <Text style={[styles.gridValue, isSmallScreen && styles.gridValueSmall]}>
                {loading ? '--' : upcomingCount}
              </Text>
              <Text style={styles.gridHint}>Tap to view and manage</Text>
            </LinearGradient>
          </Animated.View>
        </Pressable>

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
            recentConsultations.map(item => (
              <TouchableOpacity
                key={item.id}
                style={styles.consultItem}
                activeOpacity={0.88}
                onPress={() => {
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
            ))
          )}
        </View>

        <LinearGradient
          colors={['rgba(9,13,21,0.95)', 'rgba(14,20,31,0.88)']}
          style={styles.promoCard}>
          <Text style={[styles.promoTitle, isSmallScreen && styles.promoTitleSmall]}>
            Grow your law{'\n'}practice
          </Text>
          <Text style={styles.promoDesc}>
            Keep your availability updated so clients can book paid consultations in your open slots.
          </Text>
          <TouchableOpacity
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              navigation.navigate('AttyAvailabilityManager');
            }}
            activeOpacity={0.9}>
            <LinearGradient colors={[T.gold[0], T.gold[1]]} style={styles.promoButton}>
              <Text style={styles.promoButtonText}>Manage My Schedule</Text>
            </LinearGradient>
          </TouchableOpacity>
        </LinearGradient>
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
  welcomeBox: {
    marginBottom: 20,
    padding: 18,
    borderRadius: 18,
    backgroundColor: 'rgba(14, 20, 31, 0.55)',
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.08)',
  },
  welcomeText: {color: T.text, fontSize: 24, fontWeight: '900'},
  welcomeTextSmall: {fontSize: 21},
  subtitle: {color: T.textMuted, fontSize: 14, marginTop: 6},
  actionCard: {
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(186, 154, 91, 0.24)',
    marginBottom: 20,
  },
  actionGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 18,
  },
  actionIconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(215, 177, 74, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  actionText: {flex: 1, color: T.text, fontSize: 16, fontWeight: '800'},
  singleStatWrap: {marginBottom: 8},
  upcomingAnimatedOuter: {
    borderRadius: 24,
    overflow: 'hidden',
  },
  singleStatCard: {
    borderRadius: 24,
    padding: 22,
    borderWidth: 1,
    borderColor: glassBorder,
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
  gridHint: {color: T.textSoft, fontSize: 12, marginTop: 8},
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
  promoCard: {
    marginTop: 20,
    padding: 24,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(180, 146, 82, 0.2)',
  },
  promoTitle: {color: T.text, fontSize: 22, fontWeight: '900'},
  promoTitleSmall: {fontSize: 19},
  promoDesc: {color: '#9AA6BC', fontSize: 13, lineHeight: 20, marginTop: 12, marginBottom: 18},
  promoButton: {
    height: 52,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  promoButtonText: {color: '#101B2C', fontSize: 16, fontWeight: '900'},
});

export default AttorneyDashboard;
