import React, {useCallback, useEffect, useState} from 'react';
import {useFocusEffect} from '@react-navigation/native';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {LinearGradient} from 'expo-linear-gradient';
import {Feather, Ionicons, MaterialCommunityIcons} from '@expo/vector-icons';
import {ClientScreenShell, ClientFadeIn, ClientFadeInSoft} from '../components/ClientScreenShell';
import ClientConsultationQueue from '../components/ClientConsultationQueue';
import KineticClientCard from '../components/KineticClientCard';
import {useUserProfile} from '../context/UserProfileContext';
import {useNotifications} from '../context/NotificationContext';
import {invalidateAppointmentsCache} from '../services/appointmentService';
import {getMyProfile} from '../services/profileService';
import {registerClientPushNotifications} from '../services/pushNotificationService';
import {
  fetchClientConsultationQueue,
  subscribeToClientAppointments,
} from '../services/userApi';
import {getGreetingName} from '../utils/userDisplayName';
import {REFERENCE_THEME as T} from '../constants/referenceTheme';

const HomepageClient = ({navigation}) => {
  const {profile, updateProfile} = useUserProfile();
  const {unreadCount} = useNotifications();
  const [queueItems, setQueueItems] = useState([]);
  const [clientId, setClientId] = useState(null);
  const [loadingQueue, setLoadingQueue] = useState(true);

  const loadQueue = useCallback(
    async (options = {}) => {
      const force = Boolean(options?.force);
      try {
        if (!force) setLoadingQueue(true);
        let userId = clientId;
        if (!userId) {
          const data = await getMyProfile();
          userId = data?.id;
          if (userId) setClientId(userId);
        }
        if (!userId) {
          setQueueItems([]);
          return;
        }
        const rows = await fetchClientConsultationQueue(userId, {force: force || !clientId});
        setQueueItems(Array.isArray(rows) ? rows : []);
      } catch (error) {
        console.warn('Consultation queue fetch failed:', error?.message);
        setQueueItems([]);
      } finally {
        setLoadingQueue(false);
      }
    },
    [clientId],
  );

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      let unsubscribe = () => {};

      (async () => {
        await loadQueue({force: true});
        if (cancelled) return;

        try {
          const data = await getMyProfile();
          if (cancelled || !data) return;
          setClientId(data.id);
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

          if (data.id) {
            unsubscribe = subscribeToClientAppointments(data.id, () => {
              invalidateAppointmentsCache();
              loadQueue({force: true});
            });
          }
        } catch {
          // Session missing or network
        }
      })();

      return () => {
        cancelled = true;
        unsubscribe();
      };
    }, [loadQueue, updateProfile]),
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
  const handlePayment = item =>
    navigation.navigate('Payment', {
      paymentMethod: 'qrph',
      serviceData: {
        type: item?.area ?? 'Consultation',
        amount: item?.amount
          ? `₱${Number(item.amount).toLocaleString()}`
          : '₱2,500',
      },
      paymentContext: {
        sourceType: 'appointment',
        sourceId: item?.id,
        attorneyId: item?.attorney_id,
        amount: item?.amount != null ? Number(item.amount) : undefined,
      },
    });
  const handleEnterRoom = item => {
    if (!item?.payment_is_paid && String(item?.payment || '').toLowerCase() !== 'paid') {
      Alert.alert('Payment required', 'Complete payment before entering the consultation room.');
      return;
    }
    if (item?.chatAccessible === false) {
      Alert.alert(
        'Consultation not available yet',
        'Chat opens on your consultation day (any time that day).',
      );
      return;
    }
    const name = item?.name ?? 'Attorney';
    navigation.navigate('EnterConsultationChat', {
      chatId: item.id,
      chatName: name,
      initials: name
        .split(' ')
        .map(part => part[0])
        .join('')
        .slice(0, 2)
        .toUpperCase(),
    });
  };
  const handleChat = () => navigation.navigate('Chatbot');
  const handleProfileSettings = () => navigation.navigate('ProfileSettingsClient');

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
              subtitle="Schedule a consultation with our expert attorneys"
              onPress={handleBookAppointment}
            />
          </ClientFadeInSoft>

          <ClientFadeInSoft delay={148}>
            <KineticClientCard
              animateIcon
              icon="shield-check-outline"
              title="Request Notary"
              subtitle="Submit and pay for notary requests online"
              onPress={handleNotarialService}
            />
          </ClientFadeInSoft>

          <ClientFadeIn delay={120}>
            <View style={styles.queueHeader}>
              <Text style={styles.queueTitle}>Consultation Queue</Text>
              <View style={styles.queueLine} />
              <TouchableOpacity onPress={handleFullHistory} hitSlop={{top: 8, bottom: 8}}>
                <Text style={styles.queueAction}>VIEW ALL</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.queueSubtitle}>Your upcoming consultations sorted by date</Text>
          </ClientFadeIn>

          <ClientConsultationQueue
            items={queueItems}
            loading={loadingQueue}
            onViewAll={handleFullHistory}
            onEnterRoom={handleEnterRoom}
            onPay={handlePayment}
          />
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
  queueHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 22,
    marginBottom: 8,
  },
  queueTitle: {
    color: T.textSoft,
    fontSize: 14,
    fontWeight: '700',
  },
  queueLine: {
    flex: 1,
    height: 1,
    marginHorizontal: 12,
    backgroundColor: 'rgba(244, 215, 139, 0.10)',
  },
  queueAction: {
    color: T.gold[1],
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  queueSubtitle: {
    color: T.textMuted,
    fontSize: 12,
    marginBottom: 14,
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
