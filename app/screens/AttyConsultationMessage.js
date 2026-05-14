import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  FlatList,
  Alert,
  ActivityIndicator,
  Keyboard,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {MaterialCommunityIcons} from '@expo/vector-icons';
import {ClientScreenShell} from '../components/ClientScreenShell';
import {REFERENCE_THEME as T} from '../constants/referenceTheme';
import {IS_IOS} from '../constants/platformUi';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import ChatMessageBody from '../components/ChatMessageBody';
import {
  appendThreadAttachment,
  appendThreadMessage,
  attachThreadRealtime,
  getThreadMessages,
} from '../services/chatService';
import {closeConsultationRoom} from '../services/messageService';
import {getAppointmentConsultationMeta} from '../services/appointmentService';
import {
  getConsultationSessionBounds,
  getConsultationTimerDisplay,
} from '../services/consultationSession';
import {
  scheduleConsultationSessionNotifications,
  cancelConsultationSessionNotifications,
} from '../services/consultationSessionNotifications';
import {ConsultationSessionAlerts} from '../components/ConsultationSessionBar';
import {getOrCreateVideoMeeting} from '../services/videoMeetingService';

const ArrowLeft = props => <MaterialCommunityIcons name="arrow-left" {...props} />;
const Paperclip = props => <MaterialCommunityIcons name="paperclip" {...props} />;
const Send = props => <MaterialCommunityIcons name="send" {...props} />;
const ShieldCheck = props => <MaterialCommunityIcons name="shield-check" {...props} />;
const VideoIcon = props => <MaterialCommunityIcons name="video" {...props} />;

const MessageBubble = ({item}) => {
  const isMe = item.sender === 'me';

  return (
    <View style={[styles.messageContainer, isMe ? styles.myContainer : styles.clientContainer]}>
      <View style={[styles.bubble, isMe ? styles.myBubble : styles.clientBubble]}>
        <ChatMessageBody
          item={item}
          textStyle={[styles.messageText, isMe ? styles.myText : styles.clientText]}
        />
      </View>
      <Text style={[isMe ? styles.myTimeText : styles.timeText, {textAlign: isMe ? 'right' : 'left'}]}>
        {item.time}
      </Text>
    </View>
  );
};

export default function ConsultationChat({navigation, route}) {
  const insets = useSafeAreaInsets();
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const [isClosed, setIsClosed] = useState(false);
  const [sending, setSending] = useState(false);
  const [videoBusy, setVideoBusy] = useState(false);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [sessionBounds, setSessionBounds] = useState(null);
  const listRef = useRef(null);
  const notifIdsRef = useRef([]);
  const prevTimerPhaseRef = useRef(null);
  const clientName = route?.params?.clientName || 'Sarah Jenkins';
  const clientInitials = route?.params?.clientInitials || 'SJ';
  const threadId = useMemo(
    () => String(route?.params?.chatId || route?.params?.clientName || 'general-chat'),
    [route?.params?.chatId, route?.params?.clientName],
  );

  const loadThread = useCallback(async () => {
    try {
      const {messages: rows, isClosed: closed} = await getThreadMessages(threadId);
      setMessages(rows);
      setIsClosed(closed);
    } catch {
      setMessages([]);
      setIsClosed(false);
    }
  }, [threadId]);

  useEffect(() => {
    loadThread();
  }, [loadThread]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const meta = await getAppointmentConsultationMeta(threadId);
        if (cancelled) {
          return;
        }
        const b = getConsultationSessionBounds(
          meta.scheduled_at,
          meta.duration_minutes,
        );
        setSessionBounds(b);
      } catch {
        if (!cancelled) {
          setSessionBounds(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  useEffect(() => {
    prevTimerPhaseRef.current = null;
  }, [threadId]);

  useEffect(() => {
    if (isClosed) {
      return;
    }
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [isClosed]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!sessionBounds || isClosed) {
        await cancelConsultationSessionNotifications(notifIdsRef.current);
        notifIdsRef.current = [];
        return;
      }
      const prev = notifIdsRef.current.slice();
      const ids = await scheduleConsultationSessionNotifications(threadId, sessionBounds, prev);
      if (!cancelled) {
        notifIdsRef.current = ids;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionBounds, isClosed, threadId]);

  useEffect(() => {
    return () => {
      cancelConsultationSessionNotifications(notifIdsRef.current);
      notifIdsRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (!sessionBounds || isClosed) {
      return;
    }
    const {phase} = getConsultationTimerDisplay(nowMs, sessionBounds);
    const prev = prevTimerPhaseRef.current;
    if (prev !== 'in_grace' && phase === 'in_grace') {
      Alert.alert(
        'Scheduled hour complete',
        'The 15-minute grace period has started. End the consultation when you are finished.',
      );
    } else if (prev !== 'after_grace' && phase === 'after_grace') {
      Alert.alert(
        'Grace period ended',
        'Please end the consultation when ready. The chat stays open until you tap End Consultation.',
      );
    }
    prevTimerPhaseRef.current = phase;
  }, [nowMs, sessionBounds, isClosed]);

  useEffect(() => {
    let unsubscribe = () => {};
    let cancelled = false;
    (async () => {
      try {
        const unsub = await attachThreadRealtime(threadId, setMessages, setIsClosed);
        if (!cancelled) {
          unsubscribe = unsub;
        }
      } catch {
        // no room
      }
    })();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [threadId]);

  useEffect(() => {
    listRef.current?.scrollToEnd({animated: true});
  }, [messages.length]);

  useEffect(() => {
    const showEvt = IS_IOS ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = IS_IOS ? 'keyboardWillHide' : 'keyboardDidHide';

    const onShow = e => {
      const h = e?.endCoordinates?.height ?? 0;
      setKeyboardInset(h);
      requestAnimationFrame(() => listRef.current?.scrollToEnd({animated: true}));
    };
    const onHide = () => setKeyboardInset(0);

    const subShow = Keyboard.addListener(showEvt, onShow);
    const subHide = Keyboard.addListener(hideEvt, onHide);
    return () => {
      subShow.remove();
      subHide.remove();
    };
  }, []);

  const handleStartVideoCall = async () => {
    if (!threadId || isClosed || videoBusy) {
      return;
    }
    try {
      setVideoBusy(true);
      const {meetingId, roomId, token} = await getOrCreateVideoMeeting(threadId);
      navigation.navigate('ConsultationVideoCall', {
        meetingId,
        token,
        consultationRoomId: roomId,
        participantName: clientName || 'Attorney',
      });
    } catch (e) {
      Alert.alert('Video call', e?.message ?? 'Could not start video.');
    } finally {
      setVideoBusy(false);
    }
  };

  const handleEndConsultation = () => {
    Alert.alert(
      'End consultation',
      'Clients will no longer be able to send messages. You can still read the thread.',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'End',
          style: 'destructive',
          onPress: async () => {
            try {
              await cancelConsultationSessionNotifications(notifIdsRef.current);
              notifIdsRef.current = [];
              await closeConsultationRoom(threadId);
              setIsClosed(true);
              const next = await getThreadMessages(threadId);
              setMessages(next.messages);
              setIsClosed(next.isClosed);
            } catch (e) {
              Alert.alert('Error', e?.message ?? 'Could not end consultation.');
            }
          },
        },
      ],
    );
  };

  const handleSend = async () => {
    if (!message.trim() || sending || isClosed) {
      return;
    }
    try {
      setSending(true);
      const {messages: next, isClosed: closed} = await appendThreadMessage(threadId, {
        text: message,
        sender: 'me',
      });
      setMessages(next);
      setIsClosed(closed);
      setMessage('');
    } catch (e) {
      Alert.alert('Error', e?.message ?? 'Could not send.');
    } finally {
      setSending(false);
    }
  };

  const handleAttachMenu = () => {
    if (isClosed) {
      return;
    }
    Alert.alert('Attach', 'Choose a source', [
      {text: 'Photo library', onPress: () => pickImage()},
      {text: 'File', onPress: () => pickFile()},
      {text: 'Cancel', style: 'cancel'},
    ]);
  };

  const pickImage = async () => {
    if (isClosed || sending) {
      return;
    }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
    });
    if (result.canceled || !result.assets?.[0]) {
      return;
    }
    const asset = result.assets[0];
    try {
      setSending(true);
      const {messages: next, isClosed: closed} = await appendThreadAttachment(threadId, {
        uri: asset.uri,
        fileName: asset.fileName || 'photo.jpg',
        mime: asset.mimeType || 'image/jpeg',
        size: asset.fileSize ?? 0,
        caption: message.trim() || undefined,
      });
      setMessages(next);
      setIsClosed(closed);
      setMessage('');
    } catch (e) {
      Alert.alert('Error', e?.message ?? 'Upload failed.');
    } finally {
      setSending(false);
    }
  };

  const pickFile = async () => {
    if (isClosed || sending) {
      return;
    }
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      type: '*/*',
    });
    if (result.canceled) {
      return;
    }
    const asset =
      result.assets?.[0] ??
      (result.uri
        ? {
            uri: result.uri,
            name: result.name,
            mimeType: result.mimeType,
            size: result.size,
          }
        : null);
    if (!asset?.uri) {
      return;
    }
    try {
      setSending(true);
      const {messages: next, isClosed: closed} = await appendThreadAttachment(threadId, {
        uri: asset.uri,
        fileName: asset.name || 'file',
        mime: asset.mimeType || 'application/octet-stream',
        size: asset.size ?? 0,
        caption: message.trim() || undefined,
      });
      setMessages(next);
      setIsClosed(closed);
      setMessage('');
    } catch (e) {
      Alert.alert('Error', e?.message ?? 'Upload failed.');
    } finally {
      setSending(false);
    }
  };

  return (
    <ClientScreenShell edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => (navigation.canGoBack() ? navigation.goBack() : null)}>
            <ArrowLeft size={24} color={T.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>
            Consultation
          </Text>
          {!isClosed ? (
            <View style={styles.headerActions}>
              <TouchableOpacity
                style={styles.headerVideoBtn}
                onPress={handleStartVideoCall}
                disabled={videoBusy}
                accessibilityLabel="Start or join video call">
                {videoBusy ? (
                  <ActivityIndicator size="small" color={T.gold[1]} />
                ) : (
                  <VideoIcon size={24} color={T.gold[1]} />
                )}
              </TouchableOpacity>
              <TouchableOpacity style={styles.endConsultationBtn} onPress={handleEndConsultation}>
                <Text style={styles.endConsultationBtnText}>End</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.headerEndSpacer} />
          )}
        </View>

        <View style={styles.clientBar}>
          <View style={styles.avatarContainer}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{clientInitials}</Text>
            </View>
            <View style={styles.onlineStatus} />
          </View>
          <Text style={styles.clientName}>{clientName}</Text>
        </View>

        <View style={styles.keyboardAvoid}>
          <FlatList
            ref={listRef}
            style={styles.messagesList}
            data={messages}
            keyExtractor={item => item.id}
            renderItem={({item}) => <MessageBubble item={item} />}
            contentContainerStyle={styles.chatList}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={IS_IOS ? 'interactive' : 'on-drag'}
            onContentSizeChange={() => listRef.current?.scrollToEnd({animated: true})}
            ListHeaderComponent={
              <>
                <View style={styles.encryptedBadge}>
                  <ShieldCheck size={14} color={T.gold[1]} />
                  <Text style={styles.encryptedText}>END-TO-END ENCRYPTED SECURE CHANNEL</Text>
                </View>
                <ConsultationSessionAlerts
                  bounds={sessionBounds}
                  nowMs={nowMs}
                  isClosed={isClosed}
                />
                {isClosed && (
                  <View style={styles.closedBanner}>
                    <Text style={styles.closedBannerText}>
                      Consultation Ended — messaging is disabled; you can read the thread below.
                    </Text>
                  </View>
                )}
              </>
            }
          />

          <View
            style={[
              styles.inputWrapper,
              {
                paddingBottom:
                  keyboardInset > 0
                    ? keyboardInset + 8
                    : Math.max(insets.bottom, 16),
              },
            ]}>
            <View style={styles.inputContainer}>
              {!isClosed && (
                <TouchableOpacity style={styles.attachmentBtn} onPress={handleAttachMenu}>
                  <Paperclip size={20} color={T.textMuted} />
                </TouchableOpacity>
              )}
              <TextInput
                style={[styles.input, isClosed && styles.inputDisabled]}
                value={message}
                onChangeText={setMessage}
                placeholder={isClosed ? 'Consultation ended' : 'Type your message...'}
                placeholderTextColor={T.textSoft}
                multiline
                maxHeight={100}
                editable={!isClosed}
              />
              {sending ? (
                <ActivityIndicator style={{marginRight: 8}} />
              ) : (
                <TouchableOpacity
                  style={[styles.sendBtn, (isClosed || !message.trim()) && styles.sendBtnDisabled]}
                  onPress={handleSend}
                  disabled={isClosed || !message.trim()}>
                  <Send size={20} color="#101B2C" />
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
    </ClientScreenShell>
  );
}

const styles = StyleSheet.create({
  keyboardAvoid: {flex: 1},
  messagesList: {flex: 1},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(244, 215, 139, 0.1)',
    justifyContent: 'space-between',
  },
  headerTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 18,
    fontWeight: '900',
    color: T.text,
    marginLeft: 8,
  },
  headerActions: {flexDirection: 'row', alignItems: 'center'},
  headerVideoBtn: {
    padding: 8,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 40,
    marginRight: 4,
  },
  endConsultationBtn: {
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  endConsultationBtnText: {
    fontSize: 11,
    fontWeight: '800',
    color: T.gold[1],
  },
  headerEndSpacer: {width: 1},
  closedBanner: {
    backgroundColor: 'rgba(194, 65, 12, 0.2)',
    padding: 12,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(251, 191, 36, 0.35)',
  },
  closedBannerText: {
    color: T.gold[0],
    fontSize: 12,
    textAlign: 'center',
    fontWeight: '700',
  },
  clientBar: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(244, 215, 139, 0.08)',
  },
  avatarContainer: {position: 'relative'},
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(215, 177, 74, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.25)',
  },
  avatarText: {color: T.gold[1], fontWeight: '800', fontSize: 16},
  onlineStatus: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#22C55E',
    borderWidth: 1.5,
    borderColor: T.base,
  },
  clientName: {marginLeft: 12, fontSize: 16, fontWeight: '800', color: T.text},
  encryptedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: 'rgba(12, 19, 30, 0.85)',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    marginVertical: 20,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.2)',
  },
  encryptedText: {
    fontSize: 10,
    color: T.textMuted,
    fontWeight: '800',
    marginLeft: 6,
    letterSpacing: 0.5,
  },
  chatList: {paddingHorizontal: 16, paddingBottom: 20},
  messageContainer: {marginBottom: 16, maxWidth: '85%'},
  clientContainer: {alignSelf: 'flex-start'},
  myContainer: {alignSelf: 'flex-end'},
  bubble: {
    padding: 14,
    borderRadius: 15,
    marginBottom: 4,
  },
  clientBubble: {
    backgroundColor: 'rgba(18, 26, 36, 0.95)',
    borderTopLeftRadius: 2,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.12)',
  },
  myBubble: {
    backgroundColor: T.chatSentBubble,
    borderBottomRightRadius: 2,
    borderWidth: 1,
    borderColor: 'rgba(12, 15, 20, 0.15)',
  },
  messageText: {fontSize: 15, lineHeight: 22},
  clientText: {color: T.text},
  myText: {color: T.chatSentText, fontWeight: '600'},
  timeText: {fontSize: 11, color: T.textSoft, marginTop: 2},
  myTimeText: {fontSize: 11, color: T.chatSentTimestamp, marginTop: 2, fontWeight: '600'},
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 16,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(4, 7, 11, 0.92)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(244, 215, 139, 0.12)',
  },
  inputContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(18, 26, 36, 0.85)',
    borderRadius: 25,
    paddingHorizontal: 12,
    marginRight: 10,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.15)',
  },
  input: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    fontSize: 15,
    color: T.text,
    maxHeight: 100,
  },
  inputDisabled: {
    color: T.textSoft,
    backgroundColor: 'transparent',
  },
  attachmentBtn: {padding: 4},
  sendBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: T.gold[1],
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendBtnDisabled: {
    backgroundColor: 'rgba(148, 163, 184, 0.5)',
  },
  backButton: {padding: 4},
});
