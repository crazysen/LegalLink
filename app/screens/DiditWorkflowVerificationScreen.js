import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  Linking,
  Alert,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { ClientScreenShell } from '../components/ClientScreenShell';
import ClientChevronBack from '../components/ClientChevronBack';
import { REFERENCE_THEME as T } from '../constants/referenceTheme';
import { createNotarialRequest } from '../services/notarialService';
import {
  createDiditVerificationSession,
  ensureDiditMediaPermissions,
  isDiditCallbackUrl,
  parseDiditCallbackUrl,
  pingDiditWorkflow,
  waitForDiditApproval,
} from '../services/diditVerificationService';

const WEB_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

export default function DiditWorkflowVerificationScreen({ navigation, route }) {
  const notarialData = route?.params?.notarialData || {};
  const finishingRef = useRef(false);
  const sessionIdRef = useRef(null);

  const [phase, setPhase] = useState('loading');
  const [verifyUrl, setVerifyUrl] = useState(null);
  const [errorText, setErrorText] = useState('');
  const [statusHint, setStatusHint] = useState('');

  const finishApproved = useCallback(
    async (sid) => {
      if (finishingRef.current || !sid) return;
      finishingRef.current = true;
      setPhase('checking');
      setStatusHint('Checking approval with Didit…');
      try {
        const result = await waitForDiditApproval(sid, { maxAttempts: 25, intervalMs: 2000 });
        if (!result?.approved) {
          finishingRef.current = false;
          setPhase('error');
          setErrorText(
            result?.status
              ? `Verification status: ${result.status}. If Didit shows success, tap "Continue in app" below.`
              : 'Verification was not approved yet. Wait a moment and tap "Continue in app".',
          );
          return;
        }

        setStatusHint('Saving your notarial request…');
        const payload = {
          ...notarialData,
          didit_session_id: sid,
          id_verified_name: result.fullName || null,
          details: [notarialData.details, `[Didit KYC approved — session ${sid}]`]
            .filter(Boolean)
            .join('\n\n'),
        };
        const created = await createNotarialRequest(payload);
        const requestId = created?.id;
        if (!requestId) {
          throw new Error('Could not save request.');
        }
        navigation.replace('BookingSummary', {
          serviceData: {
            type: notarialData.service_type || 'Affidavit of Loss',
            date: created?.created_at
              ? new Date(created.created_at).toLocaleDateString()
              : 'To be confirmed',
            time: '-',
            amount: '₱1',
          },
          paymentContext: {
            sourceType: 'notarial',
            sourceId: requestId,
            attorneyId: created?.attorney_id,
            amount: 1,
          },
        });
      } catch (e) {
        finishingRef.current = false;
        setPhase('error');
        setErrorText(e?.message || 'Could not complete verification.');
        setStatusHint('');
      }
    },
    [navigation, notarialData],
  );

  const handleCallbackUrl = useCallback(
    (url) => {
      if (!url || finishingRef.current) return false;
      if (!isDiditCallbackUrl(url)) return false;

      const { sessionId: cbSession, status } = parseDiditCallbackUrl(url);
      const sid = cbSession || sessionIdRef.current;
      if (!sid) return false;

      if (status && !['approved', ''].includes(status.toLowerCase())) {
        finishingRef.current = false;
        setPhase('error');
        setErrorText(`Verification ended with status: ${status}`);
        return true;
      }

      finishApproved(sid);
      return true;
    },
    [finishApproved],
  );

  const continueInApp = useCallback(() => {
    const sid = sessionIdRef.current;
    if (!sid) {
      setPhase('error');
      setErrorText('Session not found. Go back and try again.');
      return;
    }
    finishApproved(sid);
  }, [finishApproved]);

  const startSession = useCallback(async () => {
    finishingRef.current = false;
    setPhase('loading');
    setErrorText('');
    setStatusHint('');

    const ping = await pingDiditWorkflow();
    if (!ping.ok) {
      setPhase('error');
      setErrorText(
        ping.error ||
          `Cannot reach verification server at ${ping.base || 'faceid-server'}.`,
      );
      return;
    }
    if (!ping.sessionReady) {
      setPhase('error');
      setErrorText(
        'Didit Workflow is not configured. Set DIDIT_WORKFLOW_ID in Mobile/faceid-server/.env and restart the server.',
      );
      return;
    }

    try {
      setStatusHint('Requesting camera access…');
      await ensureDiditMediaPermissions();

      const vendor = `notarial-${Date.now()}`;
      const session = await createDiditVerificationSession(vendor);
      sessionIdRef.current = session.sessionId;
      setVerifyUrl(session.url);
      setPhase('webview');
    } catch (e) {
      setPhase('error');
      const denied = e?.code === 'CAMERA_DENIED' || e?.code === 'MIC_DENIED';
      setErrorText(e?.message || 'Could not start verification.');
      if (denied) {
        Alert.alert(
          'Permission required',
          e?.message || 'Camera access is required for Didit verification.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Open Settings',
              onPress: () => Linking.openSettings?.(),
            },
          ],
        );
      }
    }
  }, []);

  useEffect(() => {
    startSession();
  }, [startSession]);

  const handleWebViewRequest = useCallback(
    (request) => {
      const url = request?.url || '';
      if (handleCallbackUrl(url)) {
        return false;
      }
      return true;
    },
    [handleCallbackUrl],
  );

  return (
    <ClientScreenShell>
      <View style={s.header}>
        <ClientChevronBack
          onPress={() => {
            if (phase === 'checking') return;
            navigation.canGoBack() && navigation.goBack();
          }}
        />
        <Text style={s.title}>Identity verification</Text>
        <View style={{ width: 36 }} />
      </View>

      {phase === 'loading' && (
        <View style={s.centered}>
          <ActivityIndicator size="large" color={T.gold[1]} />
          <Text style={s.muted}>Starting Didit verification…</Text>
        </View>
      )}

      {phase === 'error' && (
        <View style={s.centered}>
          <Text style={s.errorTitle}>Could not continue</Text>
          <Text style={s.muted}>{errorText}</Text>
          <TouchableOpacity style={s.primaryBtn} onPress={startSession}>
            <Text style={s.primaryBtnText}>Try again</Text>
          </TouchableOpacity>
          {sessionIdRef.current ? (
            <TouchableOpacity style={s.secondaryBtn} onPress={continueInApp}>
              <Text style={s.secondaryBtnText}>Continue in app</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      )}

      {phase === 'checking' && (
        <View style={s.centered}>
          <ActivityIndicator size="large" color={T.gold[1]} />
          <Text style={s.muted}>{statusHint || 'Confirming verification…'}</Text>
        </View>
      )}

      {phase === 'webview' && verifyUrl ? (
        <View style={s.webWrap}>
          <WebView
            source={{ uri: verifyUrl }}
            style={s.webview}
            userAgent={WEB_USER_AGENT}
            onNavigationStateChange={(nav) => {
              handleCallbackUrl(nav.url);
            }}
            onShouldStartLoadWithRequest={handleWebViewRequest}
            originWhitelist={['https://*', 'http://*', 'legallinkapp://*']}
            javaScriptEnabled
            domStorageEnabled
            mediaPlaybackRequiresUserAction={false}
            allowsInlineMediaPlayback
            allowsFullscreenVideo
            setSupportMultipleWindows={false}
            mediaCapturePermissionGrantType="grant"
            androidLayerType="none"
            mixedContentMode="always"
          />
          <View style={s.floatingBar}>
            <Text style={s.floatingHint}>
              After &quot;You&apos;ve been verified&quot;, tap Continue in Didit, or use the button below.
            </Text>
            <TouchableOpacity style={s.primaryBtn} onPress={continueInApp}>
              <Text style={s.primaryBtnText}>Continue in app</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
    </ClientScreenShell>
  );
}

const s = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  title: { fontSize: 18, fontWeight: '800', color: T.text },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 12 },
  muted: { color: T.textMuted, textAlign: 'center', lineHeight: 20, fontSize: 14 },
  errorTitle: { color: '#EF4444', fontWeight: '700', fontSize: 16 },
  primaryBtn: {
    marginTop: 8,
    backgroundColor: T.gold[1],
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 28,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  primaryBtnText: { color: T.base, fontWeight: '700' },
  secondaryBtn: { marginTop: 12, padding: 12 },
  secondaryBtnText: { color: T.gold[0], fontWeight: '600' },
  webWrap: { flex: 1 },
  webview: { flex: 1, backgroundColor: '#fff' },
  floatingBar: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingBottom: Platform.OS === 'ios' ? 24 : 12,
    backgroundColor: 'rgba(4, 7, 11, 0.94)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(244, 215, 139, 0.15)',
  },
  floatingHint: { color: T.textSoft, fontSize: 12, marginBottom: 8, lineHeight: 16 },
});
