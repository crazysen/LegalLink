import React, {useMemo} from 'react';
import {
  Image,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {REFERENCE_THEME as T} from '../constants/referenceTheme';
import {ClientScreenShell, ClientFadeIn} from '../components/ClientScreenShell';
import ClientChevronBack from '../components/ClientChevronBack';
import {parseNotificationImageUrl} from '../services/announcementImages';

function formatDateTime(value) {
  const parsed = String(value || '').trim().replace(' ', 'T').replace(/\+00$/, 'Z');
  const date = new Date(parsed);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function getTypeLabel(type) {
  const t = String(type || '').toLowerCase().replace(/^admin_/, '');
  if (t === 'announcement') return 'Announcement';
  if (t === 'general') return 'Update';
  if (t === 'reminder') return 'Reminder';
  if (t === 'reschedule') return 'Schedule notice';
  if (t === 'update') return 'Update';
  return 'Announcement';
}

export default function ClientAnnouncementDetail({navigation, route}) {
  const params = route?.params || {};
  const title = String(params.title || 'Announcement').trim();
  const body = String(params.body || '').trim();
  const imageUrl = useMemo(() => {
    const direct = String(params.imageUrl || '').trim();
    if (direct) return direct;
    return parseNotificationImageUrl(params.data) || null;
  }, [params.data, params.imageUrl]);
  const createdLabel = formatDateTime(params.createdAt);
  const typeLabel = getTypeLabel(params.type);

  const openImageExternally = () => {
    if (!imageUrl) return;
    Linking.openURL(imageUrl).catch(() => {});
  };

  return (
    <ClientScreenShell>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <ClientFadeIn>
          <ClientChevronBack
            style={styles.backHit}
            onPress={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('ClientNotification'))}
          />
          <View style={styles.typePill}>
            <Text style={styles.typePillText}>{typeLabel}</Text>
          </View>
          <Text style={styles.title}>{title}</Text>
          {createdLabel ? <Text style={styles.meta}>From LegalLink Admin · {createdLabel}</Text> : null}
        </ClientFadeIn>

        {imageUrl ? (
          <ClientFadeIn delay={60}>
            <TouchableOpacity activeOpacity={0.92} onPress={openImageExternally}>
              <Image source={{uri: imageUrl}} style={styles.image} resizeMode="contain" />
            </TouchableOpacity>
            <Text style={styles.imageHint}>Tap image to open full size</Text>
          </ClientFadeIn>
        ) : null}

        <ClientFadeIn delay={100}>
          {body ? (
            <Text style={styles.body}>{body}</Text>
          ) : (
            <Text style={styles.bodyMuted}>
              {imageUrl
                ? 'This announcement includes an image only.'
                : 'No additional message was included.'}
            </Text>
          )}
        </ClientFadeIn>
      </ScrollView>
    </ClientScreenShell>
  );
}

const styles = StyleSheet.create({
  scroll: {paddingHorizontal: 20, paddingBottom: 40},
  backHit: {alignSelf: 'flex-start', marginBottom: 12},
  typePill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(96, 165, 250, 0.35)',
    marginBottom: 10,
  },
  typePillText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#93C5FD',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  title: {fontSize: 26, fontWeight: '800', color: T.text, lineHeight: 32, marginBottom: 8},
  meta: {fontSize: 13, color: T.textSoft, marginBottom: 20},
  image: {
    width: '100%',
    minHeight: 200,
    maxHeight: 420,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginBottom: 8,
  },
  imageHint: {
    fontSize: 11,
    color: T.textMuted,
    textAlign: 'center',
    marginBottom: 20,
  },
  body: {fontSize: 16, color: T.text, lineHeight: 26},
  bodyMuted: {fontSize: 15, color: T.textSoft, lineHeight: 24, fontStyle: 'italic'},
});
