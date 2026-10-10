import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import {supabase} from '../services/supabaseClient';
import {parseNotificationImageUrl} from '../services/announcementImages';
import {stripNotificationMarkers} from '../services/notificationText';

// ─────────────────────────────────────────────────────────────────────────────
// Context definition
// ─────────────────────────────────────────────────────────────────────────────

const NotificationContext = createContext({
  notifications: [],
  unreadCount: 0,
  toast: null,           // normalized notification row | null
  dismissToast: () => {},
  markAllRead: () => {},
  markRead: (_id) => {},
  refresh: () => {},
});

export function useNotifications() {
  return useContext(NotificationContext);
}

function normalizeNotificationRow(item) {
  if (!item) return item;
  const payload = item.data && typeof item.data === 'object' ? item.data : {};
  const appointmentId =
    payload.appointment_id || payload.appointmentId || payload.appointment || null;
  return {
    ...item,
    body: stripNotificationMarkers(item.body),
    appointmentId: appointmentId ? String(appointmentId) : null,
    imageUrl: parseNotificationImageUrl(payload),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────────────────────

export function NotificationProvider({children}) {
  const [notifications, setNotifications] = useState([]);
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);
  const userIdRef = useRef(null);
  const channelRef = useRef(null);

  // ── helpers ───────────────────────────────────────────────────────────────
  const showToast = useCallback((notif) => {
    setToast(notif);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 5000);
  }, []);

  const dismissToast = useCallback(() => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(null);
  }, []);

  // ── fetch ─────────────────────────────────────────────────────────────────
  const fetchNotifications = useCallback(async (userId) => {
    if (!userId) return;
    const {data, error} = await supabase
      .from('notifications')
      .select('id, title, body, type, data, is_read, created_at')
      .eq('user_id', userId)
      .order('created_at', {ascending: false})
      .limit(50);

    if (!error && data) {
      setNotifications((data || []).map(normalizeNotificationRow));
    }
  }, []);

  // Public refresh (e.g. called when ClientNotification screen focuses)
  const refresh = useCallback(() => {
    if (userIdRef.current) fetchNotifications(userIdRef.current);
  }, [fetchNotifications]);

  // ── mark read ─────────────────────────────────────────────────────────────
  const markRead = useCallback(async (id) => {
    setNotifications(prev =>
      prev.map(n => (n.id === id ? {...n, is_read: true} : n)),
    );
    await supabase
      .from('notifications')
      .update({is_read: true, updated_at: new Date().toISOString()})
      .eq('id', id);
  }, []);

  const markAllRead = useCallback(async () => {
    if (!userIdRef.current) return;
    setNotifications(prev => prev.map(n => ({...n, is_read: true})));
    await supabase
      .from('notifications')
      .update({is_read: true, updated_at: new Date().toISOString()})
      .eq('user_id', userIdRef.current)
      .eq('is_read', false);
  }, []);

  // ── Supabase Realtime subscription ───────────────────────────────────────
  const subscribeRealtime = useCallback(
    (userId) => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }

      const ch = supabase
        .channel(`client-notifications-${userId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'notifications',
            filter: `user_id=eq.${userId}`,
          },
          (payload) => {
            const newNotif = normalizeNotificationRow(payload.new);
            if (!newNotif) return;
            setNotifications(prev => [newNotif, ...prev]);
            showToast(newNotif);
          },
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'notifications',
            filter: `user_id=eq.${userId}`,
          },
          (payload) => {
            const updated = payload.new;
            if (!updated) return;
            const normalized = normalizeNotificationRow(updated);
            setNotifications(prev =>
              prev.map(n => (n.id === normalized.id ? {...n, ...normalized} : n)),
            );
          },
        )
        .subscribe();

      channelRef.current = ch;
    },
    [showToast],
  );

  // ── Auth listener: set up on login, tear down on logout ──────────────────
  useEffect(() => {
    let cancelled = false;

    // INITIAL_SESSION fires on subscribe, so no separate getSession() bootstrap is needed.
    // Token refreshes keep the same user — skip refetch/resubscribe for those.
    const {data: authListener} = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (cancelled) return;
        const uid = session?.user?.id ?? null;
        if (uid && uid === userIdRef.current && channelRef.current) return;
        userIdRef.current = uid;
        if (uid) {
          fetchNotifications(uid);
          subscribeRealtime(uid);
        } else {
          setNotifications([]);
          if (channelRef.current) {
            supabase.removeChannel(channelRef.current);
            channelRef.current = null;
          }
        }
      },
    );

    return () => {
      cancelled = true;
      authListener?.subscription?.unsubscribe();
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, [fetchNotifications, subscribeRealtime]);

  const unreadCount = notifications.filter(n => !n.is_read).length;

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        toast,
        dismissToast,
        markAllRead,
        markRead,
        refresh,
      }}>
      {children}
    </NotificationContext.Provider>
  );
}
