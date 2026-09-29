import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  ImageBackground,
  InteractionManager,
  Modal,
  Platform,
  KeyboardAvoidingView,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { signInWithEmail, signUpWithEmail } from '../services/authService';
import {FONT_SERIF_DISPLAY} from '../constants/platformUi';
import {
  formatLockoutMessage,
  isValidEmail,
  isGmailEmail,
  isPhilippineMobile,
  sanitizePhoneInput,
  GMAIL_REQUIRED_MESSAGE,
  PH_MOBILE_REQUIRED_MESSAGE,
  mapLoginErrorMessage,
  VALID_EMAIL_MESSAGE,
} from '../utils/validators';

const THEME = {
  gold: '#d4af37',
  goldSoft: 'rgba(212, 175, 55, 0.14)',
  textMain: '#f6f8f8',
  textSecondary: '#a7b4b7',
  card: 'rgba(8, 18, 26, 0.66)',
  cardBorder: 'rgba(255, 255, 255, 0.10)',
  success: '#4ADE80',
};

const AnimatedImageBackground = Animated.createAnimatedComponent(ImageBackground);

const PressScaleButton = ({ children, onPress, style, contentStyle, scaleTo = 0.96, activeOpacity = 0.92 }) => {
  const scale = useRef(new Animated.Value(1)).current;

  const animateTo = (value) => {
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
      onPressIn={() => animateTo(scaleTo)}
      onPressOut={() => animateTo(1)}
      style={style}
    >
      <Animated.View style={[contentStyle, { transform: [{ scale }] }]}>{children}</Animated.View>
    </TouchableOpacity>
  );
};

const AuthInputField = ({
  label,
  placeholder,
  secure,
  value,
  onChangeText,
  autoCapitalize = 'none',
  keyboardType = 'default',
  showPassword,
  onTogglePassword,
}) => {
  const inputRef = useRef(null);
  const latestValueRef = useRef(value);
  const lastVisibilityToggleAt = useRef(0);

  useEffect(() => {
    latestValueRef.current = value;
  }, [value]);

  const handleChangeText = (text) => {
    if (secure) {
      const prev = latestValueRef.current;
      if (
        text === '' &&
        prev.length > 0 &&
        Date.now() - lastVisibilityToggleAt.current < 450
      ) {
        return;
      }
    }
    latestValueRef.current = text;
    onChangeText(text);
  };

  const handleToggleVisibility = () => {
    if (!secure || !onTogglePassword) {
      return;
    }
    lastVisibilityToggleAt.current = Date.now();
    inputRef.current?.blur();
    InteractionManager.runAfterInteractions(() => onTogglePassword());
  };

  const resolvedKeyboardType =
    secure && Platform.OS === 'android'
      ? showPassword
        ? 'visible-password'
        : 'default'
      : keyboardType;

  const autoCompleteProp =
    keyboardType === 'email-address'
      ? 'email'
      : secure
        ? Platform.OS === 'android'
          ? showPassword
            ? 'off'
            : 'password'
          : 'password'
        : undefined;

  return (
    <View style={styles.inputContainer}>
      <Text style={styles.inputLabel}>{label}</Text>
      <View style={styles.inputWrapper}>
        <TextInput
          ref={secure ? inputRef : undefined}
          style={styles.textInput}
          placeholder={placeholder}
          placeholderTextColor={THEME.textSecondary}
          secureTextEntry={Boolean(secure && !showPassword)}
          value={value}
          onChangeText={handleChangeText}
          autoCapitalize={autoCapitalize}
          keyboardType={resolvedKeyboardType}
          autoCorrect={false}
          spellCheck={false}
          maxLength={keyboardType === 'phone-pad' ? 11 : undefined}
          autoComplete={autoCompleteProp}
          textContentType={
            secure && Platform.OS === 'ios'
              ? showPassword
                ? 'none'
                : 'password'
              : undefined
          }
          importantForAutofill={secure ? 'no' : undefined}
        />
        {secure ? (
          <TouchableOpacity onPress={handleToggleVisibility} style={styles.eyeButton}>
            <Feather name={showPassword ? 'eye' : 'eye-off'} size={18} color={THEME.textSecondary} />
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
};

const RequirementRow = ({ label, isMet }) => (
  <View style={styles.requirementRow}>
    <View style={[styles.reqCircle, isMet && styles.reqCircleMet]}>
      {isMet && <Ionicons name="checkmark" size={12} color="#050b12" />}
    </View>
    <Text style={[styles.requirementText, isMet && styles.requirementTextMet]}>{label}</Text>
  </View>
);

const SEX_OPTIONS = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'others', label: 'Others' },
];

const SexPickerField = ({ value, onChange }) => (
  <View style={styles.inputContainer}>
    <Text style={styles.inputLabel}>Gender</Text>
    <View style={styles.sexRow}>
      {SEX_OPTIONS.map(option => {
        const active = value === option.value;
        return (
          <TouchableOpacity
            key={option.value}
            style={[styles.sexChip, active && styles.sexChipActive]}
            onPress={() => onChange(option.value)}
            activeOpacity={0.85}>
            <Text style={[styles.sexChipText, active && styles.sexChipTextActive]}>
              {option.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  </View>
);

const AuthScreen = ({navigation}) => {
  const [screenState, setScreenState] = useState('LOGIN');
  const [showPassword, setShowPassword] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');

  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lockoutSeconds, setLockoutSeconds] = useState(0);

  const introOpacity = useRef(new Animated.Value(0)).current;
  const introTranslateY = useRef(new Animated.Value(20)).current;
  const introScale = useRef(new Animated.Value(0.98)).current;
  const bgScale = useRef(new Animated.Value(0)).current;
  const bgDrift = useRef(new Animated.Value(0)).current;
  const auraA = useRef(new Animated.Value(0)).current;
  const auraB = useRef(new Animated.Value(0)).current;
  const buttonGlow = useRef(new Animated.Value(0)).current;

  const isLogin = screenState === 'LOGIN';



  const passwordChecks = useMemo(() => {
    const hasMinLength = password.length >= 8;
    const hasNumber = /\d/.test(password);
    const hasSpecial = /[^A-Za-z0-9]/.test(password);
    return { hasMinLength, hasNumber, hasSpecial };
  }, [password]);

  const strengthScore = useMemo(
    () => [passwordChecks.hasMinLength, passwordChecks.hasNumber, passwordChecks.hasSpecial].filter(Boolean).length,
    [passwordChecks],
  );

  const strengthLabel = useMemo(() => {
    if (strengthScore <= 1) return 'Weak';
    if (strengthScore === 2) return 'Medium';
    return 'Strong';
  }, [strengthScore]);

  const headerTitle = isLogin ? 'Welcome back' : 'Create your account';
  const headerSub = isLogin
    ? 'Sign in to continue your legal workspace.'
    : 'Set up a secure profile in a few quick steps.';
  const mainButtonText = isLogin ? 'LOG IN' : 'CREATE ACCOUNT';

  useEffect(() => {
    if (lockoutSeconds <= 0) return;

    const timer = setInterval(() => {
      setLockoutSeconds(prev => (prev > 0 ? prev - 1 : 0));
    }, 1000);

    return () => clearInterval(timer);
  }, [lockoutSeconds]);

  const formatLockoutTime = (totalSeconds) => {
    const min = Math.floor(totalSeconds / 60);
    const sec = totalSeconds % 60;
    return `${min}:${sec < 10 ? '0' : ''}${sec}`;
  };

  const buttonLabel =
    isLogin && lockoutSeconds > 0
      ? `LOCKED (${formatLockoutTime(lockoutSeconds)})`
      : mainButtonText;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(introOpacity, {
        toValue: 1,
        duration: 700,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(introTranslateY, {
        toValue: 0,
        duration: 700,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(introScale, {
        toValue: 1,
        duration: 700,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(bgScale, {
        toValue: 1,
        duration: 1200,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(bgDrift, {
          toValue: 1,
          duration: 9000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(bgDrift, {
          toValue: 0,
          duration: 9000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    ).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(auraA, {
          toValue: 1,
          duration: 2400,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(auraA, {
          toValue: 0,
          duration: 2400,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    ).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(auraB, {
          toValue: 1,
          duration: 3000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(auraB, {
          toValue: 0,
          duration: 3000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    ).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(buttonGlow, {
          toValue: 1,
          duration: 1300,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(buttonGlow, {
          toValue: 0,
          duration: 1300,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [auraA, auraB, bgDrift, bgScale, buttonGlow, introOpacity, introScale, introTranslateY]);

  const containerStyle = {
    opacity: introOpacity,
    transform: [{ translateY: introTranslateY }, { scale: introScale }],
  };

  const bgTransform = {
    transform: [
      {
        scale: bgScale.interpolate({
          inputRange: [0, 1],
          outputRange: [1.1, 1.22],
        }),
      },
      {
        translateY: bgDrift.interpolate({
          inputRange: [0, 1],
          outputRange: [0, -18],
        }),
      },
    ],
  };

  const auraScale = buttonGlow.interpolate({
    inputRange: [0, 1],
    outputRange: [0.96, 1.12],
  });

  const handlePrimaryPress = async () => {
    if (isSubmitting) return;

    if (!isLogin) {
      if (
        !fullName.trim() ||
        !email.trim() ||
        !password ||
        !confirmPassword ||
        !phone.trim()
      ) {
        Alert.alert(
          'Missing information',
          'Please complete all required fields.',
        );
        return;
      }
      if (!isGmailEmail(email.trim())) {
        Alert.alert('Invalid email', GMAIL_REQUIRED_MESSAGE);
        return;
      }
      if (!isValidEmail(email.trim())) {
        Alert.alert('Invalid email', VALID_EMAIL_MESSAGE);
        return;
      }
      if (!isPhilippineMobile(phone)) {
        Alert.alert('Invalid mobile', PH_MOBILE_REQUIRED_MESSAGE);
        return;
      }
      if (password !== confirmPassword) {
        Alert.alert('Password mismatch', 'Passwords do not match.');
        return;
      }
      if (!passwordChecks.hasMinLength || !passwordChecks.hasNumber || !passwordChecks.hasSpecial) {
        Alert.alert('Weak Password', 'Please meet all password requirements.');
        return;
      }
      if (!agreeTerms) {
        Alert.alert('Terms required', 'Please agree to the Terms and Conditions to continue.');
        return;
      }

      try {
        setIsSubmitting(true);

        const signUpResult = await signUpWithEmail({
          email: email.trim(),
          password,
          fullName: fullName.trim(),
          role: 'Client',
          phone: phone.trim(),
        });

        navigation.navigate('VerifyAccount', {
          phoneE164: signUpResult.phoneE164,
          email: signUpResult.email || email.trim(),
          pendingId: signUpResult.pendingId,
          role: 'Client',
          isNewSignup: true,
          verificationMethod: 'email',
          profilePayload: {
            fullName: fullName.trim(),
            email: email.trim(),
            role: 'Client',
          },
        });
      } catch (error) {
        Alert.alert('Sign up failed', error?.message || 'Unable to create your account. Please try again.');
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (!email.trim() || !password) {
      Alert.alert('Missing credentials', 'Email and password are required.');
      return;
    }

    if (!isLogin && !isGmailEmail(email.trim())) {
      Alert.alert('Invalid email', GMAIL_REQUIRED_MESSAGE);
      return;
    }

    if (!isValidEmail(email.trim())) {
      Alert.alert('Invalid email', VALID_EMAIL_MESSAGE);
      return;
    }

    if (lockoutSeconds > 0) {
      Alert.alert('Account locked', formatLockoutMessage(lockoutSeconds));
      return;
    }

    try {
      setIsSubmitting(true);
      const data = await signInWithEmail({ email: email.trim(), password });
      const user = data?.user;
      const role = (user?.role || 'client').toLowerCase();

      if (data?.needsPhoneVerification) {
        if (!data.phoneE164ForVerification) {
          Alert.alert(
            'Verification required',
            'Please complete email verification before signing in.',
          );
          return;
        }
        navigation.navigate('VerifyAccount', {
          phoneE164: data.phoneE164ForVerification,
          email: email.trim(),
          role: role === 'attorney' ? 'Attorney' : 'Client',
          isNewSignup: false,
          verificationMethod: 'email',
          profilePayload: null,
        });
        return;
      }

      if (role === 'admin') {
        Alert.alert(
          'Admin sign-in',
          'Admin tools (reschedule approvals, dashboard) are available on the LegalLink web app. Use the same email and password there.',
        );
        return;
      }

      if (role === 'attorney') {
        navigation.reset({ index: 0, routes: [{ name: 'AttyLandingPage' }] });
      } else {
        navigation.reset({ index: 0, routes: [{ name: 'HomepageClient' }] });
      }
    } catch (error) {
      if (error?.code === 'SIGNUP_OTP_REQUIRED' || error?.message === 'SIGNUP_OTP_REQUIRED') {
        navigation.navigate('VerifyAccount', {
          email: error?.email || email.trim(),
          role: 'Client',
          isNewSignup: true,
          verificationMethod: 'email',
          profilePayload: null,
        });
        return;
      }

      const message = error?.message || 'Unable to sign in. Please try again.';
      const normalized = String(message).toLowerCase();

      if (normalized.includes('email not confirmed') || normalized.includes('email not verified')) {
        Alert.alert(
          'Confirm your email',
          'Open the confirmation link in the email we sent when you registered, then sign in again. SMS verification comes after your email is confirmed.',
        );
        return;
      }

      if (message.startsWith('LOCKOUT:')) {
        const seconds = parseInt(message.split(':')[1], 10);
        const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
        setLockoutSeconds(safeSeconds);
        Alert.alert('Account locked', formatLockoutMessage(safeSeconds));
      } else {
        Alert.alert('Login failed', mapLoginErrorMessage(error));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      <KeyboardAvoidingView
        style={styles.keyboardAvoid}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}>

      <View style={styles.backgroundLayer} pointerEvents="none">
        <AnimatedImageBackground
          source={require('../assets/images/bg.jpg')}
          resizeMode="cover"
          style={[styles.backgroundImage, bgTransform]}
        >
          <View style={styles.tintDeepBlue} />
          <View style={styles.tintDark} />
        </AnimatedImageBackground>
        <Animated.View
          style={[
            styles.aura,
            styles.auraLeft,
            {
              opacity: auraA.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0.88] }),
              transform: [{ scale: auraScale }],
            },
          ]}
        />
        <Animated.View
          style={[
            styles.aura,
            styles.auraRight,
            {
              opacity: auraB.interpolate({ inputRange: [0, 1], outputRange: [0.28, 0.72] }),
              transform: [{ scale: auraScale }],
            },
          ]}
        />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled">
        <Animated.View style={[styles.topBar, containerStyle]}>
          <PressScaleButton
            style={styles.backButtonWrap}
            contentStyle={styles.backButton}
            onPress={() => (navigation?.canGoBack?.() ? navigation.goBack() : null)}
            scaleTo={0.94}>
            <Ionicons name="chevron-back" size={18} color={THEME.textSecondary} />
            <Text style={styles.backText}>Back</Text>
          </PressScaleButton>

          <View style={styles.brandBadge}>
            <Text style={styles.brandBadgeText}>LegalLink</Text>
          </View>
        </Animated.View>

        <Animated.View style={[styles.heroCard, containerStyle]}>
          <View style={styles.heroRow}>
            <View style={styles.heroCopy}>
              <Text style={styles.headerTitle}>{headerTitle}</Text>
              <Text style={styles.headerSub}>{headerSub}</Text>
            </View>
          </View>

          <View style={styles.segmentWrap}>
            <PressScaleButton
              style={styles.segmentButtonWrap}
              contentStyle={[styles.segmentButton, isLogin && styles.segmentButtonActive]}
              onPress={() => setScreenState('LOGIN')}
              scaleTo={0.97}
            >
              <Text style={[styles.segmentText, isLogin && styles.segmentTextActive]}>LOG IN</Text>
            </PressScaleButton>
            <PressScaleButton
              style={styles.segmentButtonWrap}
              contentStyle={[styles.segmentButton, !isLogin && styles.segmentButtonActive]}
              onPress={() => setScreenState('SIGNUP')}
              scaleTo={0.97}
            >
              <Text style={[styles.segmentText, !isLogin && styles.segmentTextActive]}>SIGN UP</Text>
            </PressScaleButton>
          </View>
        </Animated.View>

        <Animated.View style={[styles.formCard, containerStyle]}>
          {!isLogin && (
            <AuthInputField
              label="Full Name"
              placeholder="Alexander Hamilton"
              value={fullName}
              onChangeText={setFullName}
              autoCapitalize="words"
              showPassword={showPassword}
              onTogglePassword={() => setShowPassword((v) => !v)}
            />
          )}
          {!isLogin && (
            <AuthInputField
              label="Mobile Number"
              placeholder="09171234567"
              value={phone}
              onChangeText={text => setPhone(sanitizePhoneInput(text))}
              keyboardType="phone-pad"
              showPassword={showPassword}
              onTogglePassword={() => setShowPassword((v) => !v)}
            />
          )}

          <AuthInputField
            label="Email Address"
            placeholder="name@domain.com"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            showPassword={showPassword}
            onTogglePassword={() => setShowPassword((v) => !v)}
          />
          <AuthInputField
            label="Password"
            placeholder="••••••••"
            secure={true}
            value={password}
            onChangeText={setPassword}
            showPassword={showPassword}
            onTogglePassword={() => setShowPassword((v) => !v)}
          />
          {!isLogin && (
            <AuthInputField
              label="Confirm Password"
              placeholder="••••••••"
              secure={true}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              showPassword={showPassword}
              onTogglePassword={() => setShowPassword((v) => !v)}
            />
          )}

          {!isLogin && (
            <>
              <View style={styles.strengthRow}>
                <Text style={styles.strengthLabel}>Password Strength</Text>
                <Text style={[styles.strengthValue, strengthScore === 3 && styles.strengthStrong]}>
                  {strengthLabel}
                </Text>
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
                <RequirementRow label="At least 8 characters" isMet={passwordChecks.hasMinLength} />
                <RequirementRow label="Contains a number" isMet={passwordChecks.hasNumber} />
                <RequirementRow label="Contains a special character" isMet={passwordChecks.hasSpecial} />
              </View>
            </>
          )}

          {isLogin ? (
            <View style={styles.loginForgotRow}>
              <TouchableOpacity
                onPress={() => navigation.navigate('VerifyIdentity', {email: email.trim()})}>
                <Text style={styles.linkText}>Forgot password?</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.optionsRow}>
              <TouchableOpacity
                style={[styles.checkboxRow, styles.checkboxRowSignup]}
                onPress={() => setAgreeTerms(!agreeTerms)}>
                <View style={[styles.checkbox, agreeTerms && styles.checkboxChecked]}>
                  {agreeTerms && <Ionicons name="checkmark" size={12} color={THEME.gold} />}
                </View>
                <Text style={[styles.optionText, styles.optionTextSignup]}>
                  I agree to the Terms and Conditions
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.termsLinkWrap} onPress={() => setShowTermsModal(true)}>
                <Text style={styles.linkText}>Terms</Text>
              </TouchableOpacity>
            </View>
          )}

          <PressScaleButton
            style={styles.primaryButtonWrap}
            contentStyle={[styles.primaryButton, (isSubmitting || (isLogin && lockoutSeconds > 0)) && styles.primaryButtonDisabled]}
            onPress={handlePrimaryPress}
            scaleTo={0.95}>
            <Animated.View style={[styles.buttonGlow, { opacity: buttonGlow }]} />
            {isSubmitting ? (
              <ActivityIndicator color={'#091115'} />
            ) : (
              <Text style={styles.primaryButtonText}>{buttonLabel}</Text>
            )}
          </PressScaleButton>

          <View style={styles.footerRow}>
            <Text style={styles.footerText}>
              {isLogin ? "Don't have an account? " : 'Already have an account? '}
            </Text>
            <TouchableOpacity onPress={() => setScreenState(isLogin ? 'SIGNUP' : 'LOGIN')}>
              <Text style={styles.linkText}>{isLogin ? 'Sign up' : 'Log in'}</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </ScrollView>
      </KeyboardAvoidingView>

      <Modal visible={showTermsModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Terms and Conditions</Text>
            <ScrollView style={styles.modalScroll}>
              <Text style={styles.modalBody}>
                By accessing and using the LegalLink platform, you agree to provide accurate and complete information and to use the system only for lawful purposes. Users are responsible for maintaining the confidentiality of their account and any activities performed under it.
                {'\n\n'}
                LegalLink respects and protects your personal data in accordance with the Data Privacy Act of 2012 (Republic Act No. 10173). All information submitted will be securely stored and used only for legal consultation services.
                {'\n\n'}
                By proceeding, you confirm that you have read, understood, and agreed to these terms.
              </Text>
            </ScrollView>
            <TouchableOpacity style={styles.closeBtn} onPress={() => setShowTermsModal(false)}>
              <Text style={styles.closeBtnText}>CLOSE</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050b12',
  },
  backgroundLayer: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  backgroundImage: {
    ...StyleSheet.absoluteFillObject,
    left: -24,
    right: -24,
    top: -24,
    bottom: -24,
  },
  tintDeepBlue: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(4, 18, 44, 0.56)',
  },
  tintDark: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(3, 9, 15, 0.18)',
  },
  aura: {
    position: 'absolute',
    borderRadius: 999,
  },
  auraLeft: {
    top: 56,
    left: -74,
    width: 220,
    height: 220,
    backgroundColor: 'rgba(75, 121, 214, 0.24)',
    shadowColor: '#4b79d6',
    shadowOpacity: 0.18,
    shadowRadius: 28,
  },
  auraRight: {
    bottom: -30,
    right: -100,
    width: 280,
    height: 280,
    backgroundColor: 'rgba(212, 175, 55, 0.12)',
    shadowColor: '#d4af37',
    shadowOpacity: 0.12,
    shadowRadius: 24,
  },
  keyboardAvoid: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 48,
  },
  sexRow: {
    flexDirection: 'row',
    gap: 8,
  },
  sexChip: {
    flex: 1,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    backgroundColor: 'rgba(11, 20, 29, 0.94)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sexChipActive: {
    borderColor: 'rgba(212, 175, 55, 0.55)',
    backgroundColor: 'rgba(212, 175, 55, 0.14)',
  },
  sexChipText: {
    color: THEME.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  sexChipTextActive: {
    color: THEME.gold,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  backButtonWrap: {
    borderRadius: 999,
  },
  backText: {
    color: THEME.textSecondary,
    fontSize: 15,
    fontWeight: '600',
  },
  brandBadge: {
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.18)',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
  },
  brandBadgeText: {
    color: '#f6f8f8',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.3,
  },
  heroCard: {
    backgroundColor: THEME.card,
    borderRadius: 28,
    padding: 20,
    borderWidth: 1,
    borderColor: THEME.cardBorder,
    shadowColor: '#000',
    shadowOpacity: 0.32,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 5,
    marginBottom: 14,
  },
  heroRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  heroCopy: {
    flex: 1,
  },
  kicker: {
    color: 'rgba(212, 175, 55, 0.84)',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 2.2,
    marginBottom: 8,
  },
  headerTitle: {
    color: THEME.textMain,
    fontSize: 31,
    fontWeight: '900',
    fontFamily: FONT_SERIF_DISPLAY,
    lineHeight: 36,
  },
  headerSub: {
    color: THEME.textSecondary,
    marginTop: 8,
    fontSize: 14,
    lineHeight: 20,
  },
  heroSeal: {
    width: 72,
    height: 72,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.2)',
    backgroundColor: 'rgba(212, 175, 55, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroSealTop: {
    color: THEME.textSecondary,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.6,
  },
  heroSealBottom: {
    color: THEME.gold,
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 1.2,
    marginTop: 2,
  },
  segmentWrap: {
    flexDirection: 'row',
    marginTop: 18,
    padding: 4,
    borderRadius: 20,
    backgroundColor: 'rgba(11, 25, 36, 0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  segmentButton: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 12,
    alignItems: 'center',
  },
  segmentButtonWrap: {
    flex: 1,
    borderRadius: 16,
  },
  segmentButtonActive: {
    backgroundColor: 'rgba(212, 175, 55, 0.14)',
  },
  segmentText: {
    color: THEME.textSecondary,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.1,
  },
  segmentTextActive: {
    color: THEME.textMain,
  },
  formCard: {
    backgroundColor: 'rgba(9, 18, 26, 0.88)',
    borderRadius: 28,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.12)',
    shadowColor: '#000',
    shadowOpacity: 0.34,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 14 },
    elevation: 5,
  },
  inputContainer: {
    marginBottom: 14,
  },
  inputLabel: {
    color: '#c4cccf',
    fontSize: 12,
    marginBottom: 8,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  inputWrapper: {
    backgroundColor: 'rgba(11, 20, 29, 0.94)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 16,
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 15,
  },
  textInput: {
    flex: 1,
    color: '#f7f9f8',
    fontSize: 14,
  },
  eyeButton: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
  strengthRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 2,
    marginBottom: 8,
  },
  strengthLabel: {
    color: THEME.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  strengthValue: {
    color: THEME.gold,
    fontSize: 12,
    fontWeight: '700',
  },
  strengthStrong: {
    color: THEME.success,
  },
  progressTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    overflow: 'hidden',
    marginBottom: 14,
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
  },
  requirementsContainer: {
    marginBottom: 6,
  },
  reqTitle: {
    color: THEME.textSecondary,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 12,
  },
  requirementRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
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
  requirementText: {
    color: THEME.textSecondary,
    fontSize: 14,
    fontWeight: '500',
  },
  requirementTextMet: {
    color: THEME.textMain,
  },
  loginForgotRow: {
    alignItems: 'flex-end',
    marginBottom: 18,
    marginTop: 4,
  },
  optionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 18,
    marginTop: 4,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    paddingRight: 12,
  },
  checkboxRowSignup: {
    alignItems: 'flex-start',
  },
  checkbox: {
    width: 18,
    height: 18,
    borderWidth: 1,
    borderColor: '#8f9d9f',
    borderRadius: 5,
    marginRight: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: 'rgba(212, 175, 55, 0.16)',
    borderColor: THEME.gold,
  },
  optionText: {
    color: THEME.textSecondary,
    fontSize: 13,
    flexShrink: 1,
    flex: 1,
    lineHeight: 18,
  },
  optionTextSignup: {
    fontSize: 12,
    lineHeight: 17,
  },
  linkText: {
    color: THEME.gold,
    fontWeight: '800',
    fontSize: 13,
    letterSpacing: 0.2,
  },
  termsLinkWrap: {
    paddingLeft: 10,
    alignSelf: 'flex-start',
  },
  primaryButton: {
    backgroundColor: THEME.gold,
    height: 52,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: THEME.gold,
    shadowOpacity: 0.36,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
    elevation: 5,
    overflow: 'hidden',
  },
  primaryButtonDisabled: {
    opacity: 0.75,
  },
  primaryButtonWrap: {
    borderRadius: 16,
  },
  buttonGlow: {
    position: 'absolute',
    left: 10,
    right: 10,
    top: 8,
    bottom: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.24)',
  },
  primaryButtonText: {
    color: '#091115',
    fontWeight: '900',
    fontSize: 15,
    letterSpacing: 1.3,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 18,
    flexWrap: 'wrap',
  },
  footerText: {
    color: THEME.textSecondary,
    fontSize: 13,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.82)',
    justifyContent: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: 'rgba(10, 19, 27, 0.98)',
    borderRadius: 22,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.16)',
  },
  modalTitle: {
    color: '#f6f8f8',
    fontSize: 22,
    fontWeight: '900',
    marginBottom: 14,
    fontFamily: FONT_SERIF_DISPLAY,
  },
  modalScroll: {
    maxHeight: 300,
    marginBottom: 20,
  },
  modalBody: {
    color: THEME.textSecondary,
    lineHeight: 20,
  },
  closeBtn: {
    backgroundColor: THEME.gold,
    height: 45,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeBtnText: {
    color: '#091115',
    fontWeight: '900',
    letterSpacing: 1,
  },
  verifyToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
    marginTop: 6,
    gap: 10,
  },
  verifyToggleLabel: {
    color: THEME.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    flexShrink: 0,
  },
  verifyToggleGroup: {
    flexDirection: 'row',
    flex: 1,
    gap: 8,
  },
  verifyToggleBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(212,175,55,0.2)',
    alignItems: 'center',
    backgroundColor: 'rgba(18,26,36,0.5)',
  },
  verifyToggleBtnActive: {
    borderColor: THEME.gold,
    backgroundColor: 'rgba(212,175,55,0.12)',
  },
  verifyToggleBtnText: {
    color: THEME.textSecondary,
    fontWeight: '700',
    fontSize: 13,
  },
  verifyToggleBtnTextActive: {
    color: THEME.gold,
  },
});

export default AuthScreen;
