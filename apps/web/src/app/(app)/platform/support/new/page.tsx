'use client';

import * as React from 'react';
import { Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { platform } from '@hms/shared';
import { api } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { FieldError } from '@/components/field-error';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ErrorBox, humanize } from '@/modules/platform/ui';

type Category = (typeof platform.TICKET_CATEGORIES)[number];

function NewTicketForm() {
  const router = useRouter();
  const qc = useQueryClient();
  const initialCategory = useSearchParams().get('category');
  const category: Category = (platform.TICKET_CATEGORIES as readonly string[]).includes(initialCategory ?? '') ? (initialCategory as Category) : 'technical';
  const { register, handleSubmit, formState } = useForm({
    resolver: zodResolver(platform.createTicketSchema),
    defaultValues: { subject: '', body: '', category, priority: 'normal' as const },
  });
  const create = useMutation({
    mutationFn: (body: platform.CreateTicket) => api.platform.createTicket(body),
    onSuccess: (t) => {
      qc.invalidateQueries({ queryKey: ['platform', 'tickets'] });
      router.push(`/platform/support/${t.id}`);
    },
  });
  const { errors } = formState;

  return (
    <form onSubmit={handleSubmit((v) => create.mutate(v))} noValidate className="space-y-5">
      <ErrorBox error={create.error} />
      <Card>
        <CardContent className="grid gap-5 pt-6 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="subject">Subject *</Label>
            <Input id="subject" className="mt-2" aria-invalid={!!errors.subject} {...register('subject')} />
            <FieldError error={errors.subject} />
          </div>
          <div>
            <Label htmlFor="category">Category</Label>
            <Select id="category" className="mt-2" {...register('category')}>
              {platform.TICKET_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {humanize(c)}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="priority">Priority</Label>
            <Select id="priority" className="mt-2" {...register('priority')}>
              {platform.TICKET_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {humanize(p)}
                </option>
              ))}
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="body">What happened? *</Label>
            <textarea
              id="body"
              rows={7}
              className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="Steps, screen, bill or UHID number. Never share passwords."
              {...register('body')}
            />
            <FieldError error={errors.body} />
          </div>
        </CardContent>
      </Card>
      <div className="flex justify-end gap-2">
        <Link href="/platform/support" className={buttonVariants({ variant: 'outline' })}>
          Cancel
        </Link>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending && <Loader2 className="animate-spin" />} Raise ticket
        </Button>
      </div>
    </form>
  );
}

export default function NewTicketPage() {
  const can = usePermission('platform.ticket.create');
  if (!can) return <NoAccess />;
  return (
    <div className="max-w-3xl">
      <Link href="/platform/support" className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-3 mb-2' })}>
        <ArrowLeft /> Help & support
      </Link>
      <PageHeader title="New support ticket" />
      <Suspense>
        <NewTicketForm />
      </Suspense>
    </div>
  );
}
