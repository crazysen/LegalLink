import React, {Component, useCallback, useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  DeviceEventEmitter,
  PermissionsAndroid,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Constants from 'expo-constants';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {MaterialCommunityIcons} from '@expo/vector-icons';
import InCallManager from '@videosdk.live/react-native-incallmanager';
import {REFERENCE_THEME as T} from '../constants/referenceTheme';
import {supabase} from '../services/supabaseClient';

const JOIN_TIMEOUT_MS = 25000;
const JOIN_RETRY_DELAY_MS = 1200;
const MAX_JOIN_RETRIES = 1;
const CTRL_HIT = 48;

const ROUTE_SPEAKER = 'SPEAKER_PHONE';
const ROUTE_EARPIECE = 'EARPIECE';

/**
 * Android: the native device manager only routes to devices in its available set, which is
 * populated only in automatic mode (start({auto: true})); a user selection always wins over auto.
 * iOS: chooseAudioRoute/selectAudioDevice are not exported natively; setSpeakerphoneOn resets the
 * session category (drops DefaultToSpeaker) so the earpiece route actually takes effect.
 */
async function applyVideoCallAudioRoute(speakerEnabled) {
  if (Platform.OS === 'android') {
    await InCallManager.chooseAudioRoute(speakerEnabled ? ROUTE_SPEAKER : ROUTE_EARPIECE);
    return;
  }
  InCallManager.setForceSpeakerphoneOn(Boolean(speakerEnabled));
  InCallManager.setSpeakerphoneOn(Boolean(speakerEnabled));
}

const PIP_WIDTH = 112;
const PIP_ASPECT = 16 / 9;

const EXPO_GO_HINT =
  'Video calls need native WebRTC. Expo Go does not include it. Create a development build: npx expo prebuild then npx expo run:android (or run:ios), or use EAS Build.';

class VideoErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = {hasError: false};
  }

  static getDerivedStateFromError() {
    return {hasError: true};
  }

  componentDidCatch(error) {
    console.warn('[video] SDK error caught by boundary:', error?.message || error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.centerBox}>
          <Text style={styles.errorText}>
            Video call encountered an error. Please close and try again.
          </Text>
          <TouchableOpacity style={styles.leaveBtn} onPress={this.props.onClose}>
            <Text style={styles.leaveBtnText}>Close</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

function VideoCallHeader({onClose}) {
  return (
    <View style={styles.vcHeader}>
      <Text style={styles.vcTitle}>Video Consultation</Text>
      <TouchableOpacity
        style={styles.vcClose}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close video call"
        hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
        <Text style={styles.vcCloseText}>✕</Text>
      </TouchableOpacity>
    </View>
  );
}

const toInitials = name =>
  (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .map(p => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

function ParticipantVideo({sdk, participantId, label, variant}) {
  const participant = sdk.useParticipant(participantId);
  const {webcamStream, webcamOn, micOn, displayName, isLocal} = participant || {};
  const {RTCView, MediaStream} = sdk;

  const tileLabel = label || displayName || (isLocal ? 'You' : 'Participant');
  const isPip = variant === 'pip';
  const videoStyle = isPip ? styles.pipRtc : styles.remoteRtc;
  const containerStyle = isPip ? styles.pipInner : styles.remoteInner;
  const hasLiveVideo = Boolean(webcamOn && webcamStream?.track);

  return (
    <View style={[containerStyle, !hasLiveVideo && styles.placeholder]}>
      {hasLiveVideo ? (
        <RTCView
          objectFit="cover"
          style={videoStyle}
          streamURL={new MediaStream([webcamStream.track]).toURL()}
          mirror={Boolean(isLocal)}
          zOrder={isPip ? 1 : 0}
        />
      ) : (
        <View style={isPip ? styles.pipAvatar : styles.remoteAvatar}>
          <Text style={isPip ? styles.pipInitial : styles.remoteInitial}>{toInitials(tileLabel)}</Text>
        </View>
      )}
      <View style={isPip ? styles.pipLabelPill : styles.remoteLabelPill}>
        <Text style={isPip ? styles.pipLabel : styles.remoteLabel} numberOfLines={1}>
          {tileLabel}
          {isLocal ? ' (You)' : ''}
        </Text>
      </View>
      {micOn === false ? (
        <View style={isPip ? styles.pipMicOff : styles.remoteMicOff}>
          <MaterialCommunityIcons name="microphone-off" size={isPip ? 12 : 16} color="#FCA5A5" />
        </View>
      ) : null}
    </View>
  );
}

function ParticipantRoleReporter({sdk, participantId, onRole}) {
  const participant = sdk.useParticipant(participantId);

  useEffect(() => {
    onRole(participantId, Boolean(participant?.isLocal));
  }, [participantId, participant?.isLocal, onRole]);

  return null;
}

function MeetingVideoStage({sdk, participantIds, localDisplayName, remoteDisplayName}) {
  const [rolesById, setRolesById] = useState({});
  const pipHeight = Math.round(PIP_WIDTH * PIP_ASPECT);

  const reportRole = useCallback((participantId, isLocal) => {
    setRolesById(prev => {
      if (prev[participantId] === isLocal) {
        return prev;
      }
      return {...prev, [participantId]: isLocal};
    });
  }, []);

  const localId = participantIds.find(pid => rolesById[pid] === true) ?? null;
  const remoteIds = participantIds.filter(pid => rolesById[pid] === false);
  // Web layout: remote fills the stage, local is the PiP; alone, you fill the stage.
  const primaryRemoteId = remoteIds[0] ?? null;
  const primaryId = primaryRemoteId || localId;
  const pipId = primaryRemoteId ? localId : null;

  return (
    <View style={styles.stage}>
      {participantIds.map(pid => (
        <ParticipantRoleReporter key={`role-${pid}`} sdk={sdk} participantId={pid} onRole={reportRole} />
      ))}

      {primaryId ? (
        <ParticipantVideo
          sdk={sdk}
          participantId={primaryId}
          label={primaryRemoteId ? remoteDisplayName : localDisplayName}
          variant="remote"
        />
      ) : (
        <View style={styles.remoteInner}>
          <Text style={styles.waitingText}>Waiting for the other participant…</Text>
        </View>
      )}

      {pipId ? (
        <View style={[styles.pipContainer, {width: PIP_WIDTH, height: pipHeight}]}>
          <ParticipantVideo
            sdk={sdk}
            participantId={pipId}
            label={localDisplayName}
            variant="pip"
          />
        </View>
      ) : null}

      {remoteIds.length > 1 && (
        <View style={styles.extraRemoteHint}>
          <Text style={styles.extraRemoteText}>+{remoteIds.length - 1} more</Text>
        </View>
      )}
    </View>
  );
}

function MeetingContent({
  sdk,
  meetingId,
  onRequestLeave,
  localDisplayName,
  remoteDisplayName,
  roomClosed,
}) {
  const {useMeeting} = sdk;
  const insets = useSafeAreaInsets();

  const [joinState, setJoinState] = useState('JOINING');
  const [joinError, setJoinError] = useState('');
  const [speakerOn, setSpeakerOn] = useState(true);
  const speakerOnRef = useRef(true);
  const joinedRef = useRef(false);
  const timeoutRef = useRef(null);
  const retryCountRef = useRef(0);
  const finishedRef = useRef(false);
  const hasLeftRef = useRef(false);
  const leaveRef = useRef(null);
  const joinRef = useRef(null);
  const facingModeRef = useRef('front');
  const audioStartedRef = useRef(false);

  const clearJoinTimeout = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  const finishSession = useCallback(() => {
    if (finishedRef.current) {
      return;
    }
    finishedRef.current = true;
    try {
      InCallManager.stop();
    } catch {
      /* ignore */
    }
    audioStartedRef.current = false;
    onRequestLeave();
  }, [onRequestLeave]);

  // Always tell VideoSDK we left (close button, hardware back, room closed) so the
  // other participant does not keep a frozen tile until the SDK times us out.
  const leaveMeeting = useCallback(() => {
    if (hasLeftRef.current) {
      return;
    }
    hasLeftRef.current = true;
    try {
      leaveRef.current?.();
    } catch {
      /* meeting already torn down */
    }
  }, []);

  const startJoinTimeout = () => {
    clearJoinTimeout();
    timeoutRef.current = setTimeout(() => {
      setJoinState(prev => {
        if (prev !== 'JOINING') {
          return prev;
        }
        if (retryCountRef.current < MAX_JOIN_RETRIES) {
          retryCountRef.current += 1;
          try {
            joinRef.current?.();
            startJoinTimeout();
            return 'JOINING';
          } catch {
            /* fall through to error */
          }
        }
        setJoinError('Connection timed out. Please check your internet and try again.');
        return 'ERROR';
      });
    }, JOIN_TIMEOUT_MS);
  };

  const {
    join,
    leave,
    participants,
    toggleMic,
    toggleWebcam,
    localMicOn,
    localWebcamOn,
    getWebcams,
    changeWebcam,
  } = useMeeting({
    onMeetingJoined: () => {
      clearJoinTimeout();
      retryCountRef.current = 0;
      setJoinState('JOINED');
    },
    onMeetingLeft: () => {
      finishSession();
    },
    onWebcamRequested: ({accept}) => {
      if (typeof accept === 'function') accept();
    },
    onMicRequested: ({accept}) => {
      if (typeof accept === 'function') accept();
    },
    onError: err => {
      clearJoinTimeout();
      if (retryCountRef.current < MAX_JOIN_RETRIES) {
        retryCountRef.current += 1;
        setJoinState('JOINING');
        setJoinError('');
        setTimeout(() => {
          try {
            joinRef.current?.();
            startJoinTimeout();
          } catch {
            /* surfaced by the next onError / timeout */
          }
        }, JOIN_RETRY_DELAY_MS);
        return;
      }
      const msg =
        err && (err.message || err.code) ? String(err.message || err.code) : 'Failed to connect to the video call.';
      setJoinError(msg);
      setJoinState('ERROR');
    },
  });

  leaveRef.current = leave;
  joinRef.current = join;

  useEffect(
    () => () => {
      finishedRef.current = true;
      clearJoinTimeout();
      leaveMeeting();
      try {
        InCallManager.stop();
      } catch {
        /* ignore */
      }
    },
    [leaveMeeting],
  );

  useEffect(() => {
    if (joinState !== 'JOINED' || audioStartedRef.current) {
      return;
    }
    audioStartedRef.current = true;
    try {
      InCallManager.start({media: 'video', auto: true});
    } catch (err) {
      console.warn('[video] InCallManager start failed', err?.message || err);
    }
    applyVideoCallAudioRoute(speakerOnRef.current).catch(err => {
      console.warn('[video] initial audio route failed', err?.message || err);
    });
  }, [joinState]);

  // Android: the device list fills in asynchronously (UI thread / Bluetooth). Re-assert the
  // user's speaker/earpiece choice whenever the native manager reports a different route.
  useEffect(() => {
    if (Platform.OS !== 'android') {
      return undefined;
    }
    const sub = DeviceEventEmitter.addListener('onAudioDeviceChanged', data => {
      const selected = String(data?.selectedAudioDevice || '');
      if (selected !== ROUTE_SPEAKER && selected !== ROUTE_EARPIECE) {
        return;
      }
      const desired = speakerOnRef.current ? ROUTE_SPEAKER : ROUTE_EARPIECE;
      if (selected !== desired) {
        InCallManager.chooseAudioRoute(desired).catch(() => {});
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (joinedRef.current) {
        return;
      }
      joinedRef.current = true;

      if (Platform.OS === 'android') {
        await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.CAMERA,
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        ]);
      }

      if (cancelled) {
        return;
      }

      startJoinTimeout();
      join();
    })();

    return () => {
      cancelled = true;
      clearJoinTimeout();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLeave = useCallback(() => {
    clearJoinTimeout();
    leaveMeeting();
    finishSession();
  }, [leaveMeeting, finishSession]);

  // Attorney ended the consultation — drop out of the call immediately (web parity).
  useEffect(() => {
    if (roomClosed) {
      handleLeave();
    }
  }, [roomClosed, handleLeave]);

  const handleToggleSpeaker = useCallback(() => {
    const next = !speakerOnRef.current;
    speakerOnRef.current = next;
    setSpeakerOn(next);
    applyVideoCallAudioRoute(next).catch(err => {
      console.warn('[video] speaker toggle failed', err?.message || err);
    });
  }, []);

  const handleFlipCamera = useCallback(async () => {
    try {
      const webcams = typeof getWebcams === 'function' ? await getWebcams() : [];
      if (!webcams?.length) {
        return;
      }
      const normalizeFacing = mode => {
        if (mode === 'user' || mode === 'front') {
          return 'front';
        }
        return 'environment';
      };
      const currentFacing = normalizeFacing(facingModeRef.current);
      const preferred =
        webcams.find(w => normalizeFacing(w.facingMode) !== currentFacing) ||
        webcams.find(w => w.facingMode === 'environment') ||
        webcams[1] ||
        webcams[0];
      if (preferred?.deviceId && typeof changeWebcam === 'function') {
        changeWebcam(preferred.deviceId);
        facingModeRef.current = preferred.facingMode || (currentFacing === 'front' ? 'environment' : 'front');
      }
    } catch (err) {
      console.warn('[video] flip camera failed', err?.message || err);
    }
  }, [getWebcams, changeWebcam]);

  const participantIds = [...(participants?.keys?.() ?? [])];
  const micOn = localMicOn ?? true;
  const camOn = localWebcamOn ?? true;

  return (
    <View style={styles.meetingRoot}>
      <VideoCallHeader onClose={handleLeave} />
      <Text style={styles.meetingIdLabel} numberOfLines={1}>
        Meeting ID: {meetingId}
      </Text>

      {(joinState === 'JOINING' || joinState === 'IDLE') && (
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color={T.gold[1]} />
          <Text style={styles.hint}>Connecting to video call…</Text>
        </View>
      )}

      {joinState === 'ERROR' && (
        <View style={styles.centerBox}>
          <Text style={styles.errorText}>{joinError}</Text>
        </View>
      )}

      {joinState !== 'JOINED' && (
        <View style={[styles.controls, {paddingBottom: Math.max(insets.bottom, 12)}]}>
          <TouchableOpacity
            style={[styles.ctrl, styles.ctrlDanger]}
            onPress={handleLeave}
            accessibilityRole="button"
            accessibilityLabel="Leave call"
            hitSlop={{top: 6, bottom: 6, left: 6, right: 6}}>
            <MaterialCommunityIcons name="phone-hangup" size={24} color="#fff" />
          </TouchableOpacity>
        </View>
      )}

      {joinState === 'JOINED' && (
        <>
          <MeetingVideoStage
            sdk={sdk}
            participantIds={participantIds}
            localDisplayName={localDisplayName}
            remoteDisplayName={remoteDisplayName}
          />
          <View style={[styles.controls, {paddingBottom: Math.max(insets.bottom, 12)}]}>
            <TouchableOpacity
              style={[styles.ctrl, !micOn && styles.ctrlMuted]}
              onPress={() => toggleMic?.()}
              accessibilityRole="button"
              accessibilityLabel={micOn ? 'Mute microphone' : 'Unmute microphone'}
              hitSlop={{top: 6, bottom: 6, left: 6, right: 6}}>
              <MaterialCommunityIcons
                name={micOn ? 'microphone' : 'microphone-off'}
                size={24}
                color={micOn ? T.text : '#FCA5A5'}
              />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.ctrl, !camOn && styles.ctrlMuted]}
              onPress={() => toggleWebcam?.()}
              accessibilityRole="button"
              accessibilityLabel={camOn ? 'Stop video' : 'Start video'}
              hitSlop={{top: 6, bottom: 6, left: 6, right: 6}}>
              <MaterialCommunityIcons
                name={camOn ? 'video' : 'video-off'}
                size={24}
                color={camOn ? T.text : '#FCA5A5'}
              />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.ctrl, speakerOn && styles.ctrlActive]}
              onPress={handleToggleSpeaker}
              accessibilityRole="button"
              accessibilityLabel={speakerOn ? 'Switch to earpiece' : 'Switch to speaker'}
              hitSlop={{top: 6, bottom: 6, left: 6, right: 6}}>
              <MaterialCommunityIcons
                name={speakerOn ? 'volume-high' : 'ear-hearing'}
                size={24}
                color={speakerOn ? T.gold[0] : T.text}
              />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.ctrl}
              onPress={handleFlipCamera}
              accessibilityRole="button"
              accessibilityLabel="Flip camera"
              hitSlop={{top: 6, bottom: 6, left: 6, right: 6}}>
              <MaterialCommunityIcons name="camera-flip" size={24} color={T.text} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.ctrl, styles.ctrlDanger]}
              onPress={handleLeave}
              accessibilityRole="button"
              accessibilityLabel="Leave call"
              hitSlop={{top: 6, bottom: 6, left: 6, right: 6}}>
              <MaterialCommunityIcons name="phone-hangup" size={24} color="#fff" />
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}

const VIDEO_QUALITY_PRESETS = ['h720p_w1280p', 'h540p_w960p', 'h360p_w640p'];

async function createPreferredCameraTrack(sdk, facingMode = 'user') {
  const {createCameraVideoTrack} = sdk || {};
  if (typeof createCameraVideoTrack !== 'function') {
    return null;
  }
  for (const encoderConfig of VIDEO_QUALITY_PRESETS) {
    try {
      const track = await createCameraVideoTrack({
        encoderConfig,
        facingMode,
        optimizationMode: 'motion',
        multiStream: false,
      });
      if (track) {
        return track;
      }
    } catch (err) {
      console.warn('[video] camera preset failed', encoderConfig, err?.message || err);
    }
  }
  return null;
}

async function createPreferredAudioTrack(sdk) {
  const {createMicrophoneAudioTrack} = sdk || {};
  if (typeof createMicrophoneAudioTrack !== 'function') {
    return null;
  }
  try {
    return await createMicrophoneAudioTrack({
      encoderConfig: 'speech_standard',
      noiseConfig: {
        noiseSuppression: true,
        echoCancellation: true,
        autoGainControl: true,
      },
    });
  } catch (err) {
    console.warn('[video] mic preset failed', err?.message || err);
    return null;
  }
}

function VideoMeetingSession({
  sdk,
  meetingId,
  token,
  participantName,
  remoteParticipantName,
  navigation,
  preparedTracks,
  roomClosed,
}) {
  const insets = useSafeAreaInsets();
  const {MeetingProvider} = sdk;

  // Leave the call UI only — keep video_meeting_id so both sides can rejoin (web parity).
  const onRequestLeave = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    }
  }, [navigation]);

  return (
    <View style={[styles.shell, {paddingTop: insets.top}]}>
      <VideoErrorBoundary onClose={onRequestLeave}>
        <MeetingProvider
          config={{
            meetingId,
            micEnabled: true,
            webcamEnabled: true,
            name: participantName || 'Participant',
            multiStream: false,
            customCameraVideoTrack: preparedTracks?.videoTrack || undefined,
            customMicrophoneAudioTrack: preparedTracks?.audioTrack || undefined,
          }}
          token={token}
          joinWithoutUserInteraction={false}
          reinitialiseMeetingOnConfigChange={false}>
          <MeetingContent
            sdk={sdk}
            meetingId={meetingId}
            onRequestLeave={onRequestLeave}
            localDisplayName={participantName}
            remoteDisplayName={remoteParticipantName}
            roomClosed={roomClosed}
          />
        </MeetingProvider>
      </VideoErrorBoundary>
    </View>
  );
}

export default function ConsultationVideoCallScreen({navigation, route}) {
  const insets = useSafeAreaInsets();
  const {
    meetingId,
    token,
    participantName,
    remoteParticipantName,
    consultationRoomId,
  } = route.params || {};

  const [sdk, setSdk] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [preparedTracks, setPreparedTracks] = useState(null);
  const [tracksReady, setTracksReady] = useState(false);
  const [roomClosed, setRoomClosed] = useState(false);
  const trackCleanupRef = useRef(null);

  const handleClose = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    }
  }, [navigation]);

  useEffect(() => {
    if (!consultationRoomId) {
      return undefined;
    }
    const channel = supabase
      .channel(`video-room-close:${consultationRoomId}:${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'consultation_rooms',
          filter: `id=eq.${consultationRoomId}`,
        },
        payload => {
          if (payload?.new?.is_closed) {
            setRoomClosed(true);
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [consultationRoomId]);

  // Closed before the meeting UI mounted (still loading SDK / camera).
  useEffect(() => {
    if (roomClosed && (!sdk || !tracksReady)) {
      handleClose();
    }
  }, [roomClosed, sdk, tracksReady, handleClose]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mod = await import('@videosdk.live/react-native-sdk');
        await mod.register();
        if (!cancelled) {
          setSdk(mod);
        }
      } catch (e) {
        const raw = String(e?.message || e || '');
        let msg = raw;
        if (/webrtc|native module/i.test(raw) || Constants.appOwnership === 'expo') {
          msg = `${raw}\n\n${EXPO_GO_HINT}`;
        }
        if (!cancelled) {
          setLoadError(msg);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!sdk || !meetingId || !token) {
      return undefined;
    }

    let cancelled = false;
    setTracksReady(false);
    setPreparedTracks(null);

    (async () => {
      const [videoTrack, audioTrack] = await Promise.all([
        createPreferredCameraTrack(sdk, 'user'),
        createPreferredAudioTrack(sdk),
      ]);

      if (cancelled) {
        try {
          videoTrack?.stop?.();
        } catch {
          /* ignore */
        }
        try {
          audioTrack?.stop?.();
        } catch {
          /* ignore */
        }
        return;
      }

      trackCleanupRef.current = () => {
        try {
          videoTrack?.stop?.();
        } catch {
          /* ignore */
        }
        try {
          audioTrack?.stop?.();
        } catch {
          /* ignore */
        }
      };
      setPreparedTracks({videoTrack, audioTrack});
      setTracksReady(true);
    })();

    return () => {
      cancelled = true;
      if (typeof trackCleanupRef.current === 'function') {
        trackCleanupRef.current();
        trackCleanupRef.current = null;
      }
    };
  }, [sdk, meetingId, token]);

  const renderShell = children => (
    <View style={[styles.shell, {paddingTop: insets.top}]}>
      <VideoCallHeader onClose={handleClose} />
      <View style={styles.fallback}>{children}</View>
    </View>
  );

  if (!meetingId || !token) {
    return renderShell(
      <>
        <Text style={styles.errorText}>Missing video meeting or token.</Text>
        <TouchableOpacity style={styles.leaveBtn} onPress={handleClose}>
          <Text style={styles.leaveBtnText}>Go back</Text>
        </TouchableOpacity>
      </>,
    );
  }

  if (loadError) {
    return renderShell(
      <>
        <Text style={styles.errorText}>{loadError}</Text>
        <TouchableOpacity style={styles.leaveBtn} onPress={handleClose}>
          <Text style={styles.leaveBtnText}>Go back</Text>
        </TouchableOpacity>
      </>,
    );
  }

  if (!sdk || !tracksReady) {
    return renderShell(
      <>
        <ActivityIndicator size="large" color={T.gold[1]} />
        <Text style={styles.hint}>
          {!sdk ? 'Loading video…' : 'Preparing HD camera & microphone…'}
        </Text>
      </>,
    );
  }

  return (
    <VideoMeetingSession
      sdk={sdk}
      meetingId={meetingId}
      token={token}
      participantName={participantName}
      remoteParticipantName={remoteParticipantName}
      navigation={navigation}
      preparedTracks={preparedTracks}
      roomClosed={roomClosed}
    />
  );
}

const styles = StyleSheet.create({
  shell: {flex: 1, backgroundColor: T.base},
  fallback: {flex: 1, padding: 24, justifyContent: 'center'},
  meetingRoot: {flex: 1},
  vcHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(244,215,139,0.12)',
  },
  vcTitle: {color: T.text, fontSize: 15, fontWeight: '700', letterSpacing: 0.3},
  vcClose: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  vcCloseText: {color: T.textSoft, fontSize: 14, fontWeight: '700'},
  meetingIdLabel: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    color: T.textMuted,
    fontSize: 11,
    letterSpacing: 0.5,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  centerBox: {flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24},
  hint: {marginTop: 12, color: T.textSoft, textAlign: 'center'},
  errorText: {color: '#FCA5A5', textAlign: 'center', marginBottom: 16},
  stage: {
    flex: 1,
    backgroundColor: T.base,
    overflow: 'hidden',
  },
  remoteInner: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(12,19,30,0.98)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  remoteRtc: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  remoteLabelPill: {
    position: 'absolute',
    left: 12,
    bottom: 12,
    maxWidth: '75%',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  remoteLabel: {color: '#F9FAFB', fontSize: 12, fontWeight: '600'},
  remoteMicOff: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    padding: 4,
    borderRadius: 6,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  remoteAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  remoteInitial: {fontSize: 22, fontWeight: '700', color: '#fff', letterSpacing: 1},
  waitingText: {color: T.textMuted, fontSize: 15, textAlign: 'center', paddingHorizontal: 24},
  pipContainer: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    zIndex: 20,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'rgba(244,215,139,0.35)',
    backgroundColor: 'rgba(12,19,30,0.95)',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.45,
    shadowRadius: 8,
  },
  pipInner: {
    flex: 1,
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pipRtc: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  pipLabelPill: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    maxWidth: '80%',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  pipLabel: {color: '#F9FAFB', fontSize: 10, fontWeight: '600'},
  pipMicOff: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    padding: 2,
    borderRadius: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  pipAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pipInitial: {fontSize: 14, fontWeight: '700', color: '#fff'},
  placeholder: {justifyContent: 'center', alignItems: 'center'},
  extraRemoteHint: {
    position: 'absolute',
    left: 12,
    bottom: 12,
    zIndex: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  extraRemoteText: {color: T.textMuted, fontSize: 12, fontWeight: '600'},
  controls: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(244,215,139,0.12)',
    backgroundColor: 'rgba(4,7,11,0.92)',
  },
  ctrl: {
    minWidth: CTRL_HIT,
    minHeight: CTRL_HIT,
    width: CTRL_HIT,
    height: CTRL_HIT,
    borderRadius: CTRL_HIT / 2,
    marginHorizontal: 6,
    marginVertical: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(244,215,139,0.2)',
  },
  ctrlMuted: {
    backgroundColor: 'rgba(248,113,113,0.12)',
    borderColor: 'rgba(248,113,113,0.35)',
  },
  ctrlActive: {
    backgroundColor: 'rgba(244,215,139,0.18)',
    borderColor: 'rgba(244,215,139,0.45)',
  },
  ctrlDanger: {
    backgroundColor: '#EF4444',
    borderColor: '#EF4444',
  },
  leaveBtn: {
    marginTop: 8,
    backgroundColor: T.gold[1],
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 24,
    alignSelf: 'center',
  },
  leaveBtnText: {color: T.base, fontWeight: '800'},
});
