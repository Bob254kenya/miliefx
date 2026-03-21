import { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';

interface Signal {
  type: string;
  name: string;
  strength: number;
  symbol: string;
  detail: string;
  extra: string;
}

interface VolatilityMarkets {
  vol: string[];
  jump: string[];
  bull: string[];
  bear: string[];
}

const VOLATILITIES: VolatilityMarkets = {
  vol: ["1HZ10V", "1HZ25V", "1HZ50V", "1HZ75V", "1HZ100V", "R_10", "R_25", "R_50", "R_75", "R_100"],
  jump: ["JD10", "JD25", "JD50", "JD75", "JD100"],
  bull: ["RDBULL"],
  bear: ["RDBEAR"],
};

const TICK_DEPTH = 1000;

// Helper: compute digit frequencies, over/under, odd/even, rise/fall from recent ticks
function computeDigitStats(ticks: number[], thresholdDigit: number) {
  if (!ticks || ticks.length < 100) return null;
  const recent = ticks.slice(-TICK_DEPTH);
  const freq = Array(10).fill(0);
  recent.forEach(d => { if (d >= 0 && d <= 9) freq[d]++; });

  let entries = freq.map((count, digit) => ({ digit, count }));
  entries.sort((a, b) => b.count - a.count);
  const mostAppearing = entries[0]?.digit ?? 0;
  const secondMost = entries[1]?.digit ?? mostAppearing;
  const leastAppearing = (() => {
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].count > 0) return entries[i].digit;
    }
    return 0;
  })();

  // over/under stats
  let overCount = 0, underCount = 0;
  recent.forEach(d => { if (d > thresholdDigit) overCount++; else if (d < thresholdDigit) underCount++; });
  // odd/even
  let oddCount = 0, evenCount = 0;
  recent.forEach(d => { if (d % 2 === 0) evenCount++; else oddCount++; });
  // rise/fall
  let riseCount = 0, fallCount = 0;
  for (let i = 1; i < recent.length; i++) {
    if (recent[i] > recent[i - 1]) riseCount++;
    else if (recent[i] < recent[i - 1]) fallCount++;
  }
  const totalComp = recent.length - 1 || 1;

  return {
    mostAppearing,
    secondMost,
    leastAppearing,
    overRate: overCount / recent.length,
    underRate: underCount / recent.length,
    oddRate: oddCount / recent.length,
    evenRate: evenCount / recent.length,
    riseRate: riseCount / totalComp,
    fallRate: fallCount / totalComp,
    totalTicks: recent.length
  };
}

export function SignalForge() {
  const [contractType, setContractType] = useState<'overunder' | 'evenodd' | 'risefall'>('overunder');
  const [marketGroup, setMarketGroup] = useState<'all' | 'vol' | 'jump' | 'bull' | 'bear'>('all');
  const [topSignals, setTopSignals] = useState<Signal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [connectedMarkets, setConnectedMarkets] = useState(0);
  
  const ticksMapRef = useRef<Map<string, number[]>>(new Map());
  const activeDigitMapRef = useRef<Map<string, number>>(new Map());
  const wsConnectionsRef = useRef<Map<string, WebSocket>>(new Map());

  // Core signal generation: for each market, evaluate 4 signal categories
  const computeGlobalSignals = useCallback(() => {
    const allCandidates: Signal[] = [];
    const ticksMap = ticksMapRef.current;
    
    for (const [symbol, ticks] of ticksMap.entries()) {
      if (!ticks || ticks.length < 200) continue;
      const thr = activeDigitMapRef.current.get(symbol) ?? 5;
      const stats = computeDigitStats(ticks, thr);
      if (!stats) continue;
      
      const { mostAppearing, secondMost, leastAppearing, overRate, underRate, oddRate, evenRate, riseRate, fallRate } = stats;
      
      // STRATEGY 1: OVER/UNDER based on most appearing digit zone
      let underOverSignal: string | null = null;
      let underOverStrength = 0.5;
      let underOverReason = "";
      
      if (mostAppearing <= 6) {
        underOverSignal = "📉 UNDER";
        underOverStrength = 0.68 + (underRate * 0.25);
        underOverReason = `Most digit ${mostAppearing} in 0-6 zone | Under rate ${(underRate * 100).toFixed(0)}%`;
        if (secondMost <= 6) underOverStrength += 0.08;
        if (leastAppearing >= 5) underOverStrength -= 0.03;
      }
      if (mostAppearing >= 5) {
        underOverSignal = "📈 OVER";
        underOverStrength = 0.68 + (overRate * 0.25);
        underOverReason = `Most digit ${mostAppearing} in 5-9 zone | Over rate ${(overRate * 100).toFixed(0)}%`;
        if (secondMost >= 5) underOverStrength += 0.08;
        if (leastAppearing <= 4) underOverStrength -= 0.03;
      }
      underOverStrength = Math.min(0.96, Math.max(0.55, underOverStrength));
      
      // STRATEGY 2: ODD/EVEN based on most appearing digit parity
      let oddEvenSignal: string | null = null;
      let oddEvenStrength = 0.5;
      let oddEvenReason = "";
      if (mostAppearing % 2 === 1) {
        oddEvenSignal = "🎲 ODD";
        oddEvenStrength = 0.65 + (oddRate * 0.25);
        oddEvenReason = `Most digit ${mostAppearing} (odd) | Odd winrate ${(oddRate * 100).toFixed(0)}%`;
        if (secondMost % 2 === 1) oddEvenStrength += 0.07;
      } else {
        oddEvenSignal = "🎲 EVEN";
        oddEvenStrength = 0.65 + (evenRate * 0.25);
        oddEvenReason = `Most digit ${mostAppearing} (even) | Even winrate ${(evenRate * 100).toFixed(0)}%`;
        if (secondMost % 2 === 0) oddEvenStrength += 0.07;
      }
      oddEvenStrength = Math.min(0.94, Math.max(0.55, oddEvenStrength));
      
      // STRATEGY 3: RISE/FALL based on momentum + cluster bias
      let riseFallSignal: string | null = null;
      let riseFallStrength = 0.5;
      let riseFallReason = "";
      if (riseRate > fallRate && riseRate > 0.52) {
        riseFallSignal = "⬆️ RISE";
        riseFallStrength = 0.6 + riseRate * 0.3;
        riseFallReason = `Rise momentum ${(riseRate * 100).toFixed(0)}% vs Fall ${(fallRate * 100).toFixed(0)}%`;
      } else if (fallRate > riseRate && fallRate > 0.52) {
        riseFallSignal = "⬇️ FALL";
        riseFallStrength = 0.6 + fallRate * 0.3;
        riseFallReason = `Fall momentum ${(fallRate * 100).toFixed(0)}% vs Rise ${(riseRate * 100).toFixed(0)}%`;
      } else if (overRate > underRate && overRate > 0.55) {
        riseFallSignal = "📈 RISE (over bias)";
        riseFallStrength = 0.58 + overRate * 0.25;
        riseFallReason = `Over zone dominance ${(overRate * 100).toFixed(0)}%`;
      } else if (underRate > overRate && underRate > 0.55) {
        riseFallSignal = "📉 FALL (under bias)";
        riseFallStrength = 0.58 + underRate * 0.25;
        riseFallReason = `Under zone dominance ${(underRate * 100).toFixed(0)}%`;
      } else {
        riseFallSignal = "🌀 NEUTRAL";
        riseFallStrength = 0.48;
        riseFallReason = "Mixed momentum";
      }
      riseFallStrength = Math.min(0.92, Math.max(0.45, riseFallStrength));
      
      // STRATEGY 4: CLUSTER SIGNAL (most + second + least zone alignment)
      let clusterSignal: string | null = null;
      let clusterStrength = 0.5;
      let clusterReason = "";
      const lowZone = [0, 1, 2, 3, 4, 5, 6];
      const highZone = [5, 6, 7, 8, 9];
      let lowScore = 0, highScore = 0;
      if (lowZone.includes(mostAppearing)) lowScore += 0.45;
      if (lowZone.includes(secondMost)) lowScore += 0.3;
      if (lowZone.includes(leastAppearing)) lowScore += 0.2;
      if (highZone.includes(mostAppearing)) highScore += 0.45;
      if (highZone.includes(secondMost)) highScore += 0.3;
      if (highZone.includes(leastAppearing)) highScore += 0.2;
      
      if (lowScore > highScore && lowScore > 0.65) {
        clusterSignal = "🔻 UNDER CLUSTER";
        clusterStrength = 0.65 + (underRate * 0.2);
        clusterReason = `Digits ${mostAppearing},${secondMost},${leastAppearing} lean 0-6 zone`;
      } else if (highScore > lowScore && highScore > 0.65) {
        clusterSignal = "🔺 OVER CLUSTER";
        clusterStrength = 0.65 + (overRate * 0.2);
        clusterReason = `Digits ${mostAppearing},${secondMost},${leastAppearing} lean 5-9 zone`;
      } else {
        clusterSignal = "🌀 ZONE MIXED";
        clusterStrength = 0.45;
        clusterReason = "Balanced digit distribution";
      }
      clusterStrength = Math.min(0.9, Math.max(0.45, clusterStrength));
      
      // Build candidates based on selected contract type
      const candidates: Signal[] = [];
      
      if (contractType === 'overunder') {
        if (underOverSignal && underOverStrength > 0.58) {
          candidates.push({
            type: "Under/Over",
            name: underOverSignal,
            strength: underOverStrength,
            symbol: symbol,
            detail: underOverReason,
            extra: `Threshold ${thr} | Most:${mostAppearing} 2nd:${secondMost}`
          });
        }
        if (clusterSignal && !clusterSignal.includes("MIXED") && clusterStrength > 0.58) {
          candidates.push({
            type: "Digit Cluster",
            name: clusterSignal,
            strength: clusterStrength,
            symbol: symbol,
            detail: clusterReason,
            extra: `Most:${mostAppearing} 2nd:${secondMost} Least:${leastAppearing}`
          });
        }
      }
      
      if (contractType === 'evenodd') {
        if (oddEvenSignal && oddEvenStrength > 0.58) {
          candidates.push({
            type: "Odd/Even",
            name: oddEvenSignal,
            strength: oddEvenStrength,
            symbol: symbol,
            detail: oddEvenReason,
            extra: `Most digit ${mostAppearing} → ${mostAppearing % 2 === 0 ? 'Even' : 'Odd'} bias`
          });
        }
      }
      
      if (contractType === 'risefall') {
        if (riseFallSignal && riseFallSignal !== "🌀 NEUTRAL" && riseFallStrength > 0.58) {
          candidates.push({
            type: "Rise/Fall",
            name: riseFallSignal,
            strength: riseFallStrength,
            symbol: symbol,
            detail: riseFallReason,
            extra: `Rise:${(riseRate * 100).toFixed(0)}% Fall:${(fallRate * 100).toFixed(0)}%`
          });
        }
      }
      
      allCandidates.push(...candidates);
    }
    
    // Sort by strength descending and select top 4 distinct (market+type)
    allCandidates.sort((a, b) => b.strength - a.strength);
    const seenKeys = new Set<string>();
    const top: Signal[] = [];
    for (const cand of allCandidates) {
      const key = `${cand.symbol}_${cand.type}`;
      if (!seenKeys.has(key) && top.length < 4) {
        seenKeys.add(key);
        top.push(cand);
      }
      if (top.length === 4) break;
    }
    
    setTopSignals(top);
    setConnectedMarkets(ticksMap.size);
    setIsLoading(false);
  }, [contractType]);

  // Connect to WebSocket for a specific market
  const connectMarket = useCallback((symbol: string) => {
    if (wsConnectionsRef.current.has(symbol)) return;
    
    const ws = new WebSocket("wss://ws.binaryws.com/websockets/v3?app_id=1089");
    const ticks: number[] = [];
    
    ws.onopen = () => {
      ws.send(JSON.stringify({ ticks_history: symbol, count: TICK_DEPTH, end: "latest", style: "ticks" }));
    };
    
    ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data);
      if (data.history && data.history.prices) {
        data.history.prices.forEach((p: string) => {
          const digit = parseInt(parseFloat(p).toFixed(2).slice(-1));
          if (!isNaN(digit)) ticks.push(digit);
        });
        while (ticks.length > 2500) ticks.shift();
        ticksMapRef.current.set(symbol, [...ticks]);
        ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
        computeGlobalSignals();
      }
      if (data.tick && data.tick.quote) {
        const digit = parseInt(parseFloat(data.tick.quote).toFixed(2).slice(-1));
        if (!isNaN(digit)) {
          ticks.push(digit);
          if (ticks.length > 2500) ticks.shift();
          ticksMapRef.current.set(symbol, [...ticks]);
          computeGlobalSignals();
        }
      }
    };
    
    ws.onerror = () => {
      console.error(`WebSocket error for ${symbol}`);
    };
    
    wsConnectionsRef.current.set(symbol, ws);
    
    // Initialize threshold
    if (!activeDigitMapRef.current.has(symbol)) {
      activeDigitMapRef.current.set(symbol, 5);
    }
  }, [computeGlobalSignals]);

  // Load markets based on selected group
  const loadGroup = useCallback((group: string) => {
    // Close existing connections
    wsConnectionsRef.current.forEach((ws, symbol) => {
      ws.close();
      wsConnectionsRef.current.delete(symbol);
    });
    ticksMapRef.current.clear();
    
    let symbols: string[] = [];
    if (group === "all") {
      symbols = [...VOLATILITIES.vol, ...VOLATILITIES.jump, ...VOLATILITIES.bull, ...VOLATILITIES.bear];
    } else if (group === "vol") {
      symbols = VOLATILITIES.vol;
    } else if (group === "jump") {
      symbols = VOLATILITIES.jump;
    } else if (group === "bull") {
      symbols = VOLATILITIES.bull;
    } else if (group === "bear") {
      symbols = VOLATILITIES.bear;
    }
    
    setIsLoading(true);
    symbols.forEach(symbol => {
      connectMarket(symbol);
    });
    
    // Timeout to show loading if no data after 3 seconds
    setTimeout(() => {
      if (ticksMapRef.current.size === 0) {
        setIsLoading(false);
      }
    }, 3000);
  }, [connectMarket]);

  // Handle market group change
  useEffect(() => {
    loadGroup(marketGroup);
  }, [marketGroup, loadGroup]);

  // Handle contract type change
  useEffect(() => {
    computeGlobalSignals();
  }, [contractType, computeGlobalSignals]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      wsConnectionsRef.current.forEach((ws) => {
        ws.close();
      });
      wsConnectionsRef.current.clear();
    };
  }, []);

  return (
    <div className="space-y-4">
      {/* Header Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold bg-gradient-to-r from-orange-400 to-purple-400 bg-clip-text text-transparent">
            ⚡ SIGNAL FORGE • ELITE 4
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Volatility + Jump + Bull/Bear | Digit prophecy engine | Real-time signals
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-2 bg-muted/30 rounded-full px-4 py-2">
            <span className="text-xs font-medium">📊 CONTRACT</span>
            <Select value={contractType} onValueChange={(v: any) => setContractType(v)}>
              <SelectTrigger className="w-[160px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="overunder">OVER / UNDER</SelectItem>
                <SelectItem value="evenodd">EVEN / ODD</SelectItem>
                <SelectItem value="risefall">RISE / FALL</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 bg-muted/30 rounded-full px-4 py-2">
            <span className="text-xs font-medium">🌐 MARKET</span>
            <Select value={marketGroup} onValueChange={(v: any) => setMarketGroup(v)}>
              <SelectTrigger className="w-[160px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">ALL Markets</SelectItem>
                <SelectItem value="vol">Volatility Indices</SelectItem>
                <SelectItem value="jump">Jump Indices</SelectItem>
                <SelectItem value="bull">RDBULL</SelectItem>
                <SelectItem value="bear">RDBEAR</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Signal Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {isLoading && topSignals.length === 0 ? (
          // Loading skeletons
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="bg-gradient-to-br from-gray-900/50 to-gray-800/50 border-gray-700">
              <CardHeader className="pb-2">
                <Skeleton className="h-6 w-24" />
                <Skeleton className="h-8 w-32 mt-2" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-4 w-28 mt-3" />
                <Skeleton className="h-2 w-full mt-2" />
              </CardContent>
            </Card>
          ))
        ) : topSignals.length === 0 ? (
          <div className="col-span-full text-center py-12">
            <div className="text-6xl mb-4">🔮</div>
            <p className="text-muted-foreground">Analyzing {connectedMarkets} markets for patterns...</p>
            <p className="text-xs text-muted-foreground mt-2">Fetching live data from BinaryWS</p>
          </div>
        ) : (
          topSignals.map((sig, idx) => {
            const strengthPercent = (sig.strength * 100).toFixed(1);
            return (
              <Card
                key={`${sig.symbol}_${sig.type}_${idx}`}
                className="relative overflow-hidden bg-gradient-to-br from-gray-900/80 to-gray-800/80 border border-orange-500/30 hover:border-orange-500/60 transition-all duration-300 hover:scale-[1.02] cursor-pointer group"
              >
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-orange-500 via-yellow-500 to-blue-500" />
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <Badge className="bg-orange-500 text-black font-bold text-[10px]">
                      #{idx + 1} · {sig.type} SIGNAL
                    </Badge>
                    <span className="text-xs font-mono text-muted-foreground">{sig.symbol}</span>
                  </div>
                  <CardTitle className="text-2xl font-bold bg-gradient-to-r from-white to-purple-300 bg-clip-text text-transparent">
                    {sig.name}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="text-sm text-muted-foreground border-l-3 border-orange-500 pl-3">
                    🎯 {sig.detail}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Badge variant="outline" className="text-[10px] bg-black/20">
                      {sig.extra}
                    </Badge>
                  </div>
                  <div>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="font-semibold text-yellow-500">💪 CONFIDENCE</span>
                      <span className="font-mono font-bold">{strengthPercent}%</span>
                    </div>
                    <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-orange-500 to-yellow-500 rounded-full transition-all duration-500"
                        style={{ width: `${strengthPercent}%` }}
                      />
                    </div>
                  </div>
                  <div className="text-[10px] text-muted-foreground pt-1">
                    based on most/second/least digit zones & parity analysis
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* Footer Stats */}
      <div className="flex justify-between items-center text-xs text-muted-foreground border-t border-border pt-4 mt-2">
        <div>
          ⚡ Strategy: Most/least appearing digits (0-6 → UNDER, 5-9 → OVER) + Odd/Even majority + Rise/Fall momentum
        </div>
        <div>
          Tick depth: {TICK_DEPTH} | Live markets: {connectedMarkets}
        </div>
      </div>
    </div>
  );
}

export default SignalForge;
