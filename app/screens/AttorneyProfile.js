import React from 'react';
import {
  StyleSheet,
  View,
  Text,
  Image,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import {MaterialCommunityIcons} from '@expo/vector-icons';
import {getBundledAttorneyPhotoSource} from '../constants/attorneyPhotos';
import {REFERENCE_THEME as T} from '../constants/referenceTheme';
import {ClientScreenShell, ClientFadeIn} from '../components/ClientScreenShell';
import ClientChevronBack from '../components/ClientChevronBack';

function profileInitials(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .filter(p => !/^atty\.?$/i.test(p));
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function ProfilePhoto({name, uri}) {
  const bundled = getBundledAttorneyPhotoSource(name);
  if (bundled) {
    return <Image source={bundled} style={styles.profilePhoto} resizeMode="cover" />;
  }
  if (uri) {
    return <Image source={{uri}} style={styles.profilePhoto} resizeMode="cover" />;
  }
  return (
    <View style={[styles.profilePhoto, styles.profilePhotoPlaceholder]}>
      <Text style={styles.profilePhotoInitials}>{profileInitials(name)}</Text>
    </View>
  );
}

export default function AttorneyProfile({navigation, route}) {
  const attorney = route?.params?.attorney || {};

  const photoUri = attorney.img || attorney.image || attorney.avatarUri || null;
  const isVerified = Boolean(attorney.isVerified ?? attorney.verified);
  const experience = attorney.exp || attorney.experience || '3 years experience';
  const specialty = attorney.specialty || 'General Practice';
  const bio =
    String(attorney.bio || '').trim() || 'No biography available yet.';
  const details =
    String(attorney.details || '').trim() ||
    'No additional profile details provided.';
  const showDetails = details !== bio;
  const price = attorney.price || 'PHP 2000.00';

  const handleClose = () => {
    if (navigation?.canGoBack?.()) {
      navigation.goBack();
    }
  };

  const handleBookNow = () => {
    navigation?.navigate?.('BookNow', {
      attorney: {
        ...attorney,
        img: photoUri,
        image: photoUri,
        specialty,
        price,
        verified: isVerified,
        isVerified,
      },
    });
  };

  return (
    <ClientScreenShell>
      <ClientFadeIn>
        <View style={styles.topBar}>
          <ClientChevronBack onPress={handleClose} />
          <Text style={styles.screenTitle}>Attorney Profile</Text>
          <TouchableOpacity
            onPress={handleClose}
            hitSlop={{top: 12, bottom: 12, left: 12, right: 12}}
            accessibilityLabel="Close profile">
            <MaterialCommunityIcons name="close" size={22} color={T.textSoft} />
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}>
          <View style={styles.profileHeader}>
            <ProfilePhoto name={attorney.name} uri={photoUri} />
            <View style={styles.profileInfo}>
              <View style={styles.nameRow}>
                <Text style={styles.nameText} numberOfLines={3}>
                  {attorney.name || 'Attorney'}
                </Text>
                <MaterialCommunityIcons
                  name="check-decagram"
                  size={18}
                  color={T.gold[0]}
                  style={styles.verifiedIcon}
                />
              </View>

              <View style={styles.specialtyRow}>
                <MaterialCommunityIcons name="scale-balance" size={14} color={T.textSoft} />
                <Text style={styles.specialtyText} numberOfLines={2}>
                  {specialty}
                </Text>
              </View>

              <Text style={styles.expText}>{experience}</Text>
            </View>
          </View>

          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Professional Biography</Text>
            <Text style={styles.bioText}>{bio}</Text>
            {showDetails ? <Text style={styles.detailsText}>{details}</Text> : null}
          </View>

          <View style={styles.feeCard}>
            <View style={styles.feeLabelWrap}>
              <Text style={styles.feeLabel}>CONSULTATION FEE</Text>
              <Text style={styles.feeDesc}>Initial Legal Assessment (1 Hour)</Text>
            </View>
            <Text style={styles.feeAmount}>{price}</Text>
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity style={styles.bookBtn} onPress={handleBookNow} activeOpacity={0.9}>
            <Text style={styles.bookBtnText}>Book Now</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.closeBtn} onPress={handleClose} activeOpacity={0.9}>
            <Text style={styles.closeBtnText}>Close</Text>
          </TouchableOpacity>
        </View>
      </ClientFadeIn>
    </ClientScreenShell>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    gap: 8,
  },
  screenTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '800',
    color: T.text,
    textAlign: 'center',
  },
  scroll: {
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
    marginBottom: 20,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(244, 215, 139, 0.1)',
  },
  profilePhoto: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 3,
    borderColor: 'rgba(244, 215, 139, 0.35)',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  profilePhotoPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(30, 58, 138, 0.45)',
  },
  profilePhotoInitials: {
    color: T.gold[0],
    fontSize: 32,
    fontWeight: '800',
  },
  profileInfo: {
    flex: 1,
    minWidth: 0,
    paddingTop: 4,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginBottom: 8,
  },
  nameText: {
    flex: 1,
    fontSize: 18,
    fontWeight: '800',
    color: T.text,
    lineHeight: 24,
  },
  verifiedIcon: {marginTop: 2},
  specialtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  specialtyText: {
    flex: 1,
    fontSize: 13,
    color: T.textMuted,
    fontWeight: '500',
  },
  expText: {
    fontSize: 13,
    color: T.textSoft,
    marginBottom: 6,
  },
  ratingText: {
    fontSize: 14,
    fontWeight: '700',
    color: T.gold[0],
    marginBottom: 4,
  },
  sectionCard: {
    backgroundColor: 'rgba(18, 26, 36, 0.88)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.12)',
    padding: 18,
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: T.text,
    marginBottom: 12,
  },
  bioText: {
    fontSize: 14,
    color: T.textMuted,
    lineHeight: 22,
  },
  detailsText: {
    marginTop: 12,
    fontSize: 14,
    color: T.textSoft,
    lineHeight: 22,
  },
  feeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: 'rgba(244, 215, 139, 0.08)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(244, 215, 139, 0.2)',
    padding: 18,
  },
  feeLabelWrap: {flex: 1, minWidth: 0},
  feeLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    color: T.gold[0],
    marginBottom: 4,
  },
  feeDesc: {
    fontSize: 13,
    color: T.textSoft,
    lineHeight: 18,
  },
  feeAmount: {
    fontSize: 20,
    fontWeight: '900',
    color: T.text,
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 20,
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(244, 215, 139, 0.12)',
    backgroundColor: 'rgba(4, 7, 11, 0.92)',
  },
  bookBtn: {
    backgroundColor: T.gold[1],
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
  },
  bookBtnText: {
    color: T.base,
    fontWeight: '800',
    fontSize: 16,
  },
  closeBtn: {
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(244, 215, 139, 0.35)',
  },
  closeBtnText: {
    color: T.text,
    fontWeight: '700',
    fontSize: 16,
  },
});
