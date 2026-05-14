import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  Animated,
  Alert,
  Easing,
  ImageBackground,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather, Ionicons } from '@expo/vector-icons';
import {updatePasswordForCurrentUser} from '../services/authService';
import {FONT_SERIF_DISPLAY} from '../constants/platformUi';

const THEME = {
  gold: '#d4af37',
  textMain: '#f6f8f8',
  textSecondary: '#a7b4b7',
  card: 'rgba(8, 18, 26, 0.66)',
  cardBorder: 'rgba(255, 255, 255, 0.10)',
  success: '#4ADE80',
};

const AnimatedImageBackground = Animated.createAnimatedComponent(ImageBackground);

const PressScaleButton = ({
  children,
  onPress,
  style,
  contentStyle,
  scaleTo = 0.96,
  activeOpacity = 0.92,
  disabled = false,
}) => {
  const scale = useRef(new Animated.Value(1)).current;

  const animateTo = value => {
    Animated.spring(scale, {
      toValue: value,
      useNativeDriver: true,
      speed: 26,
      bounciness: 8,
    }).start();
  };

  return (
    <TouchableOpacity
      activeOpacity={activeOpacity}
      onPress={onPress}
      onPressIn={() => !disabled && animateTo(scaleTo)}
      onPressOut={() => !disabled && animateTo(1)}
      style={style}
      disabled={disabled}>
      <Animated.View style={[contentStyle, {transform: [{scale}]}]}>{children}</Animated.View>
    </TouchableOpacity>
  );
};

const RequirementRow = ({label, isMet}) => (
  <View style={styles.requirementRow}>
    <View style={[styles.reqCircle, isMet && styles.reqCircleMet]}>
      {isMet && <Ionicons name="checkmark" size={12} color="#050b12" />}
    </View>
    <Text style={[styles.requirementText, isMet && styles.requirementTextMet]}>{label}</Text>
  </View>
);

export default function ResetPassword({navigation, route}) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const verifiedEmail = route?.params?.email;

  const introOpacity = useRef(new Animated.Value(0)).current;
  const introTranslateY = useRef(new Animated.Value(20)).current;
  const bgDrift = useRef(new Animated.Value(0)).current;
  const auraA = useRef(new Animated.Value(0)).current;
  const auraB = useRef(new Animated.Value(0)).current;
  const buttonGlow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(introOpacity, {toValue: 1, duration: 700, useNativeDriver: true}),
      Animated.timing(introTranslateY, {toValue: 0, duration: 700, useNativeDriver: true}),
    ]).start();

    const loop = (ref, duration) => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(ref, {toValue: 1, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true}),
          Animated.timing(ref, {toValue: 0, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true}),
        ])
      ).start();
    };

    loop(bgDrift, 9000);
    loop(auraA, 2400);
    loop(auraB, 3000);
    loop(buttonGlow, 1300);
  }, [auraA, auraB, bgDrift, buttonGlow, introOpacity, introTranslateY]);

  const checks = useMemo(() => {
    const hasMinLength = newPassword.length >= 8;
    const hasNumber = /\d/.test(newPassword);
    const hasSpecial = /[^A-Za-z0-9]/.test(newPassword);
    return {hasMinLength, hasNumber, hasSpecial};
  }, [newPassword]);

  const strengthScore = useMemo(() => {
    return [checks.hasMinLength, checks.hasNumber, checks.hasSpecial].filter(Boolean).length;
  }, [checks]);

  const strengthLabel = useMemo(() => {
    if (strengthScore <= 1) return 'Weak';
    if (strengthScore === 2) return 'Medium';
    return 'Strong';
  }, [strengthScore]);

  const handleUpdatePassword = async () => {
    if (!newPassword || !confirmPassword) {
      Alert.alert('Missing Fields', 'Please complete all password fields.');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Password Mismatch', 'Passwords do not match.');
      return;
    }
    if (!checks.hasMinLength || !checks.hasNumber || !checks.hasSpecial) {
      Alert.alert('Weak Password', 'Please meet all password requirements.');
      return;
    }

    try {
      setIsSubmitting(true);
      await updatePasswordForCurrentUser({newPassword});
      Alert.alert('Success', 'Your password has been reset.', [
        {text: 'OK', onPress: () => navigation.reset({index: 0, routes: [{name: 'Login'}]})},
      ]);
    } catch (error) {
      Alert.alert(
        'Reset Failed',
        error?.message ??
          'Could not update password. Verify your recovery code first and try again.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.backgroundLayer} pointerEvents="none">
        <AnimatedImageBackground
          source={require('../assets/images/bg.jpg')}
          resizeMode="cover"
          style={[
            styles.backgroundImage,
            {
              transform: [
                {
                  translateY: bgDrift.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, -18],
                  }),
                },
              ],
            },
          ]}>
          <View style={styles.tintDeepBlue} />
          <View style={styles.tintDark} />
        </AnimatedImageBackground>
        <Animated.View style={[styles.aura, styles.auraLeft, {opacity: auraA.interpolate({inputRange: [0, 1], outputRange: [0.3, 0.6]})}]} />
        <Animated.View style={[styles.aura, styles.auraRight, {opacity: auraB.interpolate({inputRange: [0, 1], outputRange: [0.2, 0.5]})}]} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Animated.View style={[styles.topBar, {opacity: introOpacity, transform: [{translateY: introTranslateY}]}]}>
          <PressScaleButton contentStyle={styles.backButton} onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={24} color={THEME.textMain} />
          </PressScaleButton>
        </Animated.View>

        <Animated.View style={[styles.heroCard, {opacity: introOpacity}]}>
          <Text style={styles.headerTitle}>Reset Password</Text>
          <Text style={styles.headerSub}>Choose a strong and secure password for your account.</Text>
          {!!verifiedEmail && <Text style={styles.verifiedEmail}>Verified: {verifiedEmail}</Text>}
        </Animated.View>

        <Animated.View style={[styles.formCard, {opacity: introOpacity}]}>
          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>New Password</Text>
            <View style={styles.inputWrapper}>
              <TextInput
                style={styles.textInput}
                placeholder="Enter new password"
                placeholderTextColor={THEME.textSecondary}
                secureTextEntry={!showNewPassword}
                value={newPassword}
                onChangeText={setNewPassword}
              />
              <TouchableOpacity onPress={() => setShowNewPassword(!showNewPassword)} style={styles.eyeButton}>
                <Feather name={showNewPassword ? 'eye' : 'eye-off'} size={18} color={THEME.textSecondary} />
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>Confirm New Password</Text>
            <View style={styles.inputWrapper}>
              <TextInput
                style={styles.textInput}
                placeholder="Re-enter new password"
                placeholderTextColor={THEME.textSecondary}
                secureTextEntry={!showConfirmPassword}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
              />
              <TouchableOpacity onPress={() => setShowConfirmPassword(!showConfirmPassword)} style={styles.eyeButton}>
                <Feather name={showConfirmPassword ? 'eye' : 'eye-off'} size={18} color={THEME.textSecondary} />
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.strengthRow}>
            <Text style={styles.strengthLabel}>Password Strength</Text>
            <Text style={[styles.strengthValue, strengthScore === 3 && styles.strengthStrong]}>{strengthLabel}</Text>
          </View>

          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                {
                  width: `${(strengthScore / 3) * 100}%`,
                  backgroundColor: strengthScore === 3 ? THEME.success : THEME.gold,
                },
              ]}
            />
          </View>

          <View style={styles.requirementsContainer}>
            <Text style={styles.reqTitle}>PASSWORD REQUIREMENTS</Text>
            <RequirementRow label="At least 8 characters" isMet={checks.hasMinLength} />
            <RequirementRow label="Contains a number" isMet={checks.hasNumber} />
            <RequirementRow label="Contains a special character" isMet={checks.hasSpecial} />
          </View>

          <PressScaleButton
            style={[styles.primaryButtonWrap, isSubmitting && styles.disabledWrap]}
            contentStyle={styles.primaryButton}
            onPress={handleUpdatePassword}
            disabled={isSubmitting}>
            <Animated.View style={[styles.buttonGlow, {opacity: buttonGlow}]} />
            <Text style={styles.primaryButtonText}>{isSubmitting ? 'Updating...' : 'Update Password'}</Text>
          </PressScaleButton>
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#050b12'},
  backgroundLayer: {...StyleSheet.absoluteFillObject, overflow: 'hidden'},
  backgroundImage: {...StyleSheet.absoluteFillObject, left: -24, right: -24, top: -24, bottom: -24},
  tintDeepBlue: {...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(4, 18, 44, 0.7)'},
  tintDark: {...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(3, 9, 15, 0.3)'},
  aura: {position: 'absolute', borderRadius: 999},
  auraLeft: {top: 100, left: -100, width: 300, height: 300, backgroundColor: 'rgba(75, 121, 214, 0.2)'},
  auraRight: {bottom: 50, right: -100, width: 300, height: 300, backgroundColor: 'rgba(212, 175, 55, 0.1)'},
  scrollContent: {paddingHorizontal: 20, paddingTop: 10, paddingBottom: 40},
  topBar: {marginBottom: 20},
  backButton: {width: 40, height: 40, justifyContent: 'center'},
  heroCard: {marginBottom: 25},
  headerTitle: {color: THEME.textMain, fontSize: 34, fontWeight: '900', fontFamily: FONT_SERIF_DISPLAY},
  headerSub: {color: THEME.textSecondary, marginTop: 10, fontSize: 16, lineHeight: 24},
  verifiedEmail: {color: THEME.gold, marginTop: 8, fontSize: 12, fontWeight: '700'},
  formCard: {
    backgroundColor: THEME.card,
    borderRadius: 28,
    padding: 24,
    borderWidth: 1,
    borderColor: THEME.cardBorder,
  },
  inputContainer: {marginBottom: 20},
  inputLabel: {color: THEME.textMain, fontSize: 14, marginBottom: 10, fontWeight: '700'},
  inputWrapper: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 16,
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  textInput: {flex: 1, color: THEME.textMain, fontSize: 15},
  eyeButton: {padding: 4},
  strengthRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 8,
  },
  strengthLabel: {color: THEME.textSecondary, fontSize: 12, fontWeight: '700'},
  strengthValue: {color: THEME.gold, fontSize: 12, fontWeight: '700'},
  strengthStrong: {color: THEME.success},
  progressTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    overflow: 'hidden',
    marginBottom: 16,
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
  },
  requirementsContainer: {marginTop: 10, marginBottom: 30},
  reqTitle: {color: THEME.textSecondary, fontSize: 12, fontWeight: '800', letterSpacing: 1.2, marginBottom: 15},
  requirementRow: {flexDirection: 'row', alignItems: 'center', marginBottom: 12},
  reqCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: THEME.textSecondary,
    marginRight: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reqCircleMet: {
    backgroundColor: THEME.success,
    borderColor: THEME.success,
  },
  requirementText: {color: THEME.textSecondary, fontSize: 14, fontWeight: '500'},
  requirementTextMet: {color: THEME.textMain},
  primaryButton: {
    backgroundColor: '#0c1622',
    height: 58,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
  },
  primaryButtonWrap: {
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 8,
  },
  buttonGlow: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
  primaryButtonText: {color: '#fff', fontWeight: '800', fontSize: 16},
  disabledWrap: {opacity: 0.7},
});
