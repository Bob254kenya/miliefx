import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { derivApi, MARKETS, MARKET_GROUPS } from '@/services/deriv-api';
import { getLastDigit } from '@/services/analysis';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Play, StopCircle, Trash2, Loader2 } from 'lucide-react';

type ContractType = 'DIGITEVEN' | 'DIGITODD' | 'DIGITMATCH' | 'DIGITDIFF' | 'DIGITOVER' | 'DIGITUNDER';
type PatternType = 'even_odd' | 'last_digit';
type PatternAction = 'trade_once' | 'trade_until_win';
type DigitCondition = '>' | '<' | '=' | '>=' | '<=';

interface TradeEntry {
  id: number;
  time: string;
  market: string;
  contractType: string;
  stake: number;
  exitDigit: number | null;
  result: 'Win' | 'Loss' | 'Pending';
  pnl: number;
  balance: number;
}

function waitForNextTick(symbol: string): Promise<{ quote: number; epoch: number }> {
  return new Promise((resolve) => {
    const unsub = derivApi.onMessage((data: any) => {
      if (data.tick && data.tick.symbol === symbol) {
        unsub();
        resolve({ quote: data.tick.quote, epoch: data.tick.epoch });
      }
    });
  });
}

function extractDigit(price: number): number {
  const fixed = parseFloat(String(price)).toFixed(2);
  const d = parseInt(fixed.slice(-1), 10);
  return (Number.isNaN(d) || d < 0 || d > 9) ? 0 : d;
}

export default function AdvancedRamzBot() {
  const { isAuthorized, balance, activeAccount } = useAuth();

  // Connection / symbol
  const [symbol, setSymbol] = useState('R_100');

  // Market 1 (Home)
  const [m1Contract, setM1Contract] = useState<ContractType>('DIGITEVEN');
  const [m1Barrier, setM1Barrier] = useState(5);
  const [m1Active, setM1Active] = useState(true);

  // Market 2 (Recovery)
  const [m2Contract, setM2Contract] = useState<ContractType>('DIGITOVER');
  const [m2Barrier, setM2Barrier] = useState(4);
  const [m2Active, setM2Active] = useState(true);

  // Pattern Strategy (M2 only)
  const [patternEnabled, setPatternEnabled] = useState(false);
  const [patternType, setPatternType] = useState<PatternType>('even_odd');
  const [patternText, setPatternText] = useState('EEEOE');
  const [patternAction, setPatternAction] = useState<PatternAction>('trade_once');
  const [digitCondition, setDigitCondition] = useState<DigitCondition>('>');
  const [digitCompareValue, setDigitCompareValue] = useState(5);
  const [digitAnalysisWindow, setDigitAnalysisWindow] = useState(20);

  // Risk Management
  const [initialStake, setInitialStake] = useState(1);
  const [martingaleEnabled, setMartingaleEnabled] = useState(false);
  const [martingaleMultiplier, setMartingaleMultiplier] = useState(2);
  const [martingaleMaxSteps, setMartingaleMaxSteps] = useState(5);
  const [takeProfit, setTakeProfit] = useState(20);
  const [stopLoss, setStopLoss] = useState(10);

  // Bot state
  const [isRunning, setIsRunning] = useState(false);
  const runningRef = useRef(false);
  const [currentMarket, setCurrentMarket] = useState<1 | 2>(1);
  const [botStatus, setBotStatus] = useState('Idle');

  // Stats
  const [wins, setWins] = useState(0);
  const [losses, setLosses] = useState(0);
  const [totalStaked, setTotalStaked] = useState(0);
  const [netProfit, setNetProfit] = useState(0);
  const [currentStake, setCurrentStake] = useState(1);
  const [winRate, setWinRate] = useState(0);

  // Live digits
  const [liveDigits, setLiveDigits] = useState<number[]>([]);
  const liveDigitsRef = useRef<number[]>([]);

  // Trade log
  const [trades, setTrades] = useState<TradeEntry[]>([]);
  const tradeIdRef = useRef(0);
  const martingaleStepRef = useRef(0);

  // Subscribe to ticks for live digit display
  useEffect(() => {
    if (!isAuthorized) return;

    liveDigitsRef.current = [];
    setLiveDigits([]);

    derivApi.subscribeTicks(symbol, (data: any) => {
      if (data.tick) {
        const digit = extractDigit(data.tick.quote);
        liveDigitsRef.current.push(digit);
        if (liveDigitsRef.current.length > 100) liveDigitsRef.current.shift();
        setLiveDigits([...liveDigitsRef.current]);
      }
    });

    return () => {
      derivApi.unsubscribeTicks(symbol);
    };
  }, [symbol, isAuthorized]);

  // Update win rate
  useEffect(() => {
    const total = wins + losses;
    setWinRate(total > 0 ? (wins / total) * 100 : 0);
  }, [wins, losses]);

  // Pattern matching
  const doesPatternMatch = useCallback((digits: number[], pattern: string): boolean => {
    if (digits.length < pattern.length) return false;
    const recent = digits.slice(-pattern.length);
    for (let i = 0; i < pattern.length; i++) {
      const ch = pattern[i].toUpperCase();
      const d = recent[i];
      if (ch === 'E' && d % 2 !== 0) return false;
      if (ch === 'O' && d % 2 === 0) return false;
    }
    return true;
  }, []);

  // Digit condition check
  const doesDigitConditionMatch = useCallback((digits: number[]): boolean => {
    if (digits.length < digitAnalysisWindow) return false;
    const window = digits.slice(-digitAnalysisWindow);
    const lastDigit = window[window.length - 1];
    // For values 0-9: last digit; for 10-24: last two digits combined
    const value = lastDigit;
    switch (digitCondition) {
      case '>': return value > digitCompareValue;
      case '<': return value < digitCompareValue;
      case '=': return value === digitCompareValue;
      case '>=': return value >= digitCompareValue;
      case '<=': return value <= digitCompareValue;
      default: return false;
    }
  }, [digitCondition, digitCompareValue, digitAnalysisWindow]);

  // Check if pattern strategy allows trading on M2
  const canTradeM2 = useCallback((): boolean => {
    if (!patternEnabled) return true;
    const digits = liveDigitsRef.current;
    if (patternType === 'even_odd') {
      return doesPatternMatch(digits, patternText);
    } else {
      return doesDigitConditionMatch(digits);
    }
  }, [patternEnabled, patternType, patternText, doesPatternMatch, doesDigitConditionMatch]);

  // Main trading loop
  const startBot = useCallback(async () => {
    if (!isAuthorized || isRunning) return;
    if (balance < initialStake) { toast.error('Insufficient balance'); return; }

    setIsRunning(true);
    runningRef.current = true;
    setCurrentMarket(1);
    setBotStatus('Running');
    martingaleStepRef.current = 0;

    let stake = initialStake;
    setCurrentStake(stake);
    let totalPnl = 0;
    let onMarket: 1 | 2 = 1;
    let patternMatched = false;

    while (runningRef.current) {
      if (balance < stake) {
        toast.error('Insufficient balance — Bot halted');
        break;
      }

      try {
        await waitForNextTick(symbol);

        // Determine contract params based on current market
        let contractType: string;
        let barrier: string | undefined;

        if (onMarket === 1) {
          if (!m1Active) { await new Promise(r => setTimeout(r, 500)); continue; }
          contractType = m1Contract;
          barrier = ['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'].includes(m1Contract)
            ? String(m1Barrier) : undefined;
          setBotStatus(`M1: ${contractType}${barrier ? ` (${barrier})` : ''}`);
        } else {
          if (!m2Active) { await new Promise(r => setTimeout(r, 500)); continue; }

          // Check pattern strategy for M2
          if (patternEnabled && !canTradeM2()) {
            setBotStatus('M2: Waiting for pattern...');
            await new Promise(r => setTimeout(r, 300));
            continue;
          }

          contractType = m2Contract;
          barrier = ['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'].includes(m2Contract)
            ? String(m2Barrier) : undefined;
          setBotStatus(`M2 Recovery: ${contractType}${barrier ? ` (${barrier})` : ''}`);
        }

        const params: any = {
          contract_type: contractType,
          symbol,
          duration: 1,
          duration_unit: 't',
          basis: 'stake',
          amount: stake,
        };
        if (barrier !== undefined) params.barrier = barrier;

        const id = ++tradeIdRef.current;
        const now = new Date().toLocaleTimeString();
        const label = onMarket === 2 ? `${contractType} (M2)` : contractType;

        const newEntry: TradeEntry = {
          id, time: now, market: onMarket === 1 ? 'M1 (Home)' : 'M2 (Recovery)',
          contractType: label, stake, exitDigit: null,
          result: 'Pending' as const, pnl: 0, balance,
        };
        setTrades(prev => [newEntry, ...prev].slice(0, 200));

        setTotalStaked(prev => prev + stake);

        const { contractId } = await derivApi.buyContract(params);
        const result = await derivApi.waitForContractResult(contractId);
        const won = result.status === 'won';
        const pnl = result.profit;
        totalPnl += pnl;

        // Get exit digit from latest tick
        const latestDigit = liveDigitsRef.current[liveDigitsRef.current.length - 1] ?? null;

        setTrades(prev => prev.map(t =>
          t.id === id ? { ...t, result: won ? 'Win' : 'Loss', pnl, exitDigit: latestDigit, balance: balance + totalPnl } : t
        ));
        setNetProfit(totalPnl);

        if (won) {
          setWins(prev => prev + 1);
          // WIN → reset to M1, reset stake
          stake = initialStake;
          martingaleStepRef.current = 0;
          onMarket = 1;
          setCurrentMarket(1);
        } else {
          setLosses(prev => prev + 1);
          // LOSS on M1 → switch to M2
          // LOSS on M2 → stay on M2
          onMarket = 2;
          setCurrentMarket(2);

          if (martingaleEnabled && martingaleStepRef.current < martingaleMaxSteps) {
            stake *= martingaleMultiplier;
            martingaleStepRef.current++;
          }
        }
        setCurrentStake(stake);

        // TP/SL check
        if (totalPnl <= -stopLoss) {
          toast.error(`🛑 Stop Loss Hit! P/L: $${totalPnl.toFixed(2)}`);
          break;
        }
        if (totalPnl >= takeProfit) {
          toast.success(`🎊 Take Profit Hit! +$${totalPnl.toFixed(2)}`);
          break;
        }

        await new Promise(r => setTimeout(r, 500));
      } catch (err: any) {
        if (err.message?.includes('Insufficient balance')) {
          toast.error('Insufficient balance — Bot halted');
          break;
        }
        console.error('Ramz Bot error:', err);
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    setIsRunning(false);
    runningRef.current = false;
    setBotStatus('Stopped');
  }, [isAuthorized, isRunning, balance, initialStake, symbol, m1Active, m1Contract, m1Barrier,
      m2Active, m2Contract, m2Barrier, patternEnabled, canTradeM2, martingaleEnabled,
      martingaleMultiplier, martingaleMaxSteps, stopLoss, takeProfit]);

  const stopBot = () => {
    runningRef.current = false;
    setIsRunning(false);
    setBotStatus('Stopped');
  };

  const clearData = () => {
    setTrades([]);
    setWins(0);
    setLosses(0);
    setTotalStaked(0);
    setNetProfit(0);
    setCurrentStake(initialStake);
    martingaleStepRef.current = 0;
  };

  // Last 8 digits for display
  const last8 = liveDigits.slice(-8);
  const lastDigit = liveDigits.length > 0 ? liveDigits[liveDigits.length - 1] : null;

  // Pattern validation
  const patternValid = /^[EOeo]+$/.test(patternText) && patternText.length >= 2;
  const patternMatchNow = patternValid && doesPatternMatch(liveDigits, patternText);

  const needsBarrier = (ct: string) => ['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'].includes(ct);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-2xl font-bold bg-gradient-to-r from-primary to-profit bg-clip-text text-transparent">
          ⚡ Advanced Ramz Bot
        </h1>
        <p className="text-xs text-muted-foreground">Pattern-Based Strategy with M1/M2 Recovery</p>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Connection Card */}
        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2 pb-3 border-b border-border">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-sm">🔌</div>
            <h3 className="font-semibold text-foreground">Connection</h3>
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Trading Symbol</label>
            <Select value={symbol} onValueChange={setSymbol} disabled={isRunning}>
              <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MARKET_GROUPS.map(g => (
                  <div key={g.value}>
                    <div className="px-2 py-1 text-[10px] font-bold text-muted-foreground uppercase">{g.label}</div>
                    {MARKETS.filter(m => m.group === g.value).map(m => (
                      <SelectItem key={m.symbol} value={m.symbol}>{m.name}</SelectItem>
                    ))}
                  </div>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2 bg-muted rounded-lg px-3 py-2">
            <div className={`w-2 h-2 rounded-full ${isAuthorized ? 'bg-profit' : 'bg-loss animate-pulse'}`} />
            <span className="text-xs text-muted-foreground">
              {isAuthorized ? 'Connected' : 'Disconnected'}
            </span>
            <span className="text-xs font-mono text-foreground ml-auto">
              Balance: ${balance.toFixed(2)} {activeAccount?.currency}
            </span>
          </div>
        </div>

        {/* Market 1 (Home) */}
        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between pb-3 border-b border-border">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-profit/10 flex items-center justify-center text-sm">🏠</div>
              <div>
                <h3 className="font-semibold text-foreground">Market 1 (Home)</h3>
                <Badge variant="outline" className="text-[9px] mt-0.5">ACTIVE</Badge>
              </div>
            </div>
            <Switch checked={m1Active} onCheckedChange={setM1Active} disabled={isRunning} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Contract Type</label>
              <Select value={m1Contract} onValueChange={(v) => setM1Contract(v as ContractType)} disabled={isRunning}>
                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="DIGITEVEN">Digit Even</SelectItem>
                  <SelectItem value="DIGITODD">Digit Odd</SelectItem>
                  <SelectItem value="DIGITMATCH">Digit Match</SelectItem>
                  <SelectItem value="DIGITDIFF">Digit Differs</SelectItem>
                  <SelectItem value="DIGITOVER">Digit Over</SelectItem>
                  <SelectItem value="DIGITUNDER">Digit Under</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {needsBarrier(m1Contract) && (
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Barrier (0-9)</label>
                <Input
                  type="number" min={0} max={9} value={m1Barrier}
                  onChange={(e) => setM1Barrier(Math.max(0, Math.min(9, parseInt(e.target.value) || 0)))}
                  disabled={isRunning} className="h-9 text-xs"
                />
              </div>
            )}
          </div>
        </div>

        {/* Market 2 (Recovery) */}
        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between pb-3 border-b border-border">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-warning/10 flex items-center justify-center text-sm">🔄</div>
              <div>
                <h3 className="font-semibold text-foreground">Market 2 (Recovery)</h3>
                <Badge variant="outline" className="text-[9px] mt-0.5 text-warning border-warning">RECOVERY</Badge>
              </div>
            </div>
            <Switch checked={m2Active} onCheckedChange={setM2Active} disabled={isRunning} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Contract Type</label>
              <Select value={m2Contract} onValueChange={(v) => setM2Contract(v as ContractType)} disabled={isRunning}>
                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="DIGITEVEN">Digit Even</SelectItem>
                  <SelectItem value="DIGITODD">Digit Odd</SelectItem>
                  <SelectItem value="DIGITMATCH">Digit Match</SelectItem>
                  <SelectItem value="DIGITDIFF">Digit Differs</SelectItem>
                  <SelectItem value="DIGITOVER">Digit Over</SelectItem>
                  <SelectItem value="DIGITUNDER">Digit Under</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {needsBarrier(m2Contract) && (
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Barrier (0-9)</label>
                <Input
                  type="number" min={0} max={9} value={m2Barrier}
                  onChange={(e) => setM2Barrier(Math.max(0, Math.min(9, parseInt(e.target.value) || 0)))}
                  disabled={isRunning} className="h-9 text-xs"
                />
              </div>
            )}
          </div>

          <div className="bg-warning/10 border-l-2 border-warning rounded p-2 text-[10px] text-muted-foreground">
            Recovery Mode: Uses its own contract settings. Stays here until a WIN occurs, then returns to Market 1.
          </div>
        </div>

        {/* Pattern Strategy (M2 Only) */}
        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between pb-3 border-b border-border">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-accent/50 flex items-center justify-center text-sm">🎯</div>
              <div>
                <h3 className="font-semibold text-foreground">Pattern Strategy</h3>
                <Badge variant="outline" className="text-[9px] mt-0.5">M2 ONLY</Badge>
              </div>
            </div>
            <Switch checked={patternEnabled} onCheckedChange={setPatternEnabled} disabled={isRunning} />
          </div>

          {patternEnabled && (
            <>
              <p className="text-[10px] text-muted-foreground">
                This strategy ONLY applies when trading on Market 2 (Recovery mode). Bot waits for pattern to match before executing.
              </p>

              {/* Pattern Type Selector */}
              <div className="flex gap-2">
                <button
                  onClick={() => setPatternType('even_odd')}
                  disabled={isRunning}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${
                    patternType === 'even_odd' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                  }`}
                >
                  Even/Odd Pattern
                </button>
                <button
                  onClick={() => setPatternType('last_digit')}
                  disabled={isRunning}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${
                    patternType === 'last_digit' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                  }`}
                >
                  Last Digit Analysis
                </button>
              </div>

              {patternType === 'even_odd' ? (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Pattern (E=Even, O=Odd)</label>
                    <input
                      value={patternText}
                      onChange={(e) => setPatternText(e.target.value.toUpperCase().replace(/[^EO]/g, ''))}
                      disabled={isRunning}
                      placeholder="EEEOE"
                      className="w-full px-3 py-2 bg-muted border border-border rounded-lg text-xs font-mono uppercase tracking-widest text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>

                  <div className={`font-mono text-center py-2 rounded-lg border text-sm tracking-[4px] ${
                    !patternValid ? 'border-loss/50 text-loss bg-loss/5' :
                    patternMatchNow ? 'border-profit/50 text-profit bg-profit/5' :
                    'border-warning/50 text-warning bg-warning/5'
                  }`}>
                    {patternText || '...'}
                    <div className="text-[9px] mt-1 tracking-normal">
                      {!patternValid ? 'Invalid pattern' : patternMatchNow ? '✅ Pattern matched!' : '⏳ Waiting for pattern...'}
                    </div>
                  </div>

                  <div>
                    <label className="text-xs text-muted-foreground mb-2 block">Action When Pattern Matches</label>
                    <div className="space-y-1.5">
                      {[
                        { val: 'trade_once' as const, label: 'Trade Once', desc: 'Execute one contract when pattern matches' },
                        { val: 'trade_until_win' as const, label: 'Trade Until Win', desc: 'Keep trading on match until a win' },
                      ].map(opt => (
                        <label
                          key={opt.val}
                          className={`flex items-start gap-2 p-2 rounded-lg border cursor-pointer transition-all ${
                            patternAction === opt.val ? 'border-primary bg-primary/5' : 'border-border bg-muted/30'
                          }`}
                        >
                          <input
                            type="radio" name="patternAction"
                            checked={patternAction === opt.val}
                            onChange={() => setPatternAction(opt.val)}
                            disabled={isRunning}
                            className="mt-0.5"
                          />
                          <div>
                            <div className="text-xs font-medium text-foreground">{opt.label}</div>
                            <div className="text-[10px] text-muted-foreground">{opt.desc}</div>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">Condition</label>
                      <Select value={digitCondition} onValueChange={(v) => setDigitCondition(v as DigitCondition)} disabled={isRunning}>
                        <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value=">">&gt; Greater Than</SelectItem>
                          <SelectItem value="<">&lt; Less Than</SelectItem>
                          <SelectItem value="=">=  Equal To</SelectItem>
                          <SelectItem value=">=">&ge; Greater or Equal</SelectItem>
                          <SelectItem value="<=">&le; Less or Equal</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">Compare Value (0-9)</label>
                      <Input
                        type="number" min={0} max={9} value={digitCompareValue}
                        onChange={(e) => setDigitCompareValue(Math.max(0, Math.min(9, parseInt(e.target.value) || 0)))}
                        disabled={isRunning} className="h-9 text-xs"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Analysis Window (Ticks)</label>
                    <Input
                      type="number" min={5} max={100} value={digitAnalysisWindow}
                      onChange={(e) => setDigitAnalysisWindow(Math.max(5, Math.min(100, parseInt(e.target.value) || 20)))}
                      disabled={isRunning} className="h-9 text-xs"
                    />
                  </div>
                </div>
              )}

              <div className={`text-center text-xs py-2 rounded-lg ${
                currentMarket === 2 && patternEnabled
                  ? (canTradeM2() ? 'bg-profit/10 text-profit' : 'bg-warning/10 text-warning')
                  : 'bg-muted text-muted-foreground'
              }`}>
                {currentMarket === 2 && patternEnabled
                  ? (canTradeM2() ? '✅ Pattern matched — ready to trade M2' : '⏳ Waiting for pattern match on Market 2...')
                  : 'Pattern check active on M2 entry'
                }
              </div>
            </>
          )}
        </div>

        {/* Risk Management */}
        <div className="bg-card border border-border rounded-xl p-4 space-y-3 lg:col-span-2">
          <div className="flex items-center gap-2 pb-3 border-b border-border">
            <div className="w-8 h-8 rounded-lg bg-warning/10 flex items-center justify-center text-sm">💰</div>
            <h3 className="font-semibold text-foreground">Risk Management</h3>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Initial Stake ($)</label>
              <Input type="number" min={0.35} step={0.01} value={initialStake}
                onChange={(e) => setInitialStake(parseFloat(e.target.value) || 0.35)}
                disabled={isRunning} className="h-9 text-xs"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Martingale</label>
              <Select value={martingaleEnabled ? 'on' : 'off'} onValueChange={(v) => setMartingaleEnabled(v === 'on')} disabled={isRunning}>
                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="off">Disabled</SelectItem>
                  <SelectItem value="on">Enabled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {martingaleEnabled && (
              <>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Multiplier</label>
                  <Input type="number" min={1.1} step={0.1} value={martingaleMultiplier}
                    onChange={(e) => setMartingaleMultiplier(parseFloat(e.target.value) || 2)}
                    disabled={isRunning} className="h-9 text-xs"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Max Steps</label>
                  <Input type="number" min={1} max={20} value={martingaleMaxSteps}
                    onChange={(e) => setMartingaleMaxSteps(parseInt(e.target.value) || 5)}
                    disabled={isRunning} className="h-9 text-xs"
                  />
                </div>
              </>
            )}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Take Profit ($)</label>
              <Input type="number" min={1} value={takeProfit}
                onChange={(e) => setTakeProfit(parseFloat(e.target.value) || 20)}
                disabled={isRunning} className="h-9 text-xs"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Stop Loss ($)</label>
              <Input type="number" min={1} value={stopLoss}
                onChange={(e) => setStopLoss(parseFloat(e.target.value) || 10)}
                disabled={isRunning} className="h-9 text-xs"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Live Digit Stream */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between pb-3 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-sm">🔢</div>
            <h3 className="font-semibold text-foreground">Live Digit Stream</h3>
          </div>
          <Badge variant="outline" className="text-[9px]">Last 8 Ticks</Badge>
        </div>

        <div className="flex justify-center gap-2 flex-wrap">
          {last8.map((d, i) => {
            const isNewest = i === last8.length - 1;
            const isOver = d >= 5;
            const isEven = d % 2 === 0;
            return (
              <motion.div
                key={`${i}-${d}`}
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className={`w-12 h-14 rounded-lg border-2 flex flex-col items-center justify-center font-mono transition-all ${
                  isNewest ? 'border-primary shadow-[0_0_15px_rgba(var(--primary)/0.3)] scale-105' :
                  isOver ? 'border-loss/50 bg-loss/5' : 'border-profit/50 bg-profit/5'
                }`}
              >
                <span className={`text-lg font-bold ${isEven ? 'text-primary' : 'text-warning'}`}>{d}</span>
                <span className={`text-[8px] font-bold uppercase ${isOver ? 'text-loss' : 'text-profit'}`}>
                  {isOver ? 'OVER' : 'UNDER'}
                </span>
              </motion.div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex justify-center gap-4 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-loss" /> Over (≥5)</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-profit" /> Under (&lt;5)</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-primary" /> Even</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-warning" /> Odd</span>
        </div>
      </div>

      {/* Controls */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <div className="flex gap-3 justify-center">
          {!isRunning ? (
            <Button onClick={startBot} disabled={!isAuthorized || balance < initialStake}
              className="bg-profit hover:bg-profit/90 text-profit-foreground px-8">
              <Play className="w-4 h-4 mr-2" /> Start Trading
            </Button>
          ) : (
            <Button onClick={stopBot} variant="destructive" className="px-8">
              <StopCircle className="w-4 h-4 mr-2" /> Stop Trading
            </Button>
          )}
        </div>

        <div className="flex items-center justify-center gap-4 text-xs">
          <span className="text-muted-foreground">
            Current: <Badge variant={currentMarket === 1 ? 'default' : 'destructive'} className="text-[9px] ml-1">
              {currentMarket === 1 ? 'M1 (Home)' : 'M2 (Recovery)'}
            </Badge>
          </span>
          <span className="text-muted-foreground">Status: <span className="text-foreground font-medium">{botStatus}</span></span>
        </div>

        <p className="text-[10px] text-muted-foreground text-center">
          Logic: M1 trades freely → Loss → Switch to M2 → Check Pattern → Trade → Win → Return to M1
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        {[
          { label: 'Wins', value: wins, color: 'text-profit' },
          { label: 'Losses', value: losses, color: 'text-loss' },
          { label: 'Total Staked', value: `$${totalStaked.toFixed(2)}`, color: 'text-primary' },
          { label: 'Net Profit', value: `$${netProfit.toFixed(2)}`, color: netProfit >= 0 ? 'text-profit' : 'text-loss' },
          { label: 'Current Stake', value: `$${currentStake.toFixed(2)}`, color: 'text-primary' },
          { label: 'Win Rate', value: `${winRate.toFixed(0)}%`, color: winRate >= 50 ? 'text-profit' : 'text-loss' },
        ].map(s => (
          <div key={s.label} className="bg-card border border-border rounded-xl p-3 text-center">
            <div className={`text-lg font-bold font-mono ${s.color}`}>{s.value}</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Trade Log */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between pb-3 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-sm">📋</div>
            <h3 className="font-semibold text-foreground">Activity Log</h3>
          </div>
          <Button variant="ghost" size="sm" onClick={clearData} className="text-xs text-muted-foreground">
            <Trash2 className="w-3 h-3 mr-1" /> Clear
          </Button>
        </div>

        <div className="max-h-[400px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-2 text-primary font-semibold">Time</th>
                <th className="text-left py-2 px-2 text-primary font-semibold">Market</th>
                <th className="text-left py-2 px-2 text-primary font-semibold">Contract</th>
                <th className="text-right py-2 px-2 text-primary font-semibold">Stake</th>
                <th className="text-center py-2 px-2 text-primary font-semibold">Exit</th>
                <th className="text-center py-2 px-2 text-primary font-semibold">Result</th>
                <th className="text-right py-2 px-2 text-primary font-semibold">P/L</th>
              </tr>
            </thead>
            <tbody>
              {trades.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-6 text-muted-foreground">System ready. Connect and start trading.</td></tr>
              ) : (
                trades.map(t => (
                  <tr key={t.id} className="border-b border-border/30 hover:bg-muted/30">
                    <td className="py-2 px-2 font-mono text-muted-foreground">{t.time}</td>
                    <td className="py-2 px-2">{t.market}</td>
                    <td className="py-2 px-2">{t.contractType}</td>
                    <td className="py-2 px-2 text-right font-mono ${t.stake > initialStake ? 'text-warning italic' : ''}">${t.stake.toFixed(2)}</td>
                    <td className="py-2 px-2 text-center font-mono">{t.exitDigit ?? '-'}</td>
                    <td className="py-2 px-2 text-center">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        t.result === 'Win' ? 'bg-profit/10 text-profit' :
                        t.result === 'Loss' ? 'bg-loss/10 text-loss' :
                        'text-warning'
                      }`}>
                        {t.result}
                      </span>
                    </td>
                    <td className={`py-2 px-2 text-right font-mono font-bold ${t.pnl >= 0 ? 'text-profit' : 'text-loss'}`}>
                      {t.pnl >= 0 ? '+' : ''}{t.pnl.toFixed(2)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
