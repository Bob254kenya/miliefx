import { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { 
  Play, StopCircle, Settings, TrendingUp, TrendingDown, Zap, Shield, Target, 
  Plus, Trash2, Bot, BarChart3, Activity, AlertCircle, CheckCircle, XCircle, Clock, 
  Sparkles, Brain, Signal, Gauge, Rocket
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
  price: number;
  digit: number;
}

interface BotConfig {
  id: string;
  name: string;
  enabled: boolean;
  signalType: 'OVER' | 'UNDER' | 'ODD' | 'EVEN' | 'RISE' | 'FALL' | 'ANY';
  symbol: string | null;
  stake: number;
  martingaleMultiplier: number;
  martingaleMaxSteps: number;
  takeProfit: number;
  stopLoss: number;
  recoveryThreshold: number;
  minSignalStrength: number;
  maxConcurrentTrades: number;
  tradingInterval: number;
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
  pendingTrades: number;
  lastSignalStrength: number;
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
  signalStrength: number;
  exitDigit: number;
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
let tradeIdCounter = 0;

// Helper: compute digit frequencies
function computeDigitStats(ticks: number[], thresholdDigit: number = 5) {
  if (!ticks || ticks.length < 50) return null;
  const recent = ticks.slice(-TICK_DEPTH);
  const freq = Array(10).fill(0);
  recent.forEach(d => { if (d >= 0 && d <= 9) freq[d]++; });

  let entries = freq.map((count, digit) => ({ digit, count }));
  entries.sort((a, b) => b.count - a.count);
  const mostAppearing = entries[0]?.digit ?? 0;
  const secondMost = entries[1]?.digit ?? mostAppearing;

  let overCount = 0, underCount = 0;
  recent.forEach(d => { if (d > thresholdDigit) overCount++; else if (d < thresholdDigit) underCount++; });
  let oddCount = 0, evenCount = 0;
  recent.forEach(d => { if (d % 2 === 0) evenCount++; else oddCount++; });

  const lastDigit = ticks[ticks.length - 1] || 0;

  return {
    mostAppearing,
    secondMost,
    overRate: overCount / recent.length,
    underRate: underCount / recent.length,
    oddRate: oddCount / recent.length,
    evenRate: evenCount / recent.length,
    totalTicks: recent.length,
    lastDigit,
  };
}

// Generate signals from tick data
function generateSignalsFromTicks(ticksMap: Map<string, number[]>, contractType: string): Signal[] {
  const signals: Signal[] = [];
  
  for (const [symbol, ticks] of ticksMap.entries()) {
    if (!ticks || ticks.length < 100) continue;
    const stats = computeDigitStats(ticks, 5);
    if (!stats) continue;
    
    const { mostAppearing, secondMost, overRate, underRate, oddRate, evenRate, lastDigit } = stats;
    
    if (contractType === 'overunder') {
      // OVER signal
      if (mostAppearing >= 5) {
        let strength = 0.65 + (overRate * 0.3);
        if (secondMost >= 5) strength += 0.05;
        if (mostAppearing >= 8) strength += 0.05;
        strength = Math.min(0.96, strength);
        
        signals.push({
          id: `sig_${Date.now()}_${signalIdCounter++}`,
          type: "Under/Over",
          name: "📈 OVER",
          strength,
          symbol: symbol,
          detail: `Most digit ${mostAppearing} (5-9 zone) | Over rate ${(overRate * 100).toFixed(0)}%`,
          extra: `Most:${mostAppearing} 2nd:${secondMost}`,
          direction: 'OVER',
          timestamp: new Date(),
          price: lastDigit,
          digit: lastDigit
        });
      }
      
      // UNDER signal
      if (mostAppearing <= 6) {
        let strength = 0.65 + (underRate * 0.3);
        if (secondMost <= 6) strength += 0.05;
        if (mostAppearing <= 2) strength += 0.05;
        strength = Math.min(0.96, strength);
        
        signals.push({
          id: `sig_${Date.now()}_${signalIdCounter++}`,
          type: "Under/Over",
          name: "📉 UNDER",
          strength,
          symbol: symbol,
          detail: `Most digit ${mostAppearing} (0-6 zone) | Under rate ${(underRate * 100).toFixed(0)}%`,
          extra: `Most:${mostAppearing} 2nd:${secondMost}`,
          direction: 'UNDER',
          timestamp: new Date(),
          price: lastDigit,
          digit: lastDigit
        });
      }
    }
    
    if (contractType === 'evenodd') {
      // ODD signal
      if (mostAppearing % 2 === 1) {
        let strength = 0.62 + (oddRate * 0.3);
        if (secondMost % 2 === 1) strength += 0.05;
        strength = Math.min(0.94, strength);
        
        signals.push({
          id: `sig_${Date.now()}_${signalIdCounter++}`,
          type: "Odd/Even",
          name: "🎲 ODD",
          strength,
          symbol: symbol,
          detail: `Most digit ${mostAppearing} (odd) | Odd winrate ${(oddRate * 100).toFixed(0)}%`,
          extra: `Most digit ${mostAppearing} → Odd bias`,
          direction: 'ODD',
          timestamp: new Date(),
          price: lastDigit,
          digit: lastDigit
        });
      }
      
      // EVEN signal
      if (mostAppearing % 2 === 0) {
        let strength = 0.62 + (evenRate * 0.3);
        if (secondMost % 2 === 0) strength += 0.05;
        strength = Math.min(0.94, strength);
        
        signals.push({
          id: `sig_${Date.now()}_${signalIdCounter++}`,
          type: "Odd/Even",
          name: "🎲 EVEN",
          strength,
          symbol: symbol,
          detail: `Most digit ${mostAppearing} (even) | Even winrate ${(evenRate * 100).toFixed(0)}%`,
          extra: `Most digit ${mostAppearing} → Even bias`,
          direction: 'EVEN',
          timestamp: new Date(),
          price: lastDigit,
          digit: lastDigit
        });
      }
    }
  }
  
  signals.sort((a, b) => b.strength - a.strength);
  return signals;
}

// Execute a trade for a bot
async function executeTrade(
  bot: BotInstance,
  signal: Signal,
  balance: number,
  recordLossFn: (stake: number, symbol: string, duration: number) => void
): Promise<{ won: boolean; pnl: number; exitDigit: number }> {
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
    const exitDigit = getLastDigit(result.sellPrice || 0);
    
    if (!won && result.sellPrice) {
      recordLossFn(bot.currentStake, signal.symbol, 6000);
    }
    
    return { won, pnl, exitDigit };
  } catch (err) {
    console.error('Trade error:', err);
    return { won: false, pnl: -bot.currentStake, exitDigit: 0 };
  }
}

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

export function AdaptiveMultiBot() {
  const { isAuthorized, balance, activeAccount } = useAuth();
  const { recordLoss } = useLossRequirement();

  // Signal State
  const [contractType, setContractType] = useState<'overunder' | 'evenodd'>('overunder');
  const [marketGroup, setMarketGroup] = useState<'all' | 'vol' | 'jump' | 'bull' | 'bear'>('all');
  const [liveSignals, setLiveSignals] = useState<Signal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [connectedMarkets, setConnectedMarkets] = useState(0);
  const [lastSignalUpdate, setLastSignalUpdate] = useState<Date>(new Date());

  // Bot State
  const [bots, setBots] = useState<BotInstance[]>([]);
  const [tradeLogs, setTradeLogs] = useState<TradeLog[]>([]);
  const [globalPnL, setGlobalPnL] = useState(0);
  const [globalTrades, setGlobalTrades] = useState(0);
  
  const ticksMapRef = useRef<Map<string, number[]>>(new Map());
  const wsConnectionsRef = useRef<Map<string, WebSocket>>(new Map());
  const runningBotsRef = useRef<Set<string>>(new Set());
  const botLoopsRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // Initialize default bots (5 bots with different signal types)
  useEffect(() => {
    const defaultBots: BotInstance[] = [
      {
        id: `bot_over_${Date.now()}`,
        config: {
          id: `bot_over_${Date.now()}`,
          name: "🟢 OVER HUNTER",
          enabled: true,
          signalType: 'OVER',
          symbol: null,
          stake: 0.5,
          martingaleMultiplier: 2,
          martingaleMaxSteps: 3,
          takeProfit: 10,
          stopLoss: 5,
          recoveryThreshold: 3,
          minSignalStrength: 0.65,
          maxConcurrentTrades: 1,
          tradingInterval: 3000,
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
        pendingTrades: 0,
        lastSignalStrength: 0,
      },
      {
        id: `bot_under_${Date.now()}`,
        config: {
          id: `bot_under_${Date.now()}`,
          name: "🔴 UNDER SEEKER",
          enabled: true,
          signalType: 'UNDER',
          symbol: null,
          stake: 0.5,
          martingaleMultiplier: 2,
          martingaleMaxSteps: 3,
          takeProfit: 10,
          stopLoss: 5,
          recoveryThreshold: 8,
          minSignalStrength: 0.65,
          maxConcurrentTrades: 1,
          tradingInterval: 3000,
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
        pendingTrades: 0,
        lastSignalStrength: 0,
      },
      {
        id: `bot_odd_${Date.now()}`,
        config: {
          id: `bot_odd_${Date.now()}`,
          name: "🟣 ODD MASTER",
          enabled: true,
          signalType: 'ODD',
          symbol: null,
          stake: 0.5,
          martingaleMultiplier: 2,
          martingaleMaxSteps: 3,
          takeProfit: 10,
          stopLoss: 5,
          recoveryThreshold: 3,
          minSignalStrength: 0.65,
          maxConcurrentTrades: 1,
          tradingInterval: 3000,
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
        pendingTrades: 0,
        lastSignalStrength: 0,
      },
      {
        id: `bot_even_${Date.now()}`,
        config: {
          id: `bot_even_${Date.now()}`,
          name: "🟡 EVEN SLAYER",
          enabled: true,
          signalType: 'EVEN',
          symbol: null,
          stake: 0.5,
          martingaleMultiplier: 2,
          martingaleMaxSteps: 3,
          takeProfit: 10,
          stopLoss: 5,
          recoveryThreshold: 3,
          minSignalStrength: 0.65,
          maxConcurrentTrades: 1,
          tradingInterval: 3000,
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
        pendingTrades: 0,
        lastSignalStrength: 0,
      },
      {
        id: `bot_flex_${Date.now()}`,
        config: {
          id: `bot_flex_${Date.now()}`,
          name: "🧠 FLEX TRADER",
          enabled: true,
          signalType: 'ANY',
          symbol: null,
          stake: 0.5,
          martingaleMultiplier: 2,
          martingaleMaxSteps: 3,
          takeProfit: 10,
          stopLoss: 5,
          recoveryThreshold: 3,
          minSignalStrength: 0.7,
          maxConcurrentTrades: 1,
          tradingInterval: 3000,
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
        pendingTrades: 0,
        lastSignalStrength: 0,
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
          
          const newSignals = generateSignalsFromTicks(ticksMapRef.current, contractType);
          setLiveSignals(newSignals);
          setLastSignalUpdate(new Date());
          setConnectedMarkets(ticksMapRef.current.size);
          setIsLoading(false);
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
      setIsLoading(false);
    }, 5000);
  }, [connectMarket]);

  // Bot trading loop
  const startBotLoop = useCallback((bot: BotInstance) => {
    if (botLoopsRef.current.has(bot.id)) {
      clearInterval(botLoopsRef.current.get(bot.id));
    }
    
    const interval = setInterval(async () => {
      const currentBot = bots.find(b => b.id === bot.id);
      if (!currentBot || currentBot.status !== 'running' || !currentBot.config.enabled) {
        return;
      }
      
      let matchingSignals = liveSignals;
      
      if (currentBot.config.signalType !== 'ANY') {
        matchingSignals = liveSignals.filter(s => s.direction === currentBot.config.signalType);
      }
      
      matchingSignals = matchingSignals.filter(s => s.strength >= currentBot.config.minSignalStrength);
      
      if (matchingSignals.length === 0) {
        setBots(prev => prev.map(b => 
          b.id === currentBot.id ? { ...b, lastSignalStrength: 0 } : b
        ));
        return;
      }
      
      if (currentBot.pendingTrades >= currentBot.config.maxConcurrentTrades) {
        return;
      }
      
      const bestSignal = matchingSignals[0];
      
      setBots(prev => prev.map(b => 
        b.id === currentBot.id ? { ...b, lastSignalStrength: bestSignal.strength, activeSignal: bestSignal } : b
      ));
      
      // Recovery mode check
      if (currentBot.consecutiveLosses >= currentBot.config.recoveryThreshold) {
        if (currentBot.status !== 'recovery') {
          setBots(prev => prev.map(b => 
            b.id === currentBot.id ? { ...b, status: 'recovery' } : b
          ));
          toast.warning(`${currentBot.config.name}: Recovery mode after ${currentBot.consecutiveLosses} losses`);
        }
      } else if (currentBot.status === 'recovery' && currentBot.consecutiveLosses === 0) {
        setBots(prev => prev.map(b => 
          b.id === currentBot.id ? { ...b, status: 'running' } : b
        ));
        toast.success(`${currentBot.config.name}: Recovery complete!`);
      }
      
      // Execute trade
      const tradeId = `trade_${Date.now()}_${currentBot.id}_${tradeIdCounter++}`;
      const now = new Date();
      
      setTradeLogs(prev => [{
        id: tradeId,
        botId: currentBot.id,
        botName: currentBot.config.name,
        time: now,
        symbol: bestSignal.symbol,
        signalType: bestSignal.type,
        direction: bestSignal.direction,
        stake: currentBot.currentStake,
        result: 'Pending',
        pnl: 0,
        balance: balance,
        signalStrength: bestSignal.strength,
        exitDigit: 0,
      }, ...prev].slice(0, 200));
      
      setBots(prev => prev.map(b => 
        b.id === currentBot.id ? { ...b, pendingTrades: b.pendingTrades + 1 } : b
      ));
      
      try {
        const result = await executeTrade(currentBot, bestSignal, balance, recordLoss);
        
        const newConsecutiveLosses = result.won ? 0 : currentBot.consecutiveLosses + 1;
        let newStake = currentBot.currentStake;
        let newMartingaleStep = currentBot.martingaleStep;
        
        if (!result.won && currentBot.config.martingaleMultiplier > 1 && 
            currentBot.martingaleStep < currentBot.config.martingaleMaxSteps) {
          newStake = currentBot.currentStake * currentBot.config.martingaleMultiplier;
          newMartingaleStep = currentBot.martingaleStep + 1;
        } else if (result.won) {
          newStake = currentBot.config.stake;
          newMartingaleStep = 0;
        }
        
        const newTotalPnL = currentBot.totalPnL + result.pnl;
        const newTotalTrades = currentBot.totalTrades + 1;
        const newWins = currentBot.wins + (result.won ? 1 : 0);
        const newLosses = currentBot.losses + (result.won ? 0 : 1);
        
        setTradeLogs(prev => prev.map(log => 
          log.id === tradeId ? { 
            ...log, 
            result: result.won ? 'Win' : 'Loss', 
            pnl: result.pnl, 
            balance: balance + result.pnl,
            exitDigit: result.exitDigit
          } : log
        ));
        
        setBots(prev => prev.map(b => 
          b.id === currentBot.id ? {
            ...b,
            currentStake: newStake,
            martingaleStep: newMartingaleStep,
            consecutiveLosses: newConsecutiveLosses,
            totalPnL: newTotalPnL,
            totalTrades: newTotalTrades,
            wins: newWins,
            losses: newLosses,
            lastTrade: now,
            pendingTrades: Math.max(0, b.pendingTrades - 1),
          } : b
        ));
        
        setGlobalPnL(prev => prev + result.pnl);
        setGlobalTrades(prev => prev + 1);
        
        if (result.won) {
          toast.success(`${currentBot.config.name}: ✅ WIN! +$${result.pnl.toFixed(2)} on ${bestSignal.symbol}`);
        } else {
          toast.error(`${currentBot.config.name}: ❌ LOSS! -$${currentBot.currentStake.toFixed(2)} on ${bestSignal.symbol}`);
        }
        
        // Check TP/SL
        if (newTotalPnL >= currentBot.config.takeProfit) {
          toast.success(`${currentBot.config.name}: 🎯 Take Profit! +$${newTotalPnL.toFixed(2)}`);
          setBots(prev => prev.map(b => b.id === currentBot.id ? { ...b, status: 'idle' } : b));
          runningBotsRef.current.delete(currentBot.id);
          if (botLoopsRef.current.has(currentBot.id)) {
            clearInterval(botLoopsRef.current.get(currentBot.id));
            botLoopsRef.current.delete(currentBot.id);
          }
        }
        if (newTotalPnL <= -currentBot.config.stopLoss) {
          toast.error(`${currentBot.config.name}: 🛑 Stop Loss! $${newTotalPnL.toFixed(2)}`);
          setBots(prev => prev.map(b => b.id === currentBot.id ? { ...b, status: 'idle' } : b));
          runningBotsRef.current.delete(currentBot.id);
          if (botLoopsRef.current.has(currentBot.id)) {
            clearInterval(botLoopsRef.current.get(currentBot.id));
            botLoopsRef.current.delete(currentBot.id);
          }
        }
        
      } catch (err) {
        console.error(`Bot ${currentBot.config.name} trade error:`, err);
        setBots(prev => prev.map(b => 
          b.id === currentBot.id ? { ...b, pendingTrades: Math.max(0, b.pendingTrades - 1) } : b
        ));
      }
      
    }, bot.config.tradingInterval);
    
    botLoopsRef.current.set(bot.id, interval);
  }, [bots, liveSignals, balance, recordLoss]);
  
  const startBot = useCallback((botId: string) => {
    const bot = bots.find(b => b.id === botId);
    if (!bot || !bot.config.enabled) return;
    if (runningBotsRef.current.has(botId)) return;
    
    runningBotsRef.current.add(botId);
    setBots(prev => prev.map(b => 
      b.id === botId ? { ...b, status: 'running', consecutiveLosses: 0, martingaleStep: 0, currentStake: b.config.stake } : b
    ));
    
    startBotLoop(bot);
    toast.success(`${bot.config.name} started`);
  }, [bots, startBotLoop]);
  
  const stopBot = useCallback((botId: string) => {
    if (botLoopsRef.current.has(botId)) {
      clearInterval(botLoopsRef.current.get(botId));
      botLoopsRef.current.delete(botId);
    }
    runningBotsRef.current.delete(botId);
    setBots(prev => prev.map(b => b.id === botId ? { ...b, status: 'idle', pendingTrades: 0 } : b));
    toast.info(`Bot stopped`);
  }, []);
  
  const startAllBots = useCallback(() => {
    bots.forEach(bot => {
      if (bot.config.enabled && bot.status === 'idle') {
        startBot(bot.id);
      }
    });
  }, [bots, startBot]);
  
  const stopAllBots = useCallback(() => {
    bots.forEach(bot => {
      if (bot.status === 'running') {
        stopBot(bot.id);
      }
    });
  }, [bots, stopBot]);
  
  const deleteBot = useCallback((botId: string) => {
    if (runningBotsRef.current.has(botId)) {
      stopBot(botId);
    }
    setBots(prev => prev.filter(b => b.id !== botId));
    toast.info(`Bot removed`);
  }, [stopBot]);
  
  const addBot = useCallback((signalType: 'OVER' | 'UNDER' | 'ODD' | 'EVEN' | 'ANY' = 'ANY') => {
    const newBotId = `bot_${Date.now()}_${botIdCounter++}`;
    const recoveryThreshold = signalType === 'UNDER' ? 8 : 3;
    const botName = signalType === 'ANY' ? '🧠 FLEX TRADER' :
                    signalType === 'OVER' ? '🟢 OVER BOT' :
                    signalType === 'UNDER' ? '🔴 UNDER BOT' :
                    signalType === 'ODD' ? '🟣 ODD BOT' : '🟡 EVEN BOT';
    
    const newBot: BotInstance = {
      id: newBotId,
      config: {
        id: newBotId,
        name: `${botName} ${bots.length + 1}`,
        enabled: true,
        signalType: signalType,
        symbol: null,
        stake: 0.5,
        martingaleMultiplier: 2,
        martingaleMaxSteps: 3,
        takeProfit: 10,
        stopLoss: 5,
        recoveryThreshold: recoveryThreshold,
        minSignalStrength: 0.65,
        maxConcurrentTrades: 1,
        tradingInterval: 3000,
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
      pendingTrades: 0,
      lastSignalStrength: 0,
    };
    setBots(prev => [...prev, newBot]);
    toast.success(`New ${signalType === 'ANY' ? 'Flex' : signalType} bot created!`);
  }, [bots.length]);
  
  const updateBotConfig = useCallback((botId: string, updates: Partial<BotConfig>) => {
    setBots(prev => prev.map(b => 
      b.id === botId ? { ...b, config: { ...b.config, ...updates } } : b
    ));
  }, []);
  
  useEffect(() => {
    loadGroup(marketGroup);
  }, [marketGroup, loadGroup]);
  
  useEffect(() => {
    return () => {
      wsConnectionsRef.current.forEach((ws) => ws.close());
      botLoopsRef.current.forEach((interval) => clearInterval(interval));
    };
  }, []);
  
  const globalWinRate = globalTrades > 0 ? ((bots.reduce((acc, b) => acc + b.wins, 0) / globalTrades) * 100).toFixed(1) : '0';
  const activeBotsCount = bots.filter(b => b.status === 'running').length;
  const topSignals = liveSignals.slice(0, 5);
  
  return (
    <div className="space-y-6 max-w-7xl mx-auto p-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold bg-gradient-to-r from-orange-400 to-purple-400 bg-clip-text text-transparent">
            ⚡ SIGNAL FORGE • AUTO TRADING BOTS
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            {bots.length} Bots | {activeBotsCount} Active | {connectedMarkets} Markets | Real-time Signal Trading
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
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline" className="gap-2">
                <Plus className="w-4 h-4" /> Add Bot
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New Trading Bot</DialogTitle>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-3 py-4">
                <Button variant="outline" className="h-20 flex-col gap-2" onClick={() => addBot('OVER')}>
                  <TrendingUp className="w-6 h-6 text-green-500" />
                  <span>OVER Bot</span>
                </Button>
                <Button variant="outline" className="h-20 flex-col gap-2" onClick={() => addBot('UNDER')}>
                  <TrendingDown className="w-6 h-6 text-red-500" />
                  <span>UNDER Bot</span>
                </Button>
                <Button variant="outline" className="h-20 flex-col gap-2" onClick={() => addBot('ODD')}>
                  <Sparkles className="w-6 h-6 text-purple-500" />
                  <span>ODD Bot</span>
                </Button>
                <Button variant="outline" className="h-20 flex-col gap-2" onClick={() => addBot('EVEN')}>
                  <Target className="w-6 h-6 text-yellow-500" />
                  <span>EVEN Bot</span>
                </Button>
                <Button variant="outline" className="h-20 flex-col gap-2 col-span-2" onClick={() => addBot('ANY')}>
                  <Brain className="w-6 h-6 text-blue-500" />
                  <span>Smart Flex Bot (follows best signal)</span>
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Global Stats */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        <Card className="bg-gradient-to-br from-blue-900/30 to-purple-900/30">
          <CardContent className="pt-3 pb-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] text-muted-foreground">Total P/L</p>
                <p className={`text-xl font-bold ${globalPnL >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  ${globalPnL.toFixed(2)}
                </p>
              </div>
              <BarChart3 className="w-6 h-6 text-blue-400 opacity-50" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-green-900/30 to-teal-900/30">
          <CardContent className="pt-3 pb-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] text-muted-foreground">Total Trades</p>
                <p className="text-xl font-bold">{globalTrades}</p>
              </div>
              <Activity className="w-6 h-6 text-green-400 opacity-50" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-yellow-900/30 to-orange-900/30">
          <CardContent className="pt-3 pb-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] text-muted-foreground">Win Rate</p>
                <p className="text-xl font-bold text-yellow-500">{globalWinRate}%</p>
              </div>
              <Target className="w-6 h-6 text-yellow-400 opacity-50" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-purple-900/30 to-pink-900/30">
          <CardContent className="pt-3 pb-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] text-muted-foreground">Active Bots</p>
                <p className="text-xl font-bold">{activeBotsCount}/{bots.length}</p>
              </div>
              <Bot className="w-6 h-6 text-purple-400 opacity-50" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-cyan-900/30 to-blue-900/30">
          <CardContent className="pt-3 pb-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] text-muted-foreground">Last Signal</p>
                <p className="text-xs font-mono">{lastSignalUpdate.toLocaleTimeString()}</p>
              </div>
              <Signal className="w-6 h-6 text-cyan-400 animate-pulse" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Live Signals Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-md font-semibold flex items-center gap-2">
            <Zap className="w-4 h-4 text-yellow-500" /> LIVE SIGNALS
          </h3>
          <Badge variant="outline" className="text-[10px] animate-pulse">
            {isLoading ? 'Loading...' : `${liveSignals.length} active`}
          </Badge>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <Card key={i} className="bg-gray-800/50 animate-pulse">
                <CardContent className="p-2">
                  <div className="h-14 bg-gray-700 rounded" />
                </CardContent>
              </Card>
            ))
          ) : topSignals.length === 0 ? (
            <div className="col-span-full text-center py-6 text-muted-foreground text-sm">
              <Signal className="w-8 h-8 mx-auto mb-2 opacity-50" />
              Waiting for market data...
            </div>
          ) : (
            topSignals.map((signal) => (
              <Card 
                key={signal.id}
                className={`cursor-pointer transition-all hover:scale-105 ${
                  signal.direction === 'OVER' || signal.direction === 'ODD' 
                    ? 'border-green-500/50 hover:border-green-500' 
                    : 'border-red-500/50 hover:border-red-500'
                }`}
              >
                <CardContent className="p-2">
                  <div className="flex items-center justify-between mb-1">
                    <Badge className="text-[8px]">{signal.symbol}</Badge>
                    <span className="text-[10px] font-mono text-yellow-500">{Math.round(signal.strength * 100)}%</span>
                  </div>
                  <div className="flex items-center gap-1">
                    {signal.direction === 'OVER' || signal.direction === 'ODD' ? 
                      <TrendingUp className="w-3 h-3 text-green-500" /> : 
                      <TrendingDown className="w-3 h-3 text-red-500" />
                    }
                    <span className="font-bold text-sm">{signal.name}</span>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[8px] text-muted-foreground">Last: {signal.digit}</span>
                    <Progress value={signal.strength * 100} className="w-12 h-1" />
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>

      {/* Bots Grid */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-md font-semibold flex items-center gap-2">
            <Bot className="w-4 h-4 text-primary" /> TRADING BOTS
          </h3>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {bots.map((bot) => (
            <Card key={bot.id} className={`relative overflow-hidden ${bot.status === 'running' ? 'ring-2 ring-green-500/50' : ''} ${bot.status === 'recovery' ? 'ring-2 ring-orange-500/50' : ''}`}>
              <div className={`absolute top-0 left-0 right-0 h-1 ${
                bot.config.signalType === 'OVER' ? 'bg-green-500' :
                bot.config.signalType === 'UNDER' ? 'bg-red-500' :
                bot.config.signalType === 'ODD' ? 'bg-purple-500' :
                bot.config.signalType === 'EVEN' ? 'bg-yellow-500' :
                'bg-blue-500'
              }`} />
              <CardHeader className="pb-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {bot.status === 'running' ? (
                      <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    ) : bot.status === 'recovery' ? (
                      <div className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
                    ) : (
                      <div className="w-2 h-2 rounded-full bg-gray-500" />
                    )}
                    <CardTitle className="text-sm">{bot.config.name}</CardTitle>
                  </div>
                  <div className="flex items-center gap-1">
                    <Switch 
                      checked={bot.config.enabled} 
                      onCheckedChange={(checked) => updateBotConfig(bot.id, { enabled: checked })}
                      disabled={bot.status === 'running'}
                      className="scale-75"
                    />
                    <Button 
                      size="sm" 
                      variant="ghost" 
                      className="h-6 w-6 p-0"
                      onClick={() => deleteBot(bot.id)}
                    >
                      <Trash2 className="w-3 h-3 text-red-500" />
                    </Button>
                  </div>
                </div>
                <div className="flex items-center gap-1 mt-1">
                  <Badge variant={bot.status === 'running' ? 'default' : bot.status === 'recovery' ? 'destructive' : 'secondary'} 
                         className={`text-[8px] h-4 ${bot.status === 'running' ? 'bg-green-600' : bot.status === 'recovery' ? 'bg-orange-600' : ''}`}>
                    {bot.status === 'running' ? 'RUNNING' : bot.status === 'recovery' ? 'RECOVERY' : 'IDLE'}
                  </Badge>
                  <Badge variant="outline" className="text-[8px]">{bot.config.signalType}</Badge>
                  {bot.martingaleStep > 0 && (
                    <Badge variant="outline" className="text-[8px] text-yellow-500">Mx{bot.martingaleStep}</Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-2 pb-2">
                <div className="grid grid-cols-3 gap-1 text-center">
                  <div>
                    <p className="text-[8px] text-muted-foreground">P/L</p>
                    <p className={`text-xs font-mono font-bold ${bot.totalPnL >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                      ${bot.totalPnL.toFixed(2)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[8px] text-muted-foreground">Trades</p>
                    <p className="text-xs font-mono font-bold">{bot.totalTrades}</p>
                  </div>
                  <div>
                    <p className="text-[8px] text-muted-foreground">WR</p>
                    <p className="text-xs font-mono font-bold">
                      {bot.totalTrades > 0 ? ((bot.wins / bot.totalTrades) * 100).toFixed(0) : 0}%
                    </p>
                  </div>
                </div>
                
                {bot.activeSignal && (
                  <div className="bg-muted/30 rounded p-1">
                    <div className="flex items-center justify-between text-[9px]">
                      <span className="text-muted-foreground">Current Signal:</span>
                      <span className={`font-mono ${bot.activeSignal.direction === 'OVER' || bot.activeSignal.direction === 'ODD' ? 'text-green-500' : 'text-red-500'}`}>
                        {bot.activeSignal.name} @ {Math.round(bot.activeSignal.strength * 100)}%
                      </span>
                    </div>
                    <Progress value={bot.lastSignalStrength * 100} className="h-1 mt-1" />
                  </div>
                )}
                
                {bot.consecutiveLosses > 0 && (
                  <div className="space-y-0.5">
                    <div className="flex justify-between text-[8px]">
                      <span className="text-muted-foreground">Loss Streak</span>
                      <span className={bot.consecutiveLosses >= bot.config.recoveryThreshold ? 'text-orange-500 font-bold' : ''}>
                        {bot.consecutiveLosses}/{bot.config.recoveryThreshold}
                      </span>
                    </div>
                    <Progress 
                      value={(bot.consecutiveLosses / bot.config.recoveryThreshold) * 100} 
                      className="h-1" 
                    />
                  </div>
                )}
                
                <div className="flex gap-2 pt-1">
                  {bot.status !== 'running' ? (
                    <Button 
                      size="sm" 
                      className="flex-1 h-7 text-[11px] bg-green-600 hover:bg-green-700"
                      onClick={() => startBot(bot.id)}
                      disabled={!bot.config.enabled}
                    >
                      <Play className="w-3 h-3 mr-1" /> Start
                    </Button>
                  ) : (
                    <Button 
                      size="sm" 
                      variant="destructive" 
                      className="flex-1 h-7 text-[11px]"
                      onClick={() => stopBot(bot.id)}
                    >
                      <StopCircle className="w-3 h-3 mr-1" /> Stop
                    </Button>
                  )}
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button size="sm" variant="outline" className="flex-1 h-7 text-[11px]">
                        <Settings className="w-3 h-3 mr-1" /> Config
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-md">
                      <DialogHeader>
                        <DialogTitle>Configure {bot.config.name}</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-3 py-2">
                        <div>
                          <label className="text-xs font-medium">Bot Name</label>
                          <Input 
                            value={bot.config.name}
                            onChange={(e) => updateBotConfig(bot.id, { name: e.target.value })}
                            className="h-8 text-sm"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-xs font-medium">Signal Type</label>
                            <Select value={bot.config.signalType} onValueChange={(v: any) => updateBotConfig(bot.id, { signalType: v })}>
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="ANY">Any Signal</SelectItem>
                                <SelectItem value="OVER">OVER Only</SelectItem>
                                <SelectItem value="UNDER">UNDER Only</SelectItem>
                                <SelectItem value="ODD">ODD Only</SelectItem>
                                <SelectItem value="EVEN">EVEN Only</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <label className="text-xs font-medium">Min Strength</label>
                            <Input 
                              type="number" 
                              step="0.05"
                              value={bot.config.minSignalStrength}
                              onChange={(e) => updateBotConfig(bot.id, { minSignalStrength: parseFloat(e.target.value) })}
                              className="h-8 text-xs"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-xs font-medium">Stake ($)</label>
                            <Input 
                              type="number" 
                              step="0.1"
                              value={bot.config.stake}
                              onChange={(e) => updateBotConfig(bot.id, { stake: parseFloat(e.target.value) })}
                              className="h-8 text-xs"
                            />
                          </div>
                          <div>
                            <label className="text-xs font-medium">Recovery</label>
                            <Input 
                              type="number"
                              value={bot.config.recoveryThreshold}
                              onChange={(e) => updateBotConfig(bot.id, { recoveryThreshold: parseInt(e.target.value) })}
                              className="h-8 text-xs"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-xs font-medium">Take Profit</label>
                            <Input 
                              type="number"
                              value={bot.config.takeProfit}
                              onChange={(e) => updateBotConfig(bot.id, { takeProfit: parseFloat(e.target.value) })}
                              className="h-8 text-xs"
                            />
                          </div>
                          <div>
                            <label className="text-xs font-medium">Stop Loss</label>
                            <Input 
                              type="number"
                              value={bot.config.stopLoss}
                              onChange={(e) => updateBotConfig(bot.id, { stopLoss: parseFloat(e.target.value) })}
                              className="h-8 text-xs"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-xs font-medium">Martingale</label>
                            <Input 
                              type="number"
                              step="0.1"
                              value={bot.config.martingaleMultiplier}
                              onChange={(e) => updateBotConfig(bot.id, { martingaleMultiplier: parseFloat(e.target.value) })}
                              className="h-8 text-xs"
                            />
                          </div>
                          <div>
                            <label className="text-xs font-medium">Max Steps</label>
                            <Input 
                              type="number"
                              value={bot.config.martingaleMaxSteps}
                              onChange={(e) => updateBotConfig(bot.id, { martingaleMaxSteps: parseInt(e.target.value) })}
                              className="h-8 text-xs"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="text-xs font-medium">Trading Interval (ms)</label>
                          <Input 
                            type="number"
                            value={bot.config.tradingInterval}
                            onChange={(e) => updateBotConfig(bot.id, { tradingInterval: parseInt(e.target.value) })}
                            className="h-8 text-xs"
                          />
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Recent Trades */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Clock className="w-4 h-4" /> Recent Trades
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[250px]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-background">
                <tr className="border-b">
                  <th className="text-left p-1">Time</th>
                  <th className="text-left p-1">Bot</th>
                  <th className="text-left p-1">Signal</th>
                  <th className="text-right p-1">Stake</th>
                  <th className="text-center p-1">Result</th>
                  <th className="text-right p-1">P/L</th>
                  <th className="text-center p-1">Digit</th>
                 </tr>
              </thead>
              <tbody>
                {tradeLogs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-6 text-muted-foreground">
                      No trades yet. Start bots to see activity.
                    </td>
                  </tr>
                ) : (
                  tradeLogs.slice(0, 30).map((log) => (
                    <tr key={log.id} className="border-b hover:bg-muted/30">
                      <td className="p-1 font-mono text-[10px]">{log.time.toLocaleTimeString()}</td>
                      <td className="p-1 text-[10px]">{log.botName}</td>
                      <td className="p-1 text-[10px]">{log.direction}</td>
                      <td className="p-1 text-right font-mono text-[10px]">${log.stake.toFixed(2)}</td>
                      <td className="p-1 text-center">
                        {log.result === 'Win' ? (
                          <CheckCircle className="w-3 h-3 text-green-500 inline" />
                        ) : log.result === 'Loss' ? (
                          <XCircle className="w-3 h-3 text-red-500 inline" />
                        ) : (
                          <Clock className="w-3 h-3 text-yellow-500 inline animate-pulse" />
                        )}
                      </td>
                      <td className={`p-1 text-right font-mono text-[10px] ${log.pnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                        {log.pnl >= 0 ? '+' : ''}{log.pnl.toFixed(2)}
                      </td>
                      <td className="p-1 text-center font-mono text-[10px]">{log.exitDigit || '-'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Footer */}
      <div className="flex justify-between items-center text-[10px] text-muted-foreground border-t border-border pt-3">
        <div className="flex items-center gap-4">
          <span>⚡ {bots.length} Bots</span>
          <span>📊 {connectedMarkets} Markets</span>
          <span>🎯 Signal Strength Filtering</span>
          <span>🔄 Martingale Risk Management</span>
        </div>
        <div>
          Balance: <span className="font-mono font-bold">${balance.toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
}

export default AdaptiveMultiBot;
