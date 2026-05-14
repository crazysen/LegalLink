import React from 'react';
import {StatusBar, StyleSheet, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import Animated, {FadeIn, FadeInDown} from 'react-native-reanimated';
import ClientPlasmaBackground from './ClientPlasmaBackground';
import {REFERENCE_THEME as T} from '../constants/referenceTheme';
import {IS_ANDROID} from '../constants/platformUi';

/**
 * Dark base + plasma backdrop + safe area for all client flows (reference UI).
 */
export function ClientScreenShell({children, edges}) {
  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />
      <ClientPlasmaBackground />
      <SafeAreaView style={styles.safe} edges={edges ?? ['top', 'left', 'right']}>
        {children}
      </SafeAreaView>
    </View>
  );
}

const androidTextSafeProps = IS_ANDROID
  ? {collapsable: false, needsOffscreenAlphaCompositing: true}
  : {};

/** Screen content entrance (reference motion). */
export function ClientFadeIn({children, delay = 0, style, entering}) {
  const anim = entering ?? FadeInDown.duration(420).delay(delay);
  return (
    <Animated.View entering={anim} style={style} {...androidTextSafeProps}>
      {children}
    </Animated.View>
  );
}

/** Lighter fade for secondary blocks. Prefer on screens with lots of Text on Android (FadeInDown can hide text). */
export function ClientFadeInSoft({children, delay = 0, style}) {
  return (
    <Animated.View
      entering={FadeIn.duration(380).delay(delay)}
      style={style}
      {...androidTextSafeProps}>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: T.base,
  },
  safe: {
    flex: 1,
  },
});
