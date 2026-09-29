import React, {useCallback, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {LinearGradient} from 'expo-linear-gradient';
import {signOutCurrentUser} from '../services/authService';
import AttorneyScreenHeader from '../components/AttorneyScreenHeader';
import {ClientScreenShell} from '../components/ClientScreenShell';
import {useUserProfile} from '../context/UserProfileContext';
import {
  fetchAttorneyProfile,
  getCachedAttorneyProfile,
  getCachedProfile,
  getCurrentSessionProfile,
  prefetchAttorneyProfileStats,
  saveAttorneyProfile,
} from '../services/userApi';
import {
  isValidEmail,
  isValidPhoneNumber,
  sanitizePhoneInput,
  VALID_EMAIL_MESSAGE,
  VALID_PHONE_MESSAGE,
} from '../utils/validators';

const PROFILE_BLUE = {
  banner: ['rgba(12, 35, 62, 0.95)', 'rgba(26, 71, 130, 0.75)', 'rgba(50, 97, 168, 0.35)'],
  avatar: ['#357ad9', '#1d5bc0'],
  edit: ['#357ad9', '#1d5bc0'],
  specBg: 'rgba(38, 80, 136, 0.5)',
  specBorder: 'rgba(159, 193, 232, 0.28)',
  specText: '#dbe9fb',
  cardBorder: 'rgba(159, 193, 232, 0.22)',
  cardBg: 'rgba(8, 19, 33, 0.92)',
  detailBg: 'rgba(8, 17, 28, 0.72)',
  label: '#9fb9d8',
  value: '#eaf3ff',
  muted: '#c3d7ef',
};

const emptyProfile = {
  name: 'Attorney',
  role: 'Attorney',
  email: '',
  phone: '',
  location: '',
  ibpNumber: '',
  avatarUrl: '',
  specializations: [],
  bio: '',
  consultations: 0,
  notarials: 0,
  rating: 'N/A',
};

function initialsFor(name) {
  return String(name || 'A')
    .split(' ')
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function seedFromContext(ctx) {
  if (!ctx?.name && !ctx?.email) return emptyProfile;
  return {
    ...emptyProfile,
    name: ctx.name || 'Attorney',
    email: ctx.email || '',
    phone: ctx.phone || '',
    location: ctx.address || '',
  };
}

function mergeProfileFromApi(data, session) {
  const specs = Array.isArray(data?.specialties)
    ? data.specialties
    : Array.isArray(data?.attorney?.specialties)
      ? data.attorney.specialties
      : [];

  return {
    name: data.profile?.full_name || session?.full_name || 'Attorney',
    role: data.attorney?.firm_name || 'Attorney',
    email: data.profile?.email || session?.email || '',
    phone: data.profile?.phone || '',
    location: data.profile?.address || '',
    ibpNumber: data.attorney?.prc_id || '',
    avatarUrl: data.profile?.avatar_url || '',
    specializations: specs,
    bio: data.attorney?.bio || '',
    consultations: data.consultationCount ?? 0,
    notarials: data.notarialCount ?? 0,
    rating: 'N/A',
  };
}

const DetailCell = React.memo(function DetailCell({label, value}) {
  return (
    <View style={styles.detailCell}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value || '—'}</Text>
    </View>
  );
});

export default function AttyProfileSettings({navigation}) {
  const {width} = useWindowDimensions();
  const twoColumn = width >= 380;
  const {profile: ctxProfile, updateProfile} = useUserProfile();
  const hasHydratedRef = useRef(false);

  const [userId, setUserId] = useState(() => getCachedProfile()?.id || null);
  const [loading, setLoading] = useState(() => !getCachedAttorneyProfile(getCachedProfile()?.id));
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [profile, setProfile] = useState(() => {
    const id = getCachedProfile()?.id;
    const cached = id ? getCachedAttorneyProfile(id) : null;
    if (cached) return mergeProfileFromApi(cached, getCachedProfile());
    return seedFromContext(ctxProfile);
  });
  const [form, setForm] = useState(profile);

  const applyMerged = useCallback(
    (merged, session, {preserveForm = false} = {}) => {
      setProfile(merged);
      if (!preserveForm) setForm(merged);
      updateProfile({
        name: merged.name,
        email: merged.email,
        phone: merged.phone,
        address: merged.location,
        role: 'Attorney',
      });
    },
    [updateProfile],
  );

  const loadProfile = useCallback(
    async (options = {}) => {
      const silent = Boolean(options?.silent);
      const force = Boolean(options?.force);
      if (!silent) setLoading(true);
      setErrorText('');
      try {
        let session = getCachedProfile();
        if (!session?.id) {
          const res = await getCurrentSessionProfile();
          session = res.profile;
        }

        const id = session?.id;
        setUserId(id || null);
        if (!id) {
          setProfile(emptyProfile);
          setForm(emptyProfile);
          return;
        }

        if (!force) {
          const cached = getCachedAttorneyProfile(id);
          if (cached) {
            applyMerged(mergeProfileFromApi(cached, session), session, {
              preserveForm: options.preserveForm,
            });
            if (!silent) setLoading(false);
            setRefreshing(false);
            if (!cached.statsLoaded) {
              prefetchAttorneyProfileStats(id).then((statsPayload) => {
                if (!statsPayload) return;
                setProfile((prev) => ({
                  ...prev,
                  consultations: statsPayload.consultationCount ?? prev.consultations,
                  notarials: statsPayload.notarialCount ?? prev.notarials,
                }));
              });
            }
            return;
          }
        }

        const data = await fetchAttorneyProfile(id, {
          force,
          includeStats: Boolean(options?.includeStats),
        });
        applyMerged(mergeProfileFromApi(data, session), session, {
          preserveForm: options.preserveForm,
        });

        if (!data.statsLoaded) {
          prefetchAttorneyProfileStats(id).then((statsPayload) => {
            if (!statsPayload) return;
            setProfile((prev) => ({
              ...prev,
              consultations: statsPayload.consultationCount ?? prev.consultations,
              notarials: statsPayload.notarialCount ?? prev.notarials,
            }));
          });
        }
      } catch (error) {
        setErrorText(error?.message || 'Failed to load attorney profile.');
      } finally {
        if (!silent) setLoading(false);
        setRefreshing(false);
      }
    },
    [applyMerged],
  );

  useFocusEffect(
    useCallback(() => {
      const silent = hasHydratedRef.current;
      hasHydratedRef.current = true;
      loadProfile({silent, preserveForm: editing});
    }, [editing, loadProfile]),
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadProfile({silent: true, force: true, includeStats: true, preserveForm: editing});
  }, [editing, loadProfile]);

  const handleSave = async () => {
    if (!userId) return;
    if (!form.name.trim()) {
      setErrorText('Full name is required.');
      return;
    }
    if (!isValidEmail(form.email)) {
      setErrorText(VALID_EMAIL_MESSAGE);
      return;
    }
    if (!isValidPhoneNumber(form.phone)) {
      setErrorText(VALID_PHONE_MESSAGE);
      return;
    }

    try {
      setSaving(true);
      setErrorText('');
      const payload = {
        fullName: form.name.trim(),
        role: form.role.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        location: form.location.trim(),
        ibpNumber: form.ibpNumber.trim(),
        bio: form.bio.trim(),
        specializations: profile.specializations,
      };
      await saveAttorneyProfile(userId, payload);
      const next = {...form, phone: payload.phone};
      setProfile(next);
      setForm(next);
      setEditing(false);
      updateProfile({
        name: next.name,
        email: next.email,
        phone: next.phone,
        address: next.location,
        role: 'Attorney',
      });
      Alert.alert('Saved', 'Profile updated successfully.');
    } catch (error) {
      setErrorText(error?.message || 'Failed to save attorney profile.');
    } finally {
      setSaving(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOutCurrentUser();
    } catch {
      // session may already be cleared
    }
    navigation.reset({index: 0, routes: [{name: 'Landing'}]});
  };

  const specTags = useMemo(
    () => (profile.specializations?.length ? profile.specializations : []),
    [profile.specializations],
  );

  const detailItems = useMemo(
    () => [
      {label: 'Email Address', value: profile.email},
      {label: 'Phone Number', value: profile.phone},
      {label: 'Office Location', value: profile.location},
      {label: 'IBP/PRC ID', value: profile.ibpNumber},
    ],
    [profile],
  );

  return (
    <ClientScreenShell edges={['top']}>
      <AttorneyScreenHeader
        navigation={navigation}
        title="Attorney Dashboard"
        subtitle="Attorney Workspace"
        activeRoute="AttyProfileSettings"
      />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#5e99f3" />
        }>
        {errorText ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{errorText}</Text>
          </View>
        ) : null}

        {loading && !profile.name && !refreshing ? (
          <View style={styles.loadingCard}>
            <ActivityIndicator color="#5e99f3" />
            <Text style={styles.loadingText}>Loading profile...</Text>
          </View>
        ) : null}

        <View style={[styles.profileCard, loading && styles.profileCardLoading]}>
          <LinearGradient colors={PROFILE_BLUE.banner} start={{x: 0, y: 0}} end={{x: 1, y: 1}} style={styles.banner} />

          <View style={styles.profileBody}>
            <View style={styles.profileTopRow}>
              {profile.avatarUrl ? (
                <Image source={{uri: profile.avatarUrl}} style={styles.avatarImage} />
              ) : (
                <LinearGradient colors={PROFILE_BLUE.avatar} style={styles.avatar}>
                  <Text style={styles.avatarText}>{initialsFor(profile.name)}</Text>
                </LinearGradient>
              )}

              <View style={styles.profileInfo}>
                <Text style={styles.profileName} numberOfLines={2}>
                  {profile.name}
                </Text>
                <Text style={styles.profileRole}>{profile.role}</Text>
                {specTags.length > 0 ? (
                  <View style={styles.specRow}>
                    {specTags.map((s) => (
                      <View key={s} style={styles.specTag}>
                        <Text style={styles.specTagText}>{s}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            </View>

            {!editing ? (
              <View style={styles.profileActions}>
                <TouchableOpacity activeOpacity={0.88} onPress={() => setEditing(true)}>
                  <LinearGradient colors={PROFILE_BLUE.edit} style={styles.editBtn}>
                    <Text style={styles.editBtnText}>Edit Profile</Text>
                  </LinearGradient>
                </TouchableOpacity>
                <TouchableOpacity style={styles.signOutBtn} activeOpacity={0.88} onPress={handleSignOut}>
                  <Text style={styles.signOutBtnText}>Sign Out</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        </View>

        <View style={styles.statsRow}>
          <StatBox value={String(profile.consultations)} label="Consultations" />
          <StatBox value={String(profile.notarials)} label="Notarials" />
          <StatBox value={profile.rating} label="Rating" />
        </View>

        <View style={styles.detailsCard}>
          {!editing ? (
            <>
              <Text style={styles.sectionTitle}>Attorney Information</Text>
              <View style={[styles.detailGrid, twoColumn && styles.detailGridTwoCol]}>
                {detailItems.map((item) => (
                  <DetailCell key={item.label} label={item.label} value={item.value} />
                ))}
              </View>

              <Text style={[styles.sectionTitle, styles.sectionTitleSpaced]}>Professional Bio</Text>
              <View style={styles.bioBox}>
                <Text style={styles.bioText}>{profile.bio || 'No bio available.'}</Text>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.sectionTitle}>Edit Profile</Text>
              <View style={[styles.formGrid, twoColumn && styles.detailGridTwoCol]}>
                <FormField label="Full Name" value={form.name} onChangeText={(v) => setForm({...form, name: v})} />
                <FormField
                  label="Firm / Title"
                  value={form.role}
                  onChangeText={(v) => setForm({...form, role: v})}
                />
                <FormField
                  label="Email"
                  value={form.email}
                  onChangeText={(v) => setForm({...form, email: v})}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
                <FormField
                  label="Phone"
                  value={form.phone}
                  onChangeText={(v) => setForm({...form, phone: sanitizePhoneInput(v)})}
                  keyboardType="phone-pad"
                />
                <FormField
                  label="Location"
                  value={form.location}
                  onChangeText={(v) => setForm({...form, location: v})}
                />
                <FormField
                  label="IBP Number"
                  value={form.ibpNumber}
                  onChangeText={(v) => setForm({...form, ibpNumber: v})}
                />
              </View>
              <Text style={styles.fieldLabel}>Bio</Text>
              <TextInput
                style={[styles.input, styles.multiline]}
                value={form.bio}
                onChangeText={(v) => setForm({...form, bio: v})}
                multiline
                placeholder="Professional background..."
                placeholderTextColor={PROFILE_BLUE.label}
              />
              <View style={styles.formActions}>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => {
                    setForm(profile);
                    setEditing(false);
                    setErrorText('');
                  }}>
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.saveBtnWrap, saving && styles.disabledBtn]}
                  disabled={saving}
                  onPress={handleSave}>
                  <LinearGradient colors={PROFILE_BLUE.edit} style={styles.saveBtn}>
                    <Text style={styles.editBtnText}>{saving ? 'Saving...' : 'Save Changes'}</Text>
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </ScrollView>
    </ClientScreenShell>
  );
}

function StatBox({value, label}) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function FormField({label, value, onChangeText, keyboardType, autoCapitalize}) {
  return (
    <View style={styles.formField}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize || 'sentences'}
        placeholderTextColor={PROFILE_BLUE.label}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: {padding: 16, paddingBottom: 40},
  loadingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: PROFILE_BLUE.cardBg,
    borderWidth: 1,
    borderColor: PROFILE_BLUE.cardBorder,
  },
  loadingText: {color: PROFILE_BLUE.muted, marginLeft: 8},
  errorBanner: {
    marginBottom: 12,
    padding: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(164, 36, 36, 0.34)',
    borderWidth: 1,
    borderColor: 'rgba(241, 131, 131, 0.45)',
  },
  errorText: {color: '#ffd3d3', fontWeight: '600', fontSize: 13},
  profileCard: {
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: PROFILE_BLUE.cardBorder,
    backgroundColor: PROFILE_BLUE.cardBg,
    marginBottom: 14,
  },
  profileCardLoading: {opacity: 0.92},
  banner: {height: 88},
  profileBody: {marginTop: -36, paddingHorizontal: 16, paddingBottom: 16},
  profileTopRow: {flexDirection: 'row', alignItems: 'flex-end', gap: 14},
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: 'rgba(10, 24, 40, 0.95)',
  },
  avatarImage: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 4,
    borderColor: 'rgba(10, 24, 40, 0.95)',
  },
  avatarText: {color: '#fff', fontSize: 26, fontWeight: '800'},
  profileInfo: {flex: 1, minWidth: 0, paddingBottom: 4},
  profileName: {fontSize: 22, fontWeight: '800', color: '#f6f9ff', lineHeight: 26},
  profileRole: {fontSize: 14, fontWeight: '600', color: PROFILE_BLUE.muted, marginTop: 4},
  specRow: {flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10},
  specTag: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: PROFILE_BLUE.specBg,
    borderWidth: 1,
    borderColor: PROFILE_BLUE.specBorder,
  },
  specTagText: {color: PROFILE_BLUE.specText, fontSize: 11, fontWeight: '700'},
  profileActions: {flexDirection: 'row', marginTop: 16, gap: 10},
  editBtn: {
    paddingVertical: 11,
    paddingHorizontal: 18,
    borderRadius: 11,
    minWidth: 120,
    alignItems: 'center',
  },
  editBtnText: {color: '#f5f9ff', fontWeight: '700', fontSize: 13},
  signOutBtn: {
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: 11,
    backgroundColor: 'rgba(121, 22, 22, 0.82)',
    borderWidth: 1,
    borderColor: 'rgba(240, 141, 141, 0.36)',
    justifyContent: 'center',
  },
  signOutBtnText: {color: '#ffd3d3', fontWeight: '700', fontSize: 13},
  statsRow: {flexDirection: 'row', gap: 10, marginBottom: 14},
  statCard: {
    flex: 1,
    paddingVertical: 16,
    paddingHorizontal: 8,
    borderRadius: 14,
    alignItems: 'center',
    backgroundColor: PROFILE_BLUE.cardBg,
    borderWidth: 1,
    borderColor: PROFILE_BLUE.cardBorder,
  },
  statValue: {fontSize: 28, fontWeight: '800', color: '#f5f9ff'},
  statLabel: {
    marginTop: 8,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: '#bcd1ea',
  },
  detailsCard: {
    padding: 18,
    borderRadius: 16,
    backgroundColor: PROFILE_BLUE.cardBg,
    borderWidth: 1,
    borderColor: PROFILE_BLUE.cardBorder,
  },
  sectionTitle: {fontSize: 18, fontWeight: '800', color: '#f5f9ff', marginBottom: 12},
  sectionTitleSpaced: {marginTop: 8},
  detailGrid: {gap: 10},
  detailGridTwoCol: {flexDirection: 'row', flexWrap: 'wrap'},
  detailCell: {
    flexGrow: 1,
    flexBasis: '48%',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(159, 193, 232, 0.14)',
    backgroundColor: PROFILE_BLUE.detailBg,
    padding: 12,
    marginBottom: 4,
  },
  detailLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: PROFILE_BLUE.label,
  },
  detailValue: {
    marginTop: 4,
    fontSize: 14,
    fontWeight: '600',
    color: PROFILE_BLUE.value,
  },
  bioBox: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(159, 193, 232, 0.14)',
    backgroundColor: PROFILE_BLUE.detailBg,
    padding: 14,
  },
  bioText: {color: '#c8dbf1', fontSize: 14, lineHeight: 22},
  formGrid: {gap: 4},
  formField: {marginBottom: 4, flexGrow: 1, flexBasis: '48%'},
  fieldLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: PROFILE_BLUE.label,
    marginBottom: 6,
    marginTop: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: 'rgba(147, 186, 231, 0.32)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: PROFILE_BLUE.value,
    backgroundColor: 'rgba(8, 17, 28, 0.88)',
    fontSize: 14,
  },
  multiline: {minHeight: 110, textAlignVertical: 'top'},
  formActions: {flexDirection: 'row', justifyContent: 'flex-end', marginTop: 14, gap: 8},
  cancelBtn: {
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: 11,
    backgroundColor: 'rgba(121, 22, 22, 0.82)',
    borderWidth: 1,
    borderColor: 'rgba(240, 141, 141, 0.36)',
  },
  cancelBtnText: {color: '#ffd3d3', fontWeight: '700'},
  saveBtnWrap: {borderRadius: 11, overflow: 'hidden'},
  saveBtn: {paddingVertical: 11, paddingHorizontal: 18, alignItems: 'center'},
  disabledBtn: {opacity: 0.65},
});
