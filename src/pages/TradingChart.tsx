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
  Home, RefreshCw, Shield, Zap, Eye, Anchor, Download, Upload,
} from 'lucide-react';
import ConfigPreview, { type BotConfig } from '@/components/bot-config/ConfigPreview';

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

class CircularTickBuffer {
  private buffer: { digit: number; ts: number }[];
  private head = 0;
  private count = 0;
  constructor(private capacity = 1000) {
    this.buffer = new Array(capacity);
  }
  push(digit: number) {
    this.buffer[this.head] = { digit, ts: performance.now() };
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }
  last(n: number): number[] {
    const result: number[] = [];
    const start = (this.head - Math.min(n, this.count) + this.capacity) % this.capacity;
    for (let i = 0; i < Math.min(n, this.count); i++) {
      result.push(this.buffer[(start + i) % this.capacity].digit);
    }
    return result;
  }
  get size() { return this.count; }
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
        }
        resolve({ won, digit });
      }
    });
  });
}

// Initial trade condition checkers
const checkOver1Under8 = (digits: number[]): { shouldTrade: boolean; type: 'OVER' | 'UNDER'; barrier: string } => {
  const lastTwo = digits.slice(-2);
  if (lastTwo.length < 2) return { shouldTrade: false, type: 'OVER', barrier: '1' };
  
  const allLessThan1 = lastTwo.every(d => d < 1);
  const allGreaterThan8 = lastTwo.every(d => d > 8);
  
  if (allLessThan1) return { shouldTrade: true, type: 'OVER', barrier: '1' };
  if (allGreaterThan8) return { shouldTrade: true, type: 'UNDER', barrier: '8' };
  return { shouldTrade: false, type: 'OVER', barrier: '1' };
};

const checkOver2Under7 = (digits: number[]): { shouldTrade: boolean; type: 'OVER' | 'UNDER'; barrier: string } => {
  const lastThree = digits.slice(-3);
  if (lastThree.length < 3) return { shouldTrade: false, type: 'OVER', barrier: '2' };
  
  const allLessThan2 = lastThree.every(d => d < 2);
  const allGreaterThan7 = lastThree.every(d => d > 7);
  
  if (allLessThan2) return { shouldTrade: true, type: 'OVER', barrier: '2' };
  if (allGreaterThan7) return { shouldTrade: true, type: 'UNDER', barrier: '7' };
  return { shouldTrade: false, type: 'OVER', barrier: '2' };
};

const checkOver3Under6 = (digits: number[]): { shouldTrade: boolean; type: 'OVER' | 'UNDER'; barrier: string } => {
  const lastFour = digits.slice(-4);
  if (lastFour.length < 4) return { shouldTrade: false, type: 'OVER', barrier: '3' };
  
  const allLessThan3 = lastFour.every(d => d < 3);
  const allGreaterThan6 = lastFour.every(d => d > 6);
  
  if (allLessThan3) return { shouldTrade: true, type: 'OVER', barrier: '3' };
  if (allGreaterThan6) return { shouldTrade: true, type: 'UNDER', barrier: '6' };
  return { shouldTrade: false, type: 'OVER', barrier: '3' };
};

// Recovery condition checkers
const checkEvenOdd7 = (digits: number[]): { shouldTrade: boolean; contractType: string } => {
  const lastSeven = digits.slice(-7);
  if (lastSeven.length < 7) return { shouldTrade: false, contractType: 'DIGITEVEN' };
  
  const allOdd = lastSeven.every(d => d % 2 !== 0);
  const allEven = lastSeven.every(d => d % 2 === 0);
  
  if (allOdd) return { shouldTrade: true, contractType: 'DIGITEVEN' };
  if (allEven) return { shouldTrade: true, contractType: 'DIGITODD' };
  return { shouldTrade: false, contractType: 'DIGITEVEN' };
};

const checkEvenOdd6 = (digits: number[]): { shouldTrade: boolean; contractType: string } => {
  const lastSix = digits.slice(-6);
  if (lastSix.length < 6) return { shouldTrade: false, contractType: 'DIGITEVEN' };
  
  const allOdd = lastSix.every(d => d % 2 !== 0);
  const allEven = lastSix.every(d => d % 2 === 0);
  
  if (allOdd) return { shouldTrade: true, contractType: 'DIGITEVEN' };
  if (allEven) return { shouldTrade: true, contractType: 'DIGITODD' };
  return { shouldTrade: false, contractType: 'DIGITEVEN' };
};

const checkOver4Under5_7 = (digits: number[]): { shouldTrade: boolean; contractType: string; barrier: string } => {
  const lastSeven = digits.slice(-7);
  if (lastSeven.length < 7) return { shouldTrade: false, contractType: 'DIGITOVER', barrier: '4' };
  
  const allLessThan4 = lastSeven.every(d => d < 4);
  const allGreaterThan5 = lastSeven.every(d => d > 5);
  
  if (allLessThan4) return { shouldTrade: true, contractType: 'DIGITOVER', barrier: '4' };
  if (allGreaterThan5) return { shouldTrade: true, contractType: 'DIGITUNDER', barrier: '5' };
  return { shouldTrade: false, contractType: 'DIGITOVER', barrier: '4' };
};

const checkOver4Under5_6 = (digits: number[]): { shouldTrade: boolean; contractType: string; barrier: string } => {
  const lastSix = digits.slice(-6);
  if (lastSix.length < 6) return { shouldTrade: false, contractType: 'DIGITOVER', barrier: '4' };
  
  const allLessThan4 = lastSix.every(d => d < 4);
  const allGreaterThan5 = lastSix.every(d => d > 5);
  
  if (allLessThan4) return { shouldTrade: true, contractType: 'DIGITOVER', barrier: '4' };
  if (allGreaterThan5) return { shouldTrade: true, contractType: 'DIGITUNDER', barrier: '5' };
  return { shouldTrade: false, contractType: 'DIGITOVER', barrier: '4' };
};

export default function ProScannerBot() {
  const { isAuthorized, balance, activeAccount } = useAuth();
  const { recordLoss } = useLossRequirement();
  const location = useLocation();

  // Initial trade type selection
  const [initialTradeType, setInitialTradeType] = useState<'over1_under8' | 'over2_under7' | 'over3_under6'>('over1_under8');
  
  // Recovery type selection
  const [recoveryType, setRecoveryType] = useState<'even_odd_7' | 'even_odd_6' | 'over4_under5_7' | 'over4_under5_6'>('even_odd_7');

  const [m1Enabled, setM1Enabled] = useState(true);
  const [m1Symbol, setM1Symbol] = useState('R_100');

  const [m2Enabled, setM2Enabled] = useState(true);
  const [m2Symbol, setM2Symbol] = useState('R_50');

  const [stake, setStake] = useState('0.35');
  const [martingaleOn, setMartingaleOn] = useState(false);
  const [martingaleMultiplier, setMartingaleMultiplier] = useState('2.0');
  const [martingaleMaxSteps, setMartingaleMaxSteps] = useState('5');
  const [takeProfit, setTakeProfit] = useState('10');
  const [stopLoss, setStopLoss] = useState('5');

  const [scannerActive, setScannerActive] = useState(false);
  const [turboMode, setTurboMode] = useState(false);
  const [botName, setBotName] = useState('');

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

  const checkInitialCondition = useCallback((symbol: string): { shouldTrade: boolean; type: 'OVER' | 'UNDER'; barrier: string } => {
    const digits = tickMapRef.current.get(symbol) || [];
    
    switch (initialTradeType) {
      case 'over1_under8':
        return checkOver1Under8(digits);
      case 'over2_under7':
        return checkOver2Under7(digits);
      case 'over3_under6':
        return checkOver3Under6(digits);
      default:
        return { shouldTrade: false, type: 'OVER', barrier: '1' };
    }
  }, [initialTradeType]);

  const checkRecoveryCondition = useCallback((symbol: string): { shouldTrade: boolean; contractType: string; barrier?: string } => {
    const digits = tickMapRef.current.get(symbol) || [];
    
    switch (recoveryType) {
      case 'even_odd_7':
        return checkEvenOdd7(digits);
      case 'even_odd_6':
        return checkEvenOdd6(digits);
      case 'over4_under5_7':
        return checkOver4Under5_7(digits);
      case 'over4_under5_6':
        return checkOver4Under5_6(digits);
      default:
        return { shouldTrade: false, contractType: 'DIGITEVEN' };
    }
  }, [recoveryType]);

  const executeRealTrade = useCallback(async (
    symbol: string,
    cStake: number,
    mStep: number,
    isRecovery: boolean,
    localBalance: number,
    localPnl: number,
    baseStake: number,
  ) => {
    const logId = ++logIdRef.current;
    const now = new Date().toLocaleTimeString();
    setTotalStaked(prev => prev + cStake);
    setCurrentStakeState(cStake);

    let contractType = 'DIGITOVER';
    let barrier = '1';
    
    if (!isRecovery) {
      const condition = checkInitialCondition(symbol);
      if (!condition.shouldTrade) return null;
      contractType = condition.type === 'OVER' ? 'DIGITOVER' : 'DIGITUNDER';
      barrier = condition.barrier;
    } else {
      const condition = checkRecoveryCondition(symbol);
      if (!condition.shouldTrade) return null;
      contractType = condition.contractType;
      barrier = condition.barrier || '4';
    }

    addLog(logId, {
      time: now, market: isRecovery ? 'M2' : 'M1', symbol,
      contract: contractType, stake: cStake, martingaleStep: mStep,
      exitDigit: '...', result: 'Pending', pnl: 0, balance: localBalance,
      switchInfo: isRecovery ? 'Recovery trade' : 'Initial trade',
    });

    try {
      if (!turboMode) {
        await waitForNextTick(symbol as MarketSymbol);
      }

      const buyParams: any = {
        contract_type: contractType, symbol,
        duration: 1, duration_unit: 't', basis: 'stake', amount: cStake,
      };
      if (needsBarrier(contractType)) buyParams.barrier = barrier;

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
      const newLocalPnl = localPnl + pnl;
      const newLocalBalance = localBalance + pnl;
      const exitDigit = String(getLastDigit(result.sellPrice || 0));

      let newInRecovery = isRecovery;
      let newCStake = cStake;
      let newMStep = mStep;

      if (won) {
        setWins(prev => prev + 1);
        if (isRecovery) {
          newInRecovery = false;
          newCStake = baseStake;
          newMStep = 0;
          updateLog(logId, { exitDigit, result: 'Win', pnl, balance: newLocalBalance, switchInfo: '✓ Recovery WIN → Back to M1' });
        } else {
          updateLog(logId, { exitDigit, result: 'Win', pnl, balance: newLocalBalance, switchInfo: '→ Continue M1' });
        }
      } else {
        setLosses(prev => prev + 1);
        if (activeAccount?.is_virtual) {
          recordLoss(cStake, symbol, 6000);
        }
        if (!isRecovery && m2Enabled) {
          newInRecovery = true;
          updateLog(logId, { exitDigit, result: 'Loss', pnl, balance: newLocalBalance, switchInfo: '✗ Loss → Switch to Recovery' });
        } else {
          updateLog(logId, { exitDigit, result: 'Loss', pnl, balance: newLocalBalance, switchInfo: isRecovery ? '→ Stay in Recovery' : '→ Continue M1' });
        }
        
        if (martingaleOn) {
          const maxS = parseInt(martingaleMaxSteps) || 5;
          if (mStep < maxS) {
            newCStake = parseFloat((cStake * (parseFloat(martingaleMultiplier) || 2)).toFixed(2));
            newMStep = mStep + 1;
          } else {
            newCStake = baseStake;
            newMStep = 0;
          }
        } else {
          newCStake = baseStake;
          newMStep = 0;
        }
      }

      setNetProfit(prev => prev + pnl);
      setMartingaleStepState(newMStep);
      setCurrentStakeState(newCStake);

      let shouldBreak = false;
      if (newLocalPnl >= parseFloat(takeProfit)) {
        toast.success(`🎯 Take Profit! +$${newLocalPnl.toFixed(2)}`);
        shouldBreak = true;
      }
      if (newLocalPnl <= -parseFloat(stopLoss)) {
        toast.error(`🛑 Stop Loss! $${newLocalPnl.toFixed(2)}`);
        shouldBreak = true;
      }
      if (newLocalBalance < newCStake) {
        toast.error('Insufficient balance');
        shouldBreak = true;
      }

      return { localPnl: newLocalPnl, localBalance: newLocalBalance, cStake: newCStake, mStep: newMStep, inRecovery: newInRecovery, shouldBreak };
    } catch (err: any) {
      updateLog(logId, { result: 'Loss', pnl: 0, exitDigit: '-', switchInfo: `Error: ${err.message}` });
      if (!turboMode) await new Promise(r => setTimeout(r, 2000));
      return { localPnl, localBalance, cStake, mStep, inRecovery: isRecovery, shouldBreak: false };
    }
  }, [checkInitialCondition, checkRecoveryCondition, martingaleOn, martingaleMultiplier, martingaleMaxSteps, takeProfit, stopLoss, turboMode, m2Enabled, recordLoss, activeAccount]);

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

    let cStake = baseStake;
    let mStep = 0;
    let inRecovery = false;
    let localPnl = 0;
    let localBalance = balance;

    while (runningRef.current) {
      const mkt: 1 | 2 = inRecovery ? 2 : 1;
      setCurrentMarket(mkt);

      if (mkt === 1 && !m1Enabled) { 
        if (m2Enabled) { inRecovery = true; continue; } 
        else break; 
      }
      if (mkt === 2 && !m2Enabled) { 
        inRecovery = false; 
        continue; 
      }

      const symbol = mkt === 1 ? m1Symbol : m2Symbol;
      setBotStatus(mkt === 1 ? 'trading_m1' : 'recovery');

      // Check condition before trading
      let shouldTrade = false;
      if (!inRecovery) {
        const condition = checkInitialCondition(symbol);
        shouldTrade = condition.shouldTrade;
      } else {
        const condition = checkRecoveryCondition(symbol);
        shouldTrade = condition.shouldTrade;
      }

      if (shouldTrade) {
        const result = await executeRealTrade(
          symbol, cStake, mStep, inRecovery, localBalance, localPnl, baseStake
        );
        if (!result || !runningRef.current) break;
        localPnl = result.localPnl;
        localBalance = result.localBalance;
        cStake = result.cStake;
        mStep = result.mStep;
        inRecovery = result.inRecovery;

        if (result.shouldBreak) break;
        
        if (!turboMode) await new Promise(r => setTimeout(r, 400));
      } else {
        // Wait for more ticks before checking again
        await new Promise(r => setTimeout(r, 200));
      }
    }

    setIsRunning(false);
    runningRef.current = false;
    setBotStatus('idle');
  }, [isAuthorized, isRunning, balance, stake, m1Enabled, m2Enabled, m1Symbol, m2Symbol, checkInitialCondition, checkRecoveryCondition, executeRealTrade, turboMode]);

  const stopBot = useCallback(() => {
    runningRef.current = false;
    setIsRunning(false);
    setBotStatus('idle');
  }, []);

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

  return (
    <div className="space-y-2 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-2 bg-card border border-border rounded-xl px-3 py-2">
        <h1 className="text-base font-bold text-foreground flex items-center gap-2">
          <Scan className="w-4 h-4 text-primary" /> Pro Scanner Bot
        </h1>
        <div className="flex items-center gap-2">
          <Badge className={`${status.color} text-[10px]`}>{status.icon} {status.label}</Badge>
          {isRunning && (
            <Badge variant="outline" className="text-[10px] text-warning animate-pulse font-mono">
              P/L: ${netProfit.toFixed(2)}
            </Badge>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-2">
        <div className="lg:col-span-4 space-y-2">
          <div className="bg-card border border-border rounded-xl p-3 space-y-3">
            <div>
              <label className="text-xs font-semibold text-foreground">INITIAL TRADE TYPE</label>
              <Select value={initialTradeType} onValueChange={(v: any) => setInitialTradeType(v)} disabled={isRunning}>
                <SelectTrigger className="h-8 text-xs mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="over1_under8">Over 1 / Under 8 (last 2 digits)</SelectItem>
                  <SelectItem value="over2_under7">Over 2 / Under 7 (last 3 digits)</SelectItem>
                  <SelectItem value="over3_under6">Over 3 / Under 6 (last 4 digits)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-xs font-semibold text-foreground">RECOVERY TYPE</label>
              <Select value={recoveryType} onValueChange={(v: any) => setRecoveryType(v)} disabled={isRunning}>
                <SelectTrigger className="h-8 text-xs mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="even_odd_7">Even/Odd pattern (last 7)</SelectItem>
                  <SelectItem value="even_odd_6">Even/Odd pattern (last 6)</SelectItem>
                  <SelectItem value="over4_under5_7">Over 4 / Under 5 (last 7)</SelectItem>
                  <SelectItem value="over4_under5_6">Over 4 / Under 5 (last 6)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[10px] text-muted-foreground">STAKE</label>
                <Input type="number" min="0.35" step="0.01" value={stake} onChange={e => setStake(e.target.value)} disabled={isRunning} className="h-8 text-xs" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">TP</label>
                <Input type="number" value={takeProfit} onChange={e => setTakeProfit(e.target.value)} disabled={isRunning} className="h-8 text-xs" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">SL</label>
                <Input type="number" value={stopLoss} onChange={e => setStopLoss(e.target.value)} disabled={isRunning} className="h-8 text-xs" />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <label className="text-[10px] text-foreground">Enable Martingale</label>
              <Switch checked={martingaleOn} onCheckedChange={setMartingaleOn} disabled={isRunning} />
            </div>

            {martingaleOn && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[8px] text-muted-foreground">Multiplier</label>
                  <Input type="number" min="1.1" step="0.1" value={martingaleMultiplier} onChange={e => setMartingaleMultiplier(e.target.value)} disabled={isRunning} className="h-7 text-[10px]" />
                </div>
                <div>
                  <label className="text-[8px] text-muted-foreground">Max Steps</label>
                  <Input type="number" min="1" max="10" value={martingaleMaxSteps} onChange={e => setMartingaleMaxSteps(e.target.value)} disabled={isRunning} className="h-7 text-[10px]" />
                </div>
              </div>
            )}

            <div className="flex items-center justify-between pt-2 border-t border-border">
              <label className="text-[10px] text-foreground">Scanner Active</label>
              <Switch checked={scannerActive} onCheckedChange={setScannerActive} disabled={isRunning} />
            </div>

            <div className="flex items-center justify-between">
              <label className="text-[10px] text-foreground">Turbo Mode</label>
              <Switch checked={turboMode} onCheckedChange={setTurboMode} disabled={isRunning} />
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl p-3">
            <h3 className="text-xs font-semibold text-foreground mb-2">Market 1 (Home)</h3>
            <Select value={m1Symbol} onValueChange={setM1Symbol} disabled={isRunning}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SCANNER_MARKETS.map(m => <SelectItem key={m.symbol} value={m.symbol}>{m.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="bg-card border border-border rounded-xl p-3">
            <h3 className="text-xs font-semibold text-foreground mb-2">Market 2 (Recovery)</h3>
            <Select value={m2Symbol} onValueChange={setM2Symbol} disabled={isRunning}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SCANNER_MARKETS.map(m => <SelectItem key={m.symbol} value={m.symbol}>{m.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="lg:col-span-8 space-y-2">
          <div className="grid grid-cols-5 gap-1.5">
            <div className="bg-card border border-border rounded-lg p-2 text-center">
              <div className="text-[8px] text-muted-foreground">Trades</div>
              <div className="font-mono text-xs font-bold text-foreground">{wins + losses}</div>
            </div>
            <div className="bg-card border border-border rounded-lg p-2 text-center">
              <div className="text-[8px] text-muted-foreground">Wins</div>
              <div className="font-mono text-xs font-bold text-profit">{wins}</div>
            </div>
            <div className="bg-card border border-border rounded-lg p-2 text-center">
              <div className="text-[8px] text-muted-foreground">Losses</div>
              <div className="font-mono text-xs font-bold text-loss">{losses}</div>
            </div>
            <div className="bg-card border border-border rounded-lg p-2 text-center">
              <div className="text-[8px] text-muted-foreground">Win Rate</div>
              <div className="font-mono text-xs font-bold text-primary">{winRate}%</div>
            </div>
            <div className="bg-card border border-border rounded-lg p-2 text-center">
              <div className="text-[8px] text-muted-foreground">P/L</div>
              <div className={`font-mono text-xs font-bold ${netProfit >= 0 ? 'text-profit' : 'text-loss'}`}>
                ${netProfit.toFixed(2)}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button onClick={startBot} disabled={isRunning || !isAuthorized || balance < parseFloat(stake)} className="h-12 text-base font-bold bg-green-600 hover:bg-green-700">
              <Play className="w-4 h-4 mr-2" /> START BOT
            </Button>
            <Button onClick={stopBot} disabled={!isRunning} variant="destructive" className="h-12 text-base font-bold">
              <StopCircle className="w-4 h-4 mr-2" /> STOP
            </Button>
          </div>

          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-3 py-2 border-b border-border flex items-center justify-between">
              <h3 className="text-xs font-semibold text-foreground">Activity Log</h3>
              <Button variant="ghost" size="sm" onClick={clearLog} className="h-6 w-6 p-0">
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
            <div className="max-h-[400px] overflow-auto">
              <table className="w-full text-[10px]">
                <thead className="text-[9px] text-muted-foreground bg-muted/30 sticky top-0">
                  <tr>
                    <th className="text-left p-2">Time</th>
                    <th className="text-left p-2">Market</th>
                    <th className="text-left p-2">Type</th>
                    <th className="text-right p-2">Stake</th>
                    <th className="text-center p-2">Digit</th>
                    <th className="text-center p-2">Result</th>
                    <th className="text-right p-2">P/L</th>
                    <th className="text-left p-2">Info</th>
                  </tr>
                </thead>
                <tbody>
                  {logEntries.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-center text-muted-foreground py-8">No trades yet — configure and start the bot</td>
                    </tr>
                  ) : (
                    logEntries.map(e => (
                      <tr key={e.id} className="border-t border-border/30">
                        <td className="p-2 font-mono">{e.time}</td>
                        <td className="p-2 font-bold">{e.market}</td>
                        <td className="p-2 text-[9px]">{e.contract.replace('DIGIT', '')}</td>
                        <td className="p-2 text-right font-mono">${e.stake.toFixed(2)}</td>
                        <td className="p-2 text-center font-mono">{e.exitDigit}</td>
                        <td className="p-2 text-center">
                          <span className={`px-1.5 py-0.5 rounded-full text-[8px] font-bold ${
                            e.result === 'Win' ? 'bg-green-500/20 text-green-400' :
                            e.result === 'Loss' ? 'bg-red-500/20 text-red-400' :
                            'bg-yellow-500/20 text-yellow-400'
                          }`}>{e.result}</span>
                        </td>
                        <td className={`p-2 text-right font-mono ${e.pnl > 0 ? 'text-green-400' : e.pnl < 0 ? 'text-red-400' : ''}`}>
                          {e.pnl !== 0 ? `${e.pnl > 0 ? '+' : ''}${e.pnl.toFixed(2)}` : '-'}
                        </td>
                        <td className="p-2 text-[9px] text-muted-foreground truncate max-w-[150px]">{e.switchInfo}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
