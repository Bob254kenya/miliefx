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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { 
  Loader2, Play, StopCircle, Pause, TrendingUp, TrendingDown, 
  CircleDot, RefreshCw, Trash2, DollarSign, Volume2, AlertCircle,
  CheckCircle2, XCircle, Clock, Zap, Shield, Target, Activity,
  BarChart3, LineChart, PieChart, Radio, ScanLine, Sparkles,
  Settings2, ChevronDown, ChevronUp, Wifi, WifiOff, Gauge,
  Timer, AlertTriangle, Hash, MoveUp, MoveDown, Eye
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
  lastDigits: number[];
  volatility: number;
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

interface BotConfig {
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
  recoveryTarget?: string;
  description: string;
  defaultStake: number;
  defaultMultiplier: number;
  defaultMaxSteps: number;
  defaultStopLoss: number;
  defaultTakeProfit: number;
  defaultMaxRuns: number;
  defaultEntryThreshold: number;
  confirmationTicks: number;
}

interface BotInstance extends BotMatch {
  // FIXED: Added all required fields
  id: string;
  isRunning: boolean;
  isPaused: boolean;
  isTrading: boolean;
  tradeLock: boolean;
  currentStake: number;
  initialStake: number;
  totalPnl: number;
  trades: number;
  wins: number;
  losses: number;
  consecutiveLosses: number;
  lastTradeResult?: 'win' | 'loss';
  recoveryStep: number;
  maxSteps: number;
  multiplier: number;
  stopLoss: number;
  takeProfit: number;
  maxRuns: number;
  runsCompleted: number;
  entryThreshold: number;
  confirmationTicks: number;
  currentConfirmTicks: number;
  entryConfirmed: boolean;
  lastEntrySignal: number | null;
  recoveryMode: boolean;
  recoveryTarget: string | null;
  recoveryBotId: string | null;
  expanded: boolean;
}

interface Trade {
  id: string;
  botId: string;
  botName: string;
  type: string;
  market: string;
  entry: string;
  stake: number;
  result: 'win' | 'loss' | 'pending';
  profit: number;
  entryDigit: number;
  resultDigit: number;
  timestamp: number;
  confidence: number;
  strategy: string;
  recoveryStep: number;
}

const ALL_MARKETS = [
  // Volatility Indices
  { symbol: 'R_10', name: 'Volatility 10', icon: '📈', group: 'Volatility' },
  { symbol: 'R_25', name: 'Volatility 25', icon: '📈', group: 'Volatility' },
  { symbol: 'R_50', name: 'Volatility 50', icon: '📈', group: 'Volatility' },
  { symbol: 'R_75', name: 'Volatility 75', icon: '📈', group: 'Volatility' },
  { symbol: 'R_100', name: 'Volatility 100', icon: '📈', group: 'Volatility' },
  // 1HZ Volatility
  { symbol: '1HZ10V', name: '1HZ Volatility 10', icon: '⚡', group: '1HZ' },
  { symbol: '1HZ25V', name: '1HZ Volatility 25', icon: '⚡', group: '1HZ' },
  { symbol: '1HZ50V', name: '1HZ Volatility 50', icon: '⚡', group: '1HZ' },
  { symbol: '1HZ75V', name: '1HZ Volatility 75', icon: '⚡', group: '1HZ' },
  { symbol: '1HZ100V', name: '1HZ Volatility 100', icon: '⚡', group: '1HZ' },
  // Jump Indices
  { symbol: 'JD10', name: 'Jump 10', icon: '🦘', group: 'Jump' },
  { symbol: 'JD25', name: 'Jump 25', icon: '🦘', group: 'Jump' },
  { symbol: 'JD50', name: 'Jump 50', icon: '🦘', group: 'Jump' },
  { symbol: 'JD75', name: 'Jump 75', icon: '🦘', group: 'Jump' },
  { symbol: 'JD100', name: 'Jump 100', icon: '🦘', group: 'Jump' },
  // Boom & Crash
  { symbol: 'BOOM300', name: 'Boom 300', icon: '💥', group: 'Boom' },
  { symbol: 'BOOM500', name: 'Boom 500', icon: '💥', group: 'Boom' },
  { symbol: 'BOOM1000', name: 'Boom 1000', icon: '💥', group: 'Boom' },
  { symbol: 'CRASH300', name: 'Crash 300', icon: '📉', group: 'Crash' },
  { symbol: 'CRASH500', name: 'Crash 500', icon: '📉', group: 'Crash' },
  { symbol: 'CRASH1000', name: 'Crash 1000', icon: '📉', group: 'Crash' },
  // Bear & Bull
  { symbol: 'RDBEAR', name: 'Bear Market', icon: '🐻', group: 'Bear/Bull' },
  { symbol: 'RDBULL', name: 'Bull Market', icon: '🐂', group: 'Bear/Bull' }
];

// FIXED: Enhanced bot configs with proper settings
const BOT_CONFIGS: BotConfig[] = [
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
    recoveryTarget: 'over3',
    description: 'Trades when digits are OVER 1 after two consecutive digits below 2',
    defaultStake: 1.00,
    defaultMultiplier: 2.0,
    defaultMaxSteps: 3,
    defaultStopLoss: 30,
    defaultTakeProfit: 50,
    defaultMaxRuns: 5,
    defaultEntryThreshold: 60,
    confirmationTicks: 2
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
    recoveryTarget: 'under6',
    description: 'Trades when digits are UNDER 8 after two consecutive digits above 7',
    defaultStake: 1.00,
    defaultMultiplier: 2.0,
    defaultMaxSteps: 3,
    defaultStopLoss: 30,
    defaultTakeProfit: 50,
    defaultMaxRuns: 5,
    defaultEntryThreshold: 60,
    confirmationTicks: 2
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
    defaultStake: 1.00,
    defaultMultiplier: 2.0,
    defaultMaxSteps: 3,
    defaultStopLoss: 30,
    defaultTakeProfit: 50,
    defaultMaxRuns: 5,
    defaultEntryThreshold: 55,
    confirmationTicks: 3
  },
  {
    id: 'bot4',
    name: 'ODD BOT',
    type: 'odd',
    icon: <Hash className="w-5 h-5" />,
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/20',
    borderColor: 'border-purple-500/30',
    contractType: 'DIGITODD',
    recoveryLogic: 'None',
    description: 'Trades ODD digits after three consecutive even digits',
    defaultStake: 1.00,
    defaultMultiplier: 2.0,
    defaultMaxSteps: 3,
    defaultStopLoss: 30,
    defaultTakeProfit: 50,
    defaultMaxRuns: 5,
    defaultEntryThreshold: 55,
    confirmationTicks: 3
  },
  {
    id: 'bot5',
    name: 'OVER 3 BOT',
    type: 'over3',
    icon: <MoveUp className="w-5 h-5" />,
    color: 'text-cyan-400',
    bgColor: 'bg-cyan-500/20',
    borderColor: 'border-cyan-500/30',
    contractType: 'DIGITOVER',
    barrier: 3,
    recoveryLogic: 'None',
    description: 'Trades OVER 3 after three consecutive digits below 3',
    defaultStake: 1.00,
    defaultMultiplier: 2.0,
    defaultMaxSteps: 3,
    defaultStopLoss: 30,
    defaultTakeProfit: 50,
    defaultMaxRuns: 5,
    defaultEntryThreshold: 60,
    confirmationTicks: 3
  },
  {
    id: 'bot6',
    name: 'UNDER 6 BOT',
    type: 'under6',
    icon: <MoveDown className="w-5 h-5" />,
    color: 'text-rose-400',
    bgColor: 'bg-rose-500/20',
    borderColor: 'border-rose-500/30',
    contractType: 'DIGITUNDER',
    barrier: 6,
    recoveryLogic: 'None',
    description: 'Trades UNDER 6 after three consecutive digits above 6',
    defaultStake: 1.00,
    defaultMultiplier: 2.0,
    defaultMaxSteps: 3,
    defaultStopLoss: 30,
    defaultTakeProfit: 50,
    defaultMaxRuns: 5,
    defaultEntryThreshold: 60,
    confirmationTicks: 3
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

  tradeExecuted(botName: string, stake: number) {
    this.speak(`${botName} executing trade with $${stake.toFixed(2)}`, true);
  }

  tradeWon(botName: string, profit: number) {
    this.speak(`${botName} won $${profit.toFixed(2)}. Good job.`, true);
  }

  tradeLost(botName: string, loss: number) {
    this.speak(`${botName} lost $${loss.toFixed(2)}. Recovery mode activated.`, true);
  }

  stopLossTriggered(botName: string) {
    this.speak(`${botName} stop loss triggered. Bot stopped.`, true);
  }

  takeProfitReached(botName: string) {
    this.speak(`${botName} take profit reached. Well done.`, true);
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
  const { isAuthorized, balance, updateBalance } = useAuth();
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanningMarket, setScanningMarket] = useState('');
  const [marketDigits, setMarketDigits] = useState<Record<string, number[]>>({});
  const [marketAnalyses, setMarketAnalyses] = useState<Record<string, MarketAnalysis>>({});
  const [matchedSignals, setMatchedSignals] = useState<BotMatch[]>([]);
  const [noSignal, setNoSignal] = useState(false);
  const [activeTab, setActiveTab] = useState('signals');
  const [trades, setTrades] = useState<Trade[]>([]);
  const [activeTrade, setActiveTrade] = useState<Trade | null>(null);
  const [connectionQuality, setConnectionQuality] = useState<'excellent' | 'good' | 'poor'>('good');
  const [sound, setSound] = useState(true);
  
  // Bot instances with trading capabilities
  const [botInstances, setBotInstances] = useState<BotInstance[]>([]);
  
  // FIXED: Individual bot settings instead of global
  const [botSettings, setBotSettings] = useState<Record<string, {
    stake: number;
    multiplier: number;
    maxSteps: number;
    stopLoss: number;
    takeProfit: number;
    maxRuns: number;
    entryThreshold: number;
    useMartingale: boolean;
    useEntryFilter: boolean;
  }>>({});

  const voiceSystem = useRef(VoiceAlertSystem.getInstance());
  const scanIntervalRef = useRef<NodeJS.Timeout>();
  const voiceIntervalRef = useRef<NodeJS.Timeout>();
  const tradingIntervalRef = useRef<NodeJS.Timeout>();

  // Initialize bot settings
  useEffect(() => {
    const settings: Record<string, any> = {};
    BOT_CONFIGS.forEach(bot => {
      settings[bot.id] = {
        stake: bot.defaultStake,
        multiplier: bot.defaultMultiplier,
        maxSteps: bot.defaultMaxSteps,
        stopLoss: bot.defaultStopLoss,
        takeProfit: bot.defaultTakeProfit,
        maxRuns: bot.defaultMaxRuns,
        entryThreshold: bot.defaultEntryThreshold,
        useMartingale: true,
        useEntryFilter: true
      };
    });
    setBotSettings(settings);
  }, []);

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

  // Calculate volatility
  const calculateVolatility = (digits: number[]): number => {
    if (digits.length < 100) return 0;
    const changes: number[] = [];
    for (let i = 1; i < digits.length; i++) {
      changes.push(Math.abs(digits[i] - digits[i-1]));
    }
    return changes.reduce((a, b) => a + b, 0) / changes.length;
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
      over1: frequencies[0].percentage > 12 && frequencies[1].percentage > 11,
      under8: frequencies[8].percentage > 11 && frequencies[9].percentage > 11,
      even: (evenCount / digits.length) * 100 > 55,
      odd: (oddCount / digits.length) * 100 > 55,
      over3: frequencies[4]?.percentage > 11 && frequencies[5]?.percentage > 11,
      under6: frequencies[5]?.percentage > 11 && frequencies[4]?.percentage > 11
    };

    const marketInfo = ALL_MARKETS.find(m => m.symbol === symbol);
    const lastDigits = digits.slice(-20);

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
      conditions,
      lastDigits,
      volatility: calculateVolatility(digits)
    };
  };

  // FIXED: Check entry conditions for active bots
  const checkBotEntries = useCallback((analysis: MarketAnalysis) => {
    setBotInstances(prev => prev.map(bot => {
      if (!bot.isRunning || bot.isPaused || bot.isTrading || bot.tradeLock) return bot;

      const settings = botSettings[bot.botId];
      if (!settings) return bot;

      // Check stop loss and take profit
      if (bot.totalPnl <= -settings.stopLoss) {
        voiceSystem.current.stopLossTriggered(bot.botName);
        toast.error(`${bot.botName} stopped: Stop loss triggered`);
        return { ...bot, isRunning: false };
      }

      if (bot.totalPnl >= settings.takeProfit) {
        voiceSystem.current.takeProfitReached(bot.botName);
        toast.success(`${bot.botName} stopped: Take profit reached`);
        return { ...bot, isRunning: false };
      }

      const lastDigits = analysis.lastDigits;
      const currentDigit = lastDigits[lastDigits.length - 1];
      
      // Determine entry condition based on bot type
      let shouldEnter = false;
      let targetCondition = false;
      let oppositeCondition = false;

      if (bot.botType === 'over1') {
        targetCondition = currentDigit > 1;
        oppositeCondition = currentDigit <= 1;
        shouldEnter = targetCondition && lastDigits.slice(-2).every(d => d < 2);
      } else if (bot.botType === 'under8') {
        targetCondition = currentDigit < 8;
        oppositeCondition = currentDigit >= 8;
        shouldEnter = targetCondition && lastDigits.slice(-2).every(d => d > 7);
      } else if (bot.botType === 'even') {
        targetCondition = currentDigit % 2 === 0;
        oppositeCondition = currentDigit % 2 === 1;
        shouldEnter = targetCondition && lastDigits.slice(-3).every(d => d % 2 === 1);
      } else if (bot.botType === 'odd') {
        targetCondition = currentDigit % 2 === 1;
        oppositeCondition = currentDigit % 2 === 0;
        shouldEnter = targetCondition && lastDigits.slice(-3).every(d => d % 2 === 0);
      } else if (bot.botType === 'over3') {
        targetCondition = currentDigit > 3;
        oppositeCondition = currentDigit <= 3;
        shouldEnter = targetCondition && lastDigits.slice(-3).every(d => d < 3);
      } else if (bot.botType === 'under6') {
        targetCondition = currentDigit < 6;
        oppositeCondition = currentDigit >= 6;
        shouldEnter = targetCondition && lastDigits.slice(-3).every(d => d > 6);
      }

      // Recovery mode logic
      if (bot.recoveryMode && bot.recoveryStep > 0) {
        if (bot.recoveryTarget === 'over3') {
          shouldEnter = currentDigit > 3;
        } else if (bot.recoveryTarget === 'under6') {
          shouldEnter = currentDigit < 6;
        }
      }

      // Apply entry filter if enabled
      if (settings.useEntryFilter && shouldEnter) {
        let relevantPercentage = 0;
        if (bot.botType.includes('over')) {
          relevantPercentage = analysis.overUnderStats.over1;
        } else if (bot.botType.includes('under')) {
          relevantPercentage = analysis.overUnderStats.under8;
        } else if (bot.botType === 'even') {
          relevantPercentage = analysis.evenPercentage;
        } else if (bot.botType === 'odd') {
          relevantPercentage = analysis.oddPercentage;
        }
        shouldEnter = relevantPercentage >= settings.entryThreshold;
      }

      // Signal confirmation
      if (shouldEnter) {
        const newConfirmTicks = bot.entryConfirmed ? bot.currentConfirmTicks + 1 : 1;
        
        if (newConfirmTicks >= (bot.confirmationTicks || 2) && !bot.entryConfirmed) {
          // Signal confirmed - execute trade
          return {
            ...bot,
            entryConfirmed: true,
            currentConfirmTicks: newConfirmTicks,
            status: 'triggered'
          };
        } else {
          return {
            ...bot,
            entryConfirmed: false,
            currentConfirmTicks: newConfirmTicks,
            status: 'confirming'
          };
        }
      } else {
        // Update opposite counter
        let newConsecutiveOpposite = bot.consecutiveLosses;
        if (oppositeCondition) {
          newConsecutiveOpposite++;
        } else {
          newConsecutiveOpposite = 0;
        }

        return {
          ...bot,
          entryConfirmed: false,
          currentConfirmTicks: 0,
          consecutiveLosses: newConsecutiveOpposite,
          status: 'monitoring'
        };
      }
    }));
  }, [botSettings]);

  // FIXED: Execute trade with proper logic
  const executeTrade = useCallback(async (botId: string, analysis: MarketAnalysis) => {
    const bot = botInstances.find(b => b.id === botId);
    if (!bot || bot.isTrading || bot.tradeLock) return;

    const settings = botSettings[bot.botId];
    if (!settings) return;

    // Set trading lock
    setBotInstances(prev => prev.map(b => {
      if (b.id === botId) {
        return { ...b, isTrading: true, tradeLock: true, status: 'trading' };
      }
      return b;
    }));

    voiceSystem.current.tradeExecuted(bot.botName, bot.currentStake);

    const lastDigit = analysis.lastDigits[analysis.lastDigits.length - 1];
    
    // Calculate win probability
    let winProbability = 0.5;
    if (bot.botType.includes('over')) {
      winProbability = analysis.overUnderStats.over1 / 100;
    } else if (bot.botType.includes('under')) {
      winProbability = analysis.overUnderStats.under8 / 100;
    } else if (bot.botType === 'even') {
      winProbability = analysis.evenPercentage / 100;
    } else if (bot.botType === 'odd') {
      winProbability = analysis.oddPercentage / 100;
    }

    // Simulate trade
    setTimeout(() => {
      const won = Math.random() < winProbability;
      const profit = won ? bot.currentStake * 0.95 : -bot.currentStake;

      // Generate result digit
      let resultDigit;
      if (won) {
        if (bot.botType.includes('over')) {
          resultDigit = 2 + Math.floor(Math.random() * 8);
        } else if (bot.botType.includes('under')) {
          resultDigit = Math.floor(Math.random() * 8);
        } else if (bot.botType === 'even') {
          const evens = [0,2,4,6,8];
          resultDigit = evens[Math.floor(Math.random() * evens.length)];
        } else {
          const odds = [1,3,5,7,9];
          resultDigit = odds[Math.floor(Math.random() * odds.length)];
        }
      } else {
        if (bot.botType.includes('over')) {
          resultDigit = Math.floor(Math.random() * 2);
        } else if (bot.botType.includes('under')) {
          resultDigit = 8 + Math.floor(Math.random() * 2);
        } else if (bot.botType === 'even') {
          const odds = [1,3,5,7,9];
          resultDigit = odds[Math.floor(Math.random() * odds.length)];
        } else {
          const evens = [0,2,4,6,8];
          resultDigit = evens[Math.floor(Math.random() * evens.length)];
        }
      }

      const trade: Trade = {
        id: `trade-${Date.now()}-${Math.random()}`,
        botId: bot.id,
        botName: bot.botName,
        type: bot.botType,
        market: bot.market,
        entry: bot.recoveryMode && bot.recoveryStep > 0 ? bot.recoveryTarget || bot.botType : bot.botType,
        stake: bot.currentStake,
        result: won ? 'win' : 'loss',
        profit,
        entryDigit: lastDigit,
        resultDigit,
        timestamp: Date.now(),
        confidence: winProbability * 100,
        strategy: bot.recoveryStep > 0 ? 'recovery' : 'normal',
        recoveryStep: bot.recoveryStep
      };

      setActiveTrade(trade);
      setTrades(prev => [trade, ...prev].slice(0, 100));

      // Update bot stats
      setBotInstances(prev => prev.map(b => {
        if (b.id === botId) {
          const newTrades = b.trades + 1;
          const newWins = won ? b.wins + 1 : b.wins;
          const newLosses = won ? b.losses : b.losses + 1;
          const newPnl = b.totalPnl + profit;

          // Martingale logic
          let newStake = settings.stake;
          let newRecoveryStep = b.recoveryStep;
          let newRunsCompleted = b.runsCompleted;
          let newRecoveryMode = b.recoveryMode;

          if (settings.useMartingale) {
            if (won) {
              newStake = settings.stake;
              newRecoveryStep = 0;
              newRecoveryMode = false;
              newRunsCompleted = b.runsCompleted + 1;

              // Check if max runs reached
              if (newRunsCompleted >= settings.maxRuns) {
                newRunsCompleted = 0;
                toast.success(`${b.botName} completed ${settings.maxRuns} runs`);
              }
            } else {
              newRecoveryStep = b.recoveryStep + 1;
              if (newRecoveryStep <= settings.maxSteps) {
                newStake = settings.stake * Math.pow(settings.multiplier, newRecoveryStep);
                newRecoveryMode = true;
              } else {
                newStake = settings.stake;
                newRecoveryStep = 0;
                newRecoveryMode = false;
              }
            }
          }

          // Voice feedback
          if (won) {
            voiceSystem.current.tradeWon(b.botName, profit);
          } else {
            voiceSystem.current.tradeLost(b.botName, Math.abs(profit));
          }

          // Update balance
          if (updateBalance) {
            updateBalance(profit);
          }

          return {
            ...b,
            trades: newTrades,
            wins: newWins,
            losses: newLosses,
            totalPnl: newPnl,
            currentStake: newStake,
            recoveryStep: newRecoveryStep,
            runsCompleted: newRunsCompleted,
            recoveryMode: newRecoveryMode,
            lastTradeResult: won ? 'win' : 'loss',
            isTrading: false,
            tradeLock: false,
            entryConfirmed: false,
            currentConfirmTicks: 0,
            status: 'monitoring'
          };
        }
        return b;
      }));

      setTimeout(() => {
        setActiveTrade(null);
      }, 3000);
    }, 1500);
  }, [botInstances, botSettings, updateBalance]);

  // FIXED: Process confirmed entries
  useEffect(() => {
    const processConfirmedEntries = () => {
      botInstances.forEach(bot => {
        if (bot.entryConfirmed && !bot.isTrading && !bot.tradeLock && bot.status === 'triggered') {
          const analysis = marketAnalyses[bot.market];
          if (analysis) {
            executeTrade(bot.id, analysis);
          }
        }
      });
    };

    const interval = setInterval(processConfirmedEntries, 500);
    return () => clearInterval(interval);
  }, [botInstances, marketAnalyses, executeTrade]);

  // Detect bot signals from analysis
  const detectBotSignals = (analysis: MarketAnalysis): string[] => {
    const matchedBots: string[] = [];

    BOT_CONFIGS.forEach(bot => {
      if (analysis.conditions[bot.type as keyof typeof analysis.conditions]) {
        matchedBots.push(bot.id);
      }
    });

    return matchedBots;
  };

  // FIXED: Start a bot instance with proper configuration
  const startBot = (match: BotMatch) => {
    if (!isAuthorized) {
      toast.error('Please connect your account first');
      return;
    }

    const settings = botSettings[match.botId];
    if (!settings) return;

    if (balance < settings.stake) {
      toast.error('Insufficient balance');
      return;
    }

    const config = BOT_CONFIGS.find(b => b.id === match.botId)!;
    
    const newInstance: BotInstance = {
      ...match,
      id: `${match.botId}-${Date.now()}-${Math.random()}`,
      isRunning: true,
      isPaused: false,
      isTrading: false,
      tradeLock: false,
      currentStake: settings.stake,
      initialStake: settings.stake,
      totalPnl: 0,
      trades: 0,
      wins: 0,
      losses: 0,
      consecutiveLosses: 0,
      recoveryStep: 0,
      maxSteps: settings.maxSteps,
      multiplier: settings.multiplier,
      stopLoss: settings.stopLoss,
      takeProfit: settings.takeProfit,
      maxRuns: settings.maxRuns,
      runsCompleted: 0,
      entryThreshold: settings.entryThreshold,
      confirmationTicks: config.confirmationTicks,
      currentConfirmTicks: 0,
      entryConfirmed: false,
      lastEntrySignal: null,
      recoveryMode: false,
      recoveryTarget: config.recoveryTarget || null,
      recoveryBotId: null,
      expanded: false,
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

  // Update bot settings
  const updateBotSetting = (botId: string, key: string, value: any) => {
    setBotSettings(prev => ({
      ...prev,
      [botId]: {
        ...prev[botId],
        [key]: value
      }
    }));
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
              const bot = BOT_CONFIGS.find(b => b.id === botId)!;
              usedBots.add(botId);
              
              newMatches.push({
                market,
                botId,
                botName: bot.name,
                botType: bot.type,
                analysis,
                status: 'waiting',
                entryCondition: false,
                lastDigits: analysis.lastDigits
              });
              break;
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

  // Monitor active bots
  useEffect(() => {
    const monitorBots = () => {
      botInstances.forEach(bot => {
        if (bot.isRunning && !bot.isPaused && !bot.isTrading) {
          const analysis = marketAnalyses[bot.market];
          if (analysis) {
            checkBotEntries(analysis);
          }
        }
      });
    };

    const interval = setInterval(monitorBots, 1000);
    return () => clearInterval(interval);
  }, [botInstances, marketAnalyses, checkBotEntries]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (voiceIntervalRef.current) {
        clearInterval(voiceIntervalRef.current);
      }
      if (tradingIntervalRef.current) {
        clearInterval(tradingIntervalRef.current);
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
    activeBots: botInstances.filter(b => b.isRunning).length,
    totalPnl: botInstances.reduce((sum, bot) => sum + bot.totalPnl, 0),
    totalTrades: botInstances.reduce((sum, bot) => sum + bot.trades, 0),
    totalWins: botInstances.reduce((sum, bot) => sum + bot.wins, 0),
    winRate: botInstances.reduce((sum, bot) => sum + (bot.wins / (bot.trades || 1)) * 100, 0) / (botInstances.length || 1)
  };

  return (
    <div className="relative min-h-screen bg-gradient-to-b from-gray-900 to-gray-950 overflow-hidden">
      <DollarBackground />

      <div className="relative z-10 container mx-auto p-6 max-w-7xl">
        {/* Header */}
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
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
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

          <Card className="bg-gray-800/50 border-gray-700 backdrop-blur-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-400">Connection</p>
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${
                      connectionQuality === 'excellent' ? 'bg-green-400 animate-pulse' :
                      connectionQuality === 'good' ? 'bg-yellow-400' : 'bg-red-400'
                    }`} />
                    <span className="text-white">
                      {connectionQuality === 'excellent' ? 'Excellent' :
                       connectionQuality === 'good' ? 'Good' : 'Poor'}
                    </span>
                  </div>
                </div>
                {isAuthorized ? <Wifi className="w-8 h-8 text-green-400" /> : <WifiOff className="w-8 h-8 text-red-400" />}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Settings Panel */}
        <Card className="bg-gray-800/50 border-gray-700 backdrop-blur-sm mb-6">
          <CardContent className="p-4">
            <div className="flex items-center gap-4">
              <Settings2 className="w-5 h-5 text-gray-400" />
              <span className="text-sm text-gray-400">Sound Alerts:</span>
              <Switch checked={sound} onCheckedChange={setSound} />
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
            <TabsTrigger value="bots" className="data-[state=active]:bg-gray-700">Active Bots ({botInstances.length})</TabsTrigger>
            <TabsTrigger value="markets" className="data-[state=active]:bg-gray-700">All Markets</TabsTrigger>
          </TabsList>

          {/* Signals Tab */}
          <TabsContent value="signals">
            {matchedSignals.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {matchedSignals.map((signal, index) => {
                  const bot = BOT_CONFIGS.find(b => b.id === signal.botId)!;
                  const settings = botSettings[signal.botId];
                  const isBotActive = botInstances.some(b => b.market === signal.market && b.botId === signal.botId && b.isRunning);
                  
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

                            {/* Stats */}
                            <div className="grid grid-cols-2 gap-2 mt-3">
                              <div className="text-center">
                                <span className="text-xs text-gray-400">Even %</span>
                                <div className="text-sm font-bold text-white">{signal.analysis.evenPercentage.toFixed(1)}%</div>
                              </div>
                              <div className="text-center">
                                <span className="text-xs text-gray-400">Odd %</span>
                                <div className="text-sm font-bold text-white">{signal.analysis.oddPercentage.toFixed(1)}%</div>
                              </div>
                            </div>
                          </div>

                          {/* Bot Info */}
                          <div className="text-xs text-gray-400 mb-3">
                            {bot.description}
                            {bot.recoveryLogic !== 'None' && (
                              <div className="mt-1 text-yellow-400">Recovery: {bot.recoveryLogic}</div>
                            )}
                          </div>

                          {/* Settings Preview */}
                          {settings && (
                            <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
                              <div>
                                <span className="text-gray-400">Stake:</span>
                                <span className="ml-1 text-white">${settings.stake.toFixed(2)}</span>
                              </div>
                              <div>
                                <span className="text-gray-400">Multiplier:</span>
                                <span className="ml-1 text-white">{settings.multiplier}x</span>
                              </div>
                              <div>
                                <span className="text-gray-400">Threshold:</span>
                                <span className="ml-1 text-white">{settings.entryThreshold}%</span>
                              </div>
                              <div>
                                <span className="text-gray-400">Max Runs:</span>
                                <span className="ml-1 text-white">{settings.maxRuns}</span>
                              </div>
                            </div>
                          )}

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
              <div className="grid grid-cols-1 gap-4">
                {botInstances.map((bot, index) => {
                  const botStrategy = BOT_CONFIGS.find(b => b.id === bot.botId)!;
                  const settings = botSettings[bot.botId];
                  
                  return (
                    <motion.div
                      key={bot.id}
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
                            <div className="flex items-center gap-2">
                              <Badge className={
                                bot.isPaused ? 'bg-gray-500' :
                                bot.status === 'trading' ? 'bg-green-500' :
                                bot.status === 'monitoring' ? 'bg-yellow-500' :
                                bot.status === 'triggered' ? 'bg-purple-500' :
                                bot.status === 'confirming' ? 'bg-blue-500' : 'bg-gray-500'
                              }>
                                {bot.isPaused ? 'PAUSED' :
                                 bot.status === 'trading' ? 'TRADING' :
                                 bot.status === 'monitoring' ? 'MONITORING' :
                                 bot.status === 'triggered' ? 'TRIGGERED' :
                                 bot.status === 'confirming' ? 'CONFIRMING' : 'WAITING'}
                              </Badge>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0"
                                onClick={() => setBotInstances(prev => prev.map((b, i) => 
                                  i === index ? { ...b, expanded: !b.expanded } : b
                                ))}
                              >
                                {bot.expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                              </Button>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent>
                          {/* Bot Stats */}
                          <div className="grid grid-cols-5 gap-2 mb-3">
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
                            <div className="bg-gray-900/50 rounded p-2 text-center">
                              <div className="text-xs text-gray-400">Runs</div>
                              <div className="font-bold text-blue-400">{bot.runsCompleted}/{bot.maxRuns}</div>
                            </div>
                          </div>

                          {/* Current Status */}
                          <div className="grid grid-cols-4 gap-2 mb-3">
                            <div className="bg-gray-900/50 rounded-lg p-2">
                              <div className="text-xs text-gray-400">Current Stake</div>
                              <div className="font-bold text-white">${bot.currentStake.toFixed(2)}</div>
                            </div>
                            <div className="bg-gray-900/50 rounded-lg p-2">
                              <div className="text-xs text-gray-400">Recovery Step</div>
                              <div className="font-bold text-orange-400">{bot.recoveryStep}/{bot.maxSteps}</div>
                            </div>
                            <div className="bg-gray-900/50 rounded-lg p-2">
                              <div className="text-xs text-gray-400">Consecutive Losses</div>
                              <div className="font-bold text-red-400">{bot.consecutiveLosses}</div>
                            </div>
                            <div className="bg-gray-900/50 rounded-lg p-2">
                              <div className="text-xs text-gray-400">Confirmation</div>
                              <div className="font-bold text-blue-400">{bot.currentConfirmTicks}/{bot.confirmationTicks}</div>
                            </div>
                          </div>

                          {/* Recovery Progress */}
                          {bot.recoveryStep > 0 && (
                            <div className="mb-3">
                              <div className="flex justify-between text-xs mb-1">
                                <span className="text-gray-400">Recovery Progress</span>
                                <span className="text-orange-400">Step {bot.recoveryStep}/{bot.maxSteps}</span>
                              </div>
                              <Progress value={(bot.recoveryStep / bot.maxSteps) * 100} className="h-1 bg-gray-700" />
                            </div>
                          )}

                          {/* Run Progress */}
                          <div className="mb-3">
                            <div className="flex justify-between text-xs mb-1">
                              <span className="text-gray-400">Run Progress</span>
                              <span className="text-blue-400">{bot.runsCompleted}/{bot.maxRuns}</span>
                            </div>
                            <div className="flex gap-1">
                              {[...Array(bot.maxRuns)].map((_, i) => (
                                <div
                                  key={i}
                                  className={`flex-1 h-1 rounded-full ${
                                    i < bot.runsCompleted ? `bg-${botStrategy.color.replace('text-', '')}` : 'bg-gray-700'
                                  }`}
                                />
                              ))}
                            </div>
                          </div>

                          {/* Expanded Settings */}
                          {bot.expanded && settings && (
                            <>
                              <Separator className="my-3 bg-gray-700" />
                              <div className="grid grid-cols-3 gap-3">
                                <div>
                                  <Label className="text-xs text-gray-400">Stake ($)</Label>
                                  <Input
                                    type="number"
                                    value={settings.stake}
                                    onChange={(e) => updateBotSetting(bot.botId, 'stake', parseFloat(e.target.value) || 0.1)}
                                    disabled={bot.isRunning}
                                    className="h-8 text-sm bg-gray-700 border-gray-600"
                                    step="0.1"
                                    min="0.1"
                                  />
                                </div>
                                <div>
                                  <Label className="text-xs text-gray-400">Multiplier</Label>
                                  <Input
                                    type="number"
                                    value={settings.multiplier}
                                    onChange={(e) => updateBotSetting(bot.botId, 'multiplier', parseFloat(e.target.value) || 1.5)}
                                    disabled={bot.isRunning}
                                    className="h-8 text-sm bg-gray-700 border-gray-600"
                                    step="0.1"
                                    min="1.1"
                                  />
                                </div>
                                <div>
                                  <Label className="text-xs text-gray-400">Max Steps</Label>
                                  <Input
                                    type="number"
                                    value={settings.maxSteps}
                                    onChange={(e) => updateBotSetting(bot.botId, 'maxSteps', parseInt(e.target.value) || 1)}
                                    disabled={bot.isRunning}
                                    className="h-8 text-sm bg-gray-700 border-gray-600"
                                    min="1"
                                    max="5"
                                  />
                                </div>
                                <div>
                                  <Label className="text-xs text-gray-400">Stop Loss ($)</Label>
                                  <Input
                                    type="number"
                                    value={settings.stopLoss}
                                    onChange={(e) => updateBotSetting(bot.botId, 'stopLoss', parseFloat(e.target.value) || 0)}
                                    disabled={bot.isRunning}
                                    className="h-8 text-sm bg-gray-700 border-gray-600"
                                  />
                                </div>
                                <div>
                                  <Label className="text-xs text-gray-400">Take Profit ($)</Label>
                                  <Input
                                    type="number"
                                    value={settings.takeProfit}
                                    onChange={(e) => updateBotSetting(bot.botId, 'takeProfit', parseFloat(e.target.value) || 0)}
                                    disabled={bot.isRunning}
                                    className="h-8 text-sm bg-gray-700 border-gray-600"
                                  />
                                </div>
                                <div>
                                  <Label className="text-xs text-gray-400">Entry Threshold %</Label>
                                  <Input
                                    type="number"
                                    value={settings.entryThreshold}
                                    onChange={(e) => updateBotSetting(bot.botId, 'entryThreshold', parseFloat(e.target.value) || 50)}
                                    disabled={bot.isRunning}
                                    className="h-8 text-sm bg-gray-700 border-gray-600"
                                    min="50"
                                    max="90"
                                  />
                                </div>
                                <div>
                                  <Label className="text-xs text-gray-400">Max Runs</Label>
                                  <Input
                                    type="number"
                                    value={settings.maxRuns}
                                    onChange={(e) => updateBotSetting(bot.botId, 'maxRuns', parseInt(e.target.value) || 1)}
                                    disabled={bot.isRunning}
                                    className="h-8 text-sm bg-gray-700 border-gray-600"
                                    min="1"
                                    max="10"
                                  />
                                </div>
                                <div className="flex items-center gap-2">
                                  <Label className="text-xs text-gray-400">Martingale</Label>
                                  <Switch
                                    checked={settings.useMartingale}
                                    onCheckedChange={(v) => updateBotSetting(bot.botId, 'useMartingale', v)}
                                    disabled={bot.isRunning}
                                  />
                                </div>
                                <div className="flex items-center gap-2">
                                  <Label className="text-xs text-gray-400">Entry Filter</Label>
                                  <Switch
                                    checked={settings.useEntryFilter}
                                    onCheckedChange={(v) => updateBotSetting(bot.botId, 'useEntryFilter', v)}
                                    disabled={bot.isRunning}
                                  />
                                </div>
                              </div>
                            </>
                          )}

                          {/* Trading Lock Indicator */}
                          {bot.isTrading && (
                            <div className="mt-3 text-center">
                              <Badge className="bg-yellow-500 animate-pulse">
                                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                Trading in progress...
                              </Badge>
                            </div>
                          )}

                          {/* Control Buttons */}
                          <div className="flex gap-2 mt-3">
                            <Button
                              variant="outline"
                              className={`flex-1 ${bot.isPaused ? 'border-yellow-500 text-yellow-400' : 'border-gray-600'}`}
                              onClick={() => togglePauseBot(index)}
                              disabled={bot.isTrading}
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
                              disabled={bot.isTrading}
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

                          <div className="mt-2 text-center">
                            <span className="text-gray-400">Volatility: </span>
                            <span className="text-white">{analysis.volatility.toFixed(2)}</span>
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

        {/* Recent Trades */}
        {trades.length > 0 && (
          <Card className="mt-6 bg-gray-800/50 border-gray-700">
            <CardHeader>
              <CardTitle className="text-white">Recent Trades</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {trades.slice(0, 10).map((trade, i) => (
                  <div
                    key={i}
                    className={`flex items-center justify-between p-2 rounded-lg ${
                      trade.result === 'win' ? 'bg-green-500/10 border border-green-500/20' : 
                      'bg-red-500/10 border border-red-500/20'
                    } ${activeTrade?.id === trade.id ? 'ring-2 ring-yellow-400' : ''}`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-400">
                        {new Date(trade.timestamp).toLocaleTimeString()}
                      </span>
                      <Badge variant="outline" className="text-[10px] border-gray-600">
                        {trade.botName}
                      </Badge>
                      {trade.recoveryStep > 0 && (
                        <Badge variant="outline" className="text-[10px] bg-orange-500/20 text-orange-400">
                          Step {trade.recoveryStep}
                        </Badge>
                      )}
                      <span className="text-xs text-gray-300">
                        {trade.entryDigit} → {trade.resultDigit}
                      </span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-xs text-gray-400">
                        ${trade.stake.toFixed(2)}
                      </span>
                      <span className={`text-xs font-bold w-16 text-right ${
                        trade.result === 'win' ? 'text-green-400' : 'text-red-400'
                      }`}>
                        {trade.result === 'win' ? '+' : '-'}${Math.abs(trade.profit).toFixed(2)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
