import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { REFERENCE_THEME as T } from '../constants/referenceTheme';
import { ClientScreenShell, ClientFadeIn } from '../components/ClientScreenShell';
import ClientChevronBack from '../components/ClientChevronBack';

const HEADER_BACK_COL = 28;
const HEADER_BACK_GAP = 8;
const SUBTITLE_INDENT = HEADER_BACK_COL + HEADER_BACK_GAP;

export default function UploadIDScreen({ navigation, route }) {
  const notarialData = route?.params?.notarialData || {};
  const [documentFile, setDocumentFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const pickID = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['image/*', 'application/pdf'],
        copyToCacheDirectory: true,
      });

      if (result.canceled) {
        return;
      }

      const asset = result.assets?.[0];
      if (!asset?.uri) {
        return;
      }

      setDocumentFile(asset);
    } catch (error) {
      Alert.alert('Error', error?.message ?? 'Unable to pick Valid ID.');
    }
  };

  const handleNext = async () => {
    if (!documentFile?.uri) {
      Alert.alert('Error', 'Please upload a Valid/Government ID before proceeding.');
      return;
    }

    try {
      setSubmitting(true);
      
      let idBase64 = await FileSystem.readAsStringAsync(documentFile.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const updatedNotarialData = {
        ...notarialData,
        id_name: documentFile.name,
        id_base64: idBase64,
      };

      navigation.navigate('FaceRecognitionScreen', { notarialData: updatedNotarialData });
    } catch (error) {
      Alert.alert('Error', 'Failed to process the uploaded ID. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ClientScreenShell>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <ClientFadeIn>
        <View style={styles.header}>
          <View style={styles.titleRow}>
            <View style={styles.backColumn}>
              <ClientChevronBack
                onPress={() => (navigation.canGoBack() ? navigation.goBack() : null)}
              />
            </View>
            <Text style={styles.headerTitle} numberOfLines={2}>
              Verification step
            </Text>
          </View>
          <Text style={styles.headerSubtitle}>
            Please upload a valid government ID
          </Text>
        </View>

        <View style={styles.content}>
          <View style={styles.formCard}>
            <Text style={styles.sectionTitle}>Upload ID</Text>
            <Text style={styles.instructionText}>
              To process your Affidavit of Loss, we need to verify your identity. Please upload a clear photo or PDF of a valid government ID.
            </Text>

            <Text style={styles.inputLabel}>Valid/Government ID</Text>
            <TouchableOpacity style={styles.uploadArea} onPress={pickID}>
              <Text style={styles.uploadMainText}>
                {documentFile?.name || 'Click to upload your ID'}
              </Text>
              <Text style={styles.uploadSubText}>JPG, PNG, PDF (max 10MB)</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.submitButton, (!documentFile || submitting) && styles.submitButtonDisabled]}
              onPress={handleNext}
              disabled={!documentFile || submitting}>
              {submitting ? (
                <ActivityIndicator color={T.base} />
              ) : (
                <Text style={styles.submitButtonText}>Next</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
        </ClientFadeIn>
      </ScrollView>
    </ClientScreenShell>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: 32 },
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backColumn: {
    width: HEADER_BACK_COL,
    marginRight: HEADER_BACK_GAP,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  headerTitle: {
    flex: 1,
    fontSize: 22,
    fontWeight: '800',
    color: T.text,
    lineHeight: 28,
  },
  headerSubtitle: {
    fontSize: 13,
    color: T.textSoft,
    marginTop: 6,
    marginLeft: SUBTITLE_INDENT,
    lineHeight: 18,
  },
  content: { padding: 20 },
  formCard: {
    backgroundColor: 'rgba(18, 26, 36, 0.88)',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.12)',
  },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: T.gold[0], marginBottom: 10 },
  instructionText: { fontSize: 14, color: T.textMuted, marginBottom: 20, lineHeight: 20 },
  inputLabel: { fontSize: 14, fontWeight: '600', color: T.textSoft, marginBottom: 8, marginTop: 15 },
  uploadArea: {
    borderWidth: 1.5,
    borderColor: 'rgba(244, 215, 139, 0.25)',
    borderStyle: 'dashed',
    borderRadius: 12,
    padding: 30,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    marginBottom: 30,
  },
  uploadMainText: { fontSize: 14, fontWeight: '700', color: T.text, textAlign: 'center' },
  uploadSubText: { fontSize: 12, color: T.textSoft, marginTop: 4 },
  submitButton: {
    backgroundColor: T.gold[1],
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  submitButtonDisabled: {
    backgroundColor: 'rgba(148, 163, 184, 0.4)',
  },
  submitButtonText: { color: T.base, fontWeight: '700', fontSize: 16 },
});
