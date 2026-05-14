import React from 'react';
import {StyleSheet, Text, View, ScrollView, TouchableOpacity} from 'react-native';
import {LinearGradient} from 'expo-linear-gradient';
import {MaterialCommunityIcons} from '@expo/vector-icons';
import {ClientScreenShell} from '../components/ClientScreenShell';
import {REFERENCE_THEME as T} from '../constants/referenceTheme';

const accentGold = T.gold[1];

const ChevronLeft = props => <MaterialCommunityIcons name="chevron-left" {...props} />;
const Info = props => <MaterialCommunityIcons name="information" {...props} />;
const Wallet = props => <MaterialCommunityIcons name="wallet" {...props} />;
const ChevronRight = props => <MaterialCommunityIcons name="chevron-right" {...props} />;
const Filter = props => <MaterialCommunityIcons name="filter" {...props} />;

const HISTORY = [
  {id: '1', amount: '₱15,000.00', date: 'Oct 24, 2023 • 10:45 AM', status: 'COMPLETED'},
  {id: '2', amount: '₱42,500.00', date: 'Oct 20, 2023 • 02:15 PM', status: 'PROCESSING'},
  {id: '3', amount: '₱8,200.00', date: 'Oct 15, 2023 • 09:30 AM', status: 'COMPLETED'},
  {id: '4', amount: '₱22,000.00', date: 'Oct 12, 2023 • 11:20 AM', status: 'COMPLETED'},
  {id: '5', amount: '₱12,400.00', date: 'Oct 05, 2023 • 04:55 PM', status: 'FAILED'},
];

const HistoryItem = ({item, navigation}) => {
  const getStatusStyles = status => {
    switch (status) {
      case 'COMPLETED':
        return {bg: 'rgba(16, 185, 129, 0.15)', text: '#6EE7B7'};
      case 'PROCESSING':
        return {bg: 'rgba(99, 102, 241, 0.15)', text: '#A5B4FC'};
      case 'FAILED':
        return {bg: 'rgba(239, 68, 68, 0.15)', text: '#FCA5A5'};
      default:
        return {bg: 'rgba(148, 163, 184, 0.15)', text: T.textMuted};
    }
  };

  const statusStyle = getStatusStyles(item.status);

  return (
    <TouchableOpacity
      style={styles.historyRow}
      onPress={() => navigation && navigation.navigate('AttyConfirmPayout')}>
      <View style={{flex: 1}}>
        <Text style={styles.historyAmount}>{item.amount}</Text>
        <Text style={styles.historyDate}>{item.date}</Text>
      </View>
      <View style={styles.statusContainer}>
        <View style={[styles.statusBadge, {backgroundColor: statusStyle.bg}]}>
          <Text style={[styles.statusText, {color: statusStyle.text}]}>{item.status}</Text>
        </View>
        <ChevronRight size={18} color={T.textSoft} />
      </View>
    </TouchableOpacity>
  );
};

export default function PayoutDetails({navigation}) {
  return (
    <ClientScreenShell edges={['top']}>
      <View style={styles.navHeader}>
        <TouchableOpacity onPress={() => (navigation.canGoBack() ? navigation.goBack() : null)}>
          <ChevronLeft size={28} color={T.text} />
        </TouchableOpacity>
        <Text style={styles.navTitle}>Payout Details</Text>
        <TouchableOpacity>
          <Info size={24} color={accentGold} />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        <LinearGradient
          colors={['#1e3a5f', '#0c1829', T.base]}
          start={{x: 0, y: 0}}
          end={{x: 1, y: 1}}
          style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Withdrawal Balance</Text>
          <Text style={styles.balanceValue}>₱184,200</Text>

          <View style={styles.balanceFooter}>
            <View>
              <Text style={styles.payoutSubLabel}>NEXT PAYOUT</Text>
              <Text style={styles.payoutDate}>Auto-process: Oct 30</Text>
            </View>
            <TouchableOpacity
              style={styles.withdrawBtn}
              onPress={() => navigation.navigate('AttyConfirmPayout')}>
              <Text style={styles.withdrawBtnText}>Withdraw Now</Text>
            </TouchableOpacity>
          </View>
        </LinearGradient>

        <Text style={styles.sectionHeader}>PAYOUT SETTINGS</Text>
        <View style={styles.settingsCard}>
          <View style={styles.methodIcon}>
            <Wallet size={20} color={accentGold} />
          </View>
          <View style={{flex: 1, marginLeft: 12}}>
            <Text style={styles.methodName}>GCash - 0912****345</Text>
            <Text style={styles.methodSub}>Primary payout method</Text>
          </View>
          <TouchableOpacity>
            <Text style={styles.editText}>Edit</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.historyHeader}>
          <Text style={styles.sectionHeader}>WITHDRAWAL HISTORY</Text>
          <TouchableOpacity style={styles.filterBtn}>
            <Text style={styles.filterText}>Filter</Text>
            <Filter size={14} color={accentGold} style={{marginLeft: 4}} />
          </TouchableOpacity>
        </View>

        {HISTORY.map(item => (
          <HistoryItem key={item.id} item={item} navigation={navigation} />
        ))}

        <TouchableOpacity style={styles.viewFullBtn}>
          <Text style={styles.viewFullText}>View full transaction history</Text>
        </TouchableOpacity>
      </ScrollView>
    </ClientScreenShell>
  );
}

const styles = StyleSheet.create({
  navHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(244, 215, 139, 0.1)',
  },
  navTitle: {fontSize: 18, fontWeight: '900', color: T.text},
  scrollContent: {padding: 20, paddingBottom: 40},

  balanceCard: {
    borderRadius: 20,
    padding: 24,
    marginBottom: 30,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.2)',
  },
  balanceLabel: {color: T.textMuted, fontSize: 14},
  balanceValue: {color: T.text, fontSize: 36, fontWeight: 'bold', marginVertical: 10},
  balanceFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 15,
  },
  payoutSubLabel: {color: T.textSoft, fontSize: 10, fontWeight: '800'},
  payoutDate: {color: T.text, fontSize: 15, marginTop: 2},
  withdrawBtn: {
    backgroundColor: accentGold,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
  },
  withdrawBtnText: {color: '#101B2C', fontWeight: '800'},

  sectionHeader: {fontSize: 14, fontWeight: '800', color: T.textSoft, letterSpacing: 0.5},
  settingsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(12, 19, 30, 0.92)',
    borderRadius: 16,
    padding: 16,
    marginTop: 12,
    marginBottom: 30,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.12)',
  },
  methodIcon: {
    width: 44,
    height: 44,
    backgroundColor: 'rgba(215, 177, 74, 0.12)',
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  methodName: {fontSize: 15, fontWeight: '800', color: T.text},
  methodSub: {fontSize: 12, color: T.textMuted, marginTop: 2},
  editText: {color: accentGold, fontWeight: '800'},

  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  filterBtn: {flexDirection: 'row', alignItems: 'center'},
  filterText: {color: accentGold, fontWeight: '800', fontSize: 13},

  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 18,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(244, 215, 139, 0.08)',
  },
  historyAmount: {fontSize: 16, fontWeight: '800', color: T.text},
  historyDate: {fontSize: 12, color: T.textMuted, marginTop: 4},
  statusContainer: {flexDirection: 'row', alignItems: 'center'},
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    marginRight: 10,
  },
  statusText: {fontSize: 10, fontWeight: '800'},

  viewFullBtn: {
    marginTop: 25,
    padding: 15,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.2)',
    borderStyle: 'dashed',
    alignItems: 'center',
  },
  viewFullText: {color: T.textMuted, fontWeight: '600'},
});
