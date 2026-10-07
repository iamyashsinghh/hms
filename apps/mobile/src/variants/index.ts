import Constants from 'expo-constants';
import type { Variant } from '../modules/types';
import { VARIANTS } from '../modules/types';
import { doctor } from './doctor';
import { owner } from './owner';
import { patient } from './patient';
import { staff } from './staff';
import type { VariantConfig } from './types';

export type { ShellTab, VariantConfig } from './types';

const CONFIGS: Record<Variant, VariantConfig> = { doctor, staff, owner, patient };

function readVariant(): Variant {
  const v = (Constants.expoConfig?.extra as { variant?: string } | undefined)?.variant;
  return VARIANTS.includes(v as Variant) ? (v as Variant) : 'doctor';
}

/** The app variant this binary was built as (APP_VARIANT at build time). */
export const variant: VariantConfig = CONFIGS[readVariant()];
