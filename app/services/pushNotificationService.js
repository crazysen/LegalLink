import {IS_ANDROID} from '../constants/platformUi';
import Constants, {ExecutionEnvironment} from 'expo-constants';
import {supabase} from './supabaseClient';

// Remote push is not available in Expo Go (SDK 53+). Do not import expo-notifications at all there,
// or the runtime will log an error even if we never call getExpoPushTokenAsync.

let notificationHandlerConfigured = false;

function isExpoGo() {
  return Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
}

/**
 * Registers for Expo push notifications and saves the token on the user's profile (clients only).
 * No-op in Expo Go. Use a development or production build to test push.
 */
export async function registerClientPushNotifications() {
  if (isExpoGo()) {
    return null;
  }

  const [
    NotificationsHandler,
    NotificationPermissions,
    getExpoPushTokenAsyncMod,
    setNotificationChannelAsyncMod,
    ChannelTypes,
  ] = await Promise.all([
    import('expo-notifications/build/NotificationsHandler'),
    import('expo-notifications/build/NotificationPermissions'),
    import('expo-notifications/build/getExpoPushTokenAsync'),
    import('expo-notifications/build/setNotificationChannelAsync'),
    import('expo-notifications/build/NotificationChannelManager.types'),
  ]);

  const {setNotificationHandler} = NotificationsHandler;
  const {getPermissionsAsync, requestPermissionsAsync} = NotificationPermissions;
  const getExpoPushTokenAsync = getExpoPushTokenAsyncMod.default;
  const setNotificationChannelAsync = setNotificationChannelAsyncMod.default;
  const {AndroidImportance} = ChannelTypes;

  if (!notificationHandlerConfigured) {
    setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
    notificationHandlerConfigured = true;
  }

  const {status: existing} = await getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== 'granted') {
    const {status} = await requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') {
    return null;
  }

  if (IS_ANDROID) {
    await setNotificationChannelAsync('default', {
      name: 'default',
      importance: AndroidImportance.MAX,
    });
  }

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  const tokenResult = await getExpoPushTokenAsync(
    projectId ? {projectId} : undefined,
  );
  const token = tokenResult.data;
  if (!token) {
    return null;
  }

  const {
    data: {user},
  } = await supabase.auth.getUser();
  if (!user) {
    return null;
  }

  const {error} = await supabase
    .from('profiles')
    .update({expo_push_token: token, updated_at: new Date().toISOString()})
    .eq('id', user.id);

  if (error) {
    console.warn('expo_push_token update failed:', error.message);
  }

  return token;
}
