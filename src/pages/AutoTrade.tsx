import { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Play, StopCircle, Settings, TrendingUp, TrendingDown, Zap, Shield, Target, 
  Copy, Plus, Trash2, Eye, EyeOff, Bot, RefreshCw, Users, Crown, 
  BarChart3, Activity, AlertCircle, CheckCircle, XCircle, Clock
} from 'lucide-react';
import { toast } from 'sonner';
import { derivApi, type MarketSymbol } from '@/services/deriv-api';
import { getLastDigit } from '@/services/analysis';
import { useAuth } from '@/contexts/AuthContext';
import { useLossRequirement } from '@/hooks/useLossRequirement';

interface Signal {
  id: string;
  type: string;
  name: string;
  strength: number;
  symbol: string;
  detail: string;
  extra: string;
  direction: 'OVER' | 'UNDER' | 'ODD' | 'EVEN' | 'RISE' | 'FALL';
  timestamp: Date;
}

interface BotConfig {
  id: string;
  name: string;
  enabled: boolean;
  signalType: string | null;
  symbol: string | null;
  stake: number;
  martingaleMultiplier: number;
  martingaleMaxSteps: number;
  takeProfit: number;
  stopLoss: number;
  recoveryThreshold: number;
  isCopyTrading: boolean;
  masterBotId?: string;
  copyRatio?: number;
}

interface BotInstance {
  id: string;
  config: BotConfig;
  status: 'idle' | 'running' | 'paused' | 'recovery';
  currentStake: number;
  martingaleStep: number;
  consecutiveLosses: number;
  totalPnL: number;
  totalTrades: number;
  wins: number;
  losses: number;
  lastTrade: Date | null;
  activeSignal: Signal | null;
}

interface TradeLog {
  id: string;
  botId: string;
  botName: string;
  time: Date;
  symbol: string;
  signalType: string;
  direction: string;
  stake: number;
  result: 'Win' | 'Loss' | 'Pending';
  pnl: number;
  balance: number;
  isCopyTrade: boolean;
}

const VOLATILITIES = {
  vol: ["1HZ10V", "1HZ25V", "1HZ50V", "1HZ75V", "1HZ100V", "R_10", "R_25", "R_50", "R_75", "R_100"],
  jump: ["JD10", "JD25", "JD50", "JD75", "JD100"],
  bull: ["RDBULL"],
  bear: ["RDBEAR"],
};

const TICK_DEPTH = 1000;
let signalIdCounter = 0;
let botIdCounter = 0;

// Helper: compute digit frequencies
function computeDigitStats(ticks: number[], thresholdDigit: number) {
  if (!ticks || ticks.length < 100) return null;
  const recent = ticks.slice(-TICK_DEPTH);
  const freq = Array(10).fill(0);
  recent.forEach(d => { if (d >= 0 && d <= 9) freq[d]++; });

  let entries = freq.map((count, digit) => ({ digit, count }));
  entries.sort((a, b) => b.count - a.count);
  const mostAppearing = entries[0]?.digit ?? 0;
  const secondMost = entries[1]?.digit ?? mostAppearing;
  const leastAppearing = (() => {
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].count > 0) return entries[i].digit;
    }
    return 0;
  })();

  let overCount = 0, underCount = 0;
  recent.forEach(d => { if (d > thresholdDigit) overCount++; else if (d < thresholdDigit) underCount++; });
  let oddCount = 0, evenCount = 0;
  recent.forEach(d => { if (d % 2 === 0) evenCount++; else oddCount++; });

  return {
    mostAppearing,
    secondMost,
    leastAppearing,
    overRate: overCount / recent.length,
    underRate: underCount / recent.length,
    oddRate: oddCount / recent.length,
    evenRate: evenCount / recent.length,
    totalTicks: recent.length
  };
}

// Wait for next tick
function waitForNextTick(symbol: string): Promise<{ quote: number }> {
  return new Promise((resolve) => {
    const unsub = derivApi.onMessage((data: any) => {
      if (data.tick && data.tick.symbol === symbol) {
        unsub();
        resolve({ quote: data.tick.quote });
      }
    });
  });
}

// Generate signals from tick data
function generateSignalsFromTicks(ticksMap: Map<string, number[]>, contractType: string): Signal[] {
  const signals: Signal[] = [];
  
  for (const [symbol, ticks] of ticksMap.entries()) {
    if (!ticks || ticks.length < 200) continue;
    const stats = computeDigitStats(ticks, 5);
    if (!stats) continue;
    
    const { mostAppearing, secondMost, leastAppearing, overRate, underRate, oddRate, evenRate } = stats;
    
    if (contractType === 'overunder') {
      // OVER signal
      if (mostAppearing >= 5) {
        const strength = 0.68 + (overRate * 0.25);
        if (secondMost >= 5) strength + 0.08;
        signals.push({
          id: `sig_${Date.now()}_${signalIdCounter++}`,
          type: "Under/Over",
          name: "📈 OVER",
          strength: Math.min(0.96, strength),
          symbol: symbol,
          detail: `Most digit ${mostAppearing} in 5-9 zone | Over rate ${(overRate * 100).toFixed(0)}%`,
          extra: `Threshold 5 | Most:${mostAppearing} 2nd:${secondMost}`,
          direction: 'OVER',
          timestamp: new Date()
        });
      }
      
      // UNDER signal
      if (mostAppearing <= 6) {
        const strength = 0.68 + (underRate * 0.25);
        if (secondMost <= 6) strength + 0.08;
        signals.push({
          id: `sig_${Date.now()}_${signalIdCounter++}`,
          type: "Under/Over",
          name: "📉 UNDER",
          strength: Math.min(0.96, strength),
          symbol: symbol,
          detail: `Most digit ${mostAppearing} in 0-6 zone | Under rate ${(underRate * 100).toFixed(0)}%`,
          extra: `Threshold 5 | Most:${mostAppearing} 2nd:${secondMost}`,
          direction: 'UNDER',
          timestamp: new Date()
        });
      }
    }
    
    if (contractType === 'evenodd') {
      // ODD signal
      if (mostAppearing % 2 === 1) {
        const strength = 0.65 + (oddRate * 0.25);
        signals.push({
          id: `sig_${Date.now()}_${signalIdCounter++}`,
          type: "Odd/Even",
          name: "🎲 ODD",
          strength: Math.min(0.94, strength),
          symbol: symbol,
          detail: `Most digit ${mostAppearing} (odd) | Odd winrate ${(oddRate * 100).toFixed(0)}%`,
          extra: `Most digit ${mostAppearing} → Odd bias`,
          direction: 'ODD',
          timestamp: new Date()
        });
      }
      
      // EVEN signal
      if (mostAppearing % 2 === 0) {
        const strength = 0.65 + (evenRate * 0.25);
        signals.push({
          id: `sig_${Date.now()}_${signalIdCounter++}`,
          type: "Odd/Even",
          name: "🎲 EVEN",
          strength: Math.min(0.94, strength),
          symbol: symbol,
          detail: `Most digit ${mostAppearing} (even) | Even winrate ${(evenRate * 100).toFixed(0)}%`,
          extra: `Most digit ${mostAppearing} → Even bias`,
          direction: 'EVEN',
          timestamp: new Date()
        });
      }
    }
  }
  
  signals.sort((a, b) => b.strength - a.strength);
  return signals;
}

export function MultiBotSignalForge() {
  const { isAuthorized, balance, activeAccount } = useAuth();
  const { recordLoss } = useLossRequirement();

  // Signal State
  const [contractType, setContractType] = useState<'overunder' | 'evenodd'>('overunder');
  const [marketGroup, setMarketGroup] = useState<'all' | 'vol' | 'jump' | 'bull' | 'bear'>('all');
  const [liveSignals, setLiveSignals] = useState<Signal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [connectedMarkets, setConnectedMarkets] = useState(0);
  const [selectedSignal, setSelectedSignal] = useState<Signal | null>(null);
  const [showCreateBotDialog, setShowCreateBotDialog] = useState(false);

  // Bot State
  const [bots, setBots] = useState<BotInstance[]>([]);
  const [tradeLogs, setTradeLogs] = useState<TradeLog[]>([]);
  const [globalPnL, setGlobalPnL] = useState(0);
  const [globalTrades, setGlobalTrades] = useState(0);
  
  const ticksMapRef = useRef<Map<string, number[]>>(new Map());
  const wsConnectionsRef = useRef<Map<string, WebSocket>>(new Map());
  const runningBotsRef = useRef<Set<string>>(new Set());
  const botIntervalsRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // Load default bots on init (minimum 5 bots)
  useEffect(() => {
    const defaultBots: BotInstance[] = [
      {
        id: `bot_${Date.now()}_1`,
        config: {
          id: `bot_${Date.now()}_1`,
          name: "OVER Aggressor",
          enabled: true,
          signalType: "OVER",
          symbol: null,
          stake: 0.5,
          martingaleMultiplier: 2,
          martingaleMaxSteps: 3,
          takeProfit: 10,
          stopLoss: 5,
          recoveryThreshold: 3,
          isCopyTrading: false,
        },
        status: 'idle',
        currentStake: 0.5,
        martingaleStep: 0,
        consecutiveLosses: 0,
        totalPnL: 0,
        totalTrades: 0,
        wins: 0,
        losses: 0,
        lastTrade: null,
        activeSignal: null,
      },
      {
        id: `bot_${Date.now()}_2`,
        config: {
          id: `bot_${Date.now()}_2`,
          name: "UNDER Hunter",
          enabled: true,
          signalType: "UNDER",
          symbol: null,
          stake: 0.5,
          martingaleMultiplier: 2,
          martingaleMaxSteps: 3,
          takeProfit: 10,
          stopLoss: 5,
          recoveryThreshold: 8,
          isCopyTrading: false,
        },
        status: 'idle',
        currentStake: 0.5,
        martingaleStep: 0,
        consecutiveLosses: 0,
        totalPnL: 0,
        totalTrades: 0,
        wins: 0,
        losses: 0,
        lastTrade: null,
        activeSignal: null,
      },
      {
        id: `bot_${Date.now()}_3`,
        config: {
          id: `bot_${Date.now()}_3`,
          name: "ODD Seeker",
          enabled: true,
          signalType: "ODD",
          symbol: null,
          stake: 0.5,
          martingaleMultiplier: 2,
          martingaleMaxSteps: 3,
          takeProfit: 10,
          stopLoss: 5,
          recoveryThreshold: 3,
          isCopyTrading: false,
        },
        status: 'idle',
        currentStake: 0.5,
        martingaleStep: 0,
        consecutiveLosses: 0,
        totalPnL: 0,
        totalTrades: 0,
        wins: 0,
        losses: 0,
        lastTrade: null,
        activeSignal: null,
      },
      {
        id: `bot_${Date.now()}_4`,
        config: {
          id: `bot_${Date.now()}_4`,
          name: "EVEN Master",
          enabled: true,
          signalType: "EVEN",
          symbol: null,
          stake: 0.5,
          martingaleMultiplier: 2,
          martingaleMaxSteps: 3,
          takeProfit: 10,
          stopLoss: 5,
          recoveryThreshold: 3,
          isCopyTrading: false,
        },
        status: 'idle',
        currentStake: 0.5,
        martingaleStep: 0,
        consecutiveLosses: 0,
        totalPnL: 0,
        totalTrades: 0,
        wins: 0,
        losses: 0,
        lastTrade: null,
        activeSignal: null,
      },
      {
        id: `bot_${Date.now()}_5`,
        config: {
          id: `bot_${Date.now()}_5`,
          name: "Signal Follower",
          enabled: true,
          signalType: null,
          symbol: null,
          stake: 0.5,
          martingaleMultiplier: 2,
          martingaleMaxSteps: 3,
          takeProfit: 10,
          stopLoss: 5,
          recoveryThreshold: 3,
          isCopyTrading: true,
          masterBotId: `bot_${Date.now()}_1`,
          copyRatio: 0.5,
        },
        status: 'idle',
        currentStake: 0.25,
        martingaleStep: 0,
        consecutiveLosses: 0,
        totalPnL: 0,
        totalTrades: 0,
        wins: 0,
        losses: 0,
        lastTrade: null,
        activeSignal: null,
      },
    ];
    setBots(defaultBots);
  }, []);

  // Connect to WebSocket for market data
  const connectMarket = useCallback((symbol: string) => {
    if (wsConnectionsRef.current.has(symbol)) return;
    
    const ws = new WebSocket("wss://ws.binaryws.com/websockets/v3?app_id=1089");
    const ticks: number[] = [];
    
    ws.onopen = () => {
      ws.send(JSON.stringify({ ticks_history: symbol, count: TICK_DEPTH, end: "latest", style: "ticks" }));
    };
    
    ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data);
      if (data.history && data.history.prices) {
        data.history.prices.forEach((p: string) => {
          const digit = parseInt(parseFloat(p).toFixed(2).slice(-1));
          if (!isNaN(digit)) ticks.push(digit);
        });
        while (ticks.length > 2500) ticks.shift();
        ticksMapRef.current.set(symbol, [...ticks]);
        ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
      }
      if (data.tick && data.tick.quote) {
        const digit = parseInt(parseFloat(data.tick.quote).toFixed(2).slice(-1));
        if (!isNaN(digit)) {
          ticks.push(digit);
          if (ticks.length > 2500) ticks.shift();
          ticksMapRef.current.set(symbol, [...ticks]);
          // Update signals on every tick
          const newSignals = generateSignalsFromTicks(ticksMapRef.current, contractType);
          setLiveSignals(newSignals.slice(0, 10));
        }
      }
    };
    
    wsConnectionsRef.current.set(symbol, ws);
  }, [contractType]);

  const loadGroup = useCallback((group: string) => {
    wsConnectionsRef.current.forEach((ws) => ws.close());
    wsConnectionsRef.current.clear();
    ticksMapRef.current.clear();
    
    let symbols: string[] = [];
    if (group === "all") {
      symbols = [...VOLATILITIES.vol, ...VOLATILITIES.jump, ...VOLATILITIES.bull, ...VOLATILITIES.bear];
    } else if (group === "vol") {
      symbols = VOLATILITIES.vol;
    } else if (group === "jump") {
      symbols = VOLATILITIES.jump;
    } else if (group === "bull") {
      symbols = VOLATILITIES.bull;
    } else if (group === "bear") {
      symbols = VOLATILITIES.bear;
    }
    
    setIsLoading(true);
    symbols.forEach(symbol => connectMarket(symbol));
    
    setTimeout(() => {
      setConnectedMarkets(ticksMapRef.current.size);
      setIsLoading(false);
    }, 3000);
  }, [connectMarket]);

  // Execute a trade for a specific bot
  const executeTradeForBot = useCallback(async (bot: BotInstance, signal: Signal) => {
    if (!isAuthorized) return null;
    
    const tradeId = `trade_${Date.now()}_${bot.id}`;
    const now = new Date();
    
    // Determine contract type based on signal direction
    let contractTypeParam = '';
    let barrier = '';
    
    if (signal.direction === 'OVER') {
      contractTypeParam = 'DIGITOVER';
      barrier = '5';
    } else if (signal.direction === 'UNDER') {
      contractTypeParam = 'DIGITUNDER';
      barrier = '5';
    } else if (signal.direction === 'ODD') {
      contractTypeParam = 'DIGITODD';
    } else if (signal.direction === 'EVEN') {
      contractTypeParam = 'DIGITEVEN';
    }
    
    // Add to logs as pending
    setTradeLogs(prev => [{
      id: tradeId,
      botId: bot.id,
      botName: bot.config.name,
      time: now,
      symbol: signal.symbol,
      signalType: signal.type,
      direction: signal.direction,
      stake: bot.currentStake,
      result: 'Pending',
      pnl: 0,
      balance: balance,
      isCopyTrade: bot.config.isCopyTrading,
    }, ...prev].slice(0, 200));
    
    try {
      await waitForNextTick(signal.symbol as MarketSymbol);
      
      const buyParams: any = {
        contract_type: contractTypeParam,
        symbol: signal.symbol,
        duration: 1,
        duration_unit: 't',
        basis: 'stake',
        amount: bot.currentStake,
      };
      if (barrier) buyParams.barrier = barrier;
      
      const { contractId } = await derivApi.buyContract(buyParams);
      const result = await derivApi.waitForContractResult(contractId);
      const won = result.status === 'won';
      const pnl = result.profit;
      
      // Update bot stats
      const newConsecutiveLosses = won ? 0 : bot.consecutiveLosses + 1;
      const newStatus = (newConsecutiveLosses >= bot.config.recoveryThreshold && !won) ? 'recovery' : bot.status;
      
      let newStake = bot.currentStake;
      let newMartingaleStep = bot.martingaleStep;
      
      if (!won && bot.config.martingaleMultiplier > 1 && bot.martingaleStep < bot.config.martingaleMaxSteps) {
        newStake = bot.currentStake * bot.config.martingaleMultiplier;
        newMartingaleStep = bot.martingaleStep + 1;
      } else if (won) {
        newStake = bot.config.stake;
        newMartingaleStep = 0;
      }
      
      const newTotalPnL = bot.totalPnL + pnl;
      const newTotalTrades = bot.totalTrades + 1;
      const newWins = bot.wins + (won ? 1 : 0);
      const newLosses = bot.losses + (won ? 0 : 1);
      
      // Update bot
      setBots(prev => prev.map(b => 
        b.id === bot.id ? {
          ...b,
          status: newStatus,
          currentStake: newStake,
          martingaleStep: newMartingaleStep,
          consecutiveLosses: newConsecutiveLosses,
          totalPnL: newTotalPnL,
          totalTrades: newTotalTrades,
          wins: newWins,
          losses: newLosses,
          lastTrade: now,
          activeSignal: signal,
        } : b
      ));
      
      // Update trade log
      setTradeLogs(prev => prev.map(log => 
        log.id === tradeId ? { ...log, result: won ? 'Win' : 'Loss', pnl, balance: balance + pnl } : log
      ));
      
      // Update global stats
      setGlobalPnL(prev => prev + pnl);
      setGlobalTrades(prev => prev + 1);
      
      // Record loss for virtual trading
      if (!won && activeAccount?.is_virtual) {
        recordLoss(bot.currentStake, signal.symbol, 6000);
      }
      
      // Copy trading: notify copy bots
      if (!bot.config.isCopyTrading && bot.config.isCopyTrading === false) {
        setBots(prev => prev.map(copyBot => {
          if (copyBot.config.isCopyTrading && copyBot.config.masterBotId === bot.id) {
            const copyStake = bot.currentStake * (copyBot.config.copyRatio || 0.5);
            // Schedule copy trade
            setTimeout(() => {
              executeTradeForBot({ ...copyBot, currentStake: copyStake }, signal);
            }, 100);
            return copyBot;
          }
          return copyBot;
        }));
      }
      
      // Check TP/SL for this bot
      if (newTotalPnL >= bot.config.takeProfit) {
        toast.success(`${bot.config.name}: 🎯 Take Profit reached! +$${newTotalPnL.toFixed(2)}`);
        setBots(prev => prev.map(b => b.id === bot.id ? { ...b, status: 'idle' } : b));
        runningBotsRef.current.delete(bot.id);
        if (botIntervalsRef.current.has(bot.id)) {
          clearInterval(botIntervalsRef.current.get(bot.id));
          botIntervalsRef.current.delete(bot.id);
        }
      }
      if (newTotalPnL <= -bot.config.stopLoss) {
        toast.error(`${bot.config.name}: 🛑 Stop Loss reached! $${newTotalPnL.toFixed(2)}`);
        setBots(prev => prev.map(b => b.id === bot.id ? { ...b, status: 'idle' } : b));
        runningBotsRef.current.delete(bot.id);
        if (botIntervalsRef.current.has(bot.id)) {
          clearInterval(botIntervalsRef.current.get(bot.id));
          botIntervalsRef.current.delete(bot.id);
        }
      }
      
      return { won, pnl };
    } catch (err: any) {
      setTradeLogs(prev => prev.map(log => 
        log.id === tradeId ? { ...log, result: 'Loss', pnl: -bot.currentStake } : log
      ));
      setBots(prev => prev.map(b => 
        b.id === bot.id ? { ...b, totalPnL: b.totalPnL - bot.currentStake, totalTrades: b.totalTrades + 1, losses: b.losses + 1 } : b
      ));
      setGlobalPnL(prev => prev - bot.currentStake);
      setGlobalTrades(prev => prev + 1);
      return { won: false, pnl: -bot.currentStake };
    }
  }, [isAuthorized, balance, activeAccount, recordLoss]);

  // Start a specific bot
  const startBot = useCallback(async (botId: string) => {
    const bot = bots.find(b => b.id === botId);
    if (!bot || !bot.config.enabled) return;
    if (runningBotsRef.current.has(botId)) return;
    
    runningBotsRef.current.add(botId);
    setBots(prev => prev.map(b => b.id === botId ? { ...b, status: 'running' } : b));
    
    const interval = setInterval(async () => {
      const currentBot = bots.find(b => b.id === botId);
      if (!currentBot || currentBot.status !== 'running') {
        clearInterval(interval);
        botIntervalsRef.current.delete(botId);
        runningBotsRef.current.delete(botId);
        return;
      }
      
      // Find matching signal for this bot
      let matchingSignal: Signal | null = null;
      
      if (currentBot.config.signalType) {
        matchingSignal = liveSignals.find(s => s.direction === currentBot.config.signalType) || null;
      } else if (currentBot.config.symbol) {
        matchingSignal = liveSignals.find(s => s.symbol === currentBot.config.symbol) || null;
      } else {
        matchingSignal = liveSignals[0] || null;
      }
      
      if (matchingSignal && matchingSignal.strength > 0.6) {
        await executeTradeForBot(currentBot, matchingSignal);
      }
    }, 3000);
    
    botIntervalsRef.current.set(botId, interval);
    toast.success(`${bot.config.name} started`);
  }, [bots, liveSignals, executeTradeForBot]);
  
  // Stop a specific bot
  const stopBot = useCallback((botId: string) => {
    if (botIntervalsRef.current.has(botId)) {
      clearInterval(botIntervalsRef.current.get(botId));
      botIntervalsRef.current.delete(botId);
    }
    runningBotsRef.current.delete(botId);
    setBots(prev => prev.map(b => b.id === botId ? { ...b, status: 'idle' } : b));
    toast.info(`Bot stopped`);
  }, []);
  
  // Create a new bot from signal
  const createBotFromSignal = useCallback((signal: Signal, customConfig?: Partial<BotConfig>) => {
    const newBotId = `bot_${Date.now()}_${botIdCounter++}`;
    const newBot: BotInstance = {
      id: newBotId,
      config: {
        id: newBotId,
        name: `${signal.direction} Bot ${bots.length + 1}`,
        enabled: true,
        signalType: signal.direction,
        symbol: signal.symbol,
        stake: customConfig?.stake || 0.5,
        martingaleMultiplier: customConfig?.martingaleMultiplier || 2,
        martingaleMaxSteps: customConfig?.martingaleMaxSteps || 3,
        takeProfit: customConfig?.takeProfit || 10,
        stopLoss: customConfig?.stopLoss || 5,
        recoveryThreshold: signal.direction === 'UNDER' ? 8 : 3,
        isCopyTrading: customConfig?.isCopyTrading || false,
        masterBotId: customConfig?.masterBotId,
        copyRatio: customConfig?.copyRatio,
      },
      status: 'idle',
      currentStake: customConfig?.stake || 0.5,
      martingaleStep: 0,
      consecutiveLosses: 0,
      totalPnL: 0,
      totalTrades: 0,
      wins: 0,
      losses: 0,
      lastTrade: null,
      activeSignal: signal,
    };
    
    setBots(prev => [...prev, newBot]);
    toast.success(`Bot "${newBot.config.name}" created from ${signal.name} signal!`);
    setShowCreateBotDialog(false);
    setSelectedSignal(null);
  }, [bots.length]);
  
  // Delete a bot
  const deleteBot = useCallback((botId: string) => {
    if (runningBotsRef.current.has(botId)) {
      stopBot(botId);
    }
    setBots(prev => prev.filter(b => b.id !== botId));
    toast.info(`Bot removed`);
  }, [stopBot]);
  
  // Toggle bot enabled state
  const toggleBotEnabled = useCallback((botId: string) => {
    setBots(prev => prev.map(b => 
      b.id === botId ? { ...b, config: { ...b.config, enabled: !b.config.enabled } } : b
    ));
  }, []);
  
  // Update bot config
  const updateBotConfig = useCallback((botId: string, updates: Partial<BotConfig>) => {
    setBots(prev => prev.map(b => 
      b.id === botId ? { ...b, config: { ...b.config, ...updates } } : b
    ));
  }, []);
  
  // Start all bots
  const startAllBots = useCallback(() => {
    bots.forEach(bot => {
      if (bot.config.enabled && bot.status === 'idle') {
        startBot(bot.id);
      }
    });
  }, [bots, startBot]);
  
  // Stop all bots
  const stopAllBots = useCallback(() => {
    bots.forEach(bot => {
      if (bot.status === 'running') {
        stopBot(bot.id);
      }
    });
  }, [bots, stopBot]);
  
  // Load markets on mount
  useEffect(() => {
    loadGroup(marketGroup);
  }, [marketGroup, loadGroup]);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      wsConnectionsRef.current.forEach((ws) => ws.close());
      botIntervalsRef.current.forEach((interval) => clearInterval(interval));
    };
  }, []);
  
  const globalWinRate = globalTrades > 0 ? ((bots.reduce((acc, b) => acc + b.wins, 0) / globalTrades) * 100).toFixed(1) : '0';

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold bg-gradient-to-r from-orange-400 to-purple-400 bg-clip-text text-transparent">
            ⚡ MULTI-BOT SIGNAL FORGE
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            {bots.length} Active Bots | {connectedMarkets} Markets | Copy Trading Enabled
          </p>
        </div>
        <div className="flex gap-3">
          <div className="flex items-center gap-2 bg-muted/30 rounded-full px-4 py-2">
            <span className="text-xs font-medium">📊 TYPE</span>
            <Select value={contractType} onValueChange={(v: any) => setContractType(v)}>
              <SelectTrigger className="w-[120px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="overunder">OVER/UNDER</SelectItem>
                <SelectItem value="evenodd">ODD/EVEN</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 bg-muted/30 rounded-full px-4 py-2">
            <span className="text-xs font-medium">🌐 MARKET</span>
            <Select value={marketGroup} onValueChange={(v: any) => setMarketGroup(v)}>
              <SelectTrigger className="w-[120px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">ALL</SelectItem>
                <SelectItem value="vol">Volatility</SelectItem>
                <SelectItem value="jump">Jump</SelectItem>
                <SelectItem value="bull">RDBULL</SelectItem>
                <SelectItem value="bear">RDBEAR</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={startAllBots} variant="default" className="bg-green-600 hover:bg-green-700">
            <Play className="w-4 h-4 mr-2" /> Start All
          </Button>
          <Button onClick={stopAllBots} variant="destructive">
            <StopCircle className="w-4 h-4 mr-2" /> Stop All
          </Button>
        </div>
      </div>

      {/* Global Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-blue-900/30 to-purple-900/30">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Global P/L</p>
                <p className={`text-2xl font-bold ${globalPnL >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  ${globalPnL.toFixed(2)}
                </p>
              </div>
              <BarChart3 className="w-8 h-8 text-blue-400 opacity-50" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-green-900/30 to-teal-900/30">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Total Trades</p>
                <p className="text-2xl font-bold">{globalTrades}</p>
              </div>
              <Activity className="w-8 h-8 text-green-400 opacity-50" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-yellow-900/30 to-orange-900/30">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Win Rate</p>
                <p className="text-2xl font-bold text-yellow-500">{globalWinRate}%</p>
              </div>
              <Target className="w-8 h-8 text-yellow-400 opacity-50" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-purple-900/30 to-pink-900/30">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Active Bots</p>
                <p className="text-2xl font-bold">{bots.filter(b => b.status === 'running').length}/{bots.length}</p>
              </div>
              <Bot className="w-8 h-8 text-purple-400 opacity-50" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Live Signals Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Zap className="w-5 h-5 text-yellow-500" /> Live Signals
          </h3>
          <Dialog open={showCreateBotDialog} onOpenChange={setShowCreateBotDialog}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" className="gap-2">
                <Plus className="w-4 h-4" /> Create Bot from Signal
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New Trading Bot</DialogTitle>
              </DialogHeader>
              {selectedSignal && (
                <div className="space-y-4">
                  <Alert className="bg-green-500/10 border-green-500">
                    <AlertCircle className="w-4 h-4" />
                    <AlertDescription>
                      Creating bot from signal: <strong>{selectedSignal.name}</strong> on {selectedSignal.symbol}
                    </AlertDescription>
                  </Alert>
                  <div className="space-y-3">
                    <div>
                      <label className="text-sm font-medium">Bot Name</label>
                      <Input 
                        defaultValue={`${selectedSignal.direction} Bot ${bots.length + 1}`}
                        id="botName"
                        placeholder="Enter bot name"
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium">Stake ($)</label>
                      <Input type="number" defaultValue={0.5} step="0.1" id="stake" />
                    </div>
                    <div>
                      <label className="text-sm font-medium">Martingale Multiplier</label>
                      <Input type="number" defaultValue={2} step="0.1" id="multiplier" />
                    </div>
                    <div>
                      <label className="text-sm font-medium">Take Profit ($)</label>
                      <Input type="number" defaultValue={10} id="tp" />
                    </div>
                    <div>
                      <label className="text-sm font-medium">Stop Loss ($)</label>
                      <Input type="number" defaultValue={5} id="sl" />
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch id="copyTrading" />
                      <label className="text-sm">Enable Copy Trading (as master)</label>
                    </div>
                  </div>
                  <Button onClick={() => {
                    const name = (document.getElementById('botName') as HTMLInputElement)?.value;
                    const stake = parseFloat((document.getElementById('stake') as HTMLInputElement)?.value || '0.5');
                    const multiplier = parseFloat((document.getElementById('multiplier') as HTMLInputElement)?.value || '2');
                    const tp = parseFloat((document.getElementById('tp') as HTMLInputElement)?.value || '10');
                    const sl = parseFloat((document.getElementById('sl') as HTMLInputElement)?.value || '5');
                    const isCopy = (document.getElementById('copyTrading') as HTMLInputElement)?.checked;
                    
                    createBotFromSignal(selectedSignal, {
                      name: name || `${selectedSignal.direction} Bot`,
                      stake,
                      martingaleMultiplier: multiplier,
                      takeProfit: tp,
                      stopLoss: sl,
                      isCopyTrading: isCopy,
                    });
                  }} className="w-full">
                    Create Bot
                  </Button>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <Card key={i} className="bg-gray-800/50 animate-pulse">
                <CardContent className="p-3">
                  <div className="h-16 bg-gray-700 rounded" />
                </CardContent>
              </Card>
            ))
          ) : (
            liveSignals.slice(0, 5).map((signal) => (
              <Card 
                key={signal.id}
                className={`cursor-pointer transition-all hover:scale-105 ${
                  signal.direction === 'OVER' || signal.direction === 'ODD' || signal.direction === 'RISE'
                    ? 'border-green-500/50 hover:border-green-500' 
                    : 'border-red-500/50 hover:border-red-500'
                }`}
                onClick={() => {
                  setSelectedSignal(signal);
                  setShowCreateBotDialog(true);
                }}
              >
                <CardContent className="p-3">
                  <div className="flex items-center justify-between mb-2">
                    <Badge className="text-[10px]">{signal.symbol}</Badge>
                    <span className="text-xs font-mono text-yellow-500">{Math.round(signal.strength * 100)}%</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {signal.direction === 'OVER' || signal.direction === 'ODD' || signal.direction === 'RISE' ? 
                      <TrendingUp className="w-5 h-5 text-green-500" /> : 
                      <TrendingDown className="w-5 h-5 text-red-500" />
                    }
                    <span className="font-bold text-lg">{signal.name}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{signal.detail}</p>
                  <Button 
                    size="sm" 
                    variant="ghost" 
                    className="w-full mt-2 text-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedSignal(signal);
                      setShowCreateBotDialog(true);
                    }}
                  >
                    <Bot className="w-3 h-3 mr-1" /> Create Bot
                  </Button>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>

      {/* Bots Grid - Minimum 5 bots */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Bot className="w-5 h-5 text-primary" /> Active Trading Bots ({bots.length})
          </h3>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => {
              // Create empty bot template
              const newBotId = `bot_${Date.now()}_${botIdCounter++}`;
              const newBot: BotInstance = {
                id: newBotId,
                config: {
                  id: newBotId,
                  name: `Custom Bot ${bots.length + 1}`,
                  enabled: true,
                  signalType: null,
                  symbol: null,
                  stake: 0.5,
                  martingaleMultiplier: 2,
                  martingaleMaxSteps: 3,
                  takeProfit: 10,
                  stopLoss: 5,
                  recoveryThreshold: 3,
                  isCopyTrading: false,
                },
                status: 'idle',
                currentStake: 0.5,
                martingaleStep: 0,
                consecutiveLosses: 0,
                totalPnL: 0,
                totalTrades: 0,
                wins: 0,
                losses: 0,
                lastTrade: null,
                activeSignal: null,
              };
              setBots(prev => [...prev, newBot]);
              toast.success('New bot created');
            }}>
              <Plus className="w-4 h-4 mr-1" /> Add Bot
            </Button>
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {bots.map((bot) => (
            <Card key={bot.id} className={`relative overflow-hidden ${bot.status === 'running' ? 'ring-2 ring-green-500' : ''}`}>
              <div className={`absolute top-0 left-0 right-0 h-1 ${
                bot.config.signalType === 'OVER' || bot.config.signalType === 'ODD' ? 'bg-green-500' :
                bot.config.signalType === 'UNDER' || bot.config.signalType === 'EVEN' ? 'bg-red-500' :
                'bg-blue-500'
              }`} />
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Bot className="w-4 h-4 text-muted-foreground" />
                    <CardTitle className="text-base">{bot.config.name}</CardTitle>
                    {bot.config.isCopyTrading && (
                      <Badge variant="outline" className="text-[8px]">
                        <Copy className="w-3 h-3 mr-1" /> Copy
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Switch 
                      checked={bot.config.enabled} 
                      onCheckedChange={() => toggleBotEnabled(bot.id)}
                      disabled={bot.status === 'running'}
                    />
                    <Button 
                      size="sm" 
                      variant="ghost" 
                      className="h-7 w-7 p-0"
                      onClick={() => deleteBot(bot.id)}
                    >
                      <Trash2 className="w-3 h-3 text-red-500" />
                    </Button>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant={bot.status === 'running' ? 'default' : bot.status === 'recovery' ? 'destructive' : 'secondary'} 
                         className={bot.status === 'running' ? 'bg-green-500' : bot.status === 'recovery' ? 'bg-orange-500' : ''}>
                    {bot.status === 'running' ? '🟢 RUNNING' : bot.status === 'recovery' ? '🔄 RECOVERY' : '⚫ IDLE'}
                  </Badge>
                  {bot.config.signalType && (
                    <Badge variant="outline">{bot.config.signalType} Signal</Badge>
                  )}
                  {bot.martingaleStep > 0 && (
                    <Badge variant="outline" className="text-yellow-500">Mx{bot.martingaleStep}</Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="text-xs text-muted-foreground">P/L</p>
                    <p className={`font-mono font-bold ${bot.totalPnL >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                      ${bot.totalPnL.toFixed(2)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Trades</p>
                    <p className="font-mono font-bold">{bot.totalTrades}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Win Rate</p>
                    <p className="font-mono font-bold">
                      {bot.totalTrades > 0 ? ((bot.wins / bot.totalTrades) * 100).toFixed(0) : 0}%
                    </p>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-muted-foreground">Stake:</span>
                    <span className="float-right font-mono">${bot.currentStake.toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Recovery:</span>
                    <span className="float-right font-mono">{bot.consecutiveLosses}/{bot.config.recoveryThreshold}</span>
                  </div>
                </div>
                
                {bot.activeSignal && (
                  <Alert className="p-2 bg-muted/30">
                    <div className="flex items-center gap-1 text-xs">
                      <Activity className="w-3 h-3" />
                      <span className="truncate">{bot.activeSignal.name} @ {bot.activeSignal.symbol}</span>
                    </div>
                  </Alert>
                )}
                
                <div className="flex gap-2">
                  {bot.status !== 'running' ? (
                    <Button 
                      size="sm" 
                      className="flex-1 bg-green-600 hover:bg-green-700"
                      onClick={() => startBot(bot.id)}
                      disabled={!bot.config.enabled}
                    >
                      <Play className="w-3 h-3 mr-1" /> Start
                    </Button>
                  ) : (
                    <Button 
                      size="sm" 
                      variant="destructive" 
                      className="flex-1"
                      onClick={() => stopBot(bot.id)}
                    >
                      <StopCircle className="w-3 h-3 mr-1" /> Stop
                    </Button>
                  )}
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button size="sm" variant="outline" className="flex-1">
                        <Settings className="w-3 h-3 mr-1" /> Config
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Configure {bot.config.name}</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4">
                        <div>
                          <label className="text-sm font-medium">Bot Name</label>
                          <Input 
                            value={bot.config.name}
                            onChange={(e) => updateBotConfig(bot.id, { name: e.target.value })}
                          />
                        </div>
                        <div>
                          <label className="text-sm font-medium">Signal Type</label>
                          <Select value={bot.config.signalType || 'any'} onValueChange={(v) => updateBotConfig(bot.id, { signalType: v === 'any' ? null : v })}>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="any">Any Signal</SelectItem>
                              <SelectItem value="OVER">OVER Only</SelectItem>
                              <SelectItem value="UNDER">UNDER Only</SelectItem>
                              <SelectItem value="ODD">ODD Only</SelectItem>
                              <SelectItem value="EVEN">EVEN Only</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <label className="text-sm font-medium">Stake ($)</label>
                          <Input 
                            type="number" 
                            step="0.1"
                            value={bot.config.stake}
                            onChange={(e) => updateBotConfig(bot.id, { stake: parseFloat(e.target.value) })}
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-sm font-medium">Take Profit</label>
                            <Input 
                              type="number"
                              value={bot.config.takeProfit}
                              onChange={(e) => updateBotConfig(bot.id, { takeProfit: parseFloat(e.target.value) })}
                            />
                          </div>
                          <div>
                            <label className="text-sm font-medium">Stop Loss</label>
                            <Input 
                              type="number"
                              value={bot.config.stopLoss}
                              onChange={(e) => updateBotConfig(bot.id, { stopLoss: parseFloat(e.target.value) })}
                            />
                          </div>
                        </div>
                        <div>
                          <label className="text-sm font-medium">Recovery Threshold (losses)</label>
                          <Input 
                            type="number"
                            value={bot.config.recoveryThreshold}
                            onChange={(e) => updateBotConfig(bot.id, { recoveryThreshold: parseInt(e.target.value) })}
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <Switch 
                            checked={bot.config.isCopyTrading}
                            onCheckedChange={(checked) => updateBotConfig(bot.id, { isCopyTrading: checked })}
                          />
                          <label className="text-sm">Enable Copy Trading (as master)</label>
                        </div>
                        {bot.config.isCopyTrading && (
                          <div>
                            <label className="text-sm font-medium">Copy Ratio (for followers)</label>
                            <Input 
                              type="number"
                              step="0.1"
                              min="0.1"
                              max="1"
                              value={bot.config.copyRatio || 0.5}
                              onChange={(e) => updateBotConfig(bot.id, { copyRatio: parseFloat(e.target.value) })}
                            />
                          </div>
                        )}
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Trade Logs */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="w-4 h-4" /> Recent Trades
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[300px]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-background">
                <tr className="border-b">
                  <th className="text-left p-2">Time</th>
                  <th className="text-left p-2">Bot</th>
                  <th className="text-left p-2">Signal</th>
                  <th className="text-right p-2">Stake</th>
                  <th className="text-center p-2">Result</th>
                  <th className="text-right p-2">P/L</th>
                  <th className="text-center p-2">Copy</th>
                </tr>
              </thead>
              <tbody>
                {tradeLogs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-8 text-muted-foreground">
                      No trades yet. Start bots to see activity.
                    </td>
                  </tr>
                ) : (
                  tradeLogs.slice(0, 50).map((log) => (
                    <tr key={log.id} className="border-b hover:bg-muted/30">
                      <td className="p-2 font-mono text-xs">{log.time.toLocaleTimeString()}</td>
                      <td className="p-2 text-xs">{log.botName}</td>
                      <td className="p-2 text-xs">{log.direction}</td>
                      <td className="p-2 text-right font-mono text-xs">${log.stake.toFixed(2)}</td>
                      <td className="p-2 text-center">
                        {log.result === 'Win' ? (
                          <CheckCircle className="w-4 h-4 text-green-500 inline" />
                        ) : log.result === 'Loss' ? (
                          <XCircle className="w-4 h-4 text-red-500 inline" />
                        ) : (
                          <Clock className="w-4 h-4 text-yellow-500 inline animate-pulse" />
                        )}
                      </td>
                      <td className={`p-2 text-right font-mono text-xs ${log.pnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                        {log.pnl >= 0 ? '+' : ''}{log.pnl.toFixed(2)}
                      </td>
                      <td className="p-2 text-center">
                        {log.isCopyTrade && <Copy className="w-3 h-3 text-blue-500 inline" />}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Footer */}
      <div className="flex justify-between items-center text-xs text-muted-foreground border-t border-border pt-4">
        <div className="flex items-center gap-4">
          <span>⚡ {bots.length} Active Bots</span>
          <span>📊 {connectedMarkets} Live Markets</span>
          <span>🔄 Copy Trading Enabled</span>
        </div>
        <div>
          Balance: <span className="font-mono font-bold">${balance.toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
}

export default MultiBotSignalForge;
