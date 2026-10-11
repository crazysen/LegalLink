import React, {useEffect, useState} from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import {File} from 'expo-file-system';
import {REFERENCE_THEME as T} from '../constants/referenceTheme';
import {ClientScreenShell, ClientFadeIn} from '../components/ClientScreenShell';
import ClientChevronBack from '../components/ClientChevronBack';
import {createNotarialRequest} from '../services/notarialService';
import {warmPaymentBackend} from '../services/paymentApiClient';
import {
  NOTARIAL_SERVICE_FEE,
  formatNotarialFeePhp,
  resolveNotarialAmount,
} from '../constants/notarialFees';

const HEADER_BACK_COL = 28;
const HEADER_BACK_GAP = 8;
const SUBTITLE_INDENT = HEADER_BACK_COL + HEADER_BACK_GAP;

export default function ClientNotarial({navigation}) {
  return (
    <ClientScreenShell>
      <ClientFadeIn>
        <View style={styles.header}>
          <View style={styles.titleRow}>
            <View style={styles.backColumn}>
              <ClientChevronBack
                onPress={() => (navigation.canGoBack() ? navigation.goBack() : null)}
              />
            </View>
            <Text style={styles.headerTitle} numberOfLines={2}>
              Notarial Service Request
            </Text>
          </View>
          <Text style={styles.headerSubtitle}>
            Submit your documents for notarization
          </Text>
        </View>
      </ClientFadeIn>

      <ScrollView
        style={styles.scrollFlex}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>
        <ClientFadeIn delay={100}>
          <NewRequestForm navigation={navigation} />
        </ClientFadeIn>
      </ScrollView>
    </ClientScreenShell>
  );
}

const NewRequestForm = ({navigation}) => {
  const [serviceType, setServiceType] = useState('Affidavit of Loss');
  const [details, setDetails] = useState('');
  const [documentFile, setDocumentFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    warmPaymentBackend().catch(() => {});
  }, []);

  const pickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'application/pdf',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ],
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
      Alert.alert('Error', error?.message ?? 'Unable to pick document.');
    }
  };

  const handleProceedToPayment = async () => {
    if (!serviceType.trim()) {
      Alert.alert('Error', 'Type of document is required.');
      return;
    }
    if (!documentFile?.uri) {
      Alert.alert('Error', 'Please upload a document before proceeding to payment.');
      return;
    }

    try {
      setSubmitting(true);
      warmPaymentBackend().catch(() => {});

      let documentBytes = null;
      let documentBase64 = null;
      try {
        documentBytes = await new File(documentFile.uri).bytes();
      } catch {
        documentBase64 = await FileSystem.readAsStringAsync(documentFile.uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
      }

      const created = await createNotarialRequest({
        service_type: serviceType.trim(),
        details: details.trim() || null,
        document_name: documentFile.name || null,
        document_bytes: documentBytes,
        document_base64: documentBase64,
        amount: NOTARIAL_SERVICE_FEE,
      });

      if (!created?.id) {
        throw new Error('Could not save your request. Please try again.');
      }

      const amount = resolveNotarialAmount(created.amount);
      setDocumentFile(null);
      setDetails('');

      navigation.navigate('Payment', {
        paymentMethod: 'qrph',
        serviceData: {
          type: created.service_type || serviceType.trim(),
          amount: formatNotarialFeePhp(amount),
        },
        paymentContext: {
          sourceType: 'notarial',
          sourceId: created.id,
          attorneyId: created.attorney_id ?? null,
          amount,
          fromNewRequest: true,
        },
      });
    } catch (error) {
      Alert.alert('Error', error?.message ?? 'Unable to start payment.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.formCard}>
      <Text style={styles.sectionTitle}>New Request</Text>

      <Text style={styles.inputLabel}>Type of Document</Text>
      <View style={styles.dropdownButton}>
        <Text style={[styles.dropdownText, {fontWeight: '600'}]}>Affidavit of Loss</Text>
      </View>

      <Text style={styles.inputLabel}>Upload Document</Text>
      <TouchableOpacity style={styles.uploadArea} onPress={pickDocument}>
        <Text style={styles.uploadMainText}>
          {documentFile?.name || 'Click to upload your document'}
        </Text>
        <Text style={styles.uploadSubText}>PDF, DOC, DOCX (max 10MB)</Text>
      </TouchableOpacity>

      <Text style={styles.inputLabel}>Additional Notes</Text>
      <TextInput
        style={[styles.input, styles.textArea]}
        placeholder="Any special instructions or requirements..."
        placeholderTextColor={T.textSoft}
        multiline
        numberOfLines={4}
        value={details}
        onChangeText={setDetails}
      />

      <View style={styles.summaryBox}>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Service</Text>
          <Text style={styles.summaryValue}>{serviceType}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Document</Text>
          <Text style={styles.summaryValue} numberOfLines={1}>
            {documentFile?.name || '—'}
          </Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Amount due</Text>
          <Text style={styles.summaryAmount}>
            {formatNotarialFeePhp(NOTARIAL_SERVICE_FEE)}
          </Text>
        </View>
        <Text style={styles.summaryNote}>
          You will pay with QR Ph on the PayMongo page.
        </Text>
      </View>

      <TouchableOpacity
        style={[styles.submitButton, submitting && styles.submitButtonDisabled]}
        onPress={handleProceedToPayment}
        disabled={submitting}>
        <Text style={styles.submitButtonText}>
          {submitting ? 'Opening payment...' : 'Proceed to Payment'}
        </Text>
      </TouchableOpacity>

      <Text style={styles.trackHint}>
        Your file is saved before payment. If you leave PayMongo, finish paying anytime under
        Menu → Notary Status.
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  scrollFlex: {flex: 1},
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
  scrollContent: {paddingBottom: 30},
  formCard: {
    backgroundColor: 'rgba(18, 26, 36, 0.85)',
    marginHorizontal: 20,
    borderRadius: 20,
    padding: 20,
    elevation: 2,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.12)',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: T.text,
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: T.textSoft,
    marginBottom: 8,
    marginTop: 15,
  },
  uploadArea: {
    borderWidth: 1.5,
    borderColor: 'rgba(244, 215, 139, 0.22)',
    borderStyle: 'dashed',
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  uploadMainText: {fontSize: 14, fontWeight: '700', color: T.text},
  uploadSubText: {fontSize: 12, color: T.textSoft, marginTop: 4},
  input: {
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.15)',
    borderRadius: 12,
    padding: 12,
    backgroundColor: 'rgba(4, 7, 11, 0.5)',
    color: T.text,
  },
  textArea: {height: 100, textAlignVertical: 'top'},
  submitButton: {
    backgroundColor: T.gold[1],
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 25,
  },
  submitButtonDisabled: {opacity: 0.6},
  submitButtonText: {color: T.base, fontWeight: '700', fontSize: 16},
  summaryBox: {
    marginTop: 20,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.15)',
    borderRadius: 12,
    padding: 14,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    gap: 12,
  },
  summaryLabel: {fontSize: 13, color: T.textSoft},
  summaryValue: {flexShrink: 1, fontSize: 13, fontWeight: '700', color: T.text, textAlign: 'right'},
  summaryAmount: {fontSize: 14, fontWeight: '800', color: T.gold[0]},
  summaryNote: {fontSize: 11, color: T.textSoft, marginTop: 2, lineHeight: 16},
  trackHint: {
    marginTop: 16,
    fontSize: 12,
    color: T.textSoft,
    textAlign: 'center',
    lineHeight: 18,
  },
  dropdownButton: {
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.15)',
    borderRadius: 12,
    padding: 12,
    backgroundColor: 'rgba(4, 7, 11, 0.5)',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dropdownText: {color: T.text, fontSize: 14},
});
