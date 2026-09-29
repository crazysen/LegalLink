import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  ScrollView,
  Alert,
  ActivityIndicator,
  Keyboard,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {MaterialCommunityIcons} from '@expo/vector-icons';
import {REFERENCE_THEME as T} from '../constants/referenceTheme';
import {IS_IOS} from '../constants/platformUi';
import {ClientScreenShell} from '../components/ClientScreenShell';
import ClientChevronBack from '../components/ClientChevronBack';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import ChatMessageBody from '../components/ChatMessageBody';
import {
  appendThreadAttachment,
  appendThreadMessage,
  attachThreadRealtime,
  getThreadMessages,
} from '../services/chatService';
import {
  CHAT_DOCUMENT_PICKER_TYPES,
  isBlockedChatAttachment,
} from '../services/chatTypes';
import {getAppointmentConsultationMeta, getMyAppointments} from '../services/appointmentService';
import {
  getConsultationSessionBounds,
  getConsultationTimerDisplay,
} from '../services/consultationSession';
import {
  scheduleConsultationSessionNotifications,
  cancelConsultationSessionNotifications,
} from '../services/consultationSessionNotifications';
import {ConsultationSessionAlerts} from '../components/ConsultationSessionBar';
import {
  getOrCreateVideoMeeting,
  getVideoSdkToken,
} from '../services/videoMeetingService';
import {ensureAppConfigLoaded, getCurrentSessionProfile} from '../services/userApi';
import {useUserProfile} from '../context/UserProfileContext';
import {
  attachConsultationChatPresence,
  dismissConsultationPeerEntry,
} from '../services/consultationChatPresence';
import ConsultationWaitingPopup from '../components/ConsultationWaitingPopup';
import {useNotifications} from '../context/NotificationContext';

const ConsultationChat = ({navigation, route}) => {
  const insets = useSafeAreaInsets();
  const [messageText, setMessageText] = useState('');
  const [messages, setMessages] = useState([]);
  const [isClosed, setIsClosed] = useState(null);
  const [sending, setSending] = useState(false);
  const [videoBusy, setVideoBusy] = useState(false);
  const [incomingMeetingId, setIncomingMeetingId] = useState(null);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [sessionBounds, setSessionBounds] = useState(null);
  const [waitingPopup, setWaitingPopup] = useState(null);
  const [timeWarningPopup, setTimeWarningPopup] = useState(null);
  const {notifications} = useNotifications();
  const shownTimeWarningIdsRef = useRef(new Set());
  const tenMinuteWarningSentRef = useRef(false);
  const listRef = useRef(null);
  const notifIdsRef = useRef([]);
  const prevTimerPhaseRef = useRef(null);
  const isFocusedRef = useRef(false);
  const startedMeetingIdRef = useRef(null);
  const autoOpenedMeetingIdRef = useRef(null);
  const sessionWasActiveRef = useRef(false);
  const prevIsClosedRef = useRef(null);
  const lastThreadRef = useRef('');

  const {profile} = useUserProfile();
  const chatName = route?.params?.chatName || 'Attorney';
  const initials = route?.params?.initials || 'AT';
  const localParticipantName =
    String(profile?.name || profile?.full_name || '').trim() || 'Client';
  const threadId = useMemo(
    () => String(route?.params?.chatId || route?.params?.chatName || 'general-chat'),
    [route?.params?.chatId, route?.params?.chatName],
  );
  const chatOpen = isClosed === false;

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          await ensureAppConfigLoaded();
          if (!threadId || threadId === 'general-chat') return;
          const rows = await getMyAppointments({force: true});
          if (cancelled) return;
          const item = (rows || []).find(r => String(r.id) === String(threadId));
          if (!item) return;
          const status = String(item.status || '').toLowerCase();
          const eligible =
            status === 'confirmed' || status === 'rescheduled' || status === 'completed';
          if (!eligible) return;
          // Completed sessions stay readable; active ones must wait for schedule (web parity).
          if (status === 'completed') return;
          if (item.chatAccessible === false) {
            Alert.alert(
              'Consultation not available yet',
              item.chatBlockedMessage ||
                'Chat opens on your consultation day (any time that day).',
              [{text: 'OK', onPress: () => navigation.goBack()}],
            );
          }
        } catch {
          // Offline or transient errors — do not block chat access.
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [threadId, navigation]),
  );

  const loadThread = useCallback(async () => {
    try {
      const {messages: rows, isClosed: closed, videoMeetingId} = await getThreadMessages(threadId);
      setMessages(rows);
      setIsClosed(closed);
      setIncomingMeetingId(prev => {
        const next = videoMeetingId || null;
        if (next && next === startedMeetingIdRef.current) return prev;
        return next;
      });
    } catch {
      setMessages([]);
      setIsClosed(false);
    }
  }, [threadId]);

  useEffect(() => {
    if (!threadId || threadId === 'general-chat') return undefined;
    let cancelled = false;
    let detachPresence = () => {};

    (async () => {
      const {profile} = await getCurrentSessionProfile();
      if (cancelled || !profile?.id) return;
      detachPresence = attachConsultationChatPresence({
        appointmentId: threadId,
        role: 'client',
        userId: profile.id,
        displayName: profile.full_name || 'Client',
        otherPartyName: chatName,
        onWaitingPopup: copy => setWaitingPopup(copy),
      });
    })();

    return () => {
      cancelled = true;
      detachPresence();
    };
  }, [threadId, chatName]);

  useEffect(() => {
    if (!threadId || threadId === 'general-chat') return;
    const matching = (notifications || []).find(item => {
      const type = String(item?.type || '').toLowerCase();
      if (type !== 'consultation_time_warning') return false;
      const body = String(item?.body || '');
      return body.includes(`Ref #${threadId}`);
    });
    if (!matching?.id || shownTimeWarningIdsRef.current.has(matching.id)) return;
    shownTimeWarningIdsRef.current.add(matching.id);
    setTimeWarningPopup({
      title: matching.title || 'Consultation Reminder',
      body: matching.body || 'Only 10 minutes left. Please prepare your final questions.',
    });
  }, [notifications, threadId]);

  useEffect(() => {
    if (!sessionBounds || isClosed) return;
    const {phase} = getConsultationTimerDisplay(nowMs, sessionBounds);
    if (phase !== 'warning') {
      tenMinuteWarningSentRef.current = false;
      return;
    }
    if (tenMinuteWarningSentRef.current) return;
    tenMinuteWarningSentRef.current = true;
    setTimeWarningPopup({
      title: 'Consultation Reminder',
      body: 'Only 10 minutes left in your scheduled hour. Please prepare your final questions.',
    });
  }, [nowMs, sessionBounds, isClosed]);

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
        'The 15-minute grace period has started. Your attorney will end the consultation when you are finished.',
      );
    } else if (prev !== 'after_grace' && phase === 'after_grace') {
      Alert.alert(
        'Grace period ended',
        'Only your attorney can end the consultation. The chat stays open until then.',
      );
    }
    prevTimerPhaseRef.current = phase;
  }, [nowMs, sessionBounds, isClosed]);

  useEffect(() => {
    let unsubscribe = () => {};
    let cancelled = false;
    (async () => {
      try {
        const unsub = await attachThreadRealtime(
          threadId,
          setMessages,
          setIsClosed,
          {
            onVideoMeetingChange: meetingId => {
              setIncomingMeetingId(prev => {
                const next = meetingId || null;
                if (next && next === startedMeetingIdRef.current) return prev;
                return next;
              });
            },
          },
        );
        if (!cancelled) {
          unsubscribe = unsub;
        }
      } catch {
        // offline / no room
      }
    })();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [threadId]);

  useFocusEffect(
    useCallback(() => {
      isFocusedRef.current = true;
      return () => {
        isFocusedRef.current = false;
      };
    }, []),
  );

  useEffect(() => {
    if (threadId !== lastThreadRef.current) {
      lastThreadRef.current = threadId;
      sessionWasActiveRef.current = false;
      prevIsClosedRef.current = null;
    }
    if (!threadId || threadId === 'general-chat') return;
    if (isClosed === null) return;

    const wasOpen = prevIsClosedRef.current === false;
    prevIsClosedRef.current = isClosed;

    if (!isClosed) {
      sessionWasActiveRef.current = true;
      return;
    }

    if (!wasOpen || !sessionWasActiveRef.current) return;

    sessionWasActiveRef.current = false;
    startedMeetingIdRef.current = null;
    autoOpenedMeetingIdRef.current = null;
    setIncomingMeetingId(null);
    navigation.reset({
      index: 0,
      routes: [{name: 'HomepageClient'}],
    });
  }, [isClosed, threadId, navigation]);

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

  const handleSendMessage = async () => {
    if (!messageText.trim() || !chatOpen || sending) {
      return;
    }
    try {
      setSending(true);
      const {messages: next, isClosed: closed} = await appendThreadMessage(threadId, {
        text: messageText,
        sender: 'me',
      });
      setMessages(next);
      setIsClosed(closed);
      setMessageText('');
    } catch (e) {
      Alert.alert('Error', e?.message ?? 'Could not send message.');
    } finally {
      setSending(false);
    }
  };

  const handlePickImage = async () => {
    if (!chatOpen || sending) {
      return;
    }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission', 'Photo library access is needed to send images.');
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
        caption: messageText.trim() || undefined,
      });
      setMessages(next);
      setIsClosed(closed);
      setMessageText('');
    } catch (e) {
      Alert.alert('Error', e?.message ?? 'Could not send image.');
    } finally {
      setSending(false);
    }
  };

  const handlePickFile = async () => {
    if (!chatOpen || sending) {
      return;
    }
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      type: CHAT_DOCUMENT_PICKER_TYPES,
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
    const fileName = asset.name || 'file';
    const mime = asset.mimeType || 'application/octet-stream';
    if (isBlockedChatAttachment(mime, fileName)) {
      Alert.alert(
        'Not allowed',
        'Videos cannot be sent in chat. Choose an image or a document (PDF, DOC, TXT).',
      );
      return;
    }
    try {
      setSending(true);
      const {messages: next, isClosed: closed} = await appendThreadAttachment(threadId, {
        uri: asset.uri,
        fileName,
        mime,
        size: asset.size ?? 0,
        caption: messageText.trim() || undefined,
      });
      setMessages(next);
      setIsClosed(closed);
      setMessageText('');
    } catch (e) {
      Alert.alert('Error', e?.message ?? 'Could not send file.');
    } finally {
      setSending(false);
    }
  };

  const handleStartVideoCall = async () => {
    if (!threadId || !chatOpen || videoBusy) {
      return;
    }
    try {
      setVideoBusy(true);
      const {meetingId, roomId, token} = await getOrCreateVideoMeeting(threadId);
      startedMeetingIdRef.current = meetingId;
      autoOpenedMeetingIdRef.current = meetingId;
      setIncomingMeetingId(null);
      navigation.navigate('ConsultationVideoCall', {
        meetingId,
        token,
        consultationRoomId: roomId,
        participantName: localParticipantName,
        remoteParticipantName: chatName || 'Attorney',
      });
    } catch (e) {
      Alert.alert('Video call', e?.message ?? 'Could not start video.');
    } finally {
      setVideoBusy(false);
    }
  };

  const joinIncomingVideoCall = useCallback(
    async meetingId => {
      if (!threadId || !meetingId || !chatOpen) return;
      if (videoBusy) return;
      try {
        setVideoBusy(true);
        const {roomId} = await getOrCreateVideoMeeting(threadId);
        const token = await getVideoSdkToken();
        autoOpenedMeetingIdRef.current = meetingId;
        navigation.navigate('ConsultationVideoCall', {
          meetingId,
          token,
          consultationRoomId: roomId,
          participantName: localParticipantName,
          remoteParticipantName: chatName || 'Attorney',
        });
      } catch (e) {
        Alert.alert('Video call', e?.message ?? 'Could not join video.');
      } finally {
        setVideoBusy(false);
      }
    },
    [chatName, chatOpen, localParticipantName, navigation, threadId, videoBusy],
  );

  const handleDismissIncomingCall = async () => {
    const meetingId = incomingMeetingId;
    setIncomingMeetingId(null);
    autoOpenedMeetingIdRef.current = meetingId;
  };

  const ActionButton = ({icon, label, onPress}) => (
    <TouchableOpacity style={styles.actionChip} onPress={onPress} activeOpacity={0.7}>
      <Text style={styles.actionIcon}>{icon}</Text>
      <Text style={styles.actionLabel}>{label}</Text>
    </TouchableOpacity>
  );

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
            <Text style={styles.headerName}>{chatName}</Text>
            <Text style={styles.headerStatus}>ONLINE</Text>
          </View>
          {chatOpen ? (
            <TouchableOpacity
              style={styles.headerVideoBtn}
              onPress={handleStartVideoCall}
              disabled={videoBusy}
              accessibilityLabel="Start or join video call">
              {videoBusy ? (
                <ActivityIndicator size="small" color={T.gold[1]} />
              ) : (
                <MaterialCommunityIcons name="video" size={26} color={T.gold[1]} />
              )}
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={styles.keyboardAvoid}>
          <FlatList
            ref={listRef}
            style={styles.messagesList}
            data={messages}
            keyExtractor={item => item.id}
            renderItem={renderItem}
            contentContainerStyle={styles.chatList}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={IS_IOS ? 'interactive' : 'on-drag'}
            onContentSizeChange={() => listRef.current?.scrollToEnd({animated: true})}
            ListHeaderComponent={
              <>
                <View style={styles.encryptionBadge}>
                  <Text style={styles.encryptionText}>
                    🔒 This session is end-to-end encrypted for your privacy.
                  </Text>
                </View>
                <ConsultationSessionAlerts
                  bounds={sessionBounds}
                  nowMs={nowMs}
                  isClosed={isClosed}
                />
                {chatOpen && incomingMeetingId ? (
                  <View style={styles.incomingCallCard}>
                    <View style={styles.incomingCallTextWrap}>
                      <Text style={styles.incomingCallTitle}>Incoming video call</Text>
                      <Text style={styles.incomingCallSubtitle}>
                        Your attorney started a video call. Tap Join to connect.
                      </Text>
                    </View>
                    <View style={styles.incomingCallActions}>
                      <TouchableOpacity
                        style={styles.incomingCallJoinBtn}
                        onPress={() => joinIncomingVideoCall(incomingMeetingId)}
                        disabled={videoBusy}
                        activeOpacity={0.85}>
                        {videoBusy ? (
                          <ActivityIndicator size="small" color="#fff" />
                        ) : (
                          <Text style={styles.incomingCallJoinText}>Join</Text>
                        )}
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.incomingCallDismissBtn}
                        onPress={handleDismissIncomingCall}>
                        <Text style={styles.incomingCallDismissText}>Dismiss</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : null}
                {isClosed === true && (
                  <View style={styles.closedBadge}>
                    <Text style={styles.closedText}>
                      Consultation Ended — you can review messages below; sending is disabled.
                    </Text>
                  </View>
                )}
              </>
            }
          />

          <View
            style={[
              styles.footer,
              {
                paddingBottom:
                  keyboardInset > 0
                    ? keyboardInset + 8
                    : Math.max(insets.bottom, 16),
              },
            ]}>
            {chatOpen && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.actionsRow}>
                <ActionButton icon="📹" label="Video" onPress={handleStartVideoCall} />
                <ActionButton icon="🖼" label="Photo" onPress={handlePickImage} />
                <ActionButton icon="📄" label="File" onPress={handlePickFile} />
              </ScrollView>
            )}
            <View style={styles.inputRow}>
              <TextInput
                style={[styles.input, !chatOpen && styles.inputDisabled]}
                placeholder={!chatOpen ? 'Consultation closed' : `Message ${chatName}...`}
                value={messageText}
                onChangeText={setMessageText}
                placeholderTextColor={T.textSoft}
                editable={chatOpen}
              />
              {sending ? (
                <ActivityIndicator style={{marginLeft: 12}} color={T.gold[1]} />
              ) : (
                <TouchableOpacity
                  style={[styles.sendButton, (!chatOpen || !messageText.trim()) && styles.sendButtonDisabled]}
                  onPress={handleSendMessage}
                  activeOpacity={0.8}
                  disabled={!chatOpen || !messageText.trim()}>
                  <Text style={styles.sendIcon}>➤</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>

      <ConsultationWaitingPopup
        visible={Boolean(waitingPopup)}
        title={waitingPopup?.title}
        body={waitingPopup?.body}
        showGoToChatroom
        goToChatroomLabel="Continue in Chatroom"
        onNotNow={() => {
          if (waitingPopup?.appointmentId) {
            dismissConsultationPeerEntry(
              waitingPopup.appointmentId,
              waitingPopup.otherJoinedAt,
            );
          }
          setWaitingPopup(null);
        }}
        onGoToChatroom={() => setWaitingPopup(null)}
      />
      <ConsultationWaitingPopup
        visible={Boolean(timeWarningPopup)}
        title={timeWarningPopup?.title}
        body={timeWarningPopup?.body}
        onNotNow={() => setTimeWarningPopup(null)}
      />
    </ClientScreenShell>
  );
};

const styles = StyleSheet.create({
  keyboardAvoid: {flex: 1},
  messagesList: {flex: 1},
  header: {flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(244, 215, 139, 0.12)', backgroundColor: 'rgba(18, 26, 36, 0.5)'},
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
  headerVideoBtn: {
    padding: 8,
    marginLeft: 8,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 44,
  },
  headerName: {fontWeight: 'bold', fontSize: 16, color: T.text},
  headerStatus: {color: '#6EE7B7', fontSize: 10, fontWeight: 'bold'},
  chatList: {padding: 16, paddingBottom: 24},
  encryptionBadge: {backgroundColor: 'rgba(59, 130, 246, 0.12)', padding: 12, borderRadius: 8, marginBottom: 20, borderWidth: 1, borderColor: 'rgba(96, 165, 250, 0.25)'},
  encryptionText: {color: '#93C5FD', fontSize: 12, textAlign: 'center'},
  aiBubble: {backgroundColor: 'rgba(255,255,255,0.08)', padding: 16, borderRadius: 16, borderBottomLeftRadius: 4, alignSelf: 'flex-start', maxWidth: '80%', marginBottom: 12, borderWidth: 1, borderColor: 'rgba(244, 215, 139, 0.1)'},
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
  footer: {paddingTop: 16, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: 'rgba(244, 215, 139, 0.12)', backgroundColor: 'rgba(4, 7, 11, 0.35)'},
  actionsRow: {marginBottom: 16},
  actionChip: {flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.06)', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(244, 215, 139, 0.15)', marginRight: 8},
  actionIcon: {marginRight: 6},
  actionLabel: {fontSize: 12, color: T.textSoft},
  inputRow: {flexDirection: 'row', alignItems: 'center'},
  input: {flex: 1, backgroundColor: 'rgba(255,255,255,0.08)', height: 48, borderRadius: 24, paddingHorizontal: 20, color: T.text, borderWidth: 1, borderColor: 'rgba(244, 215, 139, 0.12)'},
  inputDisabled: {backgroundColor: 'rgba(148, 163, 184, 0.2)', color: T.textSoft},
  sendButton: {backgroundColor: T.gold[1], width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center', marginLeft: 12},
  sendButtonDisabled: {backgroundColor: 'rgba(148, 163, 184, 0.35)'},
  sendIcon: {color: T.base},
  closedBadge: {backgroundColor: 'rgba(251, 191, 36, 0.12)', padding: 12, borderRadius: 8, marginBottom: 20, borderWidth: 1, borderColor: 'rgba(251, 191, 36, 0.25)'},
  closedText: {color: T.gold[0], fontSize: 12, textAlign: 'center', fontWeight: 'bold'},
  incomingCallCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(37, 99, 235, 0.18)',
    borderColor: 'rgba(96, 165, 250, 0.55)',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    gap: 12,
  },
  incomingCallTextWrap: {flex: 1, minWidth: 0},
  incomingCallTitle: {color: T.text, fontWeight: '800', fontSize: 13},
  incomingCallSubtitle: {color: T.textSoft, fontSize: 11, marginTop: 2},
  incomingCallActions: {flexDirection: 'row', alignItems: 'center', gap: 6},
  incomingCallJoinBtn: {
    backgroundColor: '#2563EB',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    minWidth: 56,
    alignItems: 'center',
  },
  incomingCallJoinText: {color: '#fff', fontWeight: '800', fontSize: 12},
  incomingCallDismissBtn: {paddingHorizontal: 8, paddingVertical: 6},
  incomingCallDismissText: {color: T.textSoft, fontWeight: '700', fontSize: 11},
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(4, 7, 11, 0.65)',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: 'rgba(18, 26, 36, 0.98)',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.15)',
  },
  modalTitle: {fontSize: 18, fontWeight: 'bold', color: T.text, marginBottom: 6},
  modalSubtitle: {fontSize: 13, color: T.textSoft, marginBottom: 16},
  starRow: {flexDirection: 'row', justifyContent: 'center', marginBottom: 16},
  starHit: {paddingHorizontal: 4},
  starGlyph: {fontSize: 36, color: 'rgba(255,255,255,0.15)'},
  starGlyphActive: {color: T.gold[1]},
  modalInput: {
    minHeight: 80,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.15)',
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    color: T.text,
    textAlignVertical: 'top',
    marginBottom: 16,
    backgroundColor: 'rgba(4, 7, 11, 0.45)',
  },
  modalActions: {flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center'},
  modalBtnSecondary: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  modalBtnSecondaryText: {color: T.textSoft, fontSize: 15, fontWeight: '600'},
  modalBtnPrimary: {
    backgroundColor: T.gold[1],
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 24,
    minWidth: 100,
    alignItems: 'center',
  },
  modalBtnPrimarySpaced: {marginLeft: 12},
  modalBtnPrimaryText: {color: T.base, fontSize: 15, fontWeight: '600'},
  modalBtnDisabled: {opacity: 0.6},
});

export default ConsultationChat;
