import { useState, useRef, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import { derivApi, type MarketSymbol } from '@/services/deriv-api';
import { getLastDigit } from '@/services/analysis';
import { useAuth } from '@/contexts/AuthContext';
import TradeConfig, { type TradeConfigState } from '@/components/auto-trade/TradeConfig';
import DigitDisplay from '@/components/auto-trade/DigitDisplay';
import PercentagePanel from '@/components/auto-trade/PercentagePanel';
import PatternStrategy, { doesPatternMatch, type PatternCondition } from '@/components/auto-trade/PatternStrategy';
import SignalAlerts from '@/components/auto-trade/SignalAlerts';
import StatsPanel from '@/components/auto-trade/StatsPanel';
import TradeLogComponent from '@/components/auto-trade/TradeLog';
import { type TradeLog } from '@/components/auto-trade/types';

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

export default function AutoTrade() {
  const { isAuthorized, activeAccount, balance } = useAuth();

  const [config, setConfig] = useState<TradeConfigState>({
    market: 'R_100',
    contractType: 'DIGITOVER',
    digit: '4',
    stake: '1',
    martingale: false,
    multiplier: '2',
    stopLoss: '10',
    takeProfit: '20',
    maxTrades: '50',
  });

  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [trades, setTrades] = useState<TradeLog[]>([]);
  const [digits, setDigits] = useState<number[]>([]);
  const [currentStake, setCurrentStake] = useState(1);
  const runningRef = useRef(false);
  const pausedRef = useRef(false);
  const tradeIdRef = useRef(0);

  const [patternEnabled, setPatternEnabled] = useState(false);
  const [patternLength, setPatternLength] = useState(3);
  const [pattern, setPattern] = useState<PatternCondition[]>(['Odd', 'Odd', 'Even']);
  const [soundEnabled, setSoundEnabled] = useState(false);

  const barrier = parseInt(config.digit);

  const handleConfigChange = useCallback(<K extends keyof TradeConfigState>(key: K, val: TradeConfigState[K]) => {
    setConfig(prev => ({ ...prev, [key]: val }));
  }, []);

  const handlePatternLengthChange = useCallback((len: number) => {
    setPatternLength(len);
    setPattern(prev => {
      const next = [...prev];
      while (next.length < len) next.push('Any');
      return next.slice(0, len);
    });
  }, []);

  const handlePatternChange = useCallback((idx: number, val: PatternCondition) => {
    setPattern(prev => {
      const next = [...prev];
      next[idx] = val;
      return next;
    });
  }, []);

  // Subscribe to ticks for digit tracking
  useEffect(() => {
    if (!derivApi.isConnected) return;
    let active = true;
    const handler = (data: any) => {
      if (data.tick && data.tick.symbol === config.market && active) {
        const d = getLastDigit(data.tick.quote);
        setDigits(prev => [...prev, d].slice(-30));
      }
    };
    const unsub = derivApi.onMessage(handler);
    derivApi.subscribeTicks(config.market, () => {}).catch(console.error);
    return () => { active = false; unsub(); };
  }, [config.market]);

  // Main trading loop — FIXED: API-confirmed results + reversed martingale
  const startTrading = useCallback(async () => {
    if (!isAuthorized || isRunning) return;
    setIsRunning(true);
    runningRef.current = true;
    pausedRef.current = false;
    setIsPaused(false);

    await derivApi.subscribeTicks(config.market, () => {});

    let stake = parseFloat(config.stake);
    setCurrentStake(stake);
    let totalPnl = 0;
    let tradeCount = 0;
    const maxTradeCount = parseInt(config.maxTrades);
    const sl = parseFloat(config.stopLoss);
    const tp = parseFloat(config.takeProfit);
    const mult = parseFloat(config.multiplier);
    const needsDigit = ['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'].includes(config.contractType);

    while (runningRef.current && tradeCount < maxTradeCount) {
      if (pausedRef.current) {
        await new Promise(r => setTimeout(r, 500));
        continue;
      }

      try {
        // Wait for fresh tick before placing trade
        const freshTick = await waitForNextTick(config.market);
        const extractedDigit = getLastDigit(freshTick.quote);

        console.log('── TRADE CYCLE ──');
        console.log('Tick:', freshTick.quote, '→ digit:', extractedDigit);

        // Pattern check
        if (patternEnabled) {
          const recentDigits = [...digits, extractedDigit].slice(-30);
          if (!doesPatternMatch(recentDigits, pattern, barrier)) {
            continue;
          }
        }

        const params: any = {
          contract_type: config.contractType,
          symbol: config.market,
          duration: 1,
          duration_unit: 't',
          basis: 'stake',
          amount: stake,
        };
        if (needsDigit) params.barrier = config.digit;

        const id = ++tradeIdRef.current;
        const now = new Date().toLocaleTimeString();

        setTrades(prev => [{
          id, time: now, market: config.market, contract: config.contractType,
          stake, result: 'Pending' as const, pnl: 0,
        }, ...prev].slice(0, 100));

        // Buy contract (non-blocking)
        const { contractId, buyPrice } = await derivApi.buyContract(params);
        console.log(`Contract ${contractId} opened @ ${buyPrice} — waiting for settlement...`);

        // WAIT for Deriv to confirm result
        const result = await derivApi.waitForContractResult(contractId);
        const won = result.status === 'won';
        const pnl = result.profit;

        console.log(`Result: ${won ? 'WIN' : 'LOSS'} | P/L: ${pnl} (API-confirmed)`);

        setTrades(prev => prev.map(t =>
          t.id === id ? { ...t, result: won ? 'Win' : 'Loss', pnl } : t
        ));

        totalPnl += pnl;
        tradeCount++;

        // REVERSED MARTINGALE: WIN → multiply, LOSS → reset
        if (config.martingale) {
          if (won) {
            stake *= mult;
          } else {
            stake = parseFloat(config.stake);
          }
        } else {
          stake = parseFloat(config.stake);
        }
        setCurrentStake(stake);

        // Stop Loss / Take Profit
        if (totalPnl <= -sl || totalPnl >= tp) {
          console.log('SL/TP hit. Total P/L:', totalPnl);
          runningRef.current = false;
        }

        await new Promise(r => setTimeout(r, 500));
      } catch (err) {
        console.error('Trade error:', err);
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    setIsRunning(false);
    runningRef.current = false;
  }, [isAuthorized, isRunning, config, patternEnabled, pattern, barrier, digits]);

  const pauseTrading = () => {
    pausedRef.current = !pausedRef.current;
    setIsPaused(!isPaused);
  };

  const stopTrading = () => {
    runningRef.current = false;
    setIsRunning(false);
    setIsPaused(false);
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-foreground">Digit Trading Bot</h1>
        <p className="text-xs text-muted-foreground">API-confirmed results • Reversed martingale (WIN → multiply)</p>
      </div>

      <StatsPanel
        trades={trades}
        balance={balance}
        currentStake={currentStake}
        market={config.market}
        currency={activeAccount?.currency || 'USD'}
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-3 space-y-4">
          <TradeConfig
            config={config}
            onChange={handleConfigChange}
            isRunning={isRunning}
            isPaused={isPaused}
            isAuthorized={isAuthorized}
            currency={activeAccount?.currency || 'USD'}
            onStart={startTrading}
            onPause={pauseTrading}
            onStop={stopTrading}
          />
          <PatternStrategy
            enabled={patternEnabled}
            onToggle={setPatternEnabled}
            patternLength={patternLength}
            onLengthChange={handlePatternLengthChange}
            pattern={pattern}
            onPatternChange={handlePatternChange}
            disabled={isRunning}
          />
        </div>

        <div className="lg:col-span-4 space-y-4">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <DigitDisplay digits={digits} barrier={barrier} />
          </motion.div>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}>
            <PercentagePanel
              digits={digits}
              barrier={barrier}
              selectedDigit={barrier}
              onSelectDigit={d => handleConfigChange('digit', String(d))}
            />
          </motion.div>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}>
            <SignalAlerts
              digits={digits}
              barrier={barrier}
              soundEnabled={soundEnabled}
              onSoundToggle={setSoundEnabled}
            />
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
