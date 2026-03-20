import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { derivApi, type MarketSymbol } from '@/services/deriv-api';
import { copyTradingService } from '@/services/copy-trading-service';
import { getLastDigit, analyzeDigits, calculateRSI } from '@/services/analysis';
import { useAuth } from '@/contexts/AuthContext';
import { useLossRequirement } from '@/hooks/useLossRequirement';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play, StopCircle, Trash2, Home, RefreshCw, Shield, Zap, TrendingUp, TrendingDown, 
  Activity, ArrowUp, ArrowDown, Target, Crown, Sparkles, Flame, Gem, Star, 
  ChevronRight, BarChart3, AlertCircle, CheckCircle2, XCircle
} from 'lucide-react';

/* ───── CONSTANTS ───── */
const ALL_MARKETS = [
  { symbol: 'R_10', name: 'Vol 10', group: 'vol' },
  { symbol: 'R_25', name: 'Vol 25', group: 'vol' },
  { symbol: 'R_50', name: 'Vol 50', group: 'vol' },
  { symbol: 'R_75', name: 'Vol 75', group: 'vol' },
  { symbol: 'R_100', name: 'Vol 100', group: 'vol' },
  { symbol: '1HZ10V', name: 'V10 1s', group: 'vol1s' },
  { symbol: '1HZ25V', name: 'V25 1s', group: 'vol1s' },
  { symbol: '1HZ50V', name: 'V50 1s', group: 'vol1s' },
  { symbol: '1HZ75V', name: 'V75 1s', group: 'vol1s' },
  { symbol: '1HZ100V', name: 'V100 1s', group: 'vol1s' },
  { symbol: 'JD10', name: 'Jump 10', group: 'jump' },
  { symbol: 'JD25', name: 'Jump 25', group: 'jump' },
  { symbol: 'JD50', name: 'Jump 50', group: 'jump' },
  { symbol: 'JD75', name: 'Jump 75', group: 'jump' },
  { symbol: 'JD100', name: 'Jump 100', group: 'jump' },
  { symbol: 'RDBEAR', name: 'Bear', group: 'bear' },
  { symbol: 'RDBULL', name: 'Bull', group: 'bull' },
];

const CONTRACT_TYPES = [
  'CALL', 'PUT', 'DIGITEVEN', 'DIGITODD', 'DIGITMATCH', 'DIGITDIFF', 'DIGITOVER', 'DIGITUNDER',
] as const;

const needsBarrier = (ct: string) => ['DIGITMATCH', 'DIGITDIFF', 'DIGITOVER', 'DIGITUNDER'].includes(ct);

type BotStatus = 'idle' | 'trading_m1' | 'recovery' | 'waiting_signal' | 'signal_matched' | 'virtual_hook';

interface SignalData {
  market: string;
  name: string;
  type: 'rise_fall' | 'even_odd' | 'over_under' | 'digit_match';
  direction: string;
  confidence: number;
  digit?: number;
  contract: string;
  barrier?: string;
}

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

function waitForNextTick(symbol: string): Promise<{ quote: number }> {
  return new Promise((resolve) => {
    const unsub = derivApi.onMessage((data: any) => {
      if (data.tick && data.tick.symbol === symbol) { unsub(); resolve({ quote: data.tick.quote }); }
    });
  });
}

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
          case 'CALL': won = true; break;
          case 'PUT': won = false; break;
        }
        resolve({ won, digit });
      }
    });
  });
}

export default function ProScannerBot() {
  const { isAuthorized, balance, activeAccount } = useAuth();
  const { recordLoss } = useLossRequirement();
  const location = useLocation();

  /* ── Market 1 config (Auto-configured by signals) ── */
  const [m1Enabled, setM1Enabled] = useState(true);
  const [m1Contract, setM1Contract] = useState('CALL');
  const [m1Barrier, setM1Barrier] = useState('5');
  const [m1Symbol, setM1Symbol] = useState('R_100');

  /* ── Market 2 config (Auto-configured by signals) ── */
  const [m2Enabled, setM2Enabled] = useState(true);
  const [m2Contract, setM2Contract] = useState('PUT');
  const [m2Barrier, setM2Barrier] = useState('5');
  const [m2Symbol, setM2Symbol] = useState('R_50');

  /* ── Virtual Hook ── */
  const [hookEnabled, setHookEnabled] = useState(false);
  const [virtualLossCount, setVirtualLossCount] = useState('3');
  const [realCount, setRealCount] = useState('2');
  const [vhFakeWins, setVhFakeWins] = useState(0);
  const [vhFakeLosses, setVhFakeLosses] = useState(0);
  const [vhConsecLosses, setVhConsecLosses] = useState(0);
  const [vhStatus, setVhStatus] = useState<'idle' | 'waiting' | 'confirmed' | 'failed'>('idle');

  /* ── Risk Management ── */
  const [stake, setStake] = useState('0.35');
  const [martingaleOn, setMartingaleOn] = useState(true);
  const [martingaleMultiplier, setMartingaleMultiplier] = useState('2.0');
  const [martingaleMaxSteps, setMartingaleMaxSteps] = useState('3');
  const [takeProfit, setTakeProfit] = useState('10');
  const [stopLoss, setStopLoss] = useState('5');

  /* ── Signal Settings ── */
  const [signalThreshold, setSignalThreshold] = useState('70');
  const [selectedMarkets, setSelectedMarkets] = useState<string[]>(['R_100', 'R_75', 'R_50', '1HZ100V', '1HZ75V']);

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

  /* ── Tick data for analysis ── */
  const tickMapRef = useRef<Map<string, number[]>>(new Map());
  const [pricesMap, setPricesMap] = useState<Map<string, number[]>>(new Map());
  const [signals, setSignals] = useState<SignalData[]>([]);
  const [strongSignals, setStrongSignals] = useState<SignalData[]>([]);

  /* ── Subscribe to ticks for all markets ── */
  useEffect(() => {
    if (!derivApi.isConnected) return;
    let active = true;

    const handler = (data: any) => {
      if (!data.tick || !active) return;
      const sym = data.tick.symbol as string;
      const price = data.tick.quote;
      const digit = getLastDigit(price);

      // Store digits for pattern matching
      const digitsArr = tickMapRef.current.get(sym) || [];
      digitsArr.push(digit);
      if (digitsArr.length > 500) digitsArr.shift();
      tickMapRef.current.set(sym, digitsArr);

      // Store prices for analysis
      const pricesArr = pricesMap.get(sym) || [];
      pricesArr.push(price);
      if (pricesArr.length > 500) pricesArr.shift();
      setPricesMap(prev => new Map(prev).set(sym, pricesArr));
    };

    const unsub = derivApi.onMessage(handler);
    
    // Subscribe to all markets
    ALL_MARKETS.forEach(m => {
      derivApi.subscribeTicks(m.symbol as MarketSymbol, () => {}).catch(() => {});
    });

    return () => { active = false; unsub(); };
  }, []);

  /* ── Analyze signals for all markets ── */
  useEffect(() => {
    const analyzeMarket = (symbol: string, name: string): SignalData | null => {
      const prices = pricesMap.get(symbol) || [];
      if (prices.length < 30) return null;

      const digits = prices.map(p => getLastDigit(p));
      const rsi = calculateRSI(prices, 14);
      const evenCount = digits.filter(d => d % 2 === 0).length;
      const evenPct = (evenCount / digits.length) * 100;
      const overCount = digits.filter(d => d > 4).length;
      const overPct = (overCount / digits.length) * 100;
      const { mostCommon, percentages } = analyzeDigits(prices);
      const bestPct = percentages[mostCommon] || 0;

      // Calculate all signal types
      const signals_list: SignalData[] = [];

      // Rise/Fall signal
      const riseFallConf = rsi < 30 ? 85 : rsi > 70 ? 25 : 50 + (50 - rsi);
      const riseFallDir = rsi < 45 ? 'Rise' : 'Fall';
      signals_list.push({
        market: symbol, name, type: 'rise_fall',
        direction: riseFallDir, confidence: Math.min(95, Math.max(10, Math.round(riseFallConf))),
        contract: riseFallDir === 'Rise' ? 'CALL' : 'PUT'
      });

      // Even/Odd signal
      const eoConf = Math.abs(evenPct - 50) * 2 + 50;
      signals_list.push({
        market: symbol, name, type: 'even_odd',
        direction: evenPct > 50 ? 'Even' : 'Odd', confidence: Math.min(90, Math.round(eoConf)),
        contract: evenPct > 50 ? 'DIGITEVEN' : 'DIGITODD'
      });

      // Over/Under signal
      const ouConf = Math.abs(overPct - 50) * 2 + 50;
      signals_list.push({
        market: symbol, name, type: 'over_under',
        direction: overPct > 50 ? 'Over' : 'Under', confidence: Math.min(90, Math.round(ouConf)),
        contract: overPct > 50 ? 'DIGITOVER' : 'DIGITUNDER',
        barrier: overPct > 50 ? '5' : '4'
      });

      // Digit Match signal
      signals_list.push({
        market: symbol, name, type: 'digit_match',
        direction: `Match ${mostCommon}`, confidence: Math.min(90, Math.round(bestPct * 3)),
        digit: mostCommon, contract: 'DIGITMATCH',
        barrier: mostCommon.toString()
      });

      // Return the strongest signal
      return signals_list.reduce((best, current) => 
        current.confidence > best.confidence ? current : best, signals_list[0]);
    };

    const allSignals: SignalData[] = [];
    for (const market of selectedMarkets) {
      const marketInfo = ALL_MARKETS.find(m => m.symbol === market);
      if (marketInfo) {
        const signal = analyzeMarket(market, marketInfo.name);
        if (signal) allSignals.push(signal);
      }
    }
    
    allSignals.sort((a, b) => b.confidence - a.confidence);
    setSignals(allSignals);
    setStrongSignals(allSignals.slice(0, 5));
  }, [pricesMap, selectedMarkets]);

  /* ── Auto-configure M1 and M2 based on strongest signals ── */
  useEffect(() => {
    if (strongSignals.length >= 2 && !isRunning) {
      // M1 gets the strongest signal
      const m1Signal = strongSignals[0];
      setM1Symbol(m1Signal.market);
      setM1Contract(m1Signal.contract);
      if (m1Signal.barrier) setM1Barrier(m1Signal.barrier);
      
      // M2 gets the second strongest signal (different type for recovery)
      const m2Signal = strongSignals[1];
      let m2ContractType = m2Signal.contract;
      
      // For recovery, use opposite of M1 if same type
      if (m1Signal.type === m2Signal.type && m1Signal.type === 'rise_fall') {
        m2ContractType = m1Signal.contract === 'CALL' ? 'PUT' : 'CALL';
      } else if (m1Signal.type === m2Signal.type && m1Signal.type === 'even_odd') {
        m2ContractType = m1Signal.contract === 'DIGITEVEN' ? 'DIGITODD' : 'DIGITEVEN';
      } else if (m1Signal.type === m2Signal.type && m1Signal.type === 'over_under') {
        m2ContractType = m1Signal.contract === 'DIGITOVER' ? 'DIGITUNDER' : 'DIGITOVER';
      }
      
      setM2Symbol(m2Signal.market);
      setM2Contract(m2ContractType);
      if (m2Signal.barrier) setM2Barrier(m2Signal.barrier);
    }
  }, [strongSignals, isRunning]);

  /* ── Check if signal meets threshold ── */
  const checkSignalCondition = useCallback((market: 1 | 2, signalType?: string): boolean => {
    const threshold = parseInt(signalThreshold) || 70;
    const targetSignal = market === 1 ? strongSignals[0] : strongSignals[1];
    
    if (targetSignal && targetSignal.confidence >= threshold) {
      if (signalType && targetSignal.type !== signalType) return false;
      return true;
    }
    return false;
  }, [signalThreshold, strongSignals]);

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
  }, []);

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
      await waitForNextTick(tradeSymbol as MarketSymbol);

      const buyParams: any = {
        contract_type: cfg.contract, symbol: tradeSymbol,
        duration: 1, duration_unit: 't', basis: 'stake', amount: cStake,
      };
      if (needsBarrier(cfg.contract)) buyParams.barrier = cfg.barrier;

      const { contractId } = await derivApi.buyContract(buyParams);
      
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
      await new Promise(r => setTimeout(r, 2000));
      return { localPnl, localBalance, cStake, mStep, inRecovery, shouldBreak: false };
    }
  }, [addLog, updateLog, m2Enabled, martingaleOn, martingaleMultiplier, martingaleMaxSteps, takeProfit, stopLoss, activeAccount, recordLoss]);

  /* ═══════════════ MAIN BOT LOOP ═══════════════ */
  const startBot = useCallback(async () => {
    if (!isAuthorized || isRunning) return;
    const baseStake = parseFloat(stake);
    if (baseStake < 0.35) { toast.error('Min stake $0.35'); return; }
    if (!m1Enabled && !m2Enabled) { toast.error('Enable at least one market'); return; }
    if (strongSignals.length < 2) { toast.error('Waiting for strong signals...'); return; }

    setIsRunning(true);
    runningRef.current = true;
    setCurrentMarket(1);
    setBotStatus('trading_m1');
    setCurrentStakeState(baseStake);
    setMartingaleStepState(0);

    let cStake = baseStake;
    let mStep = 0;
    let inRecovery = false;
    let localPnl = 0;
    let localBalance = balance;

    while (runningRef.current) {
      const mkt: 1 | 2 = inRecovery ? 2 : 1;
      setCurrentMarket(mkt);

      if (mkt === 1 && !m1Enabled) { if (m2Enabled) { inRecovery = true; continue; } else break; }
      if (mkt === 2 && !m2Enabled) { inRecovery = false; continue; }

      // Get current signal for this market
      const currentSignal = mkt === 1 ? strongSignals[0] : strongSignals[1];
      if (!currentSignal) break;

      const threshold = parseInt(signalThreshold);
      if (currentSignal.confidence < threshold) {
        setBotStatus('waiting_signal');
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }

      setBotStatus('signal_matched');

      const contract = currentSignal.contract;
      const barrier = currentSignal.barrier || (mkt === 1 ? m1Barrier : m2Barrier);
      const tradeSymbol = currentSignal.market;
      const hookActive = hookEnabled;

      /* ═══ VIRTUAL HOOK SEQUENCE ═══ */
      if (hookActive) {
        setBotStatus('virtual_hook');
        setVhStatus('waiting');
        setVhFakeWins(0);
        setVhFakeLosses(0);
        setVhConsecLosses(0);
        let consecLosses = 0;
        const requiredLosses = parseInt(virtualLossCount) || 3;
        const realTradesCount = parseInt(realCount) || 2;
        let virtualTradeNum = 0;

        while (consecLosses < requiredLosses && runningRef.current) {
          virtualTradeNum++;
          const vLogId = ++logIdRef.current;
          const vNow = new Date().toLocaleTimeString();
          addLog(vLogId, {
            time: vNow, market: 'VH', symbol: tradeSymbol,
            contract, stake: 0, martingaleStep: 0,
            exitDigit: '...', result: 'Pending', pnl: 0, balance: localBalance,
            switchInfo: `Virtual #${virtualTradeNum} (losses: ${consecLosses}/${requiredLosses})`,
          });

          const vResult = await simulateVirtualContract(contract, barrier, tradeSymbol);
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
        toast.success(`🎣 Hook confirmed! ${requiredLosses} consecutive losses detected → Executing ${realTradesCount} real trade(s)`);

        for (let ri = 0; ri < realTradesCount && runningRef.current; ri++) {
          const result = await executeRealTrade(
            { contract, barrier, symbol: tradeSymbol },
            tradeSymbol, cStake, mStep, mkt, localBalance, localPnl, baseStake
          );
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

      /* ═══ NORMAL REAL TRADE ═══ */
      const result = await executeRealTrade(
        { contract, barrier, symbol: tradeSymbol },
        tradeSymbol, cStake, mStep, mkt, localBalance, localPnl, baseStake
      );
      if (!result || !runningRef.current) break;
      localPnl = result.localPnl;
      localBalance = result.localBalance;
      cStake = result.cStake;
      mStep = result.mStep;
      inRecovery = result.inRecovery;

      if (result.shouldBreak) break;

      await new Promise(r => setTimeout(r, 400));
    }

    setIsRunning(false);
    runningRef.current = false;
    setBotStatus('idle');
  }, [isAuthorized, isRunning, balance, stake, m1Enabled, m2Enabled, m1Barrier, m2Barrier,
    martingaleOn, martingaleMultiplier, martingaleMaxSteps, takeProfit, stopLoss,
    hookEnabled, virtualLossCount, realCount, signalThreshold, strongSignals,
    addLog, updateLog, executeRealTrade]);

  const stopBot = useCallback(() => {
    runningRef.current = false;
    setIsRunning(false);
    setBotStatus('idle');
  }, []);

  const winRate = wins + losses > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : '0.0';

  // Get signal type color
  const getSignalColor = (type: string) => {
    switch(type) {
      case 'rise_fall': return 'from-emerald-500/20 to-emerald-600/10 border-emerald-500/50';
      case 'even_odd': return 'from-amber-500/20 to-amber-600/10 border-amber-500/50';
      case 'over_under': return 'from-blue-500/20 to-blue-600/10 border-blue-500/50';
      case 'digit_match': return 'from-purple-500/20 to-purple-600/10 border-purple-500/50';
      default: return 'from-gray-500/20 to-gray-600/10 border-gray-500/50';
    }
  };

  const getSignalIcon = (type: string) => {
    switch(type) {
      case 'rise_fall': return <TrendingUp className="w-4 h-4" />;
      case 'even_odd': return <Activity className="w-4 h-4" />;
      case 'over_under': return <ArrowUp className="w-4 h-4" />;
      case 'digit_match': return <Target className="w-4 h-4" />;
      default: return <Zap className="w-4 h-4" />;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      <div className="space-y-4 max-w-7xl mx-auto">
        {/* ── Header with Gradient ── */}
        <div className="bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 rounded-2xl p-4 shadow-2xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-white/20 p-2 rounded-xl backdrop-blur">
                <Crown className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-white">Signal Hunter Bot</h1>
                <p className="text-xs text-white/80">Auto-configures based on strongest signals</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Badge className={`px-3 py-1 text-xs font-bold ${
                botStatus === 'idle' ? 'bg-gray-600' :
                botStatus === 'trading_m1' ? 'bg-emerald-600 animate-pulse' :
                botStatus === 'recovery' ? 'bg-purple-600' :
                botStatus === 'waiting_signal' ? 'bg-amber-600' :
                botStatus === 'signal_matched' ? 'bg-emerald-600' :
                'bg-indigo-600'
              }`}>
                {botStatus === 'idle' ? '⚪ IDLE' :
                 botStatus === 'trading_m1' ? '🟢 TRADING M1' :
                 botStatus === 'recovery' ? '🟣 RECOVERY' :
                 botStatus === 'waiting_signal' ? '🟡 WAITING SIGNAL' :
                 botStatus === 'signal_matched' ? '✅ SIGNAL MATCHED' :
                 '🎣 VIRTUAL HOOK'}
              </Badge>
              {isRunning && (
                <Badge className="bg-white/20 text-white">
                  P/L: ${netProfit.toFixed(2)}
                </Badge>
              )}
            </div>
          </div>
        </div>

        {/* ── Top 5 Strong Signals Display ── */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          {strongSignals.map((signal, idx) => (
            <motion.div
              key={signal.market}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.1 }}
              className={`bg-gradient-to-br ${getSignalColor(signal.type)} rounded-xl p-3 border backdrop-blur-sm relative overflow-hidden group`}
            >
              {idx === 0 && (
                <div className="absolute top-0 right-0">
                  <Crown className="w-8 h-8 text-yellow-500/30" />
                </div>
              )}
              <div className="flex items-start justify-between mb-2">
                <div>
                  <p className="text-[10px] text-white/60">{signal.name}</p>
                  <p className="text-xs font-bold text-white">{signal.market}</p>
                </div>
                <div className={`p-1.5 rounded-lg bg-white/10`}>
                  {getSignalIcon(signal.type)}
                </div>
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-white/60">Signal</span>
                  <span className={`text-xs font-bold ${
                    signal.type === 'rise_fall' ? 'text-emerald-400' :
                    signal.type === 'even_odd' ? 'text-amber-400' :
                    signal.type === 'over_under' ? 'text-blue-400' :
                    'text-purple-400'
                  }`}>
                    {signal.direction}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-white/60">Confidence</span>
                  <span className="text-xs font-bold text-white">{signal.confidence}%</span>
                </div>
                <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${signal.confidence}%` }}
                    className={`h-full rounded-full ${
                      signal.confidence >= 70 ? 'bg-emerald-500' :
                      signal.confidence >= 50 ? 'bg-amber-500' : 'bg-red-500'
                    }`}
                  />
                </div>
                {signal.digit !== undefined && (
                  <div className="text-center mt-1">
                    <Badge className="bg-white/20 text-white text-[8px]">Digit: {signal.digit}</Badge>
                  </div>
                )}
              </div>
              {idx === 0 && (
                <div className="absolute bottom-1 right-1">
                  <Sparkles className="w-3 h-3 text-yellow-500" />
                </div>
              )}
            </motion.div>
          ))}
        </div>

        {/* ── Main 2-Column Layout ── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* ═══ LEFT: Trading Config ═══ */}
          <div className="lg:col-span-5 space-y-4">
            {/* Market 1 - Primary (Auto-configured) */}
            <div className="bg-gradient-to-br from-emerald-900/30 to-emerald-950/30 rounded-xl p-4 border border-emerald-500/30 backdrop-blur-sm">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="bg-emerald-500/20 p-1.5 rounded-lg">
                    <Home className="w-4 h-4 text-emerald-400" />
                  </div>
                  <h3 className="text-sm font-bold text-emerald-400">M1 - Primary Market</h3>
                </div>
                <Switch checked={m1Enabled} onCheckedChange={setM1Enabled} disabled={isRunning} />
              </div>
              
              {strongSignals[0] && (
                <div className="bg-emerald-950/30 rounded-lg p-2 mb-3">
                  <p className="text-[10px] text-emerald-400/80">Based on strongest signal:</p>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-xs font-mono text-white">{strongSignals[0].market}</span>
                    <Badge className="bg-emerald-600 text-white text-[9px]">
                      {strongSignals[0].direction} {strongSignals[0].confidence}%
                    </Badge>
                  </div>
                </div>
              )}
              
              <div className="space-y-2">
                <div>
                  <label className="text-[10px] text-white/60">Contract Type</label>
                  <div className="mt-1 p-2 bg-emerald-950/50 rounded-lg">
                    <span className="text-sm font-mono text-emerald-400">{m1Contract}</span>
                  </div>
                </div>
                {needsBarrier(m1Contract) && (
                  <div>
                    <label className="text-[10px] text-white/60">Barrier</label>
                    <div className="mt-1 p-2 bg-emerald-950/50 rounded-lg">
                      <span className="text-sm font-mono text-emerald-400">{m1Barrier}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Market 2 - Recovery (Auto-configured) */}
            <div className="bg-gradient-to-br from-purple-900/30 to-purple-950/30 rounded-xl p-4 border border-purple-500/30 backdrop-blur-sm">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="bg-purple-500/20 p-1.5 rounded-lg">
                    <RefreshCw className="w-4 h-4 text-purple-400" />
                  </div>
                  <h3 className="text-sm font-bold text-purple-400">M2 - Recovery Market</h3>
                </div>
                <Switch checked={m2Enabled} onCheckedChange={setM2Enabled} disabled={isRunning} />
              </div>
              
              {strongSignals[1] && (
                <div className="bg-purple-950/30 rounded-lg p-2 mb-3">
                  <p className="text-[10px] text-purple-400/80">Based on second strongest:</p>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-xs font-mono text-white">{strongSignals[1].market}</span>
                    <Badge className="bg-purple-600 text-white text-[9px]">
                      {strongSignals[1].direction} {strongSignals[1].confidence}%
                    </Badge>
                  </div>
                </div>
              )}
              
              <div className="space-y-2">
                <div>
                  <label className="text-[10px] text-white/60">Contract Type</label>
                  <div className="mt-1 p-2 bg-purple-950/50 rounded-lg">
                    <span className="text-sm font-mono text-purple-400">{m2Contract}</span>
                  </div>
                </div>
                {needsBarrier(m2Contract) && (
                  <div>
                    <label className="text-[10px] text-white/60">Barrier</label>
                    <div className="mt-1 p-2 bg-purple-950/50 rounded-lg">
                      <span className="text-sm font-mono text-purple-400">{m2Barrier}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Risk Management */}
            <div className="bg-gradient-to-br from-slate-800/50 to-slate-900/50 rounded-xl p-4 border border-slate-700/50 backdrop-blur-sm">
              <div className="flex items-center gap-2 mb-3">
                <Shield className="w-4 h-4 text-slate-400" />
                <h3 className="text-sm font-bold text-white">Risk Management</h3>
              </div>
              
              <div className="grid grid-cols-3 gap-2 mb-3">
                <div>
                  <label className="text-[9px] text-white/60">Stake ($)</label>
                  <Input type="number" min="0.35" step="0.01" value={stake} 
                    onChange={e => setStake(e.target.value)} disabled={isRunning}
                    className="h-8 text-xs bg-slate-900/50 border-slate-700 text-white" />
                </div>
                <div>
                  <label className="text-[9px] text-white/60">Take Profit</label>
                  <Input type="number" value={takeProfit} onChange={e => setTakeProfit(e.target.value)} 
                    disabled={isRunning} className="h-8 text-xs bg-slate-900/50 border-slate-700 text-white" />
                </div>
                <div>
                  <label className="text-[9px] text-white/60">Stop Loss</label>
                  <Input type="number" value={stopLoss} onChange={e => setStopLoss(e.target.value)} 
                    disabled={isRunning} className="h-8 text-xs bg-slate-900/50 border-slate-700 text-white" />
                </div>
              </div>
              
              <div className="flex items-center justify-between mb-2">
                <label className="text-[10px] text-white">Martingale</label>
                <Switch checked={martingaleOn} onCheckedChange={setMartingaleOn} disabled={isRunning} />
              </div>
              
              {martingaleOn && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[8px] text-white/60">Multiplier</label>
                    <Input type="number" min="1.1" step="0.1" value={martingaleMultiplier} 
                      onChange={e => setMartingaleMultiplier(e.target.value)} disabled={isRunning}
                      className="h-7 text-xs bg-slate-900/50 border-slate-700 text-white" />
                  </div>
                  <div>
                    <label className="text-[8px] text-white/60">Max Steps</label>
                    <Input type="number" min="1" max="10" value={martingaleMaxSteps} 
                      onChange={e => setMartingaleMaxSteps(e.target.value)} disabled={isRunning}
                      className="h-7 text-xs bg-slate-900/50 border-slate-700 text-white" />
                  </div>
                </div>
              )}
            </div>

            {/* Virtual Hook */}
            <div className="bg-gradient-to-br from-indigo-900/30 to-indigo-950/30 rounded-xl p-4 border border-indigo-500/30 backdrop-blur-sm">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-indigo-400" />
                  <h3 className="text-sm font-bold text-indigo-400">Virtual Hook Protection</h3>
                </div>
                <Switch checked={hookEnabled} onCheckedChange={setHookEnabled} disabled={isRunning} />
              </div>
              
              {hookEnabled && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[8px] text-white/60">Virtual Losses</label>
                    <Input type="number" min="1" max="20" value={virtualLossCount} 
                      onChange={e => setVirtualLossCount(e.target.value)} disabled={isRunning}
                      className="h-7 text-xs bg-indigo-950/50 border-indigo-700 text-white" />
                  </div>
                  <div>
                    <label className="text-[8px] text-white/60">Real Trades</label>
                    <Input type="number" min="1" max="10" value={realCount} 
                      onChange={e => setRealCount(e.target.value)} disabled={isRunning}
                      className="h-7 text-xs bg-indigo-950/50 border-indigo-700 text-white" />
                  </div>
                </div>
              )}
              
              {(vhFakeWins > 0 || vhFakeLosses > 0) && (
                <div className="grid grid-cols-3 gap-1 mt-2 text-center">
                  <div className="bg-indigo-950/30 rounded p-1">
                    <div className="text-[7px] text-white/60">V-Win</div>
                    <div className="text-xs font-bold text-emerald-400">{vhFakeWins}</div>
                  </div>
                  <div className="bg-indigo-950/30 rounded p-1">
                    <div className="text-[7px] text-white/60">V-Loss</div>
                    <div className="text-xs font-bold text-red-400">{vhFakeLosses}</div>
                  </div>
                  <div className="bg-indigo-950/30 rounded p-1">
                    <div className="text-[7px] text-white/60">Streak</div>
                    <div className="text-xs font-bold text-amber-400">{vhConsecLosses}</div>
                  </div>
                </div>
              )}
            </div>

            {/* Signal Threshold */}
            <div className="bg-gradient-to-br from-amber-900/30 to-amber-950/30 rounded-xl p-4 border border-amber-500/30 backdrop-blur-sm">
              <div className="flex items-center gap-2 mb-2">
                <AlertCircle className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-bold text-amber-400">Signal Threshold</h3>
              </div>
              <Input type="number" min="0" max="100" value={signalThreshold} 
                onChange={e => setSignalThreshold(e.target.value)} disabled={isRunning}
                className="h-8 text-xs bg-amber-950/50 border-amber-700 text-white" />
              <p className="text-[8px] text-white/50 mt-1">Minimum confidence % to execute trades</p>
            </div>
          </div>

          {/* ═══ RIGHT: Live Stats + Activity ═══ */}
          <div className="lg:col-span-7 space-y-4">
            {/* Live Stats Cards */}
            <div className="grid grid-cols-5 gap-2">
              {[
                { label: 'Trades', value: wins + losses, icon: BarChart3, color: 'from-blue-600/20 to-blue-700/20' },
                { label: 'Wins', value: wins, icon: CheckCircle2, color: 'from-emerald-600/20 to-emerald-700/20' },
                { label: 'Losses', value: losses, icon: XCircle, color: 'from-red-600/20 to-red-700/20' },
                { label: 'P/L', value: `$${netProfit.toFixed(2)}`, icon: TrendingUp, color: netProfit >= 0 ? 'from-emerald-600/20 to-emerald-700/20' : 'from-red-600/20 to-red-700/20' },
                { label: 'Win Rate', value: `${winRate}%`, icon: Target, color: 'from-purple-600/20 to-purple-700/20' },
              ].map((stat, idx) => (
                <div key={idx} className={`bg-gradient-to-br ${stat.color} rounded-xl p-2 text-center border border-white/10 backdrop-blur-sm`}>
                  <stat.icon className="w-3 h-3 text-white/60 mx-auto mb-1" />
                  <div className="text-[10px] text-white/60">{stat.label}</div>
                  <div className={`text-sm font-bold text-white ${stat.label === 'P/L' && netProfit >= 0 ? 'text-emerald-400' : stat.label === 'P/L' && netProfit < 0 ? 'text-red-400' : ''}`}>
                    {stat.value}
                  </div>
                </div>
              ))}
            </div>

            {/* Current Signal Display */}
            {strongSignals[0] && (
              <div className="bg-gradient-to-r from-emerald-600/20 via-purple-600/20 to-pink-600/20 rounded-xl p-4 border border-white/20 backdrop-blur-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] text-white/60">Current Active Signal</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xl font-bold text-white">{strongSignals[0].direction}</span>
                      <Badge className="bg-white/20 text-white text-[10px]">{strongSignals[0].type}</Badge>
                    </div>
                    <p className="text-[10px] text-white/50 mt-1">{strongSignals[0].name} ({strongSignals[0].market})</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-white/60">Confidence</p>
                    <p className="text-2xl font-bold text-emerald-400">{strongSignals[0].confidence}%</p>
                  </div>
                </div>
                <div className="mt-2 h-2 bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-emerald-500 to-purple-500 rounded-full" style={{ width: `${strongSignals[0].confidence}%` }} />
                </div>
              </div>
            )}

            {/* Current Stake Status */}
            <div className="bg-gradient-to-r from-slate-800/50 to-slate-900/50 rounded-xl p-3 border border-slate-700/50 backdrop-blur-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] text-white/60">Current Stake</p>
                  <p className="text-lg font-bold text-white">${currentStake.toFixed(2)}</p>
                </div>
                {martingaleStep > 0 && (
                  <Badge className="bg-amber-600 text-white">
                    Martingale Step {martingaleStep}/{martingaleMaxSteps}
                  </Badge>
                )}
                <div className="text-right">
                  <p className="text-[10px] text-white/60">Balance</p>
                  <p className="text-lg font-bold text-white">${balance.toFixed(2)}</p>
                </div>
              </div>
            </div>

            {/* Start / Stop Buttons */}
            <div className="grid grid-cols-2 gap-3">
              <Button
                onClick={startBot}
                disabled={isRunning || !isAuthorized || balance < parseFloat(stake) || strongSignals.length < 2}
                className="h-14 text-base font-bold bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-500 hover:to-emerald-600 rounded-xl shadow-lg"
              >
                <Play className="w-5 h-5 mr-2" /> START BOT
              </Button>
              <Button
                onClick={stopBot}
                disabled={!isRunning}
                variant="destructive"
                className="h-14 text-base font-bold bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 rounded-xl shadow-lg"
              >
                <StopCircle className="w-5 h-5 mr-2" /> STOP
              </Button>
            </div>

            {/* Activity Log */}
            <div className="bg-slate-900/50 rounded-xl overflow-hidden border border-slate-700/50 backdrop-blur-sm">
              <div className="px-3 py-2 border-b border-slate-700/50 flex items-center justify-between">
                <h3 className="text-xs font-semibold text-white">Activity Log</h3>
                <Button variant="ghost" size="sm" onClick={clearLog} className="h-6 w-6 p-0 text-white/50 hover:text-red-400">
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
              <div className="max-h-[400px] overflow-auto">
                <table className="w-full text-[10px]">
                  <thead className="text-white/60 bg-slate-800/50 sticky top-0">
                    <tr>
                      <th className="text-left p-2">Time</th>
                      <th className="text-left p-2">Mkt</th>
                      <th className="text-left p-2">Type</th>
                      <th className="text-right p-2">Stake</th>
                      <th className="text-center p-2">Digit</th>
                      <th className="text-center p-2">Result</th>
                      <th className="text-right p-2">P/L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logEntries.length === 0 ? (
                      <tr><td colSpan={7} className="text-center text-white/40 py-8">No trades yet</td></tr>
                    ) : logEntries.map(e => (
                      <tr key={e.id} className={`border-t border-slate-700/30 ${
                        e.result === 'Win' ? 'bg-emerald-500/5' : e.result === 'Loss' ? 'bg-red-500/5' : ''
                      }`}>
                        <td className="p-2 font-mono text-white/60">{e.time}</td>
                        <td className={`p-2 font-bold ${
                          e.market === 'M1' ? 'text-emerald-400' : e.market === 'VH' ? 'text-indigo-400' : 'text-purple-400'
                        }`}>{e.market}</td>
                        <td className="p-2 text-white/80">{e.contract.replace('DIGIT', '').replace('CALL', 'Rise').replace('PUT', 'Fall')}</td>
                        <td className="p-2 text-right font-mono text-white/80">
                          {e.market === 'VH' ? 'FAKE' : `$${e.stake.toFixed(2)}`}
                          {e.martingaleStep > 0 && e.market !== 'VH' && <span className="text-amber-400 ml-1">M{e.martingaleStep}</span>}
                        </td>
                        <td className="p-2 text-center font-mono text-white/80">{e.exitDigit}</td>
                        <td className="p-2 text-center">
                          <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold ${
                            e.result === 'Win' ? 'bg-emerald-500/20 text-emerald-400' :
                            e.result === 'Loss' ? 'bg-red-500/20 text-red-400' :
                            e.result === 'V-Win' ? 'bg-emerald-500/20 text-emerald-400' :
                            e.result === 'V-Loss' ? 'bg-red-500/20 text-red-400' :
                            'bg-amber-500/20 text-amber-400'
                          }`}>{e.result === 'Pending' ? '...' : e.result}</span>
                        </td>
                        <td className={`p-2 text-right font-mono font-bold ${
                          e.pnl > 0 ? 'text-emerald-400' : e.pnl < 0 ? 'text-red-400' : 'text-white/60'
                        }`}>
                          {e.result === 'Pending' ? '...' : e.market === 'VH' ? '-' : `${e.pnl > 0 ? '+' : ''}${e.pnl.toFixed(2)}`}
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
    </div>
  );
}
