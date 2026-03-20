// ============================================================
// FILE: pages/AutoTradingHub.tsx
// ============================================================
// Complete Automated Trading Hub with Signal Scanner + Pro Bot Integration

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { derivApi, type MarketSymbol } from '@/services/deriv-api';
import { useAuth } from '@/contexts/AuthContext';
import { useLossRequirement } from '@/hooks/useLossRequirement';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import {
  Play, StopCircle, Trash2, Scan, RefreshCw, Shield, Zap,
  TrendingUp, TrendingDown, Activity, ArrowUp, ArrowDown, Target,
  Volume2, VolumeX, Loader2, AlertCircle
} from 'lucide-react';

/* ───── CONSTANTS ───── */
const VOLATILITY_MARKETS = [
  { symbol: '1HZ10V', name: 'V10 (1s)', group: '1s' },
  { symbol: '1HZ25V', name: 'V25 (1s)', group: '1s' },
  { symbol: '1HZ50V', name: 'V50 (1s)', group: '1s' },
  { symbol: '1HZ75V', name: 'V75 (1s)', group: '1s' },
  { symbol: '1HZ100V', name: 'V100 (1s)', group: '1s' },
  { symbol: 'R_10', name: 'Vol 10', group: 'standard' },
  { symbol: 'R_25', name: 'Vol 25', group: 'standard' },
  { symbol: 'R_50', name: 'Vol 50', group: 'standard' },
  { symbol: 'R_75', name: 'Vol 75', group: 'standard' },
  { symbol: 'R_100', name: 'Vol 100', group: 'standard' },
  { symbol: 'JD10', name: 'Jump 10', group: 'jump' },
  { symbol: 'JD25', name: 'Jump 25', group: 'jump' },
  { symbol: 'JD50', name: 'Jump 50', group: 'jump' },
  { symbol: 'JD75', name: 'Jump 75', group: 'jump' },
  { symbol: 'JD100', name: 'Jump 100', group: 'jump' },
  { symbol: 'RDBEAR', name: 'Bear Market', group: 'bear' },
  { symbol: 'RDBULL', name: 'Bull Market', group: 'bull' },
];

const CONTRACT_TYPES = [
  'CALL', 'PUT', 'DIGITEVEN', 'DIGITODD', 'DIGITMATCH', 'DIGITDIFF', 'DIGITOVER', 'DIGITUNDER',
] as const;

const DIGIT_CONTRACT_TYPES = ['DIGITMATCH', 'DIGITDIFF', 'DIGITOVER', 'DIGITUNDER', 'DIGITEVEN', 'DIGITODD'];

type SignalStrength = 'strong' | 'moderate' | 'weak';
type BotStatus = 'idle' | 'trading' | 'waiting_signal' | 'signal_matched';

// Market Data Interface
interface MarketData {
  symbol: string;
  name: string;
  prices: number[];
  digits: number[];
  lastPrice: number;
  lastDigit: number;
  evenPct: number;
  oddPct: number;
  overPct: number;
  underPct: number;
  risePct: number;
  fallPct: number;
  mostCommonDigit: number;
  leastCommonDigit: number;
  matchStrength: number;
  diffStrength: number;
  momentum: number;
  volatility: number;
  lastUpdate: number;
  isLoading: boolean;
  error?: string;
}

interface MarketSignal {
  symbol: string;
  name: string;
  type: string;
  direction: string;
  confidence: number;
  strength: SignalStrength;
  digit?: number;
  evenPct: number;
  oddPct: number;
  overPct: number;
  underPct: number;
  risePct: number;
  fallPct: number;
  lastDigit: number;
  momentum: number;
}

interface LogEntry {
  id: number;
  time: string;
  symbol: string;
  contract: string;
  stake: number;
  signalType: string;
  exitDigit: string;
  result: 'Win' | 'Loss' | 'Pending';
  pnl: number;
  balance: number;
}

/* ── HELPER FUNCTIONS ── */
const extractDigit = (price: number): number => {
  const fixed = parseFloat(String(price)).toFixed(2);
  const d = parseInt(fixed.slice(-1), 10);
  if (isNaN(d) || d < 0 || d > 9) return 0;
  return d;
};

const calculateAnalysis = (digits: number[], prices: number[]) => {
  const total = digits.length;
  if (total === 0) return null;

  // Even/Odd
  let even = 0, odd = 0;
  let over = 0, under = 0;
  const digitCount = new Array(10).fill(0);

  for (const digit of digits) {
    digitCount[digit]++;
    if (digit % 2 === 0) even++;
    else odd++;
    if (digit > 4) over++;
    else under++;
  }

  const evenPct = (even / total) * 100;
  const oddPct = (odd / total) * 100;
  const overPct = (over / total) * 100;
  const underPct = (under / total) * 100;

  // Most/Least common digits
  let mostCommon = 0, leastCommon = 0;
  for (let i = 1; i < 10; i++) {
    if (digitCount[i] > digitCount[mostCommon]) mostCommon = i;
    if (digitCount[i] < digitCount[leastCommon]) leastCommon = i;
  }

  // Rise/Fall
  let rise = 0, fall = 0;
  for (let i = 1; i < prices.length; i++) {
    if (prices[i] > prices[i - 1]) rise++;
    else if (prices[i] < prices[i - 1]) fall++;
  }
  const risePct = (rise / (prices.length - 1)) * 100;
  const fallPct = (fall / (prices.length - 1)) * 100;

  // Match/Diff Strength
  let repeats = 0;
  let sequences = 0;
  let currentRepeat = 1;
  for (let i = 1; i < digits.length; i++) {
    if (digits[i] === digits[i - 1]) {
      currentRepeat++;
      if (currentRepeat >= 3) repeats++;
    } else {
      if (currentRepeat >= 2) sequences++;
      currentRepeat = 1;
    }
  }
  const matchStrength = Math.min(95, (repeats / Math.max(1, sequences)) * 100);
  const diffStrength = 100 - matchStrength;

  // Momentum (last 10 ticks)
  let momentum = 0;
  if (prices.length >= 10) {
    const recentPrices = prices.slice(-10);
    const first = recentPrices[0];
    const last = recentPrices[recentPrices.length - 1];
    const change = ((last - first) / first) * 100;
    momentum = Math.min(1, Math.max(-1, change / 5));
  }

  // Volatility
  let volatility = 0;
  if (prices.length >= 20) {
    const recent = prices.slice(-20);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const variance = recent.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / recent.length;
    volatility = Math.sqrt(variance);
  }

  return {
    evenPct, oddPct, overPct, underPct, risePct, fallPct,
    mostCommonDigit, leastCommonDigit, matchStrength, diffStrength,
    momentum, volatility, digitCount
  };
};

const generateSignals = (data: MarketData): MarketSignal[] => {
  const signals: MarketSignal[] = [];
  
  const isChoppy = Math.abs(data.evenPct - data.oddPct) < 5 && 
                   Math.abs(data.overPct - data.underPct) < 5 &&
                   Math.abs(data.risePct - data.fallPct) < 5;
  
  const hasSpike = data.volatility > 0.5;
  
  if (isChoppy || hasSpike) return signals;

  const getStrength = (conf: number): SignalStrength => {
    if (conf >= 75) return 'strong';
    if (conf >= 55) return 'moderate';
    return 'weak';
  };

  // Even/Odd
  if (data.evenPct >= 55) {
    signals.push({
      symbol: data.symbol, name: data.name, type: 'Even', direction: 'DIGITEVEN',
      confidence: data.evenPct, strength: getStrength(data.evenPct),
      evenPct: data.evenPct, oddPct: data.oddPct, overPct: data.overPct, underPct: data.underPct,
      risePct: data.risePct, fallPct: data.fallPct, lastDigit: data.lastDigit, momentum: data.momentum
    });
  }
  
  if (data.oddPct >= 55) {
    signals.push({
      symbol: data.symbol, name: data.name, type: 'Odd', direction: 'DIGITODD',
      confidence: data.oddPct, strength: getStrength(data.oddPct),
      evenPct: data.evenPct, oddPct: data.oddPct, overPct: data.overPct, underPct: data.underPct,
      risePct: data.risePct, fallPct: data.fallPct, lastDigit: data.lastDigit, momentum: data.momentum
    });
  }

  // Over/Under
  if (data.overPct >= 55) {
    signals.push({
      symbol: data.symbol, name: data.name, type: 'Over', direction: 'DIGITOVER',
      confidence: data.overPct, strength: getStrength(data.overPct), digit: 5,
      evenPct: data.evenPct, oddPct: data.oddPct, overPct: data.overPct, underPct: data.underPct,
      risePct: data.risePct, fallPct: data.fallPct, lastDigit: data.lastDigit, momentum: data.momentum
    });
  }
  
  if (data.underPct >= 55) {
    signals.push({
      symbol: data.symbol, name: data.name, type: 'Under', direction: 'DIGITUNDER',
      confidence: data.underPct, strength: getStrength(data.underPct), digit: 4,
      evenPct: data.evenPct, oddPct: data.oddPct, overPct: data.overPct, underPct: data.underPct,
      risePct: data.risePct, fallPct: data.fallPct, lastDigit: data.lastDigit, momentum: data.momentum
    });
  }

  // Rise/Fall with momentum confirmation
  if (data.risePct >= 55 && data.momentum > 0) {
    signals.push({
      symbol: data.symbol, name: data.name, type: 'Rise', direction: 'CALL',
      confidence: Math.min(95, data.risePct + data.momentum * 10),
      strength: getStrength(data.risePct),
      evenPct: data.evenPct, oddPct: data.oddPct, overPct: data.overPct, underPct: data.underPct,
      risePct: data.risePct, fallPct: data.fallPct, lastDigit: data.lastDigit, momentum: data.momentum
    });
  }
  
  if (data.fallPct >= 55 && data.momentum < 0) {
    signals.push({
      symbol: data.symbol, name: data.name, type: 'Fall', direction: 'PUT',
      confidence: Math.min(95, data.fallPct + Math.abs(data.momentum) * 10),
      strength: getStrength(data.fallPct),
      evenPct: data.evenPct, oddPct: data.oddPct, overPct: data.overPct, underPct: data.underPct,
      risePct: data.risePct, fallPct: data.fallPct, lastDigit: data.lastDigit, momentum: data.momentum
    });
  }

  // Match/Differ
  if (data.matchStrength >= 55) {
    signals.push({
      symbol: data.symbol, name: data.name, type: 'Match', direction: 'DIGITMATCH',
      confidence: data.matchStrength, strength: getStrength(data.matchStrength), digit: data.mostCommonDigit,
      evenPct: data.evenPct, oddPct: data.oddPct, overPct: data.overPct, underPct: data.underPct,
      risePct: data.risePct, fallPct: data.fallPct, lastDigit: data.lastDigit, momentum: data.momentum
    });
  }
  
  if (data.diffStrength >= 55) {
    signals.push({
      symbol: data.symbol, name: data.name, type: 'Differ', direction: 'DIGITDIFF',
      confidence: data.diffStrength, strength: getStrength(data.diffStrength), digit: data.leastCommonDigit,
      evenPct: data.evenPct, oddPct: data.oddPct, overPct: data.overPct, underPct: data.underPct,
      risePct: data.risePct, fallPct: data.fallPct, lastDigit: data.lastDigit, momentum: data.momentum
    });
  }

  return signals;
};

// WebSocket connection for real-time ticks
const useMarketData = (symbol: string, tickCount: number = 1000) => {
  const [data, setData] = useState<MarketData | null>(null);
  const [status, setStatus] = useState<'connecting' | 'live' | 'error' | 'offline'>('connecting');
  const wsRef = useRef<WebSocket | null>(null);
  const digitsRef = useRef<number[]>([]);
  const pricesRef = useRef<number[]>([]);

  useEffect(() => {
    digitsRef.current = [];
    pricesRef.current = [];
    setStatus('connecting');

    const ws = new WebSocket('wss://ws.binaryws.com/websockets/v3?app_id=1089');
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('live');
      ws.send(JSON.stringify({
        ticks_history: symbol,
        style: 'ticks',
        count: tickCount,
        end: 'latest',
        subscribe: 1,
      }));
    };

    ws.onmessage = (msg) => {
      const parsed = JSON.parse(msg.data);

      if (parsed.history) {
        const prices: number[] = parsed.history.prices || [];
        const digits = prices.map(extractDigit);
        digitsRef.current = digits;
        pricesRef.current = prices;
        
        const analysis = calculateAnalysis(digits, prices);
        if (analysis) {
          setData({
            symbol,
            name: VOLATILITY_MARKETS.find(m => m.symbol === symbol)?.name || symbol,
            prices,
            digits,
            lastPrice: prices[prices.length - 1],
            lastDigit: digits[digits.length - 1],
            evenPct: analysis.evenPct,
            oddPct: analysis.oddPct,
            overPct: analysis.overPct,
            underPct: analysis.underPct,
            risePct: analysis.risePct,
            fallPct: analysis.fallPct,
            mostCommonDigit: analysis.mostCommonDigit,
            leastCommonDigit: analysis.leastCommonDigit,
            matchStrength: analysis.matchStrength,
            diffStrength: analysis.diffStrength,
            momentum: analysis.momentum,
            volatility: analysis.volatility,
            lastUpdate: Date.now(),
            isLoading: false,
          });
        }
      }

      if (parsed.tick) {
        const price = parseFloat(parsed.tick.quote);
        const digit = extractDigit(price);
        
        if (digit >= 0 && digit <= 9) {
          if (digitsRef.current.length >= tickCount) digitsRef.current.shift();
          if (pricesRef.current.length >= tickCount) pricesRef.current.shift();
          digitsRef.current.push(digit);
          pricesRef.current.push(price);
          
          const analysis = calculateAnalysis(digitsRef.current, pricesRef.current);
          if (analysis && data) {
            setData({
              ...data,
              prices: [...pricesRef.current],
              digits: [...digitsRef.current],
              lastPrice: price,
              lastDigit: digit,
              evenPct: analysis.evenPct,
              oddPct: analysis.oddPct,
              overPct: analysis.overPct,
              underPct: analysis.underPct,
              risePct: analysis.risePct,
              fallPct: analysis.fallPct,
              mostCommonDigit: analysis.mostCommonDigit,
              leastCommonDigit: analysis.leastCommonDigit,
              matchStrength: analysis.matchStrength,
              diffStrength: analysis.diffStrength,
              momentum: analysis.momentum,
              volatility: analysis.volatility,
              lastUpdate: Date.now(),
            });
          }
        }
      }
    };

    ws.onerror = () => setStatus('error');
    ws.onclose = () => setStatus('offline');

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [symbol, tickCount]);

  return { data, status };
};

export default function AutoTradingHub() {
  const { isAuthorized, balance, activeAccount } = useAuth();
  const { recordLoss } = useLossRequirement();

  // Market selection
  const [selectedSymbol, setSelectedSymbol] = useState('R_100');
  const [tickCount] = useState(1000);
  const { data: marketData, status } = useMarketData(selectedSymbol, tickCount);
  
  // Signals state
  const [signals, setSignals] = useState<MarketSignal[]>([]);
  const [topSignal, setTopSignal] = useState<MarketSignal | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  
  // Bot configuration
  const [botEnabled, setBotEnabled] = useState(false);
  const [followSignal, setFollowSignal] = useState(true);
  const [contractType, setContractType] = useState('CALL');
  const [barrier, setBarrier] = useState('5');
  const [stake, setStake] = useState('0.35');
  const [duration, setDuration] = useState('1');
  const [durationUnit, setDurationUnit] = useState('t');
  const [martingaleOn, setMartingaleOn] = useState(false);
  const [martingaleMultiplier, setMartingaleMultiplier] = useState('2.0');
  const [martingaleMaxSteps, setMartingaleMaxSteps] = useState('5');
  const [takeProfit, setTakeProfit] = useState('10');
  const [stopLoss, setStopLoss] = useState('5');
  const [turboMode, setTurboMode] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  
  // Bot state
  const [isRunning, setIsRunning] = useState(false);
  const runningRef = useRef(false);
  const [botStatus, setBotStatus] = useState<BotStatus>('idle');
  const [wins, setWins] = useState(0);
  const [losses, setLosses] = useState(0);
  const [netProfit, setNetProfit] = useState(0);
  const [currentStake, setCurrentStake] = useState(0);
  const [martingaleStep, setMartingaleStep] = useState(0);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const logIdRef = useRef(0);
  const lastTradeTimeRef = useRef(0);
  const cooldownMs = 60000;

  // Generate signals when market data updates
  useEffect(() => {
    if (marketData && !marketData.isLoading) {
      setIsLoading(false);
      const newSignals = generateSignals(marketData);
      setSignals(newSignals);
      
      const bestSignal = newSignals.sort((a, b) => b.confidence - a.confidence)[0] || null;
      setTopSignal(bestSignal);
      
      // Voice announcement
      if (voiceEnabled && bestSignal && bestSignal.confidence >= 75) {
        const utterance = new SpeechSynthesisUtterance(
          `${bestSignal.type} signal on ${marketData.name} with ${Math.round(bestSignal.confidence)} percent confidence`
        );
        window.speechSynthesis?.cancel();
        window.speechSynthesis?.speak(utterance);
      }
    }
  }, [marketData, voiceEnabled]);

  // Auto-refresh signals every 3 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      if (marketData && !isLoading) {
        const newSignals = generateSignals(marketData);
        setSignals(newSignals);
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [marketData, isLoading]);

  const addLog = useCallback((entry: Omit<LogEntry, 'id'>) => {
    const id = ++logIdRef.current;
    setLogEntries(prev => [{ ...entry, id }, ...prev].slice(0, 100));
    return id;
  }, []);
  
  const updateLog = useCallback((id: number, updates: Partial<LogEntry>) => {
    setLogEntries(prev => prev.map(e => e.id === id ? { ...e, ...updates } : e));
  }, []);
  
  const needsBarrier = (ct: string) => ['DIGITMATCH', 'DIGITDIFF', 'DIGITOVER', 'DIGITUNDER'].includes(ct);
  
  const executeTrade = useCallback(async (signal: MarketSignal, tradeStake: number) => {
    if (Date.now() - lastTradeTimeRef.current < cooldownMs) {
      toast.warning(`Please wait ${Math.ceil((cooldownMs - (Date.now() - lastTradeTimeRef.current)) / 1000)} seconds`);
      return { won: false, pnl: 0 };
    }
    
    const logId = addLog({
      time: new Date().toLocaleTimeString(),
      symbol: signal.symbol,
      contract: signal.direction,
      stake: tradeStake,
      signalType: signal.type,
      exitDigit: '...',
      result: 'Pending',
      pnl: 0,
      balance,
    });
    
    try {
      const buyParams: any = {
        contract_type: signal.direction,
        symbol: signal.symbol,
        duration: parseInt(duration),
        duration_unit: durationUnit,
        basis: 'stake',
        amount: tradeStake,
      };
      
      if (needsBarrier(signal.direction) && signal.digit !== undefined) {
        buyParams.barrier = String(signal.digit);
      }
      
      const { contractId } = await derivApi.buyContract(buyParams);
      lastTradeTimeRef.current = Date.now();
      
      const result = await derivApi.waitForContractResult(contractId);
      const won = result.status === 'won';
      const pnl = result.profit;
      const exitDigit = String(extractDigit(result.sellPrice || 0));
      
      updateLog(logId, { exitDigit, result: won ? 'Win' : 'Loss', pnl, balance: balance + pnl });
      
      return { won, pnl };
    } catch (err: any) {
      updateLog(logId, { result: 'Loss', exitDigit: '-', pnl: 0 });
      return { won: false, pnl: 0 };
    }
  }, [duration, durationUnit, balance, addLog, updateLog]);
  
  const startBot = useCallback(async () => {
    if (!isAuthorized || isRunning) return;
    const baseStake = parseFloat(stake);
    if (baseStake < 0.35) { toast.error('Min stake $0.35'); return; }
    
    setIsRunning(true);
    runningRef.current = true;
    setBotStatus('waiting_signal');
    setCurrentStake(baseStake);
    setMartingaleStep(0);
    
    let cStake = baseStake;
    let mStep = 0;
    let localPnl = 0;
    let localBalance = balance;
    let localWins = 0;
    let localLosses = 0;
    
    while (runningRef.current) {
      if (followSignal) {
        setBotStatus('waiting_signal');
        let bestSignal: MarketSignal | null = null;
        
        while (runningRef.current && !bestSignal) {
          const currentSignals = signals.filter(s => s.confidence >= 70);
          if (currentSignals.length > 0) bestSignal = currentSignals[0];
          if (!bestSignal) await new Promise(r => setTimeout(r, 1000));
        }
        
        if (!runningRef.current) break;
        setBotStatus('signal_matched');
        
        const { won, pnl } = await executeTrade(bestSignal!, cStake);
        
        if (won) {
          localWins++;
          setWins(prev => prev + 1);
          cStake = baseStake;
          mStep = 0;
        } else {
          localLosses++;
          setLosses(prev => prev + 1);
          if (activeAccount?.is_virtual) recordLoss(cStake, bestSignal!.symbol, 6000);
          
          if (martingaleOn) {
            const maxSteps = parseInt(martingaleMaxSteps);
            if (mStep < maxSteps) {
              cStake = parseFloat((cStake * (parseFloat(martingaleMultiplier))).toFixed(2));
              mStep++;
              setMartingaleStep(mStep);
              setCurrentStake(cStake);
            } else {
              cStake = baseStake;
              mStep = 0;
            }
          }
        }
        
        localPnl += pnl;
        localBalance += pnl;
        setNetProfit(localPnl);
        
        if (localPnl >= parseFloat(takeProfit)) {
          toast.success(`Take Profit reached! +$${localPnl.toFixed(2)}`);
          break;
        }
        if (localPnl <= -parseFloat(stopLoss)) {
          toast.error(`Stop Loss reached! $${localPnl.toFixed(2)}`);
          break;
        }
        if (localBalance < cStake) {
          toast.error('Insufficient balance');
          break;
        }
      }
      
      if (!turboMode) await new Promise(r => setTimeout(r, 1000));
    }
    
    setIsRunning(false);
    runningRef.current = false;
    setBotStatus('idle');
  }, [isAuthorized, isRunning, balance, stake, followSignal, signals, martingaleOn, 
      martingaleMultiplier, martingaleMaxSteps, takeProfit, stopLoss, turboMode, 
      activeAccount, recordLoss, executeTrade]);
  
  const stopBot = useCallback(() => {
    runningRef.current = false;
    setIsRunning(false);
    setBotStatus('idle');
    toast.info('Bot stopped');
  }, []);
  
  const clearLog = useCallback(() => {
    setLogEntries([]);
    setWins(0);
    setLosses(0);
    setNetProfit(0);
    setMartingaleStep(0);
  }, []);
  
  const handleUseSignal = (signal: MarketSignal) => {
    setContractType(signal.direction);
    if (signal.digit !== undefined) setBarrier(String(signal.digit));
    toast.success(`Configured for ${signal.type} signal`);
  };
  
  const winRate = wins + losses > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : '0.0';
  const statusColor = status === 'live' ? 'text-profit' : status === 'error' ? 'text-loss' : 'text-muted-foreground';
  
  return (
    <div className="space-y-4 max-w-[1920px] mx-auto p-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Zap className="w-5 h-5 text-primary" /> Auto Trading Hub
          </h1>
          <p className="text-xs text-muted-foreground">
            Real-time Signal Analysis | {status === 'live' ? 'Connected' : status}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="font-mono">
            Balance: ${balance.toFixed(2)}
          </Badge>
          <Button size="sm" variant={voiceEnabled ? 'default' : 'outline'} 
                  className="h-7 text-[10px] gap-1" 
                  onClick={() => setVoiceEnabled(!voiceEnabled)}>
            {voiceEnabled ? <Volume2 className="w-3 h-3" /> : <VolumeX className="w-3 h-3" />}
            Voice
          </Button>
        </div>
      </div>
      
      {/* Market Selector */}
      <Card>
        <CardContent className="py-3">
          <div className="flex items-center gap-4">
            <label className="text-sm font-medium">Select Market:</label>
            <Select value={selectedSymbol} onValueChange={setSelectedSymbol}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VOLATILITY_MARKETS.map(m => (
                  <SelectItem key={m.symbol} value={m.symbol}>{m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Badge className={statusColor}>
              {status === 'live' && '● LIVE'}
              {status === 'connecting' && '○ CONNECTING'}
              {status === 'error' && '⚠ ERROR'}
              {status === 'offline' && '○ OFFLINE'}
            </Badge>
          </div>
        </CardContent>
      </Card>
      
      {/* Current Signal Display */}
      {topSignal && marketData && (
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className={`rounded-xl border-2 p-6 text-center ${
            topSignal.strength === 'strong' ? 'border-profit bg-profit/10' :
            topSignal.strength === 'moderate' ? 'border-warning bg-warning/10' :
            'border-border bg-muted/10'
          }`}
        >
          <div className="text-sm text-muted-foreground mb-2">CURRENT SIGNAL</div>
          <div className="text-5xl font-bold mb-3">{topSignal.type}</div>
          <div className="flex items-center justify-center gap-4 mb-4">
            <Badge className={`text-sm px-3 py-1 ${
              topSignal.strength === 'strong' ? 'bg-profit' :
              topSignal.strength === 'moderate' ? 'bg-warning' : 'bg-muted'
            }`}>
              {topSignal.strength.toUpperCase()} ({Math.round(topSignal.confidence)}%)
            </Badge>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>Even: {marketData.evenPct.toFixed(1)}%</div>
            <div>Odd: {marketData.oddPct.toFixed(1)}%</div>
            <div>Over: {marketData.overPct.toFixed(1)}%</div>
            <div>Under: {marketData.underPct.toFixed(1)}%</div>
            <div>Rise: {marketData.risePct.toFixed(1)}%</div>
            <div>Fall: {marketData.fallPct.toFixed(1)}%</div>
            <div>Match: {marketData.matchStrength.toFixed(1)}%</div>
            <div>Differ: {marketData.diffStrength.toFixed(1)}%</div>
          </div>
          <Button size="sm" className="mt-4" onClick={() => handleUseSignal(topSignal)}>
            Use This Signal
          </Button>
        </motion.div>
      )}
      
      {/* Main Content Tabs */}
      <Tabs defaultValue="bot" className="space-y-4">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="bot">🤖 Bot Control</TabsTrigger>
          <TabsTrigger value="signals">📊 All Signals</TabsTrigger>
        </TabsList>
        
        {/* Bot Control Tab */}
        <TabsContent value="bot" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Left Column */}
            <div className="lg:col-span-5 space-y-4">
              <Card className="border-2 border-primary/30">
                <CardHeader className="py-3">
                  <CardTitle className="text-sm flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      {isRunning ? <Zap className="w-4 h-4 text-profit animate-pulse" /> : <Play className="w-4 h-4 text-primary" />}
                      Bot Status
                    </span>
                    <Badge className={isRunning ? 'bg-profit' : 'bg-muted'}>
                      {isRunning ? 'RUNNING' : botStatus === 'waiting_signal' ? 'WAITING' : 'IDLE'}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span>Win Rate:</span>
                    <span className="font-bold text-profit">{winRate}%</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span>P/L:</span>
                    <span className={`font-bold ${netProfit >= 0 ? 'text-profit' : 'text-loss'}`}>
                      ${netProfit.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span>Current Stake:</span>
                    <span className="font-bold">${currentStake.toFixed(2)}{martingaleStep > 0 && ` M${martingaleStep}`}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span>Trades:</span>
                    <span>{wins + losses} ({wins}W / {losses}L)</span>
                  </div>
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader className="py-3">
                  <CardTitle className="text-sm">Bot Configuration</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs">Follow AI Signals</label>
                    <Switch checked={followSignal} onCheckedChange={setFollowSignal} disabled={isRunning} />
                  </div>
                  
                  <Select value={contractType} onValueChange={setContractType} disabled={isRunning}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CONTRACT_TYPES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  
                  {needsBarrier(contractType) && (
                    <Input type="number" min="0" max="9" value={barrier} 
                           onChange={e => setBarrier(e.target.value)} disabled={isRunning}
                           className="h-8 text-xs" placeholder="Barrier Digit" />
                  )}
                  
                  <div className="grid grid-cols-2 gap-2">
                    <Input type="number" min="0.35" step="0.01" value={stake} 
                           onChange={e => setStake(e.target.value)} disabled={isRunning}
                           className="h-8 text-xs" placeholder="Stake $" />
                    <div className="flex gap-1">
                      <Input type="number" min="1" value={duration} 
                             onChange={e => setDuration(e.target.value)} disabled={isRunning}
                             className="h-8 text-xs flex-1" />
                      <Select value={durationUnit} onValueChange={setDurationUnit} disabled={isRunning}>
                        <SelectTrigger className="h-8 text-xs w-14"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="t">T</SelectItem>
                          <SelectItem value="s">S</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <label className="text-xs">Martingale</label>
                    <Switch checked={martingaleOn} onCheckedChange={setMartingaleOn} disabled={isRunning} />
                  </div>
                  
                  {martingaleOn && (
                    <div className="grid grid-cols-2 gap-2">
                      <Input type="number" min="1.1" step="0.1" value={martingaleMultiplier} 
                             onChange={e => setMartingaleMultiplier(e.target.value)} disabled={isRunning}
                             className="h-8 text-xs" placeholder="Multiplier" />
                      <Input type="number" min="1" max="10" value={martingaleMaxSteps} 
                             onChange={e => setMartingaleMaxSteps(e.target.value)} disabled={isRunning}
                             className="h-8 text-xs" placeholder="Max Steps" />
                    </div>
                  )}
                  
                  <div className="grid grid-cols-2 gap-2">
                    <Input type="number" value={stopLoss} onChange={e => setStopLoss(e.target.value)} 
                           disabled={isRunning} className="h-8 text-xs" placeholder="Stop Loss $" />
                    <Input type="number" value={takeProfit} onChange={e => setTakeProfit(e.target.value)} 
                           disabled={isRunning} className="h-8 text-xs" placeholder="Take Profit $" />
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <label className="text-xs flex items-center gap-1"><Zap className="w-3 h-3" /> Turbo Mode</label>
                    <Switch checked={turboMode} onCheckedChange={setTurboMode} disabled={isRunning} />
                  </div>
                </CardContent>
              </Card>
              
              <div className="grid grid-cols-2 gap-3">
                <Button onClick={startBot} disabled={isRunning || !isAuthorized || balance < parseFloat(stake)} 
                        className="h-12 bg-profit hover:bg-profit/90">
                  <Play className="w-4 h-4 mr-2" /> Start Bot
                </Button>
                <Button onClick={stopBot} disabled={!isRunning} variant="destructive" className="h-12">
                  <StopCircle className="w-4 h-4 mr-2" /> Stop Bot
                </Button>
              </div>
            </div>
            
            {/* Right Column - Activity Log */}
            <div className="lg:col-span-7">
              <Card className="h-full">
                <CardHeader className="py-3 flex-row items-center justify-between">
                  <CardTitle className="text-sm">Activity Log</CardTitle>
                  <Button variant="ghost" size="sm" onClick={clearLog} className="h-7">
                    <Trash2 className="w-3 h-3" /> Clear
                  </Button>
                </CardHeader>
                <CardContent className="max-h-[500px] overflow-auto">
                  {logEntries.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">No trades yet</div>
                  ) : (
                    <div className="space-y-1">
                      {logEntries.map(entry => (
                        <div key={entry.id} className={`p-2 rounded-lg border-l-4 ${
                          entry.result === 'Win' ? 'border-profit bg-profit/5' : 
                          entry.result === 'Loss' ? 'border-loss bg-loss/5' : 'border-warning bg-warning/5'
                        }`}>
                          <div className="flex justify-between text-[10px]">
                            <span className="font-mono">{entry.time}</span>
                            <span className={`font-bold ${
                              entry.result === 'Win' ? 'text-profit' : 
                              entry.result === 'Loss' ? 'text-loss' : 'text-warning'
                            }`}>{entry.result}</span>
                          </div>
                          <div className="flex justify-between text-[11px] mt-1">
                            <span>{entry.symbol}</span>
                            <span className="font-mono">${entry.stake.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between text-[9px] text-muted-foreground mt-1">
                            <span>{entry.contract}</span>
                            <span>Digit: {entry.exitDigit}</span>
                            <span className={entry.pnl >= 0 ? 'text-profit' : 'text-loss'}>
                              {entry.pnl !== 0 && `${entry.pnl >= 0 ? '+' : ''}$${entry.pnl.toFixed(2)}`}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>
        
        {/* Signals Tab */}
        <TabsContent value="signals" className="space-y-4">
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-sm">All Signal Types for {marketData?.name || selectedSymbol}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {signals.map((signal, idx) => (
                  <motion.div
                    key={`${signal.type}-${idx}`}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    className={`p-3 rounded-lg border cursor-pointer transition-all hover:scale-[1.02] ${
                      signal.strength === 'strong' ? 'border-profit bg-profit/5' :
                      signal.strength === 'moderate' ? 'border-warning bg-warning/5' : 'border-border'
                    }`}
                    onClick={() => handleUseSignal(signal)}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-bold text-lg">{signal.type}</span>
                      <Badge className={signal.strength === 'strong' ? 'bg-profit' : 
                                        signal.strength === 'moderate' ? 'bg-warning' : 'bg-muted'}>
                        {Math.round(signal.confidence)}%
                      </Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-1 text-[10px] text-muted-foreground">
                      <span>E: {signal.evenPct.toFixed(0)}%</span>
                      <span>O: {signal.oddPct.toFixed(0)}%</span>
                      <span>Ov: {signal.overPct.toFixed(0)}%</span>
                      <span>Un: {signal.underPct.toFixed(0)}%</span>
                      <span>Rise: {signal.risePct.toFixed(0)}%</span>
                      <span>Fall: {signal.fallPct.toFixed(0)}%</span>
                    </div>
                    <Button size="sm" className="w-full mt-2 h-6 text-[9px]" variant="outline"
                            onClick={(e) => { e.stopPropagation(); handleUseSignal(signal); }}>
                      Use Signal
                    </Button>
                  </motion.div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
   }
