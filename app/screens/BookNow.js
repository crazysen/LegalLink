import React, {useState, useEffect, useCallback, useRef} from 'react';
import {
  Alert,
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Modal,
  Image,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import {
  formatLocalDateString,
  getAvailability,
  isConsultationSlotInTheFuture,
} from '../services/appointmentService';
import {sortAvailabilitySlotsChronologically} from '../services/availabilityScheduleUtils';
import {REFERENCE_THEME as T} from '../constants/referenceTheme';
import {DEFAULT_PAYMENT_METHOD} from '../constants/paymentConfig';
import {IS_ANDROID, IS_IOS} from '../constants/platformUi';
import {ClientScreenShell, ClientFadeIn} from '../components/ClientScreenShell';
import ClientChevronBack from '../components/ClientChevronBack';
import ClientAvailabilityCalendar from '../components/ClientAvailabilityCalendar';
import * as DocumentPicker from 'expo-document-picker';
import {
  getCurrentSessionProfile,
  subscribeToAvailabilitySlots,
  uploadAppointmentAttachment,
} from '../services/userApi';
import { warmPaymentBackend } from '../services/paymentApiClient';
import {getBundledAttorneyPhotoSource} from '../constants/attorneyPhotos';
import {NOTARIAL_SERVICE_FEE} from '../constants/notarialFees';

const HEADER_BACK_COL = 28;
const HEADER_BACK_GAP = 8;
const SUBTITLE_INDENT = HEADER_BACK_COL + HEADER_BACK_GAP;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const NOTARIAL_DOC_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

function formatBytes(bytes) {
  const size = Number(bytes || 0);
  if (!Number.isFinite(size) || size <= 0) return 'Size unavailable';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

export default function BookNow({navigation, route}) {
  /** @type {{ id: string, time: string } | null} */
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [showPicker, setShowPicker] = useState(false);
  
  const [availableSlots, setAvailableSlots] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const slotsRequestId = useRef(0);

  const [reason, setReason] = useState('');
  const [attachment, setAttachment] = useState(null);
  const [bookingStep, setBookingStep] = useState(1);
  const paymentMethod = DEFAULT_PAYMENT_METHOD;
  const attorney = route?.params?.attorney || {
    name: 'Attorney',
    specialty: 'General Practice',
    price: 'PHP 2000.00',
    amount: 2000,
  };
  const displayedExpertise = attorney?.specialty || 'General Practice';
  const consultationAmount =
    Number(attorney?.amount) ||
    Number(String(attorney?.price || '').replace(/[^\d.]/g, '')) ||
    2000;
  const [hiddenPastSlotsCount, setHiddenPastSlotsCount] = useState(0);
  // Notarial add-on state (Directive 4)
  const [includeNotarial, setIncludeNotarial] = useState(false);
  const [notarialNotes, setNotarialNotes] = useState('');
  const [notarialDocument, setNotarialDocument] = useState(null);
  const [uploadingNotarialDoc, setUploadingNotarialDoc] = useState(false);

  const localDateStr = formatLocalDateString(selectedDate);

  const fetchAvailableSlots = useCallback(async () => {
    if (!attorney?.id) return;
    const reqId = ++slotsRequestId.current;
    try {
      setLoadingSlots(true);
      setSelectedSlot(null);
      const slots = await getAvailability(attorney.id, localDateStr);
      if (reqId !== slotsRequestId.current) {
        return;
      }

      const now = new Date();

      const allSlots = slots || [];
      let hiddenPast = 0;
      const openSlots = allSlots.filter(s => {
        const ok = isConsultationSlotInTheFuture(selectedDate, s.time, now);
        if (!ok) hiddenPast += 1;
        return ok;
      });

      setHiddenPastSlotsCount(hiddenPast);
      setAvailableSlots(sortAvailabilitySlotsChronologically(openSlots));
    } catch (error) {
      if (reqId === slotsRequestId.current) {
        Alert.alert('Error', 'Failed to load available slots.');
      }
    } finally {
      if (reqId === slotsRequestId.current) {
        setLoadingSlots(false);
      }
    }
  }, [attorney?.id, localDateStr, selectedDate]);

  useEffect(() => {
    fetchAvailableSlots();
  }, [fetchAvailableSlots]);

  useEffect(() => {
    warmPaymentBackend().catch(() => {});
  }, []);

  useEffect(() => {
    if (!attorney?.id) return undefined;
    const unsubscribe = subscribeToAvailabilitySlots(payload => {
      const changedRow = payload?.new || payload?.old || {};
      if (
        changedRow.attorney_id &&
        String(changedRow.attorney_id) !== String(attorney.id)
      ) {
        return;
      }
      fetchAvailableSlots();
    });
    return unsubscribe;
  }, [attorney?.id, fetchAvailableSlots]);

  const buildBookingPaymentPayload = () => {
    const [time, modifier] = selectedSlot.time.split(' ');
    const [rawHour, rawMinute] = time.split(':');
    let hour = Number(rawHour);
    if (modifier === 'PM' && hour < 12) hour += 12;
    if (modifier === 'AM' && hour === 12) hour = 0;

    const localAppointmentDate = new Date(
      selectedDate.getFullYear(),
      selectedDate.getMonth(),
      selectedDate.getDate(),
      hour,
      Number(rawMinute),
      0,
    );

    const notarialAddOnFee = includeNotarial ? NOTARIAL_SERVICE_FEE : 0;
    const totalAmount = consultationAmount + notarialAddOnFee;

    return {
      attorney_id: attorney.id,
      title: `Consultation - ${displayedExpertise}`,
      notes: reason.trim() || null,
      scheduled_at: localAppointmentDate.toISOString(),
      slot_time: selectedSlot.time,
      slot_date: localDateStr,
      slot_id: selectedSlot.id,
      amount: totalAmount,
      attachment_url: attachment?.url || null,
      attachment_name: attachment?.name || null,
      // Bundled notarial request fields
      includeNotarial,
      notarialNotes: notarialNotes.trim() || null,
      notarialServiceType: 'Affidavit of Loss',
      notarialAddOnFee,
      notarialDocumentUrl: includeNotarial ? notarialDocument?.url || null : null,
      notarialDocumentName: includeNotarial ? notarialDocument?.name || null : null,
    };
  };

  const validateBookingStepOne = () => {
    if (!attorney?.id) {
      Alert.alert('Error', 'Please select an attorney from the list first.');
      return false;
    }
    if (!selectedSlot?.time || !selectedSlot?.id) {
      Alert.alert('Error', 'Please select a time slot.');
      return false;
    }
    if (!isConsultationSlotInTheFuture(selectedDate, selectedSlot.time)) {
      Alert.alert(
        'Time no longer available',
        'That time has already passed today. Please pick a later slot.',
      );
      return false;
    }
    if (includeNotarial && !notarialDocument?.url) {
      Alert.alert(
        'Document required',
        'Please upload the document to be notarized before continuing.',
      );
      return false;
    }
    return true;
  };

  const handleProceedToPayment = () => {
    if (!validateBookingStepOne()) return;
    setBookingStep(2);
  };

  const handlePayNow = () => {
    if (!validateBookingStepOne()) return;

    warmPaymentBackend().catch(() => {});

    const payload = buildBookingPaymentPayload();
    const totalAmount = payload.amount;
    const displayAmount = `PHP ${totalAmount.toFixed(2)}`;

    navigation.navigate('Payment', {
      paymentMethod,
      paymentContext: {
        sourceType: 'appointment_booking',
        payload,
      },
      serviceData: {
        amount: displayAmount,
        type: `Consultation - ${displayedExpertise}${
          includeNotarial ? ' + Notarial Request' : ''
        }`,
      },
    });
  };

  const handleAttach = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const asset =
        result.assets?.[0] ??
        (result.uri
          ? {
              uri: result.uri,
              name: result.name,
              size: result.size,
              mimeType: result.mimeType,
            }
          : null);
      if (!asset?.uri) return;
      const byteSize = Number(asset.size ?? 0);
      if (byteSize > MAX_ATTACHMENT_BYTES) {
        Alert.alert('Attachment too large', `Selected file is ${formatBytes(byteSize)}; max is 10 MB.`);
        return;
      }
      const { profile } = await getCurrentSessionProfile();
      if (!profile?.id) {
        Alert.alert('Sign in required', 'Please sign in to upload attachments.');
        return;
      }
      const uploaded = await uploadAppointmentAttachment({ clientId: profile.id, file: asset });
      setAttachment(uploaded ? {...uploaded, size: byteSize || undefined} : null);
      Alert.alert('Attachment uploaded', uploaded?.name || 'Uploaded');
    } catch (e) {
      Alert.alert('Attachment error', e?.message || 'Could not upload attachment.');
    }
  };

  const handleNotarialDocumentPick = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: NOTARIAL_DOC_TYPES,
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;

      const asset =
        result.assets?.[0] ??
        (result.uri
          ? {
              uri: result.uri,
              name: result.name,
              size: result.size,
              mimeType: result.mimeType,
            }
          : null);
      if (!asset?.uri) return;

      const byteSize = Number(asset.size ?? 0);
      if (byteSize > MAX_ATTACHMENT_BYTES) {
        Alert.alert(
          'Document too large',
          `Selected file is ${formatBytes(byteSize)}; max is 10 MB.`,
        );
        return;
      }

      const {profile} = await getCurrentSessionProfile();
      if (!profile?.id) {
        Alert.alert('Sign in required', 'Please sign in to upload the notarial document.');
        return;
      }

      setUploadingNotarialDoc(true);
      const uploaded = await uploadAppointmentAttachment({
        clientId: profile.id,
        file: asset,
      });
      setNotarialDocument(
        uploaded
          ? {...uploaded, size: byteSize || undefined}
          : null,
      );
    } catch (e) {
      Alert.alert(
        'Upload error',
        e?.message || 'Could not upload the notarial document.',
      );
    } finally {
      setUploadingNotarialDoc(false);
    }
  };

  const toggleIncludeNotarial = () => {
    setIncludeNotarial(prev => {
      const next = !prev;
      if (!next) {
        setNotarialDocument(null);
        setNotarialNotes('');
      }
      return next;
    });
  };

  const handleCancel = () => {
    navigation.canGoBack() ? navigation.goBack() : null;
  };

  const onChangeDateAndroid = (event, date) => {
    if (IS_ANDROID) {
      setShowPicker(false);
      if (event?.type === 'dismissed') {
        return;
      }
    }
    if (date) {
      setSelectedDate(date);
    }
  };

  return (
    <ClientScreenShell>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        <ClientFadeIn>
        <View style={styles.screenHeader}>
          <View style={styles.titleRow}>
            <View style={styles.backColumn}>
              <ClientChevronBack onPress={handleCancel} />
            </View>
            <Text style={styles.headerTitle} numberOfLines={2}>
              Book an Appointment
            </Text>
          </View>
          <Text style={styles.headerSubtitle}>Choose from available slots</Text>
        </View>

        <View style={styles.formCard}>
          <Text style={styles.cardTitle}>Complete Your Booking</Text>

          <View style={styles.summaryBox}>
            <View style={styles.attorneySummaryRow}>
              {getBundledAttorneyPhotoSource(attorney.name) ? (
                <Image
                  source={getBundledAttorneyPhotoSource(attorney.name)}
                  style={styles.attorneySummaryPhoto}
                  resizeMode="cover"
                />
              ) : attorney.img || attorney.image ? (
                <Image
                  source={{uri: attorney.img || attorney.image}}
                  style={styles.attorneySummaryPhoto}
                  resizeMode="cover"
                />
              ) : (
                <View style={[styles.attorneySummaryPhoto, styles.attorneySummaryPhotoPlaceholder]}>
                  <Text style={styles.attorneySummaryInitials}>
                    {String(attorney.name || 'A')
                      .trim()
                      .split(/\s+/)
                      .map(p => p[0])
                      .join('')
                      .slice(0, 2)
                      .toUpperCase()}
                  </Text>
                </View>
              )}
              <View style={styles.attorneySummaryText}>
                <Text style={styles.summaryLabel}>Attorney</Text>
                <Text style={styles.summaryValue}>{attorney.name}</Text>
              </View>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Fee:</Text>
              <Text style={styles.feeValue}>{attorney.price}</Text>
            </View>
            <View style={[styles.summaryRow, {marginBottom: 0}]}>
              <Text style={styles.summaryLabel}>Expertise:</Text>
              <Text style={[styles.summaryValue, styles.expertiseValue]}>{displayedExpertise}</Text>
            </View>
          </View>

          {bookingStep === 1 ? (
          <>
          <Text style={styles.inputLabel}>📎 Supporting document (optional)</Text>
          <TouchableOpacity style={styles.attachRow} onPress={handleAttach} activeOpacity={0.85}>
            <Text style={styles.attachPrimary}>{attachment ? 'Replace attachment' : 'Attach document'}</Text>
            <Text style={styles.attachHint}>PDF, images, or office files · max 10 MB</Text>
          </TouchableOpacity>
          {attachment ? (
            <View style={styles.attachmentPill}>
              <Text style={styles.attachmentName} numberOfLines={1}>
                {attachment.name}
              </Text>
              {attachment.size ? (
                <Text style={styles.attachmentMeta}>{formatBytes(attachment.size)}</Text>
              ) : null}
              <TouchableOpacity
                onPress={() => setAttachment(null)}
                hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}>
                <Text style={styles.attachmentRemove}>Remove</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <Text style={styles.inputLabel}>📅 Select Date</Text>

          {/* ── Availability Calendar with dot indicators ── */}
          <ClientAvailabilityCalendar
            attorneyId={attorney?.id}
            selectedDate={localDateStr}
            onSelectDate={(dateKey) => {
              const [y, m, d] = dateKey.split('-').map(Number);
              setSelectedDate(new Date(y, m - 1, d));
            }}
          />

          {/* Fallback inline date picker (Android / manual override) */}
          {IS_ANDROID && showPicker && (
            <DateTimePicker
              value={selectedDate}
              mode="date"
              display="default"
              onChange={onChangeDateAndroid}
              minimumDate={new Date()}
            />
          )}

          <Text style={styles.inputLabel}>🕒 Select Available Slot</Text>

          {hiddenPastSlotsCount > 0 ? (
            <Text style={styles.hiddenSlotsHint}>
              {hiddenPastSlotsCount} slot{hiddenPastSlotsCount === 1 ? ' was' : 's were'} hidden because the
              time already passed today.
            </Text>
          ) : null}

          {loadingSlots ? (
            <View style={{marginBottom: 20}}>
              <ActivityIndicator size="small" color={T.gold[1]} />
              <Text style={styles.loadingSlotsHint}>Loading available times…</Text>
            </View>
          ) : availableSlots.length === 0 ? (
            <Text style={styles.noSlotsText}>No availability for this date.</Text>
          ) : (
            <View style={styles.timeGrid}>
              {availableSlots.map(slot => (
                <TouchableOpacity
                  key={slot.id}
                  onPress={() => setSelectedSlot(slot)}
                  style={[
                    styles.timeChip,
                    selectedSlot?.id === slot.id && styles.timeChipSelected,
                  ]}
                >
                  <Text
                    style={[
                      styles.timeChipText,
                      selectedSlot?.id === slot.id && styles.timeChipTextSelected,
                    ]}>
                    {slot.time}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <Text style={styles.inputLabel}>📝 Notes (optional)</Text>
          <TextInput
            style={styles.textArea}
            placeholder="Add notes for the attorney (optional)..."
            placeholderTextColor={T.textSoft}
            multiline
            numberOfLines={4}
            value={reason}
            onChangeText={setReason}
          />

          {/* ── Notarial Add-On Toggle (Directive 4) ── */}
          <TouchableOpacity
            style={[
              styles.notarialToggle,
              includeNotarial && styles.notarialToggleActive,
            ]}
            onPress={toggleIncludeNotarial}
            activeOpacity={0.85}>
            <View style={styles.notarialToggleLeft}>
              <Text style={styles.notarialToggleIcon}>📄</Text>
              <View>
                <Text style={styles.notarialToggleTitle}>
                  Add Notarial Request
                </Text>
                <Text style={styles.notarialToggleHint}>
                  Bundle a notarization with this booking
                </Text>
              </View>
            </View>
            <View
              style={[
                styles.notarialTogglePill,
                includeNotarial && styles.notarialTogglePillOn,
              ]}>
              <Text style={styles.notarialTogglePillText}>
                {includeNotarial ? 'ON' : 'OFF'}
              </Text>
            </View>
          </TouchableOpacity>

          {includeNotarial ? (
            <>
              <Text style={[styles.inputLabel, {marginTop: 4}]}>
                Upload Document
              </Text>
              <TouchableOpacity
                style={styles.notarialUploadArea}
                onPress={handleNotarialDocumentPick}
                disabled={uploadingNotarialDoc}
                activeOpacity={0.85}>
                {uploadingNotarialDoc ? (
                  <ActivityIndicator size="small" color={T.gold[1]} />
                ) : (
                  <>
                    <Text style={styles.notarialUploadMain}>
                      {notarialDocument?.name || 'Click to upload your document'}
                    </Text>
                    <Text style={styles.notarialUploadSub}>
                      PDF, DOC, DOCX (max 10MB)
                    </Text>
                  </>
                )}
              </TouchableOpacity>
              {notarialDocument?.url ? (
                <View style={styles.attachmentPill}>
                  <Text style={styles.attachmentName} numberOfLines={1}>
                    {notarialDocument.name}
                  </Text>
                  {notarialDocument.size ? (
                    <Text style={styles.attachmentMeta}>
                      {formatBytes(notarialDocument.size)}
                    </Text>
                  ) : null}
                  <TouchableOpacity
                    onPress={() => setNotarialDocument(null)}
                    hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}>
                    <Text style={styles.attachmentRemove}>Remove</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              <Text style={[styles.inputLabel, {marginTop: 12}]}>
                📋 Notarial Notes (optional)
              </Text>
              <TextInput
                style={styles.textArea}
                placeholder="Describe the document to be notarized..."
                placeholderTextColor={T.textSoft}
                multiline
                numberOfLines={3}
                value={notarialNotes}
                onChangeText={setNotarialNotes}
              />
              <View style={styles.notarialFeeNote}>
                <Text style={styles.notarialFeeNoteText}>
                  ✦ A notarial service fee will be added to your total payment.
                </Text>
              </View>
            </>
          ) : null}

          <View style={styles.noteBox}>
            <Text style={styles.noteText}>
              <Text style={{ fontWeight: 'bold' }}>Payment First:</Text> Your consultation slot is only confirmed and blocked off after successful payment.
            </Text>
          </View>

          <TouchableOpacity
            style={[
              styles.submitButton,
              (loadingSlots || !selectedSlot || uploadingNotarialDoc) &&
                styles.submitDisabled,
            ]}
            onPress={handleProceedToPayment}
            disabled={loadingSlots || !selectedSlot || uploadingNotarialDoc}>
            <Text style={styles.submitButtonText}>Proceed to Payment →</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.cancelButton} onPress={handleCancel}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
          </>
          ) : (
          <>
            <Text style={styles.inputLabel}>💳 Payment Method</Text>
            <View style={styles.payMethodStatic}>
              <Text style={styles.payMethodStaticText}>QR Ph — scan to pay</Text>
            </View>

            <View style={[styles.summaryBox, { marginTop: 8 }]}>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Date:</Text>
                <Text style={styles.summaryValue}>{localDateStr}</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Time:</Text>
                <Text style={styles.summaryValue}>{selectedSlot?.time || '—'}</Text>
              </View>
              <View style={[styles.summaryRow, { marginBottom: 0 }]}>
                <Text style={styles.summaryLabel}>Amount:</Text>
                <Text style={styles.feeValue}>
                  {includeNotarial
                    ? `PHP ${(consultationAmount + NOTARIAL_SERVICE_FEE).toFixed(2)} (incl. notarial)`
                    : (attorney.price || `₱${consultationAmount.toFixed(2)}`)}
                </Text>
              </View>
              {attachment?.name ? (
                <View style={[styles.summaryRow, { marginTop: 8, marginBottom: 0 }]}>
                  <Text style={styles.summaryLabel}>Attached:</Text>
                  <Text style={styles.summaryValue} numberOfLines={1}>
                    {attachment.name}
                  </Text>
                </View>
              ) : null}
            </View>

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
              <TouchableOpacity
                style={[styles.cancelButton, { flex: 1, marginBottom: 0 }]}
                onPress={() => setBookingStep(1)}>
                <Text style={styles.cancelButtonText}>← Back</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.submitButton, { flex: 2, marginBottom: 0 }]} onPress={handlePayNow}>
                <Text style={styles.submitButtonText}>Pay Now</Text>
              </TouchableOpacity>
            </View>
          </>
          )}
        </View>
        </ClientFadeIn>
      </ScrollView>
    </ClientScreenShell>
  );
}

const styles = StyleSheet.create({
  scrollContent: { padding: 20, paddingBottom: 36 },
  screenHeader: { marginBottom: 8 },
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
    fontSize: 28,
    fontWeight: '800',
    color: T.text,
    lineHeight: 34,
  },
  headerSubtitle: {
    fontSize: 14,
    color: T.textSoft,
    marginTop: 6,
    marginLeft: SUBTITLE_INDENT,
    lineHeight: 20,
    marginBottom: 20,
  },
  formCard: { 
    backgroundColor: 'rgba(18, 26, 36, 0.85)', 
    borderRadius: 24, 
    padding: 20, 
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.12)',
    shadowColor: '#000', 
    shadowOpacity: 0.2, 
    shadowRadius: 15,
    elevation: 2 
  },
  cardTitle: { fontSize: 20, fontWeight: 'bold', color: T.text, marginBottom: 20 },
  summaryBox: { 
    backgroundColor: 'rgba(255,255,255,0.04)', 
    borderRadius: 16, 
    padding: 16, 
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.1)',
  },
  attorneySummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
    gap: 12,
  },
  attorneySummaryPhoto: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: 'rgba(244, 215, 139, 0.35)',
  },
  attorneySummaryPhotoPlaceholder: {
    backgroundColor: 'rgba(30, 58, 138, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  attorneySummaryInitials: {
    color: T.gold[0],
    fontSize: 18,
    fontWeight: '800',
  },
  attorneySummaryText: {flex: 1, minWidth: 0},
  summaryRow: { flexDirection: 'row', marginBottom: 8 },
  summaryLabel: { fontSize: 14, fontWeight: 'bold', color: T.textSoft, width: 80 },
  summaryValue: { fontSize: 14, color: T.textMuted, flex: 1 },
  feeValue: { fontSize: 14, fontWeight: 'bold', color: T.gold[0] },
  expertiseValue: {fontWeight: '600', color: T.gold[0]},
  attachRow: {
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.2)',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  attachPrimary: {color: T.text, fontWeight: '700', fontSize: 15},
  attachHint: {color: T.textSoft, fontSize: 12, marginTop: 4},
  attachmentPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    marginBottom: 20,
    backgroundColor: 'rgba(4, 7, 11, 0.45)',
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.15)',
  },
  attachmentName: {flex: 1, color: T.text, fontSize: 13, fontWeight: '600'},
  attachmentMeta: {color: T.textSoft, fontSize: 12},
  attachmentRemove: {color: '#FCA5A5', fontWeight: '700', fontSize: 13},
  inputLabel: { fontSize: 14, fontWeight: '700', color: T.textSoft, marginBottom: 12 },
  datePicker: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.2)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    backgroundColor: 'rgba(59, 130, 246, 0.12)',
  },
  dateText: { fontSize: 15, color: '#93C5FD', fontWeight: '500' },
  calendarIcon: { fontSize: 16, color: T.textSoft },
  dateModalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  dateModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(4, 7, 11, 0.65)',
  },
  dateModalSheet: {
    backgroundColor: 'rgba(18, 26, 36, 0.98)',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 24,
    maxHeight: '85%',
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.15)',
  },
  dateModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(244, 215, 139, 0.12)',
  },
  dateModalTitle: {fontSize: 16, fontWeight: '600', color: T.text},
  dateModalCancel: {fontSize: 16, color: T.textSoft},
  dateModalDone: {fontSize: 16, fontWeight: '700', color: T.gold[0]},
  
  hiddenSlotsHint: {
    color: '#FBBF24',
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 10,
  },
  loadingSlotsHint: {
    marginTop: 8,
    fontSize: 13,
    color: T.textSoft,
    textAlign: 'center',
  },
  noSlotsText: { color: '#F87171', marginBottom: 20, fontStyle: 'italic', fontSize: 13 },
  
  timeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 24 },
  timeChip: {
    width: '30%',
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.15)',
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  timeChipSelected: { backgroundColor: T.gold[1], borderColor: T.gold[1] },
  timeChipText: { color: T.text, fontWeight: '600', fontSize: 12 },
  timeChipTextSelected: { color: T.base },
  
  textArea: {
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.15)',
    borderRadius: 12,
    padding: 16,
    height: 100,
    textAlignVertical: 'top',
    marginBottom: 24,
    color: T.text,
    backgroundColor: 'rgba(4, 7, 11, 0.35)',
  },
  noteBox: { 
    backgroundColor: 'rgba(59, 130, 246, 0.12)', 
    padding: 16, 
    borderRadius: 12, 
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(96, 165, 250, 0.2)',
  },
  noteText: { color: '#93C5FD', fontSize: 13, lineHeight: 18 },
  submitButton: { 
    backgroundColor: T.gold[1], 
    paddingVertical: 16, 
    borderRadius: 12, 
    marginBottom: 12 
  },
  submitDisabled: { backgroundColor: 'rgba(148, 163, 184, 0.45)' },
  submitButtonText: { color: T.base, textAlign: 'center', fontWeight: 'bold', fontSize: 16 },
  cancelButton: { 
    paddingVertical: 16, 
    borderRadius: 12, 
    borderWidth: 1, 
    borderColor: 'rgba(244, 215, 139, 0.2)' 
  },
  cancelButtonText: { color: T.textSoft, textAlign: 'center', fontWeight: '600' },
  payMethodRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  payMethodStatic: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.35)',
    backgroundColor: 'rgba(244, 215, 139, 0.08)',
    marginBottom: 8,
  },
  payMethodStaticText: {
    color: T.text,
    fontWeight: '700',
    fontSize: 14,
    textAlign: 'center',
  },
  payMethodChip: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.2)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  payMethodChipActive: { backgroundColor: T.gold[1], borderColor: T.gold[1] },
  payMethodChipText: { color: T.text, fontWeight: '600', fontSize: 13 },
  payMethodChipTextActive: { color: T.base },

  // Notarial add-on toggle (Directive 4)
  notarialToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.2)',
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  notarialToggleActive: {
    borderColor: 'rgba(244, 215, 139, 0.55)',
    backgroundColor: 'rgba(244, 215, 139, 0.06)',
  },
  notarialToggleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  notarialToggleIcon: { fontSize: 22 },
  notarialToggleTitle: {
    color: T.text,
    fontWeight: '700',
    fontSize: 14,
  },
  notarialToggleHint: {
    color: T.textSoft,
    fontSize: 11,
    marginTop: 2,
  },
  notarialTogglePill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.35)',
    backgroundColor: 'rgba(148,163,184,0.1)',
  },
  notarialTogglePillOn: {
    borderColor: T.gold[1],
    backgroundColor: T.gold[1],
  },
  notarialTogglePillText: {
    color: T.text,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  notarialFeeNote: {
    backgroundColor: 'rgba(244, 215, 139, 0.07)',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.2)',
  },
  notarialFeeNoteText: {
    color: T.gold[0],
    fontSize: 12,
    fontStyle: 'italic',
  },
  notarialUploadArea: {
    borderWidth: 1.5,
    borderColor: 'rgba(244, 215, 139, 0.22)',
    borderStyle: 'dashed',
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 88,
    backgroundColor: 'rgba(255,255,255,0.04)',
    marginBottom: 8,
  },
  notarialUploadMain: {
    fontSize: 14,
    fontWeight: '700',
    color: T.text,
    textAlign: 'center',
  },
  notarialUploadSub: {
    fontSize: 12,
    color: T.textSoft,
    marginTop: 4,
    textAlign: 'center',
  },
});

