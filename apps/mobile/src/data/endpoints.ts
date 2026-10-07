/**
 * Every API path the mobile apps call outside @hms/api-client's core methods.
 * Paths come from PARALLEL_PLAN.md section 4. Where the plan leaves a path open (Rx create, portal auth),
 * these are the mobile thread's defaults, sent to the coordinator for the owners to confirm.
 * When an owner lands a different path, change it here only.
 */
export const ENDPOINTS = {
  emr: {
    queue: '/emr/queue',
    timeline: (patientId: string) => `/emr/patients/${patientId}/timeline`,
    createPrescription: '/emr/prescriptions',
  },
  frontoffice: {
    queue: '/frontoffice/queue',
  },
  setup: {
    doctors: '/setup/doctors',
  },
  reports: {
    ownerSummary: '/reports/owner-summary',
  },
  notifications: {
    devices: '/notifications/devices',
  },
  portal: {
    otpRequest: '/portal/auth/otp/request',
    otpVerify: '/portal/auth/otp/verify',
    refresh: '/portal/auth/refresh',
    logout: '/portal/auth/logout',
    me: '/portal/me',
    appointments: '/portal/appointments',
    prescriptions: '/portal/prescriptions',
    bills: '/portal/bills',
  },
} as const;
