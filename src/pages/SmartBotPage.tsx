import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  derivApi, MARKETS, type MarketSymbol,
} from '@/services/deriv-api';
import { getLastDigit } from '@/services/analysis';
import { useAuth } from '@/contexts/AuthContext';
import {
  analyzeMarketDigits, validateDigitEligibility,
  getRecoveryAction, type MarketSignal, type RecoveryState,
} from '@/services/smart-signal-engine';
import { digitFrequency, calculateConfidence } from '@/services/bot-engine';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Zap, Play, StopCircle, Shield, TrendingUp, AlertTriangle,
  CheckCircle, XCircle, Loader2, Volume2, VolumeX,
} from 'lucide-react';
import { type TradeLog } from '@/components/auto-trade/types';
import TradeLogComponent from '@/components/auto-trade/TradeLog';
import DigitDisplay from '@/components/auto-trade/DigitDisplay';
import SmartDigitGrid from '@/components/bots/SmartDigitGrid';

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

export default function SmartBotPage() {
  const { isAuthorized, activeAccount, balance } = useAuth();

  // Config
  const [stake, setStake] = useState('1');
  const [multiplier, setMultiplier] = useState('1.8');
  const [martingaleEnabled, setMartingaleEnabled] = useState(true);
  const [stopLoss, setStopLoss] = useState('20');
  const [takeProfit, setTakeProfit] = useState('30');
  const [tickCount, setTickCount] = useState('100');
  const [soundEnabled, setSoundEnabled] = useState(false);

  // Runtime
  const [isRunning, setIsRunning] = useState(false);
  const runningRef = useRef(false);
  const [trades, setTrades] = useState<TradeLog[]>([]);
  const [signals, setSignals] = useState<MarketSignal[]>([]);
  const [activeMarket, setActiveMarket] = useState<MarketSymbol | null>(null);
  const [statusLog, setStatusLog] = useState<string[]>([]);
  const [selectedDigit, setSelectedDigit] = useState(4);
  const [liveDigits, setLiveDigits] = useState<Record<string, number[]>>({});
  const tradeIdRef = useRef(0);

  const addLog = useCallback((msg: string) => {
    const time = new Date().toLocaleTimeString();
    setStatusLog(prev => [`[${time}] ${msg}`, ...prev].slice(0, 200));
    console.log(`[SmartBot] ${msg}`);
  }, []);

  // Subscribe to ALL markets for scanning
  useEffect(() => {
    if (!derivApi.isConnected) return;
    let active = true;

    const handler = (data: any) => {
      if (!data.tick || !active) return;
      const sym = data.tick.symbol as string;
      const d = getLastDigit(data.tick.quote);
      setLiveDigits(prev => {
        const existing = prev[sym] || [];
        return { ...prev, [sym]: [...existing, d].slice(-500) };
      });
    };

    const unsub = derivApi.onMessage(handler);

    // Subscribe to all markets
    MARKETS.forEach(m => {
      derivApi.subscribeTicks(m.symbol, () => {}).catch(() => {});
    });

    return () => { active = false; unsub(); };
  }, []);

  // Generate signals from live data
  const computedSignals = useMemo(() => {
    const count = parseInt(tickCount) || 100;
    return MARKETS.map(m => {
      const digits = (liveDigits[m.symbol] || []).slice(-count);
      return analyzeMarketDigits(digits, m.symbol, m.name);
    }).sort((a, b) => b.signalStrength - a.signalStrength);
  }, [liveDigits, tickCount]);

  // Update signals state periodically
  useEffect(() => {
    const interval = setInterval(() => {
      setSignals(computedSignals);
    }, 2000);
    return () => clearInterval(interval);
  }, [computedSignals]);

  const validSignals = signals.filter(s => s.isValid);

  // ─── MAIN SMART BOT LOOP ───
  const startSmartBot = useCallback(async () => {
    if (!isAuthorized || isRunning) return;
    setIsRunning(true);
    runningRef.current = true;
    addLog('🟢 Smart Bot LOADED — Scanning all volatilities...');

    const baseStake = parseFloat(stake);
    const mult = parseFloat(multiplier);
    const sl = parseFloat(stopLoss);
    const tp = parseFloat(takeProfit);
    let totalPnl = 0;
    let totalTrades = 0;

    // Recovery state per market
    const recoveryStates: Record<string, RecoveryState> = {};

    while (runningRef.current) {
      try {
        // Step 1: Scan all volatilities for valid signals
        const count = parseInt(tickCount) || 100;
        const freshSignals = MARKETS.map(m => {
          const digits = (liveDigits[m.symbol] || []).slice(-count);
          return analyzeMarketDigits(digits, m.symbol, m.name);
        }).filter(s => s.isValid).sort((a, b) => b.signalStrength - a.signalStrength);

        if (freshSignals.length === 0) {
          addLog('⏳ No valid signals across any market — waiting...');
          await new Promise(r => setTimeout(r, 3000));
          continue;
        }

        // Step 2: Pick the strongest signal
        const signal = freshSignals[0];
        setActiveMarket(signal.symbol);
        addLog(`📊 Signal: ${signal.marketName} | Strength ${signal.signalStrength} | ${signal.suggestedContract} ${signal.suggestedBarrier}`);

        // Init recovery state for this market
        if (!recoveryStates[signal.symbol]) {
          recoveryStates[signal.symbol] = {
            inRecovery: false,
            lastWasLoss: false,
            pendingMartingale: false,
            baseStake,
            currentStake: baseStake,
          };
        }

        const rState = recoveryStates[signal.symbol];

        // Step 3: Determine contract + barrier via recovery rules
        let contractType = signal.suggestedContract;
        let barrier = signal.suggestedBarrier;

        // Apply Over/Under strategy rules:
        // If signal strength >= 4, default = OVER 1
        // If any loss, switch to OVER 3
        if (signal.signalStrength >= 4 && (contractType === 'DIGITOVER' || contractType === 'DIGITUNDER')) {
          const recovery = getRecoveryAction(rState, mult, null);
          barrier = recovery.barrier;
          if (contractType === 'DIGITOVER') {
            contractType = 'DIGITOVER';
            barrier = recovery.barrier;
          }
        }

        // Step 4: Validate digit eligibility
        const eligibility = validateDigitEligibility(
          (liveDigits[signal.symbol] || []).slice(-count),
          contractType,
          parseInt(barrier) || 0,
        );

        if (!eligibility.eligible) {
          addLog(`❌ Digit validation failed: ${eligibility.reason}`);
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }
        addLog(`✅ Digit confirmed: ${eligibility.reason}`);

        // Step 5: Wait for fresh tick
        const freshTick = await waitForNextTick(signal.symbol);
        const tickDigit = getLastDigit(freshTick.quote);
        addLog(`🔄 Fresh tick: ${freshTick.quote} → digit ${tickDigit}`);

        // Step 6: Execute trade
        const tradeStake = martingaleEnabled ? rState.currentStake : baseStake;
        const id = ++tradeIdRef.current;
        const now = new Date().toLocaleTimeString();

        setTrades(prev => [{
          id, time: now, market: signal.symbol, contract: contractType,
          stake: tradeStake, result: 'Pending' as const, pnl: 0,
        }, ...prev].slice(0, 200));

        addLog(`📤 BUYING: ${contractType} barrier=${barrier || 'N/A'} stake=${tradeStake.toFixed(2)} on ${signal.marketName}`);

        // Step 7: Buy contract (does NOT wait for result)
        const { contractId, buyPrice } = await derivApi.buyContract({
          contract_type: contractType,
          symbol: signal.symbol,
          duration: 1,
          duration_unit: 't',
          basis: 'stake',
          amount: tradeStake,
          barrier: barrier || undefined,
        });

        addLog(`⏳ Contract ${contractId} opened @ ${buyPrice} — WAITING for Deriv to settle...`);

        // Step 8: WAIT for contract to FULLY CLOSE — API-confirmed result
        const result = await derivApi.waitForContractResult(contractId);

        const won = result.status === 'won';
        const pnl = result.profit;

        addLog(`${won ? '✅ WIN' : '❌ LOSS'} | Profit: ${pnl.toFixed(2)} | Contract ${contractId}`);

        if (soundEnabled) {
          try {
            const ctx = new AudioContext();
            const osc = ctx.createOscillator();
            osc.frequency.value = won ? 880 : 440;
            osc.connect(ctx.destination);
            osc.start();
            setTimeout(() => { osc.stop(); ctx.close(); }, 200);
          } catch {}
        }

        setTrades(prev => prev.map(t =>
          t.id === id ? { ...t, result: won ? 'Win' : 'Loss', pnl } : t
        ));

        totalPnl += pnl;
        totalTrades++;

        // Step 9: Martingale logic — REVERSED
        // WIN → apply martingale (increase stake)
        // LOSS → reset stake
        const lastResult = won ? 'won' as const : 'lost' as const;
        if (martingaleEnabled) {
          const recovery = getRecoveryAction(rState, mult, lastResult);
          recoveryStates[signal.symbol] = recovery.newState;
          addLog(`💰 Stake: ${recovery.nextStake.toFixed(2)} | Recovery: ${recovery.newState.inRecovery ? 'YES' : 'NO'}`);
        } else {
          // Not using martingale - just track recovery state
          if (won) {
            recoveryStates[signal.symbol] = { ...rState, lastWasLoss: false, inRecovery: false };
          } else {
            recoveryStates[signal.symbol] = { ...rState, lastWasLoss: true, inRecovery: true, currentStake: baseStake };
          }
        }

        // Step 10: Check SL/TP
        if (totalPnl <= -sl) {
          addLog(`🛑 STOP LOSS hit: ${totalPnl.toFixed(2)}`);
          break;
        }
        if (totalPnl >= tp) {
          addLog(`🎯 TAKE PROFIT hit: ${totalPnl.toFixed(2)}`);
          break;
        }

        // Small delay before next cycle
        await new Promise(r => setTimeout(r, 500));
      } catch (err: any) {
        addLog(`⚠️ Error: ${err.message}`);
        await new Promise(r => setTimeout(r, 3000));
      }
    }

    addLog(`🏁 Session ended. Trades: ${totalTrades}, P/L: ${totalPnl.toFixed(2)}`);
    setIsRunning(false);
    runningRef.current = false;
  }, [isAuthorized, isRunning, stake, multiplier, martingaleEnabled, stopLoss, takeProfit, tickCount, liveDigits, soundEnabled, addLog]);

  const stopSmartBot = useCallback(() => {
    runningRef.current = false;
    setIsRunning(false);
    addLog('🔴 Smart Bot STOPPED by user');
  }, [addLog]);

  const activeDigits = activeMarket ? (liveDigits[activeMarket] || []).slice(-30) : [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Zap className="w-5 h-5 text-warning" /> Smart Signal Bot
          </h1>
          <p className="text-xs text-muted-foreground">
            Scans all volatilities • API-verified results • Reversed martingale
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSoundEnabled(!soundEnabled)}
            className="h-8"
          >
            {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      {/* Top: Config + Launch */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-3 space-y-4">
          <div className="bg-card border border-border rounded-xl p-4 space-y-3">
            <h2 className="font-semibold text-foreground text-sm flex items-center gap-1">
              <Shield className="w-4 h-4" /> Bot Configuration
            </h2>

            <div>
              <label className="text-[10px] text-muted-foreground">Base Stake (USD)</label>
              <Input type="number" min="0.35" step="0.01" value={stake}
                onChange={e => setStake(e.target.value)} disabled={isRunning} className="h-8 text-xs" />
            </div>

            <div className="flex items-center justify-between">
              <label className="text-xs text-foreground">Martingale on WIN</label>
              <Switch checked={martingaleEnabled} onCheckedChange={setMartingaleEnabled} disabled={isRunning} />
            </div>

            {martingaleEnabled && (
              <div>
                <label className="text-[10px] text-muted-foreground">Multiplier</label>
                <Input type="number" min="1.1" step="0.1" value={multiplier}
                  onChange={e => setMultiplier(e.target.value)} disabled={isRunning} className="h-8 text-xs" />
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-muted-foreground">Stop Loss</label>
                <Input type="number" value={stopLoss}
                  onChange={e => setStopLoss(e.target.value)} disabled={isRunning} className="h-8 text-xs" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">Take Profit</label>
                <Input type="number" value={takeProfit}
                  onChange={e => setTakeProfit(e.target.value)} disabled={isRunning} className="h-8 text-xs" />
              </div>
            </div>

            <div>
              <label className="text-[10px] text-muted-foreground">Tick History Count</label>
              <Select value={tickCount} onValueChange={setTickCount} disabled={isRunning}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['30', '50', '100', '200', '500'].map(n => (
                    <SelectItem key={n} value={n}>Last {n} ticks</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* LOAD SMART BOT & TRADE Button */}
            {!isRunning ? (
              <Button
                onClick={startSmartBot}
                disabled={!isAuthorized}
                className="w-full h-11 text-sm font-bold bg-profit hover:bg-profit/90 text-profit-foreground"
              >
                <Play className="w-4 h-4 mr-2" />
                🟢 LOAD SMART BOT & TRADE
              </Button>
            ) : (
              <Button
                onClick={stopSmartBot}
                variant="destructive"
                className="w-full h-11 text-sm font-bold"
              >
                <StopCircle className="w-4 h-4 mr-2" />
                STOP SMART BOT
              </Button>
            )}

            {isRunning && (
              <div className="flex items-center gap-2 text-xs text-warning">
                <Loader2 className="w-3 h-3 animate-spin" />
                Bot is running — settings locked
              </div>
            )}
          </div>

          {/* Martingale Rules Card */}
          <div className="bg-card border border-border rounded-xl p-4">
            <h3 className="text-xs font-semibold text-foreground mb-2">📋 Martingale Rules</h3>
            <div className="space-y-1 text-[10px] text-muted-foreground">
              <div className="flex items-center gap-1"><CheckCircle className="w-3 h-3 text-profit" /> WIN → Multiply stake</div>
              <div className="flex items-center gap-1"><XCircle className="w-3 h-3 text-loss" /> LOSS → Reset to base</div>
              <div className="flex items-center gap-1"><AlertTriangle className="w-3 h-3 text-warning" /> No stacking — wait for API result</div>
            </div>
          </div>
        </div>

        {/* Center: Signal Scanner + Digit Display */}
        <div className="lg:col-span-5 space-y-4">
          {/* Live Signal Scanner */}
          <div className="bg-card border border-border rounded-xl p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-1">
              <TrendingUp className="w-4 h-4 text-primary" /> Live Signal Scanner
              <Badge variant="outline" className="ml-auto text-[10px]">
                {validSignals.length}/{MARKETS.length} valid
              </Badge>
            </h3>
            <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
              {signals.slice(0, 10).map(s => (
                <div
                  key={s.symbol}
                  className={`flex items-center justify-between p-2 rounded-lg text-xs ${
                    s.isValid ? 'bg-profit/10 border border-profit/30' : 'bg-muted'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {s.isValid ? (
                      <CheckCircle className="w-3.5 h-3.5 text-profit" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 text-muted-foreground" />
                    )}
                    <span className="font-mono font-semibold">{s.marketName}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={s.signalStrength >= 6 ? 'default' : 'secondary'} className="text-[9px]">
                      STR: {s.signalStrength}
                    </Badge>
                    {s.isValid && (
                      <span className="font-mono text-profit">
                        {s.suggestedContract.replace('DIGIT', '')} {s.suggestedBarrier}
                      </span>
                    )}
                  </div>
                </div>
              ))}
              {signals.length === 0 && (
                <div className="text-center text-muted-foreground text-xs py-4">
                  Waiting for tick data from all markets...
                </div>
              )}
            </div>
          </div>

          {/* Active Market Digit Display */}
          {activeMarket && activeDigits.length > 0 && (
            <DigitDisplay digits={activeDigits} barrier={selectedDigit} />
          )}

          {/* Smart Digit Grid for any market with data */}
          {activeMarket && (liveDigits[activeMarket] || []).length > 10 && (
            <SmartDigitGrid
              digits={(liveDigits[activeMarket] || []).slice(-200)}
              barrier={selectedDigit}
              onSelectDigit={setSelectedDigit}
              selectedDigit={selectedDigit}
            />
          )}
        </div>

        {/* Right: Trade Log + Status */}
        <div className="lg:col-span-4 space-y-4">
          {/* Session Stats */}
          <div className="bg-card border border-border rounded-xl p-4">
            <h3 className="text-sm font-semibold text-foreground mb-2">Session</h3>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'Balance', value: `$${balance.toFixed(2)}`, color: 'text-foreground' },
                { label: 'Wins', value: trades.filter(t => t.result === 'Win').length, color: 'text-profit' },
                { label: 'Losses', value: trades.filter(t => t.result === 'Loss').length, color: 'text-loss' },
                {
                  label: 'P/L',
                  value: `$${trades.reduce((s, t) => s + t.pnl, 0).toFixed(2)}`,
                  color: trades.reduce((s, t) => s + t.pnl, 0) >= 0 ? 'text-profit' : 'text-loss',
                },
                { label: 'Trades', value: trades.filter(t => t.result !== 'Pending').length, color: 'text-foreground' },
                {
                  label: 'Active',
                  value: activeMarket || '—',
                  color: 'text-primary',
                },
              ].map(s => (
                <div key={s.label} className="bg-muted rounded-lg p-2 text-center">
                  <div className="text-[9px] text-muted-foreground">{s.label}</div>
                  <div className={`font-mono text-xs font-bold ${s.color}`}>{s.value}</div>
                </div>
              ))}
            </div>
          </div>

          <TradeLogComponent trades={trades} />

          {/* Status Log */}
          <div className="bg-card border border-border rounded-xl p-4">
            <h3 className="text-sm font-semibold text-foreground mb-2">Bot Log</h3>
            <div className="max-h-[200px] overflow-y-auto space-y-0.5">
              {statusLog.map((log, i) => (
                <div key={i} className="text-[10px] text-muted-foreground font-mono leading-relaxed">
                  {log}
                </div>
              ))}
              {statusLog.length === 0 && (
                <div className="text-[10px] text-muted-foreground text-center py-4">
                  Press "Load Smart Bot & Trade" to begin
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
