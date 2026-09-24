import { Alert, Platform } from 'react-native';

/**
 * A platform-aware alert utility that works on both Web and Native.
 * On Web, it uses window.alert and window.confirm.
 * On Native, it uses React Native's Alert.alert.
 */
export const uiAlerts = {
  /**
   * Show a simple alert message.
   */
  alert: (title: string, message?: string) => {
    if (Platform.OS === 'web') {
      window.alert(message ? `${title}\n\n${message}` : title);
    } else {
      Alert.alert(title, message);
    }
  },

  /**
   * Show a confirmation dialog with "Cancel" and "OK" (or custom) buttons.
   */
  confirm: (
    title: string,
    message: string,
    onConfirm: () => void,
    options?: {
      confirmText?: string;
      cancelText?: string;
      isDestructive?: boolean;
    }
  ) => {
    if (Platform.OS === 'web') {
      const confirmed = window.confirm(`${title}\n\n${message}`);
      if (confirmed) {
        onConfirm();
      }
    } else {
      Alert.alert(title, message, [
        {
          text: options?.cancelText || 'Cancel',
          style: 'cancel',
        },
        {
          text: options?.confirmText || 'OK',
          style: options?.isDestructive ? 'destructive' : 'default',
          onPress: onConfirm,
        },
      ]);
    }
  },
};
