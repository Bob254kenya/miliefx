import { useState, useRef, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { derivApi } from '@/services/deriv-api';
import { useAuth } from '@/contexts/AuthContext';
import { useTickLoader } from '@/hooks/useTickLoader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Play, StopCircle, Pause, TrendingUp, TrendingDown, CircleDot, RefreshCw, Trash2, DollarSign, Sparkles, Scan, Brain, Zap, Shield, Award, Target, Flame, ChevronRight, AlertCircle, CheckCircle2 } from 'lucide-react';

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
  aiConfidence?: number;
  patternStrength?: number;
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
  aiVolatilityScore?: number;
  aiRecommendedAction?: string;
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
  aiConfidence?: number;
}

const VOLATILITY_MARKETS = [
  'R_10', 'R_25', 'R_50', 'R_75', 'R_100',
  '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V',
  'BOOM300', 'BOOM500', 'BOOM1000',
  'CRASH300', 'CRASH500', 'CRASH1000',
  'RDBEAR', 'RDBULL', 'JD10', 'JD25', 'JD50', 'JD75', 'JD100'
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

// AI Volatility Analysis Engine
const analyzeWithAI = (digits: number[]): { volatilityScore: number; confidence: number; pattern: string; recommendation: string } => {
  if (digits.length < 700) {
    return { volatilityScore: 0, confidence: 0, pattern: 'Insufficient data', recommendation: 'NEUTRAL' };
  }
  
  const last700 = digits.slice(-700);
  const counts: Record<number, number> = {};
  for (let i = 0; i <= 9; i++) counts[i] = 0;
  last700.forEach(d => counts[d]++);
  
  // Calculate distribution patterns
  const distribution = Object.values(counts);
  const maxCount = Math.max(...distribution);
  const minCount = Math.min(...distribution);
  const avgCount = distribution.reduce((a, b) => a + b, 0) / distribution.length;
  const stdDev = Math.sqrt(distribution.map(x => Math.pow(x - avgCount, 2)).reduce((a, b) => a + b, 0) / distribution.length);
  
  // Detect streaks and patterns
  let maxStreak = 1;
  let currentStreak = 1;
  for (let i = 1; i < last700.length; i++) {
    if (last700[i] === last700[i-1]) {
      currentStreak++;
      maxStreak = Math.max(maxStreak, currentStreak);
    } else {
      currentStreak = 1;
    }
  }
  
  // Calculate volatility score based on multiple factors
  const distributionVolatility = (stdDev / avgCount) * 10;
  const streakVolatility = (maxStreak / 10) * 5;
  const rangeVolatility = ((maxCount - minCount) / 700) * 15;
  
  let volatilityScore = Math.min(10, (distributionVolatility + streakVolatility + rangeVolatility) / 3);
  
  // Determine pattern and recommendation
  let pattern = 'NEUTRAL';
  let recommendation = 'NEUTRAL';
  let confidence = 0;
  
  // AI pattern recognition
  const recentDigits = last700.slice(-100);
  const evenRecent = recentDigits.filter(d => d % 2 === 0).length / 100;
  const oddRecent = recentDigits.filter(d => d % 2 === 1).length / 100;
  const highRecent = recentDigits.filter(d => d > 5).length / 100;
  const lowRecent = recentDigits.filter(d => d < 5).length / 100;
  
  if (evenRecent > 0.65) {
    pattern = 'STRONG EVEN BIAS';
    recommendation = 'EVEN';
    confidence = Math.min(100, evenRecent * 100);
  } else if (oddRecent > 0.65) {
    pattern = 'STRONG ODD BIAS';
    recommendation = 'ODD';
    confidence = Math.min(100, oddRecent * 100);
  } else if (highRecent > 0.7) {
    pattern = 'HIGH NUMBER DOMINANCE';
    recommendation = 'OVER 3';
    confidence = Math.min(100, highRecent * 100);
  } else if (lowRecent > 0.7) {
    pattern = 'LOW NUMBER DOMINANCE';
    recommendation = 'UNDER 6';
    confidence = Math.min(100, lowRecent * 100);
  } else {
    // Check for extreme patterns
    const extremeLow = recentDigits.filter(d => d <= 1).length / 100;
    const extremeHigh = recentDigits.filter(d => d >= 8).length / 100;
    
    if (extremeLow > 0.4) {
      pattern = 'EXTREME LOW PATTERN';
      recommendation = 'OVER 1';
      confidence = Math.min(100, extremeLow * 100);
    } else if (extremeHigh > 0.4) {
      pattern = 'EXTREME HIGH PATTERN';
      recommendation = 'UNDER 8';
      confidence = Math.min(100, extremeHigh * 100);
    } else {
      pattern = 'RANDOM DISTRIBUTION';
      recommendation = 'NEUTRAL';
      confidence = 50;
    }
  }
  
  // Adjust volatility score based on confidence
  volatilityScore = volatilityScore * (confidence / 100);
  
  return {
    volatilityScore: Math.round(volatilityScore * 10) / 10,
    confidence: Math.round(confidence),
    pattern,
    recommendation
  };
};

// Play scanning sound with animation
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
  
  let volatilityScore = 0;
  let recommendedBot = '';
  
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
    recommendedBot
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
  const [aiAnalysis, setAiAnalysis] = useState<Record<string, { volatilityScore: number; confidence: number; pattern: string; recommendation: string }>>({});
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [globalStake, setGlobalStake] = useState<number>(0.5);
  const [globalMultiplier, setGlobalMultiplier] = useState<number>(2);
  const [globalStopLoss, setGlobalStopLoss] = useState<number>(30);
  const [globalTakeProfit, setGlobalTakeProfit] = useState<number>(5);
  const [selectedMarketForScan, setSelectedMarketForScan] = useState<string>('R_100');
  const [autoStartAll, setAutoStartAll] = useState(false);
  const [showAIPanel, setShowAIPanel] = useState(true);
  const [aiThinking, setAiThinking] = useState(false);
  
  const [trades, setTrades] = useState<TradeLog[]>([]);
  const tradeIdRef = useRef(0);
  const marketDigitsRef = useRef<Record<string, number[]>>({});
  const scanTimeoutRef = useRef<NodeJS.Timeout>();

  const { digits, prices, isLoading, tickCount } = useTickLoader(selectedMarketForScan, 1000);

  useEffect(() => {
    if (digits.length > 0) {
      marketDigitsRef.current[selectedMarketForScan] = digits;
      
      const signals = checkAllSignals(digits);
      setMarketSignals(prev => ({
        ...prev,
        [selectedMarketForScan]: signals
      }));

      // Run AI analysis
      const aiResult = analyzeWithAI(digits);
      setAiAnalysis(prev => ({
        ...prev,
        [selectedMarketForScan]: aiResult
      }));
    }
  }, [digits, selectedMarketForScan]);

  const [bots, setBots] = useState<BotState[]>([
    { 
      id: 'bot1', name: 'OVER 3 BOT', type: 'over3', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, contractType: 'DIGITOVER', barrier: 3,
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, cooldownRemaining: 0, recoveryMode: false,
      signal: false, aiVolatilityScore: 0, aiRecommendedAction: 'NEUTRAL'
    },
    { 
      id: 'bot2', name: 'UNDER 6 BOT', type: 'under6', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, contractType: 'DIGITUNDER', barrier: 6,
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, cooldownRemaining: 0, recoveryMode: false,
      signal: false, aiVolatilityScore: 0, aiRecommendedAction: 'NEUTRAL'
    },
    { 
      id: 'bot3', name: 'EVEN BOT', type: 'even', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, contractType: 'DIGITEVEN',
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, cooldownRemaining: 0, recoveryMode: false,
      signal: false, aiVolatilityScore: 0, aiRecommendedAction: 'NEUTRAL'
    },
    { 
      id: 'bot4', name: 'ODD BOT', type: 'odd', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, contractType: 'DIGITODD',
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, cooldownRemaining: 0, recoveryMode: false,
      signal: false, aiVolatilityScore: 0, aiRecommendedAction: 'NEUTRAL'
    },
    { 
      id: 'bot5', name: 'OVER 1 BOT', type: 'over1', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, contractType: 'DIGITOVER', barrier: 1,
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, cooldownRemaining: 0, recoveryMode: false,
      signal: false, aiVolatilityScore: 0, aiRecommendedAction: 'NEUTRAL'
    },
    { 
      id: 'bot6', name: 'UNDER 8 BOT', type: 'under8', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, contractType: 'DIGITUNDER', barrier: 8,
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, cooldownRemaining: 0, recoveryMode: false,
      signal: false, aiVolatilityScore: 0, aiRecommendedAction: 'NEUTRAL'
    },
  ]);

  const botRunningRefs = useRef<Record<string, boolean>>({});
  const botPausedRefs = useRef<Record<string, boolean>>({});

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
      if (bot.isRunning && bot.totalPnl > 0) {
        stopBot(bot.id);
        toast.success(`${bot.name} auto-stopped with +$${bot.totalPnl.toFixed(2)} profit!`);
      }
    });
  }, [bots]);

  const scanMarket = useCallback(async () => {
    if (isScanning) return;
    
    setIsScanning(true);
    setScanProgress(0);
    setAiThinking(true);
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
      const aiResults: Record<string, { volatilityScore: number; confidence: number; pattern: string; recommendation: string }> = {};
      const volatilityMarkets: Record<string, { score: number, type: string, aiScore: number }> = {};
      
      for (const market of VOLATILITY_MARKETS) {
        const marketDigits = marketDigitsRef.current[market] || [];
        if (marketDigits.length >= 700) {
          analysis[market] = analyzeMarket(marketDigits);
          analysis[market].symbol = market;
          
          signals[market] = checkAllSignals(marketDigits);
          
          // Run AI analysis
          const aiResult = analyzeWithAI(marketDigits);
          aiResults[market] = aiResult;
          
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
          
          // Combine with AI score
          const combinedScore = (volatilityScore + aiResult.volatilityScore) / 2;
          
          if (combinedScore > 5) {
            volatilityMarkets[market] = { 
              score: combinedScore, 
              type: recommendedType || aiResult.recommendation,
              aiScore: aiResult.confidence
            };
          }
        }
      }
      
      await new Promise(resolve => setTimeout(resolve, Math.max(0, duration - (Date.now() - startTime))));
      
      setMarketAnalysis(analysis);
      setMarketSignals(signals);
      setAiAnalysis(aiResults);
      
      // AI selects best markets based on volatility and confidence
      const bestMarkets: Record<string, string> = {};
      const aiOverMarkets = Object.entries(volatilityMarkets)
        .filter(([_, data]) => data.type.includes('OVER'))
        .sort((a, b) => (b[1].score * b[1].aiScore) - (a[1].score * a[1].aiScore));
      
      const aiUnderMarkets = Object.entries(volatilityMarkets)
        .filter(([_, data]) => data.type.includes('UNDER'))
        .sort((a, b) => (b[1].score * b[1].aiScore) - (a[1].score * a[1].aiScore));
      
      const aiEvenMarkets = Object.entries(volatilityMarkets)
        .filter(([_, data]) => data.type.includes('EVEN'))
        .sort((a, b) => (b[1].score * b[1].aiScore) - (a[1].score * a[1].aiScore));
      
      const aiOddMarkets = Object.entries(volatilityMarkets)
        .filter(([_, data]) => data.type.includes('ODD'))
        .sort((a, b) => (b[1].score * b[1].aiScore) - (a[1].score * a[1].aiScore));
      
      // Assign best markets to bots based on AI recommendation
      const overBots = ['over3', 'over1'];
      overBots.forEach((botType, index) => {
        if (aiOverMarkets[index]) {
          bestMarkets[botType] = aiOverMarkets[index][0];
        }
      });
      
      const underBots = ['under6', 'under8'];
      underBots.forEach((botType, index) => {
        if (aiUnderMarkets[index]) {
          bestMarkets[botType] = aiUnderMarkets[index][0];
        }
      });
      
      if (aiEvenMarkets[0]) {
        bestMarkets['even'] = aiEvenMarkets[0][0];
      }
      
      if (aiOddMarkets[0]) {
        bestMarkets['odd'] = aiOddMarkets[0][0];
      }
      
      // Update bots with AI-selected markets
      setBots(prev => prev.map(bot => {
        const market = bestMarkets[bot.type];
        const aiInfo = market ? aiResults[market] : null;
        return {
          ...bot,
          selectedMarket: market || bot.selectedMarket || Object.keys(marketDigitsRef.current)[0],
          aiVolatilityScore: aiInfo?.volatilityScore || 0,
          aiRecommendedAction: aiInfo?.recommendation || 'NEUTRAL'
        };
      }));
      
      playScanSound();
      setAiThinking(false);
      toast.success(`🤖 AI Scan complete! Found ${Object.keys(volatilityMarkets).length} high-probability markets`);
      
      // Auto-start all ready markets after scan
      setAutoStartAll(true);
      
    } catch (error) {
      console.error('Scan error:', error);
      toast.error('AI Scan failed');
    } finally {
      setIsScanning(false);
      setScanProgress(100);
      setAiThinking(false);
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
      signal: false,
      aiVolatilityScore: 0,
      aiRecommendedAction: 'NEUTRAL'
    })));
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
          signalType: bot.type,
          aiConfidence: bot.aiVolatilityScore
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
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-gray-900 via-indigo-900 to-purple-900 font-sans">
      {/* Animated Background Elements */}
      <div className="fixed inset-0 pointer-events-none">
        {/* Gradient Orbs */}
        <motion.div
          className="absolute top-0 left-0 w-[500px] h-[500px] bg-purple-500/20 rounded-full blur-3xl"
          animate={{
            x: [0, 100, 0],
            y: [0, 50, 0],
          }}
          transition={{
            duration: 20,
            repeat: Infinity,
            ease: "linear"
          }}
        />
        <motion.div
          className="absolute bottom-0 right-0 w-[600px] h-[600px] bg-emerald-500/20 rounded-full blur-3xl"
          animate={{
            x: [0, -100, 0],
            y: [0, -50, 0],
          }}
          transition={{
            duration: 25,
            repeat: Infinity,
            ease: "linear"
          }}
        />
        
        {/* Floating Particles */}
        {[...Array(30)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-1 h-1 bg-white/20 rounded-full"
            initial={{
              x: Math.random() * window.innerWidth,
              y: Math.random() * window.innerHeight,
            }}
            animate={{
              y: [null, Math.random() * -200, Math.random() * 200],
              x: [null, Math.random() * 100 - 50, Math.random() * 100 - 50],
              opacity: [0.2, 0.5, 0.2],
            }}
            transition={{
              duration: Math.random() * 10 + 10,
              repeat: Infinity,
              ease: "linear",
            }}
          />
        ))}
      </div>

      {/* Main Content */}
      <div className="relative z-10 space-y-4 p-4 max-w-[1920px] mx-auto">
        {/* Header Section */}
        <motion.div 
          initial={{ y: -50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="relative"
        >
          {/* Main Header Card */}
          <div className="bg-black/40 backdrop-blur-xl border border-emerald-500/30 rounded-2xl p-6 shadow-2xl shadow-emerald-500/10">
            {/* Title Row */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-4">
                <motion.div
                  animate={{ 
                    rotate: 360,
                    scale: [1, 1.2, 1],
                  }}
                  transition={{ 
                    rotate: { duration: 20, repeat: Infinity, ease: "linear" },
                    scale: { duration: 2, repeat: Infinity, ease: "easeInOut" }
                  }}
                  className="relative"
                >
                  <div className="absolute inset-0 bg-emerald-500/30 blur-xl rounded-full" />
                  <Brain className="w-10 h-10 text-emerald-400 relative z-10" />
                </motion.div>
                <div>
                  <h1 className="text-3xl font-black bg-gradient-to-r from-emerald-400 via-yellow-400 to-emerald-400 bg-clip-text text-transparent">
                    🤖 AI-POWERED AUTO TRADING SYSTEM
                  </h1>
                  <p className="text-emerald-400/60 text-sm mt-1 flex items-center gap-2">
                    <Zap className="w-4 h-4 text-yellow-400" />
                    6 Advanced Bots with Neural Network Analysis
                    <Zap className="w-4 h-4 text-yellow-400" />
                  </p>
                </div>
              </div>

              {/* Right Header Buttons */}
              <div className="flex items-center gap-3">
                {/* AI Panel Toggle Button */}
                <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                  <Button
                    onClick={() => setShowAIPanel(!showAIPanel)}
                    className={`relative px-4 py-2 rounded-xl font-bold transition-all duration-300 ${
                      showAIPanel 
                        ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-lg shadow-purple-500/30' 
                        : 'bg-black/40 text-purple-400 border border-purple-500/30 hover:bg-purple-500/20'
                    }`}
                  >
                    <Brain className="w-4 h-4 mr-2" />
                    {showAIPanel ? 'AI ACTIVE' : 'SHOW AI'}
                  </Button>
                </motion.div>

                {/* Clear Button */}
                <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                  <Button 
                    variant="destructive" 
                    onClick={clearAll}
                    className="bg-rose-500/20 hover:bg-rose-500/30 border-rose-500/30 text-rose-400 rounded-xl px-4 py-2"
                  >
                    <Trash2 className="w-4 h-4 mr-2" /> Clear All
                  </Button>
                </motion.div>

                {/* Stop All Button */}
                <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                  <Button 
                    variant="destructive" 
                    onClick={stopAllBots} 
                    disabled={!bots.some(b => b.isRunning)}
                    className="bg-rose-500/20 hover:bg-rose-500/30 border-rose-500/30 text-rose-400 rounded-xl px-4 py-2"
                  >
                    <StopCircle className="w-4 h-4 mr-2" /> Stop All
                  </Button>
                </motion.div>
              </div>
            </div>

            {/* SCANNER SECTION - CENTERED AND HIGHLIGHTED */}
            <div className="flex flex-col items-center mb-8">
              <motion.div
                initial={{ scale: 0.9 }}
                animate={{ scale: 1 }}
                transition={{ duration: 0.5, repeat: Infinity, repeatType: "reverse" }}
                className="relative mb-4"
              >
                <div className="absolute inset-0 bg-gradient-to-r from-emerald-500 to-yellow-500 rounded-full blur-xl opacity-50" />
                <div className="relative bg-black/60 backdrop-blur-xl rounded-full p-1 border-2 border-emerald-500/50">
                  <Button
                    onClick={scanMarket}
                    disabled={isScanning}
                    size="lg"
                    className="relative px-12 py-8 text-2xl font-black bg-gradient-to-r from-emerald-600 via-emerald-500 to-yellow-500 hover:from-emerald-700 hover:via-emerald-600 hover:to-yellow-600 text-white rounded-full shadow-2xl"
                  >
                    {isScanning ? (
                      <>
                        <Loader2 className="w-8 h-8 mr-3 animate-spin" />
                        AI SCANNING... {Math.round(scanProgress)}%
                      </>
                    ) : (
                      <>
                        <Scan className="w-8 h-8 mr-3 animate-pulse" />
                        START AI MARKET SCAN (20s)
                      </>
                    )}
                  </Button>
                </div>
              </motion.div>

              {/* Market Selector Button */}
              <motion.div whileHover={{ scale: 1.02 }} className="flex gap-2">
                <Select value={selectedMarketForScan} onValueChange={setSelectedMarketForScan}>
                  <SelectTrigger className="w-[250px] h-12 bg-black/50 border-emerald-500/30 text-emerald-400 rounded-xl">
                    <SelectValue placeholder="Select market to monitor" />
                  </SelectTrigger>
                  <SelectContent className="bg-black/90 border-emerald-500/30 rounded-xl">
                    {VOLATILITY_MARKETS.map(market => (
                      <SelectItem key={market} value={market} className="text-emerald-400 hover:bg-emerald-500/20">
                        {getMarketDisplay(market)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </motion.div>

              {/* Scan Progress Bar */}
              <AnimatePresence>
                {isScanning && (
                  <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    className="w-full max-w-2xl mt-4"
                  >
                    <div className="flex justify-between text-sm text-emerald-400 mb-2">
                      <span className="flex items-center gap-2">
                        <Brain className="w-4 h-4 animate-pulse" />
                        AI Neural Network Analyzing...
                      </span>
                      <span className="font-mono">{Math.round(scanProgress)}%</span>
                    </div>
                    <div className="w-full h-4 bg-black/50 rounded-full overflow-hidden border border-emerald-500/30">
                      <motion.div 
                        className="h-full bg-gradient-to-r from-emerald-400 via-yellow-400 to-purple-400"
                        style={{ width: `${scanProgress}%` }}
                        initial={{ width: 0 }}
                        animate={{ width: `${scanProgress}%` }}
                        transition={{ duration: 0.1 }}
                      />
                    </div>
                    {aiThinking && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="mt-2 text-center text-purple-400 text-sm flex items-center justify-center gap-2"
                      >
                        <Loader2 className="w-3 h-3 animate-spin" />
                        AI calculating optimal volatility patterns...
                      </motion.div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Global Stats Grid */}
            <div className="grid grid-cols-6 gap-4">
              {[
                { 
                  icon: <DollarSign className="w-5 h-5" />,
                  label: 'Balance', 
                  value: `$${balance?.toFixed(2) || '0.00'}`, 
                  color: 'text-emerald-400',
                  bg: 'from-emerald-500/20 to-emerald-500/5'
                },
                { 
                  icon: <TrendingUp className="w-5 h-5" />,
                  label: 'Total P&L', 
                  value: `$${totalProfit.toFixed(2)}`, 
                  color: totalProfit >= 0 ? 'text-emerald-400' : 'text-rose-400',
                  bg: totalProfit >= 0 ? 'from-emerald-500/20 to-emerald-500/5' : 'from-rose-500/20 to-rose-500/5'
                },
                { 
                  icon: <Award className="w-5 h-5" />,
                  label: 'Win Rate', 
                  value: `${winRate}%`, 
                  color: 'text-yellow-400',
                  bg: 'from-yellow-500/20 to-yellow-500/5'
                },
                { 
                  icon: <Target className="w-5 h-5" />,
                  label: 'Total Trades', 
                  value: totalTrades.toString(), 
                  color: 'text-blue-400',
                  bg: 'from-blue-500/20 to-blue-500/5'
                },
                { 
                  icon: <Zap className="w-5 h-5" />,
                  label: 'Active', 
                  value: `${bots.filter(b => b.isRunning).length}/6`, 
                  color: 'text-purple-400',
                  bg: 'from-purple-500/20 to-purple-500/5'
                },
                { 
                  icon: <Flame className="w-5 h-5" />,
                  label: 'Signals', 
                  value: activeSignals.toString(), 
                  color: 'text-yellow-400',
                  bg: 'from-yellow-500/20 to-yellow-500/5'
                },
              ].map((stat, i) => (
                <motion.div
                  key={i}
                  initial={{ scale: 0, rotate: -10 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ delay: i * 0.1, type: "spring" }}
                  className={`bg-gradient-to-br ${stat.bg} backdrop-blur border border-emerald-500/20 rounded-xl p-4 shadow-lg`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <div className={`${stat.color}`}>{stat.icon}</div>
                    <div className={`text-xs ${stat.color}/60 font-medium`}>{stat.label}</div>
                  </div>
                  <div className={`font-black text-2xl font-mono ${stat.color}`}>{stat.value}</div>
                </motion.div>
              ))}
            </div>

            {/* Settings Grid */}
            <div className="grid grid-cols-4 gap-4 mt-4">
              {[
                { icon: <DollarSign className="w-4 h-4" />, label: 'Stake ($)', value: globalStake, setter: setGlobalStake, step: '0.1', min: '0.1', color: 'emerald' },
                { icon: <RefreshCw className="w-4 h-4" />, label: 'Multiplier', value: globalMultiplier, setter: setGlobalMultiplier, step: '0.1', min: '1.1', color: 'blue' },
                { icon: <Shield className="w-4 h-4" />, label: 'Stop Loss ($)', value: globalStopLoss, setter: setGlobalStopLoss, step: '1', min: '1', color: 'rose' },
                { icon: <Award className="w-4 h-4" />, label: 'Take Profit ($)', value: globalTakeProfit, setter: setGlobalTakeProfit, step: '1', min: '1', color: 'yellow' },
              ].map((setting, i) => (
                <motion.div
                  key={i}
                  whileHover={{ scale: 1.02 }}
                  className="bg-black/40 backdrop-blur border border-emerald-500/20 rounded-xl p-3"
                >
                  <label className={`flex items-center gap-1 text-xs text-${setting.color}-400/60 font-medium mb-1`}>
                    {setting.icon}
                    {setting.label}
                  </label>
                  <input 
                    type="number" 
                    value={setting.value} 
                    onChange={(e) => setting.setter(parseFloat(e.target.value) || 0.5)}
                    className={`w-full bg-black/50 border border-${setting.color}-500/30 rounded-lg px-3 py-2 text-sm text-${setting.color}-400 focus:outline-none focus:border-${setting.color}-400 font-mono`}
                    step={setting.step}
                    min={setting.min}
                  />
                </motion.div>
              ))}
            </div>
          </div>
        </motion.div>

        {/* AI Analysis Panel */}
        <AnimatePresence>
          {showAIPanel && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="bg-gradient-to-r from-purple-900/40 via-indigo-900/40 to-purple-900/40 backdrop-blur-xl border border-purple-500/30 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Brain className="w-5 h-5 text-purple-400" />
                  <h3 className="text-sm font-semibold text-purple-400">🤖 AI NEURAL NETWORK ANALYSIS</h3>
                  <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30">LIVE</Badge>
                </div>
                <div className="grid grid-cols-4 gap-3">
                  {Object.entries(aiAnalysis).slice(0, 8).map(([market, data]) => (
                    <motion.div
                      key={market}
                      whileHover={{ scale: 1.02 }}
                      className="bg-black/40 backdrop-blur border border-purple-500/30 rounded-lg p-2"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold text-purple-400">{getMarketDisplay(market)}</span>
                        <Badge className={`text-[8px] px-1 py-0 ${
                          data.confidence > 80 ? 'bg-emerald-500/20 text-emerald-400' :
                          data.confidence > 60 ? 'bg-yellow-500/20 text-yellow-400' :
                          'bg-purple-500/20 text-purple-400'
                        }`}>
                          {data.confidence}%
                        </Badge>
                      </div>
                      <div className="flex items-center gap-1 text-[8px]">
                        <span className="text-purple-400/60">Vol:</span>
                        <span className="font-mono text-purple-400">{data.volatilityScore.toFixed(1)}</span>
                        <span className="text-purple-400/60 ml-1">Pat:</span>
                        <span className="font-mono text-purple-400 truncate">{data.pattern}</span>
                      </div>
                      <div className="text-[8px] mt-1">
                        <span className="text-purple-400/60">AI Rec: </span>
                        <span className={`font-bold ${
                          data.recommendation.includes('OVER') ? 'text-blue-400' :
                          data.recommendation.includes('UNDER') ? 'text-orange-400' :
                          data.recommendation === 'EVEN' ? 'text-emerald-400' :
                          data.recommendation === 'ODD' ? 'text-purple-400' :
                          'text-yellow-400'
                        }`}>
                          {data.recommendation}
                        </span>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Bots Grid */}
        <div className="grid grid-cols-3 gap-4">
          {bots.map((bot, index) => {
            const marketData = bot.selectedMarket ? marketAnalysis[bot.selectedMarket] : null;
            const marketSignal = bot.selectedMarket && marketSignals[bot.selectedMarket] 
              ? marketSignals[bot.selectedMarket][bot.type] 
              : false;
            const aiData = bot.selectedMarket ? aiAnalysis[bot.selectedMarket] : null;
            
            return (
              <motion.div
                key={bot.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
                whileHover={{ scale: 1.02 }}
                className={`relative bg-gradient-to-br from-gray-900/90 to-gray-800/90 backdrop-blur-xl border rounded-xl p-4 shadow-xl overflow-hidden ${
                  bot.isRunning ? 'border-emerald-400 ring-2 ring-emerald-400/20' : 
                  bot.signal ? 'border-yellow-400 ring-2 ring-yellow-400/20' : 
                  'border-emerald-500/20'
                }`}
              >
                {/* Background Glow */}
                <motion.div
                  className="absolute inset-0 bg-gradient-to-r from-emerald-500/5 to-purple-500/5"
                  animate={{
                    opacity: bot.isRunning ? [0.3, 0.5, 0.3] : 0.1,
                  }}
                  transition={{ duration: 2, repeat: Infinity }}
                />

                {/* Header */}
                <div className="relative z-10 flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <motion.div
                      animate={bot.isRunning ? { 
                        rotate: 360,
                        scale: [1, 1.2, 1],
                      } : {}}
                      transition={{ 
                        rotate: { duration: 3, repeat: Infinity, ease: "linear" },
                        scale: { duration: 2, repeat: Infinity }
                      }}
                      className={`p-2.5 rounded-xl ${
                        bot.type === 'over3' || bot.type === 'over1' ? 'bg-blue-500/20 text-blue-400' :
                        bot.type === 'under6' || bot.type === 'under8' ? 'bg-orange-500/20 text-orange-400' :
                        bot.type === 'even' ? 'bg-emerald-500/20 text-emerald-400' :
                        'bg-purple-500/20 text-purple-400'
                      }`}
                    >
                      {bot.type.includes('over') ? <TrendingUp className="w-5 h-5" /> :
                       bot.type.includes('under') ? <TrendingDown className="w-5 h-5" /> :
                       <CircleDot className="w-5 h-5" />}
                    </motion.div>
                    <div>
                      <h4 className="font-bold text-base text-emerald-400">{bot.name}</h4>
                      <p className="text-[10px] text-emerald-400/60 font-mono">
                        {bot.contractType} {bot.barrier !== undefined ? `| B${bot.barrier}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {bot.signal && (
                      <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ type: "spring" }}
                      >
                        <Badge className="bg-yellow-500/20 text-yellow-400 text-[9px] px-2 py-0.5 border-yellow-500/30 font-bold">
                          SIGNAL
                        </Badge>
                      </motion.div>
                    )}
                    <Badge className={`text-[9px] font-mono ${
                      bot.isRunning ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-500/20 text-gray-400'
                    }`}>
                      {bot.isRunning ? (bot.isPaused ? '⏸️ PAUSED' : '▶️ RUNNING') : '⏹️ STOPPED'}
                    </Badge>
                  </div>
                </div>

                {/* AI Score Badge */}
                {bot.aiVolatilityScore && bot.aiVolatilityScore > 0 && (
                  <motion.div
                    initial={{ x: -100 }}
                    animate={{ x: 0 }}
                    className="absolute top-2 right-2"
                  >
                    <Badge className="bg-purple-500/20 text-purple-400 text-[8px] border-purple-500/30">
                      AI: {bot.aiVolatilityScore.toFixed(1)}
                    </Badge>
                  </motion.div>
                )}

                {/* Market & Analysis */}
                <div className="relative z-10 bg-black/40 backdrop-blur border border-emerald-500/20 rounded-lg p-2 mb-2 text-[10px]">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-emerald-400/60 font-medium">Market:</span>
                    <span className="font-mono font-bold text-emerald-400">
                      {bot.selectedMarket ? getMarketDisplay(bot.selectedMarket) : '—'}
                    </span>
                  </div>
                  
                  {marketData && (
                    <>
                      <div className="flex justify-between text-emerald-400/80 font-mono">
                        <span>Most: {marketData.mostAppearing}</span>
                        <span>2nd: {marketData.secondMost}</span>
                        <span>Least: {marketData.leastAppearing}</span>
                      </div>
                      
                      {/* AI Analysis */}
                      {aiData && (
                        <div className="mt-1 pt-1 border-t border-purple-500/20">
                          <div className="flex justify-between text-[8px]">
                            <span className="text-purple-400 flex items-center gap-1">
                              <Brain className="w-3 h-3" />
                              AI: {aiData.pattern}
                            </span>
                            <span className={`font-bold ${
                              aiData.recommendation === bot.type.toUpperCase() ? 'text-emerald-400' : 'text-purple-400/60'
                            }`}>
                              Rec: {aiData.recommendation}
                            </span>
                          </div>
                          <div className="flex justify-between mt-1">
                            <span className="text-purple-400/60">Confidence:</span>
                            <div className="w-16 h-1.5 bg-black/50 rounded-full overflow-hidden">
                              <motion.div
                                className="h-full bg-purple-400"
                                initial={{ width: 0 }}
                                animate={{ width: `${aiData.confidence}%` }}
                                transition={{ duration: 1 }}
                              />
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="flex justify-between mt-1 text-[8px]">
                        <span className="text-emerald-400/60 font-mono">Last: {marketData.lastDigit}</span>
                        <span className="text-emerald-400/60 font-mono">Prev: {marketData.previousDigit}</span>
                        <span className={marketSignal ? 'text-yellow-400 font-bold' : 'text-emerald-400/60'}>
                          Signal: {marketSignal ? '✅' : '❌'}
                        </span>
                      </div>
                    </>
                  )}
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-3 gap-1 text-[10px] mb-2">
                  <div className="bg-black/20 rounded p-1">
                    <span className="text-emerald-400/60 block">P&L</span>
                    <span className={`font-mono font-bold ${
                      bot.totalPnl > 0 ? 'text-emerald-400' : bot.totalPnl < 0 ? 'text-rose-400' : 'text-yellow-400'
                    }`}>
                      ${bot.totalPnl.toFixed(2)}
                    </span>
                  </div>
                  <div className="bg-black/20 rounded p-1">
                    <span className="text-emerald-400/60 block">W/L</span>
                    <span className="font-mono text-emerald-400">{bot.wins}</span>
                    <span className="font-mono text-rose-400 ml-1">/{bot.losses}</span>
                  </div>
                  <div className="bg-black/20 rounded p-1">
                    <span className="text-emerald-400/60 block">Win%</span>
                    <span className="font-mono text-yellow-400">
                      {bot.trades > 0 ? ((bot.wins / bot.trades) * 100).toFixed(0) : 0}%
                    </span>
                  </div>
                </div>

                {/* Status Bar */}
                <div className="flex items-center justify-between text-[9px] mb-2 bg-black/20 rounded p-1">
                  <span className="text-emerald-400/60">Status:</span>
                  <span className={`font-mono flex items-center gap-1 ${
                    bot.status === 'trading' ? 'text-emerald-400' :
                    bot.status === 'waiting' ? 'text-yellow-400' :
                    bot.status === 'cooldown' ? 'text-purple-400' :
                    'text-gray-400'
                  }`}>
                    {bot.status === 'trading' && <><Zap className="w-3 h-3" /> TRADING</>}
                    {bot.status === 'waiting' && <><Loader2 className="w-3 h-3 animate-spin" /> WAITING</>}
                    {bot.status === 'cooldown' && <><Shield className="w-3 h-3" /> COOLDOWN {bot.cooldownRemaining}</>}
                    {bot.status === 'idle' && <>⚫ IDLE</>}
                  </span>
                  <span className="text-emerald-400/60">Stake:</span>
                  <span className="font-mono text-emerald-400">${bot.currentStake.toFixed(2)}</span>
                </div>

                {/* Control Buttons */}
                <div className="relative z-10 flex gap-2">
                  {!bot.isRunning ? (
                    <motion.div className="flex-1" whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                      <Button
                        onClick={() => startBot(bot.id)}
                        disabled={!isAuthorized || balance < globalStake || activeTradeId !== null || !bot.selectedMarket}
                        className="w-full h-8 text-xs bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-700 hover:to-emerald-600 text-white rounded-lg font-bold"
                      >
                        <Play className="w-3 h-3 mr-1" /> START
                      </Button>
                    </motion.div>
                  ) : (
                    <>
                      <motion.div className="flex-1" whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                        <Button
                          onClick={() => pauseBot(bot.id)}
                          className={`w-full h-8 text-xs rounded-lg font-bold ${
                            bot.isPaused 
                              ? 'bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-700 hover:to-emerald-600 text-white' 
                              : 'bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-400 border border-yellow-500/30'
                          }`}
                        >
                          <Pause className="w-3 h-3 mr-1" /> {bot.isPaused ? 'RESUME' : 'PAUSE'}
                        </Button>
                      </motion.div>
                      <motion.div className="flex-1" whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                        <Button
                          onClick={() => stopBot(bot.id)}
                          className="w-full h-8 text-xs bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 border border-rose-500/30 rounded-lg font-bold"
                        >
                          <StopCircle className="w-3 h-3 mr-1" /> STOP
                        </Button>
                      </motion.div>
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
          className="bg-black/40 backdrop-blur-xl border border-emerald-500/20 rounded-xl p-4"
        >
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-emerald-400 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-yellow-400" />
              📡 LIVE SIGNALS - ALL MARKETS
            </h3>
            <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
              {Object.keys(marketSignals).length} Markets
            </Badge>
          </div>
          
          <div className="grid grid-cols-5 gap-2 max-h-[250px] overflow-y-auto">
            {Object.entries(marketSignals).map(([market, signals]) => {
              const hasAnySignal = Object.values(signals).some(v => v);
              if (!hasAnySignal) return null;
              const aiInfo = aiAnalysis[market];
              
              return (
                <motion.div 
                  key={market} 
                  whileHover={{ scale: 1.02 }}
                  className="bg-gradient-to-br from-black/60 to-black/40 backdrop-blur border border-yellow-500/30 rounded-lg p-2"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-xs text-yellow-400">{getMarketDisplay(market)}</span>
                    {aiInfo && (
                      <Badge className="bg-purple-500/20 text-purple-400 text-[7px] border-purple-500/30">
                        AI:{aiInfo.confidence}%
                      </Badge>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    {signals.over3 && <Badge className="bg-blue-500/20 text-blue-400 text-[7px] border-blue-500/30">OVER 3</Badge>}
                    {signals.under6 && <Badge className="bg-orange-500/20 text-orange-400 text-[7px] border-orange-500/30">UNDER 6</Badge>}
                    {signals.over1 && <Badge className="bg-blue-500/20 text-blue-400 text-[7px] border-blue-500/30">OVER 1</Badge>}
                    {signals.under8 && <Badge className="bg-orange-500/20 text-orange-400 text-[7px] border-orange-500/30">UNDER 8</Badge>}
                    {signals.even && <Badge className="bg-emerald-500/20 text-emerald-400 text-[7px] border-emerald-500/30">EVEN</Badge>}
                    {signals.odd && <Badge className="bg-purple-500/20 text-purple-400 text-[7px] border-purple-500/30">ODD</Badge>}
                  </div>
                </motion.div>
              );
            })}
            {Object.keys(marketSignals).length === 0 && (
              <motion.p 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-sm text-emerald-400/60 col-span-5 text-center py-4"
              >
                🔍 No active signals. Click the AI SCAN button to analyze markets.
              </motion.p>
            )}
          </div>
        </motion.div>

        {/* Trade Log */}
        <motion.div 
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="bg-black/40 backdrop-blur-xl border border-emerald-500/20 rounded-xl p-4"
        >
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-emerald-400">📋 LIVE TRADE LOG</h3>
            <div className="flex gap-2">
              <Badge className="bg-emerald-500/20 text-emerald-400">Total: {trades.length}</Badge>
              <Badge className="bg-emerald-500/20 text-emerald-400">Wins: {trades.filter(t => t.result === 'Win').length}</Badge>
              <Badge className="bg-rose-500/20 text-rose-400">Losses: {trades.filter(t => t.result === 'Loss').length}</Badge>
            </div>
          </div>
          
          <div className="space-y-1 max-h-[300px] overflow-y-auto">
            <AnimatePresence>
              {trades.length === 0 ? (
                <motion.p 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-sm text-emerald-400/60 text-center py-4"
                >
                  No trades yet. Start trading to see results.
                </motion.p>
              ) : (
                trades.map((trade, idx) => (
                  <motion.div 
                    key={idx} 
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    transition={{ delay: idx * 0.02 }}
                    className="flex items-center justify-between text-xs py-2 px-2 border-b border-emerald-500/10 last:border-0 hover:bg-emerald-500/5 rounded"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-emerald-400/60 font-mono w-16">{trade.time}</span>
                      <Badge className="text-[8px] px-1.5 py-0.5 bg-purple-500/20 text-purple-400 border-purple-500/30 font-mono">
                        {trade.bot}
                      </Badge>
                      <span className="font-mono text-[9px] text-emerald-400">
                        {trade.market.includes('1HZ') ? '⚡' : trade.market.includes('BOOM') ? '💥' : '📊'} {trade.market}
                      </span>
                      {trade.aiConfidence && (
                        <Badge className="bg-purple-500/20 text-purple-400 text-[7px] border-purple-500/30">
                          AI:{trade.aiConfidence}%
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="font-mono text-[9px] text-emerald-400">
                        Last: {trade.lastDigit !== undefined ? trade.lastDigit : '—'}
                      </span>
                      <span className="font-mono text-emerald-400 w-16">${trade.stake.toFixed(2)}</span>
                      <span className={`font-mono w-20 text-right flex items-center gap-1 ${
                        trade.result === 'Win' ? 'text-emerald-400' : 
                        trade.result === 'Loss' ? 'text-rose-400' : 'text-yellow-400'
                      }`}>
                        {trade.result === 'Win' && <CheckCircle2 className="w-3 h-3" />}
                        {trade.result === 'Loss' && <AlertCircle className="w-3 h-3" />}
                        {trade.result === 'Win' ? `+$${trade.pnl.toFixed(2)}` : 
                         trade.result === 'Loss' ? `-$${Math.abs(trade.pnl).toFixed(2)}` : 
                         '⏳ PENDING'}
                      </span>
                    </div>
                  </motion.div>
                ))
              )}
            </AnimatePresence>
          </div>
        </motion.div>

        {/* Footer */}
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center text-[10px] text-emerald-400/40 py-2"
        >
          🤖 AI-Powered Trading System v2.0 • Neural Network Active • Real-time Market Analysis
        </motion.div>
      </div>
    </div>
  );
  }
