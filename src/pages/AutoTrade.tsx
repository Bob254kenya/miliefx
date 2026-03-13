import { useState, useRef, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { derivApi } from '@/services/deriv-api';
import { useAuth } from '@/contexts/AuthContext';
import { useTickLoader } from '@/hooks/useTickLoader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  Loader2, Play, StopCircle, Pause, TrendingUp, TrendingDown, 
  CircleDot, RefreshCw, Trash2, Zap, Activity, BarChart3, 
  LineChart, PieChart, Globe, Bell, Settings, Shield,
  Sparkles, Target, Award, ZapOff, Layers, GitCompare
} from 'lucide-react';

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
  over3Percentage: number;
  under6Percentage: number;
  over5Percentage: number;
  under5Percentage: number;
  over7Percentage: number;
  under7Percentage: number;
  lastTwelveTicks: number[];
  lastThreeTicks: number[];
  lastThreeIdentical: boolean;
  signal: 'EVEN' | 'ODD' | 'OVER_3' | 'UNDER_6' | 'OVER_5' | 'UNDER_5' | 'OVER_7' | 'UNDER_7' | 'NONE';
  confidence: number;
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
  type: 'EVEN' | 'ODD' | 'OVER_3' | 'UNDER_6' | 'OVER_5' | 'UNDER_5' | 'OVER_7' | 'UNDER_7';
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
  selectedDigit?: number;
  color?: string;
  icon?: JSX.Element;
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

// Simulated tick data for development
const generateMockTicks = (market: string, count: number): number[] => {
  const ticks: number[] = [];
  for (let i = 0; i < count; i++) {
    ticks.push(Math.floor(Math.random() * 10));
  }
  return ticks;
};

// Advanced digit analysis function
const analyzeDigits = (digits: number[]): DigitAnalysis => {
  if (digits.length < 100) {
    return {
      counts: {},
      percentages: {},
      mostAppearing: -1,
      secondMost: -1,
      thirdMost: -1,
      leastAppearing: -1,
      secondLeast: -1,
      evenPercentage: 0,
      oddPercentage: 0,
      over3Percentage: 0,
      under6Percentage: 0,
      over5Percentage: 0,
      under5Percentage: 0,
      over7Percentage: 0,
      under7Percentage: 0,
      lastTwelveTicks: [],
      lastThreeTicks: [],
      lastThreeIdentical: false,
      signal: 'NONE',
      confidence: 0
    };
  }

  const last700 = digits.slice(-700);
  const lastTwelve = digits.slice(-12);
  const lastThree = digits.slice(-3);
  const lastThreeIdentical = lastThree.length === 3 && lastThree.every(d => d === lastThree[0]);
  
  const counts: Record<number, number> = {};
  for (let i = 0; i <= 9; i++) counts[i] = 0;
  last700.forEach(d => counts[d]++);
  
  const percentages: Record<number, number> = {};
  for (let i = 0; i <= 9; i++) {
    percentages[i] = (counts[i] / 700) * 100;
  }
  
  const sortedByCount = [...Array(10).keys()].sort((a, b) => counts[b] - counts[a]);
  const sortedByLeast = [...Array(10).keys()].sort((a, b) => counts[a] - counts[b]);
  
  const mostAppearing = sortedByCount[0];
  const secondMost = sortedByCount[1];
  const thirdMost = sortedByCount[2];
  const leastAppearing = sortedByCount[9];
  const secondLeast = sortedByLeast[1];
  
  const evenDigits = [0,2,4,6,8];
  const oddDigits = [1,3,5,7,9];
  const over3Digits = [4,5,6,7,8,9];
  const under6Digits = [0,1,2,3,4,5];
  const over5Digits = [6,7,8,9];
  const under5Digits = [0,1,2,3,4];
  const over7Digits = [8,9];
  const under7Digits = [0,1,2,3,4,5,6];
  
  const evenCount = evenDigits.reduce((sum, d) => sum + counts[d], 0);
  const oddCount = oddDigits.reduce((sum, d) => sum + counts[d], 0);
  const over3Count = over3Digits.reduce((sum, d) => sum + counts[d], 0);
  const under6Count = under6Digits.reduce((sum, d) => sum + counts[d], 0);
  const over5Count = over5Digits.reduce((sum, d) => sum + counts[d], 0);
  const under5Count = under5Digits.reduce((sum, d) => sum + counts[d], 0);
  const over7Count = over7Digits.reduce((sum, d) => sum + counts[d], 0);
  const under7Count = under7Digits.reduce((sum, d) => sum + counts[d], 0);
  
  const evenPercentage = (evenCount / 700) * 100;
  const oddPercentage = (oddCount / 700) * 100;
  const over3Percentage = (over3Count / 700) * 100;
  const under6Percentage = (under6Count / 700) * 100;
  const over5Percentage = (over5Count / 700) * 100;
  const under5Percentage = (under5Count / 700) * 100;
  const over7Percentage = (over7Count / 700) * 100;
  const under7Percentage = (under7Count / 700) * 100;
  
  const lastThreeOver3 = lastThree.filter(d => d > 3).length >= 2;
  const lastThreeUnder6 = lastThree.filter(d => d < 6).length >= 2;
  const lastThreeOver5 = lastThree.filter(d => d > 5).length >= 2;
  const lastThreeUnder5 = lastThree.filter(d => d < 5).length >= 2;
  const lastThreeOver7 = lastThree.filter(d => d > 7).length >= 2;
  const lastThreeUnder7 = lastThree.filter(d => d < 7).length >= 2;
  const lastThreeEven = lastThree.filter(d => d % 2 === 0).length >= 2;
  const lastThreeOdd = lastThree.filter(d => d % 2 === 1).length >= 2;
  
  let signal: 'EVEN' | 'ODD' | 'OVER_3' | 'UNDER_6' | 'OVER_5' | 'UNDER_5' | 'OVER_7' | 'UNDER_7' | 'NONE' = 'NONE';
  let confidence = 0;
  
  if (evenPercentage >= 58 && oddPercentage <= 42 && mostAppearing % 2 === 0 && lastThreeEven) {
    signal = 'EVEN';
    confidence = evenPercentage;
  }
  else if (oddPercentage >= 58 && evenPercentage <= 42 && mostAppearing % 2 === 1 && lastThreeOdd) {
    signal = 'ODD';
    confidence = oddPercentage;
  }
  else if (over3Percentage >= 60 && mostAppearing > 3 && lastThreeOver3) {
    signal = 'OVER_3';
    confidence = over3Percentage;
  }
  else if (under6Percentage >= 60 && mostAppearing < 6 && lastThreeUnder6) {
    signal = 'UNDER_6';
    confidence = under6Percentage;
  }
  else if (over5Percentage >= 60 && mostAppearing > 5 && lastThreeOver5) {
    signal = 'OVER_5';
    confidence = over5Percentage;
  }
  else if (under5Percentage >= 60 && mostAppearing < 5 && lastThreeUnder5) {
    signal = 'UNDER_5';
    confidence = under5Percentage;
  }
  else if (over7Percentage >= 60 && mostAppearing > 7 && lastThreeOver7) {
    signal = 'OVER_7';
    confidence = over7Percentage;
  }
  else if (under7Percentage >= 60 && mostAppearing < 7 && lastThreeUnder7) {
    signal = 'UNDER_7';
    confidence = under7Percentage;
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
    over3Percentage,
    under6Percentage,
    over5Percentage,
    under5Percentage,
    over7Percentage,
    under7Percentage,
    lastTwelveTicks: lastTwelve,
    lastThreeTicks: lastThree,
    lastThreeIdentical,
    signal,
    confidence
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
  const [marketsData, setMarketsData] = useState<Record<string, MarketData>>({});
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [globalStake, setGlobalStake] = useState<number>(0.5);
  const [globalMultiplier, setGlobalMultiplier] = useState<number>(2);
  const [globalStopLoss, setGlobalStopLoss] = useState<number>(30);
  const [globalTakeProfit, setGlobalTakeProfit] = useState<number>(5);
  const [lastScanTime, setLastScanTime] = useState<Date | null>(null);
  
  const [trades, setTrades] = useState<TradeLog[]>([]);
  const tradeIdRef = useRef(0);
  const marketDigitsRef = useRef<Record<string, number[]>>({});
  const analysisIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize bots with colors and icons
  const [bots, setBots] = useState<BotState[]>([
    { 
      id: 'bot1', name: 'EVEN', type: 'EVEN', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, 
      currentMarket: 'R_100', status: 'idle', consecutiveLosses: 0, 
      cooldownRemaining: 0, marketSwitchCount: 0, signalStrength: 0,
      color: 'from-emerald-500 to-green-600',
      icon: <CircleDot className="w-3.5 h-3.5" />
    },
    { 
      id: 'bot2', name: 'ODD', type: 'ODD', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, 
      currentMarket: 'R_100', status: 'idle', consecutiveLosses: 0, 
      cooldownRemaining: 0, marketSwitchCount: 0, signalStrength: 0,
      color: 'from-purple-500 to-pink-600',
      icon: <CircleDot className="w-3.5 h-3.5" />
    },
    { 
      id: 'bot3', name: 'OVER 3', type: 'OVER_3', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, 
      currentMarket: 'R_100', status: 'idle', consecutiveLosses: 0, 
      cooldownRemaining: 0, marketSwitchCount: 0, signalStrength: 0,
      color: 'from-blue-500 to-cyan-600',
      icon: <TrendingUp className="w-3.5 h-3.5" />
    },
    { 
      id: 'bot4', name: 'UNDER 6', type: 'UNDER_6', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, 
      currentMarket: 'R_100', status: 'idle', consecutiveLosses: 0, 
      cooldownRemaining: 0, marketSwitchCount: 0, signalStrength: 0,
      color: 'from-orange-500 to-amber-600',
      icon: <TrendingDown className="w-3.5 h-3.5" />
    },
    { 
      id: 'bot5', name: 'OVER 5', type: 'OVER_5', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, 
      currentMarket: 'R_100', status: 'idle', consecutiveLosses: 0, 
      cooldownRemaining: 0, marketSwitchCount: 0, signalStrength: 0,
      selectedDigit: 5,
      color: 'from-cyan-500 to-teal-600',
      icon: <Target className="w-3.5 h-3.5" />
    },
    { 
      id: 'bot6', name: 'UNDER 5', type: 'UNDER_5', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, 
      currentMarket: 'R_100', status: 'idle', consecutiveLosses: 0, 
      cooldownRemaining: 0, marketSwitchCount: 0, signalStrength: 0,
      selectedDigit: 5,
      color: 'from-rose-500 to-pink-600',
      icon: <Shield className="w-3.5 h-3.5" />
    },
    { 
      id: 'bot7', name: 'OVER 7', type: 'OVER_7', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, 
      currentMarket: 'R_100', status: 'idle', consecutiveLosses: 0, 
      cooldownRemaining: 0, marketSwitchCount: 0, signalStrength: 0,
      selectedDigit: 7,
      color: 'from-indigo-500 to-purple-600',
      icon: <Sparkles className="w-3.5 h-3.5" />
    },
    { 
      id: 'bot8', name: 'UNDER 7', type: 'UNDER_7', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, 
      currentMarket: 'R_100', status: 'idle', consecutiveLosses: 0, 
      cooldownRemaining: 0, marketSwitchCount: 0, signalStrength: 0,
      selectedDigit: 7,
      color: 'from-violet-500 to-purple-600',
      icon: <Award className="w-3.5 h-3.5" />
    }
  ]);

  const botRunningRefs = useRef<Record<string, boolean>>({});
  const botPausedRefs = useRef<Record<string, boolean>>({});

  // Initialize with mock data
  useEffect(() => {
    VOLATILITY_MARKETS.forEach(market => {
      if (!marketDigitsRef.current[market]) {
        marketDigitsRef.current[market] = generateMockTicks(market, 1000);
      }
    });
    
    analyzeAllMarkets();
  }, []);

  // Continuous analysis every 30 seconds
  useEffect(() => {
    if (analysisIntervalRef.current) {
      clearInterval(analysisIntervalRef.current);
    }
    
    analysisIntervalRef.current = setInterval(() => {
      analyzeAllMarkets();
    }, 30000);
    
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
      if (marketDigits.length >= 100) {
        const analysis = analyzeDigits(marketDigits);
        newMarketsData[market] = {
          symbol: market,
          digits: marketDigits.slice(-100),
          analysis,
          lastUpdate: Date.now()
        };
      }
    }
    
    setMarketsData(newMarketsData);
    setLastScanTime(new Date());
    
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
  const getContractDetails = (botType: string, selectedDigit?: number): { contract: string; barrier?: number } => {
    switch(botType) {
      case 'EVEN': return { contract: 'DIGITEVEN' };
      case 'ODD': return { contract: 'DIGITODD' };
      case 'OVER_3': return { contract: 'DIGITOVER', barrier: 3 };
      case 'UNDER_6': return { contract: 'DIGITUNDER', barrier: 6 };
      case 'OVER_5': return { contract: 'DIGITOVER', barrier: selectedDigit || 5 };
      case 'UNDER_5': return { contract: 'DIGITUNDER', barrier: selectedDigit || 5 };
      case 'OVER_7': return { contract: 'DIGITOVER', barrier: selectedDigit || 7 };
      case 'UNDER_7': return { contract: 'DIGITUNDER', barrier: selectedDigit || 7 };
      default: return { contract: 'DIGITEVEN' };
    }
  };

  // Bot controls
  const startBot = (botId: string) => {
    const bot = bots.find(b => b.id === botId);
    if (!bot || bot.isRunning) return;
    
    toast.success(`${bot.name} bot started`, {
      description: `Trading on ${bot.currentMarket}`,
      icon: '🚀'
    });
    
    setBots(prev => prev.map(b => b.id === botId ? { 
      ...b, 
      isRunning: true, 
      status: 'analyzing'
    } : b));
    
    botRunningRefs.current[botId] = true;
  };

  const pauseBot = (botId: string) => {
    botPausedRefs.current[botId] = !botPausedRefs.current[botId];
    setBots(prev => prev.map(b => b.id === botId ? { ...b, isPaused: botPausedRefs.current[botId] } : b));
    
    toast.info(`Bot ${botPausedRefs.current[botId] ? 'paused' : 'resumed'}`);
  };

  const stopBot = (botId: string) => {
    botRunningRefs.current[botId] = false;
    setBots(prev => prev.map(b => b.id === botId ? { 
      ...b, 
      isRunning: false, 
      isPaused: false,
      status: 'idle'
    } : b));
    
    toast.warning(`${bots.find(b => b.id === botId)?.name} stopped`);
  };

  const stopAllBots = () => {
    bots.forEach(bot => {
      botRunningRefs.current[bot.id] = false;
    });
    setBots(prev => prev.map(b => ({ 
      ...b, 
      isRunning: false, 
      isPaused: false,
      status: 'idle'
    })));
    
    toast.warning('All bots stopped');
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
    if (market.startsWith('1HZ')) return { icon: '⚡', name: market, color: 'text-yellow-400' };
    if (market.startsWith('R_')) return { icon: '📊', name: market, color: 'text-blue-400' };
    if (market.includes('BOOM')) return { icon: '💥', name: market, color: 'text-orange-400' };
    if (market.includes('CRASH')) return { icon: '📉', name: market, color: 'text-red-400' };
    if (market.includes('RDBEAR')) return { icon: '🐻', name: market, color: 'text-amber-400' };
    if (market.includes('RDBULL')) return { icon: '🐂', name: market, color: 'text-green-400' };
    if (market.includes('JD')) return { icon: '🦘', name: market, color: 'text-purple-400' };
    return { icon: '📈', name: market, color: 'text-gray-400' };
  };

  // Calculate totals
  const totalProfit = bots.reduce((sum, bot) => sum + bot.totalPnl, 0);
  const totalTrades = bots.reduce((sum, bot) => sum + bot.trades, 0);
  const totalWins = bots.reduce((sum, bot) => sum + bot.wins, 0);
  const winRate = totalTrades > 0 ? ((totalWins / totalTrades) * 100).toFixed(1) : '0';

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 p-6">
      {/* Animated background effect */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-blue-500/10 rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-purple-500/10 rounded-full blur-3xl animate-pulse delay-1000"></div>
      </div>

      <div className="relative max-w-7xl mx-auto space-y-6">
        {/* Premium Header */}
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="backdrop-blur-xl bg-gray-900/50 border border-gray-800/50 rounded-2xl p-6 shadow-2xl"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-blue-600 to-purple-600 rounded-2xl blur-xl opacity-50"></div>
                <div className="relative bg-gradient-to-r from-blue-600 to-purple-600 p-3 rounded-xl">
                  <Layers className="w-6 h-6 text-white" />
                </div>
              </div>
              <div>
                <h1 className="text-2xl font-bold bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
                  Deriv Trading System
                </h1>
                <p className="text-sm text-gray-500 flex items-center gap-2">
                  <Globe className="w-3.5 h-3.5" />
                  <span>8 Active Strategies • Auto Market Switching • Real-time Analysis</span>
                  {lastScanTime && (
                    <>
                      <span className="w-1 h-1 bg-gray-600 rounded-full"></span>
                      <span>Last scan: {lastScanTime.toLocaleTimeString()}</span>
                    </>
                  )}
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={runAnalysis}
                disabled={isAnalyzing}
                className="border-gray-700 hover:border-gray-600 bg-gray-800/50 hover:bg-gray-800 text-gray-300"
              >
                {isAnalyzing ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4 mr-2" />
                )}
                Analyze
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={clearAll}
                className="border-gray-700 hover:border-gray-600 bg-gray-800/50 hover:bg-gray-800 text-gray-300"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Clear
              </Button>
              <Button 
                variant="destructive" 
                size="sm" 
                onClick={stopAllBots} 
                disabled={!bots.some(b => b.isRunning)}
                className="bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30"
              >
                <StopCircle className="w-4 h-4 mr-2" />
                Stop All
              </Button>
            </div>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-5 gap-4 mt-6">
            <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700/50 rounded-xl p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-500/20 rounded-lg">
                  <Activity className="w-4 h-4 text-blue-400" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">Balance</p>
                  <p className="text-xl font-bold text-white">${balance?.toFixed(2) || '10,000.00'}</p>
                </div>
              </div>
            </div>
            
            <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700/50 rounded-xl p-4">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${totalProfit >= 0 ? 'bg-green-500/20' : 'bg-red-500/20'}`}>
                  <BarChart3 className={`w-4 h-4 ${totalProfit >= 0 ? 'text-green-400' : 'text-red-400'}`} />
                </div>
                <div>
                  <p className="text-xs text-gray-500">Total P&L</p>
                  <p className={`text-xl font-bold ${totalProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    ${totalProfit.toFixed(2)}
                  </p>
                </div>
              </div>
            </div>
            
            <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700/50 rounded-xl p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-purple-500/20 rounded-lg">
                  <PieChart className="w-4 h-4 text-purple-400" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">Win Rate</p>
                  <p className="text-xl font-bold text-white">{winRate}%</p>
                </div>
              </div>
            </div>
            
            <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700/50 rounded-xl p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-orange-500/20 rounded-lg">
                  <LineChart className="w-4 h-4 text-orange-400" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">Total Trades</p>
                  <p className="text-xl font-bold text-white">{totalTrades}</p>
                </div>
              </div>
            </div>
            
            <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700/50 rounded-xl p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-500/20 rounded-lg">
                  <Target className="w-4 h-4 text-emerald-400" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">Active</p>
                  <p className="text-xl font-bold text-white">{bots.filter(b => b.isRunning).length}/8</p>
                </div>
              </div>
            </div>
          </div>

          {/* Settings Bar */}
          <div className="grid grid-cols-4 gap-4 mt-4">
            <div className="relative">
              <label className="text-xs text-gray-500 mb-1 block">Stake ($)</label>
              <input 
                type="number" 
                value={globalStake} 
                onChange={(e) => setGlobalStake(parseFloat(e.target.value) || 0.5)}
                className="w-full bg-gray-800/50 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                step="0.1"
                min="0.1"
              />
            </div>
            <div className="relative">
              <label className="text-xs text-gray-500 mb-1 block">Multiplier</label>
              <input 
                type="number" 
                value={globalMultiplier} 
                onChange={(e) => setGlobalMultiplier(parseFloat(e.target.value) || 2)}
                className="w-full bg-gray-800/50 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                step="0.1"
                min="1.1"
              />
            </div>
            <div className="relative">
              <label className="text-xs text-gray-500 mb-1 block">Stop Loss ($)</label>
              <input 
                type="number" 
                value={globalStopLoss} 
                onChange={(e) => setGlobalStopLoss(parseFloat(e.target.value) || 30)}
                className="w-full bg-gray-800/50 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
              />
            </div>
            <div className="relative">
              <label className="text-xs text-gray-500 mb-1 block">Take Profit ($)</label>
              <input 
                type="number" 
                value={globalTakeProfit} 
                onChange={(e) => setGlobalTakeProfit(parseFloat(e.target.value) || 5)}
                className="w-full bg-gray-800/50 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
              />
            </div>
          </div>
        </motion.div>

        {/* Bots Grid */}
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="grid grid-cols-4 gap-4"
        >
          {bots.map((bot) => {
            const marketData = marketsData[bot.currentMarket];
            const market = getMarketDisplay(bot.currentMarket);
            
            return (
              <motion.div
                key={bot.id}
                whileHover={{ scale: 1.02, y: -2 }}
                className={`relative overflow-hidden rounded-xl bg-gradient-to-br ${bot.color} p-[1px] group ${
                  bot.isRunning ? 'shadow-lg shadow-blue-500/20' : ''
                }`}
              >
                <div className="relative bg-gray-900/90 backdrop-blur-sm rounded-xl p-4 h-full">
                  {/* Status indicator */}
                  <div className={`absolute top-3 right-3 w-2 h-2 rounded-full ${
                    bot.isRunning ? 'bg-green-500 animate-pulse' : 'bg-gray-600'
                  }`}></div>
                  
                  {/* Header */}
                  <div className="flex items-center gap-2 mb-3">
                    <div className={`p-2 rounded-lg bg-gradient-to-br ${bot.color} bg-opacity-20`}>
                      <div className="text-white">{bot.icon}</div>
                    </div>
                    <div>
                      <h3 className="font-semibold text-white text-sm">{bot.name}</h3>
                      <p className="text-[10px] text-gray-500">
                        Switches: {bot.marketSwitchCount}
                      </p>
                    </div>
                  </div>

                  {/* Market Info */}
                  <div className="bg-gray-800/50 rounded-lg p-2 mb-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-500">Market</span>
                      <span className={`font-mono font-medium ${market.color}`}>
                        {market.icon} {market.name}
                      </span>
                    </div>
                    {marketData && (
                      <>
                        <div className="flex justify-between text-[10px] mt-1">
                          <span className="text-gray-600">Signal</span>
                          <span className={marketData.analysis.signal === bot.type ? 'text-green-400 font-bold' : 'text-gray-500'}>
                            {marketData.analysis.signal || 'NONE'}
                          </span>
                        </div>
                        <div className="flex justify-between text-[10px]">
                          <span className="text-gray-600">Most</span>
                          <span className="text-white font-mono">{marketData.analysis.mostAppearing}</span>
                        </div>
                        <div className="flex justify-between text-[10px]">
                          <span className="text-gray-600">2nd Least</span>
                          <span className="text-white font-mono">{marketData.analysis.secondLeast}</span>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Stats */}
                  <div className="grid grid-cols-2 gap-1 text-[10px] mb-3">
                    <div>
                      <span className="text-gray-600">P&L</span>
                      <span className={`ml-1 font-mono ${
                        bot.totalPnl > 0 ? 'text-green-400' : bot.totalPnl < 0 ? 'text-red-400' : 'text-white'
                      }`}>
                        ${bot.totalPnl.toFixed(2)}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-600">W</span>
                      <span className="ml-1 font-mono text-green-400">{bot.wins}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">L</span>
                      <span className="ml-1 font-mono text-red-400">{bot.losses}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">Stake</span>
                      <span className="ml-1 font-mono text-white">${bot.currentStake.toFixed(2)}</span>
                    </div>
                  </div>

                  {/* Controls */}
                  <div className="flex gap-1">
                    {!bot.isRunning ? (
                      <Button
                        onClick={() => startBot(bot.id)}
                        size="sm"
                        className="flex-1 h-7 text-xs bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white border-0"
                      >
                        <Play className="w-3 h-3 mr-1" /> Start
                      </Button>
                    ) : (
                      <>
                        <Button
                          onClick={() => pauseBot(bot.id)}
                          size="sm"
                          variant="outline"
                          className="flex-1 h-7 text-xs border-gray-700 hover:bg-gray-800 text-gray-300"
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
                </div>
              </motion.div>
            );
          })}
        </motion.div>

        {/* Market Signals Dashboard */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="backdrop-blur-xl bg-gray-900/50 border border-gray-800/50 rounded-2xl p-6"
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <GitCompare className="w-5 h-5 text-blue-400" />
              Live Market Signals
            </h2>
            <Badge variant="outline" className="border-gray-700 text-gray-400">
              {Object.keys(marketsData).length} Markets
            </Badge>
          </div>
          
          <div className="grid grid-cols-2 gap-3 max-h-96 overflow-y-auto custom-scrollbar pr-2">
            {Object.entries(marketsData).length > 0 ? (
              Object.entries(marketsData).map(([symbol, data]) => {
                const market = getMarketDisplay(symbol);
                return (
                  <motion.div
                    key={symbol}
                    whileHover={{ scale: 1.01 }}
                    className="bg-gray-800/30 border border-gray-700/50 rounded-xl p-3"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-semibold ${market.color}`}>
                          {market.icon} {market.name}
                        </span>
                      </div>
                      <Badge className={`text-[10px] ${
                        data.analysis.signal === 'EVEN' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' :
                        data.analysis.signal === 'ODD' ? 'bg-purple-500/20 text-purple-400 border-purple-500/30' :
                        data.analysis.signal === 'OVER_3' ? 'bg-blue-500/20 text-blue-400 border-blue-500/30' :
                        data.analysis.signal === 'UNDER_6' ? 'bg-orange-500/20 text-orange-400 border-orange-500/30' :
                        data.analysis.signal === 'OVER_5' ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30' :
                        data.analysis.signal === 'UNDER_5' ? 'bg-pink-500/20 text-pink-400 border-pink-500/30' :
                        data.analysis.signal === 'OVER_7' ? 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30' :
                        data.analysis.signal === 'UNDER_7' ? 'bg-amber-500/20 text-amber-400 border-amber-500/30' :
                        'bg-gray-500/20 text-gray-400 border-gray-500/30'
                      }`}>
                        {data.analysis.signal || 'NO SIGNAL'}
                      </Badge>
                    </div>
                    
                    {/* Last 12 Digits */}
                    <div className="mb-2">
                      <span className="text-[9px] text-gray-600 block mb-1">Last 12 ticks</span>
                      <div className="flex gap-1">
                        {data.analysis.lastTwelveTicks.map((digit, i) => (
                          <span
                            key={i}
                            className={`w-5 h-5 flex items-center justify-center text-[9px] font-mono rounded ${
                              digit > 5 ? 'bg-blue-500/20 text-blue-400' :
                              digit < 5 ? 'bg-orange-500/20 text-orange-400' :
                              'bg-purple-500/20 text-purple-400'
                            }`}
                          >
                            {digit}
                          </span>
                        ))}
                      </div>
                    </div>
                    
                    {/* Stats Grid */}
                    <div className="grid grid-cols-3 gap-2 text-[9px]">
                      <div className="bg-gray-800/50 rounded p-1.5">
                        <div className="text-gray-600 mb-1">Most</div>
                        <div className="font-mono font-bold text-white">{data.analysis.mostAppearing}</div>
                        <div className="text-gray-500">{data.analysis.percentages[data.analysis.mostAppearing]?.toFixed(1)}%</div>
                      </div>
                      <div className="bg-gray-800/50 rounded p-1.5">
                        <div className="text-gray-600 mb-1">2nd Most</div>
                        <div className="font-mono font-bold text-white">{data.analysis.secondMost}</div>
                        <div className="text-gray-500">{data.analysis.percentages[data.analysis.secondMost]?.toFixed(1)}%</div>
                      </div>
                      <div className="bg-gray-800/50 rounded p-1.5">
                        <div className="text-gray-600 mb-1">2nd Least</div>
                        <div className="font-mono font-bold text-white">{data.analysis.secondLeast}</div>
                        <div className="text-gray-500">{data.analysis.percentages[data.analysis.secondLeast]?.toFixed(1)}%</div>
                      </div>
                    </div>
                    
                    {/* Percentages */}
                    <div className="grid grid-cols-4 gap-1 mt-2">
                      <div className="text-center">
                        <div className="text-[8px] text-gray-600">Even</div>
                        <div className="text-[9px] font-mono text-emerald-400">{data.analysis.evenPercentage.toFixed(1)}%</div>
                      </div>
                      <div className="text-center">
                        <div className="text-[8px] text-gray-600">Odd</div>
                        <div className="text-[9px] font-mono text-purple-400">{data.analysis.oddPercentage.toFixed(1)}%</div>
                      </div>
                      <div className="text-center">
                        <div className="text-[8px] text-gray-600">Over 3</div>
                        <div className="text-[9px] font-mono text-blue-400">{data.analysis.over3Percentage.toFixed(1)}%</div>
                      </div>
                      <div className="text-center">
                        <div className="text-[8px] text-gray-600">Under 6</div>
                        <div className="text-[9px] font-mono text-orange-400">{data.analysis.under6Percentage.toFixed(1)}%</div>
                      </div>
                    </div>
                  </motion.div>
                );
              })
            ) : (
              <div className="col-span-2 text-center py-8 text-gray-500">
                No market data available. Click Analyze to scan markets.
              </div>
            )}
          </div>
        </motion.div>

        {/* Trade Log */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="backdrop-blur-xl bg-gray-900/50 border border-gray-800/50 rounded-2xl p-6"
        >
          <div className="flex items-center gap-2 mb-4">
            <Bell className="w-5 h-5 text-purple-400" />
            <h2 className="text-lg font-semibold text-white">Live Trade Log</h2>
          </div>
          
          <div className="space-y-1 max-h-48 overflow-y-auto custom-scrollbar pr-2">
            {trades.length === 0 ? (
              <div className="text-center py-4 text-gray-500 text-sm">
                No trades yet. Start a bot to see activity.
              </div>
            ) : (
              trades.map((trade, idx) => {
                const market = getMarketDisplay(trade.market);
                return (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    className="flex items-center justify-between py-2 px-3 bg-gray-800/30 rounded-lg border border-gray-700/30 text-xs"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-gray-500 text-[10px]">{trade.time}</span>
                      <Badge variant="outline" className="text-[8px] px-1.5 py-0 border-gray-700">
                        {trade.bot}
                      </Badge>
                      <span className={`font-mono text-[10px] ${market.color}`}>
                        {market.icon} {trade.market}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      {trade.signalType && (
                        <Badge className="text-[7px] px-1.5 py-0 bg-blue-500/20 text-blue-400 border-blue-500/30">
                          {trade.signalType}
                        </Badge>
                      )}
                      <span className="font-mono text-[9px] text-gray-400">
                        Last: {trade.lastDigit ?? '—'}
                      </span>
                      <span className="font-mono text-white">${trade.stake.toFixed(2)}</span>
                      <span className={`font-mono w-14 text-right ${
                        trade.result === 'Win' ? 'text-green-400' : 
                        trade.result === 'Loss' ? 'text-red-400' : 
                        'text-gray-500'
                      }`}>
                        {trade.result === 'Win' ? `+$${trade.pnl.toFixed(2)}` : 
                         trade.result === 'Loss' ? `-$${Math.abs(trade.pnl).toFixed(2)}` : 
                         '⏳'}
                      </span>
                    </div>
                  </motion.div>
                );
              })
            )}
          </div>
        </motion.div>
      </div>

      <style jsx>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(31, 41, 55, 0.5);
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(75, 85, 99, 0.8);
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(107, 114, 128, 0.8);
        }
      `}</style>
    </div>
  );
}
