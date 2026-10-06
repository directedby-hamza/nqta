import { expect, it } from 'vitest';
import { money } from '../../src/lib/api';
it('shows the exact minor units on receipts, including the smallest paid amount', () => {
  expect(money(2550)).toContain('25.50');
  expect(money(1)).toContain('0.01');
  expect(money(2500)).toContain('25.00');
});
