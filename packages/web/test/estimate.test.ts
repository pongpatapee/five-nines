import { describe, expect, it } from 'vitest';
import { parseEstimateInput } from '../src/screens/estimate.ts';

describe('napkin-maths input', () => {
  it('reads the numbers people type', () => {
    expect(parseEstimateInput('3.5')).toBe(3.5);
    expect(parseEstimateInput(' 50 ')).toBe(50);
    expect(parseEstimateInput('19,200')).toBe(19200);
    expect(parseEstimateInput('19 200')).toBe(19200);
    expect(parseEstimateInput('1,234,567')).toBe(1234567);
    expect(parseEstimateInput('3,5')).toBe(3.5);
    expect(parseEstimateInput('73%')).toBe(73);
    expect(parseEstimateInput('50 vCPUs')).toBe(50);
    expect(parseEstimateInput('3800 reads/s')).toBe(3800);
    expect(parseEstimateInput('.5')).toBe(0.5);
  });

  it('refuses anything that is not one number', () => {
    for (const text of ['', 'lots', '-3', '1e3', '3..5', '2 or 3', '12abc34']) {
      expect(parseEstimateInput(text), text).toBeNull();
    }
  });
});
