import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ClientScreenShell, ClientFadeIn} from '../components/ClientScreenShell';
import ClientChevronBack from '../components/ClientChevronBack';
import {REFERENCE_THEME as T} from '../constants/referenceTheme';
import {supabase} from '../services/supabaseClient';
import {fetchAttorneyConsultationAnalyticsData, getCurrentSessionProfile} from '../services/userApi';

const defaultAnalytics = {
  rows: [],
  total: 0,
  maxCount: 0,
  gender: {rows: [], total: 0},
  status: [],
  averageRating: 0,
  ratingCount: 0,
};

const STATUS_COLORS = {
  Completed: '#34D399',
  Cancelled: '#F87171',
  Upcoming: T.gold[1],
};

function statusFillColor(label) {
  return STATUS_COLORS[label] || T.gold[1];
}

function SummaryCard({label, value, hint, muted}) {
  return (
    <View style={styles.summaryCard}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={[styles.summaryValue, muted && styles.summaryValueMuted]}>{value}</Text>
      {hint ? <Text style={styles.summaryHint}>{hint}</Text> : null}
    </View>
  );
}

function BarRow({label, count, ratio, fillColor}) {
  return (
    <View style={styles.barRow}>
      <View style={styles.barMeta}>
        <Text style={styles.barLabel}>{label}</Text>
        <Text style={styles.barCount}>{count}</Text>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, {width: `${ratio}%`, backgroundColor: fillColor}]} />
      </View>
    </View>
  );
}

export default function AttyAnalytics({navigation}) {
  const insets = useSafeAreaInsets();
  const [attorneyId, setAttorneyId] = useState(null);
  const [analytics, setAnalytics] = useState(defaultAnalytics);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');

  const loadAnalytics = useCallback(async (userId, options = {}) => {
    if (!userId) return;
    const silent = Boolean(options?.silent);
    try {
      if (!silent) setLoading(true);
      const data = await fetchAttorneyConsultationAnalyticsData(userId);
      setAnalytics({
        ...defaultAnalytics,
        ...data,
        gender: data?.gender || defaultAnalytics.gender,
        status: Array.isArray(data?.status) ? data.status : defaultAnalytics.status,
      });
      setLoadError('');
    } catch (error) {
      setAnalytics(defaultAnalytics);
      setLoadError(error?.message || 'Unable to load analytics data.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        setLoading(true);
        const {profile} = await getCurrentSessionProfile();
        if (!active) return;
        if (!profile?.id) {
          setLoadError('Please sign in to view analytics.');
          return;
        }
        setAttorneyId(profile.id);
        await loadAnalytics(profile.id, {silent: true});
      } catch (error) {
        if (active) {
          setLoadError(error?.message || 'Unable to load analytics data.');
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [loadAnalytics]);

  useEffect(() => {
    if (!attorneyId) return undefined;
    const channel = supabase
      .channel(`attorney-analytics-feedback-${attorneyId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'consultation_feedback',
          filter: `attorney_id=eq.${attorneyId}`,
        },
        () => {
          loadAnalytics(attorneyId, {silent: true});
        },
      )
      .subscribe();

    return () => {
      try {
        supabase.removeChannel(channel);
      } catch {
        /* ignore */
      }
    };
  }, [attorneyId, loadAnalytics]);

  const onRefresh = useCallback(async () => {
    if (!attorneyId) return;
    setRefreshing(true);
    try {
      await loadAnalytics(attorneyId, {silent: true});
    } finally {
      setRefreshing(false);
    }
  }, [attorneyId, loadAnalytics]);

  const {rows, total, maxCount, gender, status, averageRating, ratingCount} = analytics;

  const chartRows = useMemo(
    () =>
      rows.slice(0, 8).map(row => ({
        ...row,
        ratio: maxCount > 0 ? Math.max(8, Math.round((row.count / maxCount) * 100)) : 0,
      })),
    [rows, maxCount],
  );

  const statusMax = useMemo(
    () => (status.length ? Math.max(...status.map(s => Number(s.count || 0)), 1) : 1),
    [status],
  );

  const statusRows = useMemo(
    () =>
      status.map(row => ({
        ...row,
        ratio:
          statusMax > 0
            ? Math.max(8, Math.round((Number(row.count || 0) / statusMax) * 100))
            : 0,
      })),
    [status, statusMax],
  );

  const genderRows = gender?.rows || [];
  const genderTotal = Number(gender?.total || 0);

  const avgRatingNum = Number(averageRating);
  const hasValidRating = ratingCount > 0 && Number.isFinite(avgRatingNum);

  const handleBack = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('AttyMenu', {activeRoute: 'AttyAnalytics'});
  };

  return (
    <ClientScreenShell edges={['top']}>
      <ScrollView
        contentContainerStyle={[styles.container, {paddingTop: Math.max(insets.top, 12)}]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={T.gold[1]} />}
      >
        <ClientFadeIn>
          <View style={styles.header}>
            <ClientChevronBack style={styles.backHit} onPress={handleBack} />
            <Text style={styles.title}>Attorney Analytics</Text>
            <Text style={styles.subtitle}>Consultation trends and client feedback at a glance.</Text>
          </View>
        </ClientFadeIn>

        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={T.gold[1]} />
            <Text style={styles.loadingText}>Loading analytics...</Text>
          </View>
        ) : null}

        {loadError ? <Text style={styles.errorText}>{loadError}</Text> : null}

        <View style={styles.summaryRow}>
          <View style={styles.summaryCardLeft}>
            <SummaryCard label="TOTAL CONSULTATIONS" value={String(total)} />
          </View>
          <SummaryCard
            label="AVG. CLIENT RATING"
            value={hasValidRating ? avgRatingNum.toFixed(1) : '—'}
            hint={hasValidRating ? `★ from ${ratingCount} review${ratingCount === 1 ? '' : 's'}` : 'No reviews yet'}
            muted={!hasValidRating}
          />
        </View>

        <View style={styles.chartSplit}>
          <View style={styles.chartCard}>
            <View style={styles.cardHeader}>
              <View>
                <Text style={styles.cardTitle}>Consultation type frequency</Text>
                <Text style={styles.cardSubtitle}>Top {chartRows.length || 0}</Text>
              </View>
            </View>

            {chartRows.length ? (
              <View style={styles.barChart}>
                {chartRows.map(row => (
                  <BarRow
                    key={row.label}
                    label={row.label}
                    count={row.count}
                    ratio={row.ratio}
                    fillColor={T.gold[1]}
                  />
                ))}
              </View>
            ) : (
              <Text style={styles.emptyText}>No consultation records yet.</Text>
            )}
          </View>

          <View style={styles.chartCard}>
            <View style={styles.cardHeader}>
              <View>
                <Text style={styles.cardTitle}>Status distribution</Text>
                <Text style={styles.cardSubtitle}>
                  {statusRows.reduce((sum, r) => sum + Number(r.count || 0), 0)} total
                </Text>
              </View>
            </View>

            {statusRows.length ? (
              <View style={styles.barChart}>
                {statusRows.map(row => (
                  <BarRow
                    key={row.label}
                    label={row.label}
                    count={row.count}
                    ratio={row.ratio}
                    fillColor={statusFillColor(row.label)}
                  />
                ))}
              </View>
            ) : (
              <Text style={styles.emptyText}>No appointments yet.</Text>
            )}
          </View>
        </View>

        <View style={styles.chartCard}>
          <View style={styles.cardHeader}>
            <View>
              <Text style={styles.cardTitle}>Client registration by gender</Text>
              <Text style={styles.cardSubtitle}>Includes legacy baseline for pre-gender-field accounts.</Text>
            </View>
            <Text style={styles.cardMeta}>Total {genderTotal}</Text>
          </View>

          {genderRows.length ? (
            <View style={styles.barChart}>
              {genderRows.map(row => {
                const pct = Number(row.percent);
                const safePct = Number.isFinite(pct) ? pct : 0;
                return (
                  <BarRow
                    key={row.key}
                    label={row.label}
                    count={`${row.count} (${safePct}%)`}
                    ratio={Math.max(safePct, row.count > 0 ? 8 : 0)}
                    fillColor={'rgba(244, 215, 139, 0.75)'}
                  />
                );
              })}
            </View>
          ) : (
            <Text style={styles.emptyText}>No gender registration records yet.</Text>
          )}
        </View>

        {!loading && !loadError ? (
          <TouchableOpacity style={styles.refreshBtn} onPress={onRefresh} activeOpacity={0.85}>
            <Text style={styles.refreshText}>Refresh analytics</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </ClientScreenShell>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  header: {
    marginBottom: 18,
  },
  backHit: {
    alignSelf: 'flex-start',
    marginBottom: 8,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: T.text,
  },
  subtitle: {
    marginTop: 6,
    color: T.textSoft,
  },
  centered: {
    paddingVertical: 18,
    alignItems: 'center',
  },
  loadingText: {
    color: T.textSoft,
    marginTop: 8,
  },
  errorText: {
    color: '#FCA5A5',
    marginBottom: 12,
  },
  summaryRow: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  summaryCardLeft: {
    flex: 1,
    marginRight: 12,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: 'rgba(18, 26, 36, 0.85)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.15)',
  },
  summaryLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    color: T.textSoft,
  },
  summaryValue: {
    marginTop: 8,
    fontSize: 22,
    fontWeight: '800',
    color: T.text,
  },
  summaryValueMuted: {
    color: T.textMuted,
  },
  summaryHint: {
    marginTop: 6,
    fontSize: 12,
    color: T.textSoft,
  },
  chartSplit: {},
  chartCard: {
    backgroundColor: 'rgba(18, 26, 36, 0.85)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.12)',
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
    gap: 12,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: T.text,
  },
  cardSubtitle: {
    marginTop: 4,
    fontSize: 12,
    color: T.textSoft,
  },
  cardMeta: {
    fontSize: 12,
    color: T.textSoft,
  },
  barChart: {},
  barRow: {
    marginBottom: 12,
  },
  barMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  barLabel: {
    color: T.text,
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
    paddingRight: 8,
  },
  barCount: {
    color: T.textSoft,
    fontSize: 12,
    fontWeight: '700',
  },
  barTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 999,
  },
  emptyText: {
    color: T.textSoft,
  },
  refreshBtn: {
    marginTop: 4,
    alignSelf: 'center',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.35)',
  },
  refreshText: {
    color: T.gold[0],
    fontWeight: '700',
  },
});
