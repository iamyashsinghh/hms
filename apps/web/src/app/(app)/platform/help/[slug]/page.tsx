'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ErrorBox } from '@/modules/platform/ui';

export default function HelpArticlePage() {
  const { slug } = useParams<{ slug: string }>();
  const can = usePermission('platform.help.read');
  const a = useQuery({ queryKey: ['platform', 'help-article', slug], queryFn: () => api.platform.helpArticle(slug), enabled: can });
  if (!can) return <NoAccess />;
  if (a.isPending) return <Loader2 className="mx-auto mt-16 size-6 animate-spin text-muted-foreground" />;
  if (a.error) return <ErrorBox error={a.error} />;
  return (
    <div className="max-w-3xl">
      <Link href="/platform/support" className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-3 mb-2' })}>
        <ArrowLeft /> Help & support
      </Link>
      <PageHeader title={a.data.title} description={a.data.summary} />
      <Card>
        <CardContent className="whitespace-pre-line pt-6 text-sm leading-relaxed">{a.data.body}</CardContent>
      </Card>
      <p className="mt-4 text-sm text-muted-foreground">
        Still stuck?{' '}
        <Link href="/platform/support/new" className="text-primary hover:underline">
          Raise a ticket
        </Link>
        .
      </p>
    </div>
  );
}
