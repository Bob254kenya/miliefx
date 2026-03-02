import { useState, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { derivApi, MARKETS, type MarketSymbol } from '@/services/deriv-api';
import { getLastDigit } from '@/services/analysis';
import { useAuth } from '@/contexts/AuthContext';
import { useTickLoader } from '@/hooks/useTickLoader';
import TradeConfig, { type TradeConfigState } from '@/components/auto-trade/TradeConfig';
import DigitDisplay from '@/components/auto-trade/DigitDisplay';
import PercentagePanel from '@/components/auto-trade/PercentagePanel';
import SignalAlerts from '@/components/auto-trade/SignalAlerts';
import StatsPanel from '@/components/auto-trade/StatsPanel';
import TradeLogComponent from '@/components/auto-trade/TradeLog';
import { type TradeLog } from '@/components/auto-trade/types';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { Loader2, Play, StopCircle, Pause } from 'lucide-react';

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
  try { if ('speechSynthesis' in window) { window.speechSynthesis.speak(new SpeechSynthesisUtterance(text)); } } catch {}
}

export default function AutoTrade() {
  const { isAuthorized, activeAccount, balance } = useAuth();

  const [config, setConfig] = useState<TradeConfigState>({
    market: 'R_100', contractType: 'DIGITOVER', digit: '4', stake: '1',
    martingale: false, multiplier: '2', stopLoss: '10', takeProfit: '20', maxTrades: '50',
  });

  const [tickRange, setTickRange] = useState<number>(100);
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [trades, setTrades] = useState<TradeLog[]>([]);
  const [currentStake, setCurrentStake] = useState(1);
  const [soundEnabled, setSoundEnabled] = useState(false);

  // Over + Even/Odd Recovery Bot state
  const [recoveryEnabled, setRecoveryEnabled] = useState(false);
  const [recoveryRunning, setRecoveryRunning] = useState(false);
  const recoveryRunningRef = useRef(false);
  const recoveryPausedRef = useRef(false);
  const [recoveryPaused, setRecoveryPaused] = useState(false);
  const [recoveryDigit, setRecoveryDigit] = useState(4);
  const [recoveryMode, setRecoveryMode] = useState<'DIGITEVEN' | 'DIGITODD'>('DIGITEVEN');
  const recoveryDigitRef = useRef(4);
  const recoveryModeRef = useRef<'DIGITEVEN' | 'DIGITODD'>('DIGITEVEN');

  const runningRef = useRef(false);
  const pausedRef = useRef(false);
  const tradeIdRef = useRef(0);

  const { digits, prices, isLoading, tickCount } = useTickLoader(config.market, 1000);

  const analysisDigits = digits.slice(-tickRange);
  const barrier = parseInt(config.digit);

  const handleConfigChange = useCallback(<K extends keyof TradeConfigState>(key: K, val: TradeConfigState[K]) => {
    setConfig(prev => ({ ...prev, [key]: val }));
  }, []);

  // Main trading loop
  const startTrading = useCallback(async () => {
    if (!isAuthorized || isRunning) return;
    const stakeNum = parseFloat(config.stake);
    if (balance < stakeNum) { toast.error('Insufficient balance — Bot halted'); return; }

    setIsRunning(true);
    runningRef.current = true;
    pausedRef.current = false;
    setIsPaused(false);

    let stake = stakeNum;
    setCurrentStake(stake);
    let totalPnl = 0;
    let tradeCount = 0;
    const maxTradeCount = parseInt(config.maxTrades);
    const sl = parseFloat(config.stopLoss);
    const tp = parseFloat(config.takeProfit);
    const mult = parseFloat(config.multiplier);

    while (runningRef.current && tradeCount < maxTradeCount) {
      if (pausedRef.current) { await new Promise(r => setTimeout(r, 500)); continue; }
      if (balance < stake) { toast.error('Insufficient balance — Bot halted'); runningRef.current = false; break; }

      try {
        const mkt = config.market;
        const freshTick = await waitForNextTick(mkt);
        const extractedDigit = getLastDigit(freshTick.quote);
        if (extractedDigit < 0 || extractedDigit > 9 || Number.isNaN(extractedDigit)) continue;

        const contractType = config.contractType;
        const tradeBarrier = config.digit;
        const needsBarrier = ['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'].includes(contractType);

        const params: any = {
          contract_type: contractType, symbol: mkt,
          duration: 1, duration_unit: 't', basis: 'stake', amount: stake,
        };
        if (needsBarrier && tradeBarrier !== undefined && tradeBarrier !== null) {
          params.barrier = tradeBarrier;
        }

        const id = ++tradeIdRef.current;
        const now = new Date().toLocaleTimeString();
        setTrades(prev => [{ id, time: now, market: mkt, contract: contractType, stake, result: 'Pending' as const, pnl: 0 }, ...prev].slice(0, 100));

        const { contractId } = await derivApi.buyContract(params);
        const result = await derivApi.waitForContractResult(contractId);
        const won = result.status === 'won';
        const pnl = result.profit;

        setTrades(prev => prev.map(t => t.id === id ? { ...t, result: won ? 'Win' : 'Loss', pnl } : t));
        totalPnl += pnl;
        tradeCount++;

        if (config.martingale) {
          if (won) stake = parseFloat(config.stake);
          else stake *= mult;
        } else { stake = parseFloat(config.stake); }
        setCurrentStake(stake);

        if (totalPnl <= -sl) {
          toast.error(`🛑 Stop Loss Hit! P/L: $${totalPnl.toFixed(2)}`, { duration: 10000 });
          speakMessage('Stop loss hit. Bot stopped.');
          runningRef.current = false;
        }
        if (totalPnl >= tp) {
          toast.success(`🎊 Take Profit Hit! +$${totalPnl.toFixed(2)}`, { duration: 15000 });
          speakMessage('Congratulations! Your take profit has been hit!');
          runningRef.current = false;
        }
        await new Promise(r => setTimeout(r, 500));
      } catch (err: any) {
        if (err.message?.includes('Insufficient balance')) {
          toast.error('Insufficient balance — Bot halted');
          runningRef.current = false;
        } else {
          console.error('Trade error:', err);
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    }
    setIsRunning(false);
    runningRef.current = false;
  }, [isAuthorized, isRunning, config, balance]);

  // ─── OVER + EVEN/ODD RECOVERY BOT ───
  const startRecoveryBot = useCallback(async () => {
    if (!isAuthorized || recoveryRunning) return;
    const stakeNum = parseFloat(config.stake);
    if (balance < stakeNum) { toast.error('Insufficient balance'); return; }

    setRecoveryRunning(true);
    recoveryRunningRef.current = true;
    recoveryPausedRef.current = false;
    setRecoveryPaused(false);

    let stake = stakeNum;
    let totalPnl = 0;
    let tradeCount = 0;
    const maxTradeCount = parseInt(config.maxTrades);
    const sl = parseFloat(config.stopLoss);
    const tp = parseFloat(config.takeProfit);
    const mult = parseFloat(config.multiplier);
    let inRecovery = false; // After Over loss, switch to Even/Odd recovery

    while (recoveryRunningRef.current && tradeCount < maxTradeCount) {
      if (recoveryPausedRef.current) { await new Promise(r => setTimeout(r, 500)); continue; }
      if (balance < stake) { toast.error('Insufficient balance — Recovery Bot halted'); recoveryRunningRef.current = false; break; }

      try {
        const mkt = config.market;
        await waitForNextTick(mkt);

        // Primary: Trade OVER with selected barrier
        // Recovery: Trade EVEN or ODD (alternating on consecutive losses)
        let contractType: string;
        let barrier: string | undefined;

        if (!inRecovery) {
          contractType = 'DIGITOVER';
          barrier = String(recoveryDigitRef.current);
        } else {
          contractType = recoveryModeRef.current;
          barrier = undefined;
        }

        const params: any = {
          contract_type: contractType, symbol: mkt,
          duration: 1, duration_unit: 't', basis: 'stake', amount: stake,
        };
        if (barrier !== undefined) params.barrier = barrier;

        const id = ++tradeIdRef.current;
        const now = new Date().toLocaleTimeString();
        const label = inRecovery ? `${contractType} (Recovery)` : contractType;
        setTrades(prev => [{ id, time: now, market: mkt, contract: label, stake, result: 'Pending' as const, pnl: 0 }, ...prev].slice(0, 100));

        const { contractId } = await derivApi.buyContract(params);
        const result = await derivApi.waitForContractResult(contractId);
        const won = result.status === 'won';
        const pnl = result.profit;

        setTrades(prev => prev.map(t => t.id === id ? { ...t, result: won ? 'Win' : 'Loss', pnl } : t));
        totalPnl += pnl;
        tradeCount++;

        if (won) {
          // WIN → reset to base stake, go back to primary Over
          stake = stakeNum;
          inRecovery = false;
        } else {
          // LOSS → switch to recovery (Even/Odd), apply martingale if enabled
          inRecovery = true;
          if (config.martingale) stake *= mult;
        }
        setCurrentStake(stake);

        if (totalPnl <= -sl) {
          toast.error(`🛑 Recovery Bot Stop Loss! P/L: $${totalPnl.toFixed(2)}`, { duration: 10000 });
          speakMessage('Stop loss hit. Recovery bot stopped.');
          recoveryRunningRef.current = false;
        }
        if (totalPnl >= tp) {
          toast.success(`🎊 Recovery Bot Take Profit! +$${totalPnl.toFixed(2)}`, { duration: 15000 });
          speakMessage('Congratulations! Your take profit has been hit!');
          recoveryRunningRef.current = false;
        }
        await new Promise(r => setTimeout(r, 500));
      } catch (err: any) {
        if (err.message?.includes('Insufficient balance')) {
          toast.error('Insufficient balance — Recovery Bot halted');
          recoveryRunningRef.current = false;
        } else {
          console.error('Recovery bot error:', err);
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    }
    setRecoveryRunning(false);
    recoveryRunningRef.current = false;
  }, [isAuthorized, recoveryRunning, config, balance]);

  const pauseTrading = () => { pausedRef.current = !pausedRef.current; setIsPaused(!isPaused); };
  const stopTrading = () => { runningRef.current = false; setIsRunning(false); setIsPaused(false); };
  const pauseRecovery = () => { recoveryPausedRef.current = !recoveryPausedRef.current; setRecoveryPaused(!recoveryPaused); };
  const stopRecovery = () => { recoveryRunningRef.current = false; setRecoveryRunning(false); setRecoveryPaused(false); };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Digit Trading Bot</h1>
          <p className="text-xs text-muted-foreground">API-confirmed results • Standard martingale (LOSS → multiply)</p>
        </div>
        {isLoading ? (
          <div className="flex items-center gap-2 text-xs text-warning">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Fetching 1000 ticks...
          </div>
        ) : (
          <Badge variant="outline" className="text-[10px]">{tickCount} ticks loaded</Badge>
        )}
      </div>

      <StatsPanel trades={trades} balance={balance} currentStake={currentStake} market={config.market} currency={activeAccount?.currency || 'USD'} />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-3 space-y-4">
          <TradeConfig
            config={config} onChange={handleConfigChange}
            isRunning={isRunning || recoveryRunning} isPaused={isPaused}
            isAuthorized={isAuthorized && balance >= parseFloat(config.stake || '0')}
            currency={activeAccount?.currency || 'USD'}
            onStart={startTrading} onPause={pauseTrading} onStop={stopTrading}
          />

          {/* Tick Range */}
          <div className="bg-card border border-border rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">Analysis Window</h3>
              <span className="text-xs font-mono text-primary">{tickRange} ticks</span>
            </div>
            <Slider min={1} max={1000} step={1} value={[tickRange]}
              onValueChange={([v]) => setTickRange(v)} disabled={isRunning || recoveryRunning} />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>1</span><span>500</span><span>1000</span>
            </div>
          </div>

          {/* Over + Even/Odd Recovery Bot */}
          <div className="bg-card border border-border rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">Over + Recovery Bot</h3>
              <Switch checked={recoveryEnabled} onCheckedChange={setRecoveryEnabled} disabled={recoveryRunning} />
            </div>
            {recoveryEnabled && (
              <>
                {/* Over Digit Selector */}
                <div>
                  <label className="text-[10px] text-muted-foreground">Over Digit (Barrier)</label>
                  <div className="grid grid-cols-5 gap-1 mt-1">
                    {Array.from({ length: 10 }, (_, i) => (
                      <button
                        key={i}
                        onClick={() => { setRecoveryDigit(i); recoveryDigitRef.current = i; }}
                        disabled={recoveryRunning}
                        className={`h-7 rounded text-xs font-mono font-bold transition-all ${
                          recoveryDigit === i
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-foreground hover:bg-secondary'
                        }`}
                      >
                        {i}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Recovery Mode */}
                <div>
                  <label className="text-[10px] text-muted-foreground">Recovery Mode</label>
                  <div className="flex gap-1 mt-1">
                    <button
                      onClick={() => { setRecoveryMode('DIGITEVEN'); recoveryModeRef.current = 'DIGITEVEN'; }}
                      disabled={recoveryRunning}
                      className={`flex-1 h-7 rounded text-xs font-bold transition-all ${
                        recoveryMode === 'DIGITEVEN'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-foreground hover:bg-secondary'
                      }`}
                    >
                      Even
                    </button>
                    <button
                      onClick={() => { setRecoveryMode('DIGITODD'); recoveryModeRef.current = 'DIGITODD'; }}
                      disabled={recoveryRunning}
                      className={`flex-1 h-7 rounded text-xs font-bold transition-all ${
                        recoveryMode === 'DIGITODD'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-foreground hover:bg-secondary'
                      }`}
                    >
                      Odd
                    </button>
                  </div>
                </div>

                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  Starts with <span className="text-profit font-bold">OVER {recoveryDigit}</span>.
                  On loss → recovers with <span className="text-primary font-bold">{recoveryMode === 'DIGITEVEN' ? 'EVEN' : 'ODD'}</span>.
                  On win → resets to OVER. Martingale applies on losses only.
                </p>

                <div className="flex gap-2">
                  {!recoveryRunning ? (
                    <Button onClick={startRecoveryBot}
                      disabled={!isAuthorized || isRunning || balance < parseFloat(config.stake || '0')}
                      className="flex-1 h-8 bg-profit hover:bg-profit/90 text-profit-foreground text-xs">
                      <Play className="w-3 h-3 mr-1" /> Start Recovery Bot
                    </Button>
                  ) : (
                    <>
                      <Button onClick={pauseRecovery} variant="outline" className="flex-1 h-8 text-xs">
                        <Pause className="w-3 h-3 mr-1" /> {recoveryPaused ? 'Resume' : 'Pause'}
                      </Button>
                      <Button onClick={stopRecovery} variant="destructive" className="flex-1 h-8 text-xs">
                        <StopCircle className="w-3 h-3 mr-1" /> Stop
                      </Button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="lg:col-span-4 space-y-4">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <DigitDisplay digits={analysisDigits.slice(-30)} barrier={barrier} />
          </motion.div>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}>
            <PercentagePanel digits={analysisDigits} barrier={barrier} selectedDigit={barrier} onSelectDigit={d => handleConfigChange('digit', String(d))} />
          </motion.div>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}>
            <SignalAlerts digits={analysisDigits} barrier={barrier} soundEnabled={soundEnabled} onSoundToggle={setSoundEnabled} />
          </motion.div>
        </div>

        <div className="lg:col-span-5">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }}>
            <TradeLogComponent trades={trades} />
          </motion.div>
        </div>
      </div>
    </div>
  );
}
