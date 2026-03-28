import { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TrendingUp, TrendingDown, Activity, Zap, BarChart3, ArrowUpDown } from 'lucide-react';

interface VolatilityCardProps {
  symbol: string;
  tickCount: number;
  mode: 'over' | 'under';
  onStrongSignal?: (hasSignal: boolean) => void;
}

interface Pattern {
  digits: number[];
  length: number;
  frequency: number;
}

/**
 * Extracts last digit from a price using Deriv-standard method
 */
function extractDigit(price: number): number {
  const fixed = parseFloat(String(price)).toFixed(2);
  const d = parseInt(fixed.slice(-1), 10);
  if (Number.isNaN(d) || d < 0 || d > 9) return 0;
  return d;
}

export default function VolatilityCard({ symbol, tickCount, mode, onStrongSignal }: VolatilityCardProps) {
  const [digits, setDigits] = useState<number[]>([]);
  const [activeDigit, setActiveDigit] = useState(5);
  const [status, setStatus] = useState<'connecting' | 'live' | 'error' | 'offline'>('connecting');
  const wsRef = useRef<WebSocket | null>(null);
  const digitsRef = useRef<number[]>([]);

  // WebSocket connection
  useEffect(() => {
    digitsRef.current = [];
    setDigits([]);
    setStatus('connecting');

    const ws = new WebSocket('wss://ws.binaryws.com/websockets/v3?app_id=1089');
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('live');
      ws.send(JSON.stringify({
        ticks_history: symbol,
        style: 'ticks',
        count: tickCount,
        end: 'latest',
        subscribe: 1,
      }));
    };

    ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data);

      if (data.history) {
        const prices: number[] = data.history.prices || [];
        const extracted = prices.map(extractDigit);
        digitsRef.current = extracted;
        setDigits([...extracted]);
      }

      if (data.tick) {
        const price = parseFloat(data.tick.quote);
        const digit = extractDigit(price);
        if (digit >= 0 && digit <= 9) {
          if (digitsRef.current.length >= 4000) digitsRef.current.shift();
          digitsRef.current.push(digit);
          setDigits([...digitsRef.current]);
        }
      }
    };

    ws.onerror = () => setStatus('error');
    ws.onclose = () => setStatus('offline');

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [symbol, tickCount]);

  // Advanced analysis computations
  const analysis = useMemo(() => {
    const recentTicks = digits.slice(-tickCount);
    const lastDigits = recentTicks.slice(-30);
    const threshold = activeDigit;
    const total = recentTicks.length || 1;

    // Frequency counts 0-9
    const counts = Array(10).fill(0);
    for (let i = 0; i <= recentTicks.length - 1; i++) {
      const d = recentTicks[i];
      if (d >= 0 && d <= 9) counts[d]++;
    }

    // Sorted for ranking
    const sorted = counts
      .map((c, d) => ({ digit: d, count: c, percentage: (c / total) * 100 }))
      .sort((a, b) => b.count - a.count);
    const most = sorted[0]?.digit ?? 0;
    const second = sorted[1]?.digit ?? 1;
    const least = sorted[sorted.length - 1]?.digit ?? 9;

    // Over/Under percentages
    let lowCount = 0;
    for (let i = 0; i < threshold; i++) lowCount += counts[i];
    let highCount = 0;
    for (let i = threshold + 1; i <= 9; i++) highCount += counts[i];
    const lowPercent = ((lowCount / total) * 100).toFixed(1);
    const highPercent = ((highCount / total) * 100).toFixed(1);

    // Even/Odd analysis
    let evenCount = 0;
    let oddCount = 0;
    for (let i = 0; i <= 9; i++) {
      if (i % 2 === 0) evenCount += counts[i];
      else oddCount += counts[i];
    }
    const evenPercent = ((evenCount / total) * 100).toFixed(1);
    const oddPercent = ((oddCount / total) * 100).toFixed(1);

    // Strong signal detection
    let signalType: 'neutral' | 'over' | 'under' = 'neutral';
    let signalStrength = 0;
    let signalText = 'WAIT';
    
    if (most < threshold && second < threshold) {
      signalType = 'under';
      signalStrength = Math.min(100, Math.round(((counts[most] + counts[second]) / total) * 100));
      signalText = `🔥 UNDER ${threshold} (${signalStrength}%)`;
    } else if (most > threshold && second > threshold) {
      signalType = 'over';
      signalStrength = Math.min(100, Math.round(((counts[most] + counts[second]) / total) * 100));
      signalText = `🔥 OVER ${threshold} (${signalStrength}%)`;
    }

    // Entry triggers
    const winningDigits: number[] = [];
    const losingDigits: number[] = [];
    const entryProbability: { digit: number; winRate: number }[] = [];
    
    for (let digit = 0; digit <= 9; digit++) {
      let wins = 0;
      let losses = 0;
      
      for (let i = 0; i < recentTicks.length - 1; i++) {
        if (recentTicks[i] === digit) {
          const next = recentTicks[i + 1];
          if (mode === 'over') {
            if (next > threshold) wins++;
            else if (next < threshold) losses++;
          } else {
            if (next < threshold) wins++;
            else if (next > threshold) losses++;
          }
        }
      }
      
      if (wins + losses > 0) {
        entryProbability.push({
          digit,
          winRate: (wins / (wins + losses)) * 100
        });
      }
    }
    
    entryProbability.sort((a, b) => b.winRate - a.winRate);
    const bestEntryDigits = entryProbability.slice(0, 2);

    // Pattern detection (longest 3 consecutive patterns)
    const patterns: Pattern[] = [];
    let currentPattern: number[] = [];
    
    for (let i = 0; i < recentTicks.length; i++) {
      if (currentPattern.length === 0 || recentTicks[i] === currentPattern[currentPattern.length - 1]) {
        currentPattern.push(recentTicks[i]);
      } else {
        if (currentPattern.length >= 3) {
          patterns.push({
            digits: [...currentPattern],
            length: currentPattern.length,
            frequency: 1
          });
        }
        currentPattern = [recentTicks[i]];
      }
    }
    
    // Merge and count pattern frequencies
    const patternMap = new Map<string, Pattern>();
    patterns.forEach(pattern => {
      const key = pattern.digits.join(',');
      if (patternMap.has(key)) {
        const existing = patternMap.get(key)!;
        existing.frequency++;
      } else {
        patternMap.set(key, { ...pattern });
      }
    });
    
    const longestPatterns = Array.from(patternMap.values())
      .sort((a, b) => b.length - a.length)
      .slice(0, 2);

    // Notify parent of strong signal
    const hasStrongSignal = signalType !== 'neutral';
    useEffect(() => {
      onStrongSignal?.(hasStrongSignal);
    }, [hasStrongSignal, onStrongSignal]);

    return {
      lastDigits,
      counts,
      total,
      most,
      second,
      least,
      lowPercent,
      highPercent,
      signalType,
      signalStrength,
      signalText,
      winningDigits,
      losingDigits,
      evenPercent,
      oddPercent,
      bestEntryDigits,
      longestPatterns,
      entryProbability
    };
  }, [digits, tickCount, activeDigit, mode, onStrongSignal]);

  const statusColor = status === 'live' ? 'text-green-500' : status === 'error' ? 'text-red-500' : 'text-yellow-500';
  const statusBg = status === 'live' ? 'bg-green-500/10' : status === 'error' ? 'bg-red-500/10' : 'bg-yellow-500/10';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -1 }}
      transition={{ duration: 0.15 }}
      className="bg-gradient-to-br from-card to-card/95 backdrop-blur-sm border border-border/50 rounded-lg p-2 shadow-md hover:shadow-lg transition-all duration-150"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1">
          <Activity className="w-3 h-3 text-primary" />
          <h3 className="font-bold text-[11px] bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
            {symbol}
          </h3>
        </div>
        <div className={`px-1 py-0.5 rounded-full text-[8px] font-mono ${statusBg} ${statusColor}`}>
          {status === 'live' && '● LIVE'}
          {status === 'connecting' && '● CONN'}
          {status === 'error' && '● ERR'}
          {status === 'offline' && '● OFF'}
        </div>
      </div>

      {/* Signal Box */}
      <AnimatePresence>
        {analysis.signalType !== 'neutral' && (
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className={`mb-2 rounded-md p-1 text-center ${
              analysis.signalType === 'over'
                ? 'bg-gradient-to-r from-green-500/20 to-emerald-500/20 border border-green-500/30'
                : 'bg-gradient-to-r from-red-500/20 to-rose-500/20 border border-red-500/30'
            }`}
          >
            <div className="flex items-center justify-center gap-0.5">
              {analysis.signalType === 'over' ? (
                <TrendingUp className="w-2.5 h-2.5 text-green-500" />
              ) : (
                <TrendingDown className="w-2.5 h-2.5 text-red-500" />
              )}
              <span className={`text-[8px] font-bold ${
                analysis.signalType === 'over' ? 'text-green-500' : 'text-red-500'
              }`}>
                {analysis.signalText}
              </span>
            </div>
            <div className="w-full bg-muted rounded-full h-0.5 mt-0.5">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${analysis.signalStrength}%` }}
                className={`h-0.5 rounded-full ${
                  analysis.signalType === 'over' ? 'bg-green-500' : 'bg-red-500'
                }`}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Last 30 digits - NO ANIMATION */}
      <div className="mb-2">
        <div className="flex items-center gap-1 mb-1">
          <BarChart3 className="w-2 h-2 text-muted-foreground" />
          <span className="text-[8px] text-muted-foreground">Last 30</span>
        </div>
        <div className="grid grid-cols-10 gap-0.5">
          {analysis.lastDigits.map((d, i) => {
            let bgColor = 'bg-muted';
            let textColor = 'text-foreground';
            if (d === activeDigit) {
              bgColor = 'bg-primary';
              textColor = 'text-primary-foreground';
            } else if (d > activeDigit) {
              bgColor = 'bg-green-500/20';
              textColor = 'text-green-500';
            } else if (d < activeDigit) {
              bgColor = 'bg-red-500/20';
              textColor = 'text-red-500';
            }
            return (
              <div
                key={`${i}-${d}`}
                className={`w-full aspect-square flex items-center justify-center rounded-full text-[8px] font-mono font-bold ${bgColor} ${textColor}`}
              >
                {d}
              </div>
            );
          })}
        </div>
      </div>

      {/* Digit buttons */}
      <div className="mb-2">
        <div className="grid grid-cols-5 gap-0.5">
          {Array.from({ length: 10 }, (_, i) => {
            const pct = analysis.total > 0 ? ((analysis.counts[i] / analysis.total) * 100).toFixed(0) : '0';
            let btnClass = 'bg-muted/50 hover:bg-muted text-foreground';
            if (i === analysis.most) btnClass = 'bg-gradient-to-r from-green-500 to-emerald-500 text-white';
            else if (i === analysis.second) btnClass = 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white';
            else if (i === analysis.least) btnClass = 'bg-gradient-to-r from-red-500 to-rose-500 text-white';

            return (
              <motion.button
                key={i}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setActiveDigit(i)}
                className={`rounded py-0.5 text-[9px] font-mono font-bold transition-all ${btnClass} ${
                  i === activeDigit ? 'ring-1 ring-primary ring-offset-0' : ''
                }`}
              >
                {i}
                <span className="block text-[7px] opacity-80">{pct}%</span>
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* Compact Stats */}
      <div className="grid grid-cols-2 gap-1 mb-2">
        <div className="bg-muted/30 rounded p-1">
          <div className="flex justify-between text-[8px] font-mono">
            <span className="text-red-500">{activeDigit}</span>
            <span className="text-green-500">{activeDigit}</span>
          </div>
          <div className="flex gap-0.5">
            <div className="flex-1 h-1 bg-red-500/20 rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${analysis.lowPercent}%` }}
                className="h-full bg-red-500 rounded-full"
              />
            </div>
            <div className="flex-1 h-1 bg-green-500/20 rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${analysis.highPercent}%` }}
                className="h-full bg-green-500 rounded-full"
              />
            </div>
          </div>
          <div className="flex justify-between text-[7px]">
            <span className="text-red-500">{analysis.lowPercent}%</span>
            <span className="text-green-500">{analysis.highPercent}%</span>
          </div>
        </div>

        <div className="bg-muted/30 rounded p-1">
          <div className="flex items-center justify-between gap-0.5">
            <ArrowUpDown className="w-2 h-2 text-muted-foreground" />
            <span className="text-[7px] font-medium">E/O</span>
          </div>
          <div className="flex gap-0.5 mt-0.5">
            <div className="flex-1 h-1 bg-purple-500/20 rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${analysis.evenPercent}%` }}
                className="h-full bg-purple-500 rounded-full"
              />
            </div>
            <div className="flex-1 h-1 bg-orange-500/20 rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${analysis.oddPercent}%` }}
                className="h-full bg-orange-500 rounded-full"
              />
            </div>
          </div>
          <div className="flex justify-between text-[7px]">
            <span className="text-purple-500">{analysis.evenPercent}%</span>
            <span className="text-orange-500">{analysis.oddPercent}%</span>
          </div>
        </div>
      </div>

      {/* Best Entries */}
      <div className="mb-2 bg-gradient-to-r from-primary/5 to-primary/10 rounded p-1">
        <div className="flex items-center gap-0.5">
          <Zap className="w-2 h-2 text-primary" />
          <span className="text-[7px] font-bold text-primary">BEST</span>
        </div>
        <div className="flex justify-around mt-0.5">
          {analysis.bestEntryDigits.map((entry, idx) => (
            <div key={idx} className="text-center">
              <div className="text-[11px] font-mono font-bold text-foreground">{entry.digit}</div>
              <div className="text-[6px] text-green-500">{entry.winRate.toFixed(0)}%</div>
            </div>
          ))}
        </div>
      </div>

      {/* Patterns & Triggers */}
      {analysis.longestPatterns.length > 0 && (
        <div className="bg-muted/30 rounded p-1 mb-1">
          <div className="flex items-center gap-0.5">
            <TrendingUp className="w-2 h-2 text-muted-foreground" />
            <span className="text-[7px] font-medium">Patterns</span>
          </div>
          <div className="text-[7px] font-mono">
            {analysis.longestPatterns[0]?.digits.slice(0, 3).join('→')}
          </div>
        </div>
      )}

      {/* Triggers */}
      <div className="bg-muted/30 rounded p-1">
        <div className="flex justify-between">
          <div>
            <div className="flex items-center gap-0.5">
              <div className="w-1 h-1 rounded-full bg-green-500" />
              <span className="text-[6px]">W</span>
            </div>
            <div className="flex gap-0.5 mt-0.5">
              {analysis.winningDigits.slice(0, 3).map(d => (
                <span key={d} className="px-0.5 bg-green-500/20 text-green-500 rounded text-[6px] font-mono">
                  {d}
                </span>
              ))}
            </div>
          </div>
          <div>
            <div className="flex items-center gap-0.5">
              <div className="w-1 h-1 rounded-full bg-red-500" />
              <span className="text-[6px]">L</span>
            </div>
            <div className="flex gap-0.5 mt-0.5">
              {analysis.losingDigits.slice(0, 3).map(d => (
                <span key={d} className="px-0.5 bg-red-500/20 text-red-500 rounded text-[6px] font-mono">
                  {d}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
