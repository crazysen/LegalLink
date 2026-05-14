import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {MaterialCommunityIcons} from '@expo/vector-icons';
import {ClientScreenShell, ClientFadeIn} from '../components/ClientScreenShell';
import ClientChevronBack from '../components/ClientChevronBack';
import {REFERENCE_THEME as T} from '../constants/referenceTheme';
import {getMyAppointments} from '../services/appointmentService';
import {getNotarialRequests} from '../services/notarialService';
import {supabase} from '../services/supabaseClient';

const NOTARIAL_FEE_FALLBACK = 4000;

const BORDER_GOLD_SOFT = 'rgba(212, 175, 55, 0.12)';
const BORDER_GOLD_MED = 'rgba(212, 175, 55, 0.2)';
const ICON_PURPLE_BG = 'rgba(139, 92, 246, 0.14)';
const ICON_PURPLE_BORDER = 'rgba(167, 139, 250, 0.35)';
const GROWTH_POS = 'rgba(52, 211, 153, 0.95)';
const GROWTH_BG = 'rgba(16, 185, 129, 0.12)';

function isPaidConsultation(a) {
  const s = String(a.status ?? '').toLowerCase();
  return Boolean(a.payment_is_paid) || ['confirmed', 'completed'].includes(s);
}

function isPaidNotarial(n) {
  return ['accepted', 'completed'].includes(String(n.status ?? '').toLowerCase());
}

function formatPhp(n) {
  const v = Number(n) || 0;
  return `PHP ${v.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
}

function formatGrowth(prev, next) {
  if (prev <= 0 && next <= 0) {
    return null;
  }
  if (prev <= 0 && next > 0) {
    return '+100%';
  }
  const raw = ((next - prev) / prev) * 100;
  const sign = raw >= 0 ? '+' : '';
  return `${sign}${raw.toFixed(1)}%`;
}

function formatRowDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return '—';
  }
  return d.toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'});
}

function buildEarningRows(appointments, notarial, attorneyId) {
  const consult = (appointments || [])
    .filter(a => a.attorney_id === attorneyId && isPaidConsultation(a))
    .map(a => ({
      key: `c-${a.id}`,
      clientName: String(a.client_name || 'Client').trim() || 'Client',
      serviceType: 'Consultation',
      dateIso: a.updated_at || a.scheduled_at || a.created_at,
      amountNum: Number(a.amount ?? 2500),
    }));

  const notar = (notarial || [])
    .filter(n => n.attorney_id === attorneyId && isPaidNotarial(n))
    .map(n => ({
      key: `n-${n.id}`,
      clientName: String(n.client_name || 'Client').trim() || 'Client',
      serviceType: String(n.service_type || 'Notarial').trim() || 'Notarial',
      dateIso: n.updated_at || n.created_at,
      amountNum: NOTARIAL_FEE_FALLBACK,
    }));

  return [...consult, ...notar].sort(
    (a, b) => new Date(b.dateIso).getTime() - new Date(a.dateIso).getTime(),
  );
}

function sumCalendarMonth(rows, ref) {
  const y = ref.getFullYear();
  const m = ref.getMonth();
  return rows.reduce((sum, r) => {
    const d = new Date(r.dateIso);
    if (d.getFullYear() === y && d.getMonth() === m) {
      return sum + r.amountNum;
    }
    return sum;
  }, 0);
}

function prevMonthRef(ref) {
  const d = new Date(ref.getFullYear(), ref.getMonth() - 1, 1);
  return d;
}

function rollingSum(rows, endMs, daysMs) {
  const start = endMs - daysMs;
  return rows.reduce((sum, r) => {
    const t = new Date(r.dateIso).getTime();
    if (t >= start && t <= endMs) {
      return sum + r.amountNum;
    }
    return sum;
  }, 0);
}

const TrendingUp = props => <MaterialCommunityIcons name="trending-up" {...props} />;

function SummaryCard({label, valueText, growth, icon, iconBg, iconBorder}) {
  return (
    <View style={styles.summaryCard}>
      <View style={styles.summaryTop}>
        <View style={[styles.iconBox, {backgroundColor: iconBg, borderColor: iconBorder}]}>
          {icon}
        </View>
        {growth != null ? (
          <View style={styles.growthBadge}>
            <TrendingUp size={12} color={GROWTH_POS} />
            <Text style={styles.growthText}>{growth}</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
        {valueText}
      </Text>
    </View>
  );
}

function TableHeader() {
  return (
    <View style={styles.tableHeadRow}>
      <Text style={[styles.thCell, styles.thName]} numberOfLines={1}>
        CLIENT NAME
      </Text>
      <Text style={[styles.thCell, styles.thService]} numberOfLines={1}>
        SERVICE
      </Text>
      <Text style={[styles.thCell, styles.thDate]} numberOfLines={1}>
        DATE
      </Text>
      <Text style={[styles.thCell, styles.thAmount]} numberOfLines={1}>
        AMOUNT
      </Text>
    </View>
  );
}

export default function MyEarnings({navigation}) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rows, setRows] = useState([]);

  const load = useCallback(async () => {
    const {
      data: {user},
    } = await supabase.auth.getUser();
    if (!user?.id) {
      setRows([]);
      return;
    }
    const [appointments, notarial] = await Promise.all([
      getMyAppointments({force: true}),
      getNotarialRequests(),
    ]);
    setRows(buildEarningRows(appointments, notarial, user.id));
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        await load();
      } catch (e) {
        Alert.alert('Error', e?.message ?? 'Unable to load earnings.');
        if (alive) {
          setRows([]);
        }
      } finally {
        if (alive) {
          setLoading(false);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } catch (e) {
      Alert.alert('Error', e?.message ?? 'Refresh failed.');
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const stats = useMemo(() => {
    const now = new Date();
    const total = rows.reduce((s, r) => s + r.amountNum, 0);
    const thisMonth = sumCalendarMonth(rows, now);
    const lastMonthRef = prevMonthRef(now);
    const lastMonth = sumCalendarMonth(rows, lastMonthRef);
    const growthMonth = formatGrowth(lastMonth, thisMonth);

    const end = Date.now();
    const last30 = rollingSum(rows, end, 30 * 86400000);
    const prev30 = rollingSum(rows, end - 30 * 86400000, 30 * 86400000);
    const growthTotal = formatGrowth(prev30, last30);

    return {
      total,
      thisMonth,
      growthMonth,
      growthTotal,
    };
  }, [rows]);

  const renderRow = (item, index, list) => (
    <TouchableOpacity
      key={item.key}
      style={[styles.tableRow, index === list.length - 1 && styles.tableRowLast]}
      onPress={() => navigation.navigate('AttyPayoutDetails')}
      activeOpacity={0.7}>
      <Text style={[styles.tdCell, styles.tdName]} numberOfLines={2}>
        {item.clientName}
      </Text>
      <Text style={[styles.tdCell, styles.tdService]} numberOfLines={2}>
        {item.serviceType}
      </Text>
      <Text style={[styles.tdCell, styles.tdDate]} numberOfLines={1}>
        {formatRowDate(item.dateIso)}
      </Text>
      <Text style={[styles.tdCell, styles.tdAmount]} numberOfLines={1}>
        {formatPhp(item.amountNum)}
      </Text>
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <ClientScreenShell edges={['top']}>
        <View style={styles.centered}>
          <ActivityIndicator color={T.gold[1]} />
          <Text style={styles.mutedHelp}>Loading earnings…</Text>
        </View>
      </ClientScreenShell>
    );
  }

  return (
    <ClientScreenShell edges={['top']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.listContent,
          {paddingBottom: Math.max(28, 12 + insets.bottom)},
        ]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={T.gold[1]} />
        }>
        <ClientFadeIn>
          <View style={styles.headerRow}>
            <ClientChevronBack
              style={styles.backHit}
              onPress={() => (navigation.canGoBack() ? navigation.goBack() : null)}
            />
            <View style={styles.headerTitles}>
              <Text style={styles.title}>Earnings</Text>
              <Text style={styles.networkSub}>BATASMO PROFESSIONAL NETWORK</Text>
            </View>
          </View>

          <View style={styles.summaryRow}>
            <SummaryCard
              label="TOTAL EARNINGS"
              valueText={formatPhp(stats.total)}
              growth={stats.growthTotal}
              icon={<MaterialCommunityIcons name="currency-php" size={22} color={T.gold[1]} />}
              iconBg="rgba(212, 175, 55, 0.12)"
              iconBorder={BORDER_GOLD_MED}
            />
            <SummaryCard
              label="THIS MONTH"
              valueText={formatPhp(stats.thisMonth)}
              growth={stats.growthMonth}
              icon={<MaterialCommunityIcons name="calendar" size={22} color="rgba(196, 181, 253, 0.95)" />}
              iconBg={ICON_PURPLE_BG}
              iconBorder={ICON_PURPLE_BORDER}
            />
          </View>

          <View style={styles.historyPanel}>
            <Text style={styles.sectionTitle}>TRANSACTION HISTORY</Text>
            {rows.length === 0 ? (
              <View style={styles.emptyInside}>
                <Text style={styles.mutedHelp}>No paid transactions yet.</Text>
              </View>
            ) : (
              <>
                <TableHeader />
                {rows.map((item, index) => renderRow(item, index, rows))}
              </>
            )}
          </View>
        </ClientFadeIn>
      </ScrollView>
    </ClientScreenShell>
  );
}

const styles = StyleSheet.create({
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  mutedHelp: {
    color: T.textSoft,
    marginTop: 10,
    textAlign: 'center',
    fontSize: 14,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  backHit: {marginRight: 8},
  headerTitles: {flex: 1},
  title: {fontSize: 22, fontWeight: '900', color: T.text},
  networkSub: {fontSize: 10, color: T.textSoft, letterSpacing: 1, marginTop: 4},

  summaryRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 18,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: T.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER_GOLD_SOFT,
    paddingVertical: 12,
    paddingHorizontal: 10,
    minWidth: 0,
    minHeight: 118,
    justifyContent: 'space-between',
  },
  summaryTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  growthBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: GROWTH_BG,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 20,
    maxWidth: '48%',
  },
  growthText: {
    color: GROWTH_POS,
    fontSize: 11,
    fontWeight: '800',
    marginLeft: 3,
  },
  summaryLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: T.textSoft,
    letterSpacing: 0.7,
    marginTop: 8,
  },
  summaryValue: {
    fontSize: 17,
    fontWeight: '800',
    color: T.text,
    marginTop: 4,
  },

  historyPanel: {
    backgroundColor: T.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER_GOLD_SOFT,
    paddingHorizontal: 12,
    paddingTop: 14,
    paddingBottom: 12,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '900',
    color: T.text,
    letterSpacing: 0.6,
    marginBottom: 12,
  },
  emptyInside: {
    paddingVertical: 20,
    alignItems: 'center',
  },

  tableHeadRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER_GOLD_SOFT,
  },
  thCell: {
    fontSize: 8,
    fontWeight: '800',
    color: T.textSoft,
    letterSpacing: 0.4,
  },
  thName: {flex: 2.1, paddingRight: 4},
  thService: {flex: 1.35, paddingRight: 4},
  thDate: {flex: 1.15, paddingRight: 4},
  thAmount: {flex: 1.2, textAlign: 'right'},

  tableRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER_GOLD_SOFT,
  },
  tableRowLast: {
    borderBottomWidth: 0,
  },
  tdCell: {
    fontSize: 11,
    color: T.textMuted,
  },
  tdName: {
    flex: 2.1,
    paddingRight: 4,
    fontWeight: '800',
    color: T.text,
  },
  tdService: {
    flex: 1.35,
    paddingRight: 4,
  },
  tdDate: {
    flex: 1.15,
    paddingRight: 4,
  },
  tdAmount: {
    flex: 1.2,
    textAlign: 'right',
    fontWeight: '700',
    color: T.textMuted,
  },
});
