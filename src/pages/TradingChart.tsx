import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import {
  TrendingUp,
  TrendingDown,
  Activity,
  Target,
  Zap,
  Volume2,
  Clock,
  BarChart3,
  ArrowUp,
  ArrowDown,
  Gauge,
  Shield,
  Signal,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Play,
  Pause,
  RefreshCw
} from 'lucide-react';

// Market configurations
const VOLATILITY_MARKETS = [
  // Volatility 10 1s to Jump 100
  { symbol: '1HZ10V', name: 'Volatility 10 (1s)', group: 'vol1s', baseVol: 10 },
  { symbol: '1HZ15V', name: 'Volatility 15 (1s)', group: 'vol1s', baseVol: 15 },
  { symbol: '1HZ25V', name: 'Volatility 25 (1s)', group: 'vol1s', baseVol: 25 },
  { symbol: '1HZ30V', name: 'Volatility 30 (1s)', group: 'vol1s', baseVol: 30 },
  { symbol: '1HZ50V', name: 'Volatility 50 (1s)', group: 'vol1s', baseVol: 50 },
  { symbol: '1HZ75V', name: 'Volatility 75 (1s)', group: 'vol1s', baseVol: 75 },
  { symbol: '1HZ100V', name: 'Volatility 100 (1s)', group: 'vol1s', baseVol: 100 },
  { symbol: 'R_10', name: 'Volatility 10', group: 'vol', baseVol: 10 },
  { symbol: 'R_25', name: 'Volatility 25', group: 'vol', baseVol: 25 },
  { symbol: 'R_50', name: 'Volatility 50', group: 'vol', baseVol: 50 },
  { symbol: 'R_75', name: 'Volatility 75', group: 'vol', baseVol: 75 },
  { symbol: 'R_100', name: 'Volatility 100', group: 'vol', baseVol: 100 },
  { symbol: 'JD10', name: 'Jump 10', group: 'jump', baseVol: 10 },
  { symbol: 'JD25', name: 'Jump 25', group: 'jump', baseVol: 25 },
  { symbol: 'JD50', name: 'Jump 50', group: 'jump', baseVol: 50 },
  { symbol: 'JD75', name: 'Jump 75', group: 'jump', baseVol: 75 },
  { symbol: 'JD100', name: 'Jump 100', group: 'jump', baseVol: 100 },
];

// Helper function to get last digit
const getLastDigit = (price: number): number => {
  const priceStr = price.toString();
  const match = priceStr.match(/\d+(?:\.\d+)?/);
  if (!match) return 0;
  const numStr = match[0].replace('.', '');
  return parseInt(numStr.slice(-1), 10);
};

// Analyze digit percentages
const analyzeDigits = (prices: number[]) => {
  const digits = prices.map(p => getLastDigit(p));
  const frequency: Record<number, number> = {};
  for (let i = 0; i <= 9; i++) frequency[i] = 0;
  digits.forEach(d => frequency[d]++);
  const percentages: Record<number, number> = {};
  const total = digits.length || 1;
  for (let i = 0; i <= 9; i++) {
    percentages[i] = (frequency[i] / total) * 100;
  }
  return { frequency, percentages };
};

// Calculate digit distribution percentages for ranges
const getRangePercentages = (prices: number[]) => {
  const digits = prices.map(p => getLastDigit(p));
  const total = digits.length || 1;
  const lowRange = digits.filter(d => d >= 0 && d <= 3).length;
  const midRange = digits.filter(d => d >= 4 && d <= 5).length;
  const highRange = digits.filter(d => d >= 6 && d <= 9).length;
  return {
    lowPct: (lowRange / total) * 100,
    midPct: (midRange / total) * 100,
    highPct: (highRange / total) * 100,
    oddPct: (digits.filter(d => d % 2 === 1).length / total) * 100,
    evenPct: (digits.filter(d => d % 2 === 0).length / total) * 100,
  };
};

// Signal types
type SignalType = 'over' | 'under' | 'odd' | 'even';
type SignalStrength = 'strong' | 'moderate' | 'weak';

interface Signal {
  id: string;
  market: typeof VOLATILITY_MARKETS[0];
  type: SignalType;
  strength: SignalStrength;
  percentage: number;
  timestamp: number;
  timeframe: string;
  conditionMet: string;
}

interface SignalCardProps {
  signal: Signal;
  index: number;
}

// Signal Card Component with animations
const SignalCard: React.FC<SignalCardProps> = ({ signal, index }) => {
  const getSignalIcon = () => {
    switch (signal.type) {
      case 'over': return <ArrowUp className="w-5 h-5" />;
      case 'under': return <ArrowDown className="w-5 h-5" />;
      case 'odd': return <Activity className="w-5 h-5" />;
      case 'even': return <Target className="w-5 h-5" />;
      default: return <Signal className="w-5 h-5" />;
    }
  };

  const getSignalColor = () => {
    switch (signal.type) {
      case 'over': return 'from-emerald-500 to-green-600';
      case 'under': return 'from-rose-500 to-red-600';
      case 'odd': return 'from-amber-500 to-orange-600';
      case 'even': return 'from-sky-500 to-blue-600';
      default: return 'from-purple-500 to-pink-600';
    }
  };

  const getStrengthColor = () => {
    switch (signal.strength) {
      case 'strong': return 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30';
      case 'moderate': return 'text-amber-400 bg-amber-400/10 border-amber-400/30';
      case 'weak': return 'text-rose-400 bg-rose-400/10 border-rose-400/30';
    }
  };

  const getStrengthText = () => {
    switch (signal.strength) {
      case 'strong': return 'Strong Signal';
      case 'moderate': return 'Moderate Signal';
      case 'weak': return 'Weak Signal';
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: index * 0.1, duration: 0.4, type: 'spring', stiffness: 300 }}
      whileHover={{ y: -4, scale: 1.02 }}
      className="relative"
    >
      <Card className="overflow-hidden border-border/50 bg-gradient-to-br from-card/80 to-card/40 backdrop-blur-sm hover:shadow-xl transition-all duration-300">
        {/* Animated gradient border */}
        <div className={`absolute inset-0 bg-gradient-to-r ${getSignalColor()} opacity-0 group-hover:opacity-20 transition-opacity duration-500`} />
        
        <CardContent className="p-4 relative">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-3">
              <motion.div
                whileHover={{ rotate: 360, scale: 1.1 }}
                transition={{ duration: 0.5 }}
                className={`w-10 h-10 rounded-xl bg-gradient-to-br ${getSignalColor()} flex items-center justify-center text-white shadow-lg`}
              >
                {getSignalIcon()}
              </motion.div>
              <div>
                <h3 className="font-bold text-sm">{signal.market.name}</h3>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Clock className="w-3 h-3" />
                  <span>{new Date(signal.timestamp).toLocaleTimeString()}</span>
                  <Badge variant="outline" className="text-[10px]">{signal.timeframe}</Badge>
                </div>
              </div>
            </div>
            <Badge className={`${getStrengthColor()} border text-[10px] font-semibold`}>
              {getStrengthText()}
            </Badge>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground capitalize">{signal.type} Signal</span>
              <span className="font-mono font-bold text-lg">{signal.percentage.toFixed(1)}%</span>
            </div>
            
            <div className="relative h-2 bg-muted rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${signal.percentage}%` }}
                transition={{ duration: 0.8, delay: 0.2, ease: "easeOut" }}
                className={`absolute inset-y-0 left-0 rounded-full bg-gradient-to-r ${getSignalColor()}`}
              />
            </div>

            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 rounded-lg p-2">
              <AlertCircle className="w-3 h-3 flex-shrink-0" />
              <span>{signal.conditionMet}</span>
            </div>

            <div className="flex items-center justify-between pt-2">
              <div className="flex items-center gap-1 text-xs">
                <Gauge className="w-3 h-3 text-muted-foreground" />
                <span>Volatility: {signal.market.baseVol}</span>
              </div>
              <motion.div
                animate={{ scale: [1, 1.05, 1] }}
                transition={{ repeat: Infinity, duration: 2 }}
              >
                <Signal className="w-4 h-4 text-primary" />
              </motion.div>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
};

// Main Signal Page Component
export default function SignalPage() {
  const [activeSignals, setActiveSignals] = useState<Signal[]>([]);
  const [historicalSignals, setHistoricalSignals] = useState<Signal[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<string>('all');
  const [autoScan, setAutoScan] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  // Simulate market data (in production, this would come from Deriv API)
  const generateMarketData = useCallback((market: typeof VOLATILITY_MARKETS[0]) => {
    // Simulate price movement based on volatility
    const basePrice = 100 + Math.random() * 50;
    const volatilityFactor = market.baseVol / 50;
    const prices: number[] = [];
    for (let i = 0; i < 100; i++) {
      const change = (Math.random() - 0.5) * volatilityFactor * 2;
      const price = basePrice + change * i;
      prices.push(price);
    }
    return prices;
  }, []);

  // Check signal conditions for a market
  const checkMarketSignals = useCallback((market: typeof VOLATILITY_MARKETS[0], prices: number[]) => {
    const signals: Omit<Signal, 'id' | 'timestamp'>[] = [];
    const { lowPct, highPct, oddPct, evenPct } = getRangePercentages(prices);
    
    // Condition 1: 0-3 digits less than 10% -> Share "over" signal
    if (lowPct < 10) {
      const strength: SignalStrength = lowPct < 5 ? 'strong' : lowPct < 8 ? 'moderate' : 'weak';
      signals.push({
        market,
        type: 'over',
        strength,
        percentage: 100 - lowPct,
        timeframe: '1m',
        conditionMet: `Digits 0-3 only ${lowPct.toFixed(1)}% of the time → Strong over bias`,
      });
    }
    
    // Condition 2: 6-9 digits less than 10% -> Share "under" signal
    if (highPct < 10) {
      const strength: SignalStrength = highPct < 5 ? 'strong' : highPct < 8 ? 'moderate' : 'weak';
      signals.push({
        market,
        type: 'under',
        strength,
        percentage: 100 - highPct,
        timeframe: '1m',
        conditionMet: `Digits 6-9 only ${highPct.toFixed(1)}% of the time → Strong under bias`,
      });
    }
    
    // Condition 3: Odd >= 55% -> Share "odd" signal
    if (oddPct >= 55) {
      const strength: SignalStrength = oddPct >= 70 ? 'strong' : oddPct >= 60 ? 'moderate' : 'weak';
      signals.push({
        market,
        type: 'odd',
        strength,
        percentage: oddPct,
        timeframe: '1m',
        conditionMet: `Odd digits at ${oddPct.toFixed(1)}% (threshold: 55%+) → Odd bias`,
      });
    }
    
    // Condition 4: Even >= 55% -> Share "even" signal
    if (evenPct >= 55) {
      const strength: SignalStrength = evenPct >= 70 ? 'strong' : evenPct >= 60 ? 'moderate' : 'weak';
      signals.push({
        market,
        type: 'even',
        strength,
        percentage: evenPct,
        timeframe: '1m',
        conditionMet: `Even digits at ${evenPct.toFixed(1)}% (threshold: 55%+) → Even bias`,
      });
    }
    
    return signals;
  }, []);

  // Scan all markets for signals
  const scanMarkets = useCallback(() => {
    setIsScanning(true);
    
    // Simulate API delay
    setTimeout(() => {
      const allSignals: Signal[] = [];
      const marketsToScan = selectedGroup === 'all' 
        ? VOLATILITY_MARKETS 
        : VOLATILITY_MARKETS.filter(m => m.group === selectedGroup);
      
      marketsToScan.forEach(market => {
        const prices = generateMarketData(market);
        const signals = checkMarketSignals(market, prices);
        
        signals.forEach(signal => {
          allSignals.push({
            ...signal,
            id: `${market.symbol}-${Date.now()}-${Math.random()}`,
            timestamp: Date.now(),
          });
        });
      });
      
      // Sort by strength (strong first)
      const sortedSignals = allSignals.sort((a, b) => {
        const strengthOrder = { strong: 3, moderate: 2, weak: 1 };
        return strengthOrder[b.strength] - strengthOrder[a.strength];
      });
      
      // Limit to 3 active signals at a time
      const limitedSignals = sortedSignals.slice(0, 3);
      
      setActiveSignals(limitedSignals);
      
      // Add to historical (keep last 20)
      setHistoricalSignals(prev => {
        const combined = [...limitedSignals, ...prev];
        return combined.slice(0, 20);
      });
      
      setLastUpdate(new Date());
      setIsScanning(false);
      
      // Toast notification for new signals
      if (limitedSignals.length > 0) {
        toast.success(`📡 ${limitedSignals.length} new signal${limitedSignals.length > 1 ? 's' : ''} detected!`);
      }
    }, 800);
  }, [selectedGroup, generateMarketData, checkMarketSignals]);

  // Auto-scan interval
  useEffect(() => {
    if (!autoScan) return;
    
    scanMarkets();
    const interval = setInterval(scanMarkets, 30000); // Scan every 30 seconds
    
    return () => clearInterval(interval);
  }, [autoScan, scanMarkets]);

  // Get market groups for filter
  const groups = useMemo(() => {
    const uniqueGroups = new Set(VOLATILITY_MARKETS.map(m => m.group));
    return Array.from(uniqueGroups).map(group => ({
      value: group,
      label: group === 'vol1s' ? 'Volatility 1s' : 
             group === 'vol' ? 'Volatility' :
             group === 'jump' ? 'Jump' : group
    }));
  }, []);

  const getSignalStats = useMemo(() => {
    const total = activeSignals.length;
    const strong = activeSignals.filter(s => s.strength === 'strong').length;
    const moderate = activeSignals.filter(s => s.strength === 'moderate').length;
    const weak = activeSignals.filter(s => s.strength === 'weak').length;
    return { total, strong, moderate, weak };
  }, [activeSignals]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background/95 to-background/90">
      {/* Header Section */}
      <div className="relative overflow-hidden border-b border-border/50 bg-card/30 backdrop-blur-sm">
        <div className="absolute inset-0 bg-grid-white/5 [mask-image:radial-gradient(ellipse_at_top,white,transparent)]" />
        <div className="container mx-auto px-4 py-8 relative">
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col md:flex-row justify-between items-center gap-4"
          >
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center shadow-lg">
                <Signal className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
                  Volatility Signal Scanner
                </h1>
                <p className="text-sm text-muted-foreground">
                  Real-time digit pattern analysis across 17 volatility markets
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <Button
                variant={autoScan ? "default" : "outline"}
                size="sm"
                onClick={() => setAutoScan(!autoScan)}
                className="gap-2"
              >
                {autoScan ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                {autoScan ? 'Auto-Scan On' : 'Auto-Scan Off'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={scanMarkets}
                disabled={isScanning}
                className="gap-2"
              >
                <RefreshCw className={`w-4 h-4 ${isScanning ? 'animate-spin' : ''}`} />
                Scan Now
              </Button>
            </div>
          </motion.div>
          
          {/* Stats Cards */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8"
          >
            <div className="bg-card/50 rounded-xl border border-border/50 p-4 backdrop-blur-sm">
              <div className="flex items-center gap-2 text-muted-foreground mb-2">
                <Signal className="w-4 h-4" />
                <span className="text-sm">Active Signals</span>
              </div>
              <div className="text-3xl font-bold">{getSignalStats.total}</div>
            </div>
            <div className="bg-card/50 rounded-xl border border-border/50 p-4 backdrop-blur-sm">
              <div className="flex items-center gap-2 text-emerald-400 mb-2">
                <TrendingUp className="w-4 h-4" />
                <span className="text-sm">Strong Signals</span>
              </div>
              <div className="text-3xl font-bold text-emerald-400">{getSignalStats.strong}</div>
            </div>
            <div className="bg-card/50 rounded-xl border border-border/50 p-4 backdrop-blur-sm">
              <div className="flex items-center gap-2 text-amber-400 mb-2">
                <Activity className="w-4 h-4" />
                <span className="text-sm">Moderate</span>
              </div>
              <div className="text-3xl font-bold text-amber-400">{getSignalStats.moderate}</div>
            </div>
            <div className="bg-card/50 rounded-xl border border-border/50 p-4 backdrop-blur-sm">
              <div className="flex items-center gap-2 text-muted-foreground mb-2">
                <Clock className="w-4 h-4" />
                <span className="text-sm">Last Scan</span>
              </div>
              <div className="text-sm font-mono">{lastUpdate.toLocaleTimeString()}</div>
            </div>
          </motion.div>
        </div>
      </div>
      
      {/* Filter Section */}
      <div className="container mx-auto px-4 py-6">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="gap-1">
              <BarChart3 className="w-3 h-3" />
              Markets: {selectedGroup === 'all' ? VOLATILITY_MARKETS.length : VOLATILITY_MARKETS.filter(m => m.group === selectedGroup).length}
            </Badge>
            <Badge variant="outline" className="gap-1">
              <Volume2 className="w-3 h-3" />
              Vol 10 → Jump 100
            </Badge>
          </div>
          
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={selectedGroup === 'all' ? 'default' : 'outline'}
              onClick={() => setSelectedGroup('all')}
              className="text-xs"
            >
              All Markets
            </Button>
            {groups.map(group => (
              <Button
                key={group.value}
                size="sm"
                variant={selectedGroup === group.value ? 'default' : 'outline'}
                onClick={() => setSelectedGroup(group.value)}
                className="text-xs"
              >
                {group.label}
              </Button>
            ))}
          </div>
        </div>
        
        {/* Active Signals Grid */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Zap className="w-5 h-5 text-primary" />
              Active Signals
              <Badge variant="secondary" className="ml-2">
                Max 3 signals
              </Badge>
            </h2>
            {isScanning && (
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
              >
                <RefreshCw className="w-4 h-4 text-primary" />
              </motion.div>
            )}
          </div>
          
          {activeSignals.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-12 bg-card/30 rounded-xl border border-dashed border-border"
            >
              <Signal className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-50" />
              <p className="text-muted-foreground">No active signals at the moment</p>
              <p className="text-xs text-muted-foreground mt-1">Scanning markets for digit pattern anomalies...</p>
            </motion.div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              <AnimatePresence mode="wait">
                {activeSignals.map((signal, idx) => (
                  <SignalCard key={signal.id} signal={signal} index={idx} />
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
        
        {/* Historical Signals */}
        {historicalSignals.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Clock className="w-5 h-5 text-muted-foreground" />
              Recent Signals
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {historicalSignals.slice(0, 6).map((signal, idx) => (
                <motion.div
                  key={signal.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  className="bg-card/40 rounded-lg border border-border/50 p-3 hover:bg-card/60 transition-colors"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs ${
                        signal.type === 'over' ? 'bg-emerald-500/20 text-emerald-400' :
                        signal.type === 'under' ? 'bg-rose-500/20 text-rose-400' :
                        signal.type === 'odd' ? 'bg-amber-500/20 text-amber-400' :
                        'bg-sky-500/20 text-sky-400'
                      }`}>
                        {signal.type === 'over' ? '↑' : signal.type === 'under' ? '↓' : signal.type === 'odd' ? 'O' : 'E'}
                      </div>
                      <span className="font-mono text-xs font-medium">{signal.market.name}</span>
                    </div>
                    <Badge className={`text-[8px] ${
                      signal.strength === 'strong' ? 'bg-emerald-500/20 text-emerald-400' :
                      signal.strength === 'moderate' ? 'bg-amber-500/20 text-amber-400' :
                      'bg-rose-500/20 text-rose-400'
                    }`}>
                      {signal.strength}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs capitalize text-muted-foreground">{signal.type} • {signal.percentage.toFixed(0)}%</span>
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(signal.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        )}
        
        {/* Signal Conditions Legend */}
        <div className="mt-8 p-4 bg-card/30 rounded-xl border border-border/50">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-primary" />
            Signal Conditions (1m Timeframe)
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5" />
              <div>
                <span className="font-medium">Over Signal:</span>
                <span className="text-muted-foreground ml-2">Digits 0-3 &lt; 10% → Strong over bias</span>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <XCircle className="w-4 h-4 text-rose-400 mt-0.5" />
              <div>
                <span className="font-medium">Under Signal:</span>
                <span className="text-muted-foreground ml-2">Digits 6-9 &lt; 10% → Strong under bias</span>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Activity className="w-4 h-4 text-amber-400 mt-0.5" />
              <div>
                <span className="font-medium">Odd Signal:</span>
                <span className="text-muted-foreground ml-2">Odd digits ≥ 55% → Odd bias</span>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Target className="w-4 h-4 text-sky-400 mt-0.5" />
              <div>
                <span className="font-medium">Even Signal:</span>
                <span className="text-muted-foreground ml-2">Even digits ≥ 55% → Even bias</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
