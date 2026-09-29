import React from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {MaterialCommunityIcons} from '@expo/vector-icons';
import {ClientFadeInSoft} from './ClientScreenShell';
import {calendarDaysFromTodayLocal} from '../services/userApi';
import {REFERENCE_THEME as T} from '../constants/referenceTheme';

function formatQueueDateLabel(dateStr) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return 'No schedule';
  return d.toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric'});
}

function formatQueueTimeLabel(timeStr) {
  const d = new Date(timeStr);
  if (Number.isNaN(d.getTime())) return '--:--';
  return d.toLocaleTimeString('en-US', {hour: 'numeric', minute: '2-digit', hour12: true});
}

function getQueueCalendarFlags(dateStr) {
  const today = new Date();
  const apptDate = new Date(dateStr);
  if (Number.isNaN(apptDate.getTime())) {
    return {isToday: false, isPast: false};
  }
  const todayCal = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const apptCal = new Date(apptDate.getFullYear(), apptDate.getMonth(), apptDate.getDate());
  return {
    isToday: todayCal.getTime() === apptCal.getTime(),
    isPast: apptCal < todayCal,
  };
}

function statusBadgeStyle(status) {
  const key = String(status || '').toLowerCase();
  if (key === 'confirmed' || key === 'active') return styles.badgeStatusConfirmed;
  if (key === 'pending') return styles.badgeStatusPending;
  if (key === 'rescheduled') return styles.badgeStatusRescheduled;
  if (key === 'started' || key === 'in_progress' || key === 'in-progress') {
    return styles.badgeStatusStarted;
  }
  return styles.badgeStatusDefault;
}

export default function ClientConsultationQueue({
  items = [],
  loading = false,
  emptyTitle = 'No consultations in queue',
  emptySubtitle = 'Book a consultation to see it here.',
  onEnterRoom,
  onPay,
  renderItemFooter,
}) {
  const sorted = [...items].sort((a, b) => new Date(a.date) - new Date(b.date));

  if (loading) {
    return (
      <View style={styles.emptyState}>
        <ActivityIndicator size="small" color={T.gold[1]} />
        <Text style={styles.emptySubtitle}>Loading consultation queue...</Text>
      </View>
    );
  }

  if (sorted.length === 0) {
    return (
      <View style={styles.emptyState}>
        <MaterialCommunityIcons name="calendar-clock" size={40} color="rgba(255,255,255,0.2)" />
        <Text style={styles.emptyTitle}>{emptyTitle}</Text>
        <Text style={styles.emptySubtitle}>{emptySubtitle}</Text>
      </View>
    );
  }

  return (
    <View style={styles.list}>
      {sorted.map((item, index) => {
        const {isToday, isPast} = getQueueCalendarFlags(item.date);
        const daysUntil = calendarDaysFromTodayLocal(item.date);
        const apptDate = new Date(item.date);
        const monthLabel = Number.isNaN(apptDate.getTime())
          ? '—'
          : apptDate.toLocaleDateString('en-US', {month: 'short'});
        const dayLabel = Number.isNaN(apptDate.getTime()) ? '—' : String(apptDate.getDate());
        const isPaid = item.payment === 'Paid';

        const handleEnterRoom = () => {
          if (!isPaid) {
            onPay?.(item);
            return;
          }
          if (!item.chatAccessible) {
            Alert.alert(
              'Consultation not available yet',
              'Chat opens on your consultation day (any time that day).',
            );
            return;
          }
          onEnterRoom?.(item);
        };

        let rightContent = null;
        if (isPaid && item.chatAccessible) {
          rightContent = (
            <View style={styles.todayActions}>
              {isToday ? <Text style={styles.todayLabel}>TODAY</Text> : null}
              <TouchableOpacity style={styles.enterRoomBtn} activeOpacity={0.9} onPress={handleEnterRoom}>
                <MaterialCommunityIcons name="forum-outline" size={16} color="#fff" />
                <Text style={styles.enterRoomText}>Enter Room</Text>
              </TouchableOpacity>
            </View>
          );
        } else if (isPaid && !item.chatAccessible && !isPast) {
          rightContent = (
            <View style={styles.todayActions}>
              {isToday ? <Text style={styles.todayLabel}>TODAY</Text> : null}
              <Text style={styles.hintText}>Available on consultation day</Text>
            </View>
          );
        } else if (isToday && !isPaid) {
          rightContent = (
            <View style={styles.todayActions}>
              <Text style={styles.todayLabel}>TODAY</Text>
              <TouchableOpacity onPress={() => onPay?.(item)} hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
                <Text style={styles.payNeededText}>Pay first to enter</Text>
              </TouchableOpacity>
            </View>
          );
        } else if (isPast) {
          rightContent = <Text style={styles.statusTextPast}>Completed</Text>;
        } else {
          const label =
            daysUntil === 1 ? 'Tomorrow' : daysUntil > 1 ? `In ${daysUntil} days` : 'Past';
          rightContent = <Text style={styles.statusText}>{label}</Text>;
        }

        const footer = renderItemFooter?.(item);

        return (
          <ClientFadeInSoft key={item.id} delay={160 + index * 55}>
            <View style={styles.itemWrap}>
            <View
              style={[
                styles.item,
                isToday && styles.itemToday,
                isPast && styles.itemPast,
              ]}>
              <View style={styles.positionCol}>
                <Text style={styles.positionNum}>{index + 1}</Text>
              </View>

              <View style={styles.dateBlock}>
                <Text style={styles.monthText}>{monthLabel}</Text>
                <Text style={styles.dayText}>{dayLabel}</Text>
              </View>

              <View style={styles.infoCol}>
                <Text style={styles.nameText} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.areaText} numberOfLines={1}>
                  {item.area}
                </Text>
                <View style={styles.timeRow}>
                  <MaterialCommunityIcons name="clock-outline" size={13} color={T.textSoft} />
                  <Text style={styles.timeText}>
                    {formatQueueDateLabel(item.date)} at {formatQueueTimeLabel(item.time)}
                  </Text>
                </View>
              </View>

              <View style={styles.rightCol}>
                <View style={styles.badgeRow}>
                  <View style={[styles.badge, statusBadgeStyle(item.status)]}>
                    <Text style={styles.badgeText}>{String(item.status || 'pending')}</Text>
                  </View>
                  <View
                    style={[
                      styles.badge,
                      isPaid ? styles.badgePayPaid : styles.badgePayUnpaid,
                    ]}>
                    <Text style={styles.badgeText}>{item.payment}</Text>
                  </View>
                </View>
                {rightContent}
              </View>
            </View>
            {footer ? <View style={styles.itemFooter}>{footer}</View> : null}
            </View>
          </ClientFadeInSoft>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: 10,
  },
  itemWrap: {
    marginBottom: 10,
  },
  itemFooter: {
    marginTop: -4,
    paddingHorizontal: 10,
    paddingBottom: 4,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(18, 26, 36, 0.88)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.12)',
    paddingVertical: 12,
    paddingHorizontal: 10,
    marginBottom: 0,
  },
  itemToday: {
    borderColor: 'rgba(244, 215, 139, 0.38)',
    backgroundColor: 'rgba(33, 44, 60, 0.55)',
  },
  itemPast: {
    opacity: 0.72,
  },
  positionCol: {
    width: 28,
    alignItems: 'center',
    paddingTop: 4,
  },
  positionNum: {
    color: T.gold[1],
    fontWeight: '900',
    fontSize: 16,
  },
  dateBlock: {
    width: 44,
    alignItems: 'center',
    marginRight: 8,
    paddingTop: 2,
  },
  monthText: {
    color: T.textSoft,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  dayText: {
    color: T.text,
    fontSize: 22,
    fontWeight: '900',
    lineHeight: 26,
  },
  infoCol: {
    flex: 1,
    minWidth: 0,
    paddingRight: 6,
  },
  nameText: {
    color: T.text,
    fontWeight: '800',
    fontSize: 14,
  },
  areaText: {
    color: T.textSoft,
    fontSize: 11,
    marginTop: 2,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
  },
  timeText: {
    flex: 1,
    color: T.textMuted,
    fontSize: 10,
    fontWeight: '600',
  },
  rightCol: {
    width: 118,
    alignItems: 'flex-end',
    gap: 8,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 4,
  },
  badge: {
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: T.text,
    textTransform: 'capitalize',
  },
  badgeStatusDefault: {
    backgroundColor: 'rgba(148, 163, 184, 0.15)',
    borderColor: 'rgba(148, 163, 184, 0.35)',
  },
  badgeStatusPending: {
    backgroundColor: 'rgba(251, 191, 36, 0.12)',
    borderColor: 'rgba(251, 191, 36, 0.35)',
  },
  badgeStatusConfirmed: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderColor: 'rgba(16, 185, 129, 0.35)',
  },
  badgeStatusRescheduled: {
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    borderColor: 'rgba(59, 130, 246, 0.35)',
  },
  badgeStatusStarted: {
    backgroundColor: 'rgba(168, 85, 247, 0.15)',
    borderColor: 'rgba(168, 85, 247, 0.35)',
  },
  badgePayPaid: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  badgePayUnpaid: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  todayActions: {
    alignItems: 'flex-end',
    gap: 6,
  },
  todayLabel: {
    color: T.gold[1],
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
  },
  enterRoomBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#2563EB',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 7,
  },
  enterRoomText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
  },
  hintText: {
    color: T.textSoft,
    fontSize: 9,
    fontWeight: '600',
    textAlign: 'right',
    maxWidth: 110,
  },
  payNeededText: {
    color: '#FCA5A5',
    fontSize: 9,
    fontWeight: '700',
    textAlign: 'right',
    maxWidth: 110,
  },
  statusText: {
    color: T.textMuted,
    fontSize: 10,
    fontWeight: '700',
    textAlign: 'right',
  },
  statusTextPast: {
    color: T.textSoft,
    fontSize: 10,
    fontWeight: '700',
    textAlign: 'right',
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
    marginTop: 8,
    color: T.textSoft,
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 16,
  },
});
