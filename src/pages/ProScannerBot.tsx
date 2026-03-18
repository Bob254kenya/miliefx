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
  Home, RefreshCw, Shield, Zap, Eye, Anchor, Download, Upload, Loader2, WifiOff
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

function waitForNextTick(symbol: string): Promise<{ quote: number }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsub();
      reject(new Error('Tick timeout'));
    }, 5000);
    
    const unsub = derivApi.onMessage((data: any) => {
      if (data.tick && data.tick.symbol === symbol) { 
        clearTimeout(timeout);
        unsub(); 
        resolve({ quote: data.tick.quote }); 
      }
    });
  });
}

/* ── Simulate a virtual contract result based on actual next tick ── */
function simulateVirtualContract(
  contractType: string, barrier: string, symbol: string
): Promise<{ won: boolean; digit: number }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsub();
      reject(new Error('Virtual contract timeout'));
    }, 5000);
    
    const unsub = derivApi.onMessage((data: any) => {
      if (data.tick && data.tick.symbol === symbol) {
        clearTimeout(timeout);
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

/* ── Retry utility with exponential backoff ── */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (i === maxRetries - 1) break;
      
      const delay = baseDelay * Math.pow(2, i);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError!;
}

export default function ProScannerBot() {
  const { isAuthorized, balance, activeAccount } = useAuth();
  const { recordLoss } = useLossRequirement();
  const location = useLocation();

  /* ── Connection state ── */
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

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

  /* ── HTML Analyzer State ── */
  const [analyzerSymbol, setAnalyzerSymbol] = useState('R_100');
  const [analyzerMode, setAnalyzerMode] = useState<'over' | 'under'>('over');
  const [analyzerThreshold, setAnalyzerThreshold] = useState(5);
  const [analyzerTicks, setAnalyzerTicks] = useState<number[]>([]);
  const [analyzerStatus, setAnalyzerStatus] = useState('Connecting...');
  const analyzerWsRef = useRef<WebSocket | null>(null);

  /* ── Check connection status ── */
  useEffect(() => {
    const checkConnection = () => {
      const connected = derivApi.isConnected;
      setIsConnected(connected);
      if (!connected) {
        setConnectionError('Not connected to Deriv API');
      } else {
        setConnectionError(null);
      }
    };

    checkConnection();
    const interval = setInterval(checkConnection, 3000);
    
    return () => clearInterval(interval);
  }, []);

  /* ── HTML Analyzer WebSocket Connection ── */
  useEffect(() => {
    // Close previous connection
    if (analyzerWsRef.current) {
      analyzerWsRef.current.close();
    }

    setAnalyzerStatus('Connecting...');
    setAnalyzerTicks([]);

    const ws = new WebSocket("wss://ws.binaryws.com/websockets/v3?app_id=1089");
    analyzerWsRef.current = ws;

    ws.onopen = () => {
      setAnalyzerStatus('Live');
      ws.send(JSON.stringify({
        ticks_history: analyzerSymbol,
        style: "ticks",
        count: 1000,
        end: "latest",
        subscribe: 1,
      }));
    };

    ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data);
      if (data.history) {
        const prices = data.history.prices.map((p: string) => 
          parseInt(parseFloat(p).toFixed(2).slice(-1))
        );
        setAnalyzerTicks(prices);
      }
      if (data.tick) {
        const tick = parseFloat(data.tick.quote);
        const digit = parseInt(tick.toFixed(2).slice(-1));
        if (!isNaN(digit)) {
          setAnalyzerTicks(prev => {
            const newTicks = [...prev, digit];
            if (newTicks.length > 4000) newTicks.shift();
            return newTicks;
          });
        }
      }
    };

    ws.onerror = () => {
      setAnalyzerStatus('Error');
    };

    ws.onclose = () => {
      setAnalyzerStatus('No network');
    };

    return () => {
      ws.close();
    };
  }, [analyzerSymbol]);

  /* ── Handle digit click from analyzer ── */
  const handleAnalyzerDigitClick = (digit: number) => {
    setAnalyzerThreshold(digit);
    if (needsBarrier(m1Contract)) {
      setM1Barrier(digit.toString());
    }
    if (needsBarrier(m2Contract)) {
      setM2Barrier(digit.toString());
    }
  };

  /* ── Calculate analyzer statistics ── */
  const analyzerStats = useMemo(() => {
    if (!analyzerTicks.length) return null;

    const tickCount = 1000;
    const recentTicks = analyzerTicks.slice(-tickCount);
    const lastDigits = recentTicks.slice(-30);
    const counts = Array(10).fill(0);
    recentTicks.forEach(d => counts[d]++);
    const total = recentTicks.length;

    // Most frequent digits
    const sorted = counts
      .map((c, d) => ({ digit: d, count: c }))
      .sort((a, b) => b.count - a.count);
    const most = sorted[0]?.digit;
    const second = sorted[1]?.digit;

    // Over/Under percentages
    const lowCount = counts.slice(0, analyzerThreshold).reduce((a, b) => a + b, 0);
    const highCount = counts.slice(analyzerThreshold + 1, 10).reduce((a, b) => a + b, 0);
    const lowPercent = total ? ((lowCount / total) * 100).toFixed(1) : 0;
    const highPercent = total ? ((highCount / total) * 100).toFixed(1) : 0;

    // Entry triggers
    let winningDigits: number[] = [], losingDigits: number[] = [];
    for (let i = 0; i < recentTicks.length - 1; i++) {
      if (recentTicks[i] === analyzerThreshold) {
        const nextDigit = recentTicks[i + 1];
        if (analyzerMode === "over") {
          if (nextDigit > analyzerThreshold) winningDigits.push(nextDigit);
          else losingDigits.push(nextDigit);
        } else {
          if (nextDigit < analyzerThreshold) winningDigits.push(nextDigit);
          else losingDigits.push(nextDigit);
        }
      }
    }
    winningDigits = [...new Set(winningDigits)];
    losingDigits = [...new Set(losingDigits)];

    // Signal
    let signalText = "WAIT / NEUTRAL", signalClass = "signal-neutral";
    if (most < analyzerThreshold && second < analyzerThreshold) {
      signalText = `SIGNAL: STRONG TRADE UNDER ${analyzerThreshold}`;
      signalClass = "signal-under";
    } else if (most > analyzerThreshold && second > analyzerThreshold) {
      signalText = `SIGNAL: STRONG TRADE OVER ${analyzerThreshold}`;
      signalClass = "signal-over";
    }

    return {
      lastDigits,
      counts,
      most,
      second,
      lowPercent,
      highPercent,
      winningDigits,
      losingDigits,
      signalText,
      signalClass
    };
  }, [analyzerTicks, analyzerThreshold, analyzerMode]);

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
    if (!isAuthorized) {
      toast.error('Please authorize first');
      return;
    }
    
    if (!derivApi.isConnected) {
      toast.error('Not connected to Deriv API');
      return;
    }

    if (isRunning) return;
    
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
      // Check connection periodically
      if (!derivApi.isConnected) {
        toast.error('Connection lost. Stopping bot.');
        break;
      }

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
          if (!derivApi.isConnected) break;
          
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
        if (!runningRef.current || !derivApi.isConnected) break;

        setBotStatus('pattern_matched');
        tradeSymbol = matchedSymbol;
        if (!turboMode) await new Promise(r => setTimeout(r, 300));
      }
      /* ── Strategy gating for M1 ── */
      else if (!inRecovery && strategyM1Enabled) {
        setBotStatus('waiting_pattern');

        let matched = false;
        while (runningRef.current && !matched) {
          if (!derivApi.isConnected) break;
          
          if (checkStrategyForMarket(cfg.symbol, 1)) { matched = true; }
          if (!matched) {
            await new Promise<void>(r => {
              if (turboMode) requestAnimationFrame(() => r());
              else setTimeout(r, 500);
            });
          }
        }
        if (!runningRef.current || !derivApi.isConnected) break;

        setBotStatus('pattern_matched');
        tradeSymbol = cfg.symbol;
        if (!turboMode) await new Promise(r => setTimeout(r, 300));
      } else {
        setBotStatus(mkt === 1 ? 'trading_m1' : 'recovery');
        tradeSymbol = cfg.symbol;
      }

      /* ═══ VIRTUAL HOOK SEQUENCE ═══ */
      if (hookEnabled) {
        setBotStatus('virtual_hook');
        setVhStatus('waiting');
        setVhFakeWins(0);
        setVhFakeLosses(0);
        setVhConsecLosses(0);
        let consecLosses = 0;
        let virtualTradeNum = 0;

        while (consecLosses < requiredLosses && runningRef.current) {
          if (!derivApi.isConnected) break;
          
          virtualTradeNum++;
          const vLogId = ++logIdRef.current;
          const vNow = new Date().toLocaleTimeString();
          addLog(vLogId, {
            time: vNow, market: 'VH', symbol: tradeSymbol,
            contract: cfg.contract, stake: 0, martingaleStep: 0,
            exitDigit: '...', result: 'Pending', pnl: 0, balance: localBalance,
            switchInfo: `Virtual #${virtualTradeNum} (losses: ${consecLosses}/${requiredLosses})`,
          });

          try {
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
          } catch (error) {
            console.error('Virtual contract error:', error);
            updateLog(vLogId, { result: 'V-Loss', exitDigit: '-', switchInfo: 'Error in virtual trade' });
            break;
          }
        }

        if (!runningRef.current || !derivApi.isConnected) break;

        setVhStatus('confirmed');
        toast.success(`🎣 Hook confirmed! ${requiredLosses} consecutive losses detected → Executing ${realCount} real trade(s)`);

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

        setVhStatus('idle');
        setVhConsecLosses(0);
        if (!runningRef.current) break;
        continue;
      }

      /* ═══ NORMAL REAL TRADE ═══ */
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
      if (!turboMode) {
        try {
          await waitForNextTick(tradeSymbol as MarketSymbol);
        } catch (error) {
          updateLog(logId, { result: 'Loss', pnl: 0, exitDigit: '-', switchInfo: 'Tick timeout' });
          return { localPnl, localBalance, cStake, mStep, inRecovery, shouldBreak: false };
        }
      }

      const buyParams: any = {
        contract_type: cfg.contract, symbol: tradeSymbol,
        duration: 1, duration_unit: 't', basis: 'stake', amount: cStake,
      };
      if (needsBarrier(cfg.contract)) buyParams.barrier = cfg.barrier;

      const { contractId } = await derivApi.buyContract(buyParams);
      
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
    if ((cfg as any).botName) setBotName((cfg as any).botName);
  }, []);

  // Auto-load config from navigation state
  useEffect(() => {
    const state = location.state as { loadConfig?: BotConfig } | null;
    if (state?.loadConfig) {
      handleLoadConfig(state.loadConfig);
      window.history.replaceState({}, '');
    }
  }, [location.state, handleLoadConfig]);

  const activeSymbol = currentMarket === 1 ? m1Symbol : m2Symbol;
  const activeDigits = (tickMapRef.current.get(activeSymbol) || []).slice(-8);

  // Show connection error if not connected
  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center h-[400px] space-y-4">
        <WifiOff className="w-16 h-16 text-rose-400" />
        <h2 className="text-xl font-semibold text-gray-200">Connection Error</h2>
        <p className="text-sm text-gray-400">{connectionError || 'Failed to connect to Deriv API'}</p>
        <Button onClick={() => window.location.reload()} className="mt-4">
          Retry Connection
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2 max-w-7xl mx-auto font-sans">
      {/* ── Compact Header ── */}
      <div className="flex items-center justify-between gap-2 bg-gradient-to-r from-gray-900 to-gray-800 border border-gray-700/50 rounded-xl px-3 py-2 shadow-lg">
        <h1 className="text-base font-semibold tracking-tight text-white flex items-center gap-2">
          <Scan className="w-4 h-4 text-cyan-400" /> Pro Scanner Bot
        </h1>
        <div className="flex items-center gap-2">
          <Badge className={`${status.color} text-[10px] font-medium bg-gray-800/80 border-gray-700`}>{status.icon} {status.label}</Badge>
          {isRunning && (
            <Badge variant="outline" className="text-[10px] text-amber-400 animate-pulse font-mono bg-gray-800/80 border-gray-700">
              P/L: ${netProfit.toFixed(2)}
            </Badge>
          )}
          {isRunning && (
            <Badge variant="outline" className={`text-[10px] font-mono bg-gray-800/80 border-gray-700 ${currentMarket === 1 ? 'text-emerald-400' : 'text-purple-400'}`}>
              {currentMarket === 1 ? '🏠 M1' : '🔄 M2'}
            </Badge>
          )}
        </div>
      </div>

      {/* ── Scanner + Turbo + Stats Compact Row ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        {/* Scanner */}
        <div className="bg-gray-800/60 backdrop-blur-sm border border-gray-700 rounded-xl p-2.5 shadow-md">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <Eye className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-xs font-medium text-gray-200">Scanner</span>
              <Badge variant={scannerActive ? 'default' : 'secondary'} className="text-[9px] h-4 px-1.5 font-medium">
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
                  className={`text-[8px] h-4 px-1 font-mono ${count > 0 ? 'border-cyan-500/50 text-cyan-400 bg-cyan-950/20' : 'text-gray-500 border-gray-700'}`}>
                  {m.name}
                </Badge>
              );
            })}
          </div>
        </div>

        {/* Turbo */}
        <div className="bg-gray-800/60 backdrop-blur-sm border border-gray-700 rounded-xl p-2.5 shadow-md">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <Zap className={`w-3.5 h-3.5 ${turboMode ? 'text-emerald-400 animate-pulse' : 'text-gray-500'}`} />
              <span className="text-xs font-medium text-gray-200">Turbo</span>
            </div>
            <Button
              size="sm"
              variant={turboMode ? 'default' : 'outline'}
              className={`h-6 text-[9px] px-2 font-medium ${turboMode ? 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-500' : 'bg-gray-800 border-gray-600 text-gray-300'}`}
              onClick={() => setTurboMode(!turboMode)}
              disabled={isRunning}
            >
              {turboMode ? '⚡ ON' : 'OFF'}
            </Button>
          </div>
          <div className="grid grid-cols-3 gap-1 text-center">
            <div className="bg-gray-900/60 rounded p-1 border border-gray-700">
              <div className="text-[8px] text-gray-500 font-medium">Latency</div>
              <div className="font-mono text-[10px] text-cyan-400 font-bold">{turboLatency}ms</div>
            </div>
            <div className="bg-gray-900/60 rounded p-1 border border-gray-700">
              <div className="text-[8px] text-gray-500 font-medium">Captured</div>
              <div className="font-mono text-[10px] text-emerald-400 font-bold">{ticksCaptured}</div>
            </div>
            <div className="bg-gray-900/60 rounded p-1 border border-gray-700">
              <div className="text-[8px] text-gray-500 font-medium">Missed</div>
              <div className="font-mono text-[10px] text-rose-400 font-bold">{ticksMissed}</div>
            </div>
          </div>
        </div>

        {/* Live Stats */}
        <div className="bg-gray-800/60 backdrop-blur-sm border border-gray-700 rounded-xl p-2.5 shadow-md">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-gray-200">Stats</span>
            <span className="font-mono text-sm font-bold text-white">${balance.toFixed(2)}</span>
          </div>
          <div className="grid grid-cols-3 gap-1 text-center">
            <div className="bg-gray-900/60 rounded p-1 border border-gray-700">
              <div className="text-[8px] text-gray-500 font-medium">W/L</div>
              <div className="font-mono text-[10px] font-bold"><span className="text-emerald-400">{wins}</span>/<span className="text-rose-400">{losses}</span></div>
            </div>
            <div className="bg-gray-900/60 rounded p-1 border border-gray-700">
              <div className="text-[8px] text-gray-500 font-medium">Net P/L</div>
              <div className={`font-mono text-[10px] font-bold ${netProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>${netProfit.toFixed(2)}</div>
            </div>
            <div className="bg-gray-900/60 rounded p-1 border border-gray-700">
              <div className="text-[8px] text-gray-500 font-medium">Stake</div>
              <div className="font-mono text-[10px] font-bold text-white">${currentStake.toFixed(2)}{martingaleStep > 0 && <span className="text-amber-400"> M{martingaleStep}</span>}</div>
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
            <div className="bg-gradient-to-br from-gray-800 to-gray-900 border-2 border-emerald-500/30 rounded-xl p-2.5 space-y-1.5 shadow-lg">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-emerald-400 flex items-center gap-1"><Home className="w-3.5 h-3.5" /> M1 — Home</h3>
                <div className="flex items-center gap-1.5">
                  {currentMarket === 1 && isRunning && <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />}
                  <Switch checked={m1Enabled} onCheckedChange={setM1Enabled} disabled={isRunning} />
                </div>
              </div>
              <Select value={m1Symbol} onValueChange={v => setM1Symbol(v)} disabled={isRunning}>
                <SelectTrigger className="h-7 text-xs bg-gray-900 border-gray-700 text-gray-200"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-gray-800 border-gray-700">{SCANNER_MARKETS.map(m => <SelectItem key={m.symbol} value={m.symbol} className="text-gray-200">{m.name} ({m.symbol})</SelectItem>)}</SelectContent>
              </Select>
              <Select value={m1Contract} onValueChange={v => setM1Contract(v)} disabled={isRunning}>
                <SelectTrigger className="h-7 text-xs bg-gray-900 border-gray-700 text-gray-200"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-gray-800 border-gray-700">{CONTRACT_TYPES.map(c => <SelectItem key={c} value={c} className="text-gray-200">{c}</SelectItem>)}</SelectContent>
              </Select>
              {needsBarrier(m1Contract) && (
                <Input type="number" min="0" max="9" value={m1Barrier} onChange={e => setM1Barrier(e.target.value)}
                  className="h-7 text-xs bg-gray-900 border-gray-700 text-gray-200" placeholder="Barrier (0-9)" disabled={isRunning} />
              )}
              {/* Virtual Hook M1 */}
              <div className="border-t border-gray-700/50 pt-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-medium text-cyan-400 flex items-center gap-1">
                    <Anchor className="w-3 h-3" /> Virtual Hook
                  </span>
                  <Switch checked={m1HookEnabled} onCheckedChange={setM1HookEnabled} disabled={isRunning} />
                </div>
                {m1HookEnabled && (
                  <div className="grid grid-cols-2 gap-1.5 mt-1">
                    <div>
                      <label className="text-[8px] text-gray-500 font-medium">V-Losses</label>
                      <Input type="number" min="1" max="20" value={m1VirtualLossCount} onChange={e => setM1VirtualLossCount(e.target.value)} disabled={isRunning} className="h-6 text-[10px] bg-gray-900 border-gray-700 text-gray-200" />
                    </div>
                    <div>
                      <label className="text-[8px] text-gray-500 font-medium">Real Trades</label>
                      <Input type="number" min="1" max="10" value={m1RealCount} onChange={e => setM1RealCount(e.target.value)} disabled={isRunning} className="h-6 text-[10px] bg-gray-900 border-gray-700 text-gray-200" />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Market 2 */}
            <div className="bg-gradient-to-br from-gray-800 to-gray-900 border-2 border-purple-500/30 rounded-xl p-2.5 space-y-1.5 shadow-lg">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-purple-400 flex items-center gap-1"><RefreshCw className="w-3.5 h-3.5" /> M2 — Recovery</h3>
                <div className="flex items-center gap-1.5">
                  {currentMarket === 2 && isRunning && <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />}
                  <Switch checked={m2Enabled} onCheckedChange={setM2Enabled} disabled={isRunning} />
                </div>
              </div>
              <Select value={m2Symbol} onValueChange={v => setM2Symbol(v)} disabled={isRunning}>
                <SelectTrigger className="h-7 text-xs bg-gray-900 border-gray-700 text-gray-200"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-gray-800 border-gray-700">{SCANNER_MARKETS.map(m => <SelectItem key={m.symbol} value={m.symbol} className="text-gray-200">{m.name} ({m.symbol})</SelectItem>)}</SelectContent>
              </Select>
              <Select value={m2Contract} onValueChange={v => setM2Contract(v)} disabled={isRunning}>
                <SelectTrigger className="h-7 text-xs bg-gray-900 border-gray-700 text-gray-200"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-gray-800 border-gray-700">{CONTRACT_TYPES.map(c => <SelectItem key={c} value={c} className="text-gray-200">{c}</SelectItem>)}</SelectContent>
              </Select>
              {needsBarrier(m2Contract) && (
                <Input type="number" min="0" max="9" value={m2Barrier} onChange={e => setM2Barrier(e.target.value)}
                  className="h-7 text-xs bg-gray-900 border-gray-700 text-gray-200" placeholder="Barrier (0-9)" disabled={isRunning} />
              )}
              {/* Virtual Hook M2 */}
              <div className="border-t border-gray-700/50 pt-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-medium text-cyan-400 flex items-center gap-1">
                    <Anchor className="w-3 h-3" /> Virtual Hook
                  </span>
                  <Switch checked={m2HookEnabled} onCheckedChange={setM2HookEnabled} disabled={isRunning} />
                </div>
                {m2HookEnabled && (
                  <div className="grid grid-cols-2 gap-1.5 mt-1">
                    <div>
                      <label className="text-[8px] text-gray-500 font-medium">V-Losses</label>
                      <Input type="number" min="1" max="20" value={m2VirtualLossCount} onChange={e => setM2VirtualLossCount(e.target.value)} disabled={isRunning} className="h-6 text-[10px] bg-gray-900 border-gray-700 text-gray-200" />
                    </div>
                    <div>
                      <label className="text-[8px] text-gray-500 font-medium">Real Trades</label>
                      <Input type="number" min="1" max="10" value={m2RealCount} onChange={e => setM2RealCount(e.target.value)} disabled={isRunning} className="h-6 text-[10px] bg-gray-900 border-gray-700 text-gray-200" />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Virtual Hook Stats */}
          {(m1HookEnabled || m2HookEnabled) && (
            <div className="bg-gradient-to-br from-gray-800 to-gray-900 border border-cyan-500/30 rounded-xl p-2.5 shadow-md">
              <h3 className="text-[10px] font-semibold text-cyan-400 flex items-center gap-1 mb-1">
                <Anchor className="w-3 h-3" /> Hook Status
              </h3>
              <div className="grid grid-cols-4 gap-1 text-center">
                <div className="bg-gray-900/60 rounded p-1 border border-gray-700">
                  <div className="text-[8px] text-gray-500 font-medium">V-Win</div>
                  <div className="font-mono text-[10px] font-bold text-emerald-400">{vhFakeWins}</div>
                </div>
                <div className="bg-gray-900/60 rounded p-1 border border-gray-700">
                  <div className="text-[8px] text-gray-500 font-medium">V-Loss</div>
                  <div className="font-mono text-[10px] font-bold text-rose-400">{vhFakeLosses}</div>
                </div>
                <div className="bg-gray-900/60 rounded p-1 border border-gray-700">
                  <div className="text-[8px] text-gray-500 font-medium">Streak</div>
                  <div className="font-mono text-[10px] font-bold text-amber-400">{vhConsecLosses}</div>
                </div>
                <div className="bg-gray-900/60 rounded p-1 border border-gray-700">
                  <div className="text-[8px] text-gray-500 font-medium">State</div>
                  <div className={`text-[9px] font-bold ${
                    vhStatus === 'confirmed' ? 'text-emerald-400' :
                    vhStatus === 'waiting' ? 'text-amber-400 animate-pulse' :
                    vhStatus === 'failed' ? 'text-rose-400' : 'text-gray-500'
                  }`}>
                    {vhStatus === 'confirmed' ? '✓' : vhStatus === 'waiting' ? '⏳' : vhStatus === 'failed' ? '✗' : '—'}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Risk */}
          <div className="bg-gradient-to-br from-gray-800 to-gray-900 border border-gray-700 rounded-xl p-2.5 space-y-1.5 shadow-md">
            <h3 className="text-xs font-semibold text-gray-200 flex items-center gap-1"><Shield className="w-3.5 h-3.5 text-amber-400" /> Risk</h3>
            <div className="grid grid-cols-3 gap-1.5">
              <div>
                <label className="text-[8px] text-gray-500 font-medium">Stake ($)</label>
                <Input type="number" min="0.35" step="0.01" value={stake} onChange={e => setStake(e.target.value)} disabled={isRunning} className="h-7 text-xs bg-gray-900 border-gray-700 text-gray-200" />
              </div>
              <div>
                <label className="text-[8px] text-gray-500 font-medium">Take Profit</label>
                <Input type="number" value={takeProfit} onChange={e => setTakeProfit(e.target.value)} disabled={isRunning} className="h-7 text-xs bg-gray-900 border-gray-700 text-gray-200" />
              </div>
              <div>
                <label className="text-[8px] text-gray-500 font-medium">Stop Loss</label>
                <Input type="number" value={stopLoss} onChange={e => setStopLoss(e.target.value)} disabled={isRunning} className="h-7 text-xs bg-gray-900 border-gray-700 text-gray-200" />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <label className="text-[10px] text-gray-200 font-medium">Martingale</label>
              <Switch checked={martingaleOn} onCheckedChange={setMartingaleOn} disabled={isRunning} />
            </div>
            {martingaleOn && (
              <div className="grid grid-cols-2 gap-1.5">
                <div>
                  <label className="text-[8px] text-gray-500 font-medium">Multiplier</label>
                  <Input type="number" min="1.1" step="0.1" value={martingaleMultiplier} onChange={e => setMartingaleMultiplier(e.target.value)} disabled={isRunning} className="h-7 text-xs bg-gray-900 border-gray-700 text-gray-200" />
                </div>
                <div>
                  <label className="text-[8px] text-gray-500 font-medium">Max Steps</label>
                  <Input type="number" min="1" max="10" value={martingaleMaxSteps} onChange={e => setMartingaleMaxSteps(e.target.value)} disabled={isRunning} className="h-7 text-xs bg-gray-900 border-gray-700 text-gray-200" />
                </div>
              </div>
            )}
            <div className="flex items-center gap-3 pt-0.5">
              <label className="flex items-center gap-1 text-[10px] text-gray-200">
                <input type="checkbox" checked={strategyM1Enabled} onChange={e => setStrategyM1Enabled(e.target.checked)} disabled={isRunning} className="rounded w-3 h-3 accent-cyan-500" />
                Strategy M1
              </label>
              <label className="flex items-center gap-1 text-[10px] text-gray-200">
                <input type="checkbox" checked={strategyEnabled} onChange={e => setStrategyEnabled(e.target.checked)} disabled={isRunning} className="rounded w-3 h-3 accent-cyan-500" />
                Strategy M2
              </label>
            </div>
          </div>

          {/* Strategy Card */}
          {(strategyEnabled || strategyM1Enabled) && (
            <div className="bg-gradient-to-br from-gray-800 to-gray-900 border border-amber-500/30 rounded-xl p-2.5 space-y-1.5 shadow-md">
              <h3 className="text-xs font-semibold text-amber-400 flex items-center gap-1"><Zap className="w-3.5 h-3.5" /> Strategy</h3>

              {/* M1 Strategy */}
              {strategyM1Enabled && (
                <div className="border border-emerald-500/20 rounded-lg p-1.5 space-y-1 bg-gray-900/50">
                  <div className="flex items-center justify-between">
                    <label className="text-[9px] font-semibold text-emerald-400">M1 Strategy</label>
                    <div className="flex gap-0.5">
                      <Button size="sm" variant={m1StrategyMode === 'pattern' ? 'default' : 'outline'}
                        className="text-[9px] h-5 px-1.5 font-medium bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700" onClick={() => setM1StrategyMode('pattern')} disabled={isRunning}>
                        Pattern
                      </Button>
                      <Button size="sm" variant={m1StrategyMode === 'digit' ? 'default' : 'outline'}
                        className="text-[9px] h-5 px-1.5 font-medium bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700" onClick={() => setM1StrategyMode('digit')} disabled={isRunning}>
                        Digit
                      </Button>
                    </div>
                  </div>
                  {m1StrategyMode === 'pattern' ? (
                    <>
                      <Textarea placeholder="E=Even O=Odd e.g. EEEOE" value={m1Pattern}
                        onChange={e => setM1Pattern(e.target.value.toUpperCase().replace(/[^EO]/g, ''))}
                        disabled={isRunning} className="h-10 text-[10px] font-mono min-h-0 bg-gray-900 border-gray-700 text-gray-200" />
                      <div className={`text-[9px] font-mono ${m1PatternValid ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {cleanM1Pattern.length === 0 ? 'Enter pattern...' :
                          m1PatternValid ? `✓ ${cleanM1Pattern}` : `✗ Need 2+`}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="grid grid-cols-3 gap-1 mt-0.5">
                        <label className="text-[8px] text-gray-500 font-medium text-center">Condition</label>
                        <label className="text-[8px] text-gray-500 font-medium text-center">Digit</label>
                        <label className="text-[8px] text-gray-500 font-medium text-center">Ticks</label>
                      </div>
                      <div className="grid grid-cols-3 gap-1">
                        <Select value={m1DigitCondition} onValueChange={setM1DigitCondition} disabled={isRunning}>
                          <SelectTrigger className="h-6 text-[10px] bg-gray-900 border-gray-700 text-gray-200"><SelectValue /></SelectTrigger>
                          <SelectContent className="bg-gray-800 border-gray-700">
                            {['==', '>', '<', '>=', '<='].map(c => <SelectItem key={c} value={c} className="text-gray-200">{c}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Input type="number" min="0" max="9" value={m1DigitCompare} onChange={e => setM1DigitCompare(e.target.value)} disabled={isRunning} className="h-6 text-[10px] bg-gray-900 border-gray-700 text-gray-200" />
                        <Input type="number" min="1" max="50" value={m1DigitWindow} onChange={e => setM1DigitWindow(e.target.value)} disabled={isRunning} className="h-6 text-[10px] bg-gray-900 border-gray-700 text-gray-200" />
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* M2 Strategy */}
              {strategyEnabled && (
                <div className="border border-purple-500/20 rounded-lg p-1.5 space-y-1 bg-gray-900/50">
                  <div className="flex items-center justify-between">
                    <label className="text-[9px] font-semibold text-purple-400">M2 Strategy</label>
                    <div className="flex gap-0.5">
                      <Button size="sm" variant={m2StrategyMode === 'pattern' ? 'default' : 'outline'}
                        className="text-[9px] h-5 px-1.5 font-medium bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700" onClick={() => setM2StrategyMode('pattern')} disabled={isRunning}>
                        Pattern
                      </Button>
                      <Button size="sm" variant={m2StrategyMode === 'digit' ? 'default' : 'outline'}
                        className="text-[9px] h-5 px-1.5 font-medium bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700" onClick={() => setM2StrategyMode('digit')} disabled={isRunning}>
                        Digit
                      </Button>
                    </div>
                  </div>
                  {m2StrategyMode === 'pattern' ? (
                    <>
                      <Textarea placeholder="E=Even O=Odd e.g. OOEEO" value={m2Pattern}
                        onChange={e => setM2Pattern(e.target.value.toUpperCase().replace(/[^EO]/g, ''))}
                        disabled={isRunning} className="h-10 text-[10px] font-mono min-h-0 bg-gray-900 border-gray-700 text-gray-200" />
                      <div className={`text-[9px] font-mono ${m2PatternValid ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {cleanM2Pattern.length === 0 ? 'Enter pattern...' :
                          m2PatternValid ? `✓ ${cleanM2Pattern}` : `✗ Need 2+`}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="grid grid-cols-3 gap-1 mt-0.5">
                        <label className="text-[8px] text-gray-500 font-medium text-center">Condition</label>
                        <label className="text-[8px] text-gray-500 font-medium text-center">Digit</label>
                        <label className="text-[8px] text-gray-500 font-medium text-center">Ticks</label>
                      </div>
                      <div className="grid grid-cols-3 gap-1">
                        <Select value={m2DigitCondition} onValueChange={setM2DigitCondition} disabled={isRunning}>
                          <SelectTrigger className="h-6 text-[10px] bg-gray-900 border-gray-700 text-gray-200"><SelectValue /></SelectTrigger>
                          <SelectContent className="bg-gray-800 border-gray-700">
                            {['==', '>', '<', '>=', '<='].map(c => <SelectItem key={c} value={c} className="text-gray-200">{c}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Input type="number" min="0" max="9" value={m2DigitCompare} onChange={e => setM2DigitCompare(e.target.value)} disabled={isRunning} className="h-6 text-[10px] bg-gray-900 border-gray-700 text-gray-200" />
                        <Input type="number" min="1" max="50" value={m2DigitWindow} onChange={e => setM2DigitWindow(e.target.value)} disabled={isRunning} className="h-6 text-[10px] bg-gray-900 border-gray-700 text-gray-200" />
                      </div>
                    </>
                  )}
                </div>
              )}

              {botStatus === 'waiting_pattern' && (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded p-1.5 text-[9px] text-amber-400 animate-pulse text-center font-semibold">
                  ⏳ WAITING FOR PATTERN...
                </div>
              )}
              {botStatus === 'pattern_matched' && (
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded p-1.5 text-[9px] text-emerald-400 text-center font-semibold animate-pulse">
                  ✅ PATTERN MATCHED!
                </div>
              )}
            </div>
          )}

          {/* Save / Load Config */}
          <div className="bg-gradient-to-br from-gray-800 to-gray-900 border border-gray-700 rounded-xl p-2.5 space-y-1.5 shadow-md">
            <h3 className="text-xs font-semibold text-gray-200 flex items-center gap-1">💾 Bot Config</h3>
            <Input
              placeholder="Enter bot name before saving..."
              value={botName}
              onChange={e => setBotName(e.target.value)}
              disabled={isRunning}
              className="h-7 text-xs bg-gray-900 border-gray-700 text-gray-200 placeholder:text-gray-600"
            />
            <div className="grid grid-cols-2 gap-1.5">
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-[10px] gap-1 font-medium bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700"
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
                className="h-8 text-[10px] gap-1 font-medium bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700"
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
                        if (cfg.botName) setBotName(cfg.botName);
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

        {/* ═══ RIGHT: Digit Stream + Activity Log + Analyzer ═══ */}
        <div className="lg:col-span-8 space-y-2">
          {/* Digit Stream */}
          <div className="bg-gradient-to-br from-gray-800 to-gray-900 border border-gray-700 rounded-xl p-2.5 shadow-md">
            <div className="flex items-center justify-between mb-1.5">
              <h3 className="text-[10px] font-semibold text-gray-200">Live Digits — {activeSymbol}</h3>
              <span className="text-[9px] text-gray-500 font-mono font-medium">Win Rate: {winRate}% | Staked: ${totalStaked.toFixed(2)}</span>
            </div>
            <div className="flex gap-1 justify-center">
              {activeDigits.length === 0 ? (
                <span className="text-[10px] text-gray-500 font-medium">Waiting for ticks...</span>
              ) : activeDigits.map((d, i) => {
                const isOver = d >= 5;
                const isEven = d % 2 === 0;
                const isLast = i === activeDigits.length - 1;
                return (
                  <div key={i} className={`w-8 h-10 rounded-lg flex flex-col items-center justify-center text-xs font-mono font-bold border transition-all ${
                    isLast ? 'ring-2 ring-cyan-400' : ''
                  } ${isOver ? 'bg-rose-500/10 border-rose-500/30 text-rose-400' : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'}`}>
                    <span className="text-sm">{d}</span>
                    <span className="text-[7px] opacity-60">{isOver ? 'O' : 'U'}{isEven ? 'E' : 'O'}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Trade Summary Panel */}
          <div className="grid grid-cols-5 gap-1.5">
            <div className="bg-gray-800/60 backdrop-blur-sm border border-gray-700 rounded-lg p-2 text-center shadow-md">
              <div className="text-[8px] text-gray-500 font-medium">Trades</div>
              <div className="font-mono text-xs font-bold text-white">{wins + losses}</div>
            </div>
            <div className="bg-gray-800/60 backdrop-blur-sm border border-gray-700 rounded-lg p-2 text-center shadow-md">
              <div className="text-[8px] text-gray-500 font-medium">Wins</div>
              <div className="font-mono text-xs font-bold text-emerald-400">{wins}</div>
            </div>
            <div className="bg-gray-800/60 backdrop-blur-sm border border-gray-700 rounded-lg p-2 text-center shadow-md">
              <div className="text-[8px] text-gray-500 font-medium">Losses</div>
              <div className="font-mono text-xs font-bold text-rose-400">{losses}</div>
            </div>
            <div className="bg-gray-800/60 backdrop-blur-sm border border-gray-700 rounded-lg p-2 text-center shadow-md">
              <div className="text-[8px] text-gray-500 font-medium">Profit/Loss</div>
              <div className={`font-mono text-xs font-bold ${netProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {netProfit >= 0 ? '+' : ''}{netProfit.toFixed(2)}
              </div>
            </div>
            <div className="bg-gray-800/60 backdrop-blur-sm border border-gray-700 rounded-lg p-2 text-center shadow-md">
              <div className="text-[8px] text-gray-500 font-medium">Total Staked</div>
              <div className="font-mono text-xs font-bold text-cyan-400">${totalStaked.toFixed(2)}</div>
            </div>
          </div>

          {/* Start / Stop Buttons */}
          <div className="grid grid-cols-2 gap-2">
            <Button
              onClick={startBot}
              disabled={isRunning || !isAuthorized || balance < parseFloat(stake) || !isConnected}
              className="h-14 text-base font-bold bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-700 hover:to-emerald-600 text-white rounded-xl shadow-lg"
            >
              <Play className="w-5 h-5 mr-2" /> START M1
            </Button>
            <Button
              onClick={stopBot}
              disabled={!isRunning}
              variant="destructive"
              className="h-14 text-base font-bold bg-gradient-to-r from-rose-600 to-rose-500 hover:from-rose-700 hover:to-rose-600 text-white rounded-xl shadow-lg"
            >
              <StopCircle className="w-5 h-5 mr-2" /> STOP
            </Button>
          </div>

          {/* Activity Log */}
          <div className="bg-gradient-to-br from-gray-800 to-gray-900 border border-gray-700 rounded-xl overflow-hidden shadow-md">
            <div className="px-2.5 py-2 border-b border-gray-700 flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold text-gray-200">Activity Log</h3>
              <div className="flex items-center gap-1.5">
                {logEntries.length > 0 && logEntries[0].switchInfo && (
                  <span className="text-[9px] text-gray-500 font-mono font-medium hidden md:inline truncate max-w-[200px]">
                    {logEntries[0].switchInfo}
                  </span>
                )}
                {!isRunning ? (
                  <Button onClick={startBot} disabled={!isAuthorized || balance < parseFloat(stake) || !isConnected}
                    size="sm" className="h-7 text-[10px] font-bold bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-700 hover:to-emerald-600 text-white px-3">
                    <Play className="w-3 h-3 mr-1" /> START
                  </Button>
                ) : (
                  <Button onClick={stopBot} variant="destructive" size="sm" className="h-7 text-[10px] font-bold bg-rose-600 hover:bg-rose-700 text-white px-3">
                    <StopCircle className="w-3 h-3 mr-1" /> STOP
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={clearLog} className="h-7 w-7 p-0 text-gray-500 hover:text-rose-400 hover:bg-gray-800">
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            </div>
            <div className="max-h-[calc(100vh-380px)] min-h-[300px] overflow-auto">
              <table className="w-full text-[10px]">
                <thead className="text-[9px] text-gray-500 font-medium bg-gray-900/80 sticky top-0">
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
                    <tr><td colSpan={10} className="text-center text-gray-500 py-8 font-medium">No trades yet — configure and start the bot</td></tr>
                  ) : logEntries.map(e => (
                    <tr key={e.id} className={`border-t border-gray-700/50 hover:bg-gray-800/30 ${
                      e.market === 'M1' ? 'border-l-2 border-l-emerald-500' :
                      e.market === 'VH' ? 'border-l-2 border-l-cyan-500' :
                      'border-l-2 border-l-purple-500'
                    }`}>
                      <td className="p-1 font-mono text-[9px] text-gray-300">{e.time}</td>
                      <td className={`p-1 font-bold ${
                        e.market === 'M1' ? 'text-emerald-400' :
                        e.market === 'VH' ? 'text-cyan-400' :
                        'text-purple-400'
                      }`}>{e.market}</td>
                      <td className="p-1 font-mono text-[9px] text-gray-300">{e.symbol}</td>
                      <td className="p-1 text-[9px] text-gray-300">{e.contract.replace('DIGIT', '')}</td>
                      <td className="p-1 font-mono text-right text-[9px] text-gray-300">
                        {e.market === 'VH' ? 'FAKE' : `$${e.stake.toFixed(2)}`}
                        {e.martingaleStep > 0 && e.market !== 'VH' && <span className="text-amber-400 ml-0.5">M{e.martingaleStep}</span>}
                      </td>
                      <td className="p-1 text-center font-mono text-gray-300">{e.exitDigit}</td>
                      <td className="p-1 text-center">
                        <span className={`px-1 py-0.5 rounded-full text-[8px] font-bold ${
                          e.result === 'Win' || e.result === 'V-Win' ? 'bg-emerald-500/20 text-emerald-400' :
                          e.result === 'Loss' || e.result === 'V-Loss' ? 'bg-rose-500/20 text-rose-400' :
                          'bg-amber-500/20 text-amber-400 animate-pulse'
                        }`}>{e.result === 'Pending' ? '...' : e.result}</span>
                      </td>
                      <td className={`p-1 font-mono text-right text-[9px] ${e.pnl > 0 ? 'text-emerald-400' : e.pnl < 0 ? 'text-rose-400' : 'text-gray-500'}`}>
                        {e.result === 'Pending' ? '...' : e.market === 'VH' ? '-' : `${e.pnl > 0 ? '+' : ''}${e.pnl.toFixed(2)}`}
                      </td>
                      <td className="p-1 font-mono text-right text-[9px] text-gray-300">{e.market === 'VH' ? '-' : `$${e.balance.toFixed(2)}`}</td>
                      <td className="p-1 text-center">
                        {isRunning && (
                          <button onClick={stopBot} className="px-1 py-0.5 rounded bg-rose-600/80 hover:bg-rose-600 text-white text-[8px] font-bold transition-colors" title="Stop Bot">
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

          {/* ── NEW: HTML Analyzer Section ── */}
          <div className="bg-gradient-to-br from-gray-800 to-gray-900 border border-gray-700 rounded-xl p-4 shadow-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-cyan-400 flex items-center gap-2">
                <span>📊</span> Deriv Over/Under Entry Digit Analyzer
              </h3>
              <div className="flex items-center gap-3">
                <div className="text-xs text-gray-400">
                  Status: <span className={`font-medium ${
                    analyzerStatus === 'Live' ? 'text-emerald-400' : 
                    analyzerStatus === 'Error' ? 'text-rose-400' : 'text-amber-400'
                  }`}>{analyzerStatus}</span>
                </div>
                <a
                  href="https://ramztraders.site/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
                >
                  Trade on ramztraders.site ↗
                </a>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
              <div>
                <label className="block text-[10px] text-gray-500 mb-1">Mode</label>
                <Select value={analyzerMode} onValueChange={(v: 'over' | 'under') => setAnalyzerMode(v)}>
                  <SelectTrigger className="h-8 text-xs bg-gray-900 border-gray-700 text-gray-200">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-800 border-gray-700">
                    <SelectItem value="over" className="text-gray-200">Over</SelectItem>
                    <SelectItem value="under" className="text-gray-200">Under</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="block text-[10px] text-gray-500 mb-1">Market</label>
                <Select value={analyzerSymbol} onValueChange={setAnalyzerSymbol}>
                  <SelectTrigger className="h-8 text-xs bg-gray-900 border-gray-700 text-gray-200">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-800 border-gray-700 max-h-[300px]">
                    {SCANNER_MARKETS.map(m => (
                      <SelectItem key={m.symbol} value={m.symbol} className="text-gray-200 text-xs">
                        {m.name} ({m.symbol})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="block text-[10px] text-gray-500 mb-1">Threshold</label>
                <div className="flex gap-1 flex-wrap">
                  {[0,1,2,3,4,5,6,7,8,9].map(d => (
                    <button
                      key={d}
                      onClick={() => handleAnalyzerDigitClick(d)}
                      className={`w-7 h-7 rounded text-xs font-bold transition-all ${
                        analyzerThreshold === d
                          ? 'bg-cyan-600 text-white ring-2 ring-cyan-400'
                          : 'bg-gray-900 text-gray-300 hover:bg-gray-700 border border-gray-700'
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-[10px] text-gray-500 mb-1">Ticks (1000)</label>
                <Input
                  type="number"
                  value="1000"
                  disabled
                  className="h-8 text-xs bg-gray-900 border-gray-700 text-gray-200 opacity-50"
                />
              </div>
            </div>

            {analyzerStats && (
              <>
                {/* Prediction Box */}
                <div className={`p-3 rounded-lg text-center font-bold mb-4 ${
                  analyzerStats.signalClass === 'signal-over' ? 'bg-green-900/50 text-green-400' :
                  analyzerStats.signalClass === 'signal-under' ? 'bg-red-900/50 text-red-400' :
                  'bg-gray-800 text-gray-400'
                }`}>
                  {analyzerStats.signalText}
                </div>

                {/* Last Digits */}
                <div className="mb-4">
                  <h4 className="text-[10px] text-gray-500 mb-2">Last 30 Digits</h4>
                  <div className="grid grid-cols-15 gap-1">
                    {analyzerStats.lastDigits.map((d: number, i: number) => {
                      let bgColor = 'bg-gray-900';
                      if (d === analyzerThreshold) bgColor = 'bg-blue-600';
                      else if (analyzerMode === 'over' && d > analyzerThreshold) bgColor = 'bg-green-700';
                      else if (analyzerMode === 'over' && d < analyzerThreshold) bgColor = 'bg-red-700';
                      else if (analyzerMode === 'under' && d < analyzerThreshold) bgColor = 'bg-green-700';
                      else if (analyzerMode === 'under' && d > analyzerThreshold) bgColor = 'bg-red-700';
                      
                      return (
                        <div
                          key={i}
                          className={`w-7 h-7 rounded flex items-center justify-center text-xs font-bold text-white ${bgColor}`}
                        >
                          {d}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Digit Buttons with Percentages */}
                <div className="mb-4">
                  <h4 className="text-[10px] text-gray-500 mb-2">Digit Distribution</h4>
                  <div className="grid grid-cols-5 gap-1">
                    {[0,1,2,3,4,5,6,7,8,9].map(d => {
                      const percent = analyzerStats.counts[d] / analyzerTicks.slice(-1000).length * 100;
                      let bgColor = 'bg-gray-900';
                      if (d === analyzerStats.most) bgColor = 'bg-green-700';
                      else if (d === analyzerStats.second) bgColor = 'bg-blue-700';
                      else if (d === Math.min(...Object.values(analyzerStats.counts))) bgColor = 'bg-red-700';
                      
                      return (
                        <div
                          key={d}
                          className={`p-2 rounded text-center ${bgColor}`}
                        >
                          <div className="text-sm font-bold text-white">{d}</div>
                          <div className="text-[8px] text-gray-300">{percent.toFixed(1)}%</div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Percentages and Triggers */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-gray-900/50 p-3 rounded-lg border border-gray-700">
                    <h4 className="text-[10px] text-gray-500 mb-1">Over/Under Percentages</h4>
                    <p className="text-sm font-mono">
                      Under {analyzerThreshold}: <span className="text-emerald-400">{analyzerStats.lowPercent}%</span> | 
                      Over {analyzerThreshold}: <span className="text-amber-400">{analyzerStats.highPercent}%</span>
                    </p>
                  </div>
                  <div className="bg-gray-900/50 p-3 rounded-lg border border-gray-700">
                    <h4 className="text-[10px] text-gray-500 mb-1">Entry Triggers</h4>
                    <p className="text-xs">
                      <span className="text-emerald-400">
                        ✅ Winning digits: [{analyzerStats.winningDigits.length ? analyzerStats.winningDigits.join(', ') : 'none'}]
                      </span>
                      <br />
                      <span className="text-rose-400">
                        ❌ Losing digits: [{analyzerStats.losingDigits.length ? analyzerStats.losingDigits.join(', ') : 'none'}]
                      </span>
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
