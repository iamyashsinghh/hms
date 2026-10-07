import { createMobileData } from '@/data/client';
import { api } from './auth';

/** Demo data is used only in development, or when a build opts in with EXPO_PUBLIC_DEMO_DATA=1. */
export const DEMO_FALLBACK = __DEV__ || process.env.EXPO_PUBLIC_DEMO_DATA === '1';

/** Staff apps (doctor, staff, owner): module endpoints with the staff session. */
export const data = createMobileData(api.http, { demoFallback: DEMO_FALLBACK });
