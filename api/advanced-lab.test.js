import test from 'node:test';
import assert from 'node:assert/strict';
import { runWalkForward, calculatePortfolioAccounting } from './advanced-lab.js';

const candles = Array.from({ length: 1000 }, (_, i) => {
  const close = 100 + i * 0.025 + Math.sin(i / 8) * 2;
  return [1700000000000 + i * 3600000, close - .2, close + .8, close - .8, close, 1000 + i];
});

test('walk-forward selects parameters only from prior training windows and reports OOS folds', () => {
  const result = runWalkForward(candles, { trainBars: 400, testBars: 100, stepBars: 100, fastPeriods: [5, 9], slowPeriods: [21, 30] });
  assert.ok(result.folds.length >= 5);
  assert.ok(Number.isFinite(result.aggregateOutOfSample.totalReturnPercent));
  assert.ok(result.folds.every(f => f.testStart > f.trainEnd));
  assert.ok(result.folds.every(f => f.selectedParameters.slow > f.selectedParameters.fast));
  assert.ok(result.folds.every(f => f.outOfSample.observations === 100));
  assert.match(result.method, /out-of-sample/);
});

test('walk-forward rejects inadequate history and invalid parameter grids', () => {
  assert.throws(() => runWalkForward(candles.slice(0, 80)), /100/);
  assert.throws(() => runWalkForward(candles, { fastPeriods: [20], slowPeriods: [10] }), /parameter grid/);
});

test('weighted-average accounting calculates realized and marked unrealized PnL', () => {
  const events = [
    { eventType: 'fill', source: 'bitget', accountId: 'main', symbol: 'BTC/USDT', side: 'buy', quantity: 2, price: 100, fee: 0, occurredAt: '2026-01-01T00:00:00.000Z' },
    { eventType: 'fill', source: 'bitget', accountId: 'main', symbol: 'BTC/USDT', side: 'sell', quantity: 1, price: 120, fee: .1, feeCurrency: 'USDT', occurredAt: '2026-01-02T00:00:00.000Z' }
  ];
  const result = calculatePortfolioAccounting(events, { 'BTC/USDT': 110 });
  assert.equal(result.positions.length, 1);
  assert.equal(result.positions[0].quantity, 1);
  assert.equal(result.positions[0].averageCost, 100);
  assert.ok(Math.abs(result.positions[0].realizedPnl - 19.9) < 1e-9);
  assert.equal(result.positions[0].unrealizedPnl, 10);
  assert.equal(result.feesByCurrency.USDT, .1);
});

test('accounting keeps accounts and exchanges segregated', () => {
  const rows = ['binance', 'bitget'].map(source => ({ eventType: 'fill', source, accountId: 'acct', symbol: 'ETH/USDT', side: 'buy', quantity: 1, price: 50, occurredAt: '2026-01-01T00:00:00.000Z' }));
  const result = calculatePortfolioAccounting(rows);
  assert.equal(result.positions.length, 2);
});

test('portfolio journal tracks deposits, withdrawals, funding and transfers as currency movements', () => {
  const events = [
    { eventType: 'deposit', source: 'okx', accountId: 'main', currency: 'USDT', quantity: 100, occurredAt: '2026-01-01T00:00:00.000Z' },
    { eventType: 'funding', source: 'okx', accountId: 'main', currency: 'USDT', quantity: .5, metadata: { signedAmount: -.5 }, occurredAt: '2026-01-02T00:00:00.000Z' },
    { eventType: 'transfer', source: 'okx', accountId: 'main', metadata: { fromCurrency: 'USDT', fromAmount: 10, toCurrency: 'USDC', toAmount: 9.99 }, occurredAt: '2026-01-03T00:00:00.000Z' },
    { eventType: 'withdrawal', source: 'okx', accountId: 'main', currency: 'USDT', quantity: 5, occurredAt: '2026-01-04T00:00:00.000Z' }
  ];
  const result = calculatePortfolioAccounting(events);
  const usdt = result.assetMovements.find(x => x.currency === 'USDT');
  const usdc = result.assetMovements.find(x => x.currency === 'USDC');
  assert.equal(usdt.netMovement, 84.5);
  assert.equal(usdc.netMovement, 9.99);
});
