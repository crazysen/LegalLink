import * as Linking from 'expo-linking';
import {getStateFromPath} from '@react-navigation/native';
import {stashPendingDeepLinkIfNeeded} from './pendingDeepLink';
import {supabase} from '../services/supabaseClient';

const linkingScreens = {
  Landing: '',
  LoginSignup: 'signup',
  Login: 'login',
  ResetPassword: 'reset-password',
  HomepageClient: 'client/home-logged',
  BookAppointment: 'client/book-appointment',
  ClientSupportMessages: 'client/support-messages',
  MyAppointments: 'client/my-appointments',
  ProfileSettingsClient: 'client/profile',
  Messages: 'client/messages',
  EnterConsultationChat: {
    path: 'client/chat-room',
    parse: {
      chatId: id => id || '',
      chatName: n => n || 'Attorney',
      initials: i => i || 'AT',
    },
  },
  ClientNotification: 'client/announcements',
  ClientAnnouncementDetail: 'client/announcement',
  TransactionHistory: 'client/transaction-history',
  ClientConsultationLogs: 'client/client-logs',
  ClientNotaryStatus: 'client/client-notary-tracking',
  ClientNotarial: 'client/notarial-request',
  Chatbot: 'client/chatbot',
  AttyLandingPage: 'attorney/attorney-home',
  AttyConsultationRequests: 'attorney/consultation-requests',
  AttyMyAppointments: 'attorney/upcoming-appointments',
  AttyAvailabilityManager: 'attorney/manage-availability',
  AttorneyConsultationLogs: 'attorney/attorney-logs',
  AttyConsultationMessage: {
    path: 'attorney/attorney-messages',
    parse: {
      chatId: id => id || 'general-chat',
      clientName: n => n || 'Client',
      clientInitials: i => i || 'CL',
    },
  },
  AttyAnalytics: 'attorney/attorney-analytics',
  AttyProfileSettings: 'attorney/attorney-profile',
  AttyAnnouncements: 'attorney/attorney-announcements',
};

const linkingConfig = {
  screens: linkingScreens,
};

async function hasAuthSession() {
  const {
    data: {session},
  } = await supabase.auth.getSession();
  return Boolean(session?.user);
}

function rewritePathForWebParity(path) {
  return String(path || '').replace(/^\/+/, '');
}

/**
 * React Navigation linking aligned with web `page` ids (april_13_new).
 */
export function createAppLinking() {
  return {
    prefixes: [Linking.createURL('/'), 'legallinkapp://'],
    config: linkingConfig,
    getStateFromPath(path, options) {
      const normalized = rewritePathForWebParity(path);
      return getStateFromPath(normalized, {
        ...options,
        screens: linkingScreens,
      });
    },
    async getInitialURL() {
      const url = await Linking.getInitialURL();
      if (!url) {
        return null;
      }
      const authed = await hasAuthSession();
      if (authed) {
        return url;
      }
      await stashPendingDeepLinkIfNeeded(url, authed);
      return null;
    },
    subscribe(listener) {
      const subscription = Linking.addEventListener('url', async event => {
        const {url} = event;
        if (!url) {
          return;
        }
        const authed = await hasAuthSession();
        await stashPendingDeepLinkIfNeeded(url, authed);
        if (authed) {
          listener(url);
        }
      });
      return () => subscription.remove();
    },
  };
}
