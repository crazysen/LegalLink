import React, {useCallback, useEffect, useState} from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {LinearGradient} from 'expo-linear-gradient';
import {MaterialCommunityIcons} from '@expo/vector-icons';
import {REFERENCE_THEME as T} from '../constants/referenceTheme';
import {
  buildCalendarCells,
  formatDisplayDate,
  formatHourLabel,
  getTodayDateKey,
  isPastDateTime,
  monthKeyFromDate,
  MONTHLY_WEEKDAY_OPTIONS,
  parseHourLabelTo24,
  SLOT_TIME_OPTIONS,
  toDateKey,
  WEEKDAY_LABELS,
} from '../services/availabilityScheduleUtils';
import {
  fetchAttorneyAvailabilitySlots,
  saveAttorneyAvailabilitySlots,
} from '../services/userApi';

const glassBorder = 'rgba(244, 215, 139, 0.12)';
const accentGold = T.gold[1];
const goldGradient = [T.gold[0], T.gold[1]];

/**
 * Manage availability content — mobile dark/gold UI; same behavior as web panel.
 */
export default function ManageAvailabilityPanel({attorneyId, displayName = 'Attorney'}) {
  const [availabilityByDate, setAvailabilityByDate] = useState({});
  const [monthCursor, setMonthCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState(getTodayDateKey());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedBanner, setSavedBanner] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(null);
  const [monthlyTemplateTimes, setMonthlyTemplateTimes] = useState(['14:00', '15:00', '16:00']);
  const [monthlyTemplateWeekdays, setMonthlyTemplateWeekdays] = useState([1, 2, 3, 4, 5]);
  const [monthlyApplyMessage, setMonthlyApplyMessage] = useState('');

  const loadAvailability = useCallback(async targetId => {
    if (!targetId) {
      return;
    }

    setLoading(true);
    setError('');
    try {
      const rows = await fetchAttorneyAvailabilitySlots(targetId);
      const nextMap = {};

      rows.forEach(item => {
        const dateKey = String(item.date || '').trim();
        if (!dateKey) {
          return;
        }
        const parsedTime = parseHourLabelTo24(item.startLabel);
        if (!parsedTime || !SLOT_TIME_OPTIONS.includes(parsedTime)) {
          return;
        }
        if (!nextMap[dateKey]) {
          nextMap[dateKey] = [];
        }
        if (!nextMap[dateKey].includes(parsedTime)) {
          nextMap[dateKey].push(parsedTime);
        }
      });

      Object.keys(nextMap).forEach(dateKey => {
        nextMap[dateKey].sort();
      });

      setAvailabilityByDate(nextMap);
    } catch (loadError) {
      setError(loadError?.message || 'Failed to load availability.');
      setAvailabilityByDate({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!attorneyId) {
      return;
    }
    void loadAvailability(attorneyId);
  }, [attorneyId, loadAvailability]);

  useEffect(() => {
    const currentMonthKey = monthKeyFromDate(monthCursor);
    if (!String(selectedDate || '').startsWith(currentMonthKey)) {
      const todayKey = getTodayDateKey();
      setSelectedDate(
        monthKeyFromDate(new Date()) === currentMonthKey ? todayKey : `${currentMonthKey}-01`,
      );
    }
  }, [monthCursor, selectedDate]);

  const changeMonth = offset => {
    setMonthCursor(prev => new Date(prev.getFullYear(), prev.getMonth() + offset, 1));
    setSavedBanner(false);
    setSaveSuccess(null);
    setMonthlyApplyMessage('');
  };

  const clearTransient = () => {
    setSavedBanner(false);
    setSaveSuccess(null);
    setMonthlyApplyMessage('');
  };

  const toggleTimeSlot = time24 => {
    if (!selectedDate || isPastDateTime(selectedDate, time24)) {
      return;
    }

    setAvailabilityByDate(prev => {
      const current = new Set(prev[selectedDate] || []);
      if (current.has(time24)) {
        current.delete(time24);
      } else {
        current.add(time24);
      }
      const next = {...prev};
      const sorted = Array.from(current).sort();
      if (sorted.length > 0) {
        next[selectedDate] = sorted;
      } else {
        delete next[selectedDate];
      }
      return next;
    });
    clearTransient();
  };

  const toggleMonthlyTemplateTime = time24 => {
    setMonthlyTemplateTimes(prev => {
      const current = new Set(prev);
      if (current.has(time24)) {
        current.delete(time24);
      } else {
        current.add(time24);
      }
      return Array.from(current).sort();
    });
    clearTransient();
  };

  const toggleMonthlyWeekday = weekday => {
    setMonthlyTemplateWeekdays(prev => {
      const current = new Set(prev);
      if (current.has(weekday)) {
        current.delete(weekday);
      } else {
        current.add(weekday);
      }
      return Array.from(current).sort((a, b) => a - b);
    });
    clearTransient();
  };

  const applyMonthlyTemplate = () => {
    if (monthlyTemplateTimes.length === 0) {
      setError('Choose at least one monthly time slot before applying.');
      return;
    }
    if (monthlyTemplateWeekdays.length === 0) {
      setError('Choose at least one weekday before applying the monthly schedule.');
      return;
    }

    const selectedWeekdays = new Set(monthlyTemplateWeekdays);
    const year = monthCursor.getFullYear();
    const month = monthCursor.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const monthAssignments = [];

    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = new Date(year, month, day);
      if (!selectedWeekdays.has(date.getDay())) {
        continue;
      }
      const dateKey = toDateKey(date);
      const futureTimes = monthlyTemplateTimes.filter(
        time24 => !isPastDateTime(dateKey, time24),
      );
      monthAssignments.push({dateKey, futureTimes});
    }

    setAvailabilityByDate(prev => {
      const next = {...prev};
      monthAssignments.forEach(({dateKey, futureTimes}) => {
        if (futureTimes.length > 0) {
          next[dateKey] = futureTimes;
        } else {
          delete next[dateKey];
        }
      });
      return next;
    });

    setError('');
    const appliedDateCount = monthAssignments.filter(item => item.futureTimes.length > 0).length;
    setMonthlyApplyMessage(
      `Monthly template applied to ${appliedDateCount} date(s). Tap Save Schedule to sync.`,
    );
    clearTransient();
  };

  const saveAvailability = async () => {
    if (!attorneyId) {
      return;
    }

    const now = new Date();
    const prepared = Object.entries(availabilityByDate)
      .flatMap(([dateKey, timeList]) =>
        (timeList || []).map(time24 => {
          const start = new Date(`${dateKey}T${time24}:00`);
          if (Number.isNaN(start.getTime()) || start <= now) {
            return null;
          }
          const end = new Date(start.getTime() + 60 * 60 * 1000);
          return {
            startTime: start.toISOString(),
            endTime: end.toISOString(),
          };
        }),
      )
      .filter(Boolean);

    const dateCount = Object.values(availabilityByDate).filter(
      times => (times || []).length > 0,
    ).length;

    setSaving(true);
    setError('');
    setSaveSuccess(null);
    try {
      await saveAttorneyAvailabilitySlots({attorneyId, slots: prepared});
      await loadAvailability(attorneyId);
      setSavedBanner(true);
      setSaveSuccess({
        attorneyName: displayName,
        slotCount: prepared.length,
        dateCount,
      });
    } catch (saveError) {
      setError(saveError?.message || 'Failed to save availability.');
      setSavedBanner(false);
      setSaveSuccess(null);
    } finally {
      setSaving(false);
    }
  };

  const calendarCells = buildCalendarCells(monthCursor);
  const selectedTimes = availabilityByDate[selectedDate] || [];
  const monthLabel = monthCursor.toLocaleDateString('en-PH', {month: 'long', year: 'numeric'});

  return (
    <>
      <View style={styles.introRow}>
        <MaterialCommunityIcons name="calendar-clock-outline" size={22} color={accentGold} />
        <Text style={styles.introTitle}>Your schedule</Text>
      </View>
      <Text style={styles.introSub}>
        Set bookable consultation times. Clients see your updates after you save.
      </Text>

      {error ? (
        <View style={styles.bannerError}>
          <Text style={styles.bannerErrorText}>{error}</Text>
        </View>
      ) : null}
      {savedBanner && !saveSuccess ? (
        <View style={styles.bannerSuccess}>
          <MaterialCommunityIcons name="check-circle" size={16} color={T.gold[0]} />
          <Text style={styles.bannerSuccessText}>Availability saved and synced to clients.</Text>
        </View>
      ) : null}
      {monthlyApplyMessage ? (
        <View style={styles.bannerInfo}>
          <Text style={styles.bannerInfoText}>{monthlyApplyMessage}</Text>
        </View>
      ) : null}

      <View style={styles.card}>
        <View style={styles.calendarHead}>
          <TouchableOpacity style={styles.monthNavBtn} onPress={() => changeMonth(-1)}>
            <MaterialCommunityIcons name="chevron-left" size={24} color={accentGold} />
          </TouchableOpacity>
          <Text style={styles.monthLabel}>{monthLabel}</Text>
          <TouchableOpacity style={styles.monthNavBtn} onPress={() => changeMonth(1)}>
            <MaterialCommunityIcons name="chevron-right" size={24} color={accentGold} />
          </TouchableOpacity>
        </View>

        <View style={styles.weekdayRow}>
          {WEEKDAY_LABELS.map((label, index) => (
            <Text key={`${label}-${index}`} style={styles.weekdayLabel}>
              {label}
            </Text>
          ))}
        </View>

        {loading ? (
          <ActivityIndicator color={accentGold} style={styles.loader} />
        ) : (
          <View style={styles.daysGrid}>
            {calendarCells.map(cell => {
              if (cell.type === 'blank') {
                return <View key={cell.key} style={styles.dayBlank} />;
              }

              const hasAvailability = (availabilityByDate[cell.dateKey] || []).length > 0;
              const isSelected = cell.dateKey === selectedDate;
              const isToday = cell.dateKey === getTodayDateKey();

              return (
                <TouchableOpacity
                  key={cell.key}
                  style={styles.dayCell}
                  activeOpacity={0.85}
                  onPress={() => setSelectedDate(cell.dateKey)}>
                  <View
                    style={[
                      styles.dayCircle,
                      styles.dayCircleIdle,
                      isToday && !isSelected && styles.dayCircleToday,
                      hasAvailability && !isSelected && styles.dayCircleMarked,
                      isSelected && styles.dayCircleSelected,
                    ]}>
                    <Text
                      style={[
                        styles.dayText,
                        hasAvailability && !isSelected && styles.dayTextMarked,
                        isSelected && styles.dayTextSelected,
                      ]}>
                      {cell.day}
                    </Text>
                  </View>
                  {hasAvailability && !isSelected ? <View style={styles.dot} /> : null}
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </View>

      <View style={styles.card}>
        <View style={styles.slotsHead}>
          <View style={styles.slotsHeadCopy}>
            <Text style={styles.slotsDate}>{formatDisplayDate(selectedDate)}</Text>
            <Text style={styles.slotsMeta}>{selectedTimes.length} active slot(s)</Text>
          </View>
          <TouchableOpacity
            onPress={saveAvailability}
            disabled={saving || loading}
            activeOpacity={0.88}>
            <LinearGradient
              colors={goldGradient}
              style={[styles.saveBtn, (saving || loading) && styles.saveBtnDisabled]}>
              <Text style={styles.saveBtnText}>{saving ? 'Saving...' : 'Save Schedule'}</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>

        {loading ? <Text style={styles.muted}>Loading availability...</Text> : null}

        <View style={styles.slotGrid}>
          {SLOT_TIME_OPTIONS.reduce((rows, time24, index) => {
            if (index % 2 === 0) {
              rows.push([time24]);
            } else {
              rows[rows.length - 1].push(time24);
            }
            return rows;
          }, []).map(row => (
            <View key={row.join('-')} style={styles.slotRow}>
              {row.map(time24 => {
                const active = selectedTimes.includes(time24);
                const blockedByPast = isPastDateTime(selectedDate, time24);

                return (
                  <Pressable
                    key={time24}
                    style={({pressed}) => [
                      styles.timeChip,
                      active ? styles.timeChipActive : styles.timeChipIdle,
                      blockedByPast && !active && styles.timeChipPast,
                      pressed && styles.timeChipPressed,
                    ]}
                    onPress={() => toggleTimeSlot(time24)}
                    disabled={blockedByPast && !active}>
                    <Text
                      style={[
                        styles.timeChipStrong,
                        active ? styles.timeChipStrongActive : null,
                        blockedByPast && !active ? styles.timeChipPastText : null,
                      ]}>
                      {formatHourLabel(time24)}
                    </Text>
                    <Text
                      style={[
                        styles.timeChipSub,
                        active ? styles.timeChipSubActive : null,
                        blockedByPast && !active ? styles.timeChipPastText : null,
                      ]}>
                      {blockedByPast ? 'Past' : active ? 'Available' : 'Tap to enable'}
                    </Text>
                  </Pressable>
                );
              })}
              {row.length === 1 ? <View style={styles.timeChipSpacer} /> : null}
            </View>
          ))}
        </View>

        <View style={styles.templateCard}>
          <Text style={styles.templateTitle}>Monthly template</Text>
          <Text style={styles.templateSub}>
            Pick usual days and times, then apply to the whole month shown above.
          </Text>
          <TouchableOpacity onPress={applyMonthlyTemplate} activeOpacity={0.88} style={styles.applyWrap}>
            <LinearGradient colors={goldGradient} style={styles.applyBtn}>
              <Text style={styles.applyBtnText}>Apply to {monthLabel}</Text>
            </LinearGradient>
          </TouchableOpacity>

          <Text style={styles.templateSectionLabel}>Repeat on</Text>
          <View style={styles.chipRow}>
            {MONTHLY_WEEKDAY_OPTIONS.map(day => {
              const active = monthlyTemplateWeekdays.includes(day.value);
              return (
                <TouchableOpacity
                  key={day.value}
                  style={[styles.roundChip, active && styles.roundChipActive]}
                  onPress={() => toggleMonthlyWeekday(day.value)}>
                  <Text style={[styles.roundChipText, active && styles.roundChipTextActive]}>
                    {day.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.templateSectionLabel}>Time slots</Text>
          <View style={styles.chipRow}>
            {SLOT_TIME_OPTIONS.map(time24 => {
              const active = monthlyTemplateTimes.includes(time24);
              return (
                <TouchableOpacity
                  key={`monthly-${time24}`}
                  style={[styles.roundChip, active && styles.roundChipActive]}
                  onPress={() => toggleMonthlyTemplateTime(time24)}>
                  <Text style={[styles.roundChipText, active && styles.roundChipTextActive]}>
                    {formatHourLabel(time24)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </View>

      <Modal
        visible={Boolean(saveSuccess)}
        transparent
        animationType="fade"
        onRequestClose={() => setSaveSuccess(null)}>
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setSaveSuccess(null)}>
          <TouchableOpacity activeOpacity={1} onPress={() => {}} style={styles.modalCard}>
            <View style={styles.modalIconWrap}>
              <MaterialCommunityIcons name="check-circle" size={44} color={T.gold[0]} />
            </View>
            <Text style={styles.modalTitle}>Schedule saved</Text>
            <Text style={styles.modalLead}>
              Your availability is live for clients booking with you.
            </Text>
            <View style={styles.modalStats}>
              <Text style={styles.modalStatLine}>
                <Text style={styles.modalStatStrong}>{saveSuccess?.slotCount ?? 0}</Text> bookable slot
                {saveSuccess?.slotCount === 1 ? '' : 's'}
              </Text>
              <Text style={styles.modalStatLine}>
                Across <Text style={styles.modalStatStrong}>{saveSuccess?.dateCount ?? 0}</Text> date
                {saveSuccess?.dateCount === 1 ? '' : 's'}
              </Text>
            </View>
            <TouchableOpacity onPress={() => setSaveSuccess(null)} activeOpacity={0.88}>
              <LinearGradient colors={goldGradient} style={styles.modalBtn}>
                <Text style={styles.modalBtnText}>Got it</Text>
              </LinearGradient>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  introRow: {flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6},
  introTitle: {fontSize: 22, fontWeight: '900', color: T.text},
  introSub: {color: T.textMuted, fontSize: 13, lineHeight: 20, marginBottom: 16},
  bannerError: {
    backgroundColor: 'rgba(220, 38, 38, 0.15)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(248, 113, 113, 0.25)',
  },
  bannerErrorText: {color: '#FCA5A5', fontWeight: '700', fontSize: 13},
  bannerSuccess: {
    backgroundColor: 'rgba(22, 163, 74, 0.12)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(134, 239, 172, 0.2)',
  },
  bannerSuccessText: {color: '#86EFAC', fontWeight: '700', fontSize: 13, flex: 1},
  bannerInfo: {
    backgroundColor: 'rgba(37, 99, 235, 0.12)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(147, 197, 253, 0.2)',
  },
  bannerInfoText: {color: '#93C5FD', fontWeight: '700', fontSize: 13},
  card: {
    backgroundColor: 'rgba(12, 19, 30, 0.92)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: glassBorder,
    padding: 16,
    marginBottom: 16,
  },
  calendarHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  monthNavBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: glassBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthLabel: {fontSize: 17, fontWeight: '800', color: T.text},
  weekdayRow: {flexDirection: 'row', marginBottom: 8},
  weekdayLabel: {
    width: `${100 / 7}%`,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '800',
    color: T.textSoft,
  },
  loader: {marginVertical: 20},
  daysGrid: {flexDirection: 'row', flexWrap: 'wrap'},
  dayBlank: {width: `${100 / 7}%`, height: 44, marginBottom: 4},
  dayCell: {
    width: `${100 / 7}%`,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  dayCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCircleIdle: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.08)',
  },
  dayCircleToday: {
    borderWidth: 2,
    borderColor: 'rgba(244, 215, 139, 0.45)',
  },
  dayCircleMarked: {
    borderWidth: 2,
    borderColor: T.gold[1],
    backgroundColor: 'rgba(212, 175, 55, 0.22)',
  },
  dayCircleSelected: {
    borderWidth: 2,
    borderColor: T.gold[1],
    backgroundColor: T.gold[0],
  },
  dayText: {fontSize: 14, fontWeight: '800', color: T.text},
  dayTextMarked: {color: T.gold[0]},
  dayTextSelected: {color: T.base},
  dot: {
    position: 'absolute',
    bottom: 2,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: T.gold[0],
  },
  slotsHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 14,
    gap: 10,
  },
  slotsHeadCopy: {flex: 1, minWidth: 0},
  slotsDate: {fontSize: 16, fontWeight: '800', color: T.text},
  slotsMeta: {fontSize: 13, color: T.textMuted, marginTop: 4},
  saveBtn: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  saveBtnDisabled: {opacity: 0.55},
  saveBtnText: {color: T.base, fontWeight: '800', fontSize: 13},
  muted: {color: T.textSoft, fontSize: 13, marginBottom: 10},
  slotGrid: {
    gap: 10,
  },
  slotRow: {
    flexDirection: 'row',
    gap: 10,
  },
  timeChip: {
    flex: 1,
    minHeight: 68,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    justifyContent: 'center',
  },
  timeChipSpacer: {
    flex: 1,
  },
  timeChipIdle: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: glassBorder,
  },
  timeChipActive: {
    backgroundColor: T.gold[0],
    borderWidth: 2,
    borderColor: T.gold[1],
  },
  timeChipPressed: {opacity: 0.88},
  timeChipPast: {opacity: 0.4},
  timeChipStrong: {fontSize: 14, fontWeight: '800', color: T.text},
  timeChipStrongActive: {color: T.base},
  timeChipSub: {fontSize: 12, color: T.textSoft, marginTop: 4},
  timeChipSubActive: {color: 'rgba(4, 7, 11, 0.72)'},
  timeChipPastText: {color: T.textSoft},
  templateCard: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(244, 215, 139, 0.1)',
  },
  templateTitle: {fontSize: 16, fontWeight: '800', color: T.text, marginBottom: 4},
  templateSub: {fontSize: 13, color: T.textMuted, lineHeight: 18, marginBottom: 12},
  applyWrap: {marginBottom: 14},
  applyBtn: {
    alignSelf: 'flex-start',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  applyBtnText: {color: T.base, fontWeight: '800', fontSize: 13},
  templateSectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: T.textSoft,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 8,
    marginTop: 4,
  },
  chipRow: {flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8},
  roundChip: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: glassBorder,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  roundChipActive: {
    backgroundColor: 'rgba(212, 175, 55, 0.22)',
    borderColor: 'rgba(244, 215, 139, 0.45)',
  },
  roundChipText: {fontSize: 12, fontWeight: '800', color: T.textMuted},
  roundChipTextActive: {color: T.gold[0]},
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(4, 7, 11, 0.75)',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: 'rgba(12, 19, 30, 0.98)',
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: glassBorder,
    alignItems: 'center',
  },
  modalIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(212, 175, 55, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  modalTitle: {fontSize: 20, fontWeight: '800', color: T.text, marginBottom: 8},
  modalLead: {
    fontSize: 14,
    color: T.textMuted,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 12,
  },
  modalStats: {
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: glassBorder,
    padding: 12,
    marginBottom: 16,
  },
  modalStatLine: {fontSize: 13, color: T.textMuted, marginBottom: 4},
  modalStatStrong: {fontWeight: '800', color: T.gold[0]},
  modalBtn: {
    width: '100%',
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  modalBtnText: {color: T.base, fontWeight: '800', fontSize: 15},
});
