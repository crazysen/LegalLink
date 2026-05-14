import React from 'react';
import {Pressable, StyleSheet} from 'react-native';
import {Feather} from '@expo/vector-icons';
import {REFERENCE_THEME as T} from '../constants/referenceTheme';

const DEFAULT_HIT_SLOP = {top: 12, bottom: 12, left: 12, right: 12};

/**
 * Minimal back control: thin chevron, no chip/shadow (iOS-style reference).
 * Default color matches primary title text on dark shells.
 */
export default function ClientChevronBack({
  onPress,
  color = T.text,
  size = 24,
  style,
  hitSlop = DEFAULT_HIT_SLOP,
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={hitSlop}
      style={({pressed}) => [styles.root, style, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel="Go back">
      <Feather name="chevron-left" size={size} color={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  pressed: {
    opacity: 0.55,
  },
});
