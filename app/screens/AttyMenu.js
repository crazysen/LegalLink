import React from 'react';
import {Image, ScrollView, StyleSheet, View, Text, TouchableOpacity} from 'react-native';
import {LinearGradient} from 'expo-linear-gradient';
import {MaterialCommunityIcons} from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {signOutCurrentUser} from '../services/authService';
import {ClientScreenShell} from '../components/ClientScreenShell';
import {REFERENCE_THEME as T} from '../constants/referenceTheme';

const ICONS = {
  AttyLandingPage: 'view-dashboard-outline',
  AttyMyAppointments: 'calendar-check-outline',
  AttyAvailabilityManager: 'calendar-clock-outline',
  AttorneyConsultationLogs: 'text-box-outline',
  AttyAnnouncements: 'bullhorn-outline',
  AttyProfileSettings: 'account-circle-outline',
};

const AttorneySidebar = ({navigation, route}) => {
  const stackState = navigation.getState();
  const previousRouteName =
    stackState?.routes?.[Math.max(0, (stackState?.index ?? 0) - 1)]?.name ??
    'AttyLandingPage';
  const activeRoute = route?.params?.activeRoute || previousRouteName;

  const menuItems = [
    {id: '1', label: 'Dashboard', route: 'AttyLandingPage'},
    {id: '2', label: 'Consultation Management', route: 'AttyMyAppointments'},
    {id: '2b', label: 'My Availability', route: 'AttyAvailabilityManager'},
    {id: '3', label: 'Logs', route: 'AttorneyConsultationLogs'},
    {id: '4', label: 'Announcement', route: 'AttyAnnouncements'},
    {id: '5', label: 'Profile', route: 'AttyProfileSettings'},
  ];

  const handleMenuPress = item => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (item.route) {
      navigation.navigate(item.route);
    }
  };

  const handleTerminate = async () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    try {
      await signOutCurrentUser();
    } catch {
      // Still leave the app shell; session may already be cleared
    }
    navigation.reset({
      index: 0,
      routes: [{name: 'Landing'}],
    });
  };

  return (
    <ClientScreenShell edges={['top', 'bottom']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>
        <View style={styles.brandRow}>
          <View style={styles.logoBox}>
            <Image
              source={require('../assets/images/logo.jpg')}
              style={styles.logoImage}
              resizeMode="cover"
            />
          </View>
          <View style={styles.brandCopy}>
            <Text style={styles.brandText}>LegalLink</Text>
            <Text style={styles.brandSub}>Attorney Console</Text>
          </View>
        </View>

        <View style={styles.navSection}>
          {menuItems.map(item => {
            const isActive = activeRoute === item.route;
            const iconName = ICONS[item.route] || 'circle-small';
            return (
              <TouchableOpacity
                key={item.id}
                activeOpacity={0.88}
                style={styles.navItemWrapper}
                onPress={() => handleMenuPress(item)}>
                {isActive ? (
                  <LinearGradient
                    colors={['rgba(244,215,139,0.35)', 'rgba(215,177,74,0.92)']}
                    start={{x: 0, y: 0}}
                    end={{x: 1, y: 1}}
                    style={styles.activeGradient}>
                    <MaterialCommunityIcons
                      name={iconName}
                      size={22}
                      color="#101B2C"
                    />
                    <Text style={styles.navTextActive}>{item.label}</Text>
                    <View style={styles.activePill} />
                  </LinearGradient>
                ) : (
                  <View style={styles.inactiveItem}>
                    <MaterialCommunityIcons
                      name={iconName}
                      size={22}
                      color={T.textMuted}
                    />
                    <Text style={styles.navText}>{item.label}</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.divider} />

        <TouchableOpacity style={styles.terminateBtn} onPress={handleTerminate} activeOpacity={0.88}>
          <MaterialCommunityIcons name="logout" size={22} color="#FF5252" />
          <Text style={styles.terminateText}>Log out</Text>
        </TouchableOpacity>
      </ScrollView>
    </ClientScreenShell>
  );
};

const styles = StyleSheet.create({
  scroll: {flex: 1},
  scrollContent: {padding: 20, paddingBottom: 36},
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 28,
    marginTop: 8,
  },
  logoBox: {
    width: 42,
    height: 42,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.24)',
    backgroundColor: 'rgba(12, 19, 30, 0.9)',
  },
  logoImage: {
    width: '100%',
    height: '100%',
  },
  brandCopy: {marginLeft: 14, flex: 1},
  brandText: {
    color: T.text,
    fontSize: 20,
    fontWeight: '900',
    fontStyle: 'italic',
  },
  brandSub: {
    color: T.textSoft,
    fontSize: 11,
    marginTop: 2,
    letterSpacing: 0.5,
  },
  navSection: {marginTop: 4},
  navItemWrapper: {marginBottom: 10},
  activeGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  activePill: {
    marginLeft: 'auto',
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(4,7,11,0.85)',
  },
  inactiveItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.024)',
    borderWidth: 1,
    borderColor: 'rgba(153, 180, 230, 0.13)',
  },
  navText: {
    fontSize: 14,
    fontWeight: '700',
    marginLeft: 12,
    color: T.textMuted,
    letterSpacing: 0.3,
    flex: 1,
  },
  navTextActive: {
    fontSize: 14,
    fontWeight: '800',
    marginLeft: 12,
    color: '#101B2C',
    letterSpacing: 0.3,
    flex: 1,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(153, 180, 230, 0.22)',
    marginVertical: 16,
  },
  terminateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(244,63,94,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(244,63,94,0.2)',
  },
  terminateText: {
    fontSize: 15,
    color: '#FF5252',
    fontWeight: '800',
    marginLeft: 12,
  },
});

export default AttorneySidebar;
