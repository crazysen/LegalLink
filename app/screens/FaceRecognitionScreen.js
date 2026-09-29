import React, { useRef, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  ScrollView,
  Image,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { createNotarialRequest } from '../services/notarialService';
import {
  verifySelfieMatchesId,
  pingDiditProxy,
} from '../services/idDocumentVerificationService';
import { REFERENCE_THEME as T } from '../constants/referenceTheme';
import { ClientScreenShell } from '../components/ClientScreenShell';

const MIN_CONFIDENCE = 70;
const MIN_SELFIE_BYTES = 250 * 1024 + 1;

async function selfieToBase64(uri) {
  let width = 1400;
  let quality = 0.92;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = await manipulateAsync(
      uri,
      [{ resize: { width } }],
      { compress: quality, format: SaveFormat.JPEG, base64: true },
    );
    const b64 = (result.base64 || '').replace(/^data:[^;]+;base64,/i, '');
    if (Math.floor((b64.length * 3) / 4) >= MIN_SELFIE_BYTES) return b64;
    quality = Math.min(0.98, quality + 0.02);
    width = Math.min(2200, width + 150);
  }
  throw new Error(
    'Selfie file is too small. Move closer, use good lighting, and keep your face centered.',
  );
}

export default function FaceRecognitionScreen({ navigation, route }) {
  const notarialData = route?.params?.notarialData || {};
  const idFrontBase64 = notarialData.id_front_base64 || notarialData.id_base64;

  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef(null);

  const [step, setStep] = useState('intro');
  const [selfieUri, setSelfieUri] = useState(null);
  const [verifyResult, setVerifyResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploadStep, setUploadStep] = useState('');
  const [busy, setBusy] = useState(false);

  const captureAndVerify = async () => {
    if (!cameraRef.current || !idFrontBase64) {
      Alert.alert('Error', 'Missing verified ID photo. Go back and capture your ID again.');
      return;
    }
    setBusy(true);
    setStep('checking');
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 1,
        shutterSound: false,
      });
      setSelfieUri(photo.uri);
      const selfieBase64 = await selfieToBase64(photo.uri);
      const result = await verifySelfieMatchesId({
        selfieBase64,
        idFrontBase64,
      });
      setVerifyResult(result);
      setStep('done');
    } catch (e) {
      setStep('camera');
      Alert.alert('Verification failed', e?.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleProceed = async () => {
    if (!verifyResult?.verified) {
      Alert.alert('Verification required', 'Your face must match your ID before continuing.');
      return;
    }
    try {
      setSubmitting(true);
      setUploadStep('Uploading files…');
      const response = await createNotarialRequest(notarialData);
      setUploadStep('Saving request…');
      const created = response?.data ?? response;
      const requestId = created?.id;
      if (!requestId) {
        Alert.alert('Error', 'Could not save request. Try again.');
        return;
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
      Alert.alert('Error', e?.message ?? 'Failed to submit.');
    } finally {
      setSubmitting(false);
      setUploadStep('');
    }
  };

  const conf = Number(verifyResult?.confidence ?? 0);
  const isVerified = verifyResult?.verified === true && conf >= MIN_CONFIDENCE;

  if (!permission) {
    return (
      <ClientScreenShell>
        <View style={s.centered}>
          <ActivityIndicator color={T.gold[1]} />
        </View>
      </ClientScreenShell>
    );
  }

  if (!permission.granted) {
    return (
      <ClientScreenShell>
        <View style={s.centered}>
          <Text style={s.permText}>Camera access is required for face verification.</Text>
          <TouchableOpacity style={s.primaryBtn} onPress={requestPermission}>
            <Text style={s.primaryBtnText}>Grant camera access</Text>
          </TouchableOpacity>
        </View>
      </ClientScreenShell>
    );
  }

  return (
    <ClientScreenShell>
      <ScrollView contentContainerStyle={s.scroll} bounces={false}>
        <View style={s.header}>
          <TouchableOpacity
            style={s.backBtn}
            onPress={() => navigation.canGoBack() && navigation.goBack()}
            disabled={busy || submitting}>
            <Text style={s.backText}>✕</Text>
          </TouchableOpacity>
          <Text style={s.title}>Face verification</Text>
          <View style={{ width: 36 }} />
        </View>

        {step === 'intro' && (
          <View style={s.card}>
            <Text style={s.cardTitle}>Match your face to your ID</Text>
            <Text style={s.cardBody}>
              {notarialData.id_type_label
                ? `Verified: ${notarialData.id_type_label}`
                : 'ID verified'}
              {notarialData.id_verified_name
                ? ` — ${notarialData.id_verified_name}`
                : ''}
            </Text>
            <Text style={s.cardBody}>
              Take a clear selfie. Didit will check liveness and compare your face to the ID
              photo.
            </Text>
            <TouchableOpacity
              style={s.primaryBtn}
              onPress={async () => {
                const ping = await pingDiditProxy();
                if (!ping.ok) {
                  Alert.alert(
                    'Verification server offline',
                    ping.error ||
                      `Cannot reach ${ping.base || 'faceid-server'}. Run: cd Mobile/faceid-server && npm start (only once — if port 4001 is in use, it is already running).`,
                  );
                  return;
                }
                setStep('camera');
              }}>
              <Text style={s.primaryBtnText}>Continue</Text>
            </TouchableOpacity>
          </View>
        )}

        {(step === 'camera' || step === 'checking') && (
          <View style={s.content}>
            <Text style={s.hintMain}>Look at the camera</Text>
            <Text style={s.hintSub}>Center your face. Remove glasses or mask if possible.</Text>
            <View style={s.circleOuter}>
              <View style={s.circle}>
                {selfieUri && step === 'done' ? (
                  <Image source={{ uri: selfieUri }} style={StyleSheet.absoluteFill} />
                ) : (
                  <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="front" />
                )}
                {step === 'checking' && (
                  <View style={s.overlay}>
                    <ActivityIndicator size="large" color={T.gold[0]} />
                    <Text style={s.overlayText}>Matching face to ID…</Text>
                  </View>
                )}
              </View>
            </View>
            {step === 'camera' && (
              <TouchableOpacity
                style={[s.primaryBtn, busy && s.primaryBtnOff]}
                onPress={captureAndVerify}
                disabled={busy}>
                <Text style={s.primaryBtnText}>Capture & verify</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {step === 'done' && (
          <View style={s.content}>
            {selfieUri ? (
              <Image source={{ uri: selfieUri }} style={s.resultThumb} />
            ) : null}
            <Text style={[s.hintMain, { color: isVerified ? '#10B981' : '#EF4444' }]}>
              {isVerified ? 'Face matches your ID' : 'Face did not match'}
            </Text>
            <Text style={s.hintSub}>
              {isVerified
                ? `Similarity: ${conf}%`
                : verifyResult?.reason || `Score: ${conf}% — try again in good lighting.`}
            </Text>
            {!isVerified && (
              <TouchableOpacity style={s.secondaryBtn} onPress={() => setStep('camera')}>
                <Text style={s.secondaryBtnText}>↺ Try again</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[s.primaryBtn, (!isVerified || submitting) && s.primaryBtnOff]}
              onPress={handleProceed}
              disabled={!isVerified || submitting}>
              {submitting ? (
                <ActivityIndicator color={T.base} />
              ) : (
                <Text style={s.primaryBtnText}>Proceed to payment</Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </ClientScreenShell>
  );
}

const s = StyleSheet.create({
  scroll: { paddingBottom: 32 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 14,
  },
  backBtn: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  backText: { fontSize: 20, color: T.textSoft, fontWeight: '700' },
  title: { fontSize: 18, fontWeight: '800', color: T.text },
  card: {
    margin: 20,
    padding: 20,
    borderRadius: 16,
    backgroundColor: 'rgba(18, 26, 36, 0.88)',
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.12)',
  },
  cardTitle: { fontSize: 18, fontWeight: '700', color: T.gold[0], marginBottom: 10 },
  cardBody: { fontSize: 14, color: T.textMuted, lineHeight: 20, marginBottom: 10 },
  content: { alignItems: 'center', paddingHorizontal: 20 },
  hintMain: { fontSize: 17, fontWeight: '800', color: T.gold[0], textAlign: 'center' },
  hintSub: {
    fontSize: 13,
    color: T.textSoft,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 16,
    lineHeight: 18,
  },
  circleOuter: {
    width: 260,
    height: 260,
    borderRadius: 130,
    borderWidth: 3,
    borderColor: T.gold[0],
    overflow: 'hidden',
    marginBottom: 20,
  },
  circle: { flex: 1, backgroundColor: '#000' },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
  },
  overlayText: { color: '#fff', fontWeight: '600' },
  resultThumb: { width: 120, height: 120, borderRadius: 60, marginBottom: 16 },
  primaryBtn: {
    backgroundColor: T.gold[1],
    borderRadius: 12,
    paddingVertical: 15,
    paddingHorizontal: 32,
    alignItems: 'center',
    width: '100%',
    marginTop: 8,
  },
  primaryBtnOff: { backgroundColor: 'rgba(148,163,184,0.18)' },
  primaryBtnText: { color: T.base, fontWeight: '700', fontSize: 15 },
  secondaryBtn: { paddingVertical: 12 },
  secondaryBtnText: { color: T.gold[0], fontWeight: '600' },
  permText: { color: T.textSoft, textAlign: 'center', marginBottom: 16 },
});
