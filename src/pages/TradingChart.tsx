import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import {
  TrendingUp,
  TrendingDown,
  Activity,
  Target,
  Zap,
  Volume2,
  Clock,
  BarChart3,
  ArrowUp,
  ArrowDown,
  Gauge,
  Signal,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Play,
  Pause,
  RefreshCw,
  Flame,
  AlertTriangle,
  BarChart,
  Eye,
  EyeOff,
  Layers,
  Timer,
  Brain,
  Shield,
  Star,
  Award,
  Hash,
  Circle,
  Divide,
  Equal,
  Percent
} from 'lucide-react';

// Market configurations
const VOLATILITIES = {
  vol: ["1HZ10V", "1HZ25V", "1HZ50V", "1HZ75V", "1HZ100V", "R_10", "R_25", "R_50", "R_75", "R_100"],
  jump: ["JD10", "JD25", "JD50", "JD75", "JD100"],
  bull: ["RDBULL"],
  bear: ["RDBEAR"],
};

const ALL_MARKETS = [
  ...VOLATILITIES.vol.map(s => ({ 
    symbol: s, 
    name: s, 
    group: s.includes('1HZ') ? 'vol1s' : 'vol', 
    baseVol: parseInt(s.match(/\d+/)?.[0] || '10'),
    recommended: s === 'R_25' || s === 'R_50'
  })),
  ...VOLATILITIES.jump.map(s => ({ 
    symbol: s, 
    name: s, 
    group: 'jump', 
    baseVol: parseInt(s.match(/\d+/)?.[0] || '10'),
    recommended: s === 'JD25' || s === 'JD50'
  })),
  ...VOLATILITIES.bull.map(s => ({ symbol: s, name: 'Bull Market', group: 'bull', baseVol: 50, recommended: false })),
  ...VOLATILITIES.bear.map(s => ({ symbol: s, name: 'Bear Market', group: 'bear', baseVol: 50, recommended: false }))
];

// Signal Types
type SignalCategory = 'over_under' | 'rise_fall' | 'even_odd' | 'digit_match';
type SignalType = 
  | 'over_4' | 'under_5' | 'over_0' | 'under_9' | 'reversal_over' | 'reversal_under'
  | 'rise' | 'fall'
  | 'even' | 'odd'
  | 'digit_match' | 'digit_diff' | 'digit_over' | 'digit_under';
type SignalStrength = 'critical' | 'strong' | 'moderate' | 'weak';

interface DigitStats {
  digit: number;
  count: number;
  percentage: number;
}

interface ZoneAnalysis {
  lowerZone: number[];
  upperZone: number[];
  lowerCount: number;
  upperCount: number;
  lowerPct: number;
  upperPct: number;
  difference: number;
  dominantZone: 'lower' | 'upper' | 'balanced';
}

interface LastTicksAnalysis {
  ticks: number[];
  over4Count: number;
  under5Count: number;
  over4Pct: number;
  under5Pct: number;
  trend: 'increasing' | 'decreasing' | 'stable';
  hasSpike: boolean;
  isSlow: boolean;
}

interface Signal {
  id: string;
  market: typeof ALL_MARKETS[0];
  category: SignalCategory;
  type: SignalType;
  strength: SignalStrength;
  entryPrice: string;
  confidence: number;
  timestamp: number;
  timeframe: string;
  conditionMet: string;
  priority: number;
  stats: {
    lowerCount?: number;
    upperCount?: number;
    difference?: number;
    last20Pct?: number;
    weakDigits?: number[];
    strongDigits?: number[];
    dominantDigit?: number;
    weakestDigit?: number;
    rsi?: number;
    macd?: number;
    evenPct?: number;
    oddPct?: number;
    digitFrequency?: Record<number, number>;
    matchDigit?: number;
    matchPct?: number;
  };
  reversalInfo?: {
    overboughtDigit: number;
    oversoldDigit: number;
  };
}

// Helper function to get last digit
const getLastDigit = (price: number): number => {
  const priceStr = price.toString();
  const match = priceStr.match(/\d+(?:\.\d+)?/);
  if (!match) return 0;
  const numStr = match[0].replace('.', '');
  return parseInt(numStr.slice(-1), 10);
};

// Analyze 1000 ticks for zone distribution
const analyzeZoneDistribution = (ticks: number[]): ZoneAnalysis => {
  const lowerZone = ticks.filter(d => d >= 0 && d <= 4);
  const upperZone = ticks.filter(d => d >= 5 && d <= 9);
  
  const lowerCount = lowerZone.length;
  const upperCount = upperZone.length;
  const total = ticks.length;
  
  return {
    lowerZone: lowerZone.map(d => d),
    upperZone: upperZone.map(d => d),
    lowerCount,
    upperCount,
    lowerPct: (lowerCount / total) * 100,
    upperPct: (upperCount / total) * 100,
    difference: Math.abs(upperCount - lowerCount),
    dominantZone: upperCount > lowerCount ? 'upper' : lowerCount > upperCount ? 'lower' : 'balanced',
  };
};

// Analyze last ticks for confirmation
const analyzeLastTicks = (ticks: number[], count: number = 20): LastTicksAnalysis => {
  const lastTicks = ticks.slice(-count);
  const over4Count = lastTicks.filter(d => d > 4).length;
  const under5Count = lastTicks.filter(d => d < 5).length;
  
  const last5 = lastTicks.slice(-5);
  const prev5 = lastTicks.slice(-10, -5);
  const spikeDetected = Math.abs(
    last5.filter(d => d > 4).length - prev5.filter(d => d > 4).length
  ) >= 3;
  
  const recent = lastTicks.slice(-10);
  const older = lastTicks.slice(-20, -10);
  const recentOver = recent.filter(d => d > 4).length;
  const olderOver = older.filter(d => d > 4).length;
  
  let trend: 'increasing' | 'decreasing' | 'stable' = 'stable';
  if (recentOver > olderOver + 2) trend = 'increasing';
  else if (recentOver < olderOver - 2) trend = 'decreasing';
  
  return {
    ticks: lastTicks,
    over4Count,
    under5Count,
    over4Pct: (over4Count / count) * 100,
    under5Pct: (under5Count / count) * 100,
    trend,
    hasSpike: spikeDetected,
    isSlow: true,
  };
};

// Analyze digit frequency
const analyzeDigitFrequency = (ticks: number[]): {
  frequencies: Record<number, number>;
  percentages: Record<number, number>;
  mostFrequent: DigitStats;
  secondMostFrequent: DigitStats;
  thirdMostFrequent: DigitStats;
  leastFrequent: DigitStats;
  sortedDigits: DigitStats[];
} => {
  const frequencies: Record<number, number> = {};
  for (let i = 0; i <= 9; i++) frequencies[i] = 0;
  ticks.forEach(d => frequencies[d]++);
  
  const total = ticks.length;
  const percentages: Record<number, number> = {};
  const sorted: DigitStats[] = [];
  
  for (let i = 0; i <= 9; i++) {
    const pct = (frequencies[i] / total) * 100;
    percentages[i] = pct;
    sorted.push({ digit: i, count: frequencies[i], percentage: pct });
  }
  
  sorted.sort((a, b) => b.count - a.count);
  
  return {
    frequencies,
    percentages,
    mostFrequent: sorted[0],
    secondMostFrequent: sorted[1],
    thirdMostFrequent: sorted[2],
    leastFrequent: sorted[sorted.length - 1],
    sortedDigits: sorted,
  };
};

// Calculate RSI from ticks
const calculateRSI = (ticks: number[], period: number = 14): number => {
  if (ticks.length < period + 1) return 50;
  const changes: number[] = [];
  for (let i = 1; i < ticks.length; i++) {
    changes.push(ticks[i] - ticks[i - 1]);
  }
  const gains = changes.slice(-period).filter(c => c > 0);
  const losses = changes.slice(-period).filter(c => c < 0);
  const avgGain = gains.length ? gains.reduce((a, b) => a + b, 0) / period : 0;
  const avgLoss = losses.length ? Math.abs(losses.reduce((a, b) => a + b, 0)) / period : 0;
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
};

// Calculate MACD
const calculateMACD = (ticks: number[]): { macd: number; signal: number; histogram: number } => {
  const ema12 = (() => {
    const k = 2 / (12 + 1);
    let ema = ticks.slice(0, 12).reduce((a, b) => a + b, 0) / 12;
    for (let i = 12; i < ticks.length; i++) {
      ema = ticks[i] * k + ema * (1 - k);
    }
    return ema;
  })();
  
  const ema26 = (() => {
    const k = 2 / (26 + 1);
    let ema = ticks.slice(0, 26).reduce((a, b) => a + b, 0) / 26;
    for (let i = 26; i < ticks.length; i++) {
      ema = ticks[i] * k + ema * (1 - k);
    }
    return ema;
  })();
  
  const macd = ema12 - ema26;
  const signal = macd * 0.8;
  const histogram = macd - signal;
  
  return { macd, signal, histogram };
};

// Check for reversal conditions
const checkReversalConditions = (digitFreq: ReturnType<typeof analyzeDigitFrequency>): {
  overboughtDigit: number | null;
  oversoldDigit: number | null;
  overboughtPct: number;
  oversoldPct: number;
} => {
  let overboughtDigit: number | null = null;
  let oversoldDigit: number | null = null;
  let overboughtPct = 0;
  let oversoldPct = 100;
  
  for (let i = 0; i <= 9; i++) {
    const pct = digitFreq.percentages[i];
    if (pct > 15) {
      overboughtDigit = i;
      overboughtPct = pct;
    }
    if (pct < 5 && oversoldPct > pct) {
      oversoldDigit = i;
      oversoldPct = pct;
    }
  }
  
  return { overboughtDigit, oversoldDigit, overboughtPct, oversoldPct };
};

// Generate Over/Under Signals (5 signals)
const generateOverUnderSignals = (
  market: typeof ALL_MARKETS[0],
  ticks: number[]
): Omit<Signal, 'id' | 'timestamp' | 'priority'>[] => {
  if (!ticks || ticks.length < 1000) return [];
  
  const signals: Omit<Signal, 'id' | 'timestamp' | 'priority'>[] = [];
  const zoneAnalysis = analyzeZoneDistribution(ticks);
  const lastTicksAnalysis = analyzeLastTicks(ticks);
  const digitFreq = analyzeDigitFrequency(ticks);
  const reversalConditions = checkReversalConditions(digitFreq);
  
  // Signal 1: OVER 4
  if (zoneAnalysis.upperCount > zoneAnalysis.lowerCount && zoneAnalysis.difference >= 60 && lastTicksAnalysis.over4Pct > 50) {
    let strength: SignalStrength = 'moderate';
    let confidence = 65;
    if (zoneAnalysis.difference >= 80 && lastTicksAnalysis.over4Pct >= 70) {
      strength = 'critical';
      confidence = 92;
    } else if (zoneAnalysis.difference >= 70 && lastTicksAnalysis.over4Pct >= 60) {
      strength = 'strong';
      confidence = 82;
    }
    
    signals.push({
      market,
      category: 'over_under',
      type: 'over_4',
      strength,
      entryPrice: 'OVER 4',
      confidence,
      timeframe: '1m',
      conditionMet: `Upper zone ${zoneAnalysis.upperPct.toFixed(1)}% vs Lower ${zoneAnalysis.lowerPct.toFixed(1)}%. Diff: ${zoneAnalysis.difference} ticks. Last 20: ${lastTicksAnalysis.over4Pct.toFixed(0)}% over.`,
      stats: {
        lowerCount: zoneAnalysis.lowerCount,
        upperCount: zoneAnalysis.upperCount,
        difference: zoneAnalysis.difference,
        last20Pct: lastTicksAnalysis.over4Pct,
        weakDigits: [0, 1].filter(d => digitFreq.percentages[d] < 8),
        strongDigits: [7, 8, 9].filter(d => digitFreq.percentages[d] > 10),
        dominantDigit: digitFreq.mostFrequent.digit,
        weakestDigit: digitFreq.leastFrequent.digit,
      },
    });
  }
  
  // Signal 2: UNDER 5
  if (zoneAnalysis.lowerCount > zoneAnalysis.upperCount && zoneAnalysis.difference >= 60 && lastTicksAnalysis.under5Pct > 50) {
    let strength: SignalStrength = 'moderate';
    let confidence = 65;
    if (zoneAnalysis.difference >= 80 && lastTicksAnalysis.under5Pct >= 70) {
      strength = 'critical';
      confidence = 92;
    } else if (zoneAnalysis.difference >= 70 && lastTicksAnalysis.under5Pct >= 60) {
      strength = 'strong';
      confidence = 82;
    }
    
    signals.push({
      market,
      category: 'over_under',
      type: 'under_5',
      strength,
      entryPrice: 'UNDER 5',
      confidence,
      timeframe: '1m',
      conditionMet: `Lower zone ${zoneAnalysis.lowerPct.toFixed(1)}% vs Upper ${zoneAnalysis.upperPct.toFixed(1)}%. Diff: ${zoneAnalysis.difference} ticks. Last 20: ${lastTicksAnalysis.under5Pct.toFixed(0)}% under.`,
      stats: {
        lowerCount: zoneAnalysis.lowerCount,
        upperCount: zoneAnalysis.upperCount,
        difference: zoneAnalysis.difference,
        last20Pct: lastTicksAnalysis.under5Pct,
        weakDigits: [8, 9].filter(d => digitFreq.percentages[d] < 8),
        strongDigits: [0, 1, 2].filter(d => digitFreq.percentages[d] > 10),
        dominantDigit: digitFreq.mostFrequent.digit,
        weakestDigit: digitFreq.leastFrequent.digit,
      },
    });
  }
  
  // Signal 3: OVER 0 (Reversal)
  if (reversalConditions.oversoldDigit === 0 && reversalConditions.oversoldPct < 5) {
    signals.push({
      market,
      category: 'over_under',
      type: 'reversal_over',
      strength: 'strong',
      entryPrice: 'OVER 0',
      confidence: 85,
      timeframe: '1m',
      conditionMet: `Digit 0 appears only ${reversalConditions.oversoldPct.toFixed(1)}% (oversold). Market reversal → BUY OVER 0`,
      stats: {
        lowerCount: zoneAnalysis.lowerCount,
        upperCount: zoneAnalysis.upperCount,
        difference: zoneAnalysis.difference,
        last20Pct: lastTicksAnalysis.over4Pct,
        weakDigits: [0],
        strongDigits: [digitFreq.mostFrequent.digit],
        dominantDigit: digitFreq.mostFrequent.digit,
        weakestDigit: 0,
      },
      reversalInfo: { overboughtDigit: reversalConditions.overboughtDigit || 0, oversoldDigit: 0 },
    });
  }
  
  // Signal 4: UNDER 9 (Reversal)
  if (reversalConditions.overboughtDigit === 9 && reversalConditions.overboughtPct > 15) {
    signals.push({
      market,
      category: 'over_under',
      type: 'reversal_under',
      strength: 'strong',
      entryPrice: 'UNDER 9',
      confidence: 85,
      timeframe: '1m',
      conditionMet: `Digit 9 appears ${reversalConditions.overboughtPct.toFixed(1)}% (overbought). Market reversal → BUY UNDER 9`,
      stats: {
        lowerCount: zoneAnalysis.lowerCount,
        upperCount: zoneAnalysis.upperCount,
        difference: zoneAnalysis.difference,
        last20Pct: lastTicksAnalysis.under5Pct,
        weakDigits: [9],
        strongDigits: [digitFreq.leastFrequent.digit],
        dominantDigit: digitFreq.mostFrequent.digit,
        weakestDigit: digitFreq.leastFrequent.digit,
      },
      reversalInfo: { overboughtDigit: 9, oversoldDigit: reversalConditions.oversoldDigit || 0 },
    });
  }
  
  // Signal 5: DIGIT MATCH (Most frequent digit)
  if (digitFreq.mostFrequent.percentage > 12) {
    let strength: SignalStrength = 'moderate';
    let confidence = 70;
    if (digitFreq.mostFrequent.percentage > 18) {
      strength = 'strong';
      confidence = 85;
    }
    
    signals.push({
      market,
      category: 'over_under',
      type: 'digit_match',
      strength,
      entryPrice: `MATCH ${digitFreq.mostFrequent.digit}`,
      confidence,
      timeframe: '1m',
      conditionMet: `Digit ${digitFreq.mostFrequent.digit} appears ${digitFreq.mostFrequent.percentage.toFixed(1)}% (most frequent). Strong match bias.`,
      stats: {
        lowerCount: zoneAnalysis.lowerCount,
        upperCount: zoneAnalysis.upperCount,
        difference: zoneAnalysis.difference,
        last20Pct: lastTicksAnalysis.over4Pct,
        dominantDigit: digitFreq.mostFrequent.digit,
        weakestDigit: digitFreq.leastFrequent.digit,
        digitFrequency: digitFreq.frequencies,
        matchDigit: digitFreq.mostFrequent.digit,
        matchPct: digitFreq.mostFrequent.percentage,
      },
    });
  }
  
  return signals;
};

// Generate Rise/Fall Signals (2 signals)
const generateRiseFallSignals = (
  market: typeof ALL_MARKETS[0],
  ticks: number[]
): Omit<Signal, 'id' | 'timestamp' | 'priority'>[] => {
  if (!ticks || ticks.length < 100) return [];
  
  const signals: Omit<Signal, 'id' | 'timestamp' | 'priority'>[] = [];
  const rsi = calculateRSI(ticks, 14);
  const macd = calculateMACD(ticks);
  const lastTicksAnalysis = analyzeLastTicks(ticks);
  
  // Signal 1: RISE
  if (rsi < 45 && macd.macd > 0 && lastTicksAnalysis.trend !== 'decreasing') {
    let strength: SignalStrength = 'moderate';
    let confidence = 65;
    if (rsi < 30 && macd.histogram > 0.5 && lastTicksAnalysis.over4Pct > 55) {
      strength = 'strong';
      confidence = 85;
    }
    
    signals.push({
      market,
      category: 'rise_fall',
      type: 'rise',
      strength,
      entryPrice: 'RISE',
      confidence,
      timeframe: '1m',
      conditionMet: `RSI at ${rsi.toFixed(1)} (oversold territory) + MACD bullish ${macd.macd > 0 ? '+' : ''}${macd.macd.toFixed(4)}. Last 20: ${lastTicksAnalysis.over4Pct.toFixed(0)}% over. Expect upward movement.`,
      stats: { rsi, macd: macd.macd, last20Pct: lastTicksAnalysis.over4Pct },
    });
  }
  
  // Signal 2: FALL
  if (rsi > 55 && macd.macd < 0 && lastTicksAnalysis.trend !== 'increasing') {
    let strength: SignalStrength = 'moderate';
    let confidence = 65;
    if (rsi > 70 && macd.histogram < -0.5 && lastTicksAnalysis.under5Pct > 55) {
      strength = 'strong';
      confidence = 85;
    }
    
    signals.push({
      market,
      category: 'rise_fall',
      type: 'fall',
      strength,
      entryPrice: 'FALL',
      confidence,
      timeframe: '1m',
      conditionMet: `RSI at ${rsi.toFixed(1)} (overbought territory) + MACD bearish ${macd.macd.toFixed(4)}. Last 20: ${lastTicksAnalysis.under5Pct.toFixed(0)}% under. Expect downward movement.`,
      stats: { rsi, macd: macd.macd, last20Pct: lastTicksAnalysis.under5Pct },
    });
  }
  
  return signals;
};

// Generate Even/Odd Signals (4 signals)
const generateEvenOddSignals = (
  market: typeof ALL_MARKETS[0],
  ticks: number[]
): Omit<Signal, 'id' | 'timestamp' | 'priority'>[] => {
  if (!ticks || ticks.length < 500) return [];
  
  const signals: Omit<Signal, 'id' | 'timestamp' | 'priority'>[] = [];
  const digitFreq = analyzeDigitFrequency(ticks);
  const evenCount = [0, 2, 4, 6, 8].reduce((sum, d) => sum + digitFreq.frequencies[d], 0);
  const oddCount = [1, 3, 5, 7, 9].reduce((sum, d) => sum + digitFreq.frequencies[d], 0);
  const total = ticks.length;
  const evenPct = (evenCount / total) * 100;
  const oddPct = (oddCount / total) * 100;
  const last20Analysis = analyzeLastTicks(ticks, 20);
  
  // Signal 1: EVEN (Strong)
  if (evenPct >= 55) {
    let strength: SignalStrength = 'moderate';
    let confidence = 70;
    if (evenPct >= 70) {
      strength = 'critical';
      confidence = 92;
    } else if (evenPct >= 60) {
      strength = 'strong';
      confidence = 82;
    }
    
    signals.push({
      market,
      category: 'even_odd',
      type: 'even',
      strength,
      entryPrice: 'EVEN',
      confidence,
      timeframe: '1m',
      conditionMet: `Even digits at ${evenPct.toFixed(1)}% (${evenCount}/${total}). Strong even bias confirmed. Last 20: ${last20Analysis.over4Pct.toFixed(0)}% over.`,
      stats: { evenPct, oddPct, last20Pct: last20Analysis.over4Pct },
    });
  }
  
  // Signal 2: ODD (Strong)
  if (oddPct >= 55) {
    let strength: SignalStrength = 'moderate';
    let confidence = 70;
    if (oddPct >= 70) {
      strength = 'critical';
      confidence = 92;
    } else if (oddPct >= 60) {
      strength = 'strong';
      confidence = 82;
    }
    
    signals.push({
      market,
      category: 'even_odd',
      type: 'odd',
      strength,
      entryPrice: 'ODD',
      confidence,
      timeframe: '1m',
      conditionMet: `Odd digits at ${oddPct.toFixed(1)}% (${oddCount}/${total}). Strong odd bias confirmed. Last 20: ${last20Analysis.under5Pct.toFixed(0)}% under.`,
      stats: { evenPct, oddPct, last20Pct: last20Analysis.under5Pct },
    });
  }
  
  // Signal 3: EVEN (Weak/Building)
  if (evenPct >= 52 && evenPct < 55) {
    signals.push({
      market,
      category: 'even_odd',
      type: 'even',
      strength: 'weak',
      entryPrice: 'EVEN (Building)',
      confidence: 60,
      timeframe: '1m',
      conditionMet: `Even digits at ${evenPct.toFixed(1)}% - approaching threshold. Even bias developing.`,
      stats: { evenPct, oddPct, last20Pct: last20Analysis.over4Pct },
    });
  }
  
  // Signal 4: ODD (Weak/Building)
  if (oddPct >= 52 && oddPct < 55) {
    signals.push({
      market,
      category: 'even_odd',
      type: 'odd',
      strength: 'weak',
      entryPrice: 'ODD (Building)',
      confidence: 60,
      timeframe: '1m',
      conditionMet: `Odd digits at ${oddPct.toFixed(1)}% - approaching threshold. Odd bias developing.`,
      stats: { evenPct, oddPct, last20Pct: last20Analysis.under5Pct },
    });
  }
  
  return signals;
};

// Generate Digit Match Signals (Top 3 digits)
const generateDigitMatchSignals = (
  market: typeof ALL_MARKETS[0],
  ticks: number[]
): Omit<Signal, 'id' | 'timestamp' | 'priority'>[] => {
  if (!ticks || ticks.length < 500) return [];
  
  const signals: Omit<Signal, 'id' | 'timestamp' | 'priority'>[] = [];
  const digitFreq = analyzeDigitFrequency(ticks);
  const last20Analysis = analyzeLastTicks(ticks, 20);
  
  // Top 3 most frequent digits
  const topDigits = [digitFreq.mostFrequent, digitFreq.secondMostFrequent, digitFreq.thirdMostFrequent];
  
  topDigits.forEach((digit, idx) => {
    if (digit.percentage >= 10) {
      let strength: SignalStrength = 'moderate';
      let confidence = 65;
      
      if (digit.percentage >= 18) {
        strength = 'critical';
        confidence = 92;
      } else if (digit.percentage >= 15) {
        strength = 'strong';
        confidence = 85;
      } else if (digit.percentage >= 12) {
        strength = 'moderate';
        confidence = 75;
      }
      
      const rankText = idx === 0 ? 'most' : idx === 1 ? 'second most' : 'third most';
      
      signals.push({
        market,
        category: 'digit_match',
        type: 'digit_match',
        strength,
        entryPrice: `MATCH ${digit.digit}`,
        confidence,
        timeframe: '1m',
        conditionMet: `Digit ${digit.digit} appears ${digit.percentage.toFixed(1)}% - ${rankText} frequent. Strong match probability.`,
        stats: {
          matchDigit: digit.digit,
          matchPct: digit.percentage,
          last20Pct: last20Analysis.over4Pct,
          digitFrequency: digitFreq.frequencies,
          dominantDigit: digitFreq.mostFrequent.digit,
          weakestDigit: digitFreq.leastFrequent.digit,
        },
      });
    }
  });
  
  return signals;
};

// Main Signal Page Component
export default function SignalPage() {
  const [activeSignals, setActiveSignals] = useState<Signal[]>([]);
  const [historicalSignals, setHistoricalSignals] = useState<Signal[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<string>('recommended');
  const [autoScan, setAutoScan] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [showAdvancedStats, setShowAdvancedStats] = useState(false);
  const [activeTab, setActiveTab] = useState<string>('all');
  const [martingaleLevel, setMartingaleLevel] = useState(0);
  const [balance, setBalance] = useState(1000);
  const [stakePercent, setStakePercent] = useState(2);
  
  // Market data storage
  const ticksMap = useRef<Record<string, number[]>>({});
  const wsConnections = useRef<Record<string, WebSocket>>({});

  // Get filtered markets
  const getFilteredMarkets = useCallback(() => {
    if (selectedGroup === 'recommended') {
      return ALL_MARKETS.filter(m => m.recommended);
    }
    if (selectedGroup === 'all') return ALL_MARKETS;
    return ALL_MARKETS.filter(m => {
      if (selectedGroup === 'vol') return VOLATILITIES.vol.includes(m.symbol);
      if (selectedGroup === 'jump') return VOLATILITIES.jump.includes(m.symbol);
      if (selectedGroup === 'bull') return VOLATILITIES.bull.includes(m.symbol);
      if (selectedGroup === 'bear') return VOLATILITIES.bear.includes(m.symbol);
      return false;
    });
  }, [selectedGroup]);

  // Scan all markets for signals
  const scanMarkets = useCallback(() => {
    setIsScanning(true);
    
    setTimeout(() => {
      const marketsToScan = getFilteredMarkets();
      const allSignals: Omit<Signal, 'id' | 'timestamp' | 'priority'>[] = [];
      
      marketsToScan.forEach(market => {
        const ticks = ticksMap.current[market.symbol];
        if (ticks && ticks.length >= 1000) {
          const overUnder = generateOverUnderSignals(market, ticks);
          const riseFall = generateRiseFallSignals(market, ticks);
          const evenOdd = generateEvenOddSignals(market, ticks);
          const digitMatch = generateDigitMatchSignals(market, ticks);
          
          allSignals.push(...overUnder, ...riseFall, ...evenOdd, ...digitMatch);
        }
      });
      
      // Sort by confidence
      const sortedSignals = allSignals.sort((a, b) => b.confidence - a.confidence);
      
      // Group signals by category with limits
      const overUnderSignals = sortedSignals.filter(s => s.category === 'over_under').slice(0, 5);
      const riseFallSignals = sortedSignals.filter(s => s.category === 'rise_fall').slice(0, 2);
      const evenOddSignals = sortedSignals.filter(s => s.category === 'even_odd').slice(0, 4);
      const digitMatchSignals = sortedSignals.filter(s => s.category === 'digit_match').slice(0, 3);
      
      // Combine all signals
      const combinedSignals = [...overUnderSignals, ...riseFallSignals, ...evenOddSignals, ...digitMatchSignals];
      
      // Add metadata
      const finalSignals: Signal[] = combinedSignals.map((signal, idx) => ({
        ...signal,
        id: `${signal.market.symbol}-${signal.type}-${Date.now()}-${idx}`,
        timestamp: Date.now(),
        priority: idx + 1,
      }));
      
      setActiveSignals(finalSignals);
      
      // Add to historical
      setHistoricalSignals(prev => {
        const combined = [...finalSignals, ...prev];
        return combined.slice(0, 50);
      });
      
      setLastUpdate(new Date());
      setIsScanning(false);
      
      const overUnderCount = finalSignals.filter(s => s.category === 'over_under').length;
      const riseFallCount = finalSignals.filter(s => s.category === 'rise_fall').length;
      const evenOddCount = finalSignals.filter(s => s.category === 'even_odd').length;
      const digitMatchCount = finalSignals.filter(s => s.category === 'digit_match').length;
      const criticalCount = finalSignals.filter(s => s.strength === 'critical').length;
      
      if (finalSignals.length > 0) {
        toast.success(
          `📡 ${finalSignals.length} signals detected! ` +
          `(OU:${overUnderCount} RF:${riseFallCount} EO:${evenOddCount} DM:${digitMatchCount}) ` +
          `${criticalCount > 0 ? `🔥 ${criticalCount} critical` : ''}`
        );
      } else {
        toast.info('No signals detected. Waiting for market conditions...');
      }
    }, 500);
  }, [getFilteredMarkets]);

  // Auto-scan interval
  useEffect(() => {
    if (!autoScan) return;
    
    scanMarkets();
    const interval = setInterval(scanMarkets, 30000);
    
    return () => clearInterval(interval);
  }, [autoScan, scanMarkets]);

  // WebSocket connection for each market
  useEffect(() => {
    const connectMarket = (symbol: string) => {
      if (wsConnections.current[symbol]) return;
      
      const ws = new WebSocket(`wss://ws.binaryws.com/websockets/v3?app_id=1089`);
      const ticks: number[] = [];
      
      ws.onopen = () => {
        ws.send(JSON.stringify({ ticks_history: symbol, count: 1000, end: "latest", style: "ticks" }));
      };
      
      ws.onmessage = (msg) => {
        const data = JSON.parse(msg.data);
        
        if (data.history?.prices) {
          data.history.prices.forEach((price: number) => {
            const digit = getLastDigit(price);
            if (!isNaN(digit)) ticks.push(digit);
          });
          ticksMap.current[symbol] = ticks;
          ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
        }
        
        if (data.tick?.quote) {
          const digit = getLastDigit(data.tick.quote);
          if (!isNaN(digit)) {
            if (ticks.length >= 2000) ticks.shift();
            ticks.push(digit);
            ticksMap.current[symbol] = [...ticks];
          }
        }
      };
      
      ws.onerror = () => console.error(`WebSocket error for ${symbol}`);
      ws.onclose = () => {
        delete wsConnections.current[symbol];
        setTimeout(() => connectMarket(symbol), 5000);
      };
      
      wsConnections.current[symbol] = ws;
    };
    
    const markets = getFilteredMarkets();
    markets.forEach(m => connectMarket(m.symbol));
    
    return () => {
      Object.values(wsConnections.current).forEach(ws => ws.close());
      wsConnections.current = {};
    };
  }, [selectedGroup]);

  const getSignalStats = useMemo(() => {
    const total = activeSignals.length;
    const critical = activeSignals.filter(s => s.strength === 'critical').length;
    const strong = activeSignals.filter(s => s.strength === 'strong').length;
    const overUnder = activeSignals.filter(s => s.category === 'over_under').length;
    const riseFall = activeSignals.filter(s => s.category === 'rise_fall').length;
    const evenOdd = activeSignals.filter(s => s.category === 'even_odd').length;
    const digitMatch = activeSignals.filter(s => s.category === 'digit_match').length;
    return { total, critical, strong, overUnder, riseFall, evenOdd, digitMatch };
  }, [activeSignals]);

  // Filtered signals by tab
  const filteredSignals = useMemo(() => {
    if (activeTab === 'all') return activeSignals;
    return activeSignals.filter(s => s.category === activeTab);
  }, [activeSignals, activeTab]);

  // Calculate suggested stake based on balance and martingale
  const suggestedStake = useMemo(() => {
    const baseStake = (balance * stakePercent) / 100;
    const multiplier = Math.pow(2, martingaleLevel);
    return (baseStake * multiplier).toFixed(2);
  }, [balance, stakePercent, martingaleLevel]);

  // Groups for filter
  const groups = [
    { value: 'recommended', label: '⭐ Recommended (Vol 25/50)' },
    { value: 'all', label: 'All Markets' },
    { value: 'vol', label: 'Volatility' },
    { value: 'jump', label: 'Jump' },
    { value: 'bull', label: 'Bull' },
    { value: 'bear', label: 'Bear' },
  ];

  // Signal Card Component
  const SignalCard: React.FC<{ signal: Signal; index: number }> = ({ signal, index }) => {
    const getSignalIcon = () => {
      switch (signal.type) {
        case 'over_4':
        case 'reversal_over':
          return <ArrowUp className="w-5 h-5" />;
        case 'under_5':
        case 'reversal_under':
          return <ArrowDown className="w-5 h-5" />;
        case 'rise':
          return <TrendingUp className="w-5 h-5" />;
        case 'fall':
          return <TrendingDown className="w-5 h-5" />;
        case 'even':
          return <Circle className="w-5 h-5" />;
        case 'odd':
          return <Divide className="w-5 h-5" />;
        case 'digit_match':
          return <Hash className="w-5 h-5" />;
        default:
          return <Target className="w-5 h-5" />;
      }
    };

    const getSignalColor = () => {
      if (signal.type === 'over_4' || signal.type === 'reversal_over') return 'from-emerald-500 to-green-600';
      if (signal.type === 'under_5' || signal.type === 'reversal_under') return 'from-rose-500 to-red-600';
      if (signal.type === 'rise') return 'from-emerald-500 to-green-600';
      if (signal.type === 'fall') return 'from-rose-500 to-red-600';
      if (signal.type === 'even') return 'from-sky-500 to-blue-600';
      if (signal.type === 'odd') return 'from-amber-500 to-orange-600';
      return 'from-purple-500 to-pink-600';
    };

    const getStrengthColor = () => {
      switch (signal.strength) {
        case 'critical': return 'text-red-400 bg-red-400/10 border-red-400/30';
        case 'strong': return 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30';
        case 'moderate': return 'text-amber-400 bg-amber-400/10 border-amber-400/30';
        default: return 'text-rose-400 bg-rose-400/10 border-rose-400/30';
      }
    };

    const getStrengthText = () => {
      switch (signal.strength) {
        case 'critical': return '🔥 CRITICAL';
        case 'strong': return '⚡ STRONG';
        case 'moderate': return '📊 MODERATE';
        default: return '⚠️ WEAK';
      }
    };

    const getCategoryBadge = () => {
      switch (signal.category) {
        case 'over_under': return <Badge className="bg-emerald-500/20 text-emerald-400 text-[8px]">Over/Under</Badge>;
        case 'rise_fall': return <Badge className="bg-blue-500/20 text-blue-400 text-[8px]">Rise/Fall</Badge>;
        case 'even_odd': return <Badge className="bg-purple-500/20 text-purple-400 text-[8px]">Even/Odd</Badge>;
        case 'digit_match': return <Badge className="bg-amber-500/20 text-amber-400 text-[8px]">Digit Match</Badge>;
        default: return null;
      }
    };

    return (
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ delay: index * 0.05, duration: 0.3 }}
        whileHover={{ y: -4, scale: 1.02 }}
      >
        <Card className={`overflow-hidden border-border/50 bg-gradient-to-br from-card/80 to-card/40 backdrop-blur-sm hover:shadow-xl transition-all duration-300 ${
          signal.strength === 'critical' ? 'ring-2 ring-red-500/50 shadow-lg shadow-red-500/20' : ''
        }`}>
          <CardContent className="p-3">
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2">
                <motion.div
                  whileHover={{ rotate: 360, scale: 1.1 }}
                  className={`w-8 h-8 rounded-lg bg-gradient-to-br ${getSignalColor()} flex items-center justify-center text-white shadow-lg`}
                >
                  {getSignalIcon()}
                </motion.div>
                <div>
                  <h3 className="font-bold text-xs flex items-center gap-1">
                    {signal.market.name}
                    {signal.strength === 'critical' && <Flame className="w-3 h-3 text-red-400" />}
                  </h3>
                  <div className="flex items-center gap-1 text-[9px] text-muted-foreground">
                    <Clock className="w-2.5 h-2.5" />
                    <span>{new Date(signal.timestamp).toLocaleTimeString()}</span>
                    {getCategoryBadge()}
                  </div>
                </div>
              </div>
              <Badge className={`${getStrengthColor()} border text-[8px] font-semibold px-1.5`}>
                {getStrengthText()}
              </Badge>
            </div>

            <div className="space-y-2">
              <div className="bg-primary/10 rounded-lg p-2 text-center">
                <div className="text-[8px] text-muted-foreground">ENTRY</div>
                <div className="font-mono text-sm font-bold text-primary">{signal.entryPrice}</div>
                <div className="text-[8px] text-muted-foreground">Confidence: {signal.confidence}%</div>
              </div>

              <div className="flex items-center gap-1 text-[9px] bg-muted/30 rounded-lg p-1.5">
                <AlertCircle className="w-2.5 h-2.5 flex-shrink-0" />
                <span className="text-muted-foreground line-clamp-2">{signal.conditionMet}</span>
              </div>

              {showAdvancedStats && signal.stats && (
                <div className="grid grid-cols-2 gap-1 text-[8px] bg-muted/20 rounded-lg p-1.5">
                  {signal.stats.difference !== undefined && <div>Diff: {signal.stats.difference}</div>}
                  {signal.stats.last20Pct !== undefined && <div>Last20: {signal.stats.last20Pct.toFixed(0)}%</div>}
                  {signal.stats.rsi !== undefined && <div>RSI: {signal.stats.rsi.toFixed(1)}</div>}
                  {signal.stats.evenPct !== undefined && <div>Even: {signal.stats.evenPct.toFixed(1)}%</div>}
                  {signal.stats.oddPct !== undefined && <div>Odd: {signal.stats.oddPct.toFixed(1)}%</div>}
                  {signal.stats.matchDigit !== undefined && <div>Match: {signal.stats.matchDigit} ({signal.stats.matchPct?.toFixed(1)}%)</div>}
                </div>
              )}

              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-1 text-[9px]">
                  <Gauge className="w-2.5 h-2.5 text-muted-foreground" />
                  <span>Vol: {signal.market.baseVol}</span>
                  {signal.market.recommended && (
                    <Star className="w-2.5 h-2.5 text-yellow-400" />
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[8px] text-muted-foreground">#{signal.priority}</span>
                  <Signal className="w-3 h-3 text-primary" />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background/95 to-background/90">
      {/* Header */}
      <div className="relative overflow-hidden border-b border-border/50 bg-card/30 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-4">
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col md:flex-row justify-between items-center gap-3"
          >
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center shadow-lg">
                <Signal className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-xl md:text-2xl font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
                  Multi-Strategy Signal Scanner
                </h1>
                <p className="text-[11px] text-muted-foreground">
                  5 Over/Under • 2 Rise/Fall • 4 Even/Odd • 3 Digit Match
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <Button
                variant={autoScan ? "default" : "outline"}
                size="sm"
                onClick={() => setAutoScan(!autoScan)}
                className="gap-1 h-8 text-xs"
              >
                {autoScan ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                {autoScan ? 'Auto' : 'Manual'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={scanMarkets}
                disabled={isScanning}
                className="gap-1 h-8 text-xs"
              >
                <RefreshCw className={`w-3 h-3 ${isScanning ? 'animate-spin' : ''}`} />
                Scan
              </Button>
            </div>
          </motion.div>

          {/* Money Management Panel */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 p-3 bg-gradient-to-r from-emerald-500/10 to-rose-500/10 rounded-xl border border-border/50"
          >
            <div>
              <label className="text-[10px] text-muted-foreground mb-1 block">Balance</label>
              <Input
                type="number"
                value={balance}
                onChange={(e) => setBalance(parseFloat(e.target.value) || 0)}
                className="h-8 text-xs"
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground mb-1 block">Risk %</label>
              <Input
                type="number"
                value={stakePercent}
                onChange={(e) => setStakePercent(parseFloat(e.target.value) || 2)}
                className="h-8 text-xs"
                min={1}
                max={10}
                step={0.5}
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground mb-1 block">Martingale</label>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => setMartingaleLevel(Math.max(0, martingaleLevel - 1))} className="h-7 w-7">-</Button>
                <span className="font-mono font-bold text-sm w-6 text-center">{martingaleLevel}</span>
                <Button size="sm" variant="outline" onClick={() => setMartingaleLevel(Math.min(2, martingaleLevel + 1))} className="h-7 w-7">+</Button>
              </div>
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground mb-1 block">Suggested Stake</label>
              <div className="text-lg font-bold text-primary">${suggestedStake}</div>
            </div>
          </motion.div>

          {/* Stats Row */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="grid grid-cols-3 md:grid-cols-7 gap-2 mt-4"
          >
            <div className="bg-card/50 rounded-lg border border-border/50 p-2 text-center">
              <div className="text-[9px] text-muted-foreground">Total</div>
              <div className="text-xl font-bold">{getSignalStats.total}</div>
            </div>
            <div className="bg-card/50 rounded-lg border border-border/50 p-2 text-center">
              <div className="text-[9px] text-red-400">Critical</div>
              <div className="text-xl font-bold text-red-400">{getSignalStats.critical}</div>
            </div>
            <div className="bg-card/50 rounded-lg border border-border/50 p-2 text-center">
              <div className="text-[9px] text-emerald-400">Strong</div>
              <div className="text-xl font-bold text-emerald-400">{getSignalStats.strong}</div>
            </div>
            <div className="bg-card/50 rounded-lg border border-border/50 p-2 text-center">
              <div className="text-[9px] text-emerald-400">Over/Under</div>
              <div className="text-lg font-bold">{getSignalStats.overUnder}/5</div>
            </div>
            <div className="bg-card/50 rounded-lg border border-border/50 p-2 text-center">
              <div className="text-[9px] text-blue-400">Rise/Fall</div>
              <div className="text-lg font-bold">{getSignalStats.riseFall}/2</div>
            </div>
            <div className="bg-card/50 rounded-lg border border-border/50 p-2 text-center">
              <div className="text-[9px] text-purple-400">Even/Odd</div>
              <div className="text-lg font-bold">{getSignalStats.evenOdd}/4</div>
            </div>
            <div className="bg-card/50 rounded-lg border border-border/50 p-2 text-center">
              <div className="text-[9px] text-amber-400">Digit Match</div>
              <div className="text-lg font-bold">{getSignalStats.digitMatch}/3</div>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-4">
        {/* Filter Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="gap-1 text-[10px]">
              <BarChart3 className="w-3 h-3" />
              {getFilteredMarkets().length} Markets
            </Badge>
            <Badge variant="outline" className="gap-1 bg-emerald-500/10 border-emerald-500/30 text-[10px]">
              <Brain className="w-3 h-3" />
              1000 Ticks Analysis
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowAdvancedStats(!showAdvancedStats)}
              className="text-[10px] h-7 gap-1"
            >
              {showAdvancedStats ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              {showAdvancedStats ? 'Hide' : 'Show'} Stats
            </Button>
          </div>
          
          <div className="flex gap-1 flex-wrap">
            {groups.map(group => (
              <Button
                key={group.value}
                size="sm"
                variant={selectedGroup === group.value ? 'default' : 'outline'}
                onClick={() => setSelectedGroup(group.value)}
                className="text-[10px] h-7 px-2"
              >
                {group.value === 'recommended' && <Star className="w-3 h-3 mr-1" />}
                {group.label}
              </Button>
            ))}
          </div>
        </div>

        {/* Signal Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-4">
          <TabsList className="grid grid-cols-5 w-full max-w-md">
            <TabsTrigger value="all" className="text-xs">All ({getSignalStats.total})</TabsTrigger>
            <TabsTrigger value="over_under" className="text-xs">Over/Under ({getSignalStats.overUnder})</TabsTrigger>
            <TabsTrigger value="rise_fall" className="text-xs">Rise/Fall ({getSignalStats.riseFall})</TabsTrigger>
            <TabsTrigger value="even_odd" className="text-xs">Even/Odd ({getSignalStats.evenOdd})</TabsTrigger>
            <TabsTrigger value="digit_match" className="text-xs">Digit Match ({getSignalStats.digitMatch})</TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Signals Grid */}
        <div className="mb-6">
          {filteredSignals.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-12 bg-card/30 rounded-xl border border-dashed border-border"
            >
              <Signal className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-50" />
              <p className="text-muted-foreground text-sm">No signals in this category</p>
              <p className="text-xs text-muted-foreground mt-1">Waiting for market conditions...</p>
            </motion.div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              <AnimatePresence mode="wait">
                {filteredSignals.map((signal, idx) => (
                  <SignalCard key={signal.id} signal={signal} index={idx} />
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>

        {/* Historical Signals */}
        {historicalSignals.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Clock className="w-4 h-4 text-muted-foreground" />
              Recent History
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
              {historicalSignals.slice(0, 12).map((signal, idx) => (
                <motion.div
                  key={signal.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: idx * 0.02 }}
                  className={`bg-card/40 rounded-lg border border-border/50 p-2 hover:bg-card/60 transition-colors ${
                    signal.strength === 'critical' ? 'border-red-500/30' : ''
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono text-[9px] font-medium truncate max-w-[60px]">{signal.market.name}</span>
                    <Badge className={`text-[7px] px-1 ${
                      signal.strength === 'critical' ? 'bg-red-500/20 text-red-400' :
                      signal.strength === 'strong' ? 'bg-emerald-500/20 text-emerald-400' :
                      'bg-amber-500/20 text-amber-400'
                    }`}>
                      {signal.strength === 'critical' ? '🔥' : signal.strength?.slice(0, 1)}
                    </Badge>
                  </div>
                  <div className="text-[10px] font-mono font-bold text-primary">{signal.entryPrice}</div>
                  <div className="text-[8px] text-muted-foreground">
                    {new Date(signal.timestamp).toLocaleTimeString()}
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        )}

        {/* Strategy Guide */}
        <div className="mt-6 p-3 bg-card/30 rounded-xl border border-border/50">
          <h3 className="text-xs font-semibold mb-2 flex items-center gap-2">
            <AlertCircle className="w-3 h-3 text-primary" />
            Signal Strategy Guide
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[10px]">
            <div>
              <div className="font-medium text-emerald-400 mb-1">📊 Over/Under (5)</div>
              <div className="text-muted-foreground">• Zone imbalance ≥60 ticks</div>
              <div className="text-muted-foreground">• Last 20 ticks confirmation</div>
              <div className="text-muted-foreground">• Reversal on extreme digits</div>
            </div>
            <div>
              <div className="font-medium text-blue-400 mb-1">📈 Rise/Fall (2)</div>
              <div className="text-muted-foreground">• RSI oversold/overbought</div>
              <div className="text-muted-foreground">• MACD crossover</div>
              <div className="text-muted-foreground">• Trend confirmation</div>
            </div>
            <div>
              <div className="font-medium text-purple-400 mb-1">🔄 Even/Odd (4)</div>
              <div className="text-muted-foreground">• Even/Odd ≥55% strong</div>
              <div className="text-muted-foreground">• 52-55% building bias</div>
              <div className="text-muted-foreground">• Last 20 ticks pattern</div>
            </div>
            <div>
              <div className="font-medium text-amber-400 mb-1">🎯 Digit Match (3)</div>
              <div className="text-muted-foreground">• Top 3 most frequent digits</div>
              <div className="text-muted-foreground">• ≥10% frequency threshold</div>
              <div className="text-muted-foreground">• Strong match probability</div>
            </div>
          </div>
          <div className="mt-2 pt-2 border-t border-border/50 text-[9px] text-muted-foreground text-center">
            🎯 Auto-scans every 30s | Max signals: 5 OU + 2 RF + 4 EO + 3 DM = 14 total
          </div>
        </div>
      </div>
    </div>
  );
}
