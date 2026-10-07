'use client';

import type { ReactNode } from 'react';
import { useAuth } from './auth-context';

/** True if the signed-in user has the permission (or no permission is required). */
export function usePermission(key?: string): boolean {
  const { user } = useAuth();
  if (!key) return true;
  return user?.permissions.includes(key) ?? false;
}

export function Can({ permission, children, fallback = null }: { permission?: string; children: ReactNode; fallback?: ReactNode }) {
  return usePermission(permission) ? children : fallback;
}
