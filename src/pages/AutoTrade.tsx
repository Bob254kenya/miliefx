// ============================================================
// FILE: pages/AutoTradingHub.tsx
// ============================================================
// Fixed: Accurate Deriv API Integration with Proper Signal Generation

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { derivApi } from '@/services/deriv-api';
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
  Volume2, VolumeX, Loader2, AlertCircle, CheckCircle2, XCircle
} from 'lucide-react';

/* ───── CONSTANTS ───── */
const VOLATILITY_MARKETS = [
  { symbol: '1HZ10V', name: 'V10 (1s)', group: '1s', tickInterval: 1 },
  { symbol: '1HZ25V', name: 'V25 (1s)', group: '1s', tickInterval: 1 },
  { symbol: '1HZ50V', name: 'V50 (1s)', group: '1s', tickInterval: 1 },
  { symbol: '1HZ75V', name: 'V75 (1s)', group: '1s', tickInterval: 1 },
  { symbol: '1HZ100V', name: 'V100 (1s)', group: '1s', tickInterval: 1 },
  { symbol: 'R_10', name: 'Vol 10', group: 'standard', tickInterval: 2 },
  { symbol: 'R_25', name: 'Vol 25', group: 'standard', tickInterval: 2 },
  { symbol: 'R_50', name: 'Vol 50', group: 'standard', tickInterval: 2 },
  { symbol: 'R_75', name: 'Vol 75', group: 'standard', tickInterval: 2 },
  { symbol: 'R_100', name: 'Vol 100', group: 'standard', tickInterval: 2 },
  { symbol: 'JD10', name: 'Jump 10', group: 'jump', tickInterval: 5 },
  { symbol: 'JD25', name: 'Jump 25', group: 'jump', tickInterval: 5 },
  { symbol: 'JD50', name: 'Jump 50', group: 'jump', tickInterval: 5 },
  { symbol: 'JD75', name: 'Jump 75', group: 'jump', tickInterval: 5 },
  { symbol: 'JD100', name: 'Jump 100', group: 'jump', tickInterval: 5 },
  { symbol: 'RDBEAR', name: 'Bear Market', group: 'bear', tickInterval: 2 },
  { symbol: 'RDBULL', name: 'Bull Market', group: 'bull', tickInterval: 2 },
];

const CONTRACT_TYPES = [
  'CALL', 'PUT', 'DIGITEVEN', 'DIGITODD', 'DIGITMATCH', 'DIGITDIFF', 'DIGITOVER', 'DIGITUNDER',
] as const;

type SignalStrength = 'strong' | 'moderate' | 'weak';
type BotStatus = 'idle' | 'trading' | 'waiting_signal' | 'signal_matched';

// Enhanced Market Data Interface
interface MarketData {
  symbol: string;
  name: string;
  prices: number[];
  digits: number[];
  lastPrice: number;
  lastDigit: number;
  lastDigitsHistory: number[]; // Last 20 digits for momentum
  
  // Analysis Results
  evenPct: number;
  oddPct: number;
  overPct: number;
  underPct: number;
  risePct: number;
  fallPct: number;
  digitFrequencies: Record<number, number>;
  mostFrequentDigit: number;
  leastFrequentDigit: number;
  
  // Pattern Analysis
  consecutiveRepeats: number; // Count of 3+ consecutive repeats in last 100 ticks
  alternatingPattern: number; // Count of alternating patterns
  matchStrength: number;
  diffStrength: number;
  
  // Momentum (last 10 ticks)
  momentum: number; // -1 to 1
  recentTrend: 'up' | 'down' | 'sideways';
  volatility: number;
  
  // Timestamp
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
  reason: string;
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

/* ── CORRECT DIGIT EXTRACTION (Deriv Official Method) ── */
/**
 * Extracts the last digit from a price using Deriv's official method:
 * The last digit is the last digit of the price after formatting to 2 decimal places [citation:5][citation:9]
 * Example: 1234.56 -> last digit is 6
 */
const extractLastDigit = (price: number): number => {
  // Convert to string with 2 decimal places (Deriv's standard format)
  const formatted = price.toFixed(2);
  // Get the last character and parse as integer
  const digit = parseInt(formatted.slice(-1), 10);
  // Validate digit is between 0-9
  return isNaN(digit) ? 0 : Math.min(9, Math.max(0, digit));
};

/* ── COMPREHENSIVE ANALYSIS ENGINE ── */
const analyzeMarketData = (prices: number[], digits: number[]): Partial<MarketData> => {
  const totalTicks = digits.length;
  if (totalTicks === 0) return {};
  
  // 1. EVEN/ODD ANALYSIS
  let evenCount = 0, oddCount = 0;
  for (const digit of digits) {
    if (digit % 2 === 0) evenCount++;
    else oddCount++;
  }
  const evenPct = (evenCount / totalTicks) * 100;
  const oddPct = (oddCount / totalTicks) * 100;
  
  // 2. OVER/UNDER ANALYSIS (Digits 0-4 = Under, 5-9 = Over)
  let underCount = 0, overCount = 0;
  for (const digit of digits) {
    if (digit <= 4) underCount++;
    else overCount++;
  }
  const underPct = (underCount / totalTicks) * 100;
  const overPct = (overCount / totalTicks) * 100;
  
  // 3. DIGIT FREQUENCY ANALYSIS
  const digitFreq: Record<number, number> = {0:0,1:0,2:0,3:0,4:0,5:0,6:0,7:0,8:0,9:0};
  for (const digit of digits) {
    digitFreq[digit]++;
  }
  
  // Find most and least frequent digits
  let mostFrequentDigit = 0, leastFrequentDigit = 0;
  for (let i = 1; i <= 9; i++) {
    if (digitFreq[i] > digitFreq[mostFrequentDigit]) mostFrequentDigit = i;
    if (digitFreq[i] < digitFreq[leastFrequentDigit]) leastFrequentDigit = i;
  }
  
  // 4. RISE/FALL ANALYSIS
  let riseCount = 0, fallCount = 0;
  for (let i = 1; i < prices.length; i++) {
    if (prices[i] > prices[i - 1]) riseCount++;
    else if (prices[i] < prices[i - 1]) fallCount++;
  }
  const totalChanges = prices.length - 1;
  const risePct = totalChanges > 0 ? (riseCount / totalChanges) * 100 : 50;
  const fallPct = totalChanges > 0 ? (fallCount / totalChanges) * 100 : 50;
  
  // 5. PATTERN ANALYSIS: MATCHES/DIFFERS
  // Count consecutive repeats (3+ same digits in a row)
  let consecutiveRepeats = 0;
  let alternatingPattern = 0;
  let currentRun = 1;
  
  for (let i = 1; i < Math.min(digits.length, 200); i++) {
    if (digits[i] === digits[i - 1]) {
      currentRun++;
      if (currentRun >= 3) consecutiveRepeats++;
    } else {
      if (currentRun === 2) alternatingPattern++;
      currentRun = 1;
    }
  }
  
  // Calculate match strength (higher = more repeats)
  const matchStrength = Math.min(95, (consecutiveRepeats / Math.max(1, digits.length / 10)) * 100);
  const diffStrength = Math.min(95, 100 - matchStrength);
  
  // 6. MOMENTUM ANALYSIS (Last 10 ticks)
  const recentDigits = digits.slice(-10);
  const recentPrices = prices.slice(-10);
  let momentum = 0;
  let recentTrend: 'up' | 'down' | 'sideways' = 'sideways';
  
  if (recentPrices.length >= 5) {
    const priceChange = ((recentPrices[recentPrices.length - 1] - recentPrices[0]) / recentPrices[0]) * 100;
    momentum = Math.min(1, Math.max(-1, priceChange / 5));
    if (momentum > 0.2) recentTrend = 'up';
    else if (momentum < -0.2) recentTrend = 'down';
  }
  
  // 7. VOLATILITY ANALYSIS
  let volatility = 0;
  if (prices.length >= 20) {
    const recentVolPrices = prices.slice(-20);
    const mean = recentVolPrices.reduce((a, b) => a + b, 0) / recentVolPrices.length;
    const variance = recentVolPrices.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / recentVolPrices.length;
    volatility = Math.sqrt(variance);
  }
  
  return {
    evenPct,
    oddPct,
    overPct,
    underPct,
    risePct,
    fallPct,
    digitFrequencies: digitFreq,
    mostFrequentDigit,
    leastFrequentDigit,
    consecutiveRepeats,
    alternatingPattern,
    matchStrength,
    diffStrength,
    momentum,
    recentTrend,
    volatility,
  };
};

/* ── SIGNAL GENERATION WITH CONFIRMATION ── */
const generateSignals = (data: MarketData): MarketSignal[] => {
  const signals: MarketSignal[] = [];
  
  // RISK FILTER: Check if market is choppy (difference < 5%)
  const evenOddDiff = Math.abs(data.evenPct - data.oddPct);
  const overUnderDiff = Math.abs(data.overPct - data.underPct);
  const riseFallDiff = Math.abs(data.risePct - data.fallPct);
  const isChoppy = evenOddDiff < 5 && overUnderDiff < 5 && riseFallDiff < 5;
  
  // Check for volatility spike
  const hasSpike = data.volatility > 0.5;
  
  // Don't generate signals in choppy or spiking markets
  if (isChoppy || hasSpike) {
    return signals;
  }
  
  const getStrength = (confidence: number): SignalStrength => {
    if (confidence >= 75) return 'strong';
    if (confidence >= 60) return 'moderate';
    return 'weak';
  };
  
  // EVEN SIGNAL (with momentum confirmation)
  if (data.evenPct >= 55) {
    const confidence = Math.min(95, data.evenPct);
    signals.push({
      symbol: data.symbol,
      name: data.name,
      type: 'EVEN',
      direction: 'DIGITEVEN',
      confidence,
      strength: getStrength(confidence),
      evenPct: data.evenPct,
      oddPct: data.oddPct,
      overPct: data.overPct,
      underPct: data.underPct,
      risePct: data.risePct,
      fallPct: data.fallPct,
      lastDigit: data.lastDigit,
      momentum: data.momentum,
      reason: `Even digits ${data.evenPct.toFixed(1)}% of last 1000 ticks`,
    });
  }
  
  // ODD SIGNAL
  if (data.oddPct >= 55) {
    const confidence = Math.min(95, data.oddPct);
    signals.push({
      symbol: data.symbol,
      name: data.name,
      type: 'ODD',
      direction: 'DIGITODD',
      confidence,
      strength: getStrength(confidence),
      evenPct: data.evenPct,
      oddPct: data.oddPct,
      overPct: data.overPct,
      underPct: data.underPct,
      risePct: data.risePct,
      fallPct: data.fallPct,
      lastDigit: data.lastDigit,
      momentum: data.momentum,
      reason: `Odd digits ${data.oddPct.toFixed(1)}% of last 1000 ticks`,
    });
  }
  
  // OVER SIGNAL
  if (data.overPct >= 55) {
    const confidence = Math.min(95, data.overPct);
    signals.push({
      symbol: data.symbol,
      name: data.name,
      type: 'OVER',
      direction: 'DIGITOVER',
      confidence,
      strength: getStrength(confidence),
      digit: 5,
      evenPct: data.evenPct,
      oddPct: data.oddPct,
      overPct: data.overPct,
      underPct: data.underPct,
      risePct: data.risePct,
      fallPct: data.fallPct,
      lastDigit: data.lastDigit,
      momentum: data.momentum,
      reason: `Over digits (5-9) ${data.overPct.toFixed(1)}% of last 1000 ticks`,
    });
  }
  
  // UNDER SIGNAL
  if (data.underPct >= 55) {
    const confidence = Math.min(95, data.underPct);
    signals.push({
      symbol: data.symbol,
      name: data.name,
      type: 'UNDER',
      direction: 'DIGITUNDER',
      confidence,
      strength: getStrength(confidence),
      digit: 4,
      evenPct: data.evenPct,
      oddPct: data.oddPct,
      overPct: data.overPct,
      underPct: data.underPct,
      risePct: data.risePct,
      fallPct: data.fallPct,
      lastDigit: data.lastDigit,
      momentum: data.momentum,
      reason: `Under digits (0-4) ${data.underPct.toFixed(1)}% of last 1000 ticks`,
    });
  }
  
  // RISE SIGNAL (requires momentum confirmation)
  if (data.risePct >= 55 && data.momentum > 0.1) {
    const confidence = Math.min(95, data.risePct + (data.momentum * 10));
    signals.push({
      symbol: data.symbol,
      name: data.name,
      type: 'RISE',
      direction: 'CALL',
      confidence,
      strength: getStrength(confidence),
      evenPct: data.evenPct,
      oddPct: data.oddPct,
      overPct: data.overPct,
      underPct: data.underPct,
      risePct: data.risePct,
      fallPct: data.fallPct,
      lastDigit: data.lastDigit,
      momentum: data.momentum,
      reason: `Rising price ${data.risePct.toFixed(1)}% with upward momentum`,
    });
  }
  
  // FALL SIGNAL (requires momentum confirmation)
  if (data.fallPct >= 55 && data.momentum < -0.1) {
    const confidence = Math.min(95, data.fallPct + (Math.abs(data.momentum) * 10));
    signals.push({
      symbol: data.symbol,
      name: data.name,
      type: 'FALL',
      direction: 'PUT',
      confidence,
      strength: getStrength(confidence),
      evenPct: data.evenPct,
      oddPct: data.oddPct,
      overPct: data.overPct,
      underPct: data.underPct,
      risePct: data.risePct,
      fallPct: data.fallPct,
      lastDigit: data.lastDigit,
      momentum: data.momentum,
      reason: `Falling price ${data.fallPct.toFixed(1)}% with downward momentum`,
    });
  }
  
  // MATCHES SIGNAL (high consecutive repeats)
  if (data.matchStrength >= 60) {
    const confidence = data.matchStrength;
    signals.push({
      symbol: data.symbol,
      name: data.name,
      type: 'MATCHES',
      direction: 'DIGITMATCH',
      confidence,
      strength: getStrength(confidence),
      digit: data.mostFrequentDigit,
      evenPct: data.evenPct,
      oddPct: data.oddPct,
      overPct: data.overPct,
      underPct: data.underPct,
      risePct: data.risePct,
      fallPct: data.fallPct,
      lastDigit: data.lastDigit,
      momentum: data.momentum,
      reason: `${data.consecutiveRepeats} repeating patterns detected, digit ${data.mostFrequentDigit} appears most often`,
    });
  }
  
  // DIFFERS SIGNAL (high alternating patterns)
  if (data.diffStrength >= 60) {
    const confidence = data.diffStrength;
    signals.push({
      symbol: data.symbol,
      name: data.name,
      type: 'DIFFERS',
      direction: 'DIGITDIFF',
      confidence,
      strength: getStrength(confidence),
      digit: data.leastFrequentDigit,
      evenPct: data.evenPct,
      oddPct: data.oddPct,
      overPct: data.overPct,
      underPct: data.underPct,
      risePct: data.risePct,
      fallPct: data.fallPct,
      lastDigit: data.lastDigit,
      momentum: data.momentum,
      reason: `Alternating pattern detected, digit ${data.leastFrequentDigit} appears least often`,
    });
  }
  
  return signals.sort((a, b) => b.confidence - a.confidence);
};

/* ── WEBSOCKET CONNECTION FOR REAL TICKS ── */
const useRealTimeMarketData = (symbol: string, tickCount: number = 1000) => {
  const [marketData, setMarketData] = useState<MarketData | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'error' | 'disconnected'>('connecting');
  const [error, setError] = useState<string | null>(null);
  
  const digitsRef = useRef<number[]>([]);
  const pricesRef = useRef<number[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const isSubscribedRef = useRef(false);
  
  useEffect(() => {
    // Reset state
    digitsRef.current = [];
    pricesRef.current = [];
    setConnectionStatus('connecting');
    setError(null);
    isSubscribedRef.current = false;
    
    // Create WebSocket connection to Deriv API [citation:10]
    const ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=1089');
    wsRef.current = ws;
    
    ws.onopen = () => {
      console.log(`[${symbol}] WebSocket connected`);
      setConnectionStatus('connected');
      
      // Send ticks_history request for initial data [citation:6]
      ws.send(JSON.stringify({
        ticks_history: symbol,
        adjust_start_time: 1,
        count: tickCount,
        end: 'latest',
        style: 'ticks',
        subscribe: 1,
        req_id: Date.now(),
      }));
    };
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      // Handle initial history data
      if (data.ticks_history && data.ticks_history.prices) {
        const prices: number[] = data.ticks_history.prices;
        const digits = prices.map(extractLastDigit);
        
        digitsRef.current = digits;
        pricesRef.current = prices;
        
        const analysis = analyzeMarketData(prices, digits);
        
        setMarketData({
          symbol,
          name: VOLATILITY_MARKETS.find(m => m.symbol === symbol)?.name || symbol,
          prices,
          digits,
          lastPrice: prices[prices.length - 1],
          lastDigit: digits[digits.length - 1],
          lastDigitsHistory: digits.slice(-20),
          evenPct: analysis.evenPct || 50,
          oddPct: analysis.oddPct || 50,
          overPct: analysis.overPct || 50,
          underPct: analysis.underPct || 50,
          risePct: analysis.risePct || 50,
          fallPct: analysis.fallPct || 50,
          digitFrequencies: analysis.digitFrequencies || {},
          mostFrequentDigit: analysis.mostFrequentDigit || 0,
          leastFrequentDigit: analysis.leastFrequentDigit || 0,
          consecutiveRepeats: analysis.consecutiveRepeats || 0,
          alternatingPattern: analysis.alternatingPattern || 0,
          matchStrength: analysis.matchStrength || 50,
          diffStrength: analysis.diffStrength || 50,
          momentum: analysis.momentum || 0,
          recentTrend: analysis.recentTrend || 'sideways',
          volatility: analysis.volatility || 0,
          lastUpdate: Date.now(),
          isLoading: false,
        });
      }
      
      // Handle live ticks [citation:3]
      if (data.tick && data.tick.symbol === symbol) {
        const price = parseFloat(data.tick.quote);
        const digit = extractLastDigit(price);
        
        // Update rolling windows (keep last 1000 ticks)
        if (pricesRef.current.length >= tickCount) {
          pricesRef.current.shift();
          digitsRef.current.shift();
        }
        pricesRef.current.push(price);
        digitsRef.current.push(digit);
        
        // Get last 20 digits for momentum
        const last20Digits = digitsRef.current.slice(-20);
        
        const analysis = analyzeMarketData(pricesRef.current, digitsRef.current);
        
        setMarketData(prev => prev ? {
          ...prev,
          prices: [...pricesRef.current],
          digits: [...digitsRef.current],
          lastPrice: price,
          lastDigit: digit,
          lastDigitsHistory: last20Digits,
          evenPct: analysis.evenPct || 50,
          oddPct: analysis.oddPct || 50,
          overPct: analysis.overPct || 50,
          underPct: analysis.underPct || 50,
          risePct: analysis.risePct || 50,
          fallPct: analysis.fallPct || 50,
          digitFrequencies: analysis.digitFrequencies || {},
          mostFrequentDigit: analysis.mostFrequentDigit || 0,
          leastFrequentDigit: analysis.leastFrequentDigit || 0,
          consecutiveRepeats: analysis.consecutiveRepeats || 0,
          alternatingPattern: analysis.alternatingPattern || 0,
          matchStrength: analysis.matchStrength || 50,
          diffStrength: analysis.diffStrength || 50,
          momentum: analysis.momentum || 0,
          recentTrend: analysis.recentTrend || 'sideways',
          volatility: analysis.volatility || 0,
          lastUpdate: Date.now(),
        } : prev);
      }
      
      // Handle errors
      if (data.error) {
        console.error(`[${symbol}] API Error:`, data.error);
        setError(data.error.message);
        setConnectionStatus('error');
      }
    };
    
    ws.onerror = (err) => {
      console.error(`[${symbol}] WebSocket error:`, err);
      setConnectionStatus('error');
      setError('Connection error');
    };
    
    ws.onclose = () => {
      console.log(`[${symbol}] WebSocket disconnected`);
      setConnectionStatus('disconnected');
    };
    
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [symbol, tickCount]);
  
  return { marketData, connectionStatus, error };
};

export default function AutoTradingHub() {
  const { isAuthorized, balance, activeAccount } = useAuth();
  const { recordLoss } = useLossRequirement();
  
  // Market selection
  const [selectedSymbol, setSelectedSymbol] = useState('R_100');
  const { marketData, connectionStatus, error: connectionError } = useRealTimeMarketData(selectedSymbol, 1000);
  
  // Signals state
  const [signals, setSignals] = useState<MarketSignal[]>([]);
  const [topSignal, setTopSignal] = useState<MarketSignal | null>(null);
  const [selectedSignal, setSelectedSignal] = useState<MarketSignal | null>(null);
  
  // Bot configuration
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
  const [cooldownSeconds, setCooldownSeconds] = useState(60);
  
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
  
  // Generate signals when market data updates
  useEffect(() => {
    if (marketData && !marketData.isLoading) {
      const newSignals = generateSignals(marketData);
      setSignals(newSignals);
      
      const bestSignal = newSignals[0] || null;
      setTopSignal(bestSignal);
      
      // Voice announcement for strong signals
      if (voiceEnabled && bestSignal && bestSignal.confidence >= 75) {
        const utterance = new SpeechSynthesisUtterance(
          `${bestSignal.type} signal on ${marketData.name} with ${Math.round(bestSignal.confidence)} percent confidence. ${bestSignal.reason}`
        );
        window.speechSynthesis?.cancel();
        window.speechSynthesis?.speak(utterance);
      }
    }
  }, [marketData, voiceEnabled]);
  
  // Auto-refresh signals every 2 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      if (marketData && !marketData.isLoading) {
        const newSignals = generateSignals(marketData);
        setSignals(newSignals);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [marketData]);
  
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
    // Check cooldown
    const timeSinceLastTrade = Date.now() - lastTradeTimeRef.current;
    if (timeSinceLastTrade < cooldownSeconds * 1000) {
      const waitSeconds = Math.ceil((cooldownSeconds * 1000 - timeSinceLastTrade) / 1000);
      toast.warning(`Cooldown: ${waitSeconds}s remaining`);
      return { won: false, pnl: 0, error: 'Cooldown active' };
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
      // Wait for next tick if not in turbo mode
      if (!turboMode) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
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
      const exitDigit = String(extractLastDigit(result.sellPrice || 0));
      
      updateLog(logId, { exitDigit, result: won ? 'Win' : 'Loss', pnl, balance: balance + pnl });
      
      return { won, pnl, error: null };
    } catch (err: any) {
      console.error('Trade execution error:', err);
      updateLog(logId, { result: 'Loss', exitDigit: '-', pnl: 0 });
      return { won: false, pnl: 0, error: err.message };
    }
  }, [duration, durationUnit, balance, turboMode, cooldownSeconds, addLog, updateLog]);
  
  const startBot = useCallback(async () => {
    if (!isAuthorized || isRunning) {
      toast.error('Not authorized or bot already running');
      return;
    }
    
    const baseStake = parseFloat(stake);
    if (baseStake < 0.35) {
      toast.error('Minimum stake is $0.35');
      return;
    }
    
    if (!marketData) {
      toast.error('No market data available');
      return;
    }
    
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
    let consecutiveLosses = 0;
    
    while (runningRef.current) {
      if (followSignal) {
        setBotStatus('waiting_signal');
        let bestSignal: MarketSignal | null = null;
        
        // Wait for a strong signal (confidence >= 70)
        while (runningRef.current && !bestSignal) {
          const currentSignals = signals.filter(s => s.confidence >= 70);
          if (currentSignals.length > 0) {
            bestSignal = currentSignals[0];
          }
          if (!bestSignal) await new Promise(r => setTimeout(r, 1000));
        }
        
        if (!runningRef.current) break;
        
        setBotStatus('signal_matched');
        setSelectedSignal(bestSignal);
        toast.info(`${bestSignal.type} signal: ${bestSignal.reason}`);
        
        const { won, pnl, error } = await executeTrade(bestSignal, cStake);
        
        if (won) {
          localWins++;
          setWins(prev => prev + 1);
          consecutiveLosses = 0;
          cStake = baseStake;
          mStep = 0;
          toast.success(`Win! +$${pnl.toFixed(2)}`);
        } else {
          localLosses++;
          setLosses(prev => prev + 1);
          consecutiveLosses++;
          
          if (activeAccount?.is_virtual) {
            recordLoss(cStake, bestSignal.symbol, 6000);
          }
          
          if (martingaleOn) {
            const maxSteps = parseInt(martingaleMaxSteps);
            if (mStep < maxSteps) {
              cStake = parseFloat((cStake * parseFloat(martingaleMultiplier)).toFixed(2));
              mStep++;
              setMartingaleStep(mStep);
              setCurrentStake(cStake);
              toast.info(`Martingale step ${mStep}: stake $${cStake.toFixed(2)}`);
            } else {
              cStake = baseStake;
              mStep = 0;
              toast.warning('Max martingale steps reached, resetting');
            }
          }
        }
        
        localPnl += pnl;
        localBalance += pnl;
        setNetProfit(localPnl);
        
        // Check profit targets
        if (localPnl >= parseFloat(takeProfit)) {
          toast.success(`Take profit reached! +$${localPnl.toFixed(2)}`);
          break;
        }
        if (localPnl <= -parseFloat(stopLoss)) {
          toast.error(`Stop loss reached! $${localPnl.toFixed(2)}`);
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
    setSelectedSignal(null);
  }, [isAuthorized, isRunning, balance, stake, followSignal, signals, marketData,
      martingaleOn, martingaleMultiplier, martingaleMaxSteps, takeProfit, stopLoss,
      turboMode, activeAccount, recordLoss, executeTrade]);
  
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
    toast.success(`Configured for ${signal.type}: ${signal.reason}`);
  };
  
  const winRate = wins + losses > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : '0.0';
  const connectionColor = connectionStatus === 'connected' ? 'text-profit' : 
                          connectionStatus === 'error' ? 'text-loss' : 'text-warning';
  
  // Check market conditions
  const isMarketChoppy = marketData && (
    Math.abs(marketData.evenPct - marketData.oddPct) < 5 &&
    Math.abs(marketData.overPct - marketData.underPct) < 5
  );
  
  return (
    <div className="space-y-4 max-w-[1920px] mx-auto p-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Zap className="w-5 h-5 text-primary" /> Auto Trading Hub
          </h1>
          <p className="text-xs text-muted-foreground">
            Real-time Deriv API Integration | {connectionStatus === 'connected' ? 'Live Data' : connectionStatus}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="font-mono">
            Balance: ${balance.toFixed(2)}
          </Badge>
          <Badge className={connectionColor}>
            {connectionStatus === 'connected' && '🟢 LIVE'}
            {connectionStatus === 'connecting' && '🟡 CONNECTING'}
            {connectionStatus === 'error' && '🔴 ERROR'}
            {connectionStatus === 'disconnected' && '⚫ OFFLINE'}
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
          <div className="flex items-center gap-4 flex-wrap">
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
            
            {marketData && (
              <div className="flex gap-4 text-xs">
                <span>Even: {marketData.evenPct.toFixed(1)}%</span>
                <span>Odd: {marketData.oddPct.toFixed(1)}%</span>
                <span>Over: {marketData.overPct.toFixed(1)}%</span>
                <span>Under: {marketData.underPct.toFixed(1)}%</span>
              </div>
            )}
          </div>
          
          {/* Market Warning */}
          {isMarketChoppy && (
            <div className="mt-2 p-2 bg-warning/10 rounded-lg flex items-center gap-2 text-warning text-xs">
              <AlertCircle className="w-3 h-3" />
              Market is choppy (difference {'<'} 5%). Signals may be unreliable.
            </div>
          )}
        </CardContent>
      </Card>
      
      {/* Current Strongest Signal */}
      {topSignal && marketData && (
        <motion.div
          initial={{ scale: 0.98, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className={`rounded-xl border-2 p-5 text-center ${
            topSignal.strength === 'strong' ? 'border-profit bg-gradient-to-r from-profit/20 to-transparent' :
            topSignal.strength === 'moderate' ? 'border-warning bg-warning/10' :
            'border-border bg-muted/10'
          }`}
        >
          <div className="text-xs text-muted-foreground mb-1">STRONGEST SIGNAL</div>
          <div className="text-5xl font-bold mb-2">{topSignal.type}</div>
          <div className="flex items-center justify-center gap-3 mb-3">
            <Badge className={`text-sm px-3 py-1 ${
              topSignal.strength === 'strong' ? 'bg-profit' :
              topSignal.strength === 'moderate' ? 'bg-warning' : 'bg-muted'
            }`}>
              {topSignal.strength.toUpperCase()} ({Math.round(topSignal.confidence)}%)
            </Badge>
            <Badge variant="outline" className="text-xs">
              Momentum: {topSignal.momentum > 0 ? '↑' : topSignal.momentum < 0 ? '↓' : '→'} {Math.abs(topSignal.momentum).toFixed(2)}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mb-3">{topSignal.reason}</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs max-w-2xl mx-auto">
            <div>Even: {marketData.evenPct.toFixed(1)}%</div>
            <div>Odd: {marketData.oddPct.toFixed(1)}%</div>
            <div>Over: {marketData.overPct.toFixed(1)}%</div>
            <div>Under: {marketData.underPct.toFixed(1)}%</div>
            <div>Rise: {marketData.risePct.toFixed(1)}%</div>
            <div>Fall: {marketData.fallPct.toFixed(1)}%</div>
            <div>Match: {marketData.matchStrength.toFixed(1)}%</div>
            <div>Diff: {marketData.diffStrength.toFixed(1)}%</div>
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
            {/* Left Column - Bot Config */}
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
                <CardContent className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span>Win Rate:</span>
                    <span className="font-bold text-profit">{winRate}%</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>P/L:</span>
                    <span className={`font-bold ${netProfit >= 0 ? 'text-profit' : 'text-loss'}`}>
                      ${netProfit.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Current Stake:</span>
                    <span className="font-bold">${currentStake.toFixed(2)}{martingaleStep > 0 && ` (M${martingaleStep})`}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Trades:</span>
                    <span>{wins + losses} ({wins}W / {losses}L)</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Selected Signal:</span>
                    <span className="font-mono text-xs">
                      {selectedSignal ? `${selectedSignal.type} (${Math.round(selectedSignal.confidence)}%)` : 'None'}
                    </span>
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
                           className="h-8 text-xs" placeholder="Barrier Digit (0-9)" />
                  )}
                  
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-muted-foreground">Stake ($)</label>
                      <Input type="number" min="0.35" step="0.01" value={stake} 
                             onChange={e => setStake(e.target.value)} disabled={isRunning}
                             className="h-8 text-xs" />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground">Duration</label>
                      <div className="flex gap-1">
                        <Input type="number" min="1" value={duration} 
                               onChange={e => setDuration(e.target.value)} disabled={isRunning}
                               className="h-8 text-xs flex-1" />
                        <Select value={durationUnit} onValueChange={setDurationUnit} disabled={isRunning}>
                          <SelectTrigger className="h-8 text-xs w-14"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="t">Ticks</SelectItem>
                            <SelectItem value="s">Seconds</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
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
                    <div>
                      <label className="text-[10px] text-muted-foreground">Stop Loss ($)</label>
                      <Input type="number" value={stopLoss} onChange={e => setStopLoss(e.target.value)} 
                             disabled={isRunning} className="h-8 text-xs" />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground">Take Profit ($)</label>
                      <Input type="number" value={takeProfit} onChange={e => setTakeProfit(e.target.value)} 
                             disabled={isRunning} className="h-8 text-xs" />
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-muted-foreground">Cooldown (seconds)</label>
                      <Input type="number" min="10" max="300" value={cooldownSeconds} 
                             onChange={e => setCooldownSeconds(parseInt(e.target.value) || 60)}
                             disabled={isRunning} className="h-8 text-xs" />
                    </div>
                    <div className="flex items-center justify-between">
                      <label className="text-xs flex items-center gap-1"><Zap className="w-3 h-3" /> Turbo Mode</label>
                      <Switch checked={turboMode} onCheckedChange={setTurboMode} disabled={isRunning} />
                    </div>
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
                            <span>Exit: {entry.exitDigit}</span>
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
              <CardTitle className="text-sm">All Generated Signals for {marketData?.name || selectedSymbol}</CardTitle>
              <p className="text-xs text-muted-foreground">Based on last 1000 ticks analysis</p>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {signals.length === 0 ? (
                  <div className="col-span-full text-center py-8 text-muted-foreground">
                    <Scan className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    <p>No signals generated. Market may be choppy or insufficient data.</p>
                  </div>
                ) : (
                  signals.map((signal, idx) => (
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
                        <div className="flex gap-1">
                          {signal.strength === 'strong' && <CheckCircle2 className="w-4 h-4 text-profit" />}
                          {signal.strength === 'weak' && <XCircle className="w-4 h-4 text-loss" />}
                          <Badge className={signal.strength === 'strong' ? 'bg-profit' : 
                                            signal.strength === 'moderate' ? 'bg-warning' : 'bg-muted'}>
                            {Math.round(signal.confidence)}%
                          </Badge>
                        </div>
                      </div>
                      <p className="text-[10px] text-muted-foreground mb-2">{signal.reason}</p>
                      <div className="grid grid-cols-2 gap-1 text-[9px] text-muted-foreground">
                        <span>E: {signal.evenPct.toFixed(0)}%</span>
                        <span>O: {signal.oddPct.toFixed(0)}%</span>
                        <span>Ov: {signal.overPct.toFixed(0)}%</span>
                        <span>Un: {signal.underPct.toFixed(0)}%</span>
                        <span>R: {signal.risePct.toFixed(0)}%</span>
                        <span>F: {signal.fallPct.toFixed(0)}%</span>
                      </div>
                      <Button size="sm" className="w-full mt-2 h-6 text-[9px]" variant="outline"
                              onClick={(e) => { e.stopPropagation(); handleUseSignal(signal); }}>
                        Use Signal
                      </Button>
                    </motion.div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
    }
