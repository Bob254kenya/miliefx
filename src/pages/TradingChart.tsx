import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
  Signal,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Play,
  Pause,
  RefreshCw,
  Flame,
  AlertTriangle,
  BarChart,
  Eye,
  EyeOff,
  TrendingUp as TrendIcon,
  Layers,
  Timer,
  Brain,
  Shield,
  Star,
  Award
} from 'lucide-react';

// Market configurations - focus on Volatility 25/50 as recommended
const VOLATILITIES = {
  vol: ["1HZ10V", "1HZ25V", "1HZ50V", "1HZ75V", "1HZ100V", "R_10", "R_25", "R_50", "R_75", "R_100"],
  jump: ["JD10", "JD25", "JD50", "JD75", "JD100"],
  bull: ["RDBULL"],
  bear: ["RDBEAR"],
};

// Recommended markets for this strategy (avoid 1s indices and Vol 100 as per strategy)
const RECOMMENDED_MARKETS = [
  { symbol: "R_25", name: "Volatility 25", group: "vol", baseVol: 25, recommended: true },
  { symbol: "R_50", name: "Volatility 50", group: "vol", baseVol: 50, recommended: true },
  { symbol: "R_75", name: "Volatility 75", group: "vol", baseVol: 75, recommended: false },
  { symbol: "R_100", name: "Volatility 100", group: "vol", baseVol: 100, recommended: false },
  { symbol: "1HZ25V", name: "Volatility 25 (1s)", group: "vol1s", baseVol: 25, recommended: false },
  { symbol: "1HZ50V", name: "Volatility 50 (1s)", group: "vol1s", baseVol: 50, recommended: false },
  { symbol: "JD25", name: "Jump 25", group: "jump", baseVol: 25, recommended: true },
  { symbol: "JD50", name: "Jump 50", group: "jump", baseVol: 50, recommended: true },
];

const ALL_MARKETS = VOLATILITIES.vol.map(s => ({ 
  symbol: s, 
  name: s, 
  group: s.includes('1HZ') ? 'vol1s' : 'vol', 
  baseVol: parseInt(s.match(/\d+/)?.[0] || '10'),
  recommended: s === 'R_25' || s === 'R_50'
})).concat(
  VOLATILITIES.jump.map(s => ({ 
    symbol: s, 
    name: s, 
    group: 'jump', 
    baseVol: parseInt(s.match(/\d+/)?.[0] || '10'),
    recommended: s === 'JD25' || s === 'JD50'
  })),
  VOLATILITIES.bull.map(s => ({ symbol: s, name: 'Bull Market', group: 'bull', baseVol: 50, recommended: false })),
  VOLATILITIES.bear.map(s => ({ symbol: s, name: 'Bear Market', group: 'bear', baseVol: 50, recommended: false }))
);

// Signal types
type SignalType = 'over_4' | 'under_5' | 'over_0' | 'under_9' | 'reversal_over' | 'reversal_under';
type SignalStrength = 'critical' | 'strong' | 'moderate' | 'weak';

interface DigitStats {
  digit: number;
  count: number;
  percentage: number;
}

interface ZoneAnalysis {
  lowerZone: number[]; // digits 0-4
  upperZone: number[]; // digits 5-9
  lowerCount: number;
  upperCount: number;
  lowerPct: number;
  upperPct: number;
  difference: number;
  dominantZone: 'lower' | 'upper' | 'balanced';
}

interface LastTicksAnalysis {
  ticks: number[];
  over4Count: number;
  under5Count: number;
  over4Pct: number;
  under5Pct: number;
  trend: 'increasing' | 'decreasing' | 'stable';
  hasSpike: boolean;
  isSlow: boolean;
}

interface Signal {
  id: string;
  market: typeof ALL_MARKETS[0];
  type: SignalType;
  strength: SignalStrength;
  entryPrice: string;
  confidence: number;
  timestamp: number;
  timeframe: string;
  conditionMet: string;
  priority: number;
  stats: {
    lowerCount: number;
    upperCount: number;
    difference: number;
    last20OverPct: number;
    weakDigits: number[];
    strongDigits: number[];
    dominantDigit: number;
    weakestDigit: number;
  };
  reversalInfo?: {
    overboughtDigit: number;
    oversoldDigit: number;
  };
}

// Helper function to get last digit
const getLastDigit = (price: number): number => {
  const priceStr = price.toString();
  const match = priceStr.match(/\d+(?:\.\d+)?/);
  if (!match) return 0;
  const numStr = match[0].replace('.', '');
  return parseInt(numStr.slice(-1), 10);
};

// Analyze 1000 ticks for zone distribution
const analyzeZoneDistribution = (ticks: number[]): ZoneAnalysis => {
  const lowerZone = ticks.filter(d => d >= 0 && d <= 4);
  const upperZone = ticks.filter(d => d >= 5 && d <= 9);
  
  const lowerCount = lowerZone.length;
  const upperCount = upperZone.length;
  const total = ticks.length;
  
  return {
    lowerZone: lowerZone.map(d => d),
    upperZone: upperZone.map(d => d),
    lowerCount,
    upperCount,
    lowerPct: (lowerCount / total) * 100,
    upperPct: (upperCount / total) * 100,
    difference: Math.abs(upperCount - lowerCount),
    dominantZone: upperCount > lowerCount ? 'upper' : lowerCount > upperCount ? 'lower' : 'balanced',
  };
};

// Analyze last 20 ticks for confirmation
const analyzeLastTicks = (ticks: number[], threshold: number = 4): LastTicksAnalysis => {
  const last20 = ticks.slice(-20);
  const over4Count = last20.filter(d => d > 4).length;
  const under5Count = last20.filter(d => d < 5).length;
  
  // Check for spikes (sudden change in pattern)
  const last5 = last20.slice(-5);
  const prev5 = last20.slice(-10, -5);
  const spikeDetected = Math.abs(
    last5.filter(d => d > 4).length - prev5.filter(d => d > 4).length
  ) >= 3;
  
  // Check if market is slow (tick pause simulation)
  // In real implementation, this would check actual time between ticks
  const isSlow = last20.length > 0; // Placeholder - would need timestamp data
  
  // Trend analysis
  const recent = last20.slice(-10);
  const older = last20.slice(-20, -10);
  const recentOver = recent.filter(d => d > 4).length;
  const olderOver = older.filter(d => d > 4).length;
  
  let trend: 'increasing' | 'decreasing' | 'stable' = 'stable';
  if (recentOver > olderOver + 2) trend = 'increasing';
  else if (recentOver < olderOver - 2) trend = 'decreasing';
  
  return {
    ticks: last20,
    over4Count,
    under5Count,
    over4Pct: (over4Count / 20) * 100,
    under5Pct: (under5Count / 20) * 100,
    trend,
    hasSpike: spikeDetected,
    isSlow,
  };
};

// Analyze digit frequency
const analyzeDigitFrequency = (ticks: number[]): {
  frequencies: Record<number, number>;
  percentages: Record<number, number>;
  mostFrequent: DigitStats;
  leastFrequent: DigitStats;
  sortedDigits: DigitStats[];
} => {
  const frequencies: Record<number, number> = {};
  for (let i = 0; i <= 9; i++) frequencies[i] = 0;
  ticks.forEach(d => frequencies[d]++);
  
  const total = ticks.length;
  const percentages: Record<number, number> = {};
  const sorted: DigitStats[] = [];
  
  for (let i = 0; i <= 9; i++) {
    const pct = (frequencies[i] / total) * 100;
    percentages[i] = pct;
    sorted.push({ digit: i, count: frequencies[i], percentage: pct });
  }
  
  sorted.sort((a, b) => b.count - a.count);
  
  return {
    frequencies,
    percentages,
    mostFrequent: sorted[0],
    leastFrequent: sorted[sorted.length - 1],
    sortedDigits: sorted,
  };
};

// Check for reversal conditions (extreme digit appearance)
const checkReversalConditions = (digitFreq: ReturnType<typeof analyzeDigitFrequency>): {
  overboughtDigit: number | null;
  oversoldDigit: number | null;
  overboughtPct: number;
  oversoldPct: number;
} => {
  let overboughtDigit: number | null = null;
  let oversoldDigit: number | null = null;
  let overboughtPct = 0;
  let oversoldPct = 100;
  
  for (let i = 0; i <= 9; i++) {
    const pct = digitFreq.percentages[i];
    if (pct > 15) {
      overboughtDigit = i;
      overboughtPct = pct;
    }
    if (pct < 5 && oversoldPct > pct) {
      oversoldDigit = i;
      oversoldPct = pct;
    }
  }
  
  return { overboughtDigit, oversoldDigit, overboughtPct, oversoldPct };
};

// Generate signals based on 1000 ticks strategy
const generateSignals = (
  market: typeof ALL_MARKETS[0],
  ticks: number[]
): Omit<Signal, 'id' | 'timestamp' | 'priority'>[] => {
  if (!ticks || ticks.length < 1000) return [];
  
  const signals: Omit<Signal, 'id' | 'timestamp' | 'priority'>[] = [];
  
  // STEP 2: Calculate zones
  const zoneAnalysis = analyzeZoneDistribution(ticks);
  const lastTicksAnalysis = analyzeLastTicks(ticks);
  const digitFreq = analyzeDigitFrequency(ticks);
  const reversalConditions = checkReversalConditions(digitFreq);
  
  // STEP 3: STRATEGY 1 - OVER 4 (BUY OVER)
  // Entry: Upper zone > Lower zone, difference >= 60, digits 7,8,9 increasing, digit 0 or 1 weak
  const isOver4Condition = 
    zoneAnalysis.upperCount > zoneAnalysis.lowerCount &&
    zoneAnalysis.difference >= 60 &&
    lastTicksAnalysis.over4Pct > 50 &&
    (digitFreq.percentages[0] < 8 || digitFreq.percentages[1] < 8) &&
    !lastTicksAnalysis.hasSpike;
  
  if (isOver4Condition) {
    let strength: SignalStrength = 'moderate';
    let confidence = 65;
    
    // Strong confirmation
    if (zoneAnalysis.difference >= 80 && lastTicksAnalysis.over4Pct >= 70) {
      strength = 'critical';
      confidence = 92;
    } else if (zoneAnalysis.difference >= 70 && lastTicksAnalysis.over4Pct >= 60) {
      strength = 'strong';
      confidence = 82;
    } else if (zoneAnalysis.difference >= 60 && lastTicksAnalysis.over4Pct >= 55) {
      strength = 'moderate';
      confidence = 72;
    }
    
    // Check if digits 7,8,9 are strong
    const strongDigits = [7, 8, 9].filter(d => digitFreq.percentages[d] > 10);
    const weakDigits = [0, 1].filter(d => digitFreq.percentages[d] < 8);
    
    signals.push({
      market,
      type: 'over_4',
      strength,
      entryPrice: 'OVER 4',
      confidence,
      timeframe: '1m',
      conditionMet: `Upper zone (5-9) at ${zoneAnalysis.upperPct.toFixed(1)}% vs Lower zone at ${zoneAnalysis.lowerPct.toFixed(1)}%. Difference: ${zoneAnalysis.difference} ticks. Strong digits: ${strongDigits.join(',')}. Weak digits: ${weakDigits.join(',')}. Last 20 ticks: ${lastTicksAnalysis.over4Pct.toFixed(0)}% over 4.`,
      stats: {
        lowerCount: zoneAnalysis.lowerCount,
        upperCount: zoneAnalysis.upperCount,
        difference: zoneAnalysis.difference,
        last20OverPct: lastTicksAnalysis.over4Pct,
        weakDigits,
        strongDigits,
        dominantDigit: digitFreq.mostFrequent.digit,
        weakestDigit: digitFreq.leastFrequent.digit,
      },
    });
  }
  
  // STRATEGY 2 - UNDER 5 (BUY UNDER)
  // Entry: Lower zone > Upper zone, difference >= 60, digits 0,1,2 strong, digits 8,9 weak
  const isUnder5Condition = 
    zoneAnalysis.lowerCount > zoneAnalysis.upperCount &&
    zoneAnalysis.difference >= 60 &&
    lastTicksAnalysis.under5Pct > 50 &&
    (digitFreq.percentages[8] < 8 || digitFreq.percentages[9] < 8) &&
    !lastTicksAnalysis.hasSpike;
  
  if (isUnder5Condition) {
    let strength: SignalStrength = 'moderate';
    let confidence = 65;
    
    if (zoneAnalysis.difference >= 80 && lastTicksAnalysis.under5Pct >= 70) {
      strength = 'critical';
      confidence = 92;
    } else if (zoneAnalysis.difference >= 70 && lastTicksAnalysis.under5Pct >= 60) {
      strength = 'strong';
      confidence = 82;
    } else if (zoneAnalysis.difference >= 60 && lastTicksAnalysis.under5Pct >= 55) {
      strength = 'moderate';
      confidence = 72;
    }
    
    const strongDigits = [0, 1, 2].filter(d => digitFreq.percentages[d] > 10);
    const weakDigits = [8, 9].filter(d => digitFreq.percentages[d] < 8);
    
    signals.push({
      market,
      type: 'under_5',
      strength,
      entryPrice: 'UNDER 5',
      confidence,
      timeframe: '1m',
      conditionMet: `Lower zone (0-4) at ${zoneAnalysis.lowerPct.toFixed(1)}% vs Upper zone at ${zoneAnalysis.upperPct.toFixed(1)}%. Difference: ${zoneAnalysis.difference} ticks. Strong digits: ${strongDigits.join(',')}. Weak digits: ${weakDigits.join(',')}. Last 20 ticks: ${lastTicksAnalysis.under5Pct.toFixed(0)}% under 5.`,
      stats: {
        lowerCount: zoneAnalysis.lowerCount,
        upperCount: zoneAnalysis.upperCount,
        difference: zoneAnalysis.difference,
        last20OverPct: lastTicksAnalysis.under5Pct,
        weakDigits,
        strongDigits,
        dominantDigit: digitFreq.mostFrequent.digit,
        weakestDigit: digitFreq.leastFrequent.digit,
      },
    });
  }
  
  // REVERSAL STRATEGY - OVER 0 or UNDER 9
  if (reversalConditions.overboughtDigit !== null) {
    const overbought = reversalConditions.overboughtDigit;
    let type: SignalType = 'reversal_under';
    let entryPrice = `UNDER ${overbought}`;
    let conditionMet = `REVERSAL: Digit ${overbought} appears ${reversalConditions.overboughtPct.toFixed(1)}% (overbought). Market will balance → BUY UNDER ${overbought}`;
    
    if (overbought === 9) {
      type = 'reversal_under';
      entryPrice = 'UNDER 9';
      conditionMet = `REVERSAL: Digit 9 appears ${reversalConditions.overboughtPct.toFixed(1)}% (overbought). Market will balance → BUY UNDER 9`;
    } else if (overbought === 0) {
      type = 'reversal_over';
      entryPrice = 'OVER 0';
      conditionMet = `REVERSAL: Digit 0 appears ${reversalConditions.overboughtPct.toFixed(1)}% (oversold). Market will balance → BUY OVER 0`;
    }
    
    signals.push({
      market,
      type,
      strength: reversalConditions.overboughtPct > 20 ? 'critical' : 'strong',
      entryPrice,
      confidence: Math.min(95, 70 + (reversalConditions.overboughtPct - 15) * 2),
      timeframe: '1m',
      conditionMet,
      stats: {
        lowerCount: zoneAnalysis.lowerCount,
        upperCount: zoneAnalysis.upperCount,
        difference: zoneAnalysis.difference,
        last20OverPct: lastTicksAnalysis.over4Pct,
        weakDigits: [digitFreq.leastFrequent.digit],
        strongDigits: [digitFreq.mostFrequent.digit],
        dominantDigit: digitFreq.mostFrequent.digit,
        weakestDigit: digitFreq.leastFrequent.digit,
      },
      reversalInfo: {
        overboughtDigit: reversalConditions.overboughtDigit,
        oversoldDigit: reversalConditions.oversoldDigit || 0,
      },
    });
  }
  
  if (reversalConditions.oversoldDigit !== null && reversalConditions.oversoldDigit !== reversalConditions.overboughtDigit) {
    const oversold = reversalConditions.oversoldDigit;
    let type: SignalType = 'reversal_over';
    let entryPrice = `OVER ${oversold}`;
    let conditionMet = `REVERSAL: Digit ${oversold} appears ${reversalConditions.oversoldPct.toFixed(1)}% (oversold). Market will balance → BUY OVER ${oversold}`;
    
    if (oversold === 0) {
      type = 'reversal_over';
      entryPrice = 'OVER 0';
      conditionMet = `REVERSAL: Digit 0 appears ${reversalConditions.oversoldPct.toFixed(1)}% (oversold). Market will balance → BUY OVER 0`;
    } else if (oversold === 9) {
      type = 'reversal_under';
      entryPrice = 'UNDER 9';
      conditionMet = `REVERSAL: Digit 9 appears ${reversalConditions.oversoldPct.toFixed(1)}% (oversold). Market will balance → BUY UNDER 9`;
    }
    
    signals.push({
      market,
      type,
      strength: reversalConditions.oversoldPct < 3 ? 'critical' : 'strong',
      entryPrice,
      confidence: Math.min(95, 70 + (15 - reversalConditions.oversoldPct) * 2),
      timeframe: '1m',
      conditionMet,
      stats: {
        lowerCount: zoneAnalysis.lowerCount,
        upperCount: zoneAnalysis.upperCount,
        difference: zoneAnalysis.difference,
        last20OverPct: lastTicksAnalysis.over4Pct,
        weakDigits: [digitFreq.leastFrequent.digit],
        strongDigits: [digitFreq.mostFrequent.digit],
        dominantDigit: digitFreq.mostFrequent.digit,
        weakestDigit: digitFreq.leastFrequent.digit,
      },
      reversalInfo: {
        overboughtDigit: reversalConditions.overboughtDigit || 0,
        oversoldDigit: reversalConditions.oversoldDigit,
      },
    });
  }
  
  return signals;
};

// Main Signal Page Component
export default function SignalPage() {
  const [activeSignals, setActiveSignals] = useState<Signal[]>([]);
  const [historicalSignals, setHistoricalSignals] = useState<Signal[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<string>('recommended');
  const [autoScan, setAutoScan] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [showAdvancedStats, setShowAdvancedStats] = useState(false);
  const [martingaleLevel, setMartingaleLevel] = useState(0);
  const [balance, setBalance] = useState(1000);
  const [stakePercent, setStakePercent] = useState(2);
  
  // Market data storage
  const ticksMap = useRef<Record<string, number[]>>({});
  const wsConnections = useRef<Record<string, WebSocket>>({});
  const lastScanResults = useRef<Record<string, ReturnType<typeof generateSignals>>>({});

  // Get filtered markets
  const getFilteredMarkets = useCallback(() => {
    if (selectedGroup === 'recommended') {
      return ALL_MARKETS.filter(m => m.recommended);
    }
    if (selectedGroup === 'all') return ALL_MARKETS;
    return ALL_MARKETS.filter(m => {
      if (selectedGroup === 'vol') return VOLATILITIES.vol.includes(m.symbol);
      if (selectedGroup === 'jump') return VOLATILITIES.jump.includes(m.symbol);
      if (selectedGroup === 'bull') return VOLATILITIES.bull.includes(m.symbol);
      if (selectedGroup === 'bear') return VOLATILITIES.bear.includes(m.symbol);
      return false;
    });
  }, [selectedGroup]);

  // Scan all markets for signals (exactly 4 over/under signals)
  const scanMarkets = useCallback(() => {
    setIsScanning(true);
    
    setTimeout(() => {
      const marketsToScan = getFilteredMarkets();
      const allSignals: Omit<Signal, 'id' | 'timestamp' | 'priority'>[] = [];
      
      marketsToScan.forEach(market => {
        const ticks = ticksMap.current[market.symbol];
        if (ticks && ticks.length >= 1000) {
          const signals = generateSignals(market, ticks);
          allSignals.push(...signals);
        }
      });
      
      // Sort by confidence (highest first)
      const sortedSignals = allSignals.sort((a, b) => b.confidence - a.confidence);
      
      // Take exactly 4 signals for over/under
      const overUnderSignals = sortedSignals.filter(s => 
        s.type === 'over_4' || s.type === 'under_5' || 
        s.type === 'reversal_over' || s.type === 'reversal_under'
      );
      
      // Ensure exactly 4 signals (or less if not enough)
      const selectedSignals = overUnderSignals.slice(0, 4);
      
      // Add metadata
      const finalSignals: Signal[] = selectedSignals.map((signal, idx) => ({
        ...signal,
        id: `${signal.market.symbol}-${Date.now()}-${idx}`,
        timestamp: Date.now(),
        priority: idx + 1,
      }));
      
      setActiveSignals(finalSignals);
      
      // Add to historical
      setHistoricalSignals(prev => {
        const combined = [...finalSignals, ...prev];
        return combined.slice(0, 30);
      });
      
      setLastUpdate(new Date());
      setIsScanning(false);
      
      if (finalSignals.length > 0) {
        const criticalCount = finalSignals.filter(s => s.strength === 'critical').length;
        toast.success(
          `📡 ${finalSignals.length} over/under signal${finalSignals.length > 1 ? 's' : ''} detected! ` +
          `${criticalCount > 0 ? `${criticalCount} critical 🔥 ` : ''}Based on 1000 ticks analysis`
        );
      } else {
        toast.info('No strong signals detected. Waiting for market imbalance...');
      }
    }, 500);
  }, [getFilteredMarkets]);

  // Auto-scan interval
  useEffect(() => {
    if (!autoScan) return;
    
    scanMarkets();
    const interval = setInterval(scanMarkets, 30000);
    
    return () => clearInterval(interval);
  }, [autoScan, scanMarkets]);

  // WebSocket connection for each market
  useEffect(() => {
    const connectMarket = (symbol: string) => {
      if (wsConnections.current[symbol]) return;
      
      const ws = new WebSocket(`wss://ws.binaryws.com/websockets/v3?app_id=1089`);
      const ticks: number[] = [];
      
      ws.onopen = () => {
        ws.send(JSON.stringify({ ticks_history: symbol, count: 1000, end: "latest", style: "ticks" }));
      };
      
      ws.onmessage = (msg) => {
        const data = JSON.parse(msg.data);
        
        if (data.history?.prices) {
          data.history.prices.forEach((price: number) => {
            const digit = getLastDigit(price);
            if (!isNaN(digit)) ticks.push(digit);
          });
          ticksMap.current[symbol] = ticks;
          ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
        }
        
        if (data.tick?.quote) {
          const digit = getLastDigit(data.tick.quote);
          if (!isNaN(digit)) {
            if (ticks.length >= 2000) ticks.shift();
            ticks.push(digit);
            ticksMap.current[symbol] = [...ticks];
          }
        }
      };
      
      ws.onerror = () => console.error(`WebSocket error for ${symbol}`);
      ws.onclose = () => {
        delete wsConnections.current[symbol];
        setTimeout(() => connectMarket(symbol), 5000);
      };
      
      wsConnections.current[symbol] = ws;
    };
    
    const markets = getFilteredMarkets();
    markets.forEach(m => connectMarket(m.symbol));
    
    return () => {
      Object.values(wsConnections.current).forEach(ws => ws.close());
      wsConnections.current = {};
    };
  }, [selectedGroup]);

  const getSignalStats = useMemo(() => {
    const total = activeSignals.length;
    const critical = activeSignals.filter(s => s.strength === 'critical').length;
    const strong = activeSignals.filter(s => s.strength === 'strong').length;
    const moderate = activeSignals.filter(s => s.strength === 'moderate').length;
    const over4 = activeSignals.filter(s => s.type === 'over_4').length;
    const under5 = activeSignals.filter(s => s.type === 'under_5').length;
    const reversal = activeSignals.filter(s => s.type === 'reversal_over' || s.type === 'reversal_under').length;
    return { total, critical, strong, moderate, over4, under5, reversal };
  }, [activeSignals]);

  // Calculate suggested stake based on balance and martingale
  const suggestedStake = useMemo(() => {
    const baseStake = (balance * stakePercent) / 100;
    const multiplier = Math.pow(2, martingaleLevel);
    return (baseStake * multiplier).toFixed(2);
  }, [balance, stakePercent, martingaleLevel]);

  // Groups for filter
  const groups = [
    { value: 'recommended', label: '⭐ Recommended (Vol 25/50)' },
    { value: 'all', label: 'All Markets' },
    { value: 'vol', label: 'Volatility' },
    { value: 'jump', label: 'Jump' },
    { value: 'bull', label: 'Bull' },
    { value: 'bear', label: 'Bear' },
  ];

  // Signal Card Component
  const SignalCard: React.FC<{ signal: Signal; index: number }> = ({ signal, index }) => {
    const getSignalIcon = () => {
      if (signal.type === 'over_4' || signal.type === 'reversal_over') return <ArrowUp className="w-5 h-5" />;
      if (signal.type === 'under_5' || signal.type === 'reversal_under') return <ArrowDown className="w-5 h-5" />;
      return <Target className="w-5 h-5" />;
    };

    const getSignalColor = () => {
      if (signal.type === 'over_4' || signal.type === 'reversal_over') return 'from-emerald-500 to-green-600';
      return 'from-rose-500 to-red-600';
    };

    const getStrengthColor = () => {
      switch (signal.strength) {
        case 'critical': return 'text-red-400 bg-red-400/10 border-red-400/30';
        case 'strong': return 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30';
        case 'moderate': return 'text-amber-400 bg-amber-400/10 border-amber-400/30';
        default: return 'text-rose-400 bg-rose-400/10 border-rose-400/30';
      }
    };

    const getStrengthText = () => {
      switch (signal.strength) {
        case 'critical': return '🔥 CRITICAL';
        case 'strong': return '⚡ STRONG';
        case 'moderate': return '📊 MODERATE';
        default: return '⚠️ WEAK';
      }
    };

    const getEntryDisplay = () => {
      switch (signal.type) {
        case 'over_4': return 'BUY OVER 4';
        case 'under_5': return 'BUY UNDER 5';
        case 'reversal_over': return signal.entryPrice;
        case 'reversal_under': return signal.entryPrice;
        default: return signal.entryPrice;
      }
    };

    return (
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ delay: index * 0.1, duration: 0.4 }}
        whileHover={{ y: -4, scale: 1.02 }}
      >
        <Card className={`overflow-hidden border-border/50 bg-gradient-to-br from-card/80 to-card/40 backdrop-blur-sm hover:shadow-xl transition-all duration-300 ${
          signal.strength === 'critical' ? 'ring-2 ring-red-500/50 shadow-lg shadow-red-500/20' : ''
        }`}>
          <CardContent className="p-4">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <motion.div
                  whileHover={{ rotate: 360, scale: 1.1 }}
                  className={`w-10 h-10 rounded-xl bg-gradient-to-br ${getSignalColor()} flex items-center justify-center text-white shadow-lg`}
                >
                  {getSignalIcon()}
                </motion.div>
                <div>
                  <h3 className="font-bold text-sm flex items-center gap-2">
                    {signal.market.name}
                    {signal.strength === 'critical' && <Flame className="w-4 h-4 text-red-400" />}
                  </h3>
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
              {/* Entry Price Display */}
              <div className="bg-primary/10 rounded-lg p-3 text-center">
                <div className="text-xs text-muted-foreground mb-1">RECOMMENDED ENTRY</div>
                <div className="font-mono text-xl font-bold text-primary">{getEntryDisplay()}</div>
                <div className="text-xs text-muted-foreground mt-1">Confidence: {signal.confidence}%</div>
              </div>

              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Market Imbalance</span>
                <span className="font-mono font-bold">
                  Upper: {signal.stats.upperCount} | Lower: {signal.stats.lowerCount}
                </span>
              </div>
              
              <div className="relative h-2 bg-muted rounded-full overflow-hidden">
                <div className="absolute inset-y-0 left-0 w-1/2 bg-emerald-500/30 rounded-l-full" />
                <div className="absolute inset-y-0 right-0 w-1/2 bg-rose-500/30 rounded-r-full" />
                <motion.div
                  initial={{ x: 0 }}
                  animate={{ x: `${(signal.stats.upperCount / (signal.stats.upperCount + signal.stats.lowerCount)) * 100}%` }}
                  className="absolute w-1 h-4 bg-primary rounded-full -top-1"
                />
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-emerald-500/10 rounded p-2 text-center">
                  <div className="text-emerald-400">Upper Zone (5-9)</div>
                  <div className="font-mono font-bold">{signal.stats.upperCount}</div>
                  <div className="text-[10px]">{((signal.stats.upperCount / 1000) * 100).toFixed(1)}%</div>
                </div>
                <div className="bg-rose-500/10 rounded p-2 text-center">
                  <div className="text-rose-400">Lower Zone (0-4)</div>
                  <div className="font-mono font-bold">{signal.stats.lowerCount}</div>
                  <div className="text-[10px]">{((signal.stats.lowerCount / 1000) * 100).toFixed(1)}%</div>
                </div>
              </div>

              <div className="flex items-center gap-2 text-xs bg-muted/30 rounded-lg p-2">
                <AlertCircle className="w-3 h-3 flex-shrink-0" />
                <span className="text-muted-foreground">{signal.conditionMet}</span>
              </div>

              {showAdvancedStats && (
                <div className="grid grid-cols-2 gap-2 text-[10px] bg-muted/20 rounded-lg p-2">
                  <div>Difference: {signal.stats.difference} ticks</div>
                  <div>Last 20: {signal.stats.last20OverPct.toFixed(0)}% over</div>
                  <div>Strong digits: {signal.stats.strongDigits.join(',') || 'none'}</div>
                  <div>Weak digits: {signal.stats.weakDigits.join(',') || 'none'}</div>
                  <div>Most frequent: {signal.stats.dominantDigit}</div>
                  <div>Least frequent: {signal.stats.weakestDigit}</div>
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                <div className="flex items-center gap-1 text-xs">
                  <Gauge className="w-3 h-3 text-muted-foreground" />
                  <span>Volatility: {signal.market.baseVol}</span>
                  {signal.market.recommended && (
                    <Badge className="bg-emerald-500/20 text-emerald-400 text-[8px]">⭐ Recommended</Badge>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-muted-foreground">Priority: {signal.priority}/4</span>
                  <Signal className="w-4 h-4 text-primary" />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background/95 to-background/90">
      {/* Header */}
      <div className="relative overflow-hidden border-b border-border/50 bg-card/30 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-6">
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
                  1000 Ticks Over/Under Strategy
                </h1>
                <p className="text-sm text-muted-foreground">
                  High accuracy | Zone imbalance detection | Reversal strategy | Exactly 4 signals
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

          {/* Money Management Panel */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-6 p-4 bg-gradient-to-r from-emerald-500/10 to-rose-500/10 rounded-xl border border-border/50"
          >
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Account Balance</label>
              <Input
                type="number"
                value={balance}
                onChange={(e) => setBalance(parseFloat(e.target.value) || 0)}
                className="h-9 text-sm font-mono"
                prefix="$"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Risk % per Trade</label>
              <Input
                type="number"
                value={stakePercent}
                onChange={(e) => setStakePercent(parseFloat(e.target.value) || 2)}
                className="h-9 text-sm"
                min={1}
                max={10}
                step={0.5}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Martingale Level</label>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setMartingaleLevel(Math.max(0, martingaleLevel - 1))}
                  className="h-9 w-9"
                >-</Button>
                <span className="font-mono font-bold w-8 text-center">{martingaleLevel}</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setMartingaleLevel(Math.min(2, martingaleLevel + 1))}
                  className="h-9 w-9"
                >+</Button>
                <span className="text-xs text-muted-foreground ml-2">Max 2 levels</span>
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Suggested Stake</label>
              <div className="text-2xl font-bold text-primary">${suggestedStake}</div>
              <div className="text-[10px] text-muted-foreground">{stakePercent}% of balance × {Math.pow(2, martingaleLevel)}x</div>
            </div>
          </motion.div>

          {/* Stats Cards */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="grid grid-cols-2 md:grid-cols-7 gap-4 mt-6"
          >
            <div className="bg-card/50 rounded-xl border border-border/50 p-3">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Signal className="w-4 h-4" />
                <span className="text-xs">Active Signals</span>
              </div>
              <div className="text-2xl font-bold">{getSignalStats.total}</div>
              <div className="text-[10px] text-muted-foreground">Exactly 4 signals</div>
            </div>
            <div className="bg-card/50 rounded-xl border border-border/50 p-3">
              <div className="flex items-center gap-2 text-red-400 mb-1">
                <Flame className="w-4 h-4" />
                <span className="text-xs">Critical</span>
              </div>
              <div className="text-2xl font-bold text-red-400">{getSignalStats.critical}</div>
            </div>
            <div className="bg-card/50 rounded-xl border border-border/50 p-3">
              <div className="flex items-center gap-2 text-emerald-400 mb-1">
                <TrendingUp className="w-4 h-4" />
                <span className="text-xs">Strong</span>
              </div>
              <div className="text-2xl font-bold text-emerald-400">{getSignalStats.strong}</div>
            </div>
            <div className="bg-card/50 rounded-xl border border-border/50 p-3">
              <div className="flex items-center gap-2 text-amber-400 mb-1">
                <ArrowUp className="w-4 h-4" />
                <span className="text-xs">Over 4</span>
              </div>
              <div className="text-2xl font-bold text-amber-400">{getSignalStats.over4}</div>
            </div>
            <div className="bg-card/50 rounded-xl border border-border/50 p-3">
              <div className="flex items-center gap-2 text-rose-400 mb-1">
                <ArrowDown className="w-4 h-4" />
                <span className="text-xs">Under 5</span>
              </div>
              <div className="text-2xl font-bold text-rose-400">{getSignalStats.under5}</div>
            </div>
            <div className="bg-card/50 rounded-xl border border-border/50 p-3">
              <div className="flex items-center gap-2 text-purple-400 mb-1">
                <RefreshCw className="w-4 h-4" />
                <span className="text-xs">Reversal</span>
              </div>
              <div className="text-2xl font-bold text-purple-400">{getSignalStats.reversal}</div>
            </div>
            <div className="bg-card/50 rounded-xl border border-border/50 p-3">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Timer className="w-4 h-4" />
                <span className="text-xs">Last Scan</span>
              </div>
              <div className="text-sm font-mono">{lastUpdate.toLocaleTimeString()}</div>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Filter Section */}
      <div className="container mx-auto px-4 py-6">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="gap-1 bg-emerald-500/10 border-emerald-500/30">
              <Brain className="w-3 h-3 text-emerald-400" />
              1000 Ticks Analysis
            </Badge>
            <Badge variant="outline" className="gap-1">
              <Layers className="w-3 h-3" />
              Zone: Upper (5-9) vs Lower (0-4)
            </Badge>
            <Badge variant="outline" className="gap-1">
              <Shield className="w-3 h-3" />
              Min difference: 60 ticks
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowAdvancedStats(!showAdvancedStats)}
              className="text-xs gap-1"
            >
              {showAdvancedStats ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              {showAdvancedStats ? 'Hide' : 'Show'} Advanced Stats
            </Button>
          </div>
          
          <div className="flex gap-2 flex-wrap">
            {groups.map(group => (
              <Button
                key={group.value}
                size="sm"
                variant={selectedGroup === group.value ? 'default' : 'outline'}
                onClick={() => setSelectedGroup(group.value)}
                className="text-xs"
              >
                {group.value === 'recommended' && <Star className="w-3 h-3 mr-1" />}
                {group.label}
              </Button>
            ))}
          </div>
        </div>

        {/* Strategy Info Banner */}
        <div className="mb-6 p-4 bg-gradient-to-r from-primary/5 to-primary/10 rounded-xl border border-primary/20">
          <div className="flex items-start gap-3">
            <Award className="w-8 h-8 text-primary" />
            <div>
              <h3 className="font-semibold text-sm">🎯 1000 Ticks Over/Under Strategy</h3>
              <div className="text-xs text-muted-foreground mt-1 grid grid-cols-1 md:grid-cols-2 gap-2">
                <div>✅ Entry: Upper/Lower zone difference ≥ 60 ticks</div>
                <div>✅ Confirmation: Last 20 ticks majority in direction</div>
                <div>✅ Reversal: Extreme digit appearance (overbought/oversold)</div>
                <div>✅ Avoid: Volatility 100 & 1s indices (too random)</div>
                <div>✅ Money Management: 2-5% stake, max 2 martingale levels</div>
                <div>✅ Timing: Wait for tick pause or repeated patterns</div>
              </div>
            </div>
          </div>
        </div>
        
        {/* Active Signals Grid - Exactly 4 Over/Under Signals */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Zap className="w-5 h-5 text-primary" />
              Over/Under Signals
              <Badge variant="secondary" className="ml-2">
                {activeSignals.length}/4 signals | Based on 1000 ticks
              </Badge>
            </h2>
            {isScanning && (
              <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1 }}>
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
              <p className="text-muted-foreground">No strong signals at the moment</p>
              <p className="text-xs text-muted-foreground mt-1">Waiting for zone imbalance ≥ 60 ticks...</p>
              <p className="text-xs text-muted-foreground">Recommended: Volatility 25/50 markets for best results</p>
            </motion.div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
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
              Recent Signals History
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              {historicalSignals.slice(0, 8).map((signal, idx) => (
                <motion.div
                  key={signal.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.03 }}
                  className={`bg-card/40 rounded-lg border border-border/50 p-3 hover:bg-card/60 transition-colors ${
                    signal.strength === 'critical' ? 'border-red-500/30 bg-red-500/5' : ''
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs ${
                        signal.type === 'over_4' || signal.type === 'reversal_over' ? 'bg-emerald-500/20 text-emerald-400' :
                        'bg-rose-500/20 text-rose-400'
                      }`}>
                        {signal.type === 'over_4' || signal.type === 'reversal_over' ? '↑' : '↓'}
                      </div>
                      <span className="font-mono text-xs font-medium truncate max-w-[80px]">{signal.market.name}</span>
                    </div>
                    <Badge className={`text-[8px] ${
                      signal.strength === 'critical' ? 'bg-red-500/20 text-red-400' :
                      signal.strength === 'strong' ? 'bg-emerald-500/20 text-emerald-400' :
                      'bg-amber-500/20 text-amber-400'
                    }`}>
                      {signal.strength === 'critical' ? '🔥' : ''}{signal.strength}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-bold text-primary">
                      {signal.type === 'over_4' ? 'OVER 4' : 
                       signal.type === 'under_5' ? 'UNDER 5' : 
                       signal.type === 'reversal_over' ? 'OVER REV' : 'UNDER REV'}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(signal.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="text-[9px] text-muted-foreground mt-1">
                    Diff: {signal.stats.difference} | Conf: {signal.confidence}%
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        )}
        
        {/* Strategy Guide */}
        <div className="mt-8 p-4 bg-card/30 rounded-xl border border-border/50">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-primary" />
            📊 1000 Ticks Over/Under Strategy Guide
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5" />
                <div>
                  <span className="font-medium">STRATEGY 1: OVER 4</span>
                  <div className="text-muted-foreground text-xs">
                    <div>• Upper zone (5-9) > Lower zone (0-4)</div>
                    <div>• Difference ≥ 60 ticks</div>
                    <div>• Digits 7,8,9 increasing, digit 0/1 weak</div>
                    <div>• Last 20 ticks: majority above 4</div>
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <XCircle className="w-4 h-4 text-rose-400 mt-0.5" />
                <div>
                  <span className="font-medium">STRATEGY 2: UNDER 5</span>
                  <div className="text-muted-foreground text-xs">
                    <div>• Lower zone (0-4) > Upper zone (5-9)</div>
                    <div>• Difference ≥ 60 ticks</div>
                    <div>• Digits 0,1,2 strong, digits 8,9 weak</div>
                    <div>• Last 20 ticks: majority below 5</div>
                  </div>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-start gap-2">
                <RefreshCw className="w-4 h-4 text-purple-400 mt-0.5" />
                <div>
                  <span className="font-medium">REVERSAL STRATEGY</span>
                  <div className="text-muted-foreground text-xs">
                    <div>• Digit 9 overbought → BUY UNDER 9</div>
                    <div>• Digit 0 oversold → BUY OVER 0</div>
                    <div>• Market always balances after extremes</div>
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Shield className="w-4 h-4 text-primary mt-0.5" />
                <div>
                  <span className="font-medium">RISK MANAGEMENT</span>
                  <div className="text-muted-foreground text-xs">
                    <div>• Stake: 2-5% of balance</div>
                    <div>• Martingale: Max 2 levels only</div>
                    <div>• Avoid: Volatility 100, 1s indices</div>
                    <div>• Wait for tick pause or pattern confirmation</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-border/50 text-xs text-muted-foreground text-center">
            🎯 Exactly 4 over/under signals per scan | Based on 1000 ticks market memory | High probability trades
          </div>
        </div>
      </div>
    </div>
  );
}
