import {useCallback, useEffect, useRef, useState} from 'react';
import {Alert} from 'react-native';
import {getCurrentSessionProfile} from '../services/userApi';
import {
  buildConsultationIncomingCallCopy,
  isConsultationCallSeen,
  joinConsultationRoom,
  markConsultationCallSeen,
} from '../services/consultationChatPresence';
import {startCallRinging, stopCallRinging} from '../services/callRinger';

const OTHER_ROLE = {client: 'attorney', attorney: 'client'};

/**
 * Messenger-style call alerts for a consultation chat screen: a ringing incoming-call popup
 * and decline/hang-up handling. Never joins a call by itself. Peer-entered notices are only
 * shown outside the chat (ConsultationPeerEntryHost); inside, the ONLINE header covers it.
 */
export default function useConsultationCallAlerts({
  appointmentId,
  role,
  otherPartyName,
  isFocused,
  chatOpen,
  joiningCall = false,
}) {
  const otherRole = OTHER_ROLE[role] || 'attorney';
  const [incomingCall, setIncomingCall] = useState(null);
  const [peer, setPeer] = useState(null);

  const roomRef = useRef(null);
  const peerRef = useRef(null);
  const ringKeyRef = useRef(null);
  const ringingRef = useRef(false);
  const selfInCallRef = useRef(false);
  const selfStartedMeetingIdRef = useRef(null);
  const knownMeetingIdRef = useRef(undefined);
  const focusedRef = useRef(isFocused);
  const chatOpenRef = useRef(chatOpen);
  const joiningCallRef = useRef(joiningCall);
  focusedRef.current = isFocused;
  chatOpenRef.current = chatOpen;
  joiningCallRef.current = joiningCall;

  const stopRinging = useCallback(() => {
    if (ringingRef.current) {
      ringingRef.current = false;
      stopCallRinging();
    }
    setIncomingCall(null);
  }, []);

  const startRinging = useCallback(
    (key, callStartedAt = null) => {
      if (ringKeyRef.current === key) return;
      if (callStartedAt && isConsultationCallSeen(appointmentId, callStartedAt)) {
        ringKeyRef.current = key;
        return;
      }
      if (joiningCallRef.current) {
        ringKeyRef.current = key;
        return;
      }
      if (!chatOpenRef.current || !focusedRef.current || selfInCallRef.current) return;
      ringKeyRef.current = key;
      if (callStartedAt) markConsultationCallSeen(appointmentId, callStartedAt);
      ringingRef.current = true;
      setIncomingCall(buildConsultationIncomingCallCopy({otherRole, otherPartyName}));
      startCallRinging(() => {
        ringingRef.current = false;
        setIncomingCall(null);
      });
    },
    [appointmentId, otherRole, otherPartyName],
  );

  useEffect(() => {
    if (!appointmentId || appointmentId === 'general-chat') return undefined;
    let cancelled = false;

    const handlePeerChange = (next, prev) => {
      peerRef.current = next;
      setPeer(next);

      if (next.inCall && next.callStartedAt) {
        const key = `presence:${next.callStartedAt}`;
        if (selfInCallRef.current) {
          ringKeyRef.current = key;
        } else if (!prev?.inCall || prev.callStartedAt !== next.callStartedAt) {
          startRinging(key, next.callStartedAt);
        }
      } else if (prev?.inCall || !next.present) {
        stopRinging();
      }
    };

    (async () => {
      const {profile} = await getCurrentSessionProfile();
      if (cancelled || !profile?.id) return;
      roomRef.current = joinConsultationRoom({
        appointmentId,
        role,
        userId: profile.id,
        displayName: profile.full_name,
        inChat: true,
        onPeerChange: handlePeerChange,
        onCallDeclined: payload => {
          const name = String(payload?.name || '').trim() || otherPartyName || 'The other party';
          Alert.alert('Call declined', `${name} declined the video call.`);
        },
      });
    })();

    return () => {
      cancelled = true;
      if (ringingRef.current) {
        ringingRef.current = false;
        stopCallRinging();
      }
      roomRef.current?.release();
      roomRef.current = null;
    };
  }, [appointmentId, role, otherRole, otherPartyName, startRinging, stopRinging]);

  // Back from the call screen: clear our in-call flag; ring if the other side is calling now.
  useEffect(() => {
    if (!isFocused) return;
    if (selfInCallRef.current) {
      selfInCallRef.current = false;
      roomRef.current?.setInCall(false);
    }
    const current = peerRef.current;
    if (current?.inCall && current.callStartedAt) {
      startRinging(`presence:${current.callStartedAt}`, current.callStartedAt);
    }
  }, [isFocused, startRinging]);

  useEffect(() => {
    if (!chatOpen) stopRinging();
  }, [chatOpen, stopRinging]);

  /** Call right before opening the video call screen (start or join). */
  const markSelfInCall = useCallback(
    ({startedMeetingId} = {}) => {
      if (startedMeetingId) selfStartedMeetingIdRef.current = startedMeetingId;
      selfInCallRef.current = true;
      roomRef.current?.setInCall(true);
      stopRinging();
    },
    [stopRinging],
  );

  /**
   * Web peers do not publish call state, so a new video_meeting_id from realtime is the
   * only signal that they started a call. Initial loads only record the known id.
   */
  const observeMeetingId = useCallback(
    (meetingId, {fromRealtime = false} = {}) => {
      const next = meetingId || null;
      const previous = knownMeetingIdRef.current;
      knownMeetingIdRef.current = next;
      if (!fromRealtime || !next || next === previous) return;
      if (next === selfStartedMeetingIdRef.current) return;
      if (peerRef.current?.reportsCallState) return;
      startRinging(`meeting:${next}`);
    },
    [startRinging],
  );

  const acceptIncomingCall = useCallback(() => {
    stopRinging();
  }, [stopRinging]);

  const declineIncomingCall = useCallback(() => {
    stopRinging();
    roomRef.current?.sendCallDeclined();
  }, [stopRinging]);

  /** Rejoin banner: only while the other party is actually in the call (web peers: legacy). */
  const isPeerCallActive = useCallback(
    meetingId => {
      if (!meetingId || !peer?.present) return false;
      return peer.reportsCallState ? peer.inCall : true;
    },
    [peer],
  );

  return {
    incomingCall,
    acceptIncomingCall,
    declineIncomingCall,
    markSelfInCall,
    observeMeetingId,
    isPeerCallActive,
  };
}
