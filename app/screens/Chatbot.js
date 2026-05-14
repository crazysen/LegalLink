import React, {useCallback, useMemo, useRef, useState} from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  KeyboardAvoidingView,
  ScrollView,
  Keyboard,
  ActivityIndicator,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {MaterialCommunityIcons} from '@expo/vector-icons';
import {REFERENCE_THEME as T} from '../constants/referenceTheme';
import {CHAT_INPUT_PADDING_VERTICAL, IS_IOS} from '../constants/platformUi';
import {ClientScreenShell} from '../components/ClientScreenShell';
import ClientChevronBack from '../components/ClientChevronBack';
import {useUserProfile} from '../context/UserProfileContext';
import {
  NOTARY_WEB_PAGES,
  webPageToScreenName,
} from '../constants/routeAlignment';
import {
  initialChatbotMessages,
  sendChatbotMessage,
} from '../services/chatbotApi';

export default function ChatbotScreen({navigation}) {
  const insets = useSafeAreaInsets();
  const listRef = useRef(null);
  const {profile} = useUserProfile();
  const [messages, setMessages] = useState(() =>
    initialChatbotMessages.map((m, index) => ({
      id: `init-${index}`,
      ...m,
    })),
  );
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [banner, setBanner] = useState('');

  const roleForNav = String(profile?.role || 'Client');

  const handleBack = useCallback(() => {
    if (navigation?.canGoBack?.()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('HomepageClient');
  }, [navigation]);

  const appendMessage = useCallback((text, from, actions = []) => {
    const id = `m-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    setMessages(prev => [
      ...prev,
      {
        id,
        text: text.trim(),
        from,
        actions,
      },
    ]);
    setTimeout(() => listRef.current?.scrollToEnd({animated: true}), 80);
  }, []);

  const resolveActionScreen = useCallback(
    webPage => {
      const page = String(webPage || '').trim();
      if (!page) return null;
      if (NOTARY_WEB_PAGES.has(page)) {
        if (page === 'notarial-request') {
          return 'ClientNotarial';
        }
        return null;
      }
      return webPageToScreenName(page, roleForNav);
    },
    [roleForNav],
  );

  const normalizeActions = useCallback(
    (actions = []) =>
      (Array.isArray(actions) ? actions : [])
        .map(action => ({
          label: String(action?.label || 'Open').trim(),
          page: String(action?.page || '').trim(),
          params: action?.params,
        }))
        .filter(action => Boolean(action.page) && Boolean(resolveActionScreen(action.page))),
    [resolveActionScreen],
  );

  const handleActionPress = useCallback(
    action => {
      const screen = resolveActionScreen(action?.page);
      if (screen) {
        navigation.navigate(screen, action?.params || {});
      }
    },
    [navigation, resolveActionScreen],
  );

  const initialActionRow = useMemo(
    () => normalizeActions(initialChatbotMessages?.[0]?.actions),
    [normalizeActions],
  );

  const handleSendMessage = useCallback(async () => {
    const t = inputText.trim();
    if (!t || sending) {
      return;
    }

    Keyboard.dismiss();
    appendMessage(t, 'user');
    setInputText('');
    setSending(true);
    setBanner('');

    try {
      const response = await sendChatbotMessage({
        message: t,
        profile,
        conversation: messages,
      });

      const reply = String(response?.reply || '').trim();
      if (reply) {
        appendMessage(reply, 'ai', normalizeActions(response?.actions));
      } else {
        appendMessage(
          'I could not read a reply from the assistant. Please try again.',
          'ai',
          initialActionRow,
        );
      }
    } catch (e) {
      setBanner(String(e?.message || 'Request failed.'));
      appendMessage(
        'The assistant is unavailable right now. Please sign in again or try again in a moment.',
        'ai',
        initialActionRow,
      );
    } finally {
      setSending(false);
    }
  }, [
    appendMessage,
    initialActionRow,
    inputText,
    messages,
    normalizeActions,
    profile,
    sending,
  ]);

  const handleQuickReply = useCallback(
    title => {
      setInputText(title);
    },
    [],
  );

  const renderMessage = useCallback(
    ({item}) => (
      <View
        style={[styles.messageRow, item.from === 'user' ? styles.userRow : styles.aiRow]}>
        {item.from === 'ai' ? (
          <View style={styles.aiAvatarSmall}>
            <MaterialCommunityIcons name="robot-outline" size={18} color={T.gold[0]} />
          </View>
        ) : null}
        <View style={styles.messageBody}>
          <View style={[styles.bubble, item.from === 'user' ? styles.userBubble : styles.aiBubble]}>
            <Text style={[styles.messageText, item.from === 'ai' ? styles.aiText : styles.userText]}>
              {item.text}
            </Text>
          </View>
          {item.from === 'ai' && Array.isArray(item.actions) && item.actions.length > 0 ? (
            <View style={styles.inlineActions}>
              {item.actions.map((action, actionIndex) => (
                <TouchableOpacity
                  key={`${action.page}-${actionIndex}`}
                  style={styles.actionChip}
                  activeOpacity={0.85}
                  onPress={() => handleActionPress(action)}>
                  <Text style={styles.actionChipText}>{action.label || 'Open'}</Text>
                  <MaterialCommunityIcons name="chevron-right" size={16} color={T.gold[0]} />
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
        </View>
      </View>
    ),
    [handleActionPress],
  );

  const QuickReply = ({title}) => (
    <TouchableOpacity style={styles.chip} onPress={() => handleQuickReply(title)} activeOpacity={0.7}>
      <Text style={styles.chipText}>{title}</Text>
    </TouchableOpacity>
  );

  return (
    <ClientScreenShell edges={['top', 'left', 'right']}>
      <View style={styles.fill}>
        <View style={styles.header}>
          <ClientChevronBack style={styles.backHit} onPress={handleBack} />
          <View style={styles.aiAvatarHeader}>
            <MaterialCommunityIcons name="robot-outline" size={22} color={T.gold[0]} />
          </View>
          <View style={styles.headerTitleContainer}>
            <Text style={styles.headerTitle}>BatasMo Informational AI Assistant</Text>
            <View style={styles.statusContainer}>
              <View style={styles.statusDot} />
              <Text style={styles.statusText}>
                {profile?.email ? 'SECURE SESSION' : 'SIGN IN REQUIRED'}
              </Text>
            </View>
          </View>
        </View>

        {banner ? (
          <Text style={styles.banner} numberOfLines={3}>
            {banner}
          </Text>
        ) : null}

        <KeyboardAvoidingView
          style={styles.fill}
          behavior={IS_IOS ? 'padding' : undefined}
          keyboardVerticalOffset={IS_IOS ? 0 : 0}>
          <View style={styles.fill}>
            <FlatList
              ref={listRef}
              style={styles.messagesList}
              data={messages}
              renderItem={renderMessage}
              keyExtractor={item => item.id}
              contentContainerStyle={styles.chatList}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={IS_IOS ? 'interactive' : 'on-drag'}
              onContentSizeChange={() => listRef.current?.scrollToEnd({animated: false})}
              ListHeaderComponent={
                <View>
                  <View style={styles.encryptionNote}>
                    <Text style={styles.encryptionText}>
                      This assistant uses your signed-in Supabase session and is informational only, not legal advice.
                    </Text>
                  </View>
                  <View style={styles.disclaimerNote}>
                    <Text style={styles.disclaimerText}>
                      Ask for legal-service guidance, appointment help, and account navigation. For formal legal advice,
                      consult your attorney.
                    </Text>
                  </View>
                </View>
              }
            />

            <View style={[styles.footer, {paddingBottom: Math.max(insets.bottom, 12)}]}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.quickReplies}>
                <QuickReply title="Track my request" />
                <QuickReply title="Find a lawyer" />
                <QuickReply title="Book consultation" />
              </ScrollView>

              <View style={styles.inputContainer}>
                <TextInput
                  style={styles.input}
                  placeholder="Ask me anything..."
                  placeholderTextColor={T.textSoft}
                  value={inputText}
                  onChangeText={setInputText}
                  onSubmitEditing={handleSendMessage}
                  returnKeyType="send"
                  editable={!sending}
                />
                <TouchableOpacity
                  style={[styles.sendButton, (!inputText.trim() || sending) && styles.sendButtonDisabled]}
                  onPress={handleSendMessage}
                  activeOpacity={0.85}
                  disabled={!inputText.trim() || sending}>
                  {sending ? (
                    <ActivityIndicator color={T.base} size="small" />
                  ) : (
                    <MaterialCommunityIcons name="send" size={22} color={T.base} />
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </ClientScreenShell>
  );
}

const styles = StyleSheet.create({
  fill: {flex: 1},
  messagesList: {flex: 1},
  banner: {
    color: '#fbbf24',
    paddingHorizontal: 16,
    paddingVertical: 8,
    fontSize: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(244, 215, 139, 0.12)',
    backgroundColor: 'rgba(18, 26, 36, 0.55)',
  },
  backHit: {marginRight: 8},
  aiAvatarHeader: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(4, 7, 11, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.2)',
  },
  headerTitleContainer: {marginLeft: 12, flex: 1},
  headerTitle: {color: T.text, fontSize: 17, fontWeight: '700'},
  statusContainer: {flexDirection: 'row', alignItems: 'center', marginTop: 2},
  statusDot: {width: 8, height: 8, borderRadius: 4, backgroundColor: '#22C55E', marginRight: 6},
  statusText: {color: T.textSoft, fontSize: 10, fontWeight: '800'},

  encryptionNote: {
    alignSelf: 'center',
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(96, 165, 250, 0.25)',
  },
  encryptionText: {color: '#93C5FD', fontSize: 12, textAlign: 'center'},
  disclaimerNote: {
    alignSelf: 'center',
    backgroundColor: 'rgba(244, 215, 139, 0.08)',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.18)',
  },
  disclaimerText: {color: T.textMuted, fontSize: 12, textAlign: 'center', lineHeight: 18},

  chatList: {paddingHorizontal: 16, paddingBottom: 16, flexGrow: 1},
  messageRow: {flexDirection: 'row', marginBottom: 14, alignItems: 'flex-end'},
  userRow: {justifyContent: 'flex-end'},
  aiRow: {justifyContent: 'flex-start'},
  messageBody: {flexShrink: 1},
  aiAvatarSmall: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(18, 26, 36, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.15)',
  },
  bubble: {maxWidth: '82%', paddingVertical: 12, paddingHorizontal: 14, borderRadius: 18},
  aiBubble: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.12)',
  },
  userBubble: {
    backgroundColor: 'rgba(244, 215, 139, 0.2)',
    borderBottomRightRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.22)',
  },
  messageText: {fontSize: 15, lineHeight: 22},
  aiText: {color: T.text},
  userText: {color: T.base},
  inlineActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
  },

  footer: {
    paddingTop: 12,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(244, 215, 139, 0.12)',
    backgroundColor: 'rgba(4, 7, 11, 0.45)',
  },
  quickReplies: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 12,
  },
  chip: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.18)',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 20,
    marginRight: 8,
  },
  chipText: {color: T.textMuted, fontSize: 13, fontWeight: '500'},
  inputContainer: {flexDirection: 'row', alignItems: 'center'},
  input: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    minHeight: 48,
    maxHeight: 120,
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingVertical: CHAT_INPUT_PADDING_VERTICAL,
    color: T.text,
    fontSize: 16,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.12)',
  },
  sendButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: T.gold[1],
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 10,
  },
  sendButtonDisabled: {
    backgroundColor: 'rgba(148, 163, 184, 0.35)',
  },
  actionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(245,166,35,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.35)',
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginRight: 8,
    marginBottom: 8,
  },
  actionChipText: {
    color: T.gold[0],
    fontSize: 13,
    fontWeight: '700',
    marginRight: 4,
  },
});
