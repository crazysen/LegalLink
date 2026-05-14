import React from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { REFERENCE_THEME as T } from '../constants/referenceTheme';

const accentGold = T.gold[1];

const ShieldCheck = (props) => <MaterialCommunityIcons name="shield-check" {...props} />;
const Wallet = (props) => <MaterialCommunityIcons name="wallet" {...props} />;
const CheckCircle2 = (props) => <MaterialCommunityIcons name="check-circle" {...props} />;
const Info = (props) => <MaterialCommunityIcons name="information" {...props} />;

const styles = StyleSheet.create({
  modalContainer: {
    backgroundColor: 'rgba(12, 19, 30, 0.98)',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: 24,
    paddingBottom: 40,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.15)',
    borderBottomWidth: 0,
  },
  handle: {
    width: 40,
    height: 5,
    backgroundColor: 'rgba(244, 215, 139, 0.25)',
    borderRadius: 10,
    marginVertical: 15,
  },
  shieldIconContainer: {
    width: 60,
    height: 60,
    backgroundColor: 'rgba(215, 177, 74, 0.12)',
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 10,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.2)',
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: '900',
    color: T.text,
    marginTop: 20,
  },
  modalSubtitle: {
    fontSize: 14,
    color: T.textMuted,
    marginTop: 8,
    marginBottom: 25,
  },
  summaryCard: {
    width: '100%',
    backgroundColor: 'rgba(4, 7, 11, 0.5)',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.12)',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 6,
  },
  summaryLabel: { fontSize: 14, color: T.textMuted },
  summaryValue: { fontSize: 15, fontWeight: 'bold', color: T.text },
  divider: {
    height: 1,
    backgroundColor: 'rgba(244, 215, 139, 0.12)',
    marginVertical: 15,
  },
  totalLabel: { fontSize: 18, fontWeight: 'bold', color: T.text },
  totalValue: { fontSize: 20, fontWeight: 'bold', color: accentGold },
  
  accountCard: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.12)',
    borderRadius: 16,
    marginTop: 20,
    backgroundColor: 'rgba(4, 7, 11, 0.35)',
  },
  walletIconBg: {
    width: 44,
    height: 44,
    backgroundColor: 'rgba(215, 177, 74, 0.12)',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  accountName: { fontSize: 16, fontWeight: 'bold', color: T.text },
  accountSub: { fontSize: 10, color: T.textSoft, fontWeight: 'bold', marginTop: 4 },
  
  infoBox: {
    flexDirection: 'row',
    backgroundColor: 'rgba(56, 189, 248, 0.08)',
    padding: 16,
    borderRadius: 12,
    marginTop: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.2)',
  },
  infoText: { flex: 1, marginLeft: 12, fontSize: 13, color: T.textMuted, lineHeight: 18 },
  
  confirmBtn: {
    width: '100%',
    backgroundColor: accentGold,
    paddingVertical: 18,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 30,
    elevation: 5,
  },
  confirmBtnText: { color: '#101B2C', fontSize: 16, fontWeight: '800' },
  cancelBtn: { marginTop: 20, padding: 10 },
  cancelBtnText: { color: T.textMuted, fontWeight: '700' },
});

export default function ConfirmPayoutScreen({ navigation }) {
  const handleConfirmWithdraw = () => {
    setTimeout(() => {
      navigation?.navigate('AttySuccessWithdrawal');
    }, 300);
  };

  return (
    <View style={{ flex: 1, backgroundColor: 'rgba(4, 7, 11, 0.92)', justifyContent: 'flex-end' }}>
      <View style={styles.modalContainer}>
        {/* Handle bar at the top */}
        <View style={styles.handle} />

        {/* Security Icon */}
        <View style={styles.shieldIconContainer}>
          <ShieldCheck size={32} color={accentGold} />
        </View>

        <Text style={styles.modalTitle}>Confirm Payout Request</Text>
        <Text style={styles.modalSubtitle}>Review your withdrawal details below</Text>

        {/* Summary Card */}
        <View style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Amount to Withdraw</Text>
            <Text style={styles.summaryValue}>₱184,200.00</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Transfer Fee</Text>
            <Text style={[styles.summaryValue, { color: '#10B981' }]}>₱0.00</Text>
          </View>
          
          <View style={styles.divider} />
          
          <View style={styles.summaryRow}>
            <Text style={styles.totalLabel}>Total to be Received</Text>
            <Text style={styles.totalValue}>₱184,200.00</Text>
          </View>
        </View>

        {/* Destination Account Card */}
        <View style={styles.accountCard}>
          <View style={styles.walletIconBg}>
            <Wallet size={20} color={accentGold} />
          </View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.accountName}>GCash: 0917****123</Text>
            <Text style={styles.accountSub}>DESTINATION ACCOUNT</Text>
          </View>
          <CheckCircle2 size={22} color={accentGold} />
        </View>

        {/* Info Box */}
        <View style={styles.infoBox}>
          <Info size={18} color={T.textMuted} />
          <Text style={styles.infoText}>
            Funds will be transferred to your account within <Text style={{fontWeight: 'bold'}}>1-3 business days.</Text>
          </Text>
        </View>

        {/* Action Buttons */}
        <TouchableOpacity style={styles.confirmBtn} onPress={handleConfirmWithdraw}>
          <Text style={styles.confirmBtnText}>Confirm & Withdraw</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.canGoBack() ? navigation.goBack() : null} style={styles.cancelBtn}>
          <Text style={styles.cancelBtnText}>Cancel Request</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
