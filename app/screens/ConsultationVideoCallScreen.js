import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  PermissionsAndroid,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import Constants from 'expo-constants';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {MaterialCommunityIcons} from '@expo/vector-icons';
import InCallManager from '@videosdk.live/react-native-incallmanager';
import {REFERENCE_THEME as T} from '../constants/referenceTheme';
import {clearVideoMeetingId} from '../services/videoMeetingService';

const JOIN_TIMEOUT_MS = 30000;
const CTRL_HIT = 48;

/**
 * Force loudspeaker vs earpiece using VideoSDK InCallManager device selection.
 * Prefer chooseAudioRoute / switchAudioDevice (maps to native selectAudioDevice);
 * setForceSpeakerphoneOn alone is unreliable on newer Android when auto-routing fights it.
 */
async function applyVideoCallAudioRoute(speakerEnabled) {
  const route = speakerEnabled ? 'SPEAKER_PHONE' : 'EARPIECE';
  try {
    if (typeof InCallManager.chooseAudioRoute === 'function') {
      await InCallManager.chooseAudioRoute(route);
    }
  } catch (err) {
    console.warn('[video] chooseAudioRoute failed', err?.message || err);
  }

  try {
    if (typeof InCallManager.switchAudioDevice === 'function') {
      await InCallManager.switchAudioDevice(route);
    }
  } catch (err) {
    console.warn('[video] switchAudioDevice failed', err?.message || err);
  }

  try {
    // iOS uses this path; Android also updates forceSpeakerOn + selectAudioDevice.
    InCallManager.setForceSpeakerphoneOn(Boolean(speakerEnabled));
    if (Platform.OS === 'android') {
      InCallManager.setSpeakerphoneOn(Boolean(speakerEnabled));
    }
  } catch (err) {
    console.warn('[video] setForceSpeakerphoneOn failed', err?.message || err);
  }

  try {
    if (speakerEnabled) {
      InCallManager.stopProximitySensor?.();
    } else {
      InCallManager.startProximitySensor?.();
    }
  } catch {
    /* proximity optional */
  }
}

const PIP_WIDTH = 112;
const PIP_ASPECT = 16 / 9;

const EXPO_GO_HINT =
  'Video calls need native WebRTC. Expo Go does not include it. Create a development build: npx expo prebuild then npx expo run:android (or run:ios), or use EAS Build.';

function ParticipantVideo({sdk, participantId, label, variant}) {
  const participant = sdk.useParticipant(participantId);
  const {webcamStream, webcamOn, displayName, isLocal} = participant || {};
  const {RTCView, MediaStream} = sdk;

  const tileLabel = label || displayName || (isLocal ? 'You' : 'Participant');
  const isPip = variant === 'pip';
  const videoStyle = isPip ? styles.pipRtc : styles.remoteRtc;
  const containerStyle = isPip ? styles.pipInner : styles.remoteInner;

  if (webcamOn && webcamStream?.track) {
    const stream = new MediaStream([webcamStream.track]);
    return (
      <View style={containerStyle}>
        <RTCView
          objectFit="cover"
          style={videoStyle}
          streamURL={stream.toURL()}
          mirror={Boolean(isLocal)}
          zOrder={isPip ? 1 : 0}
        />
        <Text style={isPip ? styles.pipLabel : styles.remoteLabel} numberOfLines={1}>
          {tileLabel}
          {isLocal ? ' (You)' : ''}
        </Text>
      </View>
    );
  }

  return (
    <View style={[containerStyle, styles.placeholder]}>
      <Text style={isPip ? styles.pipInitial : styles.remoteInitial}>
        {(tileLabel || '?')
          .split(/\s+/)
          .filter(Boolean)
          .map(p => p[0])
          .join('')
          .slice(0, 2)
          .toUpperCase()}
      </Text>
      <Text style={isPip ? styles.pipLabel : styles.remoteLabel} numberOfLines={1}>
        {tileLabel}
        {isLocal ? ' (You)' : ''}
      </Text>
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
  const primaryRemoteId = remoteIds[0] ?? null;

  return (
    <View style={styles.stage}>
      {participantIds.map(pid => (
        <ParticipantRoleReporter key={`role-${pid}`} sdk={sdk} participantId={pid} onRole={reportRole} />
      ))}

      {primaryRemoteId ? (
        <ParticipantVideo
          sdk={sdk}
          participantId={primaryRemoteId}
          label={remoteDisplayName}
          variant="remote"
        />
      ) : (
        <View style={styles.remoteInner}>
          <Text style={styles.waitingText}>Waiting for the other participant…</Text>
        </View>
      )}

      {localId ? (
        <View style={[styles.pipContainer, {width: PIP_WIDTH, height: pipHeight}]}>
          <ParticipantVideo
            sdk={sdk}
            participantId={localId}
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

function MeetingContent({sdk, meetingId, onRequestLeave, localDisplayName, remoteDisplayName}) {
  const {useMeeting} = sdk;
  const insets = useSafeAreaInsets();
  const {width: windowWidth, height: windowHeight} = useWindowDimensions();
  const isPortraitLayout = windowHeight >= windowWidth;

  const [joinState, setJoinState] = useState('JOINING');
  const [joinError, setJoinError] = useState('');
  const [speakerOn, setSpeakerOn] = useState(true);
  const joinedRef = useRef(false);
  const timeoutRef = useRef(null);
  const finishedRef = useRef(false);
  const facingModeRef = useRef('front');
  const audioStartedRef = useRef(false);

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
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      setJoinState('JOINED');
    },
    onMeetingLeft: () => {
      finishSession();
    },
    onError: err => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      const msg =
        err && (err.message || err.code) ? String(err.message || err.code) : 'Failed to connect to the video call.';
      setJoinError(msg);
      setJoinState('ERROR');
    },
  });

  useEffect(() => {
    if (joinState !== 'JOINED') {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        if (!audioStartedRef.current) {
          audioStartedRef.current = true;
          // auto: false so automatic route selection does not override the speaker toggle.
          InCallManager.start({media: 'video', auto: false});
        }
        if (!cancelled) {
          await applyVideoCallAudioRoute(speakerOn);
        }
      } catch (err) {
        console.warn('[video] InCallManager audio setup failed', err?.message || err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [joinState, speakerOn]);

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

      timeoutRef.current = setTimeout(() => {
        setJoinState(prev => {
          if (prev === 'JOINING') {
            setJoinError('Connection timed out. Check your network and try again.');
            return 'ERROR';
          }
          return prev;
        });
      }, JOIN_TIMEOUT_MS);

      join();
    })();

    return () => {
      cancelled = true;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLeave = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    try {
      leave();
    } catch {
      /* ignore */
    }
    finishSession();
  }, [leave, finishSession]);

  const handleToggleSpeaker = useCallback(() => {
    setSpeakerOn(prev => {
      const next = !prev;
      applyVideoCallAudioRoute(next).catch(err => {
        console.warn('[video] speaker toggle failed', err?.message || err);
      });
      return next;
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
    <View style={[styles.meetingRoot, isPortraitLayout && styles.meetingRootPortrait]}>
      {joinState !== 'JOINED' && (
        <Text style={styles.meetingIdLabel} numberOfLines={1}>
          Meeting: {meetingId}
        </Text>
      )}

      {(joinState === 'JOINING' || joinState === 'IDLE') && (
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color={T.gold[1]} />
          <Text style={styles.hint}>Connecting…</Text>
        </View>
      )}

      {joinState === 'ERROR' && (
        <View style={styles.centerBox}>
          <Text style={styles.errorText}>{joinError}</Text>
          <TouchableOpacity style={styles.leaveBtn} onPress={handleLeave}>
            <Text style={styles.leaveBtnText}>Close</Text>
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
              <MaterialCommunityIcons name="phone-hangup" size={24} color="#F87171" />
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
  consultationRoomId,
  navigation,
  preparedTracks,
}) {
  const insets = useSafeAreaInsets();
  const {MeetingProvider} = sdk;

  const onRequestLeave = useCallback(async () => {
    await clearVideoMeetingId(consultationRoomId);
    if (navigation.canGoBack()) {
      navigation.goBack();
    }
  }, [consultationRoomId, navigation]);

  return (
    <View style={[styles.shell, {paddingTop: insets.top}]}>
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
        />
      </MeetingProvider>
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
  const trackCleanupRef = useRef(null);

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

  if (!meetingId || !token) {
    return (
      <View style={[styles.fallback, {paddingTop: insets.top + 24}]}>
        <Text style={styles.errorText}>Missing video meeting or token.</Text>
        <TouchableOpacity style={styles.leaveBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.leaveBtnText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={[styles.fallback, {paddingTop: insets.top + 24, paddingHorizontal: 20}]}>
        <Text style={styles.errorText}>{loadError}</Text>
        <TouchableOpacity style={styles.leaveBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.leaveBtnText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!sdk || !tracksReady) {
    return (
      <View style={[styles.fallback, {paddingTop: insets.top + 48}]}>
        <ActivityIndicator size="large" color={T.gold[1]} />
        <Text style={styles.hint}>
          {!sdk ? 'Loading video…' : 'Preparing camera…'}
        </Text>
      </View>
    );
  }

  return (
    <VideoMeetingSession
      sdk={sdk}
      meetingId={meetingId}
      token={token}
      participantName={participantName}
      remoteParticipantName={remoteParticipantName}
      consultationRoomId={consultationRoomId}
      navigation={navigation}
      preparedTracks={preparedTracks}
    />
  );
}

const styles = StyleSheet.create({
  shell: {flex: 1, backgroundColor: T.base},
  fallback: {flex: 1, padding: 24, justifyContent: 'center'},
  meetingRoot: {flex: 1},
  meetingRootPortrait: {flex: 1},
  meetingIdLabel: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    color: T.textMuted,
    fontSize: 12,
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
  remoteLabel: {
    position: 'absolute',
    left: 16,
    bottom: 16,
    right: 16,
    color: T.text,
    fontSize: 13,
    fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.75)',
    textShadowOffset: {width: 0, height: 1},
    textShadowRadius: 3,
  },
  remoteInitial: {fontSize: 48, fontWeight: '800', color: T.gold[0]},
  waitingText: {color: T.textMuted, fontSize: 15, textAlign: 'center', paddingHorizontal: 24},
  pipContainer: {
    position: 'absolute',
    top: 12,
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
  pipLabel: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    right: 6,
    color: T.text,
    fontSize: 10,
    fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.75)',
    textShadowOffset: {width: 0, height: 1},
    textShadowRadius: 2,
  },
  pipInitial: {fontSize: 22, fontWeight: '800', color: T.gold[0]},
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
    backgroundColor: 'rgba(220,38,38,0.28)',
    borderColor: 'rgba(248,113,113,0.55)',
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
