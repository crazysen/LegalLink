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
  Modal,
  ScrollView,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
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
import {
  CHAT_DOCUMENT_PICKER_TYPES,
  isBlockedChatAttachment,
} from '../services/chatTypes';
import {
  endConsultationSession,
  notifyClientConsultationTimeWarning,
  saveAttorneyConsultationBranch,
  saveAttorneyConsultationSummary,
} from '../services/messageService';
import {
  attachConsultationChatPresence,
  dismissConsultationPeerEntry,
} from '../services/consultationChatPresence';
import ConsultationWaitingPopup from '../components/ConsultationWaitingPopup';
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
import {
  getOrCreateVideoMeeting,
  getVideoSdkToken,
} from '../services/videoMeetingService';
import {
  getConsultationBranchesForAttorney,
  parseConsultationBranchFromTitle,
} from '../services/consultationBranches';
import {
  CONSULTATION_SUMMARY_SECTIONS,
  serializeConsultationSummary,
  consultationSummaryHasContent,
} from '../services/consultationSummaryFormat';
import {getCurrentSessionProfile} from '../services/userApi';
import {supabase} from '../services/supabaseClient';

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
  const [incomingMeetingId, setIncomingMeetingId] = useState(null);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [sessionBounds, setSessionBounds] = useState(null);
  const [waitingPopup, setWaitingPopup] = useState(null);
  const [localParticipantName, setLocalParticipantName] = useState('Attorney');
  const [summaryModalVisible, setSummaryModalVisible] = useState(false);
  const [branchPickerVisible, setBranchPickerVisible] = useState(false);
  const [branchOptions, setBranchOptions] = useState([]);
  const [branchListLoaded, setBranchListLoaded] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState('');
  const [summaryFields, setSummaryFields] = useState(() =>
    Object.fromEntries(CONSULTATION_SUMMARY_SECTIONS.map(s => [s.key, ''])),
  );
  const [summarySaving, setSummarySaving] = useState(false);
  const tenMinuteWarningSentRef = useRef(false);
  const listRef = useRef(null);
  const notifIdsRef = useRef([]);
  const prevTimerPhaseRef = useRef(null);
  const isFocusedRef = useRef(false);
  const startedMeetingIdRef = useRef(null);
  const autoOpenedMeetingIdRef = useRef(null);
  const clientName = route?.params?.clientName || 'Sarah Jenkins';
  const clientInitials = route?.params?.clientInitials || 'SJ';
  const threadId = useMemo(
    () => String(route?.params?.chatId || route?.params?.clientName || 'general-chat'),
    [route?.params?.chatId, route?.params?.clientName],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const {profile} = await getCurrentSessionProfile();
        if (cancelled) return;
        const name = String(profile?.full_name || profile?.name || profile?.email || '').trim();
        if (name) setLocalParticipantName(name);
      } catch {
        /* keep default */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!summaryModalVisible) return;
    let cancelled = false;
    (async () => {
      setBranchListLoaded(false);
      try {
        const {profile} = await getCurrentSessionProfile();
        let specialties = [];
        if (profile?.id) {
          const {data: atty} = await supabase
            .from('attorney_profiles')
            .select('specialties')
            .eq('user_id', profile.id)
            .maybeSingle();
          const raw = atty?.specialties;
          specialties = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
        }
        const opts = getConsultationBranchesForAttorney({
          name: profile?.full_name,
          specialties,
        });
        if (!cancelled) setBranchOptions(Array.isArray(opts) ? opts : []);
      } catch {
        if (!cancelled) setBranchOptions([]);
      } finally {
        if (!cancelled) setBranchListLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [summaryModalVisible]);

  useEffect(() => {
    if (!summaryModalVisible || !threadId || branchOptions.length === 0) return;
    let cancelled = false;
    (async () => {
      const {data} = await supabase
        .from('appointments')
        .select('title')
        .eq('id', threadId)
        .maybeSingle();
      if (cancelled) return;
      const parsed = parseConsultationBranchFromTitle(data?.title || '');
      if (parsed && branchOptions.includes(parsed)) {
        setSelectedBranch(parsed);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [summaryModalVisible, threadId, branchOptions]);

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
    if (!threadId || threadId === 'general-chat') return undefined;
    let cancelled = false;
    let detachPresence = () => {};

    (async () => {
      const {profile} = await getCurrentSessionProfile();
      if (cancelled || !profile?.id) return;
      detachPresence = attachConsultationChatPresence({
        appointmentId: threadId,
        role: 'attorney',
        userId: profile.id,
        displayName: profile.full_name || 'Attorney',
        otherPartyName: clientName,
        onWaitingPopup: copy => setWaitingPopup(copy),
      });
    })();

    return () => {
      cancelled = true;
      detachPresence();
    };
  }, [threadId, clientName]);

  useEffect(() => {
    if (!sessionBounds || isClosed) {
      tenMinuteWarningSentRef.current = false;
      return;
    }
    const {phase} = getConsultationTimerDisplay(nowMs, sessionBounds);
    if (phase === 'warning' && !tenMinuteWarningSentRef.current) {
      tenMinuteWarningSentRef.current = true;
      notifyClientConsultationTimeWarning(threadId).catch(() => {});
    }
    if (phase !== 'warning') {
      tenMinuteWarningSentRef.current = false;
    }
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
        // no room
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
      startedMeetingIdRef.current = meetingId;
      autoOpenedMeetingIdRef.current = meetingId;
      setIncomingMeetingId(null);
      navigation.navigate('ConsultationVideoCall', {
        meetingId,
        token,
        consultationRoomId: roomId,
        participantName: localParticipantName,
        remoteParticipantName: clientName || 'Client',
      });
    } catch (e) {
      Alert.alert('Video call', e?.message ?? 'Could not start video.');
    } finally {
      setVideoBusy(false);
    }
  };

  const joinIncomingVideoCall = useCallback(
    async meetingId => {
      if (!threadId || !meetingId || isClosed) return;
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
          remoteParticipantName: clientName || 'Client',
        });
      } catch (e) {
        Alert.alert('Video call', e?.message ?? 'Could not join video.');
      } finally {
        setVideoBusy(false);
      }
    },
    [clientName, isClosed, localParticipantName, navigation, threadId, videoBusy],
  );

  const handleDismissIncomingCall = () => {
    const meetingId = incomingMeetingId;
    setIncomingMeetingId(null);
    autoOpenedMeetingIdRef.current = meetingId;
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
              await endConsultationSession(threadId);
              setIsClosed(true);
              const next = await getThreadMessages(threadId);
              setMessages(next.messages);
              setIsClosed(next.isClosed);
              setSummaryFields(
                Object.fromEntries(CONSULTATION_SUMMARY_SECTIONS.map(s => [s.key, ''])),
              );
              setSelectedBranch('');
              setSummaryModalVisible(true);
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

  const handleSaveSessionSummary = async () => {
    const trimmedBranch = selectedBranch.trim();
    if (!trimmedBranch) {
      Alert.alert('Branch required', 'Select the consultation branch that best fits this session.');
      return;
    }
    if (!consultationSummaryHasContent(summaryFields)) {
      Alert.alert('Summary required', 'Please fill in at least one of the summary sections.');
      return;
    }
    try {
      setSummarySaving(true);
      await saveAttorneyConsultationBranch({appointmentId: threadId, branch: trimmedBranch});
      await saveAttorneyConsultationSummary(threadId, serializeConsultationSummary(summaryFields));
      setSummaryModalVisible(false);
      Alert.alert('Saved', 'Session summary saved successfully.');
    } catch (e) {
      Alert.alert('Error', e?.message ?? 'Could not save summary.');
    } finally {
      setSummarySaving(false);
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
                {!isClosed && incomingMeetingId ? (
                  <View style={styles.incomingCallCard}>
                    <View style={styles.incomingCallTextWrap}>
                      <Text style={styles.incomingCallTitle}>Active video call</Text>
                      <Text style={styles.incomingCallSubtitle}>
                        A video meeting is in progress. Tap Join to enter the call.
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

      <Modal
        visible={summaryModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => !summarySaving && setSummaryModalVisible(false)}>
        <View style={styles.summaryOverlay}>
          <View style={styles.summarySheet}>
            <Text style={styles.summaryModalTitle}>Session summary</Text>
            <Text style={styles.summaryModalSubtitle}>
              Tag this consultation and capture what you discussed with the client.
            </Text>

            <Text style={styles.summaryFieldLabel}>Consultation branch</Text>
            <TouchableOpacity
              style={styles.branchField}
              onPress={() => branchOptions.length > 0 && setBranchPickerVisible(true)}
              disabled={branchOptions.length === 0}>
              <Text
                style={
                  selectedBranch ? styles.branchFieldText : styles.branchFieldPlaceholder
                }
                numberOfLines={2}>
                {selectedBranch ||
                  (!branchListLoaded
                    ? 'Loading branches…'
                    : branchOptions.length > 0
                      ? 'Tap to select branch'
                      : 'No branches mapped for your profile')}
              </Text>
              <MaterialCommunityIcons name="chevron-down" size={22} color={T.textSoft} />
            </TouchableOpacity>

            <ScrollView
              style={styles.summaryScroll}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}>
              {CONSULTATION_SUMMARY_SECTIONS.map(section => (
                <View key={section.key} style={styles.summaryBlock}>
                  <Text style={styles.summarySectionTitle}>{section.title}</Text>
                  <Text style={styles.summarySectionSub}>{section.subtitle}</Text>
                  <TextInput
                    style={styles.summaryInput}
                    placeholder={section.placeholder}
                    placeholderTextColor={T.textSoft}
                    multiline
                    value={summaryFields[section.key]}
                    onChangeText={t =>
                      setSummaryFields(prev => ({...prev, [section.key]: t}))
                    }
                  />
                </View>
              ))}
            </ScrollView>

            <View style={styles.summaryActions}>
              <TouchableOpacity
                style={styles.summaryBtnGhost}
                disabled={summarySaving}
                onPress={() => setSummaryModalVisible(false)}>
                <Text style={styles.summaryBtnGhostText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.summaryBtnGold, summarySaving && styles.summaryBtnDisabled]}
                disabled={summarySaving}
                onPress={handleSaveSessionSummary}>
                {summarySaving ? (
                  <ActivityIndicator color={T.base} />
                ) : (
                  <Text style={styles.summaryBtnGoldText}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={branchPickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setBranchPickerVisible(false)}>
        <View style={styles.pickerModalRoot}>
          <TouchableOpacity
            style={styles.pickerOverlay}
            activeOpacity={1}
            onPress={() => setBranchPickerVisible(false)}
          />
          <View style={styles.pickerSheet}>
            <Text style={styles.pickerTitle}>Consultation branch</Text>
            <FlatList
              data={branchOptions}
              keyExtractor={item => item}
              keyboardShouldPersistTaps="handled"
              renderItem={({item}) => (
                <TouchableOpacity
                  style={styles.pickerRow}
                  onPress={() => {
                    setSelectedBranch(item);
                    setBranchPickerVisible(false);
                  }}>
                  <Text style={styles.pickerRowText}>{item}</Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>
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
  summaryOverlay: {
    flex: 1,
    backgroundColor: 'rgba(4, 7, 11, 0.72)',
    justifyContent: 'flex-end',
  },
  summarySheet: {
    backgroundColor: 'rgba(18, 26, 36, 0.98)',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 28,
    maxHeight: '92%',
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.18)',
  },
  summaryModalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: T.text,
  },
  summaryModalSubtitle: {
    marginTop: 6,
    marginBottom: 16,
    fontSize: 13,
    color: T.textSoft,
    lineHeight: 18,
  },
  summaryFieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: T.textSoft,
    marginBottom: 8,
  },
  branchField: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.2)',
    backgroundColor: 'rgba(4, 7, 11, 0.45)',
    marginBottom: 16,
    gap: 8,
  },
  branchFieldText: {flex: 1, color: T.text, fontWeight: '600', fontSize: 14},
  branchFieldPlaceholder: {flex: 1, color: T.textSoft, fontSize: 14},
  summaryScroll: {maxHeight: 420},
  summaryBlock: {marginBottom: 14},
  summarySectionTitle: {fontSize: 15, fontWeight: '800', color: T.gold[0]},
  summarySectionSub: {fontSize: 11, color: T.textSoft, marginTop: 2, marginBottom: 8},
  summaryInput: {
    minHeight: 72,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.15)',
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    color: T.text,
    textAlignVertical: 'top',
    backgroundColor: 'rgba(4, 7, 11, 0.35)',
  },
  summaryActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginTop: 12,
    gap: 12,
  },
  summaryBtnGhost: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  summaryBtnGhostText: {color: T.textSoft, fontWeight: '700', fontSize: 15},
  summaryBtnGold: {
    backgroundColor: T.gold[1],
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 24,
    minWidth: 110,
    alignItems: 'center',
  },
  summaryBtnGoldText: {color: T.base, fontWeight: '800', fontSize: 15},
  summaryBtnDisabled: {opacity: 0.55},
  pickerModalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  pickerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(4, 7, 11, 0.55)',
  },
  pickerSheet: {
    maxHeight: '55%',
    marginHorizontal: 16,
    marginBottom: 24,
    backgroundColor: 'rgba(18, 26, 36, 0.98)',
    borderRadius: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.2)',
  },
  pickerTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: T.text,
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(244, 215, 139, 0.12)',
  },
  pickerRow: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  pickerRowText: {color: T.text, fontSize: 14},
  backButton: {padding: 4},
});
