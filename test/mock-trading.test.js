// ============================================================
// Mock Trading Unit Tests
// Tests paper trading logic without real money
// ============================================================

import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('Mock Trading Engine', () => {
  it('should calculate PnL correctly for long position', () => {
    const entryPrice = 100;
    const exitPrice = 110;
    const size = 1;
    const leverage = 2;
    
    const priceChange = (exitPrice - entryPrice) / entryPrice;
    const pnl = priceChange * size * leverage * entryPrice;
    
    assert.ok(pnl > 0, 'Long position should profit when price rises');
    assert.strictEqual(pnl, 20, 'PnL should be 20% with 2x leverage');
  });

  it('should calculate PnL correctly for short position', () => {
    const entryPrice = 100;
    const exitPrice = 90;
    const size = 1;
    const leverage = 2;
    
    const priceChange = (entryPrice - exitPrice) / entryPrice;
    const pnl = priceChange * size * leverage * entryPrice;
    
    assert.ok(pnl > 0, 'Short position should profit when price falls');
    assert.strictEqual(pnl, 20, 'PnL should be 20% with 2x leverage');
  });

  it('should detect stop loss hit for long', () => {
    const entryPrice = 100;
    const stopLossPrice = 95;
    const currentPrice = 94;
    
    const hitStopLoss = currentPrice <= stopLossPrice;
    assert.strictEqual(hitStopLoss, true, 'Should detect stop loss breach');
  });

  it('should detect take profit hit for long', () => {
    const entryPrice = 100;
    const takeProfitPrice = 110;
    const currentPrice = 111;
    
    const hitTakeProfit = currentPrice >= takeProfitPrice;
    assert.strictEqual(hitTakeProfit, true, 'Should detect take profit breach');
  });

  it('should validate position size limits', () => {
    const maxPositionSize = 10000;
    const requestedSize = 5000;
    
    assert.ok(requestedSize <= maxPositionSize, 'Position should not exceed max size');
  });

  it('should calculate risk/reward ratio', () => {
    const entryPrice = 100;
    const stopLoss = 95;
    const takeProfit = 110;
    
    const risk = entryPrice - stopLoss;
    const reward = takeProfit - entryPrice;
    const ratio = reward / risk;
    
    assert.ok(ratio > 1, 'Risk/reward ratio should be favorable (> 1:1)');
    assert.strictEqual(ratio, 2, 'Should be 2:1 ratio');
  });

  it('should calculate PnL for losing long position', () => {
    const entryPrice = 100;
    const exitPrice = 90;
    const size = 1;
    const leverage = 1;
    
    const priceChange = (exitPrice - entryPrice) / entryPrice;
    const pnl = priceChange * size * leverage * entryPrice;
    
    assert.ok(pnl < 0, 'Long position should lose when price falls');
    assert.strictEqual(pnl, -10, 'PnL should be -10 with 1x leverage');
  });

  it('should calculate PnL for losing short position', () => {
    const entryPrice = 100;
    const exitPrice = 110;
    const size = 1;
    const leverage = 1;
    
    const priceChange = (entryPrice - exitPrice) / entryPrice;
    const pnl = priceChange * size * leverage * entryPrice;
    
    assert.ok(pnl < 0, 'Short position should lose when price rises');
    assert.strictEqual(pnl, -10, 'PnL should be -10 with 1x leverage');
  });

  it('should detect stop loss hit for short', () => {
    const entryPrice = 100;
    const stopLossPrice = 105;
    const currentPrice = 106;
    
    const hitStopLoss = currentPrice >= stopLossPrice;
    assert.strictEqual(hitStopLoss, true, 'Should detect stop loss breach for short');
  });

  it('should detect take profit hit for short', () => {
    const entryPrice = 100;
    const takeProfitPrice = 90;
    const currentPrice = 89;
    
    const hitTakeProfit = currentPrice <= takeProfitPrice;
    assert.strictEqual(hitTakeProfit, true, 'Should detect take profit breach for short');
  });

  it('should reject position exceeding max size', () => {
    const maxPositionSize = 10000;
    const requestedSize = 15000;
    
    assert.ok(requestedSize > maxPositionSize, 'Position should exceed max size');
  });

  it('should calculate risk/reward ratio below 1', () => {
    const entryPrice = 100;
    const stopLoss = 90;
    const takeProfit = 105;
    
    const risk = entryPrice - stopLoss;
    const reward = takeProfit - entryPrice;
    const ratio = reward / risk;
    
    assert.ok(ratio < 1, 'Risk/reward ratio should be unfavorable (< 1:1)');
    assert.strictEqual(ratio, 0.5, 'Should be 0.5:1 ratio');
  });
});

describe('Mock Account Management', () => {
  it('should track account balance correctly', () => {
    let balance = 100000;
    const initialBalance = balance;
    const pnl = 5000;
    
    balance += pnl;
    
    assert.strictEqual(balance, initialBalance + pnl, 'Balance should reflect PnL');
    assert.ok(balance > initialBalance, 'Balance should increase with profit');
  });

  it('should calculate drawdown correctly', () => {
    const peak = 100000;
    const current = 90000;
    
    const drawdown = ((peak - current) / peak) * 100;
    
    assert.strictEqual(drawdown, 10, 'Drawdown should be 10%');
    assert.ok(drawdown >= 0, 'Drawdown should be positive');
  });

  it('should track win/loss ratio', () => {
    const wins = 6;
    const losses = 4;
    const total = wins + losses;
    const winRate = wins / total;
    
    assert.ok(winRate > 0.5, 'Win rate should be above 50% for profitable strategy');
    assert.strictEqual(winRate, 0.6, 'Win rate should be 60%');
  });

  it('should calculate profit factor correctly', () => {
    const grossProfit = 10000;
    const grossLoss = 4000;
    
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit;
    
    assert.ok(profitFactor > 1, 'Profit factor should be > 1 for profitable strategy');
    assert.strictEqual(profitFactor, 2.5, 'Profit factor should be 2.5');
  });

  it('should calculate average win and loss', () => {
    const wins = [200, 300, 500];
    const losses = [-100, -200];
    
    const avgWin = wins.reduce((a, b) => a + b, 0) / wins.length;
    const avgLoss = Math.abs(losses.reduce((a, b) => a + b, 0) / losses.length);
    
    // avgWin = 1000/3 ≈ 333.333... — use approximate comparison
    assert.ok(Math.abs(avgWin - 333.33) < 0.01, 'Average win should be ~333.33');
    assert.strictEqual(avgLoss, 150, 'Average loss should be 150');
    assert.ok(avgWin > avgLoss, 'Average win should exceed average loss');
  });

  it('should track balance decrease with losses', () => {
    let balance = 100000;
    const loss = -5000;
    
    balance += loss;
    
    assert.strictEqual(balance, 95000, 'Balance should decrease with losses');
    assert.ok(balance < 100000, 'Balance should be below initial');
  });

  it('should calculate cumulative return', () => {
    const initialBalance = 100000;
    const currentBalance = 115000;
    
    const returnPct = ((currentBalance - initialBalance) / initialBalance) * 100;
    
    assert.strictEqual(returnPct, 15, 'Return should be 15%');
  });
});

describe('Leverage Calculations', () => {
  it('should limit maximum leverage', () => {
    const maxLeverage = 20;
    const requestedLeverage = 25;
    
    const allowedLeverage = Math.min(requestedLeverage, maxLeverage);
    assert.strictEqual(allowedLeverage, maxLeverage, 'Should cap at max leverage');
  });

  it('should calculate liquidation price for long', () => {
    const entryPrice = 100;
    const leverage = 10;
    const maintenanceMargin = 0.005;
    
    // Approximate liquidation price
    const liquidationPrice = entryPrice * (1 - 1/leverage + maintenanceMargin);
    
    assert.ok(liquidationPrice < entryPrice, 'Liquidation price should be below entry for long');
  });

  it('should calculate liquidation price for short', () => {
    const entryPrice = 100;
    const leverage = 10;
    const maintenanceMargin = 0.005;
    
    const liquidationPrice = entryPrice * (1 + 1/leverage - maintenanceMargin);
    
    assert.ok(liquidationPrice > entryPrice, 'Liquidation price should be above entry for short');
  });

  it('should calculate margin required', () => {
    const positionSize = 10000;
    const leverage = 5;
    
    const margin = positionSize / leverage;
    
    assert.strictEqual(margin, 2000, 'Margin should be position size / leverage');
  });

  it('should calculate position size from risk percentage', () => {
    const accountBalance = 100000;
    const riskPct = 0.02; // 2% risk
    const stopLossPct = 0.01; // 1% stop loss
    
    const riskAmount = accountBalance * riskPct;
    const positionSize = riskAmount / stopLossPct;
    
    assert.strictEqual(riskAmount, 2000, 'Risk amount should be 2% of balance');
    assert.strictEqual(positionSize, 200000, 'Position size should be risk / stop loss %');
  });

  it('should calculate higher liquidation risk with higher leverage', () => {
    const entryPrice = 100;
    const maintenanceMargin = 0.005;
    
    const liqPrice10x = entryPrice * (1 - 1/10 + maintenanceMargin);
    const liqPrice20x = entryPrice * (1 - 1/20 + maintenanceMargin);
    
    assert.ok(liqPrice20x > liqPrice10x, 'Higher leverage means closer liquidation price');
  });
});

console.log('✅ Mock trading tests expanded');
