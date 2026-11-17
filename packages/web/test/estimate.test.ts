import { describe, expect, it } from 'vitest';
import { isDurationQuantity, parseEstimateInput } from '../src/screens/estimate.ts';

describe('napkin-math input', () => {
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

  it('reads a duration in seconds, minutes or hours', () => {
    expect(parseEstimateInput('5200', { duration: true })).toBe(5200);
    expect(parseEstimateInput('5,200 s', { duration: true })).toBe(5200);
    expect(parseEstimateInput('87 min', { duration: true })).toBe(5220);
    expect(parseEstimateInput('1.5 hours', { duration: true })).toBe(5400);
    expect(parseEstimateInput('2 h', { duration: true })).toBe(7200);
    expect(parseEstimateInput('3 parsecs', { duration: true })).toBeNull();
    expect(isDurationQuantity('secondsBetweenKeyReads')).toBe(true);
    expect(isDurationQuantity('busyVcpusAtPeak')).toBe(false);
  });

  it('refuses anything that is not one number', () => {
    for (const text of ['', 'lots', '-3', '1e3', '3..5', '2 or 3', '12abc34']) {
      expect(parseEstimateInput(text), text).toBeNull();
    }
  });
});
