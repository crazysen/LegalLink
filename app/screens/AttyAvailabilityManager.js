import React, {useState, useEffect, useCallback} from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {MaterialCommunityIcons} from '@expo/vector-icons';
import {
  getAttorneyAvailabilitySlots,
  getAttorneyCompletedConsultationSlotKeys,
  HOURLY_CONSULTATION_SLOT_LABELS,
  isConsultationSlotInTheFuture,
  setAvailability,
} from '../services/appointmentService';
import {supabase} from '../services/supabaseClient';
import {ClientScreenShell} from '../components/ClientScreenShell';
import {REFERENCE_THEME as T} from '../constants/referenceTheme';

const accentGold = T.gold[1];

const ChevronLeft = props => <MaterialCommunityIcons name="chevron-left" {...props} />;
const ChevronRight = props => <MaterialCommunityIcons name="chevron-right" {...props} />;

const ALL_SLOTS = HOURLY_CONSULTATION_SLOT_LABELS;

const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function slotKey(dateStr, time) {
  return `${dateStr}|${time}`;
}

/** Local midnight for `YYYY-MM-DD` (device timezone). */
function parseYmdLocalDate(dateStr) {
  const parts = String(dateStr).split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    return null;
  }
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

export default function AvailabilityManager({navigation}) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDateStr, setSelectedDateStr] = useState('');

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  /** Unbooked slots (attorney-editable) */
  const [openSlotKeys, setOpenSlotKeys] = useState(new Set());
  /** Client-booked slots (read-only) */
  const [bookedSlotKeys, setBookedSlotKeys] = useState(new Set());
  /** Past completed consultations (read-only label) */
  const [completedSlotKeys, setCompletedSlotKeys] = useState(new Set());

  const [activeSlots, setActiveSlots] = useState([]);

  useEffect(() => {
    const today = new Date();
    const formatted = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    setSelectedDateStr(formatted);
  }, []);

  const fetchGlobalSlots = useCallback(async () => {
    const {data: {user}} = await supabase.auth.getUser();
    const attorneyId = user?.id;
    if (!attorneyId) {
      return;
    }
    try {
      setLoading(true);
      const rows = await getAttorneyAvailabilitySlots(attorneyId);
      let completedKeys = [];
      try {
        completedKeys = await getAttorneyCompletedConsultationSlotKeys(attorneyId);
      } catch {
        completedKeys = [];
      }
      const open = new Set();
      const booked = new Set();
      rows.forEach(s => {
        const key = slotKey(s.date, s.time);
        if (s.is_booked) {
          booked.add(key);
        } else {
          open.add(key);
        }
      });
      const completedSet = new Set(completedKeys);
      const bookedUi = new Set([...booked].filter(k => !completedSet.has(k)));
      setOpenSlotKeys(open);
      setBookedSlotKeys(bookedUi);
      setCompletedSlotKeys(completedSet);
    } catch (_e) {
      Alert.alert('Error', 'Failed to load availability.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchGlobalSlots();
    }, [fetchGlobalSlots]),
  );

  useEffect(() => {
    if (!selectedDateStr) {
      return;
    }
    const dayDate = parseYmdLocalDate(selectedDateStr);
    if (!dayDate) {
      return;
    }
    const daily = [];
    ALL_SLOTS.forEach(time => {
      if (!openSlotKeys.has(slotKey(selectedDateStr, time))) {
        return;
      }
      if (!isConsultationSlotInTheFuture(dayDate, time)) {
        return;
      }
      daily.push(time);
    });
    setActiveSlots(daily);
  }, [selectedDateStr, openSlotKeys]);

  const getCalendarDays = () => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const previousMonthDays = new Date(year, month, 0).getDate();

    const calendarArray = [];

    for (let i = firstDay - 1; i >= 0; i--) {
      calendarArray.push({
        num: previousMonthDays - i,
        isCurrentMonth: false,
        dateStr: '',
      });
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

      let hasOpen = false;
      let hasBooked = false;
      let hasCompleted = false;
      for (let j = 0; j < ALL_SLOTS.length; j++) {
        const k = slotKey(dateStr, ALL_SLOTS[j]);
        if (openSlotKeys.has(k)) {
          hasOpen = true;
        }
        if (bookedSlotKeys.has(k)) {
          hasBooked = true;
        }
        if (completedSlotKeys.has(k)) {
          hasCompleted = true;
        }
        if (hasOpen && hasBooked && hasCompleted) {
          break;
        }
      }

      calendarArray.push({
        num: day,
        isCurrentMonth: true,
        dateStr,
        hasOpen,
        hasBooked,
        hasCompleted,
      });
    }

    const totalCells = calendarArray.length;
    const remainingCells = Math.ceil(totalCells / 7) * 7 - totalCells;
    for (let i = 1; i <= remainingCells; i++) {
      calendarArray.push({
        num: i,
        isCurrentMonth: false,
        dateStr: '',
      });
    }

    return calendarArray;
  };

  const calendarDays = getCalendarDays();
  const monthLabel = currentMonth.toLocaleString('default', {month: 'long', year: 'numeric'});

  const toggleSlot = time => {
    if (!selectedDateStr) {
      return;
    }
    if (bookedSlotKeys.has(slotKey(selectedDateStr, time))) {
      return;
    }
    const dayDate = parseYmdLocalDate(selectedDateStr);
    if (!dayDate) {
      return;
    }
    setActiveSlots(prev => {
      if (prev.includes(time)) {
        return prev.filter(t => t !== time);
      }
      if (!isConsultationSlotInTheFuture(dayDate, time)) {
        return prev;
      }
      return [...prev, time];
    });
  };

  const handleSave = async () => {
    if (!selectedDateStr) {
      return;
    }
    const dayDate = parseYmdLocalDate(selectedDateStr);
    if (!dayDate) {
      Alert.alert('Invalid date', 'Please select a valid day on the calendar.');
      return;
    }
    const stalePast = activeSlots.filter(
      t => !isConsultationSlotInTheFuture(dayDate, t),
    );
    if (stalePast.length > 0) {
      Alert.alert(
        'Past times',
        'You cannot save availability for times that have already passed. Remove those slots or pick a later time.',
      );
      return;
    }
    try {
      setSaving(true);
      await setAvailability(selectedDateStr, activeSlots);
      await fetchGlobalSlots();
      Alert.alert('Success', `Saved schedule for ${selectedDateStr}`);
    } catch (e) {
      Alert.alert('Error', `Failed to save: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const changeMonth = offset => {
    setCurrentMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + offset, 1));
    setSelectedDateStr(prev => {
      if (!prev) {
        return prev;
      }
      const parts = prev.split('-').map(Number);
      if (parts.length !== 3 || parts.some(n => Number.isNaN(n))) {
        return prev;
      }
      const [py, pm, pd] = parts;
      const base = new Date(py, pm - 1 + offset, 1);
      const ny = base.getFullYear();
      const nmonth = base.getMonth();
      const lastDay = new Date(ny, nmonth + 1, 0).getDate();
      const day = Math.min(pd, lastDay);
      return `${ny}-${String(nmonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    });
  };

  const getSelectedLabel = () => {
    if (!selectedDateStr) {
      return 'Select a date';
    }
    const [y, m, d] = selectedDateStr.split('-');
    const dt = new Date(Number(y), Number(m) - 1, Number(d));
    return dt.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const selectedDayDate = selectedDateStr ? parseYmdLocalDate(selectedDateStr) : null;

  return (
    <ClientScreenShell edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => (navigation.canGoBack() ? navigation.goBack() : null)}
          style={styles.backButton}>
          <ChevronLeft color={T.text} size={28} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Availability Grid</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
        <View style={styles.calendarCard}>
          <View style={styles.calendarHeader}>
            <TouchableOpacity onPress={() => changeMonth(-1)} style={styles.arrowButton}>
              <ChevronLeft color={accentGold} size={24} />
            </TouchableOpacity>
            <Text style={styles.monthText}>{monthLabel}</Text>
            <TouchableOpacity onPress={() => changeMonth(1)} style={styles.arrowButton}>
              <ChevronRight color={accentGold} size={24} />
            </TouchableOpacity>
          </View>

          <View style={styles.daysOfWeekRow}>
            {DAYS_OF_WEEK.map(d => (
              <Text key={d} style={styles.dayOfWeekText}>
                {d[0]}
              </Text>
            ))}
          </View>

          <View style={styles.legendRow}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, styles.legendDotOpen]} />
              <Text style={styles.legendText}>Available</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, styles.legendDotBooked]} />
              <Text style={styles.legendText}>Booked</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, styles.legendDotCompleted]} />
              <Text style={styles.legendText}>Completed</Text>
            </View>
          </View>

          {loading ? (
            <View style={styles.loaderAreaCalendar}>
              <ActivityIndicator size="small" color={accentGold} />
            </View>
          ) : (
            <View style={styles.gridContainer}>
              {calendarDays.map((calDay, index) => {
                const isSelected = calDay.isCurrentMonth && calDay.dateStr === selectedDateStr;
                const isToday = calDay.isCurrentMonth && calDay.dateStr === todayStr;
                const isPastDay =
                  calDay.isCurrentMonth && calDay.dateStr && calDay.dateStr < todayStr;
                const showDots =
                  calDay.isCurrentMonth &&
                  (calDay.hasOpen || calDay.hasBooked || calDay.hasCompleted);

                return (
                  <TouchableOpacity
                    key={index}
                    activeOpacity={0.7}
                    onPress={() => {
                      if (calDay.isCurrentMonth) {
                        setSelectedDateStr(calDay.dateStr);
                      }
                    }}
                    style={styles.dayCell}
                    disabled={!calDay.isCurrentMonth}>
                    <View
                      style={[
                        styles.dayCircle,
                        isSelected && styles.dayCircleSelected,
                        isToday && !isSelected && styles.dayCircleToday,
                      ]}>
                      <Text
                        style={[
                          styles.dayText,
                          !calDay.isCurrentMonth && styles.dayTextDisabled,
                          isPastDay && !isSelected && styles.dayTextPast,
                          isSelected && styles.dayTextSelected,
                          isToday && !isSelected && styles.dayTextToday,
                        ]}>
                        {calDay.num}
                      </Text>
                    </View>
                    {showDots && (
                      <View style={styles.dotsRow}>
                        {calDay.hasOpen ? (
                          <View style={[styles.dot, isSelected && styles.dotSelected]} />
                        ) : null}
                        {calDay.hasBooked ? (
                          <View style={[styles.dotBooked, isSelected && styles.dotBookedSelected]} />
                        ) : null}
                        {calDay.hasCompleted ? (
                          <View style={[styles.dotCompleted, isSelected && styles.dotCompletedSelected]} />
                        ) : null}
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>

        <View style={styles.slotsCard}>
          <Text style={styles.selectedDateTitle}>{getSelectedLabel()}</Text>
          <Text style={styles.subText}>
            Select active time slots to open your availability for the whole day. Booked slots cannot be changed
            here. Past dates and past hours today cannot be opened for booking.
          </Text>

          <View style={styles.slotsGrid}>
            {ALL_SLOTS.map(time => {
              const key = selectedDateStr ? slotKey(selectedDateStr, time) : '';
              const isBooked = key && bookedSlotKeys.has(key);
              const isActive = activeSlots.includes(time) && !isBooked;
              const isCompletedOnly =
                key &&
                !isBooked &&
                completedSlotKeys.has(key) &&
                !openSlotKeys.has(key) &&
                !activeSlots.includes(time);
              const slotIsFuture =
                !selectedDateStr ||
                (selectedDayDate != null &&
                  isConsultationSlotInTheFuture(selectedDayDate, time));

              if (isBooked) {
                return (
                  <View key={time} style={[styles.slotItem, styles.slotItemBooked]}>
                    <Text style={styles.slotTextBooked}>{time}</Text>
                    <Text style={styles.bookedLabel}>Booked</Text>
                  </View>
                );
              }

              if (isCompletedOnly) {
                const CompletedWrap = slotIsFuture ? TouchableOpacity : View;
                const wrapProps = slotIsFuture
                  ? {onPress: () => toggleSlot(time), activeOpacity: 0.7}
                  : {};
                return (
                  <CompletedWrap
                    key={time}
                    style={[styles.slotItem, styles.slotItemCompleted]}
                    {...wrapProps}>
                    <Text style={styles.slotTextCompleted}>{time}</Text>
                    <Text style={styles.completedLabel}>Completed</Text>
                  </CompletedWrap>
                );
              }

              if (!slotIsFuture) {
                return (
                  <View key={time} style={[styles.slotItem, styles.slotItemPast]}>
                    <Text style={styles.slotTextPast}>{time}</Text>
                    <Text style={styles.pastLabel}>Past</Text>
                  </View>
                );
              }

              return (
                <TouchableOpacity
                  key={time}
                  style={[styles.slotItem, isActive && styles.slotItemActive]}
                  onPress={() => toggleSlot(time)}
                  activeOpacity={0.7}>
                  <Text style={[styles.slotText, isActive && styles.slotTextActive]}>{time}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity
            style={styles.saveBtn}
            onPress={handleSave}
            disabled={saving || loading || !selectedDateStr}>
            <Text style={styles.saveBtnText}>{saving ? 'Saving...' : 'Save Day Schedule'}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </ClientScreenShell>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.1)',
  },
  backButton: {marginRight: 12},
  headerTitle: {fontSize: 22, fontWeight: '900', color: T.text},

  calendarCard: {
    backgroundColor: 'rgba(12, 19, 30, 0.92)',
    margin: 16,
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.12)',
  },
  calendarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  arrowButton: {padding: 4},
  monthText: {fontSize: 18, fontWeight: '800', color: T.text},

  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginBottom: 10,
  },
  legendItem: {flexDirection: 'row', alignItems: 'center', marginHorizontal: 8, marginBottom: 4},
  legendDot: {width: 6, height: 6, borderRadius: 3, marginRight: 6},
  legendDotOpen: {backgroundColor: accentGold},
  legendDotBooked: {backgroundColor: '#FB923C'},
  legendDotCompleted: {backgroundColor: '#A78BFA'},
  legendText: {fontSize: 11, color: T.textMuted, fontWeight: '600'},

  daysOfWeekRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  dayOfWeekText: {
    width: 36,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '700',
    color: T.textSoft,
  },

  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  dayCell: {
    width: '14.28%',
    aspectRatio: 1,
    justifyContent: 'flex-start',
    alignItems: 'center',
    marginBottom: 4,
  },
  dayCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dayCircleSelected: {backgroundColor: accentGold},
  dayCircleToday: {backgroundColor: 'rgba(215, 177, 74, 0.14)'},

  dayText: {fontSize: 16, fontWeight: '500', color: T.text},
  dayTextDisabled: {color: T.textSoft},
  dayTextPast: {color: T.textSoft, opacity: 0.45},
  dayTextSelected: {color: '#101B2C', fontWeight: 'bold'},
  dayTextToday: {color: T.gold[0], fontWeight: 'bold'},

  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    minHeight: 6,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: accentGold,
    marginHorizontal: 2,
  },
  dotSelected: {backgroundColor: '#101B2C', opacity: 1},
  dotBooked: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#FB923C',
    marginHorizontal: 2,
  },
  dotBookedSelected: {backgroundColor: '#FED7AA', opacity: 1},
  dotCompleted: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#A78BFA',
    marginHorizontal: 2,
  },
  dotCompletedSelected: {backgroundColor: '#E9D5FF', opacity: 1},

  loaderAreaCalendar: {height: 250, justifyContent: 'center', alignItems: 'center'},

  slotsCard: {
    backgroundColor: 'rgba(12, 19, 30, 0.92)',
    marginHorizontal: 16,
    marginBottom: 30,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.12)',
  },
  selectedDateTitle: {fontSize: 18, fontWeight: '800', color: T.text, marginBottom: 4},
  subText: {fontSize: 13, color: T.textMuted, marginBottom: 20},

  slotsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  slotItem: {
    width: '31%',
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.15)',
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
    marginBottom: 12,
    backgroundColor: 'rgba(4, 7, 11, 0.5)',
    minHeight: 56,
    justifyContent: 'center',
  },
  slotItemActive: {
    backgroundColor: 'rgba(215, 177, 74, 0.35)',
    borderColor: accentGold,
  },
  slotItemBooked: {
    backgroundColor: 'rgba(251, 146, 60, 0.12)',
    borderColor: 'rgba(251, 146, 60, 0.45)',
    opacity: 1,
  },
  slotItemCompleted: {
    backgroundColor: 'rgba(167, 139, 250, 0.12)',
    borderColor: 'rgba(167, 139, 250, 0.4)',
  },
  slotItemPast: {
    backgroundColor: 'rgba(100, 116, 139, 0.12)',
    borderColor: 'rgba(148, 163, 184, 0.25)',
    opacity: 0.75,
  },
  slotText: {fontWeight: '600', color: T.textMuted, fontSize: 13},
  slotTextActive: {color: T.text},
  slotTextBooked: {fontWeight: '600', color: '#FDBA74', fontSize: 12},
  slotTextCompleted: {fontWeight: '600', color: '#C4B5FD', fontSize: 12},
  bookedLabel: {fontSize: 10, color: '#FB923C', fontWeight: '700', marginTop: 2},
  completedLabel: {fontSize: 10, color: '#A78BFA', fontWeight: '700', marginTop: 2},
  slotTextPast: {fontWeight: '600', color: T.textSoft, fontSize: 12},
  pastLabel: {fontSize: 10, color: T.textSoft, fontWeight: '700', marginTop: 2},

  saveBtn: {
    backgroundColor: accentGold,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  saveBtnText: {color: '#101B2C', fontWeight: '800', fontSize: 16},
});
