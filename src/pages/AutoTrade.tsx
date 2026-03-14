import { useState, useRef, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { derivApi } from '@/services/deriv-api';
import { useAuth } from '@/contexts/AuthContext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Loader2, Play, StopCircle, Pause, TrendingUp, TrendingDown, 
  CircleDot, RefreshCw, Trash2, DollarSign, Volume2, AlertCircle,
  CheckCircle2, XCircle, Clock, Zap, Shield, Target, Activity,
  BarChart3, LineChart, PieChart, Radio, ScanLine, Sparkles
} from 'lucide-react';

interface DigitFrequency {
  digit: number;
  count: number;
  percentage: number;
}

interface MarketAnalysis {
  symbol: string;
  displayName: string;
  mostAppearing: number;
  secondMost: number;
  thirdMost: number;
  leastAppearing: number;
  digitFrequencies: DigitFrequency[];
  evenPercentage: number;
  oddPercentage: number;
  overUnderStats: {
    over3: number;
    under6: number;
    over1: number;
    under8: number;
  };
  conditions: {
    over1: boolean;
    under8: boolean;
    even: boolean;
    odd: boolean;
    over3: boolean;
    under6: boolean;
  };
}

interface BotMatch {
  market: string;
  botId: string;
  botName: string;
  botType: string;
  analysis: MarketAnalysis;
  status: 'waiting' | 'monitoring' | 'triggered' | 'trading' | 'completed';
  entryCondition: boolean;
  lastDigits?: number[];
}

interface BotStrategy {
  id: string;
  name: string;
  type: 'over1' | 'under8' | 'even' | 'odd' | 'over3' | 'under6';
  icon: JSX.Element;
  color: string;
  bgColor: string;
  borderColor: string;
  contractType: string;
  barrier?: number;
  recoveryLogic: string;
  description: string;
  condition: (analysis: MarketAnalysis) => boolean;
  entryCondition: (digits: number[]) => boolean;
}

interface BotInstance extends BotMatch {
  isRunning: boolean;
  isPaused: boolean;
  currentStake: number;
  totalPnl: number;
  trades: number;
  wins: number;
  losses: number;
  consecutiveLosses: number;
  lastTradeResult?: 'win' | 'loss';
}

const ALL_MARKETS = [
  // Volatility Indices
  { symbol: 'R_10', name: 'Volatility 10', icon: '📈' },
  { symbol: 'R_25', name: 'Volatility 25', icon: '📈' },
  { symbol: 'R_50', name: 'Volatility 50', icon: '📈' },
  { symbol: 'R_75', name: 'Volatility 75', icon: '📈' },
  { symbol: 'R_100', name: 'Volatility 100', icon: '📈' },
  // 1HZ Volatility
  { symbol: '1HZ10V', name: '1HZ Volatility 10', icon: '⚡' },
  { symbol: '1HZ25V', name: '1HZ Volatility 25', icon: '⚡' },
  { symbol: '1HZ50V', name: '1HZ Volatility 50', icon: '⚡' },
  { symbol: '1HZ75V', name: '1HZ Volatility 75', icon: '⚡' },
  { symbol: '1HZ100V', name: '1HZ Volatility 100', icon: '⚡' },
  // Jump Indices
  { symbol: 'JD10', name: 'Jump 10', icon: '🦘' },
  { symbol: 'JD25', name: 'Jump 25', icon: '🦘' },
  { symbol: 'JD50', name: 'Jump 50', icon: '🦘' },
  { symbol: 'JD75', name: 'Jump 75', icon: '🦘' },
  { symbol: 'JD100', name: 'Jump 100', icon: '🦘' },
  // Boom & Crash
  { symbol: 'BOOM300', name: 'Boom 300', icon: '💥' },
  { symbol: 'BOOM500', name: 'Boom 500', icon: '💥' },
  { symbol: 'BOOM1000', name: 'Boom 1000', icon: '💥' },
  { symbol: 'CRASH300', name: 'Crash 300', icon: '📉' },
  { symbol: 'CRASH500', name: 'Crash 500', icon: '📉' },
  { symbol: 'CRASH1000', name: 'Crash 1000', icon: '📉' },
  // Bear & Bull
  { symbol: 'RDBEAR', name: 'Bear Market', icon: '🐻' },
  { symbol: 'RDBULL', name: 'Bull Market', icon: '🐂' }
];

const BOT_STRATEGIES: BotStrategy[] = [
  {
    id: 'bot1',
    name: 'OVER 1 BOT',
    type: 'over1',
    icon: <TrendingUp className="w-5 h-5" />,
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/20',
    borderColor: 'border-blue-500/30',
    contractType: 'DIGITOVER',
    barrier: 1,
    recoveryLogic: 'Over 3',
    description: 'Trades when digits are OVER 1 after two consecutive digits below 2',
    condition: (analysis: MarketAnalysis) => {
      return analysis.conditions.over1;
    },
    entryCondition: (digits: number[]) => {
      if (digits.length < 2) return false;
      const lastTwo = digits.slice(-2);
      return lastTwo.every(d => d < 2);
    }
  },
  {
    id: 'bot2',
    name: 'UNDER 8 BOT',
    type: 'under8',
    icon: <TrendingDown className="w-5 h-5" />,
    color: 'text-orange-400',
    bgColor: 'bg-orange-500/20',
    borderColor: 'border-orange-500/30',
    contractType: 'DIGITUNDER',
    barrier: 8,
    recoveryLogic: 'Under 6',
    description: 'Trades when digits are UNDER 8 after two consecutive digits above 7',
    condition: (analysis: MarketAnalysis) => {
      return analysis.conditions.under8;
    },
    entryCondition: (digits: number[]) => {
      if (digits.length < 2) return false;
      const lastTwo = digits.slice(-2);
      return lastTwo.every(d => d > 7);
    }
  },
  {
    id: 'bot3',
    name: 'EVEN BOT',
    type: 'even',
    icon: <CircleDot className="w-5 h-5" />,
    color: 'text-green-400',
    bgColor: 'bg-green-500/20',
    borderColor: 'border-green-500/30',
    contractType: 'DIGITEVEN',
    recoveryLogic: 'None',
    description: 'Trades EVEN digits after three consecutive odd digits',
    condition: (analysis: MarketAnalysis) => {
      return analysis.conditions.even;
    },
    entryCondition: (digits: number[]) => {
      if (digits.length < 3) return false;
      const lastThree = digits.slice(-3);
      return lastThree.every(d => d % 2 === 1);
    }
  },
  {
    id: 'bot4',
    name: 'ODD BOT',
    type: 'odd',
    icon: <CircleDot className="w-5 h-5" />,
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/20',
    borderColor: 'border-purple-500/30',
    contractType: 'DIGITODD',
    recoveryLogic: 'None',
    description: 'Trades ODD digits after three consecutive even digits',
    condition: (analysis: MarketAnalysis) => {
      return analysis.conditions.odd;
    },
    entryCondition: (digits: number[]) => {
      if (digits.length < 3) return false;
      const lastThree = digits.slice(-3);
      return lastThree.every(d => d % 2 === 0);
    }
  },
  {
    id: 'bot5',
    name: 'OVER 3 BOT',
    type: 'over3',
    icon: <TrendingUp className="w-5 h-5" />,
    color: 'text-cyan-400',
    bgColor: 'bg-cyan-500/20',
    borderColor: 'border-cyan-500/30',
    contractType: 'DIGITOVER',
    barrier: 3,
    recoveryLogic: 'None',
    description: 'Trades OVER 3 after three consecutive digits below 3',
    condition: (analysis: MarketAnalysis) => {
      return analysis.conditions.over3;
    },
    entryCondition: (digits: number[]) => {
      if (digits.length < 3) return false;
      const lastThree = digits.slice(-3);
      return lastThree.every(d => d < 3);
    }
  },
  {
    id: 'bot6',
    name: 'UNDER 6 BOT',
    type: 'under6',
    icon: <TrendingDown className="w-5 h-5" />,
    color: 'text-rose-400',
    bgColor: 'bg-rose-500/20',
    borderColor: 'border-rose-500/30',
    contractType: 'DIGITUNDER',
    barrier: 6,
    recoveryLogic: 'None',
    description: 'Trades UNDER 6 after three consecutive digits above 6',
    condition: (analysis: MarketAnalysis) => {
      return analysis.conditions.under6;
    },
    entryCondition: (digits: number[]) => {
      if (digits.length < 3) return false;
      const lastThree = digits.slice(-3);
      return lastThree.every(d => d > 6);
    }
  }
];

// Voice Alert System
class VoiceAlertSystem {
  private static instance: VoiceAlertSystem;
  private synthesis: SpeechSynthesis | null = null;
  private speaking: boolean = false;

  private constructor() {
    if (typeof window !== 'undefined') {
      this.synthesis = window.speechSynthesis;
    }
  }

  static getInstance(): VoiceAlertSystem {
    if (!VoiceAlertSystem.instance) {
      VoiceAlertSystem.instance = new VoiceAlertSystem();
    }
    return VoiceAlertSystem.instance;
  }

  speak(text: string, isScary: boolean = true) {
    if (!this.synthesis || this.speaking) return;

    const utterance = new SpeechSynthesisUtterance(text);
    
    if (isScary) {
      utterance.pitch = 0.2;
      utterance.rate = 0.7;
      utterance.volume = 1;
      
      const voices = this.synthesis.getVoices();
      const deepVoice = voices.find(voice => 
        voice.name.includes('Daniel') || 
        voice.name.includes('Deep') || 
        voice.name.includes('Male')
      );
      if (deepVoice) utterance.voice = deepVoice;
    }

    utterance.onend = () => { this.speaking = false; };
    utterance.onerror = () => { this.speaking = false; };

    this.speaking = true;
    this.synthesis.speak(utterance);
  }

  scanAnnouncement() {
    this.speak("Scanning the markets for money… stay ready.", true);
  }

  signalFound() {
    this.speak("Signal found. Prepare to trade.", true);
  }

  botStarted(botName: string) {
    this.speak(`${botName} is now active. Monitoring for entry.`, true);
  }
}

// Background animation component
const DollarBackground = () => {
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
      {[...Array(30)].map((_, i) => (
        <motion.div
          key={i}
          className="absolute text-green-500/5 font-bold text-4xl"
          initial={{ 
            x: Math.random() * (typeof window !== 'undefined' ? window.innerWidth : 1000),
            y: (typeof window !== 'undefined' ? window.innerHeight : 800) + 100,
            rotate: Math.random() * 360,
            scale: 0.5 + Math.random() * 1.5
          }}
          animate={{ 
            y: -200,
            rotate: Math.random() * 720,
            x: `+=${Math.random() * 200 - 100}`
          }}
          transition={{
            duration: 15 + Math.random() * 20,
            repeat: Infinity,
            delay: Math.random() * 10,
            ease: "linear"
          }}
        >
          {Math.random() > 0.5 ? '$' : '₿'}
        </motion.div>
      ))}
    </div>
  );
};

export default function AutoTrade() {
  const { isAuthorized, balance } = useAuth();
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanningMarket, setScanningMarket] = useState('');
  const [marketDigits, setMarketDigits] = useState<Record<string, number[]>>({});
  const [marketAnalyses, setMarketAnalyses] = useState<Record<string, MarketAnalysis>>({});
  const [matchedSignals, setMatchedSignals] = useState<BotMatch[]>([]);
  const [noSignal, setNoSignal] = useState(false);
  const [activeTab, setActiveTab] = useState('signals');
  
  // Bot instances with trading capabilities
  const [botInstances, setBotInstances] = useState<BotInstance[]>([]);
  const [globalStake, setGlobalStake] = useState(1.00);
  const [globalMultiplier, setGlobalMultiplier] = useState(2.0);
  
  const voiceSystem = useRef(VoiceAlertSystem.getInstance());
  const scanIntervalRef = useRef<NodeJS.Timeout>();
  const voiceIntervalRef = useRef<NodeJS.Timeout>();

  // Fetch ticks for a single market
  const fetchTicks = async (market: string): Promise<number[]> => {
    try {
      const ticks = await derivApi.getTicks(market, 1000);
      return ticks.map((tick: any) => {
        const quote = tick.quote.toString();
        return parseInt(quote.charAt(quote.length - 1));
      });
    } catch (error) {
      console.error(`Error fetching ticks for ${market}:`, error);
      return [];
    }
  };

  // Analyze digit frequencies
  const analyzeDigits = (symbol: string, digits: number[]): MarketAnalysis => {
    if (digits.length < 1000) {
      throw new Error('Insufficient tick data');
    }

    // Count frequencies
    const frequencies: DigitFrequency[] = Array.from({ length: 10 }, (_, i) => ({
      digit: i,
      count: digits.filter(d => d === i).length,
      percentage: (digits.filter(d => d === i).length / digits.length) * 100
    }));

    // Sort by count descending
    frequencies.sort((a, b) => b.count - a.count);

    // Calculate even/odd percentages
    const evenCount = digits.filter(d => d % 2 === 0).length;
    const oddCount = digits.filter(d => d % 2 === 1).length;

    // Calculate over/under stats
    const over3Count = digits.filter(d => d > 3).length;
    const under6Count = digits.filter(d => d < 6).length;
    const over1Count = digits.filter(d => d > 1).length;
    const under8Count = digits.filter(d => d < 8).length;

    // Check conditions for each bot
    const conditions = {
      over1: frequencies[0].digit > 4 && frequencies[1].digit > 4 && frequencies[9].digit > 4,
      under8: frequencies[0].digit < 6 && frequencies[1].digit < 6 && frequencies[9].digit < 6,
      even: frequencies[0].digit % 2 === 0 && frequencies[1].digit % 2 === 0 && frequencies[9].digit % 2 === 0,
      odd: frequencies[0].digit % 2 === 1 && frequencies[1].digit % 2 === 1 && frequencies[2].digit % 2 === 1,
      over3: frequencies[0].digit > 4 && frequencies[1].digit > 4 && frequencies[9].digit > 4,
      under6: frequencies[0].digit < 5 && frequencies[1].digit < 5 && frequencies[9].digit < 5
    };

    const marketInfo = ALL_MARKETS.find(m => m.symbol === symbol);

    return {
      symbol,
      displayName: marketInfo?.name || symbol,
      mostAppearing: frequencies[0].digit,
      secondMost: frequencies[1].digit,
      thirdMost: frequencies[2].digit,
      leastAppearing: frequencies[9].digit,
      digitFrequencies: frequencies,
      evenPercentage: (evenCount / digits.length) * 100,
      oddPercentage: (oddCount / digits.length) * 100,
      overUnderStats: {
        over3: (over3Count / digits.length) * 100,
        under6: (under6Count / digits.length) * 100,
        over1: (over1Count / digits.length) * 100,
        under8: (under8Count / digits.length) * 100
      },
      conditions
    };
  };

  // Detect bot signals from analysis
  const detectBotSignals = (analysis: MarketAnalysis): string[] => {
    const matchedBots: string[] = [];

    BOT_STRATEGIES.forEach(bot => {
      if (bot.condition(analysis)) {
        matchedBots.push(bot.id);
      }
    });

    return matchedBots;
  };

  // Start a bot instance
  const startBot = (match: BotMatch) => {
    if (!isAuthorized) {
      toast.error('Please connect your account first');
      return;
    }

    if (balance < globalStake) {
      toast.error('Insufficient balance');
      return;
    }

    const newInstance: BotInstance = {
      ...match,
      isRunning: true,
      isPaused: false,
      currentStake: globalStake,
      totalPnl: 0,
      trades: 0,
      wins: 0,
      losses: 0,
      consecutiveLosses: 0,
      status: 'monitoring'
    };

    setBotInstances(prev => [...prev, newInstance]);
    voiceSystem.current.botStarted(match.botName);
    toast.success(`${match.botName} started on ${match.market}`);
  };

  // Stop a bot instance
  const stopBot = (index: number) => {
    setBotInstances(prev => prev.filter((_, i) => i !== index));
  };

  // Pause/Resume a bot instance
  const togglePauseBot = (index: number) => {
    setBotInstances(prev => prev.map((bot, i) => 
      i === index ? { ...bot, isPaused: !bot.isPaused } : bot
    ));
  };

  // Main scan function
  const startScan = useCallback(async () => {
    if (isScanning) return;

    setIsScanning(true);
    setNoSignal(false);
    setMatchedSignals([]);
    setScanProgress(0);
    setMarketAnalyses({});

    // Start voice announcements
    voiceSystem.current.scanAnnouncement();
    
    voiceIntervalRef.current = setInterval(() => {
      voiceSystem.current.scanAnnouncement();
    }, 20000);

    const newMarketDigits: Record<string, number[]> = {};
    const newAnalyses: Record<string, MarketAnalysis> = {};
    const newMatches: BotMatch[] = [];
    const usedBots = new Set<string>();

    try {
      // Scan all markets
      for (let i = 0; i < ALL_MARKETS.length; i++) {
        const market = ALL_MARKETS[i].symbol;
        
        // Update progress
        setScanProgress(Math.round(((i + 1) / ALL_MARKETS.length) * 100));
        setScanningMarket(market);

        // Fetch ticks
        const digits = await fetchTicks(market);
        if (digits.length >= 1000) {
          newMarketDigits[market] = digits;

          // Analyze digits
          const analysis = analyzeDigits(market, digits);
          newAnalyses[market] = analysis;

          // Detect matching bots
          const matchingBotIds = detectBotSignals(analysis);

          // Add matches (only one per bot)
          for (const botId of matchingBotIds) {
            if (!usedBots.has(botId)) {
              const bot = BOT_STRATEGIES.find(b => b.id === botId)!;
              usedBots.add(botId);
              
              newMatches.push({
                market,
                botId,
                botName: bot.name,
                botType: bot.type,
                analysis,
                status: 'waiting',
                entryCondition: false
              });
              break; // Only take first matching bot for this market
            }
          }
        }

        // Small delay to prevent rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      setMarketDigits(newMarketDigits);
      setMarketAnalyses(newAnalyses);
      
      if (newMatches.length > 0) {
        setMatchedSignals(newMatches);
        voiceSystem.current.signalFound();
        toast.success(`Found ${newMatches.length} trading signals!`);
      } else {
        setNoSignal(true);
        toast.info('NO SIGNAL FOUND');
      }

    } catch (error) {
      console.error('Scan error:', error);
      toast.error('Scan failed');
    } finally {
      setIsScanning(false);
      setScanningMarket('');
      
      if (voiceIntervalRef.current) {
        clearInterval(voiceIntervalRef.current);
      }
    }
  }, [isScanning]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (voiceIntervalRef.current) {
        clearInterval(voiceIntervalRef.current);
      }
    };
  }, []);

  // Get market icon
  const getMarketIcon = (symbol: string) => {
    const market = ALL_MARKETS.find(m => m.symbol === symbol);
    return market?.icon || '📊';
  };

  // Calculate total stats
  const totalStats = {
    activeBots: botInstances.length,
    totalPnl: botInstances.reduce((sum, bot) => sum + bot.totalPnl, 0),
    totalTrades: botInstances.reduce((sum, bot) => sum + bot.trades, 0),
    winRate: botInstances.reduce((sum, bot) => sum + (bot.wins / (bot.trades || 1)) * 100, 0) / (botInstances.length || 1)
  };

  return (
    <div className="relative min-h-screen bg-gradient-to-b from-gray-900 to-gray-950 overflow-hidden">
      <DollarBackground />

      <div className="relative z-10 container mx-auto p-6 max-w-7xl">
        {/* Header with animated gradient */}
        <motion.div 
          className="text-center mb-8"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <h1 className="text-5xl font-bold mb-3 bg-gradient-to-r from-green-400 via-blue-500 to-purple-600 bg-clip-text text-transparent">
            Automated Trading Scanner
          </h1>
          <p className="text-gray-400 text-lg">6 Professional Bots • Real-time Analysis • Automatic Execution</p>
        </motion.div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <Card className="bg-gray-800/50 border-gray-700 backdrop-blur-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-400">Balance</p>
                  <p className="text-2xl font-bold text-white">${balance?.toFixed(2) || '0.00'}</p>
                </div>
                <DollarSign className="w-8 h-8 text-green-400" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gray-800/50 border-gray-700 backdrop-blur-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-400">Active Bots</p>
                  <p className="text-2xl font-bold text-white">{totalStats.activeBots}/6</p>
                </div>
                <Zap className="w-8 h-8 text-yellow-400" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gray-800/50 border-gray-700 backdrop-blur-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-400">Total P&L</p>
                  <p className={`text-2xl font-bold ${totalStats.totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    ${totalStats.totalPnl.toFixed(2)}
                  </p>
                </div>
                <LineChart className="w-8 h-8 text-blue-400" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gray-800/50 border-gray-700 backdrop-blur-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-400">Win Rate</p>
                  <p className="text-2xl font-bold text-white">{totalStats.winRate.toFixed(1)}%</p>
                </div>
                <Target className="w-8 h-8 text-purple-400" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Global Settings */}
        <Card className="bg-gray-800/50 border-gray-700 backdrop-blur-sm mb-6">
          <CardContent className="p-4">
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-400">Stake:</span>
                <input
                  type="number"
                  value={globalStake}
                  onChange={(e) => setGlobalStake(parseFloat(e.target.value) || 1)}
                  step="0.1"
                  min="0.1"
                  className="w-20 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-400">Multiplier:</span>
                <input
                  type="number"
                  value={globalMultiplier}
                  onChange={(e) => setGlobalMultiplier(parseFloat(e.target.value) || 2)}
                  step="0.1"
                  min="1.1"
                  className="w-20 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white"
                />
              </div>
              <div className="flex-1" />
              <Badge variant="outline" className="border-green-500 text-green-400">
                <Volume2 className="w-3 h-3 mr-1" />
                Voice Alerts Active
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* SCAN Button */}
        <div className="flex justify-center mb-8">
          <motion.div
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <Button
              onClick={startScan}
              disabled={isScanning || !isAuthorized}
              size="lg"
              className="relative w-72 h-72 rounded-full bg-gradient-to-r from-green-500 via-blue-500 to-purple-600 hover:from-green-600 hover:via-blue-600 hover:to-purple-700 shadow-2xl"
            >
              <div className="absolute inset-0 rounded-full bg-white/20 animate-ping" />
              <div className="absolute inset-0 rounded-full bg-gradient-to-r from-transparent via-white/10 to-transparent animate-pulse" />
              <div className="relative flex flex-col items-center">
                {isScanning ? (
                  <>
                    <ScanLine className="w-20 h-20 mb-3 animate-spin text-white" />
                    <span className="text-3xl font-bold text-white">SCANNING</span>
                    <span className="text-xl mt-2 text-white/90">{scanProgress}%</span>
                    <span className="text-sm mt-2 text-white/70">{scanningMarket}</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-20 h-20 mb-3 text-white" />
                    <span className="text-3xl font-bold text-white">SCAN</span>
                    <span className="text-xl mt-2 text-white/90">All Markets</span>
                    <span className="text-sm mt-2 text-white/70">{ALL_MARKETS.length} Markets</span>
                  </>
                )}
              </div>
            </Button>
          </motion.div>
        </div>

        {/* Progress Bar */}
        {isScanning && (
          <div className="mb-8">
            <Progress value={scanProgress} className="h-2 bg-gray-700" />
          </div>
        )}

        {/* NO SIGNAL FOUND Message */}
        <AnimatePresence>
          {noSignal && (
            <motion.div 
              className="text-center py-12"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
            >
              <div className="text-7xl mb-4">🔍</div>
              <h2 className="text-4xl font-bold text-gray-400 mb-2">NO SIGNAL FOUND</h2>
              <p className="text-gray-500 text-lg">Try scanning again in a few minutes</p>
              <Button 
                variant="outline" 
                className="mt-4 border-gray-600 text-gray-300"
                onClick={startScan}
                disabled={isScanning}
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Scan Again
              </Button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Main Content Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-6">
          <TabsList className="grid grid-cols-3 w-[400px] mx-auto mb-6 bg-gray-800">
            <TabsTrigger value="signals" className="data-[state=active]:bg-gray-700">Signals</TabsTrigger>
            <TabsTrigger value="bots" className="data-[state=active]:bg-gray-700">Active Bots</TabsTrigger>
            <TabsTrigger value="markets" className="data-[state=active]:bg-gray-700">All Markets</TabsTrigger>
          </TabsList>

          {/* Signals Tab */}
          <TabsContent value="signals">
            {matchedSignals.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {matchedSignals.map((signal, index) => {
                  const bot = BOT_STRATEGIES.find(b => b.id === signal.botId)!;
                  const isBotActive = botInstances.some(b => b.market === signal.market && b.botId === signal.botId);
                  
                  return (
                    <motion.div
                      key={`${signal.market}-${signal.botId}`}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.1 }}
                    >
                      <Card className={`bg-gray-800/80 border-2 ${bot.borderColor} backdrop-blur-sm hover:shadow-lg transition-all`}>
                        <CardHeader className="pb-2">
                          <div className="flex items-start justify-between">
                            <div className="flex items-center gap-2">
                              <div className={`p-2 rounded-lg ${bot.bgColor}`}>
                                <span className="text-2xl">{getMarketIcon(signal.market)}</span>
                              </div>
                              <div>
                                <CardTitle className="text-lg text-white">{signal.analysis.displayName}</CardTitle>
                                <div className="flex items-center gap-2 mt-1">
                                  <Badge className={bot.bgColor + ' ' + bot.color}>
                                    {bot.icon}
                                    <span className="ml-1">{bot.name}</span>
                                  </Badge>
                                </div>
                              </div>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent>
                          {/* Digit Analysis */}
                          <div className="bg-gray-900/50 rounded-lg p-3 mb-3">
                            <div className="grid grid-cols-4 gap-2 text-sm mb-2">
                              <div>
                                <span className="text-gray-400 text-xs">Most</span>
                                <div className="text-xl font-bold text-white">{signal.analysis.mostAppearing}</div>
                              </div>
                              <div>
                                <span className="text-gray-400 text-xs">2nd</span>
                                <div className="text-xl font-bold text-white">{signal.analysis.secondMost}</div>
                              </div>
                              <div>
                                <span className="text-gray-400 text-xs">3rd</span>
                                <div className="text-xl font-bold text-white">{signal.analysis.thirdMost}</div>
                              </div>
                              <div>
                                <span className="text-gray-400 text-xs">Least</span>
                                <div className="text-xl font-bold text-white">{signal.analysis.leastAppearing}</div>
                              </div>
                            </div>

                            {/* Digit Distribution Bars */}
                            <div className="space-y-1 mt-3">
                              {signal.analysis.digitFrequencies.slice(0, 5).map((f, i) => (
                                <div key={i} className="flex items-center gap-2">
                                  <span className="text-xs text-gray-400 w-4">{f.digit}</span>
                                  <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
                                    <motion.div 
                                      className={`h-full ${bot.color.replace('text', 'bg')}`}
                                      initial={{ width: 0 }}
                                      animate={{ width: `${f.percentage}%` }}
                                      transition={{ duration: 0.5, delay: i * 0.1 }}
                                    />
                                  </div>
                                  <span className="text-xs text-gray-400">{f.percentage.toFixed(1)}%</span>
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Bot Info */}
                          <div className="text-xs text-gray-400 mb-3">
                            {bot.description}
                            {bot.recoveryLogic !== 'None' && (
                              <div className="mt-1 text-yellow-400">Recovery: {bot.recoveryLogic}</div>
                            )}
                          </div>

                          {/* Start Button */}
                          {!isBotActive ? (
                            <Button 
                              className="w-full bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700"
                              onClick={() => startBot(signal)}
                              disabled={!isAuthorized}
                            >
                              <Play className="w-4 h-4 mr-2" />
                              Start Bot
                            </Button>
                          ) : (
                            <Button 
                              className="w-full bg-gray-600 cursor-not-allowed"
                              disabled
                            >
                              <CheckCircle2 className="w-4 h-4 mr-2" />
                              Already Active
                            </Button>
                          )}
                        </CardContent>
                      </Card>
                    </motion.div>
                  );
                })}
              </div>
            ) : (
              !noSignal && !isScanning && (
                <div className="text-center py-12 text-gray-500">
                  <Radio className="w-16 h-16 mx-auto mb-4 opacity-50" />
                  <p className="text-lg">No signals yet. Click SCAN to analyze all markets.</p>
                </div>
              )
            )}
          </TabsContent>

          {/* Active Bots Tab */}
          <TabsContent value="bots">
            {botInstances.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {botInstances.map((bot, index) => {
                  const botStrategy = BOT_STRATEGIES.find(b => b.id === bot.botId)!;
                  
                  return (
                    <motion.div
                      key={index}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                    >
                      <Card className={`bg-gray-800/80 border-2 ${botStrategy.borderColor}`}>
                        <CardHeader className="pb-2">
                          <div className="flex items-start justify-between">
                            <div className="flex items-center gap-3">
                              <div className={`p-2 rounded-lg ${botStrategy.bgColor}`}>
                                {botStrategy.icon}
                              </div>
                              <div>
                                <CardTitle className="text-white">{bot.botName}</CardTitle>
                                <p className="text-sm text-gray-400">
                                  {getMarketIcon(bot.market)} {bot.analysis.displayName}
                                </p>
                              </div>
                            </div>
                            <Badge className={
                              bot.status === 'trading' ? 'bg-green-500' :
                              bot.status === 'monitoring' ? 'bg-yellow-500' :
                              bot.status === 'triggered' ? 'bg-purple-500' : 'bg-gray-500'
                            }>
                              {bot.status === 'trading' && 'TRADING'}
                              {bot.status === 'monitoring' && 'MONITORING'}
                              {bot.status === 'triggered' && 'TRIGGERED'}
                              {bot.status === 'waiting' && 'WAITING'}
                            </Badge>
                          </div>
                        </CardHeader>
                        <CardContent>
                          {/* Bot Stats */}
                          <div className="grid grid-cols-4 gap-2 mb-3">
                            <div className="bg-gray-900/50 rounded p-2 text-center">
                              <div className="text-xs text-gray-400">P&L</div>
                              <div className={`font-bold ${bot.totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                ${bot.totalPnl.toFixed(2)}
                              </div>
                            </div>
                            <div className="bg-gray-900/50 rounded p-2 text-center">
                              <div className="text-xs text-gray-400">Trades</div>
                              <div className="font-bold text-white">{bot.trades}</div>
                            </div>
                            <div className="bg-gray-900/50 rounded p-2 text-center">
                              <div className="text-xs text-gray-400">Wins</div>
                              <div className="font-bold text-green-400">{bot.wins}</div>
                            </div>
                            <div className="bg-gray-900/50 rounded p-2 text-center">
                              <div className="text-xs text-gray-400">Losses</div>
                              <div className="font-bold text-red-400">{bot.losses}</div>
                            </div>
                          </div>

                          {/* Current Status */}
                          <div className="bg-gray-900/50 rounded-lg p-3 mb-3">
                            <div className="flex justify-between items-center">
                              <span className="text-gray-400">Current Stake:</span>
                              <span className="font-bold text-white">${bot.currentStake.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between items-center mt-1">
                              <span className="text-gray-400">Consecutive Losses:</span>
                              <span className="font-bold text-white">{bot.consecutiveLosses}</span>
                            </div>
                            {bot.lastTradeResult && (
                              <div className="flex justify-between items-center mt-1">
                                <span className="text-gray-400">Last Trade:</span>
                                <Badge className={bot.lastTradeResult === 'win' ? 'bg-green-500' : 'bg-red-500'}>
                                  {bot.lastTradeResult.toUpperCase()}
                                </Badge>
                              </div>
                            )}
                          </div>

                          {/* Control Buttons */}
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              className={`flex-1 ${bot.isPaused ? 'border-yellow-500 text-yellow-400' : 'border-gray-600'}`}
                              onClick={() => togglePauseBot(index)}
                            >
                              {bot.isPaused ? (
                                <>
                                  <Play className="w-4 h-4 mr-2" />
                                  Resume
                                </>
                              ) : (
                                <>
                                  <Pause className="w-4 h-4 mr-2" />
                                  Pause
                                </>
                              )}
                            </Button>
                            <Button
                              variant="destructive"
                              className="flex-1"
                              onClick={() => stopBot(index)}
                            >
                              <StopCircle className="w-4 h-4 mr-2" />
                              Stop
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    </motion.div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-12 text-gray-500">
                <Zap className="w-16 h-16 mx-auto mb-4 opacity-50" />
                <p className="text-lg">No active bots. Start a bot from the Signals tab.</p>
              </div>
            )}
          </TabsContent>

          {/* All Markets Tab */}
          <TabsContent value="markets">
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {ALL_MARKETS.map((market) => {
                const analysis = marketAnalyses[market.symbol];
                const hasSignal = matchedSignals.some(s => s.market === market.symbol);
                
                return (
                  <Card key={market.symbol} className={`bg-gray-800/50 border-gray-700 hover:border-gray-600 transition-colors ${hasSignal ? 'border-green-500/50' : ''}`}>
                    <CardContent className="p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-2xl">{market.icon}</span>
                        <div className="flex-1">
                          <p className="text-sm font-medium text-white">{market.name}</p>
                          <p className="text-xs text-gray-400">{market.symbol}</p>
                        </div>
                        {hasSignal && (
                          <Badge className="bg-green-500">Signal</Badge>
                        )}
                      </div>
                      
                      {analysis ? (
                        <div className="text-xs">
                          <div className="grid grid-cols-4 gap-1 mt-2">
                            <div className="text-center">
                              <div className="text-gray-400">Most</div>
                              <div className="font-bold text-white">{analysis.mostAppearing}</div>
                            </div>
                            <div className="text-center">
                              <div className="text-gray-400">2nd</div>
                              <div className="font-bold text-white">{analysis.secondMost}</div>
                            </div>
                            <div className="text-center">
                              <div className="text-gray-400">3rd</div>
                              <div className="font-bold text-white">{analysis.thirdMost}</div>
                            </div>
                            <div className="text-center">
                              <div className="text-gray-400">Least</div>
                              <div className="font-bold text-white">{analysis.leastAppearing}</div>
                            </div>
                          </div>
                          
                          <div className="flex gap-1 mt-2 flex-wrap">
                            {analysis.conditions.over1 && <Badge className="bg-blue-500/20 text-blue-400 text-[8px]">OVER 1</Badge>}
                            {analysis.conditions.under8 && <Badge className="bg-orange-500/20 text-orange-400 text-[8px]">UNDER 8</Badge>}
                            {analysis.conditions.even && <Badge className="bg-green-500/20 text-green-400 text-[8px]">EVEN</Badge>}
                            {analysis.conditions.odd && <Badge className="bg-purple-500/20 text-purple-400 text-[8px]">ODD</Badge>}
                            {analysis.conditions.over3 && <Badge className="bg-cyan-500/20 text-cyan-400 text-[8px]">OVER 3</Badge>}
                            {analysis.conditions.under6 && <Badge className="bg-rose-500/20 text-rose-400 text-[8px]">UNDER 6</Badge>}
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-gray-500 text-center py-2">Not scanned yet</p>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
