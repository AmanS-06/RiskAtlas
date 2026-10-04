import { describe, expect, it } from 'vitest';
import { formatUnit, num, pct, pp, pts, withUnit } from './format';

describe('format', () => {
  it('formats units from config strings', () => {
    expect(formatUnit('kg/m2')).toBe('kg/m²');
    expect(formatUnit('cells/mm3')).toBe('cells/mm³');
    expect(formatUnit('1000/mm3')).toBe('1000/mm³');
    expect(formatUnit('percent')).toBe('%');
    expect(formatUnit('mg/dL')).toBe('mg/dL');
    expect(formatUnit(null)).toBe('');
  });
  it('puts the percent sign in the UI only', () => {
    expect(pct(0.9628826)).toBe('96%');
    expect(pct(0.9628826, 1)).toBe('96.3%');
    expect(pct(0)).toBe('0%');
  });
  it('signs percentage points and uses a real minus', () => {
    expect(pp(0.0447)).toBe('+4.5 pp');
    expect(pp(-0.0201)).toBe('−2.0 pp');
    expect(pp(0.00001)).toBe('0.0 pp');
    expect(pts(-0.2008)).toBe('20.1 pp');
  });
  it('trims numbers and joins units', () => {
    expect(num(26.775510204)).toBe('26.78');
    expect(num(160)).toBe('160');
    expect(withUnit(160, 'mmHg')).toBe('160 mmHg');
    expect(withUnit(32, 'percent')).toBe('32%');
  });
});
