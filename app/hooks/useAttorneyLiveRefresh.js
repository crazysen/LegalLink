import {useCallback, useEffect, useRef} from 'react';
import {useFocusEffect} from '@react-navigation/native';
import {
  subscribeToAttorneyAppointments,
  subscribeToAttorneyNotifications,
} from '../services/userApi';

/**
 * Refetch on screen focus, periodic poll, and Supabase realtime (web parity).
 */
export function useAttorneyLiveRefresh({attorneyId, reload, pollMs = 12000, enabled = true}) {
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  const runReload = useCallback((options = {}) => {
    reloadRef.current?.(options);
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!enabled) return undefined;

      // Always bootstrap on focus: reload resolves the session and sets attorneyId.
      // Previously we gated on attorneyId, which stayed null forever (chicken-and-egg).
      runReload({force: true});

      if (!attorneyId) return undefined;

      const pollId = setInterval(() => runReload({silent: true}), pollMs);
      const unsubAppts = subscribeToAttorneyAppointments(attorneyId, () =>
        runReload({silent: true}),
      );
      const unsubNotifs = subscribeToAttorneyNotifications(attorneyId, () =>
        runReload({silent: true}),
      );
      return () => {
        clearInterval(pollId);
        unsubAppts();
        unsubNotifs();
      };
    }, [attorneyId, enabled, pollMs, runReload]),
  );
}
