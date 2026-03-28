import { useState, useRef, useCallback, useEffect } from 'react'; 
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
import { toast } from 'sonner';
import {
  Play, StopCircle, Trash2, Scan,
  Home, RefreshCw, Shield, TrendingUp, DollarSign
} from 'lucide-react';

const SCANNER_MARKETS: { symbol: string; name: string }[] = [
  { symbol: 'R_10', name: 'Vol 10' },
  { symbol: 'R_25', name: 'Vol 25' },
  { symbol: 'R_50', name: 'Vol 50' },
  { symbol: 'R_75', name: 'Vol 75' },
  { symbol: 'R_100', name: 'Vol 100' },
  { symbol: '1HZ10V', name: 'V10 1s' },
  { symbol: '1HZ15V', name: 'V15 1s' },
  { symbol: '1HZ25V', name: 'V25 1s' },
  { symbol: '1HZ30V', name: 'V30 1s' },
  { symbol: '1HZ50V', name: 'V50 1s' },
  { symbol: '1HZ75V', name: 'V75 1s' },
  { symbol: '1HZ90V', name: 'V90 1s' },
  { symbol: '1HZ100V', name: 'V100 1s' },
  { symbol: 'JD10', name: 'Jump 10' },
  { symbol: 'JD25', name: 'Jump 25' },
  { symbol: 'RDBEAR', name: 'Bear' },
  { symbol: 'RDBULL', name: 'Bull' },
];

type BotStatus = 'idle' | 'trading_m1' | 'recovery' | 'waiting_pattern' | 'pattern_matched';
type M1StrategyType = 'over0_under9' | 'over1_under8' | 'over2_under7' | 'over3_under6' | 'over4_under5_5' | 'disabled';
type M2RecoveryType = 'odd_even_5' | 'odd_even_6' | 'odd_even_8' | 'odd_even_9' | 'odd_even_7' | 'over4_under5_5' | 'over4_under5_6' | 'over4_under5_8' | 'over4_under5_9' | 'over4_under5_7' | 'disabled';

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

interface DetectedPattern {
  symbol: string;
  name: string;
  patternType: string;
  timestamp: number;
  digits: number[];
}

function waitForNextTick(symbol: string): Promise<{ quote: number }> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      unsub();
      resolve({ quote: 0 });
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

export default function ProScannerBot() {
  const { isAuthorized, balance, activeAccount } = useAuth();
  const { recordLoss } = useLossRequirement();

  /* ── Market 1 config ── */
  const [m1Enabled, setM1Enabled] = useState(true);
  const [m1StrategyType, setM1StrategyType] = useState<M1StrategyType>('over1_under8');

  /* ── Market 2 config ── */
  const [m2Enabled, setM2Enabled] = useState(true);
  const [m2RecoveryType, setM2RecoveryType] = useState<M2RecoveryType>('over4_under5_9');

  /* ── Risk ── */
  const [stake, setStake] = useState('0.35');
  const [martingaleOn, setMartingaleOn] = useState(true);
  const [martingaleMultiplier, setMartingaleMultiplier] = useState('2.0');
  const [martingaleMaxSteps, setMartingaleMaxSteps] = useState('5');
  const [takeProfit, setTakeProfit] = useState('10');
  const [stopLoss, setStopLoss] = useState('5');

  /* ── Strategy Enabled Flags ── */
  const [strategyM1Enabled, setStrategyM1Enabled] = useState(true);
  const [strategyM2Enabled, setStrategyM2Enabled] = useState(true);

  /* ── Scanner ── */
  const [scannerActive, setScannerActive] = useState(true);
  
  /* ── Detected Patterns for Display ── */
  const [detectedPatterns, setDetectedPatterns] = useState<DetectedPattern[]>([]);

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
  
  // Track last trade timestamp per symbol to prevent multiple trades on same pattern
  const lastTradeTimeRef = useRef<Map<string, number>>(new Map());
  // Track last pattern digits to avoid re-trading same pattern
  const lastPatternDigitsRef = useRef<Map<string, string>>(new Map());
  // Track overall last trade time to prevent rapid successive trades
  const lastTradeOverallRef = useRef<number>(0);

  /* ── Tick data ── */
  const tickMapRef = useRef<Map<string, number[]>>(new Map());

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
    };
    const unsub = derivApi.onMessage(handler);
    SCANNER_MARKETS.forEach(m => { derivApi.subscribeTicks(m.symbol as MarketSymbol, () => {}).catch(() => {}); });
    return () => { active = false; unsub(); };
  }, []);

  const checkM1Pattern = useCallback((symbol: string): { matched: boolean; contractType?: string; barrier?: string; patternDigits?: string } => {
    const digits = tickMapRef.current.get(symbol) || [];
    
    switch (m1StrategyType) {
      case 'over0_under9': {
        if (digits.length < 2) return { matched: false };
        const last2 = digits.slice(-2);
        const patternKey = `${last2.join(',')}`;
        
        if (last2[0] === 0 && last2[1] === 0) {
          return { matched: true, contractType: 'DIGITOVER', barrier: '0', patternDigits: patternKey };
        }
        if (last2[0] === 9 && last2[1] === 9) {
          return { matched: true, contractType: 'DIGITUNDER', barrier: '9', patternDigits: patternKey };
        }
        return { matched: false };
      }
      
      case 'over1_under8': {
        if (digits.length < 2) return { matched: false };
        const last2 = digits.slice(-2);
        const patternKey = `${last2.join(',')}`;
        
        if (last2[0] === 0 && last2[1] === 0) {
          return { matched: true, contractType: 'DIGITOVER', barrier: '1', patternDigits: patternKey };
        }
        if (last2[0] === 9 && last2[1] === 9) {
          return { matched: true, contractType: 'DIGITUNDER', barrier: '8', patternDigits: patternKey };
        }
        return { matched: false };
      }
      
      case 'over2_under7': {
        if (digits.length < 3) return { matched: false };
        const last3 = digits.slice(-3);
        const patternKey = `${last3.join(',')}`;
        const allLessThan2 = last3.every(d => d < 2);
        const allGreaterThan7 = last3.every(d => d > 7);
        
        if (allLessThan2) {
          return { matched: true, contractType: 'DIGITOVER', barrier: '2', patternDigits: patternKey };
        }
        if (allGreaterThan7) {
          return { matched: true, contractType: 'DIGITUNDER', barrier: '7', patternDigits: patternKey };
        }
        return { matched: false };
      }
      
      case 'over3_under6': {
        if (digits.length < 4) return { matched: false };
        const last4 = digits.slice(-4);
        const patternKey = `${last4.join(',')}`;
        const allLessThan3 = last4.every(d => d < 3);
        const allGreaterThan6 = last4.every(d => d > 6);
        
        if (allLessThan3) {
          return { matched: true, contractType: 'DIGITOVER', barrier: '3', patternDigits: patternKey };
        }
        if (allGreaterThan6) {
          return { matched: true, contractType: 'DIGITUNDER', barrier: '6', patternDigits: patternKey };
        }
        return { matched: false };
      }
      
      case 'over4_under5_5': {
        if (digits.length < 5) return { matched: false };
        const last5 = digits.slice(-5);
        const patternKey = `${last5.join(',')}`;
        const allOver4 = last5.every(d => d >= 5);
        const allUnder5 = last5.every(d => d <= 4);
        
        if (allOver4) {
          return { matched: true, contractType: 'DIGITOVER', barrier: '4', patternDigits: patternKey };
        }
        if (allUnder5) {
          return { matched: true, contractType: 'DIGITUNDER', barrier: '5', patternDigits: patternKey };
        }
        return { matched: false };
      }
      
      default:
        return { matched: false };
    }
  }, [m1StrategyType]);

  const checkM2Pattern = useCallback((symbol: string): { matched: boolean; contractType?: string; barrier?: string; patternDigits?: string } => {
    const digits = tickMapRef.current.get(symbol) || [];
    
    switch (m2RecoveryType) {
      case 'odd_even_5': {
        if (digits.length < 5) return { matched: false };
        const last5 = digits.slice(-5);
        const patternKey = `${last5.join(',')}`;
        const allOdd = last5.every(d => d % 2 !== 0);
        const allEven = last5.every(d => d % 2 === 0);
        
        if (allOdd) {
          return { matched: true, contractType: 'DIGITEVEN', patternDigits: patternKey };
        }
        if (allEven) {
          return { matched: true, contractType: 'DIGITODD', patternDigits: patternKey };
        }
        return { matched: false };
      }
      
      case 'odd_even_6': {
        if (digits.length < 6) return { matched: false };
        const last6 = digits.slice(-6);
        const patternKey = `${last6.join(',')}`;
        const allOdd = last6.every(d => d % 2 !== 0);
        const allEven = last6.every(d => d % 2 === 0);
        
        if (allOdd) {
          return { matched: true, contractType: 'DIGITEVEN', patternDigits: patternKey };
        }
        if (allEven) {
          return { matched: true, contractType: 'DIGITODD', patternDigits: patternKey };
        }
        return { matched: false };
      }
      
      case 'odd_even_8': {
        if (digits.length < 8) return { matched: false };
        const last8 = digits.slice(-8);
        const patternKey = `${last8.join(',')}`;
        const allOdd = last8.every(d => d % 2 !== 0);
        const allEven = last8.every(d => d % 2 === 0);
        
        if (allOdd) {
          return { matched: true, contractType: 'DIGITEVEN', patternDigits: patternKey };
        }
        if (allEven) {
          return { matched: true, contractType: 'DIGITODD', patternDigits: patternKey };
        }
        return { matched: false };
      }
      
      case 'odd_even_9': {
        if (digits.length < 9) return { matched: false };
        const last9 = digits.slice(-9);
        const patternKey = `${last9.join(',')}`;
        const allOdd = last9.every(d => d % 2 !== 0);
        const allEven = last9.every(d => d % 2 === 0);
        
        if (allOdd) {
          return { matched: true, contractType: 'DIGITEVEN', patternDigits: patternKey };
        }
        if (allEven) {
          return { matched: true, contractType: 'DIGITODD', patternDigits: patternKey };
        }
        return { matched: false };
      }
      
      case 'odd_even_7': {
        if (digits.length < 7) return { matched: false };
        const last7 = digits.slice(-7);
        const patternKey = `${last7.join(',')}`;
        const allOdd = last7.every(d => d % 2 !== 0);
        const allEven = last7.every(d => d % 2 === 0);
        
        if (allOdd) {
          return { matched: true, contractType: 'DIGITEVEN', patternDigits: patternKey };
        }
        if (allEven) {
          return { matched: true, contractType: 'DIGITODD', patternDigits: patternKey };
        }
        return { matched: false };
      }
      
      case 'over4_under5_5': {
        if (digits.length < 5) return { matched: false };
        const last5 = digits.slice(-5);
        const patternKey = `${last5.join(',')}`;
        const allOver4 = last5.every(d => d >= 5);
        const allUnder5 = last5.every(d => d <= 4);
        
        if (allOver4) {
          return { matched: true, contractType: 'DIGITOVER', barrier: '4', patternDigits: patternKey };
        }
        if (allUnder5) {
          return { matched: true, contractType: 'DIGITUNDER', barrier: '5', patternDigits: patternKey };
        }
        return { matched: false };
      }
      
      case 'over4_under5_6': {
        if (digits.length < 6) return { matched: false };
        const last6 = digits.slice(-6);
        const patternKey = `${last6.join(',')}`;
        const allOver4 = last6.every(d => d >= 5);
        const allUnder5 = last6.every(d => d <= 4);
        
        if (allOver4) {
          return { matched: true, contractType: 'DIGITOVER', barrier: '4', patternDigits: patternKey };
        }
        if (allUnder5) {
          return { matched: true, contractType: 'DIGITUNDER', barrier: '5', patternDigits: patternKey };
        }
        return { matched: false };
      }
      
      case 'over4_under5_8': {
        if (digits.length < 8) return { matched: false };
        const last8 = digits.slice(-8);
        const patternKey = `${last8.join(',')}`;
        const allOver4 = last8.every(d => d >= 5);
        const allUnder5 = last8.every(d => d <= 4);
        
        if (allOver4) {
          return { matched: true, contractType: 'DIGITOVER', barrier: '4', patternDigits: patternKey };
        }
        if (allUnder5) {
          return { matched: true, contractType: 'DIGITUNDER', barrier: '5', patternDigits: patternKey };
        }
        return { matched: false };
      }
      
      case 'over4_under5_9': {
        if (digits.length < 9) return { matched: false };
        const last9 = digits.slice(-9);
        const patternKey = `${last9.join(',')}`;
        const allOver4 = last9.every(d => d >= 5);
        const allUnder5 = last9.every(d => d <= 4);
        
        if (allOver4) {
          return { matched: true, contractType: 'DIGITOVER', barrier: '4', patternDigits: patternKey };
        }
        if (allUnder5) {
          return { matched: true, contractType: 'DIGITUNDER', barrier: '5', patternDigits: patternKey };
        }
        return { matched: false };
      }
      
      case 'over4_under5_7': {
        if (digits.length < 7) return { matched: false };
        const last7 = digits.slice(-7);
        const patternKey = `${last7.join(',')}`;
        const allOver4 = last7.every(d => d >= 5);
        const allUnder5 = last7.every(d => d <= 4);
        
        if (allOver4) {
          return { matched: true, contractType: 'DIGITOVER', barrier: '4', patternDigits: patternKey };
        }
        if (allUnder5) {
          return { matched: true, contractType: 'DIGITUNDER', barrier: '5', patternDigits: patternKey };
        }
        return { matched: false };
      }
      
      default:
        return { matched: false };
    }
  }, [m2RecoveryType]);

  // Function to add detected pattern to display
  const addDetectedPattern = useCallback((symbol: string, name: string, patternType: string, digits: number[]) => {
    const newPattern = {
      symbol,
      name,
      patternType,
      timestamp: Date.now(),
      digits: [...digits]
    };
    setDetectedPatterns(prev => [newPattern, ...prev].slice(0, 10));
    setTimeout(() => {
      setDetectedPatterns(prev => prev.filter(p => p.timestamp !== newPattern.timestamp));
    }, 5000);
  }, []);

  const findM1Match = useCallback((): { symbol: string; contractType: string; barrier?: string; patternDigits: string } | null => {
    // Prevent rapid successive trades
    if (Date.now() - lastTradeOverallRef.current < 2000) return null;
    
    for (const market of SCANNER_MARKETS) {
      const result = checkM1Pattern(market.symbol);
      if (result.matched && result.contractType && result.patternDigits) {
        const digits = tickMapRef.current.get(market.symbol) || [];
        addDetectedPattern(market.symbol, market.name, `M1: ${m1StrategyType}`, digits.slice(-5));
        
        const lastPattern = lastPatternDigitsRef.current.get(market.symbol);
        if (lastPattern === result.patternDigits) {
          continue;
        }
        
        const lastTrade = lastTradeTimeRef.current.get(market.symbol) || 0;
        if (Date.now() - lastTrade < 30000) {
          continue;
        }
        
        return { 
          symbol: market.symbol, 
          contractType: result.contractType, 
          barrier: result.barrier,
          patternDigits: result.patternDigits 
        };
      }
    }
    return null;
  }, [checkM1Pattern, m1StrategyType, addDetectedPattern]);

  const findM2Match = useCallback((): { symbol: string; contractType: string; barrier?: string; patternDigits: string } | null => {
    // Prevent rapid successive trades
    if (Date.now() - lastTradeOverallRef.current < 2000) return null;
    
    for (const market of SCANNER_MARKETS) {
      const result = checkM2Pattern(market.symbol);
      if (result.matched && result.contractType && result.patternDigits) {
        const digits = tickMapRef.current.get(market.symbol) || [];
        addDetectedPattern(market.symbol, market.name, `M2: ${m2RecoveryType}`, digits.slice(-5));
        
        const lastPattern = lastPatternDigitsRef.current.get(market.symbol);
        if (lastPattern === result.patternDigits) {
          continue;
        }
        
        const lastTrade = lastTradeTimeRef.current.get(market.symbol) || 0;
        if (Date.now() - lastTrade < 30000) {
          continue;
        }
        
        return { 
          symbol: market.symbol, 
          contractType: result.contractType, 
          barrier: result.barrier,
          patternDigits: result.patternDigits 
        };
      }
    }
    return null;
  }, [checkM2Pattern, m2RecoveryType, addDetectedPattern]);

  const addLog = useCallback((id: number, entry: Omit<LogEntry, 'id'>) => {
    setLogEntries(prev => [{ ...entry, id }, ...prev].slice(0, 100));
  }, []);

  const updateLog = useCallback((id: number, updates: Partial<LogEntry>) => {
    setLogEntries(prev => prev.map(e => e.id === id ? { ...e, ...updates } : e));
  }, []);

  const clearLog = useCallback(() => {
    setLogEntries([]);
    setWins(0); setLosses(0); setTotalStaked(0); setNetProfit(0);
    setMartingaleStepState(0);
  }, []);

  const executeRealTrade = useCallback(async (
    contractType: string,
    barrier: string | undefined,
    tradeSymbol: string,
    cStake: number,
    mStep: number,
    mkt: 1 | 2,
    localBalance: number,
    localPnl: number,
    baseStake: number,
    patternDigits: string
  ) => {
    const logId = ++logIdRef.current;
    const now = new Date().toLocaleTimeString();
    setTotalStaked(prev => prev + cStake);
    setCurrentStakeState(cStake);

    lastPatternDigitsRef.current.set(tradeSymbol, patternDigits);
    lastTradeTimeRef.current.set(tradeSymbol, Date.now());
    lastTradeOverallRef.current = Date.now();

    addLog(logId, {
      time: now, market: mkt === 1 ? 'M1' : 'M2', symbol: tradeSymbol,
      contract: contractType, stake: cStake, martingaleStep: mStep,
      exitDigit: '...', result: 'Pending', pnl: 0, balance: localBalance,
      switchInfo: `Pattern: ${patternDigits}`,
    });

    let inRecovery = mkt === 2;

    try {
      await waitForNextTick(tradeSymbol as MarketSymbol);

      const buyParams: any = {
        contract_type: contractType, symbol: tradeSymbol,
        duration: 1, duration_unit: 't', basis: 'stake', amount: cStake,
      };
      if (barrier) buyParams.barrier = barrier;

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

      let switchInfo = `Pattern: ${patternDigits} | Exit: ${exitDigit}`;
      let shouldResetMartingale = false;
      
      if (won) {
        setWins(prev => prev + 1);
        if (inRecovery) {
          switchInfo += ' ✓ Recovery WIN → Back to M1';
          inRecovery = false;
          shouldResetMartingale = true;
        } else {
          switchInfo += ' ✓ WIN → Continue scanning';
          shouldResetMartingale = true;
        }
      } else {
        setLosses(prev => prev + 1);
        if (activeAccount?.is_virtual) {
          recordLoss(cStake, tradeSymbol, 6000);
        }
        
        if (martingaleOn && mStep < parseInt(martingaleMaxSteps)) {
          cStake = parseFloat((cStake * (parseFloat(martingaleMultiplier) || 2)).toFixed(2));
          mStep++;
          
          if (!inRecovery && m2Enabled) {
            inRecovery = true;
            switchInfo += ` ✗ Loss → Martingale (Step ${mStep}) → M2 Recovery`;
          } else if (!inRecovery && !m2Enabled) {
            switchInfo += ` ✗ Loss → Martingale (Step ${mStep}) → Continue M1`;
          } else if (inRecovery) {
            switchInfo += ` ✗ Loss → Martingale (Step ${mStep}) → Stay M2`;
          }
        } else {
          switchInfo += martingaleOn ? ` ✗ Loss → Max steps reached. Reset.` : ' ✗ Loss → Martingale disabled. Reset.';
          shouldResetMartingale = true;
          
          if (!inRecovery && m2Enabled) {
            inRecovery = true;
            switchInfo += ' → M2 Recovery';
          }
        }
      }
      
      if (shouldResetMartingale) {
        mStep = 0;
        cStake = baseStake;
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

  const startBot = useCallback(async () => {
    if (!isAuthorized || isRunning) return;
    const baseStake = parseFloat(stake);
    if (baseStake < 0.35) { toast.error('Min stake $0.35'); return; }
    if (!m1Enabled && !m2Enabled) { toast.error('Enable at least one market'); return; }

    setIsRunning(true);
    runningRef.current = true;
    setCurrentMarket(1);
    setBotStatus('trading_m1');
    setCurrentStakeState(baseStake);
    setMartingaleStepState(0);
    
    lastTradeTimeRef.current.clear();
    lastPatternDigitsRef.current.clear();
    lastTradeOverallRef.current = 0;

    let cStake = baseStake;
    let mStep = 0;
    let inRecovery = false;
    let localPnl = 0;
    let localBalance = balance;
    let waitingForPatternAfterLoss = false;

    while (runningRef.current) {
      const mkt: 1 | 2 = inRecovery ? 2 : 1;
      setCurrentMarket(mkt);

      if (mkt === 1 && !m1Enabled) { if (m2Enabled) { inRecovery = true; continue; } else break; }
      if (mkt === 2 && !m2Enabled) { inRecovery = false; continue; }

      let tradeSymbol: string;
      let contractType: string;
      let barrier: string | undefined;
      let patternDigits: string;

      if (waitingForPatternAfterLoss) {
        console.log('⏳ Waiting for fresh pattern after loss');
        await new Promise(r => setTimeout(r, 1000));
        waitingForPatternAfterLoss = false;
        continue;
      }

      if (!inRecovery && strategyM1Enabled && m1StrategyType !== 'disabled') {
        setBotStatus('waiting_pattern');

        let matched = false;
        let matchData: { symbol: string; contractType: string; barrier?: string; patternDigits: string } | null = null;
        let attempts = 0;
        
        while (runningRef.current && !matched && attempts < 300) {
          matchData = findM1Match();
          if (matchData) {
            matched = true;
            toast.info(`🎯 M1 Pattern on ${matchData.symbol}`);
          }
          if (!matched) {
            await new Promise<void>(r => setTimeout(r, 100));
            attempts++;
          }
        }
        if (!runningRef.current || !matched) continue;

        setBotStatus('pattern_matched');
        tradeSymbol = matchData!.symbol;
        contractType = matchData!.contractType;
        barrier = matchData!.barrier;
        patternDigits = matchData!.patternDigits;
        await new Promise(r => setTimeout(r, 500));
      }
      else if (inRecovery && strategyM2Enabled && m2RecoveryType !== 'disabled') {
        setBotStatus('waiting_pattern');

        let matched = false;
        let matchData: { symbol: string; contractType: string; barrier?: string; patternDigits: string } | null = null;
        let attempts = 0;
        
        while (runningRef.current && !matched && attempts < 300) {
          matchData = findM2Match();
          if (matchData) {
            matched = true;
            toast.info(`🔄 M2 Pattern on ${matchData.symbol}`);
          }
          if (!matched) {
            await new Promise<void>(r => setTimeout(r, 100));
            attempts++;
          }
        }
        if (!runningRef.current || !matched) continue;

        setBotStatus('pattern_matched');
        tradeSymbol = matchData!.symbol;
        contractType = matchData!.contractType;
        barrier = matchData!.barrier;
        patternDigits = matchData!.patternDigits;
        await new Promise(r => setTimeout(r, 500));
      }
      else {
        setBotStatus(mkt === 1 ? 'trading_m1' : 'recovery');
        tradeSymbol = 'R_100';
        contractType = 'DIGITEVEN';
        barrier = undefined;
        patternDigits = 'default';
      }

      const result = await executeRealTrade(
        contractType, barrier, tradeSymbol, cStake, mStep, mkt, localBalance, localPnl, baseStake, patternDigits
      );
      if (!result || !runningRef.current) break;
      
      const wasLoss = result.cStake !== cStake || result.mStep !== mStep || result.inRecovery !== inRecovery;
      if (wasLoss && !result.shouldBreak && martingaleOn && result.mStep > 0 && !result.inRecovery) {
        waitingForPatternAfterLoss = true;
      }
      
      localPnl = result.localPnl;
      localBalance = result.localBalance;
      cStake = result.cStake;
      mStep = result.mStep;
      inRecovery = result.inRecovery;

      if (result.shouldBreak) break;

      await new Promise(r => setTimeout(r, 1000));
    }

    setIsRunning(false);
    runningRef.current = false;
    setBotStatus('idle');
  }, [isAuthorized, isRunning, balance, stake, m1Enabled, m2Enabled,
    martingaleOn, martingaleMultiplier, martingaleMaxSteps, takeProfit, stopLoss,
    strategyM1Enabled, strategyM2Enabled, m1StrategyType, m2RecoveryType,
    findM1Match, findM2Match, addLog, updateLog, executeRealTrade]);

  const stopBot = useCallback(() => {
    runningRef.current = false;
    setIsRunning(false);
    setBotStatus('idle');
  }, []);

  const statusConfig: Record<BotStatus, { icon: string; label: string; color: string }> = {
    idle: { icon: '⚪', label: 'IDLE', color: 'text-slate-400' },
    trading_m1: { icon: '🟢', label: 'TRADING M1', color: 'text-emerald-400' },
    recovery: { icon: '🟣', label: 'RECOVERY MODE', color: 'text-fuchsia-400' },
    waiting_pattern: { icon: '🟡', label: 'WAITING PATTERN', color: 'text-amber-400' },
    pattern_matched: { icon: '✅', label: 'PATTERN MATCHED', color: 'text-emerald-400' },
  };

  const status = statusConfig[botStatus];
  const winRate = wins + losses > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : '0.0';

  // Colors for dollar icons
  const dollarColors = ['text-emerald-400', 'text-cyan-400', 'text-amber-400', 'text-rose-400', 'text-purple-400', 'text-blue-400', 'text-indigo-400', 'text-pink-400'];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-4">
      <div className="space-y-3 max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-900/80 to-slate-800/80 backdrop-blur-sm border border-slate-700/50 rounded-xl px-4 py-3 shadow-xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-lg shadow-lg">
                <Scan className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-bold bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
                 Milliefx Ultimate 2026 Bot
                </h1>
                <p className="text-xs text-slate-400">Milliefx Advanced Market Scanning & Recovery System</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Badge className={`${status.color} bg-slate-800/50 border-slate-700 text-[10px] px-3 py-1`}>
                {status.icon} {status.label}
              </Badge>
              {isRunning && (
                <Badge variant="outline" className="text-[10px] text-amber-400 animate-pulse border-amber-500/30 bg-amber-500/10">
                  P/L: ${netProfit.toFixed(2)}
                </Badge>
              )}
              {isRunning && (
                <Badge variant="outline" className={`text-[10px] ${currentMarket === 1 ? 'text-emerald-400 border-emerald-500/30' : 'text-fuchsia-400 border-fuchsia-500/30'} bg-slate-800/50`}>
                  {currentMarket === 1 ? '🏠 M1' : '🔄 M2'}
                </Badge>
              )}
            </div>
          </div>
        </div>
     {/* Markets Row - Horizontal */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Market 1 */}
          <div className="bg-gradient-to-br from-slate-900/90 to-slate-800/90 backdrop-blur-sm border-2 border-emerald-500/30 rounded-xl p-4 shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-bold text-emerald-400 flex items-center gap-2">
                <Home className="w-4 h-4" /> Market 1 Bot
              </h3>
              <div className="flex items-center gap-2">
                {currentMarket === 1 && isRunning && <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />}
                <Switch checked={m1Enabled} onCheckedChange={setM1Enabled} disabled={isRunning} />
              </div>
            </div>
            
            <div className="space-y-3">
              <div>
                <label className="text-[11px] text-slate-400 mb-1.5 block font-semibold">Strategy Mode</label>
                <Select value={m1StrategyType} onValueChange={(v: M1StrategyType) => {
                  setM1StrategyType(v);
                  if (v !== 'disabled') {
                    setStrategyM1Enabled(true);
                    setScannerActive(true);
                  }
                }} disabled={isRunning}>
                  <SelectTrigger className="h-10 text-sm bg-slate-800/50 border-slate-700 text-slate-200">
                    <SelectValue placeholder="Select strategy" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700">
                    <SelectItem value="over0_under9">🎯 Over 0 / Under 9 (2 ticks)</SelectItem>
                    <SelectItem value="over1_under8">🎯 Over 1 / Under 8 (2 ticks)</SelectItem>
                    <SelectItem value="over2_under7">🎯 Over 2 / Under 7 (3 ticks)</SelectItem>
                    <SelectItem value="over3_under6">🎯 Over 3 / Under 6 (4 ticks)</SelectItem>
                    <SelectItem value="over4_under5_5">🎯 Over 4 / Under 5 (5 ticks)</SelectItem>
                  </SelectContent>
                </Select>
                {m1StrategyType !== 'disabled' && (
                  <div className="text-[10px] text-emerald-400 mt-2 animate-pulse flex items-center gap-1">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                    </span>
                    Scanning ALL markets for fresh patterns...
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Market 2 */}
          <div className="bg-gradient-to-br from-slate-900/90 to-slate-800/90 backdrop-blur-sm border-2 border-fuchsia-500/30 rounded-xl p-4 shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-bold text-fuchsia-400 flex items-center gap-2">
                <RefreshCw className="w-4 h-4" /> Market 2 — Recovery Bot
              </h3>
              <div className="flex items-center gap-2">
                {currentMarket === 2 && isRunning && <span className="w-2 h-2 rounded-full bg-fuchsia-400 animate-pulse" />}
                <Switch checked={m2Enabled} onCheckedChange={setM2Enabled} disabled={isRunning} />
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-[11px] text-slate-400 mb-1.5 block font-semibold">Recovery Strategy</label>
                <Select value={m2RecoveryType} onValueChange={(v: M2RecoveryType) => {
                  setM2RecoveryType(v);
                  if (v !== 'disabled') {
                    setStrategyM2Enabled(true);
                    setScannerActive(true);
                  }
                }} disabled={isRunning}>
                  <SelectTrigger className="h-10 text-sm bg-slate-800/50 border-slate-700 text-slate-200">
                    <SelectValue placeholder="Select strategy" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700">
                    <SelectItem value="odd_even_5">🔄 Odd / Even (5 ticks)</SelectItem>
                    <SelectItem value="odd_even_6">🔄 Odd / Even (6 ticks)</SelectItem>
                    <SelectItem value="odd_even_7">🔄 Odd / Even (7 ticks)</SelectItem>
                    <SelectItem value="odd_even_8">🔄 Odd / Even (8 ticks)</SelectItem>
                    <SelectItem value="odd_even_9">🔄 Odd / Even (9 ticks)</SelectItem>
                    <SelectItem value="over4_under5_5">🎯 Over 4 / Under 5 (5 ticks)</SelectItem>
                    <SelectItem value="over4_under5_6">🎯 Over 4 / Under 5 (6 ticks)</SelectItem>
                    <SelectItem value="over4_under5_7">🎯 Over 4 / Under 5 (7 ticks)</SelectItem>
                    <SelectItem value="over4_under5_8">🎯 Over 4 / Under 5 (8 ticks)</SelectItem>
                    <SelectItem value="over4_under5_9">🎯 Over 4 / Under 5 (9 ticks)</SelectItem>
                  </SelectContent>
                </Select>
                {m2RecoveryType !== 'disabled' && (
                  <div className="text-[10px] text-fuchsia-400 mt-2 animate-pulse flex items-center gap-1">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-fuchsia-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-fuchsia-500"></span>
                    </span>
                    Scanning ALL markets for fresh recovery patterns...
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Risk Management */}
        <div className="bg-gradient-to-br from-slate-900/90 to-slate-800/90 backdrop-blur-sm border border-slate-700/50 rounded-xl p-4 shadow-xl">
          <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2 mb-3">
            <Shield className="w-4 h-4 text-amber-400" /> Bot Configuration 🚦
          </h3>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">Stake ($)</label>
              <Input type="number" min="0.35" step="0.01" value={stake} onChange={e => setStake(e.target.value)} disabled={isRunning} className="h-9 text-sm bg-slate-800/50 border-slate-700 text-slate-200" />
            </div>
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">Take Profit ($)</label>
              <Input type="number" value={takeProfit} onChange={e => setTakeProfit(e.target.value)} disabled={isRunning} className="h-9 text-sm bg-slate-800/50 border-slate-700 text-slate-200" />
            </div>
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">Stop Loss ($)</label>
              <Input type="number" value={stopLoss} onChange={e => setStopLoss(e.target.value)} disabled={isRunning} className="h-9 text-sm bg-slate-800/50 border-slate-700 text-slate-200" />
            </div>
          </div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm text-slate-300 font-semibold">Martingale System</label>
            <Switch checked={martingaleOn} onCheckedChange={setMartingaleOn} disabled={isRunning} />
          </div>
          {martingaleOn && (
            <div className="grid grid-cols-2 gap-3 mt-2">
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Multiplier</label>
                <Input type="number" min="1.1" step="0.1" value={martingaleMultiplier} onChange={e => setMartingaleMultiplier(e.target.value)} disabled={isRunning} className="h-8 text-xs bg-slate-800/50 border-slate-700 text-slate-200" />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Max Steps</label>
                <Input type="number" min="1" max="10" value={martingaleMaxSteps} onChange={e => setMartingaleMaxSteps(e.target.value)} disabled={isRunning} className="h-8 text-xs bg-slate-800/50 border-slate-700 text-slate-200" />
              </div>
            </div>
          )}
        </div>

        {/* Single Start/Stop Button - Width 600px */}
        <div className="flex justify-center">
          <button
            onClick={isRunning ? stopBot : startBot}
            disabled={!isRunning && (!isAuthorized || balance < parseFloat(stake))}
            className={`
              relative w-[600px] h-14 text-base font-bold rounded-xl transition-all duration-300 ease-out
              overflow-hidden group
              ${isRunning 
                ? 'bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-400 text-white shadow-lg shadow-red-500/30' 
                : 'bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white shadow-lg shadow-blue-500/30'
              }
              disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100
              active:scale-95 transform
            `}
          >
            {isRunning && (
              <>
                <span className="absolute inset-0 bg-white/20 animate-pulse rounded-xl" />
                <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-shimmer" />
              </>
            )}
            
            <div className="relative flex items-center justify-center gap-3">
              {isRunning ? (
                <>
                  <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span className="flex items-center gap-1">
                    STOP BOT
                    <span className="flex gap-0.5 ml-1">
                      <span className="w-1.5 h-1.5 bg-white rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1.5 h-1.5 bg-white rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1.5 h-1.5 bg-white rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </span>
                  </span>
                </>
              ) : (
                <>
                  <svg className="w-5 h-5 transition-transform group-hover:scale-110" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                  <span className="flex items-center gap-1">
                    RUN BOT
                    <span className="relative flex h-2 w-2 ml-1">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
                    </span>
                  </span>
                </>
              )}
            </div>
          </button>
        </div>

        {/* Market Scanner Patterns Container - Reduced to 600px width, 100px height */}
        <div className="flex justify-center">
          <div className="w-[1000px] bg-gradient-to-br from-slate-900/90 to-slate-800/90 backdrop-blur-sm border border-slate-700/50 rounded-xl shadow-xl overflow-hidden">
            <div className="p-3 border-b border-slate-700/50">
              <div className="flex items-center gap-2">
                <div className="p-1 bg-gradient-to-br from-amber-500 to-orange-500 rounded-lg">
                  <Scan className="w-3 h-3 text-white" />
                </div>
                <h3 className="text-xs font-bold text-slate-200">Market Scanner - Pattern Detection</h3>
                {scannerActive && (
                  <div className="flex items-center gap-1 ml-auto">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                    </span>
                    <span className="text-[8px] text-emerald-400">Active</span>
                  </div>
                )}
              </div>
            </div>
            
            {/* Animated Dollar Icons Row - Right to Left Movement with Different Colors */}
            <div className="py-2 bg-slate-800/30 overflow-hidden relative">
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className="text-[8px] text-slate-400 font-mono bg-slate-800/80 px-2 py-0.5 rounded-full z-10">SCANNING</span>
              </div>
              <div className="flex items-center gap-2 animate-scroll-right-to-left" style={{ animation: 'scrollRightToLeft 12s linear infinite' }}>
                {[...Array(15)].map((_, i) => (
                  <DollarSign 
                    key={i}
                    className={`w-3 h-3 ${dollarColors[i % dollarColors.length]} animate-pulse`}
                    style={{ 
                      animationDuration: `${0.5 + (i % 3) * 0.2}s`,
                      filter: 'drop-shadow(0 0 1px currentColor)'
                    }}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2 animate-scroll-right-to-left" style={{ animation: 'scrollRightToLeft 12s linear infinite', position: 'absolute', top: 0, left: '100%' }}>
                {[...Array(15)].map((_, i) => (
                  <DollarSign 
                    key={`dup-${i}`}
                    className={`w-3 h-3 ${dollarColors[i % dollarColors.length]} animate-pulse`}
                    style={{ 
                      animationDuration: `${0.5 + (i % 3) * 0.2}s`,
                      filter: 'drop-shadow(0 0 1px currentColor)'
                    }}
                  />
                ))}
              </div>
            </div>
            
            {/* Detected Patterns Display - height 100px */}
            <div className="h-[60px] overflow-y-auto">
              {detectedPatterns.length === 0 ? (
                <div className="h-full flex items-center justify-center">
                  {/* Empty - no message shown until patterns found */}
                </div>
              ) : (
                <div className="p-2 space-y-1.5">
                  {detectedPatterns.map((pattern) => (
                    <div 
                      key={pattern.timestamp}
                      className="bg-slate-800/50 rounded-lg p-2 border border-slate-700/50 animate-slideIn"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center">
                            <DollarSign className="w-3 h-3 text-amber-400" />
                          </div>
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-[10px] font-bold text-slate-200">{pattern.symbol}</span>
                              <Badge className="text-[7px] bg-slate-700/50 text-slate-300 px-1 py-0">{pattern.name}</Badge>
                            </div>
                            <div className="text-[8px] text-amber-400">{pattern.patternType}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className="flex gap-0.5">
                            {pattern.digits.map((digit, i) => (
                              <span 
                                key={i}
                                className="w-5 h-5 rounded bg-slate-700 flex items-center justify-center text-[9px] font-mono font-bold text-cyan-400"
                              >
                                {digit}
                              </span>
                            ))}
                          </div>
                          <Badge className="text-[7px] bg-emerald-500/20 text-emerald-400 border-emerald-500/30 px-1 py-0">
                            FOUND
                          </Badge>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            
            {/* Scanning Animation Text */}
            <div className="p-2 border-t border-slate-700/30">
              <div className="flex items-center justify-between text-[8px] text-slate-500">
                <span className="flex items-center gap-1">
                  <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse"></span>
                  {SCANNER_MARKETS.length} markets
                </span>
                <span className="font-mono text-[7px]">M1: {m1StrategyType !== 'disabled' ? m1StrategyType.substring(0, 8) : 'OFF'} | M2: {m2RecoveryType !== 'disabled' ? m2RecoveryType.substring(0, 8) : 'OFF'}</span>
              </div>
            </div>
          </div>
        </div>
         {/* Performance Stats Row */}
        <div className="bg-gradient-to-br from-slate-900/80 to-slate-800/80 backdrop-blur-sm border border-slate-700/50 rounded-xl p-4 shadow-xl">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-cyan-400" />
              Trade Report 
            </span>
            <span className="font-mono text-xl font-bold text-cyan-400">${balance.toFixed(2)}</span>
          </div>
          <div className="grid grid-cols-5 gap-3">
            <div className="text-center bg-slate-800/30 rounded-lg p-2">
              <div className="text-[9px] text-slate-400 mb-1">Total Trades</div>
              <div className="font-mono text-lg font-bold text-slate-200">{wins + losses}</div>
            </div>
            <div className="text-center bg-slate-800/30 rounded-lg p-2">
              <div className="text-[9px] text-slate-400 mb-1">Win Rate</div>
              <div className="font-mono text-lg font-bold text-emerald-400">{winRate}%</div>
            </div>
            <div className="text-center bg-slate-800/30 rounded-lg p-2">
              <div className="text-[9px] text-slate-400 mb-1">Wins</div>
              <div className="font-mono text-lg font-bold text-emerald-400">{wins}</div>
            </div>
            <div className="text-center bg-slate-800/30 rounded-lg p-2">
              <div className="text-[9px] text-slate-400 mb-1">Losses</div>
              <div className="font-mono text-lg font-bold text-rose-400">{losses}</div>
            </div>
            <div className="text-center bg-slate-800/30 rounded-lg p-2">
              <div className="text-[9px] text-slate-400 mb-1">Net Profit</div>
              <div className={`font-mono text-lg font-bold ${netProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {netProfit >= 0 ? '+' : ''}{netProfit.toFixed(2)}
              </div>
            </div>
          </div>
        </div>

        {/* Activity Log - Full Width */}
        <div className="bg-gradient-to-br from-slate-900/90 to-slate-800/90 backdrop-blur-sm border border-slate-700/50 rounded-xl overflow-hidden shadow-xl">
          <div className="px-4 py-3 border-b border-slate-700/50 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-cyan-400" />
              Trade Results  
              <Badge className="ml-2 bg-slate-800 text-slate-300 text-[9px]">
                Current Stake: ${currentStake.toFixed(2)}{martingaleStep > 0 && ` M${martingaleStep}`}
              </Badge>
            </h3>
            <Button variant="ghost" size="sm" onClick={clearLog} className="h-7 w-7 p-0 text-slate-400 hover:text-rose-400 hover:bg-slate-800/50">
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
          <div className="max-h-[500px] overflow-auto">
            <table className="w-full text-[11px]">
              <thead className="text-[10px] text-slate-400 bg-slate-800/50 sticky top-0">
                <tr>
                  <th className="text-left p-2">Time</th>
                  <th className="text-left p-2">Mkt</th>
                  <th className="text-left p-2">Symbol</th>
                  <th className="text-left p-2">Type</th>
                  <th className="text-right p-2">Stake</th>
                  <th className="text-center p-2">Result</th> 
                  <th className="text-right p-2">P/L</th>
                  <th className="text-right p-2">Balance</th>
                </tr>
              </thead>
              <tbody>
                {logEntries.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center text-slate-500 py-12">
                      No trades yet — configure and start the bot
                    </td>
                  </tr>
                ) : logEntries.map(e => (
                  <tr key={e.id} className={`border-t border-slate-700/30 hover:bg-slate-800/30 transition-colors ${
                    e.market === 'M1' ? 'border-l-2 border-l-emerald-500' : 'border-l-2 border-l-fuchsia-500'
                  }`}>
                    <td className="p-2 font-mono text-[9px] text-slate-400">{e.time}</td>
                    <td className={`p-2 font-bold text-xs ${
                      e.market === 'M1' ? 'text-emerald-400' : 'text-fuchsia-400'
                    }`}>{e.market}</td>
                    <td className="p-2 font-mono text-[9px] text-slate-300">{e.symbol}</td>
                    <td className="p-2 text-[9px] text-slate-300">{e.contract.replace('DIGIT', '')}</td>
                    <td className="p-2 font-mono text-right text-[9px] text-slate-300">
                      ${e.stake.toFixed(2)}
                      {e.martingaleStep > 0 && <span className="text-amber-400 ml-1">M{e.martingaleStep}</span>}
                    </td>
                    <td className="p-2 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${
                        e.result === 'Win' ? 'bg-emerald-500/20 text-emerald-400' :
                        e.result === 'Loss' ? 'bg-rose-500/20 text-rose-400' :
                        'bg-amber-500/20 text-amber-400 animate-pulse'
                      }`}>
                        {e.result === 'Pending' ? '...' : e.result}
                      </span>
                    </td>
                    <td className={`p-2 font-mono text-right text-[9px] font-bold ${
                      e.pnl > 0 ? 'text-emerald-400' : e.pnl < 0 ? 'text-rose-400' : 'text-slate-400'
                    }`}>
                      {e.result === 'Pending' ? '...' : `${e.pnl > 0 ? '+' : ''}${e.pnl.toFixed(2)}`}
                    </td>
                    <td className="p-2 font-mono text-right text-[9px] text-slate-400">
                      ${e.balance.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
