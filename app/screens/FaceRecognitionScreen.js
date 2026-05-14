import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Image,
  Animated,
  Easing,
  Dimensions,
  ScrollView,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { createNotarialRequest } from '../services/notarialService';
import { verifyFaceAgainstId, checkFaceLiveness } from '../services/faceVerificationService';
import { REFERENCE_THEME as T } from '../constants/referenceTheme';
import { ClientScreenShell } from '../components/ClientScreenShell';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const CIRCLE_SIZE   = Math.min(SCREEN_W - 64, 260);
const CIRCLE_RADIUS = CIRCLE_SIZE / 2;
const MIN_CONFIDENCE = 75;

// How often we run Face++ checks (silent captures, no shutter sound).
const STEP1_CHECK_MS = 3500; // face presence
const STEP2_CHECK_MS = 1200; // blink challenge

// Step 1 should not advance with tiny/false detections.
const MIN_FACE_SIZE_RATIO = 0.12;

const STEPS = [
  { id: 1, label: 'Position' },
  { id: 2, label: 'Blink'    },
  { id: 3, label: 'Scan'     },
];

export default function FaceRecognitionScreen({ navigation, route }) {
  const notarialData = route?.params?.notarialData || {};
  const idBase64     = notarialData.id_base64 || null;

  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef(null);

  // step: 1=position  2=blink  3=scanning  4=done
  const [step,         setStep]        = useState(1);
  const [hint,         setHint]        = useState('Center your face inside the frame.');
  const [hintSub,      setHintSub]     = useState('');
  const [scanCountdown, setScanCountdown] = useState(null);
  const [selfieUri,    setSelfieUri]   = useState(null);
  const [verifyResult, setVerifyResult] = useState(null);
  const [submitting,   setSubmitting]  = useState(false);
  const [uploadStep,   setUploadStep]  = useState('');

  const stepRef    = useRef(1);
  const busyRef    = useRef(false);
  const timers     = useRef([]);
  const intRef     = useRef(null);
  const animRef    = useRef(null);
  // blink tracking: wait for eyes-open → eyes-closed transition
  const eyesWereOpen = useRef(false);

  // Animations
  const scanLine  = useRef(new Animated.Value(0)).current;
  const pulse     = useRef(new Animated.Value(1)).current;
  const guideAnim = useRef(new Animated.Value(1)).current;

  // ── Permissions ───────────────────────────────────────────────────────────
  useEffect(() => { if (!permission?.granted) requestPermission(); }, []);
  useEffect(() => {
    if (permission?.granted) startStep1();
    return stopAll;
  }, [permission?.granted]);

  // ── Animations ────────────────────────────────────────────────────────────
  useEffect(() => {
    animRef.current?.stop();
    if (step === 1 || step === 2) {
      animRef.current = Animated.loop(Animated.sequence([
        Animated.timing(scanLine, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(scanLine, { toValue: 0, duration: 1800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]));
      animRef.current.start();
      Animated.loop(Animated.sequence([
        Animated.timing(pulse, { toValue: 1.025, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1,     duration: 900, useNativeDriver: true }),
      ])).start();
      Animated.loop(Animated.sequence([
        Animated.timing(guideAnim, { toValue: 0.3, duration: 900, useNativeDriver: true }),
        Animated.timing(guideAnim, { toValue: 1,   duration: 900, useNativeDriver: true }),
      ])).start();
    } else {
      scanLine.setValue(0);
      pulse.setValue(1);
      guideAnim.setValue(1);
    }
  }, [step]);

  useEffect(() => () => { stopAll(); animRef.current?.stop(); }, []);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const stopAll = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    if (intRef.current) { clearInterval(intRef.current); intRef.current = null; }
  };
  const later = (fn, ms) => { const id = setTimeout(fn, ms); timers.current.push(id); };

  // ── STEP 1: Position detection ─────────────────────────────────────────
  // Re-check face presence repeatedly (no countdown).
  const startStep1 = () => {
    stopAll();
    busyRef.current = false;
    eyesWereOpen.current = false;
    stepRef.current = 1;
    setStep(1);
    setVerifyResult(null);
    setSelfieUri(null);
    setHint('Center your face inside the frame.');
    setHintSub('');

    const checkFaceOnce = async () => {
      if (busyRef.current || stepRef.current !== 1 || !cameraRef.current) return;
      busyRef.current = true;
      try {
        const photo = await cameraRef.current.takePictureAsync({
          quality: 0.8,
          shutterSound: false,
        });
        const check = await checkFaceLiveness(photo.uri, null);

        if (
          check.faceDetected &&
          (check.faceCount ?? 1) === 1 &&
          check.faceSizeRatio >= MIN_FACE_SIZE_RATIO
        ) {
          if (intRef.current) { clearInterval(intRef.current); intRef.current = null; }
          startStep2();
        } else {
          // Keep main message; only update small detail if Face++ gives a reason.
          setHint('Center your face inside the frame.');
          setHintSub(check.reason || '');
        }
      } catch {
        // silent retry
      } finally {
        busyRef.current = false;
      }
    };

    checkFaceOnce();
    intRef.current = setInterval(checkFaceOnce, STEP1_CHECK_MS);
  };

  // ── STEP 2: Liveness (blink only) ──────────────────────────────────────
  const startStep2 = () => {
    stopAll();
    busyRef.current = false;
    eyesWereOpen.current = false;
    stepRef.current = 2;
    setStep(2);
    setHint('Keep your eyes open, then blink once.');
    setHintSub('');

    const checkBlinkOnce = async () => {
      if (busyRef.current || stepRef.current !== 2 || !cameraRef.current) return;
      busyRef.current = true;
      try {
        const photo = await cameraRef.current.takePictureAsync({
          quality: 0.8,
          shutterSound: false,
        });
        const result = await checkFaceLiveness(photo.uri, 'blink');

        if (result.faceDetected) {
          const eyesOpenKnown = result.eyesOpen !== null && result.eyesOpen !== undefined;
          if (result.eyesOpen) {
            eyesWereOpen.current = true;
          }
          const canBlink = result.eyesClosed && (eyesWereOpen.current || !eyesOpenKnown);
          if (canBlink || result.challengePassed) {
            if (intRef.current) { clearInterval(intRef.current); intRef.current = null; }
            startStep3();
            return;
          }
        }

        {
          setHint(eyesWereOpen.current ? 'Please blink.' : 'Hold still with eyes open.');
          setHintSub(result.reason || (eyesWereOpen.current ? '' : 'Then blink once.'));
        }
      } catch {
        // silent retry
      } finally {
        busyRef.current = false;
      }
    };

    checkBlinkOnce();
    intRef.current = setInterval(checkBlinkOnce, STEP2_CHECK_MS);
  };

  // ── STEP 3: Final scan ──────────────────────────────────────────────────
  const startStep3 = () => {
    stopAll();
    stepRef.current = 3;
    setStep(3);
    setHint("Scanning... please don't move.");
    setHintSub('');
    setScanCountdown(3);

    // Countdown inside Step 3 only (so the final shot feels intentional).
    later(() => setScanCountdown(2), 1000);
    later(() => setScanCountdown(1), 2000);
    later(() => {
      setScanCountdown(null);
      runFinalScan();
    }, 3000);
  };

  const runFinalScan = async () => {
    if (!cameraRef.current) return;
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.8 });
      setSelfieUri(photo.uri);
      const result = await verifyFaceAgainstId(photo.uri, idBase64);
      setVerifyResult(result);
      stepRef.current = 4;
      setStep(4);
      setHint(result.verified ? 'Identity verified!' : 'Face did not match.');
      setHintSub(result.verified ? 'You may proceed.' : 'Try again with better lighting.');
    } catch (e) {
      stepRef.current = 4;
      setStep(4);
      setVerifyResult({ verified: false, confidence: 0 });
      setHint('Scan failed.');
      setHintSub(e?.message || 'Please try again.');
    }
  };

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleProceed = async () => {
    if (!verifyResult?.verified) { Alert.alert('Verification required', 'Complete face verification first.'); return; }
    try {
      setSubmitting(true);
      setUploadStep('Uploading files…');
      const response  = await createNotarialRequest(notarialData);
      setUploadStep('Saving request…');
      const created   = response?.data ?? response;
      const requestId = created?.id;
      if (!requestId) { Alert.alert('Error', 'Could not save request. Try again.'); return; }
      navigation.replace('BookingSummary', {
        serviceData: {
          type:   notarialData.service_type || 'Affidavit of Loss',
          date:   created?.created_at ? new Date(created.created_at).toLocaleDateString() : 'To be confirmed',
          time:   '-',
          amount: '₱1',
        },
        paymentContext: {
          sourceType: 'notarial',
          sourceId:   requestId,
          attorneyId: created?.attorney_id,
          amount:     1,
        },
      });
    } catch (e) {
      Alert.alert('Error', e?.message ?? 'Failed to submit.');
    } finally {
      setSubmitting(false);
      setUploadStep('');
    }
  };

  // ── Derived ───────────────────────────────────────────────────────────────
  const conf       = Number(verifyResult?.confidence ?? 0);
  const isVerified = verifyResult?.verified === true && conf >= MIN_CONFIDENCE;
  const isDone     = step === 4;

  const borderColor = isDone && isVerified  ? '#10B981'
    : isDone && !isVerified                 ? '#EF4444'
    : step === 2                            ? '#3B82F6'
    : T.gold[0];

  const hintColor = isDone && isVerified ? '#10B981'
    : isDone && !isVerified              ? '#EF4444'
    : step === 2                         ? '#93C5FD'
    : T.gold[0];

  // ── Permission screens ────────────────────────────────────────────────────
  if (!permission) return (
    <ClientScreenShell><View style={s.centred}><ActivityIndicator color={T.gold[1]} /></View></ClientScreenShell>
  );
  if (!permission.granted) return (
    <ClientScreenShell>
      <View style={s.centred}>
        <Text style={s.permText}>Camera access is required for face verification.</Text>
        <TouchableOpacity style={s.permBtn} onPress={requestPermission}>
          <Text style={s.permBtnText}>Grant Camera Access</Text>
        </TouchableOpacity>
      </View>
    </ClientScreenShell>
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <ClientScreenShell>
      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        {/* Header */}
        <View style={s.header}>
          <TouchableOpacity style={s.backBtn} onPress={() => navigation.canGoBack() && navigation.goBack()}>
            <Text style={s.backText}>✕</Text>
          </TouchableOpacity>
          <Text style={s.title}>Face Verification</Text>
          <View style={{ width: 36 }} />
        </View>

        {/* Step indicators */}
        <View style={s.stepsRow}>
          {STEPS.map(({ id, label }, i) => {
            const done   = step > id;
            const active = step === id;
            return (
              <React.Fragment key={id}>
                <View style={s.stepItem}>
                  <View style={[s.stepCircle, done && s.stepCircleDone, active && s.stepCircleActive]}>
                    <Text style={[s.stepNum, (done || active) && s.stepNumActive]}>
                      {done ? '✓' : id}
                    </Text>
                  </View>
                  <Text style={[s.stepLabel, (done || active) && s.stepLabelActive]}>{label}</Text>
                </View>
                {i < STEPS.length - 1 && <View style={[s.stepLine, step > id && s.stepLineDone]} />}
              </React.Fragment>
            );
          })}
        </View>

        {/* Camera circle */}
        <Animated.View style={[
          s.circleOuter,
          { borderColor, transform: [{ scale: step <= 2 ? pulse : 1 }] },
        ]}>
          <View style={s.circle}>
            {isDone && selfieUri ? (
              <Image source={{ uri: selfieUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            ) : (
              <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="front" shutterSound={false} />
            )}

            {/* Pulsing face guide oval — step 1 only */}
            {step === 1 && (
              <Animated.View style={[s.faceGuide, { opacity: guideAnim }]} pointerEvents="none" />
            )}

            {/* Sweep line — steps 1 & 2 */}
            {(step === 1 || step === 2) && (
              <Animated.View style={[s.scanLine, {
                transform: [{
                  translateY: scanLine.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-CIRCLE_RADIUS * 0.5, CIRCLE_RADIUS * 0.5],
                  }),
                }],
              }]} />
            )}

            {/* Step 3 overlay: countdown first, then analysing */}
            {step === 3 && scanCountdown !== null && (
              <View style={s.countdownOverlay}>
                <Text style={s.countdownNum}>{scanCountdown}</Text>
              </View>
            )}
            {step === 3 && scanCountdown === null && (
              <View style={s.overlay}>
                <ActivityIndicator size="large" color={T.gold[0]} />
                <Text style={s.overlayText}>Analysing…</Text>
              </View>
            )}
          </View>
        </Animated.View>

        {/* ── Live guidance text (OUTSIDE circle so it's never clipped) ── */}
        <View style={s.guidanceBlock}>
          <Text style={[s.guidanceMain, { color: hintColor }]} numberOfLines={2}>{hint}</Text>
          {!!hintSub && <Text style={s.guidanceSub} numberOfLines={2}>{hintSub}</Text>}
        </View>

        {/* Confidence badge */}
        {isDone && (
          <View style={[s.badge, isVerified ? s.badgeGreen : s.badgeRed]}>
            <Text style={s.badgeText}>
              {isVerified ? `✓  ${conf}% match` : `✗  ${conf}% — no match`}
            </Text>
          </View>
        )}

        {/* Action buttons */}
        <View style={s.actions}>
          {isDone && (
            <TouchableOpacity style={s.retryBtn} onPress={startStep1}>
              <Text style={s.retryText}>↺  Scan Again</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[s.proceedBtn, (!isVerified || submitting) && s.proceedBtnOff]}
            onPress={handleProceed}
            disabled={!isVerified || submitting}
          >
            {submitting ? (
              <View style={s.row}>
                <ActivityIndicator color={T.base} size="small" />
                <Text style={[s.proceedText, { marginLeft: 10 }]}>{uploadStep || 'Please wait…'}</Text>
              </View>
            ) : (
              <Text style={s.proceedText}>
                {isVerified ? 'Proceed to Payment' : isDone ? 'Scan Again' : 'Verifying…'}
              </Text>
            )}
          </TouchableOpacity>

          {isDone && !isVerified && (
            <Text style={s.failNote}>
              Need {MIN_CONFIDENCE}% confidence · Your score: {conf}%{'\n'}
              Use good lighting and look directly at the camera.
            </Text>
          )}
        </View>

      </ScrollView>
    </ClientScreenShell>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  scroll:  { alignItems: 'center', paddingBottom: 32, paddingTop: 0 },
  centred: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },

  header: {
    width: '100%', flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 14, paddingBottom: 8,
  },
  backBtn:  { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  backText: { fontSize: 20, color: T.textSoft, fontWeight: '700' },
  title:    { fontSize: 18, fontWeight: '800', color: T.text },

  stepsRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    marginBottom: 18, paddingHorizontal: 40, width: '100%',
  },
  stepItem: { alignItems: 'center', gap: 4 },
  stepCircle: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: 'rgba(148,163,184,0.12)',
    borderWidth: 1.5, borderColor: 'rgba(148,163,184,0.3)',
    justifyContent: 'center', alignItems: 'center',
  },
  stepCircleActive: { borderColor: T.gold[0], backgroundColor: 'rgba(244,215,139,0.15)' },
  stepCircleDone:   { borderColor: '#10B981', backgroundColor: 'rgba(16,185,129,0.15)'  },
  stepNum:          { fontSize: 11, color: T.textSoft, fontWeight: '700' },
  stepNumActive:    { color: T.text },
  stepLabel:        { fontSize: 10, color: T.textSoft },
  stepLabelActive:  { color: T.text, fontWeight: '700' },
  stepLine:         { flex: 1, height: 1.5, backgroundColor: 'rgba(148,163,184,0.2)', marginHorizontal: 4, marginBottom: 14 },
  stepLineDone:     { backgroundColor: '#10B981' },

  circleOuter: {
    width: CIRCLE_SIZE + 6, height: CIRCLE_SIZE + 6,
    borderRadius: CIRCLE_RADIUS + 3, borderWidth: 3,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: T.gold[0], shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5, shadowRadius: 14, elevation: 10,
  },
  circle: {
    width: CIRCLE_SIZE, height: CIRCLE_SIZE,
    borderRadius: CIRCLE_RADIUS, overflow: 'hidden', backgroundColor: '#000',
  },

  faceGuide: {
    position: 'absolute',
    width: CIRCLE_SIZE * 0.56, height: CIRCLE_SIZE * 0.76,
    borderRadius: CIRCLE_SIZE * 0.28,
    borderWidth: 2.5, borderColor: 'rgba(255,255,255,0.7)',
    alignSelf: 'center', top: (CIRCLE_SIZE - CIRCLE_SIZE * 0.76) / 2,
    backgroundColor: 'transparent',
  },

  scanLine: {
    position: 'absolute', width: CIRCLE_SIZE * 0.7, alignSelf: 'center',
    height: 2, backgroundColor: T.gold[0], borderRadius: 2, opacity: 0.9,
    shadowColor: T.gold[0], shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1, shadowRadius: 6, elevation: 5,
  },

  countdownOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  countdownNum: { fontSize: 64, fontWeight: '900', color: T.gold[0], opacity: 0.9 },

  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center', alignItems: 'center', gap: 12,
  },
  overlayText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  // Guidance text OUTSIDE circle — never clipped
  guidanceBlock: {
    marginTop: 16, paddingHorizontal: 24,
    alignItems: 'center', gap: 4, minHeight: 56,
  },
  guidanceMain: {
    fontSize: 17, fontWeight: '800', textAlign: 'center', lineHeight: 24,
  },
  guidanceSub: {
    fontSize: 13, color: T.textSoft, textAlign: 'center', lineHeight: 18,
  },

  badge: { marginTop: 10, paddingVertical: 7, paddingHorizontal: 22, borderRadius: 20 },
  badgeGreen: { backgroundColor: 'rgba(16,185,129,0.18)', borderWidth: 1, borderColor: '#10B981' },
  badgeRed:   { backgroundColor: 'rgba(239,68,68,0.15)',  borderWidth: 1, borderColor: '#EF4444' },
  badgeText:  { color: T.text, fontWeight: '700', fontSize: 13 },

  actions:       { width: '100%', paddingHorizontal: 24, marginTop: 14, alignItems: 'center', gap: 10 },
  row:           { flexDirection: 'row', alignItems: 'center' },
  retryBtn:      { paddingVertical: 9, paddingHorizontal: 24, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(244,215,139,0.35)' },
  retryText:     { color: T.gold[0], fontWeight: '600', fontSize: 14 },
  proceedBtn:    { backgroundColor: T.gold[1], borderRadius: 12, paddingVertical: 15, width: '100%', alignItems: 'center' },
  proceedBtnOff: { backgroundColor: 'rgba(148,163,184,0.18)' },
  proceedText:   { color: T.base, fontWeight: '700', fontSize: 15 },
  failNote:      { fontSize: 12, color: '#FCA5A5', textAlign: 'center', lineHeight: 18 },

  permText:    { color: T.textSoft, textAlign: 'center', marginBottom: 20, fontSize: 14, lineHeight: 22 },
  permBtn:     { backgroundColor: T.gold[1], borderRadius: 10, paddingVertical: 14, paddingHorizontal: 28 },
  permBtnText: { color: T.base, fontWeight: '700', fontSize: 15 },
});
