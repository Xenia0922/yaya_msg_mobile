import { PermissionsAndroid, Platform } from 'react-native';

export async function ensureNotificationPermission(): Promise<boolean> {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 33) return true;
  try {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    );
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}
