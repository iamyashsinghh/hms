import type { Variant } from '../modules/types';

/** Built-in tabs provided by the foundation shell. */
export type ShellTab = 'home' | 'patients' | 'profile';

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
}
