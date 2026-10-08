'use client';

import * as React from 'react';
import { use } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { IndentForm } from '@/modules/inventory/indent-form';
import { statusLabel } from '@/modules/inventory/ui';

export default function EditIndentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const canCreate = usePermission('inventory.indent.create');
  const indent = useQuery({ queryKey: ['inventory', 'indents', id], queryFn: () => api.inventory.indents.get(id), enabled: canCreate });

  if (!canCreate) return <NoAccess />;
  if (indent.isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (indent.error) return <p className="text-sm text-destructive">{errorMessage(indent.error)}</p>;
  const i = indent.data;

  return (
    <>
      <Link href={`/inventory/indents/${id}`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Indent {i.number}
      </Link>
      <PageHeader title={`Edit indent ${i.number}`} description="An indent can be changed until the store approves or rejects it." />
      {i.status === 'submitted' ? (
        <IndentForm key={i.id} indent={i} />
      ) : (
        <p className="rounded-md border px-3 py-2 text-sm text-muted-foreground">This indent is {statusLabel(i.status).toLowerCase()} and can no longer be edited.</p>
      )}
    </>
  );
}
