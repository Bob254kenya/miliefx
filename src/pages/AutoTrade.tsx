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
  Target, ShieldAlert, Volume2, VolumeX, Zap, Trophy, Play, Pause, StopCircle, Eye, EyeOff, RefreshCw,
  TrendingUp as TrendLineIcon, Circle as CircleIcon, Square, Triangle, ArrowRight, MousePointer, Trash2, LineChart, Settings, Sliders
} from 'lucide-react';

/* ============================================
   CONSTANTS & CONFIGURATION
   ============================================ */

// Markets Data
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

// Target candles - 800 for all timeframes
const TARGET_CANDLES = 800;

// Tick selector options (50 to 5000)
const TICK_OPTIONS = [50, 100, 200, 300, 500, 800, 1000, 1500, 2000, 3000, 4000, 5000];

// Get required ticks for target candles (ensures enough data for 800 candles)
const getRequiredTicksForTimeframe = (timeframe: string): number => {
  const seconds: Record<string, number> = {
    '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800,
    '1h': 3600, '4h': 14400, '12h': 43200, '1d': 86400,
  };
  const interval = seconds[timeframe] || 60;
  // Calculate ticks needed for 800 candles with 50% buffer
  return Math.ceil(TARGET_CANDLES * interval * 1.5);
};

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

/* ============================================
   TYPE DEFINITIONS
   ============================================ */

interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  time: number;
}

interface DrawingTool {
  id: string;
  type: 'trendline' | 'long' | 'short' | 'triangle' | 'arrow' | 'rectangle' | 'circle';
  points: { x: number; y: number }[];
  color: string;
}

interface IndicatorSettings {
  macd: boolean;
  bollinger: boolean;
  ma9: boolean;
  ma20: boolean;
  ma50: boolean;
  rsi: boolean;
  parabolicSAR: boolean;
  supportResistance: boolean;
}

interface SupportResistanceLevel {
  level: number;
  strength: number;
  type: 'support' | 'resistance';
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

/* ============================================
   HELPER FUNCTIONS
   ============================================ */

// Build candles from tick data
function buildCandles(prices: number[], times: number[], tf: string): Candle[] {
  if (prices.length === 0) return [];
  const seconds: Record<string, number> = {
    '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800,
    '1h': 3600, '4h': 14400, '12h': 43200, '1d': 86400,
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
  return candles;
}

// EMA Calculation
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
  const result: (number | null)[] = new Array(prices.length).fill(null);
  if (prices.length < period) return result;
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result[period - 1] = ema;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
    result[i] = ema;
  }
  return result;
}

// Bollinger Bands
function calcBBSeries(prices: number[], period: number = 20, mult: number = 2) {
  const upper: (number | null)[] = new Array(prices.length).fill(null);
  const middle: (number | null)[] = new Array(prices.length).fill(null);
  const lower: (number | null)[] = new Array(prices.length).fill(null);
  
  for (let i = period - 1; i < prices.length; i++) {
    const slice = prices.slice(i - period + 1, i + 1);
    const ma = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((s, p) => s + Math.pow(p - ma, 2), 0) / period;
    const std = Math.sqrt(variance);
    upper[i] = ma + mult * std;
    middle[i] = ma;
    lower[i] = ma - mult * std;
  }
  return { upper, middle, lower };
}

// RSI Series
function calcRSISeries(prices: number[], period: number = 14): (number | null)[] {
  const result: (number | null)[] = new Array(prices.length).fill(null);
  if (prices.length < period + 1) return result;
  
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = prices[i] - prices[i - 1];
    if (d > 0) gains += d;
    else losses -= d;
  }
  
  let avgGain = gains / period;
  let avgLoss = losses / period;
  let rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  result[period] = rsi;
  
  for (let i = period + 1; i < prices.length; i++) {
    const d = prices[i] - prices[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(0, d)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -d)) / period;
    rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    result[i] = rsi;
  }
  return result;
}

// Parabolic SAR
function calcParabolicSAR(highs: number[], lows: number[], step: number = 0.02, maxStep: number = 0.2): (number | null)[] {
  const sar: (number | null)[] = new Array(highs.length).fill(null);
  if (highs.length < 2) return sar;
  
  let trend = 1;
  let ep = trend === 1 ? highs[0] : lows[0];
  let af = step;
  let currentSar = trend === 1 ? lows[0] : highs[0];
  sar[0] = currentSar;
  
  for (let i = 1; i < highs.length; i++) {
    currentSar = currentSar + af * (ep - currentSar);
    
    if (trend === 1) {
      currentSar = Math.min(currentSar, lows[i - 1], lows[i - 2] || lows[i - 1]);
      if (currentSar > lows[i]) {
        trend = -1;
        currentSar = ep;
        ep = lows[i];
        af = step;
      } else {
        if (highs[i] > ep) {
          ep = highs[i];
          af = Math.min(af + step, maxStep);
        }
      }
    } else {
      currentSar = Math.max(currentSar, highs[i - 1], highs[i - 2] || highs[i - 1]);
      if (currentSar < highs[i]) {
        trend = 1;
        currentSar = ep;
        ep = highs[i];
        af = step;
      } else {
        if (lows[i] < ep) {
          ep = lows[i];
          af = Math.min(af + step, maxStep);
        }
      }
    }
    sar[i] = currentSar;
  }
  return sar;
}

// Support & Resistance Levels (3 each)
function calcSupportResistanceLevels(prices: number[], candles: Candle[]): SupportResistanceLevel[] {
  const levels: SupportResistanceLevel[] = [];
  const windowSize = Math.min(20, Math.floor(candles.length / 15));
  
  for (let i = windowSize; i < candles.length - windowSize; i++) {
    const candle = candles[i];
    let isHighPivot = true;
    let isLowPivot = true;
    
    for (let j = i - windowSize; j <= i + windowSize; j++) {
      if (j === i) continue;
      if (candles[j].high >= candle.high) isHighPivot = false;
      if (candles[j].low <= candle.low) isLowPivot = false;
    }
    
    if (isHighPivot) {
      levels.push({ level: candle.high, strength: 1, type: 'resistance' });
    }
    if (isLowPivot) {
      levels.push({ level: candle.low, strength: 1, type: 'support' });
    }
  }
  
  // Group nearby levels
  const grouped: SupportResistanceLevel[] = [];
  const tolerance = (Math.max(...prices) - Math.min(...prices)) * 0.01;
  
  for (const level of levels) {
    let found = false;
    for (const g of grouped) {
      if (Math.abs(g.level - level.level) < tolerance) {
        g.strength++;
        found = true;
        break;
      }
    }
    if (!found) {
      grouped.push({ ...level });
    }
  }
  
  // Get top 3 supports and resistances
  const supports = grouped.filter(l => l.type === 'support').sort((a, b) => b.strength - a.strength).slice(0, 3);
  const resistances = grouped.filter(l => l.type === 'resistance').sort((a, b) => b.strength - a.strength).slice(0, 3);
  
  return [...supports, ...resistances];
}

// Map candles to price indices
function mapCandlesToPriceIndices(prices: number[], times: number[], tf: string): number[] {
  const seconds: Record<string, number> = {
    '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800,
    '1h': 3600, '4h': 14400, '12h': 43200, '1d': 86400,
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

// Calculate Support & Resistance
function calcSR(prices: number[]) {
  if (prices.length < 10) return { support: 0, resistance: 0 };
  const sorted = [...prices].sort((a, b) => a - b);
  const p5 = Math.floor(sorted.length * 0.05);
  const p95 = Math.floor(sorted.length * 0.95);
  return { support: sorted[p5], resistance: sorted[Math.min(p95, sorted.length - 1)] };
}

// Calculate MACD
function calcMACDFull(prices: number[]) {
  const ema12 = calcEMA(prices, 12);
  const ema26 = calcEMA(prices, 26);
  const macd = ema12 - ema26;
  const signal = macd * 0.8;
  return { macd, signal, histogram: macd - signal };
}

// Tick history storage
const tickHistoryRef: { [symbol: string]: number[] } = {};

function getTickHistory(symbol: string): number[] {
  return tickHistoryRef[symbol] || [];
}

function addTick(symbol: string, digit: number) {
  if (!tickHistoryRef[symbol]) tickHistoryRef[symbol] = [];
  tickHistoryRef[symbol].push(digit);
  if (tickHistoryRef[symbol].length > 10000) tickHistoryRef[symbol].shift();
}

/* ============================================
   MAIN COMPONENT
   ============================================ */

export default function TradingChart() {
  const { isAuthorized } = useAuth();
  
  // UI State
  const [showChart, setShowChart] = useState(false);
  const [symbol, setSymbol] = useState('R_100');
  const [groupFilter, setGroupFilter] = useState('all');
  const [timeframe, setTimeframe] = useState('1m');
  const [selectedTicks, setSelectedTicks] = useState(1000); // Default 1000 ticks
  
  // Data State
  const [prices, setPrices] = useState<number[]>([]);
  const [times, setTimes] = useState<number[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const subscribedRef = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const subscriptionRef = useRef<any>(null);
  const reconnectAttempts = useRef(0);
  
  // Chart Interaction State - NO CANDLE REMOVAL ON SCROLL
  const [candleWidth, setCandleWidth] = useState(3);
  const [scrollOffset, setScrollOffset] = useState(0);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartOffset = useRef(0);
  
  // Drawing Tools State
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [drawings, setDrawings] = useState<DrawingTool[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentDrawing, setCurrentDrawing] = useState<DrawingTool | null>(null);
  
  // Indicators State - All initially OFF
  const [indicators, setIndicators] = useState<IndicatorSettings>({
    macd: false,
    bollinger: false,
    ma9: false,
    ma20: false,
    ma50: false,
    rsi: false,
    parabolicSAR: false,
    supportResistance: false,
  });
  
  // Trade Panel State
  const [contractType, setContractType] = useState('CALL');
  const [prediction, setPrediction] = useState('5');
  const [duration, setDuration] = useState('1');
  const [durationUnit, setDurationUnit] = useState('t');
  const [tradeStake, setTradeStake] = useState('1.00');
  const [selectedDigit, setSelectedDigit] = useState<number | null>(null);
  const [isTrading, setIsTrading] = useState(false);
  const [tradeHistory, setTradeHistory] = useState<TradeRecord[]>([]);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const lastSpokenSignal = useRef('');
  
  // Strategy State
  const [strategyEnabled, setStrategyEnabled] = useState(false);
  const [strategyMode, setStrategyMode] = useState<'pattern' | 'digit'>('pattern');
  const [patternInput, setPatternInput] = useState('');
  const [digitCondition, setDigitCondition] = useState('==');
  const [digitCompare, setDigitCompare] = useState('5');
  const [digitWindow, setDigitWindow] = useState('3');
  
  // Bot State
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
  
  /* ============================================
     DATA LOADING - TICKS DON'T AFFECT CANDLE COUNT
     ============================================ */
  
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
        
        // Load data based on selected ticks (does NOT affect candle count)
        const hist = await derivApi.getTickHistory(symbol as MarketSymbol, selectedTicks);
        if (!active) return;
        
        const historicalDigits = (hist.history.prices || []).map((p: number) => getLastDigit(p));
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
              return newPrices.slice(-30000);
            });
            
            setTimes(prev => {
              const newTimes = [...prev, epoch];
              return newTimes.slice(-30000);
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
  }, [symbol, selectedTicks]);
  
  const handleManualRefresh = useCallback(async () => {
    if (!derivApi.isConnected) {
      toast.error('Not connected to Deriv');
      return;
    }
    
    setIsLoading(true);
    try {
      const hist = await derivApi.getTickHistory(symbol as MarketSymbol, selectedTicks);
      setPrices(prev => {
        const newPrices = [...prev, ...hist.history.prices];
        return newPrices.slice(-30000);
      });
      setTimes(prev => {
        const newTimes = [...prev, ...hist.history.times];
        return newTimes.slice(-30000);
      });
      toast.success('Market data refreshed');
    } catch (err) {
      toast.error('Failed to refresh data');
    } finally {
      setIsLoading(false);
    }
  }, [symbol, selectedTicks]);
  
  /* ============================================
     DERIVED DATA & INDICATORS
     ============================================ */
  
  // Use ALL available prices for candles (not limited by ticks)
  // This ensures 800 candles regardless of tick selection
  const tfPrices = useMemo(() => prices.slice(), [prices]);
  const tfTimes = useMemo(() => times.slice(), [times]);
  const candles = useMemo(() => buildCandles(tfPrices, tfTimes, timeframe), [tfPrices, tfTimes, timeframe]);
  const currentPrice = prices[prices.length - 1] || 0;
  const lastDigit = getLastDigit(currentPrice);
  const digits = useMemo(() => tfPrices.map(getLastDigit), [tfPrices]);
  const last26 = useMemo(() => getTickHistory(symbol).slice(-26), [symbol, prices]);
  const { frequency, percentages, mostCommon, leastCommon } = useMemo(() => analyzeDigits(tfPrices), [tfPrices]);
  
  // Indicators
  const bb = useMemo(() => calculateBollingerBands(tfPrices, 20), [tfPrices]);
  const ema9 = useMemo(() => calcEMA(tfPrices, 9), [tfPrices]);
  const ema20 = useMemo(() => calcEMA(tfPrices, 20), [tfPrices]);
  const ema50 = useMemo(() => calcEMA(tfPrices, 50), [tfPrices]);
  const { support, resistance } = useMemo(() => calcSR(tfPrices), [tfPrices]);
  const rsi = useMemo(() => calculateRSI(tfPrices, 14), [tfPrices]);
  const macd = useMemo(() => calcMACDFull(tfPrices), [tfPrices]);
  
  // Series for chart
  const candleEndIndices = useMemo(() => mapCandlesToPriceIndices(tfPrices, tfTimes, timeframe), [tfPrices, tfTimes, timeframe]);
  const ema9Series = useMemo(() => calcEMASeries(tfPrices, 9), [tfPrices]);
  const ema20Series = useMemo(() => calcEMASeries(tfPrices, 20), [tfPrices]);
  const ema50Series = useMemo(() => calcEMASeries(tfPrices, 50), [tfPrices]);
  const bbSeries = useMemo(() => calcBBSeries(tfPrices, 20, 2), [tfPrices]);
  const rsiSeries = useMemo(() => calcRSISeries(tfPrices, 14), [tfPrices]);
  const parabolicSAR = useMemo(() => {
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    return calcParabolicSAR(highs, lows);
  }, [candles]);
  const supportResistanceLevels = useMemo(() => calcSupportResistanceLevels(tfPrices, candles), [tfPrices, candles]);
  
  // Digit stats
  const evenCount = digits.filter(d => d % 2 === 0).length;
  const oddCount = digits.length - evenCount;
  const evenPct = digits.length > 0 ? (evenCount / digits.length * 100) : 50;
  const oddPct = 100 - evenPct;
  const overCount = digits.filter(d => d > 4).length;
  const underCount = digits.length - overCount;
  const overPct = digits.length > 0 ? (overCount / digits.length * 100) : 50;
  const underPct = 100 - overPct;
  
  const bbRange = bb.upper - bb.lower || 1;
  const bbPosition = ((currentPrice - bb.lower) / bbRange * 100);
  
  // Signals
  const riseSignal = useMemo(() => {
    const conf = rsi < 30 ? 85 : rsi > 70 ? 25 : 50 + (50 - rsi);
    return { direction: rsi < 45 ? 'Rise' : 'Fall', confidence: Math.min(95, Math.max(10, Math.round(conf))) };
  }, [rsi]);
  
  const matchSignal = useMemo(() => {
    const bestPct = Math.max(...percentages);
    return { digit: mostCommon, confidence: Math.min(90, Math.round(bestPct * 3)) };
  }, [percentages, mostCommon]);
  
  // Combined Multi-Indicator Signal
  const combinedSignal = useMemo(() => {
    let overScore = 0;
    let underScore = 0;
    let signals: string[] = [];
    
    // Parabolic SAR
    if (indicators.parabolicSAR && parabolicSAR.length > 0) {
      const lastSAR = parabolicSAR[parabolicSAR.length - 1];
      const lastCandle = candles[candles.length - 1];
      if (lastSAR !== null && lastCandle) {
        if (lastSAR < lastCandle.close) {
          overScore += 25;
          signals.push('📈 SAR: Up trend → Over');
        } else if (lastSAR > lastCandle.close) {
          underScore += 25;
          signals.push('📉 SAR: Down trend → Under');
        }
      }
    }
    
    // Bollinger Bands
    if (indicators.bollinger && bb.lower && bb.upper) {
      if (currentPrice >= bb.upper * 0.98) {
        underScore += 20;
        signals.push('📊 BB: Upper band touch → Under');
      } else if (currentPrice <= bb.lower * 1.02) {
        overScore += 20;
        signals.push('📊 BB: Lower band touch → Over');
      }
    }
    
    // Moving Average Crossover
    if (indicators.ma9 && indicators.ma20) {
      const lastEma9 = ema9Series[ema9Series.length - 1];
      const lastEma20 = ema20Series[ema20Series.length - 1];
      const prevEma9 = ema9Series[ema9Series.length - 2];
      const prevEma20 = ema20Series[ema20Series.length - 2];
      
      if (lastEma9 && lastEma20 && prevEma9 && prevEma20) {
        if (prevEma9 <= prevEma20 && lastEma9 > lastEma20) {
          overScore += 25;
          signals.push('📈 MA: Golden Cross → Over');
        } else if (prevEma9 >= prevEma20 && lastEma9 < lastEma20) {
          underScore += 25;
          signals.push('📉 MA: Death Cross → Under');
        }
      }
    }
    
    // MACD
    if (indicators.macd) {
      if (macd.histogram > 0 && macd.histogram > (macd.histogram - 0.1)) {
        overScore += 20;
        signals.push('📊 MACD: Bullish momentum → Over');
      } else if (macd.histogram < 0 && macd.histogram < (macd.histogram + 0.1)) {
        underScore += 20;
        signals.push('📊 MACD: Bearish momentum → Under');
      }
    }
    
    // RSI
    if (indicators.rsi) {
      if (rsi > 70) {
        underScore += 25;
        signals.push('⚠️ RSI: Overbought → Under');
      } else if (rsi < 30) {
        overScore += 25;
        signals.push('⚠️ RSI: Oversold → Over');
      }
    }
    
    const totalScore = overScore + underScore;
    const confidence = totalScore > 0 ? Math.min(95, Math.max(50, Math.round((Math.max(overScore, underScore) / totalScore) * 100))) : 50;
    const direction = overScore > underScore ? 'Over' : underScore > overScore ? 'Under' : 'Neutral';
    const color = direction === 'Over' ? 'text-profit' : direction === 'Under' ? 'text-loss' : 'text-warning';
    
    return { direction, confidence, signals, color, overScore, underScore };
  }, [indicators, parabolicSAR, candles, bb, currentPrice, ema9Series, ema20Series, macd, rsi]);
  
  /* ============================================
     DRAWING TOOLS FUNCTIONS
     ============================================ */
  
  const getCanvasCoordinates = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);
  
  const startDrawing = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!activeTool) return;
    const coords = getCanvasCoordinates(e);
    if (!coords) return;
    
    setIsDrawing(true);
    const newDrawing: DrawingTool = {
      id: Date.now().toString(),
      type: activeTool as any,
      points: [coords],
      color: activeTool === 'long' ? '#3FB950' : activeTool === 'short' ? '#F85149' : '#BC8CFF',
    };
    setCurrentDrawing(newDrawing);
  }, [activeTool, getCanvasCoordinates]);
  
  const draw = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !currentDrawing) return;
    const coords = getCanvasCoordinates(e);
    if (!coords) return;
    
    setCurrentDrawing(prev => {
      if (!prev) return null;
      return { ...prev, points: [...prev.points, coords] };
    });
  }, [isDrawing, currentDrawing, getCanvasCoordinates]);
  
  const endDrawing = useCallback(() => {
    if (currentDrawing && currentDrawing.points.length > 1) {
      setDrawings(prev => [...prev, currentDrawing]);
    }
    setIsDrawing(false);
    setCurrentDrawing(null);
  }, [currentDrawing]);
  
  const deleteAllDrawings = useCallback(() => {
    setDrawings([]);
  }, []);
  
  const toggleIndicator = useCallback((indicator: keyof IndicatorSettings) => {
    setIndicators(prev => ({ ...prev, [indicator]: !prev[indicator] }));
  }, []);
  
  /* ============================================
     CANVAS DRAWING - NO CANDLE REMOVAL ON SCROLL
     ============================================ */
  
  useEffect(() => {
    if (!showChart || !canvasRef.current || candles.length === 0) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    
    const W = rect.width;
    const totalH = rect.height;
    const rsiH = indicators.rsi ? 80 : 0;
    const macdH = indicators.macd ? 100 : 0;
    const H = totalH - rsiH - macdH - 8;
    const priceAxisW = 70;
    const chartW = W - priceAxisW - 40; // 40px right margin
    
    ctx.fillStyle = '#0D1117';
    ctx.fillRect(0, 0, W, totalH);
    
    const gap = 1;
    const totalCandleW = candleWidth + gap;
    const maxVisible = Math.floor(chartW / totalCandleW);
    // NO CANDLE REMOVAL - just shift visible window
    const endIdx = Math.min(candles.length, candles.length - scrollOffset);
    const startIdx = Math.max(0, endIdx - maxVisible);
    const visibleCandles = candles.slice(startIdx, endIdx);
    
    if (visibleCandles.length === 0) return;
    
    const visibleEndIndices = candleEndIndices.slice(startIdx, endIdx);
    const allPrices = visibleCandles.flatMap(c => [c.high, c.low]);
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
    
    const offsetX = 5;
    
    // Draw grid
    ctx.strokeStyle = '#21262D';
    ctx.lineWidth = 0.5;
    ctx.font = '9px JetBrains Mono, monospace';
    ctx.fillStyle = '#484F58';
    
    for (let i = 0; i <= 8; i++) {
      const y = chartPadTop + (i / 8) * drawH;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(chartW, y);
      ctx.stroke();
      const pLabel = maxP - (i / 8) * range;
      ctx.fillText(pLabel.toFixed(2), chartW + 4, y + 3);
    }
    
    // Draw Bollinger Bands
    if (indicators.bollinger && bbSeries.upper.length > 0) {
      ctx.fillStyle = 'rgba(188, 140, 255, 0.06)';
      const bbUpperPoints: { x: number; y: number }[] = [];
      const bbLowerPoints: { x: number; y: number }[] = [];
      
      for (let i = 0; i < visibleCandles.length; i++) {
        const idx = visibleEndIndices[i];
        if (idx === undefined) continue;
        const u = idx < bbSeries.upper.length ? bbSeries.upper[idx] : null;
        const l = idx < bbSeries.lower.length ? bbSeries.lower[idx] : null;
        if (u === null || l === null) continue;
        const x = offsetX + i * totalCandleW + candleWidth / 2;
        bbUpperPoints.push({ x, y: toY(u) });
        bbLowerPoints.push({ x, y: toY(l) });
      }
      
      if (bbUpperPoints.length > 1) {
        ctx.beginPath();
        ctx.moveTo(bbUpperPoints[0].x, bbUpperPoints[0].y);
        bbUpperPoints.forEach(p => ctx.lineTo(p.x, p.y));
        for (let i = bbLowerPoints.length - 1; i >= 0; i--) {
          ctx.lineTo(bbLowerPoints[i].x, bbLowerPoints[i].y);
        }
        ctx.closePath();
        ctx.fill();
      }
      
      const drawBBLine = (values: (number | null)[], color: string, dash: number[] = []) => {
        ctx.beginPath();
        ctx.setLineDash(dash);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.2;
        let started = false;
        for (let i = 0; i < visibleCandles.length; i++) {
          const idx = visibleEndIndices[i];
          if (idx === undefined) continue;
          const v = idx < values.length ? values[idx] : null;
          if (v === null) continue;
          const x = offsetX + i * totalCandleW + candleWidth / 2;
          const y = toY(v);
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
      };
      
      drawBBLine(bbSeries.upper, '#BC8CFF', [5, 3]);
      drawBBLine(bbSeries.middle, '#BC8CFF', []);
      drawBBLine(bbSeries.lower, '#BC8CFF', [5, 3]);
      ctx.setLineDash([]);
    }
    
    // Draw Moving Averages
    const drawMALine = (values: (number | null)[], color: string, width: number) => {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      let started = false;
      for (let i = 0; i < visibleCandles.length; i++) {
        const idx = visibleEndIndices[i];
        if (idx === undefined) continue;
        const v = idx < values.length ? values[idx] : null;
        if (v === null) continue;
        const x = offsetX + i * totalCandleW + candleWidth / 2;
        const y = toY(v);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    };
    
    if (indicators.ma9) drawMALine(ema9Series, '#2F81F7', 1.5);
    if (indicators.ma20) drawMALine(ema20Series, '#E6B422', 1.5);
    if (indicators.ma50) drawMALine(ema50Series, '#F97316', 1.5);
    
    // Draw Parabolic SAR
    if (indicators.parabolicSAR && parabolicSAR.length > 0) {
      for (let i = 0; i < visibleCandles.length; i++) {
        const idx = visibleEndIndices[i];
        if (idx === undefined) continue;
        const sar = idx < parabolicSAR.length ? parabolicSAR[idx] : null;
        if (sar === null) continue;
        const x = offsetX + i * totalCandleW + candleWidth / 2;
        const y = toY(sar);
        ctx.fillStyle = '#FFA500';
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, 2 * Math.PI);
        ctx.fill();
      }
    }
    
    // Draw Support & Resistance Lines (3 each)
    if (indicators.supportResistance && supportResistanceLevels.length > 0) {
      const supports = supportResistanceLevels.filter(s => s.type === 'support');
      const resistances = supportResistanceLevels.filter(s => s.type === 'resistance');
      
      resistances.forEach((res, idx) => {
        const y = toY(res.level);
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = '#F85149';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(chartW, y);
        ctx.stroke();
        
        ctx.fillStyle = '#F85149';
        ctx.font = '9px JetBrains Mono, monospace';
        ctx.fillText(`R${idx + 1} ${res.level.toFixed(2)}`, chartW - 50, y - 5);
      });
      
      supports.forEach((sup, idx) => {
        const y = toY(sup.level);
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = '#3B82F6';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(chartW, y);
        ctx.stroke();
        
        ctx.fillStyle = '#3B82F6';
        ctx.font = '9px JetBrains Mono, monospace';
        ctx.fillText(`S${idx + 1} ${sup.level.toFixed(2)}`, chartW - 50, y + 12);
      });
      ctx.setLineDash([]);
    }
    
    // Draw Candles - BLUE for bullish, RED for bearish
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
    
    // Draw current price line
    const curY = toY(currentPrice);
    ctx.setLineDash([2, 2]);
    ctx.strokeStyle = '#E6EDF3';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, curY);
    ctx.lineTo(chartW, curY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#58A6FF';
    ctx.fillRect(chartW, curY - 8, priceAxisW, 16);
    ctx.fillStyle = '#0D1117';
    ctx.font = 'bold 10px JetBrains Mono, monospace';
    ctx.fillText(currentPrice.toFixed(2), chartW + 2, curY + 4);
    
    // Draw drawings
    drawings.forEach(drawing => {
      if (drawing.points.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(drawing.points[0].x, drawing.points[0].y);
      for (let i = 1; i < drawing.points.length; i++) {
        ctx.lineTo(drawing.points[i].x, drawing.points[i].y);
      }
      ctx.strokeStyle = drawing.color;
      ctx.lineWidth = 2;
      ctx.stroke();
    });
    
    // Draw current drawing
    if (currentDrawing && currentDrawing.points.length > 1) {
      ctx.beginPath();
      ctx.moveTo(currentDrawing.points[0].x, currentDrawing.points[0].y);
      for (let i = 1; i < currentDrawing.points.length; i++) {
        ctx.lineTo(currentDrawing.points[i].x, currentDrawing.points[i].y);
      }
      ctx.strokeStyle = currentDrawing.color;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    
    // Draw MACD
    if (indicators.macd && macdH > 0) {
      const macdTop = H + 8;
      ctx.fillStyle = '#161B22';
      ctx.fillRect(0, macdTop, W, macdH);
      
      const macdToY = (v: number) => macdTop + 10 + ((0.5 - v) / 1) * (macdH - 20);
      const macdLine = tfPrices.map((_, i) => {
        const ema12 = calcEMA(tfPrices.slice(0, i + 1), 12);
        const ema26 = calcEMA(tfPrices.slice(0, i + 1), 26);
        return ema12 - ema26;
      });
      
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < visibleCandles.length; i++) {
        const idx = visibleEndIndices[i];
        if (idx === undefined) continue;
        const v = idx < macdLine.length ? macdLine[idx] : null;
        if (v === null) continue;
        const x = offsetX + i * totalCandleW + candleWidth / 2;
        const y = macdToY(v);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.strokeStyle = '#2F81F7';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      
      ctx.fillStyle = '#8B949E';
      ctx.font = '9px JetBrains Mono, monospace';
      ctx.fillText('MACD (12,26,9)', 4, macdTop + 12);
    }
    
    // Draw RSI
    if (indicators.rsi && rsiH > 0) {
      const rsiTop = H + (indicators.macd ? macdH + 8 : 8);
      ctx.fillStyle = '#161B22';
      ctx.fillRect(0, rsiTop, W, rsiH);
      
      const rsiToY = (v: number) => rsiTop + 4 + ((100 - v) / 100) * (rsiH - 8);
      
      [30, 50, 70].forEach(level => {
        const y = rsiToY(level);
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = level === 50 ? '#484F58' : level === 70 ? '#F8514950' : '#3FB95050';
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(chartW, y);
        ctx.stroke();
        ctx.fillStyle = '#484F58';
        ctx.fillText(String(level), chartW + 4, y + 3);
      });
      
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < visibleCandles.length; i++) {
        const idx = visibleEndIndices[i];
        if (idx === undefined) continue;
        const v = idx < rsiSeries.length ? rsiSeries[idx] : null;
        if (v === null) continue;
        const x = offsetX + i * totalCandleW + candleWidth / 2;
        const y = rsiToY(v);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.strokeStyle = '#D29922';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);
      
      const lastRsi = rsiSeries[rsiSeries.length - 1];
      if (lastRsi !== null) {
        ctx.fillStyle = '#D29922';
        ctx.fillRect(chartW, rsiToY(lastRsi) - 7, priceAxisW, 14);
        ctx.fillStyle = '#0D1117';
        ctx.font = 'bold 9px JetBrains Mono, monospace';
        ctx.fillText(lastRsi.toFixed(1), chartW + 2, rsiToY(lastRsi) + 3);
      }
      
      ctx.fillStyle = '#8B949E';
      ctx.font = '9px JetBrains Mono, monospace';
      ctx.fillText('RSI(14)', 4, rsiTop + 12);
    }
    
    // Legend
    ctx.font = '10px JetBrains Mono, monospace';
    let lx = 8;
    const legends = [];
    if (indicators.bollinger) legends.push({ label: 'BB(20,2)', color: '#BC8CFF' });
    if (indicators.ma9) legends.push({ label: 'MA 9', color: '#2F81F7' });
    if (indicators.ma20) legends.push({ label: 'MA 20', color: '#E6B422' });
    if (indicators.ma50) legends.push({ label: 'MA 50', color: '#F97316' });
    if (indicators.parabolicSAR) legends.push({ label: 'SAR', color: '#FFA500' });
    if (indicators.supportResistance) legends.push({ label: 'S/R', color: '#3B82F6' });
    
    legends.forEach(l => {
      ctx.fillStyle = l.color;
      ctx.fillRect(lx, 6, 10, 3);
      ctx.fillText(l.label, lx + 14, 12);
      lx += ctx.measureText(l.label).width + 24;
    });
    
    ctx.fillStyle = '#484F58';
    ctx.font = '9px JetBrains Mono, monospace';
    ctx.fillText(`${visibleCandles.length}/${candles.length} candles | ${selectedTicks} ticks | Drag to pan | Ctrl+wheel zoom`, 8, H - 6);
  }, [candles, candleEndIndices, candleWidth, scrollOffset, showChart, indicators, drawings, currentDrawing, 
      bbSeries, ema9Series, ema20Series, ema50Series, currentPrice, macd, rsiSeries, tfPrices, parabolicSAR, supportResistanceLevels, selectedTicks]);
  
  /* ============================================
     MOUSE HANDLERS - NO CANDLE REMOVAL
     ============================================ */
  
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !showChart) return;
    
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        setCandleWidth(prev => Math.max(2, Math.min(12, prev - Math.sign(e.deltaY))));
      } else {
        // Scroll to pan WITHOUT removing candles
        const delta = Math.sign(e.deltaY) * Math.max(5, Math.floor(candles.length * 0.05));
        setScrollOffset(prev => Math.max(0, Math.min(candles.length - 15, prev + delta)));
      }
    };
    
    const onMouseDown = (e: MouseEvent) => {
      if (activeTool) {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        setIsDrawing(true);
        setCurrentDrawing({
          id: Date.now().toString(),
          type: activeTool as any,
          points: [{ x, y }],
          color: activeTool === 'long' ? '#3FB950' : activeTool === 'short' ? '#F85149' : '#BC8CFF',
        });
      } else {
        isDragging.current = true;
        dragStartX.current = e.clientX;
        dragStartOffset.current = scrollOffset;
        canvas.style.cursor = 'grabbing';
      }
    };
    
    const onMouseMove = (e: MouseEvent) => {
      if (isDrawing && currentDrawing && activeTool) {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        setCurrentDrawing(prev => {
          if (!prev) return null;
          return { ...prev, points: [...prev.points, { x, y }] };
        });
      } else if (isDragging.current && !activeTool) {
        const dx = dragStartX.current - e.clientX;
        const candlesPerPx = 1 / (candleWidth + 1);
        const delta = Math.round(dx * candlesPerPx);
        setScrollOffset(prev => Math.max(0, Math.min(candles.length - 10, dragStartOffset.current + delta)));
      }
    };
    
    const onMouseUp = () => {
      if (isDrawing && currentDrawing && currentDrawing.points.length > 1) {
        setDrawings(prev => [...prev, currentDrawing]);
      }
      setIsDrawing(false);
      setCurrentDrawing(null);
      isDragging.current = false;
      canvas.style.cursor = 'crosshair';
    };
    
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    
    return () => {
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [candles.length, scrollOffset, candleWidth, showChart, activeTool, isDrawing, currentDrawing]);
  
  /* ============================================
     TRADING & BOT FUNCTIONS
     ============================================ */
  
  const filteredMarkets = groupFilter === 'all' ? ALL_MARKETS : ALL_MARKETS.filter(m => m.group === groupFilter);
  const marketName = ALL_MARKETS.find(m => m.symbol === symbol)?.name || symbol;
  
  const speak = useCallback((text: string) => {
    if (!voiceEnabled || !window.speechSynthesis) return;
    if (lastSpokenSignal.current === text) return;
    lastSpokenSignal.current = text;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.1;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }, [voiceEnabled]);
  
  const handleBuy = async (side: 'buy' | 'sell') => {
    if (!isAuthorized) { toast.error('Please login to your Deriv account first'); return; }
    if (isTrading) return;
    setIsTrading(true);
    const ct = side === 'buy' ? contractType : (contractType === 'CALL' ? 'PUT' : contractType === 'PUT' ? 'CALL' : contractType);
    const params: any = { contract_type: ct, symbol, duration: parseInt(duration), duration_unit: durationUnit, basis: 'stake', amount: parseFloat(tradeStake) };
    if (['DIGITMATCH', 'DIGITDIFF', 'DIGITOVER', 'DIGITUNDER'].includes(ct)) params.barrier = prediction;
    try {
      toast.info(`⏳ Placing ${ct} trade... $${tradeStake}`);
      const { contractId } = await derivApi.buyContract(params);
      const newTrade: TradeRecord = { id: contractId, time: Date.now(), type: ct, stake: parseFloat(tradeStake), profit: 0, status: 'open', symbol };
      setTradeHistory(prev => [newTrade, ...prev].slice(0, 50));
      const result = await derivApi.waitForContractResult(contractId);
      const resultDigit = getLastDigit(result.price || currentPrice);
      setTradeHistory(prev => prev.map(t => t.id === contractId ? { ...t, profit: result.profit, status: result.status, resultDigit } : t));
      if (result.status === 'won') { toast.success(`✅ WON +$${result.profit.toFixed(2)}`); if (voiceEnabled) speak(`Trade won. Profit ${result.profit.toFixed(2)} dollars`); }
      else { toast.error(`❌ LOST -$${Math.abs(result.profit).toFixed(2)}`); if (voiceEnabled) speak(`Trade lost. Loss ${Math.abs(result.profit).toFixed(2)} dollars`); }
    } catch (err: any) { toast.error(`Trade failed: ${err.message}`); }
    finally { setIsTrading(false); }
  };
  
  const checkPatternMatch = useCallback((): boolean => {
    const ticks = getTickHistory(botConfig.botSymbol);
    const cleanPattern = patternInput.toUpperCase().replace(/[^EO]/g, '');
    if (ticks.length < cleanPattern.length) return false;
    const recent = ticks.slice(-cleanPattern.length);
    for (let i = 0; i < cleanPattern.length; i++) {
      const expected = cleanPattern[i];
      const actual = recent[i] % 2 === 0 ? 'E' : 'O';
      if (expected !== actual) return false;
    }
    return true;
  }, [botConfig.botSymbol, patternInput]);
  
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
  
  /* ============================================
     RENDER
     ============================================ */
  
  return (
    <div className="space-y-4 max-w-[1920px] mx-auto p-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-primary" /> Trading Chart
          </h1>
          <p className="text-xs text-muted-foreground">{marketName} • {timeframe} • {candles.length}/{TARGET_CANDLES} candles</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Animated Tick Selector with Red Background */}
          <motion.div 
            className="flex items-center gap-2 rounded-lg px-3 py-1"
            style={{ background: 'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)' }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <Sliders className="w-4 h-4 text-white animate-pulse" />
            <select 
              value={selectedTicks} 
              onChange={(e) => setSelectedTicks(parseInt(e.target.value))}
              className="bg-transparent text-white text-sm h-8 px-2 rounded focus:outline-none cursor-pointer font-medium"
              style={{ textShadow: '0 1px 1px rgba(0,0,0,0.2)' }}
            >
              {TICK_OPTIONS.map(ticks => (
                <option key={ticks} value={ticks} className="bg-gray-900 text-white">
                  📊 {ticks.toLocaleString()} ticks
                </option>
              ))}
            </select>
          </motion.div>
          
          <Button onClick={handleManualRefresh} variant="outline" size="sm" className="gap-1" disabled={isLoading}>
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button onClick={() => setShowChart(!showChart)} variant="outline" size="sm" className="gap-1">
            {showChart ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            {showChart ? "Hide Chart" : "Show Chart"}
          </Button>
          <Badge className="font-mono text-sm bg-gradient-to-r from-blue-500 to-purple-500" variant="default">
            ${currentPrice.toFixed(2)}
          </Badge>
        </div>
      </div>
      
      {/* Market Selector */}
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
      
      {/* Timeframe */}
      <div className="flex flex-wrap gap-1">
        {TIMEFRAMES.map(tf => (
          <Button key={tf} size="sm" variant={timeframe === tf ? 'default' : 'outline'}
            className={`h-7 text-xs px-3 ${timeframe === tf ? 'bg-primary text-primary-foreground' : ''}`}
            onClick={() => setTimeframe(tf)}>
            {tf}
          </Button>
        ))}
      </div>
      
      {/* Multi-Indicator Strategy Signal Container */}
      <motion.div 
        className="bg-gradient-to-r from-blue-950/30 to-purple-950/30 border border-primary/30 rounded-xl p-3"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className="flex items-center gap-2 mb-2">
          <Zap className="w-4 h-4 text-yellow-500 animate-pulse" />
          <h3 className="text-sm font-bold text-foreground">Multi-Indicator Strategy Signal</h3>
          <Badge variant="outline" className="text-[10px]">Powered by AI</Badge>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Signal Display */}
          <motion.div 
            className="bg-black/30 rounded-lg p-3 text-center"
            whileHover={{ scale: 1.02 }}
            transition={{ duration: 0.2 }}
          >
            <div className="text-[10px] text-muted-foreground mb-1">Predicted Direction</div>
            <motion.div 
              className={`text-2xl font-bold ${combinedSignal.color}`}
              animate={{ scale: [1, 1.05, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
            >
              {combinedSignal.direction === 'Over' ? '📈 OVER' : combinedSignal.direction === 'Under' ? '📉 UNDER' : '⚡ NEUTRAL'}
            </motion.div>
            <div className="text-[9px] text-muted-foreground mt-1">Confidence: {combinedSignal.confidence}%</div>
            <div className="w-full bg-muted rounded-full h-1.5 mt-2">
              <motion.div 
                className={`h-full rounded-full ${combinedSignal.direction === 'Over' ? 'bg-profit' : combinedSignal.direction === 'Under' ? 'bg-loss' : 'bg-warning'}`}
                style={{ width: `${combinedSignal.confidence}%` }}
                initial={{ width: 0 }}
                animate={{ width: `${combinedSignal.confidence}%` }}
                transition={{ duration: 0.5 }}
              />
            </div>
          </motion.div>
          
          {/* Signal Strength */}
          <div className="bg-black/30 rounded-lg p-3">
            <div className="text-[10px] text-muted-foreground mb-2">Signal Strength</div>
            <div className="flex justify-between mb-1">
              <span className="text-[11px] text-profit">OVER</span>
              <span className="text-[11px] font-mono font-bold">{combinedSignal.overScore}%</span>
            </div>
            <div className="w-full bg-muted rounded-full h-1.5 mb-2">
              <motion.div 
                className="h-full bg-profit rounded-full" 
                style={{ width: `${combinedSignal.overScore}%` }}
                initial={{ width: 0 }}
                animate={{ width: `${combinedSignal.overScore}%` }}
                transition={{ duration: 0.5 }}
              />
            </div>
            <div className="flex justify-between mb-1">
              <span className="text-[11px] text-loss">UNDER</span>
              <span className="text-[11px] font-mono font-bold">{combinedSignal.underScore}%</span>
            </div>
            <div className="w-full bg-muted rounded-full h-1.5">
              <motion.div 
                className="h-full bg-loss rounded-full" 
                style={{ width: `${combinedSignal.underScore}%` }}
                initial={{ width: 0 }}
                animate={{ width: `${combinedSignal.underScore}%` }}
                transition={{ duration: 0.5 }}
              />
            </div>
          </div>
          
          {/* Active Signals */}
          <div className="bg-black/30 rounded-lg p-3">
            <div className="text-[10px] text-muted-foreground mb-1">Active Signals</div>
            <div className="space-y-1 max-h-20 overflow-auto">
              {combinedSignal.signals.length > 0 ? (
                combinedSignal.signals.map((signal, idx) => (
                  <motion.div 
                    key={idx} 
                    className="text-[9px] font-mono text-primary"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.1 }}
                  >
                    {signal}
                  </motion.div>
                ))
              ) : (
                <div className="text-[8px] text-muted-foreground">Enable indicators to see signals</div>
              )}
            </div>
          </div>
        </div>
        
        <div className="text-[8px] text-muted-foreground text-center mt-2 border-t border-border pt-2">
          💡 Combine 2-3 indicators for best results | Parabolic SAR + Bollinger Bands + RSI recommended
        </div>
      </motion.div>
      
      {/* Drawing Tools Bar */}
      {showChart && (
        <div className="bg-card border border-border rounded-xl p-2 flex flex-wrap gap-1 items-center">
          <span className="text-[10px] text-muted-foreground mr-2">Draw:</span>
          <Button size="sm" variant={activeTool === 'trendline' ? 'default' : 'outline'} className="h-7 px-2" onClick={() => setActiveTool(activeTool === 'trendline' ? null : 'trendline')}>
            <TrendLineIcon className="w-3.5 h-3.5" /> Line
          </Button>
          <Button size="sm" variant={activeTool === 'arrow' ? 'default' : 'outline'} className="h-7 px-2" onClick={() => setActiveTool(activeTool === 'arrow' ? null : 'arrow')}>
            <ArrowRight className="w-3.5 h-3.5" /> Arrow
          </Button>
          <Button size="sm" variant={activeTool === 'rectangle' ? 'default' : 'outline'} className="h-7 px-2" onClick={() => setActiveTool(activeTool === 'rectangle' ? null : 'rectangle')}>
            <Square className="w-3.5 h-3.5" /> Rect
          </Button>
          <Button size="sm" variant={activeTool === 'circle' ? 'default' : 'outline'} className="h-7 px-2" onClick={() => setActiveTool(activeTool === 'circle' ? null : 'circle')}>
            <CircleIcon className="w-3.5 h-3.5" /> Circle
          </Button>
          <Button size="sm" variant={activeTool === 'triangle' ? 'default' : 'outline'} className="h-7 px-2" onClick={() => setActiveTool(activeTool === 'triangle' ? null : 'triangle')}>
            <Triangle className="w-3.5 h-3.5" /> Triangle
          </Button>
          <Button size="sm" variant={activeTool === 'long' ? 'default' : 'outline'} className="h-7 px-2 text-profit" onClick={() => setActiveTool(activeTool === 'long' ? null : 'long')}>
            <TrendingUp className="w-3.5 h-3.5" /> Long
          </Button>
          <Button size="sm" variant={activeTool === 'short' ? 'default' : 'outline'} className="h-7 px-2 text-loss" onClick={() => setActiveTool(activeTool === 'short' ? null : 'short')}>
            <TrendingDown className="w-3.5 h-3.5" /> Short
          </Button>
          <div className="w-px h-6 bg-border mx-1" />
          <Button size="sm" variant="outline" className="h-7 px-2 text-loss" onClick={deleteAllDrawings}>
            <Trash2 className="w-3.5 h-3.5" /> Clear All
          </Button>
          {activeTool && (
            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setActiveTool(null)}>
              <MousePointer className="w-3.5 h-3.5" /> Exit
            </Button>
          )}
        </div>
      )}
      
      {/* Indicators Toggle Bar - All initially OFF */}
      {showChart && (
        <div className="bg-card border border-border rounded-xl p-2 flex flex-wrap gap-1 items-center">
          <span className="text-[10px] text-muted-foreground mr-2">Indicators:</span>
          <Button size="sm" variant={indicators.macd ? 'default' : 'outline'} className="h-7 px-2" onClick={() => toggleIndicator('macd')}>
            <LineChart className="w-3.5 h-3.5" /> MACD
          </Button>
          <Button size="sm" variant={indicators.bollinger ? 'default' : 'outline'} className="h-7 px-2" onClick={() => toggleIndicator('bollinger')}>
            <Settings className="w-3.5 h-3.5" /> BB(20,2)
          </Button>
          <Button size="sm" variant={indicators.ma9 ? 'default' : 'outline'} className="h-7 px-2" onClick={() => toggleIndicator('ma9')}>
            <TrendingUp className="w-3.5 h-3.5" /> MA 9
          </Button>
          <Button size="sm" variant={indicators.ma20 ? 'default' : 'outline'} className="h-7 px-2" onClick={() => toggleIndicator('ma20')}>
            <TrendingUp className="w-3.5 h-3.5" /> MA 20
          </Button>
          <Button size="sm" variant={indicators.ma50 ? 'default' : 'outline'} className="h-7 px-2" onClick={() => toggleIndicator('ma50')}>
            <TrendingUp className="w-3.5 h-3.5" /> MA 50
          </Button>
          <Button size="sm" variant={indicators.rsi ? 'default' : 'outline'} className="h-7 px-2" onClick={() => toggleIndicator('rsi')}>
            <Activity className="w-3.5 h-3.5" /> RSI
          </Button>
          <Button size="sm" variant={indicators.parabolicSAR ? 'default' : 'outline'} className="h-7 px-2" onClick={() => toggleIndicator('parabolicSAR')}>
            <TrendLineIcon className="w-3.5 h-3.5" /> Parabolic SAR
          </Button>
          <Button size="sm" variant={indicators.supportResistance ? 'default' : 'outline'} className="h-7 px-2" onClick={() => toggleIndicator('supportResistance')}>
            <Target className="w-3.5 h-3.5" /> S/R
          </Button>
        </div>
      )}
      
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        {/* LEFT: Chart */}
        <div className="xl:col-span-8 space-y-3">
          <AnimatePresence mode="wait">
            {showChart && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.3 }}
                className="overflow-hidden"
              >
                <div className="bg-[#0D1117] border border-[#30363D] rounded-xl overflow-hidden shadow-2xl">
                  <canvas 
                    ref={canvasRef} 
                    className="w-full" 
                    style={{ height: 650, cursor: activeTool ? 'crosshair' : 'grab' }}
                    onMouseDown={startDrawing}
                    onMouseMove={draw}
                    onMouseUp={endDrawing}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          
          {/* Price Info Panel */}
          <div className="grid grid-cols-3 md:grid-cols-7 gap-2">
            {[
              { label: 'Price', value: currentPrice.toFixed(2), color: 'text-foreground' },
              { label: 'Last Digit', value: String(lastDigit), color: 'text-primary' },
              { label: 'BB Upper', value: bb.upper.toFixed(2), color: 'text-[#BC8CFF]' },
              { label: 'BB Middle', value: bb.middle.toFixed(2), color: 'text-[#BC8CFF]' },
              { label: 'BB Lower', value: bb.lower.toFixed(2), color: 'text-[#BC8CFF]' },
              { label: 'RSI', value: rsi.toFixed(1), color: rsi > 70 ? 'text-loss' : rsi < 30 ? 'text-profit' : 'text-foreground' },
              { label: 'Signal', value: combinedSignal.direction, color: combinedSignal.color },
            ].map(item => (
              <motion.div 
                key={item.label} 
                className="bg-card border border-border rounded-lg p-2 text-center"
                whileHover={{ scale: 1.05, y: -2 }}
                transition={{ duration: 0.2 }}
              >
                <div className="text-[9px] text-muted-foreground">{item.label}</div>
                <div className={`font-mono text-xs font-bold ${item.color}`}>{item.value}</div>
              </motion.div>
            ))}
          </div>
          
          {/* Digit Analysis */}
          <div className="bg-card border border-border rounded-xl p-3 space-y-3">
            <h3 className="text-xs font-semibold text-foreground">Digit Analysis</h3>
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
                const pct = percentages[d] || 0;
                const count = frequency[d] || 0;
                return (
                  <motion.button 
                    key={d}
                    onClick={() => { setSelectedDigit(d); setPrediction(String(d)); }}
                    className={`relative rounded-lg p-2 text-center transition-all border cursor-pointer hover:ring-2 hover:ring-primary ${
                      selectedDigit === d ? 'ring-2 ring-primary' : ''
                    } ${pct > 12 ? 'bg-loss/10 border-loss/40 text-loss' :
                      pct > 9 ? 'bg-warning/10 border-warning/40 text-warning' :
                      'bg-card border-border text-primary'}`}
                    whileHover={{ scale: 1.05, y: -2 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    <div className="font-mono text-lg font-bold">{d}</div>
                    <div className="text-[8px]">{count} ({pct.toFixed(1)}%)</div>
                    <div className="h-1 bg-muted rounded-full mt-1">
                      <div className={`h-full rounded-full ${pct > 12 ? 'bg-loss' : pct > 9 ? 'bg-warning' : 'bg-primary'}`} style={{ width: `${Math.min(100, pct * 5)}%` }} />
                    </div>
                  </motion.button>
                );
              })}
            </div>
          </div>
        </div>
        
        {/* RIGHT: Trade Panel */}
        <div className="xl:col-span-4 space-y-3">
          {/* Voice AI Toggle */}
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
          
          {/* Trading Signals */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-card border border-border rounded-xl p-3">
              <div className="flex items-center gap-1 mb-1">
                {riseSignal.direction === 'Rise' ? <TrendingUp className="w-3.5 h-3.5 text-profit" /> : <TrendingDown className="w-3.5 h-3.5 text-loss" />}
                <span className="text-[10px] font-semibold">Rise/Fall</span>
              </div>
              <div className={`font-mono text-sm font-bold ${riseSignal.direction === 'Rise' ? 'text-profit' : 'text-loss'}`}>
                {riseSignal.direction}
              </div>
              <div className="text-[8px] text-muted-foreground mb-1">RSI: {rsi.toFixed(1)}</div>
              <div className="h-1.5 bg-muted rounded-full">
                <div className={`h-full rounded-full ${riseSignal.direction === 'Rise' ? 'bg-profit' : 'bg-loss'}`} style={{ width: `${riseSignal.confidence}%` }} />
              </div>
            </div>
            
            <div className="bg-card border border-border rounded-xl p-3">
              <div className="flex items-center gap-1 mb-1">
                <Target className="w-3.5 h-3.5 text-profit" />
                <span className="text-[10px] font-semibold">Best Match</span>
              </div>
              <div className="font-mono text-sm font-bold text-profit">Digit {matchSignal.digit}</div>
              <div className="text-[8px] text-muted-foreground mb-1">{percentages[mostCommon]?.toFixed(1)}% freq</div>
              <div className="h-1.5 bg-muted rounded-full">
                <div className="h-full bg-profit rounded-full" style={{ width: `${matchSignal.confidence}%` }} />
              </div>
            </div>
          </div>
          
          {/* Last 26 Digits */}
          <div className="bg-card border border-border rounded-xl p-3">
            <h3 className="text-xs font-semibold text-foreground mb-2">Last 26 Digits</h3>
            <div className="flex gap-1 flex-wrap justify-center">
              {last26.map((d, i) => {
                const isLast = i === last26.length - 1;
                const isEven = d % 2 === 0;
                return (
                  <motion.div
                    key={i}
                    initial={isLast ? { scale: 0.8 } : {}}
                    animate={isLast ? { scale: [1, 1.1, 1] } : {}}
                    transition={isLast ? { duration: 1, repeat: Infinity } : {}}
                    className={`w-7 h-9 rounded-lg flex items-center justify-center font-mono font-bold text-xs border-2 ${
                      isLast ? 'ring-2 ring-primary' : ''
                    } ${isEven
                      ? 'border-[#3FB950] text-[#3FB950] bg-[#3FB950]/10'
                      : 'border-[#D29922] text-[#D29922] bg-[#D29922]/10'
                    }`}
                  >
                    {d}
                  </motion.div>
                );
              })}
            </div>
          </div>
          
          {/* Quick Trade */}
          <div className="bg-card border border-border rounded-xl p-3 space-y-2">
            <h3 className="text-xs font-semibold text-foreground">Quick Trade</h3>
            <Select value={contractType} onValueChange={setContractType}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{CONTRACT_TYPES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
            </Select>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[9px] text-muted-foreground">Stake ($)</label>
                <Input type="number" min="0.35" step="0.01" value={tradeStake} onChange={e => setTradeStake(e.target.value)} className="h-7 text-xs" />
              </div>
              <div>
                <label className="text-[9px] text-muted-foreground">Duration</label>
                <div className="flex gap-1">
                  <Input type="number" min="1" value={duration} onChange={e => setDuration(e.target.value)} className="h-7 text-xs flex-1" />
                  <Select value={durationUnit} onValueChange={setDurationUnit}>
                    <SelectTrigger className="h-7 text-xs w-16"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="t">T</SelectItem>
                      <SelectItem value="s">S</SelectItem>
                      <SelectItem value="m">M</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button onClick={() => handleBuy('buy')} disabled={isTrading || !isAuthorized} className="bg-profit hover:bg-profit/90 text-profit-foreground">
                <TrendingUp className="w-4 h-4 mr-1" /> CALL
              </Button>
              <Button onClick={() => handleBuy('sell')} disabled={isTrading || !isAuthorized} variant="destructive">
                <TrendingDown className="w-4 h-4 mr-1" /> PUT
              </Button>
            </div>
          </div>
          
          {/* Auto Bot Panel */}
          <div className={`bg-card border rounded-xl p-3 space-y-2 ${botRunning ? 'border-profit glow-profit' : 'border-border'}`}>
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-foreground flex items-center gap-1">
                <Zap className="w-3.5 h-3.5 text-primary" /> Auto Bot
              </h3>
              {botRunning && (
                <motion.div animate={{ opacity: [0.4, 1, 0.4] }} transition={{ repeat: Infinity, duration: 1.5 }}>
                  <Badge className="text-[8px] bg-profit text-profit-foreground">RUNNING</Badge>
                </motion.div>
              )}
            </div>
            
            <Select value={botConfig.botSymbol} onValueChange={handleBotSymbolChange} disabled={botRunning}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{ALL_MARKETS.map(m => <SelectItem key={m.symbol} value={m.symbol}>{m.name}</SelectItem>)}</SelectContent>
            </Select>
            
            <Select value={botConfig.contractType} onValueChange={v => setBotConfig(p => ({ ...p, contractType: v }))} disabled={botRunning}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{CONTRACT_TYPES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
            </Select>
            
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[9px] text-muted-foreground">Stake ($)</label>
                <Input type="number" min="0.35" step="0.01" value={botConfig.stake}
                  onChange={e => setBotConfig(p => ({ ...p, stake: e.target.value }))} disabled={botRunning} className="h-7 text-xs" />
              </div>
              <div>
                <label className="text-[9px] text-muted-foreground">Duration</label>
                <div className="flex gap-1">
                  <Input type="number" min="1" value={botConfig.duration}
                    onChange={e => setBotConfig(p => ({ ...p, duration: e.target.value }))} disabled={botRunning} className="h-7 text-xs flex-1" />
                  <Select value={botConfig.durationUnit} onValueChange={v => setBotConfig(p => ({ ...p, durationUnit: v }))} disabled={botRunning}>
                    <SelectTrigger className="h-7 text-xs w-16"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="t">T</SelectItem>
                      <SelectItem value="s">S</SelectItem>
                      <SelectItem value="m">M</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            
            <div className="flex items-center justify-between">
              <label className="text-[10px] text-foreground">Martingale</label>
              <div className="flex items-center gap-2">
                {botConfig.martingale && (
                  <Input type="number" min="1.1" step="0.1" value={botConfig.multiplier}
                    onChange={e => setBotConfig(p => ({ ...p, multiplier: e.target.value }))} disabled={botRunning}
                    className="h-6 text-[10px] w-14" />
                )}
                <button onClick={() => setBotConfig(p => ({ ...p, martingale: !p.martingale }))} disabled={botRunning}
                  className={`w-9 h-5 rounded-full transition-colors ${botConfig.martingale ? 'bg-primary' : 'bg-muted'} relative`}>
                  <div className={`w-4 h-4 rounded-full bg-background shadow absolute top-0.5 transition-transform ${botConfig.martingale ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </button>
              </div>
            </div>
            
            {/* Strategy Section */}
            <div className="border-t border-border pt-2 mt-1">
              <div className="flex items-center justify-between mb-2">
                <label className="text-[10px] font-semibold text-warning flex items-center gap-1">
                  <Zap className="w-3 h-3" /> Pattern/Digit Strategy
                </label>
                <Switch checked={strategyEnabled} onCheckedChange={setStrategyEnabled} disabled={botRunning} />
              </div>
              
              {strategyEnabled && (
                <div className="space-y-2">
                  <div className="flex gap-1">
                    <Button size="sm" variant={strategyMode === 'pattern' ? 'default' : 'outline'} className="text-[9px] h-6 px-2 flex-1" onClick={() => setStrategyMode('pattern')} disabled={botRunning}>
                      Pattern (E/O)
                    </Button>
                    <Button size="sm" variant={strategyMode === 'digit' ? 'default' : 'outline'} className="text-[9px] h-6 px-2 flex-1" onClick={() => setStrategyMode('digit')} disabled={botRunning}>
                      Digit Condition
                    </Button>
                  </div>
                  
                  {strategyMode === 'pattern' ? (
                    <div>
                      <label className="text-[8px] text-muted-foreground">Pattern (E=Even, O=Odd)</label>
                      <Textarea placeholder="e.g., EEEOE or OOEEO" value={patternInput}
                        onChange={e => setPatternInput(e.target.value.toUpperCase().replace(/[^EO]/g, ''))}
                        disabled={botRunning} className="h-12 text-[10px] font-mono min-h-0 mt-1" />
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-1">
                      <div>
                        <label className="text-[8px] text-muted-foreground">If last</label>
                        <Input type="number" min="1" max="50" value={digitWindow}
                          onChange={e => setDigitWindow(e.target.value)} disabled={botRunning} className="h-7 text-[10px]" />
                      </div>
                      <div>
                        <label className="text-[8px] text-muted-foreground">ticks are</label>
                        <Select value={digitCondition} onValueChange={setDigitCondition} disabled={botRunning}>
                          <SelectTrigger className="h-7 text-[10px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {['==', '!=', '>', '<', '>=', '<='].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <label className="text-[8px] text-muted-foreground">Digit</label>
                        <Input type="number" min="0" max="9" value={digitCompare}
                          onChange={e => setDigitCompare(e.target.value)} disabled={botRunning} className="h-7 text-[10px]" />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            
            <div className="grid grid-cols-3 gap-1.5">
              <div>
                <label className="text-[8px] text-muted-foreground">Stop Loss</label>
                <Input type="number" value={botConfig.stopLoss} onChange={e => setBotConfig(p => ({ ...p, stopLoss: e.target.value }))} disabled={botRunning} className="h-7 text-xs" />
              </div>
              <div>
                <label className="text-[8px] text-muted-foreground">Take Profit</label>
                <Input type="number" value={botConfig.takeProfit} onChange={e => setBotConfig(p => ({ ...p, takeProfit: e.target.value }))} disabled={botRunning} className="h-7 text-xs" />
              </div>
              <div>
                <label className="text-[8px] text-muted-foreground">Max Trades</label>
                <Input type="number" value={botConfig.maxTrades} onChange={e => setBotConfig(p => ({ ...p, maxTrades: e.target.value }))} disabled={botRunning} className="h-7 text-xs" />
              </div>
            </div>
            
            {botRunning && (
              <div className="grid grid-cols-3 gap-1 text-center">
                <div className="bg-muted/30 rounded p-1">
                  <div className="text-[7px] text-muted-foreground">Stake</div>
                  <div className="font-mono text-[10px] font-bold">${botStats.currentStake.toFixed(2)}</div>
                </div>
                <div className="bg-muted/30 rounded p-1">
                  <div className="text-[7px] text-muted-foreground">Streak</div>
                  <div className="font-mono text-[10px] font-bold text-loss">{botStats.consecutiveLosses}L</div>
                </div>
                <div className={`${botStats.pnl >= 0 ? 'bg-profit/10' : 'bg-loss/10'} rounded p-1`}>
                  <div className="text-[7px] text-muted-foreground">P/L</div>
                  <div className={`font-mono text-[10px] font-bold ${botStats.pnl >= 0 ? 'text-profit' : 'text-loss'}`}>
                    {botStats.pnl >= 0 ? '+' : ''}{botStats.pnl.toFixed(2)}
                  </div>
                </div>
              </div>
            )}
            
            <div className="flex gap-2">
              {!botRunning ? (
                <Button onClick={startBot} disabled={!isAuthorized} className="flex-1 h-10 text-xs font-bold bg-profit hover:bg-profit/90">
                  <Play className="w-4 h-4 mr-1" /> Start Bot
                </Button>
              ) : (
                <>
                  <Button onClick={togglePauseBot} variant="outline" className="flex-1 h-10 text-xs">
                    <Pause className="w-3.5 h-3.5 mr-1" /> {botPaused ? 'Resume' : 'Pause'}
                  </Button>
                  <Button onClick={stopBot} variant="destructive" className="flex-1 h-10 text-xs">
                    <StopCircle className="w-3.5 h-3.5 mr-1" /> Stop
                  </Button>
                </>
              )}
            </div>
          </div>
          
          {/* Trade Progress */}
          <div className="bg-card border border-border rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-foreground flex items-center gap-1">
                <Trophy className="w-3.5 h-3.5 text-primary" /> Trade Progress
              </h3>
              {tradeHistory.length > 0 && (
                <Button variant="ghost" size="sm" className="h-6 text-[9px]" onClick={() => { setTradeHistory([]); setBotStats({ trades: 0, wins: 0, losses: 0, pnl: 0, currentStake: 0, consecutiveLosses: 0 }); }}>
                  Clear
                </Button>
              )}
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              <div className="bg-muted/30 rounded-lg p-1.5 text-center">
                <div className="text-[8px] text-muted-foreground">Trades</div>
                <div className="font-mono text-sm font-bold">{totalTrades}</div>
              </div>
              <div className="bg-profit/10 rounded-lg p-1.5 text-center">
                <div className="text-[8px] text-profit">Wins</div>
                <div className="font-mono text-sm font-bold text-profit">{wins}</div>
              </div>
              <div className="bg-loss/10 rounded-lg p-1.5 text-center">
                <div className="text-[8px] text-loss">Losses</div>
                <div className="font-mono text-sm font-bold text-loss">{losses}</div>
              </div>
              <div className={`${totalProfit >= 0 ? 'bg-profit/10' : 'bg-loss/10'} rounded-lg p-1.5 text-center`}>
                <div className="text-[8px] text-muted-foreground">P/L</div>
                <div className={`font-mono text-sm font-bold ${totalProfit >= 0 ? 'text-profit' : 'text-loss'}`}>
                  {totalProfit >= 0 ? '+' : ''}{totalProfit.toFixed(2)}
                </div>
              </div>
            </div>
            {totalTrades > 0 && (
              <div>
                <div className="flex justify-between text-[9px] text-muted-foreground mb-0.5">
                  <span>Win Rate</span>
                  <span className="font-mono font-bold">{winRate.toFixed(1)}%</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-profit rounded-full" style={{ width: `${winRate}%` }} />
                </div>
              </div>
            )}
            
            {tradeHistory.length > 0 && (
              <div className="max-h-40 overflow-auto space-y-1">
                {tradeHistory.slice(0, 10).map(t => (
                  <div key={t.id} className={`flex items-center justify-between text-[9px] p-1.5 rounded-lg border ${
                    t.status === 'open' ? 'border-primary/30 bg-primary/5' :
                    t.status === 'won' ? 'border-profit/30 bg-profit/5' : 'border-loss/30 bg-loss/5'
                  }`}>
                    <div className="flex items-center gap-1.5">
                      <span className={`font-bold ${t.status === 'won' ? 'text-profit' : t.status === 'lost' ? 'text-loss' : 'text-primary'}`}>
                        {t.status === 'open' ? '⏳' : t.status === 'won' ? '✅' : '❌'}
                      </span>
                      <span className="font-mono text-muted-foreground">{t.type}</span>
                      <span className="text-muted-foreground">${t.stake.toFixed(2)}</span>
                    </div>
                    <span className={`font-mono font-bold ${t.profit >= 0 ? 'text-profit' : 'text-loss'}`}>
                      {t.status === 'open' ? '...' : `${t.profit >= 0 ? '+' : ''}$${t.profit.toFixed(2)}`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
          
          {/* Technical Status */}
          <div className="bg-card border border-border rounded-xl p-3 space-y-2">
            <h3 className="text-xs font-semibold text-foreground flex items-center gap-1">
              <ShieldAlert className="w-3.5 h-3.5 text-primary" /> Technical Status
            </h3>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-muted-foreground">MACD</span>
                <span className={`font-mono font-bold ${macd.macd > 0 ? 'text-profit' : 'text-loss'}`}>
                  {macd.macd > 0 ? '📈 Bullish' : '📉 Bearish'}
                </span>
              </div>
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-muted-foreground">BB Position</span>
                <span className="font-mono font-bold text-[#BC8CFF]">{bbPosition.toFixed(1)}%</span>
              </div>
              <div className="h-1.5 bg-muted rounded-full">
                <div className="h-full bg-[#BC8CFF] rounded-full" style={{ width: `${Math.min(100, Math.max(0, bbPosition))}%` }} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
