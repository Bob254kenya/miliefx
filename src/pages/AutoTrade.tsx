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
  TrendingUp, TrendingDown, Activity, BarChart3, ArrowUp, ArrowDown,
  Target, ShieldAlert, Volume2, VolumeX, Zap, Trophy, Play, Pause, StopCircle, Eye, EyeOff, Bot, RefreshCw, Globe, Search, Sparkles,
} from 'lucide-react';

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
const TF_TICKS: Record<string, number> = {
  '1m': 1000, '3m': 2000, '5m': 3000, '15m': 4000, '30m': 4500, '1h': 5000, '4h': 5000, '12h': 5000, '1d': 5000,
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

interface Candle {
  open: number; high: number; low: number; close: number; time: number;
}

function buildCandles(prices: number[], times: number[], tf: string): Candle[] {
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
  return candles;
}

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
  marketName: string;
  resultDigit?: number;
  botId?: string;
}

const tickHistoryRef: { [symbol: string]: number[] } = {};

function getTickHistory(symbol: string): number[] {
  return tickHistoryRef[symbol] || [];
}

function addTick(symbol: string, digit: number) {
  if (!tickHistoryRef[symbol]) tickHistoryRef[symbol] = [];
  tickHistoryRef[symbol].push(digit);
  if (tickHistoryRef[symbol].length > 200) tickHistoryRef[symbol].shift();
}

interface BotConfig {
  botSymbol: string;
  stake: string;
  contractType: string;
  prediction: string;
  duration: string;
  durationUnit: string;
  martingale: boolean;
  multiplier: string;
  stopLoss: string;
  takeProfit: string;
  maxTrades: string;
}

interface BotStats {
  trades: number;
  wins: number;
  losses: number;
  pnl: number;
  currentStake: number;
  consecutiveLosses: number;
}

interface BotStrategy {
  enabled: boolean;
  mode: 'pattern' | 'digit';
  patternInput: string;
  digitCondition: string;
  digitCompare: string;
  digitWindow: string;
}

export default function TradingChart() {
  const { isAuthorized } = useAuth();
  const [showChart, setShowChart] = useState(false);
  const [symbol, setSymbol] = useState('R_100');
  const [groupFilter, setGroupFilter] = useState('all');
  const [timeframe, setTimeframe] = useState('1m');
  const [prices, setPrices] = useState<number[]>([]);
  const [times, setTimes] = useState<number[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const subscribedRef = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [candleWidth, setCandleWidth] = useState(7);
  const [scrollOffset, setScrollOffset] = useState(0);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartOffset = useRef(0);
  const isPriceAxisDragging = useRef(false);
  const priceAxisStartY = useRef(0);
  const priceAxisStartWidth = useRef(7);

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

  const [bot1Running, setBot1Running] = useState(false);
  const [bot1Paused, setBot1Paused] = useState(false);
  const bot1RunningRef = useRef(false);
  const bot1PausedRef = useRef(false);
  const [bot1Config, setBot1Config] = useState<BotConfig>({
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
  const [bot1Stats, setBot1Stats] = useState<BotStats>({ trades: 0, wins: 0, losses: 0, pnl: 0, currentStake: 0, consecutiveLosses: 0 });
  const [bot1Strategy, setBot1Strategy] = useState<BotStrategy>({
    enabled: false,
    mode: 'pattern',
    patternInput: '',
    digitCondition: '==',
    digitCompare: '5',
    digitWindow: '3',
  });

  const [globalStrategyEnabled, setGlobalStrategyEnabled] = useState(false);

  const [recoveryEnabled, setRecoveryEnabled] = useState(false);
  const [recoveryActive, setRecoveryActive] = useState(false);
  const [recoveryConfig, setRecoveryConfig] = useState({
    recoverySymbol: 'R_50',
    contractType: 'CALL',
    prediction: '5',
  });
  const [recoveryStrategy, setRecoveryStrategy] = useState<BotStrategy>({
    enabled: false,
    mode: 'pattern',
    patternInput: '',
    digitCondition: '==',
    digitCompare: '5',
    digitWindow: '3',
  });
  const [recoveryAttempts, setRecoveryAttempts] = useState(0);
  const [recoveryCurrentStake, setRecoveryCurrentStake] = useState(0);
  const [autoScanAndTrade, setAutoScanAndTrade] = useState(false);
  const [scanningMarkets, setScanningMarkets] = useState(false);
  const [autoTradeExecuted, setAutoTradeExecuted] = useState(false);

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

  const getMarketName = (symbol: string): string => {
    const market = ALL_MARKETS.find(m => m.symbol === symbol);
    return market ? market.name : symbol;
  };

  const checkConditionOnMarket = useCallback((marketSymbol: string, strategy: BotStrategy): boolean => {
    const ticks = getTickHistory(marketSymbol);
    if (ticks.length === 0) return false;
    
    if (strategy.mode === 'pattern') {
      const pattern = strategy.patternInput.toUpperCase().replace(/[^EO]/g, '');
      if (ticks.length < pattern.length || pattern.length === 0) return false;
      const recent = ticks.slice(-pattern.length);
      for (let i = 0; i < pattern.length; i++) {
        const expected = pattern[i];
        const actual = recent[i] % 2 === 0 ? 'E' : 'O';
        if (expected !== actual) return false;
      }
      return true;
    } else {
      const win = parseInt(strategy.digitWindow) || 3;
      const comp = parseInt(strategy.digitCompare);
      if (ticks.length < win) return false;
      const recent = ticks.slice(-win);
      return recent.every(d => {
        switch (strategy.digitCondition) {
          case '>': return d > comp;
          case '<': return d < comp;
          case '>=': return d >= comp;
          case '<=': return d <= comp;
          case '==': return d === comp;
          case '!=': return d !== comp;
          default: return false;
        }
      });
    }
  }, []);

  const scanAndAutoTrade = useCallback(async () => {
    if (!recoveryStrategy.enabled) {
      toast.warning('Please enable pattern/digit strategy first');
      return;
    }
    
    setScanningMarkets(true);
    
    let foundMatch = false;
    let matchedMarket = '';
    
    for (const market of ALL_MARKETS) {
      const conditionMet = checkConditionOnMarket(market.symbol, recoveryStrategy);
      
      if (conditionMet) {
        foundMatch = true;
        matchedMarket = market.symbol;
        toast.success(`✅ Found matching market: ${market.name} (${market.symbol})`);
        if (voiceEnabled) speak(`Found matching market: ${market.name}`);
        break;
      }
      
      await new Promise(r => setTimeout(r, 50));
    }
    
    setScanningMarkets(false);
    
    if (foundMatch && autoScanAndTrade && !autoTradeExecuted && !recoveryActive) {
      setAutoTradeExecuted(true);
      setRecoveryConfig(prev => ({ ...prev, recoverySymbol: matchedMarket }));
      
      toast.info(`🎯 Auto-trade triggered on ${getMarketName(matchedMarket)}`);
      if (voiceEnabled) speak(`Auto-trade triggered on ${getMarketName(matchedMarket)}`);
      
      const stake = parseFloat(bot1Config.stake);
      const ct = recoveryConfig.contractType;
      const params: any = { 
        contract_type: ct, 
        symbol: matchedMarket, 
        duration: parseInt(bot1Config.duration), 
        duration_unit: bot1Config.durationUnit, 
        basis: 'stake', 
        amount: stake 
      };
      if (['DIGITMATCH', 'DIGITDIFF', 'DIGITOVER', 'DIGITUNDER'].includes(ct)) params.barrier = recoveryConfig.prediction;
      
      try {
        const { contractId } = await derivApi.buyContract(params);
        const tr: TradeRecord = { 
          id: contractId, 
          time: Date.now(), 
          type: ct, 
          stake, 
          profit: 0, 
          status: 'open', 
          symbol: matchedMarket,
          marketName: getMarketName(matchedMarket),
          botId: 'auto-scan' 
        };
        setTradeHistory(prev => [tr, ...prev].slice(0, 100));
        
        const result = await derivApi.waitForContractResult(contractId);
        const resultDigit = getLastDigit(result.price || 0);
        setTradeHistory(prev => prev.map(t => t.id === contractId ? { ...t, profit: result.profit, status: result.status, resultDigit } : t));
        
        if (result.status === 'won') {
          toast.success(`🎉 AUTO-TRADE WON! +$${result.profit.toFixed(2)} | ${getMarketName(matchedMarket)} | Digit: ${resultDigit}`);
          if (voiceEnabled) speak(`Auto-trade won. Profit ${result.profit.toFixed(2)} dollars`);
        } else {
          toast.error(`❌ AUTO-TRADE LOST -$${Math.abs(result.profit).toFixed(2)} | ${getMarketName(matchedMarket)} | Digit: ${resultDigit}`);
          if (voiceEnabled) speak(`Auto-trade lost. Loss ${Math.abs(result.profit).toFixed(2)} dollars`);
        }
      } catch (err: any) {
        toast.error(`Auto-trade error: ${err.message}`);
      }
      
      setTimeout(() => setAutoTradeExecuted(false), 5000);
    } else if (!foundMatch) {
      // Silent scan - no toast to avoid spam
    }
  }, [recoveryStrategy, autoScanAndTrade, autoTradeExecuted, recoveryActive, bot1Config, recoveryConfig, voiceEnabled, speak, checkConditionOnMarket]);

  useEffect(() => {
    if (autoScanAndTrade && recoveryStrategy.enabled && !scanningMarkets && !autoTradeExecuted && !recoveryActive) {
      const interval = setInterval(() => {
        scanAndAutoTrade();
      }, 3000);
      return () => clearInterval(interval);
    }
  }, [autoScanAndTrade, recoveryStrategy.enabled, scanningMarkets, autoTradeExecuted, recoveryActive, scanAndAutoTrade]);

  useEffect(() => {
    let active = true;
    subscribedRef.current = false;

    const load = async () => {
      if (!derivApi.isConnected) { setIsLoading(false); return; }
      setIsLoading(true);
      try {
        const hist = await derivApi.getTickHistory(symbol as MarketSymbol, 5000);
        if (!active) return;
        
        const historicalDigits = (hist.history.prices || []).map(p => getLastDigit(p));
        tickHistoryRef[symbol] = historicalDigits.slice(-200);
        
        setPrices(hist.history.prices || []);
        setTimes(hist.history.times || []);
        setScrollOffset(0);
        setIsLoading(false);

        if (!subscribedRef.current) {
          subscribedRef.current = true;
          await derivApi.subscribeTicks(symbol as MarketSymbol, (data: any) => {
            if (!active || !data.tick) return;
            const quote = data.tick.quote;
            const digit = getLastDigit(quote);
            addTick(symbol, digit);
            setPrices(prev => [...prev, quote].slice(-5000));
            setTimes(prev => [...prev, data.tick.epoch].slice(-5000));
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

  const tfTicks = TF_TICKS[timeframe] || 60;
  const tfPrices = useMemo(() => prices.slice(-tfTicks), [prices, tfTicks]);
  const tfTimes = useMemo(() => times.slice(-tfTicks), [times, tfTicks]);
  const candles = useMemo(() => buildCandles(tfPrices, tfTimes, timeframe), [tfPrices, tfTimes, timeframe]);
  const currentPrice = prices[prices.length - 1] || 0;
  const lastDigit = getLastDigit(currentPrice);
  const digits = useMemo(() => tfPrices.map(getLastDigit), [tfPrices]);
  const last26 = useMemo(() => {
    const tickHistory = getTickHistory(symbol);
    return tickHistory.slice(-26);
  }, [symbol, prices]);
  const { frequency, percentages, mostCommon, leastCommon } = useMemo(() => analyzeDigits(tfPrices), [tfPrices]);

  const bb = useMemo(() => calculateBollingerBands(tfPrices, 20), [tfPrices]);
  const ema50 = useMemo(() => calcEMA(tfPrices, 50), [tfPrices]);
  const { support, resistance } = useMemo(() => calcSR(tfPrices), [tfPrices]);
  const rsi = useMemo(() => calculateRSI(tfPrices, 14), [tfPrices]);
  const macd = useMemo(() => calcMACDFull(tfPrices), [tfPrices]);

  const evenCount = useMemo(() => digits.filter(d => d % 2 === 0).length, [digits]);
  const oddCount = digits.length - evenCount;
  const evenPct = digits.length > 0 ? (evenCount / digits.length * 100) : 50;
  const oddPct = 100 - evenPct;
  const overCount = useMemo(() => digits.filter(d => d > 4).length, [digits]);
  const underCount = digits.length - overCount;
  const overPct = digits.length > 0 ? (overCount / digits.length * 100) : 50;
  const underPct = 100 - overPct;

  const bbRange = bb.upper - bb.lower || 1;
  const bbPosition = ((currentPrice - bb.lower) / bbRange * 100);

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
    const bestPct = Math.max(...percentages);
    return { digit: mostCommon, confidence: Math.min(90, Math.round(bestPct * 3)) };
  }, [percentages, mostCommon]);

  const cleanPattern1 = bot1Strategy.patternInput.toUpperCase().replace(/[^EO]/g, '');
  const patternValid1 = cleanPattern1.length >= 2;

  const checkPatternMatch1 = useCallback((): boolean => {
    const ticks = getTickHistory(bot1Config.botSymbol);
    if (ticks.length < cleanPattern1.length) return false;
    const recent = ticks.slice(-cleanPattern1.length);
    for (let i = 0; i < cleanPattern1.length; i++) {
      const expected = cleanPattern1[i];
      const actual = recent[i] % 2 === 0 ? 'E' : 'O';
      if (expected !== actual) return false;
    }
    return true;
  }, [bot1Config.botSymbol, cleanPattern1]);

  const checkDigitCondition1 = useCallback((): boolean => {
    const ticks = getTickHistory(bot1Config.botSymbol);
    const win = parseInt(bot1Strategy.digitWindow) || 3;
    const comp = parseInt(bot1Strategy.digitCompare);
    if (ticks.length < win) return false;
    const recent = ticks.slice(-win);
    return recent.every(d => {
      switch (bot1Strategy.digitCondition) {
        case '>': return d > comp;
        case '<': return d < comp;
        case '>=': return d >= comp;
        case '<=': return d <= comp;
        case '==': return d === comp;
        case '!=': return d !== comp;
        default: return false;
      }
    });
  }, [bot1Config.botSymbol, bot1Strategy.digitCondition, bot1Strategy.digitCompare, bot1Strategy.digitWindow]);

  const checkStrategyCondition1 = useCallback((): boolean => {
    const strategyToUse = globalStrategyEnabled ? (bot1Strategy.enabled ? bot1Strategy : recoveryStrategy) : bot1Strategy;
    if (!strategyToUse.enabled) return true;
    if (strategyToUse.mode === 'pattern') {
      const pattern = strategyToUse.patternInput.toUpperCase().replace(/[^EO]/g, '');
      const ticks = getTickHistory(bot1Config.botSymbol);
      if (ticks.length < pattern.length) return false;
      const recent = ticks.slice(-pattern.length);
      for (let i = 0; i < pattern.length; i++) {
        const expected = pattern[i];
        const actual = recent[i] % 2 === 0 ? 'E' : 'O';
        if (expected !== actual) return false;
      }
      return true;
    } else {
      const win = parseInt(strategyToUse.digitWindow) || 3;
      const comp = parseInt(strategyToUse.digitCompare);
      const ticks = getTickHistory(bot1Config.botSymbol);
      if (ticks.length < win) return false;
      const recent = ticks.slice(-win);
      return recent.every(d => {
        switch (strategyToUse.digitCondition) {
          case '>': return d > comp;
          case '<': return d < comp;
          case '>=': return d >= comp;
          case '<=': return d <= comp;
          case '==': return d === comp;
          case '!=': return d !== comp;
          default: return false;
        }
      });
    }
  }, [bot1Config.botSymbol, bot1Strategy, recoveryStrategy, globalStrategyEnabled]);

  const cleanPatternRecovery = recoveryStrategy.patternInput.toUpperCase().replace(/[^EO]/g, '');
  const patternValidRecovery = cleanPatternRecovery.length >= 2;

  const checkRecoveryStrategyCondition = useCallback((): boolean => {
    const strategyToUse = globalStrategyEnabled ? (recoveryStrategy.enabled ? recoveryStrategy : bot1Strategy) : recoveryStrategy;
    if (!strategyToUse.enabled) return true;
    if (strategyToUse.mode === 'pattern') {
      const pattern = strategyToUse.patternInput.toUpperCase().replace(/[^EO]/g, '');
      const ticks = getTickHistory(recoveryConfig.recoverySymbol);
      if (ticks.length < pattern.length) return false;
      const recent = ticks.slice(-pattern.length);
      for (let i = 0; i < pattern.length; i++) {
        const expected = pattern[i];
        const actual = recent[i] % 2 === 0 ? 'E' : 'O';
        if (expected !== actual) return false;
      }
      return true;
    } else {
      const win = parseInt(strategyToUse.digitWindow) || 3;
      const comp = parseInt(strategyToUse.digitCompare);
      const ticks = getTickHistory(recoveryConfig.recoverySymbol);
      if (ticks.length < win) return false;
      const recent = ticks.slice(-win);
      return recent.every(d => {
        switch (strategyToUse.digitCondition) {
          case '>': return d > comp;
          case '<': return d < comp;
          case '>=': return d >= comp;
          case '<=': return d <= comp;
          case '==': return d === comp;
          case '!=': return d !== comp;
          default: return false;
        }
      });
    }
  }, [recoveryConfig.recoverySymbol, recoveryStrategy, bot1Strategy, globalStrategyEnabled]);

  const candleEndIndices = useMemo(() => mapCandlesToPriceIndices(tfPrices, tfTimes, timeframe), [tfPrices, tfTimes, timeframe]);
  const emaSeries = useMemo(() => calcEMASeries(tfPrices, 50), [tfPrices]);
  const smaSeries = useMemo(() => calcSMASeries(tfPrices, 20), [tfPrices]);
  const bbSeries = useMemo(() => calcBBSeries(tfPrices, 20, 2), [tfPrices]);
  const rsiSeries = useMemo(() => calcRSISeries(tfPrices, 14), [tfPrices]);

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
    drawLine(emaSeries, '#2F81F7', 1.5);
    drawLine(smaSeries, '#E6B422', 1.5);

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
      { label: 'BB(20,2)', color: '#BC8CFF' },
      { label: 'SMA 20', color: '#E6B422' },
      { label: 'EMA 50', color: '#2F81F7' },
      { label: 'Support', color: '#3FB950' },
      { label: 'Resistance', color: '#F85149' },
    ];
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

  }, [candles, bb, ema50, support, resistance, currentPrice, candleEndIndices, emaSeries, smaSeries, bbSeries, rsiSeries, rsi, candleWidth, scrollOffset, showChart]);

  const filteredMarkets = groupFilter === 'all' ? ALL_MARKETS : ALL_MARKETS.filter(m => m.group === groupFilter);
  const marketName = ALL_MARKETS.find(m => m.symbol === symbol)?.name || symbol;

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
      const newTrade: TradeRecord = { id: contractId, time: Date.now(), type: ct, stake: parseFloat(tradeStake), profit: 0, status: 'open', symbol, marketName: getMarketName(symbol), botId: 'manual' };
      setTradeHistory(prev => [newTrade, ...prev].slice(0, 50));
      const result = await derivApi.waitForContractResult(contractId);
      const resultDigit = getLastDigit(result.price || currentPrice);
      setTradeHistory(prev => prev.map(t => t.id === contractId ? { ...t, profit: result.profit, status: result.status, resultDigit } : t));
      if (result.status === 'won') { toast.success(`✅ WON +$${result.profit.toFixed(2)} | ${getMarketName(symbol)} | Digit: ${resultDigit}`); if (voiceEnabled) speak(`Trade won. Profit ${result.profit.toFixed(2)} dollars`); }
      else { toast.error(`❌ LOST -$${Math.abs(result.profit).toFixed(2)} | ${getMarketName(symbol)} | Digit: ${resultDigit}`); if (voiceEnabled) speak(`Trade lost. Loss ${Math.abs(result.profit).toFixed(2)} dollars`); }
    } catch (err: any) { toast.error(`Trade failed: ${err.message}`); }
    finally { setIsTrading(false); }
  };

  const executeRecoveryTrade = useCallback(async (stake: number): Promise<boolean> => {
    const ct = recoveryConfig.contractType;
    const params: any = { 
      contract_type: ct, 
      symbol: recoveryConfig.recoverySymbol, 
      duration: parseInt(bot1Config.duration), 
      duration_unit: bot1Config.durationUnit, 
      basis: 'stake', 
      amount: stake 
    };
    if (['DIGITMATCH', 'DIGITDIFF', 'DIGITOVER', 'DIGITUNDER'].includes(ct)) params.barrier = recoveryConfig.prediction;

    try {
      const { contractId } = await derivApi.buyContract(params);
      const tr: TradeRecord = { 
        id: contractId, 
        time: Date.now(), 
        type: ct, 
        stake, 
        profit: 0, 
        status: 'open', 
        symbol: recoveryConfig.recoverySymbol,
        marketName: getMarketName(recoveryConfig.recoverySymbol),
        botId: 'recovery' 
      };
      setTradeHistory(prev => [tr, ...prev].slice(0, 100));
      const result = await derivApi.waitForContractResult(contractId);
      const resultDigit = getLastDigit(result.price || 0);
      setTradeHistory(prev => prev.map(t => t.id === contractId ? { ...t, profit: result.profit, status: result.status, resultDigit } : t));

      if (result.status === 'won') {
        toast.success(`🔄 RECOVERY WON! +$${result.profit.toFixed(2)} | ${getMarketName(recoveryConfig.recoverySymbol)} | Digit: ${resultDigit}`);
        if (voiceEnabled) speak(`Recovery trade won. Profit ${result.profit.toFixed(2)} dollars`);
        return true;
      } else {
        toast.error(`🔄 RECOVERY LOST -$${Math.abs(result.profit).toFixed(2)} | ${getMarketName(recoveryConfig.recoverySymbol)} | Digit: ${resultDigit}`);
        if (voiceEnabled) speak(`Recovery trade lost. Loss ${Math.abs(result.profit).toFixed(2)} dollars`);
        return false;
      }
    } catch (err: any) {
      toast.error(`Recovery trade error: ${err.message}`);
      return false;
    }
  }, [recoveryConfig, bot1Config.duration, bot1Config.durationUnit, voiceEnabled, speak]);

  const startBot1 = useCallback(async () => {
    if (!isAuthorized) { toast.error('Login to Deriv first'); return; }
    setBot1Running(true); setBot1Paused(false);
    bot1RunningRef.current = true; bot1PausedRef.current = false;
    const baseStake = parseFloat(bot1Config.stake) || 1;
    const sl = parseFloat(bot1Config.stopLoss) || 10;
    const tp = parseFloat(bot1Config.takeProfit) || 20;
    const maxT = parseInt(bot1Config.maxTrades) || 50;
    const mart = bot1Config.martingale;
    const mult = parseFloat(bot1Config.multiplier) || 2;
    let stake = baseStake;
    let pnl = 0; let trades = 0; let wins = 0; let losses = 0; let consLosses = 0;

    if (voiceEnabled) speak('Main bot started');

    while (bot1RunningRef.current) {
      if (bot1PausedRef.current) { await new Promise(r => setTimeout(r, 500)); continue; }
      if (trades >= maxT || pnl <= -sl || pnl >= tp) {
        const reason = trades >= maxT ? 'Max trades reached' : pnl <= -sl ? 'Stop loss hit' : 'Take profit reached';
        toast.info(`🤖 Main bot stopped: ${reason}`);
        if (voiceEnabled) speak(`Main bot stopped. ${reason}. Total profit ${pnl.toFixed(2)} dollars`);
        break;
      }

      if (globalStrategyEnabled ? (bot1Strategy.enabled || recoveryStrategy.enabled) : bot1Strategy.enabled) {
        let conditionMet = false;
        while (bot1RunningRef.current && !conditionMet) {
          conditionMet = checkStrategyCondition1();
          if (!conditionMet) {
            await new Promise(r => setTimeout(r, 500));
          }
        }
        if (!bot1RunningRef.current) break;
      }

      const ct = bot1Config.contractType;
      const params: any = { contract_type: ct, symbol: bot1Config.botSymbol, duration: parseInt(bot1Config.duration), duration_unit: bot1Config.durationUnit, basis: 'stake', amount: stake };
      if (['DIGITMATCH', 'DIGITDIFF', 'DIGITOVER', 'DIGITUNDER'].includes(ct)) params.barrier = bot1Config.prediction;

      try {
        const { contractId } = await derivApi.buyContract(params);
        const tr: TradeRecord = { id: contractId, time: Date.now(), type: ct, stake, profit: 0, status: 'open', symbol: bot1Config.botSymbol, marketName: getMarketName(bot1Config.botSymbol), botId: 'main' };
        setTradeHistory(prev => [tr, ...prev].slice(0, 100));
        const result = await derivApi.waitForContractResult(contractId);
        trades++; pnl += result.profit;
        const resultDigit = getLastDigit(result.price || 0);
        setTradeHistory(prev => prev.map(t => t.id === contractId ? { ...t, profit: result.profit, status: result.status, resultDigit } : t));

        if (result.status === 'won') {
          wins++; consLosses = 0;
          stake = baseStake;
          if (voiceEnabled && trades % 5 === 0) speak(`Main bot trade ${trades} won. Total profit ${pnl.toFixed(2)}`);
          toast.success(`✅ MAIN BOT WON! +$${result.profit.toFixed(2)} | ${getMarketName(bot1Config.botSymbol)} | Digit: ${resultDigit}`);
        } else {
          losses++; consLosses++;
          
          if (recoveryEnabled && !recoveryActive) {
            toast.warning(`🔄 Loss detected! Activating Recovery Bot on ${getMarketName(recoveryConfig.recoverySymbol)}`);
            if (voiceEnabled) speak(`Loss detected. Activating recovery bot on ${getMarketName(recoveryConfig.recoverySymbol)}`);
            setRecoveryActive(true);
            setRecoveryAttempts(1);
            
            let recoveryStake = parseFloat(bot1Config.stake);
            if (mart) {
              recoveryStake = recoveryStake * mult;
            } else {
              recoveryStake = recoveryStake * 2;
            }
            setRecoveryCurrentStake(recoveryStake);
            
            if (globalStrategyEnabled ? (recoveryStrategy.enabled || bot1Strategy.enabled) : recoveryStrategy.enabled) {
              let recoveryConditionMet = false;
              while (bot1RunningRef.current && !recoveryConditionMet) {
                recoveryConditionMet = checkRecoveryStrategyCondition();
                if (!recoveryConditionMet) {
                  await new Promise(r => setTimeout(r, 500));
                }
              }
              if (!bot1RunningRef.current) break;
            }
            
            const recoveryWon = await executeRecoveryTrade(recoveryStake);
            
            if (recoveryWon) {
              toast.success(`🎉 Recovery successful! Returning to main bot on ${getMarketName(bot1Config.botSymbol)}`);
              if (voiceEnabled) speak(`Recovery successful. Returning to main bot.`);
              setRecoveryActive(false);
              setRecoveryAttempts(0);
              setRecoveryCurrentStake(0);
              stake = baseStake;
            } else {
              let newAttempts = 2;
              let recoveryStakeAmount = recoveryStake;
              let recoverySuccess = false;
              
              while (newAttempts <= 5 && !recoverySuccess && bot1RunningRef.current) {
                if (mart) {
                  recoveryStakeAmount = recoveryStakeAmount * mult;
                } else {
                  recoveryStakeAmount = recoveryStakeAmount * 2;
                }
                
                setRecoveryAttempts(newAttempts);
                setRecoveryCurrentStake(recoveryStakeAmount);
                
                toast.warning(`🔄 Recovery Attempt ${newAttempts}/5 - Stake: $${recoveryStakeAmount.toFixed(2)} on ${getMarketName(recoveryConfig.recoverySymbol)}`);
                if (voiceEnabled) speak(`Recovery attempt ${newAttempts}. Stake ${recoveryStakeAmount.toFixed(2)} dollars`);
                
                if (globalStrategyEnabled ? (recoveryStrategy.enabled || bot1Strategy.enabled) : recoveryStrategy.enabled) {
                  let recoveryConditionMet = false;
                  while (bot1RunningRef.current && !recoveryConditionMet) {
                    recoveryConditionMet = checkRecoveryStrategyCondition();
                    if (!recoveryConditionMet) {
                      await new Promise(r => setTimeout(r, 500));
                    }
                  }
                  if (!bot1RunningRef.current) break;
                }
                
                recoverySuccess = await executeRecoveryTrade(recoveryStakeAmount);
                
                if (recoverySuccess) {
                  toast.success(`🎉 Recovery successful on attempt ${newAttempts}! Returning to main bot.`);
                  if (voiceEnabled) speak(`Recovery successful on attempt ${newAttempts}. Returning to main bot.`);
                  break;
                }
                
                newAttempts++;
                await new Promise(r => setTimeout(r, 1000));
              }
              
              if (recoverySuccess) {
                setRecoveryActive(false);
                setRecoveryAttempts(0);
                setRecoveryCurrentStake(0);
                stake = baseStake;
              } else {
                toast.error(`❌ Recovery failed after 5 attempts! Stopping both bots.`);
                if (voiceEnabled) speak(`Recovery failed after 5 attempts. Stopping all bots.`);
                bot1RunningRef.current = false;
                setBot1Running(false);
                setRecoveryActive(false);
                break;
              }
            }
          } else if (mart && !recoveryActive) {
            stake = Math.round(stake * mult * 100) / 100;
            if (voiceEnabled) speak(`Main bot loss ${consLosses}. Martingale stake ${stake.toFixed(2)}`);
          } else if (!recoveryActive) {
            stake = baseStake;
          }
        }
        setBot1Stats({ trades, wins, losses, pnl, currentStake: stake, consecutiveLosses: consLosses });
      } catch (err: any) {
        toast.error(`Main bot error: ${err.message}`);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    setBot1Running(false); bot1RunningRef.current = false;
    setRecoveryActive(false);
    setRecoveryAttempts(0);
    setBot1Stats(prev => ({ ...prev, trades, wins, losses, pnl }));
  }, [isAuthorized, bot1Config, voiceEnabled, speak, bot1Strategy, recoveryStrategy, globalStrategyEnabled, checkStrategyCondition1, checkRecoveryStrategyCondition, recoveryEnabled, recoveryConfig, executeRecoveryTrade]);

  const stopBot1 = useCallback(() => { 
    bot1RunningRef.current = false; 
    setBot1Running(false); 
    setRecoveryActive(false);
    setRecoveryAttempts(0);
    toast.info('🛑 Main bot stopped'); 
  }, []);
  
  const togglePauseBot1 = useCallback(() => { 
    bot1PausedRef.current = !bot1PausedRef.current; 
    setBot1Paused(bot1PausedRef.current); 
  }, []);

  const totalTrades = tradeHistory.filter(t => t.status !== 'open').length;
  const wins = tradeHistory.filter(t => t.status === 'won').length;
  const losses = tradeHistory.filter(t => t.status === 'lost').length;
  const totalProfit = tradeHistory.reduce((s, t) => s + t.profit, 0);
  const winRate = totalTrades > 0 ? (wins / totalTrades * 100) : 0;

  return (
    <div className="space-y-4 max-w-[1920px] mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-primary" /> Trading Chart
          </h1>
          <p className="text-xs text-muted-foreground">{marketName} • {timeframe} • {tfPrices.length} ticks</p>
        </div>
        <div className="flex items-center gap-2">
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
        <div className="xl:col-span-7 space-y-3">
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
                    {isBestMatch && <Badge className="absolute -top-1 -right-1 text-[7px] px-1 bg-profit text-profit-foreground">Match Digit</Badge>}
                    {isBestDiffer && <Badge className="absolute -top-1 -left-1 text-[7px] px-1 bg-loss text-loss-foreground">Differ</Badge>}
                  </button>
                );
              })}
            </div>
          </div>

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

        <div className="xl:col-span-5 space-y-3">
          <div className="bg-card border border-primary/30 rounded-xl p-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-foreground flex items-center gap-1">
                <Zap className="w-3.5 h-3.5 text-primary" /> AI Voice Signals
              </h3>
              <Button size="sm" variant={voiceEnabled ? 'default' : 'outline'} className="h-7 text-[10px] gap-1"
                onClick={() => {
                  setVoiceEnabled(!voiceEnabled);
                  if (!voiceEnabled) {
                    const u = new SpeechSynthesisUtterance('Voice signals enabled');
                    u.rate = 1.1;
                    window.speechSynthesis?.speak(u);
                  } else {
                    window.speechSynthesis?.cancel();
                  }
                }}>
                {voiceEnabled ? <Volume2 className="w-3 h-3" /> : <VolumeX className="w-3 h-3" />}
                {voiceEnabled ? 'ON' : 'OFF'}
              </Button>
            </div>
          </div>

          <div className="bg-card border border-warning/30 rounded-xl p-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-foreground flex items-center gap-1">
                <Globe className="w-3.5 h-3.5 text-warning" /> Global Strategy
              </h3>
              <div className="flex items-center gap-2">
                <Switch checked={globalStrategyEnabled} onCheckedChange={setGlobalStrategyEnabled} disabled={bot1Running} />
                <span className="text-[8px] text-muted-foreground">Apply to all markets</span>
              </div>
            </div>
            {globalStrategyEnabled && (
              <p className="text-[8px] text-warning mt-1">⚡ Strategy from {bot1Strategy.enabled ? 'Main Bot' : 'Recovery Bot'} will be used for both markets</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="bg-card border border-border rounded-xl p-3">
              <div className="flex items-center gap-1 mb-1">
                {riseSignal.direction === 'Rise' ? <TrendingUp className="w-3.5 h-3.5 text-profit" /> : <TrendingDown className="w-3.5 h-3.5 text-loss" />}
                <span className="text-[10px] font-semibold">Rise/Fall</span>
              </div>
              <div className={`font-mono text-sm font-bold ${riseSignal.direction === 'Rise' ? 'text-profit' : 'text-loss'}`}>{riseSignal.direction}</div>
              <div className="text-[8px] text-muted-foreground mb-1">RSI: {rsi.toFixed(1)}</div>
              <div className="h-1.5 bg-muted rounded-full">
                <div className={`h-full rounded-full ${riseSignal.direction === 'Rise' ? 'bg-profit' : 'bg-loss'}`} style={{ width: `${riseSignal.confidence}%` }} />
              </div>
              <div className="text-[8px] text-right text-muted-foreground mt-0.5">{riseSignal.confidence}%</div>
            </div>

            <div className="bg-card border border-border rounded-xl p-3">
              <div className="flex items-center gap-1 mb-1">
                <Activity className="w-3.5 h-3.5 text-primary" />
                <span className="text-[10px] font-semibold">Even/Odd</span>
              </div>
              <div className={`font-mono text-sm font-bold ${eoSignal.direction === 'Even' ? 'text-[#3FB950]' : 'text-[#D29922]'}`}>{eoSignal.direction}</div>
              <div className="text-[8px] text-muted-foreground mb-1">{evenPct.toFixed(1)}% even</div>
              <div className="h-1.5 bg-muted rounded-full">
                <div className={`h-full rounded-full ${eoSignal.direction === 'Even' ? 'bg-[#3FB950]' : 'bg-[#D29922]'}`} style={{ width: `${eoSignal.confidence}%` }} />
              </div>
              <div className="text-[8px] text-right text-muted-foreground mt-0.5">{eoSignal.confidence}%</div>
            </div>

            <div className="bg-card border border-border rounded-xl p-3">
              <div className="flex items-center gap-1 mb-1">
                <ArrowUp className="w-3.5 h-3.5 text-primary" />
                <span className="text-[10px] font-semibold">Over/Under</span>
              </div>
              <div className={`font-mono text-sm font-bold ${ouSignal.direction === 'Over' ? 'text-primary' : 'text-[#D29922]'}`}>{ouSignal.direction}</div>
              <div className="text-[8px] text-muted-foreground mb-1">{overPct.toFixed(1)}% over</div>
              <div className="h-1.5 bg-muted rounded-full">
                <div className={`h-full rounded-full ${ouSignal.direction === 'Over' ? 'bg-primary' : 'bg-[#D29922]'}`} style={{ width: `${ouSignal.confidence}%` }} />
              </div>
              <div className="text-[8px] text-right text-muted-foreground mt-0.5">{ouSignal.confidence}%</div>
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
              <div className="text-[8px] text-right text-muted-foreground mt-0.5">{matchSignal.confidence}%</div>
            </div>
          </div>

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

          <div className={`bg-card border rounded-xl p-3 space-y-2 ${bot1Running ? 'border-profit glow-profit' : 'border-border'}`}>
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-foreground flex items-center gap-1">
                <Bot className="w-3.5 h-3.5 text-primary" /> Ramzfx Speed Bot (Main)
              </h3>
              {bot1Running && (
                <motion.div animate={{ opacity: [0.4, 1, 0.4] }} transition={{ repeat: Infinity, duration: 1.5 }}>
                  <Badge className="text-[8px] bg-profit text-profit-foreground">RUNNING</Badge>
                </motion.div>
              )}
            </div>

            <div>
              <label className="text-[9px] text-muted-foreground">Market</label>
              <Select value={bot1Config.botSymbol} onValueChange={(v) => setBot1Config(prev => ({ ...prev, botSymbol: v }))} disabled={bot1Running}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-60">
                  {ALL_MARKETS.map(m => (<SelectItem key={m.symbol} value={m.symbol}>{m.name}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>

            <Select value={bot1Config.contractType} onValueChange={v => setBot1Config(prev => ({ ...prev, contractType: v }))} disabled={bot1Running}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{CONTRACT_TYPES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
            </Select>

            {['DIGITMATCH','DIGITDIFF','DIGITOVER','DIGITUNDER'].includes(bot1Config.contractType) && (
              <div>
                <label className="text-[9px] text-muted-foreground">Prediction (0-9)</label>
                <div className="grid grid-cols-5 gap-1">
                  {Array.from({ length: 10 }, (_, i) => (
                    <button key={i} disabled={bot1Running} onClick={() => setBot1Config(prev => ({ ...prev, prediction: String(i) }))}
                      className={`h-6 rounded text-[10px] font-mono font-bold transition-all ${
                        bot1Config.prediction === String(i) ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground hover:bg-secondary'
                      }`}>{i}</button>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[9px] text-muted-foreground">Stake ($)</label>
                <Input type="number" min="0.35" step="0.01" value={bot1Config.stake}
                  onChange={e => setBot1Config(prev => ({ ...prev, stake: e.target.value }))} disabled={bot1Running} className="h-7 text-xs" />
              </div>
              <div>
                <label className="text-[9px] text-muted-foreground">Duration</label>
                <div className="flex gap-1">
                  <Input type="number" min="1" value={bot1Config.duration}
                    onChange={e => setBot1Config(prev => ({ ...prev, duration: e.target.value }))} disabled={bot1Running} className="h-7 text-xs flex-1" />
                  <Select value={bot1Config.durationUnit} onValueChange={v => setBot1Config(prev => ({ ...prev, durationUnit: v }))} disabled={bot1Running}>
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
                {bot1Config.martingale && (
                  <Input type="number" min="1.1" step="0.1" value={bot1Config.multiplier}
                    onChange={e => setBot1Config(prev => ({ ...prev, multiplier: e.target.value }))} disabled={bot1Running}
                    className="h-6 text-[10px] w-14" />
                )}
                <button onClick={() => setBot1Config(prev => ({ ...prev, martingale: !prev.martingale }))} disabled={bot1Running}
                  className={`w-9 h-5 rounded-full transition-colors ${bot1Config.martingale ? 'bg-primary' : 'bg-muted'} relative`}>
                  <div className={`w-4 h-4 rounded-full bg-background shadow absolute top-0.5 transition-transform ${bot1Config.martingale ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </button>
              </div>
            </div>

            <div className="border-t border-border pt-2 mt-1">
              <div className="flex items-center justify-between mb-2">
                <label className="text-[10px] font-semibold text-warning flex items-center gap-1">
                  <Zap className="w-3 h-3" /> Pattern/Digit Strategy
                </label>
                <Switch checked={bot1Strategy.enabled} onCheckedChange={(v) => setBot1Strategy(prev => ({ ...prev, enabled: v }))} disabled={bot1Running} />
              </div>

              {bot1Strategy.enabled && (
                <div className="space-y-2">
                  <div className="flex gap-1">
                    <Button size="sm" variant={bot1Strategy.mode === 'pattern' ? 'default' : 'outline'} className="text-[9px] h-6 px-2 flex-1"
                      onClick={() => setBot1Strategy(prev => ({ ...prev, mode: 'pattern' }))} disabled={bot1Running}>Pattern (E/O)</Button>
                    <Button size="sm" variant={bot1Strategy.mode === 'digit' ? 'default' : 'outline'} className="text-[9px] h-6 px-2 flex-1"
                      onClick={() => setBot1Strategy(prev => ({ ...prev, mode: 'digit' }))} disabled={bot1Running}>Digit Condition</Button>
                  </div>

                  {bot1Strategy.mode === 'pattern' ? (
                    <div>
                      <label className="text-[8px] text-muted-foreground">Pattern (E=Even, O=Odd)</label>
                      <Textarea placeholder="e.g., EEEOE or OOEEO" value={bot1Strategy.patternInput}
                        onChange={e => setBot1Strategy(prev => ({ ...prev, patternInput: e.target.value.toUpperCase().replace(/[^EO]/g, '') }))}
                        disabled={bot1Running} className="h-12 text-[10px] font-mono min-h-0 mt-1" />
                      <div className={`text-[9px] font-mono mt-1 ${patternValid1 ? 'text-profit' : 'text-loss'}`}>
                        {cleanPattern1.length === 0 ? 'Enter pattern (min 2 characters)' : patternValid1 ? `✓ Pattern: ${cleanPattern1}` : `✗ Need at least 2 characters (E/O)`}
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-1">
                      <div>
                        <label className="text-[8px] text-muted-foreground">If last</label>
                        <Input type="number" min="1" max="50" value={bot1Strategy.digitWindow}
                          onChange={e => setBot1Strategy(prev => ({ ...prev, digitWindow: e.target.value }))} disabled={bot1Running} className="h-7 text-[10px]" />
                      </div>
                      <div>
                        <label className="text-[8px] text-muted-foreground">ticks are</label>
                        <Select value={bot1Strategy.digitCondition} onValueChange={(v) => setBot1Strategy(prev => ({ ...prev, digitCondition: v }))} disabled={bot1Running}>
                          <SelectTrigger className="h-7 text-[10px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {['==', '!=', '>', '<', '>=', '<='].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <label className="text-[8px] text-muted-foreground">Digit</label>
                        <Input type="number" min="0" max="9" value={bot1Strategy.digitCompare}
                          onChange={e => setBot1Strategy(prev => ({ ...prev, digitCompare: e.target.value }))} disabled={bot1Running} className="h-7 text-[10px]" />
                      </div>
                    </div>
                  )}
                  <div className="text-[8px] text-muted-foreground text-center py-1">
                    Bot will wait for {bot1Strategy.mode === 'pattern' ? 'pattern match' : 'digit condition'} before each trade
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              <div>
                <label className="text-[8px] text-muted-foreground">Stop Loss</label>
                <Input type="number" value={bot1Config.stopLoss} onChange={e => setBot1Config(prev => ({ ...prev, stopLoss: e.target.value }))}
                  disabled={bot1Running} className="h-7 text-xs" />
              </div>
              <div>
                <label className="text-[8px] text-muted-foreground">Take Profit</label>
                <Input type="number" value={bot1Config.takeProfit} onChange={e => setBot1Config(prev => ({ ...prev, takeProfit: e.target.value }))}
                  disabled={bot1Running} className="h-7 text-xs" />
              </div>
              <div>
                <label className="text-[8px] text-muted-foreground">Max Trades</label>
                <Input type="number" value={bot1Config.maxTrades} onChange={e => setBot1Config(prev => ({ ...prev, maxTrades: e.target.value }))}
                  disabled={bot1Running} className="h-7 text-xs" />
              </div>
            </div>

            {bot1Running && (
              <div className="grid grid-cols-3 gap-1 text-center">
                <div className="bg-muted/30 rounded p-1">
                  <div className="text-[7px] text-muted-foreground">Stake</div>
                  <div className="font-mono text-[10px] font-bold text-foreground">${bot1Stats.currentStake.toFixed(2)}</div>
                </div>
                <div className="bg-muted/30 rounded p-1">
                  <div className="text-[7px] text-muted-foreground">Streak</div>
                  <div className="font-mono text-[10px] font-bold text-loss">{bot1Stats.consecutiveLosses}L</div>
                </div>
                <div className={`${bot1Stats.pnl >= 0 ? 'bg-profit/10' : 'bg-loss/10'} rounded p-1`}>
                  <div className="text-[7px] text-muted-foreground">P/L</div>
                  <div className={`font-mono text-[10px] font-bold ${bot1Stats.pnl >= 0 ? 'text-profit' : 'text-loss'}`}>
                    {bot1Stats.pnl >= 0 ? '+' : ''}{bot1Stats.pnl.toFixed(2)}
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              {!bot1Running ? (
                <Button onClick={startBot1} disabled={!isAuthorized} className="flex-1 h-10 text-xs font-bold bg-profit hover:bg-profit/90 text-profit-foreground">
                  <Play className="w-4 h-4 mr-1" /> Start Main Bot
                </Button>
              ) : (
                <>
                  <Button onClick={togglePauseBot1} variant="outline" className="flex-1 h-10 text-xs">
                    <Pause className="w-3.5 h-3.5 mr-1" /> {bot1Paused ? 'Resume' : 'Pause'}
                  </Button>
                  <Button onClick={stopBot1} variant="destructive" className="flex-1 h-10 text-xs">
                    <StopCircle className="w-3.5 h-3.5 mr-1" /> Stop
                  </Button>
                </>
              )}
            </div>
          </div>

          <div className={`bg-card border rounded-xl p-3 space-y-2 ${recoveryActive ? 'border-warning animate-pulse' : 'border-border'}`}>
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-foreground flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5 text-warning" /> Auto Scan & Trade Bot
              </h3>
              <div className="flex items-center gap-2">
                <Switch checked={recoveryEnabled} onCheckedChange={setRecoveryEnabled} disabled={bot1Running} />
                <span className="text-[8px] text-muted-foreground">Enable Scanner</span>
              </div>
            </div>

            {recoveryEnabled && (
              <>
                <div className="flex items-center justify-between border-t border-border pt-2 mt-1">
                  <div className="flex items-center gap-2">
                    <Search className="w-3.5 h-3.5 text-primary" />
                    <span className="text-[9px] text-foreground">Auto Scan & Trade</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch 
                      checked={autoScanAndTrade} 
                      onCheckedChange={(checked) => {
                        setAutoScanAndTrade(checked);
                        if (checked) {
                          toast.info('Auto-scan mode activated - will trade immediately when market matches condition');
                          if (voiceEnabled) speak('Auto-scan mode activated');
                          scanAndAutoTrade();
                        } else {
                          toast.info('Auto-scan mode deactivated');
                        }
                      }} 
                      disabled={bot1Running || !recoveryStrategy.enabled}
                    />
                    <span className="text-[8px] text-muted-foreground">Auto trade on match</span>
                  </div>
                </div>

                {scanningMarkets && (
                  <div className="text-center py-2 bg-warning/10 rounded">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary mx-auto mb-1"></div>
                    <span className="text-[8px] text-warning">Scanning markets for condition...</span>
                  </div>
                )}

                {autoScanAndTrade && !scanningMarkets && (
                  <div className="bg-success/10 border border-success/30 rounded p-2 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <Sparkles className="w-3 h-3 text-success animate-pulse" />
                      <span className="text-[8px] text-success">Auto-scan active - Will trade instantly when condition matches any market</span>
                    </div>
                  </div>
                )}

                <div>
                  <label className="text-[9px] text-muted-foreground">Fallback Market (if no match found)</label>
                  <Select value={recoveryConfig.recoverySymbol} onValueChange={(v) => setRecoveryConfig(prev => ({ ...prev, recoverySymbol: v }))} disabled={bot1Running || autoScanAndTrade}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent className="max-h-60">
                      {ALL_MARKETS.map(m => (<SelectItem key={m.symbol} value={m.symbol}>{m.name}</SelectItem>))}
                    </SelectContent>
                  </Select>
                  {autoScanAndTrade && (
                    <p className="text-[8px] text-muted-foreground mt-1">⚠️ Auto-scan overrides fallback market</p>
                  )}
                </div>

                <Select value={recoveryConfig.contractType} onValueChange={v => setRecoveryConfig(prev => ({ ...prev, contractType: v }))} disabled={bot1Running}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{CONTRACT_TYPES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
                </Select>

                {['DIGITMATCH','DIGITDIFF','DIGITOVER','DIGITUNDER'].includes(recoveryConfig.contractType) && (
                  <div>
                    <label className="text-[9px] text-muted-foreground">Prediction (0-9)</label>
                    <div className="grid grid-cols-5 gap-1">
                      {Array.from({ length: 10 }, (_, i) => (
                        <button key={i} disabled={bot1Running} onClick={() => setRecoveryConfig(prev => ({ ...prev, prediction: String(i) }))}
                          className={`h-6 rounded text-[10px] font-mono font-bold transition-all ${
                            recoveryConfig.prediction === String(i) ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground hover:bg-secondary'
                          }`}>{i}</button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="border-t border-border pt-2 mt-1">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-[10px] font-semibold text-warning flex items-center gap-1">
                      <Zap className="w-3 h-3" /> Pattern/Digit Strategy
                    </label>
                    <Switch checked={recoveryStrategy.enabled} onCheckedChange={(v) => setRecoveryStrategy(prev => ({ ...prev, enabled: v }))} disabled={bot1Running} />
                  </div>

                  {recoveryStrategy.enabled && (
                    <div className="space-y-2">
                      <div className="flex gap-1">
                        <Button size="sm" variant={recoveryStrategy.mode === 'pattern' ? 'default' : 'outline'} className="text-[9px] h-6 px-2 flex-1"
                          onClick={() => setRecoveryStrategy(prev => ({ ...prev, mode: 'pattern' }))} disabled={bot1Running}>Pattern (E/O)</Button>
                        <Button size="sm" variant={recoveryStrategy.mode === 'digit' ? 'default' : 'outline'} className="text-[9px] h-6 px-2 flex-1"
                          onClick={() => setRecoveryStrategy(prev => ({ ...prev, mode: 'digit' }))} disabled={bot1Running}>Digit Condition</Button>
                      </div>

                      {recoveryStrategy.mode === 'pattern' ? (
                        <div>
                          <label className="text-[8px] text-muted-foreground">Pattern (E=Even, O=Odd)</label>
                          <Textarea placeholder="e.g., EEEOE or OOEEO" value={recoveryStrategy.patternInput}
                            onChange={e => setRecoveryStrategy(prev => ({ ...prev, patternInput: e.target.value.toUpperCase().replace(/[^EO]/g, '') }))}
                            disabled={bot1Running} className="h-12 text-[10px] font-mono min-h-0 mt-1" />
                          <div className={`text-[9px] font-mono mt-1 ${patternValidRecovery ? 'text-profit' : 'text-loss'}`}>
                            {cleanPatternRecovery.length === 0 ? 'Enter pattern (min 2 characters)' : patternValidRecovery ? `✓ Pattern: ${cleanPatternRecovery}` : `✗ Need at least 2 characters (E/O)`}
                          </div>
                        </div>
                      ) : (
                        <div className="grid grid-cols-3 gap-1">
                          <div>
                            <label className="text-[8px] text-muted-foreground">If last</label>
                            <Input type="number" min="1" max="50" value={recoveryStrategy.digitWindow}
                              onChange={e => setRecoveryStrategy(prev => ({ ...prev, digitWindow: e.target.value }))} disabled={bot1Running} className="h-7 text-[10px]" />
                          </div>
                          <div>
                            <label className="text-[8px] text-muted-foreground">ticks are</label>
                            <Select value={recoveryStrategy.digitCondition} onValueChange={(v) => setRecoveryStrategy(prev => ({ ...prev, digitCondition: v }))} disabled={bot1Running}>
                              <SelectTrigger className="h-7 text-[10px]"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {['==', '!=', '>', '<', '>=', '<='].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <label className="text-[8px] text-muted-foreground">Digit</label>
                            <Input type="number" min="0" max="9" value={recoveryStrategy.digitCompare}
                              onChange={e => setRecoveryStrategy(prev => ({ ...prev, digitCompare: e.target.value }))} disabled={bot1Running}
                              className="h-7 text-[10px]" />
                          </div>
                        </div>
                      )}
                      <div className="text-[8px] text-muted-foreground text-center py-1">
                        Scanner will check all markets for {recoveryStrategy.mode === 'pattern' ? 'pattern match' : 'digit condition'} every 3 seconds
                      </div>
                      
                      <Button size="sm" variant="outline" className="w-full text-[8px] h-6" onClick={scanAndAutoTrade} disabled={bot1Running || scanningMarkets}>
                        <Search className="w-3 h-3 mr-1" /> Scan Now
                      </Button>
                    </div>
                  )}
                </div>

                <div className="text-[8px] text-muted-foreground text-center py-1 bg-muted/30 rounded">
                  ⚡ Uses Main Bot duration ({bot1Config.duration}{bot1Config.durationUnit}) and stake (${bot1Config.stake})
                </div>
              </>
            )}
          </div>

          <div className="bg-card border border-border rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-foreground flex items-center gap-1">
                <Trophy className="w-3.5 h-3.5 text-primary" /> Trade Progress
              </h3>
              {tradeHistory.length > 0 && (
                <Button variant="ghost" size="sm" className="h-6 text-[9px] text-muted-foreground hover:text-loss"
                  onClick={() => { setTradeHistory([]); setBot1Stats({ trades: 0, wins: 0, losses: 0, pnl: 0, currentStake: 0, consecutiveLosses: 0 }); }}>
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

            {tradeHistory.length > 0 && (
              <div className="max-h-48 overflow-auto space-y-1">
                {tradeHistory.slice(0, 20).map(t => (
                  <div key={t.id} className={`flex items-center justify-between text-[9px] p-1.5 rounded-lg border ${
                    t.status === 'open' ? 'border-primary/30 bg-primary/5' :
                    t.status === 'won' ? 'border-profit/30 bg-profit/5' :
                    'border-loss/30 bg-loss/5'
                  }`}>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`font-bold ${t.status === 'won' ? 'text-profit' : t.status === 'lost' ? 'text-loss' : 'text-primary'}`}>
                        {t.status === 'open' ? '⏳' : t.status === 'won' ? '✅' : '❌'}
                      </span>
                      <Badge variant="outline" className={`text-[7px] px-1 ${t.botId === 'recovery' ? 'bg-warning/20 text-warning' : t.botId === 'auto-scan' ? 'bg-success/20 text-success' : 'bg-primary/20 text-primary'}`}>
                        {t.botId === 'recovery' ? 'REC' : t.botId === 'auto-scan' ? 'SCAN' : t.botId === 'manual' ? 'MAN' : 'MAIN'}
                      </Badge>
                      <span className="font-mono text-muted-foreground">{t.type}</span>
                      <span className="text-muted-foreground">${t.stake.toFixed(2)}</span>
                      <span className="text-primary font-mono text-[8px]">{t.marketName}</span>
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
