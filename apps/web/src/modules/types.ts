import type { ComponentType } from 'react';

export interface NavItem {
  label: string;
  href: string;
  /** Hidden unless the user has this permission. */
  permission?: string;
  icon?: ComponentType<{ className?: string }>;
}

export interface NavSection {
  key: string;
  title: string;
  items: NavItem[];
}
