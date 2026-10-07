import type { Variant } from '../modules/types';

/**
 * Tabs the shell can show. home/patients/profile are generic; queue (doctor), opd (staff) and
 * summary (owner) put each app's main screen one tap away.
 */
export type ShellTab = 'home' | 'queue' | 'opd' | 'summary' | 'patients' | 'profile';

export interface VariantConfig {
  key: Variant;
  /** App title shown on login and Home. */
  title: string;
  tagline: string;
  /**
   * Built-in tabs this app shows. Module screens are not tabs: they appear as cards on Home
   * when their `variants` include this app (see src/modules).
   */
  tabs: ShellTab[];
  /** Where the app opens after sign-in. */
  landing: '/' | '/queue' | '/opd' | '/summary' | '/my';
}
