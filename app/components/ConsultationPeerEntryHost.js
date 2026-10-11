import React, {useCallback, useEffect, useRef, useState} from 'react';
import {AppState} from 'react-native';
import {getMyAppointments} from '../services/appointmentService';
import {
  buildConsultationIncomingCallCopy,
  buildConsultationWaitingCopy,
  dismissConsultationPeerEntry,
  getConsultationChatFocusedAppointmentId,
  isConsultationCallSeen,
  isConsultationPeerEntryDismissed,
  isOnVideoCallScreen,
  joinConsultationRoom,
  markConsultationCallSeen,
} from '../services/consultationChatPresence';
import {startCallRinging, stopCallRinging, vibrateNotice} from '../services/callRinger';
import {
  fetchAttorneyUpcomingAppointments,
  getCurrentSessionProfile,
  isConsultationChatWindowOpen,
} from '../services/userApi';
import {navigationRef} from '../navigation/navigationRef';
import ConsultationWaitingPopup from './ConsultationWaitingPopup';

const AUTH_ROUTE_NAMES = new Set([
  'Landing',
  'LoginSignup',
  'Login',
  'CreateProfile',
  'VerifyAccount',
  'AccountCreated',
  'ResetPassword',
]);

const REFRESH_MS = 45000;
const NAV_REFRESH_MIN_GAP_MS = 10000;

function isWatchableClientRow(item) {
  const status = String(item?.status || '').toLowerCase();
  if (!['confirmed', 'rescheduled', 'completed'].includes(status)) {
    return false;
  }
  if (item?.chatAccessible === false) {
    return false;
  }
  return isConsultationChatWindowOpen({
    status: item.status,
    scheduledAt: item.scheduledAt || item.date,
    slotDate: item.slotDate,
    slotTime: item.slotTime,
    paymentStatus: item.payment_is_paid ? 'paid' : item.payment,
  });
}

function isWatchableAttorneyRow(item) {
  const status = String(item?.status || '').toLowerCase();
  if (!['confirmed', 'rescheduled', 'completed'].includes(status)) {
    return false;
  }
  return isConsultationChatWindowOpen({
    status: item.status,
    scheduledAt: item.scheduledAt,
    slotDate: item.slotDate,
    slotTime: item.slotTime,
    paymentStatus: item.paymentStatus,
  });
}

function isBusyWithAppointment(appointmentId) {
  return (
    getConsultationChatFocusedAppointmentId(navigationRef) === String(appointmentId) ||
    isOnVideoCallScreen(navigationRef)
  );
}

/**
 * App-wide alerts while the user is outside the consultation chat: the other party
 * entering the chatroom, and Messenger-style ringing when they start a video call.
 */
export default function ConsultationPeerEntryHost() {
  const [entryPopup, setEntryPopup] = useState(null);
  const [callPopup, setCallPopup] = useState(null);
  const roomsRef = useRef({});
  const notifiedRef = useRef(new Set());
  const lastRefreshAtRef = useRef(0);
  const callPopupRef = useRef(null);
  callPopupRef.current = callPopup;
  const entryPopupRef = useRef(null);
  entryPopupRef.current = entryPopup;

  const closeCallPopup = useCallback(() => {
    stopCallRinging();
    setCallPopup(null);
  }, []);

  const handlePeerChange = useCallback(
    (target, role, peer, prev) => {
      const {appointmentId, otherPartyName} = target;
      const otherRole = role === 'attorney' ? 'client' : 'attorney';

      if (!peer.inCall && callPopupRef.current?.appointmentId === appointmentId) {
        closeCallPopup();
      }
      if (isBusyWithAppointment(appointmentId)) {
        return;
      }

      if (peer.inCall && peer.callStartedAt) {
        if (!isConsultationCallSeen(appointmentId, peer.callStartedAt)) {
          markConsultationCallSeen(appointmentId, peer.callStartedAt);
          setEntryPopup(null);
          setCallPopup({
            ...buildConsultationIncomingCallCopy({otherRole, otherPartyName}),
            appointmentId,
            navigateParams: target.navigateParams,
          });
          startCallRinging(() => setCallPopup(null));
        }
        return;
      }

      const joinedNow =
        peer.inChat && peer.joinedAt && (!prev || !prev.inChat || prev.joinedAt !== peer.joinedAt);
      if (!joinedNow) return;
      const joinKey = `join:${appointmentId}:${peer.joinedAt}`;
      if (
        notifiedRef.current.has(joinKey) ||
        isConsultationPeerEntryDismissed(appointmentId, peer.joinedAt)
      ) {
        return;
      }
      notifiedRef.current.add(joinKey);
      setEntryPopup({
        ...buildConsultationWaitingCopy({otherRole, otherPartyName}),
        appointmentId,
        otherJoinedAt: peer.joinedAt,
        navigateParams: target.navigateParams,
      });
      vibrateNotice();
    },
    [closeCallPopup],
  );

  const detachAll = useCallback(() => {
    Object.values(roomsRef.current).forEach(entry => entry.room.release());
    roomsRef.current = {};
  }, []);

  const refreshWatchers = useCallback(async () => {
    const routeName = navigationRef.getCurrentRoute?.()?.name;
    if (!routeName || AUTH_ROUTE_NAMES.has(routeName)) {
      detachAll();
      return;
    }
    lastRefreshAtRef.current = Date.now();

    let profile;
    try {
      const session = await getCurrentSessionProfile();
      profile = session?.profile;
    } catch {
      return;
    }
    if (!profile?.id) {
      return;
    }

    const role =
      String(profile.role || '').toLowerCase() === 'attorney' ? 'attorney' : 'client';

    let targets = [];
    try {
      if (role === 'attorney') {
        const rows = await fetchAttorneyUpcomingAppointments(profile.id, {force: true});
        targets = (rows || [])
          .filter(isWatchableAttorneyRow)
          .slice(0, 12)
          .map(item => ({
            appointmentId: String(item.id),
            otherPartyName: item.name || 'Client',
            navigateParams: {
              screen: 'AttyConsultationMessage',
              params: {
                chatId: item.id,
                clientName: item.name || 'Client',
                clientInitials: item.initials || 'CL',
              },
            },
          }));
      } else {
        const rows = await getMyAppointments({force: true});
        targets = (rows || [])
          .filter(isWatchableClientRow)
          .slice(0, 12)
          .map(item => {
            const name = item.attorney_name || item.name || 'Attorney';
            return {
              appointmentId: String(item.id),
              otherPartyName: name,
              navigateParams: {
                screen: 'EnterConsultationChat',
                params: {
                  chatId: item.id,
                  chatName: name,
                  initials: name
                    .split(' ')
                    .filter(Boolean)
                    .map(part => part[0])
                    .join('')
                    .slice(0, 2)
                    .toUpperCase(),
                },
              },
            };
          });
      }
    } catch {
      return;
    }

    const nextIds = new Set(targets.map(t => t.appointmentId));
    for (const [id, entry] of Object.entries(roomsRef.current)) {
      if (!nextIds.has(id) || entry.userId !== profile.id) {
        entry.room.release();
        delete roomsRef.current[id];
      }
    }

    targets.forEach(target => {
      const existing = roomsRef.current[target.appointmentId];
      if (existing) {
        existing.target = target;
        return;
      }
      const entry = {target, userId: profile.id, room: null};
      entry.room = joinConsultationRoom({
        appointmentId: target.appointmentId,
        role,
        userId: profile.id,
        displayName: profile.full_name,
        onPeerChange: (peer, prev) => handlePeerChange(entry.target, role, peer, prev),
      });
      roomsRef.current[target.appointmentId] = entry;
    });
  }, [detachAll, handlePeerChange]);

  useEffect(() => {
    refreshWatchers().catch(() => {});
    const interval = setInterval(() => {
      refreshWatchers().catch(() => {});
    }, REFRESH_MS);
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') {
        refreshWatchers().catch(() => {});
      }
    });
    const unsubscribeNav = navigationRef.addListener('state', () => {
      const routeName = navigationRef.getCurrentRoute?.()?.name;
      const popupAppointmentId = entryPopupRef.current?.appointmentId;
      if (popupAppointmentId && isBusyWithAppointment(popupAppointmentId)) {
        setEntryPopup(null);
      }
      if (!routeName || AUTH_ROUTE_NAMES.has(routeName)) {
        detachAll();
      } else if (
        Object.keys(roomsRef.current).length === 0 &&
        Date.now() - lastRefreshAtRef.current > NAV_REFRESH_MIN_GAP_MS
      ) {
        refreshWatchers().catch(() => {});
      }
    });
    return () => {
      clearInterval(interval);
      sub.remove();
      unsubscribeNav();
      stopCallRinging();
      detachAll();
    };
  }, [refreshWatchers, detachAll]);

  const handleNotNow = () => {
    if (entryPopup?.appointmentId) {
      dismissConsultationPeerEntry(entryPopup.appointmentId, entryPopup.otherJoinedAt);
    }
    setEntryPopup(null);
  };

  const handleGoToChatroom = () => {
    const target = entryPopup?.navigateParams;
    if (target && navigationRef.isReady()) {
      navigationRef.navigate(target.screen, target.params);
    }
    setEntryPopup(null);
  };

  const handleDeclineCall = () => {
    const appointmentId = callPopup?.appointmentId;
    if (appointmentId) {
      roomsRef.current[appointmentId]?.room.sendCallDeclined();
    }
    closeCallPopup();
  };

  const handleJoinCall = () => {
    const target = callPopup?.navigateParams;
    closeCallPopup();
    if (target && navigationRef.isReady()) {
      navigationRef.navigate(target.screen, {...target.params, joinCall: true});
    }
  };

  return (
    <>
      <ConsultationWaitingPopup
        visible={Boolean(entryPopup) && !callPopup}
        title={entryPopup?.title}
        body={entryPopup?.body}
        showGoToChatroom
        onNotNow={handleNotNow}
        onGoToChatroom={handleGoToChatroom}
      />
      <ConsultationWaitingPopup
        visible={Boolean(callPopup)}
        title={callPopup?.title}
        body={callPopup?.body}
        showGoToChatroom
        goToChatroomLabel="Join"
        notNowLabel="Decline"
        onNotNow={handleDeclineCall}
        onGoToChatroom={handleJoinCall}
      />
    </>
  );
}
