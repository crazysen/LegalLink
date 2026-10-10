import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {getMyAppointments} from '../services/appointmentService';
import {ensureAppConfigReady} from '../services/userApi';
import {REFERENCE_THEME as T} from '../constants/referenceTheme';
import {ClientScreenShell, ClientFadeIn} from '../components/ClientScreenShell';
import ClientChevronBack from '../components/ClientChevronBack';

const MessagesHub = ({ navigation }) => {
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadAppointments = useCallback(async () => {
    try {
      setLoading(true);
      await ensureAppConfigReady();
      const rows = await getMyAppointments({force: true});
      setAppointments(Array.isArray(rows) ? rows : []);
    } catch (error) {
      Alert.alert('Error', error?.message ?? 'Failed to load messages.');
      setAppointments([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAppointments();
  }, [loadAppointments]);

  const chatData = useMemo(
    () =>
      appointments
        .filter(item => {
          const status = (item.status ?? '').toLowerCase();
          // Match web ChatRoom: confirmed, rescheduled, and completed sessions are all chat-eligible
          return status === 'confirmed' || status === 'rescheduled' || status === 'completed';
        })
        .map(item => {
          const name = item.attorney_name || 'Attorney';
          return {
            id: item.id,
            name,
            msg: item.notes || `Consultation: ${item.title || 'Legal Service'}`,
            time: item.updated_at
              ? new Date(item.updated_at).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})
              : 'NOW',
            initials: name
              .split(' ')
              .filter(Boolean)
              .map(part => part[0])
              .join('')
              .slice(0, 2)
              .toUpperCase(),
            unread: 0,
            chatAccessible: item.chatAccessible !== false,
            chatBlockedMessage: item.chatBlockedMessage || '',
          };
        }),
    [appointments],
  );

  // Handle chat item press
  const handleChatPress = (chat) => {
    if (!chat.chatAccessible) {
      Alert.alert(
        'Consultation not available yet',
        chat.chatBlockedMessage || 'Chat opens on your consultation day (any time that day).',
      );
      return;
    }
    if (navigation && navigation.navigate) {
      navigation.navigate('EnterConsultationChat', { 
        chatId: chat.id,
        chatName: chat.name,
        initials: chat.initials
      });
    } else {
      // Fallback if navigation is not available
      Alert.alert('Open Chat', `Opening chat with ${chat.name}`);
    }
  };

  const ChatItem = ({ item }) => (
    <TouchableOpacity 
      style={styles.chatCard}
      onPress={() => handleChatPress(item)}
      activeOpacity={0.7}
    >
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{item.initials}</Text>
      </View>
      <View style={styles.chatInfo}>
        <View style={styles.chatHeader}>
          <Text style={styles.chatName}>{item.name}</Text>
          <Text style={styles.chatTime}>{item.time}</Text>
        </View>
        <View style={styles.chatHeader}>
          <Text style={styles.chatPreview} numberOfLines={1}>{item.msg}</Text>
          {Number(item.unread) > 0 ? (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadText}>{String(item.unread)}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );

  const handleBack = () => {
    navigation.navigate('HomepageClient');
  };

  return (
    <ClientScreenShell>
      <ClientFadeIn>
      <View style={styles.header}>
        <View style={styles.backColumn}>
          <ClientChevronBack onPress={handleBack} />
        </View>
        <Text style={styles.title}>Messages</Text>
      </View>

      <TouchableOpacity
        style={styles.adminSupportBanner}
        onPress={() => navigation.navigate('ClientSupportMessages')}
        activeOpacity={0.85}>
        <View style={styles.adminSupportAvatar}>
          <Image
            source={require('../assets/images/logo.jpg')}
            style={styles.adminSupportAvatarImage}
            resizeMode="cover"
            accessibilityLabel="LegalLink Admin"
          />
        </View>
        <View style={styles.adminSupportTextCol}>
          <Text style={styles.adminSupportTitle}>LegalLink Admin</Text>
          <Text style={styles.adminSupportSub} numberOfLines={2}>
            Questions, payments, or reschedule help — tap to message admin.
          </Text>
        </View>
        <Text style={styles.adminSupportChevron}>›</Text>
      </TouchableOpacity>

      {loading ? (
        <View style={styles.emptyContainer}>
          <ActivityIndicator color={T.gold[1]} />
          <Text style={styles.emptyText}>Loading conversations...</Text>
        </View>
      ) : (
        <FlatList
          style={styles.listFlex}
          data={chatData}
          renderItem={({ item }) => <ChatItem item={item} />}
          keyExtractor={item => item.id}
          contentContainerStyle={{ padding: 16 }}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No confirmed consultations to chat yet</Text>
            </View>
          }
        />
      )}
      </ClientFadeIn>
    </ClientScreenShell>
  );
};

const styles = StyleSheet.create({
  listFlex: {flex: 1},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
  },
  backColumn: {
    width: 28,
    marginRight: 8,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  title: {
    flex: 1,
    color: T.text,
    fontSize: 22,
    fontWeight: '800',
    lineHeight: 28,
  },
  adminSupportBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: '#152238',
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.25)',
  },
  adminSupportAvatar: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#152238',
    overflow: 'hidden',
    marginRight: 12,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.35)',
  },
  adminSupportAvatarImage: {
    width: '100%',
    height: '100%',
  },
  adminSupportTextCol: {flex: 1},
  adminSupportTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  adminSupportSub: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 12,
    marginTop: 2,
    lineHeight: 16,
  },
  adminSupportChevron: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 22,
    fontWeight: '300',
    marginLeft: 6,
  },
  chatCard: { 
    flexDirection: 'row', 
    backgroundColor: '#0F172A', 
    padding: 16, 
    borderRadius: 20, 
    marginBottom: 12, 
    alignItems: 'center', 
    borderWidth: 1, 
    borderColor: '#1E293B' 
  },
  avatar: { 
    width: 56, 
    height: 56, 
    borderRadius: 16, 
    backgroundColor: '#020617', 
    justifyContent: 'center', 
    alignItems: 'center' 
  },
  avatarText: { 
    color: 'white', 
    fontWeight: 'bold', 
    fontSize: 18 
  },
  chatInfo: { 
    flex: 1, 
    marginLeft: 16 
  },
  chatHeader: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center' 
  },
  chatName: { 
    color: 'white', 
    fontWeight: 'bold', 
    fontSize: 16 
  },
  chatTime: { 
    color: '#64748B', 
    fontSize: 10, 
    fontWeight: 'bold' 
  },
  chatPreview: { 
    color: '#94A3B8', 
    marginTop: 4, 
    fontSize: 14, 
    flex: 0.9 
  },
  unreadBadge: { 
    backgroundColor: '#EAB308', 
    width: 20, 
    height: 20, 
    borderRadius: 10, 
    justifyContent: 'center', 
    alignItems: 'center' 
  },
  unreadText: { 
    color: '#0F172A', 
    fontSize: 10, 
    fontWeight: 'bold' 
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40
  },
  emptyText: {
    color: '#64748B',
    fontSize: 16
  }
});

export default MessagesHub;

