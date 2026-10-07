'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Maximize, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth, usePermission } from '@/lib/auth';
import { NoAccess } from '@/components/no-access';

/**
 * Waiting-room TV board. Covers the app shell, refreshes every 5 seconds, and announces newly
 * called tokens with the browser's speech synthesis (English + Hindi voice if the TV has one).
 */
export default function QueueDisplayPage() {
  const canView = usePermission('frontoffice.queue.display');
  const { user } = useAuth();
  const [clock, setClock] = React.useState(() => new Date());
  const lastCalled = React.useRef<Map<string, number>>(new Map());

  const { data, isError } = useQuery({
    queryKey: ['frontoffice', 'display'],
    queryFn: () => api.frontoffice.display(),
    enabled: canView,
    refetchInterval: 5_000,
    refetchIntervalInBackground: true,
  });

  React.useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  React.useEffect(() => {
    if (!data || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    for (const d of data.doctors) {
      const now = d.nowServing?.tokenNo;
      const prev = lastCalled.current.get(d.doctorId);
      if (now && prev !== undefined && prev !== now) {
        const room = d.nowServing?.room ? `, ${d.nowServing.room}` : '';
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(`Token number ${now}, please go to ${d.doctorName}${room}`));
      }
      if (now) lastCalled.current.set(d.doctorId, now);
    }
  }, [data]);

  if (!canView) return <NoAccess />;

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-slate-950 text-white">
      <header className="flex items-center justify-between border-b border-white/10 px-8 py-4">
        <div>
          <div className="text-2xl font-semibold">{user?.tenantName}</div>
          <div className="text-sm text-white/60">OPD queue</div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-3xl font-semibold tabular-nums">
              {clock.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}
            </div>
            <div className="text-sm text-white/60">
              {clock.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' })}
            </div>
          </div>
          <button
            className="rounded-md p-2 text-white/50 hover:bg-white/10 hover:text-white"
            aria-label="Full screen"
            onClick={() => document.documentElement.requestFullscreen?.()}
          >
            <Maximize className="size-5" />
          </button>
          <Link href="/frontoffice" className="rounded-md p-2 text-white/50 hover:bg-white/10 hover:text-white" aria-label="Close display">
            <X className="size-5" />
          </Link>
        </div>
      </header>

      <main className="grid flex-1 auto-rows-fr gap-6 overflow-hidden p-8 md:grid-cols-2 xl:grid-cols-3">
        {isError && <p className="text-white/60">Connection lost. Retrying…</p>}
        {data && data.doctors.length === 0 && (
          <div className="col-span-full flex items-center justify-center text-3xl text-white/50">No patients in the queue yet.</div>
        )}
        {data?.doctors.map((d) => (
          <section key={d.doctorId} className="flex flex-col rounded-2xl bg-white/5 p-6 ring-1 ring-white/10">
            <div className="flex items-baseline justify-between">
              <h2 className="text-2xl font-semibold">{d.doctorName}</h2>
              <span className="text-sm text-white/60">{d.waitingCount} waiting</span>
            </div>
            <div className="mt-4 rounded-xl bg-emerald-500/15 p-5 ring-1 ring-emerald-400/30">
              <div className="text-sm uppercase tracking-wider text-emerald-300">Now serving</div>
              {d.nowServing ? (
                <div className="flex items-end justify-between">
                  <div className="text-7xl font-bold tabular-nums text-emerald-300">{d.nowServing.tokenNo}</div>
                  <div className="text-right">
                    <div className="text-xl">{d.nowServing.patientName}</div>
                    {d.nowServing.room && <div className="text-lg text-white/70">{d.nowServing.room}</div>}
                  </div>
                </div>
              ) : (
                <div className="text-3xl text-white/40">—</div>
              )}
            </div>
            <div className="mt-4 text-sm uppercase tracking-wider text-white/60">Next</div>
            <ul className="mt-2 space-y-2">
              {d.next.map((n) => (
                <li key={n.tokenNo} className="flex items-center justify-between rounded-lg bg-white/5 px-4 py-2 text-xl">
                  <span className="font-semibold tabular-nums">{n.tokenNo}</span>
                  <span className="text-white/80">{n.patientName}</span>
                </li>
              ))}
              {d.next.length === 0 && <li className="text-white/40">No one waiting</li>}
            </ul>
          </section>
        ))}
      </main>
    </div>
  );
}
