import type { platform as P } from '@hms/shared';
import { cn } from '@/lib/utils';
import { dateTime } from './ui';

/** Conversation view shared by the hospital ticket page and the super-admin console. */
export function TicketThread({ messages, mine }: { messages: P.TicketMessage[]; mine: P.TicketMessage['authorType'] }) {
  return (
    <div className="space-y-3">
      {messages.map((m) => (
        <div key={m.id} className={cn('flex', m.authorType === mine ? 'justify-end' : 'justify-start')}>
          <div
            className={cn(
              'max-w-[85%] rounded-lg border px-4 py-3 text-sm shadow-sm',
              m.isInternal ? 'border-amber-300 bg-amber-50' : m.authorType === mine ? 'bg-secondary/70' : 'bg-card',
            )}
          >
            <p className="mb-1 text-xs text-muted-foreground">
              <b className="text-foreground">{m.authorName}</b> · {dateTime(m.createdAt)}
              {m.isInternal && ' · internal note'}
            </p>
            <p className="whitespace-pre-line">{m.body}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
