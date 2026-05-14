import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  PermissionsAndroid,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Constants from 'expo-constants';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {REFERENCE_THEME as T} from '../constants/referenceTheme';
import {clearVideoMeetingId} from '../services/videoMeetingService';

const JOIN_TIMEOUT_MS = 30000;

const EXPO_GO_HINT =
  'Video calls need native WebRTC. Expo Go does not include it. Create a development build: npx expo prebuild then npx expo run:android (or run:ios), or use EAS Build.';

function ParticipantTile({sdk, participantId}) {
  const participant = sdk.useParticipant(participantId);
  const {webcamStream, webcamOn, displayName, isLocal} = participant || {};
  const {RTCView, MediaStream} = sdk;

  if (webcamOn && webcamStream?.track) {
    const stream = new MediaStream([webcamStream.track]);
    return (
      <View style={styles.tile}>
        <RTCView
          objectFit="cover"
          style={styles.rtc}
          streamURL={stream.toURL()}
          mirror={Boolean(isLocal)}
        />
        <Text style={styles.tileLabel} numberOfLines={1}>
          {displayName || 'Participant'}
          {isLocal ? ' (You)' : ''}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.tile, styles.tilePlaceholder]}>
      <Text style={styles.placeholderInitial}>
        {(displayName || '?')
          .split(/\s+/)
          .filter(Boolean)
          .map(p => p[0])
          .join('')
          .slice(0, 2)
          .toUpperCase()}
      </Text>
      <Text style={styles.tileLabel} numberOfLines={1}>
        {displayName || 'Participant'}
      </Text>
    </View>
  );
}

function MeetingContent({sdk, meetingId, onRequestLeave}) {
  const {useMeeting} = sdk;
  const [joinState, setJoinState] = useState('JOINING');
  const [joinError, setJoinError] = useState('');
  const joinedRef = useRef(false);
  const timeoutRef = useRef(null);
  const finishedRef = useRef(false);

  const finishSession = useCallback(() => {
    if (finishedRef.current) {
      return;
    }
    finishedRef.current = true;
    onRequestLeave();
  }, [onRequestLeave]);

  const {join, leave, participants, toggleMic, toggleWebcam, localMicOn, localWebcamOn} = useMeeting({
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

  const participantIds = [...(participants?.keys?.() ?? [])];

  return (
    <View style={styles.meetingRoot}>
      <Text style={styles.meetingIdLabel} numberOfLines={1}>
        Meeting: {meetingId}
      </Text>

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
          <ScrollView style={styles.participantScroll} contentContainerStyle={styles.gridPad}>
            {participantIds.map(pid => (
              <ParticipantTile key={pid} sdk={sdk} participantId={pid} />
            ))}
          </ScrollView>
          <View style={styles.controls}>
            <TouchableOpacity
              style={[styles.ctrl, !(localMicOn ?? true) && styles.ctrlMuted]}
              onPress={() => toggleMic?.()}>
              <Text style={styles.ctrlText}>{localMicOn ?? true ? 'Mute' : 'Unmute'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.ctrl, !(localWebcamOn ?? true) && styles.ctrlMuted]}
              onPress={() => toggleWebcam?.()}>
              <Text style={styles.ctrlText}>{localWebcamOn ?? true ? 'Stop cam' : 'Start cam'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.ctrl, styles.ctrlDanger]} onPress={handleLeave}>
              <Text style={styles.ctrlDangerText}>Leave</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}

function VideoMeetingSession({sdk, meetingId, token, participantName, consultationRoomId, navigation}) {
  const insets = useSafeAreaInsets();
  const {MeetingProvider} = sdk;

  const onRequestLeave = useCallback(async () => {
    await clearVideoMeetingId(consultationRoomId);
    if (navigation.canGoBack()) {
      navigation.goBack();
    }
  }, [consultationRoomId, navigation]);

  return (
    <View style={[styles.shell, {paddingTop: insets.top, paddingBottom: insets.bottom}]}>
      <MeetingProvider
        config={{
          meetingId,
          micEnabled: true,
          webcamEnabled: true,
          name: participantName || 'Participant',
          multiStream: true,
        }}
        token={token}
        joinWithoutUserInteraction={false}
        reinitialiseMeetingOnConfigChange={false}>
        <MeetingContent sdk={sdk} meetingId={meetingId} onRequestLeave={onRequestLeave} />
      </MeetingProvider>
    </View>
  );
}

export default function ConsultationVideoCallScreen({navigation, route}) {
  const insets = useSafeAreaInsets();
  const {meetingId, token, participantName, consultationRoomId} = route.params || {};

  const [sdk, setSdk] = useState(null);
  const [loadError, setLoadError] = useState(null);

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

  if (!sdk) {
    return (
      <View style={[styles.fallback, {paddingTop: insets.top + 48}]}>
        <ActivityIndicator size="large" color={T.gold[1]} />
        <Text style={styles.hint}>Loading video…</Text>
      </View>
    );
  }

  return (
    <VideoMeetingSession
      sdk={sdk}
      meetingId={meetingId}
      token={token}
      participantName={participantName}
      consultationRoomId={consultationRoomId}
      navigation={navigation}
    />
  );
}

const styles = StyleSheet.create({
  shell: {flex: 1, backgroundColor: T.base},
  fallback: {flex: 1, padding: 24, justifyContent: 'center'},
  meetingRoot: {flex: 1},
  meetingIdLabel: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    color: T.textMuted,
    fontSize: 12,
  },
  centerBox: {flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24},
  hint: {marginTop: 12, color: T.textSoft, textAlign: 'center'},
  errorText: {color: '#FCA5A5', textAlign: 'center', marginBottom: 16},
  participantScroll: {flex: 1},
  tile: {
    width: '100%',
    minHeight: 200,
    maxHeight: 360,
    marginVertical: 6,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: 'rgba(12,19,30,0.95)',
    borderWidth: 1,
    borderColor: 'rgba(244,215,139,0.15)',
  },
  tilePlaceholder: {justifyContent: 'center', alignItems: 'center'},
  rtc: {flex: 1, width: '100%', minHeight: 140},
  tileLabel: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    right: 8,
    color: T.text,
    fontSize: 12,
    fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.75)',
    textShadowOffset: {width: 0, height: 1},
    textShadowRadius: 3,
  },
  placeholderInitial: {fontSize: 32, fontWeight: '800', color: T.gold[0]},
  gridPad: {padding: 8, paddingBottom: 24},
  controls: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(244,215,139,0.12)',
  },
  ctrl: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 24,
    marginHorizontal: 5,
    marginVertical: 4,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(244,215,139,0.2)',
  },
  ctrlMuted: {opacity: 0.7},
  ctrlDanger: {backgroundColor: 'rgba(220,38,38,0.25)', borderColor: 'rgba(248,113,113,0.5)'},
  ctrlText: {color: T.text, fontWeight: '700', fontSize: 13},
  ctrlDangerText: {color: '#FECACA', fontWeight: '800', fontSize: 13},
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
