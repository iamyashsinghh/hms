import * as SecureStore from 'expo-secure-store';
import type { RxFavourite, RxLine } from '@/data/types';
import { data } from './data';

// Favourites come from the EMR (shared with the web app). When the EMR is not on the server they are
// kept on the phone instead, small on purpose: SecureStore values should stay under 2 KB.
const KEY = 'hms.rx.favourites';
const MAX_LOCAL = 12;

async function readLocal(): Promise<RxFavourite[]> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as RxFavourite[]).filter((f) => typeof f?.name === 'string' && Array.isArray(f.lines)) : [];
  } catch {
    return [];
  }
}

export interface FavouriteStore {
  items: RxFavourite[];
  /** True when favourites live on this phone only. */
  local: boolean;
}

export async function loadFavourites(): Promise<FavouriteStore> {
  const server = await data.favourites().catch(() => null);
  return server ? { items: server, local: false } : { items: await readLocal(), local: true };
}

export async function addFavourite(store: FavouriteStore, line: RxLine): Promise<FavouriteStore> {
  const name = line.drugName.trim().slice(0, 100);
  const { allergyOverrideReason: _drop, ...clean } = line;
  if (!store.local) {
    const fav = await data.saveFavourite(name, [clean]);
    return { ...store, items: [fav, ...store.items] };
  }
  const items = [
    { id: `local-${Date.now()}`, name, lines: [clean] },
    ...store.items.filter((f) => f.name.toLowerCase() !== name.toLowerCase()),
  ].slice(0, MAX_LOCAL);
  await SecureStore.setItemAsync(KEY, JSON.stringify(items));
  return { ...store, items };
}

export async function removeFavourite(store: FavouriteStore, id: string): Promise<FavouriteStore> {
  const items = store.items.filter((f) => f.id !== id);
  if (store.local) await SecureStore.setItemAsync(KEY, JSON.stringify(items));
  else await data.deleteFavourite(id);
  return { ...store, items };
}
