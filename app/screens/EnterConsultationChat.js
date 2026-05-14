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
  Modal,
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
  hasFeedbackForAppointment,
  submitConsultationFeedback,
} from '../services/consultationFeedbackService';
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

const ConsultationChat = ({navigation, route}) => {
  const insets = useSafeAreaInsets();
  const [messageText, setMessageText] = useState('');
  const [messages, setMessages] = useState([]);
  const [isClosed, setIsClosed] = useState(false);
  const [sending, setSending] = useState(false);
  const [feedbackModalVisible, setFeedbackModalVisible] = useState(false);
  const [feedbackRating, setFeedbackRating] = useState(0);
  const [feedbackComment, setFeedbackComment] = useState('');
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [videoBusy, setVideoBusy] = useState(false);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [sessionBounds, setSessionBounds] = useState(null);
  const listRef = useRef(null);
  const notifIdsRef = useRef([]);
  const prevTimerPhaseRef = useRef(null);

  const chatName = route?.params?.chatName || 'Attorney';
  const initials = route?.params?.initials || 'AT';
  const threadId = useMemo(
    () => String(route?.params?.chatId || route?.params?.chatName || 'general-chat'),
    [route?.params?.chatId, route?.params?.chatName],
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
        const unsub = await attachThreadRealtime(threadId, setMessages, setIsClosed);
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
      if (!isClosed || !threadId) {
        return;
      }
      let cancelled = false;
      (async () => {
        try {
          const has = await hasFeedbackForAppointment(threadId);
          if (!cancelled && !has) {
            setFeedbackModalVisible(true);
          }
        } catch {
          // ignore
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [isClosed, threadId]),
  );

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
    if (!messageText.trim() || isClosed || sending) {
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
    if (isClosed || sending) {
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

  const handleFeedbackSubmit = async () => {
    if (feedbackRating < 1 || feedbackRating > 5) {
      Alert.alert('Rating', 'Please select a star rating from 1 to 5.');
      return;
    }
    try {
      setFeedbackSubmitting(true);
      await submitConsultationFeedback(threadId, {
        rating: feedbackRating,
        comment: feedbackComment,
      });
      setFeedbackModalVisible(false);
      setFeedbackComment('');
      setFeedbackRating(0);
    } catch (e) {
      Alert.alert('Error', e?.message ?? 'Could not save feedback.');
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  const handleFeedbackSkip = () => {
    setFeedbackModalVisible(false);
  };

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
        participantName: chatName || 'Client',
      });
    } catch (e) {
      Alert.alert('Video call', e?.message ?? 'Could not start video.');
    } finally {
      setVideoBusy(false);
    }
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
          {!isClosed ? (
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
                {isClosed && (
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
            {!isClosed && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.actionsRow}>
                <ActionButton icon="📹" label="Video" onPress={handleStartVideoCall} />
                <ActionButton icon="🖼" label="Photo" onPress={handlePickImage} />
                <ActionButton icon="📄" label="File" onPress={handlePickFile} />
              </ScrollView>
            )}
            <View style={styles.inputRow}>
              <TextInput
                style={[styles.input, isClosed && styles.inputDisabled]}
                placeholder={isClosed ? 'Consultation closed' : `Message ${chatName}...`}
                value={messageText}
                onChangeText={setMessageText}
                placeholderTextColor={T.textSoft}
                editable={!isClosed}
              />
              {sending ? (
                <ActivityIndicator style={{marginLeft: 12}} color={T.gold[1]} />
              ) : (
                <TouchableOpacity
                  style={[styles.sendButton, (isClosed || !messageText.trim()) && styles.sendButtonDisabled]}
                  onPress={handleSendMessage}
                  activeOpacity={0.8}
                  disabled={isClosed || !messageText.trim()}>
                  <Text style={styles.sendIcon}>➤</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>

      <Modal
        visible={feedbackModalVisible}
        transparent
        animationType="fade"
        onRequestClose={handleFeedbackSkip}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>How was your consultation?</Text>
            <Text style={styles.modalSubtitle}>Rate your attorney (optional comment below)</Text>
            <View style={styles.starRow}>
              {[1, 2, 3, 4, 5].map(n => (
                <TouchableOpacity
                  key={n}
                  onPress={() => setFeedbackRating(n)}
                  style={styles.starHit}
                  hitSlop={{top: 8, bottom: 8, left: 4, right: 4}}>
                  <Text style={[styles.starGlyph, n <= feedbackRating && styles.starGlyphActive]}>
                    ★
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              style={styles.modalInput}
              placeholder="Feedback (optional)"
              placeholderTextColor={T.textSoft}
              value={feedbackComment}
              onChangeText={setFeedbackComment}
              multiline
              maxLength={1000}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalBtnSecondary} onPress={handleFeedbackSkip}>
                <Text style={styles.modalBtnSecondaryText}>Skip</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalBtnPrimary,
                  styles.modalBtnPrimarySpaced,
                  feedbackSubmitting && styles.modalBtnDisabled,
                ]}
                onPress={handleFeedbackSubmit}
                disabled={feedbackSubmitting}>
                {feedbackSubmitting ? (
                  <ActivityIndicator color={T.base} />
                ) : (
                  <Text style={styles.modalBtnPrimaryText}>Submit</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
