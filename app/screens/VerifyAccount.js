import React, {useEffect, useRef, useState} from 'react';
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
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  e164ToPhilippinesLocal11,
  maskPhilippinesPhone,
  normalizePhilippinesToE164,
  resendPhoneVerificationOtp,
  requestPhoneVerificationSms,
  verifyPhoneOtp,
  resendSignUpOtp,
  upsertProfileFromVerificationPayload,
  completePendingSignup,
  signInWithEmail,
  OTP_RESUME_SIGNUP_KEY,
  PENDING_SIGNUP_ID_KEY,
} from '../services/authService';
import { markSignupOtpCompleted } from '../services/signupVerification';
import { supabase } from '../services/supabaseClient';
import {FONT_SERIF_DISPLAY} from '../constants/platformUi';
import {useUserProfile} from '../context/UserProfileContext';

const THEME = {
  gold: '#d4af37',
  textMain: '#f6f8f8',
  textSecondary: '#a7b4b7',
  card: 'rgba(8, 18, 26, 0.66)',
  cardBorder: 'rgba(255, 255, 255, 0.10)',
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

export default function VerifyAccount({navigation, route}) {
  const {updateProfile} = useUserProfile();
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const inputRefs = useRef([]);

  const paramPhoneE164 = route?.params?.phoneE164;
  const email = route?.params?.email || '';
  const pendingIdParam = route?.params?.pendingId || '';
  const role = route?.params?.role || 'Client';
  const profilePayload = route?.params?.profilePayload;
  const isNewSignup = route?.params?.isNewSignup !== false;
  const isEmailVerif = isNewSignup || route?.params?.verificationMethod === 'email';

  const [phoneE164, setPhoneE164] = useState(paramPhoneE164 || null);

  const introOpacity = useRef(new Animated.Value(0)).current;
  const introTranslateY = useRef(new Animated.Value(20)).current;
  const introScale = useRef(new Animated.Value(0.98)).current;
  const bgScale = useRef(new Animated.Value(0)).current;
  const bgDrift = useRef(new Animated.Value(0)).current;
  const auraA = useRef(new Animated.Value(0)).current;
  const auraB = useRef(new Animated.Value(0)).current;
  const buttonGlow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (paramPhoneE164) {
        setPhoneE164(paramPhoneE164);
        return;
      }
      const {
        data: {user},
      } = await supabase.auth.getUser();
      if (cancelled || !user) {
        return;
      }
      // Pending SMS OTP is tied to auth.users.phone_change → API field `new_phone` (not `phone`).
      let raw = user.new_phone || user.phone;
      if (!raw) {
        const {data: prof} = await supabase
          .from('profiles')
          .select('phone')
          .eq('id', user.id)
          .maybeSingle();
        raw = prof?.phone;
      }
      if (cancelled || !raw) {
        return;
      }
      try {
        setPhoneE164(normalizePhilippinesToE164(String(raw)));
      } catch {
        setPhoneE164(String(raw));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [paramPhoneE164]);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(introOpacity, {toValue: 1, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: true}),
      Animated.timing(introTranslateY, {toValue: 0, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: true}),
      Animated.timing(introScale, {toValue: 1, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: true}),
      Animated.timing(bgScale, {toValue: 1, duration: 1200, easing: Easing.out(Easing.cubic), useNativeDriver: true}),
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
  }, [auraA, auraB, bgDrift, bgScale, buttonGlow, introOpacity, introScale, introTranslateY]);

  const handleCodeChange = (value, index) => {
    const digits = value.replace(/[^0-9]/g, '');

    if (digits.length > 1) {
      const next = [...otp];
      for (let i = index; i < 6; i += 1) {
        next[i] = digits[i - index] || '';
      }
      setOtp(next);

      const nextFocusIndex = Math.min(index + digits.length, 5);
      inputRefs.current[nextFocusIndex]?.focus();
      return;
    }

    const next = [...otp];
    next[index] = digits;
    setOtp(next);

    if (digits && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyPress = (e, index) => {
    if (e.nativeEvent.key === 'Backspace' && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleVerify = async () => {
    const token = otp.join('');

    if (!isEmailVerif && !phoneE164) {
      Alert.alert('Missing phone', 'No phone number on file. Please sign up again or contact support.');
      return;
    }

    if (token.length !== 6) {
      Alert.alert('Invalid Code', 'Please enter the 6-digit verification code.');
      return;
    }

    try {
      setIsVerifying(true);

      if (isNewSignup && isEmailVerif) {
        const resumeRaw = await AsyncStorage.getItem(OTP_RESUME_SIGNUP_KEY);
        if (!resumeRaw) {
          throw new Error('Session expired. Please sign up again.');
        }
        let resume;
        try {
          resume = JSON.parse(resumeRaw);
        } catch {
          throw new Error('Session expired. Please sign up again.');
        }
        const pendingId =
          pendingIdParam || (await AsyncStorage.getItem(PENDING_SIGNUP_ID_KEY)) || undefined;
        await completePendingSignup({
          email,
          pendingId,
          otp: token,
          password: resume.password,
        });
        await signInWithEmail({
          email: resume.email || email,
          password: resume.password,
        });
        await markSignupOtpCompleted();
        await AsyncStorage.multiRemove([OTP_RESUME_SIGNUP_KEY, PENDING_SIGNUP_ID_KEY]);
      } else if (isEmailVerif) {
        throw new Error('Use the email link or sign up again to verify your account.');
      } else {
        if (!phoneE164) {
          Alert.alert('Missing phone', 'No phone number on file. Please sign up again or contact support.');
          return;
        }
        await verifyPhoneOtp({ phone: phoneE164, token });
      }

      if (profilePayload && phoneE164 && !isNewSignup) {
        await upsertProfileFromVerificationPayload(phoneE164, profilePayload);
      }

      const {
        data: {user},
      } = await supabase.auth.getUser();
      if (user) {
        updateProfile({
          name: profilePayload?.fullName || user.user_metadata?.full_name || '',
          email: profilePayload?.email || user.email || email,
          phone: e164ToPhilippinesLocal11(phoneE164) || phoneE164,
          address: profilePayload?.address ?? '',
          age: profilePayload?.age ?? '',
          guardian_name: profilePayload?.guardianName ?? '',
          guardian_contact: profilePayload?.guardianContact ?? '',
          role: profilePayload?.role || role,
        });
      }

      if (isNewSignup) {
        navigation.reset({
          index: 0,
          routes: [{name: 'AccountCreated', params: {role}}],
        });
      } else {
        const isAttorney = String(role).toLowerCase() === 'attorney';
        navigation.reset({
          index: 0,
          routes: [{name: isAttorney ? 'AttyLandingPage' : 'HomepageClient'}],
        });
      }
    } catch (error) {
      Alert.alert('Verification Failed', error?.message ?? 'Invalid or expired code.');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleResend = async () => {
    if (!isEmailVerif && !phoneE164) {
      Alert.alert('Missing phone', 'Cannot resend code without a phone number.');
      return;
    }

    try {
      setIsResending(true);
      if (isEmailVerif) {
        const pendingId =
          pendingIdParam || (await AsyncStorage.getItem(PENDING_SIGNUP_ID_KEY)) || undefined;
        await resendSignUpOtp({ email, pendingId });
        Alert.alert('Code Sent', 'A new verification code has been sent to your email.');
      } else {
        try {
          await resendPhoneVerificationOtp({phone: phoneE164});
        } catch (e) {
          await requestPhoneVerificationSms(phoneE164);
        }
        Alert.alert('Code Sent', 'A new verification code has been sent via SMS.');
      }
    } catch (error) {
      Alert.alert('Resend Failed', error?.message ?? 'Could not resend code.');
    } finally {
      setIsResending(false);
    }
  };

  const containerStyle = {
    opacity: introOpacity,
    transform: [{translateY: introTranslateY}, {scale: introScale}],
  };

  const bgTransform = {
    transform: [
      {scale: bgScale.interpolate({inputRange: [0, 1], outputRange: [1.1, 1.22]})},
      {translateY: bgDrift.interpolate({inputRange: [0, 1], outputRange: [0, -18]})},
    ],
  };

  const handleBack = async () => {
    try { await supabase.auth.signOut(); } catch {}
    navigation.reset({ index: 0, routes: [{ name: 'LoginSignup' }] });
  };

  const phoneLabel = maskPhilippinesPhone(phoneE164);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.backgroundLayer} pointerEvents="none">
        <AnimatedImageBackground
          source={require('../assets/images/bg.jpg')}
          resizeMode="cover"
          style={[styles.backgroundImage, bgTransform]}>
          <View style={styles.tintDeepBlue} />
          <View style={styles.tintDark} />
        </AnimatedImageBackground>
        <Animated.View style={[styles.aura, styles.auraLeft, {opacity: auraA.interpolate({inputRange: [0, 1], outputRange: [0.4, 0.88]})}]} />
        <Animated.View style={[styles.aura, styles.auraRight, {opacity: auraB.interpolate({inputRange: [0, 1], outputRange: [0.28, 0.72]})}]} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Animated.View style={[styles.topBar, containerStyle]}>
          <PressScaleButton style={styles.backButtonWrap} contentStyle={styles.backButton} onPress={handleBack}>
            <Ionicons name="chevron-back" size={18} color={THEME.textSecondary} />
            <Text style={styles.backText}>Back</Text>
          </PressScaleButton>
          <View style={styles.brandBadge}>
            <Text style={styles.brandBadgeText}>LegalLink</Text>
          </View>
        </Animated.View>

        <Animated.View style={[styles.heroCard, containerStyle]}>
          <Text style={styles.headerTitle}>
            {isEmailVerif ? 'Verify your email' : 'Verify your phone'}
          </Text>
          <Text style={styles.headerSub}>
            {isEmailVerif
              ? `Enter the 6-digit code sent to ${email || 'your email address'}.`
              : `Enter the 6-digit code sent via SMS to ${maskPhilippinesPhone(phoneE164)}.${email ? ` (${email})` : ''}`
            }
          </Text>
        </Animated.View>

        <Animated.View style={[styles.formCard, containerStyle]}>
          <Text style={styles.inputLabel}>SECURE CODE</Text>

          <View style={styles.otpRow}>
            {otp.map((digit, idx) => (
              <TextInput
                key={idx}
                ref={el => (inputRefs.current[idx] = el)}
                style={[styles.otpInput, digit !== '' && styles.otpInputActive]}
                maxLength={1}
                keyboardType="number-pad"
                value={digit}
                onChangeText={v => handleCodeChange(v, idx)}
                onKeyPress={e => handleKeyPress(e, idx)}
                placeholderTextColor={THEME.textSecondary}
                selectionColor={THEME.gold}
                textContentType="oneTimeCode"
                autoComplete="one-time-code"
              />
            ))}
          </View>

          <View style={styles.resendRow}>
            <Text style={styles.footerText}>Didn't receive the code? </Text>
            <TouchableOpacity onPress={handleResend} disabled={isResending}>
              <Text style={styles.linkText}>{isResending ? 'Resending...' : 'Resend Code'}</Text>
            </TouchableOpacity>
          </View>

          <PressScaleButton
            style={[styles.primaryButtonWrap, isVerifying && styles.disabledWrap]}
            contentStyle={styles.primaryButton}
            onPress={handleVerify}
            disabled={isVerifying}>
            <Animated.View style={[styles.buttonGlow, {opacity: buttonGlow}]} />
            <Text style={styles.primaryButtonText}>{isVerifying ? 'VERIFYING...' : 'VERIFY & PROCEED'}</Text>
          </PressScaleButton>

          <TouchableOpacity style={styles.footerRow} onPress={handleBack}>
            <Ionicons name="arrow-back" size={14} color={THEME.textSecondary} style={{marginRight: 6}} />
            <Text style={styles.footerText}>Back to Log In</Text>
          </TouchableOpacity>
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#050b12'},
  backgroundLayer: {...StyleSheet.absoluteFillObject, overflow: 'hidden'},
  backgroundImage: {...StyleSheet.absoluteFillObject, left: -24, right: -24, top: -24, bottom: -24},
  tintDeepBlue: {...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(4, 18, 44, 0.56)'},
  tintDark: {...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(3, 9, 15, 0.18)'},
  aura: {position: 'absolute', borderRadius: 999},
  auraLeft: {top: 56, left: -74, width: 220, height: 220, backgroundColor: 'rgba(75, 121, 214, 0.24)'},
  auraRight: {bottom: -30, right: -100, width: 280, height: 280, backgroundColor: 'rgba(212, 175, 55, 0.12)'},
  scrollContent: {paddingHorizontal: 18, paddingTop: 10, paddingBottom: 36},
  topBar: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14},
  backButtonWrap: {borderRadius: 999},
  backButton: {flexDirection: 'row', alignItems: 'center', gap: 4},
  backText: {color: THEME.textSecondary, fontSize: 15, fontWeight: '600'},
  brandBadge: {
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.18)',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
  },
  brandBadgeText: {color: '#f6f8f8', fontSize: 12, fontWeight: '900', letterSpacing: 1.3},
  heroCard: {backgroundColor: THEME.card, borderRadius: 28, padding: 24, borderWidth: 1, borderColor: THEME.cardBorder, marginBottom: 14},
  headerTitle: {
    color: THEME.textMain,
    fontSize: 32,
    fontWeight: '900',
    fontFamily: FONT_SERIF_DISPLAY,
    textAlign: 'center',
  },
  headerSub: {color: THEME.textSecondary, marginTop: 12, fontSize: 15, lineHeight: 22, textAlign: 'center', paddingHorizontal: 10},
  formCard: {backgroundColor: 'rgba(9, 18, 26, 0.88)', borderRadius: 28, padding: 20, borderWidth: 1, borderColor: 'rgba(212, 175, 55, 0.12)'},
  inputLabel: {color: THEME.textSecondary, fontSize: 12, marginBottom: 20, fontWeight: '800', letterSpacing: 1.5, textAlign: 'center'},
  otpRow: {flexDirection: 'row', justifyContent: 'space-between', marginBottom: 24},
  otpInput: {
    width: 48,
    height: 62,
    backgroundColor: 'rgba(11, 20, 29, 0.94)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 16,
    color: THEME.textMain,
    textAlign: 'center',
    fontSize: 24,
    fontWeight: '700',
  },
  otpInputActive: {borderColor: THEME.gold, backgroundColor: 'rgba(212, 175, 55, 0.05)'},
  resendRow: {flexDirection: 'row', justifyContent: 'center', marginBottom: 30},
  footerRow: {flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 24},
  footerText: {color: THEME.textSecondary, fontSize: 14},
  linkText: {color: THEME.gold, fontWeight: '800', fontSize: 14},
  primaryButton: {backgroundColor: THEME.gold, height: 56, borderRadius: 16, justifyContent: 'center', alignItems: 'center', overflow: 'hidden'},
  primaryButtonWrap: {shadowColor: THEME.gold, shadowOpacity: 0.3, shadowRadius: 15, elevation: 5},
  buttonGlow: {position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(255, 255, 255, 0.15)'},
  primaryButtonText: {color: '#091115', fontWeight: '900', fontSize: 15, letterSpacing: 1.5},
  disabledWrap: {opacity: 0.7},
});
