/**
 * Bot Engine — Strategy logic for all 5 automated bots.
 * Each bot exports an `evaluate` function that returns
 * { shouldTrade, contractType, barrier?, reason }.
 *
 * CRITICAL: digit 0 is NEVER ignored. All comparisons use strict operators.
 */

import { getLastDigit } from './analysis';

export interface BotDecision {
  shouldTrade: boolean;
  contractType: string;
  barrier?: string;
  reason: string;
}

export interface BotConfig {
  stake: number;
  martingale: boolean;
  multiplier: number;
  maxRecovery: number;
  stopLoss: number;
  takeProfit: number;
}

// ─── Shared Helpers ───

/** Check if same digit repeats N times consecutively at the end */
export function hasConsecutiveRepeat(digits: number[], times: number): boolean {
  if (digits.length < times) return false;
  const tail = digits.slice(-times);
  return tail.every(d => d === tail[0]);
}

/** Compute tick momentum: count of increasing ticks in last N */
export function tickMomentum(prices: number[], window: number = 5): { rising: number; falling: number } {
  if (prices.length < window) return { rising: 0, falling: 0 };
  const slice = prices.slice(-window);
  let rising = 0, falling = 0;
  for (let i = 1; i < slice.length; i++) {
    if (slice[i] > slice[i - 1]) rising++;
    else if (slice[i] < slice[i - 1]) falling++;
  }
  return { rising, falling };
}

/** Compute digit frequency from array of digits */
export function digitFrequency(digits: number[]): number[] {
  const freq = new Array(10).fill(0);
  digits.forEach(d => { freq[d]++; });
  return freq;
}

/** Detect if spread is choppy (tick changes alternate direction frequently) */
export function isChoppy(prices: number[], window: number = 10): boolean {
  if (prices.length < window) return false;
  const slice = prices.slice(-window);
  let changes = 0;
  for (let i = 2; i < slice.length; i++) {
    const prev = slice[i - 1] - slice[i - 2];
    const curr = slice[i] - slice[i - 1];
    if ((prev > 0 && curr < 0) || (prev < 0 && curr > 0)) changes++;
  }
  return changes / (window - 2) > 0.7;
}

/** AI Confidence Score (0-100) based on multiple factors */
export function calculateConfidence(
  digits: number[],
  consecutiveLosses: number,
): number {
  if (digits.length < 10) return 0;

  const freq = digitFrequency(digits);
  const len = digits.length;
  const pcts = freq.map(f => (f / len) * 100);

  // Factor 1: Digit imbalance (max deviation from 10%)
  const maxDeviation = Math.max(...pcts.map(p => Math.abs(p - 10)));
  const imbalanceScore = Math.min(maxDeviation * 3, 40); // 0-40

  // Factor 2: Frequency deviation (standard deviation of percentages)
  const mean = 10;
  const variance = pcts.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / 10;
  const stdDev = Math.sqrt(variance);
  const deviationScore = Math.min(stdDev * 5, 30); // 0-30

  // Factor 3: Recent loss streak penalty
  const lossPenalty = Math.min(consecutiveLosses * 10, 30);

  // Factor 4: Sample size bonus
  const sampleBonus = Math.min(len / 5, 20); // 0-20

  const score = Math.max(0, Math.min(100, imbalanceScore + deviationScore + sampleBonus - lossPenalty));
  return Math.round(score);
}

// ─── BOT 1: Over 2 Recovery 5 ───

export function evaluateOver2(digits: number[], prices: number[]): BotDecision {
  if (digits.length < 3) return { shouldTrade: false, contractType: '', reason: 'Need 3+ digits' };

  // Safety: don't trade if same digit repeats 4 times
  if (hasConsecutiveRepeat(digits, 4)) {
    return { shouldTrade: false, contractType: '', reason: 'Safety: 4x consecutive repeat' };
  }

  const last3 = digits.slice(-3);
  const allBelow3 = last3.every(d => d < 3); // digits 0, 1, 2

  const len = digits.length;
  const underCount = digits.filter(d => d < 3).length;
  const underPct = (underCount / len) * 100;

  // Digit 0 frequency spike
  const freq = digitFrequency(digits);
  const zeroPct = (freq[0] / len) * 100;
  const zeroSpike = zeroPct > 12;

  if (allBelow3 && underPct > 52 && zeroSpike) {
    return {
      shouldTrade: true,
      contractType: 'DIGITOVER',
      barrier: '2',
      reason: `Last 3 below 3, Under%=${underPct.toFixed(1)}, 0-spike=${zeroPct.toFixed(1)}%`,
    };
  }

  // Relaxed entry: just last 3 below 3 + under > 52%
  if (allBelow3 && underPct > 52) {
    return {
      shouldTrade: true,
      contractType: 'DIGITOVER',
      barrier: '2',
      reason: `Last 3 below 3, Under%=${underPct.toFixed(1)}%`,
    };
  }

  return { shouldTrade: false, contractType: '', reason: 'Conditions not met' };
}

// ─── BOT 2: Under 6 Recovery 4 ───

export function evaluateUnder6(digits: number[], prices: number[]): BotDecision {
  if (digits.length < 3) return { shouldTrade: false, contractType: '', reason: 'Need 3+ digits' };

  const last3 = digits.slice(-3);
  const allAbove6 = last3.every(d => d > 6); // digits 7, 8, 9

  const len = digits.length;
  const overCount = digits.filter(d => d > 6).length;
  const overPct = (overCount / len) * 100;

  if (allAbove6 && overPct > 52) {
    return {
      shouldTrade: true,
      contractType: 'DIGITUNDER',
      barrier: '6',
      reason: `Last 3 above 6, Over%=${overPct.toFixed(1)}%`,
    };
  }

  return { shouldTrade: false, contractType: '', reason: 'Conditions not met' };
}

// ─── BOT 3: Even/Odd ───

export function evaluateEvenOdd(digits: number[]): BotDecision {
  if (digits.length < 20) return { shouldTrade: false, contractType: '', reason: 'Need 20+ digits' };

  const analysisDigits = digits.slice(-100);
  const len = analysisDigits.length;
  const evenCount = analysisDigits.filter(d => d % 2 === 0).length;
  const evenPct = (evenCount / len) * 100;
  const oddPct = 100 - evenPct;

  // Wait for sequence confirmation: 4 consecutive same parity before entering opposite
  const last4 = digits.slice(-4);
  const last4AllEven = last4.every(d => d % 2 === 0);
  const last4AllOdd = last4.every(d => d % 2 !== 0);

  if (evenPct > 53 && last4AllEven) {
    return {
      shouldTrade: true,
      contractType: 'DIGITODD',
      reason: `Even=${evenPct.toFixed(1)}% + 4 consecutive even → Trade Odd`,
    };
  }

  if (oddPct > 53 && last4AllOdd) {
    return {
      shouldTrade: true,
      contractType: 'DIGITEVEN',
      reason: `Odd=${oddPct.toFixed(1)}% + 4 consecutive odd → Trade Even`,
    };
  }

  return { shouldTrade: false, contractType: '', reason: 'Conditions not met' };
}

// ─── BOT 4: Matches/Differs ───

export function evaluateMatchesDiffers(digits: number[]): BotDecision {
  if (digits.length < 20) return { shouldTrade: false, contractType: '', reason: 'Need 20+ digits' };

  const freq = digitFrequency(digits);
  const len = digits.length;
  const pcts = freq.map(f => (f / len) * 100);

  // Find dominant digit
  const maxPct = Math.max(...pcts);
  const dominantDigit = pcts.indexOf(maxPct);

  // Don't trade if digit repeats 3 times consecutively
  if (hasConsecutiveRepeat(digits, 3)) {
    return { shouldTrade: false, contractType: '', reason: 'Safety: 3x consecutive repeat' };
  }

  if (maxPct > 18) {
    return {
      shouldTrade: true,
      contractType: 'DIGITDIFF',
      barrier: String(dominantDigit),
      reason: `Digit ${dominantDigit} at ${maxPct.toFixed(1)}% > 18% → Trade Differs`,
    };
  }

  return { shouldTrade: false, contractType: '', reason: 'No dominant digit (>18%)' };
}

// ─── BOT 5: Rise/Fall ───

export function evaluateRiseFall(prices: number[]): BotDecision {
  if (prices.length < 5) return { shouldTrade: false, contractType: '', reason: 'Need 5+ prices' };

  if (isChoppy(prices, 10)) {
    return { shouldTrade: false, contractType: '', reason: 'Choppy market — skipping' };
  }

  const { rising, falling } = tickMomentum(prices, 5);

  if (rising >= 4) {
    return {
      shouldTrade: true,
      contractType: 'CALL', // Rise = CALL in Deriv API
      reason: `4/5 ticks rising → Enter Fall (mean reversion)`,
    };
  }

  if (falling >= 4) {
    return {
      shouldTrade: true,
      contractType: 'PUT', // Fall = PUT in Deriv API
      reason: `4/5 ticks falling → Enter Rise (mean reversion)`,
    };
  }

  return { shouldTrade: false, contractType: '', reason: 'No clear momentum' };
}
