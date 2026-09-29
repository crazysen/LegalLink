import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {REFERENCE_THEME as T} from '../constants/referenceTheme';
import {IS_IOS} from '../constants/platformUi';
import {ClientScreenShell} from '../components/ClientScreenShell';
import ClientChevronBack from '../components/ClientChevronBack';
import ChatMessageBody from '../components/ChatMessageBody';
import ConsultationSummaryView from '../components/ConsultationSummaryView';
import {
  fetchAttorneyProfile,
  fetchConsultationTranscriptForAppointment,
  getCurrentSessionProfile,
} from '../services/userApi';
import {
  getConsultationBranchesForAttorney,
  parseConsultationBranchFromTitle,
} from '../services/consultationBranches';
import {
  saveAttorneyConsultationBranch,
  saveAttorneyConsultationSummary,
} from '../services/messageService';

export default function ConsultationTranscript({navigation, route}) {
  const insets = useSafeAreaInsets();
  const listRef = useRef(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [summaryDraft, setSummaryDraft] = useState('');
  const [branchDraft, setBranchDraft] = useState('');
  const [branchOptions, setBranchOptions] = useState([]);
  const [saving, setSaving] = useState(false);

  const title = route?.params?.title ?? 'Consultation';
  const initials = route?.params?.initials ?? '?';
  const attorneyReviewMode = Boolean(route?.params?.attorneyReviewMode);
  const summaryFocus = Boolean(route?.params?.summaryFocus);
  const showSummaryOnly = summaryFocus && !attorneyReviewMode;
  const attorneySummary = String(summaryDraft || '').trim();
  const [consultationTitle, setConsultationTitle] = useState('');
  const consultationBranch = parseConsultationBranchFromTitle(
    consultationTitle || route?.params?.logTitle || title || '',
  );
  const threadId = useMemo(
    () => String(route?.params?.appointmentId ?? route?.params?.chatId ?? '').trim(),
    [route?.params?.appointmentId, route?.params?.chatId],
  );

  const loadThread = useCallback(async () => {
    if (!threadId) {
      setMessages([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const response = await fetchConsultationTranscriptForAppointment(threadId, {
        includeMessages: !showSummaryOnly,
      });
      setMessages(
        showSummaryOnly ? [] : Array.isArray(response.messages) ? response.messages : [],
      );
      setSummaryDraft(response.attorneyConsultationSummary || '');
      setConsultationTitle(response.title || route?.params?.logTitle || '');
      const parsedBranch = parseConsultationBranchFromTitle(
        response.title || route?.params?.logTitle || '',
      );
      setBranchDraft(parsedBranch || '');

      if (attorneyReviewMode) {
        const {profile} = await getCurrentSessionProfile();
        if (profile?.id) {
          const attorneyData = await fetchAttorneyProfile(profile.id);
          const opts = getConsultationBranchesForAttorney({
            name: attorneyData.profile?.full_name || '',
            specialties: attorneyData.specialties || [],
          });
          setBranchOptions(opts);
        }
      }
    } catch {
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [attorneyReviewMode, route?.params?.logTitle, showSummaryOnly, threadId]);

  useEffect(() => {
    loadThread();
  }, [loadThread]);

  useEffect(() => {
    if (showSummaryOnly) {
      return;
    }
    listRef.current?.scrollToEnd({animated: true});
  }, [messages.length, showSummaryOnly]);

  const handleSaveReview = async () => {
    if (!threadId) return;
    if (branchOptions.length > 0 && !branchDraft.trim()) {
      Alert.alert('Branch required', 'Please select a consultation branch.');
      return;
    }
    try {
      setSaving(true);
      if (branchOptions.length > 0) {
        await saveAttorneyConsultationBranch({appointmentId: threadId, branch: branchDraft.trim()});
      }
      await saveAttorneyConsultationSummary(threadId, summaryDraft);
      Alert.alert('Saved', 'Consultation notes saved.');
      navigation.goBack();
    } catch (error) {
      Alert.alert('Error', error?.message || 'Failed to save consultation notes.');
    } finally {
      setSaving(false);
    }
  };

  const renderItem = ({item}) => {
    const isMe = item.sender === 'me';
    return (
      <View style={isMe ? styles.userBubble : styles.aiBubble}>
        <ChatMessageBody
          item={item}
          textStyle={isMe ? styles.userMessageText : styles.messageText}
        />
        <Text style={isMe ? styles.userTimestamp : styles.timestamp}>{item.time}</Text>
      </View>
    );
  };

  const clientSummaryHeader =
    !attorneyReviewMode && (summaryFocus || attorneySummary || consultationBranch) ? (
      <View style={styles.clientSummaryCard}>
        <Text style={styles.clientSummaryTitle}>Session summary</Text>
        {consultationBranch ? (
          <View style={styles.clientBranchRow}>
            <Text style={styles.clientBranchLabel}>Consultation branch</Text>
            <Text style={styles.clientBranchValue}>{consultationBranch}</Text>
          </View>
        ) : null}
        {attorneySummary ? (
          <>
            <Text style={styles.clientSummarySubtitle}>From your attorney</Text>
            <ConsultationSummaryView summary={attorneySummary} />
          </>
        ) : (
          <Text style={styles.clientSummaryEmpty}>
            Your attorney has not added written notes yet. Check back later.
          </Text>
        )}
      </View>
    ) : null;

  const listFooter = attorneyReviewMode ? (
    <View style={styles.reviewCard}>
      <Text style={styles.reviewTitle}>Session wrap-up</Text>
      {branchOptions.length > 0 ? (
        <>
          <Text style={styles.reviewLabel}>Consultation branch</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.branchScroll}>
            {branchOptions.map((branch) => {
              const active = branchDraft === branch;
              return (
                <TouchableOpacity
                  key={branch}
                  style={[styles.branchChip, active && styles.branchChipActive]}
                  onPress={() => setBranchDraft(branch)}>
                  <Text style={[styles.branchChipText, active && styles.branchChipTextActive]}>
                    {branch}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </>
      ) : null}
      <Text style={styles.reviewLabel}>Attorney summary</Text>
      <TextInput
        style={styles.summaryInput}
        multiline
        placeholder="Notes from this consultation..."
        placeholderTextColor={T.textMuted}
        value={summaryDraft}
        onChangeText={setSummaryDraft}
      />
      <TouchableOpacity
        style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
        disabled={saving}
        onPress={handleSaveReview}>
        <Text style={styles.saveBtnText}>{saving ? 'Saving...' : 'Save summary'}</Text>
      </TouchableOpacity>
    </View>
  ) : null;

  return (
    <ClientScreenShell edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <ClientChevronBack
          style={styles.backHit}
          onPress={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('AttyLandingPage'))}
        />
        <View style={styles.avatarPlaceholder}>
          <Text style={styles.avatarInitials}>{initials}</Text>
        </View>
        <View style={styles.headerInfo}>
          <Text style={styles.headerName}>{title}</Text>
          <Text style={styles.headerStatus}>
            {attorneyReviewMode
              ? 'Transcript & session notes'
              : summaryFocus
                ? 'Session summary'
                : 'Transcript (read-only)'}
          </Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={T.gold[1]} size="large" />
        </View>
      ) : showSummaryOnly ? (
        <ScrollView
          style={styles.messagesList}
          contentContainerStyle={[
            styles.chatList,
            styles.summaryOnlyContent,
            {paddingBottom: Math.max(insets.bottom, 24) + 16},
          ]}
          keyboardDismissMode={IS_IOS ? 'interactive' : 'on-drag'}>
          {clientSummaryHeader}
        </ScrollView>
      ) : (
        <FlatList
          ref={listRef}
          style={styles.messagesList}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={[
            styles.chatList,
            {paddingBottom: Math.max(insets.bottom, 24) + (attorneyReviewMode ? 8 : 16)},
          ]}
          keyboardDismissMode={IS_IOS ? 'interactive' : 'on-drag'}
          onContentSizeChange={() => listRef.current?.scrollToEnd({animated: true})}
          ListHeaderComponent={
            <>
              {clientSummaryHeader}
              <View style={styles.encryptionBadge}>
                <Text style={styles.encryptionText}>
                  🔒 This session is end-to-end encrypted for your privacy.
                </Text>
              </View>
              <View style={styles.readOnlyBadge}>
                <Text style={styles.readOnlyText}>
                  Read-only transcript — messaging and attachments are disabled.
                </Text>
              </View>
            </>
          }
          ListEmptyComponent={
            <Text style={styles.emptyText}>No messages in this consultation.</Text>
          }
          ListFooterComponent={listFooter}
        />
      )}
    </ClientScreenShell>
  );
}

const styles = StyleSheet.create({
  messagesList: {flex: 1},
  centered: {flex: 1, justifyContent: 'center', alignItems: 'center'},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(244, 215, 139, 0.12)',
    backgroundColor: 'rgba(18, 26, 36, 0.5)',
  },
  backHit: {marginRight: 8},
  avatarPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(4, 7, 11, 0.6)',
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInitials: {color: T.gold[0], fontWeight: 'bold', fontSize: 16},
  headerInfo: {marginLeft: 12, flex: 1},
  headerName: {fontWeight: 'bold', fontSize: 16, color: T.text},
  headerStatus: {color: T.textSoft, fontSize: 11, fontWeight: '600', marginTop: 2},
  chatList: {padding: 16, paddingBottom: 24},
  summaryOnlyContent: {flexGrow: 1},
  encryptionBadge: {
    backgroundColor: 'rgba(59, 130, 246, 0.12)',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(96, 165, 250, 0.25)',
  },
  encryptionText: {color: '#93C5FD', fontSize: 12, textAlign: 'center'},
  readOnlyBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    padding: 12,
    borderRadius: 8,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.25)',
  },
  readOnlyText: {color: '#6EE7B7', fontSize: 12, textAlign: 'center', fontWeight: '600'},
  aiBubble: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    padding: 16,
    borderRadius: 16,
    borderBottomLeftRadius: 4,
    alignSelf: 'flex-start',
    maxWidth: '80%',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.1)',
  },
  userBubble: {
    backgroundColor: T.chatSentBubble,
    padding: 16,
    borderRadius: 16,
    borderBottomRightRadius: 4,
    alignSelf: 'flex-end',
    maxWidth: '80%',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(12, 15, 20, 0.12)',
  },
  messageText: {color: T.text, lineHeight: 20},
  userMessageText: {color: T.chatSentText, lineHeight: 20, fontWeight: '600'},
  timestamp: {fontSize: 10, color: T.textSoft, marginTop: 4},
  userTimestamp: {
    fontSize: 10,
    color: T.chatSentTimestamp,
    marginTop: 4,
    textAlign: 'right',
    fontWeight: '600',
  },
  emptyText: {color: T.textMuted, textAlign: 'center', marginTop: 24},
  clientSummaryCard: {
    marginBottom: 16,
    padding: 16,
    borderRadius: 16,
    backgroundColor: 'rgba(12, 19, 30, 0.95)',
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.22)',
  },
  clientSummaryTitle: {fontSize: 18, fontWeight: '900', color: T.text},
  clientBranchRow: {
    marginTop: 10,
    marginBottom: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(244, 215, 139, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.2)',
  },
  clientBranchLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: T.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  clientBranchValue: {fontSize: 15, fontWeight: '800', color: T.text},
  clientSummarySubtitle: {
    fontSize: 12,
    fontWeight: '700',
    color: T.gold[0],
    marginTop: 4,
    marginBottom: 12,
  },
  clientSummaryEmpty: {fontSize: 14, color: T.textSoft, lineHeight: 20},
  reviewCard: {
    marginTop: 8,
    padding: 16,
    borderRadius: 16,
    backgroundColor: 'rgba(12, 19, 30, 0.95)',
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.2)',
  },
  reviewTitle: {fontSize: 16, fontWeight: '900', color: T.text, marginBottom: 10},
  reviewLabel: {fontSize: 12, fontWeight: '700', color: T.textMuted, marginBottom: 6, marginTop: 4},
  branchScroll: {marginBottom: 8},
  branchChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.2)',
    marginRight: 8,
    backgroundColor: 'rgba(4, 7, 11, 0.45)',
  },
  branchChipActive: {backgroundColor: T.gold[1], borderColor: T.gold[1]},
  branchChipText: {color: T.textSoft, fontSize: 11, fontWeight: '700'},
  branchChipTextActive: {color: '#101B2C'},
  summaryInput: {
    minHeight: 100,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.2)',
    borderRadius: 12,
    padding: 12,
    color: T.text,
    textAlignVertical: 'top',
    backgroundColor: 'rgba(4, 7, 11, 0.45)',
  },
  saveBtn: {
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: T.gold[1],
    alignItems: 'center',
  },
  saveBtnDisabled: {opacity: 0.65},
  saveBtnText: {color: '#101B2C', fontWeight: '800'},
});
