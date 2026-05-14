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
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import {
  formatLocalDateString,
  getAvailability,
  isConsultationSlotInTheFuture,
} from '../services/appointmentService';
import {REFERENCE_THEME as T} from '../constants/referenceTheme';
import {IS_ANDROID, IS_IOS} from '../constants/platformUi';
import {ClientScreenShell, ClientFadeIn} from '../components/ClientScreenShell';
import ClientChevronBack from '../components/ClientChevronBack';

const HEADER_BACK_COL = 28;
const HEADER_BACK_GAP = 8;
const SUBTITLE_INDENT = HEADER_BACK_COL + HEADER_BACK_GAP;

export default function BookNow({navigation, route}) {
  /** @type {{ id: string, time: string } | null} */
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [showPicker, setShowPicker] = useState(false);
  
  const [availableSlots, setAvailableSlots] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const slotsRequestId = useRef(0);

  const [reason, setReason] = useState('');
  const attorney = route?.params?.attorney || { name: 'Dr. Sarah Johnson', specialty: 'Corporate Law', price: '₱2,500.00' };

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

      const openSlots = (slots || []).filter(s =>
        isConsultationSlotInTheFuture(selectedDate, s.time, now),
      );

      setAvailableSlots(openSlots);
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

  const handleSubmit = () => {
    if (!attorney?.id) {
      Alert.alert('Error', 'Please select an attorney from the list first.');
      return;
    }

    if (!selectedSlot?.time || !selectedSlot?.id) {
      Alert.alert('Error', 'Please select a time slot.');
      return;
    }

    if (!isConsultationSlotInTheFuture(selectedDate, selectedSlot.time)) {
      Alert.alert(
        'Time no longer available',
        'That time has already passed today. Please pick a later slot.',
      );
      return;
    }

    if (!reason.trim()) {
      Alert.alert('Error', 'Please describe your legal concern.');
      return;
    }

    const [time, modifier] = selectedSlot.time.split(' ');
    const [rawHour, rawMinute] = time.split(':');
    let hour = Number(rawHour);
    if (modifier === 'PM' && hour < 12) hour += 12;
    if (modifier === 'AM' && hour === 12) hour = 0;
    
    // Create a local Date object instead of a UTC string to prevent timezone shifting
    const localAppointmentDate = new Date(
      selectedDate.getFullYear(),
      selectedDate.getMonth(),
      selectedDate.getDate(),
      hour,
      Number(rawMinute),
      0
    );
    const scheduleDateTime = localAppointmentDate.toISOString();

    // Instead of creating appointment, pass to Payment
    navigation.navigate('Payment', {
      paymentMethod: 'gcash',
      paymentContext: {
        sourceType: 'appointment_booking',
        payload: {
          attorney_id: attorney.id,
          title: `Consultation - ${attorney.specialty ?? 'General'}`,
          notes: reason.trim(),
          scheduled_at: scheduleDateTime,
          slot_time: selectedSlot.time,
          slot_date: localDateStr,
          slot_id: selectedSlot.id,
          amount: Number(String(attorney.price || '').replace(/[^\d.]/g, '')) || 2500,
        },
      },
      serviceData: { amount: attorney.price || '₱2,500.00' },
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
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Attorney:</Text>
              <Text style={styles.summaryValue}>{attorney.name}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Fee:</Text>
              <Text style={styles.feeValue}>{attorney.price}</Text>
            </View>
          </View>

          <Text style={styles.inputLabel}>📅 Select Date</Text>
          <TouchableOpacity style={styles.datePicker} onPress={() => setShowPicker(true)}>
            <Text style={styles.dateText}>
              {selectedDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </Text>
            <Text style={styles.calendarIcon}>📅</Text>
          </TouchableOpacity>

          {IS_IOS ? (
            <Modal
              visible={showPicker}
              animationType="slide"
              transparent
              onRequestClose={() => setShowPicker(false)}>
              <View style={styles.dateModalRoot}>
                <TouchableOpacity
                  style={styles.dateModalBackdrop}
                  activeOpacity={1}
                  onPress={() => setShowPicker(false)}
                />
                <View style={styles.dateModalSheet}>
                  <View style={styles.dateModalHeader}>
                    <TouchableOpacity
                      onPress={() => setShowPicker(false)}
                      hitSlop={{top: 12, bottom: 12, left: 12, right: 12}}>
                      <Text style={styles.dateModalCancel}>Cancel</Text>
                    </TouchableOpacity>
                    <Text style={styles.dateModalTitle}>Select date</Text>
                    <TouchableOpacity
                      onPress={() => setShowPicker(false)}
                      hitSlop={{top: 12, bottom: 12, left: 12, right: 12}}>
                      <Text style={styles.dateModalDone}>Done</Text>
                    </TouchableOpacity>
                  </View>
                  <DateTimePicker
                    value={selectedDate}
                    mode="date"
                    display="inline"
                    onChange={(_, date) => {
                      if (date) {
                        setSelectedDate(date);
                      }
                    }}
                    minimumDate={new Date()}
                    themeVariant="dark"
                  />
                </View>
              </View>
            </Modal>
          ) : (
            showPicker && (
              <DateTimePicker
                value={selectedDate}
                mode="date"
                display="default"
                onChange={onChangeDateAndroid}
                minimumDate={new Date()}
              />
            )
          )}

          <Text style={styles.inputLabel}>🕒 Select Available Slot</Text>
          
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

          <Text style={styles.inputLabel}>Reason for Consultation</Text>
          <TextInput
            style={styles.textArea}
            placeholder="Please briefly describe your legal matter..."
            placeholderTextColor={T.textSoft}
            multiline
            numberOfLines={4}
            value={reason}
            onChangeText={setReason}
          />

          <View style={styles.noteBox}>
            <Text style={styles.noteText}>
              <Text style={{ fontWeight: 'bold' }}>Payment First:</Text> Your consultation slot is only confirmed and blocked off after successful payment.
            </Text>
          </View>

          <TouchableOpacity
            style={[
              styles.submitButton,
              (loadingSlots || !selectedSlot || !reason.trim()) && styles.submitDisabled,
            ]}
            onPress={handleSubmit}
            disabled={loadingSlots || !selectedSlot || !reason.trim()}>
            <Text style={styles.submitButtonText}>Proceed to Payment</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.cancelButton} onPress={handleCancel}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
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
  summaryRow: { flexDirection: 'row', marginBottom: 8 },
  summaryLabel: { fontSize: 14, fontWeight: 'bold', color: T.textSoft, width: 80 },
  summaryValue: { fontSize: 14, color: T.textMuted, flex: 1 },
  feeValue: { fontSize: 14, fontWeight: 'bold', color: T.gold[0] },
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
});

