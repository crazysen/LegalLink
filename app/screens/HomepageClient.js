import React, {useCallback, useEffect, useMemo, useState} from 'react';
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
import {Feather, Ionicons, MaterialCommunityIcons} from '@expo/vector-icons';
import {ClientScreenShell, ClientFadeIn, ClientFadeInSoft} from '../components/ClientScreenShell';
import KineticClientCard from '../components/KineticClientCard';
import {useUserProfile} from '../context/UserProfileContext';
import {useNotifications} from '../context/NotificationContext';
import {
  getEffectiveAppointmentStatus,
  getMyAppointments,
  isClientQueueItem,
  parseAppointmentScheduleMs,
} from '../services/appointmentService';
import {getMyProfile} from '../services/profileService';
import {registerClientPushNotifications} from '../services/pushNotificationService';
import {getGreetingName} from '../utils/userDisplayName';
import {REFERENCE_THEME as T} from '../constants/referenceTheme';

const HomepageClient = ({navigation}) => {
  const {profile, updateProfile} = useUserProfile();
  const {unreadCount} = useNotifications();
  const [appointments, setAppointments] = useState([]);
  const [loadingAppointments, setLoadingAppointments] = useState(true);

  const loadAppointments = useCallback(async () => {
    try {
      setLoadingAppointments(true);
      const records = await getMyAppointments();
      setAppointments(Array.isArray(records) ? records : []);
    } catch (error) {
      console.warn('Appointments fetch failed:', error?.message);
      setAppointments([]);
    } finally {
      setLoadingAppointments(false);
    }
  }, []);

  useEffect(() => {
    loadAppointments();
  }, [loadAppointments]);

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
          // Session missing or network
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [updateProfile]),
  );

  useEffect(() => {
    const role = String(profile?.role || '').toLowerCase();
    if (role !== 'client') {
      return;
    }
    registerClientPushNotifications().catch(() => {});
  }, [profile?.role]);

  const handleNotifications = () => {
    navigation.navigate('ClientNotification');
  };
  const handleMenu = () => {
    const state = navigation.getState();
    const routeName = state?.routes?.[state?.index ?? 0]?.name ?? 'HomepageClient';
    navigation.navigate('ClientMenu', {activeRoute: routeName});
  };
  const handleBookAppointment = () => {
    navigation.navigate('BookAppointment');
  };
  const handleNotarialService = () => navigation.navigate('ClientNotarial');
  const handleFullHistory = () => navigation.navigate('MyAppointments');
  const handlePayment = appointment =>
    navigation.navigate('Payment', {
      paymentMethod: 'gcash',
      serviceData: {
        type: appointment?.title ?? 'Consultation',
        amount: appointment?.amount
          ? `₱${Number(appointment.amount).toLocaleString()}`
          : '₱2,500',
      },
      paymentContext: {
        sourceType: 'appointment',
        sourceId: appointment?.id,
        attorneyId: appointment?.attorney_id,
        amount: appointment?.amount != null ? Number(appointment.amount) : undefined,
      },
    });
  const handleChat = () => navigation.navigate('Chatbot');
  const handleProfileSettings = () => navigation.navigate('ProfileSettingsClient');

  const formatDateTime = isoDateTime => {
    if (!isoDateTime) {
      return {date: 'No schedule', time: '--:--'};
    }

    const rawValue = String(isoDateTime).trim();
    let dateValue = null;

    const hasTimezoneInfo = /([zZ]|[+-]\d{2}:?\d{2})$/.test(rawValue);
    if (hasTimezoneInfo) {
      const normalizedTz = rawValue.replace(' ', 'T').replace(/\+00$/, 'Z');
      dateValue = new Date(normalizedTz);
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
      }
    }

    if (!dateValue || Number.isNaN(dateValue.getTime())) {
      return {date: 'No schedule', time: '--:--'};
    }

    return {
      date: dateValue.toLocaleDateString(),
      time: dateValue.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}),
    };
  };

  const queueAppointments = useMemo(() => {
    const q = (appointments || []).filter(isClientQueueItem);
    return [...q].sort((a, b) => {
      const ma = parseAppointmentScheduleMs(a);
      const mb = parseAppointmentScheduleMs(b);
      const fa = ma ?? Number.MAX_SAFE_INTEGER;
      const fb = mb ?? Number.MAX_SAFE_INTEGER;
      return fa - fb;
    });
  }, [appointments]);

  const greetingName = getGreetingName(profile);
  const initialsSource = greetingName || profile?.email?.split('@')[0] || '?';
  const initials =
    initialsSource
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part[0]?.toUpperCase())
      .join('')
      .slice(0, 2) || '?';

  return (
    <ClientScreenShell>
        <View style={styles.header}>
          <TouchableOpacity style={styles.headerButton} activeOpacity={0.9} onPress={handleMenu}>
            <Feather name="menu" size={22} color={T.text} />
          </TouchableOpacity>
          <View style={styles.headerRight}>
            <TouchableOpacity
              style={styles.notifyButton}
              activeOpacity={0.9}
              onPress={() => navigation.navigate('Messages')}>
              <Ionicons name="chatbubble-ellipses-outline" size={20} color={T.gold[0]} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.notifyButton}
              activeOpacity={0.9}
              onPress={handleNotifications}>
              <View>
                <Ionicons name="notifications-outline" size={20} color={T.gold[0]} />
                {unreadCount > 0 && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>
                      {unreadCount > 9 ? '9+' : String(unreadCount)}
                    </Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.avatarWrap} activeOpacity={0.9} onPress={handleProfileSettings}>
              <Text style={styles.avatarText}>{initials}</Text>
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}>
          <ClientFadeIn delay={0}>
            <Text style={styles.heroTitle}>
              {greetingName ? `Welcome Back, ${greetingName}` : 'Welcome Back'}
            </Text>
            <Text style={styles.heroSubtitle}>
              Manage consultations and services from your dashboard.
            </Text>
          </ClientFadeIn>

          <ClientFadeInSoft delay={72}>
            <KineticClientCard
              animateIcon
              icon="calendar-check"
              title="Book New Appointment"
              subtitle="Schedule a session with verified counsel."
              onPress={handleBookAppointment}
            />
          </ClientFadeInSoft>

          <ClientFadeInSoft delay={148}>
            <KineticClientCard
              animateIcon
              icon="shield-check-outline"
              title="Request Notarial Services"
              subtitle="Legally binding document authentication."
              onPress={handleNotarialService}
            />
          </ClientFadeInSoft>

          <ClientFadeIn delay={120}>
          <View style={styles.historyHeader}>
            <Text style={styles.historyTitle}>Appointment Queue</Text>
            <View style={styles.historyLine} />
            <TouchableOpacity onPress={handleFullHistory} hitSlop={{top: 8, bottom: 8}}>
              <Text style={styles.historyAction}>FULL HISTORY</Text>
            </TouchableOpacity>
          </View>
          </ClientFadeIn>

          <View style={styles.appointmentList}>
            {loadingAppointments ? (
              <View style={styles.emptyState}>
                <ActivityIndicator size="small" color={T.gold[1]} />
                <Text style={[styles.emptySubtitle, {marginTop: 12}]}>Loading your appointments...</Text>
              </View>
            ) : queueAppointments.length === 0 ? (
              <View style={styles.emptyState}>
                <MaterialCommunityIcons name="dots-hexagon" size={40} color="rgba(255,255,255,0.2)" />
                <Text style={styles.emptyTitle}>No appointments in queue</Text>
                <Text style={styles.emptySubtitle}>Book a consultation to see it here.</Text>
              </View>
            ) : (
              queueAppointments.slice(0, 3).map((item, index) => {
                const {date, time} = formatDateTime(item.scheduled_at);
                const effective = getEffectiveAppointmentStatus(item);
                const status = effective.toUpperCase();
                const isConfirmed = status === 'CONFIRMED';
                const isRescheduled = status === 'RESCHEDULED';
                return (
                  <ClientFadeIn key={item.id} delay={180 + index * 65}>
                  <View style={styles.appointmentCard}>
                    <View style={styles.appointmentLeft}>
                      <View style={styles.appointmentDateBox}>
                        <MaterialCommunityIcons name="calendar" size={22} color={T.gold[1]} />
                        <Text style={styles.appointmentDate}>{date}</Text>
                      </View>
                    </View>

                    <View style={styles.appointmentRight}>
                      <View style={styles.appointmentHeader}>
                        <Text style={styles.appointmentTitle}>{item.title ?? 'Consultation'}</Text>
                      </View>

                      <Text style={styles.appointmentInfo}>{item.attorney_name ?? 'Attorney not assigned'}</Text>

                      <View style={styles.appointmentDetails}>
                        <View style={styles.detailItem}>
                          <MaterialCommunityIcons name="clock-outline" size={14} color={T.textSoft} />
                          <Text style={styles.detailText}>{time}</Text>
                        </View>
                        <View style={styles.detailItem}>
                          <MaterialCommunityIcons name="briefcase-outline" size={14} color={T.textSoft} />
                          <Text style={styles.detailText}>Consultation</Text>
                        </View>
                      </View>

                      <View style={styles.appointmentActions}>
                        {status === 'PENDING' ? (
                          <TouchableOpacity style={styles.paymentButton} onPress={() => handlePayment(item)}>
                            <MaterialCommunityIcons name="credit-card-outline" size={18} color={T.base} />
                            <Text style={styles.paymentText}>Proceed to Payment</Text>
                          </TouchableOpacity>
                        ) : isRescheduled ? (
                          <View style={styles.rescheduledBadge}>
                            <Text style={styles.rescheduledBadgeText}>Rescheduled</Text>
                          </View>
                        ) : isConfirmed ? (
                          <View style={styles.confirmedBadge}>
                            <Text style={styles.confirmedText}>Confirmed</Text>
                          </View>
                        ) : (
                          <View style={styles.pendingBadgeInline}>
                            <Text style={styles.pendingBadgeInlineText}>Awaiting approval</Text>
                          </View>
                        )}
                      </View>
                    </View>
                  </View>
                  </ClientFadeIn>
                );
              })
            )}
          </View>
        </ScrollView>

        <ClientFadeInSoft delay={280} style={styles.fabWrap}>
        <TouchableOpacity activeOpacity={0.92} onPress={handleChat} style={styles.fabTouchable}>
          <LinearGradient colors={['#2A394B', '#121A25']} style={styles.fabButton}>
            <MaterialCommunityIcons name="comment-text-multiple" size={26} color={T.gold[1]} />
          </LinearGradient>
        </TouchableOpacity>
        </ClientFadeInSoft>
    </ClientScreenShell>
  );
};

export default HomepageClient;

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 8,
  },
  headerButton: {
    width: 46,
    height: 46,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.22)',
    backgroundColor: 'rgba(18, 26, 36, 0.48)',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  notifyButton: {
    marginRight: 14,
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: -5,
    right: -6,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: T.gold[1],
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: T.base,
  },
  badgeText: {
    fontSize: 8,
    fontWeight: '900',
    color: T.base,
    lineHeight: 10,
  },
  avatarWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1.5,
    borderColor: T.gold[1],
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(33, 44, 60, 0.9)',
  },
  avatarText: {
    color: T.gold[1],
    fontWeight: '700',
    fontSize: 13,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 160,
  },
  heroTitle: {
    color: T.text,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '900',
  },
  heroSubtitle: {
    marginTop: 10,
    color: T.textMuted,
    fontSize: 14,
    lineHeight: 21,
  },
  historyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 22,
    marginBottom: 16,
  },
  historyTitle: {
    color: T.textSoft,
    fontSize: 14,
    fontWeight: '700',
  },
  historyLine: {
    flex: 1,
    height: 1,
    marginHorizontal: 12,
    backgroundColor: 'rgba(244, 215, 139, 0.10)',
  },
  historyAction: {
    color: T.gold[1],
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  appointmentList: {
    marginBottom: 24,
  },
  appointmentCard: {
    flexDirection: 'row',
    backgroundColor: 'rgba(18, 26, 36, 0.85)',
    padding: 14,
    borderRadius: 24,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.12)',
  },
  appointmentLeft: {
    marginRight: 12,
  },
  appointmentDateBox: {
    width: 64,
    height: 72,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  appointmentDate: {
    fontSize: 9,
    color: T.textSoft,
    marginTop: 4,
    textAlign: 'center',
  },
  appointmentRight: {
    flex: 1,
  },
  appointmentHeader: {
    marginBottom: 4,
  },
  appointmentTitle: {
    fontWeight: '700',
    fontSize: 15,
    color: T.text,
  },
  appointmentInfo: {
    fontSize: 11,
    color: T.textSoft,
    marginBottom: 6,
  },
  appointmentDetails: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 8,
  },
  detailItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  detailText: {
    fontSize: 10,
    fontWeight: '600',
    color: T.textMuted,
  },
  appointmentActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  paymentButton: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    backgroundColor: T.gold[1],
    paddingVertical: 10,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  paymentText: {
    color: T.base,
    fontWeight: '800',
    fontSize: 11,
  },
  confirmedBadge: {
    flex: 1,
    flexDirection: 'row',
    gap: 4,
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    paddingVertical: 10,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.35)',
  },
  confirmedText: {
    color: '#6EE7B7',
    fontWeight: '800',
    fontSize: 11,
  },
  pendingBadgeInline: {
    flex: 1,
    backgroundColor: 'rgba(251, 191, 36, 0.12)',
    paddingVertical: 10,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(251, 191, 36, 0.25)',
  },
  pendingBadgeInlineText: {
    color: T.gold[0],
    fontWeight: '700',
    fontSize: 11,
  },
  rescheduledBadge: {
    flex: 1,
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    paddingVertical: 10,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.3)',
  },
  rescheduledBadgeText: {
    color: '#93C5FD',
    fontWeight: '800',
    fontSize: 11,
  },
  emptyState: {
    borderRadius: 24,
    paddingVertical: 36,
    alignItems: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(244, 215, 139, 0.10)',
    backgroundColor: 'rgba(18, 26, 36, 0.62)',
  },
  emptyTitle: {
    marginTop: 10,
    color: T.text,
    fontSize: 16,
    fontWeight: '700',
  },
  emptySubtitle: {
    marginTop: 5,
    color: T.textSoft,
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  fabWrap: {
    position: 'absolute',
    right: 24,
    bottom: 28,
    borderRadius: 28,
    shadowColor: 'rgba(212, 175, 55, 0.45)',
    shadowOpacity: 0.4,
    shadowRadius: 24,
    shadowOffset: {width: 0, height: 10},
    elevation: 18,
  },
  fabTouchable: {
    borderRadius: 28,
  },
  fabButton: {
    width: 70,
    height: 70,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
