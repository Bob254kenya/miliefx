import { useState, useRef, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { derivApi } from '@/services/deriv-api';
import { useAuth } from '@/contexts/AuthContext';
import { useTickLoader } from '@/hooks/useTickLoader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Play, StopCircle, Pause, TrendingUp, TrendingDown, CircleDot, RefreshCw, Trash2, DollarSign, Sparkles, Scan, Volume2, AlertTriangle, CheckCircle2, Clock, Radio, Activity } from 'lucide-react';

// Types
interface DigitAnalysis {
  mostAppearing: number;
  secondMost: number;
  thirdMost: number;
  leastAppearing: number;
  evenCount: number;
  oddCount: number;
  lastDigit: number;
  previousDigit: number;
}

interface BotSignal {
  id: string;
  market: string;
  botType: BotType;
  status: 'waiting_entry' | 'entry_triggered' | 'trading' | 'cooldown';
  entryCondition: boolean;
  analysis: DigitAnalysis;
  timestamp: number;
}

interface BotState {
  id: string;
  name: string;
  type: BotType;
  isRunning: boolean;
  isPaused: boolean;
  currentStake: number;
  totalPnl: number;
  trades: number;
  wins: number;
  losses: number;
  contractType: string;
  barrier?: number;
  selectedMarket?: string;
  status: 'idle' | 'waiting' | 'trading' | 'cooldown';
  consecutiveLosses: number;
  entryTriggered: boolean;
  cooldownRemaining: number;
  lastTradeResult?: 'win' | 'loss';
  recoveryMode: boolean;
  signal: boolean;
}

type BotType = 'over1' | 'under8' | 'even' | 'odd' | 'over3' | 'under6';

interface TradeLog {
  id: number;
  time: string;
  market: string;
  contract: string;
  stake: number;
  result: 'Pending' | 'Win' | 'Loss';
  pnl: number;
  bot: string;
  lastDigit?: number;
}

interface ScannedMarket {
  name: string;
  digits: number[];
  analysis: DigitAnalysis;
  signals: BotType[];
}

// Constants
const VOLATILITY_MARKETS = [
  // Volatility indices
  'R_10', 'R_25', 'R_50', 'R_75', 'R_100',
  // 1HZ indices
  '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V',
  // Boom & Crash
  'BOOM300', 'BOOM500', 'BOOM1000',
  'CRASH300', 'CRASH500', 'CRASH1000',
  // Jump indices
  'JD10', 'JD25', 'JD50', 'JD75', 'JD100',
  // Bear/Bull
  'RDBEAR', 'RDBULL'
];

const BOT_CONFIGS: Record<BotType, { name: string; contractType: string; barrier?: number; entryCheck: (digits: number[]) => boolean; marketCheck: (analysis: DigitAnalysis) => boolean }> = {
  over1: {
    name: 'OVER 1 BOT',
    contractType: 'DIGITOVER',
    barrier: 1,
    entryCheck: (digits) => digits.length >= 2 && digits.slice(-2).every(d => d <= 1),
    marketCheck: (analysis) => analysis.mostAppearing > 4 && analysis.secondMost > 4 && analysis.leastAppearing > 4
  },
  under8: {
    name: 'UNDER 8 BOT',
    contractType: 'DIGITUNDER',
    barrier: 8,
    entryCheck: (digits) => digits.length >= 2 && digits.slice(-2).every(d => d >= 8),
    marketCheck: (analysis) => analysis.mostAppearing < 6 && analysis.secondMost < 6 && analysis.leastAppearing < 6
  },
  even: {
    name: 'EVEN BOT',
    contractType: 'DIGITEVEN',
    entryCheck: (digits) => digits.length >= 3 && digits.slice(-3).every(d => d % 2 === 1),
    marketCheck: (analysis) => analysis.mostAppearing % 2 === 0 && analysis.secondMost % 2 === 0 && analysis.leastAppearing % 2 === 0
  },
  odd: {
    name: 'ODD BOT',
    contractType: 'DIGITODD',
    entryCheck: (digits) => digits.length >= 3 && digits.slice(-3).every(d => d % 2 === 0),
    marketCheck: (analysis) => analysis.mostAppearing % 2 === 1 && analysis.secondMost % 2 === 1 && analysis.thirdMost % 2 === 1
  },
  over3: {
    name: 'OVER 3 BOT',
    contractType: 'DIGITOVER',
    barrier: 3,
    entryCheck: (digits) => digits.length >= 3 && digits.slice(-3).every(d => d <= 2),
    marketCheck: (analysis) => analysis.mostAppearing > 4 && analysis.secondMost > 4 && analysis.leastAppearing > 4
  },
  under6: {
    name: 'UNDER 6 BOT',
    contractType: 'DIGITUNDER',
    barrier: 6,
    entryCheck: (digits) => digits.length >= 3 && digits.slice(-3).every(d => d >= 7),
    marketCheck: (analysis) => analysis.mostAppearing < 5 && analysis.secondMost < 5 && analysis.leastAppearing < 5
  }
};

// Voice alert system
class VoiceAlertSystem {
  private static instance: VoiceAlertSystem;
  private speech: SpeechSynthesisUtterance | null = null;
  private lastScanMessage: number = 0;

  private constructor() {
    if (typeof window !== 'undefined') {
      this.speech = new SpeechSynthesisUtterance();
      this.speech.rate = 0.9;
      this.speech.pitch = 0.8;
      this.speech.volume = 0.7;
    }
  }

  static getInstance() {
    if (!VoiceAlertSystem.instance) {
      VoiceAlertSystem.instance = new VoiceAlertSystem();
    }
    return VoiceAlertSystem.instance;
  }

  speak(text: string) {
    if (!this.speech || typeof window === 'undefined') return;
    
    window.speechSynthesis.cancel();
    this.speech.text = text;
    window.speechSynthesis.speak(this.speech);
  }

  scanAlert() {
    const now = Date.now();
    if (now - this.lastScanMessage > 20000) {
      this.speak("Scanning the markets for money... stay ready.");
      this.lastScanMessage = now;
    }
  }

  signalFound() {
    this.speak("Signal found. Prepare to trade.");
  }
}

// Digit analysis function
const analyzeDigits = (digits: number[]): DigitAnalysis => {
  if (digits.length < 1000) return {} as DigitAnalysis;
  
  const last1000 = digits.slice(-1000);
  const counts: Record<number, number> = {};
  for (let i = 0; i <= 9; i++) counts[i] = 0;
  last1000.forEach(d => counts[d]++);
  
  const sortedDigits = [...Array(10).keys()].sort((a, b) => counts[b] - counts[a]);
  
  const evenDigits = [0,2,4,6,8];
  const oddDigits = [1,3,5,7,9];
  const evenCount = evenDigits.reduce((sum, d) => sum + counts[d], 0);
  const oddCount = oddDigits.reduce((sum, d) => sum + counts[d], 0);
  
  return {
    mostAppearing: sortedDigits[0],
    secondMost: sortedDigits[1],
    thirdMost: sortedDigits[2],
    leastAppearing: sortedDigits[9],
    evenCount,
    oddCount,
    lastDigit: digits[digits.length - 1] || 0,
    previousDigit: digits[digits.length - 2] || 0
  };
};

// Dollar background animation component
const DollarBackground = () => (
  <div className="fixed inset-0 pointer-events-none overflow-hidden">
    {[...Array(30)].map((_, i) => (
      <motion.div
        key={i}
        className="absolute text-green-500/5"
        initial={{
          x: Math.random() * window.innerWidth,
          y: window.innerHeight + 100,
          rotate: Math.random() * 360,
          scale: Math.random() * 0.5 + 0.3,
        }}
        animate={{
          y: -100,
          rotate: Math.random() * 720,
          x: `calc(${Math.random() * 100}vw + ${Math.sin(i) * 50}px)`,
        }}
        transition={{
          duration: Math.random() * 15 + 10,
          repeat: Infinity,
          ease: "linear",
          delay: Math.random() * 10,
        }}
      >
        <DollarSign className="w-8 h-8" />
      </motion.div>
    ))}
  </div>
);

// Signal Card Component
const SignalCard = ({ signal, onAssign }: { signal: BotSignal; onAssign: (signal: BotSignal) => void }) => {
  const config = BOT_CONFIGS[signal.botType];
  
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={{ scale: 1.02 }}
      className="bg-gradient-to-br from-gray-900 to-gray-800 border border-green-500/30 rounded-xl p-4 shadow-xl"
    >
      <div className="flex items-center justify-between mb-3">
        <Badge variant="outline" className="bg-green-500/10 text-green-400 border-green-500/30">
          {signal.market}
        </Badge>
        <Badge className={
          signal.botType.includes('over') ? 'bg-blue-500/20 text-blue-400' :
          signal.botType.includes('under') ? 'bg-orange-500/20 text-orange-400' :
          signal.botType === 'even' ? 'bg-green-500/20 text-green-400' :
          'bg-purple-500/20 text-purple-400'
        }>
          {config.name}
        </Badge>
      </div>
      
      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">Status:</span>
          <span className={signal.status === 'waiting_entry' ? 'text-yellow-400' : 'text-green-400'}>
            {signal.status === 'waiting_entry' ? '⏳ WAITING ENTRY' : '✅ ENTRY READY'}
          </span>
        </div>
        
        <div className="grid grid-cols-2 gap-2 text-xs bg-black/30 rounded-lg p-2">
          <div>
            <span className="text-gray-500">Most:</span>
            <span className="ml-1 text-green-400">{signal.analysis.mostAppearing}</span>
          </div>
          <div>
            <span className="text-gray-500">2nd:</span>
            <span className="ml-1 text-green-400">{signal.analysis.secondMost}</span>
          </div>
          <div>
            <span className="text-gray-500">3rd:</span>
            <span className="ml-1 text-green-400">{signal.analysis.thirdMost}</span>
          </div>
          <div>
            <span className="text-gray-500">Least:</span>
            <span className="ml-1 text-green-400">{signal.analysis.leastAppearing}</span>
          </div>
        </div>
        
        <div className="flex justify-between text-xs">
          <span className="text-gray-400">Last digit:</span>
          <span className="font-mono text-green-400">{signal.analysis.lastDigit}</span>
          <span className="text-gray-400">Previous:</span>
          <span className="font-mono text-green-400">{signal.analysis.previousDigit}</span>
        </div>
      </div>
      
      <Button
        onClick={() => onAssign(signal)}
        className="w-full mt-3 bg-green-500/20 hover:bg-green-500/30 text-green-400 border border-green-500/30"
        size="sm"
      >
        <Play className="w-3 h-3 mr-1" /> Assign to Bot
      </Button>
    </motion.div>
  );
};

// Main Component
export default function AutoTrade() {
  const { isAuthorized, balance } = useAuth();
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanTimeRemaining, setScanTimeRemaining] = useState(30);
  const [scanStatus, setScanStatus] = useState('');
  const [currentScanningMarket, setCurrentScanningMarket] = useState('');
  const [scannedMarkets, setScannedMarkets] = useState<ScannedMarket[]>([]);
  const [signals, setSignals] = useState<BotSignal[]>([]);
  const [marketDigits, setMarketDigits] = useState<Record<string, number[]>>({});
  const [activeTradeId, setActiveTradeId] = useState<string | null>(null);
  const [showMarketSelector, setShowMarketSelector] = useState(false);
  
  // Bot states
  const [bots, setBots] = useState<BotState[]>(
    Object.entries(BOT_CONFIGS).map(([type, config], index) => ({
      id: `bot${index + 1}`,
      name: config.name,
      type: type as BotType,
      isRunning: false,
      isPaused: false,
      currentStake: 0.5,
      totalPnl: 0,
      trades: 0,
      wins: 0,
      losses: 0,
      contractType: config.contractType,
      barrier: config.barrier,
      status: 'idle',
      consecutiveLosses: 0,
      entryTriggered: false,
      cooldownRemaining: 0,
      recoveryMode: false,
      signal: false
    }))
  );

  // Settings
  const [globalStake, setGlobalStake] = useState(0.5);
  const [globalMultiplier, setGlobalMultiplier] = useState(2);
  const [globalStopLoss, setGlobalStopLoss] = useState(30);
  const [globalTakeProfit, setGlobalTakeProfit] = useState(5);
  
  // Trade log
  const [trades, setTrades] = useState<TradeLog[]>([]);
  const tradeIdRef = useRef(0);
  const botRunningRefs = useRef<Record<string, boolean>>({});
  const botPausedRefs = useRef<Record<string, boolean>>({});
  const voiceSystem = VoiceAlertSystem.getInstance();
  const scanTimerRef = useRef<NodeJS.Timeout>();

  // Fetch ticks for a market
  const fetchMarketTicks = async (market: string): Promise<number[]> => {
    try {
      const ticks = await derivApi.getTicks(market, 1000);
      return ticks.map((t: any) => Math.floor(t.quote) % 10);
    } catch (error) {
      console.error(`Failed to fetch ticks for ${market}:`, error);
      return [];
    }
  };

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (scanTimerRef.current) {
        clearInterval(scanTimerRef.current);
      }
    };
  }, []);

  // Scan all markets
  const scanAllMarkets = useCallback(async () => {
    if (isScanning) return;
    
    setIsScanning(true);
    setScanProgress(0);
    setScanTimeRemaining(30);
    setSignals([]);
    setScannedMarkets([]);
    setShowMarketSelector(false);
    
    const newSignals: BotSignal[] = [];
    const scannedList: ScannedMarket[] = [];
    const totalMarkets = VOLATILITY_MARKETS.length;
    const digitsRecord: Record<string, number[]> = {};
    
    // Start 30-second timer
    const startTime = Date.now();
    scanTimerRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const remaining = Math.max(0, 30 - elapsed);
      setScanTimeRemaining(remaining);
      
      if (remaining <= 0) {
        clearInterval(scanTimerRef.current);
      }
    }, 100);
    
    try {
      for (let i = 0; i < VOLATILITY_MARKETS.length; i++) {
        const market = VOLATILITY_MARKETS[i];
        setCurrentScanningMarket(market);
        setScanStatus(`Scanning ${market}... (${i + 1}/${totalMarkets})`);
        setScanProgress(((i + 1) / totalMarkets) * 100);
        
        // Voice alert every 20 seconds
        if (i % 4 === 0) voiceSystem.scanAlert();
        
        const digits = await fetchMarketTicks(market);
        if (digits.length >= 1000) {
          digitsRecord[market] = digits;
          const analysis = analyzeDigits(digits);
          
          const marketSignals: BotType[] = [];
          
          // Check each bot type against market conditions
          for (const [botType, config] of Object.entries(BOT_CONFIGS)) {
            if (config.marketCheck(analysis)) {
              marketSignals.push(botType as BotType);
              
              newSignals.push({
                id: `${market}-${botType}-${Date.now()}`,
                market,
                botType: botType as BotType,
                status: 'waiting_entry',
                entryCondition: config.entryCheck(digits),
                analysis,
                timestamp: Date.now()
              });
            }
          }
          
          scannedList.push({
            name: market,
            digits,
            analysis,
            signals: marketSignals
          });
        }
        
        // Small delay to prevent rate limiting
        await new Promise(r => setTimeout(r, 100));
      }
      
      // Ensure we wait for full 30 seconds
      const elapsed = Date.now() - startTime;
      if (elapsed < 30000) {
        await new Promise(r => setTimeout(r, 30000 - elapsed));
      }
      
      setMarketDigits(digitsRecord);
      setScannedMarkets(scannedList);
      setSignals(newSignals);
      setShowMarketSelector(true);
      
      if (newSignals.length > 0) {
        voiceSystem.signalFound();
        toast.success(`Scan complete! Found ${newSignals.length} trading signals across ${scannedList.length} markets!`);
      } else {
        toast.info('Scan complete. No signals found in any market.');
      }
      
    } catch (error) {
      console.error('Scan error:', error);
      toast.error('Scan failed. Please try again.');
    } finally {
      setIsScanning(false);
      setScanProgress(100);
      setScanStatus('');
      setCurrentScanningMarket('');
      if (scanTimerRef.current) {
        clearInterval(scanTimerRef.current);
      }
    }
  }, [isScanning]);

  // Assign signal to bot
  const assignSignalToBot = (signal: BotSignal) => {
    const availableBot = bots.find(b => !b.isRunning && !b.selectedMarket);
    if (!availableBot) {
      toast.error('No available bots. Stop a running bot first.');
      return;
    }
    
    setBots(prev => prev.map(b => 
      b.id === availableBot.id ? {
        ...b,
        selectedMarket: signal.market,
        status: 'waiting'
      } : b
    ));
    
    toast.success(`Assigned ${signal.market} to ${availableBot.name}`);
  };

  // Wait for next tick
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

  // Run bot logic
  const runBot = useCallback(async (botId: string) => {
    const bot = bots.find(b => b.id === botId);
    if (!bot || !isAuthorized || !bot.selectedMarket) return;

    if (balance < globalStake) {
      toast.error(`Insufficient balance for ${bot.name}`);
      return;
    }

    setBots(prev => prev.map(b => b.id === botId ? { 
      ...b, 
      isRunning: true, 
      isPaused: false, 
      currentStake: globalStake,
      status: 'waiting'
    } : b));
    
    botRunningRefs.current[botId] = true;
    botPausedRefs.current[botId] = false;

    let stake = globalStake;
    let totalPnl = bot.totalPnl;
    let tradeCount = bot.trades;
    let wins = bot.wins;
    let losses = bot.losses;
    let consecutiveLosses = 0;
    let entryTriggered = false;
    let cooldownRemaining = 0;
    let recoveryMode = false;

    const currentMarket = bot.selectedMarket;
    const config = BOT_CONFIGS[bot.type];

    while (botRunningRefs.current[botId]) {
      if (botPausedRefs.current[botId]) {
        await new Promise(r => setTimeout(r, 500));
        continue;
      }

      if (totalPnl <= -globalStopLoss) {
        toast.error(`${bot.name}: Stop Loss! $${totalPnl.toFixed(2)}`);
        break;
      }
      if (totalPnl >= globalTakeProfit) {
        toast.success(`${bot.name}: Take Profit! +$${totalPnl.toFixed(2)}`);
        break;
      }

      if (cooldownRemaining > 0) {
        setBots(prev => prev.map(b => b.id === botId ? { 
          ...b, 
          status: 'cooldown',
          cooldownRemaining 
        } : b));
        await new Promise(r => setTimeout(r, 1000));
        cooldownRemaining--;
        continue;
      }

      const marketDigitsList = marketDigits[currentMarket] || [];
      const currentSignal = config.entryCheck(marketDigitsList);

      setBots(prev => prev.map(b => b.id === botId ? { ...b, signal: currentSignal } : b));

      let shouldEnter = false;
      if (!entryTriggered && !recoveryMode) {
        shouldEnter = currentSignal;
      }

      if (!entryTriggered && !recoveryMode) {
        setBots(prev => prev.map(b => b.id === botId ? { ...b, status: 'waiting' } : b));
        if (!shouldEnter) {
          await new Promise(r => setTimeout(r, 500));
          continue;
        } else {
          entryTriggered = true;
          setBots(prev => prev.map(b => b.id === botId ? { ...b, status: 'trading' } : b));
        }
      }

      try {
        await waitForNextTick(currentMarket);

        if (activeTradeId) {
          await new Promise(r => setTimeout(r, 500));
          continue;
        }

        const params: any = {
          contract_type: bot.contractType,
          symbol: currentMarket,
          duration: 1,
          duration_unit: 't',
          basis: 'stake',
          amount: stake,
        };

        if (bot.barrier !== undefined) {
          params.barrier = bot.barrier.toString();
        }

        const id = ++tradeIdRef.current;
        const now = new Date().toLocaleTimeString();
        const tradeId = `${botId}-${id}`;
        setActiveTradeId(tradeId);

        setTrades(prev => [{
          id,
          time: now,
          market: currentMarket,
          contract: bot.contractType,
          stake,
          result: 'Pending',
          pnl: 0,
          bot: bot.name,
          lastDigit: marketDigitsList[marketDigitsList.length - 1]
        }, ...prev].slice(0, 100));

        const { contractId } = await derivApi.buyContract(params);
        const result = await derivApi.waitForContractResult(contractId);
        const won = result.status === 'won';
        const pnl = result.profit;

        setTrades(prev => prev.map(t => t.id === id ? { ...t, result: won ? 'Win' : 'Loss', pnl } : t));

        totalPnl += pnl;
        tradeCount++;
        
        if (won) {
          wins++;
          consecutiveLosses = 0;
          stake = globalStake;
          entryTriggered = false;
          recoveryMode = false;
          cooldownRemaining = 0;
        } else {
          losses++;
          consecutiveLosses++;
          stake = Math.round(stake * globalMultiplier * 100) / 100;
          recoveryMode = true;
          entryTriggered = false;
          
          if (bot.type === 'even' || bot.type === 'odd') {
            cooldownRemaining = 5;
          }
        }

        setBots(prev => prev.map(b => {
          if (b.id === botId) {
            return {
              ...b,
              totalPnl,
              trades: tradeCount,
              wins,
              losses,
              currentStake: stake,
              consecutiveLosses,
              status: cooldownRemaining > 0 ? 'cooldown' : (recoveryMode ? 'waiting' : (entryTriggered ? 'trading' : 'waiting')),
              cooldownRemaining,
              recoveryMode,
              lastTradeResult: won ? 'win' : 'loss',
              signal: currentSignal
            };
          }
          return b;
        }));

        setActiveTradeId(null);
        await new Promise(r => setTimeout(r, 500));

      } catch (err: any) {
        setActiveTradeId(null);
        if (err.message?.includes('Insufficient balance')) {
          toast.error(`Insufficient balance for ${bot.name}`);
          break;
        } else {
          console.error(`Trade error:`, err);
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    }

    setBots(prev => prev.map(b => b.id === botId ? { 
      ...b, 
      isRunning: false, 
      isPaused: false,
      status: 'idle',
      cooldownRemaining: 0,
      signal: false
    } : b));
    
    botRunningRefs.current[botId] = false;
  }, [isAuthorized, balance, globalStake, globalMultiplier, globalStopLoss, globalTakeProfit, activeTradeId, bots, marketDigits]);

  const startBot = (botId: string) => {
    const bot = bots.find(b => b.id === botId);
    if (!bot || bot.isRunning) return;
    setTimeout(() => runBot(botId), 0);
  };

  const pauseBot = (botId: string) => {
    botPausedRefs.current[botId] = !botPausedRefs.current[botId];
    setBots(prev => prev.map(b => b.id === botId ? { ...b, isPaused: botPausedRefs.current[botId] } : b));
  };

  const stopBot = (botId: string) => {
    botRunningRefs.current[botId] = false;
    setBots(prev => prev.map(b => b.id === botId ? { 
      ...b, 
      isRunning: false, 
      isPaused: false,
      status: 'idle',
      cooldownRemaining: 0,
      signal: false
    } : b));
  };

  const stopAllBots = () => {
    bots.forEach(bot => {
      botRunningRefs.current[bot.id] = false;
    });
    setBots(prev => prev.map(b => ({ 
      ...b, 
      isRunning: false, 
      isPaused: false,
      status: 'idle',
      cooldownRemaining: 0,
      signal: false
    })));
  };

  const clearAll = () => {
    setTrades([]);
    setSignals([]);
    setScannedMarkets([]);
    setShowMarketSelector(false);
    setBots(prev => prev.map(bot => ({
      ...bot,
      totalPnl: 0,
      trades: 0,
      wins: 0,
      losses: 0,
      currentStake: globalStake,
      status: 'idle',
      consecutiveLosses: 0,
      entryTriggered: false,
      cooldownRemaining: 0,
      recoveryMode: false,
      signal: false,
      selectedMarket: undefined
    })));
    tradeIdRef.current = 0;
    toast.success('All data cleared');
  };

  const totalProfit = bots.reduce((sum, bot) => sum + bot.totalPnl, 0);
  const totalTrades = bots.reduce((sum, bot) => sum + bot.trades, 0);
  const totalWins = bots.reduce((sum, bot) => sum + bot.wins, 0);
  const winRate = totalTrades > 0 ? ((totalWins / totalTrades) * 100).toFixed(1) : '0';

  // Get market display name
  const getMarketDisplay = (market: string) => {
    if (market.startsWith('1HZ')) return `⚡ ${market}`;
    if (market.startsWith('R_')) return `📈 ${market}`;
    if (market.startsWith('BOOM')) return `💥 ${market}`;
    if (market.startsWith('CRASH')) return `📉 ${market}`;
    if (market.startsWith('JD')) return `🦘 ${market}`;
    if (market === 'RDBEAR') return '🐻 Bear Market';
    if (market === 'RDBULL') return '🐂 Bull Market';
    return market;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white">
      <DollarBackground />

      <div className="relative z-10 container mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <motion.div 
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="text-center"
        >
          <h1 className="text-3xl font-bold bg-gradient-to-r from-green-400 to-yellow-400 bg-clip-text text-transparent">
            Automated Market Scanner
          </h1>
          <p className="text-gray-400 mt-2">Multi-market analysis & automated trading system</p>
        </motion.div>

        {/* Stats Bar */}
        <motion.div 
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="grid grid-cols-5 gap-4 bg-gray-800/50 backdrop-blur border border-green-500/20 rounded-xl p-4"
        >
          <div className="text-center">
            <div className="text-gray-400 text-sm">Balance</div>
            <div className="text-xl font-bold text-green-400">${balance?.toFixed(2) || '0.00'}</div>
          </div>
          <div className="text-center">
            <div className="text-gray-400 text-sm">Total P&L</div>
            <div className={`text-xl font-bold ${totalProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              ${totalProfit.toFixed(2)}
            </div>
          </div>
          <div className="text-center">
            <div className="text-gray-400 text-sm">Win Rate</div>
            <div className="text-xl font-bold text-yellow-400">{winRate}%</div>
          </div>
          <div className="text-center">
            <div className="text-gray-400 text-sm">Active Bots</div>
            <div className="text-xl font-bold text-blue-400">{bots.filter(b => b.isRunning).length}/6</div>
          </div>
          <div className="text-center">
            <div className="text-gray-400 text-sm">Markets</div>
            <div className="text-xl font-bold text-purple-400">{scannedMarkets.length}</div>
          </div>
        </motion.div>

        {/* Scanner Section - Redesigned */}
        <motion.div 
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="relative"
        >
          {/* Scanner Container */}
          <div className="bg-gray-800/50 backdrop-blur border-2 border-green-500/30 rounded-2xl p-8 shadow-2xl shadow-green-500/10">
            <div className="flex flex-col items-center space-y-6">
              {/* Scanner Title */}
              <div className="text-center space-y-2">
                <h2 className="text-2xl font-semibold text-green-400 flex items-center justify-center gap-2">
                  <Radio className="w-6 h-6 animate-pulse" />
                  Market Scanner Control
                  <Activity className="w-6 h-6 animate-pulse" />
                </h2>
                <p className="text-gray-400 text-sm">Click the button below to scan all 25+ markets for trading opportunities</p>
              </div>

              {/* Main Scanner Button */}
              <div className="relative">
                {/* Animated Rings */}
                {!isScanning && !showMarketSelector && (
                  <>
                    <motion.div
                      animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.5, 0.3] }}
                      transition={{ duration: 2, repeat: Infinity }}
                      className="absolute inset-0 rounded-full bg-green-500/20 blur-xl"
                    />
                    <motion.div
                      animate={{ scale: [1, 1.1, 1], opacity: [0.2, 0.4, 0.2] }}
                      transition={{ duration: 2, repeat: Infinity, delay: 0.5 }}
                      className="absolute inset-0 rounded-full bg-yellow-500/20 blur-lg"
                    />
                  </>
                )}

                <Button
                  onClick={scanAllMarkets}
                  disabled={isScanning}
                  className={`relative w-48 h-48 rounded-full text-white font-bold text-xl shadow-2xl transition-all duration-300 ${
                    isScanning 
                      ? 'bg-gradient-to-r from-green-600 to-yellow-600 cursor-not-allowed'
                      : 'bg-gradient-to-r from-green-500 to-yellow-500 hover:from-green-600 hover:to-yellow-600 hover:scale-105'
                  }`}
                >
                  <div className="absolute inset-2 rounded-full bg-gray-900 flex items-center justify-center">
                    {isScanning ? (
                      <div className="text-center">
                        <Loader2 className="w-12 h-12 animate-spin mx-auto mb-2 text-green-400" />
                        <span className="text-sm text-green-400">SCANNING...</span>
                        <span className="block text-xs text-yellow-400 mt-1">{scanTimeRemaining}s</span>
                      </div>
                    ) : showMarketSelector ? (
                      <div className="text-center">
                        <CheckCircle2 className="w-12 h-12 mx-auto mb-2 text-green-400" />
                        <span className="text-sm text-green-400">SCAN</span>
                        <span className="block text-xs text-gray-400 mt-1">COMPLETE</span>
                      </div>
                    ) : (
                      <div className="text-center">
                        <Scan className="w-12 h-12 mx-auto mb-2 text-green-400" />
                        <span className="text-sm text-green-400">START</span>
                        <span className="block text-xs text-gray-400 mt-1">30 SECOND SCAN</span>
                      </div>
                    )}
                  </div>
                </Button>
              </div>

              {/* Progress Bar */}
              {isScanning && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="w-full max-w-md space-y-3"
                >
                  <div className="flex justify-between text-sm">
                    <span className="text-green-400 flex items-center gap-1">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      {currentScanningMarket}
                    </span>
                    <span className="text-yellow-400 font-mono">{Math.round(scanProgress)}%</span>
                  </div>
                  
                  <div className="relative h-4 bg-gray-700 rounded-full overflow-hidden">
                    <motion.div 
                      className="absolute inset-0 bg-gradient-to-r from-green-400 via-yellow-400 to-green-400"
                      initial={{ width: 0 }}
                      animate={{ width: `${scanProgress}%` }}
                      transition={{ duration: 0.3 }}
                    />
                  </div>

                  <div className="flex justify-between items-center text-xs">
                    <span className="text-gray-400 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Time remaining
                    </span>
                    <span className="text-green-400 font-mono font-bold">{scanTimeRemaining}s</span>
                  </div>
                </motion.div>
              )}

              {/* Scan Results Summary */}
              {showMarketSelector && !isScanning && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="w-full max-w-2xl"
                >
                  <div className="bg-gray-900/50 border border-green-500/20 rounded-xl p-4">
                    <h3 className="text-lg font-semibold text-green-400 mb-3 flex items-center gap-2">
                      <CheckCircle2 className="w-5 h-5" />
                      Scan Complete - Choose Your Market
                    </h3>
                    
                    <div className="grid grid-cols-3 gap-3">
                      <div className="text-center p-3 bg-gray-800 rounded-lg">
                        <div className="text-2xl font-bold text-green-400">{scannedMarkets.length}</div>
                        <div className="text-xs text-gray-400">Markets Scanned</div>
                      </div>
                      <div className="text-center p-3 bg-gray-800 rounded-lg">
                        <div className="text-2xl font-bold text-yellow-400">{signals.length}</div>
                        <div className="text-xs text-gray-400">Signals Found</div>
                      </div>
                      <div className="text-center p-3 bg-gray-800 rounded-lg">
                        <div className="text-2xl font-bold text-purple-400">
                          {scannedMarkets.filter(m => m.signals.length > 0).length}
                        </div>
                        <div className="text-xs text-gray-400">Active Markets</div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </div>
          </div>
        </motion.div>

        {/* Market Selector Dropdown - Appears after scan */}
        <AnimatePresence>
          {showMarketSelector && !isScanning && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="bg-gray-800/50 backdrop-blur border border-green-500/20 rounded-xl p-4"
            >
              <h2 className="text-lg font-semibold mb-3 text-green-400 flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-yellow-400" />
                Available Markets ({scannedMarkets.length})
              </h2>
              
              <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2 max-h-60 overflow-y-auto p-2">
                {scannedMarkets.map((market) => (
                  <motion.button
                    key={market.name}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => {
                      // Handle market selection - you can add your logic here
                      toast.info(`Selected ${market.name}`);
                    }}
                    className={`p-3 rounded-lg border transition-all ${
                      market.signals.length > 0
                        ? 'bg-green-500/10 border-green-500/30 hover:bg-green-500/20'
                        : 'bg-gray-700/50 border-gray-600/30 hover:bg-gray-600/50'
                    }`}
                  >
                    <div className="text-xs font-mono">{getMarketDisplay(market.name)}</div>
                    {market.signals.length > 0 && (
                      <Badge className="mt-1 bg-green-500/20 text-green-400 text-[8px]">
                        {market.signals.length} signal{market.signals.length > 1 ? 's' : ''}
                      </Badge>
                    )}
                  </motion.button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Settings Panel */}
        <motion.div 
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="bg-gray-800/50 backdrop-blur border border-green-500/20 rounded-xl p-4"
        >
          <h2 className="text-lg font-semibold mb-3 text-green-400">⚙️ Global Settings</h2>
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: 'Stake ($)', value: globalStake, setter: setGlobalStake, step: '0.1', min: '0.1' },
              { label: 'Multiplier', value: globalMultiplier, setter: setGlobalMultiplier, step: '0.1', min: '1.1' },
              { label: 'Stop Loss ($)', value: globalStopLoss, setter: setGlobalStopLoss, step: '1', min: '1' },
              { label: 'Take Profit ($)', value: globalTakeProfit, setter: setGlobalTakeProfit, step: '1', min: '1' },
            ].map((setting, i) => (
              <div key={i} className="space-y-1">
                <label className="text-sm text-gray-400">{setting.label}</label>
                <input 
                  type="number" 
                  value={setting.value} 
                  onChange={(e) => setting.setter(parseFloat(e.target.value) || 0.5)}
                  className="w-full bg-gray-900 border border-green-500/30 rounded-lg px-3 py-2 text-green-400 focus:outline-none focus:border-green-400"
                  step={setting.step}
                  min={setting.min}
                />
              </div>
            ))}
          </div>
          <div className="flex justify-end mt-3 gap-2">
            <Button variant="outline" size="sm" onClick={clearAll} className="border-red-500/30 text-red-400 hover:bg-red-500/20">
              <Trash2 className="w-4 h-4 mr-1" /> Clear All
            </Button>
            <Button variant="outline" size="sm" onClick={stopAllBots} className="border-red-500/30 text-red-400 hover:bg-red-500/20">
              <StopCircle className="w-4 h-4 mr-1" /> Stop All Bots
            </Button>
          </div>
        </motion.div>

        {/* Signals Grid */}
        <motion.div 
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="space-y-3"
        >
          <h2 className="text-lg font-semibold text-green-400 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-yellow-400" />
            Trading Signals
            {signals.length > 0 && (
              <Badge className="bg-green-500/20 text-green-400">{signals.length} active</Badge>
            )}
          </h2>
          
          {signals.length === 0 ? (
            <div className="bg-gray-800/50 backdrop-blur border border-green-500/20 rounded-xl p-8 text-center">
              <AlertTriangle className="w-12 h-12 text-yellow-400/50 mx-auto mb-3" />
              <p className="text-gray-400">NO SIGNAL FOUND</p>
              <p className="text-sm text-gray-500 mt-2">Click the SCAN button to analyze all markets</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {signals.map(signal => (
                <SignalCard key={signal.id} signal={signal} onAssign={assignSignalToBot} />
              ))}
            </div>
          )}
        </motion.div>

        {/* Bots Grid */}
        <motion.div 
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="space-y-3"
        >
          <h2 className="text-lg font-semibold text-green-400">🤖 Trading Bots</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {bots.map((bot, index) => (
              <motion.div
                key={bot.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.1 }}
                className={`bg-gray-800/50 backdrop-blur border rounded-xl p-4 shadow-xl ${
                  bot.isRunning ? 'border-green-400 ring-2 ring-green-400/20' : 'border-green-500/20'
                } ${bot.signal ? 'ring-2 ring-yellow-500/50' : ''}`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className={`p-2 rounded-lg ${
                      bot.type.includes('over') ? 'bg-blue-500/20 text-blue-400' :
                      bot.type.includes('under') ? 'bg-orange-500/20 text-orange-400' :
                      bot.type === 'even' ? 'bg-green-500/20 text-green-400' :
                      'bg-purple-500/20 text-purple-400'
                    }`}>
                      {bot.type.includes('over') ? <TrendingUp className="w-4 h-4" /> :
                       bot.type.includes('under') ? <TrendingDown className="w-4 h-4" /> :
                       <CircleDot className="w-4 h-4" />}
                    </div>
                    <div>
                      <h3 className="font-bold text-sm">{bot.name}</h3>
                      <p className="text-xs text-gray-400">
                        {bot.selectedMarket ? getMarketDisplay(bot.selectedMarket) : 'No market'}
                      </p>
                    </div>
                  </div>
                  <Badge className={bot.isRunning ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'}>
                    {bot.isRunning ? (bot.isPaused ? '⏸️ PAUSED' : '▶️ RUNNING') : '⏹️ STOPPED'}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-2 text-sm mb-3">
                  <div>
                    <span className="text-gray-400">P&L:</span>
                    <span className={`ml-1 font-mono ${
                      bot.totalPnl > 0 ? 'text-green-400' : bot.totalPnl < 0 ? 'text-red-400' : 'text-gray-400'
                    }`}>
                      ${bot.totalPnl.toFixed(2)}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-400">W/L:</span>
                    <span className="ml-1 font-mono">
                      <span className="text-green-400">{bot.wins}</span>
                      <span className="text-gray-400">/</span>
                      <span className="text-red-400">{bot.losses}</span>
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-400">Stake:</span>
                    <span className="ml-1 font-mono text-green-400">${bot.currentStake.toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="text-gray-400">Status:</span>
                    <span className={`ml-1 ${
                      bot.status === 'trading' ? 'text-green-400' :
                      bot.status === 'waiting' ? 'text-yellow-400' :
                      bot.status === 'cooldown' ? 'text-purple-400' :
                      'text-gray-400'
                    }`}>
                      {bot.status.toUpperCase()}
                    </span>
                  </div>
                </div>

                {bot.signal && (
                  <div className="mb-3 p-2 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                    <p className="text-xs text-yellow-400 text-center animate-pulse">
                      ⚡ ENTRY SIGNAL DETECTED ⚡
                    </p>
                  </div>
                )}

                <div className="flex gap-2">
                  {!bot.isRunning ? (
                    <Button
                      onClick={() => startBot(bot.id)}
                      disabled={!isAuthorized || !bot.selectedMarket}
                      className="flex-1 bg-green-500/20 hover:bg-green-500/30 text-green-400 border border-green-500/30"
                      size="sm"
                    >
                      <Play className="w-3 h-3 mr-1" /> Start
                    </Button>
                  ) : (
                    <>
                      <Button
                        onClick={() => pauseBot(bot.id)}
                        variant="outline"
                        className="flex-1 border-green-500/30 text-green-400 hover:bg-green-500/20"
                        size="sm"
                      >
                        <Pause className="w-3 h-3 mr-1" /> {bot.isPaused ? 'Resume' : 'Pause'}
                      </Button>
                      <Button
                        onClick={() => stopBot(bot.id)}
                        variant="destructive"
                        className="flex-1 bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30"
                        size="sm"
                      >
                        <StopCircle className="w-3 h-3 mr-1" /> Stop
                      </Button>
                    </>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Trade Log */}
        <motion.div 
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="bg-gray-800/50 backdrop-blur border border-green-500/20 rounded-xl p-4"
        >
          <h2 className="text-lg font-semibold mb-3 text-green-400">📋 Live Trade Log</h2>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {trades.length === 0 ? (
              <p className="text-center text-gray-400 py-8">No trades yet</p>
            ) : (
              trades.map((trade, idx) => (
                <motion.div 
                  key={idx} 
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.02 }}
                  className="flex items-center justify-between text-sm py-2 px-3 bg-gray-900/50 rounded-lg border border-green-500/10"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-gray-400">{trade.time}</span>
                    <Badge variant="outline" className="border-green-500/30 text-green-400">
                      {trade.bot}
                    </Badge>
                    <span className="text-gray-300">{getMarketDisplay(trade.market)}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="font-mono text-green-400">${trade.stake.toFixed(2)}</span>
                    <span className={`font-mono w-20 text-right ${
                      trade.result === 'Win' ? 'text-green-400' : 
                      trade.result === 'Loss' ? 'text-red-400' : 'text-yellow-400'
                    }`}>
                      {trade.result === 'Win' ? `+$${trade.pnl.toFixed(2)}` : 
                       trade.result === 'Loss' ? `-$${Math.abs(trade.pnl).toFixed(2)}` : 
                       'Pending...'}
                    </span>
                  </div>
                </motion.div>
              ))
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
  }
