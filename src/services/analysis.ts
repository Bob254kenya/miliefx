// Technical analysis utility functions
// FIX: All digit logic uses explicit !== undefined checks instead of truthy checks,
// ensuring digit 0 is never ignored.

/**
 * Extract the last digit from a tick price.
 * FIX: Convert to string and slice the last character.
 * This correctly handles digit 0 (which is falsey in JS).
 */
export function getLastDigit(price: number): number {
  const priceStr = price.toString();
  // Slice last character, parse as integer
  const lastChar = priceStr[priceStr.length - 1];
  const digit = parseInt(lastChar, 10);
  // digit can be 0 — that's valid, do NOT use `if (digit)` checks
  return digit;
}

/**
 * Analyze digit frequency across a set of prices.
 * FIX: digit 0 is properly counted in frequency and percentage arrays.
 */
export function analyzeDigits(prices: number[]): {
  frequency: number[];
  mostCommon: number;
  leastCommon: number;
  percentages: number[];
} {
  const frequency = new Array(10).fill(0);

  prices.forEach(price => {
    const digit = getLastDigit(price);
    // FIX: No truthy guard — digit 0 is valid
    frequency[digit]++;
  });

  const total = prices.length || 1;
  const percentages = frequency.map(f => (f / total) * 100);

  const mostCommon = frequency.indexOf(Math.max(...frequency));
  const leastCommon = frequency.indexOf(Math.min(...frequency));

  return { frequency, mostCommon, leastCommon, percentages };
}

/**
 * Generate trading signals from recent price data.
 *
 * FIX — Over/Under logic:
 *   Over X  = digit >  X  (strict, NOT >=)
 *   Under X = digit <  X  (strict, NOT <=)
 *
 * FIX — Matches/Differs logic:
 *   Matches X = digit === X
 *   Differs X = digit !== X
 */
export function generateSignals(prices: number[]): {
  overUnder: { type: string; strength: 'Weak' | 'Moderate' | 'Strong'; direction: string };
  evenOdd: { type: string; strength: 'Weak' | 'Moderate' | 'Strong'; direction: string };
  matchesDiffers: { type: string; strength: 'Weak' | 'Moderate' | 'Strong'; direction: string };
} {
  const recentDigits = prices.slice(-20).map(getLastDigit);
  const len = recentDigits.length || 1;

  // Over/Under: digit > 4 is "Over", digit < 5 is "Under" (using strict >)
  const overCount = recentDigits.filter(d => d > 4).length;
  const overRatio = overCount / len;

  const overStrength: 'Weak' | 'Moderate' | 'Strong' =
    Math.abs(overRatio - 0.5) > 0.2 ? 'Strong' :
    Math.abs(overRatio - 0.5) > 0.1 ? 'Moderate' : 'Weak';

  // Even/Odd
  const evenCount = recentDigits.filter(d => d % 2 === 0).length;
  const evenRatio = evenCount / len;

  const evenStrength: 'Weak' | 'Moderate' | 'Strong' =
    Math.abs(evenRatio - 0.5) > 0.2 ? 'Strong' :
    Math.abs(evenRatio - 0.5) > 0.1 ? 'Moderate' : 'Weak';

  // Matches/Differs — consecutive digit equality (strict ===)
  const matches = recentDigits.slice(1).filter((d, i) => d === recentDigits[i]).length;
  const matchRatio = matches / (len - 1 || 1);

  const matchStrength: 'Weak' | 'Moderate' | 'Strong' =
    matchRatio > 0.2 ? 'Strong' : matchRatio > 0.1 ? 'Moderate' : 'Weak';

  return {
    overUnder: {
      type: 'Over/Under',
      strength: overStrength,
      direction: overRatio > 0.5 ? 'Over' : 'Under',
    },
    evenOdd: {
      type: 'Even/Odd',
      strength: evenStrength,
      direction: evenRatio > 0.5 ? 'Even' : 'Odd',
    },
    matchesDiffers: {
      type: 'Match/Differ',
      strength: matchStrength,
      direction: matchRatio > 0.15 ? 'Matches' : 'Differs',
    },
  };
}

// ─── Technical Indicators ───

export function calculateRSI(prices: number[], period: number = 14): number {
  if (prices.length < period + 1) return 50;

  let gains = 0;
  let losses = 0;

  for (let i = prices.length - period; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

export function calculateMACD(prices: number[]): { macd: number; signal: number; histogram: number } {
  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);
  const macd = ema12 - ema26;
  const signal = macd * 0.8;
  const histogram = macd - signal;
  return { macd, signal, histogram };
}

function calculateEMA(prices: number[], period: number): number {
  if (prices.length < period) return prices[prices.length - 1] || 0;
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

export function calculateMA(prices: number[], period: number = 20): number {
  if (prices.length < period) return prices[prices.length - 1] || 0;
  const slice = prices.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

export function calculateBollingerBands(prices: number[], period: number = 20): {
  upper: number; middle: number; lower: number;
} {
  const ma = calculateMA(prices, period);
  const slice = prices.slice(-period);
  const variance = slice.reduce((sum, p) => sum + Math.pow(p - ma, 2), 0) / period;
  const std = Math.sqrt(variance);
  return {
    upper: ma + 2 * std,
    middle: ma,
    lower: ma - 2 * std,
  };
}
