import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
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
  Home, RefreshCw, Shield, Zap, Eye, Anchor, Download, Upload,
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

export default function ProScannerBot() {
  const { isAuthorized, balance, activeAccount } = useAuth();
  const { recordLoss } = useLossRequirement();

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

  /* ── Virtual Hook M1 ── */
  const [m1HookEnabled, setM1HookEnabled] = useState(false);
  const [m1VirtualLossCount, setM1VirtualLossCount] = useState('3');
  const [m1RealCount, setM1RealCount] = useState('2');

  /* ── Virtual Hook M2 ── */
  const [m2HookEnabled, setM2HookEnabled] = useState(false);
  const [m2VirtualLossCount, setM2VirtualLossCount] = useState('3');
  const [m2RealCount, setM2RealCount] = useState('2');

  /* ── Virtual Hook stats ── */
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

  /* ── M1 pattern/digit config ── */
  const [m1Pattern, setM1Pattern] = useState('');
  const [m1DigitCondition, setM1DigitCondition] = useState('==');
  const [m1DigitCompare, setM1DigitCompare] = useState('5');
  const [m1DigitWindow, setM1DigitWindow] = useState('3');

  /* ── M2 pattern/digit config ── */
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

  /* ── Tick data (legacy for pattern matching) ── */
  const tickMapRef = useRef<Map<string, number[]>>(new Map());
  const [tickCounts, setTickCounts] = useState<Record<string, number>>({});

  /* Subscribe to all scanner markets */
  useEffect(() => {
    if (!derivApi.isConnected) return;
    let active = true;
    const handler = (data: any) => {
      if (!data.tick || !active) return;
      const sym = data.tick.symbol as string;
      const digit = getLastDigit(data.tick.quote);
      const now = performance.now();

      // Legacy tick map
      const map = tickMapRef.current;
      const arr = map.get(sym) || [];
      arr.push(digit);
      if (arr.length > 200) arr.shift();
      map.set(sym, arr);
      setTickCounts(prev => ({ ...prev, [sym]: arr.length }));

      // Turbo circular buffer
      if (!turboBuffersRef.current.has(sym)) {
        turboBuffersRef.current.set(sym, new CircularTickBuffer(1000));
      }
      const buf = turboBuffersRef.current.get(sym)!;
      buf.push(digit);

      // Turbo latency tracking
      if (lastTickTsRef.current > 0) {
        const lat = now - lastTickTsRef.current;
        setTurboLatency(Math.round(lat));
        if (lat > 50) setTicksMissed(prev => prev + 1);
      }
      lastTickTsRef.current = now;
      setTicksCaptured(prev => prev + 1);
    };
    const unsub = derivApi.onMessage(handler);
    SCANNER_MARKETS.forEach(m => { derivApi.subscribeTicks(m.symbol as MarketSymbol, () => {}).catch(() => {}); });
    return () => { active = false; unsub(); };
  }, []);

  /* ── Pattern validation ── */
  const cleanM1Pattern = m1Pattern.toUpperCase().replace(/[^EO]/g, '');
  const m1PatternValid = cleanM1Pattern.length >= 2;
  const cleanM2Pattern = m2Pattern.toUpperCase().replace(/[^EO]/g, '');
  const m2PatternValid = cleanM2Pattern.length >= 2;

  /* ── Check pattern match for a symbol with specific pattern ── */
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

  /* ── Check digit condition for a symbol with specific config ── */
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

  /* ── Check strategy condition for a specific market ── */
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

  /* ── Find scanner match across all markets for a specific market ── */
  const findScannerMatchForMarket = useCallback((market: 1 | 2): string | null => {
    for (const m of SCANNER_MARKETS) {
      if (checkStrategyForMarket(m.symbol, market)) return m.symbol;
    }
    return null;
  }, [checkStrategyForMarket]);

  /* ── Add log entry ── */
  const addLog = useCallback((id: number, entry: Omit<LogEntry, 'id'>) => {
    setLogEntries(prev => [{ ...entry, id }, ...prev].slice(0, 100));
  }, []);

  /* ── Update pending log ── */
  const updateLog = useCallback((id: number, updates: Partial<LogEntry>) => {
    setLogEntries(prev => prev.map(e => e.id === id ? { ...e, ...updates } : e));
  }, []);

  /* ── Clear log ── */
  const clearLog = useCallback(() => {
    setLogEntries([]);
    setWins(0); setLosses(0); setTotalStaked(0); setNetProfit(0);
    setMartingaleStepState(0);
    setVhFakeWins(0); setVhFakeLosses(0); setVhConsecLosses(0); setVhStatus('idle');
    setTicksCaptured(0); setTicksMissed(0);
  }, []);

  /* ═══════════════ MAIN BOT LOOP ═══════════════ */
  const startBot = useCallback(async () => {
    if (!isAuthorized || isRunning) return;
    const baseStake = parseFloat(stake);
    if (baseStake < 0.35) { toast.error('Min stake $0.35'); return; }
    if (!m1Enabled && !m2Enabled) { toast.error('Enable at least one market'); return; }
    if (strategyM1Enabled && m1StrategyMode === 'pattern' && !m1PatternValid) { toast.error('Invalid M1 pattern (min 2 E/O)'); return; }
    if (strategyEnabled && m2StrategyMode === 'pattern' && !m2PatternValid) { toast.error('Invalid M2 pattern (min 2 E/O)'); return; }

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

      /* ── Strategy gating for M2 (recovery) ── */
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
          if (!matched) {
            await new Promise<void>(r => {
              if (turboMode) requestAnimationFrame(() => r());
              else setTimeout(r, 500);
            });
          }
        }
        if (!runningRef.current) break;

        setBotStatus('pattern_matched');
        tradeSymbol = matchedSymbol;
        if (!turboMode) await new Promise(r => setTimeout(r, 300));
      }
      /* ── Strategy gating for M1 ── */
      else if (!inRecovery && strategyM1Enabled) {
        setBotStatus('waiting_pattern');

        let matched = false;
        while (runningRef.current && !matched) {
          if (checkStrategyForMarket(cfg.symbol, 1)) { matched = true; }
          if (!matched) {
            await new Promise<void>(r => {
              if (turboMode) requestAnimationFrame(() => r());
              else setTimeout(r, 500);
            });
          }
        }
        if (!runningRef.current) break;

        setBotStatus('pattern_matched');
        tradeSymbol = cfg.symbol;
        if (!turboMode) await new Promise(r => setTimeout(r, 300));
      } else {
        setBotStatus(mkt === 1 ? 'trading_m1' : 'recovery');
        tradeSymbol = cfg.symbol;
      }

      /* ═══ VIRTUAL HOOK SEQUENCE — Loss-streak based ═══ */
      if (hookEnabled) {
        setBotStatus('virtual_hook');
        setVhStatus('waiting');
        setVhFakeWins(0);
        setVhFakeLosses(0);
        setVhConsecLosses(0);
        let consecLosses = 0;
        let virtualTradeNum = 0;

        // Keep simulating virtual trades until we accumulate requiredLosses consecutive losses
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
            // Win resets the consecutive loss counter
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

        // Required consecutive losses reached → hook confirmed
        setVhStatus('confirmed');
        toast.success(`🎣 Hook confirmed! ${requiredLosses} consecutive losses detected → Executing ${realCount} real trade(s)`);

        /* Execute real trades batch */
        for (let ri = 0; ri < realCount && runningRef.current; ri++) {
          const result = await executeRealTrade(
            cfg, tradeSymbol, cStake, mStep, mkt, localBalance, localPnl, baseStake
          );
          if (!result || !runningRef.current) break;
          localPnl = result.localPnl;
          localBalance = result.localBalance;
          cStake = result.cStake;
          mStep = result.mStep;
          inRecovery = result.inRecovery;

          if (result.shouldBreak) { runningRef.current = false; break; }
        }

        // Reset after real trades
        setVhStatus('idle');
        setVhConsecLosses(0);
        if (!runningRef.current) break;
        continue;
      }

      /* ═══ NORMAL REAL TRADE (no hook) ═══ */
      const result = await executeRealTrade(
        cfg, tradeSymbol, cStake, mStep, mkt, localBalance, localPnl, baseStake
      );
      if (!result || !runningRef.current) break;
      localPnl = result.localPnl;
      localBalance = result.localBalance;
      cStake = result.cStake;
      mStep = result.mStep;
      inRecovery = result.inRecovery;

      if (result.shouldBreak) break;

      // Turbo: no delay between trades; normal: small delay
      if (!turboMode) await new Promise(r => setTimeout(r, 400));
    }

    setIsRunning(false);
    runningRef.current = false;
    setBotStatus('idle');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, isRunning, balance, stake, m1Enabled, m2Enabled, m1Contract, m2Contract,
    m1Barrier, m2Barrier, m1Symbol, m2Symbol, martingaleOn, martingaleMultiplier, martingaleMaxSteps,
    takeProfit, stopLoss, strategyEnabled, strategyM1Enabled, m1StrategyMode, m2StrategyMode, m1PatternValid, m2PatternValid,
    scannerActive, findScannerMatchForMarket, checkStrategyForMarket, addLog, updateLog, turboMode,
    m1HookEnabled, m2HookEnabled, m1VirtualLossCount, m2VirtualLossCount, m1RealCount, m2RealCount]);

  /* ── Execute a single real trade ── */
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
      // Turbo: skip waiting for next tick, trade immediately
      if (!turboMode) {
        await waitForNextTick(tradeSymbol as MarketSymbol);
      }

      const buyParams: any = {
        contract_type: cfg.contract, symbol: tradeSymbol,
        duration: 1, duration_unit: 't', basis: 'stake', amount: cStake,
      };
      if (needsBarrier(cfg.contract)) buyParams.barrier = cfg.barrier;

      const { contractId } = await derivApi.buyContract(buyParams);
      
      // Copy trade to followers
      if (copyTradingService.enabled) {
        copyTradingService.copyTrade({
          ...buyParams,
          masterTradeId: contractId,
        }).catch(err => console.error('Copy trading error:', err));
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
        if (inRecovery) {
          switchInfo = '✓ Recovery WIN → Back to M1';
          inRecovery = false;
        } else {
          switchInfo = '→ Continue M1';
        }
        mStep = 0;
        cStake = baseStake;
      } else {
        setLosses(prev => prev + 1);
        // Record loss for virtual trading requirement (duration ~1 tick ≈ 5s+)
        if (activeAccount?.is_virtual) {
          recordLoss(cStake, tradeSymbol, 6000);
        }
        if (!inRecovery && m2Enabled) {
          inRecovery = true;
          switchInfo = '✗ Loss → Switch to M2';
        } else {
          switchInfo = inRecovery ? '→ Stay M2' : '→ Continue M1';
        }
        if (martingaleOn) {
          const maxS = parseInt(martingaleMaxSteps) || 5;
          if (mStep < maxS) {
            cStake = parseFloat((cStake * (parseFloat(martingaleMultiplier) || 2)).toFixed(2));
            mStep++;
          } else {
            mStep = 0;
            cStake = baseStake;
          }
        }
      }

      setNetProfit(prev => prev + pnl);
      setMartingaleStepState(mStep);
      setCurrentStakeState(cStake);

      updateLog(logId, { exitDigit, result: won ? 'Win' : 'Loss', pnl, balance: localBalance, switchInfo });

      let shouldBreak = false;
      if (localPnl >= parseFloat(takeProfit)) {
        toast.success(`🎯 Take Profit! +$${localPnl.toFixed(2)}`);
        shouldBreak = true;
      }
      if (localPnl <= -parseFloat(stopLoss)) {
        toast.error(`🛑 Stop Loss! $${localPnl.toFixed(2)}`);
        shouldBreak = true;
      }
      if (localBalance < cStake) {
        toast.error('Insufficient balance');
        shouldBreak = true;
      }

      return { localPnl, localBalance, cStake, mStep, inRecovery, shouldBreak };
    } catch (err: any) {
      updateLog(logId, { result: 'Loss', pnl: 0, exitDigit: '-', switchInfo: `Error: ${err.message}` });
      if (!turboMode) await new Promise(r => setTimeout(r, 2000));
      return { localPnl, localBalance, cStake, mStep, inRecovery, shouldBreak: false };
    }
  }, [addLog, updateLog, m2Enabled, martingaleOn, martingaleMultiplier, martingaleMaxSteps, takeProfit, stopLoss, turboMode]);

  const stopBot = useCallback(() => {
    runningRef.current = false;
    setIsRunning(false);
    setBotStatus('idle');
  }, []);

  /* ── Status helpers ── */
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

  /* ── Build config object for preview ── */
  const currentConfig = useMemo<BotConfig>(() => ({
    version: 1,
    m1: { enabled: m1Enabled, symbol: m1Symbol, contract: m1Contract, barrier: m1Barrier, hookEnabled: m1HookEnabled, virtualLossCount: m1VirtualLossCount, realCount: m1RealCount },
    m2: { enabled: m2Enabled, symbol: m2Symbol, contract: m2Contract, barrier: m2Barrier, hookEnabled: m2HookEnabled, virtualLossCount: m2VirtualLossCount, realCount: m2RealCount },
    risk: { stake, martingaleOn, martingaleMultiplier, martingaleMaxSteps, takeProfit, stopLoss },
    strategy: { m1Enabled: strategyM1Enabled, m2Enabled: strategyEnabled, m1Mode: m1StrategyMode, m2Mode: m2StrategyMode, m1Pattern, m1DigitCondition, m1DigitCompare, m1DigitWindow, m2Pattern, m2DigitCondition, m2DigitCompare, m2DigitWindow },
    scanner: { active: scannerActive },
    turbo: { enabled: turboMode },
  }), [m1Enabled, m1Symbol, m1Contract, m1Barrier, m1HookEnabled, m1VirtualLossCount, m1RealCount, m2Enabled, m2Symbol, m2Contract, m2Barrier, m2HookEnabled, m2VirtualLossCount, m2RealCount, stake, martingaleOn, martingaleMultiplier, martingaleMaxSteps, takeProfit, stopLoss, strategyM1Enabled, strategyEnabled, m1StrategyMode, m2StrategyMode, m1Pattern, m1DigitCondition, m1DigitCompare, m1DigitWindow, m2Pattern, m2DigitCondition, m2DigitCompare, m2DigitWindow, scannerActive, turboMode]);

  const handleLoadConfig = useCallback((cfg: BotConfig) => {
    if (cfg.m1) {
      if (cfg.m1.enabled !== undefined) setM1Enabled(cfg.m1.enabled);
      if (cfg.m1.symbol) setM1Symbol(cfg.m1.symbol);
      if (cfg.m1.contract) setM1Contract(cfg.m1.contract);
      if (cfg.m1.barrier) setM1Barrier(cfg.m1.barrier);
      if (cfg.m1.hookEnabled !== undefined) setM1HookEnabled(cfg.m1.hookEnabled);
      if (cfg.m1.virtualLossCount) setM1VirtualLossCount(cfg.m1.virtualLossCount);
      if (cfg.m1.realCount) setM1RealCount(cfg.m1.realCount);
    }
    if (cfg.m2) {
      if (cfg.m2.enabled !== undefined) setM2Enabled(cfg.m2.enabled);
      if (cfg.m2.symbol) setM2Symbol(cfg.m2.symbol);
      if (cfg.m2.contract) setM2Contract(cfg.m2.contract);
      if (cfg.m2.barrier) setM2Barrier(cfg.m2.barrier);
      if (cfg.m2.hookEnabled !== undefined) setM2HookEnabled(cfg.m2.hookEnabled);
      if (cfg.m2.virtualLossCount) setM2VirtualLossCount(cfg.m2.virtualLossCount);
      if (cfg.m2.realCount) setM2RealCount(cfg.m2.realCount);
    }
    if (cfg.risk) {
      if (cfg.risk.stake) setStake(cfg.risk.stake);
      if (cfg.risk.martingaleOn !== undefined) setMartingaleOn(cfg.risk.martingaleOn);
      if (cfg.risk.martingaleMultiplier) setMartingaleMultiplier(cfg.risk.martingaleMultiplier);
      if (cfg.risk.martingaleMaxSteps) setMartingaleMaxSteps(cfg.risk.martingaleMaxSteps);
      if (cfg.risk.takeProfit) setTakeProfit(cfg.risk.takeProfit);
      if (cfg.risk.stopLoss) setStopLoss(cfg.risk.stopLoss);
    }
    if (cfg.strategy) {
      if (cfg.strategy.m1Enabled !== undefined) setStrategyM1Enabled(cfg.strategy.m1Enabled);
      if (cfg.strategy.m2Enabled !== undefined) setStrategyEnabled(cfg.strategy.m2Enabled);
      if (cfg.strategy.m1Mode) setM1StrategyMode(cfg.strategy.m1Mode);
      if (cfg.strategy.m2Mode) setM2StrategyMode(cfg.strategy.m2Mode);
      if (cfg.strategy.m1Pattern !== undefined) setM1Pattern(cfg.strategy.m1Pattern);
      if (cfg.strategy.m1DigitCondition) setM1DigitCondition(cfg.strategy.m1DigitCondition);
      if (cfg.strategy.m1DigitCompare) setM1DigitCompare(cfg.strategy.m1DigitCompare);
      if (cfg.strategy.m1DigitWindow) setM1DigitWindow(cfg.strategy.m1DigitWindow);
      if (cfg.strategy.m2Pattern !== undefined) setM2Pattern(cfg.strategy.m2Pattern);
      if (cfg.strategy.m2DigitCondition) setM2DigitCondition(cfg.strategy.m2DigitCondition);
      if (cfg.strategy.m2DigitCompare) setM2DigitCompare(cfg.strategy.m2DigitCompare);
      if (cfg.strategy.m2DigitWindow) setM2DigitWindow(cfg.strategy.m2DigitWindow);
    }
    if (cfg.scanner?.active !== undefined) setScannerActive(cfg.scanner.active);
    if (cfg.turbo?.enabled !== undefined) setTurboMode(cfg.turbo.enabled);
    if (cfg.botName) setBotName(cfg.botName);
  }, []);

  const activeSymbol = currentMarket === 1 ? m1Symbol : m2Symbol;
  const activeDigits = (tickMapRef.current.get(activeSymbol) || []).slice(-8);

  return (
    <div className="space-y-2 max-w-7xl mx-auto">
      {/* ── Compact Header ── */}
      <div className="flex items-center justify-between gap-2 bg-card border border-border rounded-xl px-3 py-2">
        <h1 className="text-base font-bold text-foreground flex items-center gap-2">
          <Scan className="w-4 h-4 text-primary" /> Pro Scanner Bot
        </h1>
        <div className="flex items-center gap-2">
          <Badge className={`${status.color} text-[10px]`}>{status.icon} {status.label}</Badge>
          {isRunning && (
            <Badge variant="outline" className="text-[10px] text-warning animate-pulse font-mono">
              P/L: ${netProfit.toFixed(2)}
            </Badge>
          )}
          {isRunning && (
            <Badge variant="outline" className={`text-[10px] ${currentMarket === 1 ? 'text-profit border-profit/50' : 'text-purple-400 border-purple-500/50'}`}>
              {currentMarket === 1 ? '🏠 M1' : '🔄 M2'}
            </Badge>
          )}
        </div>
      </div>

      {/* ── Scanner + Turbo + Stats Compact Row ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        {/* Scanner */}
        <div className="bg-card border border-border rounded-xl p-2.5">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <Eye className="w-3.5 h-3.5 text-primary" />
              <span className="text-xs font-semibold text-foreground">Scanner</span>
              <Badge variant={scannerActive ? 'default' : 'secondary'} className="text-[9px] h-4 px-1.5">
                {scannerActive ? '🟢 ON' : '⚫ OFF'}
              </Badge>
            </div>
            <Switch checked={scannerActive} onCheckedChange={setScannerActive} disabled={isRunning} />
          </div>
          <div className="flex flex-wrap gap-0.5">
            {SCANNER_MARKETS.map(m => {
              const count = tickCounts[m.symbol] || 0;
              return (
                <Badge key={m.symbol} variant="outline"
                  className={`text-[8px] h-4 px-1 font-mono ${count > 0 ? 'border-primary/50 text-primary' : 'text-muted-foreground'}`}>
                  {m.name}
                </Badge>
              );
            })}
          </div>
        </div>

        {/* Turbo */}
        <div className="bg-card border border-border rounded-xl p-2.5">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <Zap className={`w-3.5 h-3.5 ${turboMode ? 'text-profit animate-pulse' : 'text-muted-foreground'}`} />
              <span className="text-xs font-semibold text-foreground">Turbo</span>
            </div>
            <Button
              size="sm"
              variant={turboMode ? 'default' : 'outline'}
              className={`h-6 text-[9px] px-2 ${turboMode ? 'bg-profit hover:bg-profit/90 text-profit-foreground animate-pulse' : ''}`}
              onClick={() => setTurboMode(!turboMode)}
              disabled={isRunning}
            >
              {turboMode ? '⚡ ON' : 'OFF'}
            </Button>
          </div>
          <div className="grid grid-cols-3 gap-1 text-center">
            <div className="bg-muted/50 rounded p-1">
              <div className="text-[8px] text-muted-foreground">Latency</div>
              <div className="font-mono text-[10px] text-primary font-bold">{turboLatency}ms</div>
            </div>
            <div className="bg-muted/50 rounded p-1">
              <div className="text-[8px] text-muted-foreground">Captured</div>
              <div className="font-mono text-[10px] text-profit font-bold">{ticksCaptured}</div>
            </div>
            <div className="bg-muted/50 rounded p-1">
              <div className="text-[8px] text-muted-foreground">Missed</div>
              <div className="font-mono text-[10px] text-loss font-bold">{ticksMissed}</div>
            </div>
          </div>
        </div>

        {/* Live Stats */}
        <div className="bg-card border border-border rounded-xl p-2.5">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-semibold text-foreground">Stats</span>
            <span className="font-mono text-sm font-bold text-foreground">${balance.toFixed(2)}</span>
          </div>
          <div className="grid grid-cols-3 gap-1 text-center">
            <div className="bg-muted/50 rounded p-1">
              <div className="text-[8px] text-muted-foreground">W/L</div>
              <div className="font-mono text-[10px] font-bold"><span className="text-profit">{wins}</span>/<span className="text-loss">{losses}</span></div>
            </div>
            <div className="bg-muted/50 rounded p-1">
              <div className="text-[8px] text-muted-foreground">Net P/L</div>
              <div className={`font-mono text-[10px] font-bold ${netProfit >= 0 ? 'text-profit' : 'text-loss'}`}>${netProfit.toFixed(2)}</div>
            </div>
            <div className="bg-muted/50 rounded p-1">
              <div className="text-[8px] text-muted-foreground">Stake</div>
              <div className="font-mono text-[10px] font-bold text-foreground">${currentStake.toFixed(2)}{martingaleStep > 0 && <span className="text-warning"> M{martingaleStep}</span>}</div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Main 2-Column Layout ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-2">
        {/* ═══ LEFT: Config Column ═══ */}
        <div className="lg:col-span-4 space-y-2">
          {/* Market 1 + Market 2 side by side on md */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-1 gap-2">
            {/* Market 1 */}
            <div className="bg-card border-2 border-profit/30 rounded-xl p-2.5 space-y-1.5">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-profit flex items-center gap-1"><Home className="w-3.5 h-3.5" /> M1 — Home</h3>
                <div className="flex items-center gap-1.5">
                  {currentMarket === 1 && isRunning && <span className="w-2 h-2 rounded-full bg-profit animate-pulse" />}
                  <Switch checked={m1Enabled} onCheckedChange={setM1Enabled} disabled={isRunning} />
                </div>
              </div>
              <Select value={m1Symbol} onValueChange={v => setM1Symbol(v)} disabled={isRunning}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{SCANNER_MARKETS.map(m => <SelectItem key={m.symbol} value={m.symbol}>{m.name} ({m.symbol})</SelectItem>)}</SelectContent>
              </Select>
              <Select value={m1Contract} onValueChange={v => setM1Contract(v)} disabled={isRunning}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{CONTRACT_TYPES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
              {needsBarrier(m1Contract) && (
                <Input type="number" min="0" max="9" value={m1Barrier} onChange={e => setM1Barrier(e.target.value)}
                  className="h-7 text-xs" placeholder="Barrier (0-9)" disabled={isRunning} />
              )}
              {/* Virtual Hook M1 */}
              <div className="border-t border-border/30 pt-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-semibold text-primary flex items-center gap-1">
                    <Anchor className="w-3 h-3" /> Virtual Hook
                  </span>
                  <Switch checked={m1HookEnabled} onCheckedChange={setM1HookEnabled} disabled={isRunning} />
                </div>
                {m1HookEnabled && (
                  <div className="grid grid-cols-2 gap-1.5 mt-1">
                    <div>
                      <label className="text-[8px] text-muted-foreground">V-Losses</label>
                      <Input type="number" min="1" max="20" value={m1VirtualLossCount} onChange={e => setM1VirtualLossCount(e.target.value)} disabled={isRunning} className="h-6 text-[10px]" />
                    </div>
                    <div>
                      <label className="text-[8px] text-muted-foreground">Real Trades</label>
                      <Input type="number" min="1" max="10" value={m1RealCount} onChange={e => setM1RealCount(e.target.value)} disabled={isRunning} className="h-6 text-[10px]" />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Market 2 */}
            <div className="bg-card border-2 border-purple-500/30 rounded-xl p-2.5 space-y-1.5">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-purple-400 flex items-center gap-1"><RefreshCw className="w-3.5 h-3.5" /> M2 — Recovery</h3>
                <div className="flex items-center gap-1.5">
                  {currentMarket === 2 && isRunning && <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />}
                  <Switch checked={m2Enabled} onCheckedChange={setM2Enabled} disabled={isRunning} />
                </div>
              </div>
              <Select value={m2Symbol} onValueChange={v => setM2Symbol(v)} disabled={isRunning}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{SCANNER_MARKETS.map(m => <SelectItem key={m.symbol} value={m.symbol}>{m.name} ({m.symbol})</SelectItem>)}</SelectContent>
              </Select>
              <Select value={m2Contract} onValueChange={v => setM2Contract(v)} disabled={isRunning}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{CONTRACT_TYPES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
              {needsBarrier(m2Contract) && (
                <Input type="number" min="0" max="9" value={m2Barrier} onChange={e => setM2Barrier(e.target.value)}
                  className="h-7 text-xs" placeholder="Barrier (0-9)" disabled={isRunning} />
              )}
              {/* Virtual Hook M2 */}
              <div className="border-t border-border/30 pt-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-semibold text-primary flex items-center gap-1">
                    <Anchor className="w-3 h-3" /> Virtual Hook
                  </span>
                  <Switch checked={m2HookEnabled} onCheckedChange={setM2HookEnabled} disabled={isRunning} />
                </div>
                {m2HookEnabled && (
                  <div className="grid grid-cols-2 gap-1.5 mt-1">
                    <div>
                      <label className="text-[8px] text-muted-foreground">V-Losses</label>
                      <Input type="number" min="1" max="20" value={m2VirtualLossCount} onChange={e => setM2VirtualLossCount(e.target.value)} disabled={isRunning} className="h-6 text-[10px]" />
                    </div>
                    <div>
                      <label className="text-[8px] text-muted-foreground">Real Trades</label>
                      <Input type="number" min="1" max="10" value={m2RealCount} onChange={e => setM2RealCount(e.target.value)} disabled={isRunning} className="h-6 text-[10px]" />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Virtual Hook Stats */}
          {(m1HookEnabled || m2HookEnabled) && (
            <div className="bg-card border border-primary/30 rounded-xl p-2.5">
              <h3 className="text-[10px] font-semibold text-primary flex items-center gap-1 mb-1">
                <Anchor className="w-3 h-3" /> Hook Status
              </h3>
              <div className="grid grid-cols-4 gap-1 text-center">
                <div className="bg-muted/50 rounded p-1">
                  <div className="text-[8px] text-muted-foreground">V-Win</div>
                  <div className="font-mono text-[10px] font-bold text-profit">{vhFakeWins}</div>
                </div>
                <div className="bg-muted/50 rounded p-1">
                  <div className="text-[8px] text-muted-foreground">V-Loss</div>
                  <div className="font-mono text-[10px] font-bold text-loss">{vhFakeLosses}</div>
                </div>
                <div className="bg-muted/50 rounded p-1">
                  <div className="text-[8px] text-muted-foreground">Streak</div>
                  <div className="font-mono text-[10px] font-bold text-warning">{vhConsecLosses}</div>
                </div>
                <div className="bg-muted/50 rounded p-1">
                  <div className="text-[8px] text-muted-foreground">State</div>
                  <div className={`text-[9px] font-bold ${
                    vhStatus === 'confirmed' ? 'text-profit' :
                    vhStatus === 'waiting' ? 'text-warning animate-pulse' :
                    vhStatus === 'failed' ? 'text-loss' : 'text-muted-foreground'
                  }`}>
                    {vhStatus === 'confirmed' ? '✓' : vhStatus === 'waiting' ? '⏳' : vhStatus === 'failed' ? '✗' : '—'}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Risk */}
          <div className="bg-card border border-border rounded-xl p-2.5 space-y-1.5">
            <h3 className="text-xs font-semibold text-foreground flex items-center gap-1"><Shield className="w-3.5 h-3.5" /> Risk</h3>
            <div className="grid grid-cols-3 gap-1.5">
              <div>
                <label className="text-[8px] text-muted-foreground">Stake ($)</label>
                <Input type="number" min="0.35" step="0.01" value={stake} onChange={e => setStake(e.target.value)} disabled={isRunning} className="h-7 text-xs" />
              </div>
              <div>
                <label className="text-[8px] text-muted-foreground">Take Profit</label>
                <Input type="number" value={takeProfit} onChange={e => setTakeProfit(e.target.value)} disabled={isRunning} className="h-7 text-xs" />
              </div>
              <div>
                <label className="text-[8px] text-muted-foreground">Stop Loss</label>
                <Input type="number" value={stopLoss} onChange={e => setStopLoss(e.target.value)} disabled={isRunning} className="h-7 text-xs" />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <label className="text-[10px] text-foreground">Martingale</label>
              <Switch checked={martingaleOn} onCheckedChange={setMartingaleOn} disabled={isRunning} />
            </div>
            {martingaleOn && (
              <div className="grid grid-cols-2 gap-1.5">
                <div>
                  <label className="text-[8px] text-muted-foreground">Multiplier</label>
                  <Input type="number" min="1.1" step="0.1" value={martingaleMultiplier} onChange={e => setMartingaleMultiplier(e.target.value)} disabled={isRunning} className="h-7 text-xs" />
                </div>
                <div>
                  <label className="text-[8px] text-muted-foreground">Max Steps</label>
                  <Input type="number" min="1" max="10" value={martingaleMaxSteps} onChange={e => setMartingaleMaxSteps(e.target.value)} disabled={isRunning} className="h-7 text-xs" />
                </div>
              </div>
            )}
            <div className="flex items-center gap-3 pt-0.5">
              <label className="flex items-center gap-1 text-[10px] text-foreground">
                <input type="checkbox" checked={strategyM1Enabled} onChange={e => setStrategyM1Enabled(e.target.checked)} disabled={isRunning} className="rounded w-3 h-3" />
                Strategy M1
              </label>
              <label className="flex items-center gap-1 text-[10px] text-foreground">
                <input type="checkbox" checked={strategyEnabled} onChange={e => setStrategyEnabled(e.target.checked)} disabled={isRunning} className="rounded w-3 h-3" />
                Strategy M2
              </label>
            </div>
          </div>

          {/* Strategy Card */}
          {(strategyEnabled || strategyM1Enabled) && (
            <div className="bg-card border border-warning/30 rounded-xl p-2.5 space-y-1.5">
              <h3 className="text-xs font-semibold text-warning flex items-center gap-1"><Zap className="w-3.5 h-3.5" /> Strategy</h3>

              {/* M1 Strategy */}
              {strategyM1Enabled && (
                <div className="border border-profit/20 rounded-lg p-1.5 space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-[9px] font-semibold text-profit">M1 Strategy</label>
                    <div className="flex gap-0.5">
                      <Button size="sm" variant={m1StrategyMode === 'pattern' ? 'default' : 'outline'}
                        className="text-[9px] h-5 px-1.5" onClick={() => setM1StrategyMode('pattern')} disabled={isRunning}>
                        Pattern
                      </Button>
                      <Button size="sm" variant={m1StrategyMode === 'digit' ? 'default' : 'outline'}
                        className="text-[9px] h-5 px-1.5" onClick={() => setM1StrategyMode('digit')} disabled={isRunning}>
                        Digit
                      </Button>
                    </div>
                  </div>
                  {m1StrategyMode === 'pattern' ? (
                    <>
                      <Textarea placeholder="E=Even O=Odd e.g. EEEOE" value={m1Pattern}
                        onChange={e => setM1Pattern(e.target.value.toUpperCase().replace(/[^EO]/g, ''))}
                        disabled={isRunning} className="h-10 text-[10px] font-mono min-h-0" />
                      <div className={`text-[9px] font-mono ${m1PatternValid ? 'text-profit' : 'text-loss'}`}>
                        {cleanM1Pattern.length === 0 ? 'Enter pattern...' :
                          m1PatternValid ? `✓ ${cleanM1Pattern}` : `✗ Need 2+`}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="grid grid-cols-3 gap-1 mt-0.5">
                        <label className="text-[8px] text-muted-foreground text-center">Condition</label>
                        <label className="text-[8px] text-muted-foreground text-center">Digit</label>
                        <label className="text-[8px] text-muted-foreground text-center">Ticks</label>
                      </div>
                      <div className="grid grid-cols-3 gap-1">
                        <Select value={m1DigitCondition} onValueChange={setM1DigitCondition} disabled={isRunning}>
                          <SelectTrigger className="h-6 text-[10px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {['==', '>', '<', '>=', '<='].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Input type="number" min="0" max="9" value={m1DigitCompare} onChange={e => setM1DigitCompare(e.target.value)} disabled={isRunning} className="h-6 text-[10px]" />
                        <Input type="number" min="1" max="50" value={m1DigitWindow} onChange={e => setM1DigitWindow(e.target.value)} disabled={isRunning} className="h-6 text-[10px]" />
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* M2 Strategy */}
              {strategyEnabled && (
                <div className="border border-destructive/20 rounded-lg p-1.5 space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-[9px] font-semibold text-destructive">M2 Strategy</label>
                    <div className="flex gap-0.5">
                      <Button size="sm" variant={m2StrategyMode === 'pattern' ? 'default' : 'outline'}
                        className="text-[9px] h-5 px-1.5" onClick={() => setM2StrategyMode('pattern')} disabled={isRunning}>
                        Pattern
                      </Button>
                      <Button size="sm" variant={m2StrategyMode === 'digit' ? 'default' : 'outline'}
                        className="text-[9px] h-5 px-1.5" onClick={() => setM2StrategyMode('digit')} disabled={isRunning}>
                        Digit
                      </Button>
                    </div>
                  </div>
                  {m2StrategyMode === 'pattern' ? (
                    <>
                      <Textarea placeholder="E=Even O=Odd e.g. OOEEO" value={m2Pattern}
                        onChange={e => setM2Pattern(e.target.value.toUpperCase().replace(/[^EO]/g, ''))}
                        disabled={isRunning} className="h-10 text-[10px] font-mono min-h-0" />
                      <div className={`text-[9px] font-mono ${m2PatternValid ? 'text-profit' : 'text-loss'}`}>
                        {cleanM2Pattern.length === 0 ? 'Enter pattern...' :
                          m2PatternValid ? `✓ ${cleanM2Pattern}` : `✗ Need 2+`}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="grid grid-cols-3 gap-1 mt-0.5">
                        <label className="text-[8px] text-muted-foreground text-center">Condition</label>
                        <label className="text-[8px] text-muted-foreground text-center">Digit</label>
                        <label className="text-[8px] text-muted-foreground text-center">Ticks</label>
                      </div>
                      <div className="grid grid-cols-3 gap-1">
                        <Select value={m2DigitCondition} onValueChange={setM2DigitCondition} disabled={isRunning}>
                          <SelectTrigger className="h-6 text-[10px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {['==', '>', '<', '>=', '<='].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Input type="number" min="0" max="9" value={m2DigitCompare} onChange={e => setM2DigitCompare(e.target.value)} disabled={isRunning} className="h-6 text-[10px]" />
                        <Input type="number" min="1" max="50" value={m2DigitWindow} onChange={e => setM2DigitWindow(e.target.value)} disabled={isRunning} className="h-6 text-[10px]" />
                      </div>
                    </>
                  )}
                </div>
              )}

              {botStatus === 'waiting_pattern' && (
                <div className="bg-warning/10 border border-warning/30 rounded p-1.5 text-[9px] text-warning animate-pulse text-center font-semibold">
                  ⏳ WAITING FOR PATTERN...
                </div>
              )}
              {botStatus === 'pattern_matched' && (
                <div className="bg-profit/10 border border-profit/30 rounded p-1.5 text-[9px] text-profit text-center font-semibold animate-pulse">
                  ✅ PATTERN MATCHED!
                </div>
              )}
            </div>
          )}

          {/* Save / Load Config */}
          <div className="bg-card border border-border rounded-xl p-2.5 space-y-1.5">
            <h3 className="text-xs font-semibold text-foreground flex items-center gap-1">💾 Bot Config</h3>
            <Input
              placeholder="Enter bot name before saving..."
              value={botName}
              onChange={e => setBotName(e.target.value)}
              disabled={isRunning}
              className="h-7 text-xs"
            />
            <div className="grid grid-cols-2 gap-1.5">
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-[10px] gap-1"
                disabled={isRunning || !botName.trim()}
                onClick={() => {
                  const safeName = botName.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
                  const config = {
                    version: 1,
                    botName: botName.trim(),
                    m1: { enabled: m1Enabled, symbol: m1Symbol, contract: m1Contract, barrier: m1Barrier, hookEnabled: m1HookEnabled, virtualLossCount: m1VirtualLossCount, realCount: m1RealCount },
                    m2: { enabled: m2Enabled, symbol: m2Symbol, contract: m2Contract, barrier: m2Barrier, hookEnabled: m2HookEnabled, virtualLossCount: m2VirtualLossCount, realCount: m2RealCount },
                    risk: { stake, martingaleOn, martingaleMultiplier, martingaleMaxSteps, takeProfit, stopLoss },
                    strategy: {
                      m1Enabled: strategyM1Enabled, m2Enabled: strategyEnabled,
                      m1Mode: m1StrategyMode, m2Mode: m2StrategyMode,
                      m1Pattern, m1DigitCondition, m1DigitCompare, m1DigitWindow,
                      m2Pattern, m2DigitCondition, m2DigitCompare, m2DigitWindow,
                    },
                    scanner: { active: scannerActive },
                    turbo: { enabled: turboMode },
                  };
                  const now = new Date();
                  const ts = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}-${String(now.getSeconds()).padStart(2,'0')}`;
                  const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url; a.download = `${safeName}_${ts}.json`; a.click();
                  URL.revokeObjectURL(url);
                  toast.success(`Config "${botName.trim()}" saved!`);
                }}
              >
                <Download className="w-3 h-3" /> Save Config
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-[10px] gap-1"
                disabled={isRunning}
                onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'file'; input.accept = '.json';
                  input.onchange = (ev: any) => {
                    const file = ev.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = (e) => {
                      try {
                        const cfg = JSON.parse(e.target?.result as string);
                        if (!cfg.version || !cfg.m1 || !cfg.m2 || !cfg.risk) {
                          toast.error('Invalid config file format'); return;
                        }
                        // M1
                        if (cfg.m1.enabled !== undefined) setM1Enabled(cfg.m1.enabled);
                        if (cfg.m1.symbol) setM1Symbol(cfg.m1.symbol);
                        if (cfg.m1.contract) setM1Contract(cfg.m1.contract);
                        if (cfg.m1.barrier) setM1Barrier(cfg.m1.barrier);
                        if (cfg.m1.hookEnabled !== undefined) setM1HookEnabled(cfg.m1.hookEnabled);
                        if (cfg.m1.virtualLossCount) setM1VirtualLossCount(cfg.m1.virtualLossCount);
                        if (cfg.m1.realCount) setM1RealCount(cfg.m1.realCount);
                        // M2
                        if (cfg.m2.enabled !== undefined) setM2Enabled(cfg.m2.enabled);
                        if (cfg.m2.symbol) setM2Symbol(cfg.m2.symbol);
                        if (cfg.m2.contract) setM2Contract(cfg.m2.contract);
                        if (cfg.m2.barrier) setM2Barrier(cfg.m2.barrier);
                        if (cfg.m2.hookEnabled !== undefined) setM2HookEnabled(cfg.m2.hookEnabled);
                        if (cfg.m2.virtualLossCount) setM2VirtualLossCount(cfg.m2.virtualLossCount);
                        if (cfg.m2.realCount) setM2RealCount(cfg.m2.realCount);
                        // Risk
                        if (cfg.risk.stake) setStake(cfg.risk.stake);
                        if (cfg.risk.martingaleOn !== undefined) setMartingaleOn(cfg.risk.martingaleOn);
                        if (cfg.risk.martingaleMultiplier) setMartingaleMultiplier(cfg.risk.martingaleMultiplier);
                        if (cfg.risk.martingaleMaxSteps) setMartingaleMaxSteps(cfg.risk.martingaleMaxSteps);
                        if (cfg.risk.takeProfit) setTakeProfit(cfg.risk.takeProfit);
                        if (cfg.risk.stopLoss) setStopLoss(cfg.risk.stopLoss);
                        // Strategy
                        if (cfg.strategy) {
                          if (cfg.strategy.m1Enabled !== undefined) setStrategyM1Enabled(cfg.strategy.m1Enabled);
                          if (cfg.strategy.m2Enabled !== undefined) setStrategyEnabled(cfg.strategy.m2Enabled);
                          if (cfg.strategy.m1Mode) setM1StrategyMode(cfg.strategy.m1Mode);
                          if (cfg.strategy.m2Mode) setM2StrategyMode(cfg.strategy.m2Mode);
                          if (cfg.strategy.m1Pattern !== undefined) setM1Pattern(cfg.strategy.m1Pattern);
                          if (cfg.strategy.m1DigitCondition) setM1DigitCondition(cfg.strategy.m1DigitCondition);
                          if (cfg.strategy.m1DigitCompare) setM1DigitCompare(cfg.strategy.m1DigitCompare);
                          if (cfg.strategy.m1DigitWindow) setM1DigitWindow(cfg.strategy.m1DigitWindow);
                          if (cfg.strategy.m2Pattern !== undefined) setM2Pattern(cfg.strategy.m2Pattern);
                          if (cfg.strategy.m2DigitCondition) setM2DigitCondition(cfg.strategy.m2DigitCondition);
                          if (cfg.strategy.m2DigitCompare) setM2DigitCompare(cfg.strategy.m2DigitCompare);
                          if (cfg.strategy.m2DigitWindow) setM2DigitWindow(cfg.strategy.m2DigitWindow);
                        }
                        // Scanner & Turbo
                        if (cfg.scanner?.active !== undefined) setScannerActive(cfg.scanner.active);
                        if (cfg.turbo?.enabled !== undefined) setTurboMode(cfg.turbo.enabled);
                        toast.success('Config loaded successfully!');
                      } catch {
                        toast.error('Failed to parse config file');
                      }
                    };
                    reader.readAsText(file);
                  };
                  input.click();
                }}
              >
                <Upload className="w-3 h-3" /> Load Config
              </Button>
            </div>
          </div>
        </div>

        {/* ═══ RIGHT: Digit Stream + Activity Log ═══ */}
        <div className="lg:col-span-8 space-y-2">
          {/* Digit Stream */}
          <div className="bg-card border border-border rounded-xl p-2.5">
            <div className="flex items-center justify-between mb-1.5">
              <h3 className="text-[10px] font-semibold text-foreground">Live Digits — {activeSymbol}</h3>
              <span className="text-[9px] text-muted-foreground font-mono">Win Rate: {winRate}% | Staked: ${totalStaked.toFixed(2)}</span>
            </div>
            <div className="flex gap-1 justify-center">
              {activeDigits.length === 0 ? (
                <span className="text-[10px] text-muted-foreground">Waiting for ticks...</span>
              ) : activeDigits.map((d, i) => {
                const isOver = d >= 5;
                const isEven = d % 2 === 0;
                const isLast = i === activeDigits.length - 1;
                return (
                  <div key={i} className={`w-8 h-10 rounded-lg flex flex-col items-center justify-center text-xs font-mono font-bold border ${
                    isLast ? 'ring-2 ring-primary' : ''
                  } ${isOver ? 'bg-loss/10 border-loss/30 text-loss' : 'bg-profit/10 border-profit/30 text-profit'}`}>
                    <span className="text-sm">{d}</span>
                    <span className="text-[7px] opacity-60">{isOver ? 'O' : 'U'}{isEven ? 'E' : 'O'}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Trade Summary Panel */}
          <div className="grid grid-cols-5 gap-1.5">
            <div className="bg-card border border-border rounded-lg p-2 text-center">
              <div className="text-[8px] text-muted-foreground">Trades</div>
              <div className="font-mono text-xs font-bold text-foreground">{wins + losses}</div>
            </div>
            <div className="bg-card border border-border rounded-lg p-2 text-center">
              <div className="text-[8px] text-muted-foreground">Wins</div>
              <div className="font-mono text-xs font-bold text-profit">{wins}</div>
            </div>
            <div className="bg-card border border-border rounded-lg p-2 text-center">
              <div className="text-[8px] text-muted-foreground">Losses</div>
              <div className="font-mono text-xs font-bold text-loss">{losses}</div>
            </div>
            <div className="bg-card border border-border rounded-lg p-2 text-center">
              <div className="text-[8px] text-muted-foreground">Profit/Loss</div>
              <div className={`font-mono text-xs font-bold ${netProfit >= 0 ? 'text-profit' : 'text-loss'}`}>
                {netProfit >= 0 ? '+' : ''}{netProfit.toFixed(2)}
              </div>
            </div>
            <div className="bg-card border border-border rounded-lg p-2 text-center">
              <div className="text-[8px] text-muted-foreground">Total Staked</div>
              <div className="font-mono text-xs font-bold text-primary">${totalStaked.toFixed(2)}</div>
            </div>
          </div>

          {/* Start / Stop Buttons */}
          <div className="grid grid-cols-2 gap-2">
            <Button
              onClick={startBot}
              disabled={isRunning || !isAuthorized || balance < parseFloat(stake)}
              className="h-14 text-base font-bold bg-profit hover:bg-profit/90 text-profit-foreground rounded-xl"
            >
              <Play className="w-5 h-5 mr-2" /> START M1
            </Button>
            <Button
              onClick={stopBot}
              disabled={!isRunning}
              variant="destructive"
              className="h-14 text-base font-bold rounded-xl"
            >
              <StopCircle className="w-5 h-5 mr-2" /> STOP
            </Button>
          </div>

          {/* Activity Log */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-2.5 py-2 border-b border-border flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold text-foreground">Activity Log</h3>
              <div className="flex items-center gap-1.5">
                {logEntries.length > 0 && logEntries[0].switchInfo && (
                  <span className="text-[9px] text-muted-foreground font-mono hidden md:inline truncate max-w-[200px]">
                    {logEntries[0].switchInfo}
                  </span>
                )}
                {!isRunning ? (
                  <Button onClick={startBot} disabled={!isAuthorized || balance < parseFloat(stake)}
                    size="sm" className="h-7 text-[10px] font-bold bg-profit hover:bg-profit/90 text-profit-foreground px-3">
                    <Play className="w-3 h-3 mr-1" /> START
                  </Button>
                ) : (
                  <Button onClick={stopBot} variant="destructive" size="sm" className="h-7 text-[10px] font-bold px-3">
                    <StopCircle className="w-3 h-3 mr-1" /> STOP
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={clearLog} className="h-7 w-7 p-0 text-muted-foreground hover:text-loss">
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            </div>
            <div className="max-h-[calc(100vh-380px)] min-h-[300px] overflow-auto">
              <table className="w-full text-[10px]">
                <thead className="text-[9px] text-muted-foreground bg-muted/30 sticky top-0">
                  <tr>
                    <th className="text-left p-1.5">Time</th>
                    <th className="text-left p-1">Mkt</th>
                    <th className="text-left p-1">Symbol</th>
                    <th className="text-left p-1">Type</th>
                    <th className="text-right p-1">Stake</th>
                    <th className="text-center p-1">Digit</th>
                    <th className="text-center p-1">Result</th>
                    <th className="text-right p-1">P/L</th>
                    <th className="text-right p-1">Bal</th>
                    <th className="text-center p-1">⏹</th>
                  </tr>
                </thead>
                <tbody>
                  {logEntries.length === 0 ? (
                    <tr><td colSpan={10} className="text-center text-muted-foreground py-8">No trades yet — configure and start the bot</td></tr>
                  ) : logEntries.map(e => (
                    <tr key={e.id} className={`border-t border-border/30 hover:bg-muted/20 ${
                      e.market === 'M1' ? 'border-l-2 border-l-profit' :
                      e.market === 'VH' ? 'border-l-2 border-l-primary' :
                      'border-l-2 border-l-purple-500'
                    }`}>
                      <td className="p-1 font-mono text-[9px]">{e.time}</td>
                      <td className={`p-1 font-bold ${
                        e.market === 'M1' ? 'text-profit' :
                        e.market === 'VH' ? 'text-primary' :
                        'text-purple-400'
                      }`}>{e.market}</td>
                      <td className="p-1 font-mono text-[9px]">{e.symbol}</td>
                      <td className="p-1 text-[9px]">{e.contract.replace('DIGIT', '')}</td>
                      <td className="p-1 font-mono text-right text-[9px]">
                        {e.market === 'VH' ? 'FAKE' : `$${e.stake.toFixed(2)}`}
                        {e.martingaleStep > 0 && e.market !== 'VH' && <span className="text-warning ml-0.5">M{e.martingaleStep}</span>}
                      </td>
                      <td className="p-1 text-center font-mono">{e.exitDigit}</td>
                      <td className="p-1 text-center">
                        <span className={`px-1 py-0.5 rounded-full text-[8px] font-bold ${
                          e.result === 'Win' || e.result === 'V-Win' ? 'bg-profit/20 text-profit' :
                          e.result === 'Loss' || e.result === 'V-Loss' ? 'bg-loss/20 text-loss' :
                          'bg-warning/20 text-warning animate-pulse'
                        }`}>{e.result === 'Pending' ? '...' : e.result}</span>
                      </td>
                      <td className={`p-1 font-mono text-right text-[9px] ${e.pnl > 0 ? 'text-profit' : e.pnl < 0 ? 'text-loss' : ''}`}>
                        {e.result === 'Pending' ? '...' : e.market === 'VH' ? '-' : `${e.pnl > 0 ? '+' : ''}${e.pnl.toFixed(2)}`}
                      </td>
                      <td className="p-1 font-mono text-right text-[9px]">{e.market === 'VH' ? '-' : `$${e.balance.toFixed(2)}`}</td>
                      <td className="p-1 text-center">
                        {isRunning && (
                          <button onClick={stopBot} className="px-1 py-0.5 rounded bg-destructive/80 hover:bg-destructive text-destructive-foreground text-[8px] font-bold transition-colors" title="Stop Bot">
                            ■
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
