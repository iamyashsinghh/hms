// Feature module registry. Owned by the foundation; each module folder is owned by its workstream.
import type { Type } from '@nestjs/common';
import { FrontofficeModule } from './frontoffice/frontoffice.module';
import { EmrModule } from './emr/emr.module';
import { BillingModule } from './billing/billing.module';
import { PharmacyModule } from './pharmacy/pharmacy.module';
import { SetupModule } from './setup/setup.module';
import { PlatformModule } from './platform/platform.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ReportsModule } from './reports/reports.module';
import { PortalModule } from './portal/portal.module';
import { LabModule } from './lab/lab.module';
import { RadiologyModule } from './radiology/radiology.module';
import { IpdModule } from './ipd/ipd.module';
import { InventoryModule } from './inventory/inventory.module';
import { InsuranceModule } from './insurance/insurance.module';
import { CrmModule } from './crm/crm.module';
import { HrModule } from './hr/hr.module';
import { QualityModule } from './quality/quality.module';
import { OpsModule } from './ops/ops.module';
import { IntegrationsModule } from './integrations/integrations.module';

export const FEATURE_MODULES: Type[] = [
  FrontofficeModule,
  EmrModule,
  BillingModule,
  PharmacyModule,
  SetupModule,
  PlatformModule,
  NotificationsModule,
  ReportsModule,
  PortalModule,
  LabModule,
  RadiologyModule,
  IpdModule,
  InventoryModule,
  InsuranceModule,
  CrmModule,
  HrModule,
  QualityModule,
  OpsModule,
  IntegrationsModule,
];
