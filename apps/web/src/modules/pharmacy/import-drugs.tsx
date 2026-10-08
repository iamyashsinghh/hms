'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { pharmacy } from '@hms/shared';
import { api } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { BulkImportButton } from '@/components/bulk-import';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/input';

/** Drug master import; rows with batch, expiry, MRP and qty also load opening stock into the chosen store. */
export function ImportDrugsButton() {
  const canStock = usePermission('pharmacy.stock.receive');
  const [storeId, setStoreId] = React.useState('');
  const stores = useQuery({ queryKey: ['pharmacy', 'stores'], queryFn: () => api.pharmacy.stores.list(), enabled: canStock });
  return (
    <BulkImportButton
      noun="drugs"
      columns={pharmacy.ITEM_IMPORT_COLUMNS}
      run={(req) => api.pharmacy.items.import({ ...req, storeId: storeId || undefined })}
      invalidate={[['pharmacy']]}
      optionsKey={storeId}
    >
      {canStock && (
        <div className="max-w-sm space-y-1">
          <Label htmlFor="import-store">Store for opening stock</Label>
          <Select id="import-store" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
            <option value="">No stock, drug master only</option>
            {stores.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <p className="text-xs text-muted-foreground">Rows with batch, expiry, MRP and qty are added to this store as opening stock.</p>
        </div>
      )}
    </BulkImportButton>
  );
}
