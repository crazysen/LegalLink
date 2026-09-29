import React from 'react';
import {Modal, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {REFERENCE_THEME as T} from '../constants/referenceTheme';

export default function ConsultationWaitingPopup({
  visible,
  title,
  body,
  onClose,
  onNotNow,
  onGoToChatroom,
  showGoToChatroom = false,
  goToChatroomLabel = 'Go to Chatroom',
  notNowLabel = 'Not Now',
}) {
  if (!visible || (!title && !body)) {
    return null;
  }

  const handleNotNow = () => {
    if (typeof onNotNow === 'function') {
      onNotNow();
      return;
    }
    onClose?.();
  };

  const handleGoToChatroom = () => {
    if (typeof onGoToChatroom === 'function') {
      onGoToChatroom();
      return;
    }
    onClose?.();
  };

  return (
    <Modal transparent visible animationType="fade" onRequestClose={handleNotNow}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.body}>{body}</Text>
          <View style={styles.actions}>
            <TouchableOpacity style={styles.secondaryBtn} onPress={handleNotNow}>
              <Text style={styles.secondaryBtnText}>{notNowLabel}</Text>
            </TouchableOpacity>
            {showGoToChatroom ? (
              <TouchableOpacity style={styles.primaryBtn} onPress={handleGoToChatroom}>
                <Text style={styles.primaryBtnText}>{goToChatroomLabel}</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.primaryBtn} onPress={handleNotNow}>
                <Text style={styles.primaryBtnText}>OK</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: 'rgba(18, 26, 36, 0.96)',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.2)',
  },
  title: {
    color: T.text,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 10,
  },
  body: {
    color: T.textSoft,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 20,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: 10,
  },
  secondaryBtn: {
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.25)',
  },
  secondaryBtnText: {
    color: T.textSoft,
    fontWeight: '700',
    fontSize: 14,
  },
  primaryBtn: {
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: T.gold[1],
  },
  primaryBtnText: {
    color: T.base,
    fontWeight: '800',
    fontSize: 14,
  },
});
