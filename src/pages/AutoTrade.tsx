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
  Plus, X, Settings
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
const CANDLE_CONFIG = {
  minCandles: 1000,
  maxCandles: 5000,
  defaultCandles: 1000,
};

const TICK_RANGES = [50, 100, 200, 300, 500, 1000];
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

type IndicatorType = 'RSI' | 'BB' | 'MA' | 'MACD' | 'PSAR';
interface Indicator {
  id: string;
  type: IndicatorType;
  enabled: boolean;
}

interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  time: number;
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

// Global tick storage
const globalTickHistory: { [symbol: string]: number[] } = {};
let lastDigitUpdate: { [symbol: string]: number } = {};

function getTickHistory(symbol: string): number[] {
  return globalTickHistory[symbol] || [];
}

function addTick(symbol: string, digit: number) {
  if (!globalTickHistory[symbol]) globalTickHistory[symbol] = [];
  globalTickHistory[symbol].push(digit);
  if (globalTickHistory[symbol].length > 1000) globalTickHistory[symbol].shift();
  lastDigitUpdate[symbol] = Date.now();
}

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

function calcRSI(prices: number[], period: number = 14): number {
  if (prices.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(0, diff)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -diff)) / period;
  }
  return avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
}

function calcBollinger(prices: number[], period: number = 20, multiplier: number = 2) {
  if (prices.length < period) {
    return { upper: prices[prices.length - 1] || 0, middle: prices[prices.length - 1] || 0, lower: prices[prices.length - 1] || 0 };
  }
  const slice = prices.slice(-period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((s, p) => s + Math.pow(p - middle, 2), 0) / period;
  const std = Math.sqrt(variance);
  return { upper: middle + multiplier * std, middle, lower: middle - multiplier * std };
}

function calcMACD(prices: number[]) {
  const ema12 = calcEMA(prices, 12);
  const ema26 = calcEMA(prices, 26);
  const macd = ema12 - ema26;
  const signal = macd * 0.8;
  return { macd, signal, histogram: macd - signal };
}

function calcPSAR(highs: number[], lows: number[]) {
  if (highs.length < 2) return { sar: highs[highs.length - 1] || 0, trend: 'bullish' };
  let sar = lows[0];
  let trend = 1;
  let ep = highs[0];
  let af = 0.02;
  const step = 0.02;
  const maxStep = 0.2;

  for (let i = 1; i < highs.length; i++) {
    sar = sar + af * (ep - sar);
    if (trend === 1) {
      if (lows[i] < sar) {
        trend = -1;
        sar = ep;
        ep = lows[i];
        af = step;
      } else if (highs[i] > ep) {
        ep = highs[i];
        af = Math.min(af + step, maxStep);
      }
    } else {
      if (highs[i] > sar) {
        trend = 1;
        sar = ep;
        ep = highs[i];
        af = step;
      } else if (lows[i] < ep) {
        ep = lows[i];
        af = Math.min(af + step, maxStep);
      }
    }
  }
  return { sar, trend: trend === 1 ? 'bullish' : 'bearish' };
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
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'connecting'>('disconnected');
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();
  const subscriptionRef = useRef<any>(null);
  
  // Candle management
  const [candleCount, setCandleCount] = useState(CANDLE_CONFIG.defaultCandles);
  
  // Digit analysis
  const [tickRange, setTickRange] = useState(100);
  const [digitStats, setDigitStats] = useState({
    frequency: {} as Record<number, number>,
    percentages: {} as Record<number, number>,
    mostCommon: 0,
    leastCommon: 0,
  });
  
  // Indicators
  const [indicators, setIndicators] = useState<Indicator[]>([]);
  const [showIndicatorPanel, setShowIndicatorPanel] = useState(false);
  
  // Chart state
  const [candleWidth, setCandleWidth] = useState(6);
  const [scrollOffset, setScrollOffset] = useState(0);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartOffset = useRef(0);
  
  // Trade panel
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
  
  // Strategy
  const [strategyEnabled, setStrategyEnabled] = useState(false);
  const [strategyMode, setStrategyMode] = useState<'pattern' | 'digit'>('pattern');
  const [patternInput, setPatternInput] = useState('');
  const [digitCondition, setDigitCondition] = useState('==');
  const [digitCompare, setDigitCompare] = useState('5');
  const [digitWindow, setDigitWindow] = useState('3');
  
  // Auto Bot
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
  
  const currentPrice = prices[prices.length - 1] || 0;
  const lastDigit = getLastDigit(currentPrice);
  
  // Update digit analysis when tick range changes
  useEffect(() => {
    const ticks = getTickHistory(symbol);
    const recentTicks = ticks.slice(-tickRange);
    if (recentTicks.length > 0) {
      const analysis = analyzeDigits(recentTicks);
      setDigitStats({
        frequency: analysis.frequency,
        percentages: analysis.percentages,
        mostCommon: analysis.mostCommon,
        leastCommon: analysis.leastCommon,
      });
    }
  }, [symbol, tickRange]);
  
  // Load market data
  useEffect(() => {
    let mounted = true;
    let reconnectTimeout: NodeJS.Timeout;
    
    const loadData = async () => {
      if (!derivApi.isConnected) {
        setConnectionStatus('disconnected');
        setIsLoading(false);
        return;
      }
      
      setConnectionStatus('connected');
      setIsLoading(true);
      
      try {
        // Unsubscribe from previous
        if (subscriptionRef.current) {
          await derivApi.unsubscribeTicks(symbol as MarketSymbol);
          subscriptionRef.current = null;
        }
        
        // Load historical data
        const hist = await derivApi.getTickHistory(symbol as MarketSymbol, candleCount);
        if (!mounted) return;
        
        const historicalDigits = hist.history.prices.map((p: number) => getLastDigit(p));
        globalTickHistory[symbol] = historicalDigits;
        
        setPrices(hist.history.prices || []);
        setTimes(hist.history.times || []);
        setScrollOffset(0);
        setIsLoading(false);
        
        // Subscribe to new ticks
        subscriptionRef.current = await derivApi.subscribeTicks(symbol as MarketSymbol, (data: any) => {
          if (!mounted || !data?.tick) return;
          
          const quote = data.tick.quote;
          const digit = getLastDigit(quote);
          const epoch = data.tick.epoch;
          
          addTick(symbol, digit);
          
          setPrices(prev => {
            const newPrices = [...prev, quote];
            return newPrices.slice(-CANDLE_CONFIG.maxCandles);
          });
          
          setTimes(prev => {
            const newTimes = [...prev, epoch];
            return newTimes.slice(-CANDLE_CONFIG.maxCandles);
          });
        });
        
      } catch (err) {
        console.error('Error loading market data:', err);
        if (mounted) {
          toast.error(`Failed to load ${symbol} data`);
          setIsLoading(false);
        }
      }
    };
    
    loadData();
    
    // Reconnect check
    const interval = setInterval(() => {
      if (!derivApi.isConnected && mounted) {
        setConnectionStatus('disconnected');
        loadData();
      }
    }, 5000);
    
    return () => {
      mounted = false;
      clearInterval(interval);
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (subscriptionRef.current) {
        derivApi.unsubscribeTicks(symbol as MarketSymbol).catch(console.error);
      }
    };
  }, [symbol, candleCount]);
  
  // Chart rendering
  useEffect(() => {
    if (!showChart || !canvasRef.current || prices.length === 0) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      return rect;
    };
    
    const draw = () => {
      const rect = resizeCanvas();
      const width = rect.width;
      const height = rect.height;
      
      if (width === 0 || height === 0) return;
      
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#0D1117';
      ctx.fillRect(0, 0, width, height);
      
      // Build candles
      const candles = buildCandles(prices, times, timeframe);
      if (candles.length === 0) return;
      
      const priceAxisWidth = 70;
      const chartWidth = width - priceAxisWidth;
      const gap = 1;
      const totalCandleWidth = candleWidth + gap;
      const maxVisible = Math.floor(chartWidth / totalCandleWidth);
      const endIdx = candles.length - scrollOffset;
      const startIdx = Math.max(0, endIdx - maxVisible);
      const visibleCandles = candles.slice(startIdx, endIdx);
      
      if (visibleCandles.length === 0) return;
      
      // Calculate price range
      const allPrices = visibleCandles.flatMap(c => [c.high, c.low]);
      const minPrice = Math.min(...allPrices);
      const maxPrice = Math.max(...allPrices);
      const priceRange = maxPrice - minPrice;
      const padding = priceRange * 0.1 || 0.001;
      const yMin = minPrice - padding;
      const yMax = maxPrice + padding;
      const yRange = yMax - yMin;
      
      const chartTop = 20;
      const chartBottom = height - 60;
      const chartHeight = chartBottom - chartTop;
      
      const toY = (price: number) => chartTop + ((yMax - price) / yRange) * chartHeight;
      
      // Draw grid
      ctx.strokeStyle = '#21262D';
      ctx.lineWidth = 0.5;
      ctx.font = '10px monospace';
      ctx.fillStyle = '#8B949E';
      
      for (let i = 0; i <= 8; i++) {
        const y = chartTop + (i / 8) * chartHeight;
        const price = yMax - (i / 8) * yRange;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(chartWidth, y);
        ctx.stroke();
        ctx.fillText(price.toFixed(4), chartWidth + 5, y + 3);
      }
      
      const offsetX = 10;
      
      // Draw candles
      for (let i = 0; i < visibleCandles.length; i++) {
        const candle = visibleCandles[i];
        const x = offsetX + i * totalCandleWidth;
        const isGreen = candle.close >= candle.open;
        const color = isGreen ? '#3B82F6' : '#EF4444';
        
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + candleWidth / 2, toY(candle.high));
        ctx.lineTo(x + candleWidth / 2, toY(candle.low));
        ctx.stroke();
        
        const bodyTop = toY(Math.max(candle.open, candle.close));
        const bodyBottom = toY(Math.min(candle.open, candle.close));
        const bodyHeight = Math.max(1, bodyBottom - bodyTop);
        ctx.fillStyle = color;
        ctx.fillRect(x, bodyTop, candleWidth, bodyHeight);
      }
      
      // Draw current price line
      const currentY = toY(currentPrice);
      ctx.strokeStyle = '#58A6FF';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(0, currentY);
      ctx.lineTo(chartWidth, currentY);
      ctx.stroke();
      ctx.setLineDash([]);
      
      ctx.fillStyle = '#58A6FF';
      ctx.fillRect(chartWidth, currentY - 8, priceAxisWidth, 16);
      ctx.fillStyle = '#0D1117';
      ctx.font = 'bold 10px monospace';
      ctx.fillText(currentPrice.toFixed(4), chartWidth + 5, currentY + 4);
      
      // Draw indicator legends
      ctx.font = '10px monospace';
      let legendX = 10;
      const legends = [
        { label: 'Support', color: '#3FB950' },
        { label: 'Resistance', color: '#F85149' },
      ];
      
      indicators.forEach(ind => {
        if (ind.enabled) {
          switch (ind.type) {
            case 'BB': legends.push({ label: 'BB', color: '#BC8CFF' }); break;
            case 'MA': legends.push({ label: 'MA', color: '#E6B422' }); break;
            case 'PSAR': legends.push({ label: 'PSAR', color: '#FF6B6B' }); break;
          }
        }
      });
      
      legends.forEach(legend => {
        ctx.fillStyle = legend.color;
        ctx.fillRect(legendX, 5, 10, 3);
        ctx.fillStyle = '#8B949E';
        ctx.fillText(legend.label, legendX + 12, 10);
        legendX += ctx.measureText(legend.label).width + 30;
      });
      
      ctx.fillStyle = '#484F58';
      ctx.font = '9px monospace';
      ctx.fillText(`${visibleCandles.length} candles | Wheel: scroll | Ctrl+Wheel: zoom`, 10, height - 15);
    };
    
    draw();
    
    const handleResize = () => draw();
    window.addEventListener('resize', handleResize);
    
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [prices, times, timeframe, candleWidth, scrollOffset, showChart, currentPrice, indicators, symbol]);
  
  // Mouse handlers for chart interaction
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !showChart) return;
    
    const candles = buildCandles(prices, times, timeframe);
    
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey) {
        setCandleWidth(prev => Math.max(3, Math.min(15, prev - Math.sign(e.deltaY))));
      } else {
        const delta = Math.sign(e.deltaY) * 5;
        setScrollOffset(prev => Math.max(0, Math.min(candles.length - 20, prev + delta)));
      }
    };
    
    const onMouseDown = (e: MouseEvent) => {
      isDragging.current = true;
      dragStartX.current = e.clientX;
      dragStartOffset.current = scrollOffset;
      canvas.style.cursor = 'grabbing';
    };
    
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const dx = dragStartX.current - e.clientX;
      const delta = Math.floor(dx / 5);
      setScrollOffset(Math.max(0, Math.min(candles.length - 20, dragStartOffset.current + delta)));
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
  }, [prices, times, timeframe, scrollOffset, candleWidth, showChart]);
  
  // Calculate indicators
  const rsi = useMemo(() => calculateRSI(prices, 14), [prices]);
  const bb = useMemo(() => calculateBollingerBands(prices, 20), [prices]);
  const ema50 = useMemo(() => calcEMA(prices, 50), [prices]);
  const sma20 = useMemo(() => calcSMA(prices, 20), [prices]);
  const macd = useMemo(() => calcMACD(prices), [prices]);
  const psar = useMemo(() => {
    const candles = buildCandles(prices, times, timeframe);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    return calcPSAR(highs, lows);
  }, [prices, times, timeframe]);
  
  // Support/Resistance
  const { support, resistance } = useMemo(() => {
    if (prices.length < 10) return { support: 0, resistance: 0 };
    const sorted = [...prices].sort((a, b) => a - b);
    return {
      support: sorted[Math.floor(sorted.length * 0.05)],
      resistance: sorted[Math.floor(sorted.length * 0.95)],
    };
  }, [prices]);
  
  // Digit stats
  const ticks = useMemo(() => getTickHistory(symbol).slice(-tickRange), [symbol, tickRange]);
  const evenCount = ticks.filter(d => d % 2 === 0).length;
  const oddCount = ticks.length - evenCount;
  const evenPct = ticks.length > 0 ? (evenCount / ticks.length * 100) : 50;
  const oddPct = 100 - evenPct;
  const overCount = ticks.filter(d => d > 4).length;
  const underCount = ticks.length - overCount;
  const overPct = ticks.length > 0 ? (overCount / ticks.length * 100) : 50;
  const underPct = 100 - overPct;
  
  // Signals
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
    const bestPct = Math.max(...Object.values(digitStats.percentages));
    return { digit: digitStats.mostCommon, confidence: Math.min(90, Math.round(bestPct * 3)) };
  }, [digitStats]);
  
  // Get indicator signals
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
  
  const aggregatedSignal = useMemo(() => {
    const signals = getIndicatorSignals();
    if (signals.length === 0) return { direction: 'NEUTRAL' as const, confidence: 50 };
    
    const overCount = signals.filter(s => s.signal === 'OVER').length;
    const underCount = signals.filter(s => s.signal === 'UNDER').length;
    
    if (overCount > underCount) return { direction: 'OVER' as const, confidence: (overCount / signals.length) * 100 };
    if (underCount > overCount) return { direction: 'UNDER' as const, confidence: (underCount / signals.length) * 100 };
    return { direction: 'NEUTRAL' as const, confidence: 50 };
  }, [getIndicatorSignals]);
  
  // Strategy helpers
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
    if (strategyMode === 'pattern') return checkPatternMatch();
    return checkDigitCondition();
  }, [strategyEnabled, strategyMode, checkPatternMatch, checkDigitCondition]);
  
  // Voice
  const speak = useCallback((text: string) => {
    if (!voiceEnabled || !window.speechSynthesis) return;
    if (lastSpokenSignal.current === text) return;
    lastSpokenSignal.current = text;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.1;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }, [voiceEnabled]);
  
  // Trade execution
  const handleBuy = async (side: 'buy' | 'sell') => {
    if (!isAuthorized) {
      toast.error('Please login to your Deriv account first');
      return;
    }
    if (isTrading) return;
    setIsTrading(true);
    
    const ct = side === 'buy' ? contractType : (contractType === 'CALL' ? 'PUT' : contractType === 'PUT' ? 'CALL' : contractType);
    const params: any = {
      contract_type: ct,
      symbol,
      duration: parseInt(duration),
      duration_unit: durationUnit,
      basis: 'stake',
      amount: parseFloat(tradeStake)
    };
    
    if (['DIGITMATCH', 'DIGITDIFF', 'DIGITOVER', 'DIGITUNDER'].includes(ct)) {
      params.barrier = prediction;
    }
    
    try {
      toast.info(`Placing ${ct} trade... $${tradeStake}`);
      const { contractId } = await derivApi.buyContract(params);
      const newTrade: TradeRecord = {
        id: contractId,
        time: Date.now(),
        type: ct,
        stake: parseFloat(tradeStake),
        profit: 0,
        status: 'open',
        symbol
      };
      setTradeHistory(prev => [newTrade, ...prev].slice(0, 50));
      
      const result = await derivApi.waitForContractResult(contractId);
      const resultDigit = getLastDigit(result.price || currentPrice);
      
      setTradeHistory(prev => prev.map(t =>
        t.id === contractId ? { ...t, profit: result.profit, status: result.status, resultDigit } : t
      ));
      
      if (result.status === 'won') {
        toast.success(`✅ WON +$${result.profit.toFixed(2)} | Digit: ${resultDigit}`);
        if (voiceEnabled) speak(`Trade won. Profit ${result.profit.toFixed(2)} dollars`);
      } else {
        toast.error(`❌ LOST -$${Math.abs(result.profit).toFixed(2)} | Digit: ${resultDigit}`);
        if (voiceEnabled) speak(`Trade lost. Loss ${Math.abs(result.profit).toFixed(2)} dollars`);
      }
    } catch (err: any) {
      toast.error(`Trade failed: ${err.message}`);
    } finally {
      setIsTrading(false);
    }
  };
  
  // Auto Bot
  const startBot = useCallback(async () => {
    if (!isAuthorized) {
      toast.error('Login to Deriv first');
      return;
    }
    
    setBotRunning(true);
    setBotPaused(false);
    botRunningRef.current = true;
    botPausedRef.current = false;
    
    const baseStake = parseFloat(botConfig.stake) || 1;
    const sl = parseFloat(botConfig.stopLoss) || 10;
    const tp = parseFloat(botConfig.takeProfit) || 20;
    const maxT = parseInt(botConfig.maxTrades) || 50;
    const mart = botConfig.martingale;
    const mult = parseFloat(botConfig.multiplier) || 2;
    
    let stake = baseStake;
    let pnl = 0;
    let trades = 0;
    let wins = 0;
    let losses = 0;
    let consLosses = 0;
    
    if (voiceEnabled) speak('Auto trading bot started');
    
    while (botRunningRef.current) {
      if (botPausedRef.current) {
        await new Promise(r => setTimeout(r, 500));
        continue;
      }
      
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
      const params: any = {
        contract_type: ct,
        symbol: botConfig.botSymbol,
        duration: parseInt(botConfig.duration),
        duration_unit: botConfig.durationUnit,
        basis: 'stake',
        amount: stake
      };
      
      if (['DIGITMATCH', 'DIGITDIFF', 'DIGITOVER', 'DIGITUNDER'].includes(ct)) {
        params.barrier = botConfig.prediction;
      }
      
      try {
        const { contractId } = await derivApi.buyContract(params);
        const result = await derivApi.waitForContractResult(contractId);
        
        trades++;
        pnl += result.profit;
        const resultDigit = getLastDigit(result.price || 0);
        
        setTradeHistory(prev => [{
          id: contractId,
          time: Date.now(),
          type: ct,
          stake,
          profit: result.profit,
          status: result.status,
          symbol: botConfig.botSymbol,
          resultDigit
        }, ...prev].slice(0, 100));
        
        if (result.status === 'won') {
          wins++;
          consLosses = 0;
          stake = baseStake;
          if (voiceEnabled && trades % 5 === 0) {
            speak(`Trade ${trades} won. Total profit ${pnl.toFixed(2)}`);
          }
        } else {
          losses++;
          consLosses++;
          if (mart) {
            stake = Math.round(stake * mult * 100) / 100;
          } else {
            stake = baseStake;
          }
          if (voiceEnabled) {
            speak(`Loss ${consLosses}. ${mart ? `Martingale stake ${stake.toFixed(2)}` : ''}`);
          }
        }
        
        setBotStats({ trades, wins, losses, pnl, currentStake: stake, consecutiveLosses: consLosses });
        
        if (turboMode) {
          await new Promise(r => setTimeout(r, 500));
        } else {
          await new Promise(r => setTimeout(r, 2000));
        }
      } catch (err: any) {
        toast.error(`Bot trade error: ${err.message}`);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    
    setBotRunning(false);
    botRunningRef.current = false;
  }, [isAuthorized, botConfig, voiceEnabled, speak, strategyEnabled, checkStrategyCondition, turboMode]);
  
  const stopBot = useCallback(() => {
    botRunningRef.current = false;
    setBotRunning(false);
    toast.info('🛑 Bot stopped');
  }, []);
  
  const togglePauseBot = useCallback(() => {
    botPausedRef.current = !botPausedRef.current;
    setBotPaused(botPausedRef.current);
  }, []);
  
  const handleBotSymbolChange = useCallback((newSymbol: string) => {
    setBotConfig(prev => ({ ...prev, botSymbol: newSymbol }));
    setSymbol(newSymbol);
  }, []);
  
  const addIndicator = useCallback((type: IndicatorType) => {
    setIndicators(prev => [...prev, { id: `${type}-${Date.now()}`, type, enabled: true }]);
  }, []);
  
  const removeIndicator = useCallback((id: string) => {
    setIndicators(prev => prev.filter(ind => ind.id !== id));
  }, []);
  
  const toggleIndicator = useCallback((id: string) => {
    setIndicators(prev => prev.map(ind =>
      ind.id === id ? { ...ind, enabled: !ind.enabled } : ind
    ));
  }, []);
  
  const totalTrades = tradeHistory.filter(t => t.status !== 'open').length;
  const wins = tradeHistory.filter(t => t.status === 'won').length;
  const losses = tradeHistory.filter(t => t.status === 'lost').length;
  const totalProfit = tradeHistory.reduce((s, t) => s + t.profit, 0);
  const winRate = totalTrades > 0 ? (wins / totalTrades * 100) : 0;
  
  const filteredMarkets = groupFilter === 'all' ? ALL_MARKETS : ALL_MARKETS.filter(m => m.group === groupFilter);
  const marketName = ALL_MARKETS.find(m => m.symbol === symbol)?.name || symbol;
  
  return (
    <div className="space-y-4 max-w-[1920px] mx-auto p-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-primary" /> Trading Chart
          </h1>
          <p className="text-xs text-muted-foreground">
            {marketName} • {timeframe} • {prices.length} ticks
            {connectionStatus !== 'connected' && (
              <Badge variant="destructive" className="ml-2">Disconnected</Badge>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => window.location.reload()}
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
      <div className="bg-card border rounded-xl p-3">
        <div className="flex flex-wrap gap-1 mb-2">
          {GROUPS.map(g => (
            <Button
              key={g.value}
              size="sm"
              variant={groupFilter === g.value ? 'default' : 'outline'}
              className="h-6 text-[10px] px-2"
              onClick={() => setGroupFilter(g.value)}
            >
              {g.label}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1 max-h-20 overflow-auto">
          {filteredMarkets.map(m => (
            <Button
              key={m.symbol}
              size="sm"
              variant={symbol === m.symbol ? 'default' : 'ghost'}
              className={`h-6 text-[9px] px-2 ${symbol === m.symbol ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
              onClick={() => setSymbol(m.symbol)}
            >
              {m.name}
            </Button>
          ))}
        </div>
      </div>
      
      {/* Controls */}
      <div className="flex flex-wrap gap-2 justify-between items-center">
        <div className="flex flex-wrap gap-1">
          {TIMEFRAMES.map(tf => (
            <Button
              key={tf}
              size="sm"
              variant={timeframe === tf ? 'default' : 'outline'}
              className="h-7 text-xs px-3"
              onClick={() => setTimeframe(tf)}
            >
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
        {/* LEFT: Chart + Analysis */}
        <div className="xl:col-span-8 space-y-3">
          {/* Chart */}
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
                    style={{ height: 500, cursor: 'crosshair' }}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          
          {/* Price Info */}
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
              <div key={item.label} className="bg-card border rounded-lg p-2 text-center">
                <div className="text-[9px] text-muted-foreground">{item.label}</div>
                <div className={`font-mono text-xs font-bold ${item.color}`}>{item.value}</div>
              </div>
            ))}
          </div>
          
          {/* Indicators Panel */}
          <div className="bg-card border rounded-xl p-3 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold flex items-center gap-1">
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
          
          {/* Digit Analysis */}
          <div className="bg-card border rounded-xl p-3 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold">Digit Analysis</h3>
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
                <div className="h-1.5 bg-muted rounded-full mt-1">
                  <div className="h-full bg-[#D29922] rounded-full" style={{ width: `${oddPct}%` }} />
                </div>
              </div>
              <div className="bg-[#3FB950]/10 border border-[#3FB950]/30 rounded-lg p-2">
                <div className="text-[9px] text-[#3FB950]">Even</div>
                <div className="font-mono text-sm font-bold text-[#3FB950]">{evenPct.toFixed(1)}%</div>
                <div className="h-1.5 bg-muted rounded-full mt-1">
                  <div className="h-full bg-[#3FB950] rounded-full" style={{ width: `${evenPct}%` }} />
                </div>
              </div>
              <div className="bg-primary/10 border border-primary/30 rounded-lg p-2">
                <div className="text-[9px] text-primary">Over 4 (5-9)</div>
                <div className="font-mono text-sm font-bold text-primary">{overPct.toFixed(1)}%</div>
                <div className="h-1.5 bg-muted rounded-full mt-1">
                  <div className="h-full bg-primary rounded-full" style={{ width: `${overPct}%` }} />
                </div>
              </div>
              <div className="bg-[#D29922]/10 border border-[#D29922]/30 rounded-lg p-2">
                <div className="text-[9px] text-[#D29922]">Under 5 (0-4)</div>
                <div className="font-mono text-sm font-bold text-[#D29922]">{underPct.toFixed(1)}%</div>
                <div className="h-1.5 bg-muted rounded-full mt-1">
                  <div className="h-full bg-[#D29922] rounded-full" style={{ width: `${underPct}%` }} />
                </div>
              </div>
            </div>
            
            <div className="grid grid-cols-5 md:grid-cols-10 gap-1.5">
              {Array.from({ length: 10 }, (_, d) => {
                const pct = digitStats.percentages[d] || 0;
                const count = digitStats.frequency[d] || 0;
                const isHot = pct > 12;
                const isWarm = pct > 9;
                const isBestMatch = d === digitStats.mostCommon;
                const isBestDiffer = d === digitStats.leastCommon;
                return (
                  <button
                    key={d}
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
                      <Badge className="absolute -top-1 -right-1 text-[7px] px-1 bg-profit text-profit-foreground">Match</Badge>
                    )}
                    {isBestDiffer && (
                      <Badge className="absolute -top-1 -left-1 text-[7px] px-1 bg-loss text-loss-foreground">Diff</Badge>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
          
          {/* Recommendations */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div className="bg-card border border-profit/30 rounded-lg p-2">
              <div className="text-[9px] text-muted-foreground">Best Match</div>
              <div className="font-mono text-lg font-bold text-profit">{digitStats.mostCommon}</div>
              <div className="text-[8px] text-muted-foreground">{digitStats.percentages[digitStats.mostCommon]?.toFixed(1)}%</div>
            </div>
            <div className="bg-card border border-loss/30 rounded-lg p-2">
              <div className="text-[9px] text-muted-foreground">Best Differ</div>
              <div className="font-mono text-lg font-bold text-loss">{digitStats.leastCommon}</div>
              <div className="text-[8px] text-muted-foreground">{digitStats.percentages[digitStats.leastCommon]?.toFixed(1)}%</div>
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
        
        {/* RIGHT: Signals + Trade + Bot */}
        <div className="xl:col-span-4 space-y-3">
          {/* Voice AI */}
          <div className="bg-card border border-primary/30 rounded-xl p-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold flex items-center gap-1">
                <Zap className="w-3.5 h-3.5 text-primary" /> AI Voice Signals
              </h3>
              <Button
                size="sm"
                variant={voiceEnabled ? 'default' : 'outline'}
                className="h-7 text-[10px] gap-1"
                onClick={() => setVoiceEnabled(!voiceEnabled)}
              >
                {voiceEnabled ? <Volume2 className="w-3 h-3" /> : <VolumeX className="w-3 h-3" />}
                {voiceEnabled ? 'ON' : 'OFF'}
              </Button>
            </div>
          </div>
          
          {/* Signals */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-card border rounded-xl p-3">
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
            </div>
            
            <div className="bg-card border rounded-xl p-3">
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
            </div>
            
            <div className="bg-card border rounded-xl p-3">
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
            </div>
            
            <div className="bg-card border rounded-xl p-3">
              <div className="flex items-center gap-1 mb-1">
                <Target className="w-3.5 h-3.5 text-profit" />
                <span className="text-[10px] font-semibold">Best Match</span>
              </div>
              <div className="font-mono text-sm font-bold text-profit">Digit {matchSignal.digit}</div>
              <div className="text-[8px] text-muted-foreground mb-1">{digitStats.percentages[digitStats.mostCommon]?.toFixed(1)}%</div>
              <div className="h-1.5 bg-muted rounded-full">
                <div className="h-full bg-profit rounded-full" style={{ width: `${matchSignal.confidence}%` }} />
              </div>
            </div>
          </div>
          
          {/* Last Digits */}
          <div className="bg-card border rounded-xl p-3">
            <h3 className="text-xs font-semibold mb-2">Last 26 Digits</h3>
            <div className="flex gap-1 flex-wrap justify-center">
              {getTickHistory(symbol).slice(-26).map((d, i) => {
                const isLast = i === 25;
                const isEven = d % 2 === 0;
                return (
                  <div
                    key={i}
                    className={`w-7 h-9 rounded-lg flex items-center justify-center font-mono font-bold text-xs border-2 ${
                      isLast ? 'w-9 h-11 text-sm ring-2 ring-primary' : ''
                    } ${isEven
                      ? 'border-[#3FB950] text-[#3FB950] bg-[#3FB950]/10'
                      : 'border-[#D29922] text-[#D29922] bg-[#D29922]/10'
                    }`}
                  >
                    {d}
                  </div>
                );
              })}
            </div>
          </div>
          
          {/* Auto Bot */}
          <div className={`bg-card border rounded-xl p-3 space-y-2 ${botRunning ? 'border-profit' : 'border-border'}`}>
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold flex items-center gap-1">
                <Zap className="w-3.5 h-3.5 text-primary" /> Auto Bot
              </h3>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant={turboMode ? 'default' : 'outline'}
                  className={`h-6 text-[9px] px-2 ${turboMode ? 'bg-profit' : ''}`}
                  onClick={() => setTurboMode(!turboMode)}
                  disabled={botRunning}
                >
                  <Zap className="w-3 h-3 mr-0.5" />
                  Turbo
                </Button>
                {botRunning && (
                  <Badge className="text-[8px] bg-profit">RUNNING</Badge>
                )}
              </div>
            </div>
            
            <Select value={botConfig.botSymbol} onValueChange={handleBotSymbolChange} disabled={botRunning}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ALL_MARKETS.map(m => (
                  <SelectItem key={m.symbol} value={m.symbol}>{m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            <Select value={botConfig.contractType} onValueChange={v => setBotConfig(p => ({ ...p, contractType: v }))} disabled={botRunning}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CONTRACT_TYPES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
            
            {['DIGITMATCH', 'DIGITDIFF', 'DIGITOVER', 'DIGITUNDER'].includes(botConfig.contractType) && (
              <div>
                <label className="text-[9px] text-muted-foreground">Prediction (0-9)</label>
                <div className="grid grid-cols-5 gap-1 mt-1">
                  {Array.from({ length: 10 }, (_, i) => (
                    <button
                      key={i}
                      disabled={botRunning}
                      onClick={() => setBotConfig(p => ({ ...p, prediction: String(i) }))}
                      className={`h-6 rounded text-[10px] font-mono font-bold ${
                        botConfig.prediction === String(i) ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-secondary'
                      }`}
                    >
                      {i}
                    </button>
                  ))}
                </div>
              </div>
            )}
            
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[9px] text-muted-foreground">Stake ($)</label>
                <Input type="number" min="0.35" step="0.01" value={botConfig.stake}
                  onChange={e => setBotConfig(p => ({ ...p, stake: e.target.value }))} disabled={botRunning}
                  className="h-7 text-xs" />
              </div>
              <div>
                <label className="text-[9px] text-muted-foreground">Duration</label>
                <div className="flex gap-1">
                  <Input type="number" min="1" value={botConfig.duration}
                    onChange={e => setBotConfig(p => ({ ...p, duration: e.target.value }))} disabled={botRunning}
                    className="h-7 text-xs flex-1" />
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
              <label className="text-[10px]">Martingale</label>
              <div className="flex items-center gap-2">
                {botConfig.martingale && (
                  <Input type="number" min="1.1" step="0.1" value={botConfig.multiplier}
                    onChange={e => setBotConfig(p => ({ ...p, multiplier: e.target.value }))} disabled={botRunning}
                    className="h-6 text-[10px] w-14" />
                )}
                <button
                  onClick={() => setBotConfig(p => ({ ...p, martingale: !p.martingale }))}
                  disabled={botRunning}
                  className={`w-9 h-5 rounded-full transition-colors ${botConfig.martingale ? 'bg-primary' : 'bg-muted'} relative`}
                >
                  <div className={`w-4 h-4 rounded-full bg-background shadow absolute top-0.5 transition-transform ${botConfig.martingale ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </button>
              </div>
            </div>
            
            {/* Strategy */}
            <div className="border-t pt-2 mt-1">
              <div className="flex items-center justify-between mb-2">
                <label className="text-[10px] font-semibold text-warning">Strategy</label>
                <Switch checked={strategyEnabled} onCheckedChange={setStrategyEnabled} disabled={botRunning} />
              </div>
              
              {strategyEnabled && (
                <div className="space-y-2">
                  <div className="flex gap-1">
                    <Button size="sm" variant={strategyMode === 'pattern' ? 'default' : 'outline'}
                      className="text-[9px] h-6 px-2 flex-1" onClick={() => setStrategyMode('pattern')} disabled={botRunning}>
                      Pattern (E/O)
                    </Button>
                    <Button size="sm" variant={strategyMode === 'digit' ? 'default' : 'outline'}
                      className="text-[9px] h-6 px-2 flex-1" onClick={() => setStrategyMode('digit')} disabled={botRunning}>
                      Digit Condition
                    </Button>
                  </div>
                  
                  {strategyMode === 'pattern' ? (
                    <div>
                      <label className="text-[8px] text-muted-foreground">Pattern (E=Even, O=Odd)</label>
                      <Textarea
                        placeholder="e.g., EEEOE"
                        value={patternInput}
                        onChange={e => setPatternInput(e.target.value.toUpperCase().replace(/[^EO]/g, ''))}
                        disabled={botRunning}
                        className="h-12 text-[10px] font-mono min-h-0 mt-1"
                      />
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-1">
                      <div>
                        <label className="text-[8px] text-muted-foreground">Last</label>
                        <Input type="number" min="1" max="50" value={digitWindow}
                          onChange={e => setDigitWindow(e.target.value)} disabled={botRunning}
                          className="h-7 text-[10px]" />
                      </div>
                      <div>
                        <label className="text-[8px] text-muted-foreground">ticks</label>
                        <Select value={digitCondition} onValueChange={setDigitCondition} disabled={botRunning}>
                          <SelectTrigger className="h-7 text-[10px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {['==', '!=', '>', '<', '>=', '<='].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <label className="text-[8px] text-muted-foreground">digit</label>
                        <Input type="number" min="0" max="9" value={digitCompare}
                          onChange={e => setDigitCompare(e.target.value)} disabled={botRunning}
                          className="h-7 text-[10px]" />
                      </div>
                    </div>
                  )}
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
          <div className="bg-card border rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold flex items-center gap-1">
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
          <div className="bg-card border rounded-xl p-3 space-y-2">
            <h3 className="text-xs font-semibold flex items-center gap-1">
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
                <span className="font-mono font-bold text-[#BC8CFF]">
                  {((currentPrice - bb.lower) / (bb.upper - bb.lower) * 100).toFixed(1)}%
                </span>
              </div>
              <div className="h-1.5 bg-muted rounded-full">
                <div className="h-full bg-[#BC8CFF] rounded-full"
                  style={{ width: `${Math.min(100, Math.max(0, (currentPrice - bb.lower) / (bb.upper - bb.lower) * 100))}%` }} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
