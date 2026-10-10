import React, {useCallback, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {LinearGradient} from 'expo-linear-gradient';
import {MaterialCommunityIcons} from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import AttorneyScreenHeader from '../components/AttorneyScreenHeader';
import {ClientScreenShell} from '../components/ClientScreenShell';
import {REFERENCE_THEME as T} from '../constants/referenceTheme';
import {
  fetchAttorneyConsultationRequests,
  getCurrentSessionProfile,
  isConsultationChatWindowOpen,
  updateAttorneyConsultationRequestStatus,
} from '../services/userApi';
import {useAttorneyLiveRefresh} from '../hooks/useAttorneyLiveRefresh';

const accentGold = T.gold[1];

export default function AttyConsultationRequests({navigation}) {
  const [attorneyId, setAttorneyId] = useState(null);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState({type: null, requestId: null});
  const [rejectNote, setRejectNote] = useState('');
  const [reschedDate, setReschedDate] = useState('');
  const [reschedTime, setReschedTime] = useState('');
  const [reschedNote, setReschedNote] = useState('');

  const loadRequests = useCallback(async (options = {}) => {
    const silent = Boolean(options?.silent);
    if (!silent) setLoading(true);
    try {
      const {profile} = await getCurrentSessionProfile();
      const userId = profile?.id;
      setAttorneyId(userId || null);
      if (!userId) {
        setRequests([]);
        return;
      }
      const data = await fetchAttorneyConsultationRequests(userId, options);
      setRequests(Array.isArray(data?.requests) ? data.requests : []);
    } catch (error) {
      if (!silent) {
        Alert.alert('Error', error?.message ?? 'Unable to load consultation requests.');
      }
      setRequests([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useAttorneyLiveRefresh({attorneyId, reload: loadRequests});

  const closeModal = () => {
    setModal({type: null, requestId: null});
    setRejectNote('');
    setReschedDate('');
    setReschedTime('');
    setReschedNote('');
  };

  const getReq = () => requests.find(r => r.id === modal.requestId);

  const confirmAccept = async () => {
    try {
      await updateAttorneyConsultationRequestStatus({
        appointmentId: modal.requestId,
        status: 'confirmed',
      });
      await loadRequests({force: true, silent: true});
    } catch (error) {
      Alert.alert('Error', error?.message ?? 'Failed to approve request.');
    }
    closeModal();
  };

  const confirmReject = async () => {
    if (!rejectNote.trim()) return;
    try {
      await updateAttorneyConsultationRequestStatus({
        appointmentId: modal.requestId,
        status: 'rejected',
        note: rejectNote.trim(),
      });
      await loadRequests({force: true, silent: true});
    } catch (error) {
      Alert.alert('Error', error?.message ?? 'Failed to reject request.');
    }
    closeModal();
  };

  const confirmReschedule = async () => {
    if (!reschedDate || !reschedTime) return;
    try {
      const scheduledAt = new Date(`${reschedDate}T${reschedTime}`).toISOString();
      await updateAttorneyConsultationRequestStatus({
        appointmentId: modal.requestId,
        status: 'rescheduled',
        scheduledAt,
        note: reschedNote.trim() || undefined,
      });
      await loadRequests({force: true, silent: true});
    } catch (error) {
      Alert.alert('Error', error?.message ?? 'Failed to reschedule request.');
    }
    closeModal();
  };

  const openChat = item => {
    navigation.navigate('AttyConsultationMessage', {
      chatId: item.id,
      clientName: item.name,
      clientInitials: item.initials || 'CL',
    });
  };

  return (
    <ClientScreenShell edges={['top']}>
      <AttorneyScreenHeader
        navigation={navigation}
        title="Consultation Requests"
        subtitle="Review and respond to new consultation bookings"
        activeRoute="AttyConsultationRequests"
        showMenu={false}
      />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {loading ? (
          <View style={styles.emptyCard}>
            <ActivityIndicator color={accentGold} />
            <Text style={styles.emptyText}>Loading requests...</Text>
          </View>
        ) : requests.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No consultation requests</Text>
            <Text style={styles.emptyText}>New client bookings will appear here.</Text>
          </View>
        ) : (
          requests.map(item => {
            const statusKey = String(item.status || 'Pending').toLowerCase();
            const isPending = statusKey === 'pending';
            const canEnter = isConsultationChatWindowOpen({
              status: statusKey === 'approved' ? 'confirmed' : statusKey,
              scheduledAt: item.scheduledAt || `${item.date} ${item.time}`,
              paymentStatus: item.paymentStatus,
            });

            return (
              <View key={item.id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{item.initials || 'CL'}</Text>
                  </View>
                  <View style={styles.cardMain}>
                    <Text style={styles.name}>{item.name}</Text>
                    <Text style={styles.meta}>{item.area}</Text>
                    <Text style={styles.meta}>
                      {item.date} • {item.time} • {item.payment}
                    </Text>
                  </View>
                  <View style={styles.statusBadge}>
                    <Text style={styles.statusBadgeText}>{String(item.status).toUpperCase()}</Text>
                  </View>
                </View>

                <Text style={styles.concernLabel}>Brief description of concern</Text>
                <Text style={styles.concernText}>{item.concern}</Text>

                {item.attachmentUrl ? (
                  <TouchableOpacity
                    style={styles.attachmentBtn}
                    onPress={() => Linking.openURL(item.attachmentUrl).catch(() => {})}>
                    <MaterialCommunityIcons name="paperclip" size={16} color={accentGold} />
                    <Text style={styles.attachmentText}>
                      {item.attachmentName || 'View attached file'}
                    </Text>
                  </TouchableOpacity>
                ) : null}

                {isPending ? (
                  <View style={styles.actionRow}>
                    <TouchableOpacity
                      style={[styles.actionButton, styles.rejectButton]}
                      onPress={() => setModal({type: 'reject', requestId: item.id})}>
                      <Text style={styles.rejectButtonText}>Reject</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.actionButton, styles.rescheduleButton]}
                      onPress={() => setModal({type: 'reschedule', requestId: item.id})}>
                      <Text style={styles.rescheduleButtonText}>Reschedule</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.actionButton, styles.approveButton]}
                      onPress={() => setModal({type: 'accept', requestId: item.id})}>
                      <Text style={styles.approveButtonText}>Accept</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}

                {!isPending && (statusKey === 'approved' || statusKey === 'confirmed') ? (
                  <TouchableOpacity
                    style={[styles.enterBtn, !canEnter && styles.enterBtnDisabled]}
                    disabled={!canEnter}
                    onPress={() => openChat(item)}>
                    <LinearGradient
                      colors={canEnter ? [T.gold[0], T.gold[1]] : ['#4B5563', '#374151']}
                      style={styles.gradBtn}>
                      <Text style={styles.gradBtnText}>Enter Consultation</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                ) : null}
              </View>
            );
          })
        )}
      </ScrollView>

      <Modal visible={modal.type === 'accept'} transparent animationType="fade" onRequestClose={closeModal}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Accept Consultation</Text>
            <Text style={styles.modalBody}>
              Accept the consultation request from {getReq()?.name || 'this client'}?
            </Text>
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={closeModal}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalConfirm} onPress={confirmAccept}>
                <Text style={styles.modalConfirmText}>Accept</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={modal.type === 'reject'} transparent animationType="fade" onRequestClose={closeModal}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Reject Consultation</Text>
            <Text style={styles.modalBody}>Provide a reason for rejecting this request.</Text>
            <TextInput
              style={styles.modalInput}
              multiline
              placeholder="Reason for rejection..."
              placeholderTextColor={T.textMuted}
              value={rejectNote}
              onChangeText={setRejectNote}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={closeModal}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirm, styles.modalDanger, !rejectNote.trim() && styles.disabled]}
                disabled={!rejectNote.trim()}
                onPress={confirmReject}>
                <Text style={styles.modalConfirmText}>Reject</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={modal.type === 'reschedule'} transparent animationType="fade" onRequestClose={closeModal}>
        <View style={styles.modalOverlay}>
          <ScrollView contentContainerStyle={styles.modalScroll}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Reschedule Consultation</Text>
              <Text style={styles.modalBody}>Suggest a new date and time for {getReq()?.name || 'the client'}.</Text>
              <Text style={styles.fieldLabel}>New date (YYYY-MM-DD)</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="2026-05-20"
                placeholderTextColor={T.textMuted}
                value={reschedDate}
                onChangeText={setReschedDate}
              />
              <Text style={styles.fieldLabel}>New time (HH:MM, 24h)</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="14:30"
                placeholderTextColor={T.textMuted}
                value={reschedTime}
                onChangeText={setReschedTime}
              />
              <TextInput
                style={[styles.modalInput, styles.modalTextarea]}
                multiline
                placeholder="Optional note for the client..."
                placeholderTextColor={T.textMuted}
                value={reschedNote}
                onChangeText={setReschedNote}
              />
              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.modalCancel} onPress={closeModal}>
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalConfirm, (!reschedDate || !reschedTime) && styles.disabled]}
                  disabled={!reschedDate || !reschedTime}
                  onPress={confirmReschedule}>
                  <Text style={styles.modalConfirmText}>Reschedule</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </ClientScreenShell>
  );
}

const styles = StyleSheet.create({
  navHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(244, 215, 139, 0.08)',
  },
  backBtn: {width: 44, height: 44, justifyContent: 'center'},
  navTitle: {fontSize: 20, fontWeight: '900', color: T.text, marginLeft: 4, flex: 1},
  subHeader: {paddingHorizontal: 20, marginTop: 8, marginBottom: 12},
  subTitle: {color: T.textMuted, fontSize: 14},
  scrollContent: {paddingHorizontal: 20, paddingBottom: 30},
  card: {
    backgroundColor: 'rgba(12, 19, 30, 0.92)',
    borderRadius: 20,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.12)',
  },
  cardHeader: {flexDirection: 'row', alignItems: 'flex-start'},
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.06)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {color: T.text, fontWeight: '900'},
  cardMain: {flex: 1, marginLeft: 12, marginRight: 8},
  name: {fontSize: 16, fontWeight: '800', color: T.text},
  meta: {fontSize: 12, color: T.textMuted, marginTop: 2},
  statusBadge: {
    backgroundColor: 'rgba(215, 177, 74, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusBadgeText: {color: accentGold, fontSize: 9, fontWeight: '800'},
  concernLabel: {
    marginTop: 12,
    fontSize: 10,
    fontWeight: '800',
    color: T.textSoft,
    letterSpacing: 0.5,
  },
  concernText: {color: T.textSoft, fontSize: 13, marginTop: 6, lineHeight: 18},
  attachmentBtn: {flexDirection: 'row', alignItems: 'center', marginTop: 10},
  attachmentText: {color: accentGold, marginLeft: 6, fontSize: 12, fontWeight: '700'},
  actionRow: {flexDirection: 'row', marginTop: 14, flexWrap: 'wrap', gap: 8},
  actionButton: {
    flexGrow: 1,
    minWidth: '30%',
    height: 42,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rejectButton: {backgroundColor: 'rgba(254, 226, 226, 0.95)'},
  rescheduleButton: {backgroundColor: 'rgba(219, 234, 254, 0.95)'},
  approveButton: {backgroundColor: 'rgba(220, 252, 231, 0.95)'},
  rejectButtonText: {color: '#B91C1C', fontWeight: '800', fontSize: 12},
  rescheduleButtonText: {color: '#1D4ED8', fontWeight: '800', fontSize: 12},
  approveButtonText: {color: '#166534', fontWeight: '800', fontSize: 12},
  enterBtn: {marginTop: 12, borderRadius: 12, overflow: 'hidden'},
  enterBtnDisabled: {opacity: 0.65},
  gradBtn: {height: 44, justifyContent: 'center', alignItems: 'center'},
  gradBtnText: {color: '#101B2C', fontWeight: '800'},
  emptyCard: {
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.15)',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
  },
  emptyTitle: {fontSize: 16, fontWeight: '800', color: T.text, marginBottom: 6},
  emptyText: {fontSize: 13, color: T.textMuted, textAlign: 'center'},
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    padding: 20,
  },
  modalScroll: {flexGrow: 1, justifyContent: 'center'},
  modalCard: {
    backgroundColor: '#121A28',
    borderRadius: 18,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.15)',
  },
  modalTitle: {fontSize: 18, fontWeight: '900', color: T.text, marginBottom: 8},
  modalBody: {color: T.textMuted, fontSize: 14, marginBottom: 12, lineHeight: 20},
  fieldLabel: {color: T.textSoft, fontSize: 12, marginBottom: 4, marginTop: 4},
  modalInput: {
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.2)',
    borderRadius: 12,
    padding: 12,
    color: T.text,
    marginBottom: 10,
  },
  modalTextarea: {minHeight: 80, textAlignVertical: 'top'},
  modalActions: {flexDirection: 'row', marginTop: 8},
  modalCancel: {
    flex: 1,
    marginRight: 8,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
  },
  modalCancelText: {color: T.textMuted, fontWeight: '700'},
  modalConfirm: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: accentGold,
    alignItems: 'center',
  },
  modalDanger: {backgroundColor: '#DC2626'},
  modalConfirmText: {color: '#101B2C', fontWeight: '800'},
  disabled: {opacity: 0.5},
});
