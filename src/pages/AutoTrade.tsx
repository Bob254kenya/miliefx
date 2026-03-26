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
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import {
  TrendingUp, TrendingDown, Activity, BarChart3, ArrowUp, ArrowDown, Minus,
  Target, ShieldAlert, Gauge, Volume2, VolumeX, Clock, Zap, Trophy, Play, Pause, StopCircle, Eye, EyeOff, RefreshCw,
  Plus, X, Settings
} from 'lucide-react';

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
  { value: 'all', label: 'All' },
  { value: 'vol1s', label: 'Vol 1s' },
  { value: 'vol', label: 'Vol' },
  { value: 'jump', label: 'Jump' },
  { value: 'bear', label: 'Bear' },
  { value: 'bull', label: 'Bull' },
  { value: 'step', label: 'Step' },
  { value: 'range', label: 'Range' },
];

const TIMEFRAMES = ['1m','3m','5m','15m','30m','1h','4h','12h','1d'];
const CANDLE_CONFIG = {
  minCandles: 1000,
  maxCandles: 5000,
  defaultCandles: 1000,
};

const TICK_RANGES = [50, 100, 200, 300, 500, 1000];

// Available indicators
type IndicatorType = 'RSI' | 'BB' | 'MA' | 'MACD' | 'PSAR';
interface Indicator {
  id: string;
  type: IndicatorType;
  enabled: boolean;
  params?: any;
}

/* ── Candle builder with fixed count ── */
interface Candle {
  open: number; high: number; low: number; close: number; time: number;
}

function buildCandles(prices: number[], times: number[], tf: string): Candle[] {
  if (prices.length === 0) return [];
  const seconds: Record<string,number> = {
    '1m':60,'3m':180,'5m':300,'15m':900,'30m':1800,'1h':3600,'4h':14400,'12h':43200,'1d':86400,
  };
  const interval = seconds[tf] || 60;
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
  
  // Ensure we maintain candle count between min and max
  if (candles.length > CANDLE_CONFIG.maxCandles) {
    return candles.slice(-CANDLE_CONFIG.maxCandles);
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

function calcSMA(prices: number[], period: number): number {
  if (prices.length < period) return prices[prices.length - 1] || 0;
  return prices.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function calcPSAR(highs: number[], lows: number[], step = 0.02, maxStep = 0.2) {
  if (highs.length < 2) return { sar: 0, trend: 'bullish' };
  
  let sar = lows[0];
  let trend = 1; // 1 for bullish, -1 for bearish
  let ep = highs[0];
  let af = step;
  
  for (let i = 1; i < highs.length; i++) {
    sar = sar + af * (ep - sar);
    
    if (trend === 1) {
      if (lows[i] < sar) {
        trend = -1;
        sar = ep;
        ep = lows[i];
        af = step;
      } else {
        if (highs[i] > ep) {
          ep = highs[i];
          af = Math.min(af + step, maxStep);
        }
      }
    } else {
      if (highs[i] > sar) {
        trend = 1;
        sar = ep;
        ep = highs[i];
        af = step;
      } else {
        if (lows[i] < ep) {
          ep = lows[i];
          af = Math.min(af + step, maxStep);
        }
      }
    }
  }
  
  return { sar, trend: trend === 1 ? 'bullish' : 'bearish' };
}

/* ── Per-candle indicator series ── */
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
  const result: (number | null)[] = [null];
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

function calcPSARSeries(highs: number[], lows: number[]) {
  const sarValues: (number | null)[] = [];
  const trends: string[] = [];
  
  if (highs.length < 2) {
    for (let i = 0; i < highs.length; i++) {
      sarValues.push(null);
      trends.push('bullish');
    }
    return { sarValues, trends };
  }
  
  let sar = lows[0];
  let trend = 1;
  let ep = highs[0];
  let af = 0.02;
  const step = 0.02;
  const maxStep = 0.2;
  
  for (let i = 0; i < highs.length; i++) {
    if (i === 0) {
      sarValues.push(sar);
      trends.push(trend === 1 ? 'bullish' : 'bearish');
      continue;
    }
    
    sar = sar + af * (ep - sar);
    
    if (trend === 1) {
      if (lows[i] < sar) {
        trend = -1;
        sar = ep;
        ep = lows[i];
        af = step;
      } else {
        if (highs[i] > ep) {
          ep = highs[i];
          af = Math.min(af + step, maxStep);
        }
      }
    } else {
      if (highs[i] > sar) {
        trend = 1;
        sar = ep;
        ep = highs[i];
        af = step;
      } else {
        if (lows[i] < ep) {
          ep = lows[i];
          af = Math.min(af + step, maxStep);
        }
      }
    }
    
    sarValues.push(sar);
    trends.push(trend === 1 ? 'bullish' : 'bearish');
  }
  
  return { sarValues, trends };
}

/* ── Map candle index back to price-series index for indicators ── */
function mapCandlesToPriceIndices(prices: number[], times: number[], tf: string): number[] {
  const seconds: Record<string, number> = {
    '1m':60,'3m':180,'5m':300,'15m':900,'30m':1800,'1h':3600,'4h':14400,'12h':43200,'1d':86400,
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

/* ── Support/Resistance ── */
function calcSR(prices: number[]) {
  if (prices.length < 10) return { support: 0, resistance: 0 };
  const sorted = [...prices].sort((a, b) => a - b);
  const p5 = Math.floor(sorted.length * 0.05);
  const p95 = Math.floor(sorted.length * 0.95);
  return { support: sorted[p5], resistance: sorted[Math.min(p95, sorted.length - 1)] };
}

/* ── MACD proper ── */
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

// Independent tick storage for digit analysis
const globalTickHistory: { [symbol: string]: number[] } = {};
const tickSubscribers: { [symbol: string]: ((digit: number) => void)[] } = {};

function getTickHistory(symbol: string): number[] {
  return globalTickHistory[symbol] || [];
}

function subscribeToTicks(symbol: string, callback: (digit: number) => void) {
  if (!tickSubscribers[symbol]) tickSubscribers[symbol] = [];
  tickSubscribers[symbol].push(callback);
  return () => {
    tickSubscribers[symbol] = tickSubscribers[symbol].filter(cb => cb !== callback);
  };
}

function addTick(symbol: string, digit: number) {
  if (!globalTickHistory[symbol]) globalTickHistory[symbol] = [];
  globalTickHistory[symbol].push(digit);
  const maxSize = 1000; // Keep last 1000 ticks for analysis
  if (globalTickHistory[symbol].length > maxSize) globalTickHistory[symbol].shift();
  
  // Notify subscribers
  if (tickSubscribers[symbol]) {
    tickSubscribers[symbol].forEach(cb => cb(digit));
  }
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
  
  // Candle management
  const [candleCount, setCandleCount] = useState(CANDLE_CONFIG.defaultCandles);
  const [maxCandlesLoaded, setMaxCandlesLoaded] = useState(CANDLE_CONFIG.defaultCandles);
  
  // Digit analysis independent state
  const [tickRange, setTickRange] = useState(100);
  const [digitAnalysisData, setDigitAnalysisData] = useState({
    frequency: {} as Record<number, number>,
    percentages: {} as Record<number, number>,
    mostCommon: 0,
    leastCommon: 0,
  });
  
  // Indicators system
  const [indicators, setIndicators] = useState<Indicator[]>([]);
  const [showIndicatorPanel, setShowIndicatorPanel] = useState(false);
  
  // Zoom & pan state
  const [candleWidth, setCandleWidth] = useState(7);
  const [scrollOffset, setScrollOffset] = useState(0);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartOffset = useRef(0);
  const isPriceAxisDragging = useRef(false);
  const priceAxisStartY = useRef(0);
  const priceAxisStartWidth = useRef(7);

  // Trade panel
  const [contractType, setContractType] = useState('CALL');
  const [prediction, setPrediction] = useState('5');
  const [duration, setDuration] = useState('1');
  const [durationUnit, setDurationUnit] = useState('t');
  const [tradeStake, setTradeStake] = useState('1.00');
  const [selectedDigit, setSelectedDigit] = useState<number | null>(null);
  const [isTrading, setIsTrading] = useState(false);

  // Bot progress
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

  // Auto Bot state
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

  // Update digit analysis when tick range changes or new ticks arrive
  useEffect(() => {
    const updateDigitAnalysis = () => {
      const ticks = getTickHistory(symbol);
      const recentTicks = ticks.slice(-tickRange);
      if (recentTicks.length > 0) {
        const analysis = analyzeDigits(recentTicks);
        setDigitAnalysisData({
          frequency: analysis.frequency,
          percentages: analysis.percentages,
          mostCommon: analysis.mostCommon,
          leastCommon: analysis.leastCommon,
        });
      }
    };
    
    updateDigitAnalysis();
    
    // Subscribe to new ticks for this symbol
    const unsubscribe = subscribeToTicks(symbol, () => {
      updateDigitAnalysis();
    });
    
    return unsubscribe;
  }, [symbol, tickRange]);

  /* ── FIXED: Load history with configurable candle count ── */
  useEffect(() => {
    let active = true;
    let timeoutId: NodeJS.Timeout;
    
    const cleanup = async () => {
      if (subscriptionRef.current) {
        try {
          await derivApi.unsubscribeTicks(symbol as MarketSymbol);
          console.log(`Unsubscribed from ${symbol}`);
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
        
        // Load up to maxCandles candles (5000 max)
        const ticksToLoad = Math.min(candleCount, CANDLE_CONFIG.maxCandles);
        const hist = await derivApi.getTickHistory(symbol as MarketSymbol, ticksToLoad);
        if (!active) return;
        
        // Initialize tick history for digit analysis with all ticks
        const historicalDigits = (hist.history.prices || []).map(p => getLastDigit(p));
        globalTickHistory[symbol] = historicalDigits.slice(-1000);
        
        setPrices(hist.history.prices || []);
        setTimes(hist.history.times || []);
        setMaxCandlesLoaded(hist.history.prices?.length || 0);
        setScrollOffset(0);
        setIsLoading(false);

        if (!subscribedRef.current || !subscriptionRef.current) {
          subscriptionRef.current = await derivApi.subscribeTicks(symbol as MarketSymbol, (data: any) => {
            if (!active || !data.tick) return;
            
            const quote = data.tick.quote;
            const digit = getLastDigit(quote);
            const epoch = data.tick.epoch;
            
            // Update tick history for digit analysis (independent)
            addTick(symbol, digit);
            
            // Update prices and times with proper limit (maintain up to 5000 candles worth)
            setPrices(prev => {
              const newPrices = [...prev, quote];
              return newPrices.slice(-CANDLE_CONFIG.maxCandles);
            });
            
            setTimes(prev => {
              const newTimes = [...prev, epoch];
              return newTimes.slice(-CANDLE_CONFIG.maxCandles);
            });
            
            // Visual feedback for price change
            if (canvasRef.current) {
              canvasRef.current.style.transition = 'background-color 0.1s';
              canvasRef.current.style.backgroundColor = 'rgba(63, 185, 80, 0.05)';
              setTimeout(() => {
                if (canvasRef.current) {
                  canvasRef.current.style.backgroundColor = '';
                }
              }, 100);
            }
          });
          subscribedRef.current = true;
          console.log(`Subscribed to ${symbol} for real-time updates`);
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
  }, [symbol, candleCount]);

  // Connection status check
  useEffect(() => {
    const checkConnection = setInterval(() => {
      if (!derivApi.isConnected && !isLoading) {
        console.log('Connection lost, attempting to reconnect...');
        setPrices([]);
        setTimes([]);
        setSymbol(prev => prev);
      }
    }, 5000);

    return () => clearInterval(checkConnection);
  }, [isLoading]);

  // Load more candles when scrolling to the beginning
  const loadMoreCandles = useCallback(async () => {
    if (maxCandlesLoaded >= CANDLE_CONFIG.maxCandles) return;
    
    const additionalCandles = Math.min(500, CANDLE_CONFIG.maxCandles - maxCandlesLoaded);
    const hist = await derivApi.getTickHistory(symbol as MarketSymbol, maxCandlesLoaded + additionalCandles);
    
    setPrices(hist.history.prices || []);
    setTimes(hist.history.times || []);
    setMaxCandlesLoaded(hist.history.prices?.length || 0);
  }, [symbol, maxCandlesLoaded]);

  // Handle scroll to load more candles
  useEffect(() => {
    if (scrollOffset <= 10 && maxCandlesLoaded < CANDLE_CONFIG.maxCandles) {
      loadMoreCandles();
    }
  }, [scrollOffset, maxCandlesLoaded, loadMoreCandles]);

  // Manual refresh function
  const handleManualRefresh = useCallback(async () => {
    if (!derivApi.isConnected) {
      toast.error('Not connected to Deriv');
      return;
    }
    
    setIsLoading(true);
    try {
      const hist = await derivApi.getTickHistory(symbol as MarketSymbol, candleCount);
      setPrices(prev => {
        const newPrices = [...prev, ...hist.history.prices];
        return newPrices.slice(-CANDLE_CONFIG.maxCandles);
      });
      setTimes(prev => {
        const newTimes = [...prev, ...hist.history.times];
        return newTimes.slice(-CANDLE_CONFIG.maxCandles);
      });
      toast.success('Market data refreshed');
    } catch (err) {
      toast.error('Failed to refresh data');
    } finally {
      setIsLoading(false);
    }
  }, [symbol, candleCount]);

  // Add indicator
  const addIndicator = useCallback((type: IndicatorType) => {
    const newIndicator: Indicator = {
      id: `${type}-${Date.now()}`,
      type,
      enabled: true,
    };
    setIndicators(prev => [...prev, newIndicator]);
  }, []);

  // Remove indicator
  const removeIndicator = useCallback((id: string) => {
    setIndicators(prev => prev.filter(ind => ind.id !== id));
  }, []);

  // Toggle indicator
  const toggleIndicator = useCallback((id: string) => {
    setIndicators(prev => prev.map(ind => 
      ind.id === id ? { ...ind, enabled: !ind.enabled } : ind
    ));
  }, []);

  /* ── Derived data for candles ── */
  const tfTicks = useMemo(() => {
    // Calculate ticks needed for candles
    const seconds: Record<string, number> = {
      '1m':60,'3m':180,'5m':300,'15m':900,'30m':1800,'1h':3600,'4h':14400,'12h':43200,'1d':86400,
    };
    const interval = seconds[timeframe] || 60;
    // Estimate ticks needed: 1 candle per interval, need candleCount candles
    const estimatedTicks = candleCount * 2; // Rough estimate
    return Math.min(estimatedTicks, prices.length);
  }, [timeframe, candleCount, prices.length]);
  
  const tfPrices = useMemo(() => prices.slice(-tfTicks), [prices, tfTicks]);
  const tfTimes = useMemo(() => times.slice(-tfTicks), [times, tfTicks]);
  const candles = useMemo(() => buildCandles(tfPrices, tfTimes, timeframe), [tfPrices, tfTimes, timeframe]);
  const currentPrice = prices[prices.length - 1] || 0;
  const lastDigit = getLastDigit(currentPrice);
  
  // Digit analysis uses independent tick data
  const { frequency, percentages, mostCommon, leastCommon } = digitAnalysisData;
  const evenCount = useMemo(() => {
    const ticks = getTickHistory(symbol).slice(-tickRange);
    return ticks.filter(d => d % 2 === 0).length;
  }, [symbol, tickRange]);
  const oddCount = useMemo(() => {
    const ticks = getTickHistory(symbol).slice(-tickRange);
    return ticks.length - evenCount;
  }, [symbol, tickRange, evenCount]);
  const evenPct = useMemo(() => {
    const ticks = getTickHistory(symbol).slice(-tickRange);
    return ticks.length > 0 ? (evenCount / ticks.length * 100) : 50;
  }, [symbol, tickRange, evenCount]);
  const oddPct = 100 - evenPct;
  const overCount = useMemo(() => {
    const ticks = getTickHistory(symbol).slice(-tickRange);
    return ticks.filter(d => d > 4).length;
  }, [symbol, tickRange]);
  const underCount = useMemo(() => {
    const ticks = getTickHistory(symbol).slice(-tickRange);
    return ticks.length - overCount;
  }, [symbol, tickRange, overCount]);
  const overPct = useMemo(() => {
    const ticks = getTickHistory(symbol).slice(-tickRange);
    return ticks.length > 0 ? (overCount / ticks.length * 100) : 50;
  }, [symbol, tickRange, overCount]);
  const underPct = 100 - overPct;

  // Indicator calculations
  const bb = useMemo(() => calculateBollingerBands(tfPrices, 20), [tfPrices]);
  const ema50 = useMemo(() => calcEMA(tfPrices, 50), [tfPrices]);
  const sma20 = useMemo(() => calcSMA(tfPrices, 20), [tfPrices]);
  const { support, resistance } = useMemo(() => calcSR(tfPrices), [tfPrices]);
  const rsi = useMemo(() => calculateRSI(tfPrices, 14), [tfPrices]);
  const macd = useMemo(() => calcMACDFull(tfPrices), [tfPrices]);
  const psar = useMemo(() => {
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    return calcPSAR(highs, lows);
  }, [candles]);

  // Get analysis signals from indicators
  const getIndicatorSignals = useCallback(() => {
    const signals: { indicator: string; signal: 'OVER' | 'UNDER' | 'NEUTRAL'; confidence: number }[] = [];
    
    indicators.forEach(indicator => {
      if (!indicator.enabled) return;
      
      switch (indicator.type) {
        case 'RSI':
          if (rsi > 70) signals.push({ indicator: 'RSI', signal: 'UNDER', confidence: 80 });
          else if (rsi < 30) signals.push({ indicator: 'RSI', signal: 'OVER', confidence: 80 });
          break;
          
        case 'BB':
          if (currentPrice > bb.upper) signals.push({ indicator: 'BB', signal: 'UNDER', confidence: 75 });
          else if (currentPrice < bb.lower) signals.push({ indicator: 'BB', signal: 'OVER', confidence: 75 });
          break;
          
        case 'MA':
          if (currentPrice > ema50 && currentPrice > sma20) signals.push({ indicator: 'MA', signal: 'OVER', confidence: 70 });
          else if (currentPrice < ema50 && currentPrice < sma20) signals.push({ indicator: 'MA', signal: 'UNDER', confidence: 70 });
          break;
          
        case 'MACD':
          if (macd.macd > macd.signal) signals.push({ indicator: 'MACD', signal: 'OVER', confidence: 65 });
          else if (macd.macd < macd.signal) signals.push({ indicator: 'MACD', signal: 'UNDER', confidence: 65 });
          break;
          
        case 'PSAR':
          if (psar.trend === 'bullish') signals.push({ indicator: 'PSAR', signal: 'OVER', confidence: 60 });
          else signals.push({ indicator: 'PSAR', signal: 'UNDER', confidence: 60 });
          break;
      }
    });
    
    return signals;
  }, [indicators, rsi, currentPrice, bb, ema50, sma20, macd, psar]);

  // Aggregated signal
  const aggregatedSignal = useMemo(() => {
    const signals = getIndicatorSignals();
    const overCount = signals.filter(s => s.signal === 'OVER').length;
    const underCount = signals.filter(s => s.signal === 'UNDER').length;
    
    if (overCount > underCount) return { direction: 'OVER' as const, confidence: (overCount / signals.length) * 100 };
    if (underCount > overCount) return { direction: 'UNDER' as const, confidence: (underCount / signals.length) * 100 };
    return { direction: 'NEUTRAL' as const, confidence: 50 };
  }, [getIndicatorSignals]);

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
    const bestPct = Math.max(...Object.values(percentages));
    return { digit: mostCommon, confidence: Math.min(90, Math.round(bestPct * 3)) };
  }, [percentages, mostCommon]);

  // Strategy Helpers
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

  /* ── Canvas Chart with indicator rendering ── */
  const candleEndIndices = useMemo(() => mapCandlesToPriceIndices(tfPrices, tfTimes, timeframe), [tfPrices, tfTimes, timeframe]);
  const emaSeries = useMemo(() => calcEMASeries(tfPrices, 50), [tfPrices]);
  const smaSeries = useMemo(() => calcSMASeries(tfPrices, 20), [tfPrices]);
  const bbSeries = useMemo(() => calcBBSeries(tfPrices, 20, 2), [tfPrices]);
  const rsiSeries = useMemo(() => calcRSISeries(tfPrices, 14), [tfPrices]);
  const psarSeries = useMemo(() => {
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const { sarValues, trends } = calcPSARSeries(highs, lows);
    return { sarValues, trends };
  }, [candles]);

  // Canvas mouse handlers for zoom & pan
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !showChart) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        setCandleWidth(prev => Math.max(2, Math.min(20, prev - Math.sign(e.deltaY))));
      } else {
        const delta = Math.sign(e.deltaY) * Math.max(3, Math.floor(candles.length * 0.03));
        setScrollOffset(prev => Math.max(0, Math.min(candles.length - 10, prev + delta)));
      }
    };

    const onMouseDown = (e: MouseEvent) => {
      const canvasRect = canvas.getBoundingClientRect();
      const pAxisX = canvasRect.width - 70;
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
      if (isPriceAxisDragging.current) {
        const dy = priceAxisStartY.current - e.clientY;
        const newWidth = Math.max(2, Math.min(24, priceAxisStartWidth.current + Math.round(dy / 8)));
        setCandleWidth(newWidth);
        return;
      }
      if (!isDragging.current) return;
      const dx = dragStartX.current - e.clientX;
      const candlesPerPx = 1 / (candleWidth + 1);
      const delta = Math.round(dx * candlesPerPx);
      setScrollOffset(Math.max(0, Math.min(candles.length - 10, dragStartOffset.current + delta)));
    };

    const onMouseUp = () => {
      isDragging.current = false;
      isPriceAxisDragging.current = false;
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
  }, [candles.length, scrollOffset, candleWidth, showChart]);

  // Chart rendering with indicators
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
    const rsiH = indicators.some(i => i.enabled && i.type === 'RSI') ? 80 : 0;
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
    
    // Add indicator values to price range if enabled
    indicators.forEach(indicator => {
      if (!indicator.enabled) return;
      for (let i = 0; i < visibleCandles.length; i++) {
        const idx = visibleEndIndices[i];
        if (idx === undefined) continue;
        
        switch (indicator.type) {
          case 'BB':
            const u = idx < bbSeries.upper.length ? bbSeries.upper[idx] : null;
            const l = idx < bbSeries.lower.length ? bbSeries.lower[idx] : null;
            if (u !== null) allPrices.push(u);
            if (l !== null) allPrices.push(l);
            break;
          case 'MA':
            const e = idx < emaSeries.length ? emaSeries[idx] : null;
            const s = idx < smaSeries.length ? smaSeries[idx] : null;
            if (e !== null) allPrices.push(e);
            if (s !== null) allPrices.push(s);
            break;
          case 'PSAR':
            const psar = idx < psarSeries.sarValues.length ? psarSeries.sarValues[idx] : null;
            if (psar !== null) allPrices.push(psar);
            break;
        }
      }
    });
    
    const rawMin = Math.min(...allPrices);
    const rawMax = Math.max(...allPrices);
    const priceRange = rawMax - rawMin;
    const padding = priceRange * 0.12 || 0.001;
    const minP = rawMin - padding;
    const maxP = rawMax + padding;
    const range = maxP - minP || 1;
    const chartPadTop = 20;
    const chartPadBot = 20;
    const drawH = H - chartPadTop - chartPadBot;
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
    for (let i = 0; i < 10; i++) {
      const x = (chartW / 10) * i;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
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

    // Draw enabled indicators
    indicators.forEach(indicator => {
      if (!indicator.enabled) return;
      
      switch (indicator.type) {
        case 'BB':
          ctx.fillStyle = 'rgba(188, 140, 255, 0.06)';
          const bbUpperPoints: {x: number, y: number}[] = [];
          const bbLowerPoints: {x: number, y: number}[] = [];
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
            for (let i = bbLowerPoints.length - 1; i >= 0; i--) ctx.lineTo(bbLowerPoints[i].x, bbLowerPoints[i].y);
            ctx.closePath();
            ctx.fill();
          }
          drawLine(bbSeries.upper, '#BC8CFF', 1.2, [5, 3]);
          drawLine(bbSeries.middle, '#BC8CFF', 1.5);
          drawLine(bbSeries.lower, '#BC8CFF', 1.2, [5, 3]);
          break;
          
        case 'MA':
          drawLine(emaSeries, '#2F81F7', 1.5);
          drawLine(smaSeries, '#E6B422', 1.5);
          break;
          
        case 'PSAR':
          ctx.fillStyle = '#FF6B6B';
          for (let i = 0; i < visibleCandles.length; i++) {
            const idx = visibleEndIndices[i];
            if (idx === undefined) continue;
            const psar = idx < psarSeries.sarValues.length ? psarSeries.sarValues[idx] : null;
            if (psar === null) continue;
            const x = offsetX + i * totalCandleW + candleWidth / 2;
            const y = toY(psar);
            ctx.beginPath();
            ctx.arc(x, y, 2, 0, Math.PI * 2);
            ctx.fill();
          }
          break;
      }
    });

    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = '#3FB950';
    ctx.lineWidth = 1.5;
    const supY = toY(support);
    ctx.beginPath(); ctx.moveTo(0, supY); ctx.lineTo(chartW, supY); ctx.stroke();

    ctx.strokeStyle = '#F85149';
    const resY = toY(resistance);
    ctx.beginPath(); ctx.moveTo(0, resY); ctx.lineTo(chartW, resY); ctx.stroke();
    ctx.setLineDash([]);

    ctx.font = '9px JetBrains Mono, monospace';
    ctx.fillStyle = '#3FB950';
    ctx.fillRect(chartW, supY - 7, priceAxisW, 14);
    ctx.fillStyle = '#0D1117';
    ctx.fillText(`S ${support.toFixed(4)}`, chartW + 2, supY + 3);
    ctx.fillStyle = '#F85149';
    ctx.fillRect(chartW, resY - 7, priceAxisW, 14);
    ctx.fillStyle = '#0D1117';
    ctx.fillText(`R ${resistance.toFixed(4)}`, chartW + 2, resY + 3);

    // Draw candles with BLUE/RED colors
    for (let i = 0; i < visibleCandles.length; i++) {
      const c = visibleCandles[i];
      const x = offsetX + i * totalCandleW;
      const isGreen = c.close >= c.open;
      const color = isGreen ? '#3B82F6' : '#EF4444'; // BLUE for bullish, RED for bearish

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
    const legends = [
      { label: 'Support', color: '#3FB950' },
      { label: 'Resistance', color: '#F85149' },
    ];
    
    // Add indicator legends
    indicators.forEach(indicator => {
      if (!indicator.enabled) return;
      switch (indicator.type) {
        case 'BB': legends.push({ label: 'BB(20,2)', color: '#BC8CFF' }); break;
        case 'MA': legends.push({ label: 'SMA/EMA', color: '#E6B422' }); break;
        case 'PSAR': legends.push({ label: 'PSAR', color: '#FF6B6B' }); break;
      }
    });
    
    let lx = 8;
    legends.forEach(l => {
      ctx.fillStyle = l.color;
      ctx.fillRect(lx, 6, 10, 3);
      ctx.fillText(l.label, lx + 14, 12);
      lx += ctx.measureText(l.label).width + 24;
    });

    ctx.fillStyle = '#484F58';
    ctx.font = '9px JetBrains Mono, monospace';
    ctx.fillText(`${visibleCandles.length} candles | Scroll: wheel | Zoom: Ctrl+wheel | Drag to pan`, 8, H - 6);

    // Draw RSI if enabled
    if (indicators.some(i => i.enabled && i.type === 'RSI')) {
      const rsiTop = H + 8;
      ctx.fillStyle = '#161B22';
      ctx.fillRect(0, rsiTop, W, rsiH);
      ctx.strokeStyle = '#21262D';
      ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(0, rsiTop); ctx.lineTo(W, rsiTop); ctx.stroke();

      const rsiToY = (v: number) => rsiTop + 4 + ((100 - v) / 100) * (rsiH - 8);
      ctx.font = '8px JetBrains Mono, monospace';
      [30, 50, 70].forEach(level => {
        const y = rsiToY(level);
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = level === 50 ? '#484F58' : (level === 70 ? '#F8514950' : '#3FB95050');
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(chartW, y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#484F58';
        ctx.fillText(String(level), chartW + 4, y + 3);
      });

      ctx.fillStyle = '#8B949E';
      ctx.font = '9px JetBrains Mono, monospace';
      ctx.fillText('RSI(14)', 4, rsiTop + 12);

      ctx.strokeStyle = '#D29922';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      let rsiStarted = false;
      for (let i = 0; i < visibleCandles.length; i++) {
        const idx = visibleEndIndices[i];
        if (idx === undefined) continue;
        const v = idx < rsiSeries.length ? rsiSeries[idx] : null;
        if (v === null) continue;
        const x = offsetX + i * totalCandleW + candleWidth / 2;
        const y = rsiToY(v);
        if (!rsiStarted) { ctx.moveTo(x, y); rsiStarted = true; }
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      const lastRsi = rsi;
      const rsiColor = lastRsi > 70 ? '#F85149' : lastRsi < 30 ? '#3FB950' : '#D29922';
      ctx.fillStyle = rsiColor;
      ctx.fillRect(chartW, rsiToY(lastRsi) - 7, priceAxisW, 14);
      ctx.fillStyle = '#0D1117';
      ctx.font = 'bold 9px JetBrains Mono, monospace';
      ctx.fillText(lastRsi.toFixed(1), chartW + 2, rsiToY(lastRsi) + 3);

      ctx.fillStyle = 'rgba(248, 81, 73, 0.04)';
      ctx.fillRect(0, rsiTop, chartW, rsiToY(70) - rsiTop);
      ctx.fillStyle = 'rgba(63, 185, 80, 0.04)';
      ctx.fillRect(0, rsiToY(30), chartW, rsiTop + rsiH - rsiToY(30));
    }

  }, [candles, bb, ema50, sma20, support, resistance, currentPrice, candleEndIndices, emaSeries, smaSeries, bbSeries, rsiSeries, rsi, candleWidth, scrollOffset, showChart, indicators, psarSeries]);

  const filteredMarkets = groupFilter === 'all' ? ALL_MARKETS : ALL_MARKETS.filter(m => m.group === groupFilter);
  const marketName = ALL_MARKETS.find(m => m.symbol === symbol)?.name || symbol;

  // Voice AI announcements
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
      const resultDigit = getLastDigit(result.price || currentPrice);
      setTradeHistory(prev => prev.map(t => t.id === contractId ? { ...t, profit: result.profit, status: result.status, resultDigit } : t));
      if (result.status === 'won') { toast.success(`✅ WON +$${result.profit.toFixed(2)} | Digit: ${resultDigit}`); if (voiceEnabled) speak(`Trade won. Profit ${result.profit.toFixed(2)} dollars`); }
      else { toast.error(`❌ LOST -$${Math.abs(result.profit).toFixed(2)} | Digit: ${resultDigit}`); if (voiceEnabled) speak(`Trade lost. Loss ${Math.abs(result.profit).toFixed(2)} dollars`); }
    } catch (err: any) { toast.error(`Trade failed: ${err.message}`); }
    finally { setIsTrading(false); }
  };

  // Auto Bot Logic
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

  // Bot stats
  const totalTrades = tradeHistory.filter(t => t.status !== 'open').length;
  const wins = tradeHistory.filter(t => t.status === 'won').length;
  const losses = tradeHistory.filter(t => t.status === 'lost').length;
  const totalProfit = tradeHistory.reduce((s, t) => s + t.profit, 0);
  const winRate = totalTrades > 0 ? (wins / totalTrades * 100) : 0;

  return (
    <div className="space-y-4 max-w-[1920px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-primary" /> Trading Chart
          </h1>
          <p className="text-xs text-muted-foreground">{marketName} • {timeframe} • {candles.length} candles</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={handleManualRefresh}
            variant="outline"
            size="sm"
            className="gap-1"
            disabled={isLoading}
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button
            onClick={() => setShowChart(!showChart)}
            variant="outline"
            size="sm"
            className="gap-1"
          >
            {showChart ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            {showChart ? "Hide Chart" : "Show Chart"}
          </Button>
          <Badge className="font-mono text-sm" variant="outline">
            {currentPrice.toFixed(4)}
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

      {/* Timeframe & Candle Controls */}
      <div className="flex flex-wrap gap-2 justify-between items-center">
        <div className="flex flex-wrap gap-1">
          {TIMEFRAMES.map(tf => (
            <Button key={tf} size="sm" variant={timeframe === tf ? 'default' : 'outline'}
              className={`h-7 text-xs px-3 ${timeframe === tf ? 'bg-primary text-primary-foreground' : ''}`}
              onClick={() => setTimeframe(tf)}>
              {tf}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <label className="text-[10px] text-muted-foreground">Candles:</label>
          <Select value={String(candleCount)} onValueChange={v => setCandleCount(Math.min(Math.max(parseInt(v), CANDLE_CONFIG.minCandles), CANDLE_CONFIG.maxCandles))}>
            <SelectTrigger className="h-7 text-xs w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[1000, 2000, 3000, 4000, 5000].map(c => (
                <SelectItem key={c} value={String(c)}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        {/* ═══ LEFT: Chart + Info ═══ */}
        <div className="xl:col-span-8 space-y-3">
          {/* Candlestick Chart - Hideable */}
          <AnimatePresence mode="wait">
            {showChart && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.3 }}
                className="overflow-hidden"
              >
                <div className="bg-[#0D1117] border border-[#30363D] rounded-xl overflow-hidden">
                  <canvas ref={canvasRef} className="w-full" style={{ height: 520, cursor: 'crosshair' }} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Price Info Panel */}
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

          {/* Indicator Management Panel */}
          <div className="bg-card border border-border rounded-xl p-3 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-foreground flex items-center gap-1">
                <Settings className="w-3.5 h-3.5 text-primary" /> Indicators
              </h3>
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-[10px] gap-1"
                onClick={() => setShowIndicatorPanel(!showIndicatorPanel)}
              >
                <Plus className="w-3 h-3" />
                Add Indicator
              </Button>
            </div>
            
            {showIndicatorPanel && (
              <div className="flex flex-wrap gap-2 p-2 bg-muted/30 rounded-lg">
                {['RSI', 'BB', 'MA', 'MACD', 'PSAR'].map(type => (
                  <Button
                    key={type}
                    size="sm"
                    variant="outline"
                    className="h-6 text-[9px]"
                    onClick={() => addIndicator(type as IndicatorType)}
                    disabled={indicators.some(i => i.type === type)}
                  >
                    + {type}
                  </Button>
                ))}
              </div>
            )}
            
            {indicators.length > 0 && (
              <div className="space-y-1.5">
                {indicators.map(indicator => (
                  <div key={indicator.id} className="flex items-center justify-between p-1.5 bg-muted/20 rounded-lg">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={indicator.enabled}
                        onCheckedChange={() => toggleIndicator(indicator.id)}
                        className="scale-75"
                      />
                      <span className="text-[10px] font-mono">{indicator.type}</span>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-5 w-5 p-0 text-muted-foreground hover:text-loss"
                      onClick={() => removeIndicator(indicator.id)}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            
            {aggregatedSignal.direction !== 'NEUTRAL' && indicators.length > 0 && (
              <div className={`p-2 rounded-lg text-center ${aggregatedSignal.direction === 'OVER' ? 'bg-profit/20 text-profit' : 'bg-loss/20 text-loss'}`}>
                <div className="text-[9px] font-semibold">Aggregated Signal: {aggregatedSignal.direction}</div>
                <div className="text-[8px] text-muted-foreground">Confidence: {aggregatedSignal.confidence.toFixed(0)}%</div>
              </div>
            )}
          </div>

          {/* Digit Analysis with Independent Tick Selector */}
          <div className="bg-card border border-border rounded-xl p-3 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-foreground">Digit Analysis</h3>
              <div className="flex items-center gap-2">
                <label className="text-[9px] text-muted-foreground">Tick Range:</label>
                <Select value={String(tickRange)} onValueChange={v => setTickRange(parseInt(v))}>
                  <SelectTrigger className="h-7 text-xs w-20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TICK_RANGES.map(r => (
                      <SelectItem key={r} value={String(r)}>{r}</SelectItem>
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
                const pct = percentages[d] || 0;
                const count = frequency[d] || 0;
                const isHot = pct > 12;
                const isWarm = pct > 9;
                const isBestMatch = d === mostCommon;
                const isBestDiffer = d === leastCommon;
                return (
                  <button key={d}
                    onClick={() => { setSelectedDigit(d); setPrediction(String(d)); }}
                    className={`relative rounded-lg p-2 text-center transition-all border cursor-pointer hover:ring-2 hover:ring-primary ${
                      selectedDigit === d ? 'ring-2 ring-primary' : ''
                    } ${isHot ? 'bg-loss/10 border-loss/40 text-loss' :
                      isWarm ? 'bg-warning/10 border-warning/40 text-warning' :
                      'bg-card border-border text-primary'}`}
                  >
                    <div className="font-mono text-lg font-bold">{d}</div>
                    <div className="text-[8px]">{count} ({pct.toFixed(1)}%)</div>
                    <div className="h-1 bg-muted rounded-full mt-1">
                      <div className={`h-full rounded-full ${isHot ? 'bg-loss' : isWarm ? 'bg-warning' : 'bg-primary'}`} style={{ width: `${Math.min(100, pct * 5)}%` }} />
                    </div>
                    {isBestMatch && (
                      <Badge className="absolute -top-1 -right-1 text-[7px] px-1 bg-profit text-profit-foreground">Match Digit</Badge>
                    )}
                    {isBestDiffer && (
                      <Badge className="absolute -top-1 -left-1 text-[7px] px-1 bg-loss text-loss-foreground">Differ</Badge>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Strategic Recommendations */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div className="bg-card border border-profit/30 rounded-lg p-2">
              <div className="text-[9px] text-muted-foreground">Best Match</div>
              <div className="font-mono text-lg font-bold text-profit">{mostCommon}</div>
              <div className="text-[8px] text-muted-foreground">{percentages[mostCommon]?.toFixed(1)}% frequency</div>
            </div>
            <div className="bg-card border border-loss/30 rounded-lg p-2">
              <div className="text-[9px] text-muted-foreground">Best Differ</div>
              <div className="font-mono text-lg font-bold text-loss">{leastCommon}</div>
              <div className="text-[8px] text-muted-foreground">{percentages[leastCommon]?.toFixed(1)}% frequency</div>
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

        {/* ═══ RIGHT: Signals + Trade + Tech ═══ */}
        <div className="xl:col-span-4 space-y-3">
          {/* Voice AI Toggle */}
          <div className="bg-card border border-primary/30 rounded-xl p-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-foreground flex items-center gap-1">
                <Zap className="w-3.5 h-3.5 text-primary" /> AI Voice Signals
              </h3>
              <Button
                size="sm"
                variant={voiceEnabled ? 'default' : 'outline'}
                className="h-7 text-[10px] gap-1"
                onClick={() => {
                  setVoiceEnabled(!voiceEnabled);
                  if (!voiceEnabled) {
                    const u = new SpeechSynthesisUtterance('Voice signals enabled');
                    u.rate = 1.1;
                    window.speechSynthesis?.speak(u);
                  } else {
                    window.speechSynthesis?.cancel();
                  }
                }}
              >
                {voiceEnabled ? <Volume2 className="w-3 h-3" /> : <VolumeX className="w-3 h-3" />}
                {voiceEnabled ? 'ON' : 'OFF'}
              </Button>
            </div>
            {voiceEnabled && (
              <p className="text-[9px] text-muted-foreground mt-1">🔊 AI will announce trade results</p>
            )}
          </div>

          {/* Trading Signals */}
          <div className="grid grid-cols-2 gap-2">
            {/* Rise/Fall */}
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
                <div className={`h-full rounded-full ${riseSignal.direction === 'Rise' ? 'bg-profit' : 'bg-loss'}`}
                  style={{ width: `${riseSignal.confidence}%` }} />
              </div>
              <div className="text-[8px] text-right text-muted-foreground mt-0.5">{riseSignal.confidence}%</div>
            </div>

            {/* Even/Odd */}
            <div className="bg-card border border-border rounded-xl p-3">
              <div className="flex items-center gap-1 mb-1">
                <Activity className="w-3.5 h-3.5 text-primary" />
                <span className="text-[10px] font-semibold">Even/Odd</span>
              </div>
              <div className={`font-mono text-sm font-bold ${eoSignal.direction === 'Even' ? 'text-[#3FB950]' : 'text-[#D29922]'}`}>
                {eoSignal.direction}
              </div>
              <div className="text-[8px] text-muted-foreground mb-1">{evenPct.toFixed(1)}% even</div>
              <div className="h-1.5 bg-muted rounded-full">
                <div className={`h-full rounded-full ${eoSignal.direction === 'Even' ? 'bg-[#3FB950]' : 'bg-[#D29922]'}`}
                  style={{ width: `${eoSignal.confidence}%` }} />
              </div>
              <div className="text-[8px] text-right text-muted-foreground mt-0.5">{eoSignal.confidence}%</div>
            </div>

            {/* Over/Under */}
            <div className="bg-card border border-border rounded-xl p-3">
              <div className="flex items-center gap-1 mb-1">
                <ArrowUp className="w-3.5 h-3.5 text-primary" />
                <span className="text-[10px] font-semibold">Over/Under</span>
              </div>
              <div className={`font-mono text-sm font-bold ${ouSignal.direction === 'Over' ? 'text-primary' : 'text-[#D29922]'}`}>
                {ouSignal.direction}
              </div>
              <div className="text-[8px] text-muted-foreground mb-1">{overPct.toFixed(1)}% over</div>
              <div className="h-1.5 bg-muted rounded-full">
                <div className={`h-full rounded-full ${ouSignal.direction === 'Over' ? 'bg-primary' : 'bg-[#D29922]'}`}
                  style={{ width: `${ouSignal.confidence}%` }} />
              </div>
              <div className="text-[8px] text-right text-muted-foreground mt-0.5">{ouSignal.confidence}%</div>
            </div>

            {/* Match */}
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
              <div className="text-[8px] text-right text-muted-foreground mt-0.5">{matchSignal.confidence}%</div>
            </div>
          </div>

          {/* Last 26 Digits (from independent tick system) */}
          <div className="bg-card border border-border rounded-xl p-3">
            <h3 className="text-xs font-semibold text-foreground mb-2">Last 26 Digits (from {tickRange} ticks)</h3>
            <div className="flex gap-1 flex-wrap justify-center">
              {getTickHistory(symbol).slice(-26).map((d, i) => {
                const isLast = i === 25;
                const isEven = d % 2 === 0;
                return (
                  <motion.div
                    key={i}
                    initial={isLast ? { scale: 0.8 } : {}}
                    animate={isLast ? { scale: [1, 1.1, 1] } : {}}
                    transition={isLast ? { duration: 1, repeat: Infinity } : {}}
                    className={`w-7 h-9 rounded-lg flex items-center justify-center font-mono font-bold text-xs border-2 transition-all ${
                      isLast ? 'w-9 h-11 text-sm ring-2 ring-primary' : ''
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

          {/* ═══ AUTO BOT PANEL with Strategy ═══ */}
          <div className={`bg-card border rounded-xl p-3 space-y-2 ${botRunning ? 'border-profit glow-profit' : 'border-border'}`}>
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-foreground flex items-center gap-1">
                <Zap className="w-3.5 h-3.5 text-primary" /> Ramzfx Speed Bot 
              </h3>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant={turboMode ? 'default' : 'outline'}
                  className={`h-6 text-[9px] px-2 ${turboMode ? 'bg-profit hover:bg-profit/90 text-profit-foreground animate-pulse' : ''}`}
                  onClick={() => setTurboMode(!turboMode)}
                  disabled={botRunning}
                >
                  <Zap className="w-3 h-3 mr-0.5" />
                  {turboMode ? '⚡ TURBO' : 'Turbo'}
                </Button>
                {botRunning && (
                  <motion.div animate={{ opacity: [0.4, 1, 0.4] }} transition={{ repeat: Infinity, duration: 1.5 }}>
                    <Badge className="text-[8px] bg-profit text-profit-foreground">RUNNING</Badge>
                  </motion.div>
                )}
              </div>
            </div>

            {/* Market Selector for Bot */}
            <div>
              <label className="text-[9px] text-muted-foreground">Market</label>
              <Select value={botConfig.botSymbol} onValueChange={handleBotSymbolChange} disabled={botRunning}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  {ALL_MARKETS.map(m => (
                    <SelectItem key={m.symbol} value={m.symbol}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[8px] text-muted-foreground mt-0.5">Chart auto-syncs with selected market</p>
            </div>

            <Select value={botConfig.contractType} onValueChange={v => setBotConfig(p => ({ ...p, contractType: v }))} disabled={botRunning}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{CONTRACT_TYPES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
            </Select>

            {['DIGITMATCH','DIGITDIFF','DIGITOVER','DIGITUNDER'].includes(botConfig.contractType) && (
              <div>
                <label className="text-[9px] text-muted-foreground">Prediction (0-9)</label>
                <div className="grid grid-cols-5 gap-1">
                  {Array.from({ length: 10 }, (_, i) => (
                    <button key={i} disabled={botRunning} onClick={() => setBotConfig(p => ({ ...p, prediction: String(i) }))}
                      className={`h-6 rounded text-[10px] font-mono font-bold transition-all ${
                        botConfig.prediction === String(i) ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground hover:bg-secondary'
                      }`}>{i}</button>
                  ))}
                </div>
              </div>
            )}

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
                    <Button
                      size="sm"
                      variant={strategyMode === 'pattern' ? 'default' : 'outline'}
                      className="text-[9px] h-6 px-2 flex-1"
                      onClick={() => setStrategyMode('pattern')}
                      disabled={botRunning}
                    >
                      Pattern (E/O)
                    </Button>
                    <Button
                      size="sm"
                      variant={strategyMode === 'digit' ? 'default' : 'outline'}
                      className="text-[9px] h-6 px-2 flex-1"
                      onClick={() => setStrategyMode('digit')}
                      disabled={botRunning}
                    >
                      Digit Condition 
                    </Button>
                  </div>

                  {strategyMode === 'pattern' ? (
                    <div>
                      <label className="text-[8px] text-muted-foreground">Pattern (E=Even, O=Odd)</label>
                      <Textarea
                        placeholder="e.g., EEEOE or OOEEO"
                        value={patternInput}
                        onChange={e => setPatternInput(e.target.value.toUpperCase().replace(/[^EO]/g, ''))}
                        disabled={botRunning}
                        className="h-12 text-[10px] font-mono min-h-0 mt-1"
                      />
                      <div className={`text-[9px] font-mono mt-1 ${patternValid ? 'text-profit' : 'text-loss'}`}>
                        {cleanPattern.length === 0 ? 'Enter pattern (min 2 characters)' :
                          patternValid ? `✓ Pattern: ${cleanPattern}` : `✗ Need at least 2 characters (E/O)`}
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-1">
                      <div>
                        <label className="text-[8px] text-muted-foreground">If last </label>
                        <Input type="number" min="1" max="50" value={digitWindow}
                          onChange={e => setDigitWindow(e.target.value)} disabled={botRunning}
                          className="h-7 text-[10px]" />
                      </div>
                      <div>
                        <label className="text-[8px] text-muted-foreground">ticks are </label>
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
                          onChange={e => setDigitCompare(e.target.value)} disabled={botRunning}
                          className="h-7 text-[10px]" />
                      </div>
                    </div>
                  )}

                  <div className="text-[8px] text-muted-foreground text-center py-1">
                    Bot will wait for {strategyMode === 'pattern' ? 'pattern match' : 'digit condition'} before each trade
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              <div>
                <label className="text-[8px] text-muted-foreground">Stop Loss</label>
                <Input type="number" value={botConfig.stopLoss} onChange={e => setBotConfig(p => ({ ...p, stopLoss: e.target.value }))}
                  disabled={botRunning} className="h-7 text-xs" />
              </div>
              <div>
                <label className="text-[8px] text-muted-foreground">Take Profit</label>
                <Input type="number" value={botConfig.takeProfit} onChange={e => setBotConfig(p => ({ ...p, takeProfit: e.target.value }))}
                  disabled={botRunning} className="h-7 text-xs" />
              </div>
              <div>
                <label className="text-[8px] text-muted-foreground">Max Trades</label>
                <Input type="number" value={botConfig.maxTrades} onChange={e => setBotConfig(p => ({ ...p, maxTrades: e.target.value }))}
                  disabled={botRunning} className="h-7 text-xs" />
              </div>
            </div>

            {/* Bot live stats */}
            {botRunning && (
              <div className="grid grid-cols-3 gap-1 text-center">
                <div className="bg-muted/30 rounded p-1">
                  <div className="text-[7px] text-muted-foreground">Stake</div>
                  <div className="font-mono text-[10px] font-bold text-foreground">${botStats.currentStake.toFixed(2)}</div>
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

            {/* Start/Pause/Stop buttons */}
            <div className="flex gap-2">
              {!botRunning ? (
                <Button onClick={startBot} disabled={!isAuthorized} className="flex-1 h-10 text-xs font-bold bg-profit hover:bg-profit/90 text-profit-foreground">
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

          {/* Bot Progress */}
          <div className="bg-card border border-border rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-foreground flex items-center gap-1">
                <Trophy className="w-3.5 h-3.5 text-primary" /> Trade Progress
              </h3>
              {tradeHistory.length > 0 && (
                <Button variant="ghost" size="sm" className="h-6 text-[9px] text-muted-foreground hover:text-loss"
                  onClick={() => { setTradeHistory([]); setBotStats({ trades: 0, wins: 0, losses: 0, pnl: 0, currentStake: 0, consecutiveLosses: 0 }); }}>
                  Clear
                </Button>
              )}
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              <div className="bg-muted/30 rounded-lg p-1.5 text-center">
                <div className="text-[8px] text-muted-foreground">Trades</div>
                <div className="font-mono text-sm font-bold text-foreground">{totalTrades}</div>
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

            {/* Trade History */}
            {tradeHistory.length > 0 && (
              <div className="max-h-40 overflow-auto space-y-1">
                {tradeHistory.slice(0, 10).map(t => (
                  <div key={t.id} className={`flex items-center justify-between text-[9px] p-1.5 rounded-lg border ${
                    t.status === 'open' ? 'border-primary/30 bg-primary/5' :
                    t.status === 'won' ? 'border-profit/30 bg-profit/5' :
                    'border-loss/30 bg-loss/5'
                  }`}>
                    <div className="flex items-center gap-1.5">
                      <span className={`font-bold ${t.status === 'won' ? 'text-profit' : t.status === 'lost' ? 'text-loss' : 'text-primary'}`}>
                        {t.status === 'open' ? '⏳' : t.status === 'won' ? '✅' : '❌'}
                      </span>
                      <span className="font-mono text-muted-foreground">{t.type}</span>
                      <span className="text-muted-foreground">${t.stake.toFixed(2)}</span>
                      {t.resultDigit !== undefined && (
                        <Badge variant="outline" className={`text-[8px] px-1 ${t.status === 'won' ? 'border-profit text-profit' : 'border-loss text-loss'}`}>
                          {t.resultDigit}
                        </Badge>
                      )}
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
                <span className="text-muted-foreground">RSI (14)</span>
                <span className={`font-mono font-bold ${rsi > 70 ? 'text-loss' : rsi < 30 ? 'text-profit' : 'text-foreground'}`}>
                  {rsi.toFixed(1)} {rsi > 70 ? '🔴 Overbought' : rsi < 30 ? '🟢 Oversold' : '⚪ Neutral'}
                </span>
              </div>
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-muted-foreground">MACD</span>
                <span className={`font-mono font-bold ${macd.macd > 0 ? 'text-profit' : 'text-loss'}`}>
                  {macd.macd.toFixed(4)} {macd.macd > 0 ? '📈 Bullish' : '📉 Bearish'}
                </span>
              </div>
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-muted-foreground">EMA 50</span>
                <span className={`font-mono font-bold ${currentPrice > ema50 ? 'text-profit' : 'text-loss'}`}>
                  {currentPrice > ema50 ? '📈 Above' : '📉 Below'} ({ema50.toFixed(2)})
                </span>
              </div>
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-muted-foreground">BB Position</span>
                <span className="font-mono font-bold text-[#BC8CFF]">{((currentPrice - bb.lower) / (bb.upper - bb.lower) * 100).toFixed(1)}%</span>
              </div>
              <div className="h-1.5 bg-muted rounded-full">
                <div className="h-full bg-[#BC8CFF] rounded-full" style={{ width: `${Math.min(100, Math.max(0, (currentPrice - bb.lower) / (bb.upper - bb.lower) * 100))}%` }} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
