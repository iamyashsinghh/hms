'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import type { pharmacy } from '@hms/shared';
import { api } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { buttonVariants } from '@/components/ui/button';
import { ItemForm } from '@/modules/pharmacy/item-form';

export default function NewItemPage() {
  const canManage = usePermission('pharmacy.item.manage');
  const router = useRouter();
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: (body: pharmacy.CreateItem) => api.pharmacy.items.create(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pharmacy'] });
      router.push('/pharmacy/items');
    },
  });
  if (!canManage) return <NoAccess />;
  return (
    <div className="max-w-4xl">
      <Link href="/pharmacy/items" className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-3 mb-2' })}>
        <ArrowLeft /> Drug master
      </Link>
      <PageHeader title="Add drug" />
      <ItemForm submitLabel="Save drug" onSubmit={(v) => create.mutate(v)} pending={create.isPending} error={create.error} />
    </div>
  );
}
