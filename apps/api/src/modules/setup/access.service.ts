import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
  and,
  eq,
  facilities,
  hashPassword,
  inArray,
  permissions,
  refreshTokens,
  rolePermissions,
  roles,
  sql,
  tenants,
  userRoles,
  users,
  type Tx,
} from '@hms/db';
import { setup as S } from '@hms/shared';
import { Paginated } from '@hms/shared';
import { APP_CONFIG, type AppConfig } from '../../config';
import { DbService } from '../../common/db/db.service';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../common/errors/errors';
import { OutboxService } from '../../common/events/outbox.service';
import { ctx, slugKey, temporaryPassword } from './setup.util';
import { NotificationsService } from '../notifications/notifications.service';
import { PlatformService } from '../platform/platform.service';
import { StaffService } from './staff.service';

const ADMIN_ROLE = 'hospital_admin';

interface UserRow extends Record<string, unknown> {
  id: string;
  name: string;
  email: string | null;
  mobile: string | null;
  status: S.StaffUser['status'];
  last_login_at: string | null;
  locked_until: string | null;
  created_at: string;
  roles: S.StaffUser['roles'] | null;
  total?: number;
}

const ts = (col: string) => sql.raw(`to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);

const USER_SELECT = sql`
  select u.id, u.name, u.email, u.mobile, u.status,
         ${ts('u.last_login_at')} as last_login_at, ${ts('u.locked_until')} as locked_until, ${ts('u.created_at')} as created_at,
         (select json_agg(json_build_object('roleId', r.id, 'roleKey', r.key, 'roleName', r.name,
                                            'facilityId', ur.facility_id, 'facilityName', f.name) order by r.name, f.name)
            from iam.user_roles ur
            join iam.roles r on r.tenant_id = ur.tenant_id and r.id = ur.role_id
            left join setup.facilities f on f.tenant_id = ur.tenant_id and f.id = ur.facility_id
           where ur.tenant_id = u.tenant_id and ur.user_id = u.id) as roles
    from iam.users u`;

/** Staff user accounts, role assignments per facility, and custom roles. */
@Injectable()
export class AccessService {
  constructor(
    private readonly db: DbService,
    private readonly outbox: OutboxService,
    private readonly staff: StaffService,
    private readonly moduleRef: ModuleRef,
    private readonly platform: PlatformService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Sends login details by SMS and email. NotificationsModule is looked up at call time, not imported,
   * because it imports Patients, which imports Setup (a static import would be circular).
   * Delivery happens after the transaction commits; problems are reported, never thrown.
   */
  private async sendCredentials(
    tx: Tx,
    template: 'staff.invited' | 'staff.password_reset',
    user: { id: string; name: string; email: string | null; mobile: string | null },
    tempPassword: string,
    idempotencyKey: string,
  ): Promise<S.CredentialDelivery[]> {
    const notifications = this.moduleRef.get(NotificationsService, { strict: false });
    const [tenant] = await tx.select({ code: tenants.code }).from(tenants).where(eq(tenants.id, ctx().tenantId)).limit(1);
    const origin = this.config.API_CORS_ORIGINS.split(',')[0]!.trim().replace(/\/$/, '');
    const result = await notifications.send(tx, {
      to: { email: user.email ?? undefined, mobile: user.mobile ?? undefined },
      template,
      data: {
        staffName: user.name,
        hospitalCode: tenant?.code ?? '',
        loginId: user.email ?? user.mobile ?? '',
        tempPassword,
        loginUrl: `${origin}/login`,
      },
      channels: [...(user.mobile ? (['sms'] as const) : []), ...(user.email ? (['email'] as const) : [])],
      idempotencyKey,
      source: { module: 'setup', refId: user.id },
    });
    return result.messages.map((m) => ({ channel: m.channel, status: m.status, reason: m.reason }));
  }

  // ---------- users ----------

  listUsers(q: S.UserQuery & { page: number; pageSize: number }): Promise<Paginated<S.StaffUser>> {
    const term = q.q?.trim().toLowerCase();
    return this.db.tx(async (tx) => {
      const res = await tx.execute<UserRow>(sql`
        select x.*, count(*) over ()::int as total from (${USER_SELECT}
          where true
            ${q.status ? sql`and u.status = ${q.status}` : sql``}
            ${term ? sql`and (lower(u.name) like ${'%' + term + '%'} or lower(coalesce(u.email, '')) like ${term + '%'} or u.mobile like ${term + '%'})` : sql``}
            ${q.roleId ? sql`and exists (select 1 from iam.user_roles ur where ur.tenant_id = u.tenant_id and ur.user_id = u.id and ur.role_id = ${q.roleId})` : sql``}
        ) x
        order by x.name
        limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`);
      let total = res.rows[0]?.total ?? 0;
      if (!res.rows.length && q.page > 1) {
        total = (await tx.execute<{ n: number }>(sql`select count(*)::int as n from iam.users`)).rows[0]?.n ?? 0;
      }
      return { items: res.rows.map(userDto), page: q.page, pageSize: q.pageSize, total };
    });
  }

  getUser(id: string): Promise<S.StaffUser> {
    return this.db.tx((tx) => this.readUser(tx, id));
  }

  private async readUser(tx: Tx, id: string): Promise<S.StaffUser> {
    const res = await tx.execute<UserRow>(sql`${USER_SELECT} where u.id = ${id}`);
    if (!res.rows[0]) throw notFound('User');
    return userDto(res.rows[0]);
  }

  async createUser(input: S.CreateUser): Promise<S.UserWithTemporaryPassword> {
    const c = ctx();
    await this.platform.assertWithinLimit('users');
    const generated = input.password ? undefined : temporaryPassword();
    return this.db.tx(async (tx) => {
      await this.assertContactFree(tx, input.email, input.mobile);
      const roleKeys = await this.checkAssignments(tx, input.roles);
      const [user] = await tx
        .insert(users)
        .values({
          tenantId: c.tenantId,
          name: input.name,
          email: input.email ?? null,
          mobile: input.mobile ?? null,
          passwordHash: await hashPassword(input.password ?? generated!),
          status: 'active',
          createdBy: c.userId,
          updatedBy: c.userId,
        })
        .returning({ id: users.id });
      await this.writeAssignments(tx, user!.id, input.roles);
      if (input.staffProfile) await this.staff.writeProfile(tx, user!.id, input.staffProfile);
      await this.outbox.publish(tx, 'setup.user.created', { userId: user!.id, roleKeys });
      const dto = await this.readUser(tx, user!.id);
      if (!generated) return dto;
      const delivery = await this.sendCredentials(tx, 'staff.invited', dto, generated, `setup:invite:${dto.id}`);
      return { ...dto, temporaryPassword: generated, delivery };
    });
  }

  updateUser(id: string, input: S.UpdateUser): Promise<S.StaffUser> {
    const c = ctx();
    return this.db.tx(async (tx) => {
      const [cur] = await tx.select().from(users).where(eq(users.id, id)).limit(1);
      if (!cur) throw notFound('User');
      const email = input.email === undefined ? cur.email : input.email;
      const mobile = input.mobile === undefined ? cur.mobile : input.mobile;
      if (!email && !mobile) throw badRequest('contact_required', 'A user needs an email or a mobile number');
      await this.assertContactFree(tx, input.email ?? undefined, input.mobile ?? undefined, id);
      await tx
        .update(users)
        .set({
          ...(input.name !== undefined && { name: input.name }),
          email,
          mobile,
          updatedBy: c.userId,
        })
        .where(eq(users.id, id));
      return this.readUser(tx, id);
    });
  }

  setRoles(id: string, assignments: S.RoleAssignmentInput[]): Promise<S.StaffUser> {
    return this.db.tx(async (tx) => {
      await this.readUser(tx, id);
      await this.checkAssignments(tx, assignments);
      await tx.delete(userRoles).where(eq(userRoles.userId, id));
      await this.writeAssignments(tx, id, assignments);
      await this.assertAdminRemains(tx);
      return this.readUser(tx, id);
    });
  }

  deactivate(id: string): Promise<S.StaffUser> {
    const c = ctx();
    if (id === c.userId) throw badRequest('self_deactivate', 'You cannot deactivate your own account');
    return this.db.tx(async (tx) => {
      await this.readUser(tx, id);
      await tx.update(users).set({ status: 'disabled', updatedBy: c.userId }).where(eq(users.id, id));
      await this.assertAdminRemains(tx);
      await this.revokeSessions(tx, id);
      await this.outbox.publish(tx, 'setup.user.deactivated', { userId: id });
      return this.readUser(tx, id);
    });
  }

  activate(id: string): Promise<S.StaffUser> {
    const c = ctx();
    return this.db.tx(async (tx) => {
      const user = await this.readUser(tx, id);
      // Disabled users do not count towards the plan, so bringing one back must fit the limit.
      if (user.status === 'disabled') await this.platform.assertWithinLimit('users');
      await tx.update(users).set({ status: 'active', failedLoginCount: 0, lockedUntil: null, updatedBy: c.userId }).where(eq(users.id, id));
      return this.readUser(tx, id);
    });
  }

  /** Sets a new password (or generates one), unlocks the account and signs the user out everywhere. */
  resetPassword(id: string, input: S.ResetPassword): Promise<S.ResetPasswordResult> {
    const c = ctx();
    const generated = input.password ? undefined : temporaryPassword();
    return this.db.tx(async (tx) => {
      const user = await this.readUser(tx, id);
      await tx
        .update(users)
        .set({ passwordHash: await hashPassword(input.password ?? generated!), failedLoginCount: 0, lockedUntil: null, updatedBy: c.userId })
        .where(eq(users.id, id));
      await this.revokeSessions(tx, id);
      if (!generated) return {};
      const delivery = await this.sendCredentials(tx, 'staff.password_reset', user, generated, `setup:reset:${id}:${Date.now()}`);
      return { temporaryPassword: generated, delivery };
    });
  }

  private async revokeSessions(tx: Tx, userId: string) {
    await tx
      .update(refreshTokens)
      .set({ revokedAt: sql`now()` })
      .where(and(eq(refreshTokens.userId, userId), sql`${refreshTokens.revokedAt} is null`));
  }

  private async assertContactFree(tx: Tx, email?: string | null, mobile?: string | null, exceptId?: string) {
    if (!email && !mobile) return;
    const res = await tx.execute<{ email: string | null; mobile: string | null }>(sql`
      select email, mobile from iam.users
       where (${email ?? null}::text is not null and lower(email) = lower(${email ?? null}::text)
              or ${mobile ?? null}::text is not null and mobile = ${mobile ?? null}::text)
         ${exceptId ? sql`and id <> ${exceptId}` : sql``}
       limit 1`);
    const dup = res.rows[0];
    if (dup) {
      const which = email && dup.email?.toLowerCase() === email.toLowerCase() ? 'email' : 'mobile number';
      throw conflict('duplicate_user', `Another user already has this ${which}`);
    }
  }

  /** Roles and facilities must exist; only a hospital admin can hand out the hospital admin role. */
  private async checkAssignments(tx: Tx, assignments: S.RoleAssignmentInput[]): Promise<string[]> {
    const roleIds = [...new Set(assignments.map((a) => a.roleId))];
    const found = await tx.select({ id: roles.id, key: roles.key }).from(roles).where(inArray(roles.id, roleIds));
    if (found.length !== roleIds.length) throw badRequest('invalid_role', 'Role not found');
    if (found.some((r) => r.key === ADMIN_ROLE) && !ctx().roles.includes(ADMIN_ROLE)) {
      throw forbidden('Only a hospital admin can give the Hospital Admin role');
    }
    const facilityIds = [...new Set(assignments.map((a) => a.facilityId).filter((f): f is string => !!f))];
    if (facilityIds.length) {
      const found = await tx.select({ id: facilities.id }).from(facilities).where(inArray(facilities.id, facilityIds));
      if (found.length !== facilityIds.length) throw badRequest('invalid_facility', 'Facility not found');
    }
    const seen = new Set<string>();
    for (const a of assignments) {
      const k = `${a.roleId}:${a.facilityId ?? ''}`;
      if (seen.has(k)) throw badRequest('duplicate_role', 'The same role is given twice for the same facility');
      seen.add(k);
    }
    return found.map((r) => r.key);
  }

  private async writeAssignments(tx: Tx, userId: string, assignments: S.RoleAssignmentInput[]) {
    const c = ctx();
    await tx.insert(userRoles).values(assignments.map((a) => ({ tenantId: c.tenantId, userId, roleId: a.roleId, facilityId: a.facilityId ?? null })));
  }

  /** Never leave a hospital without an active admin who can sign in and fix things. */
  private async assertAdminRemains(tx: Tx) {
    const res = await tx.execute<{ n: number }>(sql`
      select count(distinct u.id)::int as n from iam.users u
        join iam.user_roles ur on ur.tenant_id = u.tenant_id and ur.user_id = u.id
        join iam.roles r on r.tenant_id = ur.tenant_id and r.id = ur.role_id
       where u.status = 'active' and r.key = ${ADMIN_ROLE} and ur.facility_id is null`);
    if ((res.rows[0]?.n ?? 0) === 0) {
      throw new AppError(HttpStatus.CONFLICT, 'last_admin', 'The hospital must keep at least one active Hospital Admin for all facilities');
    }
  }

  // ---------- roles ----------

  permissionCatalog(): Promise<S.PermissionCatalogEntry[]> {
    return this.db.tx(async (tx) => {
      const rows = await tx.select().from(permissions).orderBy(permissions.module, permissions.key);
      return rows.map((p) => ({ key: p.key, module: p.module, description: p.description }));
    });
  }

  listRoles(): Promise<S.Role[]> {
    return this.db.tx((tx) => this.readRoles(tx));
  }

  private async readRoles(tx: Tx, id?: string): Promise<S.Role[]> {
    const res = await tx.execute<{ id: string; key: string; name: string; is_system: boolean; permissions: string[]; user_count: number }>(sql`
      select r.id, r.key, r.name, r.is_system,
             coalesce((select array_agg(rp.permission_key order by rp.permission_key) from iam.role_permissions rp
                        where rp.tenant_id = r.tenant_id and rp.role_id = r.id), '{}') as permissions,
             (select count(distinct ur.user_id)::int from iam.user_roles ur
                join iam.users u on u.tenant_id = ur.tenant_id and u.id = ur.user_id and u.status <> 'disabled'
               where ur.tenant_id = r.tenant_id and ur.role_id = r.id) as user_count
        from iam.roles r
       ${id ? sql`where r.id = ${id}` : sql``}
       order by r.is_system desc, r.name`);
    return res.rows.map((r) => ({ id: r.id, key: r.key, name: r.name, isSystem: r.is_system, permissions: r.permissions, userCount: r.user_count }));
  }

  private async readRole(tx: Tx, id: string): Promise<S.Role> {
    const [role] = await this.readRoles(tx, id);
    if (!role) throw notFound('Role');
    return role;
  }

  createRole(input: S.CreateRole): Promise<S.Role> {
    const c = ctx();
    return this.db.tx(async (tx) => {
      const key = input.key ?? slugKey(input.name);
      const [dup] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.key, key)).limit(1);
      if (dup) throw conflict('duplicate_role', `A role with key ${key} already exists`);
      await this.assertPermissions(tx, input.permissions);
      const [row] = await tx.insert(roles).values({ tenantId: c.tenantId, key, name: input.name, isSystem: false }).returning({ id: roles.id });
      await this.writePermissions(tx, row!.id, input.permissions);
      return this.readRole(tx, row!.id);
    });
  }

  updateRole(id: string, input: S.UpdateRole): Promise<S.Role> {
    return this.db.tx(async (tx) => {
      const role = await this.readRole(tx, id);
      if (role.isSystem) throw forbidden('System roles cannot be edited. Create a custom role instead.');
      if (input.name !== undefined) await tx.update(roles).set({ name: input.name }).where(eq(roles.id, id));
      if (input.permissions !== undefined) {
        await this.assertPermissions(tx, input.permissions);
        await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, id));
        await this.writePermissions(tx, id, input.permissions);
        // Touch the role so the change shows in the audit log.
        await tx.update(roles).set({ updatedAt: sql`now()` }).where(eq(roles.id, id));
      }
      return this.readRole(tx, id);
    });
  }

  deleteRole(id: string): Promise<void> {
    return this.db.tx(async (tx) => {
      const role = await this.readRole(tx, id);
      if (role.isSystem) throw forbidden('System roles cannot be deleted');
      const [inUse] = await tx.select({ id: userRoles.id }).from(userRoles).where(eq(userRoles.roleId, id)).limit(1);
      if (inUse) throw conflict('role_in_use', 'Remove this role from all users before deleting it');
      await tx.delete(roles).where(eq(roles.id, id));
    });
  }

  private async assertPermissions(tx: Tx, keys: string[]) {
    if (!keys.length) return;
    const found = await tx.select({ key: permissions.key }).from(permissions).where(inArray(permissions.key, keys));
    const known = new Set(found.map((f) => f.key));
    const unknown = keys.filter((k) => !known.has(k));
    if (unknown.length) throw badRequest('unknown_permission', `These permissions do not exist: ${unknown.join(', ')}`, { unknown });
  }

  private async writePermissions(tx: Tx, roleId: string, keys: string[]) {
    const c = ctx();
    const unique = [...new Set(keys)];
    if (unique.length) await tx.insert(rolePermissions).values(unique.map((k) => ({ tenantId: c.tenantId, roleId, permissionKey: k })));
  }
}

function userDto(r: UserRow): S.StaffUser {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    mobile: r.mobile,
    status: r.status,
    roles: r.roles ?? [],
    lastLoginAt: r.last_login_at,
    lockedUntil: r.locked_until,
    createdAt: r.created_at,
  };
}
