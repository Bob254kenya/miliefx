import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { derivApi, type MarketSymbol } from '@/services/deriv-api';
import { getLastDigit, analyzeDigits, calculateRSI, calculateMACD, calculateBollingerBands } from '@/services/analysis';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import {
  TrendingUp, TrendingDown, Activity, BarChart3, ArrowUp, ArrowDown,
  Target, ShieldAlert, Gauge, Volume2, VolumeX, Zap, Trophy, Play, Pause, StopCircle, Eye, EyeOff, RefreshCw,
  Move, Square, Circle as CircleIcon, Triangle, TrendingUp as LongIcon, TrendingDown as ShortIcon, Trash2
} from 'lucide-react';

/* ── Drawing Tools Types ── */
interface DrawingPoint {
  x: number;
  y: number;
}

interface Drawing {
  id: string;
  type: 'trendline' | 'arrow' | 'rectangle' | 'circle' | 'triangle' | 'long' | 'short';
  points: DrawingPoint[];
  color: string;
  selected: boolean;
}

/* ── Markets ── */
const ALL_MARKETS = [
  { symbol: '1HZ10V', name: 'Volatility 10 (1s)', group: 'vol1s' },
  { symbol: '1HZ15V', name: 'Volatility 15 (1s)', group: 'vol1s' },
  { symbol: '1HZ25V', name: 'Volatility 25 (1s)', group: 'vol1s' },
  { symbol: '1HZ30V', name: 'Volatility 30 (1s)', group: 'vol1s' },
  { symbol: '1HZ50V', name: 'Volatility 50 (1s)', group: 'vol1s' },
  { symbol: '1HZ75V', name: 'Volatility 75 (1s)', group: 'vol1s' },
  { symbol: '1HZ100V', name: 'Volatility 100 (1s)', group: 'vol1s' },
  { symbol: 'R_10', name: 'Volatility 10', group: 'vol' },
  { symbol: 'R_25', name: 'Volatility 25', group: 'vol' },
  { symbol: 'R_50', name: 'Volatility 50', group: 'vol' },
  { symbol: 'R_75', name: 'Volatility 75', group: 'vol' },
  { symbol: 'R_100', name: 'Volatility 100', group: 'vol' },
  { symbol: 'JD10', name: 'Jump 10', group: 'jump' },
  { symbol: 'JD25', name: 'Jump 25', group: 'jump' },
  { symbol: 'JD50', name: 'Jump 50', group: 'jump' },
  { symbol: 'JD75', name: 'Jump 75', group: 'jump' },
  { symbol: 'JD100', name: 'Jump 100', group: 'jump' },
  { symbol: 'RDBEAR', name: 'Bear Market', group: 'bear' },
  { symbol: 'RDBULL', name: 'Bull Market', group: 'bull' },
  { symbol: 'stpRNG', name: 'Step Index', group: 'step' },
  { symbol: 'RBRK100', name: 'Range Break 100', group: 'range' },
  { symbol: 'RBRK200', name: 'Range Break 200', group: 'range' },
];

const GROUPS = [
  { value: 'all', label: 'All' },
  { value: 'vol1s', label: 'Vol 1s' },
  { value: 'vol', label: 'Vol' },
  { value: 'jump', label: 'Jump' },
  { value: 'bear', label: 'Bear' },
  { value: 'bull', label: 'Bull' },
  { value: 'step', label: 'Step' },
  { value: 'range', label: 'Range' },
];

const TIMEFRAMES = ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '12h', '1d'];
const CONTRACT_TYPES = [
  { value: 'CALL', label: 'Rise' },
  { value: 'PUT', label: 'Fall' },
  { value: 'DIGITMATCH', label: 'Digits Match' },
  { value: 'DIGITDIFF', label: 'Digits Differs' },
  { value: 'DIGITEVEN', label: 'Digits Even' },
  { value: 'DIGITODD', label: 'Digits Odd' },
  { value: 'DIGITOVER', label: 'Digits Over' },
  { value: 'DIGITUNDER', label: 'Digits Under' },
];

/* ── Candle builder ── */
interface Candle {
  open: number; high: number; low: number; close: number; time: number;
}

function buildCandles(prices: number[], times: number[], tf: string, targetCandles: number = 1000): Candle[] {
  if (prices.length === 0) return [];
  const seconds: Record<string, number> = {
    '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '12h': 43200, '1d': 86400,
  };
  const interval = seconds[tf] || 60;
  const candles: Candle[] = [];
  let current: Candle | null = null;

  for (let i = 0; i < prices.length; i++) {
    const p = prices[i];
    const t = times[i] || Date.now() / 1000 + i;
    const bucket = Math.floor(t / interval) * interval;

    if (!current || current.time !== bucket) {
      if (current) candles.push(current);
      current = { open: p, high: p, low: p, close: p, time: bucket };
    } else {
      current.high = Math.max(current.high, p);
      current.low = Math.min(current.low, p);
      current.close = p;
    }
  }
  if (current) candles.push(current);

  if (candles.length > targetCandles) {
    return candles.slice(-targetCandles);
  }
  return candles;
}

/* ── EMA helper ── */
function calcEMA(prices: number[], period: number): number {
  if (prices.length < period) return prices[prices.length - 1] || 0;
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

function calcEMASeries(prices: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  if (prices.length < period) return prices.map(() => null);
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = 0; i < period; i++) result.push(null);
  result[period - 1] = ema;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
    result.push(ema);
  }
  return result;
}

function calcSMASeries(prices: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    const slice = prices.slice(i - period + 1, i + 1);
    result.push(slice.reduce((a, b) => a + b, 0) / period);
  }
  return result;
}

function calcBBSeries(prices: number[], period: number, mult: number = 2) {
  const upper: (number | null)[] = [];
  const middle: (number | null)[] = [];
  const lower: (number | null)[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) { upper.push(null); middle.push(null); lower.push(null); continue; }
    const slice = prices.slice(i - period + 1, i + 1);
    const ma = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((s, p) => s + (p - ma) ** 2, 0) / period;
    const std = Math.sqrt(variance);
    upper.push(ma + mult * std);
    middle.push(ma);
    lower.push(ma - mult * std);
  }
  return { upper, middle, lower };
}

function calcRSISeries(prices: number[], period: number = 14): (number | null)[] {
  const result: (number | null)[] = [];
  if (prices.length < period + 1) return prices.map(() => null);
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = prices[i] - prices[i - 1];
    if (d > 0) gains += d; else losses -= d;
    result.push(null);
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  const rsi0 = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  result[period] = rsi0;
  for (let i = period + 1; i < prices.length; i++) {
    const d = prices[i] - prices[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(0, d)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -d)) / period;
    result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return result;
}

function calcParabolicSAR(prices: number[]): { sar: (number | null)[], trend: number } {
  const sar: (number | null)[] = [];
  if (prices.length < 2) return { sar: [null], trend: 1 };
  
  let trend = 1;
  let acceleration = 0.02;
  let maxAcceleration = 0.2;
  let ep = prices[0];
  let af = acceleration;
  let currentSar = prices[0];
  
  for (let i = 0; i < prices.length; i++) {
    if (i === 0) {
      sar.push(null);
      continue;
    }
    
    if (trend === 1) {
      currentSar = currentSar + af * (ep - currentSar);
      if (currentSar > prices[i]) {
        trend = -1;
        currentSar = ep;
        ep = prices[i];
        af = acceleration;
      } else {
        if (prices[i] > ep) {
          ep = prices[i];
          af = Math.min(af + acceleration, maxAcceleration);
        }
      }
    } else {
      currentSar = currentSar + af * (ep - currentSar);
      if (currentSar < prices[i]) {
        trend = 1;
        currentSar = ep;
        ep = prices[i];
        af = acceleration;
      } else {
        if (prices[i] < ep) {
          ep = prices[i];
          af = Math.min(af + acceleration, maxAcceleration);
        }
      }
    }
    
    sar.push(currentSar);
  }
  
  return { sar, trend };
}

function mapCandlesToPriceIndices(prices: number[], times: number[], tf: string): number[] {
  const seconds: Record<string, number> = {
    '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '12h': 43200, '1d': 86400,
  };
  const interval = seconds[tf] || 60;
  const indices: number[] = [];
  let lastBucket = -1;
  for (let i = 0; i < prices.length; i++) {
    const t = times[i] || Date.now() / 1000 + i;
    const bucket = Math.floor(t / interval) * interval;
    if (bucket !== lastBucket) {
      if (lastBucket !== -1) indices.push(i - 1);
      lastBucket = bucket;
    }
  }
  indices.push(prices.length - 1);
  return indices;
}

function calcSR(prices: number[]) {
  if (prices.length < 10) return { support: 0, resistance: 0 };
  const sorted = [...prices].sort((a, b) => a - b);
  const p5 = Math.floor(sorted.length * 0.05);
  const p95 = Math.floor(sorted.length * 0.95);
  return { support: sorted[p5], resistance: sorted[Math.min(p95, sorted.length - 1)] };
}

function calcMACDFull(prices: number[]) {
  const ema12 = calcEMA(prices, 12);
  const ema26 = calcEMA(prices, 26);
  const macd = ema12 - ema26;
  const signal = macd * 0.8;
  return { macd, signal, histogram: macd - signal };
}

interface TradeRecord {
  id: string;
  time: number;
  type: string;
  stake: number;
  profit: number;
  status: 'won' | 'lost' | 'open';
  symbol: string;
  resultDigit?: number;
}

const tickHistoryRef: { [symbol: string]: number[] } = {};

function getTickHistory(symbol: string): number[] {
  return tickHistoryRef[symbol] || [];
}

function addTick(symbol: string, digit: number) {
  if (!tickHistoryRef[symbol]) tickHistoryRef[symbol] = [];
  tickHistoryRef[symbol].push(digit);
  if (tickHistoryRef[symbol].length > 5000) tickHistoryRef[symbol].shift();
}

export default function TradingChart() {
  const { isAuthorized } = useAuth();
  const [showChart, setShowChart] = useState(true);
  const [symbol, setSymbol] = useState('R_100');
  const [groupFilter, setGroupFilter] = useState('all');
  const [timeframe, setTimeframe] = useState('1m');
  const [prices, setPrices] = useState<number[]>([]);
  const [times, setTimes] = useState<number[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const subscribedRef = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const subscriptionRef = useRef<any>(null);
  const reconnectAttempts = useRef(0);

  const [digitTickCount, setDigitTickCount] = useState(100);
  const [digitAnalysisData, setDigitAnalysisData] = useState<{ frequency: number[], percentages: number[], mostCommon: number, leastCommon: number }>({
    frequency: Array(10).fill(0), percentages: Array(10).fill(0), mostCommon: 0, leastCommon: 0
  });

  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [activeDrawingTool, setActiveDrawingTool] = useState<string | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentDrawing, setCurrentDrawing] = useState<Drawing | null>(null);
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);

  const [candleWidth, setCandleWidth] = useState(7);
  const [scrollOffset, setScrollOffset] = useState(0);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartOffset = useRef(0);
  const isPriceAxisDragging = useRef(false);
  const priceAxisStartY = useRef(0);
  const priceAxisStartWidth = useRef(7);

  const [tradeHistory, setTradeHistory] = useState<TradeRecord[]>([]);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const lastSpokenSignal = useRef('');

  const [strategyEnabled, setStrategyEnabled] = useState(false);
  const [strategyMode, setStrategyMode] = useState<'pattern' | 'digit'>('pattern');
  const [patternInput, setPatternInput] = useState('');
  const [digitCondition, setDigitCondition] = useState('==');
  const [digitCompare, setDigitCompare] = useState('5');
  const [digitWindow, setDigitWindow] = useState('3');

  const [botRunning, setBotRunning] = useState(false);
  const [botPaused, setBotPaused] = useState(false);
  const botRunningRef = useRef(false);
  const botPausedRef = useRef(false);
  const [botConfig, setBotConfig] = useState({
    botSymbol: 'R_100',
    stake: '1.00',
    contractType: 'CALL',
    prediction: '5',
    duration: '1',
    durationUnit: 't',
    martingale: false,
    multiplier: '2.0',
    stopLoss: '10',
    takeProfit: '20',
    maxTrades: '50',
  });
  const [botStats, setBotStats] = useState({ trades: 0, wins: 0, losses: 0, pnl: 0, currentStake: 0, consecutiveLosses: 0 });
  const [turboMode, setTurboMode] = useState(false);

  const [overUnderSignal, setOverUnderSignal] = useState<{ signal: 'OVER' | 'UNDER' | 'NEUTRAL', confidence: number, reasons: string[] }>({
    signal: 'NEUTRAL', confidence: 0, reasons: []
  });

  useEffect(() => {
    let active = true;
    let timeoutId: NodeJS.Timeout;

    const cleanup = async () => {
      if (subscriptionRef.current) {
        try {
          await derivApi.unsubscribeTicks(symbol as MarketSymbol);
        } catch (err) {
          console.error('Error unsubscribing:', err);
        }
        subscriptionRef.current = null;
      }
    };

    const load = async () => {
      if (!derivApi.isConnected) {
        setIsLoading(false);
        if (reconnectAttempts.current < 3) {
          reconnectAttempts.current++;
          timeoutId = setTimeout(load, 2000);
        }
        return;
      }

      reconnectAttempts.current = 0;
      setIsLoading(true);

      await cleanup();

      try {
        setPrices([]);
        setTimes([]);

        const hist = await derivApi.getTickHistory(symbol as MarketSymbol, 5000);
        if (!active) return;

        const historicalDigits = (hist.history.prices || []).map(p => getLastDigit(p));
        tickHistoryRef[symbol] = historicalDigits.slice(-5000);

        setPrices(hist.history.prices || []);
        setTimes(hist.history.times || []);
        setScrollOffset(0);
        setIsLoading(false);

        if (!subscribedRef.current || !subscriptionRef.current) {
          subscriptionRef.current = await derivApi.subscribeTicks(symbol as MarketSymbol, (data: any) => {
            if (!active || !data.tick) return;

            const quote = data.tick.quote;
            const digit = getLastDigit(quote);
            const epoch = data.tick.epoch;

            addTick(symbol, digit);

            setPrices(prev => {
              const newPrices = [...prev, quote];
              return newPrices.slice(-5000);
            });

            setTimes(prev => {
              const newTimes = [...prev, epoch];
              return newTimes.slice(-5000);
            });
          });
          subscribedRef.current = true;
          toast.success(`Connected to ${symbol} market`, { duration: 2000 });
        }
      } catch (err) {
        console.error('Error loading market data:', err);
        setIsLoading(false);
        toast.error(`Failed to load ${symbol} data`);
      }
    };

    load();

    return () => {
      active = false;
      if (timeoutId) clearTimeout(timeoutId);
      cleanup();
      subscribedRef.current = false;
    };
  }, [symbol]);

  useEffect(() => {
    const allDigits = getTickHistory(symbol);
    const recentDigits = allDigits.slice(-digitTickCount);
    const analysis = analyzeDigits(recentDigits);
    setDigitAnalysisData({
      frequency: analysis.frequency,
      percentages: analysis.percentages,
      mostCommon: analysis.mostCommon,
      leastCommon: analysis.leastCommon
    });
  }, [symbol, digitTickCount, prices]);

  const handleManualRefresh = useCallback(async () => {
    if (!derivApi.isConnected) {
      toast.error('Not connected to Deriv');
      return;
    }

    setIsLoading(true);
    try {
      const hist = await derivApi.getTickHistory(symbol as MarketSymbol, 100);
      setPrices(prev => {
        const newPrices = [...prev, ...hist.history.prices];
        return newPrices.slice(-5000);
      });
      setTimes(prev => {
        const newTimes = [...prev, ...hist.history.times];
        return newTimes.slice(-5000);
      });
      toast.success('Market data refreshed');
    } catch (err) {
      toast.error('Failed to refresh data');
    } finally {
      setIsLoading(false);
    }
  }, [symbol]);

  const tfPrices = useMemo(() => prices.slice(-5000), [prices]);
  const tfTimes = useMemo(() => times.slice(-5000), [times]);
  const candles = useMemo(() => buildCandles(tfPrices, tfTimes, timeframe, 1000), [tfPrices, tfTimes, timeframe]);
  const currentPrice = prices[prices.length - 1] || 0;
  const lastDigit = getLastDigit(currentPrice);
  const last26 = useMemo(() => {
    const tickHistory = getTickHistory(symbol);
    return tickHistory.slice(-26);
  }, [symbol, prices]);

  const bb = useMemo(() => calculateBollingerBands(tfPrices, 20), [tfPrices]);
  const ema50 = useMemo(() => calcEMA(tfPrices, 50), [tfPrices]);
  const sma20 = useMemo(() => {
    if (tfPrices.length < 20) return 0;
    return tfPrices.slice(-20).reduce((a, b) => a + b, 0) / 20;
  }, [tfPrices]);
  const { support, resistance } = useMemo(() => calcSR(tfPrices), [tfPrices]);
  const rsi = useMemo(() => calculateRSI(tfPrices, 14), [tfPrices]);
  const macd = useMemo(() => calcMACDFull(tfPrices), [tfPrices]);
  const { sar, trend: sarTrend } = useMemo(() => calcParabolicSAR(tfPrices), [tfPrices]);

  const digits = digitAnalysisData.frequency;
  const evenCount = digits.reduce((sum, count, idx) => sum + (idx % 2 === 0 ? count : 0), 0);
  const oddCount = digits.reduce((sum, count, idx) => sum + (idx % 2 !== 0 ? count : 0), 0);
  const totalDigits = digits.reduce((a, b) => a + b, 0);
  const evenPct = totalDigits > 0 ? (evenCount / totalDigits * 100) : 50;
  const oddPct = 100 - evenPct;
  const overCount = digits.reduce((sum, count, idx) => sum + (idx > 4 ? count : 0), 0);
  const underCount = digits.reduce((sum, count, idx) => sum + (idx <= 4 ? count : 0), 0);
  const overPct = totalDigits > 0 ? (overCount / totalDigits * 100) : 50;
  const underPct = 100 - overPct;

  useEffect(() => {
    const reasons: string[] = [];
    let signals = { over: 0, under: 0 };

    if (rsi > 70) {
      reasons.push(`RSI overbought (${rsi.toFixed(1)}) → Favor UNDER`);
      signals.under++;
    } else if (rsi < 30) {
      reasons.push(`RSI oversold (${rsi.toFixed(1)}) → Favor OVER`);
      signals.over++;
    }

    const bbPosition = ((currentPrice - bb.lower) / (bb.upper - bb.lower)) * 100;
    if (bbPosition > 90) {
      reasons.push(`Price near upper Bollinger Band → Favor UNDER`);
      signals.under++;
    } else if (bbPosition < 10) {
      reasons.push(`Price near lower Bollinger Band → Favor OVER`);
      signals.over++;
    }

    if (currentPrice > ema50 && currentPrice > sma20) {
      reasons.push(`Price above EMAs → Favor OVER`);
      signals.over++;
    } else if (currentPrice < ema50 && currentPrice < sma20) {
      reasons.push(`Price below EMAs → Favor UNDER`);
      signals.under++;
    }

    if (macd.macd > macd.signal) {
      reasons.push(`MACD bullish crossover → Favor OVER`);
      signals.over++;
    } else if (macd.macd < macd.signal) {
      reasons.push(`MACD bearish crossover → Favor UNDER`);
      signals.under++;
    }

    const lastSar = sar[sar.length - 1];
    if (lastSar !== null) {
      if (lastSar < currentPrice) {
        reasons.push(`SAR below price (uptrend) → Favor OVER`);
        signals.over++;
      } else if (lastSar > currentPrice) {
        reasons.push(`SAR above price (downtrend) → Favor UNDER`);
        signals.under++;
      }
    }

    let signal: 'OVER' | 'UNDER' | 'NEUTRAL' = 'NEUTRAL';
    let confidence = 50;
    if (signals.over > signals.under) {
      signal = 'OVER';
      confidence = 50 + (signals.over / (signals.over + signals.under)) * 40;
    } else if (signals.under > signals.over) {
      signal = 'UNDER';
      confidence = 50 + (signals.under / (signals.over + signals.under)) * 40;
    }

    setOverUnderSignal({ signal, confidence: Math.min(95, Math.max(5, confidence)), reasons });
  }, [rsi, bb, currentPrice, ema50, sma20, macd, sar]);

  const riseSignal = useMemo(() => {
    const conf = rsi < 30 ? 85 : rsi > 70 ? 25 : 50 + (50 - rsi);
    return { direction: rsi < 45 ? 'Rise' : 'Fall', confidence: Math.min(95, Math.max(10, Math.round(conf))) };
  }, [rsi]);

  const eoSignal = useMemo(() => {
    const conf = Math.abs(evenPct - 50) * 2 + 50;
    return { direction: evenPct > 50 ? 'Even' : 'Odd', confidence: Math.min(90, Math.round(conf)) };
  }, [evenPct]);

  const ouSignal = useMemo(() => {
    const conf = Math.abs(overPct - 50) * 2 + 50;
    return { direction: overPct > 50 ? 'Over' : 'Under', confidence: Math.min(90, Math.round(conf)) };
  }, [overPct]);

  const matchSignal = useMemo(() => {
    const bestPct = Math.max(...digitAnalysisData.percentages);
    return { digit: digitAnalysisData.mostCommon, confidence: Math.min(90, Math.round(bestPct * 3)) };
  }, [digitAnalysisData]);

  const cleanPattern = patternInput.toUpperCase().replace(/[^EO]/g, '');
  const patternValid = cleanPattern.length >= 2;

  const checkPatternMatch = useCallback((): boolean => {
    const ticks = getTickHistory(botConfig.botSymbol);
    if (ticks.length < cleanPattern.length) return false;
    const recent = ticks.slice(-cleanPattern.length);
    for (let i = 0; i < cleanPattern.length; i++) {
      const expected = cleanPattern[i];
      const actual = recent[i] % 2 === 0 ? 'E' : 'O';
      if (expected !== actual) return false;
    }
    return true;
  }, [botConfig.botSymbol, cleanPattern]);

  const checkDigitCondition = useCallback((): boolean => {
    const ticks = getTickHistory(botConfig.botSymbol);
    const win = parseInt(digitWindow) || 3;
    const comp = parseInt(digitCompare);
    if (ticks.length < win) return false;
    const recent = ticks.slice(-win);
    return recent.every(d => {
      switch (digitCondition) {
        case '>': return d > comp;
        case '<': return d < comp;
        case '>=': return d >= comp;
        case '<=': return d <= comp;
        case '==': return d === comp;
        case '!=': return d !== comp;
        default: return false;
      }
    });
  }, [botConfig.botSymbol, digitCondition, digitCompare, digitWindow]);

  const checkStrategyCondition = useCallback((): boolean => {
    if (!strategyEnabled) return true;
    if (strategyMode === 'pattern') {
      return checkPatternMatch();
    } else {
      return checkDigitCondition();
    }
  }, [strategyEnabled, strategyMode, checkPatternMatch, checkDigitCondition]);

  const startDrawing = (toolType: string) => {
    setActiveDrawingTool(toolType);
    setSelectedDrawingId(null);
    toast.info(`Drawing tool: ${toolType} - Click on chart to draw`);
  };

  const deleteDrawing = (id: string) => {
    setDrawings(prev => prev.filter(d => d.id !== id));
    if (selectedDrawingId === id) setSelectedDrawingId(null);
    toast.success('Drawing deleted');
  };

  const clearAllDrawings = () => {
    setDrawings([]);
    setSelectedDrawingId(null);
    toast.success('All drawings cleared');
  };

  const candleEndIndices = useMemo(() => mapCandlesToPriceIndices(tfPrices, tfTimes, timeframe), [tfPrices, tfTimes, timeframe]);
  const emaSeries = useMemo(() => calcEMASeries(tfPrices, 50), [tfPrices]);
  const smaSeries = useMemo(() => calcSMASeries(tfPrices, 20), [tfPrices]);
  const bbSeries = useMemo(() => calcBBSeries(tfPrices, 20, 2), [tfPrices]);
  const rsiSeries = useMemo(() => calcRSISeries(tfPrices, 14), [tfPrices]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !showChart) return;

    const getCanvasCoordinates = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY
      };
    };

    const onMouseDown = (e: MouseEvent) => {
      const coords = getCanvasCoordinates(e);
      const canvasRect = canvas.getBoundingClientRect();
      const pAxisX = canvasRect.width - 70;
      const localX = e.clientX - canvasRect.left;

      if (localX >= pAxisX) {
        isPriceAxisDragging.current = true;
        priceAxisStartY.current = e.clientY;
        priceAxisStartWidth.current = candleWidth;
        canvas.style.cursor = 'ns-resize';
      } else if (activeDrawingTool) {
        setIsDrawing(true);
        const newDrawing: Drawing = {
          id: `drawing_${Date.now()}_${Math.random()}`,
          type: activeDrawingTool as any,
          points: [{ x: coords.x, y: coords.y }],
          color: '#FFD700',
          selected: false,
        };
        setCurrentDrawing(newDrawing);
        canvas.style.cursor = 'crosshair';
      } else {
        isDragging.current = true;
        dragStartX.current = e.clientX;
        dragStartOffset.current = scrollOffset;
        canvas.style.cursor = 'grabbing';
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      if (isPriceAxisDragging.current) {
        const dy = priceAxisStartY.current - e.clientY;
        const newWidth = Math.max(2, Math.min(24, priceAxisStartWidth.current + Math.round(dy / 8)));
        setCandleWidth(newWidth);
        return;
      }

      if (isDrawing && currentDrawing) {
        const coords = getCanvasCoordinates(e);
        const updatedDrawing = { ...currentDrawing };
        
        if (currentDrawing.points.length === 1) {
          updatedDrawing.points = [...currentDrawing.points, coords];
        } else {
          updatedDrawing.points = [currentDrawing.points[0], coords];
        }
        setCurrentDrawing(updatedDrawing);
        return;
      }

      if (!isDragging.current) return;
      const dx = dragStartX.current - e.clientX;
      const candlesPerPx = 1 / (candleWidth + 1);
      const delta = Math.round(dx * candlesPerPx);
      setScrollOffset(Math.max(0, Math.min(candles.length - 10, dragStartOffset.current + delta)));
    };

    const onMouseUp = () => {
      if (isDrawing && currentDrawing && currentDrawing.points.length >= 2) {
        setDrawings(prev => [...prev, currentDrawing]);
        setCurrentDrawing(null);
        setIsDrawing(false);
        setActiveDrawingTool(null);
        toast.success('Drawing added');
      } else if (isDrawing) {
        setCurrentDrawing(null);
        setIsDrawing(false);
        setActiveDrawingTool(null);
      }

      isDragging.current = false;
      isPriceAxisDragging.current = false;
      canvas.style.cursor = 'crosshair';
    };

    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [candles.length, scrollOffset, candleWidth, showChart, activeDrawingTool, isDrawing, currentDrawing]);

  useEffect(() => {
    if (!showChart) return;

    const canvas = canvasRef.current;
    if (!canvas || candles.length < 2) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const W = rect.width;
    const totalH = rect.height;
    const rsiH = 80;
    const H = totalH - rsiH - 8;
    const priceAxisW = 70;
    const chartW = W - priceAxisW;

    ctx.fillStyle = '#0D1117';
    ctx.fillRect(0, 0, W, totalH);

    const gap = 1;
    const totalCandleW = candleWidth + gap;
    const maxVisible = Math.floor(chartW / totalCandleW);
    const endIdx = candles.length - scrollOffset;
    const startIdx = Math.max(0, endIdx - maxVisible);
    const visibleCandles = candles.slice(startIdx, endIdx);
    const visibleEndIndices = candleEndIndices.slice(startIdx, endIdx);

    if (visibleCandles.length < 1) return;

    const allPrices = visibleCandles.flatMap(c => [c.high, c.low]);
    for (let i = 0; i < visibleCandles.length; i++) {
      const idx = visibleEndIndices[i];
      if (idx === undefined) continue;
      const u = idx < bbSeries.upper.length ? bbSeries.upper[idx] : null;
      const l = idx < bbSeries.lower.length ? bbSeries.lower[idx] : null;
      if (u !== null) allPrices.push(u);
      if (l !== null) allPrices.push(l);
    }
    const rawMin = Math.min(...allPrices);
    const rawMax = Math.max(...allPrices);
    const priceRange = rawMax - rawMin;
    const padding = priceRange * 0.12 || 0.001;
    const minP = rawMin - padding;
    const maxP = rawMax + padding;
    const range = maxP - minP || 1;
    const chartPadTop = 20;
    const drawH = H - chartPadTop - 20;
    const toY = (p: number) => chartPadTop + ((maxP - p) / range) * drawH;

    ctx.strokeStyle = '#21262D';
    ctx.lineWidth = 0.5;
    const gridSteps = 8;
    ctx.font = '9px JetBrains Mono, monospace';
    ctx.fillStyle = '#484F58';
    for (let i = 0; i <= gridSteps; i++) {
      const y = chartPadTop + (i / gridSteps) * drawH;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(chartW, y); ctx.stroke();
      const pLabel = maxP - (i / gridSteps) * range;
      ctx.fillText(pLabel.toFixed(4), chartW + 4, y + 3);
    }

    const offsetX = 5;

    const drawLine = (values: (number | null)[], color: string, width: number, dash: number[] = []) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.setLineDash(dash);
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < visibleCandles.length; i++) {
        const idx = visibleEndIndices[i];
        if (idx === undefined) continue;
        const v = idx < values.length ? values[idx] : null;
        if (v === null) continue;
        const x = offsetX + i * totalCandleW + candleWidth / 2;
        const y = toY(v);
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    };

    drawLine(bbSeries.upper, '#BC8CFF', 1.2, [5, 3]);
    drawLine(bbSeries.middle, '#BC8CFF', 1.5);
    drawLine(bbSeries.lower, '#BC8CFF', 1.2, [5, 3]);
    drawLine(emaSeries, '#2F81F7', 1.5);
    drawLine(smaSeries, '#E6B422', 1.5);

    for (let i = 0; i < visibleCandles.length; i++) {
      const idx = visibleEndIndices[i];
      if (idx === undefined || idx >= sar.length) continue;
      const sarValue = sar[idx];
      if (sarValue !== null) {
        const x = offsetX + i * totalCandleW + candleWidth / 2;
        const y = toY(sarValue);
        ctx.fillStyle = '#3FB950';
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    for (let i = 0; i < visibleCandles.length; i++) {
      const c = visibleCandles[i];
      const x = offsetX + i * totalCandleW;
      const isBullish = c.close >= c.open;
      const color = isBullish ? '#3B82F6' : '#EF4444';

      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + candleWidth / 2, toY(c.high));
      ctx.lineTo(x + candleWidth / 2, toY(c.low));
      ctx.stroke();

      const bodyTop = toY(Math.max(c.open, c.close));
      const bodyBot = toY(Math.min(c.open, c.close));
      const bodyH = Math.max(1, bodyBot - bodyTop);
      ctx.fillStyle = color;
      ctx.fillRect(x, bodyTop, candleWidth, bodyH);
    }

    drawings.forEach(drawing => {
      if (drawing.points.length < 2) return;

      ctx.save();
      ctx.strokeStyle = drawing.selected ? '#FFD700' : drawing.color;
      ctx.fillStyle = drawing.selected ? '#FFD700' : drawing.color;
      ctx.lineWidth = 2;

      const start = drawing.points[0];
      const end = drawing.points[1];

      switch (drawing.type) {
        case 'trendline':
          ctx.beginPath();
          ctx.moveTo(start.x, start.y);
          ctx.lineTo(end.x, end.y);
          ctx.stroke();
          break;
        case 'arrow':
          ctx.beginPath();
          ctx.moveTo(start.x, start.y);
          ctx.lineTo(end.x, end.y);
          ctx.stroke();
          const angle = Math.atan2(end.y - start.y, end.x - start.x);
          const arrowSize = 8;
          ctx.beginPath();
          ctx.moveTo(end.x, end.y);
          ctx.lineTo(end.x - arrowSize * Math.cos(angle - Math.PI / 6), end.y - arrowSize * Math.sin(angle - Math.PI / 6));
          ctx.lineTo(end.x - arrowSize * Math.cos(angle + Math.PI / 6), end.y - arrowSize * Math.sin(angle + Math.PI / 6));
          ctx.fill();
          break;
        case 'rectangle':
          const width = Math.abs(end.x - start.x);
          const height = Math.abs(end.y - start.y);
          const x = Math.min(start.x, end.x);
          const y = Math.min(start.y, end.y);
          ctx.strokeRect(x, y, width, height);
          break;
        case 'circle':
          const radius = Math.sqrt(Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2));
          ctx.beginPath();
          ctx.arc(start.x, start.y, radius, 0, Math.PI * 2);
          ctx.stroke();
          break;
        case 'triangle':
          const centerX = (start.x + end.x) / 2;
          const centerY = (start.y + end.y) / 2;
          const size = Math.abs(end.x - start.x);
          ctx.beginPath();
          ctx.moveTo(centerX, centerY - size / 2);
          ctx.lineTo(centerX + size / 2, centerY + size / 2);
          ctx.lineTo(centerX - size / 2, centerY + size / 2);
          ctx.closePath();
          ctx.stroke();
          break;
        case 'long':
          ctx.beginPath();
          ctx.moveTo(start.x, start.y - 8);
          ctx.lineTo(start.x, start.y + 8);
          ctx.moveTo(start.x - 4, start.y);
          ctx.lineTo(start.x, start.y - 4);
          ctx.lineTo(start.x + 4, start.y);
          ctx.stroke();
          break;
        case 'short':
          ctx.beginPath();
          ctx.moveTo(start.x, start.y - 8);
          ctx.lineTo(start.x, start.y + 8);
          ctx.moveTo(start.x - 4, start.y);
          ctx.lineTo(start.x, start.y + 4);
          ctx.lineTo(start.x + 4, start.y);
          ctx.stroke();
          break;
      }
      ctx.restore();
    });

    if (currentDrawing && currentDrawing.points.length >= 2) {
      ctx.save();
      ctx.strokeStyle = '#FFD700';
      ctx.fillStyle = '#FFD700';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);

      const start = currentDrawing.points[0];
      const end = currentDrawing.points[1];

      switch (currentDrawing.type) {
        case 'trendline':
          ctx.beginPath();
          ctx.moveTo(start.x, start.y);
          ctx.lineTo(end.x, end.y);
          ctx.stroke();
          break;
        case 'arrow':
          ctx.beginPath();
          ctx.moveTo(start.x, start.y);
          ctx.lineTo(end.x, end.y);
          ctx.stroke();
          break;
        case 'rectangle':
          const width = Math.abs(end.x - start.x);
          const height = Math.abs(end.y - start.y);
          const x = Math.min(start.x, end.x);
          const y = Math.min(start.y, end.y);
          ctx.strokeRect(x, y, width, height);
          break;
        case 'circle':
          const radius = Math.sqrt(Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2));
          ctx.beginPath();
          ctx.arc(start.x, start.y, radius, 0, Math.PI * 2);
          ctx.stroke();
          break;
        case 'triangle':
          const centerX = (start.x + end.x) / 2;
          const centerY = (start.y + end.y) / 2;
          const size = Math.abs(end.x - start.x);
          ctx.beginPath();
          ctx.moveTo(centerX, centerY - size / 2);
          ctx.lineTo(centerX + size / 2, centerY + size / 2);
          ctx.lineTo(centerX - size / 2, centerY + size / 2);
          ctx.closePath();
          ctx.stroke();
          break;
        case 'long':
          ctx.beginPath();
          ctx.moveTo(start.x, start.y - 8);
          ctx.lineTo(start.x, start.y + 8);
          ctx.moveTo(start.x - 4, start.y);
          ctx.lineTo(start.x, start.y - 4);
          ctx.lineTo(start.x + 4, start.y);
          ctx.stroke();
          break;
        case 'short':
          ctx.beginPath();
          ctx.moveTo(start.x, start.y - 8);
          ctx.lineTo(start.x, start.y + 8);
          ctx.moveTo(start.x - 4, start.y);
          ctx.lineTo(start.x, start.y + 4);
          ctx.lineTo(start.x + 4, start.y);
          ctx.stroke();
          break;
      }
      ctx.setLineDash([]);
      ctx.restore();
    }

    const curY = toY(currentPrice);
    ctx.setLineDash([2, 2]);
    ctx.strokeStyle = '#E6EDF3';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, curY); ctx.lineTo(chartW, curY); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#58A6FF';
    ctx.fillRect(chartW, curY - 8, priceAxisW, 16);
    ctx.fillStyle = '#0D1117';
    ctx.font = 'bold 10px JetBrains Mono, monospace';
    ctx.fillText(currentPrice.toFixed(4), chartW + 2, curY + 4);

    ctx.font = '10px JetBrains Mono, monospace';
    ctx.fillStyle = '#484F58';
    ctx.fillText(`${visibleCandles.length} candles (fixed 1000) | Scroll: wheel | Zoom: Ctrl+wheel | Drag to pan`, 8, H - 6);
  }, [candles, bbSeries, emaSeries, smaSeries, sar, drawings, currentDrawing, candleWidth, scrollOffset, showChart, currentPrice]);

  const filteredMarkets = groupFilter === 'all' ? ALL_MARKETS : ALL_MARKETS.filter(m => m.group === groupFilter);
  const marketName = ALL_MARKETS.find(m => m.symbol === symbol)?.name || symbol;

  const speak = useCallback((text: string) => {
    if (!voiceEnabled || !window.speechSynthesis) return;
    if (lastSpokenSignal.current === text) return;
    lastSpokenSignal.current = text;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.1;
    utterance.pitch = 1;
    utterance.volume = 0.8;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }, [voiceEnabled]);

  const startBot = useCallback(async () => {
    if (!isAuthorized) { toast.error('Login to Deriv first'); return; }
    setBotRunning(true); setBotPaused(false);
    botRunningRef.current = true; botPausedRef.current = false;
    const baseStake = parseFloat(botConfig.stake) || 1;
    const sl = parseFloat(botConfig.stopLoss) || 10;
    const tp = parseFloat(botConfig.takeProfit) || 20;
    const maxT = parseInt(botConfig.maxTrades) || 50;
    const mart = botConfig.martingale;
    const mult = parseFloat(botConfig.multiplier) || 2;
    let stake = baseStake;
    let pnl = 0; let trades = 0; let wins = 0; let losses = 0; let consLosses = 0;

    if (voiceEnabled) speak('Auto trading bot started');

    while (botRunningRef.current) {
      if (botPausedRef.current) { await new Promise(r => setTimeout(r, 500)); continue; }
      if (trades >= maxT || pnl <= -sl || pnl >= tp) {
        const reason = trades >= maxT ? 'Max trades reached' : pnl <= -sl ? 'Stop loss hit' : 'Take profit reached';
        toast.info(`🤖 Bot stopped: ${reason}`);
        if (voiceEnabled) speak(`Bot stopped. ${reason}. Total profit ${pnl.toFixed(2)} dollars`);
        break;
      }

      if (strategyEnabled) {
        let conditionMet = false;
        while (botRunningRef.current && !conditionMet) {
          conditionMet = checkStrategyCondition();
          if (!conditionMet) {
            await new Promise(r => setTimeout(r, 500));
          }
        }
        if (!botRunningRef.current) break;
      }

      const ct = botConfig.contractType;
      const params: any = { contract_type: ct, symbol: botConfig.botSymbol, duration: parseInt(botConfig.duration), duration_unit: botConfig.durationUnit, basis: 'stake', amount: stake };
      if (['DIGITMATCH', 'DIGITDIFF', 'DIGITOVER', 'DIGITUNDER'].includes(ct)) params.barrier = botConfig.prediction;

      try {
        const { contractId } = await derivApi.buyContract(params);
        const tr: TradeRecord = { id: contractId, time: Date.now(), type: ct, stake, profit: 0, status: 'open', symbol: botConfig.botSymbol };
        setTradeHistory(prev => [tr, ...prev].slice(0, 100));
        const result = await derivApi.waitForContractResult(contractId);
        trades++; pnl += result.profit;
        const resultDigit = getLastDigit(result.price || 0);
        setTradeHistory(prev => prev.map(t => t.id === contractId ? { ...t, profit: result.profit, status: result.status, resultDigit } : t));

        if (result.status === 'won') {
          wins++; consLosses = 0;
          stake = baseStake;
          if (voiceEnabled && trades % 5 === 0) speak(`Trade ${trades} won. Total profit ${pnl.toFixed(2)}`);
        } else {
          losses++; consLosses++;
          if (mart) {
            stake = Math.round(stake * mult * 100) / 100;
          } else {
            stake = baseStake;
          }
          if (voiceEnabled) speak(`Loss ${consLosses}. ${mart ? `Martingale stake ${stake.toFixed(2)}` : ''}`);
        }
        setBotStats({ trades, wins, losses, pnl, currentStake: stake, consecutiveLosses: consLosses });
      } catch (err: any) {
        toast.error(`Bot trade error: ${err.message}`);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    setBotRunning(false); botRunningRef.current = false;
    setBotStats(prev => ({ ...prev, trades, wins, losses, pnl }));
  }, [isAuthorized, botConfig, voiceEnabled, speak, strategyEnabled, checkStrategyCondition]);

  const stopBot = useCallback(() => { botRunningRef.current = false; setBotRunning(false); toast.info('🛑 Bot stopped'); }, []);
  const togglePauseBot = useCallback(() => { botPausedRef.current = !botPausedRef.current; setBotPaused(botPausedRef.current); }, []);

  const handleBotSymbolChange = useCallback((newSymbol: string) => {
    setBotConfig(prev => ({ ...prev, botSymbol: newSymbol }));
    setSymbol(newSymbol);
  }, []);

  const totalTrades = tradeHistory.filter(t => t.status !== 'open').length;
  const wins = tradeHistory.filter(t => t.status === 'won').length;
  const losses = tradeHistory.filter(t => t.status === 'lost').length;
  const totalProfit = tradeHistory.reduce((s, t) => s + t.profit, 0);
  const winRate = totalTrades > 0 ? (wins / totalTrades * 100) : 0;

  return (
    <div className="space-y-4 max-w-[1920px] mx-auto p-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-primary" /> Trading Chart
          </h1>
          <p className="text-xs text-muted-foreground">{marketName} • {timeframe} • {candles.length} candles (fixed 1000)</p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={handleManualRefresh} variant="outline" size="sm" className="gap-1" disabled={isLoading}>
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button onClick={() => setShowChart(!showChart)} variant="outline" size="sm" className="gap-1">
            {showChart ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            {showChart ? "Hide Chart" : "Show Chart"}
          </Button>
          <Badge className="font-mono text-sm" variant="outline">{currentPrice.toFixed(4)}</Badge>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl p-3">
        <div className="flex flex-wrap gap-1 mb-2">
          {GROUPS.map(g => (
            <Button key={g.value} size="sm" variant={groupFilter === g.value ? 'default' : 'outline'}
              className="h-6 text-[10px] px-2" onClick={() => setGroupFilter(g.value)}>
              {g.label}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1 max-h-20 overflow-auto">
          {filteredMarkets.map(m => (
            <Button key={m.symbol} size="sm"
              variant={symbol === m.symbol ? 'default' : 'ghost'}
              className={`h-6 text-[9px] px-2 ${symbol === m.symbol ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
              onClick={() => setSymbol(m.symbol)}>
              {m.name}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        {TIMEFRAMES.map(tf => (
          <Button key={tf} size="sm" variant={timeframe === tf ? 'default' : 'outline'}
            className={`h-7 text-xs px-3 ${timeframe === tf ? 'bg-primary text-primary-foreground' : ''}`}
            onClick={() => setTimeframe(tf)}>
            {tf}
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <div className="xl:col-span-8 space-y-3">
          {showChart && (
            <div className="bg-card border border-border rounded-xl p-2 flex flex-wrap gap-1 items-center">
              <span className="text-[10px] text-muted-foreground mr-2">Draw:</span>
              {[
                { icon: <Move className="w-3 h-3" />, tool: 'trendline', label: 'Line' },
                { icon: <ArrowUp className="w-3 h-3" />, tool: 'arrow', label: 'Arrow' },
                { icon: <Square className="w-3 h-3" />, tool: 'rectangle', label: 'Rect' },
                { icon: <CircleIcon className="w-3 h-3" />, tool: 'circle', label: 'Circle' },
                { icon: <Triangle className="w-3 h-3" />, tool: 'triangle', label: 'Tri' },
                { icon: <LongIcon className="w-3 h-3" />, tool: 'long', label: 'Long' },
                { icon: <ShortIcon className="w-3 h-3" />, tool: 'short', label: 'Short' },
              ].map(({ icon, tool, label }) => (
                <Button key={tool} size="sm" variant={activeDrawingTool === tool ? 'default' : 'outline'}
                  className="h-7 text-[10px] gap-1" onClick={() => startDrawing(tool)}>
                  {icon}
                  <span className="hidden sm:inline">{label}</span>
                </Button>
              ))}
              <div className="flex-1" />
              <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1 text-loss hover:text-loss" onClick={clearAllDrawings}>
                <Trash2 className="w-3 h-3" /> Clear All
              </Button>
            </div>
          )}

          {selectedDrawingId && (
            <div className="bg-card border border-primary rounded-xl p-2 flex items-center justify-between">
              <span className="text-[10px] text-foreground">Drawing selected</span>
              <Button size="sm" variant="ghost" className="h-6 text-[9px] text-loss" onClick={() => deleteDrawing(selectedDrawingId)}>
                <Trash2 className="w-3 h-3 mr-1" /> Delete
              </Button>
            </div>
          )}

          <AnimatePresence mode="wait">
            {showChart && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.3 }} className="overflow-hidden">
                <div className="bg-[#0D1117] border border-[#30363D] rounded-xl overflow-hidden">
                  <canvas ref={canvasRef} className="w-full" style={{ height: 520, cursor: activeDrawingTool ? 'crosshair' : 'crosshair' }} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="grid grid-cols-3 md:grid-cols-7 gap-2">
            {[
              { label: 'Price', value: currentPrice.toFixed(4), color: 'text-foreground' },
              { label: 'Last Digit', value: String(lastDigit), color: 'text-primary' },
              { label: 'Support', value: support.toFixed(2), color: 'text-[#3FB950]' },
              { label: 'Resistance', value: resistance.toFixed(2), color: 'text-[#F85149]' },
              { label: 'BB Upper', value: bb.upper.toFixed(2), color: 'text-[#BC8CFF]' },
              { label: 'BB Middle', value: bb.middle.toFixed(2), color: 'text-[#BC8CFF]' },
              { label: 'BB Lower', value: bb.lower.toFixed(2), color: 'text-[#BC8CFF]' },
            ].map(item => (
              <div key={item.label} className="bg-card border border-border rounded-lg p-2 text-center">
                <div className="text-[9px] text-muted-foreground">{item.label}</div>
                <div className={`font-mono text-xs font-bold ${item.color}`}>{item.value}</div>
              </div>
            ))}
          </div>

          <div className="bg-card border border-border rounded-xl p-3 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-foreground">Digit Analysis (Tick-Based)</h3>
              <div className="flex items-center gap-2">
                <label className="text-[9px] text-muted-foreground">Last:</label>
                <Select value={String(digitTickCount)} onValueChange={(v) => setDigitTickCount(parseInt(v))}>
                  <SelectTrigger className="h-7 text-[10px] w-20"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[50, 100, 200, 500, 1000].map(count => (
                      <SelectItem key={count} value={String(count)}>{count} ticks</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div className="bg-[#D29922]/10 border border-[#D29922]/30 rounded-lg p-2">
                <div className="text-[9px] text-[#D29922]">Odd</div>
                <div className="font-mono text-sm font-bold text-[#D29922]">{oddPct.toFixed(1)}%</div>
                <div className="h-1.5 bg-muted rounded-full mt-1"><div className="h-full bg-[#D29922] rounded-full" style={{ width: `${oddPct}%` }} /></div>
              </div>
              <div className="bg-[#3FB950]/10 border border-[#3FB950]/30 rounded-lg p-2">
                <div className="text-[9px] text-[#3FB950]">Even</div>
                <div className="font-mono text-sm font-bold text-[#3FB950]">{evenPct.toFixed(1)}%</div>
                <div className="h-1.5 bg-muted rounded-full mt-1"><div className="h-full bg-[#3FB950] rounded-full" style={{ width: `${evenPct}%` }} /></div>
              </div>
              <div className="bg-primary/10 border border-primary/30 rounded-lg p-2">
                <div className="text-[9px] text-primary">Over 4 (5-9)</div>
                <div className="font-mono text-sm font-bold text-primary">{overPct.toFixed(1)}%</div>
                <div className="h-1.5 bg-muted rounded-full mt-1"><div className="h-full bg-primary rounded-full" style={{ width: `${overPct}%` }} /></div>
              </div>
              <div className="bg-[#D29922]/10 border border-[#D29922]/30 rounded-lg p-2">
                <div className="text-[9px] text-[#D29922]">Under 5 (0-4)</div>
                <div className="font-mono text-sm font-bold text-[#D29922]">{underPct.toFixed(1)}%</div>
                <div className="h-1.5 bg-muted rounded-full mt-1"><div className="h-full bg-[#D29922] rounded-full" style={{ width: `${underPct}%` }} /></div>
              </div>
            </div>

            <div className="grid grid-cols-5 md:grid-cols-10 gap-1.5">
              {Array.from({ length: 10 }, (_, d) => {
                const pct = digitAnalysisData.percentages[d] || 0;
                const count = digitAnalysisData.frequency[d] || 0;
                const isHot = pct > 12;
                const isWarm = pct > 9;
                const isBestMatch = d === digitAnalysisData.mostCommon;
                const isBestDiffer = d === digitAnalysisData.leastCommon;
                return (
                  <div key={d} className={`relative rounded-lg p-2 text-center transition-all border ${isHot ? 'bg-loss/10 border-loss/40 text-loss' : isWarm ? 'bg-warning/10 border-warning/40 text-warning' : 'bg-card border-border text-primary'}`}>
                    <div className="font-mono text-lg font-bold">{d}</div>
                    <div className="text-[8px]">{count} ({pct.toFixed(1)}%)</div>
                    <div className="h-1 bg-muted rounded-full mt-1">
                      <div className={`h-full rounded-full ${isHot ? 'bg-loss' : isWarm ? 'bg-warning' : 'bg-primary'}`} style={{ width: `${Math.min(100, pct * 5)}%` }} />
                    </div>
                    {isBestMatch && <Badge className="absolute -top-1 -right-1 text-[7px] px-1 bg-profit text-profit-foreground">Match</Badge>}
                    {isBestDiffer && <Badge className="absolute -top-1 -left-1 text-[7px] px-1 bg-loss text-loss-foreground">Differ</Badge>}
                  </div>
                );
              })}
            </div>
          </div>

          <div className={`bg-card border rounded-xl p-3 ${overUnderSignal.signal === 'OVER' ? 'border-profit' : overUnderSignal.signal === 'UNDER' ? 'border-loss' : 'border-border'}`}>
            <h3 className="text-xs font-semibold text-foreground flex items-center gap-1 mb-2">
              <Gauge className="w-3.5 h-3.5 text-primary" /> Over/Under Analysis (5 Indicators)
            </h3>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-muted-foreground">Signal:</span>
              <Badge className={`text-xs ${overUnderSignal.signal === 'OVER' ? 'bg-profit' : overUnderSignal.signal === 'UNDER' ? 'bg-loss' : 'bg-muted'}`}>
                {overUnderSignal.signal === 'OVER' ? '🔵 OVER' : overUnderSignal.signal === 'UNDER' ? '🔴 UNDER' : '⚪ NEUTRAL'}
              </Badge>
            </div>
            <div className="mb-2">
              <div className="flex justify-between text-[9px] text-muted-foreground mb-0.5">
                <span>Confidence</span>
                <span>{overUnderSignal.confidence.toFixed(0)}%</span>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${overUnderSignal.signal === 'OVER' ? 'bg-profit' : overUnderSignal.signal === 'UNDER' ? 'bg-loss' : 'bg-muted'}`} style={{ width: `${overUnderSignal.confidence}%` }} />
              </div>
            </div>
            {overUnderSignal.reasons.length > 0 && (
              <div className="space-y-0.5">
                <div className="text-[8px] text-muted-foreground">Signals:</div>
                {overUnderSignal.reasons.slice(0, 3).map((reason, idx) => (
                  <div key={idx} className="text-[8px] text-foreground">• {reason}</div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div className="bg-card border border-profit/30 rounded-lg p-2">
              <div className="text-[9px] text-muted-foreground">Best Match</div>
              <div className="font-mono text-lg font-bold text-profit">{digitAnalysisData.mostCommon}</div>
              <div className="text-[8px] text-muted-foreground">{digitAnalysisData.percentages[digitAnalysisData.mostCommon]?.toFixed(1)}% frequency</div>
            </div>
            <div className="bg-card border border-loss/30 rounded-lg p-2">
              <div className="text-[9px] text-muted-foreground">Best Differ</div>
              <div className="font-mono text-lg font-bold text-loss">{digitAnalysisData.leastCommon}</div>
              <div className="text-[8px] text-muted-foreground">{digitAnalysisData.percentages[digitAnalysisData.leastCommon]?.toFixed(1)}% frequency</div>
            </div>
            <div className="bg-card border border-[#D29922]/30 rounded-lg p-2">
              <div className="text-[9px] text-muted-foreground">Even/Odd</div>
              <div className={`font-mono text-lg font-bold ${evenPct > 50 ? 'text-[#3FB950]' : 'text-[#D29922]'}`}>
                {evenPct > 50 ? 'EVEN' : 'ODD'}
              </div>
              <div className="text-[8px] text-muted-foreground">{Math.max(evenPct, oddPct).toFixed(1)}%</div>
            </div>
            <div className="bg-card border border-primary/30 rounded-lg p-2">
              <div className="text-[9px] text-muted-foreground">Over/Under</div>
              <div className={`font-mono text-lg font-bold ${overPct > 50 ? 'text-primary' : 'text-[#D29922]'}`}>
                {overPct > 50 ? 'OVER' : 'UNDER'}
              </div>
              <div className="text-[8px] text-muted-foreground">{Math.max(overPct, underPct).toFixed(1)}%</div>
            </div>
          </div>
        </div>

        <div className="xl:col-span-4 space-y-3">
          <div className="bg-card border border-primary/30 rounded-xl p-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-foreground flex items-center gap-1">
                <Zap className="w-3.5 h-3.5 text-primary" /> AI Voice Signals
              </h3>
              <Button size="sm" variant={voiceEnabled ? 'default' : 'outline'} className="h-7 text-[10px] gap-1" onClick={() => setVoiceEnabled(!voiceEnabled)}>
                {voiceEnabled ? <Volume2 className="w-3 h-3" /> : <VolumeX className="w-3 h-3" />}
                {voiceEnabled ? 'ON' : 'OFF'}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="bg-card border border-border rounded-xl p-3">
              <div className="flex items-center gap-1 mb-1">
                {riseSignal.direction === 'Rise' ? <TrendingUp className="w-3.5 h-3.5 text-profit" /> : <TrendingDown className="w-3.5 h-3.5 text-loss" />}
                <span className="text-[10px] font-semibold">Rise/Fall</span>
              </div>
              <div className={`font-mono text-sm font-bold ${riseSignal.direction === 'Rise' ? 'text-profit' : 'text-loss'}`}>{riseSignal.direction}</div>
              <div className="text-[8px] text-muted-foreground mb-1">RSI: {rsi.toFixed(1)}</div>
              <div className="h-1.5 bg-muted rounded-full"><div className={`h-full rounded-full ${riseSignal.direction === 'Rise' ? 'bg-profit' : 'bg-loss'}`} style={{ width: `${riseSignal.confidence}%` }} /></div>
            </div>
            <div className="bg-card border border-border rounded-xl p-3">
              <div className="flex items-center gap-1 mb-1">
                <Activity className="w-3.5 h-3.5 text-primary" />
                <span className="text-[10px] font-semibold">Even/Odd</span>
              </div>
              <div className={`font-mono text-sm font-bold ${eoSignal.direction === 'Even' ? 'text-[#3FB950]' : 'text-[#D29922]'}`}>{eoSignal.direction}</div>
              <div className="text-[8px] text-muted-foreground mb-1">{evenPct.toFixed(1)}% even</div>
              <div className="h-1.5 bg-muted rounded-full"><div className={`h-full rounded-full ${eoSignal.direction === 'Even' ? 'bg-[#3FB950]' : 'bg-[#D29922]'}`} style={{ width: `${eoSignal.confidence}%` }} /></div>
            </div>
            <div className="bg-card border border-border rounded-xl p-3">
              <div className="flex items-center gap-1 mb-1">
                <ArrowUp className="w-3.5 h-3.5 text-primary" />
                <span className="text-[10px] font-semibold">Over/Under</span>
              </div>
              <div className={`font-mono text-sm font-bold ${ouSignal.direction === 'Over' ? 'text-primary' : 'text-[#D29922]'}`}>{ouSignal.direction}</div>
              <div className="text-[8px] text-muted-foreground mb-1">{overPct.toFixed(1)}% over</div>
              <div className="h-1.5 bg-muted rounded-full"><div className={`h-full rounded-full ${ouSignal.direction === 'Over' ? 'bg-primary' : 'bg-[#D29922]'}`} style={{ width: `${ouSignal.confidence}%` }} /></div>
            </div>
            <div className="bg-card border border-border rounded-xl p-3">
              <div className="flex items-center gap-1 mb-1">
                <Target className="w-3.5 h-3.5 text-profit" />
                <span className="text-[10px] font-semibold">Best Match</span>
              </div>
              <div className="font-mono text-sm font-bold text-profit">Digit {matchSignal.digit}</div>
              <div className="text-[8px] text-muted-foreground mb-1">{digitAnalysisData.percentages[digitAnalysisData.mostCommon]?.toFixed(1)}% freq</div>
              <div className="h-1.5 bg-muted rounded-full"><div className="h-full bg-profit rounded-full" style={{ width: `${matchSignal.confidence}%` }} /></div>
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl p-3">
            <h3 className="text-xs font-semibold text-foreground mb-2">Last 26 Digits</h3>
            <div className="flex gap-1 flex-wrap justify-center">
              {last26.map((d, i) => {
                const isLast = i === last26.length - 1;
                const isEven = d % 2 === 0;
                return (
                  <motion.div key={i} initial={isLast ? { scale: 0.8 } : {}} animate={isLast ? { scale: [1, 1.1, 1] } : {}} transition={isLast ? { duration: 1, repeat: Infinity } : {}} className={`w-7 h-9 rounded-lg flex items-center justify-center font-mono font-bold text-xs border-2 transition-all ${isLast ? 'w-9 h-11 text-sm ring-2 ring-primary' : ''} ${isEven ? 'border-[#3FB950] text-[#3FB950] bg-[#3FB950]/10' : 'border-[#D29922] text-[#D29922] bg-[#D29922]/10'}`}>
                    {d}
                  </motion.div>
                );
              })}
            </div>
          </div>

          <div className={`bg-card border rounded-xl p-3 space-y-2 ${botRunning ? 'border-profit' : 'border-border'}`}>
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-foreground flex items-center gap-1"><Zap className="w-3.5 h-3.5 text-primary" /> Auto Trading Bot</h3>
              <div className="flex items-center gap-2">
                <Button size="sm" variant={turboMode ? 'default' : 'outline'} className={`h-6 text-[9px] px-2 ${turboMode ? 'bg-profit animate-pulse' : ''}`} onClick={() => setTurboMode(!turboMode)} disabled={botRunning}>
                  <Zap className="w-3 h-3 mr-0.5" /> {turboMode ? 'TURBO' : 'Turbo'}
                </Button>
                {botRunning && <Badge className="text-[8px] bg-profit">RUNNING</Badge>}
              </div>
            </div>

            <div>
              <label className="text-[9px] text-muted-foreground">Market</label>
              <Select value={botConfig.botSymbol} onValueChange={handleBotSymbolChange} disabled={botRunning}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{ALL_MARKETS.map(m => <SelectItem key={m.symbol} value={m.symbol}>{m.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>

            <Select value={botConfig.contractType} onValueChange={v => setBotConfig(p => ({ ...p, contractType: v }))} disabled={botRunning}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{CONTRACT_TYPES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
            </Select>

            {['DIGITMATCH', 'DIGITDIFF', 'DIGITOVER', 'DIGITUNDER'].includes(botConfig.contractType) && (
              <div>
                <label className="text-[9px] text-muted-foreground">Prediction (0-9)</label>
                <div className="grid grid-cols-5 gap-1">
                  {Array.from({ length: 10 }, (_, i) => (
                    <button key={i} disabled={botRunning} onClick={() => setBotConfig(p => ({ ...p, prediction: String(i) }))} className={`h-6 rounded text-[10px] font-mono font-bold ${botConfig.prediction === String(i) ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>{i}</button>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-[9px] text-muted-foreground">Stake ($)</label><Input type="number" min="0.35" step="0.01" value={botConfig.stake} onChange={e => setBotConfig(p => ({ ...p, stake: e.target.value }))} disabled={botRunning} className="h-7 text-xs" /></div>
              <div><label className="text-[9px] text-muted-foreground">Duration</label><div className="flex gap-1"><Input type="number" min="1" value={botConfig.duration} onChange={e => setBotConfig(p => ({ ...p, duration: e.target.value }))} disabled={botRunning} className="h-7 text-xs flex-1" /><Select value={botConfig.durationUnit} onValueChange={v => setBotConfig(p => ({ ...p, durationUnit: v }))} disabled={botRunning}><SelectTrigger className="h-7 text-xs w-16"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="t">T</SelectItem><SelectItem value="s">S</SelectItem><SelectItem value="m">M</SelectItem></SelectContent></Select></div></div>
            </div>

            <div className="flex items-center justify-between">
              <label className="text-[10px] text-foreground">Martingale</label>
              <div className="flex items-center gap-2">
                {botConfig.martingale && <Input type="number" min="1.1" step="0.1" value={botConfig.multiplier} onChange={e => setBotConfig(p => ({ ...p, multiplier: e.target.value }))} disabled={botRunning} className="h-6 text-[10px] w-14" />}
                <button onClick={() => setBotConfig(p => ({ ...p, martingale: !p.martingale }))} disabled={botRunning} className={`w-9 h-5 rounded-full transition-colors ${botConfig.martingale ? 'bg-primary' : 'bg-muted'} relative`}>
                  <div className={`w-4 h-4 rounded-full bg-background shadow absolute top-0.5 transition-transform ${botConfig.martingale ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </button>
              </div>
            </div>

            <div className="border-t border-border pt-2 mt-1">
              <div className="flex items-center justify-between mb-2">
                <label className="text-[10px] font-semibold text-warning">Pattern/Digit Strategy</label>
                <Switch checked={strategyEnabled} onCheckedChange={setStrategyEnabled} disabled={botRunning} />
              </div>
              {strategyEnabled && (
                <div className="space-y-2">
                  <div className="flex gap-1">
                    <Button size="sm" variant={strategyMode === 'pattern' ? 'default' : 'outline'} className="text-[9px] h-6 px-2 flex-1" onClick={() => setStrategyMode('pattern')} disabled={botRunning}>Pattern (E/O)</Button>
                    <Button size="sm" variant={strategyMode === 'digit' ? 'default' : 'outline'} className="text-[9px] h-6 px-2 flex-1" onClick={() => setStrategyMode('digit')} disabled={botRunning}>Digit Condition</Button>
                  </div>
                  {strategyMode === 'pattern' ? (
                    <div><label className="text-[8px] text-muted-foreground">Pattern (E=Even, O=Odd)</label><Textarea placeholder="e.g., EEEOE" value={patternInput} onChange={e => setPatternInput(e.target.value.toUpperCase().replace(/[^EO]/g, ''))} disabled={botRunning} className="h-12 text-[10px] font-mono min-h-0 mt-1" /><div className={`text-[9px] font-mono mt-1 ${patternValid ? 'text-profit' : 'text-loss'}`}>{cleanPattern.length === 0 ? 'Enter pattern (min 2)' : patternValid ? `✓ Pattern: ${cleanPattern}` : `✗ Need at least 2`}</div></div>
                  ) : (
                    <div className="grid grid-cols-3 gap-1">
                      <div><label className="text-[8px] text-muted-foreground">Last</label><Input type="number" min="1" max="50" value={digitWindow} onChange={e => setDigitWindow(e.target.value)} disabled={botRunning} className="h-7 text-[10px]" /></div>
                      <div><label className="text-[8px] text-muted-foreground">ticks</label><Select value={digitCondition} onValueChange={setDigitCondition} disabled={botRunning}><SelectTrigger className="h-7 text-[10px]"><SelectValue /></SelectTrigger><SelectContent>{['==', '!=', '>', '<', '>=', '<='].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></div>
                      <div><label className="text-[8px] text-muted-foreground">Digit</label><Input type="number" min="0" max="9" value={digitCompare} onChange={e => setDigitCompare(e.target.value)} disabled={botRunning} className="h-7 text-[10px]" /></div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              <div><label className="text-[8px] text-muted-foreground">Stop Loss</label><Input type="number" value={botConfig.stopLoss} onChange={e => setBotConfig(p => ({ ...p, stopLoss: e.target.value }))} disabled={botRunning} className="h-7 text-xs" /></div>
              <div><label className="text-[8px] text-muted-foreground">Take Profit</label><Input type="number" value={botConfig.takeProfit} onChange={e => setBotConfig(p => ({ ...p, takeProfit: e.target.value }))} disabled={botRunning} className="h-7 text-xs" /></div>
              <div><label className="text-[8px] text-muted-foreground">Max Trades</label><Input type="number" value={botConfig.maxTrades} onChange={e => setBotConfig(p => ({ ...p, maxTrades: e.target.value }))} disabled={botRunning} className="h-7 text-xs" /></div>
            </div>

            {botRunning && (
              <div className="grid grid-cols-3 gap-1 text-center">
                <div className="bg-muted/30 rounded p-1"><div className="text-[7px] text-muted-foreground">Stake</div><div className="font-mono text-[10px]">${botStats.currentStake.toFixed(2)}</div></div>
                <div className="bg-muted/30 rounded p-1"><div className="text-[7px] text-muted-foreground">Streak</div><div className="font-mono text-[10px] text-loss">{botStats.consecutiveLosses}L</div></div>
                <div className={`${botStats.pnl >= 0 ? 'bg-profit/10' : 'bg-loss/10'} rounded p-1`}><div className="text-[7px] text-muted-foreground">P/L</div><div className={`font-mono text-[10px] ${botStats.pnl >= 0 ? 'text-profit' : 'text-loss'}`}>{botStats.pnl >= 0 ? '+' : ''}{botStats.pnl.toFixed(2)}</div></div>
              </div>
            )}

            <div className="flex gap-2">
              {!botRunning ? (
                <Button onClick={startBot} disabled={!isAuthorized} className="flex-1 h-10 text-xs font-bold bg-profit hover:bg-profit/90"><Play className="w-4 h-4 mr-1" /> Start Bot</Button>
              ) : (
                <>
                  <Button onClick={togglePauseBot} variant="outline" className="flex-1 h-10 text-xs"><Pause className="w-3.5 h-3.5 mr-1" /> {botPaused ? 'Resume' : 'Pause'}</Button>
                  <Button onClick={stopBot} variant="destructive" className="flex-1 h-10 text-xs"><StopCircle className="w-3.5 h-3.5 mr-1" /> Stop</Button>
                </>
              )}
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-foreground"><Trophy className="w-3.5 h-3.5 inline mr-1 text-primary" /> Trade Progress</h3>
              {tradeHistory.length > 0 && <Button variant="ghost" size="sm" className="h-6 text-[9px]" onClick={() => { setTradeHistory([]); setBotStats({ trades: 0, wins: 0, losses: 0, pnl: 0, currentStake: 0, consecutiveLosses: 0 }); }}>Clear</Button>}
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              <div className="bg-muted/30 rounded-lg p-1.5 text-center"><div className="text-[8px] text-muted-foreground">Trades</div><div className="font-mono text-sm">{totalTrades}</div></div>
              <div className="bg-profit/10 rounded-lg p-1.5 text-center"><div className="text-[8px] text-profit">Wins</div><div className="font-mono text-sm text-profit">{wins}</div></div>
              <div className="bg-loss/10 rounded-lg p-1.5 text-center"><div className="text-[8px] text-loss">Losses</div><div className="font-mono text-sm text-loss">{losses}</div></div>
              <div className={`${totalProfit >= 0 ? 'bg-profit/10' : 'bg-loss/10'} rounded-lg p-1.5 text-center`}><div className="text-[8px] text-muted-foreground">P/L</div><div className={`font-mono text-sm ${totalProfit >= 0 ? 'text-profit' : 'text-loss'}`}>{totalProfit >= 0 ? '+' : ''}{totalProfit.toFixed(2)}</div></div>
            </div>
            {totalTrades > 0 && (
              <div><div className="flex justify-between text-[9px] mb-0.5"><span>Win Rate</span><span>{winRate.toFixed(1)}%</span></div><div className="h-2 bg-muted rounded-full"><div className="h-full bg-profit rounded-full" style={{ width: `${winRate}%` }} /></div></div>
            )}
          </div>

          <div className="bg-card border border-border rounded-xl p-3 space-y-2">
            <h3 className="text-xs font-semibold text-foreground"><ShieldAlert className="w-3.5 h-3.5 inline mr-1 text-primary" /> Technical Status</h3>
            <div className="space-y-1.5">
              <div className="flex justify-between text-[10px]"><span className="text-muted-foreground">RSI (14)</span><span className={`font-mono ${rsi > 70 ? 'text-loss' : rsi < 30 ? 'text-profit' : ''}`}>{rsi.toFixed(1)} {rsi > 70 ? 'Overbought' : rsi < 30 ? 'Oversold' : 'Neutral'}</span></div>
              <div className="flex justify-between text-[10px]"><span className="text-muted-foreground">MACD</span><span className={`font-mono ${macd.macd > 0 ? 'text-profit' : 'text-loss'}`}>{macd.macd > 0 ? 'Bullish' : 'Bearish'}</span></div>
              <div className="flex justify-between text-[10px]"><span className="text-muted-foreground">EMA 50</span><span className={`font-mono ${currentPrice > ema50 ? 'text-profit' : 'text-loss'}`}>{currentPrice > ema50 ? 'Above' : 'Below'}</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
