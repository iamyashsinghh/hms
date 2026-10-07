import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { setup as S } from '@hms/shared';
import { type Paginated } from '@hms/shared';
import type { z } from 'zod';
import { RequirePermissions } from '../../common/auth/decorators';
import { ZodPipe } from '../../common/validation/zod.pipe';
import { AccessService } from './access.service';

@Controller('setup')
export class AccessController {
  constructor(private readonly access: AccessService) {}

  @Get('users')
  @RequirePermissions('core.user.read')
  listUsers(@Query(new ZodPipe(S.userQuerySchema)) q: z.output<typeof S.userQuerySchema>): Promise<Paginated<S.StaffUser>> {
    return this.access.listUsers(q);
  }

  @Get('users/:id')
  @RequirePermissions('core.user.read')
  getUser(@Param('id', ParseUUIDPipe) id: string): Promise<S.StaffUser> {
    return this.access.getUser(id);
  }

  @Post('users')
  @RequirePermissions('core.user.manage')
  createUser(@Body(new ZodPipe(S.createUserSchema)) body: S.CreateUser): Promise<S.UserWithTemporaryPassword> {
    return this.access.createUser(body);
  }

  @Patch('users/:id')
  @RequirePermissions('core.user.manage')
  updateUser(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(S.updateUserSchema)) body: S.UpdateUser): Promise<S.StaffUser> {
    return this.access.updateUser(id, body);
  }

  @Put('users/:id/roles')
  @RequirePermissions('core.user.manage')
  setRoles(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(S.setUserRolesSchema)) body: S.SetUserRoles): Promise<S.StaffUser> {
    return this.access.setRoles(id, body.roles);
  }

  @Post('users/:id/deactivate')
  @HttpCode(200)
  @RequirePermissions('core.user.manage')
  deactivate(@Param('id', ParseUUIDPipe) id: string): Promise<S.StaffUser> {
    return this.access.deactivate(id);
  }

  @Post('users/:id/activate')
  @HttpCode(200)
  @RequirePermissions('core.user.manage')
  activate(@Param('id', ParseUUIDPipe) id: string): Promise<S.StaffUser> {
    return this.access.activate(id);
  }

  @Post('users/:id/reset-password')
  @HttpCode(200)
  @RequirePermissions('core.user.manage')
  resetPassword(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(S.resetPasswordSchema)) body: S.ResetPassword): Promise<S.ResetPasswordResult> {
    return this.access.resetPassword(id, body);
  }

  @Get('permissions')
  @RequirePermissions('core.role.read')
  permissions(): Promise<S.PermissionCatalogEntry[]> {
    return this.access.permissionCatalog();
  }

  @Get('roles')
  @RequirePermissions('core.role.read')
  listRoles(): Promise<S.Role[]> {
    return this.access.listRoles();
  }

  @Post('roles')
  @RequirePermissions('core.role.manage')
  createRole(@Body(new ZodPipe(S.createRoleSchema)) body: S.CreateRole): Promise<S.Role> {
    return this.access.createRole(body);
  }

  @Patch('roles/:id')
  @RequirePermissions('core.role.manage')
  updateRole(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(S.updateRoleSchema)) body: S.UpdateRole): Promise<S.Role> {
    return this.access.updateRole(id, body);
  }

  @Delete('roles/:id')
  @HttpCode(204)
  @RequirePermissions('core.role.manage')
  deleteRole(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.access.deleteRole(id);
  }
}
