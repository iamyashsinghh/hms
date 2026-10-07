import { createMobileData } from '@/data/client';
import { DEMO_FALLBACK } from './data';
import { patientHttp } from './patient-auth';

/** Patient app: portal endpoints with the patient session. */
export const patientData = createMobileData(patientHttp, { demoFallback: DEMO_FALLBACK });
