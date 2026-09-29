/**
 * Canonical route IDs align with github.com/rxasrn/april_13_new `src/App.js` `page` state.
 * Notary-related web pages are excluded from deep-link / cross-nav helpers.
 */

/** @type {Set<string>} */
export const NOTARY_WEB_PAGES = new Set([
  'notarial-request',
  'my-notarial-requests',
  'notarial-requests-atty',
  'admin-notarial',
]);

const CLIENT_WEB_TO_SCREEN = {
  'home-logged': 'HomepageClient',
  'book-appointment': 'BookAppointment',
  'my-appointments': 'MyAppointments',
  profile: 'ProfileSettingsClient',
  'chat-room': 'Messages',
  'support-messages': 'ClientSupportMessages',
  announcements: 'ClientNotification',
  'transaction-history': 'TransactionHistory',
  'client-logs': 'ClientConsultationLogs',
  'client-notary-tracking': 'ClientNotaryStatus',
};

const ATTORNEY_WEB_TO_SCREEN = {
  'attorney-home': 'AttyLandingPage',
  'consultation-requests': 'AttyConsultationRequests',
  'upcoming-appointments': 'AttyMyAppointments',
  'manage-availability': 'AttyAvailabilityManager',
  'attorney-logs': 'AttorneyConsultationLogs',
  'attorney-messages': 'AttyConsultationMessage',
  'attorney-analytics': 'AttyAnalytics',
  'attorney-profile': 'AttyProfileSettings',
  'attorney-announcements': 'AttyAnnouncements',
};

export const WEB_CLIENT_PAGES = Object.freeze(Object.keys(CLIENT_WEB_TO_SCREEN));
export const WEB_ATTORNEY_PAGES = Object.freeze(Object.keys(ATTORNEY_WEB_TO_SCREEN));

/** Reverse lookup for analytics / logging */
const SCREEN_TO_WEB_CLIENT = {};
for (const [web, screen] of Object.entries(CLIENT_WEB_TO_SCREEN)) {
  if (!SCREEN_TO_WEB_CLIENT[screen]) {
    SCREEN_TO_WEB_CLIENT[screen] = web;
  }
}
const SCREEN_TO_WEB_ATTORNEY = {};
for (const [web, screen] of Object.entries(ATTORNEY_WEB_TO_SCREEN)) {
  if (!SCREEN_TO_WEB_ATTORNEY[screen]) {
    SCREEN_TO_WEB_ATTORNEY[screen] = web;
  }
}

/**
 * @param {string} roleText 'Client' | 'Attorney' | 'Admin' | ''
 * @returns {'Client'|'Attorney'|'Admin'}
 */
export function normalizeRole(roleText) {
  const r = String(roleText || '').toLowerCase();
  if (r === 'attorney') return 'Attorney';
  if (r === 'admin') return 'Admin';
  return 'Client';
}

/**
 * @param {string} webPage e.g. book-appointment
 * @param {string} roleText
 * @returns {string|null} React Navigation screen name
 */
export function webPageToScreenName(webPage, roleText) {
  const page = String(webPage || '').trim();
  if (!page || NOTARY_WEB_PAGES.has(page)) {
    return null;
  }
  const role = normalizeRole(roleText);
  if (role === 'Attorney') {
    return ATTORNEY_WEB_TO_SCREEN[page] ?? null;
  }
  if (role === 'Admin') {
    return null;
  }
  return CLIENT_WEB_TO_SCREEN[page] ?? null;
}

/**
 * @param {string} screenName React Navigation name
 * @param {string} roleText
 * @returns {string|null} web page id
 */
export function screenNameToWebPage(screenName, roleText) {
  const name = String(screenName || '').trim();
  const role = normalizeRole(roleText);
  if (role === 'Attorney') {
    return SCREEN_TO_WEB_ATTORNEY[name] ?? null;
  }
  if (role === 'Admin') {
    return null;
  }
  return SCREEN_TO_WEB_CLIENT[name] ?? null;
}

/**
 * Strip scheme/host; return path without leading slash (e.g. client/book-appointment).
 * @param {string} url
 * @returns {string}
 */
export function pathFromDeepLinkUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  const noFragment = raw.split('#')[0];
  const noQuery = noFragment.split('?')[0];
  let rest = noQuery.replace(/^[^:]+:\/\//, '');
  rest = rest.replace(/^\//, '');
  return rest;
}

/**
 * @param {string} url full deep link
 * @param {{ role?: string }} [options]
 * @returns {{ name: string, params?: object } | null}
 */
export function resolveNavigationTargetFromUrl(url, options = {}) {
  const path = pathFromDeepLinkUrl(url);
  const role = normalizeRole(options.role ?? 'Client');
  return resolveNavigationTargetFromPath(path, url, role);
}

/**
 * @param {string} path pathFromDeepLinkUrl output
 * @param {string} [originalUrl] for query params
 * @param {'Client'|'Attorney'|'Admin'} [roleHint]
 */
export function resolveNavigationTargetFromPath(path, originalUrl = '', roleHint = 'Client') {
  const segments = String(path || '')
    .split('/')
    .filter(Boolean);
  const role = normalizeRole(roleHint);

  const queryChatId = (() => {
    try {
      const q = String(originalUrl || '').split('?')[1];
      if (!q) return '';
      const params = new URLSearchParams(q);
      return (
        params.get('chatId') ||
        params.get('appointmentId') ||
        ''
      );
    } catch {
      return '';
    }
  })();

  if (segments[0] === 'client' && segments[1]) {
    const webPage = segments[1];
    if (webPage === 'messages') {
      return {name: 'Messages', params: undefined};
    }
    if (webPage === 'chatbot') {
      return {name: 'Chatbot', params: undefined};
    }
    if (NOTARY_WEB_PAGES.has(webPage)) {
      return null;
    }
    if (webPage === 'chat-room') {
      const chatId = segments[2] || queryChatId;
      if (chatId) {
        return {
          name: 'EnterConsultationChat',
          params: {chatId, chatName: 'Attorney', initials: 'AT'},
        };
      }
      return {name: 'Messages', params: undefined};
    }
    const screen = webPageToScreenName(webPage, 'Client');
    if (!screen) return null;
    return {name: screen, params: undefined};
  }

  if (segments[0] === 'attorney' && segments[1]) {
    const webPage = segments[1];
    if (NOTARY_WEB_PAGES.has(webPage)) {
      return null;
    }
    if (role === 'Client' || role === 'Admin') {
      return null;
    }
    if (webPage === 'attorney-messages') {
      const chatId = segments[2] || queryChatId;
      const name = 'AttyConsultationMessage';
      if (!chatId) {
        return {name, params: {chatId: 'general-chat', clientName: 'Client'}};
      }
      return {
        name,
        params: {
          chatId,
          clientName: 'Client',
          clientInitials: 'CL',
        },
      };
    }
    const screen = webPageToScreenName(webPage, 'Attorney');
    if (!screen) return null;
    return {name: screen, params: undefined};
  }

  return null;
}

/**
 * Menu rows for ClientMenu — same labels and order as web ClientShell MENU_ITEMS.
 * My Appointments and Notarial Requests are reached from the dashboard, matching web.
 */
export const CLIENT_MENU_WEB_ROUTES = [
  {label: 'Dashboard', webPage: 'home-logged', route: 'HomepageClient'},
  {label: 'Book Consultation', webPage: 'book-appointment', route: 'BookAppointment'},
  {label: 'Notary Status', webPage: 'client-notary-tracking', route: 'ClientNotaryStatus'},
  {label: 'Messages', webPage: 'support-messages', route: 'ClientSupportMessages'},
  {label: 'Announcement', webPage: 'announcements', route: 'ClientNotification'},
  {label: 'Transaction History', webPage: 'transaction-history', route: 'TransactionHistory'},
  {label: 'Logs', webPage: 'client-logs', route: 'ClientConsultationLogs'},
  {label: 'Profile', webPage: 'profile', route: 'ProfileSettingsClient'},
];
