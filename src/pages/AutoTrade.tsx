import { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { derivApi } from '@/services/deriv-api';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Scan, DollarSign, TrendingUp, TrendingDown, CircleDot, AlertTriangle, Volume2 } from 'lucide-react';

// Types
interface DigitAnalysis {
  mostAppearing: number;
  secondMost: number;
  thirdMost: number;
  leastAppearing: number;
  digitCounts: Record<number, number>;
}

interface BotSignal {
  id: string;
  market: string;
  botType: BotType;
  botName: string;
  analysis: DigitAnalysis;
  status: 'scanning' | 'monitoring' | 'entry_ready';
  entryTriggered: boolean;
}

type BotType = 'over1' | 'under8' | 'even' | 'odd' | 'over3' | 'under6';

// All supported markets
const ALL_MARKETS = [
  // Volatility Indices
  'R_10', 'R_25', 'R_50', 'R_75', 'R_100',
  // 1HZ Volatility
  '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V',
  // Jump Indices
  'JD10', 'JD25', 'JD50', 'JD75', 'JD100',
  // Bear & Bull
  'RDBEAR', 'RDBULL'
];

// Bot strategy configurations
const BOT_STRATEGIES: Record<BotType, {
  name: string;
  description: string;
  color: string;
  icon: any;
  marketCondition: (analysis: DigitAnalysis) => boolean;
  entryCondition: (digits: number[]) => boolean;
}> = {
  over1: {
    name: 'OVER 1 BOT',
    description: 'Recovery: Over 3',
    color: 'blue',
    icon: TrendingUp,
    marketCondition: (analysis) => 
      analysis.mostAppearing > 4 && 
      analysis.secondMost > 4 && 
      analysis.leastAppearing > 4,
    entryCondition: (digits) => {
      if (digits.length < 2) return false;
      const lastTwo = digits.slice(-2);
      return lastTwo.every(d => d <= 1);
    }
  },
  under8: {
    name: 'UNDER 8 BOT',
    description: 'Recovery: Under 6',
    color: 'orange',
    icon: TrendingDown,
    marketCondition: (analysis) => 
      analysis.mostAppearing < 6 && 
      analysis.secondMost < 6 && 
      analysis.leastAppearing < 6,
    entryCondition: (digits) => {
      if (digits.length < 2) return false;
      const lastTwo = digits.slice(-2);
      return lastTwo.every(d => d >= 8);
    }
  },
  even: {
    name: 'EVEN BOT',
    description: 'Even digits dominate',
    color: 'green',
    icon: CircleDot,
    marketCondition: (analysis) => 
      analysis.mostAppearing % 2 === 0 && 
      analysis.secondMost % 2 === 0 && 
      analysis.leastAppearing % 2 === 0,
    entryCondition: (digits) => {
      if (digits.length < 3) return false;
      const lastThree = digits.slice(-3);
      return lastThree.every(d => d % 2 === 1);
    }
  },
  odd: {
    name: 'ODD BOT',
    description: 'Odd digits dominate',
    color: 'purple',
    icon: CircleDot,
    marketCondition: (analysis) => 
      analysis.mostAppearing % 2 === 1 && 
      analysis.secondMost % 2 === 1 && 
      analysis.thirdMost % 2 === 1,
    entryCondition: (digits) => {
      if (digits.length < 3) return false;
      const lastThree = digits.slice(-3);
      return lastThree.every(d => d % 2 === 0);
    }
  },
  over3: {
    name: 'OVER 3 BOT',
    description: 'Recovery: Over 3',
    color: 'cyan',
    icon: TrendingUp,
    marketCondition: (analysis) => 
      analysis.mostAppearing > 4 && 
      analysis.secondMost > 4 && 
      analysis.leastAppearing > 4,
    entryCondition: (digits) => {
      if (digits.length < 3) return false;
      const lastThree = digits.slice(-3);
      return lastThree.every(d => d <= 2);
    }
  },
  under6: {
    name: 'UNDER 6 BOT',
    description: 'Recovery: Under 6',
    color: 'yellow',
    icon: TrendingDown,
    marketCondition: (analysis) => 
      analysis.mostAppearing < 5 && 
      analysis.secondMost < 5 && 
      analysis.leastAppearing < 5,
    entryCondition: (digits) => {
      if (digits.length < 3) return false;
      const lastThree = digits.slice(-3);
      return lastThree.every(d => d >= 7);
    }
  }
};

// Voice Alert System
class VoiceAlertSystem {
  private static instance: VoiceAlertSystem;
  private speech: SpeechSynthesisUtterance | null = null;
  private lastScanMessage: number = 0;

  private constructor() {
    if (typeof window !== 'undefined') {
      this.speech = new SpeechSynthesisUtterance();
      this.speech.rate = 0.8;
      this.speech.pitch = 0.5;
      this.speech.volume = 0.8;
      
      // Try to find a deep voice
      window.speechSynthesis.onvoiceschanged = () => {
        const voices = window.speechSynthesis.getVoices();
        const deepVoice = voices.find(v => v.name.includes('Deep') || v.name.includes('Male'));
        if (deepVoice && this.speech) {
          this.speech.voice = deepVoice;
        }
      };
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

  scanningAlert() {
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

// Dollar background animation
const DollarBackground = () => (
  <div className="fixed inset-0 pointer-events-none overflow-hidden">
    {[...Array(50)].map((_, i) => (
      <motion.div
        key={i}
        className="absolute text-green-500/10 font-bold text-2xl"
        initial={{
          x: Math.random() * window.innerWidth,
          y: window.innerHeight + 100,
          rotate: Math.random() * 360,
          scale: Math.random() * 0.8 + 0.3,
        }}
        animate={{
          y: -100,
          x: `calc(${Math.random() * 100}vw + ${Math.sin(i) * 30}px)`,
          rotate: Math.random() * 720,
        }}
        transition={{
          duration: Math.random() * 20 + 15,
          repeat: Infinity,
          ease: "linear",
          delay: Math.random() * 10,
        }}
      >
        $
      </motion.div>
    ))}
  </div>
);

// Signal Card Component
const SignalCard = ({ signal, onStopMonitoring }: { signal: BotSignal; onStopMonitoring: (id: string) => void }) => {
  const strategy = BOT_STRATEGIES[signal.botType];
  const Icon = strategy.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9 }}
      className={`bg-gradient-to-br from-gray-900 to-gray-800 border-l-4 rounded-lg p-4 shadow-xl ${
        signal.status === 'entry_ready' 
          ? 'border-green-400 ring-2 ring-green-400/50' 
          : 'border-yellow-400'
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`p-2 rounded-lg bg-${strategy.color}-500/20`}>
            <Icon className={`w-4 h-4 text-${strategy.color}-400`} />
          </div>
          <div>
            <h3 className="font-bold text-white">{signal.market}</h3>
            <p className="text-xs text-gray-400">{strategy.name}</p>
          </div>
        </div>
        <Badge className={signal.status === 'entry_ready' ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'}>
          {signal.status === 'entry_ready' ? '⚡ ENTRY READY' : '⏳ MONITORING'}
        </Badge>
      </div>

      <div className="grid grid-cols-4 gap-2 mb-3 text-xs">
        <div className="bg-gray-800/50 rounded p-1 text-center">
          <span className="text-gray-400 block">Most</span>
          <span className="text-green-400 font-bold">{signal.analysis.mostAppearing}</span>
        </div>
        <div className="bg-gray-800/50 rounded p-1 text-center">
          <span className="text-gray-400 block">2nd</span>
          <span className="text-green-400 font-bold">{signal.analysis.secondMost}</span>
        </div>
        <div className="bg-gray-800/50 rounded p-1 text-center">
          <span className="text-gray-400 block">3rd</span>
          <span className="text-green-400 font-bold">{signal.analysis.thirdMost}</span>
        </div>
        <div className="bg-gray-800/50 rounded p-1 text-center">
          <span className="text-gray-400 block">Least</span>
          <span className="text-green-400 font-bold">{signal.analysis.leastAppearing}</span>
        </div>
      </div>

      <p className="text-xs text-gray-400 mb-2">{strategy.description}</p>

      <Button
        onClick={() => onStopMonitoring(signal.id)}
        variant="outline"
        size="sm"
        className="w-full border-red-500/30 text-red-400 hover:bg-red-500/20"
      >
        Stop Monitoring
      </Button>
    </motion.div>
  );
};

// Main Component
export default function MarketScanner() {
  const { isAuthorized } = useAuth();
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [currentMarket, setCurrentMarket] = useState('');
  const [signals, setSignals] = useState<BotSignal[]>([]);
  const [marketTicks, setMarketTicks] = useState<Record<string, number[]>>({});
  
  const voiceSystem = VoiceAlertSystem.getInstance();
  const activeSubscriptions = useRef<Record<string, () => void>>({});

  // Analyze digits from tick data
  const analyzeDigits = (digits: number[]): DigitAnalysis => {
    const last1000 = digits.slice(-1000);
    const counts: Record<number, number> = {};
    for (let i = 0; i <= 9; i++) counts[i] = 0;
    last1000.forEach(d => counts[d]++);
    
    const sorted = [...Array(10).keys()].sort((a, b) => counts[b] - counts[a]);
    
    return {
      mostAppearing: sorted[0],
      secondMost: sorted[1],
      thirdMost: sorted[2],
      leastAppearing: sorted[9],
      digitCounts: counts
    };
  };

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

  // Monitor market for entry conditions
  const monitorMarket = (market: string, botType: BotType, signalId: string) => {
    if (activeSubscriptions.current[market]) {
      activeSubscriptions.current[market]();
    }

    const unsubscribe = derivApi.subscribeTicks(market, (tick: any) => {
      const digit = Math.floor(tick.quote) % 10;
      
      setMarketTicks(prev => {
        const ticks = [...(prev[market] || []), digit];
        if (ticks.length > 1000) ticks.shift();
        
        // Check entry condition
        const strategy = BOT_STRATEGIES[botType];
        if (strategy.entryCondition(ticks)) {
          setSignals(prev => prev.map(s => 
            s.id === signalId 
              ? { ...s, status: 'entry_ready', entryTriggered: true }
              : s
          ));
        }
        
        return { ...prev, [market]: ticks };
      });
    });

    activeSubscriptions.current[market] = unsubscribe;
  };

  // Scan all markets
  const scanAllMarkets = useCallback(async () => {
    if (isScanning) return;
    
    setIsScanning(true);
    setSignals([]);
    
    // Clear existing subscriptions
    Object.values(activeSubscriptions.current).forEach(unsub => unsub());
    activeSubscriptions.current = {};
    
    const newSignals: BotSignal[] = [];
    const totalMarkets = ALL_MARKETS.length;
    
    try {
      for (let i = 0; i < ALL_MARKETS.length; i++) {
        const market = ALL_MARKETS[i];
        setCurrentMarket(market);
        setScanProgress(((i + 1) / totalMarkets) * 100);
        
        // Voice alert every few markets
        if (i % 4 === 0) voiceSystem.scanningAlert();
        
        const digits = await fetchMarketTicks(market);
        
        if (digits.length >= 1000) {
          setMarketTicks(prev => ({ ...prev, [market]: digits }));
          const analysis = analyzeDigits(digits);
          
          // Check each bot strategy
          for (const [botType, strategy] of Object.entries(BOT_STRATEGIES)) {
            if (strategy.marketCondition(analysis)) {
              const signalId = `${market}-${botType}-${Date.now()}`;
              newSignals.push({
                id: signalId,
                market,
                botType: botType as BotType,
                botName: strategy.name,
                analysis,
                status: 'monitoring',
                entryTriggered: false
              });
              
              // Start monitoring this market
              monitorMarket(market, botType as BotType, signalId);
            }
          }
        }
        
        // Small delay to prevent rate limiting
        await new Promise(r => setTimeout(r, 100));
      }
      
      setSignals(newSignals);
      
      if (newSignals.length > 0) {
        voiceSystem.signalFound();
        toast.success(`Found ${newSignals.length} trading signals!`);
      } else {
        toast.info('NO SIGNAL FOUND in any market');
      }
      
    } catch (error) {
      console.error('Scan error:', error);
      toast.error('Scan failed. Please try again.');
    } finally {
      setIsScanning(false);
      setCurrentMarket('');
      setScanProgress(100);
    }
  }, [isScanning]);

  // Stop monitoring a signal
  const stopMonitoring = (signalId: string) => {
    const signal = signals.find(s => s.id === signalId);
    if (signal && activeSubscriptions.current[signal.market]) {
      activeSubscriptions.current[signal.market]();
      delete activeSubscriptions.current[signal.market];
    }
    
    setSignals(prev => prev.filter(s => s.id !== signalId));
    toast.info('Stopped monitoring signal');
  };

  // Stop all monitoring
  const stopAllMonitoring = () => {
    Object.values(activeSubscriptions.current).forEach(unsub => unsub());
    activeSubscriptions.current = {};
    setSignals([]);
    toast.info('Stopped all monitoring');
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      Object.values(activeSubscriptions.current).forEach(unsub => unsub());
    };
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white relative overflow-hidden">
      <DollarBackground />

      <div className="relative z-10 container mx-auto px-4 py-8">
        {/* Header */}
        <motion.div 
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="text-center mb-8"
        >
          <h1 className="text-4xl font-bold bg-gradient-to-r from-green-400 to-yellow-400 bg-clip-text text-transparent">
            Automated Market Scanner
          </h1>
          <p className="text-gray-400 mt-2">Scanning {ALL_MARKETS.length} markets for trading opportunities</p>
        </motion.div>

        {/* Scan Button */}
        <motion.div 
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="flex flex-col items-center mb-8"
        >
          <Button
            onClick={scanAllMarkets}
            disabled={isScanning}
            size="lg"
            className="relative w-64 h-64 rounded-full bg-gradient-to-r from-green-500 to-yellow-500 hover:from-green-600 hover:to-yellow-600 text-white font-bold text-xl shadow-2xl shadow-green-500/20"
          >
            <div className="absolute inset-2 rounded-full bg-gray-900 flex items-center justify-center">
              {isScanning ? (
                <div className="text-center">
                  <Loader2 className="w-12 h-12 animate-spin mx-auto mb-2 text-green-400" />
                  <span className="text-sm text-gray-300">SCANNING...</span>
                  <span className="block text-xs mt-1 text-gray-400">{currentMarket}</span>
                </div>
              ) : (
                <div className="text-center">
                  <Scan className="w-12 h-12 mx-auto mb-2 text-green-400" />
                  <span className="text-white">SCAN</span>
                  <span className="block text-xs mt-1 text-gray-400">All Markets</span>
                </div>
              )}
            </div>
          </Button>

          {/* Progress Bar */}
          {isScanning && (
            <div className="w-full max-w-md mt-4">
              <div className="flex justify-between text-sm mb-1">
                <span className="text-green-400">Scanning markets...</span>
                <span className="text-yellow-400">{Math.round(scanProgress)}%</span>
              </div>
              <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
                <motion.div 
                  className="h-full bg-gradient-to-r from-green-400 to-yellow-400"
                  initial={{ width: 0 }}
                  animate={{ width: `${scanProgress}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
            </div>
          )}
        </motion.div>

        {/* Controls */}
        {signals.length > 0 && (
          <motion.div 
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="flex justify-end mb-4"
          >
            <Button
              onClick={stopAllMonitoring}
              variant="outline"
              className="border-red-500/30 text-red-400 hover:bg-red-500/20"
            >
              Stop All Monitoring
            </Button>
          </motion.div>
        )}

        {/* Signals Grid */}
        <motion.div 
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="space-y-4"
        >
          <h2 className="text-xl font-semibold text-green-400 flex items-center gap-2">
            <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
            Active Signals ({signals.length})
          </h2>

          <AnimatePresence mode="wait">
            {signals.length === 0 ? (
              <motion.div
                key="no-signals"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="bg-gray-800/50 backdrop-blur border border-green-500/20 rounded-xl p-12 text-center"
              >
                <AlertTriangle className="w-16 h-16 text-yellow-400/50 mx-auto mb-4" />
                <h3 className="text-2xl font-bold text-gray-400 mb-2">NO SIGNAL FOUND</h3>
                <p className="text-gray-500">
                  Click the SCAN button to analyze all {ALL_MARKETS.length} supported markets
                </p>
                <div className="mt-4 text-sm text-gray-600">
                  <p>Markets analyzed: Volatility Indices, 1HZ Volatility, Jump Indices, Bear & Bull</p>
                </div>
              </motion.div>
            ) : (
              <motion.div 
                className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
                initial="hidden"
                animate="visible"
                variants={{
                  visible: { transition: { staggerChildren: 0.1 } }
                }}
              >
                {signals.map(signal => (
                  <SignalCard 
                    key={signal.id} 
                    signal={signal} 
                    onStopMonitoring={stopMonitoring}
                  />
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Market Stats */}
        {Object.keys(marketTicks).length > 0 && (
          <motion.div 
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="mt-8 bg-gray-800/30 backdrop-blur border border-green-500/20 rounded-xl p-4"
          >
            <h3 className="text-sm font-semibold text-gray-400 mb-2">📊 Markets Loaded</h3>
            <div className="flex flex-wrap gap-2">
              {Object.keys(marketTicks).map(market => (
                <Badge key={market} variant="outline" className="border-green-500/30 text-green-400">
                  {market} ({marketTicks[market].length} ticks)
                </Badge>
              ))}
            </div>
          </motion.div>
        )}

        {/* Voice Status */}
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed bottom-4 right-4 flex items-center gap-2 text-xs text-gray-500"
        >
          <Volume2 className="w-3 h-3" />
          <span>Voice alerts active</span>
        </motion.div>
      </div>
    </div>
  );
                                   }
