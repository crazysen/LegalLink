import React, {useEffect, useRef} from 'react';
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Ionicons} from '@expo/vector-icons';
import {useNotifications} from '../context/NotificationContext';
import {REFERENCE_THEME as T} from '../constants/referenceTheme';

/**
 * Global in-app toast banner that slides down from the top whenever a new
 * notification arrives via Supabase Realtime. Mount once inside App (index.js).
 */
export default function InAppNotificationToast() {
  const {toast, dismissToast} = useNotifications();
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(-120)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (toast) {
      // Slide in
      Animated.parallel([
        Animated.spring(translateY, {
          toValue: 0,
          useNativeDriver: true,
          damping: 18,
          stiffness: 200,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 220,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      // Slide out
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: -120,
          duration: 280,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [toast, translateY, opacity]);

  if (!toast) return null;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          top: insets.top + 10,
          transform: [{translateY}],
          opacity,
        },
      ]}>
      <TouchableOpacity
        activeOpacity={0.92}
        style={styles.inner}
        onPress={dismissToast}>
        <View style={styles.iconWrap}>
          <Ionicons name="notifications" size={20} color={T.gold[1]} />
        </View>
        <View style={styles.textWrap}>
          <Text style={styles.title} numberOfLines={1}>
            {toast.title}
          </Text>
          <Text style={styles.body} numberOfLines={2}>
            {toast.body}
          </Text>
        </View>
        <TouchableOpacity onPress={dismissToast} style={styles.closeHit}>
          <Ionicons name="close" size={16} color={T.textSoft} />
        </TouchableOpacity>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 9999,
    elevation: 20,
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(18, 26, 36, 0.97)',
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.28)',
    shadowColor: 'rgba(212, 175, 55, 0.3)',
    shadowOffset: {width: 0, height: 6},
    shadowOpacity: 0.5,
    shadowRadius: 14,
    gap: 12,
  },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: 'rgba(212, 175, 55, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.2)',
    flexShrink: 0,
  },
  textWrap: {
    flex: 1,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    color: T.text,
    marginBottom: 2,
  },
  body: {
    fontSize: 12,
    color: T.textMuted,
    lineHeight: 17,
  },
  closeHit: {
    padding: 4,
    flexShrink: 0,
  },
});
