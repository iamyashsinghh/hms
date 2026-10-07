import type { Metadata } from 'next';
import { PatientSessionProvider } from '@/modules/portal/patient-session';

export const metadata: Metadata = {
  title: { default: 'Patient portal', template: '%s · Patient portal' },
};

export default function PatientPortalLayout({ children }: { children: React.ReactNode }) {
  return <PatientSessionProvider>{children}</PatientSessionProvider>;
}
