import { Construction } from 'lucide-react';
import { moduleName } from '@/modules';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function ComingSoon({ moduleKey }: { moduleKey: string }) {
  const name = moduleName(moduleKey);
  return (
    <Card className="mx-auto mt-8 max-w-xl text-center">
      <CardHeader className="items-center">
        <div className="mb-2 flex size-12 items-center justify-center rounded-full bg-secondary text-primary">
          <Construction className="size-6" />
        </div>
        <CardTitle className="text-xl">{name} — coming soon</CardTitle>
        <CardDescription>This module is under construction.</CardDescription>
      </CardHeader>
      <CardContent />
    </Card>
  );
}
