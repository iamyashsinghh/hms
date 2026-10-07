import * as SecureStore from 'expo-secure-store';

// The refresh token is the long-lived credential, so it lives only in the OS keychain/keystore.
// The access token is short-lived and kept in memory (see session.ts).
const REFRESH_KEY = 'hms.refreshToken';

export const tokenStore = {
  getRefreshToken: () => SecureStore.getItemAsync(REFRESH_KEY),
  setRefreshToken: (token: string) => SecureStore.setItemAsync(REFRESH_KEY, token),
  clearRefreshToken: () => SecureStore.deleteItemAsync(REFRESH_KEY),
};
