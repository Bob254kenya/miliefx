import { useState, useRef, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { derivApi } from '@/services/deriv-api';
import { useAuth } from '@/contexts/AuthContext';
import { useTickLoader } from '@/hooks/useTickLoader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Play, StopCircle, Pause, TrendingUp, TrendingDown, CircleDot, RefreshCw, Trash2, DollarSign } from 'lucide-react';

interface MarketAnalysis {
  symbol: string;
  mostAppearing: number;
  secondMost: number;
  leastAppearing: number;
  evenCount: number;
  oddCount: number;
  over3Count: number;
  under6Count: number;
  over8Count: number;
  under3Count: number;
  over1Count: number;
  under8Count: number;
  lastDigit: number;
  previousDigit: number;
  volatilityScore?: number;
  recommendedBot?: string;
  marketType?: 'volatile' | 'bear' | 'bull' | 'jump';
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
  currentMarketDigits?: number[];
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

const VOLATILITY_MARKETS = [
  'R_10', 'R_25', 'R_50', 'R_75', 'R_100',
  '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V',
  'BOOM300', 'BOOM500', 'BOOM1000',
  'CRASH300', 'CRASH500', 'CRASH1000',
  'RDBEAR', 'RDBULL', 'JD10', 'JD25', 'JD50', 'JD75', 'JD100'
];

// Categorize markets by type
const getMarketType = (market: string): string => {
  if (market.startsWith('R_') || market.includes('1HZ')) return 'volatile';
  if (market.startsWith('BOOM')) return 'jump';
  if (market.startsWith('CRASH')) return 'jump';
  if (market === 'RDBEAR') return 'bear';
  if (market === 'RDBULL') return 'bull';
  if (market.startsWith('JD')) return 'jump';
  return 'volatile';
};

function waitForNextTick(symbol: string): Promise<{ quote: number; epoch: number }> {
  return new Promise((resolve) => {
    const unsub = derivApi.onMessage((data: any) => {
      if (data.tick && data.tick.symbol === symbol) {
        unsub();
        resolve({ quote: data.tick.quote, epoch: data.tick.epoch });
      }
    });
  });
}

// Play scanning sound
const playScanSound = () => {
  try {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, audioContext.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(440, audioContext.currentTime + 0.2);
    
    gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.2);
  } catch (e) {
    console.log('Audio not supported');
  }
};

// Market analysis functions
const analyzeMarket = (digits: number[], market: string): MarketAnalysis => {
  if (digits.length < 700) return {} as MarketAnalysis;
  
  const last700 = digits.slice(-700);
  const counts: Record<number, number> = {};
  for (let i = 0; i <= 9; i++) counts[i] = 0;
  last700.forEach(d => counts[d]++);
  
  const sortedDigits = [...Array(10).keys()].sort((a, b) => counts[b] - counts[a]);
  
  const evenDigits = [0,2,4,6,8];
  const oddDigits = [1,3,5,7,9];
  const evenCount = evenDigits.reduce((sum, d) => sum + counts[d], 0);
  const oddCount = oddDigits.reduce((sum, d) => sum + counts[d], 0);
  
  const over3Count = [4,5,6,7,8,9].reduce((sum, d) => sum + counts[d], 0);
  const under6Count = [0,1,2,3,4,5].reduce((sum, d) => sum + counts[d], 0);
  const over8Count = [9].reduce((sum, d) => sum + counts[d], 0);
  const under3Count = [0,1,2].reduce((sum, d) => sum + counts[d], 0);
  const over1Count = [2,3,4,5,6,7,8,9].reduce((sum, d) => sum + counts[d], 0);
  const under8Count = [0,1,2,3,4,5,6,7].reduce((sum, d) => sum + counts[d], 0);
  
  const lastDigit = digits.length > 0 ? digits[digits.length - 1] : 0;
  const previousDigit = digits.length > 1 ? digits[digits.length - 2] : 0;
  
  // Calculate volatility score based on digit distribution
  let volatilityScore = 0;
  let recommendedBot = '';
  let marketType: 'volatile' | 'bear' | 'bull' | 'jump' = 'volatile';
  
  // Check for JUMP markets (BOOM/CRASH/JD)
  if (market.startsWith('BOOM') || market.startsWith('CRASH') || market.startsWith('JD')) {
    marketType = 'jump';
    // Jump markets have different characteristics
    const volatility = Math.abs(counts[9] - counts[0]) / 7;
    volatilityScore = Math.min(10, Math.max(1, Math.round(volatility * 10)));
    
    if (market.includes('BOOM') && counts[9] > counts[0]) {
      recommendedBot = 'OVER';
    } else if (market.includes('CRASH') && counts[0] > counts[9]) {
      recommendedBot = 'UNDER';
    }
  }
  // Check for BEAR market
  else if (market === 'RDBEAR') {
    marketType = 'bear';
    // Bear market favors under digits
    if (under6Count > over3Count) {
      volatilityScore = 8;
      recommendedBot = 'UNDER';
    }
  }
  // Check for BULL market
  else if (market === 'RDBULL') {
    marketType = 'bull';
    // Bull market favors over digits
    if (over3Count > under6Count) {
      volatilityScore = 8;
      recommendedBot = 'OVER';
    }
  }
  // Volatile markets (R_ and 1HZ)
  else {
    marketType = 'volatile';
    
    // Check conditions for Over bot
    if (sortedDigits[0] >= 4) {
      const isMostEven = sortedDigits[0] % 2 === 0;
      if (isMostEven && sortedDigits[1] % 2 === 0) {
        volatilityScore = 9;
        recommendedBot = 'OVER';
      } else if (!isMostEven && sortedDigits[1] % 2 === 1) {
        volatilityScore = 9;
        recommendedBot = 'OVER';
      }
    }
    
    // Check conditions for Under bot
    if (sortedDigits[9] <= 5) {
      const isLeastEven = sortedDigits[9] % 2 === 0;
      if (isLeastEven) {
        volatilityScore = Math.max(volatilityScore, 8);
        recommendedBot = 'UNDER';
      } else {
        volatilityScore = Math.max(volatilityScore, 8);
        recommendedBot = 'UNDER';
      }
    }
  }
  
  // Default volatility score if none assigned
  if (volatilityScore === 0) {
    const range = Math.abs(counts[9] - counts[0]);
    volatilityScore = Math.min(10, Math.max(1, Math.round(range / 10)));
  }
  
  return {
    symbol: market,
    mostAppearing: sortedDigits[0],
    secondMost: sortedDigits[1],
    leastAppearing: sortedDigits[9],
    evenCount,
    oddCount,
    over3Count,
    under6Count,
    over8Count,
    under3Count,
    over1Count,
    under8Count,
    lastDigit,
    previousDigit,
    volatilityScore,
    recommendedBot,
    marketType
  };
};

// Entry condition checks
const checkOver3Entry = (digits: number[]): boolean => {
  if (digits.length < 2) return false;
  const lastTwo = digits.slice(-2);
  return lastTwo.every(d => d <= 3);
};

const checkUnder6Entry = (digits: number[]): boolean => {
  if (digits.length < 2) return false;
  const lastTwo = digits.slice(-2);
  return lastTwo.every(d => d >= 6);
};

const checkOver1Entry = (digits: number[]): boolean => {
  if (digits.length < 2) return false;
  const lastTwo = digits.slice(-2);
  return lastTwo.every(d => d <= 1);
};

const checkUnder8Entry = (digits: number[]): boolean => {
  if (digits.length < 2) return false;
  const lastTwo = digits.slice(-2);
  return lastTwo.every(d => d >= 8);
};

const checkEvenEntry = (digits: number[]): boolean => {
  if (digits.length < 3) return false;
  const lastThree = digits.slice(-3);
  return lastThree.every(d => d % 2 === 1);
};

const checkOddEntry = (digits: number[]): boolean => {
  if (digits.length < 3) return false;
  const lastThree = digits.slice(-3);
  return lastThree.every(d => d % 2 === 0);
};

const checkAllSignals = (digits: number[]): Record<string, boolean> => {
  return {
    over3: checkOver3Entry(digits),
    under6: checkUnder6Entry(digits),
    over1: checkOver1Entry(digits),
    under8: checkUnder8Entry(digits),
    even: checkEvenEntry(digits),
    odd: checkOddEntry(digits)
  };
};

export default function AutoTrade() {
  const { isAuthorized, activeAccount, balance } = useAuth();
  const [activeTradeId, setActiveTradeId] = useState<string | null>(null);
  const [selectedMarket, setSelectedMarket] = useState<string>('R_100');
  const [marketAnalysis, setMarketAnalysis] = useState<Record<string, MarketAnalysis>>({});
  const [marketSignals, setMarketSignals] = useState<Record<string, Record<string, boolean>>>({});
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [globalStake, setGlobalStake] = useState<number>(0.5);
  const [globalMultiplier, setGlobalMultiplier] = useState<number>(2);
  const [globalStopLoss, setGlobalStopLoss] = useState<number>(30);
  const [globalTakeProfit, setGlobalTakeProfit] = useState<number>(5);
  const [selectedMarketForScan, setSelectedMarketForScan] = useState<string>('R_100');
  
  const [trades, setTrades] = useState<TradeLog[]>([]);
  const tradeIdRef = useRef(0);
  const marketDigitsRef = useRef<Record<string, number[]>>({});
  const scanTimeoutRef = useRef<NodeJS.Timeout>();
  const audioContextRef = useRef<AudioContext | null>(null);

  const { digits, prices, isLoading, tickCount } = useTickLoader(selectedMarketForScan, 1000);

  // Update market digits for all markets
  useEffect(() => {
    if (digits.length > 0) {
      marketDigitsRef.current[selectedMarketForScan] = digits;
      
      const signals = checkAllSignals(digits);
      setMarketSignals(prev => ({
        ...prev,
        [selectedMarketForScan]: signals
      }));
    }
  }, [digits, selectedMarketForScan]);

  // Initialize audio context
  useEffect(() => {
    if (!audioContextRef.current) {
      try {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      } catch (e) {
        console.log('Web Audio API not supported');
      }
    }
    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  // Play scanning sound with variations
  const playEnhancedScanSound = useCallback((progress: number) => {
    if (!audioContextRef.current) return;
    
    try {
      const ctx = audioContextRef.current;
      const now = ctx.currentTime;
      
      // Main scanning beep
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.type = 'sine';
      // Frequency increases with progress
      const baseFreq = 440 + (progress * 440);
      osc.frequency.setValueAtTime(baseFreq, now);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.5, now + 0.1);
      
      gain.gain.setValueAtTime(0.05, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.start(now);
      osc.stop(now + 0.1);
    } catch (e) {
      // Ignore audio errors
    }
  }, []);

  // Six bots
  const [bots, setBots] = useState<BotState[]>([
    { 
      id: 'bot1', name: 'OVER 3 BOT', type: 'over3', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, contractType: 'DIGITOVER', barrier: 3,
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, cooldownRemaining: 0, recoveryMode: false,
      signal: false
    },
    { 
      id: 'bot2', name: 'UNDER 6 BOT', type: 'under6', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, contractType: 'DIGITUNDER', barrier: 6,
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, cooldownRemaining: 0, recoveryMode: false,
      signal: false
    },
    { 
      id: 'bot3', name: 'EVEN BOT', type: 'even', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, contractType: 'DIGITEVEN',
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, cooldownRemaining: 0, recoveryMode: false,
      signal: false
    },
    { 
      id: 'bot4', name: 'ODD BOT', type: 'odd', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, contractType: 'DIGITODD',
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, cooldownRemaining: 0, recoveryMode: false,
      signal: false
    },
    { 
      id: 'bot5', name: 'OVER 1 BOT', type: 'over1', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, contractType: 'DIGITOVER', barrier: 1,
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, cooldownRemaining: 0, recoveryMode: false,
      signal: false
    },
    { 
      id: 'bot6', name: 'UNDER 8 BOT', type: 'under8', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, contractType: 'DIGITUNDER', barrier: 8,
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, cooldownRemaining: 0, recoveryMode: false,
      signal: false
    },
  ]);

  const botRunningRefs = useRef<Record<string, boolean>>({});
  const botPausedRefs = useRef<Record<string, boolean>>({});

  // Scan all markets with enhanced features
  const scanMarket = useCallback(async () => {
    if (isScanning) return;
    
    setIsScanning(true);
    setScanProgress(0);
    
    // Play initial sound
    playScanSound();
    
    // Clear previous timeout
    if (scanTimeoutRef.current) {
      clearTimeout(scanTimeoutRef.current);
    }
    
    try {
      const startTime = Date.now();
      const duration = 20000; // 20 seconds
      
      // Progress animation with sound
      const updateProgress = () => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min((elapsed / duration) * 100, 100);
        setScanProgress(progress);
        
        // Play sound at certain intervals
        if (Math.floor(progress) % 10 === 0 && progress > 0) {
          playEnhancedScanSound(progress / 100);
        }
        
        if (elapsed < duration) {
          scanTimeoutRef.current = setTimeout(updateProgress, 100);
        }
      };
      
      scanTimeoutRef.current = setTimeout(updateProgress, 100);
      
      // Perform actual scanning
      const analysis: Record<string, MarketAnalysis> = {};
      const signals: Record<string, Record<string, boolean>> = {};
      const marketTypes: Record<string, { score: number, type: string, marketType: string }> = {};
      
      for (const market of VOLATILITY_MARKETS) {
        const marketDigits = marketDigitsRef.current[market] || [];
        if (marketDigits.length >= 700) {
          analysis[market] = analyzeMarket(marketDigits, market);
          signals[market] = checkAllSignals(marketDigits);
          
          // Store market type and recommendation
          if (analysis[market].volatilityScore && analysis[market].volatilityScore >= 7) {
            marketTypes[market] = { 
              score: analysis[market].volatilityScore || 0, 
              type: analysis[market].recommendedBot || '',
              marketType: analysis[market].marketType || 'volatile'
            };
          }
        }
      }
      
      // Wait for 20 seconds to complete
      await new Promise(resolve => setTimeout(resolve, Math.max(0, duration - (Date.now() - startTime))));
      
      setMarketAnalysis(analysis);
      setMarketSignals(signals);
      
      // Auto-select best markets for each bot based on market type
      const bestMarkets: Record<string, string> = {};
      
      // Separate markets by type
      const volatileMarkets = Object.entries(marketTypes).filter(([_, data]) => data.marketType === 'volatile');
      const jumpMarkets = Object.entries(marketTypes).filter(([_, data]) => data.marketType === 'jump');
      const bearMarkets = Object.entries(marketTypes).filter(([_, data]) => data.marketType === 'bear');
      const bullMarkets = Object.entries(marketTypes).filter(([_, data]) => data.marketType === 'bull');
      
      // Sort by score
      const sortedVolatile = volatileMarkets.sort((a, b) => b[1].score - a[1].score);
      const sortedJump = jumpMarkets.sort((a, b) => b[1].score - a[1].score);
      
      // Assign OVER bots to appropriate markets
      const overBots = ['over3', 'over1'];
      overBots.forEach((botType, index) => {
        // Prefer bull markets for OVER bots
        if (bullMarkets.length > index) {
          bestMarkets[botType] = bullMarkets[index][0];
        } else if (sortedVolatile[index] && sortedVolatile[index][1].type === 'OVER') {
          bestMarkets[botType] = sortedVolatile[index][0];
        } else if (sortedJump[index]) {
          bestMarkets[botType] = sortedJump[index][0];
        }
      });
      
      // Assign UNDER bots to appropriate markets
      const underBots = ['under6', 'under8'];
      underBots.forEach((botType, index) => {
        // Prefer bear markets for UNDER bots
        if (bearMarkets.length > index) {
          bestMarkets[botType] = bearMarkets[index][0];
        } else if (sortedVolatile[index] && sortedVolatile[index][1].type === 'UNDER') {
          bestMarkets[botType] = sortedVolatile[index][0];
        } else if (sortedJump[index]) {
          bestMarkets[botType] = sortedJump[index][0];
        }
      });
      
      // Assign EVEN/ODD bots to remaining markets
      const remainingMarkets = VOLATILITY_MARKETS.filter(m => 
        !Object.values(bestMarkets).includes(m) && marketDigitsRef.current[m]?.length >= 700
      );
      
      if (remainingMarkets.length >= 2) {
        bestMarkets['even'] = remainingMarkets[0];
        bestMarkets['odd'] = remainingMarkets[1];
      }
      
      // Update bots with selected markets
      setBots(prev => prev.map(bot => ({
        ...bot,
        selectedMarket: bestMarkets[bot.type] || bot.selectedMarket || Object.keys(marketDigitsRef.current)[0]
      })));
      
      // Play completion sound
      playScanSound();
      
      const totalFound = Object.keys(marketTypes).length;
      const volatileCount = volatileMarkets.length;
      const jumpCount = jumpMarkets.length;
      const bearCount = bearMarkets.length;
      const bullCount = bullMarkets.length;
      
      toast.success(
        `Scan complete! Found ${totalFound} high volatility markets ` +
        `(${volatileCount} volatile, ${jumpCount} jump, ${bearCount} bear, ${bullCount} bull)`
      );
    } catch (error) {
      console.error('Scan error:', error);
      toast.error('Scan failed');
    } finally {
      setIsScanning(false);
      setScanProgress(100);
      if (scanTimeoutRef.current) {
        clearTimeout(scanTimeoutRef.current);
      }
    }
  }, [isScanning, playEnhancedScanSound]);

  // Clear all data
  const clearAll = () => {
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
      entryTriggered: false,
      cooldownRemaining: 0,
      recoveryMode: false,
      signal: false
    })));
    tradeIdRef.current = 0;
    toast.success('All data cleared');
  };

  // Trading loop (unchanged from original)
  const runBot = useCallback(async (botId: string) => {
    const bot = bots.find(b => b.id === botId);
    if (!bot || !isAuthorized) return;

    if (balance < globalStake) {
      toast.error(`Insufficient balance for ${bot.name}`);
      stopBot(botId);
      return;
    }

    if (!bot.selectedMarket) {
      toast.error(`${bot.name}: No market selected. Scan first.`);
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

      const marketDigits = marketDigitsRef.current[currentMarket] || [];
      const lastDigit = marketDigits.length > 0 ? marketDigits[marketDigits.length - 1] : undefined;

      let currentSignal = false;
      switch (bot.type) {
        case 'over3': currentSignal = checkOver3Entry(marketDigits); break;
        case 'under6': currentSignal = checkUnder6Entry(marketDigits); break;
        case 'even': currentSignal = checkEvenEntry(marketDigits); break;
        case 'odd': currentSignal = checkOddEntry(marketDigits); break;
        case 'over1': currentSignal = checkOver1Entry(marketDigits); break;
        case 'under8': currentSignal = checkUnder8Entry(marketDigits); break;
      }

      setBots(prev => prev.map(b => b.id === botId ? { 
        ...b, 
        signal: currentSignal 
      } : b));

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
          lastDigit,
          signalType: bot.type
        }, ...prev].slice(0, 100));

        const { contractId } = await derivApi.buyContract(params);
        const result = await derivApi.waitForContractResult(contractId);
        const won = result.status === 'won';
        const pnl = result.profit;

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

  // Get market display name with emoji
  const getMarketDisplay = (market: string) => {
    const type = getMarketType(market);
    if (type === 'volatile') return `📈 ${market}`;
    if (type === 'jump') return `💥 ${market}`;
    if (type === 'bear') return `📉 ${market}`;
    if (type === 'bull') return `🐂 ${market}`;
    return market;
  };

  // Get market color class
  const getMarketColor = (market: string) => {
    const type = getMarketType(market);
    switch (type) {
      case 'volatile': return 'text-blue-400';
      case 'jump': return 'text-orange-400';
      case 'bear': return 'text-red-400';
      case 'bull': return 'text-green-400';
      default: return '';
    }
  };

  // Calculate totals
  const totalProfit = bots.reduce((sum, bot) => sum + bot.totalPnl, 0);
  const totalTrades = bots.reduce((sum, bot) => sum + bot.trades, 0);
  const totalWins = bots.reduce((sum, bot) => sum + bot.wins, 0);
  const winRate = totalTrades > 0 ? ((totalWins / totalTrades) * 100).toFixed(1) : '0';

  // Get active signals count
  const activeSignals = bots.filter(b => b.signal).length;

  return (
    <div className="space-y-4 p-4 bg-background min-h-screen relative overflow-hidden">
      {/* Animated dollar sign background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        {[...Array(20)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute text-green-500/10"
            initial={{
              x: Math.random() * window.innerWidth,
              y: -100,
              rotate: 0,
              scale: 0.5 + Math.random() * 0.5
            }}
            animate={{
              y: window.innerHeight + 100,
              rotate: 360,
              x: Math.random() * window.innerWidth
            }}
            transition={{
              duration: 10 + Math.random() * 20,
              repeat: Infinity,
              delay: Math.random() * 10,
              ease: "linear"
            }}
          >
            <DollarSign className="w-12 h-12" />
          </motion.div>
        ))}
      </div>

      {/* Main content */}
      <div className="relative z-10">
        {/* Header with totals */}
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-xl font-bold">🤖 6-Bot Trading System</h1>
            <div className="flex items-center gap-2">
              {/* Dollar Icon Scanner with enhanced animation */}
              <div className="relative flex items-center">
                <motion.div
                  animate={isScanning ? {
                    rotate: 360,
                    scale: [1, 1.3, 1],
                    transition: {
                      rotate: {
                        duration: 2,
                        repeat: Infinity,
                        ease: "linear"
                      },
                      scale: {
                        duration: 0.5,
                        repeat: Infinity,
                        ease: "easeInOut"
                      }
                    }
                  } : {
                    rotate: 0,
                    scale: 1
                  }}
                  className="cursor-pointer mr-2"
                  onClick={scanMarket}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                >
                  <DollarSign className={`w-8 h-8 ${isScanning ? 'text-yellow-400' : 'text-green-400'}`} />
                </motion.div>
                {isScanning && (
                  <>
                    <motion.div 
                      className="absolute -top-1 -right-1 w-3 h-3"
                      animate={{ scale: [1, 1.5, 1] }}
                      transition={{ duration: 0.5, repeat: Infinity }}
                    >
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-yellow-500"></span>
                    </motion.div>
                    {/* Scanning waves */}
                    <motion.div
                      className="absolute -inset-4 border-2 border-yellow-400/30 rounded-full"
                      animate={{ scale: [1, 1.5, 1], opacity: [0.5, 0, 0.5] }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                    />
                  </>
                )}
              </div>
              
              <Select value={selectedMarketForScan} onValueChange={setSelectedMarketForScan}>
                <SelectTrigger className="w-[180px] h-8">
                  <SelectValue placeholder="Select market" />
                </SelectTrigger>
                <SelectContent>
                  {VOLATILITY_MARKETS.map(market => (
                    <SelectItem key={market} value={market}>
                      <span className={getMarketColor(market)}>
                        {getMarketDisplay(market)}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={scanMarket}
                disabled={isScanning}
                className="relative overflow-hidden"
              >
                {isScanning ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                    Scanning... {Math.round(scanProgress)}%
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4 mr-1" />
                    Scan Markets (20s)
                  </>
                )}
              </Button>
              <Button 
                variant="destructive" 
                size="sm" 
                onClick={clearAll}
              >
                <Trash2 className="w-4 h-4 mr-1" /> Clear
              </Button>
              <Button variant="destructive" size="sm" onClick={stopAllBots} disabled={!bots.some(b => b.isRunning)}>
                <StopCircle className="w-4 h-4 mr-1" /> Stop All
              </Button>
            </div>
          </div>

          {/* Scan Progress Bar with enhanced animation */}
          {isScanning && (
            <motion.div 
              className="mb-3"
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                <span>🔍 Scanning markets for volatility...</span>
                <motion.span
                  key={scanProgress}
                  initial={{ scale: 1.2 }}
                  animate={{ scale: 1 }}
                  className="font-bold"
                >
                  {Math.round(scanProgress)}%
                </motion.span>
              </div>
              <div className="w-full h-3 bg-muted rounded-full overflow-hidden">
                <motion.div 
                  className="h-full bg-gradient-to-r from-yellow-400 via-green-400 to-blue-400 relative"
                  initial={{ width: 0 }}
                  animate={{ width: `${scanProgress}%` }}
                  transition={{ duration: 0.1 }}
                >
                  {/* Scanning light effect */}
                  <motion.div
                    className="absolute top-0 bottom-0 w-20 bg-white/30 blur-sm"
                    animate={{ left: ["0%", "100%"] }}
                    transition={{ duration: 1, repeat: Infinity }}
                  />
                </motion.div>
              </div>
            </motion.div>
          )}

          {/* Global Stats */}
          <div className="grid grid-cols-6 gap-3 text-sm">
            <div className="bg-muted/30 rounded-lg p-2">
              <div className="text-muted-foreground text-xs">Balance</div>
              <div className="font-bold text-lg">${balance?.toFixed(2) || '0.00'}</div>
            </div>
            <div className="bg-muted/30 rounded-lg p-2">
              <div className="text-muted-foreground text-xs">Total P&L</div>
              <div className={`font-bold text-lg ${totalProfit >= 0 ? 'text-profit' : 'text-loss'}`}>
                ${totalProfit.toFixed(2)}
              </div>
            </div>
            <div className="bg-muted/30 rounded-lg p-2">
              <div className="text-muted-foreground text-xs">Win Rate</div>
              <div className="font-bold text-lg">{winRate}%</div>
            </div>
            <div className="bg-muted/30 rounded-lg p-2">
              <div className="text-muted-foreground text-xs">Total Trades</div>
              <div className="font-bold text-lg">{totalTrades}</div>
            </div>
            <div className="bg-muted/30 rounded-lg p-2">
              <div className="text-muted-foreground text-xs">Active</div>
              <div className="font-bold text-lg">{bots.filter(b => b.isRunning).length}/6</div>
            </div>
            <div className="bg-muted/30 rounded-lg p-2">
              <div className="text-muted-foreground text-xs">Signals</div>
              <div className="font-bold text-lg text-yellow-400">{activeSignals}/6</div>
            </div>
          </div>

          {/* Settings */}
          <div className="grid grid-cols-4 gap-3 mt-3">
            <div>
              <label className="text-xs text-muted-foreground">Stake ($)</label>
              <input 
                type="number" 
                value={globalStake} 
                onChange={(e) => setGlobalStake(parseFloat(e.target.value) || 0.5)}
                className="w-full bg-background border border-border rounded-lg px-2 py-1 text-sm"
                step="0.1"
                min="0.1"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Multiplier</label>
              <input 
                type="number" 
                value={globalMultiplier} 
                onChange={(e) => setGlobalMultiplier(parseFloat(e.target.value) || 2)}
                className="w-full bg-background border border-border rounded-lg px-2 py-1 text-sm"
                step="0.1"
                min="1.1"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Stop Loss ($)</label>
              <input 
                type="number" 
                value={globalStopLoss} 
                onChange={(e) => setGlobalStopLoss(parseFloat(e.target.value) || 30)}
                className="w-full bg-background border border-border rounded-lg px-2 py-1 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Take Profit ($)</label>
              <input 
                type="number" 
                value={globalTakeProfit} 
                onChange={(e) => setGlobalTakeProfit(parseFloat(e.target.value) || 5)}
                className="w-full bg-background border border-border rounded-lg px-2 py-1 text-sm"
              />
            </div>
          </div>
        </div>

        {/* Bots Grid */}
        <div className="grid grid-cols-3 gap-3 mt-3">
          {bots.map((bot) => {
            const marketData = bot.selectedMarket ? marketAnalysis[bot.selectedMarket] : null;
            const marketSignal = bot.selectedMarket && marketSignals[bot.selectedMarket] 
              ? marketSignals[bot.selectedMarket][bot.type] 
              : false;
            
            return (
              <motion.div
                key={bot.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className={`bg-card border rounded-xl p-3 ${
                  bot.isRunning ? 'border-primary ring-1 ring-primary/20' : 'border-border'
                } ${bot.signal ? 'ring-2 ring-yellow-500/50' : ''}`}
              >
                {/* Header */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className={`p-1.5 rounded-lg ${
                      bot.type === 'over3' || bot.type === 'over1' ? 'bg-blue-500/20 text-blue-400' :
                      bot.type === 'under6' || bot.type === 'under8' ? 'bg-orange-500/20 text-orange-400' :
                      bot.type === 'even' ? 'bg-green-500/20 text-green-400' :
                      'bg-purple-500/20 text-purple-400'
                    }`}>
                      {bot.type.includes('over') ? <TrendingUp className="w-4 h-4" /> :
                       bot.type.includes('under') ? <TrendingDown className="w-4 h-4" /> :
                       <CircleDot className="w-4 h-4" />}
                    </div>
                    <div>
                      <h4 className="font-bold text-sm">{bot.name}</h4>
                      <p className="text-[9px] text-muted-foreground">
                        {bot.contractType} {bot.barrier !== undefined ? `| B${bot.barrier}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {bot.signal && (
                      <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: [1, 1.2, 1] }}
                        transition={{ duration: 0.5, repeat: Infinity }}
                      >
                        <Badge variant="default" className="bg-yellow-500 text-[8px] px-1 py-0">
                          SIGNAL
                        </Badge>
                      </motion.div>
                    )}
                    <Badge variant={bot.isRunning ? "default" : "secondary"} className="text-[9px]">
                      {bot.isRunning ? (bot.isPaused ? '⏸️' : '▶️') : '⏹️'}
                    </Badge>
                  </div>
                </div>

                {/* Market & Analysis */}
                <div className="bg-muted/30 rounded-lg p-2 mb-2 text-[10px]">
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Market:</span>
                    <span className={`font-mono font-bold ${bot.selectedMarket ? getMarketColor(bot.selectedMarket) : ''}`}>
                      {bot.selectedMarket ? getMarketDisplay(bot.selectedMarket) : '—'}
                    </span>
                  </div>
                  {marketData && (
                    <>
                      <div className="flex justify-between mt-1">
                        <span>Most: {marketData.mostAppearing}</span>
                        <span>2nd: {marketData.secondMost}</span>
                        <span>Least: {marketData.leastAppearing}</span>
                      </div>
                      {marketData.volatilityScore && (
                        <div className="flex justify-between mt-1 text-[8px]">
                          <span className="text-yellow-400">
                            Volatility: {marketData.volatilityScore}/10
                            {marketData.marketType && ` (${marketData.marketType})`}
                          </span>
                          {marketData.recommendedBot && (
                            <span className="text-green-400">Rec: {marketData.recommendedBot}</span>
                          )}
                        </div>
                      )}
                      <div className="flex justify-between mt-1 text-[8px]">
                        <span>Last: {marketData.lastDigit}</span>
                        <span>Prev: {marketData.previousDigit}</span>
                        <span className={marketSignal ? 'text-yellow-400 font-bold' : ''}>
                          Signal: {marketSignal ? '✅' : '❌'}
                        </span>
                      </div>
                    </>
                  )}
                </div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-1 text-[10px] mb-2">
                  <div>
                    <span className="text-muted-foreground">P&L:</span>
                    <span className={`ml-1 font-mono ${
                      bot.totalPnl > 0 ? 'text-profit' : bot.totalPnl < 0 ? 'text-loss' : ''
                    }`}>
                      ${bot.totalPnl.toFixed(2)}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Wins:</span>
                    <span className="ml-1 font-mono text-profit">{bot.wins}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Losses:</span>
                    <span className="ml-1 font-mono text-loss">{bot.losses}</span>
                  </div>
                </div>

                {/* Status */}
                <div className="flex items-center justify-between text-[9px] mb-2">
                  <span className="text-muted-foreground">Status:</span>
                  <span className={`font-mono ${
                    bot.status === 'trading' ? 'text-green-400' :
                    bot.status === 'waiting' ? 'text-yellow-400' :
                    bot.status === 'cooldown' ? 'text-purple-400' :
                    'text-gray-400'
                  }`}>
                    {bot.status === 'trading' ? '📈 Trading' :
                     bot.status === 'waiting' ? '⏳ Waiting' :
                     bot.status === 'cooldown' ? `⏱️ Cooldown ${bot.cooldownRemaining}` :
                     '⚫ Idle'}
                  </span>
                  <span className="text-muted-foreground">Stake:</span>
                  <span className="font-mono">${bot.currentStake.toFixed(2)}</span>
                </div>

                {/* Controls */}
                <div className="flex gap-1">
                  {!bot.isRunning ? (
                    <Button
                      onClick={() => startBot(bot.id)}
                      disabled={!isAuthorized || balance < globalStake || activeTradeId !== null || !bot.selectedMarket}
                      size="sm"
                      className="flex-1 h-7 text-xs"
                    >
                      <Play className="w-3 h-3 mr-1" /> Start
                    </Button>
                  ) : (
                    <>
                      <Button
                        onClick={() => pauseBot(bot.id)}
                        size="sm"
                        variant="outline"
                        className="flex-1 h-7 text-xs"
                      >
                        <Pause className="w-3 h-3 mr-1" /> {bot.isPaused ? 'Resume' : 'Pause'}
                      </Button>
                      <Button
                        onClick={() => stopBot(bot.id)}
                        size="sm"
                        variant="destructive"
                        className="flex-1 h-7 text-xs"
                      >
                        <StopCircle className="w-3 h-3 mr-1" /> Stop
                      </Button>
                    </>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Live Signals Panel */}
        <div className="bg-card border border-border rounded-xl p-3 mt-3">
          <h3 className="text-sm font-semibold mb-2">📡 Live Signals - All Markets</h3>
          <div className="grid grid-cols-4 gap-2 max-h-[200px] overflow-y-auto">
            {Object.entries(marketSignals).map(([market, signals]) => {
              const hasAnySignal = Object.values(signals).some(v => v);
              if (!hasAnySignal) return null;
              
              return (
                <motion.div 
                  key={market} 
                  className="bg-muted/30 rounded-lg p-2 text-[10px]"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.2 }}
                >
                  <div className={`font-bold mb-1 ${getMarketColor(market)}`}>
                    {getMarketDisplay(market)}
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    {signals.over3 && <Badge className="bg-blue-500/20 text-blue-400 text-[8px]">OVER 3</Badge>}
                    {signals.under6 && <Badge className="bg-orange-500/20 text-orange-400 text-[8px]">UNDER 6</Badge>}
                    {signals.over1 && <Badge className="bg-blue-500/20 text-blue-400 text-[8px]">OVER 1</Badge>}
                    {signals.under8 && <Badge className="bg-orange-500/20 text-orange-400 text-[8px]">UNDER 8</Badge>}
                    {signals.even && <Badge className="bg-green-500/20 text-green-400 text-[8px]">EVEN</Badge>}
                    {signals.odd && <Badge className="bg-purple-500/20 text-purple-400 text-[8px]">ODD</Badge>}
                  </div>
                </motion.div>
              );
            })}
            {Object.keys(marketSignals).length === 0 && (
              <p className="text-xs text-muted-foreground col-span-4 text-center py-2">
                No active signals. Click the dollar icon to scan.
              </p>
            )}
          </div>
        </div>

        {/* Trade Log */}
        <div className="bg-card border border-border rounded-xl p-3 mt-3">
          <h3 className="text-sm font-semibold mb-2">📋 Live Trade Log</h3>
          <div className="space-y-1 max-h-[300px] overflow-y-auto">
            {trades.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">No trades yet</p>
            ) : (
              trades.map((trade, idx) => (
                <motion.div 
                  key={idx} 
                  className="flex items-center justify-between text-xs py-1 border-b border-border/50 last:border-0"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">{trade.time}</span>
                    <Badge variant="outline" className="text-[8px] px-1 py-0">{trade.bot}</Badge>
                    <span className={`font-mono text-[10px] ${getMarketColor(trade.market)}`}>
                      {trade.market.includes('1HZ') ? '⚡' : 
                       trade.market.includes('BOOM') ? '💥' : 
                       trade.market.includes('CRASH') ? '📉' :
                       trade.market === 'RDBEAR' ? '🐻' :
                       trade.market === 'RDBULL' ? '🐂' : '📊'} {trade.market}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-[10px]">
                      Last: {trade.lastDigit !== undefined ? trade.lastDigit : '—'}
                    </span>
                    <span className="font-mono">${trade.stake.toFixed(2)}</span>
                    <span className={`font-mono w-16 text-right ${
                      trade.result === 'Win' ? 'text-profit' : trade.result === 'Loss' ? 'text-loss' : ''
                    }`}>
                      {trade.result === 'Win' ? `+$${trade.pnl.toFixed(2)}` : 
                       trade.result === 'Loss' ? `-$${Math.abs(trade.pnl).toFixed(2)}` : 
                       '⏳'}
                    </span>
                  </div>
                </motion.div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
