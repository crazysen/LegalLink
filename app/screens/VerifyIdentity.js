import React, {useEffect, useRef, useState} from 'react';
import {
  Animated,
  Alert,
  Easing,
  ImageBackground,
  ScrollView,
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  startPasswordRecovery,
  verifyRecoveryOtp,
} from '../services/authService';
import {FONT_SERIF_DISPLAY} from '../constants/platformUi';

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

export default function VerifyIdentity({navigation, route}) {
  const [email, setEmail] = useState(route?.params?.email ?? '');
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [hasRequestedCode, setHasRequestedCode] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const inputRefs = useRef([]);

  const introOpacity = useRef(new Animated.Value(0)).current;
  const introTranslateY = useRef(new Animated.Value(20)).current;
  const introScale = useRef(new Animated.Value(0.98)).current;
  const bgScale = useRef(new Animated.Value(0)).current;
  const bgDrift = useRef(new Animated.Value(0)).current;
  const auraA = useRef(new Animated.Value(0)).current;
  const auraB = useRef(new Animated.Value(0)).current;
  const buttonGlow = useRef(new Animated.Value(0)).current;

  const isValidEmail = value => value.includes('@') && value.includes('.');

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

  const requestRecoveryCode = async () => {
    if (!email) {
      Alert.alert('Missing Email', 'Please enter your email first.');
      return;
    }

    if (!isValidEmail(email)) {
      Alert.alert('Invalid Email', 'Please enter a valid email address.');
      return;
    }

    try {
      setIsSending(true);
      await startPasswordRecovery({email: email.trim()});
      setCode(['', '', '', '', '', '']);
      setHasRequestedCode(true);
      Alert.alert(
        'Code Sent',
        'If your account exists, we sent a 6-digit recovery code to your email.',
      );
    } catch (error) {
      Alert.alert('Send Failed', error?.message ?? 'Could not send recovery code.');
    } finally {
      setIsSending(false);
    }
  };

  const focusFirstEmptyInput = () => {
    const firstEmptyIndex = code.findIndex(char => !char);
    const targetIndex = firstEmptyIndex === -1 ? 5 : firstEmptyIndex;
    inputRefs.current[targetIndex]?.focus();
  };

  const handleCodeChange = (value, index) => {
    const digits = value.replace(/[^0-9]/g, '');

    // Allow pasting the full code into any box.
    if (digits.length > 1) {
      const next = [...code];
      for (let i = index; i < 6; i += 1) {
        next[i] = digits[i - index] || '';
      }
      setCode(next);

      const nextFocusIndex = Math.min(index + digits.length, 5);
      inputRefs.current[nextFocusIndex]?.focus();
      return;
    }

    const next = [...code];
    next[index] = digits;
    setCode(next);

    if (digits && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyPress = (e, index) => {
    if (e.nativeEvent.key === 'Backspace' && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleVerify = async () => {
    if (!email || !isValidEmail(email)) {
      Alert.alert('Invalid Email', 'Please enter a valid email address.');
      return;
    }

    if (code.join('').length !== 6) {
      Alert.alert('Invalid Code', 'Please enter the full 6-digit code.');
      return;
    }

    try {
      setIsVerifying(true);
      await verifyRecoveryOtp({
        email: email.trim(),
        token: code.join(''),
      });

      navigation.reset({
        index: 0,
        routes: [{name: 'ResetPassword', params: {email: email.trim()}}],
      });
    } catch (error) {
      Alert.alert(
        'Verification Failed',
        error?.message ?? 'Invalid or expired recovery code.',
      );
    } finally {
      setIsVerifying(false);
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

  const handleBack = () => {
    if (navigation?.canGoBack?.()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('Login');
  };

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
            <Text style={styles.brandBadgeText}>Batas Mo</Text>
          </View>
        </Animated.View>

        <Animated.View style={[styles.heroCard, containerStyle]}>
          <Text style={styles.headerTitle}>Verify Identity</Text>
          <Text style={styles.headerSub}>
            Enter your email and the 6-digit recovery code sent to your inbox.
          </Text>
        </Animated.View>

        <Animated.View style={[styles.formCard, containerStyle]}>
          {!hasRequestedCode && (
            <>
              <Text style={styles.inputLabel}>EMAIL ADDRESS</Text>
              <TextInput
                style={styles.emailInput}
                keyboardType="email-address"
                autoCapitalize="none"
                placeholder="name@domain.com"
                placeholderTextColor={THEME.textSecondary}
                value={email}
                onChangeText={value => {
                  setEmail(value);
                  if (hasRequestedCode) {
                    setHasRequestedCode(false);
                    setCode(['', '', '', '', '', '']);
                  }
                }}
              />

              <PressScaleButton
                style={[styles.primaryButtonWrap, isSending && styles.disabledWrap]}
                contentStyle={styles.primaryButton}
                onPress={requestRecoveryCode}
                disabled={isSending}>
                <Animated.View style={[styles.buttonGlow, {opacity: buttonGlow}]} />
                <Text style={styles.primaryButtonText}>{isSending ? 'SENDING...' : 'SEND 6-DIGIT CODE'}</Text>
              </PressScaleButton>
            </>
          )}

          {hasRequestedCode && (
            <>
              <Text style={styles.codeSentText}>Code sent to {email.trim()}.</Text>
              <Text style={styles.inputLabel}>SECURE CODE</Text>

              <View style={styles.otpRow}>
                {[0, 1, 2, 3, 4, 5].map(index => (
                  <TextInput
                    key={index}
                    ref={ref => (inputRefs.current[index] = ref)}
                    style={[styles.otpInput, code[index] !== '' && styles.otpInputActive]}
                    keyboardType="number-pad"
                    maxLength={1}
                    value={code[index]}
                    onChangeText={value => handleCodeChange(value, index)}
                    onKeyPress={e => handleKeyPress(e, index)}
                    autoComplete="one-time-code"
                    textContentType="oneTimeCode"
                    selectTextOnFocus
                  />
                ))}
              </View>

              <View style={styles.resendRow}>
                <Text style={styles.footerText}>Didn't receive the code? </Text>
                <TouchableOpacity onPress={requestRecoveryCode} disabled={isSending}>
                  <Text style={styles.linkText}>{isSending ? 'Sending...' : 'Resend Code'}</Text>
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
            </>
          )}

          <TouchableOpacity style={styles.footerRow} onPress={() => navigation.navigate('Login')}>
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
  inputLabel: {color: THEME.textSecondary, fontSize: 12, marginBottom: 12, fontWeight: '800', letterSpacing: 1.5, textAlign: 'center'},
  emailInput: {
    backgroundColor: 'rgba(11, 20, 29, 0.94)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 14,
    height: 56,
    paddingHorizontal: 16,
    color: THEME.textMain,
    fontSize: 15,
    marginBottom: 20,
  },
  codeSentText: {color: THEME.textSecondary, textAlign: 'center', marginBottom: 12},
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
  resendRow: {flexDirection: 'row', justifyContent: 'center', marginBottom: 24},
  footerRow: {flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 22},
  footerText: {color: THEME.textSecondary, fontSize: 14},
  linkText: {color: THEME.gold, fontWeight: '800', fontSize: 14},
  primaryButton: {backgroundColor: THEME.gold, height: 56, borderRadius: 16, justifyContent: 'center', alignItems: 'center', overflow: 'hidden'},
  primaryButtonWrap: {shadowColor: THEME.gold, shadowOpacity: 0.3, shadowRadius: 15, elevation: 5},
  buttonGlow: {position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(255, 255, 255, 0.15)'},
  primaryButtonText: {color: '#091115', fontWeight: '900', fontSize: 15, letterSpacing: 1.5},
  disabledWrap: {opacity: 0.7},
});
