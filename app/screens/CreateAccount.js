import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
} from 'react-native';
import {useUserProfile} from '../context/UserProfileContext';
import {signUpWithEmail} from '../services/authService';
import {IS_IOS} from '../constants/platformUi';

const navy = '#0F1E36';
const blueGray = '#7B8BA3';
const lightGray = '#F3F4F6';

export default function CreateAccount({ navigation }) {
  const {updateProfile} = useUserProfile();
  const [contactNumber, setContactNumber] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const validateAndSubmit = async () => {
    if (!fullName) return Alert.alert('Error', 'Full name is required');
    if (!email) return Alert.alert('Error', 'Email is required');
    if (!email.includes('@') || !email.includes('.'))
      return Alert.alert('Error', 'Enter valid email');
    if (!password) return Alert.alert('Error', 'Password is required');
    if (password.length < 6)
      return Alert.alert('Error', 'Minimum 6 characters');
    if (!confirmPassword)
      return Alert.alert('Error', 'Confirm your password');
    if (password !== confirmPassword)
      return Alert.alert('Error', 'Passwords do not match');

    if (!contactNumber) return Alert.alert('Error', 'Contact number is required');
    if (!/^\d+$/.test(contactNumber)) return Alert.alert('Error', 'Contact number must contain only numbers');
    if (contactNumber.length < 10 || contactNumber.length > 13) return Alert.alert('Error', 'Contact number must be 10-13 digits');
    if (!contactNumber.startsWith('0') && !contactNumber.startsWith('9')) return Alert.alert('Error', 'Contact number must start with 0 or 9 (e.g. 09171234567)');

    const role = 'Client';

    try {
      setIsSubmitting(true);

      const signUpResult = await signUpWithEmail({
        email: email.trim(),
        password,
        fullName: fullName.trim(),
        role,
        phone: contactNumber.trim(),
      });

      updateProfile({
        name: fullName.trim(),
        email: email.trim(),
        phone: contactNumber.trim(),
        role,
      });

      navigation.navigate('VerifyAccount', {
        phoneE164: signUpResult.phoneE164,
        email: email.trim(),
        role,
        isNewSignup: true,
        profilePayload: {
          fullName: fullName.trim(),
          email: email.trim(),
          role,
        },
      });
    } catch (error) {
      Alert.alert('Sign Up Failed', error?.message ?? 'Unable to create account.');
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
        contentContainerStyle={styles.scrollContent}>
        {/* Back Button */}
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.canGoBack() ? navigation.goBack() : null}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>

        <View style={styles.formContainer}>
        <Text style={styles.title}>Create Profile</Text>
        <Text style={styles.subtitle}>Join the LegalLink legal network.</Text>


        {/* Full Name */}
        <Text style={styles.label}>Full Name</Text>
        <TextInput
          style={styles.input}
          placeholder="Dr. Sarah Johnson"
          placeholderTextColor="#94A3B8"
          value={fullName}
          onChangeText={setFullName}
          maxLength={100}
        />

        {/* Contact Number */}
        <Text style={styles.label}>Contact Number</Text>
        <TextInput
          style={styles.input}
          placeholder="09171234567"
          placeholderTextColor="#94A3B8"
          keyboardType="phone-pad"
          value={contactNumber}
          onChangeText={setContactNumber}
          maxLength={11}
        />

        {/* Email */}
        <Text style={styles.label}>Email Address</Text>
        <TextInput
          style={[styles.input, {color: '#0F172A'}]}
          placeholder="sarah.johnson@legal.com"
          placeholderTextColor="#94A3B8"
          keyboardType="email-address"
          autoCapitalize="none"
          value={email}
          onChangeText={setEmail}
          maxLength={150}
        />

        {/* Password */}
        <Text style={styles.label}>Password</Text>
        <View style={styles.passwordInputContainer}>
          <TextInput
            style={styles.passwordInput}
            placeholder="••••••••"
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
            maxLength={64}
          />
          <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
            <Text style={styles.passwordToggleText}>
              {showPassword ? 'Hide' : 'Show'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Confirm Password */}
        <Text style={styles.label}>Confirm Password</Text>
        <View style={styles.passwordInputContainer}>
          <TextInput
            style={styles.passwordInput}
            placeholder="••••••••"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry={!showConfirmPassword}
            maxLength={64}
          />
          <TouchableOpacity onPress={() => setShowConfirmPassword(!showConfirmPassword)}>
            <Text style={styles.passwordToggleText}>
              {showConfirmPassword ? 'Hide' : 'Show'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Submit Button */}
        <TouchableOpacity
          style={[styles.submitButton, isSubmitting && styles.submitButtonDisabled]}
          onPress={validateAndSubmit}
          disabled={isSubmitting}
        >
          <Text style={styles.submitText}>
            {isSubmitting ? 'Creating Account...' : 'Create Account'}
          </Text>
        </TouchableOpacity>

        {/* Login Text */}
        <Text style={styles.loginText}>
          Already have an account?{' '}
          <Text
            style={styles.loginLink}
            onPress={() => navigation.navigate('Login')}>
            Log In
          </Text>
        </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#F8F9FB',
    flex: 1,
  },
  scrollContent: {
    paddingVertical: 30,
    paddingHorizontal: 20,
    flexGrow: 1,
    justifyContent: 'center',
  },
  backButton: {
    alignSelf: 'flex-start',
    marginBottom: 14,
    paddingVertical: 6,
  },
  backButtonText: {
    color: '#EAB308',
    fontSize: 16,
    fontWeight: '600',
  },
  formContainer: {
    backgroundColor: '#fff',
    borderRadius: 22,
    padding: 24,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 3,
  },
  title: {
    fontSize: 30,
    fontWeight: '700',
    color: navy,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: blueGray,
    marginBottom: 24,
  },
  toggleContainer: {
    flexDirection: 'row',
    backgroundColor: lightGray,
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
    fontWeight: '600',
    color: blueGray,
  },
  activeToggle: {
    backgroundColor: '#fff',
    borderRadius: 10,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: {width: 0, height: 2},
    elevation: 2,
  },
  activeText: {
    color: navy,
  },
  label: {
    fontWeight: '600',
    color: navy,
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#F8F9FB',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 18,
  },
  passwordInputContainer: {
    backgroundColor: '#F8F9FB',
    borderRadius: 14,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 18,
    flexDirection: 'row',
    alignItems: 'center',
  },
  passwordInput: {
    flex: 1,
    paddingVertical: 14,
  },
  passwordToggleText: {
    color: '#EAB308',
    fontWeight: '700',
  },
  submitButton: {
    backgroundColor: navy,
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    marginBottom: 16,
  },
  submitButtonDisabled: {
    opacity: 0.7,
  },
  submitText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#fff',
  },
  loginText: {
    textAlign: 'center',
    fontSize: 14,
    color: blueGray,
  },
  loginLink: {
    color: '#D4AF37',
    fontWeight: '600',
  },
});
