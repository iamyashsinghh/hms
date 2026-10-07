'use client';

import Link from 'next/link';
import { Building2, ShieldCheck, UserPlus, Users } from 'lucide-react';
import { roleLabel } from '@/lib/format';
import { Can, useAuth } from '@/lib/auth';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export default function DashboardPage() {
  const { user, facility } = useAuth();
  if (!user) return null;

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-r from-primary to-accent px-6 py-8 text-white">
          <p className="text-sm text-white/80">{greeting()},</p>
          <h1 className="mt-1 text-2xl font-semibold">{user.name}</h1>
          <p className="mt-1 text-sm text-white/80">Welcome to {user.tenantName}.</p>
        </div>
        <CardContent className="grid gap-6 pt-6 sm:grid-cols-3">
          <div>
            <p className="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
              <ShieldCheck className="size-4" /> Roles
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {user.roles.map((r) => (
                <Badge key={r}>{roleLabel(r)}</Badge>
              ))}
            </div>
          </div>
          <div>
            <p className="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
              <Building2 className="size-4" /> Hospital
            </p>
            <p className="mt-2 font-medium">{user.tenantName}</p>
            <p className="text-sm text-muted-foreground">Code: {user.tenantCode}</p>
          </div>
          <div>
            <p className="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
              <Building2 className="size-4" /> Facility
            </p>
            <p className="mt-2 font-medium">{facility?.name ?? 'None assigned'}</p>
            {facility && <p className="text-sm text-muted-foreground">Code: {facility.code}</p>}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Can permission="core.patient.read">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="size-5 text-primary" /> Patients
              </CardTitle>
              <CardDescription>Search the patient master and view demographics.</CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/patients" className={buttonVariants({ variant: 'outline' })}>
                Open patients
              </Link>
            </CardContent>
          </Card>
        </Can>
        <Can permission="core.patient.create">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserPlus className="size-5 text-accent" /> Register patient
              </CardTitle>
              <CardDescription>Create a new patient record with a UHID.</CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/patients/new" className={buttonVariants()}>
                New registration
              </Link>
            </CardContent>
          </Card>
        </Can>
      </div>
    </div>
  );
}
