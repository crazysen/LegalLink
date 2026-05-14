import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {REFERENCE_THEME as T} from '../constants/referenceTheme';
import {IS_IOS} from '../constants/platformUi';
import {ClientScreenShell} from '../components/ClientScreenShell';
import ClientChevronBack from '../components/ClientChevronBack';
import ChatMessageBody from '../components/ChatMessageBody';
import {getThreadMessages} from '../services/chatService';

export default function ConsultationTranscript({navigation, route}) {
  const insets = useSafeAreaInsets();
  const listRef = useRef(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);

  const title = route?.params?.title ?? 'Consultation';
  const initials = route?.params?.initials ?? '?';
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
      const {messages: rows} = await getThreadMessages(threadId);
      setMessages(Array.isArray(rows) ? rows : []);
    } catch {
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [threadId]);

  useEffect(() => {
    loadThread();
  }, [loadThread]);

  useEffect(() => {
    listRef.current?.scrollToEnd({animated: true});
  }, [messages.length]);

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

  return (
    <ClientScreenShell edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <ClientChevronBack
          style={styles.backHit}
          onPress={() => (navigation.canGoBack() ? navigation.goBack() : null)}
        />
        <View style={styles.avatarPlaceholder}>
          <Text style={styles.avatarInitials}>{initials}</Text>
        </View>
        <View style={styles.headerInfo}>
          <Text style={styles.headerName}>{title}</Text>
          <Text style={styles.headerStatus}>Transcript (read-only)</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={T.gold[1]} size="large" />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          style={styles.messagesList}
          data={messages}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          contentContainerStyle={[
            styles.chatList,
            {paddingBottom: Math.max(insets.bottom, 24) + 16},
          ]}
          keyboardDismissMode={IS_IOS ? 'interactive' : 'on-drag'}
          onContentSizeChange={() => listRef.current?.scrollToEnd({animated: true})}
          ListHeaderComponent={
            <>
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
  avatarInitials: {
    color: T.gold[0],
    fontWeight: 'bold',
    fontSize: 16,
  },
  headerInfo: {marginLeft: 12, flex: 1},
  headerName: {fontWeight: 'bold', fontSize: 16, color: T.text},
  headerStatus: {color: T.textSoft, fontSize: 11, fontWeight: '600', marginTop: 2},
  chatList: {padding: 16, paddingBottom: 24},
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
});
