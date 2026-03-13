import { useState, useRef, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Loader2, Play, StopCircle, Pause, TrendingUp, TrendingDown, CircleDot, RefreshCw, Trash2, Volume2, DollarSign, Sparkles } from 'lucide-react';

// Mock derivApi for demonstration - replace with actual Deriv API
const derivApi = {
  onMessage: (callback: any) => {
    return () => {};
  },
  subscribeTicks: (symbol: string) => {
    console.log('Subscribing to', symbol);
  },
  buyContract: async (params: any) => {
    return { contractId: 'mock123' };
  },
  waitForContractResult: async (contractId: string) => {
    await new Promise(r => setTimeout(r, 2000));
    return {
      status: Math.random() > 0.5 ? 'won' : 'lost',
      profit: Math.random() > 0.5 ? 0.95 : -1
    };
  }
};

// Mock auth context
const useAuth = () => {
  return {
    isAuthorized: true,
    activeAccount: { id: 'test' },
    balance: 1000
  };
};

interface DigitAnalysis {
  most: number;
  second: number;
  third: number;
  least: number;
  counts: Record<number, number>;
}

interface MarketSignal {
  market: string;
  botId: number;
  botName: string;
  status: 'waiting' | 'triggered';
  analysis: DigitAnalysis;
}

interface BotState {
  id: string;
  name: string;
  type: 'over3' | 'under6' | 'even' | 'odd' | 'over1' | 'under8';
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
  lastDigit?: number;
  autoTradeEnabled: boolean;
}

interface TradeLog {
  id: number;
  time: string;
  market: string;
  contract: string;
  stake: number;
  result: 'Pending' | 'Win' | 'Loss';
  pnl: number;
  bot: string;
  entryDigit: number;
  exitDigit?: number;
  signalType?: string;
}

// Markets without BOOM/CRASH
const ALL_MARKETS = [
  'R_10', 'R_25', 'R_50', 'R_75', 'R_100',
  '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V',
  'RDBEAR', 'RDBULL',
  'JD10', 'JD25', 'JD50', 'JD75', 'JD100'
];

// Bot strategies
const BOT_STRATEGIES = [
  {
    id: 1,
    name: 'OVER 1',
    type: 'over1',
    contractType: 'DIGITOVER',
    barrier: 1,
    condition: (analysis: DigitAnalysis) => {
      return analysis.most > 4 && analysis.second > 4 && analysis.least > 4;
    },
    entryCondition: (digits: number[]) => {
      if (digits.length < 2) return false;
      const lastTwo = digits.slice(-2);
      return lastTwo.every(d => d <= 1);
    }
  },
  {
    id: 2,
    name: 'UNDER 8',
    type: 'under8',
    contractType: 'DIGITUNDER',
    barrier: 8,
    condition: (analysis: DigitAnalysis) => {
      return analysis.most < 6 && analysis.second < 6 && analysis.least < 6;
    },
    entryCondition: (digits: number[]) => {
      if (digits.length < 2) return false;
      const lastTwo = digits.slice(-2);
      return lastTwo.every(d => d >= 8);
    }
  },
  {
    id: 3,
    name: 'EVEN',
    type: 'even',
    contractType: 'DIGITEVEN',
    condition: (analysis: DigitAnalysis) => {
      return analysis.most % 2 === 0 && 
             analysis.second % 2 === 0 && 
             analysis.least % 2 === 0;
    },
    entryCondition: (digits: number[]) => {
      if (digits.length < 3) return false;
      const lastThree = digits.slice(-3);
      return lastThree.every(d => d % 2 === 1);
    }
  },
  {
    id: 4,
    name: 'ODD',
    type: 'odd',
    contractType: 'DIGITODD',
    condition: (analysis: DigitAnalysis) => {
      return analysis.most % 2 === 1 && 
             analysis.second % 2 === 1 && 
             analysis.third % 2 === 1;
    },
    entryCondition: (digits: number[]) => {
      if (digits.length < 3) return false;
      const lastThree = digits.slice(-3);
      return lastThree.every(d => d % 2 === 0);
    }
  },
  {
    id: 5,
    name: 'OVER 3',
    type: 'over3',
    contractType: 'DIGITOVER',
    barrier: 3,
    condition: (analysis: DigitAnalysis) => {
      return analysis.most > 4 && analysis.second > 4 && analysis.least > 4;
    },
    entryCondition: (digits: number[]) => {
      if (digits.length < 3) return false;
      const lastThree = digits.slice(-3);
      return lastThree.every(d => d <= 2);
    }
  },
  {
    id: 6,
    name: 'UNDER 6',
    type: 'under6',
    contractType: 'DIGITUNDER',
    barrier: 6,
    condition: (analysis: DigitAnalysis) => {
      return analysis.most < 5 && analysis.second < 5 && analysis.least < 5;
    },
    entryCondition: (digits: number[]) => {
      if (digits.length < 3) return false;
      const lastThree = digits.slice(-3);
      return lastThree.every(d => d >= 7);
    }
  }
];

// Scanning sound
const playScanSound = (type: 'start' | 'progress' | 'complete' | 'signal') => {
  try {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.type = 'sine';
    
    switch(type) {
      case 'start':
        oscillator.frequency.setValueAtTime(660, audioContext.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(440, audioContext.currentTime + 0.3);
        gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
        break;
      case 'progress':
        oscillator.frequency.setValueAtTime(880, audioContext.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(440, audioContext.currentTime + 0.1);
        gainNode.gain.setValueAtTime(0.05, audioContext.currentTime);
        break;
      case 'complete':
        oscillator.frequency.setValueAtTime(440, audioContext.currentTime);
        oscillator.frequency.setValueAtTime(554.37, audioContext.currentTime + 0.1);
        oscillator.frequency.setValueAtTime(659.25, audioContext.currentTime + 0.2);
        gainNode.gain.setValueAtTime(0.15, audioContext.currentTime);
        break;
      case 'signal':
        oscillator.frequency.setValueAtTime(988, audioContext.currentTime);
        oscillator.frequency.setValueAtTime(1318.51, audioContext.currentTime + 0.15);
        gainNode.gain.setValueAtTime(0.2, audioContext.currentTime);
        break;
    }
    
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.3);
  } catch (e) {
    console.log('Audio not supported');
  }
};

// Voice system
const speak = (text: string, isScary = true) => {
  try {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.pitch = isScary ? 0.3 : 0.8;
    utterance.rate = 0.7;
    utterance.volume = 1;
    
    const voices = window.speechSynthesis.getVoices();
    const deepVoice = voices.find(v => 
      v.name.includes('Google UK English Male') || 
      v.name.includes('Daniel')
    );
    if (deepVoice) utterance.voice = deepVoice;
    
    window.speechSynthesis.speak(utterance);
  } catch (e) {
    console.log('Speech not supported');
  }
};

// Digit analysis
const analyzeDigits = (digits: number[]): DigitAnalysis => {
  const counts: Record<number, number> = {};
  for (let i = 0; i <= 9; i++) counts[i] = 0;
  
  digits.forEach(d => counts[d]++);
  
  const sorted = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(entry => parseInt(entry[0]));
  
  return {
    most: sorted[0],
    second: sorted[1],
    third: sorted[2],
    least: sorted[9],
    counts
  };
};

// Market display
const getMarketDisplay = (market: string) => {
  if (market.startsWith('R_')) return `R${market.slice(2)}`;
  if (market.startsWith('1HZ')) return `HZ${market.slice(3)}`;
  if (market === 'RDBEAR') return 'BEAR';
  if (market === 'RDBULL') return 'BULL';
  if (market.startsWith('JD')) return `JD${market.slice(2)}`;
  return market;
};

// Mock tick loader
const useTickLoader = (market: string, count: number) => {
  const [digits, setDigits] = useState<number[]>([]);
  useEffect(() => {
    const mockDigits = Array.from({ length: 1000 }, () => Math.floor(Math.random() * 10));
    setDigits(mockDigits);
  }, [market]);
  return { digits, prices: [], isLoading: false, tickCount: digits.length };
};

export default function AutoTrade() {
  const { isAuthorized, balance } = useAuth();
  const [activeTradeId, setActiveTradeId] = useState<string | null>(null);
  const [marketSignals, setMarketSignals] = useState<MarketSignal[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [globalStake, setGlobalStake] = useState<number>(0.5);
  const [globalMultiplier, setGlobalMultiplier] = useState<number>(2);
  const [globalStopLoss, setGlobalStopLoss] = useState<number>(30);
  const [globalTakeProfit, setGlobalTakeProfit] = useState<number>(5);
  const [noSignal, setNoSignal] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [autoTradeEnabled, setAutoTradeEnabled] = useState(false);
  
  const [trades, setTrades] = useState<TradeLog[]>([]);
  const tradeIdRef = useRef(0);
  const marketDigitsRef = useRef<Record<string, number[]>>({});
  const voiceIntervalRef = useRef<NodeJS.Timeout>();

  const { digits } = useTickLoader('R_100', 1000);

  // Initialize voices
  useEffect(() => {
    if (window.speechSynthesis) window.speechSynthesis.getVoices();
  }, []);

  // Six bots
  const [bots, setBots] = useState<BotState[]>([
    { id: 'bot1', name: 'OV3', type: 'over3', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, contractType: 'DIGITOVER', barrier: 3,
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, cooldownRemaining: 0, recoveryMode: false, signal: false, lastDigit: undefined, autoTradeEnabled: false },
    { id: 'bot2', name: 'UN6', type: 'under6', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, contractType: 'DIGITUNDER', barrier: 6,
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, cooldownRemaining: 0, recoveryMode: false, signal: false, lastDigit: undefined, autoTradeEnabled: false },
    { id: 'bot3', name: 'EVN', type: 'even', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, contractType: 'DIGITEVEN',
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, cooldownRemaining: 0, recoveryMode: false, signal: false, lastDigit: undefined, autoTradeEnabled: false },
    { id: 'bot4', name: 'ODD', type: 'odd', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, contractType: 'DIGITODD',
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, cooldownRemaining: 0, recoveryMode: false, signal: false, lastDigit: undefined, autoTradeEnabled: false },
    { id: 'bot5', name: 'OV1', type: 'over1', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, contractType: 'DIGITOVER', barrier: 1,
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, cooldownRemaining: 0, recoveryMode: false, signal: false, lastDigit: undefined, autoTradeEnabled: false },
    { id: 'bot6', name: 'UN8', type: 'under8', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, contractType: 'DIGITUNDER', barrier: 8,
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, cooldownRemaining: 0, recoveryMode: false, signal: false, lastDigit: undefined, autoTradeEnabled: false }
  ]);

  const botRunningRefs = useRef<Record<string, boolean>>({});
  const botPausedRefs = useRef<Record<string, boolean>>({});

  // Monitor entry conditions - with auto-trade support
  useEffect(() => {
    const checkSignals = () => {
      marketSignals.forEach(signal => {
        if (signal.status === 'waiting') {
          const bot = BOT_STRATEGIES.find(b => b.id === signal.botId)!;
          const marketDigits = marketDigitsRef.current[signal.market] || [];
          const lastDigit = marketDigits.length > 0 ? marketDigits[marketDigits.length - 1] : undefined;
          
          // Update last digit for display
          if (lastDigit !== undefined) {
            setBots(prev => prev.map(b => 
              b.type === bot.type ? { ...b, lastDigit } : b
            ));
          }
          
          if (bot.entryCondition(marketDigits)) {
            setMarketSignals(prev => prev.map(s => 
              s.market === signal.market && s.botId === signal.botId
                ? { ...s, status: 'triggered' }
                : s
            ));
            
            if (soundEnabled) playScanSound('signal');
            speak(`Entry signal for ${bot.name} on ${signal.market}`, true);
            toast.info(`${bot.name} entry condition met on ${signal.market}`);
            
            // Mark bot as having signal
            setBots(prev => prev.map(b => 
              b.type === bot.type ? { ...b, signal: true, selectedMarket: signal.market } : b
            ));
            
            // Auto-trade if enabled
            const botState = bots.find(b => b.type === bot.type);
            if (autoTradeEnabled && botState && !botState.isRunning) {
              setTimeout(() => startBot(botState.id), 500);
            }
          }
        }
      });
    };

    const interval = setInterval(checkSignals, 1000);
    return () => clearInterval(interval);
  }, [marketSignals, bots, soundEnabled, autoTradeEnabled]);

  // Fetch ticks
  const fetchMarketTicks = useCallback(async (market: string, count: number = 1000): Promise<number[]> => {
    await new Promise(r => setTimeout(r, 300));
    return Array.from({ length: count }, () => Math.floor(Math.random() * 10));
  }, []);

  // Scan all markets
  const scanMarket = useCallback(async () => {
    if (isScanning) return;
    
    setIsScanning(true);
    setNoSignal(false);
    setMarketSignals([]);
    setScanProgress(0);
    
    // Reset bot signals
    setBots(prev => prev.map(b => ({ ...b, signal: false, selectedMarket: undefined })));
    
    if (soundEnabled) playScanSound('start');
    speak("Scanning the markets for money", true);
    
    voiceIntervalRef.current = setInterval(() => {
      speak("Scanning the markets for money", true);
      if (soundEnabled) playScanSound('progress');
    }, 15000);
    
    const totalMarkets = ALL_MARKETS.length;
    let processed = 0;
    const usedBots = new Set<number>();
    const foundSignals: MarketSignal[] = [];
    
    try {
      for (const market of ALL_MARKETS) {
        processed++;
        setScanProgress(Math.round((processed / totalMarkets) * 100));
        
        const digits = await fetchMarketTicks(market, 1000);
        
        if (digits.length >= 700) {
          marketDigitsRef.current[market] = digits;
          const analysis = analyzeDigits(digits);
          
          for (const bot of BOT_STRATEGIES) {
            if (!usedBots.has(bot.id) && bot.condition(analysis)) {
              usedBots.add(bot.id);
              foundSignals.push({
                market,
                botId: bot.id,
                botName: bot.name,
                status: 'waiting',
                analysis
              });
              
              if (soundEnabled) playScanSound('signal');
              speak(`Signal for ${bot.name} on ${market}`, true);
              
              break;
            }
          }
        }
        
        await new Promise(r => setTimeout(r, 50));
      }
      
      if (foundSignals.length === 0) {
        setNoSignal(true);
        speak("No signals found", true);
      } else {
        setMarketSignals(foundSignals);
        toast.success(`Found ${foundSignals.length} market signals`);
      }
      
      if (soundEnabled) playScanSound('complete');
      
    } catch (error) {
      console.error('Scan error:', error);
      toast.error('Scan failed');
    } finally {
      setIsScanning(false);
      setScanProgress(100);
      if (voiceIntervalRef.current) clearInterval(voiceIntervalRef.current);
    }
  }, [isScanning, fetchMarketTicks, soundEnabled]);

  // Clear all
  const clearAll = () => {
    setTrades([]);
    setMarketSignals([]);
    setNoSignal(false);
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
      selectedMarket: undefined,
      lastDigit: undefined
    })));
    tradeIdRef.current = 0;
    toast.success('All cleared');
  };

  // Trading loop
  const runBot = useCallback(async (botId: string) => {
    const bot = bots.find(b => b.id === botId);
    if (!bot || !isAuthorized) return;

    if (balance < globalStake) {
      toast.error(`Insufficient balance`);
      stopBot(botId);
      return;
    }

    if (!bot.selectedMarket) {
      toast.error(`No market selected`);
      return;
    }

    setBots(prev => prev.map(b => b.id === botId ? { 
      ...b, 
      isRunning: true, 
      isPaused: false, 
      currentStake: globalStake,
      status: 'trading',
      signal: false
    } : b));
    
    botRunningRefs.current[botId] = true;
    botPausedRefs.current[botId] = false;

    let stake = globalStake;
    let totalPnl = bot.totalPnl;
    let tradeCount = bot.trades;
    let wins = bot.wins;
    let losses = bot.losses;
    let consecutiveLosses = 0;
    let cooldownRemaining = 0;

    const currentMarket = bot.selectedMarket;

    while (botRunningRefs.current[botId]) {
      if (botPausedRefs.current[botId]) {
        await new Promise(r => setTimeout(r, 500));
        continue;
      }

      if (totalPnl <= -globalStopLoss) {
        toast.error(`${bot.name}: Stop Loss`);
        break;
      }
      if (totalPnl >= globalTakeProfit) {
        toast.success(`${bot.name}: Take Profit`);
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

      try {
        await new Promise(r => setTimeout(r, 1000));

        if (activeTradeId) {
          await new Promise(r => setTimeout(r, 500));
          continue;
        }

        const marketDigits = marketDigitsRef.current[currentMarket] || [];
        const entryDigit = marketDigits.length > 0 ? marketDigits[marketDigits.length - 1] : 0;

        const id = ++tradeIdRef.current;
        const now = new Date().toLocaleTimeString();
        setActiveTradeId(`${botId}-${id}`);

        setTrades(prev => [{
          id,
          time: now,
          market: currentMarket,
          contract: bot.contractType,
          stake,
          result: 'Pending',
          pnl: 0,
          bot: bot.name,
          entryDigit,
          signalType: bot.type
        }, ...prev].slice(0, 50));

        await new Promise(r => setTimeout(r, 2000));
        
        // Simulate result with random exit digit
        const won = Math.random() > 0.5;
        const pnl = won ? stake * 0.95 : -stake;
        const exitDigit = Math.floor(Math.random() * 10);

        setTrades(prev => prev.map(t => t.id === id ? { 
          ...t, 
          result: won ? 'Win' : 'Loss', 
          pnl,
          exitDigit 
        } : t));

        totalPnl += pnl;
        tradeCount++;
        
        if (won) {
          wins++;
          consecutiveLosses = 0;
          stake = globalStake;
          cooldownRemaining = 0;
        } else {
          losses++;
          consecutiveLosses++;
          stake = Math.round(stake * globalMultiplier * 100) / 100;
          
          if (bot.type === 'even' || bot.type === 'odd') {
            cooldownRemaining = 3;
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
              status: cooldownRemaining > 0 ? 'cooldown' : 'trading',
              cooldownRemaining,
              lastTradeResult: won ? 'win' : 'loss',
            };
          }
          return b;
        }));

        setActiveTradeId(null);
        await new Promise(r => setTimeout(r, 500));

      } catch (err) {
        setActiveTradeId(null);
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    setBots(prev => prev.map(b => b.id === botId ? { 
      ...b, 
      isRunning: false, 
      isPaused: false,
      status: 'idle',
      cooldownRemaining: 0,
    } : b));
    
    botRunningRefs.current[botId] = false;
  }, [isAuthorized, balance, globalStake, globalMultiplier, globalStopLoss, globalTakeProfit, activeTradeId, bots]);

  // Bot controls
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
    } : b));
  };

  const stopAllBots = () => {
    bots.forEach(bot => botRunningRefs.current[bot.id] = false);
    setBots(prev => prev.map(b => ({ ...b, isRunning: false, isPaused: false, status: 'idle' })));
  };

  // Calculate totals
  const totalProfit = bots.reduce((sum, bot) => sum + bot.totalPnl, 0);
  const totalTrades = bots.reduce((sum, bot) => sum + bot.trades, 0);
  const totalWins = bots.reduce((sum, bot) => sum + bot.wins, 0);
  const winRate = totalTrades > 0 ? ((totalWins / totalTrades) * 100).toFixed(1) : '0';
  const activeSignals = bots.filter(b => b.signal).length;

  return (
    <div className="space-y-3 p-3 bg-gradient-to-br from-gray-900 via-gray-800 to-black min-h-screen relative overflow-hidden">
      {/* Animated Dollar Background with Multiple Colors */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        {[...Array(40)].map((_, i) => {
          const colors = [
            'text-green-500/10',
            'text-yellow-500/10',
            'text-blue-500/10',
            'text-purple-500/10',
            'text-pink-500/10',
            'text-orange-500/10',
            'text-cyan-500/10',
            'text-emerald-500/10'
          ];
          const color = colors[Math.floor(Math.random() * colors.length)];
          const size = 20 + Math.random() * 40;
          
          return (
            <motion.div
              key={i}
              className={`absolute ${color} font-bold`}
              style={{ fontSize: size }}
              initial={{
                x: Math.random() * (typeof window !== 'undefined' ? window.innerWidth : 1000),
                y: (typeof window !== 'undefined' ? window.innerHeight : 1000) + 100,
                rotate: Math.random() * 360,
                opacity: 0.1 + Math.random() * 0.2
              }}
              animate={{
                y: -200,
                rotate: Math.random() * 720,
                x: Math.random() * (typeof window !== 'undefined' ? window.innerWidth : 1000)
              }}
              transition={{
                duration: 15 + Math.random() * 25,
                repeat: Infinity,
                delay: Math.random() * 10,
                ease: "linear"
              }}
            >
              {Math.random() > 0.3 ? '$' : '💰'}
            </motion.div>
          );
        })}
        {/* Additional sparkling effect */}
        {[...Array(15)].map((_, i) => (
          <motion.div
            key={`sparkle-${i}`}
            className="absolute text-yellow-300/20"
            initial={{
              x: Math.random() * (typeof window !== 'undefined' ? window.innerWidth : 1000),
              y: Math.random() * (typeof window !== 'undefined' ? window.innerHeight : 1000),
              scale: 0
            }}
            animate={{
              scale: [0, 1, 0],
              opacity: [0, 0.5, 0]
            }}
            transition={{
              duration: 3 + Math.random() * 4,
              repeat: Infinity,
              delay: Math.random() * 5
            }}
          >
            ✦
          </motion.div>
        ))}
      </div>

      {/* Main Content */}
      <div className="relative z-10 backdrop-blur-[1px]">
        {/* Sound Toggle & Auto Trade */}
        <div className="absolute top-3 right-3 z-20 flex gap-2">
          <div className="flex items-center gap-1 bg-card/80 backdrop-blur rounded-lg px-2 py-1">
            <Sparkles className="w-3 h-3 text-yellow-400" />
            <Label htmlFor="auto-trade" className="text-[8px]">AUTO</Label>
            <Switch
              id="auto-trade"
              checked={autoTradeEnabled}
              onCheckedChange={setAutoTradeEnabled}
              className="scale-75"
            />
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setSoundEnabled(!soundEnabled)}
            className="w-7 h-7 bg-card/80 backdrop-blur"
          >
            <Volume2 className={`w-3 h-3 ${soundEnabled ? 'text-green-400' : 'text-gray-400'}`} />
          </Button>
        </div>

        {/* Header */}
        <div className="bg-card/80 backdrop-blur border rounded-lg p-2">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-bold bg-gradient-to-r from-yellow-400 to-green-400 text-transparent bg-clip-text">
              🤖 6-BOT SYSTEM
            </h1>
            <div className="flex items-center gap-1">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={scanMarket}
                disabled={isScanning}
                className="h-7 text-xs bg-background/50"
              >
                {isScanning ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}
                {isScanning ? `${scanProgress}%` : 'SCAN'}
              </Button>
              <Button variant="destructive" size="sm" onClick={clearAll} className="h-7 text-xs">
                <Trash2 className="w-3 h-3" />
              </Button>
              <Button variant="destructive" size="sm" onClick={stopAllBots} className="h-7 text-xs">
                <StopCircle className="w-3 h-3" />
              </Button>
            </div>
          </div>

          {/* Stats with better styling */}
          <div className="grid grid-cols-4 gap-1 mt-1 text-[10px]">
            <div className="bg-gradient-to-br from-blue-500/10 to-purple-500/10 rounded p-1 border border-blue-500/20">
              <div className="text-muted-foreground">Balance</div>
              <div className="font-bold text-blue-400">${balance?.toFixed(2)}</div>
            </div>
            <div className="bg-gradient-to-br from-green-500/10 to-emerald-500/10 rounded p-1 border border-green-500/20">
              <div className="text-muted-foreground">P&L</div>
              <div className={totalProfit >= 0 ? 'text-profit' : 'text-loss'}>
                ${totalProfit.toFixed(2)}
              </div>
            </div>
            <div className="bg-gradient-to-br from-yellow-500/10 to-orange-500/10 rounded p-1 border border-yellow-500/20">
              <div className="text-muted-foreground">Win%</div>
              <div className="text-yellow-400">{winRate}%</div>
            </div>
            <div className="bg-gradient-to-br from-purple-500/10 to-pink-500/10 rounded p-1 border border-purple-500/20">
              <div className="text-muted-foreground">Signal</div>
              <div className="text-purple-400">{activeSignals}/6</div>
            </div>
          </div>

          {/* Settings with better styling */}
          <div className="grid grid-cols-4 gap-1 mt-1">
            <div className="relative">
              <span className="absolute -top-1 left-1 text-[6px] text-muted-foreground">Stake</span>
              <input 
                type="number" 
                value={globalStake} 
                onChange={(e) => setGlobalStake(parseFloat(e.target.value) || 0.5)}
                className="w-full bg-background/50 border border-green-500/30 rounded px-1 pt-2 pb-0.5 text-[10px] text-green-400 text-center"
                step="0.1"
                min="0.1"
              />
            </div>
            <div className="relative">
              <span className="absolute -top-1 left-1 text-[6px] text-muted-foreground">Mult</span>
              <input 
                type="number" 
                value={globalMultiplier} 
                onChange={(e) => setGlobalMultiplier(parseFloat(e.target.value) || 2)}
                className="w-full bg-background/50 border border-blue-500/30 rounded px-1 pt-2 pb-0.5 text-[10px] text-blue-400 text-center"
                step="0.1"
                min="1.1"
              />
            </div>
            <div className="relative">
              <span className="absolute -top-1 left-1 text-[6px] text-muted-foreground">SL</span>
              <input 
                type="number" 
                value={globalStopLoss} 
                onChange={(e) => setGlobalStopLoss(parseFloat(e.target.value) || 30)}
                className="w-full bg-background/50 border border-red-500/30 rounded px-1 pt-2 pb-0.5 text-[10px] text-red-400 text-center"
              />
            </div>
            <div className="relative">
              <span className="absolute -top-1 left-1 text-[6px] text-muted-foreground">TP</span>
              <input 
                type="number" 
                value={globalTakeProfit} 
                onChange={(e) => setGlobalTakeProfit(parseFloat(e.target.value) || 5)}
                className="w-full bg-background/50 border border-green-500/30 rounded px-1 pt-2 pb-0.5 text-[10px] text-green-400 text-center"
              />
            </div>
          </div>
        </div>

        {/* No Signal */}
        <AnimatePresence>
          {noSignal && !isScanning && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }} 
              animate={{ opacity: 1, y: 0 }} 
              exit={{ opacity: 0, y: -10 }} 
              className="text-center py-2"
            >
              <div className="text-red-400 text-xs font-bold bg-red-500/10 rounded-lg p-2 border border-red-500/30">
                NO SIGNAL FOUND
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Signals with better styling */}
        {marketSignals.length > 0 && (
          <div className="space-y-1">
            <div className="text-xs font-bold flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse"></span>
              Ready Signals ({marketSignals.filter(s => s.status === 'triggered').length}/{marketSignals.length})
            </div>
            <div className="grid grid-cols-2 gap-1">
              {marketSignals.map((signal) => {
                const bot = BOT_STRATEGIES.find(b => b.id === signal.botId)!;
                const botState = bots.find(b => b.type === bot.type);
                return (
                  <motion.div 
                    key={`${signal.market}_${signal.botId}`} 
                    className={`backdrop-blur border rounded p-1.5 text-[9px] ${
                      signal.status === 'triggered' 
                        ? 'bg-gradient-to-r from-green-500/20 to-emerald-500/20 border-green-500' 
                        : 'bg-gradient-to-r from-yellow-500/10 to-orange-500/10 border-yellow-500'
                    }`}
                    whileHover={{ scale: 1.02 }}
                  >
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-blue-400">{getMarketDisplay(signal.market)}</span>
                      <span className={`px-1.5 rounded-full text-[7px] font-bold ${
                        signal.status === 'triggered' 
                          ? 'bg-green-500 text-white' 
                          : 'bg-yellow-500 text-black'
                      }`}>
                        {signal.status === 'triggered' ? 'READY' : 'WAIT'}
                      </span>
                    </div>
                    <div className="flex justify-between mt-0.5">
                      <span>Bot: {signal.botName}</span>
                      <span>Last: <span className="font-mono font-bold">{botState?.lastDigit !== undefined ? botState.lastDigit : '—'}</span></span>
                    </div>
                    {signal.status === 'triggered' && (
                      <div className="mt-1 text-[6px] text-green-400 flex items-center gap-1">
                        <span className="w-1 h-1 bg-green-400 rounded-full animate-pulse"></span>
                        Ready to trade - Click bot to start
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </div>
          </div>
        )}

        {/* Bots Grid with improved styling */}
        <div className="grid grid-cols-3 gap-1 mt-2">
          {bots.map((bot) => {
            const botStrategy = BOT_STRATEGIES.find(s => s.type === bot.type);
            const signal = marketSignals.find(s => s.botId === botStrategy?.id);
            
            return (
              <motion.div
                key={bot.id}
                className={`backdrop-blur border rounded p-1.5 text-[8px] ${
                  bot.isRunning 
                    ? 'bg-gradient-to-br from-primary/20 to-primary/5 border-primary' 
                    : bot.signal 
                      ? 'bg-gradient-to-br from-green-500/20 to-emerald-500/20 border-green-500 ring-1 ring-green-500/50' 
                      : 'bg-card/50 border-border'
                }`}
                whileHover={{ scale: 1.02 }}
                animate={bot.signal ? {
                  boxShadow: ['0 0 0px rgba(34,197,94,0)', '0 0 8px rgba(34,197,94,0.5)', '0 0 0px rgba(34,197,94,0)']
                } : {}}
                transition={{ duration: 1.5, repeat: bot.signal ? Infinity : 0 }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <div className={`p-0.5 rounded ${
                      bot.type.includes('over') ? 'bg-blue-500/30' :
                      bot.type.includes('under') ? 'bg-orange-500/30' :
                      bot.type === 'even' ? 'bg-green-500/30' : 'bg-purple-500/30'
                    }`}>
                      {bot.type.includes('over') ? <TrendingUp className="w-2 h-2" /> :
                       bot.type.includes('under') ? <TrendingDown className="w-2 h-2" /> :
                       <CircleDot className="w-2 h-2" />}
                    </div>
                    <span className="font-bold">{bot.name}</span>
                    {bot.signal && (
                      <motion.span 
                        className="text-[6px] bg-green-500 text-white px-1 rounded-full"
                        animate={{ scale: [1, 1.2, 1] }}
                        transition={{ duration: 1, repeat: Infinity }}
                      >
                        !
                      </motion.span>
                    )}
                  </div>
                  <Badge variant={bot.isRunning ? "default" : "secondary"} className="text-[5px] px-1 py-0 h-3">
                    {bot.isRunning ? (bot.isPaused ? '⏸️' : '▶️') : '⏹️'}
                  </Badge>
                </div>

                <div className="mt-1 space-y-0.5">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Market:</span>
                    <span className="text-blue-400 font-mono">{bot.selectedMarket ? getMarketDisplay(bot.selectedMarket) : '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">P&L:</span>
                    <span className={bot.totalPnl > 0 ? 'text-profit' : bot.totalPnl < 0 ? 'text-loss' : ''}>
                      ${bot.totalPnl.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Last:</span>
                    <span className="font-mono font-bold">{bot.lastDigit !== undefined ? bot.lastDigit : '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Stake:</span>
                    <span className="text-yellow-400">${bot.currentStake.toFixed(2)}</span>
                  </div>
                </div>

                <div className="flex gap-1 mt-1.5">
                  {!bot.isRunning ? (
                    <Button 
                      onClick={() => startBot(bot.id)} 
                      disabled={!bot.selectedMarket} 
                      size="sm" 
                      className={`flex-1 h-5 text-[6px] px-0 ${
                        bot.signal 
                          ? 'bg-gradient-to-r from-green-500 to-green-600 hover:from-green-400 hover:to-green-500 animate-pulse' 
                          : ''
                      }`}
                    >
                      <Play className="w-2 h-2 mr-0.5" /> {bot.signal ? 'TRADE NOW' : 'START'}
                    </Button>
                  ) : (
                    <>
                      <Button onClick={() => pauseBot(bot.id)} size="sm" variant="outline" className="flex-1 h-5 text-[6px] px-0">
                        <Pause className="w-2 h-2 mr-0.5" /> {bot.isPaused ? 'RES' : 'PAU'}
                      </Button>
                      <Button onClick={() => stopBot(bot.id)} size="sm" variant="destructive" className="flex-1 h-5 text-[6px] px-0">
                        <StopCircle className="w-2 h-2 mr-0.5" /> STOP
                      </Button>
                    </>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Enhanced Trade Log with Stake and Digits */}
        <div className="bg-card/80 backdrop-blur border rounded-lg p-2 mt-2">
          <div className="text-xs font-bold mb-1 flex items-center gap-2">
            <span>📊 Trade History</span>
            <span className="text-[8px] text-muted-foreground">(Stake | Entry → Exit)</span>
          </div>
          <div className="space-y-1 max-h-36 overflow-y-auto">
            {trades.length === 0 ? (
              <p className="text-[8px] text-center py-2 text-muted-foreground">No trades yet</p>
            ) : (
              trades.map((trade, idx) => (
                <motion.div 
                  key={idx} 
                  className="grid grid-cols-12 gap-1 text-[8px] py-1 px-1.5 border-b border-border/50 last:border-0 hover:bg-muted/30 rounded"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <span className="col-span-2 text-muted-foreground">{trade.time.slice(-5)}</span>
                  <span className="col-span-2 font-bold text-blue-400">{getMarketDisplay(trade.market)}</span>
                  <span className="col-span-2 text-center font-mono">
                    <span className={trade.result === 'Win' ? 'text-profit' : trade.result === 'Loss' ? 'text-loss' : ''}>
                      ${trade.stake.toFixed(2)}
                    </span>
                  </span>
                  <span className="col-span-2 text-center font-mono">
                    <span className="text-yellow-400">{trade.entryDigit}</span>
                    {trade.exitDigit && (
                      <>
                        <span className="text-muted-foreground mx-0.5">→</span>
                        <span className={trade.result === 'Win' ? 'text-profit' : 'text-loss'}>
                          {trade.exitDigit}
                        </span>
                      </>
                    )}
                  </span>
                  <span className="col-span-2 text-center text-[6px] uppercase">
                    {trade.contract}
                  </span>
                  <span className={`col-span-2 text-right font-mono ${
                    trade.result === 'Win' ? 'text-profit' : trade.result === 'Loss' ? 'text-loss' : ''
                  }`}>
                    {trade.result === 'Win' ? `+$${trade.pnl.toFixed(2)}` : 
                     trade.result === 'Loss' ? `-$${Math.abs(trade.pnl).toFixed(2)}` : 
                     '⏳'}
                  </span>
                </motion.div>
              ))
            )}
          </div>
        </div>

        {/* Quick Stats Footer */}
        <div className="grid grid-cols-3 gap-1 mt-1 text-[6px] text-muted-foreground">
          <div className="bg-card/50 backdrop-blur rounded p-1 text-center">
            Total Trades: {totalTrades}
          </div>
          <div className="bg-card/50 backdrop-blur rounded p-1 text-center">
            Wins: {totalWins} | Losses: {totalTrades - totalWins}
          </div>
          <div className="bg-card/50 backdrop-blur rounded p-1 text-center">
            Auto: {autoTradeEnabled ? 'ON' : 'OFF'}
          </div>
        </div>
      </div>
    </div>
  );
}
