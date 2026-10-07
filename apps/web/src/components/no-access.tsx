import { ShieldAlert } from 'lucide-react';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function NoAccess() {
  return (
    <Card className="mx-auto mt-8 max-w-md text-center">
      <CardHeader className="items-center">
        <ShieldAlert className="size-8 text-destructive" />
        <CardTitle>Access denied</CardTitle>
        <CardDescription>You don&apos;t have permission to view this page.</CardDescription>
      </CardHeader>
    </Card>
  );
}
