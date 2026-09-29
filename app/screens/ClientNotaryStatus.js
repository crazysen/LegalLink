import React, {useCallback, useMemo, useState} from 'react';
import {useFocusEffect} from '@react-navigation/native';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import {MaterialCommunityIcons} from '@expo/vector-icons';
import {ClientScreenShell, ClientFadeIn, ClientFadeInSoft} from '../components/ClientScreenShell';
import ClientChevronBack from '../components/ClientChevronBack';
import KineticClientCard from '../components/KineticClientCard';
import {
  NOTARIAL_FILTERS,
  NOTARIAL_WORKFLOW_STEPS,
  buildNotarialWorkflow,
  computeNotarialStats,
  matchesNotarialFilter,
  notarialToneColors,
} from '../services/notarialWorkflow';
import { warmPaymentBackend } from '../services/paymentApiClient';
import {
  cancelNotarialRequest,
  fetchClientNotarialRequests,
  subscribeToClientNotarialRequests,
} from '../services/userApi';
import {replaceNotarialRequestDocument} from '../services/notarialService';
import {getMyProfile} from '../services/profileService';
import {REFERENCE_THEME as T} from '../constants/referenceTheme';
import {resolveNotarialAmount} from '../constants/notarialFees';

const WORKFLOW_OPTS = {isMobile: true};

const HEADER_BACK_COL = 28;
const HEADER_BACK_GAP = 8;

function NotarialStepper({stepIndex, flow}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.stepperScroll}>
      {NOTARIAL_WORKFLOW_STEPS.map((step, index) => {
        const done = index <= stepIndex && flow.phase !== 'rejected';
        const current = index === stepIndex;
        return (
          <View key={step.key} style={styles.step}>
            <View
              style={[
                styles.stepDot,
                done && styles.stepDotDone,
                current && styles.stepDotCurrent,
              ]}>
              <Text
                style={[
                  styles.stepDotText,
                  (done || current) && styles.stepDotTextActive,
                ]}>
                {done ? '✓' : index + 1}
              </Text>
            </View>
            <Text
              style={[
                styles.stepLabel,
                done && styles.stepLabelDone,
                current && styles.stepLabelCurrent,
              ]}
              numberOfLines={2}>
              {step.label}
            </Text>
          </View>
        );
      })}
    </ScrollView>
  );
}

function NotarialRequestCard({
  item,
  expanded,
  onToggle,
  onPay,
  onReplaceDocument,
  onCancel,
  onResubmit,
  busy,
}) {
  const flow = buildNotarialWorkflow(item, WORKFLOW_OPTS);
  const colors = notarialToneColors(flow.tone);
  const isPaid = String(item.payment || '').toUpperCase() === 'PAID';
  const isPending = String(item.status || 'PENDING').toUpperCase() === 'PENDING';
  const declined = flow.phase === 'rejected';
  const canReplace = isPending || flow.needsPayment;

  return (
    <View style={[styles.requestCard, {borderLeftColor: colors.border}]}>
      <TouchableOpacity style={styles.cardHeader} onPress={onToggle} activeOpacity={0.85}>
        <View style={styles.cardTitleWrap}>
          <Text style={styles.cardTitle} numberOfLines={2}>
            {item.service}
          </Text>
          <Text style={styles.cardDate}>Submitted {item.date}</Text>
        </View>
        <View style={[styles.badge, {backgroundColor: colors.badgeBg}]}>
          <Text style={[styles.badgeText, {color: colors.badgeText}]}>{flow.label}</Text>
        </View>
      </TouchableOpacity>

      <Text style={styles.cardSummary}>{flow.summary}</Text>

      <NotarialStepper stepIndex={flow.stepIndex} flow={flow} />

      {flow.needsPayment ? (
        <TouchableOpacity
          style={styles.payBtn}
          onPress={() => onPay(item)}
          activeOpacity={0.9}
          disabled={busy}>
          <MaterialCommunityIcons name="credit-card-outline" size={18} color={T.base} />
          <Text style={styles.payBtnText}>Proceed to Payment</Text>
        </TouchableOpacity>
      ) : null}

      {declined ? (
        <TouchableOpacity
          style={styles.payBtn}
          onPress={onResubmit}
          activeOpacity={0.9}
          disabled={busy}>
          <MaterialCommunityIcons name="refresh" size={18} color={T.base} />
          <Text style={styles.payBtnText}>Resubmit Request</Text>
        </TouchableOpacity>
      ) : null}

      {canReplace ? (
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={styles.ghostBtn}
            onPress={() => onReplaceDocument(item)}
            activeOpacity={0.85}
            disabled={busy}>
            {busy ? (
              <ActivityIndicator color={T.gold[0]} size="small" />
            ) : (
              <MaterialCommunityIcons name="file-replace-outline" size={16} color={T.gold[0]} />
            )}
            <Text style={styles.ghostBtnText}>Replace File</Text>
          </TouchableOpacity>
          {isPending ? (
            <TouchableOpacity
              style={[styles.ghostBtn, styles.dangerBtn]}
              onPress={() => onCancel(item)}
              activeOpacity={0.85}
              disabled={busy}>
              <MaterialCommunityIcons name="close-circle-outline" size={16} color="#FCA5A5" />
              <Text style={[styles.ghostBtnText, styles.dangerBtnText]}>Cancel</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {expanded ? (
        <View style={styles.details}>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Payment</Text>
            <Text style={styles.detailValue}>{isPaid ? 'Paid' : 'Pending'}</Text>
          </View>
          {item.fee && item.amount > 0 ? (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Fee</Text>
              <Text style={styles.detailValue}>{item.fee}</Text>
            </View>
          ) : null}
          {item.file && item.file !== 'N/A' ? (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Document</Text>
              <Text style={styles.detailValue} numberOfLines={1}>
                {String(item.file).split('/').pop() || 'Attached'}
              </Text>
            </View>
          ) : null}
          {item.assignedTo ? (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Assigned</Text>
              <Text style={styles.detailValue}>{item.assignedTo}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export default function ClientNotaryStatus({navigation}) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [activeFilter, setActiveFilter] = useState('All');
  const [expandedId, setExpandedId] = useState(null);
  const [clientId, setClientId] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const loadRequests = useCallback(
    async (options = {}) => {
      const silent = Boolean(options?.silent);
      try {
        if (!silent) setLoading(true);

        let userId = clientId;
        if (!userId) {
          const profile = await getMyProfile();
          userId = profile?.id;
          if (userId) setClientId(userId);
        }
        if (!userId) {
          setRequests([]);
          return;
        }

        const rows = await fetchClientNotarialRequests(userId);
        setRequests(Array.isArray(rows) ? rows : []);
        setLoadError('');
      } catch (error) {
        setLoadError(error?.message ?? 'Unable to load notary requests.');
        setRequests([]);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [clientId],
  );

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      let unsubscribe = () => {};

      (async () => {
        await loadRequests();
        if (cancelled) return;

        try {
          const profile = await getMyProfile();
          if (cancelled || !profile?.id) return;
          setClientId(profile.id);
          unsubscribe = subscribeToClientNotarialRequests(profile.id, () => {
            loadRequests({silent: true});
          });
        } catch {
          // ignore
        }
      })();

      return () => {
        cancelled = true;
        unsubscribe();
      };
    }, [loadRequests]),
  );

  const stats = useMemo(
    () => computeNotarialStats(requests, WORKFLOW_OPTS),
    [requests],
  );

  const visible = useMemo(
    () => requests.filter(req => matchesNotarialFilter(req, activeFilter, WORKFLOW_OPTS)),
    [requests, activeFilter],
  );

  const handlePay = item => {
    const amount = resolveNotarialAmount(item.amount);
    warmPaymentBackend().catch(() => {});

    navigation.navigate('Payment', {
      paymentMethod: 'qrph',
      serviceData: {
        type: item.service ?? 'Notarial Service',
        amount: `₱${amount.toLocaleString()}`,
      },
      paymentContext: {
        sourceType: 'notarial',
        sourceId: item.id,
        attorneyId: item.attorneyId,
        amount,
      },
    });
  };

  const handleReplaceDocument = async item => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'application/pdf',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ],
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;

      const asset = result.assets?.[0];
      if (!asset?.uri) return;

      setBusyId(item.id);
      const documentBase64 = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      await replaceNotarialRequestDocument({
        requestId: item.id,
        documentBase64,
        documentName: asset.name,
      });
      await loadRequests({silent: true});
      Alert.alert('File replaced', 'Your new document is now attached to this request.');
    } catch (error) {
      Alert.alert('Error', error?.message ?? 'Unable to replace the document.');
    } finally {
      setBusyId(null);
    }
  };

  const handleCancel = item => {
    Alert.alert(
      'Cancel request?',
      'This withdraws your notarial request. You can submit a new one anytime.',
      [
        {text: 'Keep request', style: 'cancel'},
        {
          text: 'Cancel request',
          style: 'destructive',
          onPress: async () => {
            try {
              setBusyId(item.id);
              await cancelNotarialRequest(item.id);
              await loadRequests({silent: true});
            } catch (error) {
              Alert.alert('Error', error?.message ?? 'Unable to cancel the request.');
            } finally {
              setBusyId(null);
            }
          },
        },
      ],
    );
  };

  const handleResubmit = () => navigation.navigate('ClientNotarial');

  const goBack = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.navigate('HomepageClient');
    }
  };

  return (
    <ClientScreenShell>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}>
        <ClientFadeIn>
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <View style={styles.backColumn}>
                <ClientChevronBack onPress={goBack} />
              </View>
              <Text style={styles.headerTitle} numberOfLines={2}>
                Notary Status
              </Text>
            </View>
            <Text style={styles.headerSubtitle}>
              Track notary requests from submission through pickup
            </Text>
          </View>
        </ClientFadeIn>

        <ClientFadeInSoft delay={50}>
          <View style={styles.heroCard}>
            <Text style={styles.heroEyebrow}>Notary services</Text>
            <Text style={styles.heroTitle}>Track your notary requests</Text>
            <Text style={styles.heroBody}>
              Status updates sync with the web dashboard. Submit your document, wait for
              approval, then pay to move your request into the notarization queue.
            </Text>
          </View>
        </ClientFadeInSoft>

        <ClientFadeInSoft delay={90}>
          <KineticClientCard
            animateIcon
            icon="file-certificate"
            title="New notary request"
            subtitle="Upload your document and submit it for review."
            onPress={() => navigation.navigate('ClientNotarial')}
          />
        </ClientFadeInSoft>

        <ClientFadeIn delay={120}>
          <View style={styles.statsRow}>
            {[
              {label: 'Active', value: stats.active, color: '#60A5FA'},
              {label: 'Ready for Pickup', value: stats.pickup, color: '#4ADE80'},
              {label: 'Completed', value: stats.done, color: '#A78BFA'},
              {label: 'Total', value: stats.total, color: T.gold[0]},
            ].map(stat => (
              <View key={stat.label} style={styles.statCard}>
                <Text style={[styles.statValue, {color: stat.color}]}>{stat.value}</Text>
                <Text style={styles.statLabel} numberOfLines={2}>
                  {stat.label}
                </Text>
              </View>
            ))}
          </View>
        </ClientFadeIn>

        <ClientFadeIn delay={150}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filters}>
            {NOTARIAL_FILTERS.map(filter => (
              <TouchableOpacity
                key={filter}
                style={[styles.filterChip, activeFilter === filter && styles.filterChipActive]}
                onPress={() => setActiveFilter(filter)}>
                <Text
                  style={[
                    styles.filterText,
                    activeFilter === filter && styles.filterTextActive,
                  ]}>
                  {filter}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </ClientFadeIn>

        {loadError ? <Text style={styles.errorText}>{loadError}</Text> : null}

        {loading ? (
          <View style={styles.emptyCard}>
            <ActivityIndicator color={T.gold[1]} size="large" />
            <Text style={styles.emptySubtitle}>Loading your notary requests…</Text>
          </View>
        ) : visible.length === 0 ? (
          <View style={styles.emptyCard}>
            <MaterialCommunityIcons
              name="file-document-outline"
              size={44}
              color="rgba(255,255,255,0.2)"
            />
            <Text style={styles.emptyTitle}>No notary requests yet</Text>
            <Text style={styles.emptySubtitle}>
              Submit a notary request to see live status updates here.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {visible.map((item, index) => (
              <ClientFadeInSoft key={item.id} delay={180 + index * 40}>
                <NotarialRequestCard
                  item={item}
                  expanded={expandedId === item.id}
                  onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
                  onPay={handlePay}
                  onReplaceDocument={handleReplaceDocument}
                  onCancel={handleCancel}
                  onResubmit={handleResubmit}
                  busy={busyId === item.id}
                />
              </ClientFadeInSoft>
            ))}
          </View>
        )}
      </ScrollView>
    </ClientScreenShell>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    paddingTop: 4,
  },
  header: {
    marginBottom: 16,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backColumn: {
    width: HEADER_BACK_COL,
    marginRight: HEADER_BACK_GAP,
    alignItems: 'flex-start',
  },
  headerTitle: {
    flex: 1,
    fontSize: 24,
    fontWeight: '900',
    color: T.text,
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    marginTop: 8,
    marginLeft: HEADER_BACK_COL + HEADER_BACK_GAP,
    fontSize: 14,
    color: T.textMuted,
    lineHeight: 20,
  },
  heroCard: {
    backgroundColor: 'rgba(18, 26, 36, 0.88)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.12)',
    padding: 18,
    marginBottom: 14,
  },
  heroEyebrow: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    color: T.gold[1],
    marginBottom: 6,
  },
  heroTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: T.text,
    marginBottom: 8,
  },
  heroBody: {
    fontSize: 14,
    color: T.textMuted,
    lineHeight: 21,
  },
  statsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 14,
  },
  statCard: {
    width: '47%',
    flexGrow: 1,
    backgroundColor: 'rgba(18, 26, 36, 0.88)',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.12)',
  },
  statValue: {
    fontSize: 24,
    fontWeight: '900',
  },
  statLabel: {
    marginTop: 4,
    fontSize: 10,
    fontWeight: '700',
    color: T.textSoft,
    textAlign: 'center',
  },
  filters: {
    gap: 8,
    paddingBottom: 14,
  },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.15)',
    backgroundColor: 'rgba(18, 26, 36, 0.7)',
  },
  filterChipActive: {
    backgroundColor: T.gold[1],
    borderColor: T.gold[1],
  },
  filterText: {
    color: T.textSoft,
    fontSize: 13,
    fontWeight: '700',
  },
  filterTextActive: {
    color: T.base,
  },
  errorText: {
    color: '#FCA5A5',
    fontSize: 13,
    marginBottom: 12,
  },
  emptyCard: {
    borderRadius: 20,
    paddingVertical: 36,
    paddingHorizontal: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(244, 215, 139, 0.12)',
    backgroundColor: 'rgba(18, 26, 36, 0.62)',
  },
  emptyTitle: {
    marginTop: 12,
    color: T.text,
    fontSize: 17,
    fontWeight: '800',
  },
  emptySubtitle: {
    marginTop: 8,
    color: T.textSoft,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
  },
  list: {
    gap: 12,
  },
  requestCard: {
    backgroundColor: 'rgba(18, 26, 36, 0.88)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.12)',
    borderLeftWidth: 4,
    padding: 16,
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
  },
  cardTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: T.text,
  },
  cardDate: {
    fontSize: 11,
    color: T.textSoft,
    marginTop: 4,
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    maxWidth: '42%',
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '800',
    textAlign: 'center',
  },
  cardSummary: {
    color: T.textMuted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 12,
    marginBottom: 14,
  },
  stepperScroll: {
    gap: 6,
    paddingBottom: 4,
  },
  step: {
    width: 72,
    alignItems: 'center',
  },
  stepDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 2,
    borderColor: 'rgba(244, 215, 139, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDotDone: {
    backgroundColor: '#1e3a8a',
    borderColor: '#1e3a8a',
  },
  stepDotCurrent: {
    backgroundColor: T.gold[1],
    borderColor: T.gold[1],
  },
  stepDotText: {
    fontSize: 11,
    fontWeight: '800',
    color: T.textSoft,
  },
  stepDotTextActive: {
    color: '#fff',
  },
  stepLabel: {
    marginTop: 6,
    fontSize: 9,
    fontWeight: '700',
    color: T.textSoft,
    textAlign: 'center',
    lineHeight: 12,
  },
  stepLabelDone: {
    color: T.text,
  },
  stepLabelCurrent: {
    color: T.gold[0],
  },
  payBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: T.gold[1],
    borderRadius: 12,
    paddingVertical: 12,
    marginTop: 4,
  },
  payBtnText: {
    color: T.base,
    fontWeight: '800',
    fontSize: 14,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  ghostBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.28)',
    backgroundColor: 'rgba(244, 215, 139, 0.08)',
    paddingVertical: 11,
  },
  ghostBtnText: {
    color: T.gold[0],
    fontWeight: '800',
    fontSize: 13,
  },
  dangerBtn: {
    borderColor: 'rgba(239, 68, 68, 0.35)',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  },
  dangerBtnText: {
    color: '#FCA5A5',
  },
  details: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(244, 215, 139, 0.1)',
    gap: 8,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  detailLabel: {
    color: T.textSoft,
    fontSize: 13,
  },
  detailValue: {
    color: T.text,
    fontSize: 13,
    fontWeight: '700',
    flex: 1,
    textAlign: 'right',
  },
});
