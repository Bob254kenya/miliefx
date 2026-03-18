import { useState, useRef, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { derivApi } from '@/services/deriv-api';
import { useAuth } from '@/contexts/AuthContext';
import { useTickLoader } from '@/hooks/useTickLoader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Loader2, Play, StopCircle, Pause, TrendingUp, TrendingDown,
  CircleDot, RefreshCw, Trash2, Scan, Brain, Activity, Target,
  AlertCircle, CheckCircle2, Clock, Hash, Zap, Shield, Gauge,
  Volume2, VolumeX, Timer, XCircle, Download, Upload, Settings,
  BarChart3, LineChart, PieChart, Save, Copy, FileText,
  ChevronDown, ChevronUp, AlertTriangle, Info, Award, Star,
  Flame, Snowflake, Wind, Sun, Moon, Cloud, Droplets,
  ArrowUp, ArrowDown, Minus, Plus, Percent, DollarSign,
  Eye, EyeOff, Lock, Unlock, Bell, BellOff, Wifi, WifiOff
} from 'lucide-react';

// ==================== TYPES ====================
interface DigitAnalysis {
  digitCounts: Record<number, number>;
  digitPercentages: Record<number, number>;
  lowDigitsPercentage: number; // 0,1,2 combined
  highDigitsPercentage: number; // 7,8,9 combined
  evenCount: number;
  oddCount: number;
  evenPercentage: number;
  oddPercentage: number;
  mostAppearingDigits: number[];
  leastAppearingDigits: number[];
  marketType: 'TYPE_A' | 'TYPE_B' | 'EVEN_ODD' | 'NEUTRAL';
  recommendedEntry: number | 'EVEN' | 'ODD';
  confidence: number;
}

interface BotConfig {
  id: string;
  name: string;
  type: 'TYPE_A' | 'TYPE_B' | 'EVEN_ODD';
  market: string;
  stake: number;
  contractType: string;
  duration: number;
  durationUnit: 't' | 'm' | 'h';
  barrier?: number;
  targetDigit?: number | 'EVEN' | 'ODD';
  
  // Recovery settings
  recoveryEnabled: boolean;
  recoveryMultiplier: number;
  recoveryStopLoss: number;
  recoveryTakeProfit: number;
  maxRecoveryAttempts: number;
  
  // Run settings
  maxConsecutiveContracts: number;
  stopOnProfit: boolean;
  stopOnLoss: boolean;
  autoRestart: boolean;
}

interface BotState extends BotConfig {
  isRunning: boolean;
  isPaused: boolean;
  status: 'idle' | 'analyzing' | 'waiting' | 'trading' | 'recovery' | 'cooldown' | 'completed' | 'stopped';
  
  // Trading stats
  currentStake: number;
  totalPnl: number;
  trades: number;
  wins: number;
  losses: number;
  consecutiveWins: number;
  consecutiveLosses: number;
  
  // Current run state
  currentRun: number;
  runsCompleted: number;
  entryTriggered: boolean;
  recoveryMode: boolean;
  recoveryAttempts: number;
  cooldownRemaining: number;
  lastTradeResult?: 'win' | 'loss';
  
  // Market data
  currentDigit?: number;
  marketAnalysis?: DigitAnalysis;
  tickProgress: number;
  
  // UI state
  expanded: boolean;
}

interface TradeLog {
  id: string;
  timestamp: Date;
  botId: string;
  botName: string;
  market: string;
  contractType: string;
  stake: number;
  result: 'win' | 'loss' | 'pending';
  profit: number;
  digit?: number;
  entryType?: string;
  recoveryAttempt?: number;
}

interface MarketData {
  symbol: string;
  ticks: number[];
  analysis: DigitAnalysis;
  lastUpdated: Date;
}

// ==================== CONSTANTS ====================
const VOLATILITY_MARKETS = [
  // Standard Volatility
  { value: 'R_10', label: 'R 10', icon: '📈' },
  { value: 'R_25', label: 'R 25', icon: '📈' },
  { value: 'R_50', label: 'R 50', icon: '📈' },
  { value: 'R_75', label: 'R 75', icon: '📈' },
  { value: 'R_100', label: 'R 100', icon: '📈' },
  
  // 1-Second Volatility
  { value: '1HZ10V', label: '1HZ 10', icon: '⚡' },
  { value: '1HZ25V', label: '1HZ 25', icon: '⚡' },
  { value: '1HZ50V', label: '1HZ 50', icon: '⚡' },
  { value: '1HZ75V', label: '1HZ 75', icon: '⚡' },
  { value: '1HZ100V', label: '1HZ 100', icon: '⚡' },
  
  // Jump Indices
  { value: 'JD10', label: 'JD 10', icon: '🦘' },
  { value: 'JD25', label: 'JD 25', icon: '🦘' },
  { value: 'JD50', label: 'JD 50', icon: '🦘' },
  { value: 'JD75', label: 'JD 75', icon: '🦘' },
  { value: 'JD100', label: 'JD 100', icon: '🦘' },
  
  // Boom & Crash
  { value: 'BOOM300', label: 'BOOM 300', icon: '💥' },
  { value: 'BOOM500', label: 'BOOM 500', icon: '💥' },
  { value: 'BOOM1000', label: 'BOOM 1000', icon: '💥' },
  { value: 'CRASH300', label: 'CRASH 300', icon: '📉' },
  { value: 'CRASH500', label: 'CRASH 500', icon: '📉' },
  { value: 'CRASH1000', label: 'CRASH 1000', icon: '📉' },
  
  // Daily Reset
  { value: 'RDBEAR', label: 'RD Bear', icon: '🐻' },
  { value: 'RDBULL', label: 'RD Bull', icon: '🐂' }
];

const CONTRACT_TYPES = {
  DIGITOVER: { label: 'Over', icon: '↑' },
  DIGITUNDER: { label: 'Under', icon: '↓' },
  DIGITEVEN: { label: 'Even', icon: '2️⃣' },
  DIGITODD: { label: 'Odd', icon: '3️⃣' },
  DIGITDIFF: { label: 'Differs', icon: '≠' },
  DIGITMATCH: { label: 'Matches', icon: '=' }
};

const DURATION_UNITS = [
  { value: 't', label: 'Ticks' },
  { value: 'm', label: 'Minutes' },
  { value: 'h', label: 'Hours' }
];

// ==================== HELPER FUNCTIONS ====================
const analyzeDigits = (ticks: number[]): DigitAnalysis => {
  if (ticks.length === 0) {
    return {
      digitCounts: {},
      digitPercentages: {},
      lowDigitsPercentage: 0,
      highDigitsPercentage: 0,
      evenCount: 0,
      oddCount: 0,
      evenPercentage: 0,
      oddPercentage: 0,
      mostAppearingDigits: [],
      leastAppearingDigits: [],
      marketType: 'NEUTRAL',
      recommendedEntry: 0,
      confidence: 0
    };
  }

  // Get last 1000 ticks or all available
  const lastTicks = ticks.slice(-1000);
  const total = lastTicks.length;
  
  // Initialize counters
  const digitCounts: Record<number, number> = {};
  for (let i = 0; i <= 9; i++) digitCounts[i] = 0;
  
  // Count digits
  lastTicks.forEach(tick => {
    const digit = Math.floor(tick % 10);
    digitCounts[digit]++;
  });
  
  // Calculate percentages
  const digitPercentages: Record<number, number> = {};
  for (let i = 0; i <= 9; i++) {
    digitPercentages[i] = (digitCounts[i] / total) * 100;
  }
  
  // Low digits (0,1,2) percentage
  const lowDigitsPercentage = (digitCounts[0] + digitCounts[1] + digitCounts[2]) / total * 100;
  
  // High digits (7,8,9) percentage
  const highDigitsPercentage = (digitCounts[7] + digitCounts[8] + digitCounts[9]) / total * 100;
  
  // Even/Odd counts
  const evenDigits = [0,2,4,6,8];
  const oddDigits = [1,3,5,7,9];
  
  const evenCount = evenDigits.reduce((sum, d) => sum + digitCounts[d], 0);
  const oddCount = oddDigits.reduce((sum, d) => sum + digitCounts[d], 0);
  
  const evenPercentage = (evenCount / total) * 100;
  const oddPercentage = (oddCount / total) * 100;
  
  // Find most/least appearing digits
  const sortedDigits = [...Array(10).keys()].sort((a, b) => digitCounts[b] - digitCounts[a]);
  const mostAppearingDigits = sortedDigits.slice(0, 3);
  const leastAppearingDigits = sortedDigits.slice(-3).reverse();
  
  // Determine market type and recommended entry
  let marketType: 'TYPE_A' | 'TYPE_B' | 'EVEN_ODD' | 'NEUTRAL' = 'NEUTRAL';
  let recommendedEntry: number | 'EVEN' | 'ODD' = 0;
  let confidence = 0;
  
  if (lowDigitsPercentage < 10) {
    marketType = 'TYPE_A';
    recommendedEntry = leastAppearingDigits[0]; // Most rare digit
    confidence = Math.max(0, 100 - lowDigitsPercentage * 5);
  } else if (highDigitsPercentage < 10) {
    marketType = 'TYPE_B';
    recommendedEntry = leastAppearingDigits[0];
    confidence = Math.max(0, 100 - highDigitsPercentage * 5);
  } else if (evenPercentage > 55) {
    marketType = 'EVEN_ODD';
    recommendedEntry = 'EVEN';
    confidence = evenPercentage;
  } else if (oddPercentage > 55) {
    marketType = 'EVEN_ODD';
    recommendedEntry = 'ODD';
    confidence = oddPercentage;
  }
  
  return {
    digitCounts,
    digitPercentages,
    lowDigitsPercentage,
    highDigitsPercentage,
    evenCount,
    oddCount,
    evenPercentage,
    oddPercentage,
    mostAppearingDigits,
    leastAppearingDigits,
    marketType,
    recommendedEntry,
    confidence
  };
};

const formatNumber = (num: number, decimals: number = 2): string => {
  return num.toFixed(decimals);
};

const formatCurrency = (amount: number): string => {
  return `$${amount.toFixed(2)}`;
};

const formatPercentage = (value: number): string => {
  return `${value.toFixed(1)}%`;
};

const getStatusColor = (status: BotState['status']): string => {
  switch (status) {
    case 'trading': return 'text-green-500';
    case 'recovery': return 'text-orange-500';
    case 'waiting': return 'text-yellow-500';
    case 'cooldown': return 'text-purple-500';
    case 'completed': return 'text-blue-500';
    case 'stopped': return 'text-red-500';
    default: return 'text-gray-500';
  }
};

const getStatusIcon = (status: BotState['status']) => {
  switch (status) {
    case 'trading': return <Activity className="w-3 h-3" />;
    case 'recovery': return <RefreshCw className="w-3 h-3" />;
    case 'waiting': return <Clock className="w-3 h-3" />;
    case 'cooldown': return <Timer className="w-3 h-3" />;
    case 'completed': return <CheckCircle2 className="w-3 h-3" />;
    case 'stopped': return <StopCircle className="w-3 h-3" />;
    default: return <CircleDot className="w-3 h-3" />;
  }
};

const waitForNextTick = (symbol: string): Promise<{ quote: number; epoch: number }> => {
  return new Promise((resolve) => {
    const unsub = derivApi.onMessage((data: any) => {
      if (data.tick && data.tick.symbol === symbol) {
        unsub();
        resolve({ quote: data.tick.quote, epoch: data.tick.epoch });
      }
    });
  });
};

// ==================== MAIN COMPONENT ====================
export default function DerivTradingBot() {
  const { isAuthorized, balance } = useAuth();
  
  // ==================== STATE ====================
  const [activeTradeId, setActiveTradeId] = useState<string | null>(null);
  const [marketData, setMarketData] = useState<Record<string, MarketData>>({});
  const [selectedMarketForAnalysis, setSelectedMarketForAnalysis] = useState<string>('R_100');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [autoAnalyze, setAutoAnalyze] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [darkMode, setDarkMode] = useState(false);
  
  const [bots, setBots] = useState<BotState[]>([]);
  const [tradeLogs, setTradeLogs] = useState<TradeLog[]>([]);
  const [selectedTab, setSelectedTab] = useState('bots');
  
  const [globalSettings, setGlobalSettings] = useState({
    defaultStake: 1.00,
    defaultMultiplier: 2.0,
    defaultStopLoss: 50,
    defaultTakeProfit: 25,
    maxConcurrentBots: 5,
    tickHistorySize: 1000
  });

  // Refs
  const botRunningRefs = useRef<Record<string, boolean>>({});
  const botPausedRefs = useRef<Record<string, boolean>>({});
  const analysisIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const marketTicksRef = useRef<Record<string, number[]>>({});

  // Tick loader for selected market
  const { digits, prices, isLoading, tickCount } = useTickLoader(
    selectedMarketForAnalysis, 
    globalSettings.tickHistorySize
  );

  // ==================== EFFECTS ====================
  
  // Update market data when new ticks arrive
  useEffect(() => {
    if (digits.length > 0) {
      marketTicksRef.current[selectedMarketForAnalysis] = digits;
      
      const analysis = analyzeDigits(digits);
      
      setMarketData(prev => ({
        ...prev,
        [selectedMarketForAnalysis]: {
          symbol: selectedMarketForAnalysis,
          ticks: digits,
          analysis,
          lastUpdated: new Date()
        }
      }));
    }
  }, [digits, selectedMarketForAnalysis]);

  // Auto-analyze all markets periodically
  useEffect(() => {
    if (autoAnalyze && !isAnalyzing) {
      if (analysisIntervalRef.current) clearInterval(analysisIntervalRef.current);
      
      analysisIntervalRef.current = setInterval(() => {
        analyzeAllMarkets();
      }, 60000); // Every minute
      
      return () => {
        if (analysisIntervalRef.current) clearInterval(analysisIntervalRef.current);
      };
    }
  }, [autoAnalyze, isAnalyzing]);

  // ==================== MARKET ANALYSIS ====================
  
  const analyzeAllMarkets = useCallback(async () => {
    if (isAnalyzing) return;
    
    setIsAnalyzing(true);
    setAnalysisProgress(0);
    
    try {
      const markets = VOLATILITY_MARKETS.map(m => m.value);
      const total = markets.length;
      const updatedData: Record<string, MarketData> = {};
      
      for (let i = 0; i < markets.length; i++) {
        const market = markets[i];
        const ticks = marketTicksRef.current[market] || [];
        
        setAnalysisProgress(Math.round(((i + 1) / total) * 100));
        
        if (ticks.length >= 100) {
          const analysis = analyzeDigits(ticks);
          
          updatedData[market] = {
            symbol: market,
            ticks,
            analysis,
            lastUpdated: new Date()
          };
          
          // Auto-create bots based on analysis
          if (analysis.marketType !== 'NEUTRAL' && analysis.confidence > 70) {
            createBotFromAnalysis(market, analysis);
          }
        }
        
        // Small delay to prevent UI freeze
        await new Promise(r => setTimeout(r, 10));
      }
      
      setMarketData(prev => ({ ...prev, ...updatedData }));
      
      if (soundEnabled) {
        playSound('success');
      }
      
      toast.success(`✅ Analyzed ${Object.keys(updatedData).length} markets`);
      
    } catch (error) {
      console.error('Analysis error:', error);
      toast.error('Analysis failed');
    } finally {
      setIsAnalyzing(false);
      setAnalysisProgress(100);
    }
  }, [isAnalyzing, soundEnabled]);

  const analyzeMarket = useCallback((market: string) => {
    const ticks = marketTicksRef.current[market] || [];
    
    if (ticks.length < 100) {
      toast.warning(`Not enough data for ${market}`);
      return null;
    }
    
    const analysis = analyzeDigits(ticks);
    
    setMarketData(prev => ({
      ...prev,
      [market]: {
        symbol: market,
        ticks,
        analysis,
        lastUpdated: new Date()
      }
    }));
    
    return analysis;
  }, []);

  const createBotFromAnalysis = useCallback((market: string, analysis: DigitAnalysis) => {
    const existingBot = bots.find(b => b.market === market && b.type === analysis.marketType);
    if (existingBot) return;
    
    let botName = '';
    let contractType = '';
    let barrier: number | undefined;
    let targetDigit: number | 'EVEN' | 'ODD' = 0;
    
    switch (analysis.marketType) {
      case 'TYPE_A':
        botName = `Type A - ${market}`;
        contractType = 'DIGITOVER';
        targetDigit = analysis.leastAppearingDigits[0];
        barrier = targetDigit as number;
        break;
      case 'TYPE_B':
        botName = `Type B - ${market}`;
        contractType = 'DIGITUNDER';
        targetDigit = analysis.leastAppearingDigits[0];
        barrier = targetDigit as number;
        break;
      case 'EVEN_ODD':
        botName = `Even/Odd - ${market}`;
        contractType = analysis.recommendedEntry === 'EVEN' ? 'DIGITEVEN' : 'DIGITODD';
        targetDigit = analysis.recommendedEntry;
        break;
      default:
        return;
    }
    
    const newBot: BotState = {
      id: `bot-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: botName,
      type: analysis.marketType,
      market,
      stake: globalSettings.defaultStake,
      contractType,
      duration: 1,
      durationUnit: 't',
      barrier,
      targetDigit,
      
      recoveryEnabled: true,
      recoveryMultiplier: globalSettings.defaultMultiplier,
      recoveryStopLoss: globalSettings.defaultStopLoss,
      recoveryTakeProfit: globalSettings.defaultTakeProfit,
      maxRecoveryAttempts: 5,
      
      maxConsecutiveContracts: 3,
      stopOnProfit: true,
      stopOnLoss: false,
      autoRestart: false,
      
      isRunning: false,
      isPaused: false,
      status: 'idle',
      
      currentStake: globalSettings.defaultStake,
      totalPnl: 0,
      trades: 0,
      wins: 0,
      losses: 0,
      consecutiveWins: 0,
      consecutiveLosses: 0,
      
      currentRun: 0,
      runsCompleted: 0,
      entryTriggered: false,
      recoveryMode: false,
      recoveryAttempts: 0,
      cooldownRemaining: 0,
      
      tickProgress: 0,
      
      expanded: true
    };
    
    setBots(prev => [...prev, newBot]);
    
    toast.success(`🤖 Created ${botName} bot`);
  }, [bots, globalSettings]);

  // ==================== TRADING LOGIC ====================
  
  const runBot = useCallback(async (botId: string) => {
    const bot = bots.find(b => b.id === botId);
    if (!bot || !isAuthorized) return;

    // Check balance
    if (balance < bot.currentStake) {
      toast.error(`Insufficient balance for ${bot.name}`);
      stopBot(botId);
      return;
    }

    // Check market data
    const marketTicks = marketTicksRef.current[bot.market] || [];
    if (marketTicks.length < 10) {
      toast.error(`${bot.name}: Insufficient market data`);
      return;
    }

    // Update bot state
    setBots(prev => prev.map(b => 
      b.id === botId ? { 
        ...b, 
        isRunning: true, 
        isPaused: false,
        status: 'analyzing',
        currentStake: bot.stake
      } : b
    ));
    
    botRunningRefs.current[botId] = true;
    botPausedRefs.current[botId] = false;

    let currentStake = bot.stake;
    let totalPnl = bot.totalPnl;
    let trades = bot.trades;
    let wins = bot.wins;
    let losses = bot.losses;
    let consecutiveWins = 0;
    let consecutiveLosses = 0;
    let runsCompleted = 0;
    let recoveryMode = false;
    let recoveryAttempts = 0;
    let entryTriggered = false;
    let cooldownRemaining = 0;

    while (botRunningRefs.current[botId] && runsCompleted < bot.maxConsecutiveContracts) {
      // Check if paused
      if (botPausedRefs.current[botId]) {
        setBots(prev => prev.map(b => 
          b.id === botId ? { ...b, status: 'waiting' } : b
        ));
        await new Promise(r => setTimeout(r, 500));
        continue;
      }

      // Check stop loss / take profit
      if (totalPnl <= -bot.recoveryStopLoss) {
        toast.error(`${bot.name}: Stop Loss reached!`);
        break;
      }
      if (totalPnl >= bot.recoveryTakeProfit && bot.stopOnProfit) {
        toast.success(`${bot.name}: Take Profit reached!`);
        break;
      }

      // Handle cooldown
      if (cooldownRemaining > 0) {
        setBots(prev => prev.map(b => 
          b.id === botId ? { 
            ...b, 
            status: 'cooldown',
            cooldownRemaining 
          } : b
        ));
        await new Promise(r => setTimeout(r, 1000));
        cooldownRemaining--;
        continue;
      }

      // Update tick progress
      const tickProgress = Math.min(100, (marketTicksRef.current[bot.market]?.length || 0) / 10);
      setBots(prev => prev.map(b => 
        b.id === botId ? { ...b, tickProgress } : b
      ));

      // Check entry condition based on bot type
      const currentDigit = marketTicksRef.current[bot.market]?.slice(-1)[0] % 10;
      let shouldEnter = false;
      
      if (!entryTriggered && !recoveryMode) {
        switch (bot.type) {
          case 'TYPE_A':
            shouldEnter = currentDigit === bot.targetDigit;
            break;
          case 'TYPE_B':
            shouldEnter = currentDigit === bot.targetDigit;
            break;
          case 'EVEN_ODD':
            if (bot.targetDigit === 'EVEN') {
              shouldEnter = currentDigit % 2 === 0;
            } else {
              shouldEnter = currentDigit % 2 === 1;
            }
            break;
        }
      }

      setBots(prev => prev.map(b => 
        b.id === botId ? { 
          ...b, 
          status: shouldEnter ? 'trading' : 'waiting',
          currentDigit
        } : b
      ));

      if (!shouldEnter) {
        await new Promise(r => setTimeout(r, 100));
        continue;
      }

      // Entry triggered
      entryTriggered = true;
      
      try {
        // Wait for next tick to execute trade
        await waitForNextTick(bot.market);

        // Check if another trade is active
        if (activeTradeId) {
          await new Promise(r => setTimeout(r, 500));
          continue;
        }

        // Prepare contract parameters
        const params: any = {
          contract_type: bot.contractType,
          symbol: bot.market,
          duration: bot.duration,
          duration_unit: bot.durationUnit,
          basis: 'stake',
          amount: currentStake,
        };

        if (bot.barrier !== undefined) {
          params.barrier = bot.barrier.toString();
        }

        // Generate trade ID
        const tradeId = `${botId}-${Date.now()}-${trades + 1}`;
        setActiveTradeId(tradeId);

        // Add to trade logs
        const newTrade: TradeLog = {
          id: tradeId,
          timestamp: new Date(),
          botId,
          botName: bot.name,
          market: bot.market,
          contractType: bot.contractType,
          stake: currentStake,
          result: 'pending',
          profit: 0,
          digit: currentDigit,
          entryType: bot.type,
          recoveryAttempt: recoveryAttempts
        };

        setTradeLogs(prev => [newTrade, ...prev].slice(0, 100));

        // Execute trade
        const { contractId } = await derivApi.buyContract(params);
        const result = await derivApi.waitForContractResult(contractId);
        
        const won = result.status === 'won';
        const profit = result.profit;

        // Update trade log
        setTradeLogs(prev => prev.map(t => 
          t.id === tradeId ? { ...t, result: won ? 'win' : 'loss', profit } : t
        ));

        // Update statistics
        totalPnl += profit;
        trades++;
        
        if (won) {
          wins++;
          consecutiveWins++;
          consecutiveLosses = 0;
          
          // Reset stake on win
          currentStake = bot.stake;
          entryTriggered = false;
          recoveryMode = false;
          recoveryAttempts = 0;
          runsCompleted++;
          
          // If stop on profit is enabled, stop after a win
          if (bot.stopOnProfit) {
            break;
          }
        } else {
          losses++;
          consecutiveLosses++;
          consecutiveWins = 0;
          
          // Handle recovery
          if (bot.recoveryEnabled) {
            if (!recoveryMode) {
              // Enter recovery mode
              recoveryMode = true;
              recoveryAttempts = 1;
              currentStake = bot.stake * bot.recoveryMultiplier;
            } else {
              // Increment recovery attempt
              recoveryAttempts++;
              
              if (recoveryAttempts <= bot.maxRecoveryAttempts) {
                // Increase stake for next recovery attempt
                currentStake = bot.stake * Math.pow(bot.recoveryMultiplier, recoveryAttempts);
              } else {
                // Max recovery attempts reached
                toast.error(`${bot.name}: Max recovery attempts reached`);
                break;
              }
            }
          } else {
            // No recovery, reset
            currentStake = bot.stake;
            entryTriggered = false;
            runsCompleted++;
          }
          
          // Add cooldown after loss
          cooldownRemaining = 2;
        }

        // Update bot state
        setBots(prev => prev.map(b => {
          if (b.id === botId) {
            return {
              ...b,
              totalPnl,
              trades,
              wins,
              losses,
              consecutiveWins,
              consecutiveLosses,
              currentStake,
              runsCompleted,
              recoveryMode,
              recoveryAttempts,
              entryTriggered: !won && recoveryMode,
              status: cooldownRemaining > 0 ? 'cooldown' : (recoveryMode ? 'recovery' : (runsCompleted >= bot.maxConsecutiveContracts ? 'completed' : 'waiting')),
              cooldownRemaining,
              lastTradeResult: won ? 'win' : 'loss'
            };
          }
          return b;
        }));

        setActiveTradeId(null);
        
        // Small delay between trades
        await new Promise(r => setTimeout(r, 500));

      } catch (err: any) {
        setActiveTradeId(null);
        
        if (err.message?.includes('Insufficient balance')) {
          toast.error(`Insufficient balance for ${bot.name}`);
          break;
        } else {
          console.error('Trade error:', err);
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    }

    // Bot finished
    setBots(prev => prev.map(b => 
      b.id === botId ? { 
        ...b, 
        isRunning: false, 
        isPaused: false,
        status: 'completed',
        cooldownRemaining: 0,
        entryTriggered: false,
        recoveryMode: false
      } : b
    ));
    
    botRunningRefs.current[botId] = false;
    
    // Auto-restart if enabled
    if (bot.autoRestart) {
      setTimeout(() => {
        if (!botRunningRefs.current[botId]) {
          runBot(botId);
        }
      }, 3000);
    }
  }, [isAuthorized, balance, activeTradeId, bots]);

  // ==================== BOT CONTROLS ====================
  
  const startBot = (botId: string) => {
    const bot = bots.find(b => b.id === botId);
    if (!bot || bot.isRunning) return;
    
    if (!bot.market) {
      toast.error(`${bot.name}: No market selected`);
      return;
    }
    
    runBot(botId);
  };

  const pauseBot = (botId: string) => {
    const bot = bots.find(b => b.id === botId);
    if (!bot || !bot.isRunning) return;
    
    botPausedRefs.current[botId] = !botPausedRefs.current[botId];
    
    setBots(prev => prev.map(b => 
      b.id === botId ? { 
        ...b, 
        isPaused: botPausedRefs.current[botId],
        status: botPausedRefs.current[botId] ? 'waiting' : b.status
      } : b
    ));
    
    toast.info(`${bot.name} ${botPausedRefs.current[botId] ? 'paused' : 'resumed'}`);
  };

  const stopBot = (botId: string) => {
    botRunningRefs.current[botId] = false;
    
    setBots(prev => prev.map(b => 
      b.id === botId ? { 
        ...b, 
        isRunning: false, 
        isPaused: false,
        status: 'stopped',
        cooldownRemaining: 0,
        entryTriggered: false,
        recoveryMode: false
      } : b
    ));
  };

  const stopAllBots = () => {
    bots.forEach(bot => {
      botRunningRefs.current[bot.id] = false;
    });
    
    setBots(prev => prev.map(b => ({ 
      ...b, 
      isRunning: false, 
      isPaused: false,
      status: 'stopped',
      cooldownRemaining: 0,
      entryTriggered: false,
      recoveryMode: false
    })));
    
    toast.info('All bots stopped');
  };

  const removeBot = (botId: string) => {
    stopBot(botId);
    setBots(prev => prev.filter(b => b.id !== botId));
  };

  const duplicateBot = (bot: BotState) => {
    const newBot: BotState = {
      ...bot,
      id: `bot-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: `${bot.name} (Copy)`,
      isRunning: false,
      isPaused: false,
      status: 'idle',
      totalPnl: 0,
      trades: 0,
      wins: 0,
      losses: 0,
      consecutiveWins: 0,
      consecutiveLosses: 0,
      currentRun: 0,
      runsCompleted: 0,
      recoveryAttempts: 0,
      currentStake: bot.stake
    };
    
    setBots(prev => [...prev, newBot]);
    toast.success(`Bot duplicated`);
  };

  const updateBotConfig = (botId: string, updates: Partial<BotConfig>) => {
    setBots(prev => prev.map(b => 
      b.id === botId ? { ...b, ...updates } : b
    ));
  };

  const clearAllData = () => {
    stopAllBots();
    setBots([]);
    setTradeLogs([]);
    setMarketData({});
    marketTicksRef.current = {};
    toast.success('All data cleared');
  };

  const exportSettings = () => {
    const data = {
      bots: bots.map(({ id, ...bot }) => bot),
      settings: globalSettings,
      timestamp: new Date().toISOString()
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `deriv-bot-settings-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    toast.success('Settings exported');
  };

  const importSettings = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result as string);
        
        if (data.bots && Array.isArray(data.bots)) {
          const importedBots = data.bots.map((bot: any) => ({
            ...bot,
            id: `bot-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            isRunning: false,
            isPaused: false,
            status: 'idle',
            totalPnl: 0,
            trades: 0,
            wins: 0,
            losses: 0,
            consecutiveWins: 0,
            consecutiveLosses: 0,
            currentRun: 0,
            runsCompleted: 0,
            recoveryAttempts: 0,
            currentStake: bot.stake || globalSettings.defaultStake
          }));
          
          setBots(prev => [...prev, ...importedBots]);
        }
        
        if (data.settings) {
          setGlobalSettings(data.settings);
        }
        
        toast.success(`Imported ${data.bots?.length || 0} bots`);
      } catch (error) {
        console.error('Import error:', error);
        toast.error('Failed to import settings');
      }
    };
    reader.readAsText(file);
  };

  // ==================== UTILITIES ====================
  
  const playSound = (type: 'success' | 'error' | 'alert') => {
    if (!soundEnabled) return;
    
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      switch (type) {
        case 'success':
          oscillator.frequency.setValueAtTime(880, audioContext.currentTime);
          oscillator.frequency.exponentialRampToValueAtTime(440, audioContext.currentTime + 0.1);
          break;
        case 'error':
          oscillator.frequency.setValueAtTime(220, audioContext.currentTime);
          oscillator.frequency.exponentialRampToValueAtTime(110, audioContext.currentTime + 0.1);
          break;
        case 'alert':
          oscillator.frequency.setValueAtTime(440, audioContext.currentTime);
          oscillator.frequency.setValueAtTime(440, audioContext.currentTime + 0.1);
          oscillator.frequency.setValueAtTime(440, audioContext.currentTime + 0.2);
          break;
      }
      
      gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
      
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.1);
    } catch (e) {
      console.log('Audio not supported');
    }
  };

  // Calculate statistics
  const totalProfit = bots.reduce((sum, bot) => sum + bot.totalPnl, 0);
  const totalTrades = bots.reduce((sum, bot) => sum + bot.trades, 0);
  const totalWins = bots.reduce((sum, bot) => sum + bot.wins, 0);
  const winRate = totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0;
  const activeBots = bots.filter(b => b.isRunning).length;
  const runningBots = bots.filter(b => b.isRunning && !b.isPaused).length;

  return (
    <TooltipProvider>
      <div className={`min-h-screen ${darkMode ? 'dark' : ''}`}>
        <div className="container mx-auto p-2 sm:p-4 space-y-4 bg-background text-foreground">
          
          {/* ==================== HEADER ==================== */}
          <Card className="border-2 shadow-lg">
            <CardHeader className="p-3 sm:p-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Brain className="w-5 h-5 text-primary" />
                  <div>
                    <CardTitle className="text-base sm:text-lg">Deriv Trading Bot System</CardTitle>
                    <CardDescription className="text-xs">
                      Advanced Market Analysis & Automated Trading
                    </CardDescription>
                  </div>
                </div>
                
                <div className="flex flex-wrap items-center gap-1 w-full sm:w-auto">
                  {/* Theme Toggle */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDarkMode(!darkMode)}
                    className="h-7 w-7 p-0"
                  >
                    {darkMode ? <Sun className="w-3 h-3" /> : <Moon className="w-3 h-3" />}
                  </Button>
                  
                  {/* Sound Toggle */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSoundEnabled(!soundEnabled)}
                    className="h-7 w-7 p-0"
                  >
                    {soundEnabled ? <Volume2 className="w-3 h-3" /> : <VolumeX className="w-3 h-3" />}
                  </Button>
                  
                  {/* Auto Analyze Toggle */}
                  <div className="flex items-center gap-1 px-2 py-1 bg-muted/30 rounded-lg text-xs">
                    <span>Auto</span>
                    <Switch
                      checked={autoAnalyze}
                      onCheckedChange={setAutoAnalyze}
                      className="scale-75"
                    />
                  </div>
                  
                  {/* Market Selector */}
                  <Select 
                    value={selectedMarketForAnalysis} 
                    onValueChange={setSelectedMarketForAnalysis}
                  >
                    <SelectTrigger className="h-7 text-xs w-28 sm:w-32">
                      <SelectValue placeholder="Market" />
                    </SelectTrigger>
                    <SelectContent>
                      {VOLATILITY_MARKETS.slice(0, 10).map(market => (
                        <SelectItem key={market.value} value={market.value} className="text-xs">
                          {market.icon} {market.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  
                  {/* Analyze Button */}
                  <Button
                    variant="default"
                    size="sm"
                    onClick={analyzeAllMarkets}
                    disabled={isAnalyzing}
                    className="h-7 text-xs px-2"
                  >
                    {isAnalyzing ? (
                      <>
                        <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                        {analysisProgress}%
                      </>
                    ) : (
                      <>
                        <Scan className="w-3 h-3 mr-1" />
                        Analyze
                      </>
                    )}
                  </Button>
                  
                  {/* Export/Import */}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={exportSettings}
                    className="h-7 w-7 p-0"
                  >
                    <Download className="w-3 h-3" />
                  </Button>
                  
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const input = document.createElement('input');
                      input.type = 'file';
                      input.accept = '.json';
                      input.onchange = (e) => {
                        const file = (e.target as HTMLInputElement).files?.[0];
                        if (file) importSettings(file);
                      };
                      input.click();
                    }}
                    className="h-7 w-7 p-0"
                  >
                    <Upload className="w-3 h-3" />
                  </Button>
                  
                  {/* Clear All */}
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={clearAllData}
                    className="h-7 text-xs px-2"
                  >
                    <Trash2 className="w-3 h-3 mr-1" />
                    Clear
                  </Button>
                  
                  {/* Stop All */}
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={stopAllBots}
                    disabled={activeBots === 0}
                    className="h-7 text-xs px-2"
                  >
                    <StopCircle className="w-3 h-3 mr-1" />
                    Stop All
                  </Button>
                </div>
              </div>
              
              {/* Progress Bar */}
              {isAnalyzing && (
                <div className="mt-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                    <span>Analyzing markets...</span>
                    <span>{analysisProgress}%</span>
                  </div>
                  <Progress value={analysisProgress} className="h-1" />
                </div>
              )}
            </CardHeader>
            
            {/* Global Stats */}
            <CardContent className="p-3 pt-0">
              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-8 gap-2 text-xs">
                <div className="bg-muted/30 rounded-lg p-2">
                  <div className="text-muted-foreground">Balance</div>
                  <div className="font-bold text-sm">${balance?.toFixed(2) || '0.00'}</div>
                </div>
                <div className="bg-muted/30 rounded-lg p-2">
                  <div className="text-muted-foreground">Total P&L</div>
                  <div className={`font-bold text-sm ${totalProfit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {formatCurrency(totalProfit)}
                  </div>
                </div>
                <div className="bg-muted/30 rounded-lg p-2">
                  <div className="text-muted-foreground">Win Rate</div>
                  <div className="font-bold text-sm">{formatPercentage(winRate)}</div>
                </div>
                <div className="bg-muted/30 rounded-lg p-2">
                  <div className="text-muted-foreground">Trades</div>
                  <div className="font-bold text-sm">{totalTrades}</div>
                </div>
                <div className="bg-muted/30 rounded-lg p-2">
                  <div className="text-muted-foreground">Active</div>
                  <div className="font-bold text-sm">{runningBots}/{activeBots}</div>
                </div>
                <div className="bg-muted/30 rounded-lg p-2">
                  <div className="text-muted-foreground">Bots</div>
                  <div className="font-bold text-sm">{bots.length}</div>
                </div>
                <div className="bg-muted/30 rounded-lg p-2">
                  <div className="text-muted-foreground">Markets</div>
                  <div className="font-bold text-sm">{Object.keys(marketData).length}</div>
                </div>
                <div className="bg-muted/30 rounded-lg p-2">
                  <div className="text-muted-foreground">Win/Loss</div>
                  <div className="font-bold text-sm">
                    <span className="text-green-500">{totalWins}</span>/
                    <span className="text-red-500">{totalTrades - totalWins}</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ==================== TABS ==================== */}
          <Tabs value={selectedTab} onValueChange={setSelectedTab} className="space-y-4">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="bots" className="text-xs">🤖 Bots</TabsTrigger>
              <TabsTrigger value="analysis" className="text-xs">📊 Market Analysis</TabsTrigger>
              <TabsTrigger value="trades" className="text-xs">📝 Trade Log</TabsTrigger>
            </TabsList>

            {/* ==================== BOTS TAB ==================== */}
            <TabsContent value="bots" className="space-y-4">
              {/* Create Bot Button */}
              <Button
                onClick={() => {
                  const newBot: BotState = {
                    id: `bot-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    name: 'New Bot',
                    type: 'NEUTRAL',
                    market: 'R_100',
                    stake: globalSettings.defaultStake,
                    contractType: 'DIGITEVEN',
                    duration: 1,
                    durationUnit: 't',
                    
                    recoveryEnabled: true,
                    recoveryMultiplier: globalSettings.defaultMultiplier,
                    recoveryStopLoss: globalSettings.defaultStopLoss,
                    recoveryTakeProfit: globalSettings.defaultTakeProfit,
                    maxRecoveryAttempts: 5,
                    
                    maxConsecutiveContracts: 3,
                    stopOnProfit: true,
                    stopOnLoss: false,
                    autoRestart: false,
                    
                    isRunning: false,
                    isPaused: false,
                    status: 'idle',
                    
                    currentStake: globalSettings.defaultStake,
                    totalPnl: 0,
                    trades: 0,
                    wins: 0,
                    losses: 0,
                    consecutiveWins: 0,
                    consecutiveLosses: 0,
                    
                    currentRun: 0,
                    runsCompleted: 0,
                    entryTriggered: false,
                    recoveryMode: false,
                    recoveryAttempts: 0,
                    cooldownRemaining: 0,
                    
                    tickProgress: 0,
                    
                    expanded: true
                  };
                  setBots(prev => [...prev, newBot]);
                }}
                className="w-full sm:w-auto"
                size="sm"
              >
                <Plus className="w-4 h-4 mr-2" />
                Create New Bot
              </Button>

              {/* Bots Grid */}
              {bots.length === 0 ? (
                <Card>
                  <CardContent className="p-8 text-center">
                    <Brain className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                    <p className="text-muted-foreground">No bots created yet</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Click "Create New Bot" or run market analysis to auto-create bots
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  <AnimatePresence>
                    {bots.map(bot => (
                      <motion.div
                        key={bot.id}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                      >
                        <Card className={`border-2 ${
                          bot.isRunning ? 'border-green-500/50' : 
                          bot.recoveryMode ? 'border-orange-500/50' : 'border-border'
                        }`}>
                          {/* Bot Header */}
                          <CardHeader className="p-3 pb-0">
                            <div className="flex items-start justify-between">
                              <div className="flex items-center gap-2">
                                <div className={`p-1.5 rounded ${
                                  bot.type === 'TYPE_A' ? 'bg-blue-500/20 text-blue-500' :
                                  bot.type === 'TYPE_B' ? 'bg-red-500/20 text-red-500' :
                                  bot.type === 'EVEN_ODD' ? 'bg-green-500/20 text-green-500' :
                                  'bg-gray-500/20 text-gray-500'
                                }`}>
                                  {bot.type === 'TYPE_A' ? <TrendingUp className="w-4 h-4" /> :
                                   bot.type === 'TYPE_B' ? <TrendingDown className="w-4 h-4" /> :
                                   bot.type === 'EVEN_ODD' ? <CircleDot className="w-4 h-4" /> :
                                   <Brain className="w-4 h-4" />}
                                </div>
                                <div>
                                  <CardTitle className="text-sm flex items-center gap-1">
                                    {bot.name}
                                    {bot.recoveryMode && (
                                      <Badge variant="destructive" className="text-[8px] px-1 py-0">
                                        Recovery
                                      </Badge>
                                    )}
                                  </CardTitle>
                                  <CardDescription className="text-xs">
                                    {VOLATILITY_MARKETS.find(m => m.value === bot.market)?.icon} {bot.market}
                                  </CardDescription>
                                </div>
                              </div>
                              
                              <div className="flex items-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => duplicateBot(bot)}
                                  className="h-6 w-6 p-0"
                                >
                                  <Copy className="w-3 h-3" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => removeBot(bot.id)}
                                  className="h-6 w-6 p-0 text-red-500"
                                  disabled={bot.isRunning}
                                >
                                  <XCircle className="w-3 h-3" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setBots(prev => prev.map(b => 
                                    b.id === bot.id ? { ...b, expanded: !b.expanded } : b
                                  ))}
                                  className="h-6 w-6 p-0"
                                >
                                  {bot.expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                </Button>
                              </div>
                            </div>
                          </CardHeader>

                          {/* Bot Stats Preview */}
                          <CardContent className="p-3">
                            <div className="grid grid-cols-4 gap-1 text-xs mb-2">
                              <div>
                                <div className="text-muted-foreground">P&L</div>
                                <div className={`font-bold ${bot.totalPnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                  {formatCurrency(bot.totalPnl)}
                                </div>
                              </div>
                              <div>
                                <div className="text-muted-foreground">W/L</div>
                                <div>
                                  <span className="text-green-500">{bot.wins}</span>
                                  <span className="text-muted-foreground">/</span>
                                  <span className="text-red-500">{bot.losses}</span>
                                </div>
                              </div>
                              <div>
                                <div className="text-muted-foreground">Stake</div>
                                <div>{formatCurrency(bot.currentStake)}</div>
                              </div>
                              <div>
                                <div className="text-muted-foreground">Status</div>
                                <div className={`flex items-center gap-0.5 ${getStatusColor(bot.status)}`}>
                                  {getStatusIcon(bot.status)}
                                  <span className="text-[10px] capitalize">{bot.status}</span>
                                </div>
                              </div>
                            </div>

                            {/* Progress Bar */}
                            <div className="mb-2">
                              <div className="flex justify-between text-[8px] text-muted-foreground mb-0.5">
                                <span>Run {bot.runsCompleted + 1}/{bot.maxConsecutiveContracts}</span>
                                <span>{Math.round(bot.tickProgress)}%</span>
                              </div>
                              <Progress value={bot.tickProgress} className="h-1" />
                            </div>
                          </CardContent>

                          {/* Expanded Settings */}
                          <AnimatePresence>
                            {bot.expanded && (
                              <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                              >
                                <CardContent className="p-3 pt-0 space-y-3">
                                  <Separator />
                                  
                                  {/* Basic Settings */}
                                  <div className="grid grid-cols-2 gap-2">
                                    <div>
                                      <Label className="text-xs">Market</Label>
                                      <Select
                                        value={bot.market}
                                        onValueChange={(value) => updateBotConfig(bot.id, { market: value })}
                                        disabled={bot.isRunning}
                                      >
                                        <SelectTrigger className="h-8 text-xs">
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {VOLATILITY_MARKETS.map(market => (
                                            <SelectItem key={market.value} value={market.value} className="text-xs">
                                              {market.icon} {market.label}
                                            </SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    </div>
                                    
                                    <div>
                                      <Label className="text-xs">Contract Type</Label>
                                      <Select
                                        value={bot.contractType}
                                        onValueChange={(value) => updateBotConfig(bot.id, { contractType: value })}
                                        disabled={bot.isRunning}
                                      >
                                        <SelectTrigger className="h-8 text-xs">
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {Object.entries(CONTRACT_TYPES).map(([value, { label, icon }]) => (
                                            <SelectItem key={value} value={value} className="text-xs">
                                              {icon} {label}
                                            </SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    </div>
                                    
                                    <div>
                                      <Label className="text-xs">Stake ($)</Label>
                                      <Input
                                        type="number"
                                        value={bot.stake}
                                        onChange={(e) => updateBotConfig(bot.id, { 
                                          stake: parseFloat(e.target.value) || 0 
                                        })}
                                        disabled={bot.isRunning}
                                        className="h-8 text-xs"
                                        step="0.1"
                                        min="0.1"
                                      />
                                    </div>
                                    
                                    <div>
                                      <Label className="text-xs">Duration</Label>
                                      <div className="flex gap-1">
                                        <Input
                                          type="number"
                                          value={bot.duration}
                                          onChange={(e) => updateBotConfig(bot.id, { 
                                            duration: parseInt(e.target.value) || 1 
                                          })}
                                          disabled={bot.isRunning}
                                          className="h-8 text-xs w-16"
                                          min="1"
                                        />
                                        <Select
                                          value={bot.durationUnit}
                                          onValueChange={(value: 't' | 'm' | 'h') => 
                                            updateBotConfig(bot.id, { durationUnit: value })
                                          }
                                          disabled={bot.isRunning}
                                        >
                                          <SelectTrigger className="h-8 text-xs w-16">
                                            <SelectValue />
                                          </SelectTrigger>
                                          <SelectContent>
                                            {DURATION_UNITS.map(unit => (
                                              <SelectItem key={unit.value} value={unit.value} className="text-xs">
                                                {unit.label}
                                              </SelectItem>
                                            ))}
                                          </SelectContent>
                                        </Select>
                                      </div>
                                    </div>
                                  </div>

                                  {/* Recovery Settings */}
                                  <div>
                                    <div className="flex items-center justify-between mb-2">
                                      <Label className="text-xs font-medium">Recovery Settings</Label>
                                      <Switch
                                        checked={bot.recoveryEnabled}
                                        onCheckedChange={(checked) => 
                                          updateBotConfig(bot.id, { recoveryEnabled: checked })
                                        }
                                        disabled={bot.isRunning}
                                      />
                                    </div>
                                    
                                    {bot.recoveryEnabled && (
                                      <div className="grid grid-cols-2 gap-2">
                                        <div>
                                          <Label className="text-xs">Multiplier</Label>
                                          <Input
                                            type="number"
                                            value={bot.recoveryMultiplier}
                                            onChange={(e) => updateBotConfig(bot.id, { 
                                              recoveryMultiplier: parseFloat(e.target.value) || 1 
                                            })}
                                            disabled={bot.isRunning}
                                            className="h-8 text-xs"
                                            step="0.1"
                                            min="1.1"
                                          />
                                        </div>
                                        <div>
                                          <Label className="text-xs">Max Attempts</Label>
                                          <Input
                                            type="number"
                                            value={bot.maxRecoveryAttempts}
                                            onChange={(e) => updateBotConfig(bot.id, { 
                                              maxRecoveryAttempts: parseInt(e.target.value) || 1 
                                            })}
                                            disabled={bot.isRunning}
                                            className="h-8 text-xs"
                                            min="1"
                                            max="10"
                                          />
                                        </div>
                                        <div>
                                          <Label className="text-xs">Stop Loss ($)</Label>
                                          <Input
                                            type="number"
                                            value={bot.recoveryStopLoss}
                                            onChange={(e) => updateBotConfig(bot.id, { 
                                              recoveryStopLoss: parseFloat(e.target.value) || 0 
                                            })}
                                            disabled={bot.isRunning}
                                            className="h-8 text-xs"
                                            step="5"
                                          />
                                        </div>
                                        <div>
                                          <Label className="text-xs">Take Profit ($)</Label>
                                          <Input
                                            type="number"
                                            value={bot.recoveryTakeProfit}
                                            onChange={(e) => updateBotConfig(bot.id, { 
                                              recoveryTakeProfit: parseFloat(e.target.value) || 0 
                                            })}
                                            disabled={bot.isRunning}
                                            className="h-8 text-xs"
                                            step="5"
                                          />
                                        </div>
                                      </div>
                                    )}
                                  </div>

                                  {/* Run Settings */}
                                  <div className="grid grid-cols-2 gap-2">
                                    <div>
                                      <Label className="text-xs">Consecutive Contracts</Label>
                                      <Input
                                        type="number"
                                        value={bot.maxConsecutiveContracts}
                                        onChange={(e) => updateBotConfig(bot.id, { 
                                          maxConsecutiveContracts: parseInt(e.target.value) || 1 
                                        })}
                                        disabled={bot.isRunning}
                                        className="h-8 text-xs"
                                        min="1"
                                        max="10"
                                      />
                                    </div>
                                    <div className="flex items-center justify-between">
                                      <Label className="text-xs">Stop on Profit</Label>
                                      <Switch
                                        checked={bot.stopOnProfit}
                                        onCheckedChange={(checked) => 
                                          updateBotConfig(bot.id, { stopOnProfit: checked })
                                        }
                                        disabled={bot.isRunning}
                                      />
                                    </div>
                                    <div className="flex items-center justify-between">
                                      <Label className="text-xs">Auto Restart</Label>
                                      <Switch
                                        checked={bot.autoRestart}
                                        onCheckedChange={(checked) => 
                                          updateBotConfig(bot.id, { autoRestart: checked })
                                        }
                                        disabled={bot.isRunning}
                                      />
                                    </div>
                                  </div>
                                </CardContent>

                                {/* Bot Actions */}
                                <CardFooter className="p-3 pt-0 flex gap-2">
                                  {!bot.isRunning ? (
                                    <Button
                                      onClick={() => startBot(bot.id)}
                                      disabled={!isAuthorized || balance < bot.currentStake || activeTradeId !== null}
                                      className="flex-1 h-8 text-xs"
                                      size="sm"
                                    >
                                      <Play className="w-3 h-3 mr-1" />
                                      Start
                                    </Button>
                                  ) : (
                                    <>
                                      <Button
                                        onClick={() => pauseBot(bot.id)}
                                        variant={bot.isPaused ? "default" : "outline"}
                                        className="flex-1 h-8 text-xs"
                                        size="sm"
                                      >
                                        <Pause className="w-3 h-3 mr-1" />
                                        {bot.isPaused ? 'Resume' : 'Pause'}
                                      </Button>
                                      <Button
                                        onClick={() => stopBot(bot.id)}
                                        variant="destructive"
                                        className="flex-1 h-8 text-xs"
                                        size="sm"
                                      >
                                        <StopCircle className="w-3 h-3 mr-1" />
                                        Stop
                                      </Button>
                                    </>
                                  )}
                                </CardFooter>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </Card>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </TabsContent>

            {/* ==================== MARKET ANALYSIS TAB ==================== */}
            <TabsContent value="analysis">
              <Card>
                <CardHeader className="p-3">
                  <CardTitle className="text-sm">Market Analysis</CardTitle>
                  <CardDescription className="text-xs">
                    Digit distribution analysis for all markets
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-3 pt-0">
                  <div className="space-y-2 max-h-[500px] overflow-y-auto">
                    {Object.entries(marketData).map(([symbol, data]) => (
                      <Card key={symbol} className="border">
                        <CardHeader className="p-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-lg">
                                {VOLATILITY_MARKETS.find(m => m.value === symbol)?.icon}
                              </span>
                              <div>
                                <h4 className="text-sm font-medium">{symbol}</h4>
                                <p className="text-[10px] text-muted-foreground">
                                  Updated: {data.lastUpdated.toLocaleTimeString()}
                                </p>
                              </div>
                            </div>
                            <Badge variant={
                              data.analysis.marketType === 'TYPE_A' ? 'default' :
                              data.analysis.marketType === 'TYPE_B' ? 'destructive' :
                              data.analysis.marketType === 'EVEN_ODD' ? 'secondary' : 'outline'
                            } className="text-[8px]">
                              {data.analysis.marketType}
                            </Badge>
                          </div>
                        </CardHeader>
                        <CardContent className="p-2 pt-0">
                          {/* Digit Distribution */}
                          <div className="grid grid-cols-5 gap-1 mb-2">
                            {[0,1,2,3,4,5,6,7,8,9].map(digit => {
                              const percentage = data.analysis.digitPercentages[digit] || 0;
                              let bgColor = 'bg-gray-500/20';
                              if (percentage > 12) bgColor = 'bg-green-500/20';
                              else if (percentage < 8) bgColor = 'bg-red-500/20';
                              else if (percentage > 10) bgColor = 'bg-yellow-500/20';
                              
                              return (
                                <Tooltip key={digit}>
                                  <TooltipTrigger>
                                    <div className="text-center">
                                      <div className={`${bgColor} rounded p-1`}>
                                        <div className="text-xs font-bold">{digit}</div>
                                        <div className="text-[8px]">{percentage.toFixed(1)}%</div>
                                      </div>
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p className="text-xs">Digit {digit}: {data.analysis.digitCounts[digit] || 0} times</p>
                                  </TooltipContent>
                                </Tooltip>
                              );
                            })}
                          </div>

                          {/* Analysis Metrics */}
                          <div className="grid grid-cols-3 gap-2 text-xs">
                            <div>
                              <span className="text-muted-foreground">Low (0-2):</span>
                              <span className={`ml-1 font-bold ${
                                data.analysis.lowDigitsPercentage < 10 ? 'text-red-500' : ''
                              }`}>
                                {data.analysis.lowDigitsPercentage.toFixed(1)}%
                              </span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">High (7-9):</span>
                              <span className={`ml-1 font-bold ${
                                data.analysis.highDigitsPercentage < 10 ? 'text-red-500' : ''
                              }`}>
                                {data.analysis.highDigitsPercentage.toFixed(1)}%
                              </span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Even:</span>
                              <span className={`ml-1 font-bold ${
                                data.analysis.evenPercentage > 55 ? 'text-green-500' : ''
                              }`}>
                                {data.analysis.evenPercentage.toFixed(1)}%
                              </span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Odd:</span>
                              <span className={`ml-1 font-bold ${
                                data.analysis.oddPercentage > 55 ? 'text-green-500' : ''
                              }`}>
                                {data.analysis.oddPercentage.toFixed(1)}%
                              </span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Confidence:</span>
                              <span className="ml-1 font-bold">
                                {data.analysis.confidence.toFixed(0)}%
                              </span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Ticks:</span>
                              <span className="ml-1 font-bold">
                                {data.ticks.length}
                              </span>
                            </div>
                          </div>

                          {/* Most/Least Appearing */}
                          <div className="flex justify-between mt-2 text-[10px]">
                            <div>
                              <span className="text-muted-foreground">Most:</span>
                              <span className="ml-1 font-bold">
                                {data.analysis.mostAppearingDigits.join(', ')}
                              </span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Least:</span>
                              <span className="ml-1 font-bold">
                                {data.analysis.leastAppearingDigits.join(', ')}
                              </span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Rec:</span>
                              <span className="ml-1 font-bold">
                                {data.analysis.recommendedEntry}
                              </span>
                            </div>
                          </div>

                          {/* Create Bot Button */}
                          {data.analysis.marketType !== 'NEUTRAL' && data.analysis.confidence > 70 && (
                            <Button
                              onClick={() => createBotFromAnalysis(symbol, data.analysis)}
                              size="sm"
                              className="w-full mt-2 h-6 text-[10px]"
                            >
                              <Brain className="w-3 h-3 mr-1" />
                              Create Bot
                            </Button>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ==================== TRADE LOG TAB ==================== */}
            <TabsContent value="trades">
              <Card>
                <CardHeader className="p-3">
                  <CardTitle className="text-sm">Trade History</CardTitle>
                  <CardDescription className="text-xs">
                    Last 100 trades
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-3 pt-0">
                  {tradeLogs.length === 0 ? (
                    <div className="text-center py-8">
                      <FileText className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                      <p className="text-muted-foreground">No trades yet</p>
                    </div>
                  ) : (
                    <div className="space-y-1 max-h-[500px] overflow-y-auto">
                      {tradeLogs.map(trade => (
                        <div
                          key={trade.id}
                          className={`flex items-center justify-between p-2 rounded text-xs ${
                            trade.result === 'win' ? 'bg-green-500/10' :
                            trade.result === 'loss' ? 'bg-red-500/10' :
                            'bg-yellow-500/10'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground">
                              {trade.timestamp.toLocaleTimeString()}
                            </span>
                            <Badge variant="outline" className="text-[8px]">
                              {trade.botName}
                            </Badge>
                            <span className="font-mono">
                              {trade.market}
                            </span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="font-mono">
                              {formatCurrency(trade.stake)}
                            </span>
                            {trade.digit !== undefined && (
                              <span className="text-muted-foreground">
                                Digit: {trade.digit}
                              </span>
                            )}
                            <span className={`font-bold ${
                              trade.result === 'win' ? 'text-green-500' :
                              trade.result === 'loss' ? 'text-red-500' :
                              'text-yellow-500'
                            }`}>
                              {trade.result === 'win' ? `+${formatCurrency(trade.profit)}` :
                               trade.result === 'loss' ? `-${formatCurrency(Math.abs(trade.profit))}` :
                               'Pending'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </TooltipProvider>
  );
}
