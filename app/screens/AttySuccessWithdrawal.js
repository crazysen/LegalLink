import React from 'react';
import {StyleSheet, Text, View, TouchableOpacity} from 'react-native';
import {MaterialCommunityIcons} from '@expo/vector-icons';
import {ClientScreenShell} from '../components/ClientScreenShell';
import {REFERENCE_THEME as T} from '../constants/referenceTheme';

const accentGold = T.gold[1];

const Check = props => <MaterialCommunityIcons name="check" {...props} />;
const Info = props => <MaterialCommunityIcons name="information" {...props} />;
const Clock = props => <MaterialCommunityIcons name="clock-outline" {...props} />;

export default function WithdrawalSuccess({navigation}) {
  return (
    <ClientScreenShell edges={['top', 'bottom']}>
      <View style={styles.content}>
        <Text style={styles.headerTitle}>Success</Text>

        <View style={styles.successCircleWrapper}>
          <View style={styles.outerCircle}>
            <View style={styles.innerCircle}>
              <Check size={48} color="#FFF" />
            </View>
          </View>
          <View style={[styles.dot, {backgroundColor: '#FDE047', top: 0, left: -20}]} />
          <View style={[styles.dot, {backgroundColor: '#93C5FD', top: 40, right: -30}]} />
          <View style={[styles.dot, {backgroundColor: '#F9A8D4', bottom: 20, left: -40, width: 8, height: 8}]} />
        </View>

        <Text style={styles.mainTitle}>Withdrawal Initiated</Text>
        <Text style={styles.description}>
          Your request for <Text style={styles.bold}>₱184,200</Text> is being processed and will arrive in your GCash account
          shortly.
        </Text>

        <View style={styles.summaryCard}>
          <View style={styles.row}>
            <Text style={styles.label}>Transaction ID</Text>
            <Text style={styles.value}>#WDR-77421</Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.row}>
            <Text style={styles.label}>Estimated Arrival</Text>
            <View style={styles.arrivalBox}>
              <Clock size={16} color={T.textMuted} style={{marginRight: 6}} />
              <Text style={styles.value}>1-3 Business Days</Text>
            </View>
          </View>
        </View>

        <View style={styles.infoBox}>
          <Info size={20} color={accentGold} />
          <Text style={styles.infoText}>
            You will receive a notification and SMS once the funds are credited to your account.
          </Text>
        </View>
      </View>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.button} onPress={() => navigation.navigate('AttyLandingPage')}>
          <Text style={styles.buttonText}>Back to Dashboard</Text>
        </TouchableOpacity>
      </View>
    </ClientScreenShell>
  );
}

const styles = StyleSheet.create({
  content: {flex: 1, alignItems: 'center', paddingHorizontal: 30},
  headerTitle: {fontSize: 18, fontWeight: '700', color: T.text, marginTop: 20},

  successCircleWrapper: {marginTop: 60, marginBottom: 40, position: 'relative'},
  outerCircle: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  innerCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#22C55E',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
  },
  dot: {position: 'absolute', width: 12, height: 12, borderRadius: 6},

  mainTitle: {fontSize: 28, fontWeight: '900', color: T.text, textAlign: 'center'},
  description: {fontSize: 15, color: T.textMuted, textAlign: 'center', marginTop: 15, lineHeight: 22},
  bold: {color: accentGold, fontWeight: '800'},

  summaryCard: {
    width: '100%',
    backgroundColor: 'rgba(12, 19, 30, 0.92)',
    borderRadius: 20,
    padding: 24,
    marginTop: 40,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.12)',
  },
  row: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'},
  label: {fontSize: 14, color: T.textMuted},
  value: {fontSize: 15, fontWeight: '800', color: T.text},
  arrivalBox: {flexDirection: 'row', alignItems: 'center'},
  divider: {height: 1, backgroundColor: 'rgba(244, 215, 139, 0.1)', marginVertical: 15},

  infoBox: {
    flexDirection: 'row',
    backgroundColor: 'rgba(56, 189, 248, 0.08)',
    padding: 16,
    borderRadius: 12,
    marginTop: 25,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.2)',
  },
  infoText: {flex: 1, marginLeft: 12, fontSize: 13, color: T.textMuted, lineHeight: 18},

  footer: {padding: 20, paddingBottom: 40},
  button: {
    backgroundColor: accentGold,
    paddingVertical: 18,
    borderRadius: 12,
    alignItems: 'center',
    elevation: 5,
  },
  buttonText: {color: '#101B2C', fontSize: 16, fontWeight: '800'},
});
