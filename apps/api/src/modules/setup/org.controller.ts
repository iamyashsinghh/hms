import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { setup as S } from '@hms/shared';
import { z } from 'zod';
import { RequirePermissions } from '../../common/auth/decorators';
import { ZodPipe } from '../../common/validation/zod.pipe';
import { OrgService } from './org.service';

const departmentQuery = S.listQuerySchema.extend({ facilityId: z.uuid().optional() });
type ListQ = z.output<typeof S.listQuerySchema>;

@Controller('setup')
export class OrgController {
  constructor(private readonly org: OrgService) {}

  @Get('facilities')
  @RequirePermissions('core.facility.read')
  listFacilities(@Query(new ZodPipe(S.listQuerySchema)) q: ListQ): Promise<S.FacilityDetail[]> {
    return this.org.listFacilities(q);
  }

  @Get('facilities/:id')
  @RequirePermissions('core.facility.read')
  getFacility(@Param('id', ParseUUIDPipe) id: string): Promise<S.FacilityDetail> {
    return this.org.getFacility(id);
  }

  @Post('facilities')
  @RequirePermissions('core.facility.manage')
  createFacility(@Body(new ZodPipe(S.createFacilitySchema)) body: S.CreateFacility): Promise<S.FacilityDetail> {
    return this.org.createFacility(body);
  }

  @Patch('facilities/:id')
  @RequirePermissions('core.facility.manage')
  updateFacility(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(S.updateFacilitySchema)) body: S.UpdateFacility): Promise<S.FacilityDetail> {
    return this.org.updateFacility(id, body);
  }

  @Get('departments')
  @RequirePermissions('setup.department.read')
  listDepartments(@Query(new ZodPipe(departmentQuery)) q: z.output<typeof departmentQuery>): Promise<S.Department[]> {
    return this.org.listDepartments(q);
  }

  @Post('departments')
  @RequirePermissions('setup.department.manage')
  createDepartment(@Body(new ZodPipe(S.createDepartmentSchema)) body: S.CreateDepartment): Promise<S.Department> {
    return this.org.createDepartment(body);
  }

  @Patch('departments/:id')
  @RequirePermissions('setup.department.manage')
  updateDepartment(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(S.updateDepartmentSchema)) body: S.UpdateDepartment): Promise<S.Department> {
    return this.org.updateDepartment(id, body);
  }

  @Get('specializations')
  @RequirePermissions('setup.department.read')
  listSpecializations(@Query(new ZodPipe(S.listQuerySchema)) q: ListQ): Promise<S.Specialization[]> {
    return this.org.listSpecializations(q);
  }

  @Post('specializations')
  @RequirePermissions('setup.department.manage')
  createSpecialization(@Body(new ZodPipe(S.createSpecializationSchema)) body: S.CreateSpecialization): Promise<S.Specialization> {
    return this.org.createSpecialization(body);
  }

  @Patch('specializations/:id')
  @RequirePermissions('setup.department.manage')
  updateSpecialization(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(S.updateSpecializationSchema)) body: S.UpdateSpecialization,
  ): Promise<S.Specialization> {
    return this.org.updateSpecialization(id, body);
  }
}
