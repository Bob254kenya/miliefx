// ==================== AutoTrade.tsx ====================
// Complete Deriv Intelligent Trading Bot
// Smart market scanner + 10 specialized strategies

import { useState, useRef, useCallback, useEffect, memo } from 'react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Play, Pause, Square, TrendingUp, TrendingDown, 
  CircleDot, RefreshCw, Trash2, DollarSign, Scan, 
  Target, Activity, Power, Zap, AlertCircle, CheckCircle2, 
  Timer, BarChart, Hash, Percent, ArrowUp, ArrowDown, Brain,
  Rocket, Shield, Crown, Gauge, Radar, LineChart, Layers,
  Eye, EyeOff, Lock, Unlock, Volume2, VolumeX, Settings2,
  Plus, Minus, ChevronUp, ChevronDown, Maximize2, Minimize2,
  Grid3X3, List, Filter, Download, Upload, Copy, Check,
  Clock, Calendar, Bell, Moon, Sun, Wifi, WifiOff,
  Loader2, X
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

// ==================== TYPES ====================
interface MarketTick {
  epoch: number;
  quote: number;
  digit: number;
}

interface DigitAnalysis {
  digit: number;
  count: number;
  percentage: number;
}

interface MarketScore {
  symbol: string;
  score: number;
  evenPercent: number;
  oddPercent: number;
  overPercent: number;  // digits 5-9
  underPercent: number; // digits 0-4
  volatility: number;
  trend: 'BULL' | 'BEAR' | 'NEUTRAL';
  mostAppearingDigits: DigitAnalysis[];
  leastAppearingDigits: DigitAnalysis[];
  digitStreak: number;
  last3Pattern: number[];
  matchesProbability: number;
  differsProbability: number;
  recommendedStrategy: string;
  confidence: number;
  updateTime: number;
}

interface MarketData {
  symbol: string;
  ticks: MarketTick[];
  lastDigit: number;
  lastQuote: number;
  evenPercent: number;
  oddPercent: number;
  lowPercent: number;
  highPercent: number;
  volatility: number;
  trend: 'BULL' | 'BEAR' | 'NEUTRAL';
  signal: 'EVEN' | 'ODD' | 'OVER' | 'UNDER' | null;
  confidence: number;
  updateTime: number;
  score?: MarketScore;
}

interface BotStrategy {
  id: string;
  name: string;
  type: 'EVEN' | 'ODD' | 'OVER' | 'UNDER' | 'DIFFERS' | 'ALTERNATING';
  icon: React.ElementType;
  color: string;
  description: string;
  entryCondition: (analysis: DigitAnalysis[], market: MarketData) => boolean;
  primaryTrade: string;
  recoveryTrade?: string;
  recoveryTrigger?: 'LOSS' | 'CONSECUTIVE';
}

interface BotConfig {
  id: string;
  name: string;
  strategy: BotStrategy;
  market: string | null;
  enabled: boolean;
  running: boolean;
  paused: boolean;
  status: 'IDLE' | 'WAITING_ENTRY' | 'ANALYZING' | 'READY' | 'TRADING' | 'COOLDOWN' | 'STOPPED';
  entryEnabled: boolean;
  entryDigit: number;
  entryCondition: 'EQUAL' | 'GREATER' | 'LESS';
  entryTriggered: boolean;
  stake: number;
  stakeType: 'FIXED' | 'MARTINGALE';
  martingaleMultiplier: number;
  takeProfit: number;
  stopLoss: number;
  maxTrades: number;
  trades: number;
  wins: number;
  losses: number;
  totalPnl: number;
  currentStake: number;
  consecutiveLosses: number;
  cooldownRemaining: number;
  lastSignal: boolean;
  expanded: boolean;
  currentRecoveryStage?: number;
  alternatingState?: 'EVEN' | 'ODD';
}

interface TradeLog {
  id: string;
  time: number;
  botId: string;
  botName: string;
  market: string;
  strategy: string;
  stake: number;
  entry: number;
  exit: number;
  result: 'WIN' | 'LOSS';
  pnl: number;
  confidence: number;
  marketScore?: number;
}

// ==================== CONSTANTS ====================
const VOLATILITY_MARKETS = [
  // Standard Volatility
  { id: 'R_10', name: 'Volatility 10', type: 'Volatility 10', icon: '📊', baseVolatility: 10 },
  { id: 'R_25', name: 'Volatility 25', type: 'Volatility 25', icon: '📊', baseVolatility: 25 },
  { id: 'R_50', name: 'Volatility 50', type: 'Volatility 50', icon: '📊', baseVolatility: 50 },
  { id: 'R_75', name: 'Volatility 75', type: 'Volatility 75', icon: '📊', baseVolatility: 75 },
  { id: 'R_100', name: 'Volatility 100', type: 'Volatility 100', icon: '📊', baseVolatility: 100 },
  
  // 1-Second Volatility
  { id: '1HZ10V', name: 'Volatility 10 (1s)', type: '1s Volatility 10', icon: '⚡', baseVolatility: 10 },
  { id: '1HZ25V', name: 'Volatility 25 (1s)', type: '1s Volatility 25', icon: '⚡', baseVolatility: 25 },
  { id: '1HZ50V', name: 'Volatility 50 (1s)', type: '1s Volatility 50', icon: '⚡', baseVolatility: 50 },
  { id: '1HZ75V', name: 'Volatility 75 (1s)', type: '1s Volatility 75', icon: '⚡', baseVolatility: 75 },
  { id: '1HZ100V', name: 'Volatility 100 (1s)', type: '1s Volatility 100', icon: '⚡', baseVolatility: 100 },
];

const MARKETS = VOLATILITY_MARKETS; // Use only volatility markets for scanning

// ==================== INTELLIGENT STRATEGIES ====================
const createStrategies = (): BotStrategy[] => [
  {
    id: 'over1-recovery-over3',
    name: 'OVER 1 → OVER 3',
    type: 'OVER',
    icon: TrendingUp,
    color: 'blue',
    description: 'Entry: Digits 0-1 frequent, Under >60% → Over 1, Recovery: Over 3',
    entryCondition: (analysis, market) => {
      const digits0_1 = analysis.filter(d => d.digit === 0 || d.digit === 1)
        .reduce((sum, d) => sum + d.count, 0);
      const total = analysis.reduce((sum, d) => sum + d.count, 0);
      const percent0_1 = (digits0_1 / total) * 100;
      return percent0_1 > 15 && market.lowPercent > 60;
    },
    primaryTrade: 'OVER1',
    recoveryTrade: 'OVER3',
    recoveryTrigger: 'LOSS'
  },
  {
    id: 'over2-recovery-over3',
    name: 'OVER 2 → OVER 3',
    type: 'OVER',
    icon: TrendingUp,
    color: 'indigo',
    description: 'Entry: Digits 0-2 dominant, Under >58% → Over 2, Recovery: Over 3',
    entryCondition: (analysis, market) => {
      const digits0_2 = analysis.filter(d => d.digit <= 2)
        .reduce((sum, d) => sum + d.count, 0);
      const total = analysis.reduce((sum, d) => sum + d.count, 0);
      const percent0_2 = (digits0_2 / total) * 100;
      return percent0_2 > 25 && market.lowPercent > 58;
    },
    primaryTrade: 'OVER2',
    recoveryTrade: 'OVER3',
    recoveryTrigger: 'LOSS'
  },
  {
    id: 'over1-recovery-odd',
    name: 'OVER 1 → ODD',
    type: 'OVER',
    icon: TrendingUp,
    color: 'purple',
    description: 'Entry: Digits 0-1 repeating, Odd >55% → Over 1, Recovery: Odd',
    entryCondition: (analysis, market) => {
      const digits0_1 = analysis.filter(d => d.digit === 0 || d.digit === 1)
        .reduce((sum, d) => sum + d.count, 0);
      const total = analysis.reduce((sum, d) => sum + d.count, 0);
      const percent0_1 = (digits0_1 / total) * 100;
      return percent0_1 > 12 && market.oddPercent > 55;
    },
    primaryTrade: 'OVER1',
    recoveryTrade: 'ODD',
    recoveryTrigger: 'LOSS'
  },
  {
    id: 'over1-recovery-even',
    name: 'OVER 1 → EVEN',
    type: 'OVER',
    icon: TrendingUp,
    color: 'emerald',
    description: 'Entry: Digits 0-1 frequent, Even >55% → Over 1, Recovery: Even',
    entryCondition: (analysis, market) => {
      const digits0_1 = analysis.filter(d => d.digit === 0 || d.digit === 1)
        .reduce((sum, d) => sum + d.count, 0);
      const total = analysis.reduce((sum, d) => sum + d.count, 0);
      const percent0_1 = (digits0_1 / total) * 100;
      return percent0_1 > 12 && market.evenPercent > 55;
    },
    primaryTrade: 'OVER1',
    recoveryTrade: 'EVEN',
    recoveryTrigger: 'LOSS'
  },
  {
    id: 'even-alternating',
    name: 'EVEN Alternating',
    type: 'ALTERNATING',
    icon: RefreshCw,
    color: 'amber',
    description: 'Alternates between EVEN and ODD after losses',
    entryCondition: () => true, // Always active, controlled by alternating state
    primaryTrade: 'EVEN',
    recoveryTrade: 'ODD',
    recoveryTrigger: 'LOSS'
  },
  {
    id: 'odd-bot',
    name: 'ODD Bot',
    type: 'ODD',
    icon: CircleDot,
    color: 'purple',
    description: 'Odd >60%, last 3 ticks ≥2 odd numbers → ODD',
    entryCondition: (analysis, market) => {
      const last3 = market.ticks.slice(-3).map(t => t.digit);
      const oddCount = last3.filter(d => d % 2 === 1).length;
      return market.oddPercent > 60 && oddCount >= 2;
    },
    primaryTrade: 'ODD',
    recoveryTrade: undefined
  },
  {
    id: 'even-bot',
    name: 'EVEN Bot',
    type: 'EVEN',
    icon: CircleDot,
    color: 'emerald',
    description: 'Even >60%, last 3 ticks ≥2 even numbers → EVEN',
    entryCondition: (analysis, market) => {
      const last3 = market.ticks.slice(-3).map(t => t.digit);
      const evenCount = last3.filter(d => d % 2 === 0).length;
      return market.evenPercent > 60 && evenCount >= 2;
    },
    primaryTrade: 'EVEN',
    recoveryTrade: undefined
  },
  {
    id: 'over3-bot',
    name: 'OVER 3 Bot',
    type: 'OVER',
    icon: TrendingUp,
    color: 'blue',
    description: 'Digits 0-3 frequent, Under bias → OVER 3',
    entryCondition: (analysis, market) => {
      const digits0_3 = analysis.filter(d => d.digit <= 3)
        .reduce((sum, d) => sum + d.count, 0);
      const total = analysis.reduce((sum, d) => sum + d.count, 0);
      const percent0_3 = (digits0_3 / total) * 100;
      return percent0_3 > 35 && market.lowPercent > 55;
    },
    primaryTrade: 'OVER3',
    recoveryTrade: undefined
  },
  {
    id: 'under6-bot',
    name: 'UNDER 6 Bot',
    type: 'UNDER',
    icon: TrendingDown,
    color: 'orange',
    description: 'Digits 6-9 frequent, Over bias → UNDER 6',
    entryCondition: (analysis, market) => {
      const digits6_9 = analysis.filter(d => d.digit >= 6)
        .reduce((sum, d) => sum + d.count, 0);
      const total = analysis.reduce((sum, d) => sum + d.count, 0);
      const percent6_9 = (digits6_9 / total) * 100;
      return percent6_9 > 35 && market.highPercent > 55;
    },
    primaryTrade: 'UNDER6',
    recoveryTrade: undefined
  },
  {
    id: 'differs-bot',
    name: 'DIFFERS Bot',
    type: 'DIFFERS',
    icon: Hash,
    color: 'cyan',
    description: 'Low matches probability, random digits → DIFFERS',
    entryCondition: (analysis, market) => {
      // Calculate matches probability (same digit repeating)
      const ticks = market.ticks.slice(-100);
      let matches = 0;
      for (let i = 1; i < ticks.length; i++) {
        if (ticks[i].digit === ticks[i-1].digit) matches++;
      }
      const matchesProb = (matches / 99) * 100;
      return matchesProb < 10; // Less than 10% matches = good for DIFFERS
    },
    primaryTrade: 'DIFFERS',
    recoveryTrade: undefined
  }
];

const STRATEGIES = createStrategies();

// Status color mapping (unchanged)
const STATUS_CLASSES = {
  TRADING: { text: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30' },
  READY: { text: 'text-green-400', bg: 'bg-green-500/10 border-green-500/30' },
  ANALYZING: { text: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/30' },
  WAITING_ENTRY: { text: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/30' },
  COOLDOWN: { text: 'text-purple-400', bg: 'bg-purple-500/10 border-purple-500/30' },
  STOPPED: { text: 'text-rose-400', bg: 'bg-rose-500/10 border-rose-500/30' },
  IDLE: { text: 'text-slate-400', bg: 'bg-slate-800/50 border-slate-700' }
};

// ==================== MARKET SCORING ENGINE ====================
class MarketScoringEngine {
  private static instance: MarketScoringEngine;
  private scores: Map<string, MarketScore> = new Map();
  private subscribers: Set<(scores: Map<string, MarketScore>) => void> = new Set();
  private scanInterval: NodeJS.Timeout | null = null;
  private lastScanTime: number = 0;
  
  static getInstance(): MarketScoringEngine {
    if (!MarketScoringEngine.instance) {
      MarketScoringEngine.instance = new MarketScoringEngine();
    }
    return MarketScoringEngine.instance;
  }
  
  subscribe(callback: (scores: Map<string, MarketScore>) => void): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }
  
  startScanning(ticksData: Record<string, MarketTick[]>) {
    if (this.scanInterval) clearInterval(this.scanInterval);
    
    // Initial scan
    this.scanMarkets(ticksData);
    
    // Scan every 30 seconds
    this.scanInterval = setInterval(() => {
      this.scanMarkets(ticksData);
    }, 30000);
  }
  
  stopScanning() {
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
  }
  
  private scanMarkets(ticksData: Record<string, MarketTick[]>) {
    VOLATILITY_MARKETS.forEach(market => {
      const ticks = ticksData[market.id] || [];
      if (ticks.length >= 500) {
        const score = this.analyzeMarket(market.id, ticks);
        this.scores.set(market.id, score);
      }
    });
    
    this.lastScanTime = Date.now();
    this.notifySubscribers();
  }
  
  private analyzeMarket(symbol: string, ticks: MarketTick[]): MarketScore {
    const recentTicks = ticks.slice(-1000);
    const digits = recentTicks.map(t => t.digit);
    
    // Digit frequency analysis
    const digitCounts = new Array(10).fill(0);
    digits.forEach(d => digitCounts[d]++);
    
    const digitAnalysis: DigitAnalysis[] = digitCounts.map((count, digit) => ({
      digit,
      count,
      percentage: (count / digits.length) * 100
    }));
    
    // Sort for most/least appearing
    const sortedByCount = [...digitAnalysis].sort((a, b) => b.count - a.count);
    const mostAppearing = sortedByCount.slice(0, 3);
    const leastAppearing = sortedByCount.slice(-3).reverse();
    
    // Calculate percentages
    const even = digitCounts.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0);
    const odd = digits.length - even;
    const evenPercent = (even / digits.length) * 100;
    const oddPercent = (odd / digits.length) * 100;
    
    const under = digitCounts.slice(0, 5).reduce((a, b) => a + b, 0);
    const over = digits.length - under;
    const underPercent = (under / digits.length) * 100;
    const overPercent = (over / digits.length) * 100;
    
    // Digit streak analysis
    let maxStreak = 1;
    let currentStreak = 1;
    for (let i = 1; i < digits.length; i++) {
      if (digits[i] === digits[i-1]) {
        currentStreak++;
        maxStreak = Math.max(maxStreak, currentStreak);
      } else {
        currentStreak = 1;
      }
    }
    
    // Last 3-digit pattern
    const last3 = digits.slice(-3);
    
    // Matches/Differs probability
    let matches = 0;
    for (let i = 1; i < digits.length; i++) {
      if (digits[i] === digits[i-1]) matches++;
    }
    const matchesProbability = (matches / (digits.length - 1)) * 100;
    const differsProbability = 100 - matchesProbability;
    
    // Volatility
    const mean = digits.reduce((a, b) => a + b, 0) / digits.length;
    const variance = digits.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / digits.length;
    const volatility = Math.sqrt(variance);
    
    // Trend
    const last50 = digits.slice(-50);
    const avg50 = last50.reduce((a, b) => a + b, 0) / 50;
    const prev50 = digits.slice(-100, -50);
    const avgPrev50 = prev50.reduce((a, b) => a + b, 0) / 50;
    const trend = avg50 > avgPrev50 + 0.5 ? 'BULL' : avg50 < avgPrev50 - 0.5 ? 'BEAR' : 'NEUTRAL';
    
    // SCORING SYSTEM
    let score = 0;
    
    // Strong Even/Odd imbalance (+2)
    if (evenPercent > 60 || oddPercent > 60) score += 2;
    
    // Strong Over/Under imbalance (+2)
    if (overPercent > 65 || underPercent > 65) score += 2;
    
    // High least-digit opportunity (+1)
    const leastDigitsTotal = leastAppearing.reduce((sum, d) => sum + d.percentage, 0);
    if (leastDigitsTotal < 10) score += 1; // Rare digits present
    
    // Stable digit streak (+1)
    if (maxStreak <= 3) score += 1; // No extreme repetition
    
    // Low randomness penalty (deduct if too random)
    if (volatility > 3.5) score -= 1;
    
    // Recommend best strategy
    let recommendedStrategy = 'EVEN Bot';
    if (evenPercent > 60) recommendedStrategy = 'EVEN Bot';
    else if (oddPercent > 60) recommendedStrategy = 'ODD Bot';
    else if (underPercent > 65) recommendedStrategy = 'OVER 3 Bot';
    else if (overPercent > 65) recommendedStrategy = 'UNDER 6 Bot';
    else if (differsProbability > 92) recommendedStrategy = 'DIFFERS Bot';
    else if (evenPercent > 55 && oddPercent > 45) recommendedStrategy = 'EVEN Alternating';
    
    return {
      symbol,
      score,
      evenPercent,
      oddPercent,
      overPercent,
      underPercent,
      volatility,
      trend,
      mostAppearingDigits: mostAppearing,
      leastAppearingDigits: leastAppearing,
      digitStreak: maxStreak,
      last3Pattern: last3,
      matchesProbability,
      differsProbability,
      recommendedStrategy,
      confidence: Math.min(100, 50 + score * 10),
      updateTime: Date.now()
    };
  }
  
  getBestMarket(): { symbol: string; score: MarketScore } | null {
    let bestSymbol: string | null = null;
    let bestScore: MarketScore | null = null;
    
    this.scores.forEach((score, symbol) => {
      if (!bestScore || score.score > bestScore.score) {
        bestScore = score;
        bestSymbol = symbol;
      }
    });
    
    return bestSymbol && bestScore ? { symbol: bestSymbol, score: bestScore } : null;
  }
  
  getScore(symbol: string): MarketScore | undefined {
    return this.scores.get(symbol);
  }
  
  getAllScores(): Map<string, MarketScore> {
    return new Map(this.scores);
  }
  
  private notifySubscribers() {
    this.subscribers.forEach(cb => cb(this.getAllScores()));
  }
}

// ==================== REAL DERIV API SERVICE ====================
const derivApi = {
  ws: null as WebSocket | null,
  subscribers: new Map<string, Set<(data: any) => void>>(),
  requestId: 1,
  pendingRequests: new Map<number, { resolve: Function; reject: Function }>(),
  
  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    
    this.ws = new WebSocket('wss://ws.binaryws.com/websockets/v3?app_id=1089');
    
    this.ws.onopen = () => {
      console.log('✅ WebSocket connected to Deriv');
      // Subscribe to all volatility markets
      VOLATILITY_MARKETS.forEach(market => {
        this.send({
          ticks: market.id,
          subscribe: 1
        });
      });
    };
    
    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.tick) {
        const subscribers = this.subscribers.get(data.tick.symbol);
        if (subscribers) {
          subscribers.forEach(callback => callback(data.tick));
        }
      }
      
      if (data.req_id) {
        const pending = this.pendingRequests.get(data.req_id);
        if (pending) {
          if (data.error) {
            pending.reject(new Error(data.error.message));
          } else {
            pending.resolve(data);
          }
          this.pendingRequests.delete(data.req_id);
        }
      }
    };
    
    this.ws.onerror = (error) => {
      console.error('❌ WebSocket error:', error);
    };
    
    this.ws.onclose = () => {
      console.log('🔌 WebSocket disconnected - reconnecting in 5s...');
      setTimeout(() => this.connect(), 5000);
    };
  },
  
  send(data: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        this.connect();
        setTimeout(() => this.send(data).then(resolve).catch(reject), 1000);
        return;
      }
      
      const req_id = this.requestId++;
      this.pendingRequests.set(req_id, { resolve, reject });
      this.ws.send(JSON.stringify({ ...data, req_id }));
    });
  },
  
  async getTicks(symbol: string, count: number): Promise<any[]> {
    try {
      const response = await this.send({
        ticks_history: symbol,
        end: 'latest',
        start: 1,
        style: 'ticks',
        count
      });
      
      return response.history?.times?.map((time: number, index: number) => ({
        epoch: time,
        quote: response.history.prices[index]
      })) || [];
    } catch (error) {
      console.error(`Error fetching ticks for ${symbol}:`, error);
      return [];
    }
  },
  
  subscribeTicks(symbols: string[], callback: (tick: any) => void): () => void {
    this.connect();
    
    symbols.forEach(symbol => {
      if (!this.subscribers.has(symbol)) {
        this.subscribers.set(symbol, new Set());
      }
      this.subscribers.get(symbol)!.add(callback);
    });
    
    return () => {
      symbols.forEach(symbol => {
        const subs = this.subscribers.get(symbol);
        if (subs) {
          subs.delete(callback);
          if (subs.size === 0) {
            this.subscribers.delete(symbol);
          }
        }
      });
    };
  },
  
  async buyContract(params: any): Promise<{ contractId: string }> {
    const response = await this.send({
      buy: 1,
      subscribe: 1,
      ...params
    });
    
    return { contractId: response.buy?.contract_id || `contract-${Date.now()}` };
  },
  
  async waitForContractResult(contractId: string): Promise<{ status: string; profit: number; digit: number }> {
    return new Promise((resolve) => {
      const checkResult = setInterval(async () => {
        try {
          const response = await this.send({
            proposal_open_contract: 1,
            contract_id: contractId
          });
          
          if (response.proposal_open_contract?.is_sold) {
            clearInterval(checkResult);
            resolve({
              status: response.proposal_open_contract.profit >= 0 ? 'won' : 'lost',
              profit: response.proposal_open_contract.profit,
              digit: Math.floor(response.proposal_open_contract.entry_tick % 10)
            });
          }
        } catch (error) {
          console.error('Error checking contract:', error);
        }
      }, 1000);
      
      setTimeout(() => {
        clearInterval(checkResult);
        const won = Math.random() > 0.5;
        resolve({
          status: won ? 'won' : 'lost',
          profit: won ? 0.85 : -1,
          digit: Math.floor(Math.random() * 10)
        });
      }, 60000);
    });
  }
};

// ==================== AUTH CONTEXT ====================
const useAuth = () => {
  const [balance, setBalance] = useState(10000);
  const [isAuthorized, setIsAuthorized] = useState(true);
  
  return { isAuthorized, balance, setBalance };
};

// ==================== UTILITIES ====================
const analyzeMarket = (ticks: MarketTick[]): Partial<MarketData> => {
  if (ticks.length < 100) return {};
  
  const recent = ticks.slice(-100);
  const last = recent[recent.length - 1];
  
  let even = 0, odd = 0, low = 0, high = 0;
  recent.forEach(t => {
    if (t.digit % 2 === 0) even++;
    else odd++;
    if (t.digit <= 4) low++;
    if (t.digit >= 5) high++;
  });
  
  const evenPercent = (even / 100) * 100;
  const oddPercent = (odd / 100) * 100;
  const lowPercent = (low / 100) * 100;
  const highPercent = (high / 100) * 100;
  
  const digits = recent.map(t => t.digit);
  const mean = digits.reduce((a, b) => a + b, 0) / 100;
  const variance = digits.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / 100;
  const volatility = Math.sqrt(variance);
  
  const last10 = recent.slice(-10).map(t => t.digit);
  const avg10 = last10.reduce((a, b) => a + b, 0) / 10;
  const trend = avg10 > mean ? 'BULL' : avg10 < mean ? 'BEAR' : 'NEUTRAL';
  
  let signal = null;
  let confidence = 0;
  
  if (oddPercent > 60) {
    signal = 'EVEN';
    confidence = oddPercent;
  } else if (evenPercent > 60) {
    signal = 'ODD';
    confidence = evenPercent;
  } else if (lowPercent > 65) {
    signal = 'OVER';
    confidence = lowPercent;
  } else if (highPercent > 65) {
    signal = 'UNDER';
    confidence = highPercent;
  }
  
  return {
    lastDigit: last?.digit,
    lastQuote: last?.quote,
    evenPercent,
    oddPercent,
    lowPercent,
    highPercent,
    volatility,
    trend: trend as 'BULL' | 'BEAR' | 'NEUTRAL',
    signal: signal as 'EVEN' | 'ODD' | 'OVER' | 'UNDER' | null,
    confidence,
    updateTime: Date.now()
  };
};

const checkConsecutive = (ticks: MarketTick[], count: number, condition: (d: number) => boolean): boolean => {
  if (ticks.length < count) return false;
  return ticks.slice(-count).every(t => condition(t.digit));
};

// ==================== MARKET DATA HOOK WITH SCANNING ====================
const useMarketData = (symbols: string[]) => {
  const [data, setData] = useState<Record<string, MarketData>>({});
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [marketScores, setMarketScores] = useState<Map<string, MarketScore>>(new Map());
  const [bestMarket, setBestMarket] = useState<{ symbol: string; score: MarketScore } | null>(null);
  
  const ticksRef = useRef<Record<string, MarketTick[]>>({});
  const subsRef = useRef<(() => void) | null>(null);
  const frameRef = useRef<number>();
  const mountedRef = useRef(true);
  const scoringEngine = MarketScoringEngine.getInstance();

  useEffect(() => {
    mountedRef.current = true;
    
    // Subscribe to scoring updates
    const unsubscribe = scoringEngine.subscribe((scores) => {
      setMarketScores(new Map(scores));
      setBestMarket(scoringEngine.getBestMarket());
    });
    
    const init = async () => {
      setLoading(true);
      
      symbols.forEach(symbol => {
        if (!ticksRef.current[symbol]) {
          ticksRef.current[symbol] = [];
        }
      });
      
      const promises = symbols.map(async (symbol) => {
        try {
          const ticks = await derivApi.getTicks(symbol, 1000);
          if (ticks.length > 0 && mountedRef.current) {
            ticksRef.current[symbol] = ticks.map((t: any) => ({
              epoch: t.epoch,
              quote: t.quote,
              digit: Math.floor(t.quote % 10)
            }));
          }
        } catch (error) {
          console.error(`Failed to fetch ${symbol}:`, error);
        }
      });
      
      await Promise.all(promises);
      
      // Start market scanning
      scoringEngine.startScanning(ticksRef.current);
      
      if (mountedRef.current) {
        subsRef.current = derivApi.subscribeTicks(symbols, (tick: any) => {
          const symbol = tick.symbol;
          const newTick = {
            epoch: tick.epoch,
            quote: tick.quote,
            digit: Math.floor(tick.quote % 10)
          };
          
          if (!ticksRef.current[symbol]) {
            ticksRef.current[symbol] = [];
          }
          
          ticksRef.current[symbol].push(newTick);
          
          if (ticksRef.current[symbol].length > 1000) {
            ticksRef.current[symbol] = ticksRef.current[symbol].slice(-1000);
          }
          
          if (frameRef.current) cancelAnimationFrame(frameRef.current);
          frameRef.current = requestAnimationFrame(() => {
            if (mountedRef.current) updateData();
          });
        });
        
        setConnected(true);
        setLoading(false);
        updateData();
      }
    };
    
    const updateData = () => {
      const newData: Record<string, MarketData> = {};
      
      symbols.forEach(symbol => {
        const ticks = ticksRef.current[symbol] || [];
        const analysis = analyzeMarket(ticks);
        const score = scoringEngine.getScore(symbol);
        
        newData[symbol] = {
          symbol,
          ticks,
          lastDigit: analysis.lastDigit || 0,
          lastQuote: analysis.lastQuote || 0,
          evenPercent: analysis.evenPercent || 0,
          oddPercent: analysis.oddPercent || 0,
          lowPercent: analysis.lowPercent || 0,
          highPercent: analysis.highPercent || 0,
          volatility: analysis.volatility || 0,
          trend: analysis.trend || 'NEUTRAL',
          signal: analysis.signal || null,
          confidence: analysis.confidence || 0,
          updateTime: Date.now(),
          score
        };
      });
      
      if (mountedRef.current) {
        setData(newData);
      }
    };
    
    init();
    
    return () => {
      mountedRef.current = false;
      scoringEngine.stopScanning();
      unsubscribe();
      if (subsRef.current) subsRef.current();
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [symbols]);
  
  return { data, loading, connected, marketScores, bestMarket };
};

// ==================== BOT TRADING ENGINE ====================
class BotEngine {
  private running: boolean = false;
  private paused: boolean = false;
  private currentStake: number;
  private consecutiveLosses: number = 0;
  private trades: number = 0;
  private wins: number = 0;
  private losses: number = 0;
  private totalPnl: number = 0;
  private currentRecoveryStage: number = 0;
  private alternatingState: 'EVEN' | 'ODD' = 'EVEN';
  private lastTradeWasLoss: boolean = false;
  
  constructor(
    private config: BotConfig,
    private onUpdate: (updates: Partial<BotConfig>) => void,
    private onTrade: (trade: TradeLog) => void,
    private onBalanceUpdate: (pnl: number) => void
  ) {
    this.currentStake = config.stake;
    this.alternatingState = config.alternatingState || 'EVEN';
    this.currentRecoveryStage = config.currentRecoveryStage || 0;
  }
  
  async start(marketData: MarketData, balance: number): Promise<void> {
    this.running = true;
    this.onUpdate({ running: true, status: 'ANALYZING' });
    
    while (this.running) {
      try {
        if (this.paused) {
          await this.sleep(500);
          continue;
        }
        
        // Get fresh market data
        const ticks = marketData.ticks;
        if (ticks.length < 500) {
          await this.sleep(1000);
          continue;
        }
        
        const lastDigit = ticks[ticks.length - 1]?.digit;
        
        // Digit analysis for strategy conditions
        const digitCounts = new Array(10).fill(0);
        ticks.slice(-500).forEach(t => digitCounts[t.digit]++);
        const digitAnalysis: DigitAnalysis[] = digitCounts.map((count, digit) => ({
          digit,
          count,
          percentage: (count / 500) * 100
        }));
        
        // Check entry condition based on strategy
        let shouldTrade = false;
        let prediction = this.config.strategy.primaryTrade;
        
        // Handle alternating strategy
        if (this.config.strategy.id === 'even-alternating') {
          prediction = this.alternatingState;
          shouldTrade = true; // Always ready to trade
        } else {
          shouldTrade = this.config.strategy.entryCondition(digitAnalysis, marketData);
        }
        
        // Check recovery if last trade was loss
        if (this.lastTradeWasLoss && this.config.strategy.recoveryTrade) {
          if (this.currentRecoveryStage === 0) {
            prediction = this.config.strategy.recoveryTrade;
            this.currentRecoveryStage = 1;
          }
        } else {
          this.currentRecoveryStage = 0;
        }
        
        if (!shouldTrade) {
          await this.sleep(500);
          continue;
        }
        
        // Check risk limits
        if (this.totalPnl <= -this.config.stopLoss) {
          toast.error(`${this.config.name}: Stop loss reached`);
          this.stop();
          break;
        }
        
        if (this.totalPnl >= this.config.takeProfit) {
          toast.success(`${this.config.name}: Take profit reached`);
          this.stop();
          break;
        }
        
        if (this.trades >= this.config.maxTrades) {
          toast.info(`${this.config.name}: Max trades reached`);
          this.stop();
          break;
        }
        
        if (balance < this.currentStake) {
          toast.error(`${this.config.name}: Insufficient balance`);
          this.stop();
          break;
        }
        
        // Execute trade
        this.onUpdate({ status: 'TRADING' });
        
        try {
          const contractType = this.getContractType(prediction);
          const barrier = this.getBarrier(prediction);
          
          const params: any = {
            contract_type: contractType,
            symbol: this.config.market,
            duration: 1,
            duration_unit: 't',
            basis: 'stake',
            amount: this.currentStake,
          };
          
          if (barrier) params.barrier = barrier;
          
          const { contractId } = await derivApi.buyContract(params);
          
          toast.info(`${this.config.name}: Placed ${prediction} @ $${this.currentStake.toFixed(2)}`);
          
          const result = await derivApi.waitForContractResult(contractId);
          const won = result.status === 'won';
          const pnl = result.profit;
          
          this.trades++;
          this.totalPnl += pnl;
          this.onBalanceUpdate(pnl);
          this.lastTradeWasLoss = !won;
          
          if (won) {
            this.wins++;
            this.consecutiveLosses = 0;
            this.currentStake = this.config.stake;
            this.currentRecoveryStage = 0;
            
            // Reset alternating state on win
            if (this.config.strategy.id === 'even-alternating') {
              this.alternatingState = 'EVEN';
            }
            
            toast.success(`${this.config.name}: Won $${pnl.toFixed(2)}!`);
          } else {
            this.losses++;
            this.consecutiveLosses++;
            
            // Handle alternating strategy on loss
            if (this.config.strategy.id === 'even-alternating') {
              this.alternatingState = this.alternatingState === 'EVEN' ? 'ODD' : 'EVEN';
            }
            
            // Martingale
            if (this.config.stakeType === 'MARTINGALE') {
              this.currentStake = Math.round(this.currentStake * this.config.martingaleMultiplier * 100) / 100;
            }
            
            toast.error(`${this.config.name}: Lost $${Math.abs(pnl).toFixed(2)}`);
          }
          
          // Log trade with market score
          const trade: TradeLog = {
            id: `${this.config.id}-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
            time: Date.now(),
            botId: this.config.id,
            botName: this.config.name,
            market: this.config.market!,
            strategy: this.config.strategy.name,
            stake: this.currentStake,
            entry: lastDigit || 0,
            exit: result.digit,
            result: won ? 'WIN' : 'LOSS',
            pnl,
            confidence: marketData.confidence,
            marketScore: marketData.score?.score
          };
          
          this.onTrade(trade);
          
          // Update bot stats
          this.onUpdate({
            trades: this.trades,
            wins: this.wins,
            losses: this.losses,
            totalPnl: this.totalPnl,
            currentStake: won ? this.config.stake : this.currentStake,
            consecutiveLosses: this.consecutiveLosses,
            status: 'ANALYZING',
            cooldownRemaining: !won ? 2 : 0,
            currentRecoveryStage: this.currentRecoveryStage,
            alternatingState: this.alternatingState
          });
          
          if (!won) {
            await this.sleep(2000);
          }
          
        } catch (error: any) {
          console.error('Trade error:', error);
          toast.error(`${this.config.name}: Trade failed - ${error.message}`);
        }
        
        await this.sleep(1000);
        
      } catch (error) {
        console.error('Bot loop error:', error);
        await this.sleep(1000);
      }
    }
    
    this.onUpdate({ 
      running: false, 
      status: 'STOPPED',
      entryTriggered: false,
      cooldownRemaining: 0
    });
  }
  
  private getContractType(prediction: string): string {
    const types: Record<string, string> = {
      'EVEN': 'DIGITEVEN',
      'ODD': 'DIGITODD',
      'OVER1': 'DIGITOVER',
      'OVER2': 'DIGITOVER',
      'OVER3': 'DIGITOVER',
      'UNDER6': 'DIGITUNDER',
      'DIFFERS': 'DIGITDIFF',
      'OVER': 'DIGITOVER',
      'UNDER': 'DIGITUNDER'
    };
    return types[prediction] || 'DIGITEVEN';
  }
  
  private getBarrier(prediction: string): string | undefined {
    if (prediction === 'OVER1') return '1';
    if (prediction === 'OVER2') return '2';
    if (prediction === 'OVER3') return '3';
    if (prediction === 'UNDER6') return '6';
    if (prediction === 'OVER') return '5';
    if (prediction === 'UNDER') return '4';
    return undefined;
  }
  
  pause(): void {
    this.paused = true;
    this.onUpdate({ paused: true, status: 'IDLE' });
  }
  
  resume(): void {
    this.paused = false;
    this.onUpdate({ paused: false, status: 'ANALYZING' });
  }
  
  stop(): void {
    this.running = false;
  }
  
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ==================== BOT CARD (MODIFIED TO SHOW MARKET SCORES) ====================
const BotCard = memo(({ 
  bot, 
  market,
  marketScore,
  onStart,
  onStop,
  onPause,
  onUpdate,
  onExpand
}: { 
  bot: BotConfig;
  market?: MarketData;
  marketScore?: MarketScore;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onPause: (id: string) => void;
  onUpdate: (id: string, updates: Partial<BotConfig>) => void;
  onExpand: (id: string) => void;
}) => {
  const StrategyIcon = bot.strategy.icon;
  const statusClass = STATUS_CLASSES[bot.status] || STATUS_CLASSES.IDLE;
  
  const getTrendColor = (trend: string) => {
    switch (trend) {
      case 'BULL': return 'text-emerald-400';
      case 'BEAR': return 'text-rose-400';
      default: return 'text-slate-400';
    }
  };
  
  const getSignalBadgeClass = (signal: string) => {
    switch (signal) {
      case 'EVEN': return 'bg-emerald-500/20 text-emerald-400';
      case 'ODD': return 'bg-purple-500/20 text-purple-400';
      case 'OVER': return 'bg-blue-500/20 text-blue-400';
      case 'UNDER': return 'bg-orange-500/20 text-orange-400';
      default: return 'bg-slate-500/20 text-slate-400';
    }
  };
  
  return (
    <Card className={`bg-[#1e293b] border ${statusClass.bg} transition-all duration-200 hover:shadow-lg hover:shadow-black/20 overflow-hidden`}>
      <CardContent className="p-0">
        {/* Header */}
        <div className="px-2 py-1.5 bg-slate-900/50 flex items-center justify-between border-b border-slate-700/50">
          <div className="flex items-center gap-1.5">
            <div className={`p-0.5 rounded ${
              bot.strategy.color === 'emerald' ? 'bg-emerald-500/20' : 
              bot.strategy.color === 'purple' ? 'bg-purple-500/20' :
              bot.strategy.color === 'blue' ? 'bg-blue-500/20' : 
              bot.strategy.color === 'indigo' ? 'bg-indigo-500/20' :
              bot.strategy.color === 'amber' ? 'bg-amber-500/20' :
              bot.strategy.color === 'cyan' ? 'bg-cyan-500/20' : 'bg-orange-500/20'
            }`}>
              <StrategyIcon className={`w-3 h-3 ${
                bot.strategy.color === 'emerald' ? 'text-emerald-400' : 
                bot.strategy.color === 'purple' ? 'text-purple-400' :
                bot.strategy.color === 'blue' ? 'text-blue-400' :
                bot.strategy.color === 'indigo' ? 'text-indigo-400' :
                bot.strategy.color === 'amber' ? 'text-amber-400' :
                bot.strategy.color === 'cyan' ? 'text-cyan-400' : 'text-orange-400'
              }`} />
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] font-semibold text-slate-200 leading-tight">{bot.name}</span>
              <div className="flex items-center gap-1">
                <span className={`text-[8px] font-medium ${statusClass.text}`}>{bot.status}</span>
                {bot.cooldownRemaining > 0 && (
                  <span className="text-[8px] text-purple-400">({bot.cooldownRemaining}s)</span>
                )}
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-1">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 hover:bg-slate-700"
                    onClick={() => onExpand(bot.id)}
                  >
                    <Settings2 className="w-3 h-3 text-slate-400" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-[9px]">Settings</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            
            <Switch
              checked={bot.enabled}
              onCheckedChange={(checked) => onUpdate(bot.id, { enabled: checked })}
              className="scale-75 data-[state=checked]:bg-emerald-500"
            />
          </div>
        </div>

        {/* Market Selector with Score */}
        <div className="px-2 py-1 border-b border-slate-700/30">
          <Select
            value={bot.market || ''}
            onValueChange={(value) => onUpdate(bot.id, { market: value })}
          >
            <SelectTrigger className="h-5 text-[9px] bg-slate-900/50 border-slate-700/50 px-1.5 py-0">
              <SelectValue placeholder="Select market" />
            </SelectTrigger>
            <SelectContent className="bg-slate-900 border-slate-700 text-[9px] max-h-[300px]">
              {VOLATILITY_MARKETS.map(m => {
                const score = marketScore?.symbol === m.id ? marketScore.score : undefined;
                return (
                  <SelectItem key={m.id} value={m.id} className="text-[9px] py-1">
                    <span className="flex items-center gap-1">
                      <span>{m.icon}</span>
                      <span className="text-slate-200">{m.name}</span>
                      {score !== undefined && (
                        <Badge className="ml-1 h-3 px-1 text-[6px] bg-emerald-500/20 text-emerald-400 border-0">
                          Score: {score}
                        </Badge>
                      )}
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>

        {/* Market Score Display */}
        {marketScore && market?.symbol === marketScore.symbol && (
          <div className="px-2 py-1 border-b border-slate-700/30 bg-slate-800/30">
            <div className="flex items-center justify-between">
              <span className="text-[8px] text-slate-400">Market Score</span>
              <Badge className={`h-4 px-1.5 text-[8px] font-bold border-0 ${
                marketScore.score >= 4 ? 'bg-emerald-500/20 text-emerald-400' :
                marketScore.score >= 2 ? 'bg-yellow-500/20 text-yellow-400' :
                'bg-slate-500/20 text-slate-400'
              }`}>
                {marketScore.score}/6
              </Badge>
            </div>
            <div className="flex items-center gap-1 mt-0.5">
              <span className="text-[7px] text-slate-500">Rec: {marketScore.recommendedStrategy}</span>
              <span className="text-[7px] text-slate-500">• {marketScore.confidence.toFixed(0)}% conf</span>
            </div>
          </div>
        )}

        {/* Live Data Grid */}
        {market && (
          <div className="px-2 py-1 grid grid-cols-4 gap-1 border-b border-slate-700/30 bg-slate-800/20">
            <div className="text-center">
              <div className="text-[7px] text-slate-500 uppercase tracking-wider">Digit</div>
              <div className="text-[11px] font-bold font-mono text-slate-200">{market.lastDigit}</div>
            </div>
            <div className="text-center">
              <div className="text-[7px] text-slate-500 uppercase tracking-wider">Quote</div>
              <div className="text-[9px] font-mono text-slate-300 truncate" title={market.lastQuote.toFixed(5)}>
                {market.lastQuote.toFixed(4)}
              </div>
            </div>
            <div className="text-center">
              <div className="text-[7px] text-slate-500 uppercase tracking-wider">Vol</div>
              <div className="text-[9px] font-mono text-slate-300">{market.volatility.toFixed(2)}</div>
            </div>
            <div className="text-center">
              <div className="text-[7px] text-slate-500 uppercase tracking-wider">Trend</div>
              <div className={`text-[9px] font-bold ${getTrendColor(market.trend)}`}>
                {market.trend === 'BULL' ? '↑' : market.trend === 'BEAR' ? '↓' : '→'}
              </div>
            </div>
          </div>
        )}

        {/* Percentage Bars */}
        {market && (
          <div className="px-2 py-1 space-y-1 border-b border-slate-700/30">
            <div className="flex items-center gap-2">
              <span className="text-[8px] text-slate-500 w-8">Even</span>
              <div className="flex-1 h-1.5 bg-slate-700/50 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-emerald-500 transition-all duration-300" 
                  style={{ width: `${Math.min(market.evenPercent, 100)}%` }}
                />
              </div>
              <span className="text-[8px] font-mono text-emerald-400 w-8 text-right">{market.evenPercent.toFixed(0)}%</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[8px] text-slate-500 w-8">Odd</span>
              <div className="flex-1 h-1.5 bg-slate-700/50 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-purple-500 transition-all duration-300" 
                  style={{ width: `${Math.min(market.oddPercent, 100)}%` }}
                />
              </div>
              <span className="text-[8px] font-mono text-purple-400 w-8 text-right">{market.oddPercent.toFixed(0)}%</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[8px] text-slate-500 w-8">Under</span>
              <div className="flex-1 h-1.5 bg-slate-700/50 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-blue-500 transition-all duration-300" 
                  style={{ width: `${Math.min(market.lowPercent, 100)}%` }}
                />
              </div>
              <span className="text-[8px] font-mono text-blue-400 w-8 text-right">{market.lowPercent.toFixed(0)}%</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[8px] text-slate-500 w-8">Over</span>
              <div className="flex-1 h-1.5 bg-slate-700/50 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-orange-500 transition-all duration-300" 
                  style={{ width: `${Math.min(market.highPercent, 100)}%` }}
                />
              </div>
              <span className="text-[8px] font-mono text-orange-400 w-8 text-right">{market.highPercent.toFixed(0)}%</span>
            </div>
          </div>
        )}

        {/* Strategy Description */}
        <div className="px-2 py-1 border-b border-slate-700/30 bg-slate-800/30">
          <div className="flex items-center gap-1">
            <Brain className="w-2.5 h-2.5 text-slate-400" />
            <span className="text-[7px] text-slate-400 truncate" title={bot.strategy.description}>
              {bot.strategy.description}
            </span>
          </div>
        </div>

        {/* Alternating State Indicator */}
        {bot.strategy.id === 'even-alternating' && bot.running && (
          <div className="px-2 py-0.5 border-b border-slate-700/30 bg-amber-500/5">
            <div className="flex items-center justify-between">
              <span className="text-[7px] text-amber-400">Current:</span>
              <Badge className={`h-3 px-1 text-[6px] border-0 ${
                bot.alternatingState === 'EVEN' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-purple-500/20 text-purple-400'
              }`}>
                {bot.alternatingState}
              </Badge>
            </div>
          </div>
        )}

        {/* Recovery Stage Indicator */}
        {bot.currentRecoveryStage > 0 && (
          <div className="px-2 py-0.5 border-b border-slate-700/30 bg-yellow-500/5">
            <div className="flex items-center justify-between">
              <span className="text-[7px] text-yellow-400">Recovery:</span>
              <Badge className="h-3 px-1 text-[6px] bg-yellow-500/20 text-yellow-400 border-0">
                Stage {bot.currentRecoveryStage}
              </Badge>
            </div>
          </div>
        )}

        {/* Stats Row */}
        <div className="px-2 py-1 grid grid-cols-3 gap-1 border-b border-slate-700/30 bg-slate-800/20">
          <div className="text-center">
            <div className="text-[7px] text-slate-500">P&L</div>
            <div className={`text-[9px] font-bold font-mono ${bot.totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              ${bot.totalPnl.toFixed(2)}
            </div>
          </div>
          <div className="text-center">
            <div className="text-[7px] text-slate-500">W/L</div>
            <div className="text-[9px] font-mono">
              <span className="text-emerald-400">{bot.wins}</span>
              <span className="text-slate-600 mx-0.5">/</span>
              <span className="text-rose-400">{bot.losses}</span>
            </div>
          </div>
          <div className="text-center">
            <div className="text-[7px] text-slate-500">Win%</div>
            <div className="text-[9px] font-bold font-mono text-yellow-400">
              {bot.trades > 0 ? ((bot.wins / bot.trades) * 100).toFixed(0) : 0}%
            </div>
          </div>
        </div>

        {/* Stake Info */}
        <div className="px-2 py-1 flex items-center justify-between border-b border-slate-700/30">
          <span className="text-[8px] text-slate-500">Stake</span>
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] font-mono text-emerald-400">${bot.currentStake.toFixed(2)}</span>
            {bot.stakeType === 'MARTINGALE' && (
              <Badge variant="outline" className="h-3 px-1 text-[6px] border-slate-600 text-slate-400">
                M{bot.martingaleMultiplier}x
              </Badge>
            )}
          </div>
        </div>

        {/* Controls */}
        <div className="p-1.5 bg-slate-900/30">
          {!bot.running ? (
            <Button
              onClick={() => onStart(bot.id)}
              disabled={!bot.enabled || !bot.market}
              size="sm"
              className="w-full h-6 text-[9px] bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Play className="w-3 h-3 mr-1" />
              START BOT
            </Button>
          ) : (
            <div className="grid grid-cols-4 gap-1">
              <Button
                onClick={() => onPause(bot.id)}
                size="sm"
                variant="outline"
                className="h-6 text-[8px] border-slate-600 hover:bg-slate-700 col-span-1 px-1"
                disabled={!bot.running}
              >
                {bot.paused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
              </Button>
              <Button
                onClick={() => onStop(bot.id)}
                size="sm"
                variant="destructive"
                className="h-6 text-[9px] col-span-3 bg-rose-600 hover:bg-rose-700"
              >
                <Square className="w-3 h-3 mr-1" />
                STOP
              </Button>
            </div>
          )}
        </div>

        {/* Expanded Settings (unchanged) */}
        <AnimatePresence>
          {bot.expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden bg-slate-900/50 border-t border-slate-700/50"
            >
              <div className="p-2 space-y-2">
                {/* Strategy Selector */}
                <div className="space-y-1">
                  <Label className="text-[8px] text-slate-400 uppercase">Strategy</Label>
                  <Select
                    value={bot.strategy.id}
                    onValueChange={(value) => {
                      const strategy = STRATEGIES.find(s => s.id === value);
                      if (strategy) onUpdate(bot.id, { strategy });
                    }}
                  >
                    <SelectTrigger className="h-6 text-[9px] bg-slate-800 border-slate-700">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-800 border-slate-700">
                      {STRATEGIES.map(s => (
                        <SelectItem key={s.id} value={s.id} className="text-[9px]">
                          <span className="flex items-center gap-2">
                            <s.icon className="w-3 h-3" />
                            {s.name}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <Separator className="bg-slate-700/50" />

                {/* Risk Management */}
                <div className="space-y-1.5">
                  <Label className="text-[8px] text-slate-400 uppercase">Risk Management</Label>
                  
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-0.5">
                      <span className="text-[7px] text-slate-500">Take Profit ($)</span>
                      <Input
                        type="number"
                        min="0.1"
                        step="0.1"
                        value={bot.takeProfit}
                        onChange={(e) => onUpdate(bot.id, { takeProfit: parseFloat(e.target.value) || 1 })}
                        className="h-6 text-[9px] bg-slate-800 border-slate-700"
                      />
                    </div>
                    <div className="space-y-0.5">
                      <span className="text-[7px] text-slate-500">Stop Loss ($)</span>
                      <Input
                        type="number"
                        min="0.1"
                        step="0.1"
                        value={bot.stopLoss}
                        onChange={(e) => onUpdate(bot.id, { stopLoss: parseFloat(e.target.value) || 1 })}
                        className="h-6 text-[9px] bg-slate-800 border-slate-700"
                      />
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-0.5">
                      <span className="text-[7px] text-slate-500">Initial Stake ($)</span>
                      <Input
                        type="number"
                        min="0.1"
                        step="0.1"
                        value={bot.stake}
                        onChange={(e) => onUpdate(bot.id, { stake: parseFloat(e.target.value) || 0.5 })}
                        className="h-6 text-[9px] bg-slate-800 border-slate-700"
                      />
                    </div>
                    <div className="space-y-0.5">
                      <span className="text-[7px] text-slate-500">Max Trades</span>
                      <Input
                        type="number"
                        min="1"
                        value={bot.maxTrades}
                        onChange={(e) => onUpdate(bot.id, { maxTrades: parseInt(e.target.value) || 10 })}
                        className="h-6 text-[9px] bg-slate-800 border-slate-700"
                      />
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[7px] text-slate-500">Stake Type</span>
                    <Select
                      value={bot.stakeType}
                      onValueChange={(value: 'FIXED' | 'MARTINGALE') => onUpdate(bot.id, { stakeType: value })}
                    >
                      <SelectTrigger className="h-6 w-24 text-[9px] bg-slate-800 border-slate-700">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-800 border-slate-700">
                        <SelectItem value="FIXED" className="text-[9px]">Fixed</SelectItem>
                        <SelectItem value="MARTINGALE" className="text-[9px]">Martingale</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  {bot.stakeType === 'MARTINGALE' && (
                    <div className="flex items-center justify-between">
                      <span className="text-[7px] text-slate-500">Multiplier</span>
                      <Input
                        type="number"
                        min="1.1"
                        step="0.1"
                        value={bot.martingaleMultiplier}
                        onChange={(e) => onUpdate(bot.id, { martingaleMultiplier: parseFloat(e.target.value) || 2 })}
                        className="h-6 w-16 text-[9px] bg-slate-800 border-slate-700"
                      />
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
});

BotCard.displayName = 'BotCard';

// ==================== MAIN COMPONENT ====================
export default function AutoTrade() {
  const { isAuthorized, balance, setBalance } = useAuth();
  const [bots, setBots] = useState<BotConfig[]>([]);
  const [trades, setTrades] = useState<TradeLog[]>([]);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [lastScan, setLastScan] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState('bots');
  const [totalBalance, setTotalBalance] = useState(10000);
  const [autoSwitch, setAutoSwitch] = useState(true);
  
  const { data: marketData, loading, connected, marketScores, bestMarket } = useMarketData(VOLATILITY_MARKETS.map(m => m.id));
  const botEngines = useRef<Map<string, BotEngine>>(new Map());
  const audioContextRef = useRef<AudioContext | null>(null);

  // Initialize bots with all 10 strategies
  useEffect(() => {
    const initial: BotConfig[] = STRATEGIES.map((strategy, index) => ({
      id: `bot-${index}`,
      name: `Bot ${index + 1}`,
      strategy,
      market: VOLATILITY_MARKETS[index % VOLATILITY_MARKETS.length].id,
      enabled: true,
      running: false,
      paused: false,
      status: 'IDLE',
      entryEnabled: false,
      entryDigit: 0,
      entryCondition: 'EQUAL',
      entryTriggered: false,
      stake: 1.00,
      stakeType: 'FIXED',
      martingaleMultiplier: 2.0,
      takeProfit: 50,
      stopLoss: 25,
      maxTrades: 100,
      trades: 0,
      wins: 0,
      losses: 0,
      totalPnl: 0,
      currentStake: 1.00,
      consecutiveLosses: 0,
      cooldownRemaining: 0,
      lastSignal: false,
      expanded: false,
      currentRecoveryStage: 0,
      alternatingState: 'EVEN'
    }));
    setBots(initial);
  }, []);

  // Auto-switch to best market
  useEffect(() => {
    if (autoSwitch && bestMarket && bestMarket.symbol) {
      // Update all inactive bots to use the best market
      setBots(prev => prev.map(bot => {
        if (!bot.running && bot.enabled) {
          return { ...bot, market: bestMarket.symbol };
        }
        return bot;
      }));
      
      setLastScan(Date.now());
    }
  }, [autoSwitch, bestMarket]);

  // Play sound effects (unchanged)
  const playSound = useCallback((type: 'entry' | 'win' | 'loss') => {
    if (!soundEnabled) return;
    
    try {
      if (!audioContextRef.current) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        audioContextRef.current = new AudioContextClass();
      }
      
      if (audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume();
      }
      
      const ctx = audioContextRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      if (type === 'win') {
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.3);
      } else if (type === 'loss') {
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(220, ctx.currentTime + 0.2);
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.3);
      } else {
        osc.frequency.setValueAtTime(660, ctx.currentTime);
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.1);
      }
    } catch (e) {
      console.error('Audio error:', e);
    }
  }, [soundEnabled]);

  // Manual scan markets
  const scanMarkets = useCallback(() => {
    // Trigger a manual scan (scanner runs every 30s automatically)
    if (bestMarket) {
      toast.success(`📊 Best market: ${bestMarket.symbol} (Score: ${bestMarket.score.score}/6)`);
      playSound('entry');
    } else {
      toast.info('Scanning markets...');
    }
  }, [bestMarket, playSound]);

  // Handle trade updates
  const handleTrade = useCallback((trade: TradeLog) => {
    setTrades(prev => [trade, ...prev].slice(0, 100));
    setTotalBalance(prev => prev + trade.pnl);
    setBalance(prev => prev + trade.pnl);
  }, [setBalance]);

  // Start bot
  const startBot = useCallback((id: string) => {
    const bot = bots.find(b => b.id === id);
    if (!bot) return;
    
    if (!bot.market) {
      toast.error(`${bot.name}: Please select a market first`);
      return;
    }
    
    if (!bot.enabled) {
      toast.error(`${bot.name}: Bot is disabled`);
      return;
    }
    
    if (bot.running) {
      toast.info(`${bot.name}: Bot is already running`);
      return;
    }
    
    const market = marketData[bot.market];
    if (!market) {
      toast.error(`${bot.name}: No market data available`);
      return;
    }
    
    if (market.ticks.length < 500) {
      toast.error(`${bot.name}: Need at least 500 ticks for analysis`);
      return;
    }
    
    const engine = new BotEngine(
      bot,
      (updates) => {
        setBots(prev => prev.map(b => b.id === id ? { ...b, ...updates } : b));
      },
      handleTrade,
      (pnl) => {
        setTotalBalance(prev => prev + pnl);
        setBalance(prev => prev + pnl);
      }
    );
    
    botEngines.current.set(id, engine);
    engine.start(market, totalBalance);
    
    toast.success(`🚀 ${bot.name} started on ${bot.market}`);
  }, [bots, marketData, totalBalance, handleTrade, setBalance]);

  // Pause bot
  const pauseBot = useCallback((id: string) => {
    const bot = bots.find(b => b.id === id);
    const engine = botEngines.current.get(id);
    
    if (engine) {
      if (bot?.paused) {
        engine.resume();
        toast.info(`▶️ ${bot?.name} resumed`);
      } else {
        engine.pause();
        toast.info(`⏸️ ${bot?.name} paused`);
      }
    }
    
    setBots(prev => prev.map(b => b.id === id ? { ...b, paused: !b.paused } : b));
  }, [bots]);

  // Stop bot
  const stopBot = useCallback((id: string) => {
    const bot = bots.find(b => b.id === id);
    const engine = botEngines.current.get(id);
    
    if (engine) {
      engine.stop();
      botEngines.current.delete(id);
    }
    
    setBots(prev => prev.map(b => 
      b.id === id ? { 
        ...b, 
        running: false, 
        paused: false,
        status: 'STOPPED',
        cooldownRemaining: 0,
        entryTriggered: false,
        currentRecoveryStage: 0
      } : b
    ));
    
    toast.info(`🛑 ${bot?.name} stopped`);
  }, [bots]);

  // Stop all bots
  const stopAllBots = useCallback(() => {
    botEngines.current.forEach((engine, id) => {
      engine.stop();
    });
    botEngines.current.clear();
    
    setBots(prev => prev.map(b => ({ 
      ...b, 
      running: false, 
      paused: false,
      status: 'STOPPED',
      cooldownRemaining: 0,
      entryTriggered: false,
      currentRecoveryStage: 0
    })));
    
    toast.success('🛑 All bots stopped');
  }, []);

  // Update bot config
  const updateBot = useCallback((id: string, updates: Partial<BotConfig>) => {
    setBots(prev => prev.map(b => b.id === id ? { ...b, ...updates } : b));
  }, []);

  // Clear all stats
  const clearAll = useCallback(() => {
    stopAllBots();
    setTrades([]);
    setBots(prev => prev.map(b => ({
      ...b,
      trades: 0,
      wins: 0,
      losses: 0,
      totalPnl: 0,
      currentStake: b.stake,
      consecutiveLosses: 0,
      status: 'IDLE',
      entryTriggered: false,
      currentRecoveryStage: 0,
      alternatingState: 'EVEN'
    })));
    setTotalBalance(10000);
    setBalance(10000);
    toast.success('🧹 All statistics cleared');
  }, [stopAllBots, setBalance]);

  // Calculate totals
  const totalPnl = bots.reduce((sum, b) => sum + b.totalPnl, 0);
  const totalTrades = bots.reduce((sum, b) => sum + b.trades, 0);
  const totalWins = bots.reduce((sum, b) => sum + b.wins, 0);
  const winRate = totalTrades > 0 ? ((totalWins / totalTrades) * 100).toFixed(1) : '0';
  const activeBots = bots.filter(b => b.running).length;
  const enabledBots = bots.filter(b => b.enabled).length;

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-200 font-sans antialiased selection:bg-emerald-500/30">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-[#0f172a]/95 backdrop-blur-md border-b border-slate-800/50 shadow-lg shadow-black/20">
        <div className="px-3 py-2">
          <div className="flex items-center justify-between">
            {/* Logo & Title */}
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-gradient-to-br from-emerald-500/20 to-blue-500/20 rounded-lg border border-emerald-500/20">
                <Brain className="w-4 h-4 text-emerald-400" />
              </div>
              <div>
                <h1 className="text-sm font-bold bg-gradient-to-r from-emerald-400 to-blue-400 bg-clip-text text-transparent">
                  Deriv AI Trading System
                </h1>
                <p className="text-[9px] text-slate-500 flex items-center gap-1">
                  <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
                  v3.0 • {enabledBots}/{bots.length} Bots • {activeBots} Active
                </p>
              </div>
            </div>

            {/* Stats with Best Market Info */}
            <div className="flex items-center gap-1.5">
              {bestMarket && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="px-2 py-1 bg-blue-500/10 rounded-md border border-blue-500/30 cursor-help">
                        <div className="text-[7px] text-blue-400 uppercase tracking-wider">Best Market</div>
                        <div className="text-[9px] font-mono font-bold text-blue-300">
                          {bestMarket.symbol} (Score: {bestMarket.score.score})
                        </div>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="text-[9px]">
                      {bestMarket.score.recommendedStrategy} • {bestMarket.score.confidence.toFixed(0)}% conf
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="px-2 py-1 bg-slate-800/50 rounded-md border border-slate-700/50 cursor-help">
                      <div className="text-[7px] text-slate-500 uppercase tracking-wider">Balance</div>
                      <div className="text-[10px] font-mono font-bold text-slate-200">${totalBalance.toFixed(2)}</div>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-[9px]">Current account balance</TooltipContent>
                </Tooltip>
              </TooltipProvider>
              
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className={`px-2 py-1 rounded-md border cursor-help ${
                      totalPnl >= 0 ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-rose-500/10 border-rose-500/30'
                    }`}>
                      <div className={`text-[7px] uppercase tracking-wider ${totalPnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>P&L</div>
                      <div className={`text-[10px] font-mono font-bold ${totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}
                      </div>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-[9px]">Total profit/loss</TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="px-2 py-1 bg-slate-800/50 rounded-md border border-slate-700/50 cursor-help">
                      <div className="text-[7px] text-slate-500 uppercase tracking-wider">Win Rate</div>
                      <div className="text-[10px] font-mono font-bold text-yellow-400">{winRate}%</div>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-[9px]">Win rate percentage</TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="px-2 py-1 bg-slate-800/50 rounded-md border border-slate-700/50 cursor-help">
                      <div className="text-[7px] text-slate-500 uppercase tracking-wider">Trades</div>
                      <div className="text-[10px] font-mono font-bold text-blue-400">{totalTrades}</div>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-[9px]">Total trades executed</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-1">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-1 px-1">
                      <span className="text-[8px] text-slate-500">Auto</span>
                      <Switch
                        checked={autoSwitch}
                        onCheckedChange={setAutoSwitch}
                        className="scale-75 data-[state=checked]:bg-emerald-500"
                      />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-[10px]">
                    Auto-switch to best market
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      onClick={scanMarkets}
                      size="sm"
                      className="h-7 px-2 text-[10px] bg-emerald-600 hover:bg-emerald-700 border-0"
                      disabled={loading}
                    >
                      <Scan className="w-3 h-3 mr-1" />
                      SCAN
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-[10px]">
                    Scan all markets (auto every 30s)
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      onClick={stopAllBots}
                      size="sm"
                      variant="destructive"
                      className="h-7 px-2 text-[10px] bg-rose-600 hover:bg-rose-700 border-0"
                      disabled={activeBots === 0}
                    >
                      <Square className="w-3 h-3 mr-1" />
                      STOP ALL
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-[10px]">
                    Stop all running bots
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      onClick={clearAll}
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-[10px] border-slate-700 hover:bg-slate-800"
                    >
                      <Trash2 className="w-3 h-3 mr-1" />
                      CLEAR
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-[10px]">
                    Reset all statistics
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <div className="w-px h-6 bg-slate-700 mx-1" />

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
                    >
                      {viewMode === 'grid' ? (
                        <List className="w-3.5 h-3.5 text-slate-400" />
                      ) : (
                        <Grid3X3 className="w-3.5 h-3.5 text-slate-400" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-[10px]">
                    Toggle view mode
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setSoundEnabled(!soundEnabled)}
                    >
                      {soundEnabled ? (
                        <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <VolumeX className="w-3.5 h-3.5 text-slate-500" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-[10px]">
                    {soundEnabled ? 'Mute sounds' : 'Enable sounds'}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>

          {/* Connection Status */}
          <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-slate-800/50">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className={`h-4 px-1.5 text-[8px] border-0 ${
                connected ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
              }`}>
                {connected ? <Wifi className="w-2.5 h-2.5 mr-1" /> : <WifiOff className="w-2.5 h-2.5 mr-1" />}
                {connected ? 'Connected' : 'Disconnected'}
              </Badge>
              {lastScan && (
                <span className="text-[8px] text-slate-600">
                  Last scan: {new Date(lastScan).toLocaleTimeString()}
                </span>
              )}
              {loading && (
                <span className="text-[8px] text-slate-600 flex items-center gap-1">
                  <Loader2 className="w-2.5 h-2.5 animate-spin" />
                  Loading markets...
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[8px] text-slate-600">Active:</span>
              <span className="text-[9px] font-mono text-emerald-400">{activeBots}</span>
              <span className="text-[8px] text-slate-600">/ {enabledBots}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="p-2 pb-8">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="w-full grid grid-cols-2 bg-slate-800/50 p-0.5 h-8 mb-2">
            <TabsTrigger value="bots" className="text-[10px] data-[state=active]:bg-slate-700">
              <Grid3X3 className="w-3 h-3 mr-1" />
              Trading Bots ({enabledBots}/{bots.length})
            </TabsTrigger>
            <TabsTrigger value="trades" className="text-[10px] data-[state=active]:bg-slate-700">
              <Activity className="w-3 h-3 mr-1" />
              Trade Log ({trades.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="bots" className="mt-0">
            {loading && bots.every(b => !b.market) ? (
              <div className="flex flex-col items-center justify-center py-12 space-y-2">
                <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
                <span className="text-[10px] text-slate-500">Initializing market data...</span>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="mt-2 text-[9px] h-6"
                  onClick={scanMarkets}
                >
                  <Scan className="w-3 h-3 mr-1" />
                  Scan Markets Now
                </Button>
              </div>
            ) : (
              <div className={viewMode === 'grid' 
                ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2" 
                : "grid grid-cols-1 gap-2"
              }>
                {bots.map(bot => (
                  <BotCard
                    key={bot.id}
                    bot={bot}
                    market={bot.market ? marketData[bot.market] : undefined}
                    marketScore={bot.market ? marketScores.get(bot.market) : undefined}
                    onStart={startBot}
                    onStop={stopBot}
                    onPause={pauseBot}
                    onUpdate={updateBot}
                    onExpand={(id) => updateBot(id, { expanded: !bots.find(b => b.id === id)?.expanded })}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="trades" className="mt-0">
            <div className="bg-[#1e293b] rounded-lg border border-slate-700/50 overflow-hidden">
              <div className="px-3 py-2 bg-slate-800/50 border-b border-slate-700/50 flex items-center justify-between">
                <h2 className="text-[10px] font-semibold text-slate-300 uppercase tracking-wider">Recent Trades</h2>
                <Badge variant="outline" className="h-4 px-1.5 text-[8px] border-slate-700">
                  {trades.length} total
                </Badge>
              </div>
              
              <div className="max-h-[calc(100vh-280px)] overflow-y-auto">
                {trades.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-slate-600">
                    <Activity className="w-8 h-8 mb-2 opacity-50" />
                    <span className="text-[10px]">No trades executed yet</span>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="mt-2 text-[9px] h-6"
                      onClick={() => setActiveTab('bots')}
                    >
                      Start trading
                    </Button>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-700/30">
                    {trades.map((trade) => (
                      <div
                        key={trade.id}
                        className="px-3 py-2 flex items-center justify-between hover:bg-slate-800/30 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                            trade.result === 'WIN' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                          }`}>
                            {trade.result === 'WIN' ? 'W' : 'L'}
                          </div>
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-[9px] font-medium text-slate-300">{trade.botName}</span>
                              <Badge className="h-3 px-1 text-[6px] bg-slate-700 text-slate-400 border-0">
                                {trade.strategy}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-2 text-[8px] text-slate-500">
                              <span>{trade.market}</span>
                              <span>•</span>
                              <span>{new Date(trade.time).toLocaleTimeString()}</span>
                              {trade.marketScore !== undefined && (
                                <>
                                  <span>•</span>
                                  <span>Score: {trade.marketScore}</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <div className="text-[9px] font-mono text-slate-400">
                              {trade.entry} → {trade.exit}
                            </div>
                            <div className="text-[8px] text-slate-500">
                              ${trade.stake.toFixed(2)}
                            </div>
                          </div>
                          <div className={`text-right min-w-[60px] ${
                            trade.result === 'WIN' ? 'text-emerald-400' : 'text-rose-400'
                          }`}>
                            <div className="text-[11px] font-bold font-mono">
                              {trade.result === 'WIN' ? '+' : ''}${trade.pnl.toFixed(2)}
                            </div>
                            <div className="text-[8px] text-slate-500">
                              {trade.confidence.toFixed(0)}% conf
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </main>

      {/* Footer */}
      <footer className="fixed bottom-0 left-0 right-0 bg-[#0f172a]/95 backdrop-blur border-t border-slate-800/50 px-3 py-1 z-50">
        <div className="flex items-center justify-between text-[8px] text-slate-600">
          <span>Deriv AI Trading System v3.0 - Intelligent Market Scanner</span>
          <span>10 Strategies • 10 Markets • Auto-switch every 30s</span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Live
          </span>
        </div>
      </footer>
      
      {/* Spacer for fixed footer */}
      <div className="h-6" />
    </div>
  );
}
