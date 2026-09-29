import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ClientScreenShell, ClientFadeIn} from '../components/ClientScreenShell';
import ClientChevronBack from '../components/ClientChevronBack';
import {REFERENCE_THEME as T} from '../constants/referenceTheme';
import {
  fetchClientSupportThread,
  getCurrentSessionProfile,
  markClientSupportMessagesAsRead,
  sendClientSupportMessage,
  subscribeToClientSupport,
} from '../services/userApi';

const NAVY = '#152238';
const CREAM = '#faf8f4';
const CREAM_BORDER = '#ece6de';

function formatTimeLabel(value) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const now = new Date();
  const sameDay =
    parsed.getFullYear() === now.getFullYear() &&
    parsed.getMonth() === now.getMonth() &&
    parsed.getDate() === now.getDate();
  if (sameDay) {
    return parsed.toLocaleTimeString('en-PH', {hour: 'numeric', minute: '2-digit'});
  }
  return parsed.toLocaleString('en-PH', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function ClientSupportMessages({navigation, route}) {
  const insets = useSafeAreaInsets();
  const initialDraft = route?.params?.initialDraft || route?.params?.draft || '';
  const [clientId, setClientId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [bootLoading, setBootLoading] = useState(true);
  const listRef = useRef(null);
  const composerRef = useRef(null);
  const consumedDraftRef = useRef(false);

  const refreshAndMarkRead = useCallback(async () => {
    if (!clientId) return;
    try {
      const rows = await fetchClientSupportThread(clientId);
      setMessages(rows);
      setLoadError('');
      await markClientSupportMessagesAsRead(clientId);
    } catch (error) {
      setLoadError(error?.message || 'Unable to load messages.');
    }
  }, [clientId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const {profile} = await getCurrentSessionProfile();
        if (cancelled) return;
        setClientId(profile?.id || null);
        if (!profile?.id) {
          setLoadError('Sign in to message LegalLink Admin.');
        }
      } finally {
        if (!cancelled) setBootLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (consumedDraftRef.current) return;
    if (!initialDraft) return;
    consumedDraftRef.current = true;
    setDraft(prev => (prev && prev.trim().length > 0 ? prev : initialDraft));
    requestAnimationFrame(() => {
      composerRef.current?.focus?.();
    });
  }, [initialDraft]);

  useEffect(() => {
    let cancelled = false;
    refreshAndMarkRead();
    const unsubscribe = subscribeToClientSupport(clientId, () => {
      if (!cancelled) refreshAndMarkRead();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [clientId, refreshAndMarkRead]);

  const conversation = useMemo(
    () =>
      [...messages].sort((a, b) =>
        String(a.createdAt || '').localeCompare(String(b.createdAt || '')),
      ),
    [messages],
  );

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({animated: true});
    });
  }, []);

  useEffect(() => {
    if (conversation.length) scrollToEnd();
  }, [conversation.length, scrollToEnd]);

  const handleSend = async () => {
    const text = draft.trim();
    if (!text || sending || !clientId) return;
    try {
      setSending(true);
      const newMsg = await sendClientSupportMessage({clientId, message: text});
      setMessages(previous => {
        if (previous.some(m => m.id === newMsg.id)) return previous;
        return [...previous, newMsg];
      });
      setDraft('');
    } catch (error) {
      setLoadError(error?.message || 'Failed to send message.');
    } finally {
      setSending(false);
    }
  };

  const renderBubble = ({item}) => {
    const mine = item.senderRole === 'client';
    return (
      <View
        style={[
          styles.bubbleWrap,
          mine ? styles.bubbleWrapMine : styles.bubbleWrapTheirs,
        ]}>
        <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
          <Text style={[styles.bubbleText, mine ? styles.bubbleTextMine : styles.bubbleTextTheirs]}>
            {item.message}
          </Text>
          <Text style={[styles.bubbleMeta, mine ? styles.bubbleMetaMine : styles.bubbleMetaTheirs]}>
            {formatTimeLabel(item.createdAt)}
          </Text>
        </View>
      </View>
    );
  };

  if (bootLoading) {
    return (
      <ClientScreenShell>
        <View style={styles.centered}>
          <ActivityIndicator color={T.gold[1]} />
        </View>
      </ClientScreenShell>
    );
  }

  return (
    <ClientScreenShell edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}>
        <ClientFadeIn style={styles.flex}>
          <View style={styles.topBar}>
            <ClientChevronBack
              style={styles.backHit}
              onPress={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('HomepageClient'))}
            />
            <Text style={styles.screenTitle}>Messages</Text>
            <Text style={styles.screenSubtitle}>Message LegalLink Admin for help or follow-ups.</Text>
          </View>

          <View style={styles.card}>
            <View style={styles.chatHead}>
              <View style={styles.headAvatar}>
                <Image
                  source={require('../assets/images/logo.jpg')}
                  style={styles.headAvatarImage}
                  resizeMode="cover"
                  accessibilityLabel="LegalLink Admin"
                />
              </View>
              <View style={styles.headTextCol}>
                <Text style={styles.headTitle}>LegalLink Admin</Text>
                <Text style={styles.headSub}>
                  Reach out for booking help, payment concerns, or any follow-ups.
                </Text>
              </View>
            </View>

            {loadError ? (
              <View style={styles.errorBanner}>
                <Text style={styles.errorText}>{loadError}</Text>
              </View>
            ) : null}

            <FlatList
              ref={listRef}
              style={styles.thread}
              data={conversation}
              keyExtractor={item => String(item.id)}
              renderItem={renderBubble}
              onContentSizeChange={scrollToEnd}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Text style={styles.emptyTitle}>Start a conversation</Text>
                  <Text style={styles.emptyBody}>
                    Send a message to LegalLink Admin and we&apos;ll get back to you here.
                  </Text>
                </View>
              }
            />

            <View style={[styles.composer, {paddingBottom: Math.max(insets.bottom, 10)}]}>
              <TextInput
                ref={composerRef}
                style={styles.input}
                value={draft}
                onChangeText={setDraft}
                placeholder="Type your message to LegalLink Admin..."
                placeholderTextColor="rgba(21, 34, 56, 0.45)"
                editable={!sending && Boolean(clientId)}
                maxLength={2000}
                multiline
              />
              <TouchableOpacity
                style={[styles.sendBtn, (!draft.trim() || sending || !clientId) && styles.sendBtnDisabled]}
                onPress={handleSend}
                disabled={!draft.trim() || sending || !clientId}
                activeOpacity={0.85}>
                <Text style={styles.sendBtnLabel}>{sending ? 'Sending…' : 'Send'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ClientFadeIn>
      </KeyboardAvoidingView>
    </ClientScreenShell>
  );
}

const styles = StyleSheet.create({
  flex: {flex: 1},
  centered: {flex: 1, justifyContent: 'center', alignItems: 'center'},
  topBar: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 12,
  },
  backHit: {
    marginBottom: 8,
    alignSelf: 'flex-start',
  },
  screenTitle: {
    color: T.text,
    fontSize: 22,
    fontWeight: '800',
  },
  screenSubtitle: {
    color: T.textSoft,
    fontSize: 13,
    marginTop: 4,
    lineHeight: 18,
  },
  card: {
    flex: 1,
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(214, 193, 160, 0.32)',
    backgroundColor: '#fff',
    overflow: 'hidden',
  },
  chatHead: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: NAVY,
  },
  headAvatar: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: NAVY,
    overflow: 'hidden',
    marginRight: 12,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.35)',
  },
  headAvatarImage: {
    width: '100%',
    height: '100%',
  },
  headTextCol: {flex: 1},
  headTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  headSub: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
    marginTop: 2,
    lineHeight: 16,
  },
  errorBanner: {
    backgroundColor: '#fee2e2',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#fecaca',
  },
  errorText: {
    color: '#991b1b',
    fontSize: 13,
  },
  thread: {
    flex: 1,
    backgroundColor: CREAM,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  empty: {
    paddingVertical: 48,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  emptyTitle: {
    color: NAVY,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
  },
  emptyBody: {
    color: '#6b7280',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  bubbleWrap: {
    marginBottom: 10,
    maxWidth: '88%',
  },
  bubbleWrapMine: {
    alignSelf: 'flex-end',
  },
  bubbleWrapTheirs: {
    alignSelf: 'flex-start',
  },
  bubble: {
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  bubbleMine: {
    backgroundColor: NAVY,
    borderBottomRightRadius: 4,
  },
  bubbleTheirs: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: CREAM_BORDER,
    borderBottomLeftRadius: 4,
  },
  bubbleText: {
    fontSize: 14,
    lineHeight: 20,
  },
  bubbleTextMine: {color: '#fff'},
  bubbleTextTheirs: {color: '#0b0f19'},
  bubbleMeta: {
    fontSize: 10,
    marginTop: 4,
  },
  bubbleMetaMine: {
    color: 'rgba(255,255,255,0.72)',
    textAlign: 'right',
  },
  bubbleMetaTheirs: {
    color: 'rgba(11, 15, 25, 0.55)',
    textAlign: 'right',
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: CREAM_BORDER,
    backgroundColor: '#fff',
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: '#d6c1a0',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: NAVY,
    backgroundColor: CREAM,
  },
  sendBtn: {
    backgroundColor: NAVY,
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
    marginBottom: 2,
    marginLeft: 10,
  },
  sendBtnDisabled: {
    opacity: 0.5,
  },
  sendBtnLabel: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
});
