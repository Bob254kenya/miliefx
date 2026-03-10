import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { derivApi, type MarketSymbol } from '@/services/deriv-api';
import { getLastDigit, analyzeDigits, calculateRSI, calculateMACD, calculateBollingerBands } from '@/services/analysis';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import {
  TrendingUp, TrendingDown, Activity, BarChart3, ArrowUp, ArrowDown, Minus,
  Target, ShieldAlert, Gauge, Volume2, VolumeX, Clock, Zap, Trophy, Play, Pause, StopCircle,
  Settings, Eye, EyeOff, LineChart, CandlestickChart, AreaChart, Move, ZoomIn, ZoomOut,
  RefreshCw, Download, Maximize2, Minimize2, ChevronDown, ChevronRight, Layers, Sigma,
  Waves, Rabbit, Turtle, Flame, Snowflake, AlertCircle, CheckCircle2, XCircle, Info,
  ChartCandlestick, ChartLine, ChartArea, ChartBar, ChartNoAxesColumn, ChartSpline,
  ArrowLeftRight, ArrowUpDown, Palette, Grid3x3, Ruler, EyeClosed, Crosshair,
  TimerReset, Timer, Sunrise, Sunset, Cloud, CloudRain, CloudSnow, CloudLightning,
  Wind, GaugeCircle, Sparkles, Brain, Cpu, Orbit, Rocket, Shield, Swords, Wand2,
  Star, Heart, Crown, Diamond, CircleDollarSign, Coins, Bitcoin, Wallet, Pencil,
} from 'lucide-react';

/* ── Types ── */
interface Indicator {
  id: string;
  name: string;
  enabled: boolean;
  color: string;
  params: Record<string, any>;
  type: 'overlay' | 'oscillator' | 'volume';
  section: 'trend' | 'oscillator' | 'volume' | 'volatility' | 'custom';
}

interface DrawingTool {
  id: string;
  type: 'horizontal' | 'vertical' | 'trend' | 'fib' | 'rectangle' | 'text';
  points: { x: number; y: number }[];
  color: string;
  text?: string;
}

interface Candle {
  open: number; high: number; low: number; close: number; time: number;
}

interface TradeRecord {
  id: string;
  time: number;
  type: string;
  stake: number;
  profit: number;
  status: 'won' | 'lost' | 'open';
  symbol: string;
}

/* ── Markets ── */
const ALL_MARKETS = [
  // Vol 1s
  { symbol: '1HZ10V', name: 'Volatility 10 (1s)', group: 'vol1s' },
  { symbol: '1HZ15V', name: 'Volatility 15 (1s)', group: 'vol1s' },
  { symbol: '1HZ25V', name: 'Volatility 25 (1s)', group: 'vol1s' },
  { symbol: '1HZ30V', name: 'Volatility 30 (1s)', group: 'vol1s' },
  { symbol: '1HZ50V', name: 'Volatility 50 (1s)', group: 'vol1s' },
  { symbol: '1HZ75V', name: 'Volatility 75 (1s)', group: 'vol1s' },
  { symbol: '1HZ100V', name: 'Volatility 100 (1s)', group: 'vol1s' },
  // Vol
  { symbol: 'R_10', name: 'Volatility 10', group: 'vol' },
  { symbol: 'R_25', name: 'Volatility 25', group: 'vol' },
  { symbol: 'R_50', name: 'Volatility 50', group: 'vol' },
  { symbol: 'R_75', name: 'Volatility 75', group: 'vol' },
  { symbol: 'R_100', name: 'Volatility 100', group: 'vol' },
  // Jump
  { symbol: 'JD10', name: 'Jump 10', group: 'jump' },
  { symbol: 'JD25', name: 'Jump 25', group: 'jump' },
  { symbol: 'JD50', name: 'Jump 50', group: 'jump' },
  { symbol: 'JD75', name: 'Jump 75', group: 'jump' },
  { symbol: 'JD100', name: 'Jump 100', group: 'jump' },
  // Bear/Bull
  { symbol: 'RDBEAR', name: 'Bear Market', group: 'bear' },
  { symbol: 'RDBULL', name: 'Bull Market', group: 'bull' },
  // Step
  { symbol: 'stpRNG', name: 'Step Index', group: 'step' },
  // Range Break
  { symbol: 'RBRK100', name: 'Range Break 100', group: 'range' },
  { symbol: 'RBRK200', name: 'Range Break 200', group: 'range' },
];

const GROUPS = [
  { value: 'all', label: 'All Markets' },
  { value: 'vol1s', label: 'Volatility 1s' },
  { value: 'vol', label: 'Volatility' },
  { value: 'jump', label: 'Jump' },
  { value: 'bear', label: 'Bear/Bull' },
  { value: 'step', label: 'Step' },
  { value: 'range', label: 'Range Break' },
];

const TIMEFRAMES = [
  { value: '1m', label: '1m', seconds: 60 },
  { value: '3m', label: '3m', seconds: 180 },
  { value: '5m', label: '5m', seconds: 300 },
  { value: '15m', label: '15m', seconds: 900 },
  { value: '30m', label: '30m', seconds: 1800 },
  { value: '1h', label: '1h', seconds: 3600 },
  { value: '4h', label: '4h', seconds: 14400 },
  { value: '12h', label: '12h', seconds: 43200 },
  { value: '1d', label: '1d', seconds: 86400 },
];

const CHART_TYPES = [
  { value: 'candles', label: 'Candles', icon: ChartCandlestick },
  { value: 'bars', label: 'Bars', icon: ChartBar },
  { value: 'line', label: 'Line', icon: ChartLine },
  { value: 'area', label: 'Area', icon: ChartArea },
  { value: 'hollow', label: 'Hollow', icon: ChartSpline },
  { value: 'heikin-ashi', label: 'Heikin Ashi', icon: ChartNoAxesColumn },
];

const CONTRACT_TYPES = [
  { value: 'CALL', label: 'Rise', icon: TrendingUp, color: '#3FB950' },
  { value: 'PUT', label: 'Fall', icon: TrendingDown, color: '#F85149' },
  { value: 'DIGITMATCH', label: 'Digits Match', icon: Target, color: '#D29922' },
  { value: 'DIGITDIFF', label: 'Digits Differs', icon: Crosshair, color: '#BC8CFF' },
  { value: 'DIGITEVEN', label: 'Digits Even', icon: Activity, color: '#58A6FF' },
  { value: 'DIGITODD', label: 'Digits Odd', icon: Gauge, color: '#F778BA' },
  { value: 'DIGITOVER', label: 'Digits Over', icon: ArrowUp, color: '#7EE3B8' },
  { value: 'DIGITUNDER', label: 'Digits Under', icon: ArrowDown, color: '#FFA28B' },
];

/* ── All Deriv Indicators ── */
const ALL_INDICATORS: Indicator[] = [
  // Trend Indicators
  { id: 'ema', name: 'EMA', enabled: true, color: '#2F81F7', params: { period: 50, source: 'close' }, type: 'overlay', section: 'trend' },
  { id: 'sma', name: 'SMA', enabled: true, color: '#E6B422', params: { period: 20, source: 'close' }, type: 'overlay', section: 'trend' },
  { id: 'wma', name: 'WMA', enabled: false, color: '#F78166', params: { period: 20, source: 'close' }, type: 'overlay', section: 'trend' },
  { id: 'hma', name: 'Hull MA', enabled: false, color: '#7EE3B8', params: { period: 20, source: 'close' }, type: 'overlay', section: 'trend' },
  { id: 'vwap', name: 'VWAP', enabled: false, color: '#F778BA', params: { period: 20 }, type: 'overlay', section: 'trend' },
  { id: 'ichimoku', name: 'Ichimoku', enabled: false, color: '#8957E5', params: { conversion: 9, base: 26, span: 52 }, type: 'overlay', section: 'trend' },
  { id: 'parabolic_sar', name: 'Parabolic SAR', enabled: false, color: '#F0883E', params: { step: 0.02, max: 0.2 }, type: 'overlay', section: 'trend' },
  
  // Oscillators
  { id: 'rsi', name: 'RSI', enabled: true, color: '#D29922', params: { period: 14, source: 'close' }, type: 'oscillator', section: 'oscillator' },
  { id: 'macd', name: 'MACD', enabled: true, color: '#BC8CFF', params: { fast: 12, slow: 26, signal: 9 }, type: 'oscillator', section: 'oscillator' },
  { id: 'stoch', name: 'Stochastic', enabled: false, color: '#3FB950', params: { k: 14, d: 3, smooth: 3 }, type: 'oscillator', section: 'oscillator' },
  { id: 'cci', name: 'CCI', enabled: false, color: '#F85149', params: { period: 20 }, type: 'oscillator', section: 'oscillator' },
  { id: 'williams_r', name: 'Williams %R', enabled: false, color: '#58A6FF', params: { period: 14 }, type: 'oscillator', section: 'oscillator' },
  { id: 'awesome', name: 'Awesome Osc', enabled: false, color: '#BC8CFF', params: { fast: 5, slow: 34 }, type: 'oscillator', section: 'oscillator' },
  { id: 'momentum', name: 'Momentum', enabled: false, color: '#D29922', params: { period: 10 }, type: 'oscillator', section: 'oscillator' },
  
  // Volatility
  { id: 'bb', name: 'Bollinger Bands', enabled: true, color: '#BC8CFF', params: { period: 20, std: 2 }, type: 'overlay', section: 'volatility' },
  { id: 'keltner', name: 'Keltner Channels', enabled: false, color: '#F778BA', params: { period: 20, multiplier: 2, atr: 10 }, type: 'overlay', section: 'volatility' },
  { id: 'donchian', name: 'Donchian Channels', enabled: false, color: '#7EE3B8', params: { period: 20 }, type: 'overlay', section: 'volatility' },
  { id: 'atr', name: 'ATR', enabled: false, color: '#F85149', params: { period: 14 }, type: 'oscillator', section: 'volatility' },
  { id: 'stddev', name: 'Std Deviation', enabled: false, color: '#8957E5', params: { period: 20 }, type: 'oscillator', section: 'volatility' },
  { id: 'channels', name: 'Price Channels', enabled: false, color: '#F0883E', params: { period: 20 }, type: 'overlay', section: 'volatility' },
  
  // Volume
  { id: 'volume', name: 'Volume', enabled: true, color: '#58A6FF', params: {}, type: 'volume', section: 'volume' },
  { id: 'obv', name: 'OBV', enabled: false, color: '#3FB950', params: { type: 'simple' }, type: 'volume', section: 'volume' },
  { id: 'mfi', name: 'MFI', enabled: false, color: '#F778BA', params: { period: 14 }, type: 'volume', section: 'volume' },
  { id: 'vwap_volume', name: 'VWAP Volume', enabled: false, color: '#BC8CFF', params: { period: 20 }, type: 'volume', section: 'volume' },
  { id: 'cvd', name: 'CVD', enabled: false, color: '#D29922', params: { period: 20 }, type: 'volume', section: 'volume' },
  
  // Custom Deriv-specific
  { id: 'digit_trend', name: 'Digit Trend', enabled: false, color: '#FF7B72', params: { period: 26 }, type: 'overlay', section: 'custom' },
  { id: 'even_odd', name: 'Even/Odd Ratio', enabled: false, color: '#7EE3B8', params: { period: 100 }, type: 'oscillator', section: 'custom' },
  { id: 'over_under', name: 'Over/Under', enabled: false, color: '#F778BA', params: { period: 100 }, type: 'oscillator', section: 'custom' },
  { id: 'hot_cold', name: 'Hot/Cold Digits', enabled: false, color: '#F0883E', params: { period: 50 }, type: 'oscillator', section: 'custom' },
];

/* ── Helper Functions ── */
function buildCandles(prices: number[], times: number[], tf: string): Candle[] {
  if (prices.length === 0) return [];
  const tfMap = Object.fromEntries(TIMEFRAMES.map(t => [t.value, t.seconds]));
  const interval = tfMap[tf] || 60;
  const candles: Candle[] = [];
  let current: Candle | null = null;

  for (let i = 0; i < prices.length; i++) {
    const p = prices[i];
    const t = times[i] || Date.now()/1000 + i;
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

function buildHeikinAshi(candles: Candle[]): Candle[] {
  if (candles.length === 0) return [];
  const ha: Candle[] = [];
  
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      ha.push({ ...candles[i] });
      continue;
    }
    
    const prev = ha[i - 1];
    const curr = candles[i];
    
    const haClose = (curr.open + curr.high + curr.low + curr.close) / 4;
    const haOpen = (prev.open + prev.close) / 2;
    const haHigh = Math.max(curr.high, haOpen, haClose);
    const haLow = Math.min(curr.low, haOpen, haClose);
    
    ha.push({ open: haOpen, high: haHigh, low: haLow, close: haClose, time: curr.time });
  }
  
  return ha;
}

function isHollowBullish(open: number, close: number): boolean {
  return close > open;
}

function calcEMA(prices: number[], period: number): number[] {
  const result: number[] = [];
  if (prices.length < period) return prices.map(() => NaN);
  
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
    } else if (i === period - 1) {
      result.push(ema);
    } else {
      ema = prices[i] * k + ema * (1 - k);
      result.push(ema);
    }
  }
  return result;
}

function calcSMA(prices: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
    } else {
      const slice = prices.slice(i - period + 1, i + 1);
      result.push(slice.reduce((a, b) => a + b, 0) / period);
    }
  }
  return result;
}

function calcWMA(prices: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
    } else {
      let sum = 0;
      let weightSum = 0;
      for (let j = 0; j < period; j++) {
        const weight = period - j;
        sum += prices[i - j] * weight;
        weightSum += weight;
      }
      result.push(sum / weightSum);
    }
  }
  return result;
}

function calcHMA(prices: number[], period: number): number[] {
  const half = Math.floor(period / 2);
  const sqrt = Math.floor(Math.sqrt(period));
  
  const wmaHalf = calcWMA(prices, half);
  const wmaFull = calcWMA(prices, period);
  const diff = wmaHalf.map((v, i) => 2 * v - (wmaFull[i] || 0));
  
  return calcWMA(diff, sqrt);
}

function calcVWAP(prices: number[], volumes: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (i < period) {
      result.push(NaN);
    } else {
      let sumPV = 0;
      let sumV = 0;
      for (let j = 0; j < period; j++) {
        sumPV += prices[i - j] * (volumes[i - j] || 1);
        sumV += (volumes[i - j] || 1);
      }
      result.push(sumPV / sumV);
    }
  }
  return result;
}

function calcIchimoku(candles: Candle[]): {
  tenkan: number[];
  kijun: number[];
  senkouA: number[];
  senkouB: number[];
  chikou: number[];
} {
  const tenkan: number[] = [];
  const kijun: number[] = [];
  const senkouA: number[] = [];
  const senkouB: number[] = [];
  const chikou: number[] = [];
  
  for (let i = 0; i < candles.length; i++) {
    // Tenkan-sen (Conversion Line): (9-period high + 9-period low)/2
    if (i >= 8) {
      const high9 = Math.max(...candles.slice(i - 8, i + 1).map(c => c.high));
      const low9 = Math.min(...candles.slice(i - 8, i + 1).map(c => c.low));
      tenkan.push((high9 + low9) / 2);
    } else {
      tenkan.push(NaN);
    }
    
    // Kijun-sen (Base Line): (26-period high + 26-period low)/2
    if (i >= 25) {
      const high26 = Math.max(...candles.slice(i - 25, i + 1).map(c => c.high));
      const low26 = Math.min(...candles.slice(i - 25, i + 1).map(c => c.low));
      kijun.push((high26 + low26) / 2);
    } else {
      kijun.push(NaN);
    }
    
    // Senkou Span A (Leading Span A): (Tenkan + Kijun)/2, shifted forward 26 periods
    if (i >= 25) {
      senkouA.push((tenkan[i] + kijun[i]) / 2);
    } else {
      senkouA.push(NaN);
    }
    
    // Senkou Span B (Leading Span B): (52-period high + 52-period low)/2, shifted forward 26 periods
    if (i >= 51) {
      const high52 = Math.max(...candles.slice(i - 51, i + 1).map(c => c.high));
      const low52 = Math.min(...candles.slice(i - 51, i + 1).map(c => c.low));
      senkouB.push((high52 + low52) / 2);
    } else {
      senkouB.push(NaN);
    }
    
    // Chikou Span (Lagging Span): Current closing price, shifted backward 26 periods
    chikou.push(candles[i].close);
  }
  
  return { tenkan, kijun, senkouA, senkouB, chikou };
}

function calcParabolicSAR(candles: Candle[], step: number = 0.02, max: number = 0.2): number[] {
  const sar: number[] = [];
  let trend: 'up' | 'down' = 'up';
  let ep = candles[0].high;
  let af = step;
  let currentSar = candles[0].low;
  
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      sar.push(NaN);
      continue;
    }
    
    const prev = candles[i - 1];
    const curr = candles[i];
    
    if (trend === 'up') {
      currentSar = currentSar + af * (ep - currentSar);
      
      if (curr.low < currentSar) {
        trend = 'down';
        currentSar = ep;
        ep = curr.low;
        af = step;
      } else {
        if (curr.high > ep) {
          ep = curr.high;
          af = Math.min(af + step, max);
        }
      }
    } else {
      currentSar = currentSar - af * (currentSar - ep);
      
      if (curr.high > currentSar) {
        trend = 'up';
        currentSar = ep;
        ep = curr.high;
        af = step;
      } else {
        if (curr.low < ep) {
          ep = curr.low;
          af = Math.min(af + step, max);
        }
      }
    }
    
    sar.push(currentSar);
  }
  
  return sar;
}

function calcStoch(candles: Candle[], kPeriod: number = 14, dPeriod: number = 3, smooth: number = 3): { k: number[], d: number[] } {
  const k: number[] = [];
  const d: number[] = [];
  
  for (let i = 0; i < candles.length; i++) {
    if (i < kPeriod - 1) {
      k.push(NaN);
      d.push(NaN);
      continue;
    }
    
    const periodCandles = candles.slice(i - kPeriod + 1, i + 1);
    const high = Math.max(...periodCandles.map(c => c.high));
    const low = Math.min(...periodCandles.map(c => c.low));
    const close = candles[i].close;
    
    const kRaw = ((close - low) / (high - low)) * 100;
    k.push(kRaw);
    
    if (i >= kPeriod + smooth - 2) {
      const kSlice = k.slice(i - smooth + 1, i + 1);
      const dRaw = kSlice.reduce((a, b) => a + b, 0) / smooth;
      d.push(dRaw);
    } else {
      d.push(NaN);
    }
  }
  
  return { k, d };
}

function calcCCI(candles: Candle[], period: number = 20): number[] {
  const cci: number[] = [];
  
  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) {
      cci.push(NaN);
      continue;
    }
    
    const tp = (candles[i].high + candles[i].low + candles[i].close) / 3;
    
    const periodTPs = [];
    for (let j = 0; j < period; j++) {
      const idx = i - j;
      periodTPs.push((candles[idx].high + candles[idx].low + candles[idx].close) / 3);
    }
    
    const smaTP = periodTPs.reduce((a, b) => a + b, 0) / period;
    const meanDev = periodTPs.reduce((sum, val) => sum + Math.abs(val - smaTP), 0) / period;
    
    cci.push((tp - smaTP) / (0.015 * meanDev));
  }
  
  return cci;
}

function calcWilliamsR(candles: Candle[], period: number = 14): number[] {
  const wr: number[] = [];
  
  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) {
      wr.push(NaN);
      continue;
    }
    
    const periodCandles = candles.slice(i - period + 1, i + 1);
    const high = Math.max(...periodCandles.map(c => c.high));
    const low = Math.min(...periodCandles.map(c => c.low));
    const close = candles[i].close;
    
    wr.push(((high - close) / (high - low)) * -100);
  }
  
  return wr;
}

function calcAwesomeOsc(candles: Candle[], fast: number = 5, slow: number = 34): number[] {
  const ao: number[] = [];
  
  for (let i = 0; i < candles.length; i++) {
    if (i < slow - 1) {
      ao.push(NaN);
      continue;
    }
    
    const mp = (candles[i].high + candles[i].low) / 2;
    
    let fastSum = 0;
    for (let j = 0; j < fast; j++) {
      fastSum += (candles[i - j].high + candles[i - j].low) / 2;
    }
    const fastMA = fastSum / fast;
    
    let slowSum = 0;
    for (let j = 0; j < slow; j++) {
      slowSum += (candles[i - j].high + candles[i - j].low) / 2;
    }
    const slowMA = slowSum / slow;
    
    ao.push(fastMA - slowMA);
  }
  
  return ao;
}

function calcMomentum(prices: number[], period: number = 10): number[] {
  const momentum: number[] = [];
  
  for (let i = 0; i < prices.length; i++) {
    if (i < period) {
      momentum.push(NaN);
    } else {
      momentum.push(prices[i] - prices[i - period]);
    }
  }
  
  return momentum;
}

function calcKeltner(candles: Candle[], period: number = 20, multiplier: number = 2, atrPeriod: number = 10): {
  upper: number[];
  middle: number[];
  lower: number[];
} {
  const upper: number[] = [];
  const middle: number[] = [];
  const lower: number[] = [];
  
  const ema = calcEMA(candles.map(c => c.close), period);
  const atr = calcATR(candles, atrPeriod);
  
  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) {
      upper.push(NaN);
      middle.push(NaN);
      lower.push(NaN);
    } else {
      const mid = ema[i];
      const atrValue = atr[i] || 0;
      upper.push(mid + multiplier * atrValue);
      middle.push(mid);
      lower.push(mid - multiplier * atrValue);
    }
  }
  
  return { upper, middle, lower };
}

function calcDonchian(candles: Candle[], period: number = 20): {
  upper: number[];
  middle: number[];
  lower: number[];
} {
  const upper: number[] = [];
  const middle: number[] = [];
  const lower: number[] = [];
  
  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) {
      upper.push(NaN);
      middle.push(NaN);
      lower.push(NaN);
    } else {
      const periodCandles = candles.slice(i - period + 1, i + 1);
      const high = Math.max(...periodCandles.map(c => c.high));
      const low = Math.min(...periodCandles.map(c => c.low));
      
      upper.push(high);
      lower.push(low);
      middle.push((high + low) / 2);
    }
  }
  
  return { upper, middle, lower };
}

function calcATR(candles: Candle[], period: number = 14): number[] {
  const atr: number[] = [];
  
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      atr.push(NaN);
      continue;
    }
    
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    );
    
    if (i < period) {
      atr.push(NaN);
    } else if (i === period) {
      let sum = 0;
      for (let j = 1; j <= period; j++) {
        const prev = candles[i - j];
        const curr = candles[i - j + 1];
        sum += Math.max(
          curr.high - curr.low,
          Math.abs(curr.high - prev.close),
          Math.abs(curr.low - prev.close)
        );
      }
      atr.push(sum / period);
    } else {
      atr.push((atr[i - 1] * (period - 1) + tr) / period);
    }
  }
  
  return atr;
}

function calcStdDev(prices: number[], period: number = 20): number[] {
  const stddev: number[] = [];
  
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      stddev.push(NaN);
    } else {
      const slice = prices.slice(i - period + 1, i + 1);
      const mean = slice.reduce((a, b) => a + b, 0) / period;
      const variance = slice.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / period;
      stddev.push(Math.sqrt(variance));
    }
  }
  
  return stddev;
}

function calcOBV(prices: number[], volumes: number[]): number[] {
  const obv: number[] = [volumes[0] || 0];
  
  for (let i = 1; i < prices.length; i++) {
    if (prices[i] > prices[i - 1]) {
      obv.push(obv[i - 1] + (volumes[i] || 0));
    } else if (prices[i] < prices[i - 1]) {
      obv.push(obv[i - 1] - (volumes[i] || 0));
    } else {
      obv.push(obv[i - 1]);
    }
  }
  
  return obv;
}

function calcMFI(candles: Candle[], period: number = 14): number[] {
  const mfi: number[] = [];
  
  for (let i = 0; i < candles.length; i++) {
    if (i < period) {
      mfi.push(NaN);
      continue;
    }
    
    let positiveFlow = 0;
    let negativeFlow = 0;
    
    for (let j = 0; j < period; j++) {
      const idx = i - j;
      const tp = (candles[idx].high + candles[idx].low + candles[idx].close) / 3;
      const rawMoneyFlow = tp * (candles[idx].volume || 1);
      
      if (idx > 0) {
        const prevTP = (candles[idx - 1].high + candles[idx - 1].low + candles[idx - 1].close) / 3;
        if (tp > prevTP) {
          positiveFlow += rawMoneyFlow;
        } else {
          negativeFlow += rawMoneyFlow;
        }
      }
    }
    
    const moneyRatio = positiveFlow / negativeFlow;
    mfi.push(100 - (100 / (1 + moneyRatio)));
  }
  
  return mfi;
}

function calcCVD(prices: number[], volumes: number[], period: number = 20): number[] {
  const cvd: number[] = [0];
  
  for (let i = 1; i < prices.length; i++) {
    const delta = prices[i] - prices[i - 1];
    const volumeDelta = (volumes[i] || 0) * Math.sign(delta);
    cvd.push(cvd[i - 1] + volumeDelta);
  }
  
  return cvd;
}

function calcDigitTrend(digits: number[], period: number = 26): number[] {
  const trend: number[] = [];
  
  for (let i = 0; i < digits.length; i++) {
    if (i < period) {
      trend.push(NaN);
    } else {
      const slice = digits.slice(i - period + 1, i + 1);
      const evens = slice.filter(d => d % 2 === 0).length;
      const odds = period - evens;
      const ratio = (evens - odds) / period * 100;
      trend.push(ratio);
    }
  }
  
  return trend;
}

function calcEvenOddRatio(digits: number[], period: number = 100): number[] {
  const ratio: number[] = [];
  
  for (let i = 0; i < digits.length; i++) {
    if (i < period) {
      ratio.push(NaN);
    } else {
      const slice = digits.slice(i - period + 1, i + 1);
      const evens = slice.filter(d => d % 2 === 0).length;
      ratio.push((evens / period) * 100);
    }
  }
  
  return ratio;
}

function calcOverUnder(digits: number[], period: number = 100): number[] {
  const ratio: number[] = [];
  
  for (let i = 0; i < digits.length; i++) {
    if (i < period) {
      ratio.push(NaN);
    } else {
      const slice = digits.slice(i - period + 1, i + 1);
      const over = slice.filter(d => d > 4).length;
      ratio.push((over / period) * 100);
    }
  }
  
  return ratio;
}

function calcHotCold(digits: number[], period: number = 50): { hot: number[], cold: number[] } {
  const hot: number[] = [];
  const cold: number[] = [];
  
  for (let i = 0; i < digits.length; i++) {
    if (i < period) {
      hot.push(NaN);
      cold.push(NaN);
    } else {
      const slice = digits.slice(i - period + 1, i + 1);
      const freq = Array(10).fill(0);
      slice.forEach(d => freq[d]++);
      
      const maxFreq = Math.max(...freq);
      const minFreq = Math.min(...freq);
      
      hot.push((maxFreq / period) * 100);
      cold.push((minFreq / period) * 100);
    }
  }
  
  return { hot, cold };
}

export default function TradingChart() {
  const { isAuthorized } = useAuth();
  
  // Chart State
  const [symbol, setSymbol] = useState('R_100');
  const [groupFilter, setGroupFilter] = useState('all');
  const [timeframe, setTimeframe] = useState('1m');
  const [chartType, setChartType] = useState('candles');
  const [prices, setPrices] = useState<number[]>([]);
  const [times, setTimes] = useState<number[]>([]);
  const [volumes, setVolumes] = useState<number[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const subscribedRef = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Indicators
  const [indicators, setIndicators] = useState<Indicator[]>(ALL_INDICATORS);
  const [showIndicatorPanel, setShowIndicatorPanel] = useState(true);
  const [selectedIndicatorSection, setSelectedIndicatorSection] = useState('trend');
  
  // Chart Settings
  const [chartSettings, setChartSettings] = useState({
    gridLines: true,
    crosshair: true,
    showVolume: true,
    showOHLC: true,
    showTicker: true,
    precision: 4,
    theme: 'dark',
    colors: {
      bg: '#0D1117',
      grid: '#21262D',
      text: '#E6EDF3',
      up: '#3FB950',
      down: '#F85149',
      volume: '#58A6FF',
      crosshair: '#FFFFFF',
    },
  });
  
  // Zoom & pan
  const [candleWidth, setCandleWidth] = useState(7);
  const [scrollOffset, setScrollOffset] = useState(0);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartOffset = useRef(0);
  const isPriceAxisDragging = useRef(false);
  const priceAxisStartY = useRef(0);
  const priceAxisStartWidth = useRef(7);
  
  // Crosshair
  const [crosshairPos, setCrosshairPos] = useState<{ x: number; y: number } | null>(null);
  const [crosshairPrice, setCrosshairPrice] = useState<number | null>(null);
  const [crosshairTime, setCrosshairTime] = useState<number | null>(null);
  
  // Drawing tools
  const [drawingMode, setDrawingMode] = useState<string | null>(null);
  const [drawings, setDrawings] = useState<DrawingTool[]>([]);
  const [selectedDrawing, setSelectedDrawing] = useState<string | null>(null);
  
  // Layout
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [activeTab, setActiveTab] = useState('chart');
  
  // Trade panel
  const [contractType, setContractType] = useState('CALL');
  const [prediction, setPrediction] = useState('5');
  const [duration, setDuration] = useState('1');
  const [durationUnit, setDurationUnit] = useState('t');
  const [tradeStake, setTradeStake] = useState('1.00');
  const [selectedDigit, setSelectedDigit] = useState<number | null>(null);
  const [isTrading, setIsTrading] = useState(false);
  
  // Trade history
  const [tradeHistory, setTradeHistory] = useState<TradeRecord[]>([]);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const lastSpokenSignal = useRef('');
  
  // Auto Bot
  const [botRunning, setBotRunning] = useState(false);
  const [botPaused, setBotPaused] = useState(false);
  const botRunningRef = useRef(false);
  const botPausedRef = useRef(false);
  const [botConfig, setBotConfig] = useState({
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

  // Add missing startIdx and endIdx for canvas rendering
  const gap = 1;
  const totalCandleW = candleWidth + gap;
  const maxVisible = canvasRef.current ? Math.floor((canvasRef.current.width - 80) / totalCandleW) : 50;
  const endIdx = candles.length - scrollOffset;
  const startIdx = Math.max(0, endIdx - maxVisible);
  
  /* ── Load history + subscribe ── */
  useEffect(() => {
    let active = true;
    subscribedRef.current = false;

    const load = async () => {
      if (!derivApi.isConnected) { setIsLoading(false); return; }
      setIsLoading(true);
      try {
        const hist = await derivApi.getTickHistory(symbol as MarketSymbol, 5000);
        if (!active) return;
        setPrices(hist.history.prices || []);
        setTimes(hist.history.times || []);
        setVolumes(hist.history.prices?.map(() => Math.random() * 100) || []); // Mock volumes
        setScrollOffset(0);
        setIsLoading(false);

        if (!subscribedRef.current) {
          subscribedRef.current = true;
          await derivApi.subscribeTicks(symbol as MarketSymbol, (data: any) => {
            if (!active || !data.tick) return;
            setPrices(prev => [...prev, data.tick.quote].slice(-5000));
            setTimes(prev => [...prev, data.tick.epoch].slice(-5000));
            setVolumes(prev => [...prev, Math.random() * 100].slice(-5000));
          });
        }
      } catch (err) {
        console.error(err);
        setIsLoading(false);
      }
    };
    load();
    return () => {
      active = false;
      derivApi.unsubscribeTicks(symbol as MarketSymbol).catch(() => {});
    };
  }, [symbol]);

  /* ── Derived data ── */
  const tfPrices = useMemo(() => prices.slice(-1000), [prices]);
  const tfTimes = useMemo(() => times.slice(-1000), [times]);
  const tfVolumes = useMemo(() => volumes.slice(-1000), [volumes]);
  
  const rawCandles = useMemo(() => buildCandles(tfPrices, tfTimes, timeframe), [tfPrices, tfTimes, timeframe]);
  
  const candles = useMemo(() => {
    if (chartType === 'heikin-ashi') {
      return buildHeikinAshi(rawCandles);
    }
    return rawCandles;
  }, [rawCandles, chartType]);
  
  const currentPrice = prices[prices.length - 1] || 0;
  const lastDigit = getLastDigit(currentPrice);
  const digits = useMemo(() => tfPrices.map(getLastDigit), [tfPrices]);
  const last26 = useMemo(() => digits.slice(-26), [digits]);
  const { frequency, percentages, mostCommon, leastCommon } = useMemo(() => analyzeDigits(tfPrices), [tfPrices]);

  // Calculate all indicator values
  const indicatorValues = useMemo(() => {
    const values: Record<string, any> = {};
    
    indicators.forEach(ind => {
      if (!ind.enabled) return;
      
      try {
        switch (ind.id) {
          case 'ema':
            values.ema = calcEMA(tfPrices, ind.params.period);
            break;
          case 'sma':
            values.sma = calcSMA(tfPrices, ind.params.period);
            break;
          case 'wma':
            values.wma = calcWMA(tfPrices, ind.params.period);
            break;
          case 'hma':
            values.hma = calcHMA(tfPrices, ind.params.period);
            break;
          case 'vwap':
            values.vwap = calcVWAP(tfPrices, tfVolumes, ind.params.period);
            break;
          case 'ichimoku':
            values.ichimoku = calcIchimoku(candles);
            break;
          case 'parabolic_sar':
            values.parabolicSar = calcParabolicSAR(candles, ind.params.step, ind.params.max);
            break;
          case 'rsi':
            values.rsi = calculateRSI(tfPrices, ind.params.period);
            break;
          case 'macd':
            values.macd = calculateMACD(tfPrices, ind.params.fast, ind.params.slow, ind.params.signal);
            break;
          case 'stoch':
            values.stoch = calcStoch(candles, ind.params.k, ind.params.d, ind.params.smooth);
            break;
          case 'cci':
            values.cci = calcCCI(candles, ind.params.period);
            break;
          case 'williams_r':
            values.williamsR = calcWilliamsR(candles, ind.params.period);
            break;
          case 'awesome':
            values.awesome = calcAwesomeOsc(candles, ind.params.fast, ind.params.slow);
            break;
          case 'momentum':
            values.momentum = calcMomentum(tfPrices, ind.params.period);
            break;
          case 'bb':
            values.bb = calculateBollingerBands(tfPrices, ind.params.period, ind.params.std);
            break;
          case 'keltner':
            values.keltner = calcKeltner(candles, ind.params.period, ind.params.multiplier, ind.params.atr);
            break;
          case 'donchian':
            values.donchian = calcDonchian(candles, ind.params.period);
            break;
          case 'atr':
            values.atr = calcATR(candles, ind.params.period);
            break;
          case 'stddev':
            values.stddev = calcStdDev(tfPrices, ind.params.period);
            break;
          case 'obv':
            values.obv = calcOBV(tfPrices, tfVolumes);
            break;
          case 'mfi':
            values.mfi = calcMFI(candles, ind.params.period);
            break;
          case 'cvd':
            values.cvd = calcCVD(tfPrices, tfVolumes, ind.params.period);
            break;
          case 'digit_trend':
            values.digitTrend = calcDigitTrend(digits, ind.params.period);
            break;
          case 'even_odd':
            values.evenOdd = calcEvenOddRatio(digits, ind.params.period);
            break;
          case 'over_under':
            values.overUnder = calcOverUnder(digits, ind.params.period);
            break;
          case 'hot_cold':
            values.hotCold = calcHotCold(digits, ind.params.period);
            break;
        }
      } catch (e) {
        console.error(`Error calculating ${ind.id}:`, e);
      }
    });
    
    return values;
  }, [indicators, tfPrices, tfVolumes, candles, digits]);

  // Digit stats
  const evenCount = useMemo(() => digits.filter(d => d % 2 === 0).length, [digits]);
  const oddCount = digits.length - evenCount;
  const evenPct = digits.length > 0 ? (evenCount / digits.length * 100) : 50;
  const oddPct = 100 - evenPct;
  const overCount = useMemo(() => digits.filter(d => d > 4).length, [digits]);
  const underCount = digits.length - overCount;
  const overPct = digits.length > 0 ? (overCount / digits.length * 100) : 50;
  const underPct = 100 - overPct;

  // BB position
  const bb = indicatorValues.bb || { upper: 0, middle: 0, lower: 0 };
  const bbRange = bb.upper - bb.lower || 1;
  const bbPosition = ((currentPrice - bb.lower) / bbRange * 100);

  /* ── Canvas Chart ── */
  // Map candles to pixel positions
  const getCandleX = useCallback((index: number): number => {
    const gap = 1;
    const totalCandleW = candleWidth + gap;
    const visibleCandles = candles.slice(
      Math.max(0, Math.min(candles.length - 10, scrollOffset)),
      Math.min(candles.length, scrollOffset + Math.floor((canvasRef.current?.width || 800) / totalCandleW))
    );
    const visibleStart = Math.max(0, Math.min(candles.length - 10, scrollOffset));
    return 5 + (index - visibleStart) * totalCandleW;
  }, [candles.length, scrollOffset, candleWidth]);

  const getCandleY = useCallback((price: number, chartHeight: number, minP: number, maxP: number): number => {
    const range = maxP - minP || 1;
    return 20 + ((maxP - price) / range) * (chartHeight - 40);
  }, []);

  // Canvas mouse handlers
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        setCandleWidth(prev => Math.max(2, Math.min(30, prev - Math.sign(e.deltaY))));
      } else {
        const delta = Math.sign(e.deltaY) * Math.max(3, Math.floor(candles.length * 0.03));
        setScrollOffset(prev => Math.max(0, Math.min(candles.length - 10, prev + delta)));
      }
    };

    const onMouseDown = (e: MouseEvent) => {
      const canvasRect = canvas.getBoundingClientRect();
      const pAxisX = canvasRect.width - 80;
      const localX = e.clientX - canvasRect.left;
      
      if (localX >= pAxisX) {
        isPriceAxisDragging.current = true;
        priceAxisStartY.current = e.clientY;
        priceAxisStartWidth.current = candleWidth;
        canvas.style.cursor = 'ns-resize';
      } else {
        isDragging.current = true;
        dragStartX.current = e.clientX;
        dragStartOffset.current = scrollOffset;
        canvas.style.cursor = 'grabbing';
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      const canvasRect = canvas.getBoundingClientRect();
      const localX = e.clientX - canvasRect.left;
      const localY = e.clientY - canvasRect.top;
      
      if (isPriceAxisDragging.current) {
        const dy = priceAxisStartY.current - e.clientY;
        const newWidth = Math.max(2, Math.min(30, priceAxisStartWidth.current + Math.round(dy / 8)));
        setCandleWidth(newWidth);
        return;
      }
      
      if (isDragging.current) {
        const dx = dragStartX.current - e.clientX;
        const candlesPerPx = 1 / (candleWidth + 1);
        const delta = Math.round(dx * candlesPerPx);
        setScrollOffset(Math.max(0, Math.min(candles.length - 10, dragStartOffset.current + delta)));
      } else if (chartSettings.crosshair) {
        // Update crosshair position
        setCrosshairPos({ x: localX, y: localY });
        
        // Find price and time at crosshair
        const chartH = canvasRect.height - (indicatorValues.rsi ? 100 : 0) - (indicatorValues.macd ? 120 : 0);
        
        if (localY < chartH && candles.length > 0) {
          // Price calculation
          const allPrices = candles.flatMap(c => [c.high, c.low]);
          const rawMin = Math.min(...allPrices);
          const rawMax = Math.max(...allPrices);
          const priceRange = rawMax - rawMin;
          const padding = priceRange * 0.08;
          const minP = rawMin - padding;
          const maxP = rawMax + padding;
          
          const priceY = localY - 20;
          const chartHeight = chartH - 40;
          const priceAtY = maxP - (priceY / chartHeight) * (maxP - minP);
          setCrosshairPrice(priceAtY);
          
          // Time calculation
          const gap = 1;
          const totalCandleW = candleWidth + gap;
          const visibleStart = Math.max(0, Math.min(candles.length - 10, scrollOffset));
          const candleIndex = visibleStart + Math.floor((localX - 5) / totalCandleW);
          
          if (candleIndex >= 0 && candleIndex < candles.length) {
            setCrosshairTime(candles[candleIndex].time);
          }
        }
      }
    };

    const onMouseUp = () => {
      isDragging.current = false;
      isPriceAxisDragging.current = false;
      canvas.style.cursor = 'crosshair';
    };

    const onMouseLeave = () => {
      setCrosshairPos(null);
      setCrosshairPrice(null);
      setCrosshairTime(null);
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('mouseleave', onMouseLeave);

    return () => {
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('mouseleave', onMouseLeave);
    };
  }, [candles.length, scrollOffset, candleWidth, indicatorValues, chartSettings.crosshair]);

  // Draw chart effect - simplified for now to avoid canvas errors
  useEffect(() => {
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
    const H = rect.height;
    
    // Clear
    ctx.fillStyle = chartSettings.colors.bg;
    ctx.fillRect(0, 0, W, H);
    
    // Simple price line for now
    ctx.strokeStyle = '#2F81F7';
    ctx.lineWidth = 2;
    ctx.beginPath();
    
    const maxPrice = Math.max(...candles.map(c => c.high));
    const minPrice = Math.min(...candles.map(c => c.low));
    const range = maxPrice - minPrice || 1;
    
    for (let i = 0; i < candles.length; i++) {
      const x = (i / candles.length) * W;
      const y = 20 + ((maxPrice - candles[i].close) / range) * (H - 40);
      
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    
  }, [candles, chartSettings]);

  // Filter markets
  const filteredMarkets = groupFilter === 'all' ? ALL_MARKETS : ALL_MARKETS.filter(m => m.group === groupFilter);
  const marketName = ALL_MARKETS.find(m => m.symbol === symbol)?.name || symbol;

  // Trade execution
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
      setTradeHistory(prev => prev.map(t => t.id === contractId ? { ...t, profit: result.profit, status: result.status } : t));
      
      if (result.status === 'won') { 
        toast.success(`✅ WON +$${result.profit.toFixed(2)}`); 
        if (voiceEnabled) speak(`Trade won. Profit ${result.profit.toFixed(2)} dollars`);
      } else { 
        toast.error(`❌ LOST -$${Math.abs(result.profit).toFixed(2)}`); 
        if (voiceEnabled) speak(`Trade lost. Loss ${Math.abs(result.profit).toFixed(2)} dollars`);
      }
    } catch (err: any) { 
      toast.error(`Trade failed: ${err.message}`); 
    } finally { 
      setIsTrading(false); 
    }
  };

  // Voice AI
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

  // Toggle indicator
  const toggleIndicator = useCallback((indicatorId: string) => {
    setIndicators(prev => prev.map(ind => 
      ind.id === indicatorId ? { ...ind, enabled: !ind.enabled } : ind
    ));
  }, []);

  // Bot stats
  const totalTrades = tradeHistory.filter(t => t.status !== 'open').length;
  const wins = tradeHistory.filter(t => t.status === 'won').length;
  const losses = tradeHistory.filter(t => t.status === 'lost').length;
  const totalProfit = tradeHistory.reduce((s, t) => s + t.profit, 0);
  const winRate = totalTrades > 0 ? (wins / totalTrades * 100) : 0;

  return (
    <div className={`flex h-screen ${chartSettings.theme === 'dark' ? 'dark' : ''}`}>
      {/* Left Sidebar - Markets */}
      {showSidebar && (
        <div className="w-64 bg-card border-r border-border flex flex-col">
          <div className="p-3 border-b border-border">
            <h2 className="font-semibold text-sm">Markets</h2>
          </div>
          
          <div className="p-2">
            <Select value={groupFilter} onValueChange={setGroupFilter}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GROUPS.map(g => (
                  <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {filteredMarkets.map(m => (
                <button
                  key={m.symbol}
                  onClick={() => setSymbol(m.symbol)}
                  className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${
                    symbol === m.symbol 
                      ? 'bg-primary text-primary-foreground' 
                      : 'hover:bg-muted text-muted-foreground'
                  }`}
                >
                  {m.name}
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}
      
      {/* Main Chart Area */}
      <div className="flex-1 flex flex-col">
        {/* Top Toolbar */}
        <div className="h-12 border-b border-border flex items-center px-3 gap-2 bg-card">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setShowSidebar(!showSidebar)}
          >
            <Layers className="h-4 w-4" />
          </Button>
          
          <Separator orientation="vertical" className="h-6" />
          
          {/* Chart Type */}
          <Select value={chartType} onValueChange={setChartType}>
            <SelectTrigger className="h-8 w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CHART_TYPES.map(t => {
                const Icon = t.icon;
                return (
                  <SelectItem key={t.value} value={t.value}>
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4" />
                      {t.label}
                    </div>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          
          <Separator orientation="vertical" className="h-6" />
          
          {/* Timeframes */}
          <div className="flex gap-1">
            {TIMEFRAMES.map(tf => (
              <Button
                key={tf.value}
                size="sm"
                variant={timeframe === tf.value ? 'default' : 'ghost'}
                className="h-7 text-xs px-2"
                onClick={() => setTimeframe(tf.value)}
              >
                {tf.label}
              </Button>
            ))}
          </div>
          
          <Separator orientation="vertical" className="h-6" />
          
          {/* Indicators Toggle */}
          <Button
            variant={showIndicatorPanel ? 'default' : 'outline'}
            size="sm"
            className="h-8 text-xs gap-1"
            onClick={() => setShowIndicatorPanel(!showIndicatorPanel)}
          >
            <Sigma className="h-3.5 w-3.5" />
            Indicators
          </Button>
          
          <div className="flex-1" />
          
          {/* Current Price */}
          <Badge variant="outline" className="font-mono text-sm">
            {currentPrice.toFixed(chartSettings.precision)}
          </Badge>
          
          {/* Fullscreen */}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setIsFullscreen(!isFullscreen)}
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
        </div>
        
        {/* Chart */}
        <div className="flex-1 relative">
          <canvas 
            ref={canvasRef} 
            className="w-full h-full cursor-crosshair"
            style={{ background: chartSettings.colors.bg }}
          />
          
          {/* Loading Overlay */}
          {isLoading && (
            <div className="absolute inset-0 bg-background/80 flex items-center justify-center">
              <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">Loading chart data...</p>
              </div>
            </div>
          )}
        </div>
        
        {/* Bottom Panel - Tabs */}
        <div className="h-[300px] border-t border-border bg-card">
          <Tabs defaultValue="indicators" className="h-full flex flex-col">
            <div className="px-3 pt-2 border-b border-border">
              <TabsList>
                <TabsTrigger value="indicators" className="text-xs">Indicators</TabsTrigger>
                <TabsTrigger value="trading" className="text-xs">Trading</TabsTrigger>
                <TabsTrigger value="bot" className="text-xs">Auto Bot</TabsTrigger>
                <TabsTrigger value="history" className="text-xs">History</TabsTrigger>
                <TabsTrigger value="analysis" className="text-xs">Analysis</TabsTrigger>
                <TabsTrigger value="settings" className="text-xs">Settings</TabsTrigger>
              </TabsList>
            </div>
            
            <TabsContent value="indicators" className="flex-1 p-3 overflow-auto">
              <div className="grid grid-cols-4 gap-4">
                {['trend', 'oscillator', 'volatility', 'volume', 'custom'].map(section => (
                  <div key={section}>
                    <h3 className="text-xs font-semibold mb-2 capitalize">{section}</h3>
                    <div className="space-y-2">
                      {indicators
                        .filter(i => i.section === section)
                        .map(ind => (
                          <div key={ind.id} className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={ind.enabled}
                                onCheckedChange={() => toggleIndicator(ind.id)}
                              />
                              <span className="text-xs" style={{ color: ind.color }}>{ind.name}</span>
                            </div>
                            
                            {ind.enabled && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={() => {
                                  // Show settings modal
                                }}
                              >
                                <Settings className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        ))}
                    </div>
                  </div>
                ))}
              </div>
            </TabsContent>
            
            <TabsContent value="trading" className="flex-1 p-3 overflow-auto">
              <div className="grid grid-cols-3 gap-4">
                {/* Contract Type */}
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Contract Type</label>
                  <Select value={contractType} onValueChange={setContractType}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CONTRACT_TYPES.map(c => {
                        const Icon = c.icon;
                        return (
                          <SelectItem key={c.value} value={c.value}>
                            <div className="flex items-center gap-2">
                              <Icon className="h-4 w-4" style={{ color: c.color }} />
                              {c.label}
                            </div>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
                
                {/* Duration */}
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Duration</label>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      value={duration}
                      onChange={(e) => setDuration(e.target.value)}
                      className="flex-1"
                    />
                    <Select value={durationUnit} onValueChange={setDurationUnit}>
                      <SelectTrigger className="w-20">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="t">Ticks</SelectItem>
                        <SelectItem value="s">Seconds</SelectItem>
                        <SelectItem value="m">Minutes</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                
                {/* Stake */}
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Stake ($)</label>
                  <Input
                    type="number"
                    value={tradeStake}
                    onChange={(e) => setTradeStake(e.target.value)}
                    step="0.01"
                    min="0.35"
                  />
                </div>
              </div>
              
              {/* Digit Prediction */}
              {['DIGITMATCH', 'DIGITDIFF', 'DIGITOVER', 'DIGITUNDER'].includes(contractType) && (
                <div className="mt-3">
                  <label className="text-xs text-muted-foreground mb-1 block">Prediction</label>
                  <div className="grid grid-cols-10 gap-1">
                    {Array.from({ length: 10 }, (_, i) => (
                      <button
                        key={i}
                        onClick={() => { setPrediction(String(i)); setSelectedDigit(i); }}
                        className={`h-10 rounded text-sm font-mono font-bold transition-all ${
                          prediction === String(i) 
                            ? 'bg-primary text-primary-foreground' 
                            : 'bg-muted text-foreground hover:bg-secondary'
                        }`}
                      >
                        {i}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Action Buttons */}
              <div className="flex gap-3 mt-4">
                <Button
                  onClick={() => handleBuy('buy')}
                  disabled={isTrading || !isAuthorized}
                  className="flex-1 h-12 bg-profit hover:bg-profit/90 text-profit-foreground"
                >
                  <TrendingUp className="h-4 w-4 mr-2" />
                  Buy {contractType === 'CALL' ? 'Rise' : contractType}
                </Button>
                
                <Button
                  onClick={() => handleBuy('sell')}
                  disabled={isTrading || !isAuthorized}
                  className="flex-1 h-12 bg-loss hover:bg-loss/90 text-loss-foreground"
                >
                  <TrendingDown className="h-4 w-4 mr-2" />
                  Sell {contractType === 'PUT' ? 'Fall' : contractType}
                </Button>
              </div>
            </TabsContent>
            
            <TabsContent value="bot" className="flex-1 p-3 overflow-auto">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Bot Mode</label>
                  <Select>
                    <SelectTrigger>
                      <SelectValue placeholder="Select mode" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="simple">Simple</SelectItem>
                      <SelectItem value="martingale">Martingale</SelectItem>
                      <SelectItem value="antimartingale">Anti-Martingale</SelectItem>
                      <SelectItem value="dAlembert">d'Alembert</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Base Stake ($)</label>
                  <Input type="number" value="1.00" step="0.01" />
                </div>
                
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Max Trades</label>
                  <Input type="number" value="50" />
                </div>
              </div>
              
              <div className="grid grid-cols-3 gap-4 mt-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Stop Loss ($)</label>
                  <Input type="number" value="10" />
                </div>
                
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Take Profit ($)</label>
                  <Input type="number" value="20" />
                </div>
                
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Max Concurrent</label>
                  <Input type="number" value="1" />
                </div>
              </div>
              
              <div className="flex gap-3 mt-4">
                <Button className="flex-1 bg-profit hover:bg-profit/90">
                  <Play className="h-4 w-4 mr-2" />
                  Start Bot
                </Button>
                
                <Button variant="outline" className="flex-1">
                  <Pause className="h-4 w-4 mr-2" />
                  Pause
                </Button>
                
                <Button variant="destructive" className="flex-1">
                  <StopCircle className="h-4 w-4 mr-2" />
                  Stop
                </Button>
              </div>
              
              {/* Bot Stats */}
              <div className="grid grid-cols-5 gap-2 mt-4 p-3 bg-muted/30 rounded-lg">
                <div className="text-center">
                  <div className="text-xs text-muted-foreground">Trades</div>
                  <div className="font-mono font-bold">0</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-muted-foreground">Win Rate</div>
                  <div className="font-mono font-bold text-profit">0%</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-muted-foreground">Profit</div>
                  <div className="font-mono font-bold">$0.00</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-muted-foreground">Balance</div>
                  <div className="font-mono font-bold">$0.00</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-muted-foreground">Streak</div>
                  <div className="font-mono font-bold">0</div>
                </div>
              </div>
            </TabsContent>
            
            <TabsContent value="history" className="flex-1 p-3 overflow-auto">
              <div className="space-y-2">
                {tradeHistory.length > 0 ? (
                  tradeHistory.map(t => (
                    <div
                      key={t.id}
                      className={`flex items-center justify-between p-2 rounded-lg border ${
                        t.status === 'open' ? 'border-primary/30 bg-primary/5' :
                        t.status === 'won' ? 'border-profit/30 bg-profit/5' :
                        'border-loss/30 bg-loss/5'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className={`font-bold ${
                          t.status === 'won' ? 'text-profit' : 
                          t.status === 'lost' ? 'text-loss' : 
                          'text-primary'
                        }`}>
                          {t.status === 'open' ? '⏳' : t.status === 'won' ? '✅' : '❌'}
                        </span>
                        
                        <div>
                          <div className="text-xs font-medium">{t.type}</div>
                          <div className="text-[10px] text-muted-foreground">
                            {new Date(t.time).toLocaleString()}
                          </div>
                        </div>
                      </div>
                      
                      <div className="text-right">
                        <div className="text-xs font-mono">Stake: ${t.stake.toFixed(2)}</div>
                        <div className={`text-xs font-mono font-bold ${
                          t.profit >= 0 ? 'text-profit' : 'text-loss'
                        }`}>
                          {t.profit >= 0 ? '+' : ''}{t.profit.toFixed(2)}
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    No trades yet
                  </div>
                )}
              </div>
            </TabsContent>
            
            <TabsContent value="analysis" className="flex-1 p-3 overflow-auto">
              <div className="grid grid-cols-2 gap-4">
                {/* Digit Analysis */}
                <div>
                  <h3 className="text-sm font-semibold mb-2">Digit Distribution</h3>
                  <div className="grid grid-cols-5 gap-2">
                    {Array.from({ length: 10 }, (_, d) => {
                      const pct = percentages[d] || 0;
                      const count = frequency[d] || 0;
                      return (
                        <div key={d} className="text-center p-2 bg-muted/30 rounded">
                          <div className="text-lg font-mono font-bold">{d}</div>
                          <div className="text-xs">{count}x</div>
                          <div className="text-[10px] text-muted-foreground">{pct.toFixed(1)}%</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                
                {/* Statistics */}
                <div>
                  <h3 className="text-sm font-semibold mb-2">Statistics</h3>
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs">
                      <span>Even/Odd Ratio</span>
                      <span className="font-mono">{evenPct.toFixed(1)}% / {oddPct.toFixed(1)}%</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span>Over/Under Ratio</span>
                      <span className="font-mono">{overPct.toFixed(1)}% / {underPct.toFixed(1)}%</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span>Most Common Digit</span>
                      <span className="font-mono text-profit">{mostCommon} ({percentages[mostCommon]?.toFixed(1)}%)</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span>Least Common Digit</span>
                      <span className="font-mono text-loss">{leastCommon} ({percentages[leastCommon]?.toFixed(1)}%)</span>
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Last Digits */}
              <div className="mt-4">
                <h3 className="text-sm font-semibold mb-2">Last 26 Digits</h3>
                <div className="flex gap-1 flex-wrap">
                  {last26.map((d, i) => {
                    const isEven = d % 2 === 0;
                    return (
                      <div
                        key={i}
                        className={`w-8 h-8 rounded flex items-center justify-center font-mono text-xs font-bold border-2 ${
                          isEven
                            ? 'border-profit text-profit bg-profit/10'
                            : 'border-warning text-warning bg-warning/10'
                        }`}
                      >
                        {d}
                      </div>
                    );
                  })}
                </div>
              </div>
            </TabsContent>
            
            <TabsContent value="settings" className="flex-1 p-3 overflow-auto">
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-semibold mb-2">Chart Settings</h3>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs">Grid Lines</span>
                      <Switch
                        checked={chartSettings.gridLines}
                        onCheckedChange={(v) => setChartSettings(prev => ({ ...prev, gridLines: v }))}
                      />
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <span className="text-xs">Crosshair</span>
                      <Switch
                        checked={chartSettings.crosshair}
                        onCheckedChange={(v) => setChartSettings(prev => ({ ...prev, crosshair: v }))}
                      />
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <span className="text-xs">Show Volume</span>
                      <Switch
                        checked={chartSettings.showVolume}
                        onCheckedChange={(v) => setChartSettings(prev => ({ ...prev, showVolume: v }))}
                      />
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <span className="text-xs">Show OHLC</span>
                      <Switch
                        checked={chartSettings.showOHLC}
                        onCheckedChange={(v) => setChartSettings(prev => ({ ...prev, showOHLC: v }))}
                      />
                    </div>
                  </div>
                </div>
                
                <div>
                  <h3 className="text-sm font-semibold mb-2">Precision</h3>
                  <Select 
                    value={String(chartSettings.precision)} 
                    onValueChange={(v) => setChartSettings(prev => ({ ...prev, precision: parseInt(v) }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="2">2 decimals</SelectItem>
                      <SelectItem value="3">3 decimals</SelectItem>
                      <SelectItem value="4">4 decimals</SelectItem>
                      <SelectItem value="5">5 decimals</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div>
                  <h3 className="text-sm font-semibold mb-2">Candle Width</h3>
                  <Slider
                    value={[candleWidth]}
                    onValueChange={([v]) => setCandleWidth(v)}
                    min={2}
                    max={30}
                    step={1}
                  />
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
