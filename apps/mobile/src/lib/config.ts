import Constants from 'expo-constants';

/** API base URL. EXPO_PUBLIC_API_URL is inlined at build time; app.config.ts also copies it into `extra`. */
export const API_URL: string =
  process.env.EXPO_PUBLIC_API_URL ??
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ??
  'http://localhost:4000/api/v1';
