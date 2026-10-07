import * as SecureStore from 'expo-secure-store';
import type { RxDraftLine } from '@/data/rx';

// Doctor's favourite medicines, kept on the phone. Small on purpose: SecureStore values should stay under 2 KB.
// Server-side favourites (shared with web) come with the EMR module; this is the offline-friendly lite version.
const KEY = 'hms.rx.favourites';
const MAX = 12;

export type Favourite = Pick<RxDraftLine, 'drugName' | 'dose' | 'frequency' | 'days'>;

export async function loadFavourites(): Promise<Favourite[]> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as Favourite[]).filter((f) => typeof f?.drugName === 'string') : [];
  } catch {
    return [];
  }
}

export async function saveFavourite(f: Favourite, current: Favourite[]): Promise<Favourite[]> {
  const name = f.drugName.trim();
  const trim = (v: string, n: number) => v.trim().slice(0, n);
  const entry: Favourite = { drugName: trim(name, 40), dose: trim(f.dose, 20), frequency: trim(f.frequency, 10), days: trim(f.days, 3) };
  const next = [entry, ...current.filter((x) => x.drugName.toLowerCase() !== name.toLowerCase())].slice(0, MAX);
  await SecureStore.setItemAsync(KEY, JSON.stringify(next));
  return next;
}

export async function removeFavourite(drugName: string, current: Favourite[]): Promise<Favourite[]> {
  const next = current.filter((x) => x.drugName !== drugName);
  await SecureStore.setItemAsync(KEY, JSON.stringify(next));
  return next;
}
