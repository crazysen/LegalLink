import React from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  } from 'react-native';
import { REFERENCE_THEME as T } from '../constants/referenceTheme';
import { ClientScreenShell, ClientFadeInSoft } from '../components/ClientScreenShell';

export default function BookingRequestSubmitted({navigation}) {
  const handleBackToDashboard = () => {
    navigation.navigate('HomepageClient');
  };

  return (
    <ClientScreenShell>
      <ClientFadeInSoft style={styles.fill}>
      <View style={styles.overlay}>
      <View style={styles.card}>
        <View style={styles.iconCircle}>
          <Text style={styles.checkMark}>✓</Text>
        </View>

        <Text style={styles.title}>Booking Request Submitted</Text>
        <Text style={styles.description}>
          Your legal concern has been successfully transmitted to our network. 
          An attorney will review your case shortly.
        </Text>

        <TouchableOpacity style={styles.dashboardButton} onPress={handleBackToDashboard}>
          <Text style={styles.buttonText}>Back to Dashboard</Text>
        </TouchableOpacity>
      </View>
      </View>
      </ClientFadeInSoft>
    </ClientScreenShell>
  );
}

const styles = StyleSheet.create({
  fill: {flex: 1},
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: 'rgba(18, 26, 36, 0.95)',
    borderRadius: 32,
    padding: 32,
    width: '100%',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.15)',
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: T.gold[1],
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  checkMark: {
    color: T.base,
    fontSize: 40,
    fontWeight: 'bold',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: T.text,
    textAlign: 'center',
    marginBottom: 16,
  },
  description: {
    fontSize: 16,
    color: T.textMuted,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 32,
    paddingHorizontal: 10,
  },
  dashboardButton: {
    backgroundColor: T.gold[1],
    paddingVertical: 16,
    paddingHorizontal: 48,
    borderRadius: 16,
    width: '100%',
  },
  buttonText: {
    color: T.base,
    textAlign: 'center',
    fontWeight: 'bold',
    fontSize: 16,
  },
});
