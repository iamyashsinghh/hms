'use client';

import { Plus, X } from 'lucide-react';
import type { setup } from '@hms/shared';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';

export type Assignment = { roleId: string; facilityId: string | null };

/** Rows of role + facility ("All facilities" = null). */
export function RoleAssignments({
  value,
  onChange,
  roles,
  facilities,
}: {
  value: Assignment[];
  onChange: (v: Assignment[]) => void;
  roles: setup.Role[];
  facilities: setup.FacilityDetail[];
}) {
  const set = (i: number, patch: Partial<Assignment>) => onChange(value.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  return (
    <div className="space-y-2">
      {value.map((a, i) => (
        <div key={i} className="flex gap-2">
          <Select aria-label="Role" value={a.roleId} onChange={(e) => set(i, { roleId: e.target.value })}>
            <option value="">Choose a role…</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {r.isSystem ? '' : ' (custom)'}
              </option>
            ))}
          </Select>
          <Select aria-label="Facility" value={a.facilityId ?? ''} onChange={(e) => set(i, { facilityId: e.target.value || null })}>
            <option value="">All facilities</option>
            {facilities.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </Select>
          <Button type="button" variant="ghost" size="icon" aria-label="Remove role" onClick={() => onChange(value.filter((_, j) => j !== i))}>
            <X />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...value, { roleId: '', facilityId: null }])}>
        <Plus /> Add role
      </Button>
    </div>
  );
}
