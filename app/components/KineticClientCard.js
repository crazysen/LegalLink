import React, {useEffect, useRef} from 'react';
import {Animated, Easing, Pressable, StyleSheet, Text, View} from 'react-native';
import {LinearGradient} from 'expo-linear-gradient';
import {MaterialCommunityIcons} from '@expo/vector-icons';
import Svg, {Circle} from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import {REFERENCE_THEME as T} from '../constants/referenceTheme';

/**
 * Ring must be clearly **outside** the 52×52 badge; same-sized circle was drawn behind the gold and hidden.
 * r=32 → stroke sits ~29–35px from center; badge edge ~26px → visible halo.
 */
const RING_SIZE = 68;
const RING_CX = RING_SIZE / 2;
const RING_R = 32;
const RING_STROKE = 2.2;
/** iconCluster fits ring + centered 52 badge */
const CLUSTER = 76;
const RING_INSET = (CLUSTER - RING_SIZE) / 2;

/**
 * Press-scale kinetic card with gold gradient frame (reference mobile_client_side).
 * @param {boolean} [animateIcon] — rotating dashed gold ring around the icon (dashboard CTAs only).
 */
export default function KineticClientCard({icon, title, subtitle, onPress, animateIcon}) {
  const scale = useRef(new Animated.Value(1)).current;
  const ringRotate = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!animateIcon) {
      ringRotate.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(ringRotate, {
        toValue: 1,
        duration: 8000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [animateIcon]);

  const rotate = ringRotate.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const onPressIn = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    Animated.spring(scale, {
      toValue: 0.97,
      friction: 6,
      useNativeDriver: true,
    }).start();
  };

  const onPressOut = () => {
    Animated.spring(scale, {
      toValue: 1,
      friction: 5,
      useNativeDriver: true,
    }).start();
  };

  const iconBlock = (
    <View style={styles.iconCluster}>
      {animateIcon ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.ringWrap,
            {
              transform: [{rotate}],
            },
          ]}>
          <Svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}>
            <Circle
              cx={RING_CX}
              cy={RING_CX}
              r={RING_R}
              fill="none"
              stroke={T.gold[1]}
              strokeWidth={RING_STROKE}
              strokeDasharray="14 10"
              strokeLinecap="round"
            />
          </Svg>
        </Animated.View>
      ) : null}
      <LinearGradient colors={[T.gold[0], T.gold[2]]} style={styles.iconBadge}>
        <MaterialCommunityIcons name={icon} size={26} color={T.base} />
      </LinearGradient>
    </View>
  );

  return (
    <Pressable
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      accessibilityRole="button">
      <Animated.View style={[styles.shadowWrap, {transform: [{scale}]}]}>
        <LinearGradient
          colors={['rgba(244, 215, 139, 0.55)', 'rgba(18, 26, 36, 0.95)', T.base]}
          start={{x: 0, y: 0}}
          end={{x: 1, y: 1}}
          style={styles.gradientFrame}>
          <View style={styles.inner}>
            {iconBlock}
            <View style={styles.textBlock}>
              <Text style={styles.title}>{title}</Text>
              <Text style={styles.subtitle}>{subtitle}</Text>
            </View>
          </View>
        </LinearGradient>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  shadowWrap: {
    marginTop: 14,
    borderRadius: 24,
    overflow: 'visible',
    shadowColor: 'rgba(212, 175, 55, 0.35)',
    shadowOffset: {width: 0, height: 12},
    shadowOpacity: 0.35,
    shadowRadius: 20,
    elevation: 12,
  },
  gradientFrame: {
    borderRadius: 24,
    padding: 1.5,
    overflow: 'visible',
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(18, 26, 36, 0.92)',
    borderRadius: 22,
    paddingVertical: 18,
    paddingHorizontal: 18,
    gap: 14,
    overflow: 'visible',
  },
  iconCluster: {
    width: CLUSTER,
    height: CLUSTER,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'visible',
  },
  ringWrap: {
    position: 'absolute',
    width: RING_SIZE,
    height: RING_SIZE,
    top: RING_INSET,
    left: RING_INSET,
    zIndex: 0,
  },
  iconBadge: {
    width: 52,
    height: 52,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  textBlock: {
    flex: 1,
  },
  title: {
    color: T.text,
    fontSize: 16,
    fontWeight: '800',
  },
  subtitle: {
    marginTop: 4,
    color: T.textSoft,
    fontSize: 13,
    lineHeight: 18,
  },
});
