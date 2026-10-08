'use client';

import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { IndentForm } from '@/modules/inventory/indent-form';

export default function NewIndentPage() {
  const canCreate = usePermission('inventory.indent.create');
  if (!canCreate) return <NoAccess />;

  return (
    <>
      <PageHeader title="New indent" description="Ask the central store for supplies for your ward or department." />
      <IndentForm />
    </>
  );
}
