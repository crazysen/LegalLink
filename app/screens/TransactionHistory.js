import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {MaterialCommunityIcons} from '@expo/vector-icons';
import {REFERENCE_THEME as T} from '../constants/referenceTheme';
import {ClientScreenShell, ClientFadeIn} from '../components/ClientScreenShell';
import ClientChevronBack from '../components/ClientChevronBack';
import {fetchClientTransactions, getCurrentSessionProfile} from '../services/userApi';

const BORDER_GOLD_SOFT = 'rgba(212, 175, 55, 0.12)';
const BORDER_GOLD_MED = 'rgba(212, 175, 55, 0.18)';
const BORDER_GOLD_PILL = 'rgba(212, 175, 55, 0.28)';

const COL = {
  icon: 40,
  date: 80,
};

function parseAmountPhpString(s) {
  return parseFloat(String(s || '').replace(/[^\d.]/g, '')) || 0;
}

function formatCurrencyNegative(value) {
  const amount = Number(value || 0);
  return `-PHP ${amount.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
}

function getStatusStyle(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'paid' || s === 'completed') {
    return {bg: 'rgba(209, 250, 229, 0.2)', color: '#6EE7B7', label: s === 'paid' ? 'PAID' : 'COMPLETED'};
  }
  if (s === 'refunded') {
    return {bg: 'rgba(254, 243, 199, 0.2)', color: '#FBBF24', label: 'REFUNDED'};
  }
  if (s === 'failed') {
    return {bg: 'rgba(254, 226, 226, 0.18)', color: '#FCA5A5', label: 'FAILED'};
  }
  return {bg: 'rgba(148, 163, 184, 0.12)', color: T.textSoft, label: s ? s.toUpperCase() : 'PENDING'};
}

export default function TransactionHistory({navigation}) {
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [filter, setFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedKey, setExpandedKey] = useState(null);

  const loadData = useCallback(async () => {
    try {
      setLoadError('');
      const {profile} = await getCurrentSessionProfile();
      const userId = profile?.id;
      if (!userId) {
        setRows([]);
        setLoadError('Sign in to view transaction history.');
        return;
      }
      const list = await fetchClientTransactions(userId);
      setRows(Array.isArray(list) ? list : []);
    } catch (error) {
      setLoadError(error?.message ?? 'Unable to load transaction history.');
      setRows([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadData();
  }, [loadData]);

  const stats = useMemo(() => {
    const isCounted = t => ['paid', 'completed'].includes(String(t.status || '').toLowerCase());
    const totalSpent = rows.filter(isCounted).reduce((sum, t) => sum + parseAmountPhpString(t.amount), 0);
    const consultationCount = rows.filter(t => t.type === 'consultation').length;
    const notarialCount = rows.filter(t => t.type === 'notarial').length;
    return {
      totalSpent,
      consultationCount,
      notarialCount,
      totalCount: rows.length,
    };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = String(searchQuery || '').trim().toLowerCase();
    return rows.filter(txn => {
      const matchesFilter =
        filter === 'all' ||
        (filter === 'consultation' && txn.type === 'consultation') ||
        (filter === 'notarial' && txn.type === 'notarial');
      const matchesSearch =
        !q ||
        String(txn.description || '')
          .toLowerCase()
          .includes(q) ||
        String(txn.detail || '')
          .toLowerCase()
          .includes(q) ||
        String(txn.id || '')
          .toLowerCase()
          .includes(q) ||
        String(txn.refNo || '')
          .toLowerCase()
          .includes(q);
      return matchesFilter && matchesSearch;
    });
  }, [rows, filter, searchQuery]);

  const formatCurrency = value => {
    const amount = Number(value || 0);
    return `₱${amount.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
  };

  const toggleExpand = key => {
    setExpandedKey(prev => (prev === key ? null : key));
  };

  const renderRow = ({item, index}) => {
    const expanded = expandedKey === item.id;
    const isConsult = item.type === 'consultation';
    const statusStyle = getStatusStyle(item.status);
    const isRefund = String(item.status || '').toLowerCase() === 'refunded';
    const amountNum = parseAmountPhpString(item.amount);
    const attorneyLine = String(item.detail || '')
      .replace(/^With\s+/i, '')
      .trim();

    return (
      <ClientFadeIn delay={32 + index * 24}>
        <TouchableOpacity
          style={styles.rowCard}
          onPress={() => toggleExpand(item.id)}
          activeOpacity={0.75}>
          <View style={styles.rowTop}>
            <View style={styles.typeIconWrap}>
              <MaterialCommunityIcons
                name={isConsult ? 'message-text' : 'file-document-outline'}
                size={18}
                color={T.gold[1]}
              />
            </View>
            <View style={styles.descBlock}>
              <Text style={styles.descTitle} numberOfLines={2}>
                {item.description}
              </Text>
              <Text style={styles.descSub} numberOfLines={2}>
                {item.detail}
              </Text>
            </View>
            <View style={styles.chevronHit}>
              <MaterialCommunityIcons
                name={expanded ? 'chevron-up' : 'chevron-down'}
                size={20}
                color={T.textSoft}
              />
            </View>
          </View>

          <View style={styles.rowMetaLabels}>
            <View style={[styles.metaDateBlock, {width: COL.date}]}>
              <Text style={styles.thInline}>DATE</Text>
            </View>
            <View style={styles.metaMethodSpacer} />
            <View style={styles.metaRightBlock}>
              <Text style={styles.thInline}>AMOUNT</Text>
              <View style={styles.thAmountGap} />
              <View style={styles.thPillSpace} />
            </View>
          </View>

          <View style={styles.rowMeta}>
            <View style={[styles.metaDateBlock, {width: COL.date}]}>
              <Text style={styles.metaDate}>{item.date}</Text>
              {item.time ? <Text style={styles.metaTime}>{item.time}</Text> : null}
            </View>
            <View style={styles.metaMethodBlock}>
              {item.method === 'Maya' ? (
                <View style={[styles.gcashBadge, styles.mayaBadge]}>
                  <Text style={[styles.gcashG, styles.mayaLetter]}>M</Text>
                </View>
              ) : (
                <View style={styles.gcashBadge}>
                  <Text style={styles.gcashG}>G</Text>
                </View>
              )}
              <Text style={styles.methodText} numberOfLines={1}>
                {item.method}
              </Text>
            </View>
            <View style={styles.metaRightBlock}>
              <Text style={styles.amountText}>
                {isRefund
                  ? `+PHP ${amountNum.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}`
                  : formatCurrencyNegative(amountNum)}
              </Text>
              <View style={[styles.statusPill, {borderColor: statusStyle.color + '55', backgroundColor: statusStyle.bg}]}>
                <Text style={[styles.statusPillText, {color: statusStyle.color}]}>{statusStyle.label}</Text>
              </View>
            </View>
          </View>

          {expanded ? (
            <View style={styles.expanded}>
              <Text style={styles.receiptTitle}>Payment receipt</Text>
              <ReceiptRow label="Transaction ID" value={String(item.id)} mono />
              <ReceiptRow label="Reference No." value={String(item.refNo ?? item.id)} mono />
              <ReceiptRow label="Service" value={item.description} />
              <ReceiptRow label="Attorney / Provider" value={attorneyLine || '—'} />
              <ReceiptRow
                label="Date & Time"
                value={`${item.date}${item.time ? ` at ${item.time}` : ''}`}
              />
              <ReceiptRow label="Payment method" value={item.method} />
              <View style={styles.receiptDivider} />
              <View style={styles.receiptTotalRow}>
                <Text style={styles.receiptTotalLabel}>
                  Amount {isRefund ? 'refunded' : 'paid'}
                </Text>
                <Text style={styles.receiptTotalValue}>{item.amount}</Text>
              </View>
            </View>
          ) : null}
        </TouchableOpacity>
      </ClientFadeIn>
    );
  };

  const ListHeader = (
    <ClientFadeIn>
      <ClientChevronBack
        style={styles.backHit}
        onPress={() => (navigation.canGoBack() ? navigation.goBack() : null)}
      />

      <View style={styles.summaryRow}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>TOTAL SPENT</Text>
          <Text style={styles.summaryValue}>{formatCurrency(stats.totalSpent)}</Text>
          <Text style={styles.summaryHint}>{stats.totalCount} transactions</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>CONSULTATIONS</Text>
          <Text style={styles.summaryValueNum}>{stats.consultationCount}</Text>
          <Text style={styles.summaryHint}>Legal consultations paid</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>NOTARIAL SERVICES</Text>
          <Text style={styles.summaryValueNum}>{stats.notarialCount}</Text>
          <Text style={styles.summaryHint}>Notarial fees paid</Text>
        </View>
      </View>

      <View style={styles.searchWrap}>
        <MaterialCommunityIcons name="magnify" size={18} color={T.textSoft} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search transactions..."
          placeholderTextColor={T.textSoft}
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterScrollContent}
        style={styles.filterRow}>
        <TouchableOpacity
          style={[styles.filterPill, filter === 'all' && styles.filterPillActive]}
          onPress={() => setFilter('all')}
          activeOpacity={0.8}>
          <Text style={[styles.filterPillText, filter === 'all' && styles.filterPillTextActive]}>All</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterPill, filter === 'consultation' && styles.filterPillActive]}
          onPress={() => setFilter('consultation')}
          activeOpacity={0.8}>
          <Text
            style={[styles.filterPillText, filter === 'consultation' && styles.filterPillTextActive]}>
            Consultation {stats.consultationCount}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterPill, filter === 'notarial' && styles.filterPillActive]}
          onPress={() => setFilter('notarial')}
          activeOpacity={0.8}>
          <Text style={[styles.filterPillText, filter === 'notarial' && styles.filterPillTextActive]}>
            Notarial {stats.notarialCount}
          </Text>
        </TouchableOpacity>
      </ScrollView>

      {loadError ? <Text style={styles.loadErrorText}>{loadError}</Text> : null}
    </ClientFadeIn>
  );

  return (
    <ClientScreenShell>
      {loading ? (
        <View style={styles.centerWrap}>
          <ActivityIndicator color={T.gold[1]} />
          <Text style={styles.emptyText}>Loading transactions...</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => String(item.id)}
          renderItem={renderRow}
          ListHeaderComponent={ListHeader}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={T.gold[1]} />
          }
          contentContainerStyle={[
            styles.listContent,
            {paddingBottom: Math.max(28, 12 + insets.bottom)},
          ]}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>
                {loadError
                  ? ''
                  : rows.length === 0
                    ? 'No transactions yet.'
                    : 'No transactions match your filters.'}
              </Text>
            </View>
          }
        />
      )}
    </ClientScreenShell>
  );
}

function ReceiptRow({label, value, mono}) {
  return (
    <View style={styles.receiptRow}>
      <Text style={styles.expandedLabel}>{label}</Text>
      <Text style={[styles.expandedValue, mono && styles.expandedMono]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  listContent: {
    paddingHorizontal: 16,
  },
  centerWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  backHit: {alignSelf: 'flex-start', marginBottom: 12},
  summaryRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: T.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER_GOLD_SOFT,
    paddingVertical: 12,
    paddingHorizontal: 8,
    minWidth: 0,
    minHeight: 92,
    justifyContent: 'space-between',
  },
  summaryLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: T.textSoft,
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: '800',
    color: T.text,
    marginBottom: 2,
  },
  summaryValueNum: {
    fontSize: 20,
    fontWeight: '800',
    color: T.text,
    marginBottom: 2,
  },
  summaryHint: {
    fontSize: 10,
    color: T.textSoft,
    lineHeight: 13,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BORDER_GOLD_PILL,
    borderRadius: 12,
    backgroundColor: T.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  searchIcon: {marginRight: 8},
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: T.text,
    padding: 0,
  },
  loadErrorText: {
    color: T.textSoft,
    marginBottom: 10,
    fontSize: 13,
  },
  filterRow: {
    marginBottom: 14,
  },
  filterScrollContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingRight: 4,
  },
  filterPill: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: BORDER_GOLD_PILL,
    backgroundColor: T.card,
  },
  filterPillActive: {
    backgroundColor: T.gold[1],
    borderColor: T.gold[1],
  },
  filterPillText: {
    fontSize: 13,
    fontWeight: '600',
    color: T.textMuted,
  },
  filterPillTextActive: {
    color: T.base,
  },
  rowMetaLabels: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginLeft: COL.icon + 10,
    paddingRight: 12,
    paddingBottom: 6,
    marginBottom: 2,
  },
  thInline: {
    fontSize: 9,
    fontWeight: '800',
    color: T.textSoft,
    letterSpacing: 0.8,
    opacity: 0.85,
  },
  thAmountGap: {width: 8},
  thPillSpace: {width: 44, height: 1},
  rowCard: {
    backgroundColor: T.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER_GOLD_SOFT,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 10,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  typeIconWrap: {
    width: COL.icon,
    height: COL.icon,
    borderRadius: 8,
    backgroundColor: T.plasmaA,
    borderWidth: 1,
    borderColor: BORDER_GOLD_MED,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  descBlock: {flex: 1, minWidth: 0, paddingRight: 4},
  descTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: T.text,
    letterSpacing: 0.3,
  },
  descSub: {
    fontSize: 10,
    color: T.textSoft,
    marginTop: 4,
    lineHeight: 14,
  },
  chevronHit: {
    paddingTop: 2,
    paddingLeft: 4,
  },
  rowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 8,
    marginLeft: COL.icon + 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: BORDER_GOLD_SOFT,
  },
  metaDateBlock: {
    justifyContent: 'center',
  },
  metaDate: {
    fontSize: 10,
    fontWeight: '700',
    color: T.textSoft,
  },
  metaTime: {
    fontSize: 9,
    color: T.textSoft,
    marginTop: 2,
  },
  metaMethodSpacer: {
    minWidth: 108,
    flexShrink: 0,
  },
  metaMethodBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    flexShrink: 0,
    minWidth: 108,
    marginRight: 10,
  },
  gcashBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: T.plasmaB,
    borderWidth: 1,
    borderColor: BORDER_GOLD_MED,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 6,
  },
  mayaBadge: {
    backgroundColor: 'rgba(124, 58, 237, 0.25)',
    borderColor: 'rgba(167, 139, 250, 0.45)',
  },
  mayaLetter: {
    color: '#C4B5FD',
  },
  gcashG: {
    color: T.gold[0],
    fontSize: 11,
    fontWeight: '900',
  },
  methodText: {
    fontSize: 11,
    fontWeight: '700',
    color: T.text,
    flexShrink: 0,
  },
  metaRightBlock: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    flexWrap: 'nowrap',
  },
  amountText: {
    fontSize: 12,
    fontWeight: '800',
    color: T.text,
    marginRight: 8,
    flexShrink: 0,
    textAlign: 'right',
  },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  statusPillText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  expanded: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: BORDER_GOLD_MED,
    marginLeft: COL.icon + 10,
  },
  receiptTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: T.gold[0],
    marginBottom: 10,
  },
  receiptRow: {
    marginBottom: 8,
  },
  receiptDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: BORDER_GOLD_MED,
    marginVertical: 8,
  },
  receiptTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  receiptTotalLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: T.text,
  },
  receiptTotalValue: {
    fontSize: 12,
    fontWeight: '800',
    color: T.gold[0],
  },
  expandedLabel: {fontSize: 10, color: T.textSoft, marginBottom: 2},
  expandedValue: {fontSize: 12, color: T.textMuted},
  expandedMono: {fontFamily: 'monospace'},
  emptyState: {
    borderWidth: 1,
    borderColor: BORDER_GOLD_SOFT,
    borderRadius: 16,
    backgroundColor: T.card,
    padding: 20,
    alignItems: 'center',
    marginTop: 12,
  },
  emptyText: {color: T.textSoft, marginTop: 8, textAlign: 'center'},
});
