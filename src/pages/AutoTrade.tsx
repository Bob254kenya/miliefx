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

/**
 * Wait for a fresh tick on a given symbol.
 * Resolves with the new tick data so we can extract the confirmed digit.
 */
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

  // Trade configuration
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

  // Runtime state
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [trades, setTrades] = useState<TradeLog[]>([]);
  const [digits, setDigits] = useState<number[]>([]);
  const [currentStake, setCurrentStake] = useState(1);
  const runningRef = useRef(false);
  const pausedRef = useRef(false);
  const tradeIdRef = useRef(0);

  // Pattern strategy state
  const [patternEnabled, setPatternEnabled] = useState(false);
  const [patternLength, setPatternLength] = useState(3);
  const [pattern, setPattern] = useState<PatternCondition[]>(['Odd', 'Odd', 'Even']);

  // Signal sound
  const [soundEnabled, setSoundEnabled] = useState(false);

  const barrier = parseInt(config.digit);

  // Handle config changes
  const handleConfigChange = useCallback(<K extends keyof TradeConfigState>(key: K, val: TradeConfigState[K]) => {
    setConfig(prev => ({ ...prev, [key]: val }));
  }, []);

  // Handle pattern change with auto-resize
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

  // Subscribe to ticks for digit tracking (even when not trading)
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

    return () => {
      active = false;
      unsub();
    };
  }, [config.market]);

  // Main trading loop
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
    const needsDigit = ['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'].includes(config.contractType);

    while (runningRef.current && tradeCount < maxTradeCount) {
      if (pausedRef.current) {
        await new Promise(r => setTimeout(r, 500));
        continue;
      }

      try {
        // FIX: Wait for fresh tick before placing trade
        const freshTick = await waitForNextTick(config.market);
        const extractedDigit = getLastDigit(freshTick.quote);

        // Debug logging — digit 0 is valid
        console.log('──── TRADE CYCLE ────');
        console.log('Tick quote:', freshTick.quote);
        console.log('Extracted digit:', extractedDigit, '(type:', typeof extractedDigit, ')');
        console.log('Contract type:', config.contractType);
        console.log('Barrier:', needsDigit ? config.digit : 'N/A');

        // Pattern check — skip if enabled and not matched
        if (patternEnabled) {
          const recentDigits = [...digits, extractedDigit].slice(-30);
          if (!doesPatternMatch(recentDigits, pattern, barrier)) {
            console.log('Pattern not matched, skipping trade');
            continue;
          }
          console.log('✓ Pattern matched, entering trade');
        }

        const params: any = {
          contract_type: config.contractType,
          symbol: config.market,
          duration: 1,
          duration_unit: 't',
          basis: 'stake',
          amount: stake,
        };
        if (needsDigit) {
          params.barrier = config.digit;
        }

        const id = ++tradeIdRef.current;
        const now = new Date().toLocaleTimeString();

        setTrades(prev => [{
          id, time: now, market: config.market, contract: config.contractType,
          stake, result: 'Pending' as const, pnl: 0,
        }, ...prev].slice(0, 100));

        const result = await derivApi.buy(params);
        const pnl = result.buy?.profit || 0;
        const won = pnl > 0;

        console.log('Result:', won ? 'WIN' : 'LOSS', '| P/L:', pnl);
        console.log('─────────────────────');

        setTrades(prev => prev.map(t =>
          t.id === id ? { ...t, result: won ? 'Win' : 'Loss', pnl } : t
        ));

        totalPnl += pnl;
        tradeCount++;

        // Martingale logic
        if (config.martingale && !won) {
          stake *= parseFloat(config.multiplier);
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
    console.log('Session ended. Trades:', tradeCount, 'P/L:', totalPnl);
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
        <p className="text-xs text-muted-foreground">Real-time analysis, pattern strategies & automated execution</p>
      </div>

      {/* Stats bar */}
      <StatsPanel
        trades={trades}
        balance={balance}
        currentStake={currentStake}
        market={config.market}
        currency={activeAccount?.currency || 'USD'}
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left column: Config + Pattern */}
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

        {/* Center column: Digits + Percentages + Signals */}
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

        {/* Right column: Trade Log */}
        <div className="lg:col-span-5">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }}>
            <TradeLogComponent trades={trades} />
          </motion.div>
        </div>
      </div>
    </div>
  );
}
