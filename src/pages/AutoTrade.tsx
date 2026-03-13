import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { derivApi } from '@/services/deriv-api';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

// All Deriv markets
const ALL_MARKETS = {
  // Volatility Indices (R_10 to R_100)
  volatility: ['R_10', 'R_25', 'R_50', 'R_75', 'R_100'],
  
  // 1HZ Volatility Indices
  hzVolatility: ['1HZ10V', '1HZ25V', 'HZ50V', '1HZ75V', '1HZ100V'],
  
  // Boom & Crash Indices
  boomCrash: ['BOOM300', 'BOOM500', 'BOOM1000', 'CRASH300', 'CRASH500', 'CRASH1000'],
  
  // Jump Indices
  jump: ['JD10', 'JD25', 'JD50', 'JD75', 'JD100'],
  
  // Bear & Bull Markets
  bearBull: ['RDBEAR', 'RDBULL']
};

// Flatten all markets for scanning
const ALL_MARKETS_FLAT = [
  ...ALL_MARKETS.volatility,
  ...ALL_MARKETS.hzVolatility,
  ...ALL_MARKETS.boomCrash,
  ...ALL_MARKETS.jump,
  ...ALL_MARKETS.bearBull
];

// Voice Alert System
class VoiceAlert {
  private static instance: VoiceAlert;
  private synth: SpeechSynthesis | null = null;
  private speaking: boolean = false;

  private constructor() {
    if (typeof window !== 'undefined') {
      this.synth = window.speechSynthesis;
    }
  }

  static getInstance(): VoiceAlert {
    if (!VoiceAlert.instance) {
      VoiceAlert.instance = new VoiceAlert();
    }
    return VoiceAlert.instance;
  }

  speak(text: string, isDeep: boolean = true) {
    if (!this.synth || this.speaking) return;

    const utterance = new SpeechSynthesisUtterance(text);
    
    // Find a deep voice
    const voices = this.synth.getVoices();
    const deepVoice = voices.find(v => 
      v.name.toLowerCase().includes('male') || 
      v.name.toLowerCase().includes('deep') ||
      v.name.toLowerCase().includes('david')
    );
    
    if (deepVoice) {
      utterance.voice = deepVoice;
    }
    
    utterance.rate = 0.7;
    utterance.pitch = 0.2;
    utterance.volume = 1;
    
    utterance.onstart = () => { this.speaking = true; };
    utterance.onend = () => { this.speaking = false; };
    utterance.onerror = () => { this.speaking = false; };
    
    this.synth.speak(utterance);
  }

  stop() {
    if (this.synth) {
      this.synth.cancel();
      this.speaking = false;
    }
  }
}

// Bot Configurations
const BOT_STRATEGIES = {
  'OVER-1': {
    name: 'OVER 1 BOT',
    icon: '🎯',
    color: 'from-blue-500 to-cyan-500',
    bgColor: 'bg-blue-500/10',
    borderColor: 'border-blue-500/30',
    textColor: 'text-blue-400',
    condition: (freq: any) => {
      return freq.mostAppearing > 4 && 
             freq.secondMost > 4 && 
             freq.leastAppearing > 4;
    },
    entryCondition: (digits: number[]) => {
      if (digits.length < 2) return false;
      const lastTwo = digits.slice(-2);
      return lastTwo.every(d => d <= 1);
    },
    entryText: 'Last 2 digits ≤ 1',
    contractType: 'DIGITOVER',
    barrier: 1
  },
  'UNDER-8': {
    name: 'UNDER 8 BOT',
    icon: '⬇️',
    color: 'from-orange-500 to-red-500',
    bgColor: 'bg-orange-500/10',
    borderColor: 'border-orange-500/30',
    textColor: 'text-orange-400',
    condition: (freq: any) => {
      return freq.mostAppearing < 6 && 
             freq.secondMost < 6 && 
             freq.leastAppearing < 6;
    },
    entryCondition: (digits: number[]) => {
      if (digits.length < 2) return false;
      const lastTwo = digits.slice(-2);
      return lastTwo.every(d => d >= 8);
    },
    entryText: 'Last 2 digits ≥ 8',
    contractType: 'DIGITUNDER',
    barrier: 8
  },
  'EVEN': {
    name: 'EVEN BOT',
    icon: '⚖️',
    color: 'from-green-500 to-emerald-500',
    bgColor: 'bg-green-500/10',
    borderColor: 'border-green-500/30',
    textColor: 'text-green-400',
    condition: (freq: any) => {
      return freq.mostAppearing % 2 === 0 &&
             freq.secondMost % 2 === 0 &&
             freq.leastAppearing % 2 === 0;
    },
    entryCondition: (digits: number[]) => {
      if (digits.length < 3) return false;
      const lastThree = digits.slice(-3);
      return lastThree.every(d => d % 2 === 1);
    },
    entryText: 'Last 3 digits odd',
    contractType: 'DIGITEVEN'
  },
  'ODD': {
    name: 'ODD BOT',
    icon: '🎲',
    color: 'from-purple-500 to-pink-500',
    bgColor: 'bg-purple-500/10',
    borderColor: 'border-purple-500/30',
    textColor: 'text-purple-400',
    condition: (freq: any) => {
      return freq.mostAppearing % 2 === 1 &&
             freq.secondMost % 2 === 1 &&
             freq.thirdMost % 2 === 1;
    },
    entryCondition: (digits: number[]) => {
      if (digits.length < 3) return false;
      const lastThree = digits.slice(-3);
      return lastThree.every(d => d % 2 === 0);
    },
    entryText: 'Last 3 digits even',
    contractType: 'DIGITODD'
  },
  'OVER-3': {
    name: 'OVER 3 BOT',
    icon: '📈',
    color: 'from-indigo-500 to-blue-500',
    bgColor: 'bg-indigo-500/10',
    borderColor: 'border-indigo-500/30',
    textColor: 'text-indigo-400',
    condition: (freq: any) => {
      return freq.mostAppearing > 4 &&
             freq.secondMost > 4 &&
             freq.leastAppearing > 4;
    },
    entryCondition: (digits: number[]) => {
      if (digits.length < 3) return false;
      const lastThree = digits.slice(-3);
      return lastThree.every(d => d <= 3);
    },
    entryText: 'Last 3 digits ≤ 3',
    contractType: 'DIGITOVER',
    barrier: 3
  },
  'UNDER-6': {
    name: 'UNDER 6 BOT',
    icon: '📉',
    color: 'from-amber-500 to-orange-500',
    bgColor: 'bg-amber-500/10',
    borderColor: 'border-amber-500/30',
    textColor: 'text-amber-400',
    condition: (freq: any) => {
      return freq.mostAppearing < 5 &&
             freq.secondMost < 5 &&
             freq.leastAppearing < 5;
    },
    entryCondition: (digits: number[]) => {
      if (digits.length < 3) return false;
      const lastThree = digits.slice(-3);
      return lastThree.every(d => d >= 6);
    },
    entryText: 'Last 3 digits ≥ 6',
    contractType: 'DIGITUNDER',
    barrier: 6
  }
};

// Dollar Background Animation Component
const DollarBackground = () => {
  const [dimensions, setDimensions] = useState({ width: 1200, height: 800 });

  useEffect(() => {
    setDimensions({
      width: window.innerWidth,
      height: window.innerHeight
    });

    const handleResize = () => {
      setDimensions({
        width: window.innerWidth,
        height: window.innerHeight
      });
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden">
      {/* Gradient Overlay */}
      <div className="absolute inset-0 bg-gradient-to-b from-gray-900/95 via-gray-800/95 to-black/95 z-0" />
      
      {/* Floating Dollar Signs */}
      {[...Array(50)].map((_, i) => {
        const size = Math.random() * 40 + 20;
        const left = Math.random() * 100;
        const duration = Math.random() * 20 + 15;
        const delay = Math.random() * 10;
        const rotation = Math.random() * 360;
        
        return (
          <motion.div
            key={i}
            className="absolute text-green-500/5 font-bold z-0"
            style={{
              fontSize: `${size}px`,
              left: `${left}%`,
              top: `${-size}px`,
              transform: `rotate(${rotation}deg)`,
            }}
            animate={{
              y: [0, dimensions.height + size],
              rotate: [rotation, rotation + 360],
              opacity: [0, 0.3, 0.2, 0]
            }}
            transition={{
              duration: duration,
              repeat: Infinity,
              delay: delay,
              ease: "linear"
            }}
          >
            $
          </motion.div>
        );
      })}

      {/* Additional Dollar Signs with different animations */}
      {[...Array(25)].map((_, i) => {
        const size = Math.random() * 60 + 30;
        const left = Math.random() * 100;
        const duration = Math.random() * 30 + 20;
        const delay = Math.random() * 15;
        
        return (
          <motion.div
            key={`large-${i}`}
            className="absolute text-yellow-500/5 font-bold z-0"
            style={{
              fontSize: `${size}px`,
              left: `${left}%`,
              top: `${-size}px`,
            }}
            animate={{
              y: [0, dimensions.height + size],
              x: [0, Math.sin(i) * 100, 0],
              rotate: [0, 180, 360],
              opacity: [0, 0.2, 0.1, 0]
            }}
            transition={{
              duration: duration,
              repeat: Infinity,
              delay: delay,
              ease: "easeInOut"
            }}
          >
            💰
          </motion.div>
        );
      })}
    </div>
  );
};

// Market Category Card Component
const MarketCategory = ({ title, markets, icon, color }: any) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    className="bg-gray-800/50 backdrop-blur-sm rounded-xl p-4 border border-gray-700"
  >
    <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
      <span className={`p-1 rounded-lg bg-${color}-500/20 text-${color}-400`}>
        {icon}
      </span>
      {title}
    </h3>
    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
      {markets.map((market: string) => (
        <Badge key={market} variant="outline" className="justify-start text-xs">
          {market}
        </Badge>
      ))}
    </div>
  </motion.div>
);

// Badge Component
const Badge = ({ children, variant = "default", className = "", ...props }: any) => {
  const baseStyle = "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium";
  const variants = {
    default: "bg-gray-700 text-gray-200",
    success: "bg-green-500/20 text-green-400 border border-green-500/30",
    warning: "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30",
    error: "bg-red-500/20 text-red-400 border border-red-500/30",
    outline: "border border-gray-600 text-gray-300"
  };
  
  return (
    <span className={`${baseStyle} ${variants[variant]} ${className}`} {...props}>
      {children}
    </span>
  );
};

// Button Component
const Button = ({ children, variant = "default", size = "default", className = "", ...props }: any) => {
  const baseStyle = "inline-flex items-center justify-center font-medium transition-all duration-200 rounded-lg";
  
  const variants = {
    default: "bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white shadow-lg shadow-green-500/25",
    outline: "border border-gray-600 hover:border-gray-500 hover:bg-gray-800 text-gray-300",
    ghost: "hover:bg-gray-800 text-gray-400",
    danger: "bg-gradient-to-r from-red-500 to-pink-600 hover:from-red-600 hover:to-pink-700 text-white"
  };
  
  const sizes = {
    sm: "px-3 py-1.5 text-sm",
    default: "px-4 py-2",
    lg: "px-6 py-3 text-lg"
  };
  
  return (
    <button
      className={`${baseStyle} ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
};

// Card Component
const Card = ({ children, className = "", ...props }: any) => (
  <div
    className={`bg-gray-800/30 backdrop-blur-sm border border-gray-700 rounded-xl ${className}`}
    {...props}
  >
    {children}
  </div>
);

export default function AutoTradeScanner() {
  const { isAuthorized, balance } = useAuth();
  const voice = useRef(VoiceAlert.getInstance());
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [currentMarket, setCurrentMarket] = useState('');
  const [signals, setSignals] = useState<any[]>([]);
  const [noSignal, setNoSignal] = useState(false);
  const [marketData, setMarketData] = useState<Record<string, any>>({});
  const [scanStats, setScanStats] = useState({
    total: 0,
    scanned: 0,
    found: 0
  });

  // Fetch ticks for a market
  const fetchMarketTicks = async (symbol: string) => {
    try {
      setCurrentMarket(symbol);
      
      const response = await derivApi.getTicks(symbol, 1000);
      if (!response?.ticks) return null;

      const ticks = response.ticks.map((t: any) => t.quote);
      const digits = ticks.map(t => Math.floor(t % 10));
      
      // Calculate frequency
      const frequency: Record<number, number> = {};
      for (let i = 0; i <= 9; i++) frequency[i] = 0;
      digits.forEach(d => frequency[d]++);
      
      const sortedDigits = [...Array(10).keys()].sort((a, b) => frequency[b] - frequency[a]);

      return {
        symbol,
        ticks,
        digits,
        frequency,
        mostAppearing: sortedDigits[0],
        secondMost: sortedDigits[1],
        thirdMost: sortedDigits[2],
        leastAppearing: sortedDigits[9],
        distribution: sortedDigits.map(d => ({ digit: d, count: frequency[d] }))
      };
    } catch (error) {
      console.error(`Error fetching ${symbol}:`, error);
      return null;
    }
  };

  // Check for matching bots
  const findMatchingBots = (data: any) => {
    const matches: any[] = [];
    
    Object.entries(BOT_STRATEGIES).forEach(([key, config]: [string, any]) => {
      if (config.condition(data)) {
        matches.push({
          botType: key,
          ...config
        });
      }
    });

    return matches;
  };

  // Start scanning
  const startScan = async () => {
    if (isScanning) return;
    
    setIsScanning(true);
    setNoSignal(false);
    setSignals([]);
    setScanStats({ total: ALL_MARKETS_FLAT.length, scanned: 0, found: 0 });

    // Start periodic voice alerts
    const voiceInterval = setInterval(() => {
      voice.current.speak("Scanning the markets for money... stay ready.", true);
    }, 20000);

    const foundSignals: any[] = [];
    const processedData: Record<string, any> = {};

    // Scan each market
    for (let i = 0; i < ALL_MARKETS_FLAT.length; i++) {
      const market = ALL_MARKETS_FLAT[i];
      
      const data = await fetchMarketTicks(market);
      if (data) {
        processedData[market] = data;
        
        const matches = findMatchingBots(data);
        
        matches.forEach((match: any) => {
          foundSignals.push({
            id: `${market}-${match.botType}-${Date.now()}`,
            market,
            ...match,
            lastDigits: data.digits.slice(-3),
            status: 'monitoring'
          });
        });
      }

      // Update progress
      const progress = Math.floor((i + 1) / ALL_MARKETS_FLAT.length * 100);
      setScanProgress(progress);
      setScanStats(prev => ({ ...prev, scanned: i + 1, found: foundSignals.length }));
    }

    clearInterval(voiceInterval);
    setMarketData(processedData);

    if (foundSignals.length > 0) {
      setSignals(foundSignals);
      voice.current.speak(`Found ${foundSignals.length} trading signals. Prepare to trade.`, true);
      toast.success(`🎯 Found ${foundSignals.length} trading signals!`);
    } else {
      setNoSignal(true);
      voice.current.speak("No signals found. Keep scanning.", true);
      toast.info('No matching signals found');
    }

    setScanProgress(100);
    setTimeout(() => {
      setIsScanning(false);
      setCurrentMarket('');
    }, 1000);
  };

  // Stop all voices on unmount
  useEffect(() => {
    return () => {
      voice.current.stop();
    };
  }, []);

  return (
    <div className="min-h-screen bg-gray-900 text-white relative">
      {/* Animated Dollar Background */}
      <DollarBackground />

      {/* Main Content */}
      <div className="relative z-10 container mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
              className="text-4xl"
            >
              💰
            </motion.div>
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-green-400 to-emerald-400 bg-clip-text text-transparent">
                Money Scanner Pro
              </h1>
              <p className="text-gray-400 text-sm mt-1">
                6-Bot Automated Trading System • All Markets
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <Card className="px-4 py-2">
              <div className="text-xs text-gray-400">Balance</div>
              <div className="text-xl font-bold text-green-400">
                ${balance?.toFixed(2) || '0.00'}
              </div>
            </Card>
            
            <Button
              onClick={startScan}
              disabled={isScanning || !isAuthorized}
              size="lg"
              className="min-w-[200px]"
            >
              {isScanning ? (
                <>
                  <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent mr-2" />
                  SCANNING...
                </>
              ) : (
                <>
                  <span className="mr-2">🔍</span>
                  SCAN ALL MARKETS
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Progress Bar */}
        {isScanning && (
          <Card className="p-4 mb-6">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-400">Scanning:</span>
                <Badge variant="warning">{currentMarket}</Badge>
              </div>
              <div className="text-sm">
                <span className="text-green-400">{scanStats.found}</span>
                <span className="text-gray-400"> signals found from </span>
                <span className="text-white">{scanStats.scanned}</span>
                <span className="text-gray-400">/{scanStats.total}</span>
              </div>
            </div>
            <div className="w-full h-3 bg-gray-700 rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-gradient-to-r from-green-400 to-emerald-400"
                initial={{ width: 0 }}
                animate={{ width: `${scanProgress}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
          </Card>
        )}

        {/* Market Categories */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          <MarketCategory
            title="Volatility Indices"
            markets={ALL_MARKETS.volatility}
            icon="📊"
            color="blue"
          />
          <MarketCategory
            title="1HZ Volatility"
            markets={ALL_MARKETS.hzVolatility}
            icon="⚡"
            color="yellow"
          />
          <MarketCategory
            title="Boom & Crash"
            markets={ALL_MARKETS.boomCrash}
            icon="💥"
            color="red"
          />
          <MarketCategory
            title="Jump Indices"
            markets={ALL_MARKETS.jump}
            icon="🦘"
            color="purple"
          />
          <MarketCategory
            title="Bear & Bull"
            markets={ALL_MARKETS.bearBull}
            icon="🐂"
            color="green"
          />
          <MarketCategory
            title="Total Markets"
            markets={[`${ALL_MARKETS_FLAT.length} Markets`]}
            icon="🎯"
            color="white"
          />
        </div>

        {/* No Signal Message */}
        <AnimatePresence>
          {noSignal && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="mb-6"
            >
              <Card className="p-8 text-center border-red-500/30 bg-red-500/5">
                <div className="text-6xl mb-4">😕</div>
                <h2 className="text-2xl font-bold text-red-400 mb-2">NO SIGNAL FOUND</h2>
                <p className="text-gray-400">
                  No markets match current bot conditions. Try scanning again later.
                </p>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Signals Grid */}
        {signals.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <span className="text-2xl">🎯</span>
                Active Signals ({signals.length})
              </h2>
              <Badge variant="success">Live Monitoring</Badge>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {signals.map((signal) => (
                <motion.div
                  key={signal.id}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className={`
                    relative overflow-hidden rounded-xl border-2 p-5
                    ${signal.bgColor} ${signal.borderColor}
                    backdrop-blur-sm
                  `}
                >
                  {/* Background Icon */}
                  <div className="absolute right-0 bottom-0 text-6xl opacity-5 transform rotate-12">
                    {signal.icon}
                  </div>

                  {/* Header */}
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className={`text-2xl p-2 rounded-lg bg-black/30`}>
                        {signal.icon}
                      </div>
                      <div>
                        <h3 className="font-bold text-lg">{signal.market}</h3>
                        <p className={`text-sm ${signal.textColor}`}>{signal.name}</p>
                      </div>
                    </div>
                    <Badge variant="warning">MONITORING</Badge>
                  </div>

                  {/* Market Analysis */}
                  {marketData[signal.market] && (
                    <div className="grid grid-cols-2 gap-2 mb-4">
                      <div className="bg-black/30 rounded-lg p-2 text-center">
                        <div className="text-xs text-gray-400">Most</div>
                        <div className="text-lg font-bold text-green-400">
                          {marketData[signal.market].mostAppearing}
                        </div>
                      </div>
                      <div className="bg-black/30 rounded-lg p-2 text-center">
                        <div className="text-xs text-gray-400">Least</div>
                        <div className="text-lg font-bold text-red-400">
                          {marketData[signal.market].leastAppearing}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Entry Condition */}
                  <div className="bg-black/30 rounded-lg p-3 mb-4">
                    <div className="text-xs text-gray-400 mb-1">Entry Condition:</div>
                    <div className="text-sm font-medium">{signal.entryText}</div>
                  </div>

                  {/* Last Digits */}
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-sm text-gray-400">Last Digits:</span>
                    <div className="flex gap-1">
                      {signal.lastDigits.map((d: number, i: number) => (
                        <motion.div
                          key={i}
                          animate={{ scale: [1, 1.2, 1] }}
                          transition={{ duration: 0.3, delay: i * 0.1 }}
                          className={`w-8 h-8 flex items-center justify-center rounded-lg
                            ${signal.bgColor} border ${signal.borderColor} font-bold`}
                        >
                          {d}
                        </motion.div>
                      ))}
                    </div>
                  </div>

                  {/* Contract Info */}
                  <div className="flex gap-2 text-xs">
                    <Badge variant="outline">{signal.contractType}</Badge>
                    {signal.barrier !== undefined && (
                      <Badge variant="outline">Barrier: {signal.barrier}</Badge>
                    )}
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        )}

        {/* Welcome State */}
        {!isScanning && signals.length === 0 && !noSignal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-16"
          >
            <div className="text-8xl mb-6 animate-bounce">💰</div>
            <h2 className="text-3xl font-bold text-gray-300 mb-3">Ready to Scan</h2>
            <p className="text-gray-400 text-lg max-w-md mx-auto mb-8">
              Click the SCAN ALL MARKETS button to analyze all volatility, jump, bear, and bull markets for trading opportunities
            </p>
            <div className="flex items-center justify-center gap-3 text-sm text-gray-500">
              <span>📊 {ALL_MARKETS_FLAT.length} Markets</span>
              <span>•</span>
              <span>🤖 6 Bot Strategies</span>
              <span>•</span>
              <span>🎯 Real-time Monitoring</span>
            </div>
          </motion.div>
        )}

        {/* Bot Strategies Legend */}
        <Card className="p-4 mt-8">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <span className="text-xl">🤖</span>
            Bot Strategies
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {Object.entries(BOT_STRATEGIES).map(([key, bot]: [string, any]) => (
              <div key={key} className="text-center p-2 bg-gray-700/30 rounded-lg">
                <div className={`text-2xl mb-1`}>{bot.icon}</div>
                <div className={`text-xs font-medium ${bot.textColor}`}>{bot.name}</div>
                <div className="text-[10px] text-gray-400 mt-1">{bot.entryText}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
