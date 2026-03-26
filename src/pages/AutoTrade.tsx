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
  TrendingUp as TrendLineIcon, Move, Circle as CircleIcon, Square, Type, X, Trash2, Layers, LineChart, Settings,
  Minus as LineIcon, Triangle, ArrowRight, MousePointer, Eraser
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

const TIMEFRAMES = ['1m','3m','5m','15m','30m','1h','4h','12h','1d'];

// Updated candle counts per timeframe
const getCandleCountForTimeframe = (timeframe: string): number => {
  const counts: Record<string, number> = {
    '1m': 200,
    '3m': 200,
    '5m': 200,
    '15m': 200,
    '30m': 200,
    '1h': 150,
    '4h': 145,
    '12h': 145,
    '1d': 145,
  };
  return counts[timeframe] || 150;
};

const getTickCountForTimeframe = (timeframe: string): number => {
  const seconds: Record<string, number> = {
    '1m': 60,
    '3m': 180,
    '5m': 300,
    '15m': 900,
    '30m': 1800,
    '1h': 3600,
    '4h': 14400,
    '12h': 43200,
    '1d': 86400,
  };
  
  const interval = seconds[timeframe] || 60;
  const targetCandles = getCandleCountForTimeframe(timeframe);
  return Math.ceil(targetCandles * interval * 1.2);
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

/* ── Drawing Tool Types ── */
interface DrawingTool {
  id: string;
  type: 'trendline' | 'long' | 'short' | 'triangle' | 'arrow' | 'rectangle' | 'circle';
  points: { x: number; y: number; price?: number; time?: number }[];
  color: string;
  label?: string;
}

/* ── Indicator Settings ── */
interface IndicatorSettings {
  macd: boolean;
  bollinger: boolean;
  ma9: boolean;
  ma20: boolean;
  ma50: boolean;
  rsi: boolean;
}

/* ── Candle builder ── */
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

function calcBBSeries(prices: number[], period: number = 20, mult: number = 2) {
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

function calcMACDSeries(prices: number[]) {
  const macdLine: (number | null)[] = [];
  const signalLine: (number | null)[] = [];
  const histogram: (number | null)[] = [];
  
  for (let i = 0; i < prices.length; i++) {
    if (i < 26) {
      macdLine.push(null);
      signalLine.push(null);
      histogram.push(null);
      continue;
    }
    
    const ema12 = calcEMA(prices.slice(0, i + 1), 12);
    const ema26 = calcEMA(prices.slice(0, i + 1), 26);
    const macd = ema12 - ema26;
    macdLine.push(macd);
    
    if (i >= 33) {
      const signalPrices = macdLine.slice(i - 8, i + 1).filter(v => v !== null) as number[];
      const signal = signalPrices.reduce((a, b) => a + b, 0) / signalPrices.length;
      signalLine.push(signal);
      histogram.push(macd - signal);
    } else {
      signalLine.push(null);
      histogram.push(null);
    }
  }
  
  return { macdLine, signalLine, histogram };
}

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

function calcSR(prices: number[]) {
  if (prices.length < 10) return { support: 0, resistance: 0 };
  const sorted = [...prices].sort((a, b) => a - b);
  const p5 = Math.floor(sorted.length * 0.05);
  const p95 = Math.floor(sorted.length * 0.95);
  return { support: sorted[p5], resistance: sorted[Math.min(p95, sorted.length - 1)] };
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
  if (tickHistoryRef[symbol].length > 500) tickHistoryRef[symbol].shift();
}

export default function TradingChart() {
  const { isAuthorized } = useAuth();
  const [showChart, setShowChart] = useState(false); // Initially hidden
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

  // Zoom & pan state - NO candle removal
  const [candleWidth, setCandleWidth] = useState(3);
  const [scrollOffset, setScrollOffset] = useState(0);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartOffset = useRef(0);
  
  // Drawing tools state
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [drawings, setDrawings] = useState<DrawingTool[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentDrawing, setCurrentDrawing] = useState<DrawingTool | null>(null);
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);
  
  // Indicator settings
  const [indicators, setIndicators] = useState<IndicatorSettings>({
    macd: true,
    bollinger: true,
    ma9: true,
    ma20: true,
    ma50: true,
    rsi: true,
  });

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

  // Load data
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
        
        const tickCount = getTickCountForTimeframe(timeframe);
        const hist = await derivApi.getTickHistory(symbol as MarketSymbol, tickCount);
        if (!active) return;
        
        const historicalDigits = (hist.history.prices || []).map(p => getLastDigit(p));
        tickHistoryRef[symbol] = historicalDigits.slice(-500);
        
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
              return newPrices.slice(-20000);
            });
            
            setTimes(prev => {
              const newTimes = [...prev, epoch];
              return newTimes.slice(-20000);
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
  }, [symbol, timeframe]);

  const handleManualRefresh = useCallback(async () => {
    if (!derivApi.isConnected) {
      toast.error('Not connected to Deriv');
      return;
    }
    
    setIsLoading(true);
    try {
      const tickCount = getTickCountForTimeframe(timeframe);
      const hist = await derivApi.getTickHistory(symbol as MarketSymbol, tickCount);
      setPrices(prev => {
        const newPrices = [...prev, ...hist.history.prices];
        return newPrices.slice(-20000);
      });
      setTimes(prev => {
        const newTimes = [...prev, ...hist.history.times];
        return newTimes.slice(-20000);
      });
      toast.success('Market data refreshed');
    } catch (err) {
      toast.error('Failed to refresh data');
    } finally {
      setIsLoading(false);
    }
  }, [symbol, timeframe]);

  /* ── Derived data ── */
  const targetCandles = getCandleCountForTimeframe(timeframe);
  const tfPrices = useMemo(() => prices.slice(-getTickCountForTimeframe(timeframe)), [prices, timeframe]);
  const tfTimes = useMemo(() => times.slice(-getTickCountForTimeframe(timeframe)), [times, timeframe]);
  const candles = useMemo(() => buildCandles(tfPrices, tfTimes, timeframe), [tfPrices, tfTimes, timeframe]);
  const currentPrice = prices[prices.length - 1] || 0;
  const lastDigit = getLastDigit(currentPrice);
  const digits = useMemo(() => tfPrices.map(getLastDigit), [tfPrices]);
  const last26 = useMemo(() => {
    const tickHistory = getTickHistory(symbol);
    return tickHistory.slice(-26);
  }, [symbol, prices]);
  const { frequency, percentages, mostCommon, leastCommon } = useMemo(() => analyzeDigits(tfPrices), [tfPrices]);

  // Indicators
  const bb = useMemo(() => calculateBollingerBands(tfPrices, 20), [tfPrices]);
  const ema9 = useMemo(() => calcEMA(tfPrices, 9), [tfPrices]);
  const ema20 = useMemo(() => calcEMA(tfPrices, 20), [tfPrices]);
  const ema50 = useMemo(() => calcEMA(tfPrices, 50), [tfPrices]);
  const { support, resistance } = useMemo(() => calcSR(tfPrices), [tfPrices]);
  const rsi = useMemo(() => calculateRSI(tfPrices, 14), [tfPrices]);
  const macd = useMemo(() => calcMACDSeries(tfPrices), [tfPrices]);

  const candleEndIndices = useMemo(() => mapCandlesToPriceIndices(tfPrices, tfTimes, timeframe), [tfPrices, tfTimes, timeframe]);
  const ema9Series = useMemo(() => calcEMASeries(tfPrices, 9), [tfPrices]);
  const ema20Series = useMemo(() => calcEMASeries(tfPrices, 20), [tfPrices]);
  const ema50Series = useMemo(() => calcEMASeries(tfPrices, 50), [tfPrices]);
  const bbSeries = useMemo(() => calcBBSeries(tfPrices, 20, 2), [tfPrices]);
  const rsiSeries = useMemo(() => calcRSISeries(tfPrices, 14), [tfPrices]);

  // Canvas drawing handlers
  const getCanvasCoordinates = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    return { x, y };
  }, []);

  const startDrawing = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!activeTool) return;
    const coords = getCanvasCoordinates(e);
    if (!coords) return;
    
    setIsDrawing(true);
    const newDrawing: DrawingTool = {
      id: Date.now().toString(),
      type: activeTool as any,
      points: [{ x: coords.x, y: coords.y }],
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
      return {
        ...prev,
        points: [...prev.points, { x: coords.x, y: coords.y }],
      };
    });
  }, [isDrawing, currentDrawing, getCanvasCoordinates]);

  const endDrawing = useCallback(() => {
    if (currentDrawing && currentDrawing.points.length > 1) {
      setDrawings(prev => [...prev, currentDrawing]);
    }
    setIsDrawing(false);
    setCurrentDrawing(null);
  }, [currentDrawing]);

  const deleteDrawing = useCallback((id: string) => {
    setDrawings(prev => prev.filter(d => d.id !== id));
    if (selectedDrawingId === id) setSelectedDrawingId(null);
  }, [selectedDrawingId]);

  const deleteAllDrawings = useCallback(() => {
    setDrawings([]);
    setSelectedDrawingId(null);
  }, []);

  const toggleIndicator = useCallback((indicator: keyof IndicatorSettings) => {
    setIndicators(prev => ({ ...prev, [indicator]: !prev[indicator] }));
  }, []);

  // Canvas drawing functions
  const drawTrendLine = (ctx: CanvasRenderingContext2D, drawing: DrawingTool) => {
    if (drawing.points.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(drawing.points[0].x, drawing.points[0].y);
    ctx.lineTo(drawing.points[drawing.points.length - 1].x, drawing.points[drawing.points.length - 1].y);
    ctx.strokeStyle = drawing.color;
    ctx.lineWidth = 2;
    ctx.stroke();
  };

  const drawArrow = (ctx: CanvasRenderingContext2D, drawing: DrawingTool) => {
    if (drawing.points.length < 2) return;
    const start = drawing.points[0];
    const end = drawing.points[drawing.points.length - 1];
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const arrowSize = 10;
    
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.strokeStyle = drawing.color;
    ctx.lineWidth = 2;
    ctx.stroke();
    
    const arrowX = end.x - arrowSize * Math.cos(angle);
    const arrowY = end.y - arrowSize * Math.sin(angle);
    ctx.beginPath();
    ctx.moveTo(end.x, end.y);
    ctx.lineTo(arrowX - arrowSize * Math.sin(angle), arrowY + arrowSize * Math.cos(angle));
    ctx.lineTo(arrowX + arrowSize * Math.sin(angle), arrowY - arrowSize * Math.cos(angle));
    ctx.fillStyle = drawing.color;
    ctx.fill();
  };

  const drawRectangle = (ctx: CanvasRenderingContext2D, drawing: DrawingTool) => {
    if (drawing.points.length < 2) return;
    const start = drawing.points[0];
    const end = drawing.points[drawing.points.length - 1];
    ctx.beginPath();
    ctx.rect(start.x, start.y, end.x - start.x, end.y - start.y);
    ctx.strokeStyle = drawing.color;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = `${drawing.color}20`;
    ctx.fill();
  };

  const drawCircle = (ctx: CanvasRenderingContext2D, drawing: DrawingTool) => {
    if (drawing.points.length < 2) return;
    const start = drawing.points[0];
    const end = drawing.points[drawing.points.length - 1];
    const radius = Math.sqrt(Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2));
    ctx.beginPath();
    ctx.arc(start.x, start.y, radius, 0, 2 * Math.PI);
    ctx.strokeStyle = drawing.color;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = `${drawing.color}20`;
    ctx.fill();
  };

  const drawTriangle = (ctx: CanvasRenderingContext2D, drawing: DrawingTool) => {
    if (drawing.points.length < 3) return;
    ctx.beginPath();
    ctx.moveTo(drawing.points[0].x, drawing.points[0].y);
    ctx.lineTo(drawing.points[1].x, drawing.points[1].y);
    ctx.lineTo(drawing.points[2].x, drawing.points[2].y);
    ctx.closePath();
    ctx.strokeStyle = drawing.color;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = `${drawing.color}20`;
    ctx.fill();
  };

  const drawLongPosition = (ctx: CanvasRenderingContext2D, drawing: DrawingTool) => {
    if (drawing.points.length < 1) return;
    const point = drawing.points[0];
    ctx.beginPath();
    ctx.moveTo(point.x - 10, point.y);
    ctx.lineTo(point.x, point.y - 15);
    ctx.lineTo(point.x + 10, point.y);
    ctx.fillStyle = '#3FB950';
    ctx.fill();
    ctx.fillStyle = '#0D1117';
    ctx.font = 'bold 10px JetBrains Mono';
    ctx.fillText('LONG', point.x - 12, point.y - 18);
  };

  const drawShortPosition = (ctx: CanvasRenderingContext2D, drawing: DrawingTool) => {
    if (drawing.points.length < 1) return;
    const point = drawing.points[0];
    ctx.beginPath();
    ctx.moveTo(point.x - 10, point.y);
    ctx.lineTo(point.x, point.y + 15);
    ctx.lineTo(point.x + 10, point.y);
    ctx.fillStyle = '#F85149';
    ctx.fill();
    ctx.fillStyle = '#0D1117';
    ctx.font = 'bold 10px JetBrains Mono';
    ctx.fillText('SHORT', point.x - 14, point.y + 22);
  };

  // Canvas chart drawing
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
    const rsiH = indicators.rsi ? 80 : 0;
    const macdH = indicators.macd ? 100 : 0;
    const H = totalH - rsiH - macdH - 8;
    const priceAxisW = 70;
    const chartW = W - priceAxisW;

    ctx.fillStyle = '#0D1117';
    ctx.fillRect(0, 0, W, totalH);

    const gap = 1;
    const totalCandleW = candleWidth + gap;
    const maxVisible = Math.floor(chartW / totalCandleW);
    // NO candle removal - just adjust visible range
    const endIdx = Math.min(candles.length, candles.length - scrollOffset);
    const startIdx = Math.max(0, endIdx - maxVisible);
    const visibleCandles = candles.slice(startIdx, endIdx);
    const visibleEndIndices = candleEndIndices.slice(startIdx, endIdx);

    if (visibleCandles.length < 1) return;

    const allPrices = visibleCandles.flatMap(c => [c.high, c.low]);
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

    // Draw grid
    ctx.strokeStyle = '#21262D';
    ctx.lineWidth = 0.5;
    const gridSteps = 8;
    ctx.font = '9px JetBrains Mono, monospace';
    ctx.fillStyle = '#484F58';
    for (let i = 0; i <= gridSteps; i++) {
      const y = chartPadTop + (i / gridSteps) * drawH;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(chartW, y); ctx.stroke();
      const pLabel = maxP - (i / gridSteps) * range;
      ctx.fillText(pLabel.toFixed(2), chartW + 4, y + 3);
    }

    const offsetX = 5;

    // Draw Bollinger Bands
    if (indicators.bollinger) {
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

      // Draw Bollinger lines
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
          if (!started) { ctx.moveTo(x, y); started = true; }
          else ctx.lineTo(x, y);
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
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };

    if (indicators.ma9) drawMALine(ema9Series, '#2F81F7', 1.5);
    if (indicators.ma20) drawMALine(ema20Series, '#E6B422', 1.5);
    if (indicators.ma50) drawMALine(ema50Series, '#F97316', 1.5);

    // Draw Support/Resistance
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = '#3FB950';
    ctx.lineWidth = 1.5;
    const supY = toY(support);
    ctx.beginPath(); ctx.moveTo(0, supY); ctx.lineTo(chartW, supY); ctx.stroke();

    ctx.strokeStyle = '#F85149';
    const resY = toY(resistance);
    ctx.beginPath(); ctx.moveTo(0, resY); ctx.lineTo(chartW, resY); ctx.stroke();
    ctx.setLineDash([]);

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
    ctx.beginPath(); ctx.moveTo(0, curY); ctx.lineTo(chartW, curY); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#58A6FF';
    ctx.fillRect(chartW, curY - 8, priceAxisW, 16);
    ctx.fillStyle = '#0D1117';
    ctx.font = 'bold 10px JetBrains Mono, monospace';
    ctx.fillText(currentPrice.toFixed(2), chartW + 2, curY + 4);

    // Draw drawings
    drawings.forEach(drawing => {
      switch (drawing.type) {
        case 'trendline': drawTrendLine(ctx, drawing); break;
        case 'arrow': drawArrow(ctx, drawing); break;
        case 'rectangle': drawRectangle(ctx, drawing); break;
        case 'circle': drawCircle(ctx, drawing); break;
        case 'triangle': drawTriangle(ctx, drawing); break;
        case 'long': drawLongPosition(ctx, drawing); break;
        case 'short': drawShortPosition(ctx, drawing); break;
      }
    });

    // Draw current drawing in progress
    if (currentDrawing && currentDrawing.points.length > 1) {
      switch (currentDrawing.type) {
        case 'trendline': drawTrendLine(ctx, currentDrawing); break;
        case 'arrow': drawArrow(ctx, currentDrawing); break;
        case 'rectangle': drawRectangle(ctx, currentDrawing); break;
        case 'circle': drawCircle(ctx, currentDrawing); break;
        case 'triangle': drawTriangle(ctx, currentDrawing); break;
        case 'long': drawLongPosition(ctx, currentDrawing); break;
        case 'short': drawShortPosition(ctx, currentDrawing); break;
      }
    }

    // Draw MACD
    if (indicators.macd && macdH > 0) {
      const macdTop = H + 8;
      ctx.fillStyle = '#161B22';
      ctx.fillRect(0, macdTop, W, macdH);
      
      const macdToY = (v: number) => macdTop + 10 + ((1 - (v + 0.5)) / 1) * (macdH - 20);
      
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < visibleCandles.length; i++) {
        const idx = visibleEndIndices[i];
        if (idx === undefined) continue;
        const v = idx < macd.macdLine.length ? macd.macdLine[idx] : null;
        if (v === null) continue;
        const x = offsetX + i * totalCandleW + candleWidth / 2;
        const y = macdToY(v);
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = '#2F81F7';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      
      ctx.beginPath();
      started = false;
      for (let i = 0; i < visibleCandles.length; i++) {
        const idx = visibleEndIndices[i];
        if (idx === undefined) continue;
        const v = idx < macd.signalLine.length ? macd.signalLine[idx] : null;
        if (v === null) continue;
        const x = offsetX + i * totalCandleW + candleWidth / 2;
        const y = macdToY(v);
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = '#F97316';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      
      // Draw histogram
      for (let i = 0; i < visibleCandles.length; i++) {
        const idx = visibleEndIndices[i];
        if (idx === undefined) continue;
        const v = idx < macd.histogram.length ? macd.histogram[idx] : null;
        if (v === null) continue;
        const x = offsetX + i * totalCandleW + candleWidth / 2;
        const y = macdToY(0);
        const histY = macdToY(v);
        const height = y - histY;
        ctx.fillStyle = v >= 0 ? '#3FB950' : '#F85149';
        ctx.fillRect(x - 2, histY, 4, Math.abs(height));
      }
      
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
        ctx.strokeStyle = level === 50 ? '#484F58' : (level === 70 ? '#F8514950' : '#3FB95050');
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(chartW, y); ctx.stroke();
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
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = '#D29922';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);
      
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
    
    legends.forEach(l => {
      ctx.fillStyle = l.color;
      ctx.fillRect(lx, 6, 10, 3);
      ctx.fillText(l.label, lx + 14, 12);
      lx += ctx.measureText(l.label).width + 24;
    });

    ctx.fillStyle = '#484F58';
    ctx.font = '9px JetBrains Mono, monospace';
    ctx.fillText(`${visibleCandles.length} / ${candles.length} candles | Scroll: drag | Zoom: Ctrl+wheel`, 8, H - 6);

  }, [candles, bb, ema9, ema20, ema50, support, resistance, currentPrice, candleEndIndices, 
      ema9Series, ema20Series, ema50Series, bbSeries, rsiSeries, rsi, candleWidth, scrollOffset, 
      showChart, indicators, drawings, currentDrawing, macd]);

  // Canvas mouse handlers
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !showChart) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        setCandleWidth(prev => Math.max(2, Math.min(12, prev - Math.sign(e.deltaY))));
      } else {
        // Pan without removing candles
        const delta = Math.sign(e.deltaY) * Math.max(5, Math.floor(candles.length * 0.02));
        setScrollOffset(prev => Math.max(0, Math.min(candles.length - 20, prev + delta)));
      }
    };

    const onMouseDown = (e: MouseEvent) => {
      if (activeTool) {
        // Handle drawing
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        setIsDrawing(true);
        const newDrawing: DrawingTool = {
          id: Date.now().toString(),
          type: activeTool as any,
          points: [{ x, y }],
          color: activeTool === 'long' ? '#3FB950' : activeTool === 'short' ? '#F85149' : '#BC8CFF',
        };
        setCurrentDrawing(newDrawing);
      } else {
        // Handle panning
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
        setScrollOffset(Math.max(0, Math.min(candles.length - 10, dragStartOffset.current + delta)));
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
          const ticks = getTickHistory(botConfig.botSymbol);
          if (strategyMode === 'pattern') {
            const cleanPattern = patternInput.toUpperCase().replace(/[^EO]/g, '');
            if (ticks.length >= cleanPattern.length) {
              const recent = ticks.slice(-cleanPattern.length);
              conditionMet = recent.every((d, i) => (d % 2 === 0 ? 'E' : 'O') === cleanPattern[i]);
            }
          } else {
            const win = parseInt(digitWindow) || 3;
            const comp = parseInt(digitCompare);
            if (ticks.length >= win) {
              const recent = ticks.slice(-win);
              conditionMet = recent.every(d => {
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
            }
          }
          if (!conditionMet) await new Promise(r => setTimeout(r, 500));
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
        setTradeHistory(prev => prev.map(t => t.id === contractId ? { ...t, profit: result.profit, status: result.status } : t));

        if (result.status === 'won') {
          wins++; consLosses = 0;
          stake = baseStake;
        } else {
          losses++; consLosses++;
          if (mart) stake = Math.round(stake * mult * 100) / 100;
          else stake = baseStake;
        }
        setBotStats({ trades, wins, losses, pnl, currentStake: stake, consecutiveLosses: consLosses });
      } catch (err: any) {
        toast.error(`Bot trade error: ${err.message}`);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    setBotRunning(false); botRunningRef.current = false;
  }, [isAuthorized, botConfig, voiceEnabled, speak, strategyEnabled, strategyMode, patternInput, digitCondition, digitCompare, digitWindow]);

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

  const riseSignal = useMemo(() => {
    const conf = rsi < 30 ? 85 : rsi > 70 ? 25 : 50 + (50 - rsi);
    return { direction: rsi < 45 ? 'Rise' : 'Fall', confidence: Math.min(95, Math.max(10, Math.round(conf))) };
  }, [rsi]);

  return (
    <div className="space-y-4 max-w-[1920px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-primary" /> Trading Chart
          </h1>
          <p className="text-xs text-muted-foreground">{marketName} • {timeframe} • {candles.length} / {targetCandles} candles</p>
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
          <Badge className="font-mono text-sm" variant="outline">
            {currentPrice.toFixed(2)}
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
            {tf} ({getCandleCountForTimeframe(tf)}c)
          </Button>
        ))}
      </div>

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
              <MousePointer className="w-3.5 h-3.5" /> Exit Draw
            </Button>
          )}
        </div>
      )}

      {/* Indicators Toggle Bar */}
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
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        {/* LEFT: Chart + Info */}
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
                  <button key={d}
                    onClick={() => { setSelectedDigit(d); setPrediction(String(d)); }}
                    className={`relative rounded-lg p-2 text-center transition-all border cursor-pointer hover:ring-2 hover:ring-primary ${
                      selectedDigit === d ? 'ring-2 ring-primary' : ''
                    } ${pct > 12 ? 'bg-loss/10 border-loss/40 text-loss' :
                      pct > 9 ? 'bg-warning/10 border-warning/40 text-warning' :
                      'bg-card border-border text-primary'}`}
                  >
                    <div className="font-mono text-lg font-bold">{d}</div>
                    <div className="text-[8px]">{count} ({pct.toFixed(1)}%)</div>
                    <div className="h-1 bg-muted rounded-full mt-1">
                      <div className={`h-full rounded-full ${pct > 12 ? 'bg-loss' : pct > 9 ? 'bg-warning' : 'bg-primary'}`} style={{ width: `${Math.min(100, pct * 5)}%` }} />
                    </div>
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

        {/* RIGHT: Signals + Trade + Tech */}
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

          {/* AUTO BOT PANEL */}
          <div className={`bg-card border rounded-xl p-3 space-y-2 ${botRunning ? 'border-profit glow-profit' : 'border-border'}`}>
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-foreground flex items-center gap-1">
                <Zap className="w-3.5 h-3.5 text-primary" /> Milliefx Speed Bot
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
                <span className="text-muted-foreground">RSI (14)</span>
                <span className={`font-mono font-bold ${rsi > 70 ? 'text-loss' : rsi < 30 ? 'text-profit' : 'text-foreground'}`}>
                  {rsi.toFixed(1)} {rsi > 70 ? '🔴 Overbought' : rsi < 30 ? '🟢 Oversold' : '⚪ Neutral'}
                </span>
              </div>
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-muted-foreground">EMA 9/20/50</span>
                <span className={`font-mono font-bold ${currentPrice > ema9 ? 'text-profit' : 'text-loss'}`}>
                  {currentPrice > ema9 ? '📈 Above' : '📉 Below'} MA9
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
