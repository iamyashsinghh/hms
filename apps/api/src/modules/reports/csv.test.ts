import { describe, expect, it } from 'vitest';
import { toCsv } from './csv';

describe('toCsv', () => {
  it('quotes, escapes and neutralises formulas', () => {
    const out = toCsv([{ a: 'x,y', b: 'say "hi"', c: '=SUM(A1)', d: 12.5, e: null }]);
    expect(out).toBe('﻿a,b,c,d,e\r\n"x,y","say ""hi""",\'=SUM(A1),12.5,\r\n');
  });

  it('writes only a header when there are no rows but columns are given', () => {
    expect(toCsv([], ['date', 'amount'])).toBe('﻿date,amount\r\n');
  });
});
