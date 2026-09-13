import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VIP_INCREMENT_MINUTES, VIP_INCREMENT_OPTIONS, vipTotalLabel } from './vipDurations.js';

test('+10 min is offered alongside the existing increments, smallest first', () => {
  assert.deepEqual(VIP_INCREMENT_MINUTES, [10, 15, 30, 60]);
  assert.deepEqual(VIP_INCREMENT_OPTIONS.map(o => o.label), ['+10m', '+15m', '+30m', '+1h']);
});

test('a single +10 press stages exactly 600000 ms', () => {
  const ten = VIP_INCREMENT_OPTIONS.find(o => o.minutes === 10);
  assert.equal(ten.ms, 600000);
});

test('increments ACCUMULATE - two +10 presses are 20 minutes, three are 30', () => {
  const ten = VIP_INCREMENT_OPTIONS.find(o => o.minutes === 10).ms;
  assert.equal(ten * 2, 1200000);
  assert.equal(ten * 3, 1800000);
});

test('mixed increments add correctly', () => {
  const ms = m => VIP_INCREMENT_OPTIONS.find(o => o.minutes === m).ms;
  assert.equal(ms(10) + ms(15), 25 * 60 * 1000);
  assert.equal(ms(10) + ms(60), 70 * 60 * 1000);
  assert.equal(ms(10) + ms(10) + ms(30), 50 * 60 * 1000);
});

test('the running total reads correctly for the operator', () => {
  assert.equal(vipTotalLabel(0), '—');
  assert.equal(vipTotalLabel(600000), '10m');
  assert.equal(vipTotalLabel(1200000), '20m');
  assert.equal(vipTotalLabel(3600000), '1h');
  assert.equal(vipTotalLabel(4200000), '1h 10m');
  assert.equal(vipTotalLabel(25 * 60 * 1000), '25m');
});

test('zero stages nothing, so the confirm button stays disabled', () => {
  assert.equal(vipTotalLabel(0), '—');
  assert.equal(Number(0) > 0, false);
});