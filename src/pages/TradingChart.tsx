import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { derivApi, type MarketSymbol } from '@/services/deriv-api';
import { getLastDigit, analyzeDigits, calculateRSI, calculateMACD, calculateBollingerBands } from '@/services/analysis';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import {
  TrendingUp, TrendingDown, Activity, BarChart3, ArrowUp, ArrowDown, Minus,
  Target, ShieldAlert, Gauge, Volume2, VolumeX, Clock, Zap, Trophy,
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
const TF_TICKS: Record<string,number> = {
  '1m':1000,'3m':2000,'5m':3000,'15m':4000,'30m':4500,'1h':5000,'4h':5000,'12h':5000,'1d':5000,
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

/* ── Map candle index back to price-series index for indicators ── */
function mapCandlesToPriceIndices(prices: number[], times: number[], tf: string): number[] {
  // returns the ending price-index for each candle
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
}

export default function TradingChart() {
  const { isAuthorized } = useAuth();
  const [symbol, setSymbol] = useState('R_100');
  const [groupFilter, setGroupFilter] = useState('all');
  const [timeframe, setTimeframe] = useState('1m');
  const [prices, setPrices] = useState<number[]>([]);
  const [times, setTimes] = useState<number[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const subscribedRef = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

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
        setScrollOffset(0);
        setIsLoading(false);

        if (!subscribedRef.current) {
          subscribedRef.current = true;
          await derivApi.subscribeTicks(symbol as MarketSymbol, (data: any) => {
            if (!active || !data.tick) return;
            setPrices(prev => [...prev, data.tick.quote].slice(-5000));
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

  /* ── Derived data ── */
  const tfTicks = TF_TICKS[timeframe] || 60;
  const tfPrices = useMemo(() => prices.slice(-tfTicks), [prices, tfTicks]);
  const tfTimes = useMemo(() => times.slice(-tfTicks), [times, tfTicks]);
  const candles = useMemo(() => buildCandles(tfPrices, tfTimes, timeframe), [tfPrices, tfTimes, timeframe]);
  const currentPrice = prices[prices.length - 1] || 0;
  const lastDigit = getLastDigit(currentPrice);
  const digits = useMemo(() => tfPrices.map(getLastDigit), [tfPrices]);
  const last18 = useMemo(() => digits.slice(-18), [digits]);
  const { frequency, percentages, mostCommon, leastCommon } = useMemo(() => analyzeDigits(tfPrices), [tfPrices]);

  // Indicators
  const bb = useMemo(() => calculateBollingerBands(tfPrices, 20), [tfPrices]);
  const ema50 = useMemo(() => calcEMA(tfPrices, 50), [tfPrices]);
  const { support, resistance } = useMemo(() => calcSR(tfPrices), [tfPrices]);
  const rsi = useMemo(() => calculateRSI(tfPrices, 14), [tfPrices]);
  const macd = useMemo(() => calcMACDFull(tfPrices), [tfPrices]);

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
  const bbRange = bb.upper - bb.lower || 1;
  const bbPosition = ((currentPrice - bb.lower) / bbRange * 100);

  // Multi-TF S/R
  const multiTfSR = useMemo(() => {
    return TIMEFRAMES.map(tf => {
      const n = TF_TICKS[tf] || 60;
      const p = prices.slice(-n);
      const sr = calcSR(p);
      const dist_s = currentPrice > 0 ? ((currentPrice - sr.support) / currentPrice * 100) : 0;
      const dist_r = currentPrice > 0 ? ((sr.resistance - currentPrice) / currentPrice * 100) : 0;
      return { tf, ...sr, dist_s, dist_r };
    });
  }, [prices, currentPrice]);

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
    const bestPct = Math.max(...percentages);
    return { digit: mostCommon, confidence: Math.min(90, Math.round(bestPct * 3)) };
  }, [percentages, mostCommon]);

  /* ── Canvas Chart ── */
  // Per-candle indicator series
  const candleEndIndices = useMemo(() => mapCandlesToPriceIndices(tfPrices, tfTimes, timeframe), [tfPrices, tfTimes, timeframe]);
  const emaSeries = useMemo(() => calcEMASeries(tfPrices, 50), [tfPrices]);
  const smaSeries = useMemo(() => calcSMASeries(tfPrices, 20), [tfPrices]);
  const bbSeries = useMemo(() => calcBBSeries(tfPrices, 20, 2), [tfPrices]);
  const rsiSeries = useMemo(() => calcRSISeries(tfPrices, 14), [tfPrices]);

  // Canvas mouse handlers for zoom & pan
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        // Zoom
        setCandleWidth(prev => Math.max(2, Math.min(20, prev - Math.sign(e.deltaY))));
      } else {
        // Scroll
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
  }, [candles.length, scrollOffset, candleWidth]);

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
    const totalH = rect.height;
    const rsiH = 80;
    const H = totalH - rsiH - 8;
    const priceAxisW = 70;
    const chartW = W - priceAxisW;

    // Background
    ctx.fillStyle = '#0D1117';
    ctx.fillRect(0, 0, W, totalH);

    // ── Visible candles based on zoom & scroll ──
    const gap = 1;
    const totalCandleW = candleWidth + gap;
    const maxVisible = Math.floor(chartW / totalCandleW);
    const endIdx = candles.length - scrollOffset;
    const startIdx = Math.max(0, endIdx - maxVisible);
    const visibleCandles = candles.slice(startIdx, endIdx);
    const visibleEndIndices = candleEndIndices.slice(startIdx, endIdx);

    if (visibleCandles.length < 1) return;

    // ── Price scale — center candles in view ──
    const allPrices = visibleCandles.flatMap(c => [c.high, c.low]);
    // Include BB bounds for proper centering
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
    // Center the visible price range
    const chartPadTop = 20;
    const chartPadBot = 20;
    const drawH = H - chartPadTop - chartPadBot;
    const toY = (p: number) => chartPadTop + ((maxP - p) / range) * drawH;

    // ── Grid ──
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

    // ── Draw helpers ──
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

    // ── BB fill area ──
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

    // BB lines
    drawLine(bbSeries.upper, '#BC8CFF', 1.2, [5, 3]);
    drawLine(bbSeries.middle, '#BC8CFF', 1.5);
    drawLine(bbSeries.lower, '#BC8CFF', 1.2, [5, 3]);

    // EMA 50 line
    drawLine(emaSeries, '#2F81F7', 1.5);

    // SMA 20 (Moving Average) line
    drawLine(smaSeries, '#E6B422', 1.5);

    // Support line
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = '#3FB950';
    ctx.lineWidth = 1.5;
    const supY = toY(support);
    ctx.beginPath(); ctx.moveTo(0, supY); ctx.lineTo(chartW, supY); ctx.stroke();

    // Resistance line
    ctx.strokeStyle = '#F85149';
    const resY = toY(resistance);
    ctx.beginPath(); ctx.moveTo(0, resY); ctx.lineTo(chartW, resY); ctx.stroke();
    ctx.setLineDash([]);

    // S/R labels on price axis
    ctx.font = '9px JetBrains Mono, monospace';
    ctx.fillStyle = '#3FB950';
    ctx.fillRect(chartW, supY - 7, priceAxisW, 14);
    ctx.fillStyle = '#0D1117';
    ctx.fillText(`S ${support.toFixed(4)}`, chartW + 2, supY + 3);
    ctx.fillStyle = '#F85149';
    ctx.fillRect(chartW, resY - 7, priceAxisW, 14);
    ctx.fillStyle = '#0D1117';
    ctx.fillText(`R ${resistance.toFixed(4)}`, chartW + 2, resY + 3);

    // ── Candlesticks ──
    for (let i = 0; i < visibleCandles.length; i++) {
      const c = visibleCandles[i];
      const x = offsetX + i * totalCandleW;
      const isGreen = c.close >= c.open;
      const color = isGreen ? '#3FB950' : '#F85149';

      // Wick
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + candleWidth / 2, toY(c.high));
      ctx.lineTo(x + candleWidth / 2, toY(c.low));
      ctx.stroke();

      // Body
      const bodyTop = toY(Math.max(c.open, c.close));
      const bodyBot = toY(Math.min(c.open, c.close));
      const bodyH = Math.max(1, bodyBot - bodyTop);
      ctx.fillStyle = color;
      ctx.fillRect(x, bodyTop, candleWidth, bodyH);
    }

    // ── Current price line ──
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

    // ── Indicator legend ──
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

    // ── Zoom info ──
    ctx.fillStyle = '#484F58';
    ctx.font = '9px JetBrains Mono, monospace';
    ctx.fillText(`${visibleCandles.length} candles | Scroll: wheel | Zoom: Ctrl+wheel | Drag to pan`, 8, H - 6);

    // ══════ RSI Subplot ══════
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

    // RSI line
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

    // RSI current value
    const lastRsi = rsi;
    const rsiColor = lastRsi > 70 ? '#F85149' : lastRsi < 30 ? '#3FB950' : '#D29922';
    ctx.fillStyle = rsiColor;
    ctx.fillRect(chartW, rsiToY(lastRsi) - 7, priceAxisW, 14);
    ctx.fillStyle = '#0D1117';
    ctx.font = 'bold 9px JetBrains Mono, monospace';
    ctx.fillText(lastRsi.toFixed(1), chartW + 2, rsiToY(lastRsi) + 3);

    // Overbought/Oversold zones
    ctx.fillStyle = 'rgba(248, 81, 73, 0.04)';
    ctx.fillRect(0, rsiTop, chartW, rsiToY(70) - rsiTop);
    ctx.fillStyle = 'rgba(63, 185, 80, 0.04)';
    ctx.fillRect(0, rsiToY(30), chartW, rsiTop + rsiH - rsiToY(30));

  }, [candles, bb, ema50, support, resistance, currentPrice, candleEndIndices, emaSeries, smaSeries, bbSeries, rsiSeries, rsi, candleWidth, scrollOffset]);

  const filteredMarkets = groupFilter === 'all' ? ALL_MARKETS : ALL_MARKETS.filter(m => m.group === groupFilter);
  const marketName = ALL_MARKETS.find(m => m.symbol === symbol)?.name || symbol;

  // Multi-timeframe Rise/Fall predictions
  const multiTfPredictions = useMemo(() => {
    const tfList = ['1m', '3m', '5m', '15m', '30m', '1h', '4h'];
    return tfList.map(tf => {
      const n = TF_TICKS[tf] || 1000;
      const p = prices.slice(-n);
      if (p.length < 30) return { tf, direction: 'N/A' as const, confidence: 0, rsi: 50, trend: 0 };
      const tfRsi = calculateRSI(p, 14);
      const ema12 = calcEMA(p, 12);
      const ema26 = calcEMA(p, 26);
      const trend = ema12 - ema26;
      const last = p[p.length - 1];
      const sma = p.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, p.length);
      const aboveSma = last > sma;
      
      // Score: RSI + trend + SMA position
      let score = 50;
      if (tfRsi < 30) score += 25; else if (tfRsi < 45) score += 10;
      else if (tfRsi > 70) score -= 25; else if (tfRsi > 55) score -= 10;
      if (trend > 0) score += 15; else score -= 15;
      if (aboveSma) score += 10; else score -= 10;
      
      const direction = score >= 50 ? 'Rise' : 'Fall';
      const confidence = Math.min(95, Math.max(15, Math.round(Math.abs(score - 50) * 2 + 40)));
      return { tf, direction, confidence, rsi: tfRsi, trend };
    });
  }, [prices]);

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

  // Announce strong signals
  useEffect(() => {
    if (!voiceEnabled) return;
    const strongSignals = multiTfPredictions.filter(p => p.confidence >= 75);
    if (strongSignals.length >= 3) {
      const direction = strongSignals[0].direction;
      const tfs = strongSignals.map(s => s.tf).join(', ');
      speak(`Strong ${direction} signal detected across ${tfs} timeframes with over 75% confidence`);
    }
  }, [multiTfPredictions, voiceEnabled, speak]);

  // Trade execution
  const handleBuy = async (side: 'buy' | 'sell') => {
    if (!isAuthorized) {
      toast.error('Please login to your Deriv account first');
      return;
    }
    if (isTrading) return;
    setIsTrading(true);

    const ct = side === 'buy' ? contractType : 
      (contractType === 'CALL' ? 'PUT' : contractType === 'PUT' ? 'CALL' : contractType);

    const params: any = {
      contract_type: ct,
      symbol,
      duration: parseInt(duration),
      duration_unit: durationUnit,
      basis: 'stake',
      amount: parseFloat(tradeStake),
    };

    // Add barrier for digit contracts
    if (['DIGITMATCH', 'DIGITDIFF'].includes(ct)) {
      params.barrier = prediction;
    } else if (ct === 'DIGITOVER') {
      params.barrier = prediction;
    } else if (ct === 'DIGITUNDER') {
      params.barrier = prediction;
    }

    try {
      toast.info(`⏳ Placing ${ct} trade... $${tradeStake}`);
      const { contractId, buyPrice } = await derivApi.buyContract(params);
      
      const newTrade: TradeRecord = {
        id: contractId,
        time: Date.now(),
        type: ct,
        stake: parseFloat(tradeStake),
        profit: 0,
        status: 'open',
        symbol,
      };
      setTradeHistory(prev => [newTrade, ...prev].slice(0, 50));

      // Wait for result
      const result = await derivApi.waitForContractResult(contractId);
      setTradeHistory(prev => prev.map(t => 
        t.id === contractId ? { ...t, profit: result.profit, status: result.status } : t
      ));

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
          <p className="text-xs text-muted-foreground">{marketName} • {timeframe} • {tfPrices.length} ticks</p>
        </div>
        <Badge className="font-mono text-sm" variant="outline">
          {currentPrice.toFixed(4)}
        </Badge>
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

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        {/* ═══ LEFT: Chart + Info ═══ */}
        <div className="xl:col-span-8 space-y-3">
          {/* Candlestick Chart */}
          <div className="bg-[#0D1117] border border-[#30363D] rounded-xl overflow-hidden">
            <canvas ref={canvasRef} className="w-full" style={{ height: 520, cursor: 'crosshair' }} />
          </div>

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

          {/* Last 18 Digits */}
          <div className="bg-card border border-border rounded-xl p-3">
            <h3 className="text-xs font-semibold text-foreground mb-2">Last 18 Digits</h3>
            <div className="flex gap-1 flex-wrap justify-center">
              {last18.map((d, i) => {
                const isLast = i === last18.length - 1;
                const isEven = d % 2 === 0;
                return (
                  <motion.div
                    key={i}
                    initial={isLast ? { scale: 0.8 } : {}}
                    animate={isLast ? { scale: [1, 1.1, 1] } : {}}
                    transition={isLast ? { duration: 1, repeat: Infinity } : {}}
                    className={`w-8 h-10 rounded-lg flex items-center justify-center font-mono font-bold text-sm border-2 transition-all ${
                      isLast ? 'w-10 h-12 text-base ring-2 ring-primary' : ''
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

          {/* Digit Analysis */}
          <div className="bg-card border border-border rounded-xl p-3 space-y-3">
            <h3 className="text-xs font-semibold text-foreground">Digit Analysis</h3>

            {/* Stats cards */}
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

            {/* Digit Grid 0-9 */}
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
                      <Badge className="absolute -top-1 -right-1 text-[7px] px-1 bg-profit text-profit-foreground">Match</Badge>
                    )}
                    {isBestDiffer && (
                      <Badge className="absolute -top-1 -left-1 text-[7px] px-1 bg-loss text-loss-foreground">Avoid</Badge>
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

          {/* Multi-TF S/R Table */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="p-2.5 border-b border-border">
              <h3 className="text-xs font-semibold text-foreground">Multi-Timeframe Support/Resistance</h3>
            </div>
            <div className="overflow-auto">
              <table className="w-full text-[10px]">
                <thead className="bg-muted/30 text-muted-foreground">
                  <tr>
                    <th className="p-1.5 text-left">TF</th>
                    <th className="p-1.5 text-right">Support</th>
                    <th className="p-1.5 text-right">Resistance</th>
                    <th className="p-1.5 text-right">Dist S%</th>
                    <th className="p-1.5 text-right">Dist R%</th>
                  </tr>
                </thead>
                <tbody>
                  {multiTfSR.map(row => (
                    <tr key={row.tf} className={`border-t border-border/30 ${row.tf === timeframe ? 'bg-primary/10' : ''}`}>
                      <td className="p-1.5 font-mono font-bold">{row.tf}</td>
                      <td className="p-1.5 text-right font-mono text-[#3FB950]">{row.support.toFixed(2)}</td>
                      <td className="p-1.5 text-right font-mono text-[#F85149]">{row.resistance.toFixed(2)}</td>
                      <td className="p-1.5 text-right font-mono">{row.dist_s.toFixed(3)}%</td>
                      <td className="p-1.5 text-right font-mono">{row.dist_r.toFixed(3)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
              <p className="text-[9px] text-muted-foreground mt-1">🔊 AI will announce strong signals across timeframes</p>
            )}
          </div>

          {/* Multi-Timeframe Rise/Fall Predictions */}
          <div className="bg-card border border-border rounded-xl p-3 space-y-2">
            <h3 className="text-xs font-semibold text-foreground flex items-center gap-1">
              <Clock className="w-3.5 h-3.5 text-primary" /> Rise/Fall Predictions
            </h3>
            <div className="space-y-1.5">
              {multiTfPredictions.map(p => (
                <div key={p.tf} className="flex items-center gap-2">
                  <span className="text-[10px] font-mono font-bold w-8 text-muted-foreground">{p.tf}</span>
                  <div className="flex-1 h-5 bg-muted rounded-full overflow-hidden relative">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${p.confidence}%` }}
                      transition={{ duration: 0.6 }}
                      className={`h-full rounded-full ${p.direction === 'Rise' ? 'bg-profit' : 'bg-loss'}`}
                    />
                    <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-foreground">
                      {p.direction} {p.confidence}%
                    </span>
                  </div>
                  {p.direction === 'Rise' 
                    ? <TrendingUp className="w-3.5 h-3.5 text-profit" />
                    : <TrendingDown className="w-3.5 h-3.5 text-loss" />
                  }
                </div>
              ))}
            </div>
            <div className="text-[8px] text-muted-foreground text-center mt-1">
              Based on RSI, EMA crossover & SMA position analysis
            </div>
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

          {/* Quick Trade Panel */}
          <div className="bg-card border border-primary/30 rounded-xl p-3 space-y-2">
            <h3 className="text-xs font-semibold text-foreground flex items-center gap-1">
              <Gauge className="w-3.5 h-3.5 text-primary" /> Quick Trade
            </h3>
            <Select value={contractType} onValueChange={setContractType}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{CONTRACT_TYPES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
            </Select>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[9px] text-muted-foreground">Prediction (0-9)</label>
                <Input type="number" min="0" max="9" value={prediction} onChange={e => setPrediction(e.target.value)} className="h-7 text-xs" />
              </div>
              <div>
                <label className="text-[9px] text-muted-foreground">Stake ($)</label>
                <Input type="number" min="0.35" step="0.01" value={tradeStake} onChange={e => setTradeStake(e.target.value)} className="h-7 text-xs" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[9px] text-muted-foreground">Duration</label>
                <Input type="number" min="1" value={duration} onChange={e => setDuration(e.target.value)} className="h-7 text-xs" />
              </div>
              <div>
                <label className="text-[9px] text-muted-foreground">Unit</label>
                <Select value={durationUnit} onValueChange={setDurationUnit}>
                  <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="t">Ticks</SelectItem>
                    <SelectItem value="s">Seconds</SelectItem>
                    <SelectItem value="m">Minutes</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {selectedDigit !== null && (
              <div className="text-[9px] text-primary">Auto-suggestion: Digit {selectedDigit} ({percentages[selectedDigit]?.toFixed(1)}%)</div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Button onClick={() => handleBuy('buy')} disabled={isTrading} className="h-9 text-xs font-bold bg-profit hover:bg-profit/90 text-profit-foreground">
                {isTrading ? <span className="animate-spin">⏳</span> : <ArrowUp className="w-3 h-3 mr-1" />} BUY
              </Button>
              <Button onClick={() => handleBuy('sell')} disabled={isTrading} className="h-9 text-xs font-bold bg-loss hover:bg-loss/90 text-loss-foreground">
                {isTrading ? <span className="animate-spin">⏳</span> : <ArrowDown className="w-3 h-3 mr-1" />} SELL
              </Button>
            </div>
          </div>

          {/* Bot Progress */}
          <div className="bg-card border border-border rounded-xl p-3 space-y-2">
            <h3 className="text-xs font-semibold text-foreground flex items-center gap-1">
              <Trophy className="w-3.5 h-3.5 text-primary" /> Trade Progress
            </h3>
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
