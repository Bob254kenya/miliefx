import { useState, useRef, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Play, StopCircle, Pause, TrendingUp, TrendingDown, CircleDot, RefreshCw, Trash2, Volume2 } from 'lucide-react';

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
  status: 'waiting' | 'triggered' | 'trading';
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
  lastDigit?: number;
  signalType?: string;
}

// Removed BOOM and CRASH markets
const ALL_MARKETS = [
  // Volatility Indices
  'R_10', 'R_25', 'R_50', 'R_75', 'R_100',
  // 1HZ Volatility
  '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V',
  // Bear/Bull
  'RDBEAR', 'RDBULL',
  // Jump Digital
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
      // Wait for 3 odd digits, then trade EVEN
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
      // Wait for 3 even digits, then trade ODD
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

// Scanning sound using Web Audio API
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

// Market display - shortened
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
  
  const [trades, setTrades] = useState<TradeLog[]>([]);
  const tradeIdRef = useRef(0);
  const marketDigitsRef = useRef<Record<string, number[]>>({});
  const voiceIntervalRef = useRef<NodeJS.Timeout>();

  const { digits } = useTickLoader('R_100', 1000);

  // Initialize voices
  useEffect(() => {
    if (window.speechSynthesis) window.speechSynthesis.getVoices();
  }, []);

  // Six bots - compact version
  const [bots, setBots] = useState<BotState[]>([
    { id: 'bot1', name: 'OV3', type: 'over3', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, contractType: 'DIGITOVER', barrier: 3,
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, cooldownRemaining: 0, recoveryMode: false, signal: false },
    { id: 'bot2', name: 'UN6', type: 'under6', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, contractType: 'DIGITUNDER', barrier: 6,
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, cooldownRemaining: 0, recoveryMode: false, signal: false },
    { id: 'bot3', name: 'EVN', type: 'even', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, contractType: 'DIGITEVEN',
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, cooldownRemaining: 0, recoveryMode: false, signal: false },
    { id: 'bot4', name: 'ODD', type: 'odd', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, contractType: 'DIGITODD',
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, cooldownRemaining: 0, recoveryMode: false, signal: false },
    { id: 'bot5', name: 'OV1', type: 'over1', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, contractType: 'DIGITOVER', barrier: 1,
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, cooldownRemaining: 0, recoveryMode: false, signal: false },
    { id: 'bot6', name: 'UN8', type: 'under8', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, contractType: 'DIGITUNDER', barrier: 8,
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, cooldownRemaining: 0, recoveryMode: false, signal: false }
  ]);

  const botRunningRefs = useRef<Record<string, boolean>>({});
  const botPausedRefs = useRef<Record<string, boolean>>({});

  // Monitor entry conditions
  useEffect(() => {
    const checkSignals = () => {
      marketSignals.forEach(signal => {
        if (signal.status === 'waiting') {
          const bot = BOT_STRATEGIES.find(b => b.id === signal.botId)!;
          const marketDigits = marketDigitsRef.current[signal.market] || [];
          
          if (bot.entryCondition(marketDigits)) {
            setMarketSignals(prev => prev.map(s => 
              s.market === signal.market && s.botId === signal.botId
                ? { ...s, status: 'triggered' }
                : s
            ));
            
            if (soundEnabled) playScanSound('signal');
            speak(`Signal found for ${bot.name}`, true);
            toast.success(`${bot.name} triggered on ${signal.market}`);
            
            const botState = bots.find(b => b.type === bot.type);
            if (botState && !botState.isRunning) {
              setBots(prev => prev.map(b => 
                b.id === botState.id 
                  ? { ...b, selectedMarket: signal.market, signal: true }
                  : b
              ));
              setTimeout(() => startBot(botState.id), 1000);
            }
          }
        }
      });
    };

    const interval = setInterval(checkSignals, 1000);
    return () => clearInterval(interval);
  }, [marketSignals, bots, soundEnabled]);

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
              
              setBots(prev => prev.map(b => 
                b.type === bot.type ? { ...b, selectedMarket: market } : b
              ));
              
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
        toast.success(`Found ${foundSignals.length} signals`);
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
      selectedMarket: undefined
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

      const marketDigits = marketDigitsRef.current[currentMarket] || [];
      const lastDigit = marketDigits.length > 0 ? marketDigits[marketDigits.length - 1] : undefined;

      const botStrategy = BOT_STRATEGIES.find(s => s.type === bot.type)!;
      let currentSignal = botStrategy.entryCondition(marketDigits);

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
        await new Promise(r => setTimeout(r, 1000));

        if (activeTradeId) {
          await new Promise(r => setTimeout(r, 500));
          continue;
        }

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
          lastDigit,
          signalType: bot.type
        }, ...prev].slice(0, 50));

        await new Promise(r => setTimeout(r, 2000));
        const won = Math.random() > 0.5;
        const pnl = won ? stake * 0.95 : -stake;

        setTrades(prev => prev.map(t => t.id === id ? { ...t, result: won ? 'Win' : 'Loss', pnl, lastDigit } : t));

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
      signal: false
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
      signal: false
    } : b));
  };

  const stopAllBots = () => {
    bots.forEach(bot => botRunningRefs.current[bot.id] = false);
    setBots(prev => prev.map(b => ({ ...b, isRunning: false, isPaused: false, status: 'idle', signal: false })));
  };

  // Calculate totals
  const totalProfit = bots.reduce((sum, bot) => sum + bot.totalPnl, 0);
  const totalTrades = bots.reduce((sum, bot) => sum + bot.trades, 0);
  const totalWins = bots.reduce((sum, bot) => sum + bot.wins, 0);
  const winRate = totalTrades > 0 ? ((totalWins / totalTrades) * 100).toFixed(1) : '0';
  const activeSignals = bots.filter(b => b.signal).length;

  return (
    <div className="space-y-3 p-3 bg-background min-h-screen relative overflow-hidden">
      {/* Sound Toggle */}
      <div className="absolute top-3 right-3 z-20">
        <Button
          variant="outline"
          size="icon"
          onClick={() => setSoundEnabled(!soundEnabled)}
          className="w-8 h-8"
        >
          <Volume2 className={`w-4 h-4 ${soundEnabled ? 'text-green-400' : 'text-gray-400'}`} />
        </Button>
      </div>

      {/* Header - Compact */}
      <div className="bg-card border rounded-lg p-2">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold">🤖 6-BOT</h1>
          <div className="flex items-center gap-1">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={scanMarket}
              disabled={isScanning}
              className="h-7 text-xs"
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

        {/* Mini Stats */}
        <div className="grid grid-cols-4 gap-1 mt-1 text-[10px]">
          <div className="bg-muted/30 rounded p-1">
            <div className="text-muted-foreground">Balance</div>
            <div className="font-bold">${balance?.toFixed(2)}</div>
          </div>
          <div className="bg-muted/30 rounded p-1">
            <div className="text-muted-foreground">P&L</div>
            <div className={totalProfit >= 0 ? 'text-profit' : 'text-loss'}>
              ${totalProfit.toFixed(2)}
            </div>
          </div>
          <div className="bg-muted/30 rounded p-1">
            <div className="text-muted-foreground">Win%</div>
            <div>{winRate}%</div>
          </div>
          <div className="bg-muted/30 rounded p-1">
            <div className="text-muted-foreground">Signal</div>
            <div className="text-yellow-400">{activeSignals}/6</div>
          </div>
        </div>

        {/* Settings - Compact */}
        <div className="grid grid-cols-4 gap-1 mt-1">
          <input type="number" value={globalStake} onChange={(e) => setGlobalStake(parseFloat(e.target.value) || 0.5)} className="w-full bg-background border rounded px-1 py-0.5 text-[10px]" placeholder="Stake" />
          <input type="number" value={globalMultiplier} onChange={(e) => setGlobalMultiplier(parseFloat(e.target.value) || 2)} className="w-full bg-background border rounded px-1 py-0.5 text-[10px]" placeholder="Mult" />
          <input type="number" value={globalStopLoss} onChange={(e) => setGlobalStopLoss(parseFloat(e.target.value) || 30)} className="w-full bg-background border rounded px-1 py-0.5 text-[10px]" placeholder="SL" />
          <input type="number" value={globalTakeProfit} onChange={(e) => setGlobalTakeProfit(parseFloat(e.target.value) || 5)} className="w-full bg-background border rounded px-1 py-0.5 text-[10px]" placeholder="TP" />
        </div>
      </div>

      {/* No Signal */}
      <AnimatePresence>
        {noSignal && !isScanning && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-center py-4">
            <div className="text-red-400 text-sm font-bold">NO SIGNAL FOUND</div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Signals - Compact */}
      {marketSignals.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-bold">Signals ({marketSignals.length})</div>
          <div className="grid grid-cols-2 gap-1">
            {marketSignals.map((signal) => (
              <div key={`${signal.market}_${signal.botId}`} className={`bg-card border rounded p-1 text-[9px] ${signal.status === 'triggered' ? 'border-green-500' : 'border-yellow-500'}`}>
                <div className="flex justify-between">
                  <span className="font-bold text-blue-400">{getMarketDisplay(signal.market)}</span>
                  <span className={`px-1 rounded ${signal.status === 'triggered' ? 'bg-green-500' : 'bg-yellow-500'} text-black`}>
                    {signal.status === 'triggered' ? 'TRADE' : 'WAIT'}
                  </span>
                </div>
                <div>Bot: {signal.botName}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bots Grid - Compact 3x2 */}
      <div className="grid grid-cols-3 gap-1">
        {bots.map((bot) => (
          <motion.div
            key={bot.id}
            className={`bg-card border rounded p-1 text-[8px] ${bot.isRunning ? 'border-primary' : ''} ${bot.signal ? 'ring-1 ring-yellow-500' : ''}`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                <div className={`p-0.5 rounded ${
                  bot.type.includes('over') ? 'bg-blue-500/20' :
                  bot.type.includes('under') ? 'bg-orange-500/20' :
                  bot.type === 'even' ? 'bg-green-500/20' : 'bg-purple-500/20'
                }`}>
                  {bot.type.includes('over') ? <TrendingUp className="w-2 h-2" /> :
                   bot.type.includes('under') ? <TrendingDown className="w-2 h-2" /> :
                   <CircleDot className="w-2 h-2" />}
                </div>
                <span className="font-bold">{bot.name}</span>
              </div>
              <Badge variant={bot.isRunning ? "default" : "secondary"} className="text-[6px] px-1 py-0 h-3">
                {bot.isRunning ? (bot.isPaused ? '⏸️' : '▶️') : '⏹️'}
              </Badge>
            </div>

            <div className="mt-1">
              <div className="text-muted-foreground">Mkt: <span className="text-blue-400">{bot.selectedMarket ? getMarketDisplay(bot.selectedMarket) : '—'}</span></div>
              <div className="flex justify-between">
                <span>P&L: <span className={bot.totalPnl > 0 ? 'text-profit' : bot.totalPnl < 0 ? 'text-loss' : ''}>${bot.totalPnl.toFixed(2)}</span></span>
                <span>Stake: ${bot.currentStake.toFixed(2)}</span>
              </div>
            </div>

            <div className="flex gap-1 mt-1">
              {!bot.isRunning ? (
                <Button onClick={() => startBot(bot.id)} disabled={!bot.selectedMarket} size="sm" className="flex-1 h-5 text-[6px] px-0">
                  <Play className="w-2 h-2 mr-0.5" /> Start
                </Button>
              ) : (
                <>
                  <Button onClick={() => pauseBot(bot.id)} size="sm" variant="outline" className="flex-1 h-5 text-[6px] px-0">
                    <Pause className="w-2 h-2 mr-0.5" /> {bot.isPaused ? 'Res' : 'Pau'}
                  </Button>
                  <Button onClick={() => stopBot(bot.id)} size="sm" variant="destructive" className="flex-1 h-5 text-[6px] px-0">
                    <StopCircle className="w-2 h-2 mr-0.5" /> Stop
                  </Button>
                </>
              )}
            </div>
          </motion.div>
        ))}
      </div>

      {/* Trade Log - Compact */}
      <div className="bg-card border rounded-lg p-1">
        <div className="text-xs font-bold mb-1">Trades</div>
        <div className="space-y-0.5 max-h-32 overflow-y-auto">
          {trades.length === 0 ? (
            <p className="text-[8px] text-center py-1">No trades</p>
          ) : (
            trades.map((trade, idx) => (
              <div key={idx} className="flex justify-between text-[7px] py-0.5 border-b last:border-0">
                <span>{trade.time}</span>
                <span>{getMarketDisplay(trade.market)}</span>
                <span className={trade.result === 'Win' ? 'text-profit' : trade.result === 'Loss' ? 'text-loss' : ''}>
                  {trade.result === 'Win' ? `+$${trade.pnl.toFixed(2)}` : 
                   trade.result === 'Loss' ? `-$${Math.abs(trade.pnl).toFixed(2)}` : '⏳'}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
