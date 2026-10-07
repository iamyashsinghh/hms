import { hr as contracts } from '@hms/shared';

const R = contracts.PAYROLL_RULES;

export interface PayslipInput {
  daysInMonth: number;
  /** Days of the month the person was on the rolls (joining/exit inside the month). */
  employedDays: number;
  /** Loss-of-pay days: absences, half days (0.5) and unpaid leave. */
  lopDays: number;
  basic: number;
  hra: number;
  otherAllowances: number;
  pfApplicable: boolean;
  esiApplicable: boolean;
  professionalTax: number;
  tds: number;
  otherEarnings?: number;
  otherDeductions?: number;
}

export interface PayslipAmounts {
  payableDays: number;
  lopDays: number;
  basic: number;
  hra: number;
  otherAllowances: number;
  otherEarnings: number;
  gross: number;
  pfEmployee: number;
  esiEmployee: number;
  professionalTax: number;
  tds: number;
  otherDeductions: number;
  totalDeductions: number;
  netPay: number;
  pfEmployer: number;
  esiEmployer: number;
}

/** Works in paise so the totals always add up. */
const p = (rupees: number) => Math.round(rupees * 100);
const r = (paise: number) => paise / 100;

/**
 * One month's pay. Fixed pay is pro-rated by payable days over calendar days. PF is 12% of earned basic
 * (capped at the PF wage ceiling), ESI applies while the full monthly gross is within the ESI ceiling;
 * both are rounded to the rupee (ESI upwards), as the challans are.
 */
export function computePayslip(i: PayslipInput): PayslipAmounts {
  const lopDays = Math.min(i.lopDays, i.employedDays);
  const payableDays = Math.max(0, i.employedDays - lopDays);
  const factor = i.daysInMonth > 0 ? payableDays / i.daysInMonth : 0;

  const basic = Math.round(p(i.basic) * factor);
  const hra = Math.round(p(i.hra) * factor);
  const otherAllowances = Math.round(p(i.otherAllowances) * factor);
  const otherEarnings = p(i.otherEarnings ?? 0);
  const gross = basic + hra + otherAllowances + otherEarnings;

  const pfBase = Math.min(basic, p(R.pfWageCeiling));
  const pfEmployee = i.pfApplicable ? Math.round((pfBase * R.pfRate) / 100) * 100 : 0;
  const pfEmployer = pfEmployee;

  const fullGross = i.basic + i.hra + i.otherAllowances;
  const esiCovered = i.esiApplicable && fullGross <= R.esiGrossCeiling && gross > 0;
  const esiEmployee = esiCovered ? Math.ceil((gross * R.esiEmployeeRate) / 100) * 100 : 0;
  const esiEmployer = esiCovered ? Math.ceil((gross * R.esiEmployerRate) / 100) * 100 : 0;

  const professionalTax = payableDays > 0 ? p(i.professionalTax) : 0;
  const tds = p(i.tds);
  const otherDeductions = p(i.otherDeductions ?? 0);
  const totalDeductions = pfEmployee + esiEmployee + professionalTax + tds + otherDeductions;

  return {
    payableDays,
    lopDays,
    basic: r(basic),
    hra: r(hra),
    otherAllowances: r(otherAllowances),
    otherEarnings: r(otherEarnings),
    gross: r(gross),
    pfEmployee: r(pfEmployee),
    esiEmployee: r(esiEmployee),
    professionalTax: r(professionalTax),
    tds: r(tds),
    otherDeductions: r(otherDeductions),
    totalDeductions: r(totalDeductions),
    netPay: r(gross - totalDeductions),
    pfEmployer: r(pfEmployer),
    esiEmployer: r(esiEmployer),
  };
}
