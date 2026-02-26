/**
 * Smart Signal Engine — Scans ALL volatilities for digit dominance.
 * Produces validated signals with digit confirmation before any trade.
 */

import { derivApi, MARKETS, type MarketSymbol } from './deriv-api';
import { getLastDigit } from './analysis';
import { digitFrequency } from './bot-engine';

export interface DigitRanking {
  digit: number;
  count: number;
  pct: number;
}

export interface MarketSignal {
  symbol: MarketSymbol;
  marketName: string;
  digits: number[];
  rankings: DigitRanking[];
  most: DigitRanking;
  second: DigitRanking;
  third: DigitRanking;
  least: DigitRanking;
  signalStrength: number; // 0-10
  isValid: boolean;
  validationReason: string;
  suggestedContract: string;
  suggestedBarrier: string;
  overPct: number;
  underPct: number;
  evenPct: number;
  oddPct: number;
}

/**
 * Analyze a set of digits and produce ranked digit info + signal.
 */
export function analyzeMarketDigits(
  digits: number[],
  symbol: MarketSymbol,
  marketName: string,
): MarketSignal {
  const len = digits.length || 1;
  const freq = digitFrequency(digits);

  const rankings: DigitRanking[] = freq
    .map((count, digit) => ({ digit, count, pct: (count / len) * 100 }))
    .sort((a, b) => b.count - a.count);

  const most = rankings[0];
  const second = rankings[1];
  const third = rankings[2];
  const least = rankings[rankings.length - 1];

  // Over/Under/Even/Odd stats
  const overCount = digits.filter(d => d >= 6).length;
  const underCount = digits.filter(d => d <= 4).length;
  const evenCount = digits.filter(d => d % 2 === 0).length;
  const oddCount = digits.filter(d => d % 2 !== 0).length;

  const overPct = (overCount / len) * 100;
  const underPct = (underCount / len) * 100;
  const evenPct = (evenCount / len) * 100;
  const oddPct = (oddCount / len) * 100;

  // Signal validation: 2nd and 3rd must be "dominant" + least must be isolated
  const topThreeTotal = most.pct + second.pct + third.pct;
  const imbalance = most.pct - least.pct;

  // Signal strength (0-10)
  let strength = 0;
  if (imbalance > 5) strength += 2;
  if (imbalance > 10) strength += 2;
  if (imbalance > 15) strength += 2;
  if (second.pct > 12) strength += 1;
  if (third.pct > 11) strength += 1;
  if (topThreeTotal > 40) strength += 1;
  if (least.pct < 5) strength += 1;
  strength = Math.min(10, strength);

  const isValid = strength >= 4 && second.pct > 11 && third.pct > 10 && imbalance > 6;

  let validationReason = '';
  if (!isValid) {
    if (strength < 4) validationReason = `Strength ${strength} < 4`;
    else if (imbalance <= 6) validationReason = `Imbalance ${imbalance.toFixed(1)}% too low`;
    else validationReason = 'Insufficient digit dominance';
  } else {
    validationReason = `Strength ${strength}, Imbalance ${imbalance.toFixed(1)}%, Top3 ${topThreeTotal.toFixed(1)}%`;
  }

  // Default suggestion: OVER 1 when strength >= 4
  let suggestedContract = 'DIGITOVER';
  let suggestedBarrier = '1';

  if (isValid) {
    // Digit confirmation for Over: find digits frequently above barrier
    if (overPct > 55) {
      suggestedContract = 'DIGITUNDER';
      suggestedBarrier = '6';
    } else if (underPct > 55) {
      suggestedContract = 'DIGITOVER';
      suggestedBarrier = '1';
    } else if (evenPct > 55) {
      suggestedContract = 'DIGITODD';
      suggestedBarrier = '';
    } else if (oddPct > 55) {
      suggestedContract = 'DIGITEVEN';
      suggestedBarrier = '';
    } else {
      // Default: OVER 1 (per requirement)
      suggestedContract = 'DIGITOVER';
      suggestedBarrier = '1';
    }
  }

  return {
    symbol,
    marketName,
    digits,
    rankings,
    most,
    second,
    third,
    least,
    signalStrength: strength,
    isValid,
    validationReason,
    suggestedContract,
    suggestedBarrier,
    overPct,
    underPct,
    evenPct,
    oddPct,
  };
}

/**
 * Validates digit eligibility before trade execution.
 * OVER: checks digits frequently appearing above barrier
 * UNDER: checks digits frequently appearing below barrier
 * EVEN: checks even digit dominance
 * ODD: checks odd digit dominance
 */
export function validateDigitEligibility(
  digits: number[],
  contractType: string,
  barrier: number,
): { eligible: boolean; reason: string; dominantDigits: number[] } {
  if (digits.length < 10) {
    return { eligible: false, reason: 'Need 10+ ticks for analysis', dominantDigits: [] };
  }

  const len = digits.length;
  const freq = digitFrequency(digits);

  if (contractType === 'DIGITOVER') {
    // Find digits that appear above the barrier
    const aboveDigits = digits.filter(d => d > barrier);
    const abovePct = (aboveDigits.length / len) * 100;
    const dominantAbove = freq
      .map((c, i) => ({ digit: i, count: c }))
      .filter(d => d.digit > barrier)
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .map(d => d.digit);

    if (abovePct < 40) {
      return { eligible: false, reason: `Over ${barrier} only ${abovePct.toFixed(1)}% — need 40%+`, dominantDigits: dominantAbove };
    }
    return { eligible: true, reason: `Over ${barrier} at ${abovePct.toFixed(1)}% ✓`, dominantDigits: dominantAbove };
  }

  if (contractType === 'DIGITUNDER') {
    const belowDigits = digits.filter(d => d < barrier);
    const belowPct = (belowDigits.length / len) * 100;
    const dominantBelow = freq
      .map((c, i) => ({ digit: i, count: c }))
      .filter(d => d.digit < barrier)
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .map(d => d.digit);

    if (belowPct < 40) {
      return { eligible: false, reason: `Under ${barrier} only ${belowPct.toFixed(1)}% — need 40%+`, dominantDigits: dominantBelow };
    }
    return { eligible: true, reason: `Under ${barrier} at ${belowPct.toFixed(1)}% ✓`, dominantDigits: dominantBelow };
  }

  if (contractType === 'DIGITEVEN') {
    const evenCount = digits.filter(d => d % 2 === 0).length;
    const evenPct = (evenCount / len) * 100;
    if (evenPct < 48) {
      return { eligible: false, reason: `Even at ${evenPct.toFixed(1)}% — weak`, dominantDigits: [0, 2, 4, 6, 8] };
    }
    return { eligible: true, reason: `Even at ${evenPct.toFixed(1)}% ✓`, dominantDigits: [0, 2, 4, 6, 8] };
  }

  if (contractType === 'DIGITODD') {
    const oddCount = digits.filter(d => d % 2 !== 0).length;
    const oddPct = (oddCount / len) * 100;
    if (oddPct < 48) {
      return { eligible: false, reason: `Odd at ${oddPct.toFixed(1)}% — weak`, dominantDigits: [1, 3, 5, 7, 9] };
    }
    return { eligible: true, reason: `Odd at ${oddPct.toFixed(1)}% ✓`, dominantDigits: [1, 3, 5, 7, 9] };
  }

  return { eligible: true, reason: 'No digit validation needed', dominantDigits: [] };
}

/**
 * Determine recovery action per the Over/Under strategy rules:
 * - Normal: OVER 1
 * - After ANY loss: switch to OVER 3 (recovery mode)
 * - Martingale only if next trade WINS
 */
export interface RecoveryState {
  inRecovery: boolean;
  lastWasLoss: boolean;
  pendingMartingale: boolean; // true when last loss occurred, waiting for next win
  baseStake: number;
  currentStake: number;
}

export function getRecoveryAction(
  state: RecoveryState,
  multiplier: number,
  lastResult: 'won' | 'lost' | null,
): { barrier: string; nextStake: number; newState: RecoveryState } {
  const newState = { ...state };

  if (lastResult === 'lost') {
    // Switch to recovery mode
    newState.inRecovery = true;
    newState.lastWasLoss = true;
    newState.pendingMartingale = true;
    // DO NOT increase stake on loss — reset to base
    newState.currentStake = state.baseStake;
  } else if (lastResult === 'won') {
    if (state.pendingMartingale) {
      // WIN after a loss → apply martingale NOW
      newState.currentStake = state.currentStake * multiplier;
      newState.pendingMartingale = false;
    } else {
      // Consecutive win → keep multiplying
      newState.currentStake = state.currentStake * multiplier;
    }
    newState.lastWasLoss = false;
    // Stay in recovery if we were in it, until a clean streak
    if (!state.lastWasLoss) {
      newState.inRecovery = false;
    }
  }

  // Barrier: normal = OVER 1, recovery = OVER 3
  const barrier = newState.inRecovery ? '3' : '1';

  return {
    barrier,
    nextStake: newState.currentStake,
    newState,
  };
}
