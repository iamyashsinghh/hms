'use client';

import { use } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import type { pharmacy } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Button, buttonVariants } from '@/components/ui/button';
import { ItemForm } from '@/modules/pharmacy/item-form';

export default function EditItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const canRead = usePermission('pharmacy.item.read');
  const canManage = usePermission('pharmacy.item.manage');
  const queryClient = useQueryClient();
  const { data: item, isPending, error } = useQuery({ queryKey: ['pharmacy', 'items', id], queryFn: () => api.pharmacy.items.get(id), enabled: canRead });
  const update = useMutation({
    mutationFn: (body: pharmacy.UpdateItem) => api.pharmacy.items.update(id, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pharmacy'] }),
  });

  if (!canRead) return <NoAccess />;
  return (
    <div className="max-w-4xl">
      <Link href="/pharmacy/items" className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-3 mb-2' })}>
        <ArrowLeft /> Drug master
      </Link>
      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : error ? (
        <p className="text-sm text-destructive">{errorMessage(error)}</p>
      ) : (
        <>
          <PageHeader
            title={item.name}
            description={`${item.code}${item.isActive ? '' : ' · inactive'}`}
            actions={
              canManage && (
                <Button variant="outline" disabled={update.isPending} onClick={() => update.mutate({ isActive: !item.isActive })}>
                  {item.isActive ? 'Deactivate' : 'Activate'}
                </Button>
              )
            }
          />
          {update.isSuccess && <p className="mb-4 text-sm text-primary">Saved.</p>}
          {canManage ? (
            <ItemForm
              key={item.updatedAt}
              initial={item}
              submitLabel="Save changes"
              onSubmit={(values) =>
                // Emptied optional fields go as '' so the server clears them (undefined would leave the old value).
                update.mutate({ ...values, genericName: values.genericName ?? '', strength: values.strength ?? '', manufacturer: values.manufacturer ?? '', hsnCode: values.hsnCode ?? '' })
              }
              pending={update.isPending}
              error={update.error}
            />
          ) : (
            <p className="text-sm text-muted-foreground">You can view this drug but not edit it.</p>
          )}
        </>
      )}
    </div>
  );
}
