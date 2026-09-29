import Constants from 'expo-constants';

const DIDIT_PROXY_PORT = Number(process.env.EXPO_PUBLIC_DIDIT_PROXY_PORT || 4001);

/**
 * Metro / Expo Go debugger host (e.g. 192.168.1.48) — same machine as the dev server.
 */
export function getDevLanHost() {
  if (!__DEV__) return null;
  const debuggerHost =
    Constants.expoGoConfig?.debuggerHost ||
    Constants.expoConfig?.hostUri ||
    Constants.manifest2?.extra?.expoClient?.hostUri ||
    '';
  const host = String(debuggerHost).split(':')[0]?.trim();
  if (!host || host === 'localhost' || host === '127.0.0.1') return null;
  return host;
}

/** True if this host can serve faceid-server to a phone on the same LAN. */
export function isLanReachableHost(host) {
  if (!host) return false;
  const h = host.toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1') return false;
  // Expo tunnel / cloud hosts do not forward port 4001.
  if (
    h.includes('exp.direct') ||
    h.includes('.exp.host') ||
    h.endsWith('.exp.dev') ||
    h.includes('expo.dev')
  ) {
    return false;
  }
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(h);
}

/**
 * URL for Mobile/faceid-server (Didit proxy). In dev, prefers Metro LAN IP :4001
 * so .env does not need updating when your Wi‑Fi IP changes.
 */
export function resolveDiditProxyBaseUrl() {
  const explicit = String(process.env.EXPO_PUBLIC_DIDIT_PROXY_URL || '')
    .trim()
    .replace(/\/+$/, '');

  // Explicit URL first (ngrok/Render) — required for remote testers on Expo tunnel.
  if (explicit) {
    return explicit;
  }

  const webApi = String(
    process.env.EXPO_PUBLIC_BATASMO_WEB_API_URL ||
      process.env.EXPO_PUBLIC_PAYMENT_API_URL ||
      '',
  )
    .trim()
    .replace(/\/+$/, '');
  if (webApi && !__DEV__) {
    return webApi;
  }

  const lanHost = getDevLanHost();
  if (__DEV__ && lanHost && isLanReachableHost(lanHost)) {
    return `http://${lanHost}:${DIDIT_PROXY_PORT}`;
  }

  return '';
}

export function getDiditProxySetupHint() {
  const explicit = String(process.env.EXPO_PUBLIC_DIDIT_PROXY_URL || '').trim();
  if (explicit) return null;
  const host = getDevLanHost();
  if (host && !isLanReachableHost(host)) {
    return (
      'Remote testers cannot reach your verification server. Run: ngrok http 4001, ' +
      'then set EXPO_PUBLIC_DIDIT_PROXY_URL=https://YOUR-NGROK-URL in Mobile/app/.env and restart Expo with -c.'
    );
  }
  return (
    'Set EXPO_PUBLIC_DIDIT_PROXY_URL to a public https URL (ngrok port 4001) for remote testers, ' +
    'or use the same Wi‑Fi with npx expo start --lan.'
  );
}
