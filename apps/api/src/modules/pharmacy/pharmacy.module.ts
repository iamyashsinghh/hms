import { Module } from '@nestjs/common';

/**
 * Pharmacy. Owned by the "pharmacy" workstream (see PARALLEL_PLAN.md).
 * Layout: pharmacy.controller.ts (routes), pharmacy.service.ts (rules), pharmacy.repository.ts (Drizzle),
 * permissions and Zod contracts in packages/shared/src/modules/pharmacy.ts. Follow src/modules/patients as the example.
 */
@Module({})
export class PharmacyModule {}
