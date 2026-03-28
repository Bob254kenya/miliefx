// App.tsx
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
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

// ---------- Types ----------
type Market = {
  symbol: string;
  name: string;
  group: string;
  baseVol: number;
  recommended: boolean;
};

type SignalCategory = 'over_under' | 'rise_fall' | 'even_odd' | 'digit_match';
type SignalType = 
  | 'over_4' | 'under_5'
  | 'rise' | 'fall'
  | 'even' | 'odd'
  | 'digit_match';
type SignalStrength = 'critical' | 'strong' | 'moderate' | 'weak';

interface Trade {
  id: string;
  market: Market;
  type: string;
  entryPrice: number;
  stake: number;
  status: 'open' | 'won' | 'lost';
  profit: number;
  entryTick: number;
  exitTick?: number;
  entryTickTime: number;
  exitTickTime?: number;
  contractId?: string;
}

interface Signal {
  id: string;
  market: Market;
  category: SignalCategory;
  type: SignalType;
  strength: SignalStrength;
  entryPrice: string;
  confidence: number;
  timestamp: number;
  timeframe: string;
  conditionMet: string;
  priority: number;
  stats?: any;
}

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

// ---------- Market Config ----------
const VOLATILITIES = {
  vol: ["1HZ10V", "1HZ25V", "1HZ50V", "1HZ75V", "1HZ100V", "R_10", "R_25", "R_50", "R_75", "R_100"],
  jump: ["JD10", "JD25", "JD50", "JD75", "JD100"],
  bull: ["RDBULL"],
  bear: ["RDBEAR"],
};

const ALL_MARKETS: Market[] = [
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

// ---------- Helpers ----------
const getLastDigit = (price: number): number => {
  const priceStr = price.toString();
  const match = priceStr.match(/\d+(?:\.\d+)?/);
  if (!match) return 0;
  const numStr = match[0].replace('.', '');
  return parseInt(numStr.slice(-1), 10);
};

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

// ---------- Signal Generation ----------
const generateOverUnderSignals = (
  market: Market,
  ticks: number[]
): Omit<Signal, 'id' | 'timestamp' | 'priority'>[] => {
  if (!ticks || ticks.length < 1000) return [];
  const signals: Omit<Signal, 'id' | 'timestamp' | 'priority'>[] = [];
  const zoneAnalysis = analyzeZoneDistribution(ticks);
  const lastTicksAnalysis = analyzeLastTicks(ticks);
  
  // OVER 4
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
      },
    });
  }
  
  // UNDER 5
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
      },
    });
  }
  
  return signals;
};

const generateRiseFallSignals = (
  market: Market,
  ticks: number[]
): Omit<Signal, 'id' | 'timestamp' | 'priority'>[] => {
  if (!ticks || ticks.length < 100) return [];
  const signals: Omit<Signal, 'id' | 'timestamp' | 'priority'>[] = [];
  const rsi = calculateRSI(ticks, 14);
  const macd = calculateMACD(ticks);
  const lastTicksAnalysis = analyzeLastTicks(ticks);
  
  // RISE
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
      conditionMet: `RSI at ${rsi.toFixed(1)} (oversold) + MACD bullish. Last 20: ${lastTicksAnalysis.over4Pct.toFixed(0)}% over.`,
      stats: { rsi, macd: macd.macd, last20Pct: lastTicksAnalysis.over4Pct },
    });
  }
  
  // FALL
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
      conditionMet: `RSI at ${rsi.toFixed(1)} (overbought) + MACD bearish. Last 20: ${lastTicksAnalysis.under5Pct.toFixed(0)}% under.`,
      stats: { rsi, macd: macd.macd, last20Pct: lastTicksAnalysis.under5Pct },
    });
  }
  
  return signals;
};

const generateEvenOddSignals = (
  market: Market,
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
  
  // EVEN Strong
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
      conditionMet: `Even digits at ${evenPct.toFixed(1)}% (${evenCount}/${total}). Strong even bias.`,
      stats: { evenPct, oddPct, last20Pct: last20Analysis.over4Pct },
    });
  }
  
  // ODD Strong
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
      conditionMet: `Odd digits at ${oddPct.toFixed(1)}% (${oddCount}/${total}). Strong odd bias.`,
      stats: { evenPct, oddPct, last20Pct: last20Analysis.under5Pct },
    });
  }
  
  // EVEN Building
  if (evenPct >= 52 && evenPct < 55) {
    signals.push({
      market,
      category: 'even_odd',
      type: 'even',
      strength: 'weak',
      entryPrice: 'EVEN (Building)',
      confidence: 60,
      timeframe: '1m',
      conditionMet: `Even digits at ${evenPct.toFixed(1)}% - approaching threshold.`,
      stats: { evenPct, oddPct },
    });
  }
  
  // ODD Building
  if (oddPct >= 52 && oddPct < 55) {
    signals.push({
      market,
      category: 'even_odd',
      type: 'odd',
      strength: 'weak',
      entryPrice: 'ODD (Building)',
      confidence: 60,
      timeframe: '1m',
      conditionMet: `Odd digits at ${oddPct.toFixed(1)}% - approaching threshold.`,
      stats: { evenPct, oddPct },
    });
  }
  
  return signals;
};

const generateDigitMatchSignals = (
  market: Market,
  ticks: number[]
): Omit<Signal, 'id' | 'timestamp' | 'priority'>[] => {
  if (!ticks || ticks.length < 500) return [];
  const signals: Omit<Signal, 'id' | 'timestamp' | 'priority'>[] = [];
  const digitFreq = analyzeDigitFrequency(ticks);
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
        conditionMet: `Digit ${digit.digit} appears ${digit.percentage.toFixed(1)}% - ${rankText} frequent.`,
        stats: {
          matchDigit: digit.digit,
          matchPct: digit.percentage,
          digitFrequency: digitFreq.frequencies,
        },
      });
    }
  });
  
  return signals;
};

// ---------- Trade Logic ----------
const evaluateInitialCondition = (ticks: number[], initialType: string): { shouldTrade: boolean; type?: string } => {
  if (!ticks || ticks.length < 2) return { shouldTrade: false };
  
  if (initialType === 'over1_under8') {
    const last2 = ticks.slice(-2);
    const allLessThan1 = last2.every(d => d < 1);
    const allGreaterThan8 = last2.every(d => d > 8);
    if (allLessThan1) return { shouldTrade: true, type: 'over_1' };
    if (allGreaterThan8) return { shouldTrade: true, type: 'under_8' };
  } else if (initialType === 'over2_under7') {
    const last3 = ticks.slice(-3);
    const allLessThan2 = last3.every(d => d < 2);
    const allGreaterThan7 = last3.every(d => d > 7);
    if (allLessThan2) return { shouldTrade: true, type: 'over_2' };
    if (allGreaterThan7) return { shouldTrade: true, type: 'under_7' };
  } else if (initialType === 'over3_under6') {
    const last4 = ticks.slice(-4);
    const allLessThan3 = last4.every(d => d < 3);
    const allGreaterThan6 = last4.every(d => d > 6);
    if (allLessThan3) return { shouldTrade: true, type: 'over_3' };
    if (allGreaterThan6) return { shouldTrade: true, type: 'under_6' };
  }
  
  return { shouldTrade: false };
};

const evaluateRecoveryCondition = (ticks: number[], recoveryType: string): { shouldTrade: boolean; type?: string } => {
  if (!ticks || ticks.length < 7) return { shouldTrade: false };
  
  if (recoveryType === 'evenOdd_7') {
    const last7 = ticks.slice(-7);
    const oddCount = last7.filter(d => d % 2 === 1).length;
    const evenCount = last7.filter(d => d % 2 === 0).length;
    if (oddCount > evenCount) return { shouldTrade: true, type: 'even' };
    if (evenCount > oddCount) return { shouldTrade: true, type: 'odd' };
  } else if (recoveryType === 'evenOdd_6') {
    const last6 = ticks.slice(-6);
    const oddCount = last6.filter(d => d % 2 === 1).length;
    const evenCount = last6.filter(d => d % 2 === 0).length;
    if (oddCount > evenCount) return { shouldTrade: true, type: 'even' };
    if (evenCount > oddCount) return { shouldTrade: true, type: 'odd' };
  } else if (recoveryType === 'overUnder_7') {
    const last7 = ticks.slice(-7);
    const lessThan4 = last7.filter(d => d < 4).length;
    const greaterThan5 = last7.filter(d => d > 5).length;
    if (lessThan4 > greaterThan5) return { shouldTrade: true, type: 'over_4' };
    if (greaterThan5 > lessThan4) return { shouldTrade: true, type: 'under_5' };
  } else if (recoveryType === 'overUnder_6') {
    const last6 = ticks.slice(-6);
    const lessThan4 = last6.filter(d => d < 4).length;
    const greaterThan5 = last6.filter(d => d > 5).length;
    if (lessThan4 > greaterThan5) return { shouldTrade: true, type: 'over_4' };
    if (greaterThan5 > lessThan4) return { shouldTrade: true, type: 'under_5' };
  }
  
  return { shouldTrade: false };
};

// ---------- WebSocket Manager ----------
interface DerivWebSocketManagerProps {
  onTick: (symbol: string, digit: number, price: number) => void;
  onTradeResult?: (trade: Trade) => void;
  appId?: number;
}

class DerivWebSocketManager {
  private ws: WebSocket | null = null;
  private subscriptions: Set<string> = new Set();
  private onTickCallback: (symbol: string, digit: number, price: number) => void;
  private onTradeResultCallback?: (trade: Trade) => void;
  private pendingProposals: Map<string, { trade: Trade; resolve: (value: any) => void; reject: (value: any) => void }> = new Map();
  private openContracts: Map<string, Trade> = new Map();
  private appId: number;

  constructor(props: DerivWebSocketManagerProps) {
    this.onTickCallback = props.onTick;
    this.onTradeResultCallback = props.onTradeResult;
    this.appId = props.appId || 1089;
    this.connect();
  }

  private connect() {
    this.ws = new WebSocket(`wss://ws.binaryws.com/websockets/v3?app_id=${this.appId}`);
    
    this.ws.onopen = () => {
      console.log('WebSocket connected');
      // Re-subscribe to all markets
      this.subscriptions.forEach(symbol => {
        this.sendSubscribe(symbol);
      });
    };
    
    this.ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data);
      this.handleMessage(data);
    };
    
    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
    
    this.ws.onclose = () => {
      console.log('WebSocket closed, reconnecting in 3s...');
      setTimeout(() => this.connect(), 3000);
    };
  }

  private handleMessage(data: any) {
    // Handle tick updates
    if (data.tick) {
      const symbol = data.tick.symbol;
      const price = data.tick.quote;
      const digit = getLastDigit(price);
      this.onTickCallback(symbol, digit, price);
    }
    
    // Handle tick history response
    if (data.history) {
      const symbol = data.echo_req?.ticks_history;
      if (symbol && data.history.prices) {
        data.history.prices.forEach((price: number) => {
          const digit = getLastDigit(price);
          this.onTickCallback(symbol, digit, price);
        });
        // Subscribe to real-time ticks after history
        this.sendSubscribe(symbol);
      }
    }
    
    // Handle proposal response
    if (data.proposal) {
      const reqId = data.echo_req?.req_id;
      const pending = this.pendingProposals.get(reqId);
      if (pending) {
        pending.resolve(data.proposal);
        this.pendingProposals.delete(reqId);
      }
    }
    
    // Handle proposal open contract response
    if (data.proposal_open_contract) {
      const contract = data.proposal_open_contract;
      const trade = this.openContracts.get(contract.contract_id);
      if (trade) {
        trade.entryTick = contract.entry_tick;
        trade.entryTickTime = contract.entry_tick_time;
        if (contract.exit_tick !== undefined) {
          trade.exitTick = contract.exit_tick;
          trade.exitTickTime = contract.exit_tick_time;
          trade.profit = contract.profit;
          trade.status = contract.profit > 0 ? 'won' : 'lost';
          if (this.onTradeResultCallback) {
            this.onTradeResultCallback(trade);
          }
          this.openContracts.delete(contract.contract_id);
        }
      }
    }
  }

  private send(message: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn('WebSocket not open, message queued');
      setTimeout(() => this.send(message), 1000);
    }
  }

  sendSubscribe(symbol: string) {
    this.subscriptions.add(symbol);
    this.send({ ticks: symbol, subscribe: 1 });
  }

  fetchTickHistory(symbol: string, count: number = 1000) {
    this.send({ ticks_history: symbol, count, end: 'latest', style: 'ticks' });
  }

  async placeTrade(
    symbol: string,
    amount: number,
    contractType: string,
    duration: number = 1,
    durationUnit: string = 't'
  ): Promise<any> {
    const reqId = `proposal_${Date.now()}_${Math.random()}`;
    const proposalRequest = {
      proposal: 1,
      amount,
      basis: 'stake',
      contract_type: contractType,
      currency: 'USD',
      duration,
      duration_unit: durationUnit,
      symbol,
      req_id: reqId,
    };
    
    return new Promise((resolve, reject) => {
      this.pendingProposals.set(reqId, { resolve, reject, trade: {} as Trade });
      this.send(proposalRequest);
    });
  }

  async buyContract(proposalId: string, price: number): Promise<any> {
    const buyRequest = {
      buy: proposalId,
      price,
    };
    return new Promise((resolve, reject) => {
      const reqId = `buy_${Date.now()}`;
      const handler = (msg: MessageEvent) => {
        const data = JSON.parse(msg.data);
        if (data.buy && data.echo_req?.buy === proposalId) {
          this.ws?.removeEventListener('message', handler);
          resolve(data.buy);
        }
        if (data.error && data.echo_req?.buy === proposalId) {
          this.ws?.removeEventListener('message', handler);
          reject(data.error);
        }
      };
      this.ws?.addEventListener('message', handler);
      this.send(buyRequest);
    });
  }

  subscribeToContract(contractId: string, trade: Trade) {
    this.openContracts.set(contractId, trade);
    this.send({ proposal_open_contract: 1, contract_id: contractId, subscribe: 1 });
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

// ---------- Main Component ----------
export default function TradingBot() {
  // State
  const [isBotActive, setIsBotActive] = useState(false);
  const [initialType, setInitialType] = useState('over1_under8');
  const [recoveryType, setRecoveryType] = useState('evenOdd_7');
  const [stake, setStake] = useState(0.5);
  const [takeProfit, setTakeProfit] = useState(5);
  const [stopLoss, setStopLoss] = useState(30);
  const [martingaleEnabled, setMartingaleEnabled] = useState(false);
  const [selectedMarkets, setSelectedMarkets] = useState<string[]>(['R_25', 'R_50']);
  const [balance, setBalance] = useState(1000);
  const [wonTrades, setWonTrades] = useState(0);
  const [lostTrades, setLostTrades] = useState(0);
  const [activeTrades, setActiveTrades] = useState<Trade[]>([]);
  const [tradeHistory, setTradeHistory] = useState<Trade[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [consecutiveLosses, setConsecutiveLosses] = useState(0);
  const [currentStake, setCurrentStake] = useState(stake);
  
  // Refs
  const ticksMap = useRef<Record<string, number[]>>({});
  const wsManager = useRef<DerivWebSocketManager | null>(null);
  const isProcessingTrade = useRef(false);
  
  // Market tick handler
  const handleTick = useCallback((symbol: string, digit: number, price: number) => {
    if (!ticksMap.current[symbol]) {
      ticksMap.current[symbol] = [];
    }
    const ticks = ticksMap.current[symbol];
    if (ticks.length >= 2000) ticks.shift();
    ticks.push(digit);
    ticksMap.current[symbol] = [...ticks];
    
    // Generate signals from this tick update
    const market = ALL_MARKETS.find(m => m.symbol === symbol);
    if (market && ticks.length >= 1000) {
      const overUnder = generateOverUnderSignals(market, ticks);
      const riseFall = generateRiseFallSignals(market, ticks);
      const evenOdd = generateEvenOddSignals(market, ticks);
      const digitMatch = generateDigitMatchSignals(market, ticks);
      const allSignals = [...overUnder, ...riseFall, ...evenOdd, ...digitMatch];
      
      setSignals(prev => {
        const newSignals = allSignals.map((s, idx) => ({
          ...s,
          id: `${s.market.symbol}-${s.type}-${Date.now()}-${idx}`,
          timestamp: Date.now(),
          priority: idx + 1,
        }));
        return [...newSignals, ...prev].slice(0, 30);
      });
    }
  }, []);
  
  // Trade result handler
  const handleTradeResult = useCallback((trade: Trade) => {
    setActiveTrades(prev => prev.filter(t => t.id !== trade.id));
    setTradeHistory(prev => [trade, ...prev].slice(0, 50));
    
    if (trade.status === 'won') {
      setWonTrades(prev => prev + 1);
      setBalance(prev => prev + trade.profit);
      setConsecutiveLosses(0);
      setRecoveryMode(false);
      setCurrentStake(stake);
      toast.success(`Trade WON! Profit: $${trade.profit.toFixed(2)}`);
    } else if (trade.status === 'lost') {
      setLostTrades(prev => prev + 1);
      setBalance(prev => prev + trade.profit); // profit is negative
      setConsecutiveLosses(prev => prev + 1);
      
      if (martingaleEnabled) {
        setRecoveryMode(true);
        const newStake = currentStake * 2;
        setCurrentStake(newStake);
        toast.info(`Trade LOST. Entering recovery mode with stake $${newStake.toFixed(2)}`);
      } else {
        toast.error(`Trade LOST! Loss: $${Math.abs(trade.profit).toFixed(2)}`);
      }
    }
    
    isProcessingTrade.current = false;
  }, [stake, martingaleEnabled, currentStake]);
  
  // Check and execute trades
  const checkAndExecuteTrade = useCallback(async () => {
    if (!isBotActive || isProcessingTrade.current) return;
    
    for (const symbol of selectedMarkets) {
      const ticks = ticksMap.current[symbol];
      if (!ticks || ticks.length < 7) continue;
      
      let shouldTrade = false;
      let tradeType = '';
      
      if (!recoveryMode) {
        const result = evaluateInitialCondition(ticks, initialType);
        if (result.shouldTrade) {
          shouldTrade = true;
          tradeType = result.type!;
        }
      } else {
        const result = evaluateRecoveryCondition(ticks, recoveryType);
        if (result.shouldTrade) {
          shouldTrade = true;
          tradeType = result.type!;
        }
      }
      
      if (shouldTrade && wsManager.current) {
        isProcessingTrade.current = true;
        
        // Map trade type to contract type
        let contractType = '';
        if (tradeType.includes('over')) contractType = 'CALL';
        else if (tradeType.includes('under')) contractType = 'PUT';
        else if (tradeType === 'rise') contractType = 'CALL';
        else if (tradeType === 'fall') contractType = 'PUT';
        else if (tradeType === 'even') contractType = 'CALL';
        else if (tradeType === 'odd') contractType = 'PUT';
        else contractType = 'CALL';
        
        try {
          const proposal = await wsManager.current.placeTrade(symbol, currentStake, contractType, 1, 't');
          if (proposal && proposal.id) {
            const buyResult = await wsManager.current.buyContract(proposal.id, proposal.ask_price);
            const newTrade: Trade = {
              id: buyResult.contract_id,
              market: ALL_MARKETS.find(m => m.symbol === symbol)!,
              type: tradeType,
              entryPrice: buyResult.longcode ? parseFloat(buyResult.longcode.match(/\d+\.\d+/)?.[0] || '0') : 0,
              stake: currentStake,
              status: 'open',
              profit: 0,
              entryTick: 0,
              entryTickTime: Date.now(),
              contractId: buyResult.contract_id,
            };
            setActiveTrades(prev => [...prev, newTrade]);
            wsManager.current.subscribeToContract(buyResult.contract_id, newTrade);
            toast.info(`Trade executed: ${tradeType} on ${symbol} with stake $${currentStake}`);
          }
        } catch (error) {
          console.error('Trade execution error:', error);
          isProcessingTrade.current = false;
        }
      }
    }
  }, [isBotActive, recoveryMode, initialType, recoveryType, selectedMarkets, currentStake]);
  
  // Auto-scan and trade interval
  useEffect(() => {
    if (!isBotActive) return;
    
    const interval = setInterval(() => {
      checkAndExecuteTrade();
    }, 2000);
    
    return () => clearInterval(interval);
  }, [isBotActive, checkAndExecuteTrade]);
  
  // Initialize WebSocket connection
  useEffect(() => {
    wsManager.current = new DerivWebSocketManager({
      onTick: handleTick,
      onTradeResult: handleTradeResult,
      appId: 1089,
    });
    
    // Fetch initial history for selected markets
    selectedMarkets.forEach(symbol => {
      wsManager.current?.fetchTickHistory(symbol, 1000);
    });
    
    return () => {
      wsManager.current?.disconnect();
    };
  }, [selectedMarkets]);
  
  // Start bot
  const startBot = () => {
    if (selectedMarkets.length === 0) {
      toast.error('Please select at least one market');
      return;
    }
    setIsBotActive(true);
    setRecoveryMode(false);
    setConsecutiveLosses(0);
    setCurrentStake(stake);
    toast.success('Bot started!');
  };
  
  // Stop bot
  const stopBot = () => {
    setIsBotActive(false);
    toast.info('Bot stopped');
  };
  
  // Market selection handler
  const handleMarketToggle = (symbol: string) => {
    setSelectedMarkets(prev => {
      if (prev.includes(symbol)) {
        return prev.filter(s => s !== symbol);
      } else {
        return [...prev, symbol];
      }
    });
  };
  
  // UI Helpers
  const getSignalTypeColor = (type: SignalType) => {
    if (type === 'over_4') return 'text-emerald-400';
    if (type === 'under_5') return 'text-rose-400';
    if (type === 'rise') return 'text-emerald-400';
    if (type === 'fall') return 'text-rose-400';
    if (type === 'even') return 'text-sky-400';
    if (type === 'odd') return 'text-amber-400';
    return 'text-purple-400';
  };
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <div className="container mx-auto px-4 py-6 max-w-7xl">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
              Deriv Trading Bot
            </h1>
            <p className="text-slate-400 text-sm">Automated trading with last digit pattern analysis</p>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={isBotActive ? stopBot : startBot}
              className={`gap-2 ${isBotActive ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}
            >
              {isBotActive ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              {isBotActive ? 'STOP BOT' : 'START BOT'}
            </Button>
          </div>
        </div>
        
        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <Card className="bg-slate-900/50 border-slate-800">
            <CardContent className="p-4">
              <div className="text-slate-400 text-sm">Balance</div>
              <div className={`text-2xl font-bold ${balance >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                ${balance.toFixed(2)}
              </div>
            </CardContent>
          </Card>
          <Card className="bg-slate-900/50 border-slate-800">
            <CardContent className="p-4">
              <div className="text-slate-400 text-sm">Won Trades</div>
              <div className="text-2xl font-bold text-emerald-400">{wonTrades}</div>
            </CardContent>
          </Card>
          <Card className="bg-slate-900/50 border-slate-800">
            <CardContent className="p-4">
              <div className="text-slate-400 text-sm">Lost Trades</div>
              <div className="text-2xl font-bold text-rose-400">{lostTrades}</div>
            </CardContent>
          </Card>
          <Card className="bg-slate-900/50 border-slate-800">
            <CardContent className="p-4">
              <div className="text-slate-400 text-sm">Active Trades</div>
              <div className="text-2xl font-bold text-blue-400">{activeTrades.length}</div>
            </CardContent>
          </Card>
        </div>
        
        {/* Configuration Panel */}
        <div className="grid md:grid-cols-2 gap-6 mb-6">
          <Card className="bg-slate-900/50 border-slate-800">
            <CardContent className="p-4">
              <h2 className="font-semibold mb-4 flex items-center gap-2">
                <Target className="w-4 h-4 text-blue-400" />
                Initial Trade Settings
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="text-sm text-slate-400 block mb-1">Initial Trade Type</label>
                  <Select value={initialType} onValueChange={setInitialType}>
                    <SelectTrigger className="bg-slate-800 border-slate-700">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="over1_under8">Over 1 / Under 8 (last 2 digits)</SelectItem>
                      <SelectItem value="over2_under7">Over 2 / Under 7 (last 3 digits)</SelectItem>
                      <SelectItem value="over3_under6">Over 3 / Under 6 (last 4 digits)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm text-slate-400 block mb-1">Recovery Type</label>
                  <Select value={recoveryType} onValueChange={setRecoveryType}>
                    <SelectTrigger className="bg-slate-800 border-slate-700">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="evenOdd_7">Even/Odd pattern (last 7)</SelectItem>
                      <SelectItem value="evenOdd_6">Even/Odd pattern (last 6)</SelectItem>
                      <SelectItem value="overUnder_7">Over/Under pattern (last 7)</SelectItem>
                      <SelectItem value="overUnder_6">Over/Under pattern (last 6)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card className="bg-slate-900/50 border-slate-800">
            <CardContent className="p-4">
              <h2 className="font-semibold mb-4 flex items-center gap-2">
                <Shield className="w-4 h-4 text-purple-400" />
                Risk Management
              </h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-slate-400 block mb-1">Stake ($)</label>
                  <Input
                    type="number"
                    value={stake}
                    onChange={(e) => setStake(parseFloat(e.target.value) || 0)}
                    className="bg-slate-800 border-slate-700"
                    step={0.1}
                    min={0.1}
                  />
                </div>
                <div>
                  <label className="text-sm text-slate-400 block mb-1">Take Profit ($)</label>
                  <Input
                    type="number"
                    value={takeProfit}
                    onChange={(e) => setTakeProfit(parseFloat(e.target.value) || 0)}
                    className="bg-slate-800 border-slate-700"
                  />
                </div>
                <div>
                  <label className="text-sm text-slate-400 block mb-1">Stop Loss ($)</label>
                  <Input
                    type="number"
                    value={stopLoss}
                    onChange={(e) => setStopLoss(parseFloat(e.target.value) || 0)}
                    className="bg-slate-800 border-slate-700"
                  />
                </div>
                <div className="flex items-center justify-between pt-2">
                  <label className="text-sm text-slate-400">Martingale</label>
                  <Button
                    variant={martingaleEnabled ? "default" : "outline"}
                    size="sm"
                    onClick={() => setMartingaleEnabled(!martingaleEnabled)}
                    className={martingaleEnabled ? "bg-blue-600" : ""}
                  >
                    {martingaleEnabled ? "ON" : "OFF"}
                  </Button>
                </div>
              </div>
              {recoveryMode && (
                <div className="mt-4 p-2 bg-amber-500/20 border border-amber-500/30 rounded-lg">
                  <p className="text-amber-400 text-sm flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" />
                    RECOVERY MODE ACTIVE - Stake: ${currentStake.toFixed(2)}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
        
        {/* Market Selection */}
        <Card className="bg-slate-900/50 border-slate-800 mb-6">
          <CardContent className="p-4">
            <h2 className="font-semibold mb-3 flex items-center gap-2">
              <Layers className="w-4 h-4 text-emerald-400" />
              Select Markets
            </h2>
            <div className="flex flex-wrap gap-2">
              {ALL_MARKETS.slice(0, 10).map(market => (
                <Button
                  key={market.symbol}
                  variant={selectedMarkets.includes(market.symbol) ? "default" : "outline"}
                  size="sm"
                  onClick={() => handleMarketToggle(market.symbol)}
                  className={`text-xs ${selectedMarkets.includes(market.symbol) ? 'bg-blue-600' : ''}`}
                >
                  {market.name}
                  {market.recommended && <Star className="w-3 h-3 ml-1 text-yellow-400" />}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
        
        {/* Active Trades */}
        {activeTrades.length > 0 && (
          <Card className="bg-slate-900/50 border-slate-800 mb-6">
            <CardContent className="p-4">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <Activity className="w-4 h-4 text-green-400" />
                Active Trades
              </h2>
              <div className="space-y-2">
                {activeTrades.map(trade => (
                  <div key={trade.id} className="flex items-center justify-between p-2 bg-slate-800/50 rounded-lg">
                    <div>
                      <div className="font-mono text-sm">{trade.market.name}</div>
                      <div className="text-xs text-slate-400">{trade.type}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm">Stake: ${trade.stake}</div>
                      <div className="text-xs text-yellow-400">Open</div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
        
        {/* Signals Panel */}
        <Card className="bg-slate-900/50 border-slate-800">
          <CardContent className="p-4">
            <h2 className="font-semibold mb-3 flex items-center gap-2">
              <Signal className="w-4 h-4 text-purple-400" />
              Live Signals
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-96 overflow-y-auto">
              {signals.slice(0, 12).map(signal => (
                <div key={signal.id} className="p-2 bg-slate-800/50 rounded-lg border border-slate-700">
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="font-mono text-xs">{signal.market.name}</span>
                      <div className={`text-sm font-bold ${getSignalTypeColor(signal.type)}`}>
                        {signal.entryPrice}
                      </div>
                    </div>
                    <Badge className={`text-[9px] ${
                      signal.strength === 'critical' ? 'bg-red-500/20 text-red-400' :
                      signal.strength === 'strong' ? 'bg-emerald-500/20 text-emerald-400' :
                      'bg-amber-500/20 text-amber-400'
                    }`}>
                      {signal.strength}
                    </Badge>
                  </div>
                  <div className="text-[10px] text-slate-400 mt-1 line-clamp-2">{signal.conditionMet}</div>
                  <div className="text-[9px] text-slate-500 mt-1">
                    Conf: {signal.confidence}%
                  </div>
                </div>
              ))}
              {signals.length === 0 && (
                <div className="col-span-full text-center py-8 text-slate-500">
                  Waiting for market data...
                </div>
              )}
            </div>
          </CardContent>
        </Card>
        
        {/* Trade History */}
        {tradeHistory.length > 0 && (
          <Card className="bg-slate-900/50 border-slate-800 mt-6">
            <CardContent className="p-4">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <Clock className="w-4 h-4 text-slate-400" />
                Trade History
              </h2>
              <div className="max-h-64 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="text-slate-400 border-b border-slate-700">
                    <tr>
                      <th className="text-left py-2">Market</th>
                      <th className="text-left">Type</th>
                      <th className="text-right">Stake</th>
                      <th className="text-right">Profit</th>
                      <th className="text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tradeHistory.slice(0, 20).map(trade => (
                      <tr key={trade.id} className="border-b border-slate-800">
                        <td className="py-2">{trade.market.name}</td>
                        <td>{trade.type}</td>
                        <td className="text-right">${trade.stake.toFixed(2)}</td>
                        <td className={`text-right ${trade.profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {trade.profit >= 0 ? '+' : ''}{trade.profit.toFixed(2)}
                        </td>
                        <td className="text-right">
                          <Badge className={trade.status === 'won' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}>
                            {trade.status.toUpperCase()}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
