import type { FieldError as RHFFieldError } from 'react-hook-form';

export function FieldError({ error }: { error?: Pick<RHFFieldError, 'message'> }) {
  if (!error?.message) return null;
  return <p className="text-xs text-destructive">{error.message}</p>;
}
