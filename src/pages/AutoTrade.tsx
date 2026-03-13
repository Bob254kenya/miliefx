import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { derivApi } from '@/services/deriv-api';
import { useAuth } from '@/contexts/AuthContext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Play, StopCircle, Pause, TrendingUp, TrendingDown, 
  CircleDot, RefreshCw, Trash2, Zap, Activity, BarChart3, 
  LineChart, PieChart, Globe, Bell, Target, Award, Layers, 
  GitCompare, AlertTriangle, CheckCircle, XCircle, Clock,
  ArrowUp, ArrowDown, Minus, Maximize2, Minimize2
} from 'lucide-react';

// ==================== TYPES ====================

interface DigitAnalysis {
  counts: Record<number, number>;
  percentages: Record<number, number>;
  mostAppearing: number;
  secondMost: number;
  thirdMost: number;
  leastAppearing: number;
  secondLeast: number;
  evenCount: number;
  oddCount: number;
  evenPercentage: number;
  oddPercentage: number;
  over3Percentage: number;
  under6Percentage: number;
  over5Percentage: number;
  under5Percentage: number;
  over7Percentage: number;
  under7Percentage: number;
  lastTwelveTicks: number[];
  lastThreeTicks: number[];
  lastTwoTicks: number[];
  lastThreeIdentical: boolean;
  digitImbalance: number;
  clusterDetected: boolean;
  momentum: 'increasing' | 'decreasing' | 'stable';
  signal: 'OVER_3' | 'UNDER_8' | 'EVEN' | 'ODD' | 'NONE';
  signalStrength: 'STRONG' | 'MEDIUM' | 'WEAK' | 'NONE';
  confidence: number;
}

interface MarketData {
  symbol: string;
  displayName: string;
  category: 'volatility' | 'jump' | 'bear' | 'bull' | 'R';
  digits: number[];
  analysis: DigitAnalysis;
  lastUpdate: number;
  tickRate: number;
  signalAvailable: boolean;
}

interface BotState {
  id: string;
  name: string;
  type: 'OVER_3' | 'UNDER_8' | 'EVEN' | 'ODD';
  isRunning: boolean;
  isPaused: boolean;
  currentStake: number;
  totalPnl: number;
  trades: number;
  wins: number;
  losses: number;
  currentMarket: string;
  status: 'idle' | 'scanning' | 'waiting_entry' | 'trading' | 'recovery' | 'cooldown' | 'switching';
  consecutiveLosses: number;
  cooldownRemaining: number;
  lastTradeResult?: 'win' | 'loss';
  marketSwitchCount: number;
  lastSignal?: string;
  signalStrength: number;
  tradesRemaining: number;
  maxTrades: number;
  inRecovery: boolean;
  recoveryFrom?: string;
  entryCondition: string;
}

interface TradeLog {
  id: number;
  time: string;
  market: string;
  contract: string;
  stake: number;
  result: 'Win' | 'Loss' | 'Pending';
  pnl: number;
  bot: string;
  botId: string;
  lastDigit?: number;
  entryPattern?: string;
  recoveryNote?: string;
}

interface MarketSignal {
  market: string;
  signal: string;
  strength: 'STRONG' | 'MEDIUM' | 'WEAK';
  confidence: number;
  mostAppearing: number;
  secondMost: number;
  leastAppearing: number;
  over3Pct: number;
  evenPct: number;
  oddPct: number;
}

// ==================== CONSTANTS ====================

const VOLATILITY_MARKETS = [
  // Volatility 1s indices
  { symbol: '1HZ10V', name: 'Volatility 10 (1s)', category: 'volatility' },
  { symbol: '1HZ25V', name: 'Volatility 25 (1s)', category: 'volatility' },
  { symbol: '1HZ50V', name: 'Volatility 50 (1s)', category: 'volatility' },
  { symbol: '1HZ75V', name: 'Volatility 75 (1s)', category: 'volatility' },
  { symbol: '1HZ90V', name: 'Volatility 90 (1s)', category: 'volatility' },
  { symbol: '1HZ100V', name: 'Volatility 100 (1s)', category: 'volatility' },
  
  // Standard Volatility
  { symbol: 'R_10', name: 'Volatility 10', category: 'R' },
  { symbol: 'R_25', name: 'Volatility 25', category: 'R' },
  { symbol: 'R_50', name: 'Volatility 50', category: 'R' },
  { symbol: 'R_75', name: 'Volatility 75', category: 'R' },
  { symbol: 'R_100', name: 'Volatility 100', category: 'R' },
  
  // Jump indices
  { symbol: 'JD10', name: 'Jump 10', category: 'jump' },
  { symbol: 'JD25', name: 'Jump 25', category: 'jump' },
  { symbol: 'JD50', name: 'Jump 50', category: 'jump' },
  { symbol: 'JD75', name: 'Jump 75', category: 'jump' },
  { symbol: 'JD100', name: 'Jump 100', category: 'jump' },
  
  // Boom & Crash
  { symbol: 'BOOM300', name: 'Boom 300', category: 'bull' },
  { symbol: 'BOOM500', name: 'Boom 500', category: 'bull' },
  { symbol: 'BOOM1000', name: 'Boom 1000', category: 'bull' },
  { symbol: 'CRASH300', name: 'Crash 300', category: 'bear' },
  { symbol: 'CRASH500', name: 'Crash 500', category: 'bear' },
  { symbol: 'CRASH1000', name: 'Crash 1000', category: 'bear' },
  
  // Bear/Bull
  { symbol: 'RDBEAR', name: 'Bear Market', category: 'bear' },
  { symbol: 'RDBULL', name: 'Bull Market', category: 'bull' },
];

const TICK_HISTORY_SIZE = 1000;
const ANALYSIS_TICKS = 700;

// ==================== UTILITY FUNCTIONS ====================

// Advanced digit analysis with all required metrics
const analyzeDigits = (digits: number[]): DigitAnalysis => {
  if (digits.length < ANALYSIS_TICKS) {
    return {
      counts: {},
      percentages: {},
      mostAppearing: -1,
      secondMost: -1,
      thirdMost: -1,
      leastAppearing: -1,
      secondLeast: -1,
      evenCount: 0,
      oddCount: 0,
      evenPercentage: 0,
      oddPercentage: 0,
      over3Percentage: 0,
      under6Percentage: 0,
      over5Percentage: 0,
      under5Percentage: 0,
      over7Percentage: 0,
      under7Percentage: 0,
      lastTwelveTicks: [],
      lastThreeTicks: [],
      lastTwoTicks: [],
      lastThreeIdentical: false,
      digitImbalance: 0,
      clusterDetected: false,
      momentum: 'stable',
      signal: 'NONE',
      signalStrength: 'NONE',
      confidence: 0
    };
  }

  const last700 = digits.slice(-ANALYSIS_TICKS);
  const lastTwelve = digits.slice(-12);
  const lastThree = digits.slice(-3);
  const lastTwo = digits.slice(-2);
  const lastThreeIdentical = lastThree.length === 3 && lastThree.every(d => d === lastThree[0]);
  
  // Count frequencies
  const counts: Record<number, number> = {};
  for (let i = 0; i <= 9; i++) counts[i] = 0;
  last700.forEach(d => counts[d]++);
  
  // Calculate percentages
  const percentages: Record<number, number> = {};
  for (let i = 0; i <= 9; i++) {
    percentages[i] = (counts[i] / ANALYSIS_TICKS) * 100;
  }
  
  // Sort digits
  const sortedByCount = [...Array(10).keys()].sort((a, b) => counts[b] - counts[a]);
  const sortedByLeast = [...Array(10).keys()].sort((a, b) => counts[a] - counts[b]);
  
  const mostAppearing = sortedByCount[0];
  const secondMost = sortedByCount[1];
  const thirdMost = sortedByCount[2];
  const leastAppearing = sortedByCount[9];
  const secondLeast = sortedByLeast[1];
  
  // Calculate group counts and percentages
  const evenDigits = [0,2,4,6,8];
  const oddDigits = [1,3,5,7,9];
  const over3Digits = [4,5,6,7,8,9];
  const under6Digits = [0,1,2,3,4,5];
  const over5Digits = [6,7,8,9];
  const under5Digits = [0,1,2,3,4];
  const over7Digits = [8,9];
  const under7Digits = [0,1,2,3,4,5,6];
  
  const evenCount = evenDigits.reduce((sum, d) => sum + counts[d], 0);
  const oddCount = oddDigits.reduce((sum, d) => sum + counts[d], 0);
  const over3Count = over3Digits.reduce((sum, d) => sum + counts[d], 0);
  const under6Count = under6Digits.reduce((sum, d) => sum + counts[d], 0);
  const over5Count = over5Digits.reduce((sum, d) => sum + counts[d], 0);
  const under5Count = under5Digits.reduce((sum, d) => sum + counts[d], 0);
  const over7Count = over7Digits.reduce((sum, d) => sum + counts[d], 0);
  const under7Count = under7Digits.reduce((sum, d) => sum + counts[d], 0);
  
  const evenPercentage = (evenCount / ANALYSIS_TICKS) * 100;
  const oddPercentage = (oddCount / ANALYSIS_TICKS) * 100;
  const over3Percentage = (over3Count / ANALYSIS_TICKS) * 100;
  const under6Percentage = (under6Count / ANALYSIS_TICKS) * 100;
  const over5Percentage = (over5Count / ANALYSIS_TICKS) * 100;
  const under5Percentage = (under5Count / ANALYSIS_TICKS) * 100;
  const over7Percentage = (over7Count / ANALYSIS_TICKS) * 100;
  const under7Percentage = (under7Count / ANALYSIS_TICKS) * 100;
  
  // Calculate digit imbalance (variance from uniform distribution)
  const uniformPercentage = 10;
  const imbalance = Object.values(percentages).reduce(
    (sum, pct) => sum + Math.abs(pct - uniformPercentage), 0
  ) / 10;
  
  // Detect clusters (consecutive same parity)
  let clusterDetected = false;
  for (let i = 0; i < lastTwelve.length - 2; i++) {
    if (lastTwelve[i] % 2 === lastTwelve[i + 1] % 2 && 
        lastTwelve[i] % 2 === lastTwelve[i + 2] % 2) {
      clusterDetected = true;
      break;
    }
  }
  
  // Calculate momentum (comparing recent vs older)
  const recent200 = last700.slice(-200);
  const older200 = last700.slice(-400, -200);
  const recentOver3 = recent200.filter(d => d > 3).length / 2;
  const olderOver3 = older200.filter(d => d > 3).length / 2;
  const momentum = recentOver3 > olderOver3 ? 'increasing' : recentOver3 < olderOver3 ? 'decreasing' : 'stable';
  
  // Determine signal based on bot conditions
  let signal: 'OVER_3' | 'UNDER_8' | 'EVEN' | 'ODD' | 'NONE' = 'NONE';
  let signalStrength: 'STRONG' | 'MEDIUM' | 'WEAK' | 'NONE' = 'NONE';
  let confidence = 0;
  
  // Check OVER 3 conditions
  if (mostAppearing > 3 && secondMost > 3 && over3Percentage > 55 && momentum === 'increasing') {
    signal = 'OVER_3';
    confidence = over3Percentage;
    signalStrength = over3Percentage > 65 ? 'STRONG' : over3Percentage > 55 ? 'MEDIUM' : 'WEAK';
  }
  // Check UNDER 8 conditions
  else if (mostAppearing < 6 && secondMost < 6 && leastAppearing < 6 && under6Percentage > 55) {
    signal = 'UNDER_8';
    confidence = under6Percentage;
    signalStrength = under6Percentage > 65 ? 'STRONG' : under6Percentage > 55 ? 'MEDIUM' : 'WEAK';
  }
  // Check EVEN conditions
  else if (mostAppearing % 2 === 0 && secondMost % 2 === 0 && thirdMost % 2 === 0 && leastAppearing % 2 === 0) {
    signal = 'EVEN';
    confidence = evenPercentage;
    signalStrength = evenPercentage > 60 ? 'STRONG' : evenPercentage > 52 ? 'MEDIUM' : 'WEAK';
  }
  // Check ODD conditions
  else if (mostAppearing % 2 === 1 && secondMost % 2 === 1 && thirdMost % 2 === 1 && leastAppearing % 2 === 1) {
    signal = 'ODD';
    confidence = oddPercentage;
    signalStrength = oddPercentage > 60 ? 'STRONG' : oddPercentage > 52 ? 'MEDIUM' : 'WEAK';
  }
  
  return {
    counts,
    percentages,
    mostAppearing,
    secondMost,
    thirdMost,
    leastAppearing,
    secondLeast,
    evenCount,
    oddCount,
    evenPercentage,
    oddPercentage,
    over3Percentage,
    under6Percentage,
    over5Percentage,
    under5Percentage,
    over7Percentage,
    under7Percentage,
    lastTwelveTicks: lastTwelve,
    lastThreeTicks: lastThree,
    lastTwoTicks: lastTwo,
    lastThreeIdentical,
    digitImbalance: imbalance,
    clusterDetected,
    momentum,
    signal,
    signalStrength,
    confidence
  };
};

// Generate mock ticks for development (in production, this comes from WebSocket)
const generateInitialTicks = (market: string, count: number): number[] => {
  const ticks: number[] = [];
  let bias = 0;
  
  // Create market-specific biases
  if (market.includes('BOOM')) bias = 2; // Boom tends higher
  else if (market.includes('CRASH')) bias = -2; // Crash tends lower
  else if (market.includes('RDBEAR')) bias = -1;
  else if (market.includes('RDBULL')) bias = 1;
  else if (market.includes('JD')) bias = (Math.random() - 0.5) * 2;
  
  for (let i = 0; i < count; i++) {
    let digit = Math.floor(Math.random() * 10) + bias;
    digit = Math.max(0, Math.min(9, digit));
    ticks.push(digit);
  }
  return ticks;
};

// ==================== MAIN COMPONENT ====================

export default function AutoTrade() {
  const { isAuthorized, activeAccount, balance } = useAuth();
  const [marketsData, setMarketsData] = useState<Record<string, MarketData>>({});
  const [bestSignals, setBestSignals] = useState<Record<string, MarketSignal>>({});
  const [isScanning, setIsScanning] = useState(false);
  const [globalStake, setGlobalStake] = useState(0.5);
  const [globalMultiplier, setGlobalMultiplier] = useState(2);
  const [globalStopLoss, setGlobalStopLoss] = useState(30);
  const [globalTakeProfit, setGlobalTakeProfit] = useState(5);
  const [lastScanTime, setLastScanTime] = useState<Date | null>(null);
  const [trades, setTrades] = useState<TradeLog[]>([]);
  const [expandedMarket, setExpandedMarket] = useState<string | null>(null);
  const [autoScan, setAutoScan] = useState(true);
  
  const tradeIdRef = useRef(0);
  const marketDigitsRef = useRef<Record<string, number[]>>({});
  const wsSubscriptionsRef = useRef<Record<string, boolean>>({});
  const analysisIntervalRef = useRef<NodeJS.Timeout>();
  const botIntervalsRef = useRef<Record<string, NodeJS.Timeout>>({});
  const tickSimulationRef = useRef<NodeJS.Timeout>();

  // Initialize bots with all required properties
  const [bots, setBots] = useState<BotState[]>([
    {
      id: 'bot1', name: 'OVER 3 BOT', type: 'OVER_3',
      isRunning: false, isPaused: false, currentStake: 0.5,
      totalPnl: 0, trades: 0, wins: 0, losses: 0,
      currentMarket: '', status: 'idle', consecutiveLosses: 0,
      cooldownRemaining: 0, marketSwitchCount: 0, signalStrength: 0,
      tradesRemaining: 3, maxTrades: 3, inRecovery: false,
      entryCondition: 'Wait for 2 consecutive digits BELOW 3'
    },
    {
      id: 'bot2', name: 'UNDER 8 BOT', type: 'UNDER_8',
      isRunning: false, isPaused: false, currentStake: 0.5,
      totalPnl: 0, trades: 0, wins: 0, losses: 0,
      currentMarket: '', status: 'idle', consecutiveLosses: 0,
      cooldownRemaining: 0, marketSwitchCount: 0, signalStrength: 0,
      tradesRemaining: 3, maxTrades: 3, inRecovery: false,
      recoveryFrom: 'UNDER_6',
      entryCondition: 'Wait for 2 consecutive digits ABOVE 6'
    },
    {
      id: 'bot3', name: 'EVEN BOT', type: 'EVEN',
      isRunning: false, isPaused: false, currentStake: 0.5,
      totalPnl: 0, trades: 0, wins: 0, losses: 0,
      currentMarket: '', status: 'idle', consecutiveLosses: 0,
      cooldownRemaining: 0, marketSwitchCount: 0, signalStrength: 0,
      tradesRemaining: 2, maxTrades: 2, inRecovery: false,
      entryCondition: 'Wait for 3 consecutive ODD digits'
    },
    {
      id: 'bot4', name: 'ODD BOT', type: 'ODD',
      isRunning: false, isPaused: false, currentStake: 0.5,
      totalPnl: 0, trades: 0, wins: 0, losses: 0,
      currentMarket: '', status: 'idle', consecutiveLosses: 0,
      cooldownRemaining: 0, marketSwitchCount: 0, signalStrength: 0,
      tradesRemaining: 2, maxTrades: 2, inRecovery: false,
      entryCondition: 'Wait for 3 consecutive EVEN digits'
    }
  ]);

  const botRunningRefs = useRef<Record<string, boolean>>({});
  const botPausedRefs = useRef<Record<string, boolean>>({});

  // ==================== INITIALIZATION ====================

  useEffect(() => {
    // Initialize market data with mock ticks
    VOLATILITY_MARKETS.forEach(market => {
      if (!marketDigitsRef.current[market.symbol]) {
        marketDigitsRef.current[market.symbol] = generateInitialTicks(market.symbol, TICK_HISTORY_SIZE);
      }
    });
    
    // Start continuous scanning
    scanAllMarkets();
    
    // Simulate tick updates every 2 seconds (in production, this would be WebSocket)
    tickSimulationRef.current = setInterval(() => {
      simulateNewTicks();
    }, 2000);
    
    return () => {
      if (tickSimulationRef.current) clearInterval(tickSimulationRef.current);
      if (analysisIntervalRef.current) clearInterval(analysisIntervalRef.current);
      Object.values(botIntervalsRef.current).forEach(clearInterval);
    };
  }, []);

  // Auto-scan every 10 seconds
  useEffect(() => {
    if (autoScan) {
      analysisIntervalRef.current = setInterval(() => {
        scanAllMarkets();
      }, 10000);
    }
    return () => {
      if (analysisIntervalRef.current) clearInterval(analysisIntervalRef.current);
    };
  }, [autoScan]);

  // ==================== MARKET SCANNING ====================

  const simulateNewTicks = useCallback(() => {
    // Add a new random tick to each market
    Object.keys(marketDigitsRef.current).forEach(symbol => {
      const ticks = marketDigitsRef.current[symbol];
      const lastDigit = ticks[ticks.length - 1];
      
      // Generate new digit with some correlation to previous
      let newDigit = lastDigit + (Math.random() > 0.7 ? (Math.random() > 0.5 ? 1 : -1) : 0);
      newDigit = Math.max(0, Math.min(9, Math.round(newDigit)));
      
      ticks.push(newDigit);
      if (ticks.length > TICK_HISTORY_SIZE) {
        ticks.shift();
      }
    });
    
    // Rescan all markets
    scanAllMarkets();
  }, []);

  const scanAllMarkets = useCallback(() => {
    setIsScanning(true);
    
    const newMarketsData: Record<string, MarketData> = {};
    const signals: Record<string, MarketSignal> = {};
    
    VOLATILITY_MARKETS.forEach(market => {
      const ticks = marketDigitsRef.current[market.symbol] || [];
      if (ticks.length >= ANALYSIS_TICKS) {
        const analysis = analyzeDigits(ticks);
        
        newMarketsData[market.symbol] = {
          ...market,
          digits: ticks.slice(-100),
          analysis,
          lastUpdate: Date.now(),
          tickRate: 1000 / 2, // Simulated
          signalAvailable: analysis.signal !== 'NONE'
        };
        
        // Store best signal for each type
        if (analysis.signal !== 'NONE') {
          signals[analysis.signal] = {
            market: market.symbol,
            signal: analysis.signal,
            strength: analysis.signalStrength,
            confidence: analysis.confidence,
            mostAppearing: analysis.mostAppearing,
            secondMost: analysis.secondMost,
            leastAppearing: analysis.leastAppearing,
            over3Pct: analysis.over3Percentage,
            evenPct: analysis.evenPercentage,
            oddPct: analysis.oddPercentage
          };
        }
      }
    });
    
    setMarketsData(newMarketsData);
    setBestSignals(signals);
    setLastScanTime(new Date());
    
    // Auto-select markets for bots
    updateBotMarkets(signals);
    
    setIsScanning(false);
  }, []);

  const updateBotMarkets = useCallback((signals: Record<string, MarketSignal>) => {
    setBots(prev => prev.map(bot => {
      const signal = signals[bot.type];
      if (signal && signal.market !== bot.currentMarket) {
        return {
          ...bot,
          currentMarket: signal.market,
          marketSwitchCount: bot.marketSwitchCount + 1,
          lastSignal: signal.signal,
          signalStrength: signal.confidence
        };
      } else if (!signal && bot.currentMarket) {
        // Signal lost, stop bot if running
        if (bot.isRunning) {
          toast.warning(`${bot.name}: Signal lost, stopping bot`);
          stopBot(bot.id);
        }
        return { ...bot, currentMarket: '', lastSignal: undefined, signalStrength: 0 };
      }
      return bot;
    }));
  }, []);

  // ==================== ENTRY CONDITIONS ====================

  const checkEntryCondition = (botType: string, analysis: DigitAnalysis): boolean => {
    switch (botType) {
      case 'OVER_3':
        return analysis.lastTwoTicks.length === 2 && 
               analysis.lastTwoTicks.every(d => d < 3);
      
      case 'UNDER_8':
        return analysis.lastTwoTicks.length === 2 && 
               analysis.lastTwoTicks.every(d => d > 6);
      
      case 'EVEN':
        return analysis.lastThreeTicks.length === 3 && 
               analysis.lastThreeTicks.every(d => d % 2 === 1);
      
      case 'ODD':
        return analysis.lastThreeTicks.length === 3 && 
               analysis.lastThreeTicks.every(d => d % 2 === 0);
      
      default:
        return false;
    }
  };

  // ==================== TRADING LOGIC ====================

  const executeTrade = useCallback(async (botId: string) => {
    const bot = bots.find(b => b.id === botId);
    if (!bot || !bot.isRunning || bot.isPaused) return;

    // Check stop loss / take profit
    if (bot.totalPnl <= -globalStopLoss) {
      toast.error(`${bot.name}: Stop Loss reached! Stopping bot.`);
      stopBot(botId);
      return;
    }
    if (bot.totalPnl >= globalTakeProfit) {
      toast.success(`${bot.name}: Take Profit reached! Stopping bot.`);
      stopBot(botId);
      return;
    }

    // Check if bot has a market
    if (!bot.currentMarket) {
      const signal = bestSignals[bot.type];
      if (signal) {
        setBots(prev => prev.map(b => 
          b.id === botId ? { ...b, currentMarket: signal.market } : b
        ));
      }
      return;
    }

    const marketData = marketsData[bot.currentMarket];
    if (!marketData) return;

    const analysis = marketData.analysis;
    const shouldTrade = checkEntryCondition(bot.type, analysis);

    if (!shouldTrade) {
      setBots(prev => prev.map(b => 
        b.id === botId ? { ...b, status: 'waiting_entry' } : b
      ));
      return;
    }

    // Check if bot has reached max trades and not in recovery
    if (!bot.inRecovery && bot.tradesRemaining <= 0) {
      if (bot.totalPnl > 0) {
        toast.success(`${bot.name}: Completed ${bot.maxTrades} winning trades, stopping.`);
        stopBot(botId);
      } else {
        // Enter recovery mode
        setBots(prev => prev.map(b => 
          b.id === botId ? { ...b, inRecovery: true, tradesRemaining: 999 } : b
        ));
      }
      return;
    }

    setBots(prev => prev.map(b => 
      b.id === botId ? { ...b, status: 'trading' } : b
    ));

    // Determine contract type
    let contract = '';
    let barrier: number | undefined;
    
    if (bot.type === 'OVER_3') {
      contract = 'DIGITOVER';
      barrier = 3;
    } else if (bot.type === 'UNDER_8') {
      contract = bot.inRecovery ? 'DIGITUNDER' : 'DIGITUNDER';
      barrier = bot.inRecovery ? 6 : 8;
    } else if (bot.type === 'EVEN') {
      contract = 'DIGITEVEN';
    } else if (bot.type === 'ODD') {
      contract = 'DIGITODD';
    }

    // Simulate trade
    const id = ++tradeIdRef.current;
    const now = new Date().toLocaleTimeString();
    const won = Math.random() > 0.4; // 60% win rate for demo
    const pnl = won ? bot.currentStake * 0.95 : -bot.currentStake;

    // Create entry pattern description
    let entryPattern = '';
    if (bot.type === 'OVER_3') entryPattern = `${analysis.lastTwoTicks.join(',')} → OVER 3`;
    else if (bot.type === 'UNDER_8') entryPattern = `${analysis.lastTwoTicks.join(',')} → UNDER ${bot.inRecovery ? '6' : '8'}`;
    else if (bot.type === 'EVEN') entryPattern = `${analysis.lastThreeTicks.join(',')} → EVEN`;
    else if (bot.type === 'ODD') entryPattern = `${analysis.lastThreeTicks.join(',')} → ODD`;

    const trade: TradeLog = {
      id,
      time: now,
      market: bot.currentMarket,
      contract,
      stake: bot.currentStake,
      result: won ? 'Win' : 'Loss',
      pnl,
      bot: bot.name,
      botId: bot.id,
      lastDigit: analysis.lastThreeTicks[analysis.lastThreeTicks.length - 1],
      entryPattern,
      recoveryNote: bot.inRecovery ? 'Recovery mode' : undefined
    };

    setTrades(prev => [trade, ...prev].slice(0, 100));

    // Update bot stats
    setBots(prev => prev.map(b => {
      if (b.id === botId) {
        const newStake = won 
          ? globalStake
          : Math.round(b.currentStake * globalMultiplier * 100) / 100;
        
        const newTradesRemaining = b.inRecovery 
          ? b.tradesRemaining 
          : b.tradesRemaining - 1;
        
        return {
          ...b,
          totalPnl: b.totalPnl + pnl,
          trades: b.trades + 1,
          wins: b.wins + (won ? 1 : 0),
          losses: b.losses + (won ? 0 : 1),
          currentStake: newStake,
          consecutiveLosses: won ? 0 : b.consecutiveLosses + 1,
          lastTradeResult: won ? 'win' : 'loss',
          status: 'cooldown',
          cooldownRemaining: 3,
          tradesRemaining: newTradesRemaining
        };
      }
      return b;
    }));

    // Show notification
    if (won) {
      toast.success(`${bot.name} won $${pnl.toFixed(2)}`, {
        description: `${entryPattern} | #${id}`,
      });
    } else {
      toast.error(`${bot.name} lost $${Math.abs(pnl).toFixed(2)}`, {
        description: `${entryPattern} | #${id}`,
      });
    }

    // Cooldown countdown
    const cooldownInterval = setInterval(() => {
      setBots(prev => prev.map(b => {
        if (b.id === botId && b.cooldownRemaining > 0) {
          const newCooldown = b.cooldownRemaining - 1;
          return {
            ...b,
            cooldownRemaining: newCooldown,
            status: newCooldown === 0 ? 'waiting_entry' : 'cooldown'
          };
        }
        return b;
      }));
    }, 1000);

    setTimeout(() => clearInterval(cooldownInterval), 3000);

  }, [bots, marketsData, bestSignals, globalStake, globalMultiplier, globalStopLoss, globalTakeProfit]);

  // ==================== BOT CONTROL ====================

  const startBot = useCallback((botId: string) => {
    const bot = bots.find(b => b.id === botId);
    if (!bot || bot.isRunning) return;
    
    // Check if there's a signal for this bot type
    const signal = bestSignals[bot.type];
    if (!signal) {
      toast.error(`No signal available for ${bot.name}`);
      return;
    }
    
    setBots(prev => prev.map(b => 
      b.id === botId ? { 
        ...b, 
        isRunning: true, 
        status: 'scanning',
        currentMarket: signal.market,
        currentStake: globalStake,
        tradesRemaining: b.maxTrades,
        inRecovery: false
      } : b
    ));
    
    botRunningRefs.current[botId] = true;
    
    // Start trading loop
    if (botIntervalsRef.current[botId]) {
      clearInterval(botIntervalsRef.current[botId]);
    }
    
    botIntervalsRef.current[botId] = setInterval(() => {
      executeTrade(botId);
    }, 4000);
    
    toast.success(`${bot.name} started on ${signal.market}`);
  }, [bots, bestSignals, globalStake, executeTrade]);

  const pauseBot = useCallback((botId: string) => {
    const bot = bots.find(b => b.id === botId);
    if (!bot) return;
    
    botPausedRefs.current[botId] = !bot.isPaused;
    setBots(prev => prev.map(b => 
      b.id === botId ? { ...b, isPaused: !b.isPaused } : b
    ));
    
    toast.info(`${bot.name} ${bot.isPaused ? 'resumed' : 'paused'}`);
  }, []);

  const stopBot = useCallback((botId: string) => {
    const bot = bots.find(b => b.id === botId);
    if (!bot) return;
    
    botRunningRefs.current[botId] = false;
    botPausedRefs.current[botId] = false;
    
    if (botIntervalsRef.current[botId]) {
      clearInterval(botIntervalsRef.current[botId]);
      delete botIntervalsRef.current[botId];
    }
    
    setBots(prev => prev.map(b => 
      b.id === botId ? { 
        ...b, 
        isRunning: false, 
        isPaused: false,
        status: 'idle',
        cooldownRemaining: 0
      } : b
    ));
    
    toast.warning(`${bot.name} stopped`);
  }, []);

  const stopAllBots = useCallback(() => {
    bots.forEach(bot => {
      if (bot.isRunning) {
        stopBot(bot.id);
      }
    });
  }, [bots, stopBot]);

  const clearAll = useCallback(() => {
    stopAllBots();
    setTrades([]);
    setBots(prev => prev.map(bot => ({
      ...bot,
      totalPnl: 0,
      trades: 0,
      wins: 0,
      losses: 0,
      currentStake: globalStake,
      status: 'idle',
      consecutiveLosses: 0,
      cooldownRemaining: 0,
      marketSwitchCount: 0,
      tradesRemaining: bot.maxTrades,
      inRecovery: false
    })));
    tradeIdRef.current = 0;
    toast.success('All data cleared');
  }, [globalStake, stopAllBots]);

  // ==================== UI HELPERS ====================

  const getSignalColor = (strength: string) => {
    switch (strength) {
      case 'STRONG': return 'text-green-400 bg-green-500/20 border-green-500/30';
      case 'MEDIUM': return 'text-yellow-400 bg-yellow-500/20 border-yellow-500/30';
      case 'WEAK': return 'text-orange-400 bg-orange-500/20 border-orange-500/30';
      default: return 'text-gray-400 bg-gray-500/20 border-gray-500/30';
    }
  };

  const getMarketIcon = (category: string) => {
    switch (category) {
      case 'volatility': return '⚡';
      case 'jump': return '🦘';
      case 'bear': return '🐻';
      case 'bull': return '🐂';
      case 'R': return '📊';
      default: return '📈';
    }
  };

  const getMarketColor = (category: string) => {
    switch (category) {
      case 'volatility': return 'text-yellow-400';
      case 'jump': return 'text-purple-400';
      case 'bear': return 'text-red-400';
      case 'bull': return 'text-green-400';
      case 'R': return 'text-blue-400';
      default: return 'text-gray-400';
    }
  };

  // Calculate totals
  const totalProfit = bots.reduce((sum, b) => sum + b.totalPnl, 0);
  const totalTrades = bots.reduce((sum, b) => sum + b.trades, 0);
  const totalWins = bots.reduce((sum, b) => sum + b.wins, 0);
  const winRate = totalTrades > 0 ? ((totalWins / totalTrades) * 100).toFixed(1) : '0';

  // ==================== RENDER ====================

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 p-6">
      {/* Background Effects */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-0 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute bottom-0 right-0 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl animate-pulse delay-1000"></div>
      </div>

      <div className="relative max-w-7xl mx-auto space-y-6">
        {/* ==================== HEADER ==================== */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="backdrop-blur-xl bg-gray-900/50 border border-gray-800/50 rounded-2xl p-6 shadow-2xl"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-blue-600 to-purple-600 rounded-2xl blur-xl opacity-50"></div>
                <div className="relative bg-gradient-to-r from-blue-600 to-purple-600 p-3 rounded-xl">
                  <Layers className="w-6 h-6 text-white" />
                </div>
              </div>
              <div>
                <h1 className="text-2xl font-bold bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
                  Deriv Smart Scanner & Auto-Trader
                </h1>
                <p className="text-sm text-gray-500 flex items-center gap-2">
                  <Globe className="w-3.5 h-3.5" />
                  <span>24/7 Market Scanner • 4 Intelligent Bots • Auto Signal Detection</span>
                  {lastScanTime && (
                    <>
                      <span className="w-1 h-1 bg-gray-600 rounded-full"></span>
                      <span>Last scan: {lastScanTime.toLocaleTimeString()}</span>
                    </>
                  )}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 mr-2">
                <span className="text-xs text-gray-500">Auto-scan</span>
                <Switch checked={autoScan} onCheckedChange={setAutoScan} />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={scanAllMarkets}
                disabled={isScanning}
                className="border-gray-700 hover:border-gray-600 bg-gray-800/50 hover:bg-gray-800 text-gray-300"
              >
                {isScanning ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4 mr-2" />
                )}
                Scan Now
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={clearAll}
                className="border-gray-700 hover:border-gray-600 bg-gray-800/50 hover:bg-gray-800 text-gray-300"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Clear
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={stopAllBots}
                disabled={!bots.some(b => b.isRunning)}
                className="bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30"
              >
                <StopCircle className="w-4 h-4 mr-2" />
                Stop All
              </Button>
            </div>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-5 gap-4 mt-6">
            <Card className="bg-gray-800/50 border-gray-700/50">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-500/20 rounded-lg">
                    <Activity className="w-4 h-4 text-blue-400" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Balance</p>
                    <p className="text-xl font-bold text-white">
                      ${balance?.toFixed(2) || '10,000.00'}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-gray-800/50 border-gray-700/50">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${totalProfit >= 0 ? 'bg-green-500/20' : 'bg-red-500/20'}`}>
                    <BarChart3 className={`w-4 h-4 ${totalProfit >= 0 ? 'text-green-400' : 'text-red-400'}`} />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Total P&L</p>
                    <p className={`text-xl font-bold ${totalProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      ${totalProfit.toFixed(2)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-gray-800/50 border-gray-700/50">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-purple-500/20 rounded-lg">
                    <PieChart className="w-4 h-4 text-purple-400" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Win Rate</p>
                    <p className="text-xl font-bold text-white">{winRate}%</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-gray-800/50 border-gray-700/50">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-orange-500/20 rounded-lg">
                    <LineChart className="w-4 h-4 text-orange-400" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Total Trades</p>
                    <p className="text-xl font-bold text-white">{totalTrades}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-gray-800/50 border-gray-700/50">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-emerald-500/20 rounded-lg">
                    <Target className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Active Bots</p>
                    <p className="text-xl font-bold text-white">
                      {bots.filter(b => b.isRunning).length}/4
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Settings Bar */}
          <div className="grid grid-cols-4 gap-4 mt-4">
            <div>
              <Label className="text-xs text-gray-500">Stake ($)</Label>
              <Input
                type="number"
                value={globalStake}
                onChange={(e) => setGlobalStake(parseFloat(e.target.value) || 0.5)}
                className="bg-gray-800/50 border-gray-700 text-white"
                step="0.1"
                min="0.1"
              />
            </div>
            <div>
              <Label className="text-xs text-gray-500">Multiplier</Label>
              <Input
                type="number"
                value={globalMultiplier}
                onChange={(e) => setGlobalMultiplier(parseFloat(e.target.value) || 2)}
                className="bg-gray-800/50 border-gray-700 text-white"
                step="0.1"
                min="1.1"
              />
            </div>
            <div>
              <Label className="text-xs text-gray-500">Stop Loss ($)</Label>
              <Input
                type="number"
                value={globalStopLoss}
                onChange={(e) => setGlobalStopLoss(parseFloat(e.target.value) || 30)}
                className="bg-gray-800/50 border-gray-700 text-white"
              />
            </div>
            <div>
              <Label className="text-xs text-gray-500">Take Profit ($)</Label>
              <Input
                type="number"
                value={globalTakeProfit}
                onChange={(e) => setGlobalTakeProfit(parseFloat(e.target.value) || 5)}
                className="bg-gray-800/50 border-gray-700 text-white"
              />
            </div>
          </div>
        </motion.div>

        {/* ==================== SIGNALS DASHBOARD ==================== */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="backdrop-blur-xl bg-gray-900/50 border border-gray-800/50 rounded-2xl p-6"
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Zap className="w-5 h-5 text-yellow-400" />
              Live Market Signals
            </h2>
            <Badge variant="outline" className="border-gray-700 text-gray-400">
              {Object.keys(marketsData).length} Markets
            </Badge>
          </div>

          {/* Signal Summary */}
          <div className="grid grid-cols-4 gap-4 mb-4">
            {['OVER_3', 'UNDER_8', 'EVEN', 'ODD'].map((signalType) => {
              const signal = bestSignals[signalType];
              return (
                <Card key={signalType} className={`bg-gray-800/30 border ${
                  signal ? 'border-green-500/30' : 'border-gray-700/30'
                }`}>
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-300">
                        {signalType.replace('_', ' ')}
                      </span>
                      {signal ? (
                        <Badge className={getSignalColor(signal.strength)}>
                          {signal.strength}
                        </Badge>
                      ) : (
                        <Badge className="bg-gray-500/20 text-gray-400 border-gray-500/30">
                          NO SIGNAL
                        </Badge>
                      )}
                    </div>
                    {signal ? (
                      <div className="mt-2 space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-gray-500">Market</span>
                          <span className="font-mono text-white">{signal.market}</span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-gray-500">Confidence</span>
                          <span className="font-mono text-green-400">
                            {signal.confidence.toFixed(1)}%
                          </span>
                        </div>
                        <Progress value={signal.confidence} className="h-1 mt-1" />
                      </div>
                    ) : (
                      <div className="mt-2 text-xs text-gray-500 text-center py-2">
                        No signal available
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Markets List */}
          <ScrollArea className="h-64">
            <div className="space-y-2">
              {Object.entries(marketsData).map(([symbol, data]) => {
                const isExpanded = expandedMarket === symbol;
                const marketIcon = getMarketIcon(data.category);
                const marketColor = getMarketColor(data.category);
                
                return (
                  <motion.div
                    key={symbol}
                    className="bg-gray-800/30 border border-gray-700/30 rounded-lg overflow-hidden"
                  >
                    <div
                      className="p-3 flex items-center justify-between cursor-pointer hover:bg-gray-700/30 transition-colors"
                      onClick={() => setExpandedMarket(isExpanded ? null : symbol)}
                    >
                      <div className="flex items-center gap-3">
                        <span className={`text-lg ${marketColor}`}>{marketIcon}</span>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-white">{data.displayName}</span>
                            {data.analysis.signal !== 'NONE' && (
                              <Badge className={getSignalColor(data.analysis.signalStrength)}>
                                {data.analysis.signal}
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                            <span>Most: {data.analysis.mostAppearing}</span>
                            <span>2nd: {data.analysis.secondMost}</span>
                            <span>Least: {data.analysis.leastAppearing}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <div className="text-xs text-gray-500">Confidence</div>
                          <div className="text-sm font-mono text-white">
                            {data.analysis.confidence.toFixed(1)}%
                          </div>
                        </div>
                        <Button variant="ghost" size="sm" className="text-gray-500">
                          {isExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                        </Button>
                      </div>
                    </div>

                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="border-t border-gray-700/30 p-3 bg-gray-900/50"
                        >
                          <div className="grid grid-cols-3 gap-4">
                            {/* Digit Distribution */}
                            <div>
                              <h4 className="text-xs font-medium text-gray-400 mb-2">Digit Distribution</h4>
                              <div className="grid grid-cols-5 gap-1">
                                {[0,1,2,3,4,5,6,7,8,9].map(d => (
                                  <div key={d} className="text-center">
                                    <div className="text-[10px] text-gray-500">{d}</div>
                                    <div className="text-xs font-mono text-white">
                                      {data.analysis.percentages[d]?.toFixed(1)}%
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>

                            {/* Last 12 Ticks */}
                            <div>
                              <h4 className="text-xs font-medium text-gray-400 mb-2">Last 12 Ticks</h4>
                              <div className="flex gap-1 flex-wrap">
                                {data.analysis.lastTwelveTicks.map((digit, i) => (
                                  <span
                                    key={i}
                                    className={`w-6 h-6 flex items-center justify-center text-xs font-mono rounded ${
                                      digit > 5 ? 'bg-blue-500/20 text-blue-400' :
                                      digit < 5 ? 'bg-orange-500/20 text-orange-400' :
                                      'bg-purple-500/20 text-purple-400'
                                    }`}
                                  >
                                    {digit}
                                  </span>
                                ))}
                              </div>
                            </div>

                            {/* Statistics */}
                            <div>
                              <h4 className="text-xs font-medium text-gray-400 mb-2">Statistics</h4>
                              <div className="grid grid-cols-2 gap-2 text-xs">
                                <div>
                                  <span className="text-gray-500">Even:</span>
                                  <span className="ml-1 text-emerald-400">
                                    {data.analysis.evenPercentage.toFixed(1)}%
                                  </span>
                                </div>
                                <div>
                                  <span className="text-gray-500">Odd:</span>
                                  <span className="ml-1 text-purple-400">
                                    {data.analysis.oddPercentage.toFixed(1)}%
                                  </span>
                                </div>
                                <div>
                                  <span className="text-gray-500">Over 3:</span>
                                  <span className="ml-1 text-blue-400">
                                    {data.analysis.over3Percentage.toFixed(1)}%
                                  </span>
                                </div>
                                <div>
                                  <span className="text-gray-500">Under 6:</span>
                                  <span className="ml-1 text-orange-400">
                                    {data.analysis.under6Percentage.toFixed(1)}%
                                  </span>
                                </div>
                                <div>
                                  <span className="text-gray-500">Imbalance:</span>
                                  <span className="ml-1 text-white">
                                    {data.analysis.digitImbalance.toFixed(1)}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-gray-500">Momentum:</span>
                                  <span className={`ml-1 ${
                                    data.analysis.momentum === 'increasing' ? 'text-green-400' :
                                    data.analysis.momentum === 'decreasing' ? 'text-red-400' :
                                    'text-yellow-400'
                                  }`}>
                                    {data.analysis.momentum}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
            </div>
          </ScrollArea>
        </motion.div>

        {/* ==================== BOTS GRID ==================== */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="grid grid-cols-4 gap-4"
        >
          {bots.map((bot) => {
            const signal = bestSignals[bot.type];
            const marketData = bot.currentMarket ? marketsData[bot.currentMarket] : null;
            const marketIcon = marketData ? getMarketIcon(marketData.category) : '❓';
            const marketColor = marketData ? getMarketColor(marketData.category) : 'text-gray-500';

            return (
              <motion.div
                key={bot.id}
                whileHover={{ scale: 1.02 }}
                className={`relative overflow-hidden rounded-xl bg-gradient-to-br ${
                  bot.type === 'OVER_3' ? 'from-blue-500 to-cyan-600' :
                  bot.type === 'UNDER_8' ? 'from-orange-500 to-amber-600' :
                  bot.type === 'EVEN' ? 'from-emerald-500 to-green-600' :
                  'from-purple-500 to-pink-600'
                } p-[1px] ${bot.isRunning ? 'shadow-lg shadow-blue-500/20' : ''}`}
              >
                <div className="relative bg-gray-900/90 backdrop-blur-sm rounded-xl p-4">
                  {/* Status Indicator */}
                  <div className={`absolute top-3 right-3 w-2 h-2 rounded-full ${
                    bot.isRunning ? 'bg-green-500 animate-pulse' : 'bg-gray-600'
                  }`} />

                  {/* Header */}
                  <div className="flex items-center gap-2 mb-3">
                    <div className={`p-2 rounded-lg bg-gradient-to-br ${
                      bot.type === 'OVER_3' ? 'from-blue-500 to-cyan-600' :
                      bot.type === 'UNDER_8' ? 'from-orange-500 to-amber-600' :
                      bot.type === 'EVEN' ? 'from-emerald-500 to-green-600' :
                      'from-purple-500 to-pink-600'
                    } bg-opacity-20`}>
                      {bot.type === 'OVER_3' ? <TrendingUp className="w-4 h-4 text-white" /> :
                       bot.type === 'UNDER_8' ? <TrendingDown className="w-4 h-4 text-white" /> :
                       <CircleDot className="w-4 h-4 text-white" />}
                    </div>
                    <div>
                      <h3 className="font-semibold text-white text-sm">{bot.name}</h3>
                      <p className="text-[10px] text-gray-500">
                        Switches: {bot.marketSwitchCount}
                      </p>
                    </div>
                  </div>

                  {/* Signal Status */}
                  <div className="bg-gray-800/50 rounded-lg p-2 mb-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-gray-400">Signal</span>
                      {signal ? (
                        <Badge className={getSignalColor(signal.strength)}>
                          {signal.strength}
                        </Badge>
                      ) : (
                        <Badge className="bg-gray-500/20 text-gray-400 border-gray-500/30">
                          NO SIGNAL
                        </Badge>
                      )}
                    </div>
                    {bot.currentMarket && (
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-[10px] text-gray-400">Market</span>
                        <span className={`text-xs font-mono ${marketColor}`}>
                          {marketIcon} {bot.currentMarket}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Entry Condition */}
                  <div className="bg-gray-800/50 rounded-lg p-2 mb-2">
                    <div className="text-[9px] text-gray-400 mb-1">Entry Condition</div>
                    <div className="text-[10px] font-medium text-white">{bot.entryCondition}</div>
                  </div>

                  {/* Stats */}
                  <div className="grid grid-cols-2 gap-1 text-[10px] mb-3">
                    <div>
                      <span className="text-gray-500">P&L</span>
                      <span className={`ml-1 font-mono ${
                        bot.totalPnl > 0 ? 'text-green-400' : bot.totalPnl < 0 ? 'text-red-400' : 'text-white'
                      }`}>
                        ${bot.totalPnl.toFixed(2)}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-500">W/L</span>
                      <span className="ml-1 font-mono">
                        <span className="text-green-400">{bot.wins}</span>
                        <span className="text-gray-600">/</span>
                        <span className="text-red-400">{bot.losses}</span>
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-500">Stake</span>
                      <span className="ml-1 font-mono text-white">${bot.currentStake.toFixed(2)}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Trades left</span>
                      <span className="ml-1 font-mono text-white">
                        {bot.inRecovery ? '∞' : bot.tradesRemaining}
                      </span>
                    </div>
                  </div>

                  {/* Status */}
                  <div className="flex items-center justify-between text-[9px] mb-3">
                    <span className="text-gray-500">Status</span>
                    <span className={`font-mono ${
                      bot.status === 'trading' ? 'text-green-400' :
                      bot.status === 'waiting_entry' ? 'text-yellow-400' :
                      bot.status === 'scanning' ? 'text-blue-400' :
                      bot.status === 'recovery' ? 'text-orange-400' :
                      bot.status === 'cooldown' ? 'text-purple-400' :
                      bot.status === 'switching' ? 'text-pink-400' :
                      'text-gray-500'
                    }`}>
                      {bot.status === 'trading' ? '📈 Trading' :
                       bot.status === 'waiting_entry' ? '⏳ Waiting' :
                       bot.status === 'scanning' ? '🔍 Scanning' :
                       bot.status === 'recovery' ? '🔄 Recovery' :
                       bot.status === 'cooldown' ? `⏱️ ${bot.cooldownRemaining}s` :
                       bot.status === 'switching' ? '🔄 Switching' :
                       '⚫ Idle'}
                    </span>
                  </div>

                  {/* Recovery Indicator */}
                  {bot.inRecovery && (
                    <div className="bg-orange-500/20 text-orange-400 text-[8px] px-2 py-1 rounded mb-2 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      Recovery Mode {bot.recoveryFrom && `→ ${bot.recoveryFrom}`}
                    </div>
                  )}

                  {/* Controls */}
                  <div className="flex gap-1">
                    {!bot.isRunning ? (
                      <Button
                        onClick={() => startBot(bot.id)}
                        disabled={!signal}
                        size="sm"
                        className="flex-1 h-7 text-xs bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white border-0"
                      >
                        <Play className="w-3 h-3 mr-1" /> Start
                      </Button>
                    ) : (
                      <>
                        <Button
                          onClick={() => pauseBot(bot.id)}
                          size="sm"
                          variant="outline"
                          className="flex-1 h-7 text-xs border-gray-700 hover:bg-gray-800 text-gray-300"
                        >
                          <Pause className="w-3 h-3 mr-1" /> {bot.isPaused ? 'Resume' : 'Pause'}
                        </Button>
                        <Button
                          onClick={() => stopBot(bot.id)}
                          size="sm"
                          variant="destructive"
                          className="flex-1 h-7 text-xs bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30"
                        >
                          <StopCircle className="w-3 h-3 mr-1" /> Stop
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </motion.div>

        {/* ==================== TRADE LOG ==================== */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="backdrop-blur-xl bg-gray-900/50 border border-gray-800/50 rounded-2xl p-6"
        >
          <div className="flex items-center gap-2 mb-4">
            <Bell className="w-5 h-5 text-purple-400" />
            <h2 className="text-lg font-semibold text-white">Live Trade Log</h2>
          </div>

          <ScrollArea className="h-48">
            <div className="space-y-1">
              {trades.length === 0 ? (
                <div className="text-center py-8 text-gray-500 text-sm">
                  No trades yet. Start a bot to see activity.
                </div>
              ) : (
                trades.map((trade, i) => {
                  const market = VOLATILITY_MARKETS.find(m => m.symbol === trade.market);
                  const icon = market ? getMarketIcon(market.category) : '📊';
                  
                  return (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.02 }}
                      className="flex items-center justify-between py-2 px-3 bg-gray-800/30 rounded-lg border border-gray-700/30 text-xs"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-gray-500 text-[10px]">{trade.time}</span>
                        <Badge variant="outline" className="text-[8px] px-1.5 py-0 border-gray-700">
                          {trade.bot}
                        </Badge>
                        <span className="font-mono text-[10px] text-gray-400">
                          {icon} {trade.market}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        {trade.entryPattern && (
                          <Badge className="text-[7px] px-1.5 py-0 bg-blue-500/20 text-blue-400 border-blue-500/30">
                            {trade.entryPattern}
                          </Badge>
                        )}
                        {trade.recoveryNote && (
                          <Badge className="text-[7px] px-1.5 py-0 bg-orange-500/20 text-orange-400 border-orange-500/30">
                            {trade.recoveryNote}
                          </Badge>
                        )}
                        <span className="font-mono text-[9px] text-gray-400">
                          Last: {trade.lastDigit}
                        </span>
                        <span className="font-mono text-white">${trade.stake.toFixed(2)}</span>
                        <span className={`font-mono w-14 text-right ${
                          trade.result === 'Win' ? 'text-green-400' : 'text-red-400'
                        }`}>
                          {trade.result === 'Win' ? `+$${trade.pnl.toFixed(2)}` : `-$${Math.abs(trade.pnl).toFixed(2)}`}
                        </span>
                      </div>
                    </motion.div>
                  );
                })
              )}
            </div>
          </ScrollArea>
        </motion.div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 0.8; }
        }
        .animate-pulse {
          animation: pulse 3s ease-in-out infinite;
        }
        .delay-1000 {
          animation-delay: 1s;
        }
      `}</style>
    </div>
  );
}
