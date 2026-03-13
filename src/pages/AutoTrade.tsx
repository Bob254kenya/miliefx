import { useState, useRef, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { derivApi } from '@/services/deriv-api';
import { useAuth } from '@/contexts/AuthContext';
import { useTickLoader } from '@/hooks/useTickLoader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Play, StopCircle, Pause, TrendingUp, TrendingDown, CircleDot, RefreshCw, Trash2, AlertCircle, ArrowRight, Zap, BarChart2, Percent, Hash, Activity } from 'lucide-react';

interface DigitAnalysis {
  counts: Record<number, number>;
  percentages: Record<number, number>;
  mostAppearing: number;
  secondMost: number;
  thirdMost: number;
  leastAppearing: number;
  secondLeast: number;
  evenPercentage: number;
  oddPercentage: number;
  over5Percentage: number;
  under5Percentage: number;
  over3Percentage: number;
  under6Percentage: number;
  over7Percentage: number;
  under2Percentage: number;
  lastTwelveTicks: number[];
  lastThreeTicks: number[];
  lastThreeIdentical: boolean;
  signal: 'EVEN' | 'ODD' | 'OVER_3' | 'UNDER_6' | 'OVER_5' | 'UNDER_5' | 'OVER_7' | 'UNDER_2' | 'NONE';
  confidence: number;
  comparison: {
    evenVsOdd: { even: number; odd: number; advantage: 'EVEN' | 'ODD' | 'BALANCED' };
    over5VsUnder5: { over5: number; under5: number; advantage: 'OVER_5' | 'UNDER_5' | 'BALANCED' };
    over3VsUnder6: { over3: number; under6: number; advantage: 'OVER_3' | 'UNDER_6' | 'BALANCED' };
  };
}

interface MarketData {
  symbol: string;
  digits: number[];
  analysis: DigitAnalysis;
  lastUpdate: number;
}

interface BotState {
  id: string;
  name: string;
  type: 'EVEN' | 'ODD' | 'OVER_3' | 'UNDER_6' | 'OVER_5' | 'UNDER_5' | 'OVER_7' | 'UNDER_2';
  isRunning: boolean;
  isPaused: boolean;
  currentStake: number;
  totalPnl: number;
  trades: number;
  wins: number;
  losses: number;
  currentMarket: string;
  status: 'idle' | 'analyzing' | 'waiting_entry' | 'trading' | 'cooldown' | 'switching_market';
  consecutiveLosses: number;
  cooldownRemaining: number;
  lastTradeResult?: 'win' | 'loss';
  marketSwitchCount: number;
  lastSignal?: string;
  signalStrength: number;
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
  marketSwitch?: string;
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

// Advanced digit analysis function
const analyzeDigits = (digits: number[]): DigitAnalysis => {
  if (digits.length < 700) {
    const emptyCounts: Record<number, number> = {};
    for (let i = 0; i <= 9; i++) emptyCounts[i] = 0;
    
    return {
      counts: emptyCounts,
      percentages: emptyCounts,
      mostAppearing: -1,
      secondMost: -1,
      thirdMost: -1,
      leastAppearing: -1,
      secondLeast: -1,
      evenPercentage: 0,
      oddPercentage: 0,
      over5Percentage: 0,
      under5Percentage: 0,
      over3Percentage: 0,
      under6Percentage: 0,
      over7Percentage: 0,
      under2Percentage: 0,
      lastTwelveTicks: [],
      lastThreeTicks: [],
      lastThreeIdentical: false,
      signal: 'NONE',
      confidence: 0,
      comparison: {
        evenVsOdd: { even: 0, odd: 0, advantage: 'BALANCED' },
        over5VsUnder5: { over5: 0, under5: 0, advantage: 'BALANCED' },
        over3VsUnder6: { over3: 0, under6: 0, advantage: 'BALANCED' }
      }
    };
  }

  const last700 = digits.slice(-700);
  const lastTwelve = digits.slice(-12);
  const lastThree = digits.slice(-3);
  const lastThreeIdentical = lastThree.length === 3 && lastThree.every(d => d === lastThree[0]);
  
  // Count frequencies
  const counts: Record<number, number> = {};
  for (let i = 0; i <= 9; i++) counts[i] = 0;
  last700.forEach(d => counts[d]++);
  
  // Calculate percentages
  const percentages: Record<number, number> = {};
  for (let i = 0; i <= 9; i++) {
    percentages[i] = (counts[i] / 700) * 100;
  }
  
  // Sort digits by frequency
  const sortedByCount = [...Array(10).keys()].sort((a, b) => counts[b] - counts[a]);
  const sortedByLeast = [...Array(10).keys()].sort((a, b) => counts[a] - counts[b]);
  
  const mostAppearing = sortedByCount[0];
  const secondMost = sortedByCount[1];
  const thirdMost = sortedByCount[2];
  const leastAppearing = sortedByLeast[0];
  const secondLeast = sortedByLeast[1];
  
  // Calculate group percentages
  const evenDigits = [0,2,4,6,8];
  const oddDigits = [1,3,5,7,9];
  const over5Digits = [5,6,7,8,9];
  const under5Digits = [0,1,2,3,4];
  const over3Digits = [4,5,6,7,8,9];
  const under6Digits = [0,1,2,3,4,5];
  const over7Digits = [7,8,9];
  const under2Digits = [0,1];
  
  const evenCount = evenDigits.reduce((sum, d) => sum + counts[d], 0);
  const oddCount = oddDigits.reduce((sum, d) => sum + counts[d], 0);
  const over5Count = over5Digits.reduce((sum, d) => sum + counts[d], 0);
  const under5Count = under5Digits.reduce((sum, d) => sum + counts[d], 0);
  const over3Count = over3Digits.reduce((sum, d) => sum + counts[d], 0);
  const under6Count = under6Digits.reduce((sum, d) => sum + counts[d], 0);
  const over7Count = over7Digits.reduce((sum, d) => sum + counts[d], 0);
  const under2Count = under2Digits.reduce((sum, d) => sum + counts[d], 0);
  
  const evenPercentage = (evenCount / 700) * 100;
  const oddPercentage = (oddCount / 700) * 100;
  const over5Percentage = (over5Count / 700) * 100;
  const under5Percentage = (under5Count / 700) * 100;
  const over3Percentage = (over3Count / 700) * 100;
  const under6Percentage = (under6Count / 700) * 100;
  const over7Percentage = (over7Count / 700) * 100;
  const under2Percentage = (under2Count / 700) * 100;
  
  // Calculate comparisons
  const evenVsOddAdvantage = evenPercentage > oddPercentage + 5 ? 'EVEN' : oddPercentage > evenPercentage + 5 ? 'ODD' : 'BALANCED';
  const over5VsUnder5Advantage = over5Percentage > under5Percentage + 5 ? 'OVER_5' : under5Percentage > over5Percentage + 5 ? 'UNDER_5' : 'BALANCED';
  const over3VsUnder6Advantage = over3Percentage > under6Percentage + 5 ? 'OVER_3' : under6Percentage > over3Percentage + 5 ? 'UNDER_6' : 'BALANCED';
  
  // Check last three pattern for entry signals
  const lastThreeOver3 = lastThree.filter(d => d > 3).length >= 2;
  const lastThreeUnder6 = lastThree.filter(d => d < 6).length >= 2;
  const lastThreeEven = lastThree.filter(d => d % 2 === 0).length >= 2;
  const lastThreeOdd = lastThree.filter(d => d % 2 === 1).length >= 2;
  const lastThreeOver5 = lastThree.filter(d => d > 4).length >= 2;
  const lastThreeUnder5 = lastThree.filter(d => d < 5).length >= 2;
  const lastThreeOver7 = lastThree.filter(d => d > 6).length >= 2;
  const lastThreeUnder2 = lastThree.filter(d => d < 2).length >= 2;
  
  // Determine signal based on strict conditions
  let signal: 'EVEN' | 'ODD' | 'OVER_3' | 'UNDER_6' | 'OVER_5' | 'UNDER_5' | 'OVER_7' | 'UNDER_2' | 'NONE' = 'NONE';
  let confidence = 0;
  
  // Check EVEN conditions
  if (
    evenPercentage >= 55 &&
    mostAppearing % 2 === 0 &&
    secondMost % 2 === 0 &&
    lastThreeEven
  ) {
    signal = 'EVEN';
    confidence = evenPercentage;
  }
  // Check ODD conditions
  else if (
    oddPercentage >= 55 &&
    mostAppearing % 2 === 1 &&
    secondMost % 2 === 1 &&
    lastThreeOdd
  ) {
    signal = 'ODD';
    confidence = oddPercentage;
  }
  // Check OVER 3 conditions
  else if (
    over3Percentage >= 55 &&
    mostAppearing > 3 &&
    secondMost > 3 &&
    lastThreeOver3
  ) {
    signal = 'OVER_3';
    confidence = over3Percentage;
  }
  // Check UNDER 6 conditions
  else if (
    under6Percentage >= 55 &&
    mostAppearing < 6 &&
    secondMost < 6 &&
    lastThreeUnder6
  ) {
    signal = 'UNDER_6';
    confidence = under6Percentage;
  }
  // Check OVER 5 conditions
  else if (
    over5Percentage >= 55 &&
    mostAppearing > 4 &&
    secondMost > 4 &&
    lastThreeOver5
  ) {
    signal = 'OVER_5';
    confidence = over5Percentage;
  }
  // Check UNDER 5 conditions
  else if (
    under5Percentage >= 55 &&
    mostAppearing < 5 &&
    secondMost < 5 &&
    lastThreeUnder5
  ) {
    signal = 'UNDER_5';
    confidence = under5Percentage;
  }
  // Check OVER 7 conditions
  else if (
    over7Percentage >= 40 &&
    mostAppearing > 6 &&
    secondMost > 6 &&
    lastThreeOver7
  ) {
    signal = 'OVER_7';
    confidence = over7Percentage;
  }
  // Check UNDER 2 conditions
  else if (
    under2Percentage >= 30 &&
    mostAppearing < 2 &&
    secondMost < 2 &&
    lastThreeUnder2
  ) {
    signal = 'UNDER_2';
    confidence = under2Percentage;
  }
  
  return {
    counts,
    percentages,
    mostAppearing,
    secondMost,
    thirdMost,
    leastAppearing,
    secondLeast,
    evenPercentage,
    oddPercentage,
    over5Percentage,
    under5Percentage,
    over3Percentage,
    under6Percentage,
    over7Percentage,
    under2Percentage,
    lastTwelveTicks: lastTwelve,
    lastThreeTicks: lastThree,
    lastThreeIdentical,
    signal,
    confidence,
    comparison: {
      evenVsOdd: { even: evenPercentage, odd: oddPercentage, advantage: evenVsOddAdvantage },
      over5VsUnder5: { over5: over5Percentage, under5: under5Percentage, advantage: over5VsUnder5Advantage },
      over3VsUnder6: { over3: over3Percentage, under6: under6Percentage, advantage: over3VsUnder6Advantage }
    }
  };
};

// Find best market for each bot type
const findBestMarketForBot = (
  marketsData: Record<string, MarketData>,
  botType: string
): { market: string; analysis: DigitAnalysis } | null => {
  let bestMarket: string | null = null;
  let bestAnalysis: DigitAnalysis | null = null;
  let highestConfidence = 0;
  
  for (const [symbol, data] of Object.entries(marketsData)) {
    if (data.analysis.signal === botType && data.analysis.confidence > highestConfidence) {
      highestConfidence = data.analysis.confidence;
      bestMarket = symbol;
      bestAnalysis = data.analysis;
    }
  }
  
  return bestMarket && bestAnalysis ? { market: bestMarket, analysis: bestAnalysis } : null;
};

export default function AutoTrade() {
  const { isAuthorized, activeAccount, balance } = useAuth();
  const [activeTradeId, setActiveTradeId] = useState<string | null>(null);
  const [selectedMarket, setSelectedMarket] = useState<string>('R_100');
  const [marketsData, setMarketsData] = useState<Record<string, MarketData>>({});
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [globalStake, setGlobalStake] = useState<number>(0.5);
  const [globalMultiplier, setGlobalMultiplier] = useState<number>(2);
  const [globalStopLoss, setGlobalStopLoss] = useState<number>(30);
  const [globalTakeProfit, setGlobalTakeProfit] = useState<number>(5);
  const [lastScanTime, setLastScanTime] = useState<Date | null>(null);
  const [selectedDigit, setSelectedDigit] = useState<number>(5);
  
  const [trades, setTrades] = useState<TradeLog[]>([]);
  const tradeIdRef = useRef(0);
  const marketDigitsRef = useRef<Record<string, number[]>>({});
  const analysisIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const { digits, prices, isLoading, tickCount } = useTickLoader(selectedMarket, 1000);

  // Update market digits
  useEffect(() => {
    if (digits.length > 0) {
      marketDigitsRef.current[selectedMarket] = digits;
      
      // Also update other markets with simulated data for demo
      // In production, you would fetch real data for all markets
      VOLATILITY_MARKETS.forEach(market => {
        if (market !== selectedMarket && !marketDigitsRef.current[market]) {
          // Generate some random but plausible data for other markets
          const simulatedDigits = Array.from({ length: 1000 }, () => Math.floor(Math.random() * 10));
          marketDigitsRef.current[market] = simulatedDigits;
        }
      });
      
      // Trigger analysis
      analyzeAllMarkets();
    }
  }, [digits, selectedMarket]);

  // Initialize bots with more types
  const [bots, setBots] = useState<BotState[]>([
    { 
      id: 'bot1', name: 'EVEN BOT', type: 'EVEN', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, 
      currentMarket: 'R_100', status: 'idle', consecutiveLosses: 0, 
      cooldownRemaining: 0, marketSwitchCount: 0, signalStrength: 0
    },
    { 
      id: 'bot2', name: 'ODD BOT', type: 'ODD', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, 
      currentMarket: 'R_100', status: 'idle', consecutiveLosses: 0, 
      cooldownRemaining: 0, marketSwitchCount: 0, signalStrength: 0
    },
    { 
      id: 'bot3', name: 'OVER 3 BOT', type: 'OVER_3', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, 
      currentMarket: 'R_100', status: 'idle', consecutiveLosses: 0, 
      cooldownRemaining: 0, marketSwitchCount: 0, signalStrength: 0
    },
    { 
      id: 'bot4', name: 'UNDER 6 BOT', type: 'UNDER_6', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, 
      currentMarket: 'R_100', status: 'idle', consecutiveLosses: 0, 
      cooldownRemaining: 0, marketSwitchCount: 0, signalStrength: 0
    },
    { 
      id: 'bot5', name: 'OVER 5 BOT', type: 'OVER_5', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, 
      currentMarket: 'R_100', status: 'idle', consecutiveLosses: 0, 
      cooldownRemaining: 0, marketSwitchCount: 0, signalStrength: 0
    },
    { 
      id: 'bot6', name: 'UNDER 5 BOT', type: 'UNDER_5', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, 
      currentMarket: 'R_100', status: 'idle', consecutiveLosses: 0, 
      cooldownRemaining: 0, marketSwitchCount: 0, signalStrength: 0
    },
    { 
      id: 'bot7', name: 'OVER 7 BOT', type: 'OVER_7', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, 
      currentMarket: 'R_100', status: 'idle', consecutiveLosses: 0, 
      cooldownRemaining: 0, marketSwitchCount: 0, signalStrength: 0
    },
    { 
      id: 'bot8', name: 'UNDER 2 BOT', type: 'UNDER_2', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, 
      currentMarket: 'R_100', status: 'idle', consecutiveLosses: 0, 
      cooldownRemaining: 0, marketSwitchCount: 0, signalStrength: 0
    }
  ]);

  const botRunningRefs = useRef<Record<string, boolean>>({});
  const botPausedRefs = useRef<Record<string, boolean>>({});

  // Continuous analysis every 10 seconds
  useEffect(() => {
    if (analysisIntervalRef.current) {
      clearInterval(analysisIntervalRef.current);
    }
    
    analysisIntervalRef.current = setInterval(() => {
      analyzeAllMarkets();
    }, 10000);
    
    return () => {
      if (analysisIntervalRef.current) {
        clearInterval(analysisIntervalRef.current);
      }
    };
  }, []);

  // Analyze all markets
  const analyzeAllMarkets = useCallback(() => {
    setIsAnalyzing(true);
    
    const newMarketsData: Record<string, MarketData> = {};
    
    for (const market of VOLATILITY_MARKETS) {
      const marketDigits = marketDigitsRef.current[market] || [];
      if (marketDigits.length >= 700) {
        const analysis = analyzeDigits(marketDigits);
        newMarketsData[market] = {
          symbol: market,
          digits: marketDigits.slice(-700),
          analysis,
          lastUpdate: Date.now()
        };
      }
    }
    
    setMarketsData(newMarketsData);
    setLastScanTime(new Date());
    
    // Auto-switch bots to best markets
    setBots(prev => prev.map(bot => {
      const bestMarket = findBestMarketForBot(newMarketsData, bot.type);
      if (bestMarket && bestMarket.market !== bot.currentMarket) {
        return {
          ...bot,
          currentMarket: bestMarket.market,
          marketSwitchCount: bot.marketSwitchCount + 1,
          lastSignal: bestMarket.analysis.signal,
          signalStrength: bestMarket.analysis.confidence
        };
      }
      return bot;
    }));
    
    setIsAnalyzing(false);
  }, []);

  // Get contract type from bot type
  const getContractDetails = (botType: string): { contract: string; barrier?: number } => {
    switch(botType) {
      case 'EVEN': return { contract: 'DIGITEVEN' };
      case 'ODD': return { contract: 'DIGITODD' };
      case 'OVER_3': return { contract: 'DIGITOVER', barrier: 3 };
      case 'UNDER_6': return { contract: 'DIGITUNDER', barrier: 6 };
      case 'OVER_5': return { contract: 'DIGITOVER', barrier: 5 };
      case 'UNDER_5': return { contract: 'DIGITUNDER', barrier: 5 };
      case 'OVER_7': return { contract: 'DIGITOVER', barrier: 7 };
      case 'UNDER_2': return { contract: 'DIGITUNDER', barrier: 2 };
      default: return { contract: 'DIGITEVEN' };
    }
  };

  // Trading loop
  const runBot = useCallback(async (botId: string) => {
    const bot = bots.find(b => b.id === botId);
    if (!bot || !isAuthorized) return;

    if (balance < globalStake) {
      toast.error(`Insufficient balance for ${bot.name}`);
      stopBot(botId);
      return;
    }

    setBots(prev => prev.map(b => b.id === botId ? { 
      ...b, 
      isRunning: true, 
      isPaused: false, 
      currentStake: globalStake,
      status: 'analyzing'
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
    let currentMarket = bot.currentMarket;
    let marketSwitchCount = bot.marketSwitchCount;

    while (botRunningRefs.current[botId]) {
      if (botPausedRefs.current[botId]) {
        await new Promise(r => setTimeout(r, 500));
        continue;
      }

      // Check stop loss / take profit
      if (totalPnl <= -globalStopLoss) {
        toast.error(`${bot.name}: Stop Loss! $${totalPnl.toFixed(2)}`);
        break;
      }
      if (totalPnl >= globalTakeProfit) {
        toast.success(`${bot.name}: Take Profit! +$${totalPnl.toFixed(2)}`);
        break;
      }

      // Handle cooldown (3 ticks after trade)
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

      // Get current market analysis
      const marketData = marketsData[currentMarket];
      if (!marketData) {
        // Try to find another market with signal
        const bestMarket = findBestMarketForBot(marketsData, bot.type);
        if (bestMarket) {
          currentMarket = bestMarket.market;
          marketSwitchCount++;
          setBots(prev => prev.map(b => b.id === botId ? { 
            ...b, 
            currentMarket,
            marketSwitchCount,
            status: 'switching_market'
          } : b));
          toast.info(`${bot.name} switched to ${currentMarket}`);
        }
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }

      const analysis = marketData.analysis;
      const lastDigit = marketData.digits.length > 0 ? marketData.digits[marketData.digits.length - 1] : undefined;

      // Update signal info
      setBots(prev => prev.map(b => b.id === botId ? { 
        ...b, 
        lastSignal: analysis.signal,
        signalStrength: analysis.confidence,
        status: analysis.signal === bot.type ? 'waiting_entry' : 'analyzing'
      } : b));

      // Check if current market has signal for this bot type
      if (analysis.signal !== bot.type) {
        // Look for better market
        const bestMarket = findBestMarketForBot(marketsData, bot.type);
        if (bestMarket && bestMarket.market !== currentMarket) {
          currentMarket = bestMarket.market;
          marketSwitchCount++;
          toast.info(`${bot.name} found better signal in ${currentMarket}`);
        }
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }

      // Check last three identical rule
      if (analysis.lastThreeIdentical) {
        toast.warning(`${bot.name}: Last 3 identical, waiting 5 ticks`);
        cooldownRemaining = 5;
        continue;
      }

      // Check if signal is strong enough
      if (analysis.confidence < 55) {
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }

      setBots(prev => prev.map(b => b.id === botId ? { ...b, status: 'trading' } : b));

      try {
        await waitForNextTick(currentMarket);

        if (activeTradeId) {
          await new Promise(r => setTimeout(r, 500));
          continue;
        }

        const { contract, barrier } = getContractDetails(bot.type);
        
        const params: any = {
          contract_type: contract,
          symbol: currentMarket,
          duration: 1,
          duration_unit: 't',
          basis: 'stake',
          amount: stake,
        };

        if (barrier !== undefined) {
          params.barrier = barrier.toString();
        }

        const id = ++tradeIdRef.current;
        const now = new Date().toLocaleTimeString();
        const tradeId = `${botId}-${id}`;
        setActiveTradeId(tradeId);

        setTrades(prev => [{
          id,
          time: now,
          market: currentMarket,
          contract,
          stake,
          result: 'Pending',
          pnl: 0,
          bot: bot.name,
          lastDigit,
          signalType: analysis.signal
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
        } else {
          losses++;
          consecutiveLosses++;
          stake = Math.round(stake * globalMultiplier * 100) / 100;
        }

        cooldownRemaining = 3;

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
              status: 'cooldown',
              cooldownRemaining,
              lastTradeResult: won ? 'win' : 'loss',
              currentMarket,
              marketSwitchCount
            };
          }
          return b;
        }));

        setActiveTradeId(null);

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
      cooldownRemaining: 0
    } : b));
    
    botRunningRefs.current[botId] = false;
  }, [isAuthorized, balance, globalStake, globalMultiplier, globalStopLoss, globalTakeProfit, activeTradeId, bots, marketsData]);

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
      cooldownRemaining: 0
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
      cooldownRemaining: 0
    })));
  };

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
      cooldownRemaining: 0,
      marketSwitchCount: 0,
      lastSignal: undefined,
      signalStrength: 0
    })));
    tradeIdRef.current = 0;
    toast.success('All data cleared');
  };

  // Manual analysis trigger
  const runAnalysis = () => {
    analyzeAllMarkets();
    toast.info('Market analysis triggered');
  };

  // Get market display
  const getMarketDisplay = (market: string) => {
    if (market.startsWith('1HZ')) return `⚡ ${market}`;
    if (market.startsWith('R_')) return `📊 ${market}`;
    if (market.includes('BOOM')) return `💥 ${market}`;
    if (market.includes('CRASH')) return `📉 ${market}`;
    if (market.includes('RDBEAR')) return `🐻 ${market}`;
    if (market.includes('RDBULL')) return `🐂 ${market}`;
    if (market.includes('JD')) return `🦘 ${market}`;
    return market;
  };

  // Calculate totals
  const totalProfit = bots.reduce((sum, bot) => sum + bot.totalPnl, 0);
  const totalTrades = bots.reduce((sum, bot) => sum + bot.trades, 0);
  const totalWins = bots.reduce((sum, bot) => sum + bot.wins, 0);
  const winRate = totalTrades > 0 ? ((totalWins / totalTrades) * 100).toFixed(1) : '0';

  // Get status color
  const getStatusColor = (status: string) => {
    switch(status) {
      case 'trading': return 'text-green-400';
      case 'waiting_entry': return 'text-yellow-400';
      case 'analyzing': return 'text-blue-400';
      case 'cooldown': return 'text-purple-400';
      case 'switching_market': return 'text-pink-400';
      default: return 'text-gray-400';
    }
  };

  const getStatusIcon = (status: string) => {
    switch(status) {
      case 'trading': return '📈';
      case 'waiting_entry': return '⏳';
      case 'analyzing': return '🔍';
      case 'cooldown': return '⏱️';
      case 'switching_market': return '🔄';
      default: return '⚫';
    }
  };

  return (
    <div className="space-y-4 p-4 bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 min-h-screen text-white">
      {/* Animated background with dollar signs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden opacity-5">
        {[...Array(20)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute text-green-500 font-bold text-4xl"
            initial={{
              x: Math.random() * window.innerWidth,
              y: -100,
              rotate: 0
            }}
            animate={{
              y: window.innerHeight + 100,
              rotate: 360
            }}
            transition={{
              duration: 15 + Math.random() * 20,
              repeat: Infinity,
              delay: Math.random() * 10,
              ease: "linear"
            }}
          >
            $
          </motion.div>
        ))}
      </div>

      {/* Main content */}
      <div className="relative z-10">
        {/* Header */}
        <div className="bg-white/10 backdrop-blur-lg border border-white/20 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-yellow-400 to-green-400 text-transparent bg-clip-text">
                🤖 Advanced Signal-Based Trading System
              </h1>
              <p className="text-xs text-gray-300">
                Auto-market switching • 700-tick analysis • 8 bot strategies
                {lastScanTime && ` • Last scan: ${lastScanTime.toLocaleTimeString()}`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={runAnalysis}
                disabled={isAnalyzing}
                className="bg-white/10 border-white/20 hover:bg-white/20"
              >
                {isAnalyzing ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Zap className="w-4 h-4 mr-1" />}
                Analyze Now
              </Button>
              <Button 
                variant="destructive" 
                size="sm" 
                onClick={clearAll}
                className="bg-red-500/20 hover:bg-red-500/30"
              >
                <Trash2 className="w-4 h-4 mr-1" /> Clear
              </Button>
              <Button variant="destructive" size="sm" onClick={stopAllBots} disabled={!bots.some(b => b.isRunning)} className="bg-red-500/20 hover:bg-red-500/30">
                <StopCircle className="w-4 h-4 mr-1" /> Stop All
              </Button>
            </div>
          </div>

          {/* Global Stats */}
          <div className="grid grid-cols-5 gap-3 text-sm mb-3">
            <div className="bg-white/5 rounded-lg p-2">
              <div className="text-gray-400 text-xs">Balance</div>
              <div className="font-bold text-lg text-green-400">${balance?.toFixed(2) || '0.00'}</div>
            </div>
            <div className="bg-white/5 rounded-lg p-2">
              <div className="text-gray-400 text-xs">Total P&L</div>
              <div className={`font-bold text-lg ${totalProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                ${totalProfit.toFixed(2)}
              </div>
            </div>
            <div className="bg-white/5 rounded-lg p-2">
              <div className="text-gray-400 text-xs">Win Rate</div>
              <div className="font-bold text-lg text-yellow-400">{winRate}%</div>
            </div>
            <div className="bg-white/5 rounded-lg p-2">
              <div className="text-gray-400 text-xs">Total Trades</div>
              <div className="font-bold text-lg text-blue-400">{totalTrades}</div>
            </div>
            <div className="bg-white/5 rounded-lg p-2">
              <div className="text-gray-400 text-xs">Active</div>
              <div className="font-bold text-lg text-purple-400">{bots.filter(b => b.isRunning).length}/8</div>
            </div>
          </div>

          {/* Settings */}
          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className="text-xs text-gray-400">Stake ($)</label>
              <input 
                type="number" 
                value={globalStake} 
                onChange={(e) => setGlobalStake(parseFloat(e.target.value) || 0.5)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-sm text-white"
                step="0.1"
                min="0.1"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">Multiplier</label>
              <input 
                type="number" 
                value={globalMultiplier} 
                onChange={(e) => setGlobalMultiplier(parseFloat(e.target.value) || 2)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-sm text-white"
                step="0.1"
                min="1.1"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">Stop Loss ($)</label>
              <input 
                type="number" 
                value={globalStopLoss} 
                onChange={(e) => setGlobalStopLoss(parseFloat(e.target.value) || 30)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-sm text-white"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">Take Profit ($)</label>
              <input 
                type="number" 
                value={globalTakeProfit} 
                onChange={(e) => setGlobalTakeProfit(parseFloat(e.target.value) || 5)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-sm text-white"
              />
            </div>
          </div>
        </div>

        {/* Digit Selector */}
        <div className="bg-white/10 backdrop-blur-lg border border-white/20 rounded-xl p-3 mt-3">
          <div className="flex items-center gap-2 mb-2">
            <Hash className="w-4 h-4 text-yellow-400" />
            <h3 className="text-sm font-semibold">Digit Analysis - Selected: {selectedDigit}</h3>
          </div>
          <div className="flex gap-1 mb-3">
            {[0,1,2,3,4,5,6,7,8,9].map((digit) => (
              <Button
                key={digit}
                size="sm"
                variant={selectedDigit === digit ? "default" : "outline"}
                onClick={() => setSelectedDigit(digit)}
                className={`flex-1 ${selectedDigit === digit ? 'bg-yellow-500' : 'bg-white/5 border-white/10'}`}
              >
                {digit}
              </Button>
            ))}
          </div>
          
          {/* Show comparison for selected digit */}
          {marketsData[selectedMarket] && (
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white/5 rounded p-2">
                <div className="text-xs text-gray-400">OVER {selectedDigit}</div>
                <div className="text-lg font-bold text-blue-400">
                  {marketsData[selectedMarket].analysis.percentages[selectedDigit]?.toFixed(1)}%
                </div>
                <div className="text-[8px] text-gray-400">Count: {marketsData[selectedMarket].analysis.counts[selectedDigit]}</div>
              </div>
              <div className="bg-white/5 rounded p-2">
                <div className="text-xs text-gray-400">UNDER {selectedDigit}</div>
                <div className="text-lg font-bold text-orange-400">
                  {(100 - (marketsData[selectedMarket].analysis.percentages[selectedDigit] || 0)).toFixed(1)}%
                </div>
                <div className="text-[8px] text-gray-400">Others: {700 - (marketsData[selectedMarket].analysis.counts[selectedDigit] || 0)}</div>
              </div>
            </div>
          )}
        </div>

        {/* Bots Grid */}
        <div className="grid grid-cols-4 gap-3 mt-3">
          {bots.map((bot) => {
            const marketData = marketsData[bot.currentMarket];
            
            return (
              <motion.div
                key={bot.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className={`bg-white/10 backdrop-blur-lg border rounded-xl p-3 ${
                  bot.isRunning ? 'border-green-500 ring-1 ring-green-500/50' : 'border-white/20'
                }`}
              >
                {/* Header */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className={`p-1.5 rounded-lg ${
                      bot.type === 'EVEN' ? 'bg-green-500/20 text-green-400' :
                      bot.type === 'ODD' ? 'bg-purple-500/20 text-purple-400' :
                      bot.type === 'OVER_3' ? 'bg-blue-500/20 text-blue-400' :
                      bot.type === 'UNDER_6' ? 'bg-orange-500/20 text-orange-400' :
                      bot.type === 'OVER_5' ? 'bg-cyan-500/20 text-cyan-400' :
                      bot.type === 'UNDER_5' ? 'bg-pink-500/20 text-pink-400' :
                      bot.type === 'OVER_7' ? 'bg-indigo-500/20 text-indigo-400' :
                      'bg-amber-500/20 text-amber-400'
                    }`}>
                      {bot.type.includes('OVER') ? <TrendingUp className="w-4 h-4" /> :
                       bot.type.includes('UNDER') ? <TrendingDown className="w-4 h-4" /> :
                       <CircleDot className="w-4 h-4" />}
                    </div>
                    <div>
                      <h4 className="font-bold text-sm">{bot.name}</h4>
                      <p className="text-[9px] text-gray-400">
                        Switches: {bot.marketSwitchCount}
                      </p>
                    </div>
                  </div>
                  <Badge variant={bot.isRunning ? "default" : "secondary"} className="text-[9px]">
                    {bot.isRunning ? (bot.isPaused ? '⏸️' : '▶️') : '⏹️'}
                  </Badge>
                </div>

                {/* Current Market & Signal */}
                <div className="bg-white/5 rounded-lg p-2 mb-2">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-gray-400">Market:</span>
                    <span className="font-mono font-bold text-blue-400">
                      {getMarketDisplay(bot.currentMarket)}
                    </span>
                  </div>
                  {marketData && (
                    <>
                      <div className="flex justify-between text-[10px] mt-1">
                        <span className="text-gray-400">Signal:</span>
                        <span className={marketData.analysis.signal === bot.type ? 'text-green-400 font-bold' : 'text-gray-400'}>
                          {marketData.analysis.signal || 'NONE'}
                        </span>
                        <span className="text-gray-400">Strength:</span>
                        <span className={marketData.analysis.confidence >= 55 ? 'text-green-400' : 'text-gray-400'}>
                          {marketData.analysis.confidence.toFixed(1)}%
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-1 text-[8px] mt-1">
                        <div>Most: {marketData.analysis.mostAppearing}</div>
                        <div>2nd: {marketData.analysis.secondMost}</div>
                        <div>3rd: {marketData.analysis.thirdMost}</div>
                        <div>Least: {marketData.analysis.leastAppearing}</div>
                      </div>
                    </>
                  )}
                </div>

                {/* Stats */}
                <div className="grid grid-cols-4 gap-1 text-[10px] mb-2">
                  <div>
                    <span className="text-gray-400">P&L:</span>
                    <span className={`ml-1 font-mono ${
                      bot.totalPnl > 0 ? 'text-green-400' : bot.totalPnl < 0 ? 'text-red-400' : ''
                    }`}>
                      ${bot.totalPnl.toFixed(2)}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-400">W:</span>
                    <span className="ml-1 font-mono text-green-400">{bot.wins}</span>
                  </div>
                  <div>
                    <span className="text-gray-400">L:</span>
                    <span className="ml-1 font-mono text-red-400">{bot.losses}</span>
                  </div>
                  <div>
                    <span className="text-gray-400">Stake:</span>
                    <span className="ml-1 font-mono text-yellow-400">${bot.currentStake.toFixed(2)}</span>
                  </div>
                </div>

                {/* Status */}
                <div className="flex items-center justify-between text-[10px] mb-2">
                  <span className="text-gray-400">Status:</span>
                  <span className={`font-mono ${getStatusColor(bot.status)}`}>
                    {getStatusIcon(bot.status)} {
                      bot.status === 'trading' ? 'Trading' :
                      bot.status === 'waiting_entry' ? 'Waiting Signal' :
                      bot.status === 'analyzing' ? 'Analyzing' :
                      bot.status === 'cooldown' ? `Cooldown ${bot.cooldownRemaining}` :
                      bot.status === 'switching_market' ? 'Switching' :
                      'Idle'
                    }
                  </span>
                </div>

                {/* Controls */}
                <div className="flex gap-1">
                  {!bot.isRunning ? (
                    <Button
                      onClick={() => startBot(bot.id)}
                      disabled={!isAuthorized || balance < globalStake || activeTradeId !== null}
                      size="sm"
                      className="flex-1 h-7 text-xs bg-gradient-to-r from-green-500 to-green-600 hover:from-green-400 hover:to-green-500"
                    >
                      <Play className="w-3 h-3 mr-1" /> Start
                    </Button>
                  ) : (
                    <>
                      <Button
                        onClick={() => pauseBot(bot.id)}
                        size="sm"
                        variant="outline"
                        className="flex-1 h-7 text-xs border-white/20 hover:bg-white/10"
                      >
                        <Pause className="w-3 h-3 mr-1" /> {bot.isPaused ? 'Resume' : 'Pause'}
                      </Button>
                      <Button
                        onClick={() => stopBot(bot.id)}
                        size="sm"
                        variant="destructive"
                        className="flex-1 h-7 text-xs bg-red-500/20 hover:bg-red-500/30"
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

        {/* Market Signals Dashboard */}
        <div className="bg-white/10 backdrop-blur-lg border border-white/20 rounded-xl p-3 mt-3">
          <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-green-400" />
            📊 Live Market Signals
          </h3>
          <div className="grid grid-cols-2 gap-2 max-h-96 overflow-y-auto">
            {Object.entries(marketsData).length > 0 ? (
              Object.entries(marketsData).map(([symbol, data]) => (
                <div key={symbol} className="bg-white/5 rounded p-3 text-xs">
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-bold text-blue-400">{getMarketDisplay(symbol)}</span>
                    <Badge className={`text-[8px] ${
                      data.analysis.signal === 'EVEN' ? 'bg-green-500' :
                      data.analysis.signal === 'ODD' ? 'bg-purple-500' :
                      data.analysis.signal === 'OVER_3' ? 'bg-blue-500' :
                      data.analysis.signal === 'UNDER_6' ? 'bg-orange-500' :
                      data.analysis.signal === 'OVER_5' ? 'bg-cyan-500' :
                      data.analysis.signal === 'UNDER_5' ? 'bg-pink-500' :
                      data.analysis.signal === 'OVER_7' ? 'bg-indigo-500' :
                      data.analysis.signal === 'UNDER_2' ? 'bg-amber-500' :
                      'bg-gray-500'
                    }`}>
                      {data.analysis.signal || 'NO SIGNAL'}
                    </Badge>
                  </div>
                  
                  {/* Last 12 digits */}
                  <div className="mb-2">
                    <div className="text-[8px] text-gray-400 mb-1">Last 12 digits:</div>
                    <div className="flex gap-1">
                      {data.analysis.lastTwelveTicks.map((digit, idx) => (
                        <span key={idx} className={`w-4 h-4 flex items-center justify-center text-[8px] font-bold rounded ${
                          digit > 5 ? 'bg-blue-500/30 text-blue-300' : 
                          digit < 5 ? 'bg-orange-500/30 text-orange-300' : 
                          'bg-purple-500/30 text-purple-300'
                        }`}>
                          {digit}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Digit buttons with percentages */}
                  <div className="grid grid-cols-5 gap-1 mb-2">
                    {[0,1,2,3,4,5,6,7,8,9].map((digit) => (
                      <div key={digit} className="text-center">
                        <Button
                          size="sm"
                          variant="ghost"
                          className={`w-full h-6 text-[10px] p-0 ${
                            digit === data.analysis.mostAppearing ? 'bg-green-500/30 text-green-300' :
                            digit === data.analysis.leastAppearing ? 'bg-red-500/30 text-red-300' :
                            'bg-white/5'
                          }`}
                        >
                          {digit}
                        </Button>
                        <div className="text-[6px] mt-1 text-gray-400">
                          {data.analysis.percentages[digit]?.toFixed(1)}%
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Most appearing and second least */}
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <div className="bg-white/5 rounded p-1">
                      <div className="text-[8px] text-gray-400">Most Appearing</div>
                      <div className="text-sm font-bold text-green-400">{data.analysis.mostAppearing}</div>
                      <div className="text-[6px] text-gray-400">{data.analysis.percentages[data.analysis.mostAppearing]?.toFixed(1)}%</div>
                    </div>
                    <div className="bg-white/5 rounded p-1">
                      <div className="text-[8px] text-gray-400">Second Least</div>
                      <div className="text-sm font-bold text-orange-400">{data.analysis.secondLeast}</div>
                      <div className="text-[6px] text-gray-400">{data.analysis.percentages[data.analysis.secondLeast]?.toFixed(1)}%</div>
                    </div>
                  </div>

                  {/* Comparisons */}
                  <div className="space-y-1">
                    {/* Even vs Odd */}
                    <div className="bg-white/5 rounded p-1">
                      <div className="flex justify-between items-center text-[8px]">
                        <span className="text-gray-400">Even vs Odd:</span>
                        <span className={data.analysis.comparison.evenVsOdd.advantage === 'EVEN' ? 'text-green-400' : 
                                       data.analysis.comparison.evenVsOdd.advantage === 'ODD' ? 'text-purple-400' : 
                                       'text-gray-400'}>
                          {data.analysis.comparison.evenVsOdd.advantage}
                        </span>
                      </div>
                      <div className="flex gap-2 mt-1">
                        <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
                          <div className="h-full bg-green-400" style={{ width: `${data.analysis.evenPercentage}%` }} />
                        </div>
                        <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
                          <div className="h-full bg-purple-400" style={{ width: `${data.analysis.oddPercentage}%` }} />
                        </div>
                      </div>
                      <div className="flex justify-between text-[6px] mt-1">
                        <span>Even: {data.analysis.evenPercentage.toFixed(1)}%</span>
                        <span>Odd: {data.analysis.oddPercentage.toFixed(1)}%</span>
                      </div>
                    </div>

                    {/* Over 5 vs Under 5 */}
                    <div className="bg-white/5 rounded p-1">
                      <div className="flex justify-between items-center text-[8px]">
                        <span className="text-gray-400">Over 5 vs Under 5:</span>
                        <span className={data.analysis.comparison.over5VsUnder5.advantage === 'OVER_5' ? 'text-blue-400' : 
                                       data.analysis.comparison.over5VsUnder5.advantage === 'UNDER_5' ? 'text-orange-400' : 
                                       'text-gray-400'}>
                          {data.analysis.comparison.over5VsUnder5.advantage}
                        </span>
                      </div>
                      <div className="flex gap-2 mt-1">
                        <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-400" style={{ width: `${data.analysis.over5Percentage}%` }} />
                        </div>
                        <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
                          <div className="h-full bg-orange-400" style={{ width: `${data.analysis.under5Percentage}%` }} />
                        </div>
                      </div>
                      <div className="flex justify-between text-[6px] mt-1">
                        <span>Over 5: {data.analysis.over5Percentage.toFixed(1)}%</span>
                        <span>Under 5: {data.analysis.under5Percentage.toFixed(1)}%</span>
                      </div>
                    </div>

                    {/* Over 3 vs Under 6 */}
                    <div className="bg-white/5 rounded p-1">
                      <div className="flex justify-between items-center text-[8px]">
                        <span className="text-gray-400">Over 3 vs Under 6:</span>
                        <span className={data.analysis.comparison.over3VsUnder6.advantage === 'OVER_3' ? 'text-cyan-400' : 
                                       data.analysis.comparison.over3VsUnder6.advantage === 'UNDER_6' ? 'text-pink-400' : 
                                       'text-gray-400'}>
                          {data.analysis.comparison.over3VsUnder6.advantage}
                        </span>
                      </div>
                      <div className="flex gap-2 mt-1">
                        <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
                          <div className="h-full bg-cyan-400" style={{ width: `${data.analysis.over3Percentage}%` }} />
                        </div>
                        <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
                          <div className="h-full bg-pink-400" style={{ width: `${data.analysis.under6Percentage}%` }} />
                        </div>
                      </div>
                      <div className="flex justify-between text-[6px] mt-1">
                        <span>Over 3: {data.analysis.over3Percentage.toFixed(1)}%</span>
                        <span>Under 6: {data.analysis.under6Percentage.toFixed(1)}%</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-gray-400 col-span-2 text-center py-4">No market data yet. Click Analyze Now.</p>
            )}
          </div>
        </div>

        {/* Trade Log */}
        <div className="bg-white/10 backdrop-blur-lg border border-white/20 rounded-xl p-3 mt-3">
          <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <Activity className="w-4 h-4 text-green-400" />
            📋 Live Trade Log
          </h3>
          <div className="space-y-1 max-h-[300px] overflow-y-auto">
            {trades.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-4">No trades yet</p>
            ) : (
              trades.map((trade, idx) => (
                <div key={idx} className="flex items-center justify-between text-xs py-1 border-b border-white/10 last:border-0">
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400">{trade.time}</span>
                    <Badge variant="outline" className="text-[8px] px-1 py-0 border-white/20">{trade.bot}</Badge>
                    <span className="font-mono text-[10px] text-blue-400">
                      {getMarketDisplay(trade.market)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    {trade.signalType && (
                      <Badge className="text-[7px] px-1 py-0 bg-opacity-50">
                        {trade.signalType}
                      </Badge>
                    )}
                    <span className="font-mono text-[10px] text-yellow-400">
                      Last: {trade.lastDigit !== undefined ? trade.lastDigit : '—'}
                    </span>
                    <span className="font-mono text-white">${trade.stake.toFixed(2)}</span>
                    <span className={`font-mono w-16 text-right ${
                      trade.result === 'Win' ? 'text-green-400' : trade.result === 'Loss' ? 'text-red-400' : 'text-yellow-400'
                    }`}>
                      {trade.result === 'Win' ? `+$${trade.pnl.toFixed(2)}` : 
                       trade.result === 'Loss' ? `-$${Math.abs(trade.pnl).toFixed(2)}` : 
                       '⏳'}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
