import { Injectable } from '@nestjs/common';
import type { hr as contracts } from '@hms/shared';
import { DbService } from '../../common/db/db.service';
import { EmployeesService, toEmployee } from './employees.service';
import { RosterService } from './roster.service';

/**
 * What other modules may use from HR (import HrModule):
 * - `employeeForUser(userId)`: the HR record behind a staff login, or null.
 * - `onDuty(date)`: who is rostered on which shift (ward boards, mobile staff app, IPD nursing).
 */
@Injectable()
export class HrService {
  constructor(
    private readonly db: DbService,
    private readonly employees: EmployeesService,
    private readonly roster: RosterService,
  ) {}

  employeeForUser(userId: string): Promise<contracts.Employee | null> {
    return this.db.tx(async (tx) => {
      const row = await this.employees.findByUser(tx, userId);
      return row ? toEmployee(row, null) : null;
    });
  }

  onDuty(date: string): Promise<contracts.OnDutyRow[]> {
    return this.roster.onDuty(date);
  }
}
