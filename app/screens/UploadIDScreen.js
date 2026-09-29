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
import * as FileSystem from 'expo-file-system/legacy';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { REFERENCE_THEME as T } from '../constants/referenceTheme';
import { ClientScreenShell, ClientFadeIn } from '../components/ClientScreenShell';
import ClientChevronBack from '../components/ClientChevronBack';
import { PHILIPPINE_ID_TYPES, getPhilippineIdType } from '../constants/philippineIdTypes';
import {
  verifyPhilippineIdDocument,
  pingDiditProxy,
} from '../services/idDocumentVerificationService';

const HEADER_BACK_COL = 28;
const HEADER_BACK_GAP = 8;
const SUBTITLE_INDENT = HEADER_BACK_COL + HEADER_BACK_GAP;

const MIN_ID_IMAGE_BYTES = 250 * 1024 + 1;

async function photoToBase64(uri) {
  let width = 1800;
  let quality = 0.92;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const optimized = await manipulateAsync(
      uri,
      [{ resize: { width } }],
      { compress: quality, format: SaveFormat.JPEG, base64: true },
    );
    const b64 = (optimized.base64 || '').replace(/^data:[^;]+;base64,/i, '');
    const approxBytes = Math.floor((b64.length * 3) / 4);
    if (approxBytes >= MIN_ID_IMAGE_BYTES) return b64;
    quality = Math.min(0.98, quality + 0.02);
    width = Math.min(2400, width + 150);
  }
  throw new Error(
    'Photo file is too small for verification. Move closer, use good lighting, and ensure all ID corners are visible.',
  );
}

export default function UploadIDScreen({ navigation, route }) {
  const notarialData = route?.params?.notarialData || {};
  const [permission, requestPermission] = useCameraPermissions();

  const [step, setStep] = useState('type');
  const [selectedType, setSelectedType] = useState(null);
  const [frontUri, setFrontUri] = useState(null);
  const [backUri, setBackUri] = useState(null);
  const [frontBase64, setFrontBase64] = useState(null);
  const [backBase64, setBackBase64] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [captureSide, setCaptureSide] = useState('front');
  const [hint, setHint] = useState('');

  const cameraRef = useRef(null);
  const idConfig = selectedType ? getPhilippineIdType(selectedType) : null;

  const goCapture = (side) => {
    setCaptureSide(side);
    setHint(
      side === 'front'
        ? `Capture the ${side} of your ${idConfig?.shortLabel || 'ID'}. Show all corners with margin.`
        : `Capture the back of your ${idConfig?.shortLabel || 'ID'}.`,
    );
    setStep('camera');
  };

  const onSelectType = async (typeId) => {
    const ping = await pingDiditProxy();
    if (!ping.ok) {
      Alert.alert(
        'Verification server offline',
        ping.error ||
          `Cannot reach ${ping.base || 'faceid-server'}. Start it with: cd Mobile/faceid-server && npm start. Use "npx expo start --lan" on the same Wi‑Fi (Expo tunnel cannot reach your PC on port 4001).`,
      );
      return;
    }

    setSelectedType(typeId);
    setFrontUri(null);
    setBackUri(null);
    setFrontBase64(null);
    setBackBase64(null);
    goCapture('front');
  };

  const takePhoto = async () => {
    if (!cameraRef.current) return;
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 1,
        shutterSound: false,
      });
      const b64 = await photoToBase64(photo.uri);

      if (captureSide === 'front') {
        setFrontUri(photo.uri);
        setFrontBase64(b64);
        if (idConfig?.requiresBack) {
          goCapture('back');
        } else {
          await runAnalysis(b64, null);
        }
      } else {
        setBackUri(photo.uri);
        setBackBase64(b64);
        await runAnalysis(frontBase64, b64);
      }
    } catch (e) {
      Alert.alert('Capture failed', e?.message || 'Please try again.');
    }
  };

  const runAnalysis = async (front, back) => {
    setStep('analyzing');
    setAnalyzing(true);
    try {
      const result = await verifyPhilippineIdDocument({
        idType: selectedType,
        frontBase64: front,
        backBase64: back,
      });

      if (!result.verified) {
        setStep('type');
        setSelectedType(null);
        Alert.alert(
          'ID not accepted',
          result.reason ||
            'The document could not be verified. Check your ID type and retake clear photos.',
        );
        return;
      }

      const updatedNotarialData = {
        ...notarialData,
        id_type: selectedType,
        id_type_label: idConfig?.label,
        id_front_base64: front,
        id_back_base64: back || null,
        id_base64: front,
        id_name: `${idConfig?.shortLabel || 'id'}-front.jpg`,
        id_verified_name: result.fullName,
        id_verified_document_number: result.documentNumber,
        id_detected_type: result.detectedDocumentType,
      };

      navigation.navigate('FaceRecognitionScreen', { notarialData: updatedNotarialData });
    } catch (e) {
      setStep('type');
      setSelectedType(null);
      Alert.alert('Verification error', e?.message || 'Could not verify ID.');
    } finally {
      setAnalyzing(false);
    }
  };

  const skipBackForPassport = async () => {
    if (!frontBase64) return;
    await runAnalysis(frontBase64, null);
  };

  if (!permission) {
    return (
      <ClientScreenShell>
        <View style={styles.centered}>
          <ActivityIndicator color={T.gold[1]} />
        </View>
      </ClientScreenShell>
    );
  }

  if (!permission.granted && step !== 'type') {
    return (
      <ClientScreenShell>
        <View style={styles.centered}>
          <Text style={styles.permText}>Camera access is required to photograph your ID.</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={requestPermission}>
            <Text style={styles.primaryBtnText}>Grant camera access</Text>
          </TouchableOpacity>
        </View>
      </ClientScreenShell>
    );
  }

  return (
    <ClientScreenShell>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <ClientFadeIn>
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <View style={styles.backColumn}>
                <ClientChevronBack
                  onPress={() => {
                    if (step === 'camera') setStep('type');
                    else if (navigation.canGoBack()) navigation.goBack();
                  }}
                />
              </View>
              <Text style={styles.headerTitle} numberOfLines={2}>
                Government ID
              </Text>
            </View>
            <Text style={styles.headerSubtitle}>
              Select your ID type, then capture front and back for verification
            </Text>
          </View>

          {step === 'type' && (
            <View style={styles.content}>
              <Text style={styles.sectionTitle}>Select ID type</Text>
              {PHILIPPINE_ID_TYPES.map((item) => (
                <TouchableOpacity
                  key={item.id}
                  style={styles.typeCard}
                  onPress={() => onSelectType(item.id)}>
                  <Text style={styles.typeTitle}>{item.label}</Text>
                  <Text style={styles.typeDesc}>{item.description}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {step === 'camera' && (
            <View style={styles.content}>
              <Text style={styles.sectionTitle}>
                {captureSide === 'front' ? 'Front of ID' : 'Back of ID'}
              </Text>
              <Text style={styles.instructionText}>{hint}</Text>
              <View style={styles.cameraWrap}>
                <CameraView ref={cameraRef} style={styles.camera} facing="back" />
                <View style={styles.frameOverlay} pointerEvents="none" />
              </View>
              {frontUri && captureSide === 'back' ? (
                <View style={styles.thumbRow}>
                  <Image source={{ uri: frontUri }} style={styles.thumb} />
                  <Text style={styles.thumbLabel}>Front captured</Text>
                </View>
              ) : null}
              <TouchableOpacity style={styles.primaryBtn} onPress={takePhoto}>
                <Text style={styles.primaryBtnText}>Capture photo</Text>
              </TouchableOpacity>
              {selectedType === 'passport' && captureSide === 'back' ? (
                <TouchableOpacity style={styles.secondaryBtn} onPress={skipBackForPassport}>
                  <Text style={styles.secondaryBtnText}>Skip back (passport only)</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          )}

          {step === 'analyzing' && (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color={T.gold[1]} />
              <Text style={styles.analyzingText}>Analyzing your ID…</Text>
              <Text style={styles.analyzingSub}>
                Checking document type and authenticity with Didit
              </Text>
            </View>
          )}
        </ClientFadeIn>
      </ScrollView>
    </ClientScreenShell>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: 32 },
  content: { padding: 20 },
  centered: { padding: 32, alignItems: 'center', justifyContent: 'center' },
  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16 },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  backColumn: { width: HEADER_BACK_COL, marginRight: HEADER_BACK_GAP, justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 22, fontWeight: '800', color: T.text, lineHeight: 28 },
  headerSubtitle: {
    fontSize: 13,
    color: T.textSoft,
    marginTop: 6,
    marginLeft: SUBTITLE_INDENT,
    lineHeight: 18,
  },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: T.gold[0], marginBottom: 12 },
  instructionText: { fontSize: 14, color: T.textMuted, marginBottom: 16, lineHeight: 20 },
  typeCard: {
    backgroundColor: 'rgba(18, 26, 36, 0.88)',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.2)',
  },
  typeTitle: { fontSize: 16, fontWeight: '700', color: T.text },
  typeDesc: { fontSize: 13, color: T.textSoft, marginTop: 4 },
  cameraWrap: {
    height: 280,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 16,
    backgroundColor: '#000',
  },
  camera: { flex: 1 },
  frameOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 2,
    borderColor: 'rgba(244, 215, 139, 0.65)',
    margin: 20,
    borderRadius: 8,
  },
  thumbRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 10 },
  thumb: { width: 56, height: 36, borderRadius: 6 },
  thumbLabel: { color: T.textSoft, fontSize: 13 },
  primaryBtn: {
    backgroundColor: T.gold[1],
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryBtnText: { color: T.base, fontWeight: '700', fontSize: 16 },
  secondaryBtn: { paddingVertical: 14, alignItems: 'center' },
  secondaryBtnText: { color: T.gold[0], fontWeight: '600' },
  permText: { color: T.textSoft, textAlign: 'center', marginBottom: 16 },
  analyzingText: { color: T.text, fontSize: 16, fontWeight: '700', marginTop: 16 },
  analyzingSub: { color: T.textSoft, fontSize: 13, marginTop: 8, textAlign: 'center' },
});
