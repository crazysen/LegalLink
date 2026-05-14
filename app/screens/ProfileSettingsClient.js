import React, {useEffect, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {useUserProfile} from '../context/UserProfileContext';
import {REFERENCE_THEME as T} from '../constants/referenceTheme';
import {ClientScreenShell, ClientFadeIn} from '../components/ClientScreenShell';
import ClientChevronBack from '../components/ClientChevronBack';
import {getMyProfile, updateMyProfile} from '../services/profileService';

const ProfileSettingsClient = ({navigation}) => {
  const {profile, updateProfile} = useUserProfile();
  const [name, setName] = useState(profile.name);
  const [email, setEmail] = useState(profile.email);
  const [phone, setPhone] = useState(profile.phone);
  const [address, setAddress] = useState(profile.address);
  const [age, setAge] = useState(profile.age?.toString() || '');
  const [guardianName, setGuardianName] = useState(profile.guardian_name || '');
  const [guardianContact, setGuardianContact] = useState(profile.guardian_contact || '');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const loadProfile = async () => {
      try {
        setLoading(true);
        const data = await getMyProfile();
        const resolvedName = data?.full_name ?? profile.name;
        const resolvedEmail = data?.email ?? profile.email;
        const resolvedPhone = data?.phone ?? profile.phone;
        const resolvedAddress = data?.address ?? profile.address;
        const resolvedAge = data?.age ?? profile.age ?? '';
        const resolvedGuardianName = data?.guardian_name ?? profile.guardian_name ?? '';
        const resolvedGuardianContact = data?.guardian_contact ?? profile.guardian_contact ?? '';

        setName(resolvedName || '');
        setEmail(resolvedEmail || '');
        setPhone(resolvedPhone || '');
        setAddress(resolvedAddress || '');
        setAge(resolvedAge !== null && resolvedAge !== undefined ? String(resolvedAge) : '');
        setGuardianName(resolvedGuardianName || '');
        setGuardianContact(resolvedGuardianContact || '');

        updateProfile({
          name: resolvedName || '',
          email: resolvedEmail || '',
          phone: resolvedPhone || '',
          address: resolvedAddress || '',
          age: resolvedAge,
          guardian_name: resolvedGuardianName,
          guardian_contact: resolvedGuardianContact,
          role: (data?.role || profile.role || 'client').toLowerCase() === 'attorney' ? 'Attorney' : 'Client',
        });
      } catch (error) {
        Alert.alert('Error', error?.message ?? 'Failed to load profile.');
      } finally {
        setLoading(false);
      }
    };

    loadProfile();
  }, []);

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('Error', 'Full name is required.');
      return;
    }

    if (!phone.trim()) {
      Alert.alert('Error', 'Contact number is required.');
      return;
    }

    if (!address.trim()) {
      Alert.alert('Error', 'Address is required.');
      return;
    }

    try {
      setSaving(true);
      const updated = await updateMyProfile({
        full_name: name.trim(),
        phone: phone.trim(),
        address: address.trim(),
        age: age ? parseInt(age, 10) : null,
        guardian_name: guardianName.trim(),
        guardian_contact: guardianContact.trim(),
        role: 'client',
      });

      updateProfile({
        name: updated?.full_name ?? name.trim(),
        email: updated?.email ?? email.trim(),
        phone: updated?.phone ?? phone.trim(),
        address: updated?.address ?? address.trim(),
        role: 'Client',
      });

      Alert.alert('Saved', 'Profile settings updated.');
    } catch (error) {
      Alert.alert('Error', error?.message ?? 'Unable to save profile settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setName(profile.name);
    setEmail(profile.email);
    setPhone(profile.phone);
    setAddress(profile.address);
    navigation.canGoBack() ? navigation.goBack() : null;
  };

  const initials = name
    .trim()
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join('') || 'AJ';

  return (
    <ClientScreenShell>
      <View style={styles.header}>
        <View style={styles.headerBar}>
          <View style={styles.headerSide}>
            <ClientChevronBack onPress={() => (navigation.canGoBack() ? navigation.goBack() : null)} />
          </View>
          <Text style={styles.headerTitleCenter} numberOfLines={1}>
            Profile Settings
          </Text>
          <View style={styles.headerSide} />
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ClientFadeIn>
        {loading ? (
          <View style={styles.loadingCard}>
            <ActivityIndicator color={T.gold[1]} />
            <Text style={styles.loadingText}>Loading profile...</Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <Text style={styles.name}>{name}</Text>
          <Text style={styles.email}>{email}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Personal Information</Text>

          <Text style={styles.label}>Full Name</Text>
          <TextInput
            style={styles.input}
            placeholderTextColor={T.textSoft}
            value={name}
            onChangeText={setName}
            placeholder="Full name"
          />

          <Text style={styles.label}>Email Address</Text>
          <TextInput
            style={[styles.input, styles.disabledInput]}
            placeholderTextColor={T.textSoft}
            value={email}
            editable={false}
            keyboardType="email-address"
            autoCapitalize="none"
            placeholder="name@domain.com"
          />

          <Text style={styles.label}>Contact Number</Text>
          <TextInput
            style={styles.input}
            placeholderTextColor={T.textSoft}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            placeholder="09xxxxxxxxx"
          />

          <Text style={styles.label}>Age</Text>
          <TextInput
            style={styles.input}
            placeholderTextColor={T.textSoft}
            value={age}
            onChangeText={setAge}
            keyboardType="number-pad"
            placeholder="e.g. 25"
          />

          {age && parseInt(age, 10) < 18 && (
            <>
              <Text style={styles.label}>Guardian Full Name</Text>
              <TextInput
                style={styles.input}
                placeholderTextColor={T.textSoft}
                value={guardianName}
                onChangeText={setGuardianName}
                placeholder="Parent/Guardian Name"
              />
              <Text style={styles.label}>Guardian Contact Number</Text>
              <TextInput
                style={styles.input}
                placeholderTextColor={T.textSoft}
                value={guardianContact}
                onChangeText={setGuardianContact}
                placeholder="09171234567"
                keyboardType="phone-pad"
              />
            </>
          )}

          <Text style={styles.label}>Address</Text>
          <TextInput
            style={[styles.input, styles.multilineInput]}
            placeholderTextColor={T.textSoft}
            value={address}
            onChangeText={setAddress}
            placeholder="Street, City"
            multiline
          />

          <View style={styles.buttonRow}>
            <TouchableOpacity style={styles.saveButton} onPress={handleSave} disabled={saving || loading}>
              <Text style={styles.saveButtonText}>{saving ? 'Saving...' : 'Save Changes'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelButton} onPress={handleCancel}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
        </ClientFadeIn>
      </ScrollView>
    </ClientScreenShell>
  );
};

export default ProfileSettingsClient;

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 14,
    backgroundColor: 'rgba(18, 26, 36, 0.75)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(244, 215, 139, 0.12)',
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
  },
  headerSide: {
    width: 40,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  headerTitleCenter: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: T.text,
    textAlign: 'center',
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  loadingCard: {
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.12)',
    borderRadius: 10,
    marginBottom: 12,
    backgroundColor: 'rgba(18, 26, 36, 0.62)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  loadingText: {fontSize: 13, color: T.textSoft},
  card: {
    backgroundColor: 'rgba(18, 26, 36, 0.88)',
    borderRadius: 18,
    padding: 20,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.12)',
  },
  avatar: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignSelf: 'center',
    backgroundColor: 'rgba(4, 7, 11, 0.8)',
    borderWidth: 2,
    borderColor: 'rgba(244, 215, 139, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  avatarText: {
    color: T.gold[0],
    fontSize: 30,
    fontWeight: '700',
  },
  name: {
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '700',
    color: T.text,
  },
  email: {
    textAlign: 'center',
    fontSize: 14,
    color: T.textSoft,
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: T.gold[0],
    marginBottom: 14,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: T.textSoft,
    marginBottom: 6,
  },
  input: {
    backgroundColor: 'rgba(4, 7, 11, 0.45)',
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.15)',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14,
    color: T.text,
  },
  disabledInput: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    color: T.textSoft,
  },
  multilineInput: {
    minHeight: 82,
    textAlignVertical: 'top',
  },
  saveButton: {
    flex: 1,
    backgroundColor: T.gold[1],
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
  },
  saveButtonText: {
    color: T.base,
    fontSize: 16,
    fontWeight: '700',
  },
  buttonRow: {
    marginTop: 4,
    flexDirection: 'row',
    gap: 10,
  },
  cancelButton: {
    width: 110,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButtonText: {
    color: T.text,
    fontSize: 15,
    fontWeight: '600',
  },
});
