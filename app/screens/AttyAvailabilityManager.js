import React, {useCallback, useState} from 'react';
import {ActivityIndicator, ScrollView, StyleSheet, Text, View} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import AttorneyScreenHeader from '../components/AttorneyScreenHeader';
import ManageAvailabilityPanel from '../components/ManageAvailabilityPanel';
import {ClientScreenShell} from '../components/ClientScreenShell';
import {REFERENCE_THEME as T} from '../constants/referenceTheme';
import {getCurrentSessionProfile} from '../services/userApi';

const accentGold = T.gold[1];

/**
 * Attorney manage availability — mobile shell + shared schedule panel.
 */
export default function AttyAvailabilityManager({navigation}) {
  const [attorneyId, setAttorneyId] = useState(null);
  const [displayName, setDisplayName] = useState('Attorney');
  const [booting, setBooting] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          const {profile} = await getCurrentSessionProfile();
          if (cancelled) {
            return;
          }
          setAttorneyId(profile?.id ?? null);
          setDisplayName(
            String(profile?.full_name || profile?.name || profile?.email || 'Attorney').trim() ||
              'Attorney',
          );
        } catch {
          if (!cancelled) {
            setAttorneyId(null);
          }
        } finally {
          if (!cancelled) {
            setBooting(false);
          }
        }
      })();
      return () => {
        cancelled = true;
      };
    }, []),
  );

  return (
    <ClientScreenShell edges={['top']}>
      <AttorneyScreenHeader
        navigation={navigation}
        title="My Availability"
        subtitle="Attorney Workspace"
        activeRoute="AttyAvailabilityManager"
      />

      {booting ? (
        <View style={styles.bootWrap}>
          <ActivityIndicator color={accentGold} size="large" />
        </View>
      ) : attorneyId ? (
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.scroll}>
          <ManageAvailabilityPanel attorneyId={attorneyId} displayName={displayName} />
        </ScrollView>
      ) : (
        <View style={styles.bootWrap}>
          <Text style={styles.bootError}>Sign in again to manage your schedule.</Text>
        </View>
      )}
    </ClientScreenShell>
  );
}

const styles = StyleSheet.create({
  scroll: {padding: 20, paddingBottom: 32},
  bootWrap: {flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24},
  bootError: {color: T.textMuted, fontSize: 15, fontWeight: '600', textAlign: 'center'},
});
