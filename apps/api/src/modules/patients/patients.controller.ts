import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  createPatientSchema,
  patientSearchQuerySchema,
  updatePatientSchema,
  type CreatePatient,
  type Paginated,
  type Patient,
  type UpdatePatient,
} from '@hms/shared';
import type { z } from 'zod';
import { RequirePermissions } from '../../common/auth/decorators';
import { ZodPipe } from '../../common/validation/zod.pipe';
import { PatientsService } from './patients.service';

@Controller('patients')
export class PatientsController {
  constructor(private readonly patients: PatientsService) {}

  @Get()
  @RequirePermissions('core.patient.read')
  search(@Query(new ZodPipe(patientSearchQuerySchema)) q: z.output<typeof patientSearchQuerySchema>): Promise<Paginated<Patient>> {
    return this.patients.search(q.q, q.page, q.pageSize);
  }

  @Get(':id')
  @RequirePermissions('core.patient.read')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<Patient> {
    return this.patients.get(id);
  }

  @Post()
  @RequirePermissions('core.patient.create')
  create(@Body(new ZodPipe(createPatientSchema)) body: CreatePatient): Promise<Patient> {
    return this.patients.create(body, { uniqueAbha: true });
  }

  @Patch(':id')
  @RequirePermissions('core.patient.update')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updatePatientSchema)) body: UpdatePatient): Promise<Patient> {
    return this.patients.update(id, body, { uniqueAbha: true });
  }
}
