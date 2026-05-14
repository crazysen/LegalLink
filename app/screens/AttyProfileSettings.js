import React, {useEffect, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import {ClientScreenShell} from '../components/ClientScreenShell';
import {useUserProfile} from '../context/UserProfileContext';
import {getMyProfile, updateMyProfile} from '../services/profileService';
import {REFERENCE_THEME as T} from '../constants/referenceTheme';

const accentGold = T.gold[1];

export default function AttyProfileSettings({navigation}) {
  const {updateProfile} = useUserProfile();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [firmName, setFirmName] = useState('');
  const [yearsExperience, setYearsExperience] = useState('');
  const [specialties, setSpecialties] = useState('');
  const [bio, setBio] = useState('');
  const [consultationFee, setConsultationFee] = useState('');

  const [profileImage, setProfileImage] = useState(null);
  const [currentAvatarUrl, setCurrentAvatarUrl] = useState('');
  const [credentialDoc, setCredentialDoc] = useState(null);
  const [existingCredentialUrl, setExistingCredentialUrl] = useState(null);

  useEffect(() => {
    const loadProfile = async () => {
      try {
        setLoading(true);
        const data = await getMyProfile();
        const attorney = data?.attorney_profile || {};

        setFullName(data?.full_name || '');
        setEmail(data?.email || '');
        setPhone(data?.phone || '');
        setAddress(data?.address || '');
        setFirmName(attorney?.firm_name || '');
        setYearsExperience(
          attorney?.years_experience !== null && attorney?.years_experience !== undefined
            ? String(attorney.years_experience)
            : '',
        );
        setSpecialties(attorney?.specialties || '');
        setBio(attorney?.bio || '');
        setConsultationFee(
          attorney?.consultation_fee !== null && attorney?.consultation_fee !== undefined
            ? String(attorney.consultation_fee)
            : '',
        );
        setCurrentAvatarUrl(data?.avatar_url || '');
        setExistingCredentialUrl(data?.credential_document_url || null);

        updateProfile({
          name: data?.full_name || '',
          email: data?.email || '',
          phone: data?.phone || '',
          address: data?.address || '',
          role: 'Attorney',
        });
      } catch (error) {
        Alert.alert('Error', error?.message ?? 'Failed to load attorney profile.');
      } finally {
        setLoading(false);
      }
    };

    loadProfile();
  }, [updateProfile]);

  const pickProfileImage = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['image/*'],
        copyToCacheDirectory: true,
      });
      if (!result.canceled) {
        setProfileImage(result.assets?.[0] ?? null);
      }
    } catch (error) {
      Alert.alert('Error', error?.message ?? 'Unable to pick image.');
    }
  };

  const pickCredentialDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/*'],
        copyToCacheDirectory: true,
      });
      if (!result.canceled) {
        setCredentialDoc(result.assets?.[0] ?? null);
      }
    } catch (error) {
      Alert.alert('Error', error?.message ?? 'Unable to pick credential document.');
    }
  };

  const handleSave = async () => {
    if (!fullName.trim()) {
      Alert.alert('Error', 'Full name is required.');
      return;
    }

    try {
      setSaving(true);

      let avatarBase64 = null;
      if (profileImage?.uri) {
        avatarBase64 = await FileSystem.readAsStringAsync(profileImage.uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
      }

      let credentialBase64 = null;
      if (credentialDoc?.uri) {
        credentialBase64 = await FileSystem.readAsStringAsync(credentialDoc.uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
      }

      const updated = await updateMyProfile({
        full_name: fullName.trim(),
        phone: phone.trim() || null,
        address: address.trim() || null,
        role: 'attorney',
        firm_name: firmName.trim() || null,
        years_experience: yearsExperience ? Number(yearsExperience) : null,
        specialties: specialties.trim() || null,
        bio: bio.trim() || null,
        consultation_fee: consultationFee ? Number(consultationFee) : null,
        avatar_base64: avatarBase64,
        avatar_name: profileImage?.name || null,
        credential_document_base64: credentialBase64,
        credential_document_name: credentialDoc?.name || null,
      });

      setCurrentAvatarUrl(updated?.avatar_url || currentAvatarUrl);
      setExistingCredentialUrl(updated?.credential_document_url || existingCredentialUrl);

      updateProfile({
        name: updated?.full_name || fullName.trim(),
        email: updated?.email || email.trim(),
        phone: updated?.phone || phone.trim(),
        address: updated?.address || address.trim(),
        role: 'Attorney',
      });

      Alert.alert('Saved', 'Attorney profile updated successfully.');
    } catch (error) {
      Alert.alert('Error', error?.message ?? 'Unable to save attorney profile.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ClientScreenShell edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.canGoBack() ? navigation.goBack() : null}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Attorney Profile Settings</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {loading ? (
          <View style={styles.loadingCard}>
            <ActivityIndicator color={accentGold} />
            <Text style={styles.loadingText}>Loading profile...</Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Identity</Text>

          <Text style={styles.label}>Full Name</Text>
          <TextInput style={styles.input} value={fullName} onChangeText={setFullName} />

          <Text style={styles.label}>Email</Text>
          <TextInput
            style={[styles.input, styles.disabledInput]}
            value={email}
            editable={false}
            autoCapitalize="none"
            keyboardType="email-address"
          />

          <Text style={styles.label}>Phone</Text>
          <TextInput style={styles.input} value={phone} onChangeText={setPhone} />

          <Text style={styles.label}>Office Address</Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            value={address}
            onChangeText={setAddress}
            multiline
          />

          <View style={styles.avatarPreviewBox}>
            {profileImage?.uri || currentAvatarUrl ? (
              <Image
                source={{uri: profileImage?.uri || currentAvatarUrl}}
                style={styles.avatarPreview}
              />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarPlaceholderText}>No image</Text>
              </View>
            )}
            <Text style={styles.hintText}>
              {profileImage?.name
                ? `Selected: ${profileImage.name}`
                : currentAvatarUrl
                  ? 'Current profile image'
                  : 'Upload an attorney profile image'}
            </Text>
          </View>

          <TouchableOpacity style={styles.uploadButton} onPress={pickProfileImage}>
            <Text style={styles.uploadButtonText}>
              {profileImage?.name ? `Image: ${profileImage.name}` : 'Upload Profile Image'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Professional Details</Text>

          <Text style={styles.label}>Law Firm</Text>
          <TextInput style={styles.input} value={firmName} onChangeText={setFirmName} />

          <Text style={styles.label}>Years of Experience</Text>
          <TextInput
            style={styles.input}
            value={yearsExperience}
            onChangeText={setYearsExperience}
            keyboardType="numeric"
          />

          <Text style={styles.label}>Specialties</Text>
          <TextInput
            style={styles.input}
            value={specialties}
            onChangeText={setSpecialties}
            placeholder="Civil Law, Family Law"
          />

          <Text style={styles.label}>Consultation Fee</Text>
          <TextInput
            style={styles.input}
            value={consultationFee}
            onChangeText={setConsultationFee}
            keyboardType="decimal-pad"
            placeholder="2500"
          />

          <Text style={styles.label}>Bio</Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            value={bio}
            onChangeText={setBio}
            multiline
          />

          <TouchableOpacity style={styles.uploadButton} onPress={pickCredentialDocument}>
            <Text style={styles.uploadButtonText}>
              {credentialDoc?.name
                ? `Credential: ${credentialDoc.name}`
                : existingCredentialUrl
                  ? 'Replace Credential Document'
                  : 'Upload Credential Document'}
            </Text>
          </TouchableOpacity>

          {existingCredentialUrl ? (
            <Text style={styles.hintText}>Saved credential: {existingCredentialUrl}</Text>
          ) : null}
        </View>

        <TouchableOpacity
          style={[styles.saveButton, (saving || loading) && styles.disabledButton]}
          onPress={handleSave}
          disabled={saving || loading}>
          <Text style={styles.saveButtonText}>{saving ? 'Saving...' : 'Save Changes'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </ClientScreenShell>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(244, 215, 139, 0.1)',
  },
  backText: {color: accentGold, fontWeight: '800', fontSize: 16, marginBottom: 6},
  title: {fontSize: 24, fontWeight: '900', color: T.text},
  content: {padding: 20, paddingBottom: 32},
  loadingCard: {
    backgroundColor: 'rgba(12, 19, 30, 0.85)',
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.12)',
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  loadingText: {fontSize: 13, color: T.textMuted, marginLeft: 8},
  card: {
    backgroundColor: 'rgba(12, 19, 30, 0.92)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.12)',
  },
  sectionTitle: {fontSize: 18, fontWeight: '800', color: T.text, marginBottom: 10},
  label: {fontSize: 13, fontWeight: '600', color: T.textMuted, marginBottom: 6, marginTop: 10},
  input: {
    backgroundColor: 'rgba(4, 7, 11, 0.45)',
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.15)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: T.text,
  },
  disabledInput: {
    backgroundColor: 'rgba(18, 26, 36, 0.6)',
    color: T.textSoft,
  },
  multiline: {minHeight: 84, textAlignVertical: 'top'},
  uploadButton: {
    marginTop: 14,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.25)',
    borderStyle: 'dashed',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: 'center',
    backgroundColor: 'rgba(4, 7, 11, 0.35)',
  },
  uploadButtonText: {fontWeight: '800', color: accentGold, fontSize: 13},
  hintText: {fontSize: 12, color: T.textMuted, marginTop: 8},
  avatarPreviewBox: {
    marginTop: 12,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.12)',
    backgroundColor: 'rgba(4, 7, 11, 0.35)',
  },
  avatarPreview: {
    width: 92,
    height: 92,
    borderRadius: 46,
    borderWidth: 2,
    borderColor: 'rgba(244, 215, 139, 0.3)',
  },
  avatarPlaceholder: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: 'rgba(18, 26, 36, 0.8)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarPlaceholderText: {
    color: T.textSoft,
    fontSize: 11,
    fontWeight: '600',
  },
  saveButton: {
    height: 48,
    borderRadius: 12,
    backgroundColor: accentGold,
    justifyContent: 'center',
    alignItems: 'center',
  },
  disabledButton: {opacity: 0.7},
  saveButtonText: {color: '#101B2C', fontWeight: '800', fontSize: 16},
});
