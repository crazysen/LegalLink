/**
 * ClientAvailabilityCalendar
 *
 * React Native port of the Web `ClientAvailabilityCalendar.js` component.
 * Displays a monthly grid calendar with dot indicators:
 *   • Green dot  — 'available'   → date is selectable / clickable
 *   • Red dot    — 'fully_booked' → date is rendered but disabled
 *   • No dot     — 'no_schedule' or 'past' → greyed out / disabled
 *
 * Props:
 *   attorneyId   {string}   — attorney whose slots are loaded
 *   selectedDate {string}   — currently selected date key (YYYY-MM-DD)
 *   onSelectDate {function} — called with (dateKey: string) when a valid day is tapped
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  buildCalendarCells,
  getTodayDateKey,
  monthKeyFromDate,
  WEEKDAY_LABELS,
} from '../services/availabilityScheduleUtils';
import {
  fetchClientAttorneyAvailabilityCalendar,
  getClientDayAvailabilityStatus,
} from '../services/userApi';
import { REFERENCE_THEME as T } from '../constants/referenceTheme';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function monthTitle(monthCursor) {
  return monthCursor.toLocaleDateString('en-PH', {
    month: 'long',
    year: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ClientAvailabilityCalendar({
  attorneyId,
  selectedDate,
  onSelectDate,
}) {
  const [monthCursor, setMonthCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [daySummary, setDaySummary] = useState({});
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');

  const todayKey = getTodayDateKey();
  const calendarCells = useMemo(() => buildCalendarCells(monthCursor), [monthCursor]);

  const loadMonth = useCallback(async () => {
    if (!attorneyId) return;
    setLoading(true);
    setLoadError('');
    try {
      const summary = await fetchClientAttorneyAvailabilityCalendar(
        attorneyId,
        monthCursor,
      );
      setDaySummary(summary);
    } catch (error) {
      setDaySummary({});
      setLoadError(error?.message || 'Could not load availability calendar.');
    } finally {
      setLoading(false);
    }
  }, [attorneyId, monthCursor]);

  useEffect(() => {
    loadMonth();
  }, [loadMonth]);

  const changeMonth = (offset) => {
    setMonthCursor(
      (prev) => new Date(prev.getFullYear(), prev.getMonth() + offset, 1),
    );
  };

  const canGoPrev =
    monthKeyFromDate(monthCursor) > monthKeyFromDate(new Date());

  const handlePickDay = (dateKey, status) => {
    if (status !== 'available') return;
    onSelectDate(dateKey);
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <View style={styles.calendarContainer}>
      {/* ── Header row: prev / month-year / next ──────────────────────── */}
      <View style={styles.calHead}>
        <TouchableOpacity
          onPress={() => changeMonth(-1)}
          disabled={!canGoPrev || loading}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={[styles.navBtn, (!canGoPrev || loading) && styles.navBtnDisabled]}>
          <Text style={styles.navBtnText}>‹</Text>
        </TouchableOpacity>

        <Text style={styles.calTitle}>{monthTitle(monthCursor)}</Text>

        <TouchableOpacity
          onPress={() => changeMonth(1)}
          disabled={loading}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={[styles.navBtn, loading && styles.navBtnDisabled]}>
          <Text style={styles.navBtnText}>›</Text>
        </TouchableOpacity>
      </View>

      {/* ── Weekday labels ───────────────────────────────────────────── */}
      <View style={styles.weekdayRow}>
        {WEEKDAY_LABELS.map((label, idx) => (
          <Text key={`wd-${idx}`} style={styles.weekdayLabel}>
            {label}
          </Text>
        ))}
      </View>

      {/* ── Day grid ─────────────────────────────────────────────────── */}
      <View style={styles.dayGrid}>
        {calendarCells.map((cell) => {
          if (cell.type === 'blank') {
            return <View key={cell.key} style={styles.dayCell} />;
          }

          const status = getClientDayAvailabilityStatus(
            cell.dateKey,
            daySummary,
            todayKey,
          );
          const isSelected = cell.dateKey === selectedDate;
          const isToday = cell.dateKey === todayKey;
          const isClickable = status === 'available' && !loading;

          const cellBg =
            isSelected
              ? T.gold[1]
              : isToday && !isSelected
              ? 'rgba(244, 215, 139, 0.1)'
              : 'transparent';

          const numColor =
            isSelected
              ? T.base
              : status === 'past' || status === 'no_schedule'
              ? T.textSoft
              : T.text;

          return (
            <TouchableOpacity
              key={cell.key}
              style={[
                styles.dayCell,
                { backgroundColor: cellBg },
                isToday && !isSelected && styles.todayBorder,
              ]}
              onPress={() => handlePickDay(cell.dateKey, status)}
              disabled={!isClickable}
              activeOpacity={0.75}
              accessibilityLabel={
                status === 'available'
                  ? `${cell.day}, open slots — tap to select`
                  : status === 'fully_booked'
                  ? `${cell.day}, fully booked`
                  : `${cell.day}`
              }>
              <Text style={[styles.dayNum, { color: numColor }]}>{cell.day}</Text>

              {/* Green dot — available */}
              {status === 'available' ? (
                <View style={[styles.dot, styles.dotGreen]} />
              ) : null}

              {/* Red dot — fully booked */}
              {status === 'fully_booked' ? (
                <View style={[styles.dot, styles.dotRed]} />
              ) : null}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ── Loading / error / selection hint ─────────────────────────── */}
      {loading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={T.gold[1]} />
          <Text style={styles.hintText}>Loading calendar…</Text>
        </View>
      ) : null}

      {loadError ? (
        <Text style={styles.errorText}>{loadError}</Text>
      ) : null}

      {!loading && !loadError && !selectedDate ? (
        <Text style={styles.hintText}>
          Tap a green day to choose a time slot.
        </Text>
      ) : null}

      {/* ── Legend ───────────────────────────────────────────────────── */}
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.dot, styles.dotGreen, { marginRight: 6 }]} />
          <Text style={styles.legendText}>Available</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.dot, styles.dotRed, { marginRight: 6 }]} />
          <Text style={styles.legendText}>Fully booked</Text>
        </View>
        <View style={styles.legendItem}>
          <Text style={[styles.legendText, { color: T.textSoft, marginRight: 6 }]}>
            —
          </Text>
          <Text style={styles.legendText}>No schedule</Text>
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const CELL_SIZE = 40;

const styles = StyleSheet.create({
  calendarContainer: {
    backgroundColor: 'rgba(18, 26, 36, 0.85)',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.12)',
    marginBottom: 20,
  },
  calHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  navBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: 'rgba(244, 215, 139, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.2)',
  },
  navBtnDisabled: {
    opacity: 0.3,
  },
  navBtnText: {
    color: T.gold[0],
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 24,
  },
  calTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: T.text,
    letterSpacing: 0.3,
  },
  weekdayRow: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  weekdayLabel: {
    flex: 1,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '600',
    color: T.textSoft,
    letterSpacing: 0.5,
  },
  dayGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  dayCell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    marginVertical: 2,
  },
  todayBorder: {
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.45)',
  },
  dayNum: {
    fontSize: 13,
    fontWeight: '600',
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    marginTop: 3,
  },
  dotGreen: {
    backgroundColor: '#34D399',
  },
  dotRed: {
    backgroundColor: '#F87171',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  hintText: {
    color: T.textSoft,
    fontSize: 12,
    marginTop: 10,
    textAlign: 'center',
  },
  errorText: {
    color: '#F87171',
    fontSize: 12,
    marginTop: 10,
    textAlign: 'center',
  },
  legend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 20,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(244, 215, 139, 0.12)',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  legendText: {
    fontSize: 11,
    color: T.textMuted,
  },
});
