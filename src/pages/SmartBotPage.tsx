import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { derivApi, MARKETS, type MarketSymbol } from '@/services/deriv-api';
import { getLastDigit } from '@/services/analysis';
import { useAuth } from '@/contexts/AuthContext';
import {
  analyzeMarketDigits, validateDigitEligibility,
  getRecoveryAction, createRecoveryState, checkConditionsStillValid,
  type MarketSignal, type RecoveryState,
} from '@/services/smart-signal-engine';
import { digitFrequency, calculateConfidence } from '@/services/bot-engine';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Zap, Play, StopCircle, Shield, TrendingUp, AlertTriangle,
  CheckCircle, XCircle, Loader2, Volume2, VolumeX, Settings2,
  BarChart3, Activity,
} from 'lucide-react';
import { type TradeLog } from '@/components/auto-trade/types';
import TradeLogComponent from '@/components/auto-trade/TradeLog';
import DigitDisplay from '@/components/auto-trade/DigitDisplay';
import SmartDigitGrid from '@/components/bots/SmartDigitGrid';
import { toast } from 'sonner';

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

function speakMessage(text: string) {
  try { if ('speechSynthesis' in window) { const u = new SpeechSynthesisUtterance(text); u.rate = 1; u.pitch = 1; u.volume = 1; window.speechSynthesis.speak(u); } } catch {}
}

function loadConfig() {
  try { const raw = localStorage.getItem('smartbot_config'); if (raw) return JSON.parse(raw); } catch {}
  return null;
}
function saveConfig(cfg: any) {
  try { localStorage.setItem('smartbot_config', JSON.stringify(cfg)); } catch {}
}

type StopCondition = 'none' | 'even_runs' | 'on_loss' | 'on_profit';

export default function SmartBotPage() {
  const { isAuthorized, activeAccount, balance } = useAuth();

  const saved = loadConfig();
  const [stake, setStake] = useState(saved?.stake || '1');
  const [multiplier, setMultiplier] = useState(saved?.multiplier || '1.8');
  const [martingaleEnabled, setMartingaleEnabled] = useState(saved?.martingaleEnabled ?? true);
  const [stopLoss, setStopLoss] = useState(saved?.stopLoss || '20');
  const [takeProfit, setTakeProfit] = useState(saved?.takeProfit || '30');
  const [tickCount, setTickCount] = useState(saved?.tickCount || '1000');
  const [maxRuns, setMaxRuns] = useState(saved?.maxRuns || '50');
  const [stopCondition, setStopCondition] = useState<StopCondition>(saved?.stopCondition || 'none');
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [editingConfig, setEditingConfig] = useState(false);

  useEffect(() => {
    saveConfig({ stake, multiplier, martingaleEnabled, stopLoss, takeProfit, tickCount, maxRuns, stopCondition });
  }, [stake, multiplier, martingaleEnabled, stopLoss, takeProfit, tickCount, maxRuns, stopCondition]);

  const [isRunning, setIsRunning] = useState(false);
  const runningRef = useRef(false);
  const [trades, setTrades] = useState<TradeLog[]>([]);
  const [signals, setSignals] = useState<MarketSignal[]>([]);
  const [activeMarket, setActiveMarket] = useState<MarketSymbol | null>(null);
  const [statusLog, setStatusLog] = useState<string[]>([]);
  const [selectedDigit, setSelectedDigit] = useState(4);
  const [liveDigits, setLiveDigits] = useState<Record<string, number[]>>({});
  const [runCount, setRunCount] = useState(0);
  const tradeIdRef = useRef(0);
  const [executingSignal, setExecutingSignal] = useState<string | null>(null);

  // Continuous signal trading state
  const [continuousSignal, setContinuousSignal] = useState<MarketSignal | null>(null);
  const continuousRef = useRef(false);

  const addLog = useCallback((msg: string) => {
    const time = new Date().toLocaleTimeString();
    setStatusLog(prev => [`[${time}] ${msg}`, ...prev].slice(0, 200));
  }, []);

  useEffect(() => {
    if (!derivApi.isConnected) return;
    let active = true;
    const handler = (data: any) => {
      if (!data.tick || !active) return;
      const sym = data.tick.symbol as string;
      const d = getLastDigit(data.tick.quote);
      setLiveDigits(prev => ({ ...prev, [sym]: [...(prev[sym] || []), d].slice(-1000) }));
    };
    const unsub = derivApi.onMessage(handler);
    MARKETS.forEach(m => { derivApi.subscribeTicks(m.symbol, () => {}).catch(() => {}); });
    return () => { active = false; unsub(); };
  }, []);

  const computedSignals = useMemo(() => {
    const count = parseInt(tickCount) || 1000;
    return MARKETS.map(m => {
      const digs = (liveDigits[m.symbol] || []).slice(-count);
      return analyzeMarketDigits(digs, m.symbol, m.name);
    }).sort((a, b) => b.signalStrength - a.signalStrength);
  }, [liveDigits, tickCount]);

  useEffect(() => {
    const interval = setInterval(() => { setSignals(computedSignals); }, 2000);
    return () => clearInterval(interval);
  }, [computedSignals]);

  const validSignals = signals.filter(s => s.isValid);
  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
  const winCount = trades.filter(t => t.result === 'Win').length;
  const lossCount = trades.filter(t => t.result === 'Loss').length;

  /** Execute a single signal trade */
  const executeSignalTrade = useCallback(async (signal: MarketSignal) => {
    if (!isAuthorized || isRunning) return;
    if (balance < parseFloat(stake)) { toast.error('Insufficient balance'); return; }

    setExecutingSignal(signal.symbol);
    addLog(`⚡ Instant execute: ${signal.marketName} ${signal.suggestedContract} ${signal.suggestedBarrier}`);

    try {
      const baseStake = parseFloat(stake);
      const freshTick = await waitForNextTick(signal.symbol);
      const tickDigit = getLastDigit(freshTick.quote);
      addLog(`🔄 Fresh tick: ${freshTick.quote} → digit ${tickDigit}`);

      const id = ++tradeIdRef.current;
      const now = new Date().toLocaleTimeString();
      setTrades(prev => [{ id, time: now, market: signal.symbol, contract: signal.suggestedContract, stake: baseStake, result: 'Pending' as const, pnl: 0 }, ...prev].slice(0, 200));

      const { contractId, buyPrice } = await derivApi.buyContract({
        contract_type: signal.suggestedContract, symbol: signal.symbol,
        duration: 1, duration_unit: 't', basis: 'stake', amount: baseStake,
        barrier: signal.suggestedBarrier || undefined,
      });

      addLog(`⏳ Contract ${contractId} opened @ ${buyPrice}`);
      const result = await derivApi.waitForContractResult(contractId);
      const won = result.status === 'won';
      addLog(`${won ? '✅ WIN' : '❌ LOSS'} | Profit: ${result.profit.toFixed(2)}`);
      setTrades(prev => prev.map(t => t.id === id ? { ...t, result: won ? 'Win' : 'Loss', pnl: result.profit } : t));

      if (soundEnabled) {
        try { const ctx = new AudioContext(); const o = ctx.createOscillator(); o.frequency.value = won ? 880 : 440; o.connect(ctx.destination); o.start(); setTimeout(() => { o.stop(); ctx.close(); }, 200); } catch {}
      }
    } catch (err: any) {
      addLog(`⚠️ Error: ${err.message}`);
    } finally {
      setExecutingSignal(null);
    }
  }, [isAuthorized, isRunning, stake, balance, soundEnabled, addLog]);

  /** Start continuous trading on a signal until TP/SL/manual stop/condition change */
  const startContinuousTrading = useCallback(async (signal: MarketSignal) => {
    if (!isAuthorized || isRunning || continuousRef.current) return;
    if (balance < parseFloat(stake)) { toast.error('Insufficient balance'); return; }

    setContinuousSignal(signal);
    continuousRef.current = true;
    setIsRunning(true);
    runningRef.current = true;
    setRunCount(0);

    const baseStake = parseFloat(stake);
    const recoveryStake = signal.entryDirection === 'OVER' ? signal.overRecoveryStake : signal.underRecoveryStake;
    const mult = parseFloat(multiplier);
    const sl = parseFloat(stopLoss);
    const tp = parseFloat(takeProfit);
    let localPnl = 0;
    let localRuns = 0;
    let currentStake = baseStake;
    let consLosses = 0;
    const originalFilter = signal.oddEvenFilter;

    addLog(`🟢 AUTO: ${signal.marketName} ${signal.suggestedContract} ${signal.suggestedBarrier} | ${signal.entryDirection} | Filter: ${originalFilter || 'NONE'}`);
    addLog(`📊 Most: digit ${signal.most.digit} (${signal.most.count}x) | Least: digit ${signal.least.digit} (${signal.least.count}x)`);

    while (continuousRef.current) {
      if (balance < currentStake) { addLog('🛑 Insufficient balance'); toast.error('Insufficient balance'); break; }

      // Auto-stop: check conditions still valid
      const currentDigits = (liveDigits[signal.symbol] || []).slice(-1000);
      const condCheck = checkConditionsStillValid(signal, currentDigits, originalFilter);
      if (!condCheck.valid) {
        addLog(`🔄 AUTO-STOP: ${condCheck.reason}`);
        toast.info(`Conditions changed: ${condCheck.reason}`);
        break;
      }

      // Auto-stop: max 5 recovery exhausted
      if (consLosses >= 5) {
        addLog(`🛑 Max 5 recovery runs exhausted`);
        toast.error('Recovery limit reached (5 runs)');
        break;
      }

      try {
        const freshTick = await waitForNextTick(signal.symbol);
        const id = ++tradeIdRef.current;
        const now = new Date().toLocaleTimeString();
        setTrades(prev => [{ id, time: now, market: signal.symbol, contract: signal.suggestedContract, stake: currentStake, result: 'Pending' as const, pnl: 0 }, ...prev].slice(0, 200));

        const { contractId, buyPrice } = await derivApi.buyContract({
          contract_type: signal.suggestedContract, symbol: signal.symbol,
          duration: 1, duration_unit: 't', basis: 'stake', amount: currentStake,
          barrier: signal.suggestedBarrier || undefined,
        });

        addLog(`⏳ Contract ${contractId} @ ${buyPrice} (stake: $${currentStake.toFixed(2)})`);
        const result = await derivApi.waitForContractResult(contractId);
        const won = result.status === 'won';
        const pnl = result.profit;
        addLog(`${won ? '✅ WIN' : '❌ LOSS'} | P/L: ${pnl.toFixed(2)} | Recovery: ${consLosses}/5`);

        setTrades(prev => prev.map(t => t.id === id ? { ...t, result: won ? 'Win' : 'Loss', pnl } : t));
        localPnl += pnl;
        localRuns++;
        setRunCount(localRuns);

        // Martingale: LOSS → recovery stake then multiply, WIN → reset
        if (won) {
          consLosses = 0;
          currentStake = baseStake;
          // Auto-stop on profit
          if (localPnl > 0) {
            addLog(`🎯 PROFIT LOCKED: +$${localPnl.toFixed(2)}`);
            toast.success(`🎊 Profit locked! +$${localPnl.toFixed(2)}`);
            if (soundEnabled) speakMessage('Profit locked!');
            break;
          }
        } else {
          consLosses++;
          if (martingaleEnabled) {
            currentStake = consLosses === 1 ? recoveryStake : currentStake * mult;
          }
        }

        if (soundEnabled) {
          try { const ctx = new AudioContext(); const o = ctx.createOscillator(); o.frequency.value = won ? 880 : 440; o.connect(ctx.destination); o.start(); setTimeout(() => { o.stop(); ctx.close(); }, 200); } catch {}
        }

        // TP/SL
        if (localPnl <= -sl) {
          addLog(`🛑 STOP LOSS: ${localPnl.toFixed(2)}`);
          toast.error(`🛑 Stop Loss! P/L: $${localPnl.toFixed(2)}`);
          if (soundEnabled) speakMessage('Stop loss hit.');
          break;
        }
        if (localPnl >= tp) {
          addLog(`🎯 TAKE PROFIT: ${localPnl.toFixed(2)}`);
          toast.success(`🎊 Take Profit! +$${localPnl.toFixed(2)}`);
          if (soundEnabled) speakMessage('Take profit hit!');
          break;
        }

        await new Promise(r => setTimeout(r, 500));
      } catch (err: any) {
        if (err.message?.includes('Insufficient balance')) { toast.error('Insufficient balance'); break; }
        addLog(`⚠️ Error: ${err.message}`);
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    addLog(`🏁 Continuous trade ended. Runs: ${localRuns}, P/L: ${localPnl.toFixed(2)}`);
    continuousRef.current = false;
    setContinuousSignal(null);
    setIsRunning(false);
    runningRef.current = false;
  }, [isAuthorized, isRunning, stake, multiplier, martingaleEnabled, stopLoss, takeProfit, balance, soundEnabled, addLog, liveDigits]);

  const stopContinuousTrading = useCallback(() => {
    continuousRef.current = false;
    runningRef.current = false;
    setIsRunning(false);
    setContinuousSignal(null);
    addLog('🔴 Continuous trade STOPPED by user');
  }, [addLog]);

  // Main smart bot loop — scans all markets
  const startSmartBot = useCallback(async () => {
    if (!isAuthorized || isRunning) return;
    if (balance < parseFloat(stake)) { toast.error('Insufficient balance'); return; }

    setIsRunning(true);
    runningRef.current = true;
    setRunCount(0);
    addLog('🟢 Smart Bot LOADED — Scanning all volatilities (1000 ticks)...');

    const baseStake = parseFloat(stake);
    const mult = parseFloat(multiplier);
    const sl = parseFloat(stopLoss);
    const tp = parseFloat(takeProfit);
    const maxRunsNum = parseInt(maxRuns) || 999999;
    let localPnl = 0;
    let localRuns = 0;
    let consLosses = 0;
    let currentStake = baseStake;
    let activeSignal: MarketSignal | null = null;
    let originalFilter: 'ODD' | 'EVEN' | null = null;

    while (runningRef.current) {
      if (balance < currentStake) { addLog('🛑 Insufficient balance'); toast.error('Insufficient balance'); break; }
      if (localRuns >= maxRunsNum) { addLog(`🏁 Max runs (${maxRunsNum})`); toast.info(`Max ${maxRunsNum} runs reached`); break; }
      if (consLosses >= 5) { addLog('🛑 Max 5 recovery runs exhausted'); toast.error('Recovery limit reached'); break; }

      try {
        const count = parseInt(tickCount) || 1000;
        const freshSignals = MARKETS.map(m => {
          const digs = (liveDigits[m.symbol] || []).slice(-count);
          return analyzeMarketDigits(digs, m.symbol, m.name);
        }).filter(s => s.isValid).sort((a, b) => b.signalStrength - a.signalStrength);

        if (freshSignals.length === 0) {
          addLog('⏳ No valid signals — scanning...');
          await new Promise(r => setTimeout(r, 3000));
          continue;
        }

        const signal = freshSignals[0];
        if (!activeSignal) {
          activeSignal = signal;
          originalFilter = signal.oddEvenFilter;
          addLog(`📊 Locked signal: ${signal.marketName} | ${signal.entryDirection} | Filter: ${originalFilter || 'NONE'}`);
          addLog(`   Most: digit ${signal.most.digit} (${signal.most.count}x) | Least: digit ${signal.least.digit} (${signal.least.count}x)`);
        }

        setActiveMarket(signal.symbol);

        // Check conditions still valid
        const currentDigits = (liveDigits[signal.symbol] || []).slice(-count);
        const condCheck = checkConditionsStillValid(activeSignal, currentDigits, originalFilter);
        if (!condCheck.valid) {
          addLog(`🔄 Conditions changed: ${condCheck.reason} — re-scanning`);
          activeSignal = null;
          originalFilter = null;
          consLosses = 0;
          currentStake = baseStake;
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }

        const eligibility = validateDigitEligibility(currentDigits, signal.suggestedContract, parseInt(signal.suggestedBarrier) || 0);
        if (!eligibility.eligible) {
          addLog(`❌ Digit validation: ${eligibility.reason}`);
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }

        await waitForNextTick(signal.symbol);

        const id = ++tradeIdRef.current;
        const now = new Date().toLocaleTimeString();
        setTrades(prev => [{ id, time: now, market: signal.symbol, contract: signal.suggestedContract, stake: currentStake, result: 'Pending' as const, pnl: 0 }, ...prev].slice(0, 200));

        const { contractId, buyPrice } = await derivApi.buyContract({
          contract_type: signal.suggestedContract, symbol: signal.symbol,
          duration: 1, duration_unit: 't', basis: 'stake', amount: currentStake,
          barrier: signal.suggestedBarrier || undefined,
        });

        addLog(`⏳ Contract ${contractId} @ ${buyPrice} (stake: $${currentStake.toFixed(2)})`);
        const result = await derivApi.waitForContractResult(contractId);
        const won = result.status === 'won';
        const pnl = result.profit;
        addLog(`${won ? '✅ WIN' : '❌ LOSS'} | P/L: ${pnl.toFixed(2)} | Recovery: ${consLosses}/5`);

        setTrades(prev => prev.map(t => t.id === id ? { ...t, result: won ? 'Win' : 'Loss', pnl } : t));
        localPnl += pnl;
        localRuns++;
        setRunCount(localRuns);

        if (soundEnabled) {
          try { const ctx = new AudioContext(); const o = ctx.createOscillator(); o.frequency.value = won ? 880 : 440; o.connect(ctx.destination); o.start(); setTimeout(() => { o.stop(); ctx.close(); }, 200); } catch {}
        }

        // Martingale with recovery stakes
        const recoveryStake = signal.entryDirection === 'OVER' ? signal.overRecoveryStake : signal.underRecoveryStake;
        if (won) {
          consLosses = 0;
          currentStake = baseStake;
          // Auto-stop on profit
          if (localPnl > 0) {
            addLog(`🎯 PROFIT: +$${localPnl.toFixed(2)} — auto-stopping`);
            toast.success(`🎊 Profit! +$${localPnl.toFixed(2)}`);
            if (soundEnabled) speakMessage('Profit locked!');
            break;
          }
        } else {
          consLosses++;
          if (martingaleEnabled) {
            currentStake = consLosses === 1 ? recoveryStake : currentStake * mult;
          }
        }

        if (stopCondition === 'on_loss' && !won) { addLog('🏁 Stopped: On Loss'); break; }
        if (stopCondition === 'on_profit' && won) { addLog('🏁 Stopped: On Profit'); break; }
        if (stopCondition === 'even_runs' && localRuns % 2 === 0) { addLog(`🏁 Stopped: Even runs (${localRuns})`); break; }

        if (localPnl <= -sl) { addLog(`🛑 STOP LOSS: ${localPnl.toFixed(2)}`); toast.error(`🛑 Stop Loss! $${localPnl.toFixed(2)}`); break; }
        if (localPnl >= tp) { addLog(`🎯 TAKE PROFIT: ${localPnl.toFixed(2)}`); toast.success(`🎊 Take Profit! +$${localPnl.toFixed(2)}`); break; }

        await new Promise(r => setTimeout(r, 500));
      } catch (err: any) {
        if (err.message?.includes('Insufficient balance')) { toast.error('Insufficient balance'); break; }
        addLog(`⚠️ Error: ${err.message}`);
        await new Promise(r => setTimeout(r, 3000));
      }
    }

    addLog(`🏁 Session ended. Runs: ${localRuns}, P/L: ${localPnl.toFixed(2)}`);
    setIsRunning(false);
    runningRef.current = false;
  }, [isAuthorized, isRunning, stake, multiplier, martingaleEnabled, stopLoss, takeProfit, tickCount, maxRuns, stopCondition, liveDigits, balance, soundEnabled, addLog]);

  const stopSmartBot = useCallback(() => {
    runningRef.current = false;
    continuousRef.current = false;
    setIsRunning(false);
    setContinuousSignal(null);
    addLog('🔴 Smart Bot STOPPED by user');
  }, [addLog]);

  const activeDigits = activeMarket ? (liveDigits[activeMarket] || []).slice(-30) : [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Zap className="w-5 h-5 text-warning" /> Smart Signal Bot
          </h1>
          <p className="text-xs text-muted-foreground">
            Frequency analysis • 1000 ticks • Auto-stop on profit/condition change • Max 5 recovery
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isRunning && (
            <Badge variant="outline" className="text-[10px] text-warning animate-pulse">
              {continuousSignal ? `Trading ${continuousSignal.marketName}` : 'Scanning...'} | P/L: ${totalPnl.toFixed(2)} | Run {runCount}
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={() => setSoundEnabled(!soundEnabled)} className="h-8">
            {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      {/* Config Bar */}
      <div className="bg-card border border-border rounded-xl p-3 flex flex-wrap items-center gap-4 text-xs">
        <span className="font-mono">Stake: <strong className="text-foreground">${stake}</strong></span>
        <span className="font-mono">TP: <strong className="text-profit">${takeProfit}</strong></span>
        <span className="font-mono">SL: <strong className="text-loss">${stopLoss}</strong></span>
        <span className="font-mono">Martingale: <strong className={martingaleEnabled ? 'text-warning' : 'text-muted-foreground'}>{martingaleEnabled ? `${multiplier}x` : 'OFF'}</strong></span>
        <span className="font-mono">Recovery: <strong className="text-foreground">Max 5</strong></span>
        <span className="font-mono">Ticks: <strong className="text-foreground">{tickCount}</strong></span>
        <Button variant="ghost" size="sm" className="h-6 px-2 ml-auto" onClick={() => setEditingConfig(!editingConfig)}>
          <Settings2 className="w-3 h-3 mr-1" /> {editingConfig ? 'Close' : 'Edit'}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Config Panel */}
        <div className="lg:col-span-3 space-y-4">
          {editingConfig && (
            <div className="bg-card border border-border rounded-xl p-4 space-y-3">
              <h2 className="font-semibold text-foreground text-sm flex items-center gap-1">
                <Shield className="w-4 h-4" /> Bot Configuration
              </h2>
              <div>
                <label className="text-[10px] text-muted-foreground">Base Stake (USD)</label>
                <Input type="number" min="0.35" step="0.01" value={stake} onChange={e => setStake(e.target.value)} disabled={isRunning} className="h-8 text-xs" />
              </div>
              <div className="flex items-center justify-between">
                <label className="text-xs text-foreground">Martingale on LOSS</label>
                <Switch checked={martingaleEnabled} onCheckedChange={setMartingaleEnabled} disabled={isRunning} />
              </div>
              {martingaleEnabled && (
                <div>
                  <label className="text-[10px] text-muted-foreground">Multiplier</label>
                  <Input type="number" min="1.1" step="0.1" value={multiplier} onChange={e => setMultiplier(e.target.value)} disabled={isRunning} className="h-8 text-xs" />
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-muted-foreground">Stop Loss</label>
                  <Input type="number" value={stopLoss} onChange={e => setStopLoss(e.target.value)} disabled={isRunning} className="h-8 text-xs" />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">Take Profit</label>
                  <Input type="number" value={takeProfit} onChange={e => setTakeProfit(e.target.value)} disabled={isRunning} className="h-8 text-xs" />
                </div>
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">Max Runs</label>
                <Input type="number" value={maxRuns} onChange={e => setMaxRuns(e.target.value)} disabled={isRunning} className="h-8 text-xs" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">Stop Condition</label>
                <Select value={stopCondition} onValueChange={v => setStopCondition(v as StopCondition)} disabled={isRunning}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Manual stop only</SelectItem>
                    <SelectItem value="even_runs">Even number of runs</SelectItem>
                    <SelectItem value="on_loss">On Loss</SelectItem>
                    <SelectItem value="on_profit">On Profit</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">Tick History Count</label>
                <Select value={tickCount} onValueChange={setTickCount} disabled={isRunning}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['100', '200', '500', '1000'].map(n => (
                      <SelectItem key={n} value={n}>Last {n} ticks</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {!isRunning ? (
            <Button onClick={startSmartBot} disabled={!isAuthorized || balance < parseFloat(stake)}
              className="w-full h-11 text-sm font-bold bg-profit hover:bg-profit/90 text-profit-foreground">
              <Play className="w-4 h-4 mr-2" /> 🟢 LOAD SMART BOT & TRADE
            </Button>
          ) : (
            <Button onClick={stopSmartBot} variant="destructive" className="w-full h-11 text-sm font-bold">
              <StopCircle className="w-4 h-4 mr-2" /> STOP SMART BOT
            </Button>
          )}

          {isRunning && (
            <div className="flex items-center gap-2 text-xs text-warning">
              <Loader2 className="w-3 h-3 animate-spin" /> Bot running — settings locked
            </div>
          )}

          {/* Entry Rules */}
          <div className="bg-card border border-border rounded-xl p-4">
            <h3 className="text-xs font-semibold text-foreground mb-2">📋 Entry Rules</h3>
            <div className="space-y-1.5 text-[10px] text-muted-foreground">
              <div className="font-semibold text-profit">OVER Entry:</div>
              <div className="pl-2">Most freq &gt; 4 AND Least freq &gt; 4</div>
              <div className="pl-2">Stake: $1 → Recovery: $3</div>
              <div className="font-semibold text-loss mt-1">UNDER Entry:</div>
              <div className="pl-2">Most freq &lt; 5 AND Least freq &lt; 8</div>
              <div className="pl-2">Stake: $1 → Recovery: $6</div>
              <div className="border-t border-border mt-2 pt-2">
                <div className="flex items-center gap-1"><XCircle className="w-3 h-3 text-loss" /> LOSS → Recovery stake then multiply</div>
                <div className="flex items-center gap-1"><CheckCircle className="w-3 h-3 text-profit" /> WIN → Reset + Auto-stop on profit</div>
                <div className="flex items-center gap-1"><AlertTriangle className="w-3 h-3 text-warning" /> Max 5 recovery runs</div>
                <div className="flex items-center gap-1"><Activity className="w-3 h-3 text-primary" /> Odd/Even volatility filter</div>
              </div>
            </div>
          </div>
        </div>

        {/* Center: Signals + Digits */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-card border border-border rounded-xl p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-1">
              <TrendingUp className="w-4 h-4 text-primary" /> Live Signal Scanner
              <Badge variant="outline" className="ml-auto text-[10px]">
                {validSignals.length}/{MARKETS.length} valid
              </Badge>
            </h3>
            <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
              {signals.slice(0, 17).map(s => (
                <div key={s.symbol} className={`flex items-center justify-between p-2 rounded-lg text-xs ${s.isValid ? 'bg-profit/10 border border-profit/30' : 'bg-muted'}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {s.isValid ? <CheckCircle className="w-3.5 h-3.5 text-profit shrink-0" /> : <XCircle className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                      <span className="font-mono font-semibold truncate">{s.marketName}</span>
                    </div>
                    {s.isValid && (
                      <div className="text-[9px] text-muted-foreground ml-5 mt-0.5">
                        {s.entryDirection} | Most:{s.most.count} Least:{s.least.count} | {s.oddEvenFilter || 'N/A'}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant={s.signalStrength >= 6 ? 'default' : 'secondary'} className="text-[9px]">STR: {s.signalStrength}</Badge>
                    {s.isValid && (
                      <>
                        <span className="font-mono text-profit">{s.suggestedContract.replace('DIGIT', '')} {s.suggestedBarrier}</span>
                        {continuousSignal?.symbol === s.symbol ? (
                          <Button size="sm" variant="destructive"
                            className="h-6 px-2 text-[10px] font-bold"
                            onClick={stopContinuousTrading}>
                            <StopCircle className="w-3 h-3 mr-1" /> STOP
                          </Button>
                        ) : (
                          <div className="flex gap-1">
                            <Button size="sm" variant="outline"
                              className="h-6 px-2 text-[10px] font-bold border-profit text-profit hover:bg-profit hover:text-profit-foreground"
                              disabled={isRunning || executingSignal !== null || balance < parseFloat(stake)}
                              onClick={() => executeSignalTrade(s)}>
                              {executingSignal === s.symbol ? <Loader2 className="w-3 h-3 animate-spin" /> : <><Play className="w-3 h-3 mr-1" /> 1x</>}
                            </Button>
                            <Button size="sm" variant="outline"
                              className="h-6 px-2 text-[10px] font-bold border-warning text-warning hover:bg-warning hover:text-warning-foreground"
                              disabled={isRunning || executingSignal !== null || balance < parseFloat(stake)}
                              onClick={() => startContinuousTrading(s)}>
                              <Play className="w-3 h-3 mr-1" /> AUTO
                            </Button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}
              {signals.length === 0 && (
                <div className="text-center text-muted-foreground text-xs py-4">Waiting for tick data...</div>
              )}
            </div>
          </div>

          {activeMarket && activeDigits.length > 0 && <DigitDisplay digits={activeDigits} barrier={selectedDigit} />}
          {activeMarket && (liveDigits[activeMarket] || []).length > 10 && (
            <SmartDigitGrid digits={(liveDigits[activeMarket] || []).slice(-200)} barrier={selectedDigit} onSelectDigit={setSelectedDigit} selectedDigit={selectedDigit} />
          )}
        </div>

        {/* Right: Trade Log + Status + Dashboard */}
        <div className="lg:col-span-4 space-y-4">
          <div className="bg-card border border-border rounded-xl p-4">
            <h3 className="text-sm font-semibold text-foreground mb-2">Session Dashboard</h3>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'Balance', value: `$${balance.toFixed(2)}`, color: 'text-foreground' },
                { label: 'Wins', value: winCount, color: 'text-profit' },
                { label: 'Losses', value: lossCount, color: 'text-loss' },
                { label: 'P/L', value: `$${totalPnl.toFixed(2)}`, color: totalPnl >= 0 ? 'text-profit' : 'text-loss' },
                { label: 'Runs', value: `${runCount}/${maxRuns}`, color: 'text-foreground' },
                { label: 'Status', value: isRunning ? (continuousSignal ? 'TRADING' : 'SCANNING') : 'STOPPED', color: isRunning ? 'text-profit' : 'text-muted-foreground' },
              ].map(s => (
                <div key={s.label} className="bg-muted rounded-lg p-2 text-center">
                  <div className="text-[9px] text-muted-foreground">{s.label}</div>
                  <div className={`font-mono text-xs font-bold ${s.color}`}>{s.value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Live frequency counts */}
          {activeMarket && (liveDigits[activeMarket] || []).length > 20 && (() => {
            const digs = (liveDigits[activeMarket] || []).slice(-1000);
            const freq = digitFrequency(digs);
            const sorted = freq.map((c, i) => ({ digit: i, count: c })).sort((a, b) => b.count - a.count);
            const evenC = digs.filter(d => d % 2 === 0).length;
            const oddC = digs.length - evenC;
            return (
              <div className="bg-card border border-border rounded-xl p-4">
                <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-1">
                  <BarChart3 className="w-4 h-4 text-primary" /> Live Frequency ({digs.length} ticks)
                </h3>
                <div className="grid grid-cols-5 gap-1 mb-2">
                  {sorted.map(d => (
                    <div key={d.digit} className={`text-center rounded-lg p-1.5 text-xs font-mono ${
                      d === sorted[0] ? 'bg-profit/20 border border-profit/40 text-profit' :
                      d === sorted[sorted.length - 1] ? 'bg-loss/20 border border-loss/40 text-loss' :
                      'bg-muted text-foreground'
                    }`}>
                      <div className="font-bold text-sm">{d.digit}</div>
                      <div className="text-[9px]">{d.count}x</div>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  <div className="bg-muted rounded p-1.5 text-center">
                    <span className="text-muted-foreground">Odd: </span>
                    <span className={`font-mono font-bold ${oddC > evenC ? 'text-warning' : 'text-foreground'}`}>{(oddC / digs.length * 100).toFixed(1)}%</span>
                  </div>
                  <div className="bg-muted rounded p-1.5 text-center">
                    <span className="text-muted-foreground">Even: </span>
                    <span className={`font-mono font-bold ${evenC > oddC ? 'text-profit' : 'text-foreground'}`}>{(evenC / digs.length * 100).toFixed(1)}%</span>
                  </div>
                </div>
              </div>
            );
          })()}

          <TradeLogComponent trades={trades} />

          <div className="bg-card border border-border rounded-xl p-4">
            <h3 className="text-sm font-semibold text-foreground mb-2">Bot Log</h3>
            <div className="max-h-[200px] overflow-y-auto space-y-0.5">
              {statusLog.map((log, i) => (
                <div key={i} className="text-[10px] text-muted-foreground font-mono leading-relaxed">{log}</div>
              ))}
              {statusLog.length === 0 && (
                <div className="text-[10px] text-muted-foreground text-center py-4">Press "Load Smart Bot & Trade" to begin</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
