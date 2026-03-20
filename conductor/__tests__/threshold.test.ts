import { checkThreshold } from '../threshold';

describe('checkThreshold', () => {
  test('checkThreshold(30, 10, 0.50) → passed: true, winningProportion: 0.75', () => {
    expect(checkThreshold(30, 10, 0.50)).toEqual({ passed: true, winningProportion: 0.75 });
  });

  test('checkThreshold(20, 20, 0.50) → passed: true, winningProportion: 0.50 (exact tie passes)', () => {
    expect(checkThreshold(20, 20, 0.50)).toEqual({ passed: true, winningProportion: 0.50 });
  });

  test('checkThreshold(26, 14, 0.65) → passed: true, winningProportion: 0.65 (exact threshold passes)', () => {
    expect(checkThreshold(26, 14, 0.65)).toEqual({ passed: true, winningProportion: 0.65 });
  });

  test('checkThreshold(25, 15, 0.65) → passed: false, winningProportion: 0.625', () => {
    expect(checkThreshold(25, 15, 0.65)).toEqual({ passed: false, winningProportion: 0.625 });
  });

  test('checkThreshold(0, 0, 0.50) → passed: false, winningProportion: 0 (no votes)', () => {
    expect(checkThreshold(0, 0, 0.50)).toEqual({ passed: false, winningProportion: 0 });
  });

  test('checkThreshold(39, 1, 0.95) → passed: true, winningProportion: 0.975', () => {
    expect(checkThreshold(39, 1, 0.95)).toEqual({ passed: true, winningProportion: 0.975 });
  });

  test('checkThreshold(37, 3, 0.95) → passed: false, winningProportion: 0.925', () => {
    expect(checkThreshold(37, 3, 0.95)).toEqual({ passed: false, winningProportion: 0.925 });
  });
});
