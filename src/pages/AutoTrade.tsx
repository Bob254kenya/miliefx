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
  LineChart, Move, Square, Circle, Triangle, TrendingUp as LongPosition, TrendingDown as ShortPosition, Eraser
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
];

const GROUPS = [
  { value: 'all', label: 'All' },
  { value: 'vol1s', label: 'Vol 1s' },
  { value: 'vol', label: 'Vol' },
  { value: 'jump', label: 'Jump' },
];

// CONSTANT: Always load exactly 1000 candles for ALL timeframes
const CONSTANT_CANDLE_COUNT = 1000;

const TIMEFRAMES = ['1m','3m','5m','15m','30m','1h','4h','12h','1d'];
const TF_SECONDS: Record<string,number> = {
  '1m':60,'3m':180,'5m':300,'15m':900,'30m':1800,'1h':3600,'4h':14400,'12h':43200,'1d':86400,
};

// Contract types for auto bot
const BOT_CONTRACT_TYPES = [
  { value: 'CALL', label: 'Rise (Above)' },
  { value: 'PUT', label: 'Fall (Below)' },
  { value: 'DIGITMATCH', label: 'Digits Match' },
  { value: 'DIGITDIFF', label: 'Digits Differs' },
  { value: 'DIGITEVEN', label: 'Digits Even' },
  { value: 'DIGITODD', label: 'Digits Odd' },
  { value: 'DIGITOVER', label: 'Digits Over' },
  { value: 'DIGITUNDER', label: 'Digits Under' },
];

/* ── Candle builder with constant candles ── */
interface Candle {
  open: number; high: number; low: number; close: number; time: number;
}

function buildCandles(prices: number[], times: number[], tf: string): Candle[] {
  if (prices.length === 0) return [];
  const interval = TF_SECONDS[tf] || 60;
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

/* ── EMA/SMA/BB/RSI helpers ── */
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

function calcPSAR(prices: number[], high: number[], low: number[]): (number | null)[] {
  const sar: (number | null)[] = [];
  if (prices.length < 2) return [null];
  
  let af = 0.02;
  let maxAf = 0.2;
  let sarValue = low[0];
  let isUp = true;
  let ep = high[0];
  
  for (let i = 1; i < prices.length; i++) {
    if (isUp) {
      sarValue = sarValue + af * (ep - sarValue);
      if (i > 1 && sarValue > low[i-1]) sarValue = low[i-1];
      if (sarValue > low[i]) {
        isUp = false;
        sarValue = ep;
        ep = low[i];
        af = 0.02;
      }
    } else {
      sarValue = sarValue + af * (ep - sarValue);
      if (i > 1 && sarValue < high[i-1]) sarValue = high[i-1];
      if (sarValue < high[i]) {
        isUp = true;
        sarValue = ep;
        ep = high[i];
        af = 0.02;
      }
    }
    
    if (isUp && high[i] > ep) {
      ep = high[i];
      af = Math.min(af + 0.02, maxAf);
    } else if (!isUp && low[i] < ep) {
      ep = low[i];
      af = Math.min(af + 0.02, maxAf);
    }
    
    sar.push(sarValue);
  }
  
  return [null, ...sar];
}

function calcMACDFull(prices: number[]) {
  const ema12 = calcEMA(prices, 12);
  const ema26 = calcEMA(prices, 26);
  const macd = ema12 - ema26;
  const signal = calcEMA(prices.map((_, i) => {
    const e12 = calcEMA(prices.slice(0, i+1), 12);
    const e26 = calcEMA(prices.slice(0, i+1), 26);
    return e12 - e26;
  }), 9);
  return { macd, signal, histogram: macd - signal };
}

/* ── Drawing Tools System ── */
interface Drawing {
  id: string;
  type: 'trendline' | 'arrow' | 'rectangle' | 'circle' | 'triangle' | 'long' | 'short';
  startX: number;
  startY: number;
  endX?: number;
  endY?: number;
  color: string;
}

/* ── Tick storage for digit analysis ── */
const tickHistoryRef: { [symbol: string]: number[] } = {};

function getTickHistory(symbol: string): number[] {
  return tickHistoryRef[symbol] || [];
}

function addTick(symbol: string, digit: number) {
  if (!tickHistoryRef[symbol]) tickHistoryRef[symbol] = [];
  tickHistoryRef[symbol].push(digit);
  // Keep last 500 ticks for digit analysis
  if (tickHistoryRef[symbol].length > 500) tickHistoryRef[symbol].shift();
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

interface BotStats {
  trades: number;
  wins: number;
  losses: number;
  pnl: number;
  currentStake: number;
  consecutiveLosses: number;
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
  
  // Digit analysis tick count (separate from candles)
  const [digitTickCount, setDigitTickCount] = useState(100);
  
  // Zoom & pan state
  const [candleWidth, setCandleWidth] = useState(7);
  const [scrollOffset, setScrollOffset] = useState(0);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartOffset = useRef(0);
  
  // Drawing tools state
  const [activeDrawingTool, setActiveDrawingTool] = useState<string | null>(null);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const isDrawing = useRef(false);
  const drawingStart = useRef<{ x: number; y: number } | null>(null);
  
  // Bot state
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
    signalType: 'overunder' as 'overunder' | 'evenodd' | 'match',
  });
  const [botStats, setBotStats] = useState<BotStats>({ trades: 0, wins: 0, losses: 0, pnl: 0, currentStake: 0, consecutiveLosses: 0 });
  const [tradeHistory, setTradeHistory] = useState<TradeRecord[]>([]);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const lastSpokenSignal = useRef('');

  /* ── Load history + subscribe with constant candle count ── */
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
        
        // Load exactly CONSTANT_CANDLE_COUNT candles worth of ticks
        const hist = await derivApi.getTickHistory(symbol as MarketSymbol, CONSTANT_CANDLE_COUNT * 10);
        if (!active) return;
        
        // Initialize tick history with digits from historical data
        const historicalDigits = (hist.history.prices || []).map(p => getLastDigit(p));
        tickHistoryRef[symbol] = historicalDigits.slice(-500);
        
        setPrices(hist.history.prices || []);
        setTimes(hist.history.times || []);
        setScrollOffset(0);
        setIsLoading(false);

        // Subscribe to new ticks
        if (!subscribedRef.current || !subscriptionRef.current) {
          subscriptionRef.current = await derivApi.subscribeTicks(symbol as MarketSymbol, (data: any) => {
            if (!active || !data.tick) return;
            
            const quote = data.tick.quote;
            const digit = getLastDigit(quote);
            const epoch = data.tick.epoch;
            
            addTick(symbol, digit);
            
            setPrices(prev => {
              const newPrices = [...prev, quote];
              return newPrices.slice(-CONSTANT_CANDLE_COUNT * 10);
            });
            
            setTimes(prev => {
              const newTimes = [...prev, epoch];
              return newTimes.slice(-CONSTANT_CANDLE_COUNT * 10);
            });
            
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
  }, [symbol]);

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

  // Manual refresh
  const handleManualRefresh = useCallback(async () => {
    if (!derivApi.isConnected) {
      toast.error('Not connected to Deriv');
      return;
    }
    
    setIsLoading(true);
    try {
      const hist = await derivApi.getTickHistory(symbol as MarketSymbol, CONSTANT_CANDLE_COUNT * 10);
      setPrices(prev => {
        const newPrices = [...prev, ...hist.history.prices];
        return newPrices.slice(-CONSTANT_CANDLE_COUNT * 10);
      });
      setTimes(prev => {
        const newTimes = [...prev, ...hist.history.times];
        return newTimes.slice(-CONSTANT_CANDLE_COUNT * 10);
      });
      toast.success('Market data refreshed');
    } catch (err) {
      toast.error('Failed to refresh data');
    } finally {
      setIsLoading(false);
    }
  }, [symbol]);

  /* ── Derived data ── */
  // Use ALL prices for candles (constant candle count)
  const candles = useMemo(() => buildCandles(prices, times, timeframe), [prices, times, timeframe]);
  
  // Digit analysis uses ONLY the selected tick count (independent of candles)
  const digitAnalysisTicks = useMemo(() => {
    const tickHistory = getTickHistory(symbol);
    return tickHistory.slice(-digitTickCount);
  }, [symbol, digitTickCount]);
  
  const currentPrice = prices[prices.length - 1] || 0;
  const lastDigit = getLastDigit(currentPrice);
  
  const { frequency, percentages, mostCommon, leastCommon } = useMemo(() => 
    analyzeDigits(digitAnalysisTicks), [digitAnalysisTicks]
  );
  
  // Calculate digit statistics from selected tick count
  const digits = digitAnalysisTicks;
  const evenCount = useMemo(() => digits.filter(d => d % 2 === 0).length, [digits]);
  const oddCount = digits.length - evenCount;
  const evenPct = digits.length > 0 ? (evenCount / digits.length * 100) : 50;
  const oddPct = 100 - evenPct;
  const overCount = useMemo(() => digits.filter(d => d > 4).length, [digits]);
  const underCount = digits.length - overCount;
  const overPct = digits.length > 0 ? (overCount / digits.length * 100) : 50;
  const underPct = 100 - overPct;

  // Indicators for chart
  const bb = useMemo(() => calculateBollingerBands(prices, 20), [prices]);
  const ema50 = useMemo(() => calcEMA(prices, 50), [prices]);
  const sma20 = useMemo(() => {
    if (prices.length < 20) return prices[prices.length - 1] || 0;
    const slice = prices.slice(-20);
    return slice.reduce((a, b) => a + b, 0) / 20;
  }, [prices]);
  const rsi = useMemo(() => calculateRSI(prices, 14), [prices]);
  const macd = useMemo(() => calcMACDFull(prices), [prices]);
  const psar = useMemo(() => {
    const high = candles.map(c => c.high);
    const low = candles.map(c => c.low);
    return calcPSAR(prices, high, low);
  }, [prices, candles]);

  // Candle indices for indicator mapping
  const candleEndIndices = useMemo(() => {
    const indices: number[] = [];
    let lastBucket = -1;
    for (let i = 0; i < prices.length; i++) {
      const t = times[i] || Date.now() / 1000 + i;
      const interval = TF_SECONDS[timeframe] || 60;
      const bucket = Math.floor(t / interval) * interval;
      if (bucket !== lastBucket) {
        if (lastBucket !== -1) indices.push(i - 1);
        lastBucket = bucket;
      }
    }
    indices.push(prices.length - 1);
    return indices;
  }, [prices, times, timeframe]);
  
  const emaSeries = useMemo(() => calcEMASeries(prices, 50), [prices]);
  const smaSeries = useMemo(() => calcSMASeries(prices, 20), [prices]);
  const bbSeries = useMemo(() => calcBBSeries(prices, 20, 2), [prices]);
  const rsiSeries = useMemo(() => calcRSISeries(prices, 14), [prices]);

  // Signal generation for auto bot
  const generateSignal = useCallback(() => {
    if (digits.length < 10) return null;
    
    switch (botConfig.signalType) {
      case 'overunder':
        const overPercentage = (digits.filter(d => d > 4).length / digits.length) * 100;
        if (overPercentage > 55) return { type: 'DIGITOVER', prediction: '5' };
        if (overPercentage < 45) return { type: 'DIGITUNDER', prediction: '4' };
        return null;
        
      case 'evenodd':
        const evenPercentage = (digits.filter(d => d % 2 === 0).length / digits.length) * 100;
        if (evenPercentage > 55) return { type: 'DIGITEVEN', prediction: '' };
        if (evenPercentage < 45) return { type: 'DIGITODD', prediction: '' };
        return null;
        
      case 'match':
        const bestMatch = mostCommon;
        const matchPercentage = percentages[bestMatch] || 0;
        if (matchPercentage > 15) return { type: 'DIGITMATCH', prediction: String(bestMatch) };
        if (matchPercentage < 5) return { type: 'DIGITDIFF', prediction: String(bestMatch) };
        return null;
        
      default:
        return null;
    }
  }, [digits, botConfig.signalType, mostCommon, percentages]);

  // Voice announcements
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

  // Auto Bot execution
  const startBot = useCallback(async () => {
    if (!isAuthorized) { toast.error('Login to Deriv first'); return; }
    setBotRunning(true); setBotPaused(false);
    botRunningRef.current = true; botPausedRef.current = false;
    
    let stake = parseFloat(botConfig.stake) || 1;
    let pnl = 0; let trades = 0; let wins = 0; let losses = 0; let consLosses = 0;
    const sl = parseFloat(botConfig.stopLoss) || 10;
    const tp = parseFloat(botConfig.takeProfit) || 20;
    const maxT = parseInt(botConfig.maxTrades) || 50;
    const mart = botConfig.martingale;
    const mult = parseFloat(botConfig.multiplier) || 2;

    if (voiceEnabled) speak('Auto trading bot started');

    while (botRunningRef.current) {
      if (botPausedRef.current) { await new Promise(r => setTimeout(r, 500)); continue; }
      if (trades >= maxT || pnl <= -sl || pnl >= tp) {
        const reason = trades >= maxT ? 'Max trades reached' : pnl <= -sl ? 'Stop loss hit' : 'Take profit reached';
        toast.info(`🤖 Bot stopped: ${reason}`);
        if (voiceEnabled) speak(`Bot stopped. ${reason}. Total profit ${pnl.toFixed(2)} dollars`);
        break;
      }

      // Generate signal based on digit analysis
      const signal = generateSignal();
      if (!signal) {
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }

      const params: any = { 
        contract_type: signal.type, 
        symbol: botConfig.botSymbol, 
        duration: parseInt(botConfig.duration), 
        duration_unit: botConfig.durationUnit, 
        basis: 'stake', 
        amount: stake 
      };
      if (signal.prediction) params.barrier = signal.prediction;

      try {
        const { contractId } = await derivApi.buyContract(params);
        const tr: TradeRecord = { 
          id: contractId, 
          time: Date.now(), 
          type: signal.type, 
          stake, 
          profit: 0, 
          status: 'open', 
          symbol: botConfig.botSymbol 
        };
        setTradeHistory(prev => [tr, ...prev].slice(0, 100));
        
        const result = await derivApi.waitForContractResult(contractId);
        trades++; pnl += result.profit;
        const resultDigit = getLastDigit(result.price || 0);
        
        setTradeHistory(prev => prev.map(t => t.id === contractId ? { ...t, profit: result.profit, status: result.status, resultDigit } : t));

        if (result.status === 'won') {
          wins++; consLosses = 0;
          stake = parseFloat(botConfig.stake) || 1;
          if (voiceEnabled && trades % 5 === 0) speak(`Trade ${trades} won. Total profit ${pnl.toFixed(2)}`);
          toast.success(`✅ Bot trade WON! +$${result.profit.toFixed(2)}`);
        } else {
          losses++; consLosses++;
          if (mart) {
            stake = stake * mult;
          } else {
            stake = parseFloat(botConfig.stake) || 1;
          }
          if (voiceEnabled) speak(`Loss ${consLosses}. ${mart ? `Martingale stake ${stake.toFixed(2)}` : ''}`);
          toast.error(`❌ Bot trade LOST -$${Math.abs(result.profit).toFixed(2)}`);
        }
        
        setBotStats({ trades, wins, losses, pnl, currentStake: stake, consecutiveLosses: consLosses });
        
        // Wait between trades
        await new Promise(r => setTimeout(r, 2000));
      } catch (err: any) {
        toast.error(`Bot trade error: ${err.message}`);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    setBotRunning(false); botRunningRef.current = false;
  }, [isAuthorized, botConfig, voiceEnabled, speak, generateSignal]);

  const stopBot = useCallback(() => { 
    botRunningRef.current = false; 
    setBotRunning(false); 
    toast.info('🛑 Bot stopped'); 
  }, []);
  
  const togglePauseBot = useCallback(() => { 
    botPausedRef.current = !botPausedRef.current; 
    setBotPaused(botPausedRef.current); 
  }, []);

  // Update chart symbol when bot symbol changes
  const handleBotSymbolChange = useCallback((newSymbol: string) => {
    setBotConfig(prev => ({ ...prev, botSymbol: newSymbol }));
    setSymbol(newSymbol);
  }, []);

  // Drawing tools handlers
  const handleDrawingToolSelect = (tool: string) => {
    setActiveDrawingTool(tool === activeDrawingTool ? null : tool);
  };

  const clearAllDrawings = () => {
    setDrawings([]);
    toast.success('All drawings cleared');
  };

  // Canvas drawing logic
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !showChart) return;

    const handleCanvasMouseDown = (e: MouseEvent) => {
      if (!activeDrawingTool) return;
      
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      isDrawing.current = true;
      drawingStart.current = { x, y };
    };

    const handleCanvasMouseMove = (e: MouseEvent) => {
      if (!isDrawing.current || !drawingStart.current || !activeDrawingTool) return;
      
      const rect = canvas.getBoundingClientRect();
      const currentX = e.clientX - rect.left;
      const currentY = e.clientY - rect.top;
      
      // Redraw canvas with temporary drawing
      // This would need full canvas redraw logic
    };

    const handleCanvasMouseUp = (e: MouseEvent) => {
      if (!isDrawing.current || !drawingStart.current || !activeDrawingTool) {
        isDrawing.current = false;
        drawingStart.current = null;
        return;
      }
      
      const rect = canvas.getBoundingClientRect();
      const endX = e.clientX - rect.left;
      const endY = e.clientY - rect.top;
      
      const newDrawing: Drawing = {
        id: Date.now().toString(),
        type: activeDrawingTool as any,
        startX: drawingStart.current.x,
        startY: drawingStart.current.y,
        endX,
        endY,
        color: '#58A6FF',
      };
      
      setDrawings(prev => [...prev, newDrawing]);
      isDrawing.current = false;
      drawingStart.current = null;
    };

    canvas.addEventListener('mousedown', handleCanvasMouseDown);
    canvas.addEventListener('mousemove', handleCanvasMouseMove);
    canvas.addEventListener('mouseup', handleCanvasMouseUp);

    return () => {
      canvas.removeEventListener('mousedown', handleCanvasMouseDown);
      canvas.removeEventListener('mousemove', handleCanvasMouseMove);
      canvas.removeEventListener('mouseup', handleCanvasMouseUp);
    };
  }, [activeDrawingTool, showChart]);

  // Canvas zoom/pan handlers
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
      if (activeDrawingTool) return;
      isDragging.current = true;
      dragStartX.current = e.clientX;
      dragStartOffset.current = scrollOffset;
      canvas.style.cursor = 'grabbing';
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || activeDrawingTool) return;
      const dx = dragStartX.current - e.clientX;
      const candlesPerPx = 1 / (candleWidth + 1);
      const delta = Math.round(dx * candlesPerPx);
      setScrollOffset(Math.max(0, Math.min(candles.length - 10, dragStartOffset.current + delta)));
    };

    const onMouseUp = () => {
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
  }, [candles.length, scrollOffset, candleWidth, showChart, activeDrawingTool]);

  // Main chart drawing with indicators
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
    const indicatorsH = 120;
    const H = totalH - indicatorsH - 8;
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
      const s = idx < psar.length ? psar[idx] : null;
      if (u !== null) allPrices.push(u);
      if (l !== null) allPrices.push(l);
      if (s !== null) allPrices.push(s);
    }
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

    // Grid
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

    // Draw indicator lines
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

    // Bollinger Bands fill
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

    // Draw all indicators
    drawLine(bbSeries.upper, '#BC8CFF', 1.2, [5, 3]);
    drawLine(bbSeries.middle, '#BC8CFF', 1.5);
    drawLine(bbSeries.lower, '#BC8CFF', 1.2, [5, 3]);
    drawLine(emaSeries, '#2F81F7', 1.5);
    drawLine(smaSeries, '#E6B422', 1.5);
    drawLine(psar, '#FF7E47', 1.2, [2, 2]);

    // Candles
    for (let i = 0; i < visibleCandles.length; i++) {
      const c = visibleCandles[i];
      const x = offsetX + i * totalCandleW;
      const isGreen = c.close >= c.open;
      const color = isGreen ? '#3FB950' : '#F85149';

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

    // Current price line
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

    // Legend
    ctx.font = '10px JetBrains Mono, monospace';
    const legends = [
      { label: 'BB(20,2)', color: '#BC8CFF' },
      { label: 'SMA 20', color: '#E6B422' },
      { label: 'EMA 50', color: '#2F81F7' },
      { label: 'PSAR', color: '#FF7E47' },
    ];
    let lx = 8;
    legends.forEach(l => {
      ctx.fillStyle = l.color;
      ctx.fillRect(lx, 6, 10, 3);
      ctx.fillText(l.label, lx + 14, 12);
      lx += ctx.measureText(l.label).width + 24;
    });

    // Drawings overlay
    drawings.forEach(drawing => {
      ctx.strokeStyle = drawing.color;
      ctx.fillStyle = drawing.color;
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      
      switch (drawing.type) {
        case 'trendline':
          if (drawing.endX && drawing.endY) {
            ctx.beginPath();
            ctx.moveTo(drawing.startX, drawing.startY);
            ctx.lineTo(drawing.endX, drawing.endY);
            ctx.stroke();
          }
          break;
        case 'arrow':
          if (drawing.endX && drawing.endY) {
            ctx.beginPath();
            ctx.moveTo(drawing.startX, drawing.startY);
            ctx.lineTo(drawing.endX, drawing.endY);
            ctx.stroke();
            // Draw arrowhead
            const angle = Math.atan2(drawing.endY - drawing.startY, drawing.endX - drawing.startX);
            const arrowSize = 10;
            const arrowX = drawing.endX;
            const arrowY = drawing.endY;
            ctx.beginPath();
            ctx.moveTo(arrowX, arrowY);
            ctx.lineTo(arrowX - arrowSize * Math.cos(angle - Math.PI / 6), arrowY - arrowSize * Math.sin(angle - Math.PI / 6));
            ctx.lineTo(arrowX - arrowSize * Math.cos(angle + Math.PI / 6), arrowY - arrowSize * Math.sin(angle + Math.PI / 6));
            ctx.fill();
          }
          break;
        case 'rectangle':
          if (drawing.endX && drawing.endY) {
            ctx.strokeRect(drawing.startX, drawing.startY, drawing.endX - drawing.startX, drawing.endY - drawing.startY);
          }
          break;
        case 'circle':
          if (drawing.endX && drawing.endY) {
            const radius = Math.sqrt(Math.pow(drawing.endX - drawing.startX, 2) + Math.pow(drawing.endY - drawing.startY, 2));
            ctx.beginPath();
            ctx.arc(drawing.startX, drawing.startY, radius, 0, 2 * Math.PI);
            ctx.stroke();
          }
          break;
        case 'triangle':
          if (drawing.endX && drawing.endY) {
            const centerX = (drawing.startX + drawing.endX) / 2;
            const centerY = (drawing.startY + drawing.endY) / 2;
            const size = Math.abs(drawing.endX - drawing.startX);
            ctx.beginPath();
            ctx.moveTo(centerX, centerY - size / 2);
            ctx.lineTo(centerX - size / 2, centerY + size / 2);
            ctx.lineTo(centerX + size / 2, centerY + size / 2);
            ctx.closePath();
            ctx.stroke();
          }
          break;
        case 'long':
          if (drawing.endX && drawing.endY) {
            const centerX = (drawing.startX + drawing.endX) / 2;
            const centerY = (drawing.startY + drawing.endY) / 2;
            const size = 12;
            ctx.fillStyle = '#3FB950';
            ctx.beginPath();
            ctx.moveTo(centerX, centerY - size);
            ctx.lineTo(centerX - size / 2, centerY + size / 2);
            ctx.lineTo(centerX, centerY);
            ctx.lineTo(centerX + size / 2, centerY + size / 2);
            ctx.closePath();
            ctx.fill();
          }
          break;
        case 'short':
          if (drawing.endX && drawing.endY) {
            const centerX = (drawing.startX + drawing.endX) / 2;
            const centerY = (drawing.startY + drawing.endY) / 2;
            const size = 12;
            ctx.fillStyle = '#F85149';
            ctx.beginPath();
            ctx.moveTo(centerX, centerY + size);
            ctx.lineTo(centerX - size / 2, centerY - size / 2);
            ctx.lineTo(centerX, centerY);
            ctx.lineTo(centerX + size / 2, centerY - size / 2);
            ctx.closePath();
            ctx.fill();
          }
          break;
      }
    });

    // RSI indicator at bottom
    const rsiTop = H + 8;
    ctx.fillStyle = '#161B22';
    ctx.fillRect(0, rsiTop, W, indicatorsH);
    ctx.strokeStyle = '#21262D';
    ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(0, rsiTop); ctx.lineTo(W, rsiTop); ctx.stroke();

    const rsiToY = (v: number) => rsiTop + 4 + ((100 - v) / 100) * (indicatorsH - 8);
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
    ctx.fillRect(0, rsiToY(30), chartW, rsiTop + indicatorsH - rsiToY(30));
    
    // MACD indicator (simplified)
    const macdTop = rsiTop + indicatorsH - 40;
    ctx.fillStyle = '#161B22';
    ctx.fillRect(0, macdTop, W, 40);
    ctx.fillStyle = '#8B949E';
    ctx.font = '8px JetBrains Mono, monospace';
    ctx.fillText('MACD', 4, macdTop + 12);
    
    const macdValue = macd.macd;
    const macdColor = macdValue > 0 ? '#3FB950' : '#F85149';
    ctx.fillStyle = macdColor;
    ctx.fillRect(chartW - 30, macdTop + 5, 20, 20);
    ctx.fillStyle = '#0D1117';
    ctx.font = 'bold 8px JetBrains Mono, monospace';
    ctx.fillText(macdValue.toFixed(4), chartW - 28, macdTop + 20);

  }, [candles, bbSeries, emaSeries, smaSeries, psar, rsiSeries, rsi, macd, currentPrice, candleEndIndices, candleWidth, scrollOffset, showChart, drawings]);

  const filteredMarkets = groupFilter === 'all' ? ALL_MARKETS : ALL_MARKETS.filter(m => m.group === groupFilter);
  const marketName = ALL_MARKETS.find(m => m.symbol === symbol)?.name || symbol;
  
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

      {/* Drawing Tools Toolbar */}
      {showChart && (
        <div className="bg-card border border-border rounded-xl p-2 flex flex-wrap gap-1 items-center">
          <span className="text-[10px] text-muted-foreground mr-2">Drawing Tools:</span>
          <Button
            size="sm"
            variant={activeDrawingTool === 'trendline' ? 'default' : 'outline'}
            className="h-7 px-2"
            onClick={() => handleDrawingToolSelect('trendline')}
          >
            <Move className="w-3 h-3 mr-1" /> Line
          </Button>
          <Button
            size="sm"
            variant={activeDrawingTool === 'arrow' ? 'default' : 'outline'}
            className="h-7 px-2"
            onClick={() => handleDrawingToolSelect('arrow')}
          >
            <TrendingUp className="w-3 h-3 mr-1" /> Arrow
          </Button>
          <Button
            size="sm"
            variant={activeDrawingTool === 'rectangle' ? 'default' : 'outline'}
            className="h-7 px-2"
            onClick={() => handleDrawingToolSelect('rectangle')}
          >
            <Square className="w-3 h-3 mr-1" /> Rect
          </Button>
          <Button
            size="sm"
            variant={activeDrawingTool === 'circle' ? 'default' : 'outline'}
            className="h-7 px-2"
            onClick={() => handleDrawingToolSelect('circle')}
          >
            <Circle className="w-3 h-3 mr-1" /> Circle
          </Button>
          <Button
            size="sm"
            variant={activeDrawingTool === 'triangle' ? 'default' : 'outline'}
            className="h-7 px-2"
            onClick={() => handleDrawingToolSelect('triangle')}
          >
            <Triangle className="w-3 h-3 mr-1" /> Tri
          </Button>
          <Button
            size="sm"
            variant={activeDrawingTool === 'long' ? 'default' : 'outline'}
            className="h-7 px-2"
            onClick={() => handleDrawingToolSelect('long')}
          >
            <LongPosition className="w-3 h-3 mr-1 text-profit" /> Long
          </Button>
          <Button
            size="sm"
            variant={activeDrawingTool === 'short' ? 'default' : 'outline'}
            className="h-7 px-2"
            onClick={() => handleDrawingToolSelect('short')}
          >
            <ShortPosition className="w-3 h-3 mr-1 text-loss" /> Short
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 ml-auto"
            onClick={clearAllDrawings}
          >
            <Eraser className="w-3 h-3 mr-1" /> Clear All
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        {/* ═══ LEFT: Chart + Info ═══ */}
        <div className="xl:col-span-8 space-y-3">
          {/* Candlestick Chart */}
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
                  <canvas ref={canvasRef} className="w-full" style={{ height: 620, cursor: 'crosshair' }} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Price Info Panel */}
          <div className="grid grid-cols-3 md:grid-cols-7 gap-2">
            {[
              { label: 'Price', value: currentPrice.toFixed(4), color: 'text-foreground' },
              { label: 'Last Digit', value: String(lastDigit), color: 'text-primary' },
              { label: 'EMA 50', value: ema50.toFixed(2), color: 'text-[#2F81F7]' },
              { label: 'SMA 20', value: sma20.toFixed(2), color: 'text-[#E6B422]' },
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

          {/* Digit Analysis with Tick Selector */}
          <div className="bg-card border border-border rounded-xl p-3 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-foreground">Digit Analysis</h3>
              <div className="flex items-center gap-2">
                <label className="text-[9px] text-muted-foreground">Analysis Ticks:</label>
                <Select value={String(digitTickCount)} onValueChange={(v) => setDigitTickCount(parseInt(v))}>
                  <SelectTrigger className="h-6 w-20 text-[10px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="50">50</SelectItem>
                    <SelectItem value="100">100</SelectItem>
                    <SelectItem value="200">200</SelectItem>
                    <SelectItem value="500">500</SelectItem>
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
                  <div key={d}
                    className={`relative rounded-lg p-2 text-center transition-all border ${
                      isHot ? 'bg-loss/10 border-loss/40 text-loss' :
                      isWarm ? 'bg-warning/10 border-warning/40 text-warning' :
                      'bg-card border-border text-primary'
                    }`}
                  >
                    <div className="font-mono text-lg font-bold">{d}</div>
                    <div className="text-[8px]">{count} ({pct.toFixed(1)}%)</div>
                    <div className="h-1 bg-muted rounded-full mt-1">
                      <div className={`h-full rounded-full ${isHot ? 'bg-loss' : isWarm ? 'bg-warning' : 'bg-primary'}`} style={{ width: `${Math.min(100, pct * 5)}%` }} />
                    </div>
                    {isBestMatch && (
                      <Badge className="absolute -top-1 -right-1 text-[7px] px-1 bg-profit text-profit-foreground">Match</Badge>
                    )}
                    {isBestDiffer && (
                      <Badge className="absolute -top-1 -left-1 text-[7px] px-1 bg-loss text-loss-foreground">Differ</Badge>
                    )}
                  </div>
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

        {/* ═══ RIGHT: Signals + Auto Bot ═══ */}
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
              <p className="text-[9px] text-muted-foreground mt-1">🔊 AI will announce trade results and signals</p>
            )}
          </div>

          {/* Current Signal */}
          <div className="bg-card border border-border rounded-xl p-3">
            <h3 className="text-xs font-semibold text-foreground mb-2">Current Signal</h3>
            {generateSignal() ? (
              <div className="space-y-1">
                <div className="text-lg font-bold text-primary">
                  {generateSignal()?.type === 'DIGITOVER' ? '📈 OVER 5' :
                   generateSignal()?.type === 'DIGITUNDER' ? '📉 UNDER 5' :
                   generateSignal()?.type === 'DIGITEVEN' ? '🎯 EVEN' :
                   generateSignal()?.type === 'DIGITODD' ? '🎯 ODD' :
                   generateSignal()?.type === 'DIGITMATCH' ? `🎯 MATCH ${generateSignal()?.prediction}` :
                   generateSignal()?.type === 'DIGITDIFF' ? `⚡ DIFFERS ${generateSignal()?.prediction}` :
                   '⚡ RISE/FALL'}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  Based on {digitTickCount} ticks analysis
                </div>
              </div>
            ) : (
              <div className="text-muted-foreground text-sm">Waiting for clear signal...</div>
            )}
          </div>

          {/* ═══ MILLIEFX SPEED BOT ═══ */}
          <div className={`bg-card border rounded-xl p-3 space-y-2 ${botRunning ? 'border-profit glow-profit' : 'border-border'}`}>
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-foreground flex items-center gap-1">
                <Zap className="w-3.5 h-3.5 text-primary" /> MillieFX Speed Bot
              </h3>
              <div className="flex items-center gap-2">
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

            {/* Signal Type Selector */}
            <div>
              <label className="text-[9px] text-muted-foreground">Trading Strategy</label>
              <Select value={botConfig.signalType} onValueChange={(v: any) => setBotConfig(p => ({ ...p, signalType: v }))} disabled={botRunning}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="overunder">Over/Under (5)</SelectItem>
                  <SelectItem value="evenodd">Even/Odd</SelectItem>
                  <SelectItem value="match">Match/Differ</SelectItem>
                </SelectContent>
              </Select>
            </div>

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
                      <SelectItem value="t">Ticks</SelectItem>
                      <SelectItem value="s">Seconds</SelectItem>
                      <SelectItem value="m">Minutes</SelectItem>
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

            <div className="grid grid-cols-3 gap-1.5">
              <div>
                <label className="text-[8px] text-muted-foreground">Stop Loss ($)</label>
                <Input type="number" value={botConfig.stopLoss} onChange={e => setBotConfig(p => ({ ...p, stopLoss: e.target.value }))}
                  disabled={botRunning} className="h-7 text-xs" />
              </div>
              <div>
                <label className="text-[8px] text-muted-foreground">Take Profit ($)</label>
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
