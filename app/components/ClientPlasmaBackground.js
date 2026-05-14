import React, {useEffect, useRef} from 'react';
import {Animated, Dimensions, StyleSheet, View} from 'react-native';
import {REFERENCE_THEME as T} from '../constants/referenceTheme';

const {width, height} = Dimensions.get('window');

/**
 * Slow-moving gradient orbs + light grain feel (reference ClientDashboard atmosphere).
 */
export default function ClientPlasmaBackground() {
  const drift = useRef(new Animated.Value(0)).current;
  const drift2 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = (anim, duration) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(anim, {
            toValue: 1,
            duration,
            useNativeDriver: true,
          }),
          Animated.timing(anim, {
            toValue: 0,
            duration,
            useNativeDriver: true,
          }),
        ]),
      );
    loop(drift, 14000).start();
    loop(drift2, 11000).start();
  }, [drift, drift2]);

  const t1 = drift.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });
  const moveX = drift.interpolate({
    inputRange: [0, 1],
    outputRange: [-18, 22],
  });
  const moveY = drift2.interpolate({
    inputRange: [0, 1],
    outputRange: [12, -20],
  });
  const scaleOrb = t1.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.08],
  });

  return (
    <View style={styles.container} pointerEvents="none">
      <Animated.View
        style={[
          styles.orb,
          styles.orbA,
          {
            opacity: 0.45,
            transform: [{translateX: moveX}, {translateY: moveY}, {scale: scaleOrb}],
          },
        ]}
      />
      <Animated.View
        style={[
          styles.orb,
          styles.orbB,
          {
            opacity: 0.38,
            transform: [
              {
                translateX: drift2.interpolate({
                  inputRange: [0, 1],
                  outputRange: [14, -24],
                }),
              },
              {
                translateY: drift.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-16, 18],
                }),
              },
            ],
          },
        ]}
      />
      <View style={[styles.orb, styles.orbGold]} />
      <View style={styles.grain} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
    backgroundColor: T.base,
  },
  orb: {
    position: 'absolute',
    borderRadius: 999,
  },
  orbA: {
    width: width * 0.85,
    height: width * 0.85,
    top: -width * 0.15,
    left: -width * 0.2,
    backgroundColor: T.plasmaA,
  },
  orbB: {
    width: width * 0.65,
    height: width * 0.65,
    bottom: height * 0.05,
    right: -width * 0.18,
    backgroundColor: T.plasmaB,
  },
  orbGold: {
    width: width * 0.5,
    height: width * 0.5,
    top: height * 0.35,
    left: width * 0.12,
    backgroundColor: T.plasmaGold,
    opacity: 1,
  },
  grain: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.02)',
    opacity: 0.35,
  },
});
