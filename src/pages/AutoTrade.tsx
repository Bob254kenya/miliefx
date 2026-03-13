import { useState, useRef, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { derivApi } from '@/services/deriv-api';
import { useAuth } from '@/contexts/AuthContext';
import { useTickLoader } from '@/hooks/useTickLoader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Play, StopCircle, Pause, TrendingUp, TrendingDown, CircleDot, RefreshCw, Trash2, DollarSign, Sparkles } from 'lucide-react';

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
  signalStrength?: number;
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

interface ScannedMarket {
  symbol: string;
  score: number;
  analysis: MarketAnalysis;
  signals: Record<string, boolean>;
}

const VOLATILITY_MARKETS = [
  'R_10', 'R_25', 'R_50', 'R_75', 'R_100',
  '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V',
  'BOOM300', 'BOOM500', 'BOOM1000',
  'CRASH300', 'CRASH500', 'CRASH1000',
  'RDBEAR', 'RDBULL', 'JD10', 'JD25', 'JD50', 'JD75', 'JD100'
];

const AUTO_SCAN_MARKETS = [
  'R_10', 'R_25', 'R_50', 'R_75', 'R_100',
  '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V'
];

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

const analyzeMarket = (digits: number[]): MarketAnalysis => {
  if (digits.length < 100) return {} as MarketAnalysis;
  
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
  
  let volatilityScore = 0;
  let recommendedBot = '';
  let signalStrength = 0;
  
  if (sortedDigits[0] >= 4) {
    const isMostEven = sortedDigits[0] % 2 === 0;
    if (isMostEven) {
      if (sortedDigits[1] % 2 === 0) {
        volatilityScore = 9;
        recommendedBot = 'OVER';
      }
    } else {
      if (sortedDigits[1] % 2 === 1) {
        volatilityScore = 9;
        recommendedBot = 'OVER';
      }
    }
  }
  
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
  
  // Calculate signal strength
  const top3Count = sortedDigits.slice(0, 3).reduce((sum, d) => sum + counts[d], 0);
  const concentrationScore = (top3Count / 700) * 40;
  
  const patternScore = (
    (checkOver3Entry(digits) ? 10 : 0) +
    (checkUnder6Entry(digits) ? 10 : 0) +
    (checkOver1Entry(digits) ? 10 : 0) +
    (checkUnder8Entry(digits) ? 10 : 0) +
    (checkEvenEntry(digits) ? 10 : 0) +
    (checkOddEntry(digits) ? 10 : 0)
  );
  
  const digitRange = Math.max(...sortedDigits) - Math.min(...sortedDigits);
  const volatilityFactor = (digitRange / 9) * 20;
  
  signalStrength = Math.min(100, concentrationScore + patternScore + volatilityFactor);
  
  return {
    symbol: '',
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
    signalStrength: Math.round(signalStrength)
  };
};

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
  const [autoStartAll, setAutoStartAll] = useState(false);
  
  // Internal state for auto market scanning
  const [scannedMarkets, setScannedMarkets] = useState<ScannedMarket[]>([]);
  const [bestMarket, setBestMarket] = useState<string | null>(null);
  const [bestScore, setBestScore] = useState<number>(0);
  const [isAutoScanning, setIsAutoScanning] = useState(false);
  const autoScanIntervalRef = useRef<NodeJS.Timeout>();
  const isScanningRef = useRef(false);
  
  const [trades, setTrades] = useState<TradeLog[]>([]);
  const tradeIdRef = useRef(0);
  const marketDigitsRef = useRef<Record<string, number[]>>({});
  const scanTimeoutRef = useRef<NodeJS.Timeout>();

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

  const { digits, prices, isLoading, tickCount } = useTickLoader(selectedMarketForScan, 1000);

  // Update digits for the selected market
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

  // Auto-scan all markets function
  const autoScanAllMarkets = useCallback(async (): Promise<ScannedMarket[]> => {
    const scanned: ScannedMarket[] = [];
    
    for (const market of AUTO_SCAN_MARKETS) {
      try {
        let marketDigits = marketDigitsRef.current[market];
        
        // If we don't have enough data for this market, try to get it
        if (!marketDigits || marketDigits.length < 100) {
          // Skip if we don't have data - will be picked up in next scan
          continue;
        }
        
        const analysis = analyzeMarket(marketDigits);
        analysis.symbol = market;
        
        const signals = checkAllSignals(marketDigits);
        
        // Calculate score based on signal strength and active signals
        const signalCount = Object.values(signals).filter(v => v).length;
        const score = (analysis.signalStrength || 0) + (signalCount * 5);
        
        scanned.push({
          symbol: market,
          score,
          analysis,
          signals
        });
      } catch (error) {
        console.error(`Error scanning market ${market}:`, error);
      }
    }
    
    // Sort by score
    scanned.sort((a, b) => b.score - a.score);
    
    return scanned;
  }, []);

  // Background scanner
  const runBackgroundScan = useCallback(async () => {
    if (isScanningRef.current) return;
    
    isScanningRef.current = true;
    
    try {
      const scanned = await autoScanAllMarkets();
      setScannedMarkets(scanned);
      
      if (scanned.length > 0 && scanned[0].score > 0) {
        const newBestMarket = scanned[0];
        setBestMarket(newBestMarket.symbol);
        setBestScore(newBestMarket.score);
        
        // Only update if we have a valid market
        if (newBestMarket.symbol) {
          // Update all running bots to use the best market
          setBots(prev => prev.map(bot => {
            if (bot.isRunning) {
              return {
                ...bot,
                selectedMarket: newBestMarket.symbol
              };
            }
            return bot;
          }));
          
          // Also update the manual selector
          setSelectedMarketForScan(newBestMarket.symbol);
          
          // Update market analysis and signals
          setMarketAnalysis(prev => ({
            ...prev,
            [newBestMarket.symbol]: newBestMarket.analysis
          }));
          
          setMarketSignals(prev => ({
            ...prev,
            [newBestMarket.symbol]: newBestMarket.signals
          }));
        }
      }
    } catch (error) {
      console.error('Background scan error:', error);
    } finally {
      isScanningRef.current = false;
    }
  }, [autoScanAllMarkets]);

  // Start/stop background scanner based on bot activity
  useEffect(() => {
    const anyBotRunning = bots.some(b => b.isRunning);
    
    if (anyBotRunning && !isAutoScanning) {
      setIsAutoScanning(true);
      // Run initial scan
      runBackgroundScan();
      // Set up interval for continuous scanning
      autoScanIntervalRef.current = setInterval(runBackgroundScan, 30000);
    } else if (!anyBotRunning && isAutoScanning) {
      setIsAutoScanning(false);
      if (autoScanIntervalRef.current) {
        clearInterval(autoScanIntervalRef.current);
        autoScanIntervalRef.current = undefined;
      }
    }
    
    return () => {
      if (autoScanIntervalRef.current) {
        clearInterval(autoScanIntervalRef.current);
        autoScanIntervalRef.current = undefined;
      }
    };
  }, [bots, isAutoScanning, runBackgroundScan]);

  // Auto-start all bots when markets are ready
  useEffect(() => {
    if (autoStartAll && !isScanning && Object.keys(marketAnalysis).length > 0) {
      const readyBots = bots.filter(bot => bot.selectedMarket && !bot.isRunning);
      readyBots.forEach(bot => {
        setTimeout(() => startBot(bot.id), 100);
      });
      setAutoStartAll(false);
      toast.success('All ready markets auto-started!');
    }
  }, [autoStartAll, isScanning, marketAnalysis, bots]);

  // Auto-stop if bot is in profit
  useEffect(() => {
    bots.forEach(bot => {
      if (bot.isRunning && bot.totalPnl > 0 && !bot.isPaused) {
        stopBot(bot.id);
        toast.success(`${bot.name} auto-stopped with +$${bot.totalPnl.toFixed(2)} profit!`);
      }
    });
  }, [bots]);

  const scanMarket = useCallback(async () => {
    if (isScanning) return;
    
    setIsScanning(true);
    setScanProgress(0);
    playScanSound();
    
    if (scanTimeoutRef.current) {
      clearTimeout(scanTimeoutRef.current);
    }
    
    try {
      const startTime = Date.now();
      const duration = 20000;
      
      const updateProgress = () => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min((elapsed / duration) * 100, 100);
        setScanProgress(progress);
        
        if (elapsed < duration) {
          scanTimeoutRef.current = setTimeout(updateProgress, 100);
        }
      };
      
      scanTimeoutRef.current = setTimeout(updateProgress, 100);
      
      const analysis: Record<string, MarketAnalysis> = {};
      const signals: Record<string, Record<string, boolean>> = {};
      const volatilityMarkets: Record<string, { score: number, type: string }> = {};
      
      for (const market of VOLATILITY_MARKETS) {
        const marketDigits = marketDigitsRef.current[market] || [];
        if (marketDigits.length >= 100) {
          analysis[market] = analyzeMarket(marketDigits);
          analysis[market].symbol = market;
          
          signals[market] = checkAllSignals(marketDigits);
          
          const sortedDigits = [...Array(10).keys()].sort((a, b) => {
            const countA = marketDigits.filter(d => d === a).length;
            const countB = marketDigits.filter(d => d === b).length;
            return countB - countA;
          });
          
          const mostAppearing = sortedDigits[0];
          const leastAppearing = sortedDigits[9];
          const secondMost = sortedDigits[1];
          
          let volatilityScore = 0;
          let recommendedType = '';
          
          if (mostAppearing >= 4) {
            const isMostEven = mostAppearing % 2 === 0;
            if (isMostEven && secondMost % 2 === 0) {
              volatilityScore = 9;
              recommendedType = 'OVER';
            } else if (!isMostEven && secondMost % 2 === 1) {
              volatilityScore = 9;
              recommendedType = 'OVER';
            }
          }
          
          if (leastAppearing <= 5) {
            const isLeastEven = leastAppearing % 2 === 0;
            if (isLeastEven) {
              volatilityScore = Math.max(volatilityScore, 8);
              recommendedType = 'UNDER';
            } else {
              volatilityScore = Math.max(volatilityScore, 8);
              recommendedType = 'UNDER';
            }
          }
          
          if (volatilityScore > 0) {
            volatilityMarkets[market] = { score: volatilityScore, type: recommendedType };
          }
        }
      }
      
      await new Promise(resolve => setTimeout(resolve, Math.max(0, duration - (Date.now() - startTime))));
      
      setMarketAnalysis(analysis);
      setMarketSignals(signals);
      
      const bestMarkets: Record<string, string> = {};
      const overMarkets = Object.entries(volatilityMarkets)
        .filter(([_, data]) => data.type === 'OVER')
        .sort((a, b) => b[1].score - a[1].score);
      
      const underMarkets = Object.entries(volatilityMarkets)
        .filter(([_, data]) => data.type === 'UNDER')
        .sort((a, b) => b[1].score - a[1].score);
      
      const overBots = ['over3', 'over1'];
      overBots.forEach((botType, index) => {
        if (overMarkets[index]) {
          bestMarkets[botType] = overMarkets[index][0];
        }
      });
      
      const underBots = ['under6', 'under8'];
      underBots.forEach((botType, index) => {
        if (underMarkets[index]) {
          bestMarkets[botType] = underMarkets[index][0];
        }
      });
      
      const remainingMarkets = VOLATILITY_MARKETS.filter(m => 
        !Object.values(bestMarkets).includes(m) && marketDigitsRef.current[m]?.length >= 100
      );
      
      if (remainingMarkets.length >= 2) {
        bestMarkets['even'] = remainingMarkets[0];
        bestMarkets['odd'] = remainingMarkets[1];
      }
      
      setBots(prev => prev.map(bot => ({
        ...bot,
        selectedMarket: bestMarkets[bot.type] || bot.selectedMarket || Object.keys(marketDigitsRef.current)[0] || 'R_100'
      })));
      
      playScanSound();
      toast.success(`Scan complete! Found ${Object.keys(volatilityMarkets).length} volatile markets`);
      
      setAutoStartAll(true);
      
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
  }, [isScanning]);

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
    setScannedMarkets([]);
    setBestMarket(null);
    setBestScore(0);
    tradeIdRef.current = 0;
    toast.success('All data cleared');
  };

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

    let currentMarket = bot.selectedMarket;

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

      // Check for better market
      if (scannedMarkets.length > 0 && scannedMarkets[0].symbol !== currentMarket && scannedMarkets[0].score > bestScore) {
        currentMarket = scannedMarkets[0].symbol;
        setBestMarket(currentMarket);
        setBestScore(scannedMarkets[0].score);
        
        setBots(prev => prev.map(b => b.id === botId ? { 
          ...b, 
          selectedMarket: currentMarket
        } : b));
        
        toast.info(`${bot.name} switching to better market: ${currentMarket}`);
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
  }, [isAuthorized, balance, globalStake, globalMultiplier, globalStopLoss, globalTakeProfit, activeTradeId, bots, scannedMarkets, bestScore]);

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

  const getMarketDisplay = (market: string) => {
    if (market.startsWith('1HZ')) return `⚡ ${market}`;
    if (market.startsWith('R_')) return `📈 ${market}`;
    if (market.startsWith('BOOM')) return `💥 ${market}`;
    if (market.startsWith('CRASH')) return `📉 ${market}`;
    return market;
  };

  const totalProfit = bots.reduce((sum, bot) => sum + bot.totalPnl, 0);
  const totalTrades = bots.reduce((sum, bot) => sum + bot.trades, 0);
  const totalWins = bots.reduce((sum, bot) => sum + bot.wins, 0);
  const winRate = totalTrades > 0 ? ((totalWins / totalTrades) * 100).toFixed(1) : '0';

  const activeSignals = bots.filter(b => b.signal).length;

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      {/* Animated Dollar Background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        {[...Array(50)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute text-green-500/10"
            initial={{
              x: Math.random() * window.innerWidth,
              y: Math.random() * window.innerHeight,
              rotate: Math.random() * 360,
              scale: Math.random() * 0.5 + 0.5,
            }}
            animate={{
              y: [null, -100, window.innerHeight + 100],
              rotate: [null, Math.random() * 720, Math.random() * 360],
              opacity: [0.1, 0.3, 0.1],
            }}
            transition={{
              duration: Math.random() * 20 + 10,
              repeat: Infinity,
              ease: "linear",
              delay: Math.random() * 10,
            }}
          >
            <DollarSign className="w-12 h-12" />
          </motion.div>
        ))}
      </div>

      {/* Floating Dollar Icons Animation */}
      <div className="fixed inset-0 pointer-events-none">
        {[...Array(20)].map((_, i) => (
          <motion.div
            key={`float-${i}`}
            className="absolute"
            initial={{
              x: Math.random() * window.innerWidth,
              y: Math.random() * window.innerHeight,
            }}
            animate={{
              y: [null, Math.random() * -200, Math.random() * 200],
              x: [null, Math.random() * 100 - 50, Math.random() * 100 - 50],
              rotate: [0, 360],
              scale: [1, 1.2, 1],
            }}
            transition={{
              duration: Math.random() * 15 + 10,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          >
            <div className="text-yellow-500/5">
              <DollarSign className="w-16 h-16" />
            </div>
          </motion.div>
        ))}
      </div>

      {/* Main Content */}
      <div className="relative z-10 space-y-4 p-4">
        {/* Header with totals */}
        <motion.div 
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="bg-black/40 backdrop-blur-xl border border-green-500/20 rounded-xl p-4 shadow-2xl shadow-green-500/5"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <motion.div
                animate={{ rotate: [0, 360] }}
                transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
              >
                <DollarSign className="w-8 h-8 text-green-400" />
              </motion.div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-green-400 to-yellow-400 bg-clip-text text-transparent">
                🤖 6-Bot Auto Trading System
              </h1>
            </div>
            <div className="flex items-center gap-2">
              <motion.div
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                className="relative flex items-center cursor-pointer"
                onClick={scanMarket}
              >
                <motion.div
                  animate={isScanning ? {
                    rotate: 360,
                    scale: [1, 1.3, 1],
                  } : {}}
                  transition={isScanning ? {
                    rotate: { duration: 2, repeat: Infinity, ease: "linear" },
                    scale: { duration: 1, repeat: Infinity, ease: "easeInOut" }
                  } : {}}
                >
                  <DollarSign className={`w-8 h-8 ${isScanning ? 'text-yellow-400' : 'text-green-400'} drop-shadow-lg`} />
                </motion.div>
                {isScanning && (
                  <div className="absolute -top-1 -right-1">
                    <span className="animate-ping absolute inline-flex h-3 w-3 rounded-full bg-yellow-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-yellow-500"></span>
                  </div>
                )}
              </motion.div>
              
              <Select value={selectedMarketForScan} onValueChange={setSelectedMarketForScan}>
                <SelectTrigger className="w-[180px] h-8 bg-black/50 border-green-500/30 text-green-400">
                  <SelectValue placeholder="Select market" />
                </SelectTrigger>
                <SelectContent className="bg-black/90 border-green-500/30">
                  {VOLATILITY_MARKETS.map(market => (
                    <SelectItem key={market} value={market} className="text-green-400 hover:bg-green-500/20">
                      {getMarketDisplay(market)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              
              <Button 
                variant="outline" 
                size="sm" 
                onClick={scanMarket}
                disabled={isScanning}
                className="border-green-500/30 text-green-400 hover:bg-green-500/20"
              >
                {isScanning ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1" />}
                Scan Markets (20s)
              </Button>
              
              <Button 
                variant="destructive" 
                size="sm" 
                onClick={clearAll}
                className="bg-red-500/20 hover:bg-red-500/30 border-red-500/30"
              >
                <Trash2 className="w-4 h-4 mr-1" /> Clear
              </Button>
              
              <Button 
                variant="destructive" 
                size="sm" 
                onClick={stopAllBots} 
                disabled={!bots.some(b => b.isRunning)}
                className="bg-red-500/20 hover:bg-red-500/30 border-red-500/30"
              >
                <StopCircle className="w-4 h-4 mr-1" /> Stop All
              </Button>
            </div>
          </div>

          {/* Scan Progress Bar */}
          {isScanning && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-3"
            >
              <div className="flex justify-between text-xs text-green-400 mb-1">
                <span>🔍 Scanning markets for volatility...</span>
                <span>{Math.round(scanProgress)}%</span>
              </div>
              <div className="w-full h-2 bg-black/50 rounded-full overflow-hidden border border-green-500/30">
                <motion.div 
                  className="h-full bg-gradient-to-r from-green-400 via-yellow-400 to-green-400"
                  initial={{ width: 0 }}
                  animate={{ width: `${scanProgress}%` }}
                  transition={{ duration: 0.1 }}
                />
              </div>
            </motion.div>
          )}

          {/* Global Stats */}
          <div className="grid grid-cols-6 gap-3 text-sm">
            {[
              { label: 'Balance', value: `$${balance?.toFixed(2) || '0.00'}`, color: 'text-green-400' },
              { label: 'Total P&L', value: `$${totalProfit.toFixed(2)}`, color: totalProfit >= 0 ? 'text-green-400' : 'text-red-400' },
              { label: 'Win Rate', value: `${winRate}%`, color: 'text-yellow-400' },
              { label: 'Total Trades', value: totalTrades.toString(), color: 'text-blue-400' },
              { label: 'Active', value: `${bots.filter(b => b.isRunning).length}/6`, color: 'text-purple-400' },
              { label: 'Signals', value: activeSignals.toString(), color: 'text-yellow-400' },
            ].map((stat, i) => (
              <motion.div
                key={i}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: i * 0.1 }}
                className="bg-black/40 backdrop-blur border border-green-500/20 rounded-lg p-2"
              >
                <div className="text-green-400/60 text-xs">{stat.label}</div>
                <div className={`font-bold text-lg ${stat.color}`}>{stat.value}</div>
              </motion.div>
            ))}
          </div>

          {/* Settings */}
          <div className="grid grid-cols-4 gap-3 mt-3">
            {[
              { label: 'Stake ($)', value: globalStake, setter: setGlobalStake, step: '0.1', min: '0.1' },
              { label: 'Multiplier', value: globalMultiplier, setter: setGlobalMultiplier, step: '0.1', min: '1.1' },
              { label: 'Stop Loss ($)', value: globalStopLoss, setter: setGlobalStopLoss },
              { label: 'Take Profit ($)', value: globalTakeProfit, setter: setGlobalTakeProfit },
            ].map((setting, i) => (
              <div key={i} className="bg-black/40 backdrop-blur border border-green-500/20 rounded-lg p-2">
                <label className="text-xs text-green-400/60">{setting.label}</label>
                <input 
                  type="number" 
                  value={setting.value} 
                  onChange={(e) => setting.setter(parseFloat(e.target.value) || 0.5)}
                  className="w-full bg-black/50 border border-green-500/30 rounded-lg px-2 py-1 text-sm text-green-400 focus:outline-none focus:border-green-400"
                  step={setting.step}
                  min={setting.min}
                />
              </div>
            ))}
          </div>
        </motion.div>

        {/* Bots Grid */}
        <div className="grid grid-cols-3 gap-3">
          {bots.map((bot, index) => {
            const marketData = bot.selectedMarket ? marketAnalysis[bot.selectedMarket] : null;
            const marketSignal = bot.selectedMarket && marketSignals[bot.selectedMarket] 
              ? marketSignals[bot.selectedMarket][bot.type] 
              : false;
            
            return (
              <motion.div
                key={bot.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.1 }}
                className={`bg-black/40 backdrop-blur-xl border rounded-xl p-3 shadow-xl ${
                  bot.isRunning ? 'border-green-400 ring-2 ring-green-400/20' : 'border-green-500/20'
                } ${bot.signal ? 'ring-2 ring-yellow-500/50' : ''}`}
              >
                {/* Header */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <motion.div
                      animate={bot.isRunning ? { rotate: 360 } : {}}
                      transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                      className={`p-1.5 rounded-lg ${
                        bot.type === 'over3' || bot.type === 'over1' ? 'bg-blue-500/20 text-blue-400' :
                        bot.type === 'under6' || bot.type === 'under8' ? 'bg-orange-500/20 text-orange-400' :
                        bot.type === 'even' ? 'bg-green-500/20 text-green-400' :
                        'bg-purple-500/20 text-purple-400'
                      }`}
                    >
                      {bot.type.includes('over') ? <TrendingUp className="w-4 h-4" /> :
                       bot.type.includes('under') ? <TrendingDown className="w-4 h-4" /> :
                       <CircleDot className="w-4 h-4" />}
                    </motion.div>
                    <div>
                      <h4 className="font-bold text-sm text-green-400">{bot.name}</h4>
                      <p className="text-[9px] text-green-400/60">
                        {bot.contractType} {bot.barrier !== undefined ? `| B${bot.barrier}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {bot.signal && (
                      <Badge variant="default" className="bg-yellow-500/20 text-yellow-400 text-[8px] px-1 py-0 border-yellow-500/30">
                        SIGNAL
                      </Badge>
                    )}
                    <Badge variant={bot.isRunning ? "default" : "secondary"} className={`text-[9px] ${
                      bot.isRunning ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'
                    }`}>
                      {bot.isRunning ? (bot.isPaused ? '⏸️' : '▶️') : '⏹️'}
                    </Badge>
                  </div>
                </div>

                {/* Market & Analysis */}
                <div className="bg-black/40 backdrop-blur border border-green-500/20 rounded-lg p-2 mb-2 text-[10px]">
                  <div className="flex justify-between items-center">
                    <span className="text-green-400/60">Market:</span>
                    <span className="font-mono font-bold text-green-400">
                      {bot.selectedMarket ? getMarketDisplay(bot.selectedMarket) : '—'}
                    </span>
                  </div>
                  {marketData && (
                    <>
                      <div className="flex justify-between mt-1 text-green-400/80">
                        <span>Most: {marketData.mostAppearing}</span>
                        <span>2nd: {marketData.secondMost}</span>
                        <span>Least: {marketData.leastAppearing}</span>
                      </div>
                      {marketData.volatilityScore && (
                        <div className="flex justify-between mt-1 text-[8px]">
                          <span className="text-yellow-400">Volatility: {marketData.volatilityScore}/10</span>
                          {marketData.recommendedBot && (
                            <span className="text-green-400">Rec: {marketData.recommendedBot}</span>
                          )}
                        </div>
                      )}
                      <div className="flex justify-between mt-1 text-[8px]">
                        <span className="text-green-400/60">Last: {marketData.lastDigit}</span>
                        <span className="text-green-400/60">Prev: {marketData.previousDigit}</span>
                        <span className={marketSignal ? 'text-yellow-400 font-bold' : 'text-green-400/60'}>
                          Signal: {marketSignal ? '✅' : '❌'}
                        </span>
                      </div>
                    </>
                  )}
                </div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-1 text-[10px] mb-2">
                  <div>
                    <span className="text-green-400/60">P&L:</span>
                    <span className={`ml-1 font-mono ${
                      bot.totalPnl > 0 ? 'text-green-400' : bot.totalPnl < 0 ? 'text-red-400' : 'text-yellow-400'
                    }`}>
                      ${bot.totalPnl.toFixed(2)}
                    </span>
                  </div>
                  <div>
                    <span className="text-green-400/60">Wins:</span>
                    <span className="ml-1 font-mono text-green-400">{bot.wins}</span>
                  </div>
                  <div>
                    <span className="text-green-400/60">Losses:</span>
                    <span className="ml-1 font-mono text-red-400">{bot.losses}</span>
                  </div>
                </div>

                {/* Status */}
                <div className="flex items-center justify-between text-[9px] mb-2">
                  <span className="text-green-400/60">Status:</span>
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
                  <span className="text-green-400/60">Stake:</span>
                  <span className="font-mono text-green-400">${bot.currentStake.toFixed(2)}</span>
                </div>

                {/* Controls */}
                <div className="flex gap-1">
                  {!bot.isRunning ? (
                    <Button
                      onClick={() => startBot(bot.id)}
                      disabled={!isAuthorized || balance < globalStake || activeTradeId !== null || !bot.selectedMarket}
                      size="sm"
                      className="flex-1 h-7 text-xs bg-green-500/20 hover:bg-green-500/30 text-green-400 border border-green-500/30"
                    >
                      <Play className="w-3 h-3 mr-1" /> Start
                    </Button>
                  ) : (
                    <>
                      <Button
                        onClick={() => pauseBot(bot.id)}
                        size="sm"
                        variant="outline"
                        className="flex-1 h-7 text-xs border-green-500/30 text-green-400 hover:bg-green-500/20"
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
              </motion.div>
            );
          })}
        </div>

        {/* Live Signals Panel */}
        <motion.div 
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="bg-black/40 backdrop-blur-xl border border-green-500/20 rounded-xl p-3"
        >
          <h3 className="text-sm font-semibold mb-2 text-green-400 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-yellow-400" />
            📡 Live Signals - All Markets
            <Sparkles className="w-4 h-4 text-yellow-400" />
          </h3>
          <div className="grid grid-cols-4 gap-2 max-h-[200px] overflow-y-auto">
            {Object.entries(marketSignals).map(([market, signals]) => {
              const hasAnySignal = Object.values(signals).some(v => v);
              if (!hasAnySignal) return null;
              
              return (
                <motion.div 
                  key={market} 
                  whileHover={{ scale: 1.02 }}
                  className="bg-black/40 backdrop-blur border border-yellow-500/30 rounded-lg p-2 text-[10px]"
                >
                  <div className="font-bold mb-1 text-yellow-400">{getMarketDisplay(market)}</div>
                  <div className="grid grid-cols-2 gap-1">
                    {signals.over3 && <Badge className="bg-blue-500/20 text-blue-400 text-[8px] border-blue-500/30">OVER 3</Badge>}
                    {signals.under6 && <Badge className="bg-orange-500/20 text-orange-400 text-[8px] border-orange-500/30">UNDER 6</Badge>}
                    {signals.over1 && <Badge className="bg-blue-500/20 text-blue-400 text-[8px] border-blue-500/30">OVER 1</Badge>}
                    {signals.under8 && <Badge className="bg-orange-500/20 text-orange-400 text-[8px] border-orange-500/30">UNDER 8</Badge>}
                    {signals.even && <Badge className="bg-green-500/20 text-green-400 text-[8px] border-green-500/30">EVEN</Badge>}
                    {signals.odd && <Badge className="bg-purple-500/20 text-purple-400 text-[8px] border-purple-500/30">ODD</Badge>}
                  </div>
                </motion.div>
              );
            })}
            {Object.keys(marketSignals).length === 0 && (
              <p className="text-xs text-green-400/60 col-span-4 text-center py-2">
                🔍 No active signals. Click the dollar icon to scan.
              </p>
            )}
          </div>
        </motion.div>

        {/* Trade Log */}
        <motion.div 
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="bg-black/40 backdrop-blur-xl border border-green-500/20 rounded-xl p-3"
        >
          <h3 className="text-sm font-semibold mb-2 text-green-400">📋 Live Trade Log</h3>
          <div className="space-y-1 max-h-[300px] overflow-y-auto">
            {trades.length === 0 ? (
              <p className="text-xs text-green-400/60 text-center py-4">No trades yet</p>
            ) : (
              trades.map((trade, idx) => (
                <motion.div 
                  key={idx} 
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.02 }}
                  className="flex items-center justify-between text-xs py-1 border-b border-green-500/10 last:border-0"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-green-400/60">{trade.time}</span>
                    <Badge variant="outline" className="text-[8px] px-1 py-0 border-green-500/30 text-green-400">
                      {trade.bot}
                    </Badge>
                    <span className="font-mono text-[10px] text-green-400">
                      {trade.market.includes('1HZ') ? '⚡' : trade.market.includes('BOOM') ? '💥' : '📊'} {trade.market}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-[10px] text-green-400">
                      Last: {trade.lastDigit !== undefined ? trade.lastDigit : '—'}
                    </span>
                    <span className="font-mono text-green-400">${trade.stake.toFixed(2)}</span>
                    <span className={`font-mono w-16 text-right ${
                      trade.result === 'Win' ? 'text-green-400' : 
                      trade.result === 'Loss' ? 'text-red-400' : 'text-yellow-400'
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
        </motion.div>
      </div>
    </div>
  );
}
