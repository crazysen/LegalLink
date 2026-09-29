import React, {useCallback, useEffect, useRef, useState} from 'react';
import {AppState} from 'react-native';
import {getMyAppointments} from '../services/appointmentService';
import {
  dismissConsultationPeerEntry,
  getConsultationChatFocusedAppointmentId,
  subscribeConsultationPeerEntry,
} from '../services/consultationChatPresence';
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

export default function ConsultationPeerEntryHost() {
  const [entryPopup, setEntryPopup] = useState(null);
  const [navTick, setNavTick] = useState(0);
  const detachByAppointmentRef = useRef({});
  const watchTargetsRef = useRef([]);
  const roleRef = useRef('client');
  const userIdRef = useRef(null);

  useEffect(() => {
    if (!navigationRef.isReady()) {
      return undefined;
    }
    const unsubscribe = navigationRef.addListener('state', () => {
      setNavTick(t => t + 1);
    });
    return unsubscribe;
  }, []);

  const isViewingChat = useCallback(
    appointmentId =>
      getConsultationChatFocusedAppointmentId(navigationRef) === String(appointmentId),
    [navTick],
  );

  const refreshWatchers = useCallback(async () => {
    const routeName = navigationRef.getCurrentRoute?.()?.name;
    if (!routeName || AUTH_ROUTE_NAMES.has(routeName)) {
      Object.values(detachByAppointmentRef.current).forEach(detach => detach());
      detachByAppointmentRef.current = {};
      watchTargetsRef.current = [];
      return;
    }

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
    roleRef.current = role;
    userIdRef.current = profile.id;

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
    for (const [id, detach] of Object.entries(detachByAppointmentRef.current)) {
      if (!nextIds.has(id)) {
        detach();
        delete detachByAppointmentRef.current[id];
      }
    }

    watchTargetsRef.current = targets;

    targets.forEach(target => {
      if (detachByAppointmentRef.current[target.appointmentId]) {
        return;
      }
      detachByAppointmentRef.current[target.appointmentId] = subscribeConsultationPeerEntry({
        appointmentId: target.appointmentId,
        role,
        userId: profile.id,
        otherPartyName: target.otherPartyName,
        isViewingChat: () => isViewingChat(target.appointmentId),
        onPeerEntered: payload => {
          if (isViewingChat(target.appointmentId)) {
            return;
          }
          setEntryPopup({
            ...payload,
            navigateParams: target.navigateParams,
          });
        },
      });
    });
  }, [isViewingChat]);

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
    return () => {
      clearInterval(interval);
      sub.remove();
      Object.values(detachByAppointmentRef.current).forEach(detach => detach());
      detachByAppointmentRef.current = {};
    };
  }, [refreshWatchers, navTick]);

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

  return (
    <ConsultationWaitingPopup
      visible={Boolean(entryPopup)}
      title={entryPopup?.title}
      body={entryPopup?.body}
      showGoToChatroom
      onNotNow={handleNotNow}
      onGoToChatroom={handleGoToChatroom}
    />
  );
}
