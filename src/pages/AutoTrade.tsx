import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { derivApi, type MarketSymbol } from '@/services/deriv-api';
import { getLastDigit } from '@/services/analysis';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import {
  Scan, TrendingUp, TrendingDown, Activity, Target, Shield,
  Zap, RefreshCw, Eye, Volume2, VolumeX, Play, Pause, StopCircle,
  ArrowUp, ArrowDown, Crown, Sparkles, Timer, Gauge, Flame
} from 'lucide-react';

/* ───── ALL VOLATILITY MARKETS ───── */
const VOLATILITY_MARKETS = [
  // Volatility 1s
  { symbol: '1HZ10V', name: 'V10 (1s)', group: '1s', vol: 10 },
  { symbol: '1HZ25V', name: 'V25 (1s)', group: '1s', vol: 25 },
  { symbol: '1HZ50V', name: 'V50 (1s)', group: '1s', vol: 50 },
  { symbol: '1HZ75V', name: 'V75 (1s)', group: '1s', vol: 75 },
  { symbol: '1HZ100V', name: 'V100 (1s)', group: '1s', vol: 100 },
  // Standard Volatility
  { symbol: 'R_10', name: 'Vol 10', group: 'standard', vol: 10 },
  { symbol: 'R_25', name: 'Vol 25', group: 'standard', vol: 25 },
  { symbol: 'R_50', name: 'Vol 50', group: 'standard', vol: 50 },
  { symbol: 'R_75', name: 'Vol 75', group: 'standard', vol: 75 },
  { symbol: 'R_100', name: 'Vol 100', group: 'standard', vol: 100 },
  // Jump
  { symbol: 'JD10', name: 'Jump 10', group: 'jump', vol: 10 },
  { symbol: 'JD25', name: 'Jump 25', group: 'jump', vol: 25 },
  { symbol: 'JD50', name: 'Jump 50', group: 'jump', vol: 50 },
  { symbol: 'JD75', name: 'Jump 75', group: 'jump', vol: 75 },
  { symbol: 'JD100', name: 'Jump 100', group: 'jump', vol: 100 },
];

const GROUP_FILTERS = [
  { value: 'all', label: 'All Markets' },
  { value: '1s', label: '1s Volatility' },
  { value: 'standard', label: 'Standard Vol' },
  { value: 'jump', label: 'Jump Index' },
];

type SignalType = 'rise' | 'fall' | 'even' | 'odd' | 'over' | 'under' | 'match' | 'differ';
type SignalStrength = 'strong' | 'moderate' | 'weak';

interface MarketSignal {
  symbol: string;
  name: string;
  type: SignalType;
  direction: string;
  confidence: number;
  strength: SignalStrength;
  digit?: number;
  value: number;
  lastDigit: number;
  evenPct: number;
  oddPct: number;
  overPct: number;
  underPct: number;
  rsi: number;
  trend: number;
}

interface MarketData {
  symbol: string;
  name: string;
  prices: number[];
  digits: number[];
  lastPrice: number;
  lastDigit: number;
  evenCount: number;
  oddCount: number;
  overCount: number;
  underCount: number;
  evenPct: number;
  oddPct: number;
  overPct: number;
  underPct: number;
  digitFreq: Record<number, number>;
  digitPct: Record<number, number>;
  mostCommonDigit: number;
  leastCommonDigit: number;
  rsi: number;
  trend: number;
}

/* ── Helper: Calculate RSI ── */
function calcRSI(prices: number[], period: number = 14): number {
  if (prices.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = prices[prices.length - i] - prices[prices.length - i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

/* ── Helper: Calculate EMA trend ── */
function calcTrend(prices: number[]): number {
  if (prices.length < 26) return 0;
  const ema12 = calcEMA(prices, 12);
  const ema26 = calcEMA(prices, 26);
  return ema12 - ema26;
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

/* ── Digit frequency analysis ── */
function analyzeDigitsFreq(digits: number[]) {
  const freq: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0 };
  for (const d of digits) freq[d] = (freq[d] || 0) + 1;
  
  const pct: Record<number, number> = {};
  const total = digits.length || 1;
  for (let i = 0; i < 10; i++) pct[i] = (freq[i] / total) * 100;
  
  let mostCommon = 0, leastCommon = 0;
  for (let i = 1; i < 10; i++) {
    if (freq[i] > freq[mostCommon]) mostCommon = i;
    if (freq[i] < freq[leastCommon]) leastCommon = i;
  }
  
  return { freq, pct, mostCommon, leastCommon };
}

export default function SignalScanner() {
  const { isAuthorized, balance } = useAuth();
  
  // State
  const [groupFilter, setGroupFilter] = useState('all');
  const [marketsData, setMarketsData] = useState<Map<string, MarketData>>(new Map());
  const [signals, setSignals] = useState<MarketSignal[]>([]);
  const [topSignals, setTopSignals] = useState<MarketSignal[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [scanInterval, setScanInterval] = useState(3000);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [selectedMarket, setSelectedMarket] = useState<string>('R_100');
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastSpokenRef = useRef<string>('');

  // Subscribe to all markets
  useEffect(() => {
    if (!derivApi.isConnected) return;
    
    const subscriptions: string[] = [];
    
    const handler = (data: any) => {
      if (!data.tick) return;
      const symbol = data.tick.symbol as string;
      const market = VOLATILITY_MARKETS.find(m => m.symbol === symbol);
      if (!market) return;
      
      const price = data.tick.quote;
      const digit = getLastDigit(price);
      
      setMarketsData(prev => {
        const existing = prev.get(symbol);
        const newPrices = existing ? [...existing.prices, price].slice(-500) : [price];
        const newDigits = existing ? [...existing.digits, digit].slice(-500) : [digit];
        
        const evenCount = newDigits.filter(d => d % 2 === 0).length;
        const oddCount = newDigits.length - evenCount;
        const overCount = newDigits.filter(d => d > 4).length;
        const underCount = newDigits.length - overCount;
        const evenPct = newDigits.length > 0 ? (evenCount / newDigits.length) * 100 : 50;
        const oddPct = 100 - evenPct;
        const overPct = newDigits.length > 0 ? (overCount / newDigits.length) * 100 : 50;
        const underPct = 100 - overPct;
        
        const { freq, pct, mostCommon, leastCommon } = analyzeDigitsFreq(newDigits);
        const rsi = calcRSI(newPrices);
        const trend = calcTrend(newPrices);
        
        const updated: MarketData = {
          symbol,
          name: market.name,
          prices: newPrices,
          digits: newDigits,
          lastPrice: price,
          lastDigit: digit,
          evenCount,
          oddCount,
          overCount,
          underCount,
          evenPct,
          oddPct,
          overPct,
          underPct,
          digitFreq: freq,
          digitPct: pct,
          mostCommonDigit: mostCommon,
          leastCommonDigit: leastCommon,
          rsi,
          trend,
        };
        
        const newMap = new Map(prev);
        newMap.set(symbol, updated);
        return newMap;
      });
    };
    
    const unsub = derivApi.onMessage(handler);
    
    // Subscribe to all markets
    VOLATILITY_MARKETS.forEach(async market => {
      try {
        await derivApi.subscribeTicks(market.symbol as MarketSymbol, () => {});
        subscriptions.push(market.symbol);
      } catch (err) {
        console.error(`Failed to subscribe to ${market.symbol}:`, err);
      }
    });
    
    return () => {
      unsub();
      subscriptions.forEach(symbol => {
        derivApi.unsubscribeTicks(symbol as MarketSymbol).catch(() => {});
      });
    };
  }, []);
  
  // Calculate signals for each market
  const calculateSignals = useCallback(() => {
    const allSignals: MarketSignal[] = [];
    
    for (const [symbol, data] of marketsData) {
      if (data.prices.length < 20) continue;
      
      // Rise/Fall signal based on RSI and trend
      let riseConfidence = 50;
      let fallConfidence = 50;
      
      if (data.rsi < 30) riseConfidence += 25;
      else if (data.rsi < 45) riseConfidence += 10;
      else if (data.rsi > 70) riseConfidence -= 25;
      else if (data.rsi > 55) riseConfidence -= 10;
      
      if (data.trend > 0) riseConfidence += 15;
      else riseConfidence -= 15;
      
      fallConfidence = 100 - riseConfidence;
      riseConfidence = Math.min(95, Math.max(10, riseConfidence));
      fallConfidence = Math.min(95, Math.max(10, fallConfidence));
      
      // Even/Odd signal
      const evenConfidence = Math.min(90, Math.abs(data.evenPct - 50) * 2 + 50);
      const oddConfidence = Math.min(90, Math.abs(data.oddPct - 50) * 2 + 50);
      
      // Over/Under signal
      const overConfidence = Math.min(90, Math.abs(data.overPct - 50) * 2 + 50);
      const underConfidence = Math.min(90, Math.abs(data.underPct - 50) * 2 + 50);
      
      // Match signal (most common digit)
      const matchConfidence = Math.min(90, (data.digitPct[data.mostCommonDigit] || 0) * 2);
      
      // Differ signal (least common digit)
      const differConfidence = Math.min(90, 100 - (data.digitPct[data.leastCommonDigit] || 0));
      
      allSignals.push(
        { symbol, name: data.name, type: 'rise', direction: 'Rise', confidence: riseConfidence, strength: getStrength(riseConfidence), value: data.rsi, lastDigit: data.lastDigit, evenPct: data.evenPct, oddPct: data.oddPct, overPct: data.overPct, underPct: data.underPct, rsi: data.rsi, trend: data.trend },
        { symbol, name: data.name, type: 'fall', direction: 'Fall', confidence: fallConfidence, strength: getStrength(fallConfidence), value: data.rsi, lastDigit: data.lastDigit, evenPct: data.evenPct, oddPct: data.oddPct, overPct: data.overPct, underPct: data.underPct, rsi: data.rsi, trend: data.trend },
        { symbol, name: data.name, type: 'even', direction: 'Even', confidence: evenConfidence, strength: getStrength(evenConfidence), value: data.evenPct, lastDigit: data.lastDigit, evenPct: data.evenPct, oddPct: data.oddPct, overPct: data.overPct, underPct: data.underPct, rsi: data.rsi, trend: data.trend },
        { symbol, name: data.name, type: 'odd', direction: 'Odd', confidence: oddConfidence, strength: getStrength(oddConfidence), value: data.oddPct, lastDigit: data.lastDigit, evenPct: data.evenPct, oddPct: data.oddPct, overPct: data.overPct, underPct: data.underPct, rsi: data.rsi, trend: data.trend },
        { symbol, name: data.name, type: 'over', direction: 'Over 4', confidence: overConfidence, strength: getStrength(overConfidence), value: data.overPct, lastDigit: data.lastDigit, evenPct: data.evenPct, oddPct: data.oddPct, overPct: data.overPct, underPct: data.underPct, rsi: data.rsi, trend: data.trend },
        { symbol, name: data.name, type: 'under', direction: 'Under 5', confidence: underConfidence, strength: getStrength(underConfidence), value: data.underPct, lastDigit: data.lastDigit, evenPct: data.evenPct, oddPct: data.oddPct, overPct: data.overPct, underPct: data.underPct, rsi: data.rsi, trend: data.trend },
        { symbol, name: data.name, type: 'match', direction: `Match ${data.mostCommonDigit}`, confidence: matchConfidence, strength: getStrength(matchConfidence), digit: data.mostCommonDigit, value: data.digitPct[data.mostCommonDigit], lastDigit: data.lastDigit, evenPct: data.evenPct, oddPct: data.oddPct, overPct: data.overPct, underPct: data.underPct, rsi: data.rsi, trend: data.trend },
        { symbol, name: data.name, type: 'differ', direction: `Differ ${data.leastCommonDigit}`, confidence: differConfidence, strength: getStrength(differConfidence), digit: data.leastCommonDigit, value: 100 - (data.digitPct[data.leastCommonDigit] || 0), lastDigit: data.lastDigit, evenPct: data.evenPct, oddPct: data.oddPct, overPct: data.overPct, underPct: data.underPct, rsi: data.rsi, trend: data.trend }
      );
    }
    
    // Sort by confidence
    allSignals.sort((a, b) => b.confidence - a.confidence);
    setSignals(allSignals);
    
    // Get top 4 unique markets with best signals
    const uniqueMarkets = new Map<string, MarketSignal>();
    for (const signal of allSignals) {
      if (!uniqueMarkets.has(signal.symbol) && signal.confidence >= 60) {
        uniqueMarkets.set(signal.symbol, signal);
      }
      if (uniqueMarkets.size >= 4) break;
    }
    
    const top = Array.from(uniqueMarkets.values());
    setTopSignals(top);
    
    // Voice announcement for strong signals
    if (voiceEnabled && top.length > 0) {
      const best = top[0];
      const message = `Strong ${best.direction} signal on ${best.name} with ${best.confidence} percent confidence`;
      if (lastSpokenRef.current !== message) {
        lastSpokenRef.current = message;
        speak(message);
      }
    }
    
  }, [marketsData, voiceEnabled]);
  
  const getStrength = (confidence: number): SignalStrength => {
    if (confidence >= 75) return 'strong';
    if (confidence >= 55) return 'moderate';
    return 'weak';
  };
  
  const getStrengthColor = (strength: SignalStrength) => {
    switch (strength) {
      case 'strong': return 'bg-profit text-profit-foreground';
      case 'moderate': return 'bg-warning text-warning-foreground';
      default: return 'bg-muted text-muted-foreground';
    }
  };
  
  const getStrengthIcon = (strength: SignalStrength) => {
    switch (strength) {
      case 'strong': return <Flame className="w-3 h-3" />;
      case 'moderate': return <Sparkles className="w-3 h-3" />;
      default: return <Timer className="w-3 h-3" />;
    }
  };
  
  const speak = (text: string) => {
    if (!voiceEnabled || !window.speechSynthesis) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    utterance.pitch = 1;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  };
  
  // Auto-refresh signals
  useEffect(() => {
    if (autoRefresh && marketsData.size > 0) {
      calculateSignals();
      intervalRef.current = setInterval(calculateSignals, scanInterval);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoRefresh, marketsData, calculateSignals, scanInterval]);
  
  // Manual scan
  const handleManualScan = () => {
    setIsScanning(true);
    calculateSignals();
    toast.success(`Scanned ${marketsData.size} markets`);
    setTimeout(() => setIsScanning(false), 500);
  };
  
  const filteredMarkets = groupFilter === 'all' 
    ? VOLATILITY_MARKETS 
    : VOLATILITY_MARKETS.filter(m => m.group === groupFilter);
  
  const selectedMarketData = marketsData.get(selectedMarket);
  
  return (
    <div className="space-y-4 max-w-[1920px] mx-auto p-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Scan className="w-5 h-5 text-primary" /> Signal Scanner
          </h1>
          <p className="text-xs text-muted-foreground">
            Real-time signal analysis across {marketsData.size} volatility markets
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="font-mono">
            <Zap className="w-3 h-3 mr-1" /> {marketsData.size} Active
          </Badge>
          <Button
            size="sm"
            variant={voiceEnabled ? 'default' : 'outline'}
            className="h-7 text-[10px] gap-1"
            onClick={() => setVoiceEnabled(!voiceEnabled)}
          >
            {voiceEnabled ? <Volume2 className="w-3 h-3" /> : <VolumeX className="w-3 h-3" />}
            Voice
          </Button>
        </div>
      </div>
      
      {/* Control Bar */}
      <div className="bg-card border border-border rounded-xl p-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {GROUP_FILTERS.map(g => (
            <Button
              key={g.value}
              size="sm"
              variant={groupFilter === g.value ? 'default' : 'outline'}
              className="h-7 text-[10px] px-2"
              onClick={() => setGroupFilter(g.value)}
            >
              {g.label}
            </Button>
          ))}
        </div>
        
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <span className="text-[9px] text-muted-foreground">Auto-refresh</span>
            <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} />
          </div>
          
          {autoRefresh && (
            <Select value={String(scanInterval)} onValueChange={v => setScanInterval(parseInt(v))}>
              <SelectTrigger className="h-7 text-[10px] w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1000">1s</SelectItem>
                <SelectItem value="2000">2s</SelectItem>
                <SelectItem value="3000">3s</SelectItem>
                <SelectItem value="5000">5s</SelectItem>
              </SelectContent>
            </Select>
          )}
          
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[10px] gap-1"
            onClick={handleManualScan}
            disabled={isScanning}
          >
            <RefreshCw className={`w-3 h-3 ${isScanning ? 'animate-spin' : ''}`} />
            Scan Now
          </Button>
        </div>
      </div>
      
      {/* Top 4 Signals Dashboard */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {topSignals.length === 0 ? (
          <div className="col-span-full text-center py-8 text-muted-foreground">
            <Scan className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">Waiting for market data...</p>
            <p className="text-xs">Signals will appear here once enough ticks are collected</p>
          </div>
        ) : (
          topSignals.map((signal, idx) => (
            <motion.div
              key={`${signal.symbol}-${signal.type}`}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.1 }}
              className={`relative overflow-hidden rounded-xl border-2 ${
                signal.strength === 'strong' ? 'border-profit shadow-lg shadow-profit/20' :
                signal.strength === 'moderate' ? 'border-warning' : 'border-border'
              } bg-card`}
            >
              <div className={`absolute top-0 right-0 w-16 h-16 -mr-8 -mt-8 rounded-full ${
                signal.strength === 'strong' ? 'bg-profit/10' :
                signal.strength === 'moderate' ? 'bg-warning/10' : 'bg-muted/10'
              }`} />
              
              <div className="p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-foreground">{signal.name}</span>
                  <Badge className={`text-[8px] px-1.5 ${getStrengthColor(signal.strength)}`}>
                    {getStrengthIcon(signal.strength)}
                    <span className="ml-0.5">{signal.strength.toUpperCase()}</span>
                  </Badge>
                </div>
                
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1">
                    {signal.type === 'rise' && <TrendingUp className="w-5 h-5 text-profit" />}
                    {signal.type === 'fall' && <TrendingDown className="w-5 h-5 text-loss" />}
                    {signal.type === 'even' && <Activity className="w-5 h-5 text-primary" />}
                    {signal.type === 'odd' && <Activity className="w-5 h-5 text-warning" />}
                    {signal.type === 'over' && <ArrowUp className="w-5 h-5 text-primary" />}
                    {signal.type === 'under' && <ArrowDown className="w-5 h-5 text-warning" />}
                    {(signal.type === 'match' || signal.type === 'differ') && <Target className="w-5 h-5 text-profit" />}
                    <span className="text-lg font-bold text-foreground">{signal.direction}</span>
                  </div>
                  <span className="text-xl font-mono font-bold text-primary">{signal.confidence}%</span>
                </div>
                
                <div className="h-1.5 bg-muted rounded-full mb-2 overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${signal.confidence}%` }}
                    className={`h-full rounded-full ${
                      signal.strength === 'strong' ? 'bg-profit' :
                      signal.strength === 'moderate' ? 'bg-warning' : 'bg-muted-foreground'
                    }`}
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-1 text-[9px] text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <Activity className="w-2.5 h-2.5" />
                    <span>E: {signal.evenPct.toFixed(0)}%</span>
                    <span className="text-warning">O: {signal.oddPct.toFixed(0)}%</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <ArrowUp className="w-2.5 h-2.5" />
                    <span>Ov: {signal.overPct.toFixed(0)}%</span>
                    <span className="text-warning">Un: {signal.underPct.toFixed(0)}%</span>
                  </div>
                </div>
                
                <div className="mt-2 pt-2 border-t border-border flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <Gauge className="w-3 h-3 text-muted-foreground" />
                    <span className="text-[8px] font-mono">
                      RSI: {signal.rsi.toFixed(1)}
                    </span>
                  </div>
                  <span className="text-[8px] font-mono text-muted-foreground">
                    Last: {signal.lastDigit}
                  </span>
                </div>
              </div>
            </motion.div>
          ))
        )}
      </div>
      
      {/* All Signals Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Crown className="w-4 h-4 text-primary" />
            All Market Signals
            <Badge variant="outline" className="text-[9px]">{signals.length} signals</Badge>
          </h3>
          <Select value={selectedMarket} onValueChange={setSelectedMarket}>
            <SelectTrigger className="h-7 text-[10px] w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {filteredMarkets.map(m => (
                <SelectItem key={m.symbol} value={m.symbol}>{m.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        
        <div className="max-h-[400px] overflow-auto">
          <table className="w-full text-[10px]">
            <thead className="bg-muted/30 text-muted-foreground sticky top-0">
              <tr>
                <th className="p-2 text-left">Market</th>
                <th className="p-2 text-left">Rise</th>
                <th className="p-2 text-left">Fall</th>
                <th className="p-2 text-left">Even</th>
                <th className="p-2 text-left">Odd</th>
                <th className="p-2 text-left">Over</th>
                <th className="p-2 text-left">Under</th>
                <th className="p-2 text-left">Match</th>
                <th className="p-2 text-left">Differ</th>
                <th className="p-2 text-left">Last</th>
                <th className="p-2 text-left">RSI</th>
              </tr>
            </thead>
            <tbody>
              {filteredMarkets.map(market => {
                const data = marketsData.get(market.symbol);
                if (!data || data.prices.length < 20) return null;
                
                const rise = signals.find(s => s.symbol === market.symbol && s.type === 'rise');
                const fall = signals.find(s => s.symbol === market.symbol && s.type === 'fall');
                const even = signals.find(s => s.symbol === market.symbol && s.type === 'even');
                const odd = signals.find(s => s.symbol === market.symbol && s.type === 'odd');
                const over = signals.find(s => s.symbol === market.symbol && s.type === 'over');
                const under = signals.find(s => s.symbol === market.symbol && s.type === 'under');
                const match = signals.find(s => s.symbol === market.symbol && s.type === 'match');
                const differ = signals.find(s => s.symbol === market.symbol && s.type === 'differ');
                
                return (
                  <tr key={market.symbol} className={`border-t border-border/30 hover:bg-muted/20 ${
                    selectedMarket === market.symbol ? 'bg-primary/5' : ''
                  }`}>
                    <td className="p-2 font-mono font-bold text-foreground">{market.name}</td>
                    
                    <td className="p-2">
                      {rise && (
                        <span className={`font-mono font-bold ${rise.confidence >= 70 ? 'text-profit' : rise.confidence >= 50 ? 'text-warning' : 'text-muted-foreground'}`}>
                          {rise.confidence}%
                        </span>
                      )}
                    </td>
                    <td className="p-2">
                      {fall && (
                        <span className={`font-mono font-bold ${fall.confidence >= 70 ? 'text-profit' : fall.confidence >= 50 ? 'text-warning' : 'text-muted-foreground'}`}>
                          {fall.confidence}%
                        </span>
                      )}
                    </td>
                    <td className="p-2">
                      {even && (
                        <span className={`font-mono font-bold ${even.confidence >= 70 ? 'text-profit' : even.confidence >= 50 ? 'text-warning' : 'text-muted-foreground'}`}>
                          {even.confidence}%
                        </span>
                      )}
                    </td>
                    <td className="p-2">
                      {odd && (
                        <span className={`font-mono font-bold ${odd.confidence >= 70 ? 'text-profit' : odd.confidence >= 50 ? 'text-warning' : 'text-muted-foreground'}`}>
                          {odd.confidence}%
                        </span>
                      )}
                    </td>
                    <td className="p-2">
                      {over && (
                        <span className={`font-mono font-bold ${over.confidence >= 70 ? 'text-profit' : over.confidence >= 50 ? 'text-warning' : 'text-muted-foreground'}`}>
                          {over.confidence}%
                        </span>
                      )}
                    </td>
                    <td className="p-2">
                      {under && (
                        <span className={`font-mono font-bold ${under.confidence >= 70 ? 'text-profit' : under.confidence >= 50 ? 'text-warning' : 'text-muted-foreground'}`}>
                          {under.confidence}%
                        </span>
                      )}
                    </td>
                    <td className="p-2">
                      {match && (
                        <span className={`font-mono font-bold ${match.confidence >= 70 ? 'text-profit' : match.confidence >= 50 ? 'text-warning' : 'text-muted-foreground'}`}>
                          {match.digit} ({match.confidence}%)
                        </span>
                      )}
                    </td>
                    <td className="p-2">
                      {differ && (
                        <span className={`font-mono font-bold ${differ.confidence >= 70 ? 'text-profit' : differ.confidence >= 50 ? 'text-warning' : 'text-muted-foreground'}`}>
                          {differ.digit} ({differ.confidence}%)
                        </span>
                      )}
                    </td>
                    <td className="p-2 font-mono font-bold">{data.lastDigit}</td>
                    <td className="p-2 font-mono">
                      <span className={data.rsi > 70 ? 'text-loss' : data.rsi < 30 ? 'text-profit' : 'text-foreground'}>
                        {data.rsi.toFixed(1)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      
      {/* Market Detail Panel */}
      {selectedMarketData && (
        <div className="bg-card border border-border rounded-xl p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <Eye className="w-4 h-4 text-primary" />
            {selectedMarketData.name} - Detailed Analysis
          </h3>
          
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="bg-muted/30 rounded-lg p-2 text-center">
              <div className="text-[8px] text-muted-foreground">Last Price</div>
              <div className="font-mono text-sm font-bold">{selectedMarketData.lastPrice.toFixed(4)}</div>
              <div className="text-[10px]">Digit: {selectedMarketData.lastDigit}</div>
            </div>
            
            <div className="bg-muted/30 rounded-lg p-2 text-center">
              <div className="text-[8px] text-muted-foreground">Even/Odd</div>
              <div className="flex justify-center gap-2 mt-1">
                <span className="text-profit">{selectedMarketData.evenPct.toFixed(0)}%</span>
                <span className="text-warning">{selectedMarketData.oddPct.toFixed(0)}%</span>
              </div>
              <div className="h-1 bg-muted rounded-full mt-1">
                <div className="h-full bg-profit rounded-full" style={{ width: `${selectedMarketData.evenPct}%` }} />
              </div>
            </div>
            
            <div className="bg-muted/30 rounded-lg p-2 text-center">
              <div className="text-[8px] text-muted-foreground">Over/Under</div>
              <div className="flex justify-center gap-2 mt-1">
                <span className="text-primary">{selectedMarketData.overPct.toFixed(0)}%</span>
                <span className="text-warning">{selectedMarketData.underPct.toFixed(0)}%</span>
              </div>
              <div className="h-1 bg-muted rounded-full mt-1">
                <div className="h-full bg-primary rounded-full" style={{ width: `${selectedMarketData.overPct}%` }} />
              </div>
            </div>
            
            <div className="bg-muted/30 rounded-lg p-2 text-center">
              <div className="text-[8px] text-muted-foreground">RSI (14)</div>
              <div className={`font-mono text-sm font-bold ${selectedMarketData.rsi > 70 ? 'text-loss' : selectedMarketData.rsi < 30 ? 'text-profit' : 'text-foreground'}`}>
                {selectedMarketData.rsi.toFixed(1)}
              </div>
              <div className="text-[9px]">
                {selectedMarketData.rsi > 70 ? 'Overbought' : selectedMarketData.rsi < 30 ? 'Oversold' : 'Neutral'}
              </div>
            </div>
            
            <div className="bg-muted/30 rounded-lg p-2 text-center">
              <div className="text-[8px] text-muted-foreground">Trend (EMA12-26)</div>
              <div className={`font-mono text-sm font-bold ${selectedMarketData.trend > 0 ? 'text-profit' : 'text-loss'}`}>
                {selectedMarketData.trend > 0 ? 'Bullish' : 'Bearish'}
              </div>
              <div className="text-[9px]">{selectedMarketData.trend.toFixed(4)}</div>
            </div>
          </div>
          
          {/* Digit Frequency Grid */}
          <div className="mt-3">
            <div className="text-[10px] text-muted-foreground mb-1">Digit Frequency (last 500 ticks)</div>
            <div className="grid grid-cols-10 gap-1">
              {Array.from({ length: 10 }, (_, d) => {
                const pct = selectedMarketData.digitPct[d] || 0;
                const isMost = d === selectedMarketData.mostCommonDigit;
                const isLeast = d === selectedMarketData.leastCommonDigit;
                return (
                  <div key={d} className={`text-center p-1 rounded ${
                    isMost ? 'bg-profit/20 border border-profit' :
                    isLeast ? 'bg-loss/20 border border-loss' :
                    'bg-muted/20'
                  }`}>
                    <div className="font-mono font-bold text-xs">{d}</div>
                    <div className="text-[8px]">{pct.toFixed(1)}%</div>
                    <div className="h-1 bg-muted rounded-full mt-0.5">
                      <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
