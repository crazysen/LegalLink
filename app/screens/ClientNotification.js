import React, {useCallback, useEffect} from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {REFERENCE_THEME as T} from '../constants/referenceTheme';
import {ClientScreenShell, ClientFadeIn} from '../components/ClientScreenShell';
import ClientChevronBack from '../components/ClientChevronBack';
import {useNotifications} from '../context/NotificationContext';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function getRelativeTime(value) {
  const now = Date.now();
  const parsed = String(value || '').trim().replace(' ', 'T').replace(/\+00$/, 'Z');
  const target = new Date(parsed).getTime();
  if (Number.isNaN(target)) return 'JUST NOW';
  const diffMins = Math.max(1, Math.floor((now - target) / 60000));
  if (diffMins < 60) return `${diffMins}M AGO`;
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)}H AGO`;
  return `${Math.floor(diffMins / 1440)}D AGO`;
}

/** Map notification `type` value to a display icon + background. */
function getIconForType(type) {
  const t = String(type || '').toLowerCase();
  if (t === 'payment')         return {icon: '💳', bg: '#EEF2FF'};
  if (t === 'notarial_update') return {icon: '📄', bg: '#F0FDF4'};
  if (t === 'consultation')    return {icon: '📅', bg: '#FEF3C7'};
  if (t === 'announcement' || t === 'admin_announcement') return {icon: '📢', bg: '#FFF7ED'};
  return {icon: '🔔', bg: '#E2E8F0'};
}

// ─────────────────────────────────────────────────────────────────────────────
// Screen
// ─────────────────────────────────────────────────────────────────────────────

export default function ClientNotification({navigation}) {
  const {notifications, unreadCount, markAllRead, markRead, refresh} =
    useNotifications();

  // Refresh list & mark all read each time the screen is focused
  useFocusEffect(
    useCallback(() => {
      refresh();
      // Small delay so the user sees the badge before it disappears
      const t = setTimeout(() => markAllRead(), 1200);
      return () => clearTimeout(t);
    }, [refresh, markAllRead]),
  );

  // Also refresh on initial mount
  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleNotifPress = (item) => {
    // Mark individual notification read immediately
    if (!item.is_read) markRead(item.id);

    // Deep-link from data field if present
    const data = item.data || {};
    if (data.screen) {
      navigation.navigate(data.screen, data.params || {});
    }
  };

  return (
    <ClientScreenShell>
      <ClientFadeIn>
        <ClientChevronBack
          style={styles.backHit}
          onPress={() => (navigation.canGoBack() ? navigation.goBack() : null)}
        />

        <View style={styles.headerSection}>
          <View style={styles.headerRow}>
            <Text style={styles.mainTitle}>Notifications</Text>
            {unreadCount > 0 && (
              <TouchableOpacity onPress={markAllRead} style={styles.clearBtn}>
                <Text style={styles.clearBtnText}>Mark all read</Text>
              </TouchableOpacity>
            )}
          </View>
          <Text style={styles.subtitle}>Stay updated on your legal proceedings.</Text>
        </View>
      </ClientFadeIn>

      {notifications.length === 0 ? (
        <View style={styles.centerState}>
          <Text style={styles.emptyIcon}>🔔</Text>
          <Text style={styles.centerStateTitle}>No notifications yet</Text>
          <Text style={styles.centerStateText}>
            Updates about your appointments and notarial requests will appear here.
          </Text>
        </View>
      ) : (
        <FlatList
          style={styles.listFlex}
          data={notifications}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listPadding}
          showsVerticalScrollIndicator={false}
          renderItem={({item, index}) => {
            const {icon, bg} = getIconForType(item.type);
            const isUnread = !item.is_read;
            return (
              <ClientFadeIn delay={40 + index * 35}>
                <TouchableOpacity
                  activeOpacity={0.88}
                  onPress={() => handleNotifPress(item)}
                  style={[styles.card, isUnread && styles.cardUnread]}>
                  {isUnread && <View style={styles.unreadDot} />}
                  <View style={[styles.iconContainer, {backgroundColor: bg}]}>
                    <Text style={styles.iconText}>{icon}</Text>
                  </View>

                  <View style={styles.cardContent}>
                    <View style={styles.row}>
                      <Text
                        style={[styles.cardTitle, isUnread && styles.cardTitleUnread]}
                        numberOfLines={1}>
                        {item.title}
                      </Text>
                      <Text style={styles.timeText}>
                        {getRelativeTime(item.created_at)}
                      </Text>
                    </View>
                    <Text style={styles.descriptionText} numberOfLines={3}>
                      {item.body}
                    </Text>
                  </View>
                </TouchableOpacity>
              </ClientFadeIn>
            );
          }}
        />
      )}
    </ClientScreenShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  listFlex: {flex: 1},
  backHit: {
    alignSelf: 'flex-start',
    marginLeft: 18,
    marginTop: 8,
  },
  headerSection: {paddingHorizontal: 24, paddingTop: 8, paddingBottom: 18},
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  mainTitle: {fontSize: 32, fontWeight: '800', color: T.text},
  clearBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(244, 215, 139, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.25)',
  },
  clearBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: T.gold[0],
    letterSpacing: 0.4,
  },
  subtitle: {fontSize: 15, color: T.textSoft},
  listPadding: {paddingHorizontal: 16, paddingBottom: 32},
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyIcon: {fontSize: 40, marginBottom: 12},
  centerStateTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: T.text,
    marginBottom: 8,
  },
  centerStateText: {
    color: T.textSoft,
    textAlign: 'center',
    lineHeight: 21,
    fontSize: 14,
  },
  card: {
    backgroundColor: 'rgba(18, 26, 36, 0.88)',
    borderRadius: 22,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.12)',
    flexDirection: 'row',
    position: 'relative',
    overflow: 'hidden',
  },
  cardUnread: {
    borderColor: 'rgba(244, 215, 139, 0.35)',
    backgroundColor: 'rgba(22, 32, 48, 0.95)',
  },
  unreadDot: {
    position: 'absolute',
    top: 14,
    right: 14,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: T.gold[1],
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    flexShrink: 0,
  },
  iconText: {fontSize: 22},
  cardContent: {flex: 1},
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  cardTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: T.textMuted,
    marginRight: 8,
  },
  cardTitleUnread: {
    color: T.text,
    fontWeight: '800',
  },
  timeText: {fontSize: 11, color: T.textSoft, fontWeight: '600', flexShrink: 0},
  descriptionText: {
    fontSize: 13,
    color: T.textMuted,
    lineHeight: 19,
  },
});
