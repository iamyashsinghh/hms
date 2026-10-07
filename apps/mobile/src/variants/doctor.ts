import type { VariantConfig } from './types';

export const doctor: VariantConfig = {
  key: 'doctor',
  title: 'HMS Doctor',
  tagline: 'Your OPD, patients and rounds in your pocket',
  tabs: ['queue', 'patients', 'home', 'profile'],
  landing: '/queue',
};
