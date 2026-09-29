import React from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {MaterialCommunityIcons} from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {REFERENCE_THEME as T} from '../constants/referenceTheme';

const accentGold = T.gold[1];

export default function AttorneyScreenHeader({
  navigation,
  title,
  subtitle,
  activeRoute,
  showMenu = true,
  onBack,
}) {
  const openMenu = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigation.navigate('AttyMenu', {activeRoute: activeRoute || ''});
  };

  const handleBack = () => {
    Haptics.selectionAsync();
    if (onBack) {
      onBack();
      return;
    }
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('AttyLandingPage');
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {showMenu ? (
          <TouchableOpacity style={styles.iconBtn} onPress={openMenu} accessibilityLabel="Open menu">
            <MaterialCommunityIcons name="menu" size={22} color={T.text} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.iconBtn} onPress={handleBack} accessibilityLabel="Go back">
            <MaterialCommunityIcons name="chevron-left" size={28} color={T.text} />
          </TouchableOpacity>
        )}
        <View style={styles.titleWrap}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={styles.subtitle} numberOfLines={2}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {showMenu ? (
          <TouchableOpacity style={styles.iconBtn} onPress={handleBack} accessibilityLabel="Go back">
            <MaterialCommunityIcons name="chevron-left" size={26} color={accentGold} />
          </TouchableOpacity>
        ) : (
          <View style={styles.iconBtn} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(244, 215, 139, 0.08)',
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconBtn: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  titleWrap: {flex: 1, paddingHorizontal: 4},
  title: {fontSize: 20, fontWeight: '900', color: T.text},
  subtitle: {fontSize: 12, color: T.textMuted, marginTop: 2, lineHeight: 17},
});
