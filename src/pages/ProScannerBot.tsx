import { useState, useRef, useCallback, useEffect } from 'react';
import { derivApi, type MarketSymbol } from '@/services/deriv-api';
import { getLastDigit } from '@/services/analysis';
import { useAuth } from '@/contexts/AuthContext';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import {
  Play, StopCircle, Loader2, Trash2, Scan,
  Home, RefreshCw, Shield, Zap, Eye,
} from 'lucide-react';

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

type BotStatus = 'idle' | 'trading_m1' | 'recovery' | 'waiting_pattern' | 'pattern_matched';

interface LogEntry {
  id: number;
  time: string;
  market: 'M1' | 'M2';
  symbol: string;
  contract: string;
  stake: number;
  martingaleStep: number;
  exitDigit: string;
  result: 'Win' | 'Loss' | 'Pending';
  pnl: number;
  balance: number;
  switchInfo: string;
}

function waitForNextTick(symbol: string): Promise<{ quote: number }> {
  return new Promise((resolve) => {
    const unsub = derivApi.onMessage((data: any) => {
      if (data.tick && data.tick.symbol === symbol) { unsub(); resolve({ quote: data.tick.quote }); }
    });
  });
}

export default function ProScannerBot() {
  const { isAuthorized, balance } = useAuth();

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

  /* ── Risk ── */
  const [stake, setStake] = useState('0.35');
  const [martingaleOn, setMartingaleOn] = useState(false);
  const [martingaleMultiplier, setMartingaleMultiplier] = useState('2.0');
  const [martingaleMaxSteps, setMartingaleMaxSteps] = useState('5');
  const [takeProfit, setTakeProfit] = useState('10');
  const [stopLoss, setStopLoss] = useState('5');

  /* ── Strategy ── */
  const [strategyEnabled, setStrategyEnabled] = useState(false);
  const [strategyMode, setStrategyMode] = useState<'pattern' | 'digit'>('pattern');
  const [pattern, setPattern] = useState('');
  const [patternAction, setPatternAction] = useState<'tradeOnce' | 'tradeUntilWin'>('tradeUntilWin');
  const [digitCondition, setDigitCondition] = useState('==');
  const [digitCompare, setDigitCompare] = useState('5');
  const [digitWindow, setDigitWindow] = useState('3');

  /* ── Scanner ── */
  const [scannerActive, setScannerActive] = useState(false);

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

  /* ── Tick data ── */
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
      const map = tickMapRef.current;
      const arr = map.get(sym) || [];
      arr.push(digit);
      if (arr.length > 200) arr.shift();
      map.set(sym, arr);
      setTickCounts(prev => ({ ...prev, [sym]: arr.length }));
    };
    const unsub = derivApi.onMessage(handler);
    SCANNER_MARKETS.forEach(m => { derivApi.subscribeTicks(m.symbol as MarketSymbol, () => {}).catch(() => {}); });
    return () => { active = false; unsub(); };
  }, []);

  /* ── Pattern validation ── */
  const cleanPattern = pattern.toUpperCase().replace(/[^EO]/g, '');
  const patternValid = cleanPattern.length >= 2;

  /* ── Check pattern match for a symbol ── */
  const checkPatternMatch = useCallback((symbol: string): boolean => {
    const digits = tickMapRef.current.get(symbol) || [];
    if (digits.length < cleanPattern.length) return false;
    const recent = digits.slice(-cleanPattern.length);
    for (let i = 0; i < cleanPattern.length; i++) {
      const expected = cleanPattern[i];
      const actual = recent[i] % 2 === 0 ? 'E' : 'O';
      if (expected !== actual) return false;
    }
    return true;
  }, [cleanPattern]);

  /* ── Check digit condition for a symbol ── */
  const checkDigitCondition = useCallback((symbol: string): boolean => {
    const digits = tickMapRef.current.get(symbol) || [];
    const win = parseInt(digitWindow) || 3;
    const compare = parseInt(digitCompare);
    if (digits.length < win) return false;
    const recent = digits.slice(-win);
    return recent.every(d => {
      switch (digitCondition) {
        case '>': return d > compare;
        case '<': return d < compare;
        case '>=': return d >= compare;
        case '<=': return d <= compare;
        case '==': return d === compare;
        default: return false;
      }
    });
  }, [digitCondition, digitCompare, digitWindow]);

  /* ── Check strategy condition ── */
  const checkCondition = useCallback((symbol: string): boolean => {
    if (!strategyEnabled) return true;
    if (strategyMode === 'pattern') return checkPatternMatch(symbol);
    return checkDigitCondition(symbol);
  }, [strategyEnabled, strategyMode, checkPatternMatch, checkDigitCondition]);

  /* ── Find scanner match across all markets ── */
  const findScannerMatch = useCallback((): string | null => {
    for (const m of SCANNER_MARKETS) {
      if (checkCondition(m.symbol)) return m.symbol;
    }
    return null;
  }, [checkCondition]);

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
  }, []);

  /* ═══════════════ MAIN BOT LOOP ═══════════════ */
  const startBot = useCallback(async () => {
    if (!isAuthorized || isRunning) return;
    const baseStake = parseFloat(stake);
    if (baseStake < 0.35) { toast.error('Min stake $0.35'); return; }
    if (!m1Enabled && !m2Enabled) { toast.error('Enable at least one market'); return; }
    if (strategyEnabled && strategyMode === 'pattern' && !patternValid) { toast.error('Invalid pattern (min 2 E/O)'); return; }

    setIsRunning(true);
    runningRef.current = true;
    setCurrentMarket(1);
    setBotStatus('trading_m1');
    setCurrentStakeState(baseStake);
    setMartingaleStepState(0);

    let cStake = baseStake;
    let mStep = 0;
    let inRecovery = false;
    let patternMatched = false;
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

      /* Strategy gating for M2 */
      if (inRecovery && strategyEnabled) {
        setBotStatus('waiting_pattern');
        patternMatched = false;

        // Wait for condition
        let matched = false;
        let matchedSymbol = '';
        while (runningRef.current && !matched) {
          if (scannerActive) {
            const found = findScannerMatch();
            if (found) { matched = true; matchedSymbol = found; }
          } else {
            if (checkCondition(cfg.symbol)) { matched = true; matchedSymbol = cfg.symbol; }
          }
          if (!matched) await new Promise(r => setTimeout(r, 500));
        }
        if (!runningRef.current) break;

        setBotStatus('pattern_matched');
        patternMatched = true;
        tradeSymbol = matchedSymbol;
        await new Promise(r => setTimeout(r, 300)); // brief flash
      } else {
        setBotStatus(mkt === 1 ? 'trading_m1' : 'recovery');
        tradeSymbol = cfg.symbol;
      }

      /* Execute trade */
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

      try {
        await waitForNextTick(tradeSymbol as MarketSymbol);

        const buyParams: any = {
          contract_type: cfg.contract, symbol: tradeSymbol,
          duration: ['DIGITEVEN','DIGITODD','DIGITMATCH','DIGITDIFF','DIGITOVER','DIGITUNDER'].includes(cfg.contract) ? 1 : 5,
          duration_unit: 't', basis: 'stake', amount: cStake,
        };
        if (needsBarrier(cfg.contract)) buyParams.barrier = cfg.barrier;

        const { contractId, buyPrice } = await derivApi.buyContract(buyParams);
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
            patternMatched = false;
          } else {
            switchInfo = '→ Continue M1';
          }
          mStep = 0;
          cStake = baseStake;
        } else {
          setLosses(prev => prev + 1);
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
          if (patternAction === 'tradeOnce' && inRecovery && strategyEnabled) {
            patternMatched = false;
          }
        }

        setNetProfit(prev => prev + pnl);
        setMartingaleStepState(mStep);
        setCurrentStakeState(cStake);

        updateLog(logId, { exitDigit, result: won ? 'Win' : 'Loss', pnl, balance: localBalance, switchInfo });

        /* TP/SL */
        if (localPnl >= parseFloat(takeProfit)) {
          toast.success(`🎯 Take Profit! +$${localPnl.toFixed(2)}`);
          break;
        }
        if (localPnl <= -parseFloat(stopLoss)) {
          toast.error(`🛑 Stop Loss! $${localPnl.toFixed(2)}`);
          break;
        }
        if (localBalance < cStake) {
          toast.error('Insufficient balance');
          break;
        }

        await new Promise(r => setTimeout(r, 400));
      } catch (err: any) {
        updateLog(logId, { result: 'Loss', pnl: 0, exitDigit: '-', switchInfo: `Error: ${err.message}` });
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    setIsRunning(false);
    runningRef.current = false;
    setBotStatus('idle');
  }, [isAuthorized, isRunning, balance, stake, m1Enabled, m2Enabled, m1Contract, m2Contract,
    m1Barrier, m2Barrier, m1Symbol, m2Symbol, martingaleOn, martingaleMultiplier, martingaleMaxSteps,
    takeProfit, stopLoss, strategyEnabled, strategyMode, patternValid, patternAction,
    scannerActive, findScannerMatch, checkCondition, addLog, updateLog]);

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
  };

  const status = statusConfig[botStatus];
  const winRate = wins + losses > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : '0.0';

  /* ── Last 8 digits for live display ── */
  const activeSymbol = currentMarket === 1 ? m1Symbol : m2Symbol;
  const activeDigits = (tickMapRef.current.get(activeSymbol) || []).slice(-8);

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Scan className="w-5 h-5 text-primary" /> Pro Scanner Bot
          </h1>
          <p className="text-xs text-muted-foreground">Multi-market scanner • Dual-market recovery • Pattern strategy</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge className={`${status.color} text-xs`}>{status.icon} {status.label}</Badge>
          {isRunning && (
            <Badge variant="outline" className="text-xs text-warning animate-pulse font-mono">
              P/L: ${netProfit.toFixed(2)}
            </Badge>
          )}
        </div>
      </div>

      {/* Scanner Toggle */}
      <div className="bg-card border border-border rounded-xl p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Eye className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">Multi-Market Scanner</span>
            <Badge variant={scannerActive ? 'default' : 'secondary'} className="text-[10px]">
              {scannerActive ? '🟢 SCANNING ACTIVE' : '⚫ SCANNING OFF'}
            </Badge>
          </div>
          <Switch checked={scannerActive} onCheckedChange={setScannerActive} disabled={isRunning} />
        </div>
        <div className="flex flex-wrap gap-1">
          {SCANNER_MARKETS.map(m => {
            const count = tickCounts[m.symbol] || 0;
            return (
              <Badge key={m.symbol} variant="outline"
                className={`text-[9px] font-mono ${count > 0 ? 'border-primary/50 text-primary' : 'text-muted-foreground'}`}>
                {m.name} {count > 0 && <span className="ml-1 opacity-60">{count}</span>}
              </Badge>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* ═══ LEFT: Markets + Risk + Strategy ═══ */}
        <div className="lg:col-span-4 space-y-3">
          {/* Market 1 */}
          <div className="bg-card border-2 border-profit/30 rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-profit flex items-center gap-1"><Home className="w-4 h-4" /> 🏠 Market 1 — Home</h3>
              <Switch checked={m1Enabled} onCheckedChange={setM1Enabled} disabled={isRunning} />
            </div>
            {currentMarket === 1 && isRunning && <Badge className="bg-profit text-profit-foreground text-[10px]">ACTIVE</Badge>}
            <Select value={m1Symbol} onValueChange={v => setM1Symbol(v)} disabled={isRunning}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{SCANNER_MARKETS.map(m => <SelectItem key={m.symbol} value={m.symbol}>{m.name} ({m.symbol})</SelectItem>)}</SelectContent>
            </Select>
            <Select value={m1Contract} onValueChange={v => setM1Contract(v)} disabled={isRunning}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{CONTRACT_TYPES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
            {needsBarrier(m1Contract) && (
              <Input type="number" min="0" max="9" value={m1Barrier} onChange={e => setM1Barrier(e.target.value)}
                className="h-8 text-xs" placeholder="Barrier (0-9)" disabled={isRunning} />
            )}
          </div>

          {/* Market 2 */}
          <div className="bg-card border-2 border-purple-500/30 rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-purple-400 flex items-center gap-1"><RefreshCw className="w-4 h-4" /> 🔄 Market 2 — Recovery</h3>
              <Switch checked={m2Enabled} onCheckedChange={setM2Enabled} disabled={isRunning} />
            </div>
            {currentMarket === 2 && isRunning && <Badge className="bg-destructive text-destructive-foreground text-[10px]">RECOVERY MODE ACTIVE</Badge>}
            <Select value={m2Symbol} onValueChange={v => setM2Symbol(v)} disabled={isRunning}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{SCANNER_MARKETS.map(m => <SelectItem key={m.symbol} value={m.symbol}>{m.name} ({m.symbol})</SelectItem>)}</SelectContent>
            </Select>
            <Select value={m2Contract} onValueChange={v => setM2Contract(v)} disabled={isRunning}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{CONTRACT_TYPES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
            {needsBarrier(m2Contract) && (
              <Input type="number" min="0" max="9" value={m2Barrier} onChange={e => setM2Barrier(e.target.value)}
                className="h-8 text-xs" placeholder="Barrier (0-9)" disabled={isRunning} />
            )}
            <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-2 text-[10px] text-purple-300">
              After a loss on M1, bot switches here until a win occurs, then auto-returns to M1.
            </div>
          </div>

          {/* Risk */}
          <div className="bg-card border border-border rounded-xl p-3 space-y-2">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-1"><Shield className="w-4 h-4" /> Risk Management</h3>
            <div>
              <label className="text-[10px] text-muted-foreground">Stake ($)</label>
              <Input type="number" min="0.35" step="0.01" value={stake} onChange={e => setStake(e.target.value)} disabled={isRunning} className="h-8 text-xs" />
            </div>
            <div className="flex items-center justify-between">
              <label className="text-xs">Martingale</label>
              <Switch checked={martingaleOn} onCheckedChange={setMartingaleOn} disabled={isRunning} />
            </div>
            {martingaleOn && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-muted-foreground">Multiplier</label>
                  <Input type="number" min="1.1" step="0.1" value={martingaleMultiplier} onChange={e => setMartingaleMultiplier(e.target.value)} disabled={isRunning} className="h-8 text-xs" />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">Max Steps</label>
                  <Input type="number" min="1" max="10" value={martingaleMaxSteps} onChange={e => setMartingaleMaxSteps(e.target.value)} disabled={isRunning} className="h-8 text-xs" />
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-muted-foreground">Take Profit ($)</label>
                <Input type="number" value={takeProfit} onChange={e => setTakeProfit(e.target.value)} disabled={isRunning} className="h-8 text-xs" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">Stop Loss ($)</label>
                <Input type="number" value={stopLoss} onChange={e => setStopLoss(e.target.value)} disabled={isRunning} className="h-8 text-xs" />
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <input type="checkbox" id="enableStrategy" checked={strategyEnabled} onChange={e => setStrategyEnabled(e.target.checked)} disabled={isRunning} className="rounded" />
              <label htmlFor="enableStrategy" className="text-xs text-foreground">Enable Strategy (M2 only)</label>
            </div>
          </div>

          {/* Strategy Card */}
          {strategyEnabled && (
            <div className="bg-card border border-warning/30 rounded-xl p-3 space-y-2">
              <h3 className="text-sm font-semibold text-warning flex items-center gap-1"><Zap className="w-4 h-4" /> Pattern Strategy</h3>
              <div className="flex gap-1">
                <Button size="sm" variant={strategyMode === 'pattern' ? 'default' : 'outline'}
                  className="text-[10px] h-7 flex-1" onClick={() => setStrategyMode('pattern')} disabled={isRunning}>
                  Even/Odd Pattern
                </Button>
                <Button size="sm" variant={strategyMode === 'digit' ? 'default' : 'outline'}
                  className="text-[10px] h-7 flex-1" onClick={() => setStrategyMode('digit')} disabled={isRunning}>
                  Digit Analysis
                </Button>
              </div>

              {strategyMode === 'pattern' ? (
                <div className="space-y-2">
                  <Textarea placeholder="E=Even O=Odd e.g. EEEOE" value={pattern}
                    onChange={e => setPattern(e.target.value.toUpperCase().replace(/[^EO]/g, ''))}
                    disabled={isRunning} className="h-16 text-xs font-mono" />
                  <div className={`text-[10px] font-mono ${patternValid ? 'text-profit' : 'text-loss'}`}>
                    {cleanPattern.length === 0 ? 'Enter pattern...' :
                      patternValid ? `✓ ${cleanPattern} (${cleanPattern.length} chars)` :
                        `✗ Too short (need 2+)`}
                  </div>
                  <div className="space-y-1">
                    <label className="flex items-center gap-2 text-[10px] text-muted-foreground cursor-pointer">
                      <input type="radio" name="pAction" checked={patternAction === 'tradeOnce'} onChange={() => setPatternAction('tradeOnce')} disabled={isRunning} />
                      Trade Once per match
                    </label>
                    <label className="flex items-center gap-2 text-[10px] text-muted-foreground cursor-pointer">
                      <input type="radio" name="pAction" checked={patternAction === 'tradeUntilWin'} onChange={() => setPatternAction('tradeUntilWin')} disabled={isRunning} />
                      Trade Until Win
                    </label>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="text-[10px] text-muted-foreground">Condition</label>
                      <Select value={digitCondition} onValueChange={setDigitCondition} disabled={isRunning}>
                        <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {['==', '>', '<', '>=', '<='].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground">Value</label>
                      <Input type="number" min="0" max="9" value={digitCompare} onChange={e => setDigitCompare(e.target.value)} disabled={isRunning} className="h-7 text-xs" />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground">Window</label>
                      <Input type="number" min="1" max="50" value={digitWindow} onChange={e => setDigitWindow(e.target.value)} disabled={isRunning} className="h-7 text-xs" />
                    </div>
                  </div>
                </div>
              )}

              {botStatus === 'waiting_pattern' && (
                <div className="bg-warning/10 border border-warning/30 rounded-lg p-2 text-[10px] text-warning animate-pulse text-center font-semibold">
                  ⏳ WAITING FOR PATTERN...
                </div>
              )}
              {botStatus === 'pattern_matched' && (
                <div className="bg-profit/10 border border-profit/30 rounded-lg p-2 text-[10px] text-profit text-center font-semibold animate-pulse">
                  ✅ PATTERN MATCHED!
                </div>
              )}
            </div>
          )}

          {/* Control */}
          <div className="flex gap-2">
            {!isRunning ? (
              <Button onClick={startBot} disabled={!isAuthorized || balance < parseFloat(stake)}
                className="flex-1 h-11 font-bold bg-profit hover:bg-profit/90 text-profit-foreground">
                <Play className="w-4 h-4 mr-2" /> START BOT
              </Button>
            ) : (
              <Button onClick={stopBot} variant="destructive" className="flex-1 h-11 font-bold">
                <StopCircle className="w-4 h-4 mr-2" /> STOP BOT
              </Button>
            )}
          </div>

          {/* Market indicator */}
          {isRunning && (
            <div className={`text-center text-xs font-semibold py-1.5 rounded-lg ${
              currentMarket === 1 ? 'bg-profit/10 text-profit' : 'bg-purple-500/10 text-purple-400'
            }`}>
              {currentMarket === 1 ? '🏠 M1: HOME' : '🔄 M2: RECOVERY'}
            </div>
          )}
        </div>

        {/* ═══ CENTER: Stats + Digit Stream ═══ */}
        <div className="lg:col-span-4 space-y-3">
          {/* Stats Grid */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'Wins', value: wins, color: 'text-profit' },
              { label: 'Losses', value: losses, color: 'text-loss' },
              { label: 'Total Staked', value: `$${totalStaked.toFixed(2)}`, color: 'text-primary' },
              { label: 'Net Profit', value: `$${netProfit.toFixed(2)}`, color: netProfit >= 0 ? 'text-profit' : 'text-loss' },
              { label: 'Current Stake', value: `$${currentStake.toFixed(2)}${martingaleStep > 0 ? ` M${martingaleStep}` : ''}`, color: 'text-foreground' },
              { label: 'Win Rate', value: `${winRate}%`, color: 'text-primary' },
            ].map(s => (
              <div key={s.label} className="bg-card border border-border rounded-xl p-2.5 text-center">
                <div className="text-[9px] text-muted-foreground uppercase">{s.label}</div>
                <div className={`font-mono text-sm font-bold ${s.color}`}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Live Digit Stream */}
          <div className="bg-card border border-border rounded-xl p-3">
            <h3 className="text-xs font-semibold text-foreground mb-2">Live Digit Stream — {activeSymbol}</h3>
            <div className="flex gap-1 justify-center">
              {activeDigits.length === 0 ? (
                <span className="text-[10px] text-muted-foreground">Waiting for ticks...</span>
              ) : activeDigits.map((d, i) => {
                const isOver = d >= 5;
                const isEven = d % 2 === 0;
                const isLast = i === activeDigits.length - 1;
                return (
                  <div key={i} className={`w-9 h-12 rounded-lg flex flex-col items-center justify-center text-xs font-mono font-bold border ${
                    isLast ? 'ring-2 ring-primary' : ''
                  } ${isOver ? 'bg-loss/10 border-loss/30 text-loss' : 'bg-profit/10 border-profit/30 text-profit'}`}>
                    <span className="text-sm">{d}</span>
                    <span className="text-[8px] opacity-60">{isOver ? 'O' : 'U'}{isEven ? 'E' : 'O'}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Balance */}
          <div className="bg-card border border-border rounded-xl p-3 text-center">
            <div className="text-[10px] text-muted-foreground">Live Balance</div>
            <div className="font-mono text-lg font-bold text-foreground">${balance.toFixed(2)}</div>
          </div>
        </div>

        {/* ═══ RIGHT: Activity Log ═══ */}
        <div className="lg:col-span-4 space-y-3">
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="p-2.5 border-b border-border flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">Activity Log</h3>
              <Button variant="ghost" size="sm" onClick={clearLog} className="h-7 text-[10px] text-muted-foreground hover:text-loss">
                <Trash2 className="w-3 h-3 mr-1" /> Clear
              </Button>
            </div>
            <div className="max-h-[500px] overflow-auto">
              <table className="w-full text-[10px]">
                <thead className="text-[9px] text-muted-foreground bg-muted/30 sticky top-0">
                  <tr>
                    <th className="text-left p-1.5">Time</th>
                    <th className="text-left p-1.5">Mkt</th>
                    <th className="text-left p-1.5">Symbol</th>
                    <th className="text-left p-1.5">Type</th>
                    <th className="text-right p-1.5">Stake</th>
                    <th className="text-center p-1.5">Digit</th>
                    <th className="text-center p-1.5">Result</th>
                    <th className="text-right p-1.5">P/L</th>
                    <th className="text-right p-1.5">Bal</th>
                    <th className="text-center p-1.5">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {logEntries.length === 0 ? (
                    <tr><td colSpan={10} className="text-center text-muted-foreground py-6">No trades yet</td></tr>
                  ) : logEntries.map(e => (
                    <tr key={e.id} className={`border-t border-border/30 hover:bg-muted/20 ${
                      e.market === 'M1' ? 'border-l-2 border-l-profit' : 'border-l-2 border-l-purple-500'
                    }`}>
                      <td className="p-1.5 font-mono">{e.time}</td>
                      <td className={`p-1.5 font-bold ${e.market === 'M1' ? 'text-profit' : 'text-purple-400'}`}>{e.market}</td>
                      <td className="p-1.5 font-mono">{e.symbol}</td>
                      <td className="p-1.5">{e.contract.replace('DIGIT', '')}</td>
                      <td className="p-1.5 font-mono text-right">
                        ${e.stake.toFixed(2)}
                        {e.martingaleStep > 0 && <span className="text-warning ml-0.5">M{e.martingaleStep}</span>}
                      </td>
                      <td className="p-1.5 text-center font-mono">{e.exitDigit}</td>
                      <td className="p-1.5 text-center">
                        <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold ${
                          e.result === 'Win' ? 'bg-profit/20 text-profit' :
                          e.result === 'Loss' ? 'bg-loss/20 text-loss' :
                          'bg-warning/20 text-warning animate-pulse'
                        }`}>{e.result === 'Pending' ? '...' : e.result}</span>
                      </td>
                      <td className={`p-1.5 font-mono text-right ${e.pnl > 0 ? 'text-profit' : e.pnl < 0 ? 'text-loss' : ''}`}>
                        {e.result === 'Pending' ? '...' : `${e.pnl > 0 ? '+' : ''}${e.pnl.toFixed(2)}`}
                      </td>
                      <td className="p-1.5 font-mono text-right">${e.balance.toFixed(2)}</td>
                      <td className="p-1.5 text-center">
                        {isRunning && (
                          <button onClick={stopBot} className="px-1.5 py-0.5 rounded bg-destructive/80 hover:bg-destructive text-destructive-foreground text-[9px] font-bold transition-colors" title="Stop Bot">
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
          {logEntries.length > 0 && logEntries[0].switchInfo && (
            <div className="text-[10px] text-muted-foreground bg-card border border-border rounded-lg p-2 font-mono">
              Last: {logEntries[0].switchInfo}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
