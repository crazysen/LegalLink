import React, {useState, useEffect, useRef, useCallback} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
  InteractionManager,
} from 'react-native';
import {useUserProfile} from '../context/UserProfileContext';
import {signInWithEmail, checkEmailLockout} from '../services/authService';
import {getMyProfile} from '../services/profileService';
import {IS_IOS} from '../constants/platformUi';

const colors = {
  navy: '#0F1E36',
  blueGray: '#64748B',
  lightGray: '#F1F5F9',
  border: '#E2E8F0',
  gold: '#EAB308',
  white: '#FFFFFF',
  bg: '#F8FAFC',
  text: '#0F172A',
};

export default function Login({navigation}) {
  const {updateProfile} = useUserProfile();
  const [isClient, setIsClient] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [focusedField, setFocusedField] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lockoutSeconds, setLockoutSeconds] = useState(0);
  const [lockedEmail, setLockedEmail] = useState(null);
  const passwordInputRef = useRef(null);
  /** RN often fires onChangeText('') when toggling secureTextEntry — ignore briefly after Show/Hide. */
  const lastPasswordVisibilityToggleAt = useRef(0);
  const passwordForSignInRef = useRef('');

  const toggleShowPassword = useCallback(() => {
    if (lockoutSeconds !== 0) {
      return;
    }
    lastPasswordVisibilityToggleAt.current = Date.now();
    passwordInputRef.current?.blur();
    InteractionManager.runAfterInteractions(() => {
      setShowPassword((v) => !v);
    });
  }, [lockoutSeconds]);

  const onPasswordChange = useCallback((text) => {
    const prev = passwordForSignInRef.current;
    if (
      text === '' &&
      prev.length > 0 &&
      Date.now() - lastPasswordVisibilityToggleAt.current < 450
    ) {
      return;
    }
    passwordForSignInRef.current = text;
    setPassword(text);
  }, []);

  useEffect(() => {
    let interval = null;
    if (lockoutSeconds > 0) {
      interval = setInterval(() => {
        setLockoutSeconds(prev => prev - 1);
      }, 1000);
    } else if (interval) {
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [lockoutSeconds]);

  const formatLockoutTime = (totalSeconds) => {
    const min = Math.floor(totalSeconds / 60);
    const sec = totalSeconds % 60;
    return `${min}:${sec < 10 ? '0' : ''}${sec}`;
  };

  const handleEmailBlur = async () => {
    setFocusedField(null);
    if (!email.trim() || !email.includes('@')) return;
    try {
      const timeRemaining = await checkEmailLockout(email.trim());
      if (timeRemaining > 0) {
        setLockoutSeconds(Math.ceil(timeRemaining));
        setLockedEmail(email.trim().toLowerCase());
      } else if (email.trim().toLowerCase() === lockedEmail) {
        setLockoutSeconds(0);
        setLockedEmail(null);
      }
    } catch (e) {
      // Background check failed, ignore
    }
  };

  const handleEmailChange = (text) => {
    setEmail(text);
    if (lockoutSeconds > 0 && text.trim().toLowerCase() !== lockedEmail) {
      setLockoutSeconds(0);
    } else if (text.trim().toLowerCase() === lockedEmail && lockoutSeconds === 0) {
      // Recalculate if they switch back to the locked email
      handleEmailBlur();
    }
  };

  const handleLogin = async () => {
    if (!email) return Alert.alert('Error', 'Email is required');
    if (!email.includes('@') || !email.includes('.')) {
      return Alert.alert('Error', 'Enter valid email');
    }
    const passwordToUse = passwordForSignInRef.current || password;
    if (!passwordToUse) return Alert.alert('Error', 'Password is required');

    try {
      setIsSubmitting(true);

      const data = await signInWithEmail({
        email: email.trim(),
        password: passwordToUse,
      });

      const user = data?.user;

      const roleFromApi = user?.role;
      const fullNameFromApi = user?.name;
      const normalizedRole =
        String(roleFromApi || '').toLowerCase() === 'attorney'
          ? 'Attorney'
          : String(roleFromApi || '').toLowerCase() === 'client'
            ? 'Client'
          : isClient
            ? 'Client'
            : 'Attorney';

      if (data?.needsPhoneVerification) {
        if (!data.phoneE164ForVerification) {
          Alert.alert(
            'Phone verification',
            'Your account needs a mobile number on file for SMS verification. Please update your profile or contact support.',
          );
          return;
        }
        updateProfile({
          email: user?.email ?? email.trim(),
          name: fullNameFromApi ?? 'BatasMo User',
          phone: user?.phone ?? '',
          address: user?.address ?? '',
          role: normalizedRole,
        });
        navigation.navigate('VerifyAccount', {
          phoneE164: data.phoneE164ForVerification,
          email: email.trim(),
          role: normalizedRole,
          isNewSignup: false,
          profilePayload: null,
        });
        return;
      }

      updateProfile({
        email: user?.email ?? email.trim(),
        name: fullNameFromApi ?? 'BatasMo User',
        phone: user?.phone ?? '',
        address: user?.address ?? '',
        role: normalizedRole,
      });

      if (normalizedRole === 'Client') {
        navigation.navigate('HomepageClient');
      } else {
        navigation.navigate('AttyLandingPage');
      }
    } catch (error) {
      const message = error?.message ?? 'Unable to sign in.';
      const normalized = message.toLowerCase();

      if (
        normalized.includes('email not confirmed') ||
        normalized.includes('email not verified')
      ) {
        Alert.alert(
          'Confirm your email',
          'Open the confirmation link in the email we sent when you registered, then sign in again. If you already confirmed, wait a moment and retry. Check spam or promotions folders.',
        );
        return;
      }

      if (error?.message?.startsWith('LOCKOUT:')) {
        const timeRemaining = parseInt(error.message.split(':')[1], 10);
        setLockoutSeconds(timeRemaining);
        setLockedEmail(email.trim().toLowerCase());
        const mins = Math.max(1, Math.ceil(timeRemaining / 60));
        Alert.alert(
          'Too many attempts',
          `Try again in about ${mins} minute${mins === 1 ? '' : 's'}. An admin can clear failed logins in Supabase. For local testing only, add EXPO_PUBLIC_SKIP_LOGIN_LOCKOUT=1 to .env and restart Expo.`,
        );
        return;
      }

      if (normalized.includes('account locked')) {
        setLockoutSeconds(15 * 60);
        setLockedEmail(email.trim().toLowerCase());
        Alert.alert('Login Failed', error?.message ?? 'Account locked due to 3 consecutive failed login attempts.');
        return;
      }

      Alert.alert('Login Failed', error?.message ?? 'Unable to sign in.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={IS_IOS ? 'padding' : undefined}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.scrollContent}>
        <View style={styles.heroSection}>
          <View style={styles.heroBadge}>
            <Text style={styles.heroBadgeText}>BATASMO SECURE PORTAL</Text>
          </View>
          <Text style={styles.title}>Welcome Back</Text>
          <Text style={styles.subtitle}>Access your secure legal portal.</Text>
        </View>

        <View style={styles.formContainer}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => {
              if (navigation.canGoBack()) {
                navigation.goBack();
              } else {
                navigation.navigate('Landing');
              }
            }}>
            <Text style={styles.backButtonText}>← Back</Text>
          </TouchableOpacity>

          <View style={styles.toggleContainer}>
            <TouchableOpacity
              style={[styles.toggleOption, isClient && styles.activeToggle]}
              onPress={() => setIsClient(true)}>
              <Text style={[styles.toggleText, isClient && styles.activeText]}>Client</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toggleOption, !isClient && styles.activeToggle]}
              onPress={() => setIsClient(false)}>
              <Text style={[styles.toggleText, !isClient && styles.activeText]}>Attorney</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.label}>Email Address</Text>
          <View
            style={[
              styles.inputContainer,
              focusedField === 'email' && styles.inputContainerFocused,
            ]}>
            <Text style={styles.inputIcon}>✉️</Text>
            <TextInput
              style={styles.input}
              placeholder="name@domain.com"
              placeholderTextColor="#94A3B8"
              value={email}
              onChangeText={handleEmailChange}
              maxLength={150}
              keyboardType="email-address"
              autoCapitalize="none"
              onFocus={() => setFocusedField('email')}
              onBlur={handleEmailBlur}
              editable={lockoutSeconds === 0}
              selectTextOnFocus={lockoutSeconds === 0}
            />
          </View>

          <Text style={styles.label}>Secure Password</Text>
          <View
            style={[
              styles.inputContainer,
              focusedField === 'password' && styles.inputContainerFocused,
            ]}>
            <Text style={styles.inputIcon}>🔒</Text>
            <TextInput
              ref={passwordInputRef}
              style={styles.input}
              placeholder="••••••••"
              placeholderTextColor="#94A3B8"
              value={password}
              onChangeText={onPasswordChange}
              maxLength={64}
              keyboardType={
                Platform.OS === 'android'
                  ? showPassword
                    ? 'visible-password'
                    : 'default'
                  : 'default'
              }
              secureTextEntry={!showPassword}
              onFocus={() => setFocusedField('password')}
              onBlur={() => setFocusedField(null)}
              editable={lockoutSeconds === 0}
              selectTextOnFocus={lockoutSeconds === 0}
              autoCorrect={false}
              spellCheck={false}
              autoCapitalize="none"
              autoComplete={
                Platform.OS === 'android' ? (showPassword ? 'off' : 'password') : 'password'
              }
              textContentType={
                Platform.OS === 'ios' ? (showPassword ? 'none' : 'password') : undefined
              }
              importantForAutofill="no"
            />
            <TouchableOpacity onPress={toggleShowPassword}>
              <Text style={styles.passwordToggleText}>
                {showPassword ? 'Hide' : 'Show'}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.forgotPasswordRow}>
            <TouchableOpacity
              onPress={() =>
                navigation.navigate('VerifyIdentity', {email: email.trim()})
              }>
              <Text style={styles.forgotPasswordText}>Forgot Password?</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.loginButton, (isSubmitting || lockoutSeconds > 0) && styles.loginButtonDisabled]}
            onPress={handleLogin}
            disabled={isSubmitting || lockoutSeconds > 0}>
            <Text style={styles.loginButtonText}>
              {lockoutSeconds > 0 
                ? `Locked (${formatLockoutTime(lockoutSeconds)})` 
                : isSubmitting ? 'Logging In...' : 'Log In'}
            </Text>
          </TouchableOpacity>

          <Text style={styles.signUpText}>
            Don't have an account?{' '}
            <Text
              style={styles.signUpLink}
              onPress={() => navigation.navigate('CreateProfile')}>
              Sign Up
            </Text>
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.bg,
    flex: 1,
  },
  scrollContent: {
    paddingVertical: 28,
    paddingHorizontal: 20,
    flexGrow: 1,
  },
  heroSection: {
    marginBottom: 18,
  },
  heroBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#FEF3C7',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  heroBadgeText: {
    color: '#92400E',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  formContainer: {
    backgroundColor: colors.white,
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOpacity: 0.08,
    shadowRadius: 24,
    shadowOffset: {width: 0, height: 12},
    elevation: 5,
  },
  backButton: {
    alignSelf: 'flex-start',
    marginBottom: 18,
    paddingVertical: 4,
  },
  backButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.gold,
    letterSpacing: 0.2,
  },
  title: {
    fontSize: 34,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 15,
    color: colors.blueGray,
    marginBottom: 8,
  },
  toggleContainer: {
    flexDirection: 'row',
    backgroundColor: colors.lightGray,
    borderRadius: 14,
    marginBottom: 24,
    padding: 4,
  },
  toggleOption: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 10,
  },
  toggleText: {
    fontWeight: '700',
    fontSize: 13,
    color: colors.blueGray,
    letterSpacing: 0.6,
  },
  activeToggle: {
    backgroundColor: colors.white,
    shadowColor: '#000',
    shadowOpacity: 0.07,
    shadowRadius: 8,
    shadowOffset: {width: 0, height: 2},
    elevation: 2,
  },
  activeText: {
    color: colors.navy,
  },
  label: {
    fontWeight: '700',
    fontSize: 13,
    color: colors.text,
    marginBottom: 8,
    marginTop: 2,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 16,
  },
  inputContainerFocused: {
    borderColor: '#94A3B8',
    backgroundColor: '#FFFFFF',
  },
  inputIcon: {
    marginRight: 8,
    fontSize: 14,
  },
  input: {
    flex: 1,
    paddingVertical: 14,
    fontSize: 15,
    color: colors.text,
  },
  passwordToggleText: {
    color: colors.gold,
    fontSize: 13,
    fontWeight: '700',
    marginLeft: 10,
  },
  forgotPasswordRow: {
    alignItems: 'flex-end',
    marginBottom: 20,
    marginTop: 2,
  },
  forgotPasswordText: {
    fontSize: 13,
    color: colors.gold,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  loginButton: {
    backgroundColor: colors.navy,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    marginBottom: 16,
    shadowColor: colors.navy,
    shadowOpacity: 0.28,
    shadowRadius: 10,
    shadowOffset: {width: 0, height: 4},
    elevation: 4,
  },
  loginButtonDisabled: {
    opacity: 0.7,
  },
  loginButtonText: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.white,
    letterSpacing: 0.6,
  },
  signUpText: {
    textAlign: 'center',
    fontSize: 14,
    color: colors.blueGray,
    marginBottom: 2,
  },
  signUpLink: {
    color: colors.gold,
    fontWeight: '800',
  },
});
