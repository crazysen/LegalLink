/**
 * Client drawer aligned with github.com/rxasrn/mobile_client_side (screens/Sidebar.js).
 * Rotating dashed ring lives on dashboard cards (KineticClientCard), not in this menu.
 */
import React, {useCallback, useState} from 'react';
import {useFocusEffect} from '@react-navigation/native';
import {
  Alert,
  Dimensions,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import {Feather, MaterialCommunityIcons} from '@expo/vector-icons';
import {LinearGradient} from 'expo-linear-gradient';
import {signOutCurrentUser} from '../services/authService';
import {fetchClientSupportUnreadCount, getCurrentSessionProfile} from '../services/userApi';
import {REFERENCE_THEME as T} from '../constants/referenceTheme';
import {ClientScreenShell} from '../components/ClientScreenShell';
import {CLIENT_MENU_WEB_ROUTES} from '../constants/routeAlignment';

const {width, height} = Dimensions.get('window');

const DANGER = '#E74C3C';
const DANGER_DARK = '#962D22';

const INACTIVE_DIAMOND = ['#2A394B', '#121A25'];

const ROUTE_ICONS = {
  HomepageClient: 'view-dashboard',
  BookAppointment: 'calendar-check',
  ClientSupportMessages: 'message-text',
  ClientConsultationLogs: 'text-box-outline',
  ClientNotaryStatus: 'file-document-outline',
  ClientNotification: 'bullhorn',
  TransactionHistory: 'history',
  ProfileSettingsClient: 'account-circle',
};

const menuRoutes = CLIENT_MENU_WEB_ROUTES.map(row => ({
  label: row.label,
  route: row.route,
  icon: ROUTE_ICONS[row.route] || 'circle-small',
}));

function SidebarItem({icon, label, isActive, isLogout, badgeCount, onPress}) {
  const gradientColors = isLogout
    ? [DANGER, DANGER_DARK]
    : isActive
      ? T.gold
      : INACTIVE_DIAMOND;

  const iconColor =
    isLogout || isActive ? T.base : T.gold[1];

  return (
    <TouchableOpacity
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        onPress?.();
      }}
      style={[styles.navItem, isActive && !isLogout && styles.navItemActive]}
      activeOpacity={0.7}>
      <View style={styles.navIconContainer}>
        <LinearGradient colors={gradientColors} style={styles.navIconDiamond}>
          <View style={styles.iconCounterRotate}>
            <MaterialCommunityIcons name={icon} size={18} color={iconColor} />
          </View>
        </LinearGradient>
        {!isLogout && badgeCount > 0 ? (
          <View style={styles.navBadge}>
            <Text style={styles.navBadgeText}>{badgeCount > 9 ? '9+' : String(badgeCount)}</Text>
          </View>
        ) : null}
      </View>
      <Text
        style={[
          styles.navLabel,
          isActive && !isLogout && styles.navLabelActive,
          isLogout && styles.navLabelLogout,
        ]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

export default function ClientMenu({navigation, route}) {
  const stackState = navigation.getState();
  const previousRouteName =
    stackState?.routes?.[Math.max(0, (stackState?.index ?? 0) - 1)]?.name ?? 'HomepageClient';
  const activeRoute = route?.params?.activeRoute || previousRouteName;
  const [supportUnread, setSupportUnread] = useState(0);

  const refreshSupportUnread = useCallback(async () => {
    try {
      const {profile} = await getCurrentSessionProfile();
      const uid = profile?.id;
      if (!uid) {
        setSupportUnread(0);
        return;
      }
      const count = await fetchClientSupportUnreadCount(uid);
      setSupportUnread(Number(count) || 0);
    } catch {
      setSupportUnread(0);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshSupportUnread();
    }, [refreshSupportUnread]),
  );

  const go = routeName => {
    if (!routeName) return;
    navigation.replace(routeName);
  };

  const handleClose = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    }
  };

  const handleLogout = () => {
    Alert.alert('Logout', 'Are you sure you want to logout?', [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Logout',
        style: 'destructive',
        onPress: async () => {
          try {
            await signOutCurrentUser();
          } catch {
            // still leave app
          }
          navigation.reset({
            index: 0,
            routes: [{name: 'Landing'}],
          });
        },
      },
    ]);
  };

  return (
    <ClientScreenShell>
      <View style={styles.panelOuter}>
        <View
          style={[
            styles.sidebarContainer,
            {width: Math.min(width * 0.92, width - 24), minHeight: height * 0.88},
          ]}>
          <LinearGradient
            colors={['rgba(244, 215, 139, 0.25)', 'rgba(255, 255, 255, 0.05)']}
            style={styles.sidebarGlassBorder}>
            <View style={styles.sidebarContent}>
              <View style={styles.sidebarHeader}>
                <View style={styles.brandWrap}>
                  <Image
                    source={require('../assets/images/logo.jpg')}
                    style={styles.brandLogo}
                    resizeMode="cover"
                  />
                  <Text style={styles.brandText}>LegalLink</Text>
                </View>
                <TouchableOpacity onPress={handleClose} hitSlop={{top: 12, bottom: 12, left: 12, right: 12}}>
                  <Feather name="chevron-left" size={24} color={T.gold[0]} />
                </TouchableOpacity>
              </View>

              <ScrollView
                style={styles.navScrollFlex}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.navScroll}>
                {menuRoutes.map(item => (
                  <SidebarItem
                    key={item.route}
                    icon={item.icon}
                    label={item.label}
                    isActive={activeRoute === item.route}
                    badgeCount={
                      item.route === 'ClientSupportMessages' &&
                      activeRoute !== 'ClientSupportMessages'
                        ? supportUnread
                        : 0
                    }
                    onPress={() => go(item.route)}
                  />
                ))}
              </ScrollView>

              <View style={styles.sidebarFooter}>
                <SidebarItem icon="door-open" label="Logout" isLogout onPress={handleLogout} />
              </View>
            </View>
          </LinearGradient>
        </View>
      </View>
    </ClientScreenShell>
  );
}

const styles = StyleSheet.create({
  panelOuter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  sidebarContainer: {
    borderRadius: 35,
    overflow: 'hidden',
    elevation: 25,
    shadowColor: 'rgba(212, 175, 55, 0.22)',
    shadowOpacity: 0.22,
    shadowRadius: 26,
    shadowOffset: {width: 0, height: 10},
  },
  sidebarGlassBorder: {
    flex: 1,
    padding: 1.5,
    borderRadius: 35,
  },
  sidebarContent: {
    flex: 1,
    backgroundColor: 'rgba(18, 26, 36, 0.85)',
    borderRadius: 33,
    padding: 20,
  },
  sidebarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
    paddingTop: 6,
  },
  brandWrap: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  brandLogo: {
    width: 30,
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.35)',
  },
  brandText: {
    color: T.text,
    fontSize: 20,
    fontWeight: '900',
    marginLeft: 10,
    letterSpacing: -0.5,
  },
  navScrollFlex: {
    flex: 1,
  },
  navScroll: {
    paddingBottom: 12,
    flexGrow: 1,
  },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    marginBottom: 8,
    borderRadius: 15,
    paddingHorizontal: 10,
  },
  navItemActive: {
    backgroundColor: 'rgba(244, 215, 139, 0.1)',
  },
  navIconContainer: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  navBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: '#E74C3C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
  },
  navIconDiamond: {
    width: 30,
    height: 30,
    borderRadius: 8,
    transform: [{rotate: '45deg'}],
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconCounterRotate: {
    transform: [{rotate: '-45deg'}],
  },
  navLabel: {
    color: T.textSoft,
    fontSize: 15,
    fontWeight: '600',
    marginLeft: 15,
  },
  navLabelActive: {
    color: T.gold[0],
    fontWeight: '800',
  },
  navLabelLogout: {
    color: DANGER,
    fontWeight: '700',
  },
  sidebarFooter: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.05)',
    paddingTop: 15,
  },
});
