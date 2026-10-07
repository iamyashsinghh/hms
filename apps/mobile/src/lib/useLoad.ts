import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@hms/api-client';
import { FeatureUnavailableError } from '@/data/client';
import type { Loaded } from '@/data/types';

export interface LoadState<T> {
  data: T | null;
  demo: boolean;
  /** First load (no data yet). */
  loading: boolean;
  /** Pull-to-refresh in progress. */
  refreshing: boolean;
  error: string | null;
  /** The server does not have this module yet (release build without demo data). */
  unavailable: boolean;
  reload: () => void;
}

export function errorMessage(err: unknown): string {
  if (err instanceof FeatureUnavailableError) return err.message;
  if (err instanceof ApiError) {
    if (err.status === 403) return 'You do not have permission for this.';
    if (err.status === 404) return 'Not found.';
    return err.message;
  }
  if (err instanceof TypeError) return 'Cannot reach the server. Check your internet connection.';
  return err instanceof Error ? err.message : String(err);
}

/**
 * Loads data for a screen: re-runs when `key` changes and when the screen regains focus,
 * optionally polls every `pollMs`, and ignores responses that arrive after a newer request.
 */
export function useLoad<T>(fn: () => Promise<Loaded<T>>, key: string, opts: { pollMs?: number } = {}): LoadState<T> {
  const [state, setState] = useState<Omit<LoadState<T>, 'reload'>>({
    data: null,
    demo: false,
    loading: true,
    refreshing: false,
    error: null,
    unavailable: false,
  });
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const seq = useRef(0);

  const run = useCallback((mode: 'initial' | 'refresh' | 'silent') => {
    const id = ++seq.current;
    setState((s) => ({
      ...s,
      loading: mode === 'initial',
      refreshing: mode === 'refresh',
      ...(mode === 'initial' ? { data: null, error: null } : {}),
    }));
    fnRef
      .current()
      .then((res) => {
        if (id !== seq.current) return;
        setState({ data: res.data, demo: res.demo, loading: false, refreshing: false, error: null, unavailable: false });
      })
      .catch((err: unknown) => {
        if (id !== seq.current) return;
        setState((s) => ({
          ...s,
          loading: false,
          refreshing: false,
          // A failed background refresh keeps the last good data on screen.
          error: mode === 'silent' && s.data !== null ? s.error : errorMessage(err),
          unavailable: err instanceof FeatureUnavailableError,
        }));
      });
  }, []);

  useEffect(() => {
    run('initial');
  }, [key, run]);

  const first = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      run('silent');
    }, [run]),
  );

  useEffect(() => {
    if (!opts.pollMs) return;
    const t = setInterval(() => run('silent'), opts.pollMs);
    return () => clearInterval(t);
  }, [opts.pollMs, key, run]);

  return { ...state, reload: () => run('refresh') };
}
