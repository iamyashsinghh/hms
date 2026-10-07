import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * One codebase, four apps. APP_VARIANT picks which one is built:
 *   APP_VARIANT=doctor|staff|owner|patient (default doctor)
 * Variant-specific behaviour (home title, visible tabs) lives in src/variants/<variant>.ts.
 */
const VARIANTS = {
  doctor: { name: 'HMS Doctor', color: '#0E7490' },
  staff: { name: 'HMS Staff', color: '#1D4ED8' },
  owner: { name: 'HMS Owner', color: '#0F766E' },
  patient: { name: 'HMS Patient', color: '#0284C7' },
} as const;

type Variant = keyof typeof VARIANTS;

function resolveVariant(): Variant {
  const raw = (process.env.APP_VARIANT ?? 'doctor').toLowerCase();
  if (raw in VARIANTS) return raw as Variant;
  throw new Error(`Unknown APP_VARIANT "${raw}". Use one of: ${Object.keys(VARIANTS).join(', ')}`);
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const variant = resolveVariant();
  const v = VARIANTS[variant];
  const id = `com.hms.${variant}`;
  return {
    ...config,
    name: v.name,
    slug: `hms-${variant}`,
    scheme: `hms-${variant}`,
    version: '0.1.0',
    orientation: 'portrait',
    icon: './assets/images/icon.png',
    userInterfaceStyle: 'light',
    ios: {
      bundleIdentifier: id,
      supportsTablet: true,
    },
    android: {
      package: id,
      adaptiveIcon: {
        backgroundColor: '#E6F4FE',
        foregroundImage: './assets/images/android-icon-foreground.png',
        backgroundImage: './assets/images/android-icon-background.png',
        monochromeImage: './assets/images/android-icon-monochrome.png',
      },
    },
    web: { favicon: './assets/images/favicon.png' },
    plugins: [
      'expo-router',
      'expo-secure-store',
      [
        'expo-splash-screen',
        {
          backgroundColor: v.color,
          image: './assets/images/splash-icon.png',
          imageWidth: 76,
        },
      ],
    ],
    experiments: { typedRoutes: false },
    extra: {
      ...config.extra,
      variant,
      apiUrl: process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1',
    },
  };
};
