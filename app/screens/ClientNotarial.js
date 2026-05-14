import React, {useCallback, useEffect, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { getNotarialRequests } from '../services/notarialService';
import {REFERENCE_THEME as T} from '../constants/referenceTheme';
import {ClientScreenShell, ClientFadeIn} from '../components/ClientScreenShell';
import ClientChevronBack from '../components/ClientChevronBack';

const HEADER_BACK_COL = 28;
const HEADER_BACK_GAP = 8;
const SUBTITLE_INDENT = HEADER_BACK_COL + HEADER_BACK_GAP;

export default function ClientNotarial({navigation}) {
  const [activeTab, setActiveTab] = useState('New Request');
  const [requests, setRequests] = useState([]);
  const [loadingStatus, setLoadingStatus] = useState(true);

  const loadRequests = useCallback(async () => {
    try {
      setLoadingStatus(true);
      const records = await getNotarialRequests();
      setRequests(Array.isArray(records) ? records : []);
    } catch (error) {
      Alert.alert('Error', error?.message ?? 'Failed to load notarial requests.');
      setRequests([]);
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

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

        <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'New Request' && styles.activeTab]}
          onPress={() => setActiveTab('New Request')}>
          <Text
            style={[
              styles.tabText,
              activeTab === 'New Request' && styles.activeTabText,
            ]}>
            New Request
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.tab,
            activeTab === 'Request Status' && styles.activeTab,
          ]}
          onPress={() => setActiveTab('Request Status')}>
          <Text
            style={[
              styles.tabText,
              activeTab === 'Request Status' && styles.activeTabText,
            ]}>
            Request Status
          </Text>
        </TouchableOpacity>
        </View>
      </ClientFadeIn>

      <ScrollView
        style={styles.scrollFlex}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>
        <ClientFadeIn delay={100}>
        {activeTab === 'New Request' ? (
          <NewRequestForm navigation={navigation} onSubmitted={loadRequests} />
        ) : (
          <RequestStatusList
            navigation={navigation}
            requests={requests}
            loadingStatus={loadingStatus}
          />
        )}
        </ClientFadeIn>
      </ScrollView>
    </ClientScreenShell>
  );
}

const NewRequestForm = ({navigation, onSubmitted}) => {
  const [serviceType, setServiceType] = useState('Affidavit of Loss');
  const [details, setDetails] = useState('');
  const [documentFile, setDocumentFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const pickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
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

  const handleSubmit = async () => {
    if (!serviceType.trim()) {
      Alert.alert('Error', 'Type of document is required.');
      return;
    }
    if (!documentFile?.uri) {
      Alert.alert('Error', 'Please upload a document before submitting.');
      return;
    }

    try {
      setSubmitting(true);

      let documentBase64 = null;
      if (documentFile?.uri) {
        documentBase64 = await FileSystem.readAsStringAsync(documentFile.uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
      }

      const notarialData = {
        service_type: serviceType.trim(),
        details: details.trim() || null,
        document_name: documentFile?.name || null,
        document_base64: documentBase64,
      };

      setSubmitting(false);
      navigation.navigate('UploadIDScreen', { notarialData });
    } catch (error) {
      setSubmitting(false);
      Alert.alert('Error', error?.message ?? 'Unable to process request.');
    }
  };

  return (
    <View style={styles.formCard}>
      <Text style={styles.sectionTitle}>New Request</Text>

      <Text style={styles.inputLabel}>Type of Document</Text>
      <View style={styles.dropdownButton}>
        <Text style={[styles.dropdownText, { fontWeight: '600' }]}>
          Affidavit of Loss
        </Text>
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

      <TouchableOpacity
        style={styles.submitButton}
        onPress={handleSubmit}
        disabled={submitting}>
        <Text style={styles.submitButtonText}>
          {submitting ? 'Submitting...' : 'Submit Request'}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

const RequestStatusNotificationHint = () => (
  <View style={styles.statusNoticeBox}>
    <Text style={styles.statusNoticeText}>
      🔔 You will be notified in the app when your request is done or when the status is updated.
    </Text>
  </View>
);

const RequestStatusList = ({navigation, requests, loadingStatus}) => {
  if (loadingStatus) {
    return (
      <View style={styles.statusContainer}>
        <Text style={[styles.sectionTitle, styles.statusTabTitle]}>Request Status</Text>
        <RequestStatusNotificationHint />
        <View style={styles.statusCardCentered}>
          <ActivityIndicator color={T.gold[1]} />
          <Text style={styles.subInfoText}>Loading request status...</Text>
        </View>
      </View>
    );
  }

  if (requests.length === 0) {
    return (
      <View style={styles.statusContainer}>
        <Text style={[styles.sectionTitle, styles.statusTabTitle]}>Request Status</Text>
        <RequestStatusNotificationHint />
        <View style={styles.statusCardCentered}>
          <Text style={styles.docTypeTitle}>No requests yet</Text>
          <Text style={styles.subInfoText}>Your notarial requests will appear here.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.statusContainer}>
      <Text style={[styles.sectionTitle, styles.statusTabTitle]}>Request Status</Text>
      <RequestStatusNotificationHint />

      {requests.map(item => {
        const status = (item.status ?? 'PENDING').toUpperCase();
        const paymentStatus = String(item.payment_status || '').toLowerCase();
        const isPaid = paymentStatus === 'paid' || item.payment_is_paid === true;
        const canPay = !isPaid && ['PENDING', 'APPROVED', 'ACCEPTED'].includes(status);
        const submittedDate = item.created_at
          ? new Date(item.created_at).toLocaleDateString()
          : 'N/A';
        return (
          <View key={item.id} style={styles.statusCard}>
            <View style={styles.statusHeaderRow}>
              <Text style={styles.docTypeTitle}>{item.service_type}</Text>
              <View
                style={[
                  styles.badge,
                  (status === 'ACCEPTED' || status === 'APPROVED' || status === 'READY FOR PICKUP')
                    ? {backgroundColor: 'rgba(16, 185, 129, 0.22)'}
                    : (status === 'REJECTED' || status === 'CLOSED')
                      ? {backgroundColor: 'rgba(239, 68, 68, 0.2)'}
                      : status === 'IN PROCESS'
                        ? {backgroundColor: 'rgba(99, 179, 237, 0.18)'}
                        : {backgroundColor: 'rgba(251, 191, 36, 0.18)'},
                ]}>
                <Text
                  style={[
                    styles.badgeText,
                    (status === 'ACCEPTED' || status === 'APPROVED' || status === 'READY FOR PICKUP')
                      ? {color: '#6EE7B7'}
                      : (status === 'REJECTED' || status === 'CLOSED')
                        ? {color: '#FCA5A5'}
                        : status === 'IN PROCESS'
                          ? {color: '#90CDF4'}
                          : {color: T.gold[0]},
                  ]}>
                  {status}
                </Text>
              </View>
            </View>
            <Text style={styles.subInfoText}>Submitted on {submittedDate}</Text>

            {canPay && (
              <TouchableOpacity
                style={styles.paymentButton}
                onPress={() =>
                  navigation.navigate('BookingSummary', {
                    serviceData: {
                      type: item.service_type,
                      date: submittedDate,
                      time: 'To be confirmed',
                      amount: '₱1', // TEST AMOUNT — change to ₱4,000 before go-live
                    },
                    paymentContext: {
                      sourceType: 'notarial',
                      sourceId: item.id,
                      attorneyId: item.attorney_id,
                      amount: 1, // TEST AMOUNT — change to 4000 before go-live
                    },
                  })
                }>
                <Text style={styles.paymentButtonText}>Proceed to Payment</Text>
              </TouchableOpacity>
            )}
          </View>
        );
      })}
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
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginHorizontal: 20,
    borderRadius: 12,
    padding: 4,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.12)',
  },
  tab: {flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 10},
  activeTab: {
    backgroundColor: 'rgba(18, 26, 36, 0.95)',
    elevation: 2,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.2)',
  },
  tabText: {fontSize: 14, fontWeight: '600', color: T.textSoft},
  activeTabText: {color: T.gold[0]},
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
  statusTabTitle: {
    marginBottom: 12,
  },
  statusNoticeBox: {
    backgroundColor: 'rgba(59, 130, 246, 0.12)',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(96, 165, 250, 0.25)',
  },
  statusNoticeText: {
    fontSize: 13,
    color: '#93C5FD',
    lineHeight: 20,
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
  submitButtonText: {color: T.base, fontWeight: '700', fontSize: 16},
  statusContainer: {marginHorizontal: 20},
  statusCardCentered: {
    backgroundColor: 'rgba(18, 26, 36, 0.85)',
    borderRadius: 20,
    padding: 20,
    marginBottom: 15,
    elevation: 1,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.12)',
  },
  statusCard: {
    backgroundColor: 'rgba(18, 26, 36, 0.85)',
    borderRadius: 20,
    padding: 20,
    marginBottom: 15,
    elevation: 1,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.12)',
  },
  statusHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  docTypeTitle: {fontSize: 18, fontWeight: '700', color: T.text},
  badge: {paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8},
  badgeText: {fontSize: 10, fontWeight: '800'},
  subInfoText: {fontSize: 12, color: T.textSoft, marginTop: 8, textAlign: 'center'},
  paymentButton: {
    backgroundColor: T.gold[1],
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 15,
  },
  paymentButtonText: {color: T.base, fontWeight: '700'},
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
  dropdownPlaceholder: {color: T.textSoft, fontSize: 14},
  dropdownArrow: {color: T.textSoft, fontSize: 10},
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: 'rgba(18, 26, 36, 0.98)',
    borderRadius: 20,
    width: '80%',
    maxHeight: 400,
    paddingVertical: 20,
    elevation: 5,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.15)',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: T.text,
    textAlign: 'center',
    marginBottom: 12,
    paddingHorizontal: 20,
  },
  modalOption: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(244, 215, 139, 0.08)',
  },
  modalOptionSelected: {backgroundColor: 'rgba(244, 215, 139, 0.1)'},
  modalOptionText: {fontSize: 15, color: T.textMuted},
  modalOptionTextSelected: {color: T.gold[0], fontWeight: '700'},
});
