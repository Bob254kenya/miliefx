import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { derivApi, type MarketSymbol } from '@/services/deriv-api';
import { copyTradingService } from '@/services/copy-trading-service';
import { getLastDigit } from '@/services/analysis';
import { useAuth } from '@/contexts/AuthContext';
import { useLossRequirement } from '@/hooks/useLossRequirement';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import {
  Play, StopCircle, Trash2, Scan,
  Home, RefreshCw, Shield, Zap, Eye, Anchor, Download, Upload, TrendingUp, Activity,
} from 'lucide-react';
import ConfigPreview, { type BotConfig } from '@/components/bot-config/ConfigPreview';

/* ───── CONSTANTS ───── */
const SCANNER_MARKETS: { symbol: string; name: string }[] = [
  { symbol: 'R_10', name: 'Vol 10' }, { symbol: 'R_25', name: 'Vol 25' },
  { symbol: 'R_50', name: 'Vol 50' }, { symbol: 'R_75', name: 'Vol 75' },
  { symbol: 'R_100', name: 'Vol 100' },
  { symbol: '1HZ10V', name: 'V10 1s' }, { symbol: '1HZ25V', name: 'V25 1s' },
  { symbol: '1HZ50V', name: 'V50 1s' }, { symbol: '1HZ75V', name: 'V75 1s' },
  { symbol: '1HZ100V', name: 'V100 1s' },
  { symbol: 'JD10', name: 'Jump 10' }, { symbol: 'JD25', name: 'Jump 25' },
  { symbol: 'RDBEAR', name: 'Bear' }, { symbol: 'RDBULL', name: 'Bull' },
];

const CONTRACT_TYPES = [
  'DIGITEVEN', 'DIGITODD', 'DIGITMATCH', 'DIGITDIFF', 'DIGITOVER', 'DIGITUNDER',
] as const;

const needsBarrier = (ct: string) => ['DIGITMATCH', 'DIGITDIFF', 'DIGITOVER', 'DIGITUNDER'].includes(ct);

type BotStatus = 'idle' | 'trading_m1' | 'recovery' | 'waiting_pattern' | 'pattern_matched' | 'virtual_hook';

interface LogEntry {
  id: number;
  time: string;
  market: 'M1' | 'M2' | 'VH';
  symbol: string;
  contract: string;
  stake: number;
  martingaleStep: number;
  exitDigit: string;
  result: 'Win' | 'Loss' | 'Pending' | 'V-Win' | 'V-Loss';
  pnl: number;
  balance: number;
  switchInfo: string;
}

/* ── Signal Types from Elite Dashboard ── */
interface SignalCandidate {
  type: string;
  name: string;
  strength: number;
  symbol: string;
  detail: string;
  extra: string;
}

/* ── Circular Tick Buffer ── */
class CircularTickBuffer {
  private buffer: { digit: number; ts: number }[];
  private head = 0;
  private count = 0;
  constructor(private capacity = 1000) {
    this.buffer = new Array(capacity);
  }
  push(digit: number) {
    this.buffer[this.head] = { digit, ts: performance.now() };
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }
  last(n: number): number[] {
    const result: number[] = [];
    const start = (this.head - Math.min(n, this.count) + this.capacity) % this.capacity;
    for (let i = 0; i < Math.min(n, this.count); i++) {
      result.push(this.buffer[(start + i) % this.capacity].digit);
    }
    return result;
  }
  lastTs(): number { return this.count > 0 ? this.buffer[(this.head - 1 + this.capacity) % this.capacity].ts : 0; }
  get size() { return this.count; }
  getAll(): number[] { return this.last(this.count); }
}

function waitForNextTick(symbol: string): Promise<{ quote: number }> {
  return new Promise((resolve) => {
    const unsub = derivApi.onMessage((data: any) => {
      if (data.tick && data.tick.symbol === symbol) { unsub(); resolve({ quote: data.tick.quote }); }
    });
  });
}

/* ── Simulate a virtual contract result based on actual next tick ── */
function simulateVirtualContract(
  contractType: string, barrier: string, symbol: string
): Promise<{ won: boolean; digit: number }> {
  return new Promise((resolve) => {
    const unsub = derivApi.onMessage((data: any) => {
      if (data.tick && data.tick.symbol === symbol) {
        unsub();
        const digit = getLastDigit(data.tick.quote);
        const b = parseInt(barrier) || 0;
        let won = false;
        switch (contractType) {
          case 'DIGITEVEN': won = digit % 2 === 0; break;
          case 'DIGITODD': won = digit % 2 !== 0; break;
          case 'DIGITMATCH': won = digit === b; break;
          case 'DIGITDIFF': won = digit !== b; break;
          case 'DIGITOVER': won = digit > b; break;
          case 'DIGITUNDER': won = digit < b; break;
        }
        resolve({ won, digit });
      }
    });
  });
}

/* ── Elite Signal Analysis Engine ── */
function computeEliteSignals(ticksMap: Map<string, number[]>, thresholdDigit = 5): SignalCandidate[] {
  const allCandidates: SignalCandidate[] = [];

  for (const [symbol, ticks] of ticksMap.entries()) {
    if (!ticks || ticks.length < 200) continue;

    const recent = ticks.slice(-1000);
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

    let overCount = 0, underCount = 0;
    recent.forEach(d => { if (d > thresholdDigit) overCount++; else if (d < thresholdDigit) underCount++; });
    let oddCount = 0, evenCount = 0;
    recent.forEach(d => { if (d % 2 === 0) evenCount++; else oddCount++; });
    let riseCount = 0, fallCount = 0;
    for (let i = 1; i < recent.length; i++) {
      if (recent[i] > recent[i - 1]) riseCount++;
      else if (recent[i] < recent[i - 1]) fallCount++;
    }
    const totalComp = recent.length - 1 || 1;
    const overRate = overCount / recent.length;
    const underRate = underCount / recent.length;
    const oddRate = oddCount / recent.length;
    const evenRate = evenCount / recent.length;
    const riseRate = riseCount / totalComp;
    const fallRate = fallCount / totalComp;

    // Strategy 1: Over/Under
    let underOverSignal: string | null = null;
    let underOverStrength = 0.5;
    let underOverReason = "";
    if (mostAppearing <= 6) {
      underOverSignal = "📉 UNDER";
      underOverStrength = 0.68 + (underRate * 0.25);
      underOverReason = `Most digit ${mostAppearing} in 0-6 zone | Under rate ${(underRate * 100).toFixed(0)}%`;
      if (secondMost <= 6) underOverStrength += 0.08;
    }
    if (mostAppearing >= 5) {
      underOverSignal = "📈 OVER";
      underOverStrength = 0.68 + (overRate * 0.25);
      underOverReason = `Most digit ${mostAppearing} in 5-9 zone | Over rate ${(overRate * 100).toFixed(0)}%`;
      if (secondMost >= 5) underOverStrength += 0.08;
    }
    underOverStrength = Math.min(0.96, Math.max(0.55, underOverStrength));

    // Strategy 2: Odd/Even
    let oddEvenSignal: string | null = null;
    let oddEvenStrength = 0.5;
    let oddEvenReason = "";
    if (mostAppearing % 2 === 1) {
      oddEvenSignal = "🎲 ODD";
      oddEvenStrength = 0.65 + (oddRate * 0.25);
      oddEvenReason = `Most digit ${mostAppearing} (odd) | Odd winrate ${(oddRate * 100).toFixed(0)}%`;
    } else {
      oddEvenSignal = "🎲 EVEN";
      oddEvenStrength = 0.65 + (evenRate * 0.25);
      oddEvenReason = `Most digit ${mostAppearing} (even) | Even winrate ${(evenRate * 100).toFixed(0)}%`;
    }
    oddEvenStrength = Math.min(0.94, Math.max(0.55, oddEvenStrength));

    // Strategy 3: Rise/Fall
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
      riseFallSignal = null;
      riseFallStrength = 0.48;
    }
    riseFallStrength = Math.min(0.92, Math.max(0.45, riseFallStrength));

    // Strategy 4: Cluster Signal
    const lowZone = [0, 1, 2, 3, 4, 5, 6];
    const highZone = [5, 6, 7, 8, 9];
    let lowScore = 0, highScore = 0;
    if (lowZone.includes(mostAppearing)) lowScore += 0.45;
    if (lowZone.includes(secondMost)) lowScore += 0.3;
    if (lowZone.includes(leastAppearing)) lowScore += 0.2;
    if (highZone.includes(mostAppearing)) highScore += 0.45;
    if (highZone.includes(secondMost)) highScore += 0.3;
    if (highZone.includes(leastAppearing)) highScore += 0.2;

    let clusterSignal: string | null = null;
    let clusterStrength = 0.5;
    let clusterReason = "";
    if (lowScore > highScore && lowScore > 0.65) {
      clusterSignal = "🔻 UNDER CLUSTER";
      clusterStrength = 0.65 + (underRate * 0.2);
      clusterReason = `Digits ${mostAppearing},${secondMost},${leastAppearing} lean 0-6 zone`;
    } else if (highScore > lowScore && highScore > 0.65) {
      clusterSignal = "🔺 OVER CLUSTER";
      clusterStrength = 0.65 + (overRate * 0.2);
      clusterReason = `Digits ${mostAppearing},${secondMost},${leastAppearing} lean 5-9 zone`;
    }
    clusterStrength = Math.min(0.9, Math.max(0.45, clusterStrength));

    if (underOverSignal && underOverStrength > 0.58) {
      allCandidates.push({
        type: "Under/Over",
        name: underOverSignal,
        strength: underOverStrength,
        symbol: symbol,
        detail: underOverReason,
        extra: `Threshold ${thresholdDigit} | Most:${mostAppearing} 2nd:${secondMost}`
      });
    }
    if (oddEvenSignal && oddEvenStrength > 0.58) {
      allCandidates.push({
        type: "Odd/Even",
        name: oddEvenSignal,
        strength: oddEvenStrength,
        symbol: symbol,
        detail: oddEvenReason,
        extra: `Most digit ${mostAppearing} → ${mostAppearing % 2 === 0 ? 'Even' : 'Odd'} bias`
      });
    }
    if (riseFallSignal && riseFallStrength > 0.58) {
      allCandidates.push({
        type: "Rise/Fall",
        name: riseFallSignal,
        strength: riseFallStrength,
        symbol: symbol,
        detail: riseFallReason,
        extra: `Rise:${(riseRate * 100).toFixed(0)}% Fall:${(fallRate * 100).toFixed(0)}%`
      });
    }
    if (clusterSignal && clusterStrength > 0.58) {
      allCandidates.push({
        type: "Digit Cluster",
        name: clusterSignal,
        strength: clusterStrength,
        symbol: symbol,
        detail: clusterReason,
        extra: `Most:${mostAppearing} 2nd:${secondMost} Least:${leastAppearing}`
      });
    }
  }

  allCandidates.sort((a, b) => b.strength - a.strength);
  const seenKeys = new Set<string>();
  const topSignals: SignalCandidate[] = [];
  for (const cand of allCandidates) {
    const key = `${cand.symbol}_${cand.type}`;
    if (!seenKeys.has(key) && topSignals.length < 4) {
      seenKeys.add(key);
      topSignals.push(cand);
    }
    if (topSignals.length === 4) break;
  }
  return topSignals;
}

export default function ProScannerBot() {
  const { isAuthorized, balance, activeAccount } = useAuth();
  const { recordLoss } = useLossRequirement();
  const location = useLocation();

  /* ── Market 1 config ── */
  const [m1Enabled, setM1Enabled] = useState(true);
  const [m1Contract, setM1Contract] = useState('DIGITEVEN');
  const [m1Barrier, setM1Barrier] = useState('5');
  const [m1Symbol, setM1Symbol] = useState('R_100');

  /* ── Market 2 config ── */
  const [m2Enabled, setM2Enabled] = useState(true);
  const [m2Contract, setM2Contract] = useState('DIGITODD');
  const [m2Barrier, setM2Barrier] = useState('5');
  const [m2Symbol, setM2Symbol] = useState('R_50');

  /* ── Virtual Hook ── */
  const [m1HookEnabled, setM1HookEnabled] = useState(false);
  const [m1VirtualLossCount, setM1VirtualLossCount] = useState('3');
  const [m1RealCount, setM1RealCount] = useState('2');
  const [m2HookEnabled, setM2HookEnabled] = useState(false);
  const [m2VirtualLossCount, setM2VirtualLossCount] = useState('3');
  const [m2RealCount, setM2RealCount] = useState('2');

  const [vhFakeWins, setVhFakeWins] = useState(0);
  const [vhFakeLosses, setVhFakeLosses] = useState(0);
  const [vhConsecLosses, setVhConsecLosses] = useState(0);
  const [vhStatus, setVhStatus] = useState<'idle' | 'waiting' | 'confirmed' | 'failed'>('idle');

  /* ── Risk ── */
  const [stake, setStake] = useState('0.35');
  const [martingaleOn, setMartingaleOn] = useState(false);
  const [martingaleMultiplier, setMartingaleMultiplier] = useState('2.0');
  const [martingaleMaxSteps, setMartingaleMaxSteps] = useState('5');
  const [takeProfit, setTakeProfit] = useState('10');
  const [stopLoss, setStopLoss] = useState('5');

  /* ── Strategy ── */
  const [strategyEnabled, setStrategyEnabled] = useState(false);
  const [strategyM1Enabled, setStrategyM1Enabled] = useState(false);
  const [m1StrategyMode, setM1StrategyMode] = useState<'pattern' | 'digit'>('pattern');
  const [m2StrategyMode, setM2StrategyMode] = useState<'pattern' | 'digit'>('pattern');
  const [m1Pattern, setM1Pattern] = useState('');
  const [m1DigitCondition, setM1DigitCondition] = useState('==');
  const [m1DigitCompare, setM1DigitCompare] = useState('5');
  const [m1DigitWindow, setM1DigitWindow] = useState('3');
  const [m2Pattern, setM2Pattern] = useState('');
  const [m2DigitCondition, setM2DigitCondition] = useState('==');
  const [m2DigitCompare, setM2DigitCompare] = useState('5');
  const [m2DigitWindow, setM2DigitWindow] = useState('3');

  /* ── Scanner ── */
  const [scannerActive, setScannerActive] = useState(false);

  /* ── Turbo ── */
  const [turboMode, setTurboMode] = useState(false);
  const [botName, setBotName] = useState('');
  const [turboLatency, setTurboLatency] = useState(0);
  const [ticksCaptured, setTicksCaptured] = useState(0);
  const [ticksMissed, setTicksMissed] = useState(0);
  const turboBuffersRef = useRef<Map<string, CircularTickBuffer>>(new Map());
  const lastTickTsRef = useRef(0);

  /* ── Bot state ── */
  const [botStatus, setBotStatus] = useState<BotStatus>('idle');
  const [isRunning, setIsRunning] = useState(false);
  const runningRef = useRef(false);
  const [currentMarket, setCurrentMarket] = useState<1 | 2>(1);
  const [wins, setWins] = useState(0);
  const [losses, setLosses] = useState(0);
  const [totalStaked, setTotalStaked] = useState(0);
  const [netProfit, setNetProfit] = useState(0);
  const [currentStake, setCurrentStakeState] = useState(0);
  const [martingaleStep, setMartingaleStepState] = useState(0);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const logIdRef = useRef(0);

  /* ── Elite Signals State ── */
  const [topSignals, setTopSignals] = useState<SignalCandidate[]>([]);
  const [signalContractType, setSignalContractType] = useState<'overunder' | 'evenodd' | 'risefall'>('overunder');

  /* ── Tick data ── */
  const tickMapRef = useRef<Map<string, number[]>>(new Map());
  const [tickCounts, setTickCounts] = useState<Record<string, number>>({});

  /* Subscribe to all scanner markets and compute signals */
  useEffect(() => {
    if (!derivApi.isConnected) return;
    let active = true;
    const handler = (data: any) => {
      if (!data.tick || !active) return;
      const sym = data.tick.symbol as string;
      const digit = getLastDigit(data.tick.quote);
      const now = performance.now();

      const map = tickMapRef.current;
      const arr = map.get(sym) || [];
      arr.push(digit);
      if (arr.length > 2000) arr.shift();
      map.set(sym, arr);
      setTickCounts(prev => ({ ...prev, [sym]: arr.length }));

      if (!turboBuffersRef.current.has(sym)) {
        turboBuffersRef.current.set(sym, new CircularTickBuffer(1000));
      }
      const buf = turboBuffersRef.current.get(sym)!;
      buf.push(digit);

      if (lastTickTsRef.current > 0) {
        const lat = now - lastTickTsRef.current;
        setTurboLatency(Math.round(lat));
        if (lat > 50) setTicksMissed(prev => prev + 1);
      }
      lastTickTsRef.current = now;
      setTicksCaptured(prev => prev + 1);

      // Update elite signals on every tick
      const signals = computeEliteSignals(map, 5);
      setTopSignals(signals);
    };
    const unsub = derivApi.onMessage(handler);
    SCANNER_MARKETS.forEach(m => { derivApi.subscribeTicks(m.symbol as MarketSymbol, () => {}).catch(() => {}); });
    return () => { active = false; unsub(); };
  }, []);

  const cleanM1Pattern = m1Pattern.toUpperCase().replace(/[^EO]/g, '');
  const m1PatternValid = cleanM1Pattern.length >= 2;
  const cleanM2Pattern = m2Pattern.toUpperCase().replace(/[^EO]/g, '');
  const m2PatternValid = cleanM2Pattern.length >= 2;

  const checkPatternMatchWith = useCallback((symbol: string, cleanPat: string): boolean => {
    const digits = tickMapRef.current.get(symbol) || [];
    if (digits.length < cleanPat.length) return false;
    const recent = digits.slice(-cleanPat.length);
    for (let i = 0; i < cleanPat.length; i++) {
      const expected = cleanPat[i];
      const actual = recent[i] % 2 === 0 ? 'E' : 'O';
      if (expected !== actual) return false;
    }
    return true;
  }, []);

  const checkDigitConditionWith = useCallback((symbol: string, condition: string, compare: string, window: string): boolean => {
    const digits = tickMapRef.current.get(symbol) || [];
    const win = parseInt(window) || 3;
    const comp = parseInt(compare);
    if (digits.length < win) return false;
    const recent = digits.slice(-win);
    return recent.every(d => {
      switch (condition) {
        case '>': return d > comp;
        case '<': return d < comp;
        case '>=': return d >= comp;
        case '<=': return d <= comp;
        case '==': return d === comp;
        default: return false;
      }
    });
  }, []);

  const checkStrategyForMarket = useCallback((symbol: string, market: 1 | 2): boolean => {
    const mode = market === 1 ? m1StrategyMode : m2StrategyMode;
    if (mode === 'pattern') {
      const pat = market === 1 ? cleanM1Pattern : cleanM2Pattern;
      return checkPatternMatchWith(symbol, pat);
    }
    const cond = market === 1 ? m1DigitCondition : m2DigitCondition;
    const comp = market === 1 ? m1DigitCompare : m2DigitCompare;
    const win = market === 1 ? m1DigitWindow : m2DigitWindow;
    return checkDigitConditionWith(symbol, cond, comp, win);
  }, [m1StrategyMode, m2StrategyMode, cleanM1Pattern, cleanM2Pattern, checkPatternMatchWith, checkDigitConditionWith, m1DigitCondition, m1DigitCompare, m1DigitWindow, m2DigitCondition, m2DigitCompare, m2DigitWindow]);

  const findScannerMatchForMarket = useCallback((market: 1 | 2): string | null => {
    for (const m of SCANNER_MARKETS) {
      if (checkStrategyForMarket(m.symbol, market)) return m.symbol;
    }
    return null;
  }, [checkStrategyForMarket]);

  const addLog = useCallback((id: number, entry: Omit<LogEntry, 'id'>) => {
    setLogEntries(prev => [{ ...entry, id }, ...prev].slice(0, 100));
  }, []);

  const updateLog = useCallback((id: number, updates: Partial<LogEntry>) => {
    setLogEntries(prev => prev.map(e => e.id === id ? { ...e, ...updates } : e));
  }, []);

  const clearLog = useCallback(() => {
    setLogEntries([]);
    setWins(0); setLosses(0); setTotalStaked(0); setNetProfit(0);
    setMartingaleStepState(0);
    setVhFakeWins(0); setVhFakeLosses(0); setVhConsecLosses(0); setVhStatus('idle');
    setTicksCaptured(0); setTicksMissed(0);
  }, []);

  const executeRealTrade = useCallback(async (
    cfg: { contract: string; barrier: string; symbol: string },
    tradeSymbol: string,
    cStake: number,
    mStep: number,
    mkt: 1 | 2,
    localBalance: number,
    localPnl: number,
    baseStake: number,
  ) => {
    const logId = ++logIdRef.current;
    const now = new Date().toLocaleTimeString();
    setTotalStaked(prev => prev + cStake);
    setCurrentStakeState(cStake);

    addLog(logId, {
      time: now, market: mkt === 1 ? 'M1' : 'M2', symbol: tradeSymbol,
      contract: cfg.contract, stake: cStake, martingaleStep: mStep,
      exitDigit: '...', result: 'Pending', pnl: 0, balance: localBalance,
      switchInfo: '',
    });

    let inRecovery = mkt === 2;

    try {
      if (!turboMode) await waitForNextTick(tradeSymbol as MarketSymbol);

      const buyParams: any = {
        contract_type: cfg.contract, symbol: tradeSymbol,
        duration: 1, duration_unit: 't', basis: 'stake', amount: cStake,
      };
      if (needsBarrier(cfg.contract)) buyParams.barrier = cfg.barrier;

      const { contractId } = await derivApi.buyContract(buyParams);
      
      if (copyTradingService.enabled) {
        copyTradingService.copyTrade({ ...buyParams, masterTradeId: contractId }).catch(() => {});
      }
      
      const result = await derivApi.waitForContractResult(contractId);
      const won = result.status === 'won';
      const pnl = result.profit;
      localPnl += pnl;
      localBalance += pnl;

      const exitDigit = String(getLastDigit(result.sellPrice || 0));

      let switchInfo = '';
      if (won) {
        setWins(prev => prev + 1);
        if (inRecovery) { switchInfo = '✓ Recovery WIN → Back to M1'; inRecovery = false; }
        else { switchInfo = '→ Continue M1'; }
        mStep = 0;
        cStake = baseStake;
      } else {
        setLosses(prev => prev + 1);
        if (activeAccount?.is_virtual) { recordLoss(cStake, tradeSymbol, 6000); }
        if (!inRecovery && m2Enabled) { inRecovery = true; switchInfo = '✗ Loss → Switch to M2'; }
        else { switchInfo = inRecovery ? '→ Stay M2' : '→ Continue M1'; }
        if (martingaleOn) {
          const maxS = parseInt(martingaleMaxSteps) || 5;
          if (mStep < maxS) {
            cStake = parseFloat((cStake * (parseFloat(martingaleMultiplier) || 2)).toFixed(2));
            mStep++;
          } else { mStep = 0; cStake = baseStake; }
        }
      }

      setNetProfit(prev => prev + pnl);
      setMartingaleStepState(mStep);
      setCurrentStakeState(cStake);

      updateLog(logId, { exitDigit, result: won ? 'Win' : 'Loss', pnl, balance: localBalance, switchInfo });

      let shouldBreak = false;
      if (localPnl >= parseFloat(takeProfit)) { toast.success(`🎯 Take Profit! +$${localPnl.toFixed(2)}`); shouldBreak = true; }
      if (localPnl <= -parseFloat(stopLoss)) { toast.error(`🛑 Stop Loss! $${localPnl.toFixed(2)}`); shouldBreak = true; }
      if (localBalance < cStake) { toast.error('Insufficient balance'); shouldBreak = true; }

      return { localPnl, localBalance, cStake, mStep, inRecovery, shouldBreak };
    } catch (err: any) {
      updateLog(logId, { result: 'Loss', pnl: 0, exitDigit: '-', switchInfo: `Error: ${err.message}` });
      if (!turboMode) await new Promise(r => setTimeout(r, 2000));
      return { localPnl, localBalance, cStake, mStep, inRecovery, shouldBreak: false };
    }
  }, [addLog, updateLog, m2Enabled, martingaleOn, martingaleMultiplier, martingaleMaxSteps, takeProfit, stopLoss, turboMode, activeAccount, recordLoss]);

  const startBot = useCallback(async () => {
    if (!isAuthorized || isRunning) return;
    const baseStake = parseFloat(stake);
    if (baseStake < 0.35) { toast.error('Min stake $0.35'); return; }
    if (!m1Enabled && !m2Enabled) { toast.error('Enable at least one market'); return; }

    setIsRunning(true);
    runningRef.current = true;
    setCurrentMarket(1);
    setBotStatus('trading_m1');
    setCurrentStakeState(baseStake);
    setMartingaleStepState(0);
    setVhFakeWins(0); setVhFakeLosses(0); setVhConsecLosses(0); setVhStatus('idle');

    let cStake = baseStake;
    let mStep = 0;
    let inRecovery = false;
    let localPnl = 0;
    let localBalance = balance;

    const getConfig = (market: 1 | 2) => ({
      contract: market === 1 ? m1Contract : m2Contract,
      barrier: market === 1 ? m1Barrier : m2Barrier,
      symbol: market === 1 ? m1Symbol : m2Symbol,
    });

    while (runningRef.current) {
      const mkt: 1 | 2 = inRecovery ? 2 : 1;
      setCurrentMarket(mkt);

      if (mkt === 1 && !m1Enabled) { if (m2Enabled) { inRecovery = true; continue; } else break; }
      if (mkt === 2 && !m2Enabled) { inRecovery = false; continue; }

      let tradeSymbol: string;
      const cfg = getConfig(mkt);
      const hookEnabled = mkt === 1 ? m1HookEnabled : m2HookEnabled;
      const requiredLosses = parseInt(mkt === 1 ? m1VirtualLossCount : m2VirtualLossCount) || 3;
      const realCount = parseInt(mkt === 1 ? m1RealCount : m2RealCount) || 2;

      if (inRecovery && strategyEnabled) {
        setBotStatus('waiting_pattern');
        let matched = false;
        let matchedSymbol = '';
        while (runningRef.current && !matched) {
          if (scannerActive) {
            const found = findScannerMatchForMarket(2);
            if (found) { matched = true; matchedSymbol = found; }
          } else {
            if (checkStrategyForMarket(cfg.symbol, 2)) { matched = true; matchedSymbol = cfg.symbol; }
          }
          if (!matched) await new Promise(r => setTimeout(r, turboMode ? 16 : 500));
        }
        if (!runningRef.current) break;
        setBotStatus('pattern_matched');
        tradeSymbol = matchedSymbol;
        if (!turboMode) await new Promise(r => setTimeout(r, 300));
      } else if (!inRecovery && strategyM1Enabled) {
        setBotStatus('waiting_pattern');
        let matched = false;
        while (runningRef.current && !matched) {
          if (checkStrategyForMarket(cfg.symbol, 1)) matched = true;
          if (!matched) await new Promise(r => setTimeout(r, turboMode ? 16 : 500));
        }
        if (!runningRef.current) break;
        setBotStatus('pattern_matched');
        tradeSymbol = cfg.symbol;
        if (!turboMode) await new Promise(r => setTimeout(r, 300));
      } else {
        setBotStatus(mkt === 1 ? 'trading_m1' : 'recovery');
        tradeSymbol = cfg.symbol;
      }

      if (hookEnabled) {
        setBotStatus('virtual_hook');
        setVhStatus('waiting');
        setVhFakeWins(0);
        setVhFakeLosses(0);
        setVhConsecLosses(0);
        let consecLosses = 0;
        let virtualTradeNum = 0;

        while (consecLosses < requiredLosses && runningRef.current) {
          virtualTradeNum++;
          const vLogId = ++logIdRef.current;
          const vNow = new Date().toLocaleTimeString();
          addLog(vLogId, {
            time: vNow, market: 'VH', symbol: tradeSymbol,
            contract: cfg.contract, stake: 0, martingaleStep: 0,
            exitDigit: '...', result: 'Pending', pnl: 0, balance: localBalance,
            switchInfo: `Virtual #${virtualTradeNum} (losses: ${consecLosses}/${requiredLosses})`,
          });

          const vResult = await simulateVirtualContract(cfg.contract, cfg.barrier, tradeSymbol);
          if (!runningRef.current) break;

          if (vResult.won) {
            consecLosses = 0;
            setVhConsecLosses(0);
            setVhFakeWins(prev => prev + 1);
            updateLog(vLogId, { exitDigit: String(vResult.digit), result: 'V-Win', switchInfo: `Virtual WIN → Losses reset (0/${requiredLosses})` });
          } else {
            consecLosses++;
            setVhConsecLosses(consecLosses);
            setVhFakeLosses(prev => prev + 1);
            updateLog(vLogId, { exitDigit: String(vResult.digit), result: 'V-Loss', switchInfo: `Virtual LOSS (${consecLosses}/${requiredLosses})` });
          }
        }

        if (!runningRef.current) break;
        setVhStatus('confirmed');
        toast.success(`🎣 Hook confirmed! ${requiredLosses} consecutive losses detected → Executing ${realCount} real trade(s)`);

        for (let ri = 0; ri < realCount && runningRef.current; ri++) {
          const result = await executeRealTrade(cfg, tradeSymbol, cStake, mStep, mkt, localBalance, localPnl, baseStake);
          if (!result || !runningRef.current) break;
          localPnl = result.localPnl;
          localBalance = result.localBalance;
          cStake = result.cStake;
          mStep = result.mStep;
          inRecovery = result.inRecovery;
          if (result.shouldBreak) { runningRef.current = false; break; }
        }
        setVhStatus('idle');
        setVhConsecLosses(0);
        if (!runningRef.current) break;
        continue;
      }

      const result = await executeRealTrade(cfg, tradeSymbol, cStake, mStep, mkt, localBalance, localPnl, baseStake);
      if (!result || !runningRef.current) break;
      localPnl = result.localPnl;
      localBalance = result.localBalance;
      cStake = result.cStake;
      mStep = result.mStep;
      inRecovery = result.inRecovery;
      if (result.shouldBreak) break;
      if (!turboMode) await new Promise(r => setTimeout(r, 400));
    }

    setIsRunning(false);
    runningRef.current = false;
    setBotStatus('idle');
  }, [isAuthorized, isRunning, balance, stake, m1Enabled, m2Enabled, m1Contract, m2Contract, m1Barrier, m2Barrier, m1Symbol, m2Symbol, martingaleOn, martingaleMultiplier, martingaleMaxSteps, takeProfit, stopLoss, strategyEnabled, strategyM1Enabled, m1StrategyMode, m2StrategyMode, scannerActive, findScannerMatchForMarket, checkStrategyForMarket, addLog, updateLog, turboMode, m1HookEnabled, m2HookEnabled, m1VirtualLossCount, m2VirtualLossCount, m1RealCount, m2RealCount, executeRealTrade]);

  const stopBot = useCallback(() => {
    runningRef.current = false;
    setIsRunning(false);
    setBotStatus('idle');
  }, []);

  const statusConfig: Record<BotStatus, { icon: string; label: string; color: string }> = {
    idle: { icon: '⚪', label: 'IDLE', color: 'text-muted-foreground' },
    trading_m1: { icon: '🟢', label: 'TRADING M1', color: 'text-profit' },
    recovery: { icon: '🟣', label: 'RECOVERY MODE', color: 'text-purple-400' },
    waiting_pattern: { icon: '🟡', label: 'WAITING PATTERN', color: 'text-warning' },
    pattern_matched: { icon: '✅', label: 'PATTERN MATCHED', color: 'text-profit' },
    virtual_hook: { icon: '🎣', label: 'VIRTUAL HOOK', color: 'text-primary' },
  };

  const status = statusConfig[botStatus];
  const winRate = wins + losses > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : '0.0';
  const activeSymbol = currentMarket === 1 ? m1Symbol : m2Symbol;
  const activeDigits = (tickMapRef.current.get(activeSymbol) || []).slice(-8);

  return (
    <div className="space-y-3 max-w-7xl mx-auto">
      {/* Elite Signals Dashboard - 4 Cards */}
      <div className="bg-gradient-to-r from-indigo-950/50 to-slate-900/50 rounded-xl border border-primary/30 p-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-orange-400" />
            <h2 className="text-sm font-bold bg-gradient-to-r from-orange-400 to-blue-400 bg-clip-text text-transparent">⚡ ELITE SIGNAL FORGE</h2>
            <Badge variant="outline" className="text-[9px]">LIVE 4 SIGNALS</Badge>
          </div>
          <Select value={signalContractType} onValueChange={(v: any) => setSignalContractType(v)}>
            <SelectTrigger className="h-7 w-32 text-[10px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="overunder">OVER/UNDER</SelectItem>
              <SelectItem value="evenodd">EVEN/ODD</SelectItem>
              <SelectItem value="risefall">RISE/FALL</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {topSignals.length === 0 ? (
            <div className="col-span-full text-center py-6 text-muted-foreground text-xs">
              🔮 Analyzing {Object.keys(tickCounts).length} markets... gathering ticks
            </div>
          ) : (
            topSignals.map((sig, idx) => {
              const strengthPercent = (sig.strength * 100).toFixed(1);
              return (
                <div key={`${sig.symbol}_${sig.type}`} className="bg-slate-900/80 backdrop-blur-sm rounded-xl p-3 border border-orange-500/30 hover:border-orange-500 transition-all hover:-translate-y-1">
                  <div className="flex items-center justify-between">
                    <Badge className="bg-orange-600 text-[8px] px-1.5">#{idx + 1} · {sig.type}</Badge>
                    <span className="text-[9px] font-mono text-blue-300">{sig.symbol}</span>
                  </div>
                  <div className="text-base font-bold mt-1 bg-gradient-to-r from-white to-orange-300 bg-clip-text text-transparent">{sig.name}</div>
                  <p className="text-[9px] text-slate-300 mt-1 leading-tight">{sig.detail}</p>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-[8px] text-slate-400">{sig.extra?.slice(0, 25)}</span>
                    <span className="text-[10px] font-bold text-yellow-400">{strengthPercent}%</span>
                  </div>
                  <div className="w-full h-1 bg-slate-700 rounded-full mt-1 overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-orange-500 to-yellow-400 rounded-full" style={{ width: `${strengthPercent}%` }} />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between gap-2 bg-card border border-border rounded-xl px-3 py-2">
        <h1 className="text-base font-bold text-foreground flex items-center gap-2">
          <Scan className="w-4 h-4 text-primary" /> Pro Scanner Bot
        </h1>
        <div className="flex items-center gap-2">
          <Badge className={`${status.color} text-[10px]`}>{status.icon} {status.label}</Badge>
          {isRunning && <Badge variant="outline" className="text-[10px] text-warning animate-pulse font-mono">P/L: ${netProfit.toFixed(2)}</Badge>}
          {isRunning && <Badge variant="outline" className={`text-[10px] ${currentMarket === 1 ? 'text-profit border-profit/50' : 'text-purple-400 border-purple-500/50'}`}>{currentMarket === 1 ? '🏠 M1' : '🔄 M2'}</Badge>}
        </div>
      </div>

      {/* Scanner + Turbo + Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div className="bg-card border border-border rounded-xl p-2.5">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5"><Eye className="w-3.5 h-3.5 text-primary" /><span className="text-xs font-semibold">Scanner</span><Badge variant={scannerActive ? 'default' : 'secondary'} className="text-[9px]">{scannerActive ? 'ON' : 'OFF'}</Badge></div>
            <Switch checked={scannerActive} onCheckedChange={setScannerActive} disabled={isRunning} />
          </div>
          <div className="flex flex-wrap gap-0.5">{SCANNER_MARKETS.map(m => <Badge key={m.symbol} variant="outline" className={`text-[8px] ${(tickCounts[m.symbol] || 0) > 0 ? 'border-primary/50 text-primary' : 'text-muted-foreground'}`}>{m.name}</Badge>)}</div>
        </div>
        <div className="bg-card border border-border rounded-xl p-2.5">
          <div className="flex items-center justify-between mb-1.5"><Zap className={`w-3.5 h-3.5 ${turboMode ? 'text-profit animate-pulse' : 'text-muted-foreground'}`} /><span className="text-xs font-semibold">Turbo</span><Button size="sm" variant={turboMode ? 'default' : 'outline'} className="h-6 text-[9px] px-2" onClick={() => setTurboMode(!turboMode)} disabled={isRunning}>{turboMode ? '⚡ ON' : 'OFF'}</Button></div>
          <div className="grid grid-cols-3 gap-1 text-center"><div className="bg-muted/50 rounded p-1"><div className="text-[8px]">Latency</div><div className="font-mono text-[10px] text-primary">{turboLatency}ms</div></div><div className="bg-muted/50 rounded p-1"><div className="text-[8px]">Captured</div><div className="font-mono text-[10px] text-profit">{ticksCaptured}</div></div><div className="bg-muted/50 rounded p-1"><div className="text-[8px]">Missed</div><div className="font-mono text-[10px] text-loss">{ticksMissed}</div></div></div>
        </div>
        <div className="bg-card border border-border rounded-xl p-2.5">
          <div className="flex items-center justify-between mb-1.5"><span className="text-xs font-semibold">Stats</span><span className="font-mono text-sm font-bold">${balance.toFixed(2)}</span></div>
          <div className="grid grid-cols-3 gap-1 text-center"><div className="bg-muted/50 rounded p-1"><div className="text-[8px]">W/L</div><div className="font-mono text-[10px]"><span className="text-profit">{wins}</span>/<span className="text-loss">{losses}</span></div></div><div className="bg-muted/50 rounded p-1"><div className="text-[8px]">Net P/L</div><div className={`font-mono text-[10px] ${netProfit >= 0 ? 'text-profit' : 'text-loss'}`}>${netProfit.toFixed(2)}</div></div><div className="bg-muted/50 rounded p-1"><div className="text-[8px]">Stake</div><div className="font-mono text-[10px]">${currentStake.toFixed(2)}{martingaleStep > 0 && <span className="text-warning"> M{martingaleStep}</span>}</div></div></div>
        </div>
      </div>

      {/* Main 2-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-2">
        <div className="lg:col-span-4 space-y-2">
          {/* Market Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-1 gap-2">
            <div className="bg-card border-2 border-profit/30 rounded-xl p-2.5"><div className="flex justify-between"><h3 className="text-xs font-bold text-profit"><Home className="w-3.5 h-3.5 inline mr-1" /> M1 — Home</h3><Switch checked={m1Enabled} onCheckedChange={setM1Enabled} disabled={isRunning} /></div><Select value={m1Symbol} onValueChange={setM1Symbol} disabled={isRunning}><SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger><SelectContent>{SCANNER_MARKETS.map(m => <SelectItem key={m.symbol} value={m.symbol}>{m.name}</SelectItem>)}</SelectContent></Select><Select value={m1Contract} onValueChange={setM1Contract} disabled={isRunning}><SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger><SelectContent>{CONTRACT_TYPES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select>{needsBarrier(m1Contract) && <Input type="number" value={m1Barrier} onChange={e => setM1Barrier(e.target.value)} className="h-7 text-xs" disabled={isRunning} />}<div className="border-t border-border/30 pt-1.5 mt-1"><div className="flex justify-between"><span className="text-[9px] font-semibold text-primary"><Anchor className="w-3 h-3 inline mr-1" /> Virtual Hook</span><Switch checked={m1HookEnabled} onCheckedChange={setM1HookEnabled} disabled={isRunning} /></div>{m1HookEnabled && <div className="grid grid-cols-2 gap-1 mt-1"><Input type="number" placeholder="V-Losses" value={m1VirtualLossCount} onChange={e => setM1VirtualLossCount(e.target.value)} className="h-6 text-[10px]" disabled={isRunning} /><Input type="number" placeholder="Real Trades" value={m1RealCount} onChange={e => setM1RealCount(e.target.value)} className="h-6 text-[10px]" disabled={isRunning} /></div>}</div></div>
            <div className="bg-card border-2 border-purple-500/30 rounded-xl p-2.5"><div className="flex justify-between"><h3 className="text-xs font-bold text-purple-400"><RefreshCw className="w-3.5 h-3.5 inline mr-1" /> M2 — Recovery</h3><Switch checked={m2Enabled} onCheckedChange={setM2Enabled} disabled={isRunning} /></div><Select value={m2Symbol} onValueChange={setM2Symbol} disabled={isRunning}><SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger><SelectContent>{SCANNER_MARKETS.map(m => <SelectItem key={m.symbol} value={m.symbol}>{m.name}</SelectItem>)}</SelectContent></Select><Select value={m2Contract} onValueChange={setM2Contract} disabled={isRunning}><SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger><SelectContent>{CONTRACT_TYPES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select>{needsBarrier(m2Contract) && <Input type="number" value={m2Barrier} onChange={e => setM2Barrier(e.target.value)} className="h-7 text-xs" disabled={isRunning} />}<div className="border-t border-border/30 pt-1.5 mt-1"><div className="flex justify-between"><span className="text-[9px] font-semibold text-primary"><Anchor className="w-3 h-3 inline mr-1" /> Virtual Hook</span><Switch checked={m2HookEnabled} onCheckedChange={setM2HookEnabled} disabled={isRunning} /></div>{m2HookEnabled && <div className="grid grid-cols-2 gap-1 mt-1"><Input type="number" placeholder="V-Losses" value={m2VirtualLossCount} onChange={e => setM2VirtualLossCount(e.target.value)} className="h-6 text-[10px]" disabled={isRunning} /><Input type="number" placeholder="Real Trades" value={m2RealCount} onChange={e => setM2RealCount(e.target.value)} className="h-6 text-[10px]" disabled={isRunning} /></div>}</div></div>
          </div>
          <div className="bg-card border border-border rounded-xl p-2.5"><h3 className="text-xs font-semibold"><Shield className="w-3.5 h-3.5 inline mr-1" /> Risk</h3><div className="grid grid-cols-3 gap-1.5 mt-1"><Input type="number" placeholder="Stake" value={stake} onChange={e => setStake(e.target.value)} className="h-7 text-xs" disabled={isRunning} /><Input type="number" placeholder="TP" value={takeProfit} onChange={e => setTakeProfit(e.target.value)} className="h-7 text-xs" disabled={isRunning} /><Input type="number" placeholder="SL" value={stopLoss} onChange={e => setStopLoss(e.target.value)} className="h-7 text-xs" disabled={isRunning} /></div><div className="flex justify-between items-center mt-1"><span className="text-[10px]">Martingale</span><Switch checked={martingaleOn} onCheckedChange={setMartingaleOn} disabled={isRunning} /></div>{martingaleOn && <div className="grid grid-cols-2 gap-1 mt-1"><Input type="number" placeholder="Multiplier" value={martingaleMultiplier} onChange={e => setMartingaleMultiplier(e.target.value)} className="h-7 text-xs" disabled={isRunning} /><Input type="number" placeholder="Max Steps" value={martingaleMaxSteps} onChange={e => setMartingaleMaxSteps(e.target.value)} className="h-7 text-xs" disabled={isRunning} /></div>}<div className="flex gap-3 mt-2"><label className="flex items-center gap-1 text-[10px]"><input type="checkbox" checked={strategyM1Enabled} onChange={e => setStrategyM1Enabled(e.target.checked)} disabled={isRunning} /> Strategy M1</label><label className="flex items-center gap-1 text-[10px]"><input type="checkbox" checked={strategyEnabled} onChange={e => setStrategyEnabled(e.target.checked)} disabled={isRunning} /> Strategy M2</label></div></div>
        </div>

        <div className="lg:col-span-8 space-y-2">
          <div className="bg-card border border-border rounded-xl p-2.5"><div className="flex justify-between mb-1.5"><h3 className="text-[10px] font-semibold">Live Digits — {activeSymbol}</h3><span className="text-[9px] text-muted-foreground">Win Rate: {winRate}% | Staked: ${totalStaked.toFixed(2)}</span></div><div className="flex gap-1 justify-center">{activeDigits.length === 0 ? <span className="text-[10px]">Waiting...</span> : activeDigits.map((d, i) => (<div key={i} className={`w-8 h-10 rounded-lg flex flex-col items-center justify-center text-xs font-mono border ${i === activeDigits.length - 1 ? 'ring-2 ring-primary' : ''} ${d >= 5 ? 'bg-loss/10 border-loss/30 text-loss' : 'bg-profit/10 border-profit/30 text-profit'}`}><span className="text-sm">{d}</span><span className="text-[7px]">{d >= 5 ? 'O' : 'U'}{d % 2 === 0 ? 'E' : 'O'}</span></div>))}</div></div>

          <div className="grid grid-cols-2 gap-2"><Button onClick={startBot} disabled={isRunning || !isAuthorized || balance < parseFloat(stake)} className="h-12 bg-profit hover:bg-profit/90"><Play className="w-4 h-4 mr-2" /> START M1</Button><Button onClick={stopBot} disabled={!isRunning} variant="destructive" className="h-12"><StopCircle className="w-4 h-4 mr-2" /> STOP</Button></div>

          <div className="bg-card border border-border rounded-xl overflow-hidden"><div className="px-2.5 py-2 border-b border-border flex justify-between"><h3 className="text-xs font-semibold">Activity Log</h3><Button variant="ghost" size="sm" onClick={clearLog} className="h-7 w-7 p-0"><Trash2 className="w-3 h-3" /></Button></div><div className="max-h-[280px] overflow-auto"><table className="w-full text-[9px]"><thead className="sticky top-0 bg-muted"><tr><th className="p-1 text-left">Time</th><th className="p-1">Mkt</th><th className="p-1">Sym</th><th className="p-1">Stake</th><th className="p-1">Digit</th><th className="p-1">Result</th><th className="p-1">P/L</th></tr></thead><tbody>{logEntries.slice(0, 20).map(e => (<tr key={e.id} className="border-t border-border/30"><td className="p-1 font-mono">{e.time}</td><td className={`p-1 font-bold ${e.market === 'M1' ? 'text-profit' : e.market === 'VH' ? 'text-primary' : 'text-purple-400'}`}>{e.market}</td><td className="p-1">{e.symbol}</td><td className="p-1">{e.market === 'VH' ? 'FAKE' : `$${e.stake.toFixed(2)}`}</td><td className="p-1 text-center font-mono">{e.exitDigit}</td><td className="p-1"><span className={`px-1 py-0.5 rounded text-[8px] ${e.result === 'Win' || e.result === 'V-Win' ? 'bg-profit/20 text-profit' : e.result === 'Loss' || e.result === 'V-Loss' ? 'bg-loss/20 text-loss' : 'bg-warning/20 text-warning'}`}>{e.result === 'Pending' ? '...' : e.result}</span></td><td className={`p-1 ${e.pnl > 0 ? 'text-profit' : e.pnl < 0 ? 'text-loss' : ''}`}>{e.market === 'VH' ? '-' : `${e.pnl > 0 ? '+' : ''}${e.pnl.toFixed(2)}`}</td></tr>))}</tbody></table></div></div>
        </div>
      </div>
    </div>
  );
}
