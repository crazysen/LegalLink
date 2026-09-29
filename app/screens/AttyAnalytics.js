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
import AttorneyScreenHeader from '../components/AttorneyScreenHeader';
import {ClientScreenShell} from '../components/ClientScreenShell';
import {REFERENCE_THEME as T} from '../constants/referenceTheme';
import {supabase} from '../services/supabaseClient';
import {fetchAttorneyConsultationAnalyticsData, getCurrentSessionProfile} from '../services/userApi';

const defaultAnalytics = {
  rows: [],
  total: 0,
  maxCount: 0,
  branches: {rows: [], total: 0, maxCount: 0},
  status: [],
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

/** Horizontal scroll of vertical bars — one column per consultation branch. */
function BranchColumnChart({rows, maxCount}) {
  const safeMax = Math.max(Number(maxCount || 0), 1);
  const list = Array.isArray(rows) ? rows : [];

  if (!list.length) {
    return <Text style={styles.emptyText}>No branch classifications yet.</Text>;
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.branchScrollContent}>
      {list.map(row => {
        const n = Number(row.count || 0);
        const h = Math.max(18, Math.round((n / safeMax) * 132));
        return (
          <View key={row.label} style={styles.branchColumn}>
            <View style={styles.branchBarArea}>
              <View style={[styles.branchBarFill, {height: h}]} />
            </View>
            <Text style={styles.branchBarCount}>{n}</Text>
            <Text style={styles.branchBarLabel} numberOfLines={3}>
              {row.label}
            </Text>
          </View>
        );
      })}
    </ScrollView>
  );
}

export default function AttyAnalytics({navigation}) {
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
      const branchBlock = data?.branches || {
        rows: data?.rows || [],
        total: 0,
        maxCount: data?.maxCount || 0,
      };
      setAnalytics({
        ...defaultAnalytics,
        ...data,
        branches: {
          rows: branchBlock.rows || data?.rows || [],
          total: Number(branchBlock.total ?? 0),
          maxCount: Number(branchBlock.maxCount ?? data?.maxCount ?? 0),
        },
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

  const {total, branches, status} = analytics;

  const branchRows = branches?.rows || [];
  const branchMax = Math.max(Number(branches?.maxCount || 0), 1);
  const classifiedTotal = Number(branches?.total ?? 0);

  const classifiedPct =
    total > 0 ? Math.round((classifiedTotal / total) * 100) : 0;

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

  return (
    <ClientScreenShell edges={['top']}>
      <AttorneyScreenHeader
        navigation={navigation}
        title="Attorney Analytics"
        subtitle="Consultation volume, classified branches, and booking outcomes"
        activeRoute="AttyAnalytics"
      />
      <ScrollView
        contentContainerStyle={[styles.container, {paddingTop: 8}]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={T.gold[1]} />}
      >
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
            label="CLASSIFIED BY BRANCH"
            value={`${classifiedTotal}`}
            hint={
              total > 0
                ? `${classifiedPct}% of active consultations tagged with your branch list`
                : 'No consultations in scope yet'
            }
            muted={total === 0}
          />
        </View>

        <View style={styles.chartCard}>
          <View style={styles.cardHeader}>
            <View style={{flex: 1}}>
              <Text style={styles.cardTitle}>Consultation branches</Text>
              <Text style={styles.cardSubtitle}>
                Paid consultations grouped by the branch saved after sessions ({classifiedTotal}{' '}
                classified)
              </Text>
            </View>
          </View>
          <BranchColumnChart rows={branchRows} maxCount={branchMax} />
        </View>

        <View style={styles.chartCard}>
          <View style={styles.cardHeader}>
            <View style={{flex: 1}}>
              <Text style={styles.cardTitle}>Status distribution</Text>
              <Text style={styles.cardSubtitle}>
                {statusRows.reduce((sum, r) => sum + Number(r.count || 0), 0)} total appointments
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
  branchScrollContent: {
    paddingVertical: 8,
    paddingRight: 8,
    alignItems: 'flex-end',
  },
  branchColumn: {
    width: 104,
    marginRight: 14,
    alignItems: 'center',
  },
  branchBarArea: {
    width: 36,
    height: 140,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    justifyContent: 'flex-end',
    alignItems: 'center',
    overflow: 'hidden',
  },
  branchBarFill: {
    width: '100%',
    backgroundColor: T.gold[1],
    borderBottomLeftRadius: 10,
    borderBottomRightRadius: 10,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
  },
  branchBarCount: {
    marginTop: 8,
    fontSize: 13,
    fontWeight: '800',
    color: T.text,
  },
  branchBarLabel: {
    marginTop: 4,
    fontSize: 10,
    color: T.textSoft,
    textAlign: 'center',
    lineHeight: 13,
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
