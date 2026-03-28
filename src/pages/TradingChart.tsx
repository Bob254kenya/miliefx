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
  Home, RefreshCw, Shield, Zap, Eye, Anchor, Download, Upload, Activity, TrendingUp, TrendingDown
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

const INITIAL_TRADE_TYPES = [
  { id: 1, name: 'Over 1 / Under 8', condition: 'last 2 digits < 1 → OVER 1, last 2 digits > 8 → UNDER 8' },
  { id: 2, name: 'Over 2 / Under 7', condition: 'last 3 digits < 2 → OVER 2, last 3 digits > 7 → UNDER 7' },
  { id: 3, name: 'Over 3 / Under 6', condition: 'last 4 digits < 3 → OVER 3, last 4 digits > 6 → UNDER 6' },
] as const;

const RECOVERY_TYPES = [
  { id: 1, name: 'Even/Odd Pattern (last 7)', condition: 'last 7 odd → EVEN, last 7 even → ODD' },
  { id: 2, name: 'Even/Odd Pattern (last 6)', condition: 'last 6 odd → EVEN, last 6 even → ODD' },
  { id: 3, name: 'Over/Under Pattern (last 7)', condition: 'last 7 < 4 → OVER 4, last 7 > 5 → UNDER 5' },
  { id: 4, name: 'Over/Under Pattern (last 6)', condition: 'last 6 < 4 → OVER 4, last 6 > 5 → UNDER 5' },
] as const;

type BotStatus = 'idle' | 'trading' | 'recovery' | 'analyzing';

interface TradeDetails {
  entry_tick: number;
  exit_tick: number;
  entry_tick_time: number;
  exit_tick_time: number;
  profit: number;
  status: 'won' | 'lost';
}

interface LogEntry {
  id: number;
  time: string;
  market: string;
  symbol: string;
  contract: string;
  stake: number;
  martingaleStep: number;
  entryTick: number;
  exitTick: number;
  result: 'Win' | 'Loss' | 'Pending';
  pnl: number;
  balance: number;
  condition: string;
}

class CircularTickBuffer {
  private buffer: { digit: number; ts: number; quote: number }[];
  private head = 0;
  private count = 0;
  constructor(private capacity = 1000) {
    this.buffer = new Array(capacity);
  }
  push(digit: number, quote: number, ts: number) {
    this.buffer[this.head] = { digit, ts, quote };
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
  lastWithQuotes(n: number): { digit: number; quote: number; ts: number }[] {
    const result: { digit: number; quote: number; ts: number }[] = [];
    const start = (this.head - Math.min(n, this.count) + this.capacity) % this.capacity;
    for (let i = 0; i < Math.min(n, this.count); i++) {
      result.push(this.buffer[(start + i) % this.capacity]);
    }
    return result;
  }
  get size() { return this.count; }
}

function waitForNextTick(symbol: string): Promise<{ quote: number; tick: any }> {
  return new Promise((resolve) => {
    const unsub = derivApi.onMessage((data: any) => {
      if (data.tick && data.tick.symbol === symbol) {
        unsub();
        resolve({ quote: data.tick.quote, tick: data.tick });
      }
    });
  });
}

export default function ProScannerBot() {
  const { isAuthorized, balance, activeAccount } = useAuth();
  const { recordLoss } = useLossRequirement();
  const location = useLocation();

  // Market config
  const [selectedMarket, setSelectedMarket] = useState('R_100');
  const [contractType, setContractType] = useState('DIGITOVER');
  const [initialTradeType, setInitialTradeType] = useState(1);
  const [recoveryType, setRecoveryType] = useState(1);
  
  // Risk settings
  const [stake, setStake] = useState('0.35');
  const [martingaleOn, setMartingaleOn] = useState(false);
  const [martingaleMultiplier, setMartingaleMultiplier] = useState('2.0');
  const [martingaleMaxSteps, setMartingaleMaxSteps] = useState('5');
  const [takeProfit, setTakeProfit] = useState('10');
  const [stopLoss, setStopLoss] = useState('5');
  
  // Scanner
  const [scannerActive, setScannerActive] = useState(true);
  const [turboMode, setTurboMode] = useState(false);
  const [botName, setBotName] = useState('');
  
  // Bot state
  const [botStatus, setBotStatus] = useState<BotStatus>('idle');
  const [isRunning, setIsRunning] = useState(false);
  const runningRef = useRef(false);
  const [currentSymbol, setCurrentSymbol] = useState('');
  const [wins, setWins] = useState(0);
  const [losses, setLosses] = useState(0);
  const [totalStaked, setTotalStaked] = useState(0);
  const [netProfit, setNetProfit] = useState(0);
  const [currentStake, setCurrentStakeState] = useState(0);
  const [martingaleStep, setMartingaleStepState] = useState(0);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const logIdRef = useRef(0);
  
  // Tick data
  const tickMapRef = useRef<Map<string, CircularTickBuffer>>(new Map());
  const [activeDigits, setActiveDigits] = useState<number[]>([]);
  const [lastTradeDetails, setLastTradeDetails] = useState<TradeDetails | null>(null);

  // Initialize tick buffers for all markets
  useEffect(() => {
    if (!derivApi.isConnected) return;
    
    const handler = (data: any) => {
      if (!data.tick) return;
      const sym = data.tick.symbol as string;
      const digit = getLastDigit(data.tick.quote);
      const now = performance.now();
      
      if (!tickMapRef.current.has(sym)) {
        tickMapRef.current.set(sym, new CircularTickBuffer(1000));
      }
      const buf = tickMapRef.current.get(sym)!;
      buf.push(digit, data.tick.quote, now);
      
      if (sym === selectedMarket) {
        setActiveDigits(buf.last(8));
      }
    };
    
    const unsub = derivApi.onMessage(handler);
    
    // Subscribe to all markets
    SCANNER_MARKETS.forEach(m => {
      derivApi.subscribeTicks(m.symbol as MarketSymbol, () => {}).catch(() => {});
    });
    
    return () => { unsub(); };
  }, [selectedMarket]);

  // Check initial trade condition
  const checkInitialCondition = useCallback((symbol: string): { shouldTrade: boolean; contractType: string; barrier: string; condition: string } | null => {
    const buf = tickMapRef.current.get(symbol);
    if (!buf || buf.size === 0) return null;
    
    const digits = buf.last(4);
    
    switch (initialTradeType) {
      case 1: { // Over 1 / Under 8 (last 2 digits)
        const last2 = digits.slice(-2);
        if (last2.length < 2) return null;
        const allLessThan1 = last2.every(d => d < 1);
        const allGreaterThan8 = last2.every(d => d > 8);
        
        if (allLessThan1) {
          return { shouldTrade: true, contractType: 'DIGITOVER', barrier: '1', condition: `Last 2 digits (${last2.join(',')}) all < 1 → OVER 1` };
        } else if (allGreaterThan8) {
          return { shouldTrade: true, contractType: 'DIGITUNDER', barrier: '8', condition: `Last 2 digits (${last2.join(',')}) all > 8 → UNDER 8` };
        }
        break;
      }
      
      case 2: { // Over 2 / Under 7 (last 3 digits)
        const last3 = digits.slice(-3);
        if (last3.length < 3) return null;
        const allLessThan2 = last3.every(d => d < 2);
        const allGreaterThan7 = last3.every(d => d > 7);
        
        if (allLessThan2) {
          return { shouldTrade: true, contractType: 'DIGITOVER', barrier: '2', condition: `Last 3 digits (${last3.join(',')}) all < 2 → OVER 2` };
        } else if (allGreaterThan7) {
          return { shouldTrade: true, contractType: 'DIGITUNDER', barrier: '7', condition: `Last 3 digits (${last3.join(',')}) all > 7 → UNDER 7` };
        }
        break;
      }
      
      case 3: { // Over 3 / Under 6 (last 4 digits)
        const last4 = digits.slice(-4);
        if (last4.length < 4) return null;
        const allLessThan3 = last4.every(d => d < 3);
        const allGreaterThan6 = last4.every(d => d > 6);
        
        if (allLessThan3) {
          return { shouldTrade: true, contractType: 'DIGITOVER', barrier: '3', condition: `Last 4 digits (${last4.join(',')}) all < 3 → OVER 3` };
        } else if (allGreaterThan6) {
          return { shouldTrade: true, contractType: 'DIGITUNDER', barrier: '6', condition: `Last 4 digits (${last4.join(',')}) all > 6 → UNDER 6` };
        }
        break;
      }
    }
    
    return null;
  }, [initialTradeType]);

  // Check recovery condition
  const checkRecoveryCondition = useCallback((symbol: string): { shouldTrade: boolean; contractType: string; condition: string } | null => {
    const buf = tickMapRef.current.get(symbol);
    if (!buf || buf.size === 0) return null;
    
    switch (recoveryType) {
      case 1: { // Even/Odd Pattern (last 7)
        const last7 = buf.last(7);
        if (last7.length < 7) return null;
        const allOdd = last7.every(d => d % 2 !== 0);
        const allEven = last7.every(d => d % 2 === 0);
        
        if (allOdd) {
          return { shouldTrade: true, contractType: 'DIGITEVEN', condition: `Last 7 digits (${last7.join(',')}) all odd → EVEN` };
        } else if (allEven) {
          return { shouldTrade: true, contractType: 'DIGITODD', condition: `Last 7 digits (${last7.join(',')}) all even → ODD` };
        }
        break;
      }
      
      case 2: { // Even/Odd Pattern (last 6)
        const last6 = buf.last(6);
        if (last6.length < 6) return null;
        const allOdd = last6.every(d => d % 2 !== 0);
        const allEven = last6.every(d => d % 2 === 0);
        
        if (allOdd) {
          return { shouldTrade: true, contractType: 'DIGITEVEN', condition: `Last 6 digits (${last6.join(',')}) all odd → EVEN` };
        } else if (allEven) {
          return { shouldTrade: true, contractType: 'DIGITODD', condition: `Last 6 digits (${last6.join(',')}) all even → ODD` };
        }
        break;
      }
      
      case 3: { // Over/Under Pattern (last 7)
        const last7 = buf.last(7);
        if (last7.length < 7) return null;
        const allLessThan4 = last7.every(d => d < 4);
        const allGreaterThan5 = last7.every(d => d > 5);
        
        if (allLessThan4) {
          return { shouldTrade: true, contractType: 'DIGITOVER', barrier: '4', condition: `Last 7 digits (${last7.join(',')}) all < 4 → OVER 4` };
        } else if (allGreaterThan5) {
          return { shouldTrade: true, contractType: 'DIGITUNDER', barrier: '5', condition: `Last 7 digits (${last7.join(',')}) all > 5 → UNDER 5` };
        }
        break;
      }
      
      case 4: { // Over/Under Pattern (last 6)
        const last6 = buf.last(6);
        if (last6.length < 6) return null;
        const allLessThan4 = last6.every(d => d < 4);
        const allGreaterThan5 = last6.every(d => d > 5);
        
        if (allLessThan4) {
          return { shouldTrade: true, contractType: 'DIGITOVER', barrier: '4', condition: `Last 6 digits (${last6.join(',')}) all < 4 → OVER 4` };
        } else if (allGreaterThan5) {
          return { shouldTrade: true, contractType: 'DIGITUNDER', barrier: '5', condition: `Last 6 digits (${last6.join(',')}) all > 5 → UNDER 5` };
        }
        break;
      }
    }
    
    return null;
  }, [recoveryType]);

  // Find symbol that matches condition
  const findMatchingSymbol = useCallback((checkFn: (symbol: string) => boolean): string | null => {
    if (!scannerActive) return selectedMarket;
    
    for (const market of SCANNER_MARKETS) {
      if (checkFn(market.symbol)) {
        return market.symbol;
      }
    }
    return null;
  }, [scannerActive, selectedMarket]);

  // Get contract details with entry/exit ticks
  const getContractDetails = useCallback(async (contractId: string): Promise<TradeDetails | null> => {
    return new Promise((resolve) => {
      let attempts = 0;
      const maxAttempts = 30;
      
      const checkContract = () => {
        derivApi.sendMessage({
          proposal_open_contract: 1,
          contract_id: contractId,
          subscribe: 1
        }).catch(() => {});
      };
      
      const unsub = derivApi.onMessage((data: any) => {
        if (data.proposal_open_contract && data.proposal_open_contract.contract_id === contractId) {
          const contract = data.proposal_open_contract;
          
          if (contract.is_sold || contract.status === 'sold') {
            unsub();
            resolve({
              entry_tick: contract.entry_tick || 0,
              exit_tick: contract.exit_tick || 0,
              entry_tick_time: contract.entry_tick_time || 0,
              exit_tick_time: contract.exit_tick_time || 0,
              profit: contract.profit || 0,
              status: contract.profit > 0 ? 'won' : 'lost'
            });
          } else if (attempts >= maxAttempts) {
            unsub();
            resolve(null);
          } else {
            attempts++;
            setTimeout(checkContract, 1000);
          }
        }
      });
      
      checkContract();
      setTimeout(() => {
        unsub();
        resolve(null);
      }, 30000);
    });
  }, []);

  // Execute trade
  const executeTrade = useCallback(async (
    symbol: string,
    contract: string,
    barrier: string | undefined,
    stakeAmount: number,
    step: number,
    condition: string,
    isRecovery: boolean = false
  ): Promise<{ won: boolean; pnl: number; details: TradeDetails | null }> => {
    const logId = ++logIdRef.current;
    const now = new Date().toLocaleTimeString();
    
    setTotalStaked(prev => prev + stakeAmount);
    setCurrentStakeState(stakeAmount);
    
    addLog(logId, {
      time: now,
      market: isRecovery ? 'RECOVERY' : 'INITIAL',
      symbol,
      contract,
      stake: stakeAmount,
      martingaleStep: step,
      entryTick: 0,
      exitTick: 0,
      result: 'Pending',
      pnl: 0,
      balance,
      condition
    });
    
    try {
      if (!turboMode) {
        await waitForNextTick(symbol);
      }
      
      const buyParams: any = {
        contract_type: contract,
        symbol: symbol,
        duration: 1,
        duration_unit: 't',
        basis: 'stake',
        amount: stakeAmount,
      };
      
      if (barrier && (contract === 'DIGITOVER' || contract === 'DIGITUNDER')) {
        buyParams.barrier = barrier;
      }
      
      const { contractId } = await derivApi.buyContract(buyParams);
      
      // Get detailed contract info with entry/exit ticks
      const details = await getContractDetails(contractId);
      
      const result = await derivApi.waitForContractResult(contractId);
      const won = result.status === 'won';
      const pnl = result.profit;
      
      updateLog(logId, {
        entryTick: details?.entry_tick || 0,
        exitTick: details?.exit_tick || 0,
        result: won ? 'Win' : 'Loss',
        pnl,
        balance: balance + netProfit + pnl
      });
      
      setLastTradeDetails(details);
      
      return { won, pnl, details };
    } catch (err: any) {
      updateLog(logId, {
        result: 'Loss',
        pnl: 0,
        condition: `Error: ${err.message}`
      });
      return { won: false, pnl: 0, details: null };
    }
  }, [turboMode, balance, netProfit, addLog, updateLog, getContractDetails]);

  const addLog = useCallback((id: number, entry: Omit<LogEntry, 'id'>) => {
    setLogEntries(prev => [{ ...entry, id }, ...prev].slice(0, 100));
  }, []);

  const updateLog = useCallback((id: number, updates: Partial<LogEntry>) => {
    setLogEntries(prev => prev.map(e => e.id === id ? { ...e, ...updates } : e));
  }, []);

  const clearLog = useCallback(() => {
    setLogEntries([]);
    setWins(0);
    setLosses(0);
    setTotalStaked(0);
    setNetProfit(0);
    setMartingaleStepState(0);
    setLastTradeDetails(null);
  }, []);

  // Main bot loop
  const startBot = useCallback(async () => {
    if (!isAuthorized || isRunning) return;
    
    const baseStake = parseFloat(stake);
    if (baseStake < 0.35) {
      toast.error('Min stake $0.35');
      return;
    }
    
    setIsRunning(true);
    runningRef.current = true;
    setBotStatus('trading');
    
    let cStake = baseStake;
    let mStep = 0;
    let localPnl = 0;
    let localBalance = balance;
    let inRecovery = false;
    let currentSymbolTrade = '';
    
    while (runningRef.current) {
      setBotStatus(inRecovery ? 'recovery' : 'trading');
      
      // Find symbol that matches condition
      let conditionResult;
      let isRecoveryTrade = inRecovery;
      
      if (!inRecovery) {
        // Initial trade - scan all markets for condition
        const matchedSymbol = findMatchingSymbol((symbol) => {
          const result = checkInitialCondition(symbol);
          if (result?.shouldTrade) {
            conditionResult = result;
            return true;
          }
          return false;
        });
        
        if (matchedSymbol && conditionResult) {
          currentSymbolTrade = matchedSymbol;
          setCurrentSymbol(currentSymbolTrade);
          
          const { won, pnl, details } = await executeTrade(
            currentSymbolTrade,
            conditionResult.contractType,
            conditionResult.barrier,
            cStake,
            mStep,
            conditionResult.condition,
            false
          );
          
          localPnl += pnl;
          localBalance += pnl;
          setNetProfit(localPnl);
          
          if (won) {
            setWins(prev => prev + 1);
            mStep = 0;
            cStake = baseStake;
            inRecovery = false;
          } else {
            setLosses(prev => prev + 1);
            if (activeAccount?.is_virtual) {
              recordLoss(cStake, currentSymbolTrade, 6000);
            }
            inRecovery = true;
          }
        } else {
          // No condition met, wait for next tick
          if (!turboMode) await new Promise(r => setTimeout(r, 100));
          continue;
        }
      } else {
        // Recovery mode - check recovery condition
        const matchedSymbol = findMatchingSymbol((symbol) => {
          const result = checkRecoveryCondition(symbol);
          if (result?.shouldTrade) {
            conditionResult = result;
            return true;
          }
          return false;
        });
        
        if (matchedSymbol && conditionResult) {
          currentSymbolTrade = matchedSymbol;
          setCurrentSymbol(currentSymbolTrade);
          
          const { won, pnl, details } = await executeTrade(
            currentSymbolTrade,
            conditionResult.contractType,
            'barrier' in conditionResult ? conditionResult.barrier : undefined,
            cStake,
            mStep,
            conditionResult.condition,
            true
          );
          
          localPnl += pnl;
          localBalance += pnl;
          setNetProfit(localPnl);
          
          if (won) {
            setWins(prev => prev + 1);
            mStep = 0;
            cStake = baseStake;
            inRecovery = false;
          } else {
            setLosses(prev => prev + 1);
            if (activeAccount?.is_virtual) {
              recordLoss(cStake, currentSymbolTrade, 6000);
            }
            
            if (martingaleOn) {
              const maxS = parseInt(martingaleMaxSteps) || 5;
              if (mStep < maxS) {
                cStake = parseFloat((cStake * (parseFloat(martingaleMultiplier) || 2)).toFixed(2));
                mStep++;
                setMartingaleStepState(mStep);
              } else {
                mStep = 0;
                cStake = baseStake;
              }
            }
          }
        } else {
          // No recovery condition met, wait
          if (!turboMode) await new Promise(r => setTimeout(r, 100));
          continue;
        }
      }
      
      setCurrentStakeState(cStake);
      setMartingaleStepState(mStep);
      
      // Check TP/SL
      if (localPnl >= parseFloat(takeProfit)) {
        toast.success(`🎯 Take Profit! +$${localPnl.toFixed(2)}`);
        break;
      }
      if (localPnl <= -parseFloat(stopLoss)) {
        toast.error(`🛑 Stop Loss! $${localPnl.toFixed(2)}`);
        break;
      }
      if (localBalance < cStake) {
        toast.error('Insufficient balance');
        break;
      }
      
      if (!turboMode) await new Promise(r => setTimeout(r, 400));
    }
    
    setIsRunning(false);
    runningRef.current = false;
    setBotStatus('idle');
  }, [isAuthorized, isRunning, balance, stake, initialTradeType, recoveryType, scannerActive, 
      martingaleOn, martingaleMultiplier, martingaleMaxSteps, takeProfit, stopLoss, turboMode,
      findMatchingSymbol, checkInitialCondition, checkRecoveryCondition, executeTrade, recordLoss, activeAccount]);

  const stopBot = useCallback(() => {
    runningRef.current = false;
    setIsRunning(false);
    setBotStatus('idle');
  }, []);

  const winRate = wins + losses > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : '0.0';
  
  const initialTradeTypeInfo = INITIAL_TRADE_TYPES.find(t => t.id === initialTradeType);
  const recoveryTypeInfo = RECOVERY_TYPES.find(t => t.id === recoveryType);

  return (
    <div className="space-y-2 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 bg-gradient-to-r from-card to-card/80 border border-border rounded-xl px-4 py-3">
        <div className="flex items-center gap-3">
          <Scan className="w-5 h-5 text-primary" />
          <h1 className="text-lg font-bold text-foreground">Pro Scanner Bot</h1>
          <Badge className={`${botStatus === 'idle' ? 'bg-muted' : botStatus === 'trading' ? 'bg-profit' : 'bg-purple-500'} text-white`}>
            {botStatus.toUpperCase()}
          </Badge>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Balance</div>
            <div className="font-mono font-bold text-foreground">${balance.toFixed(2)}</div>
          </div>
          {isRunning && (
            <div className="text-right">
              <div className="text-xs text-muted-foreground">P/L</div>
              <div className={`font-mono font-bold ${netProfit >= 0 ? 'text-profit' : 'text-loss'}`}>
                {netProfit >= 0 ? '+' : ''}{netProfit.toFixed(2)}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        {/* Left Column - Configuration */}
        <div className="lg:col-span-5 space-y-3">
          {/* Market Selection */}
          <div className="bg-card border border-border rounded-xl p-3 space-y-2">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" />
              Market Settings
            </h3>
            <Select value={selectedMarket} onValueChange={setSelectedMarket} disabled={isRunning}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Select market" />
              </SelectTrigger>
              <SelectContent>
                {SCANNER_MARKETS.map(m => (
                  <SelectItem key={m.symbol} value={m.symbol}>
                    {m.name} ({m.symbol})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            <div className="flex items-center justify-between">
              <label className="text-sm">Scanner Mode</label>
              <Switch checked={scannerActive} onCheckedChange={setScannerActive} disabled={isRunning} />
            </div>
            {scannerActive && (
              <p className="text-xs text-muted-foreground">Scanning {SCANNER_MARKETS.length} markets for conditions</p>
            )}
          </div>

          {/* Initial Trade Type */}
          <div className="bg-card border-2 border-profit/30 rounded-xl p-3 space-y-2">
            <h3 className="text-sm font-semibold flex items-center gap-2 text-profit">
              <Activity className="w-4 h-4" />
              Initial Trade Type
            </h3>
            <div className="space-y-2">
              {INITIAL_TRADE_TYPES.map(type => (
                <label key={type.id} className="flex items-start gap-2 p-2 rounded-lg hover:bg-muted/50 cursor-pointer">
                  <input
                    type="radio"
                    name="initialTrade"
                    value={type.id}
                    checked={initialTradeType === type.id}
                    onChange={() => setInitialTradeType(type.id)}
                    disabled={isRunning}
                    className="mt-0.5"
                  />
                  <div className="flex-1">
                    <div className="font-medium text-sm">{type.name}</div>
                    <div className="text-xs text-muted-foreground">{type.condition}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Recovery Type */}
          <div className="bg-card border-2 border-purple-500/30 rounded-xl p-3 space-y-2">
            <h3 className="text-sm font-semibold flex items-center gap-2 text-purple-400">
              <RefreshCw className="w-4 h-4" />
              Recovery Type
            </h3>
            <div className="space-y-2">
              {RECOVERY_TYPES.map(type => (
                <label key={type.id} className="flex items-start gap-2 p-2 rounded-lg hover:bg-muted/50 cursor-pointer">
                  <input
                    type="radio"
                    name="recoveryType"
                    value={type.id}
                    checked={recoveryType === type.id}
                    onChange={() => setRecoveryType(type.id)}
                    disabled={isRunning}
                    className="mt-0.5"
                  />
                  <div className="flex-1">
                    <div className="font-medium text-sm">{type.name}</div>
                    <div className="text-xs text-muted-foreground">{type.condition}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Risk Settings */}
          <div className="bg-card border border-border rounded-xl p-3 space-y-2">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Shield className="w-4 h-4" />
              Risk Management
            </h3>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-xs text-muted-foreground">Stake ($)</label>
                <Input type="number" min="0.35" step="0.01" value={stake} onChange={e => setStake(e.target.value)} disabled={isRunning} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Take Profit</label>
                <Input type="number" value={takeProfit} onChange={e => setTakeProfit(e.target.value)} disabled={isRunning} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Stop Loss</label>
                <Input type="number" value={stopLoss} onChange={e => setStopLoss(e.target.value)} disabled={isRunning} />
              </div>
            </div>
            
            <div className="flex items-center justify-between">
              <label className="text-sm">Martingale</label>
              <Switch checked={martingaleOn} onCheckedChange={setMartingaleOn} disabled={isRunning} />
            </div>
            
            {martingaleOn && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-muted-foreground">Multiplier</label>
                  <Input type="number" min="1.1" step="0.1" value={martingaleMultiplier} onChange={e => setMartingaleMultiplier(e.target.value)} disabled={isRunning} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Max Steps</label>
                  <Input type="number" min="1" max="10" value={martingaleMaxSteps} onChange={e => setMartingaleMaxSteps(e.target.value)} disabled={isRunning} />
                </div>
              </div>
            )}
            
            <div className="flex items-center justify-between">
              <label className="text-sm">Turbo Mode</label>
              <Switch checked={turboMode} onCheckedChange={setTurboMode} disabled={isRunning} />
            </div>
          </div>

          {/* Bot Controls */}
          <div className="grid grid-cols-2 gap-2">
            <Button
              onClick={startBot}
              disabled={isRunning || !isAuthorized || balance < parseFloat(stake)}
              className="h-12 text-base font-bold bg-profit hover:bg-profit/90 text-profit-foreground"
            >
              <Play className="w-4 h-4 mr-2" /> START BOT
            </Button>
            <Button
              onClick={stopBot}
              disabled={!isRunning}
              variant="destructive"
              className="h-12 text-base font-bold"
            >
              <StopCircle className="w-4 h-4 mr-2" /> STOP
            </Button>
          </div>
        </div>

        {/* Right Column - Live Data */}
        <div className="lg:col-span-7 space-y-3">
          {/* Live Digits Display */}
          <div className="bg-card border border-border rounded-xl p-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold">Live Digits - {currentSymbol || selectedMarket}</h3>
              <Badge variant="outline">Win Rate: {winRate}%</Badge>
            </div>
            <div className="flex gap-1 justify-center flex-wrap">
              {activeDigits.length === 0 ? (
                <span className="text-sm text-muted-foreground">Waiting for ticks...</span>
              ) : activeDigits.map((d, i) => {
                const isOver = d >= 5;
                const isEven = d % 2 === 0;
                const isLast = i === activeDigits.length - 1;
                return (
                  <div key={i} className={`w-12 h-14 rounded-lg flex flex-col items-center justify-center text-lg font-mono font-bold border-2 transition-all ${
                    isLast ? 'ring-2 ring-primary scale-105' : ''
                  } ${isOver ? 'bg-loss/20 border-loss/50 text-loss' : 'bg-profit/20 border-profit/50 text-profit'}`}>
                    <span className="text-xl">{d}</span>
                    <span className="text-[10px] opacity-70">{isOver ? 'OVER' : 'UNDER'} | {isEven ? 'EVEN' : 'ODD'}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Trade Conditions Display */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-card border border-profit/30 rounded-xl p-2">
              <div className="text-xs text-muted-foreground mb-1">Initial Trade Condition</div>
              <div className="text-sm font-medium text-profit">{initialTradeTypeInfo?.name}</div>
              <div className="text-[10px] text-muted-foreground mt-1">{initialTradeTypeInfo?.condition}</div>
            </div>
            <div className="bg-card border border-purple-500/30 rounded-xl p-2">
              <div className="text-xs text-muted-foreground mb-1">Recovery Condition</div>
              <div className="text-sm font-medium text-purple-400">{recoveryTypeInfo?.name}</div>
              <div className="text-[10px] text-muted-foreground mt-1">{recoveryTypeInfo?.condition}</div>
            </div>
          </div>

          {/* Trade Stats */}
          <div className="grid grid-cols-4 gap-2">
            <div className="bg-card border border-border rounded-lg p-2 text-center">
              <div className="text-[10px] text-muted-foreground">Trades</div>
              <div className="font-mono text-lg font-bold">{wins + losses}</div>
            </div>
            <div className="bg-card border border-border rounded-lg p-2 text-center">
              <div className="text-[10px] text-muted-foreground">Wins</div>
              <div className="font-mono text-lg font-bold text-profit">{wins}</div>
            </div>
            <div className="bg-card border border-border rounded-lg p-2 text-center">
              <div className="text-[10px] text-muted-foreground">Losses</div>
              <div className="font-mono text-lg font-bold text-loss">{losses}</div>
            </div>
            <div className="bg-card border border-border rounded-lg p-2 text-center">
              <div className="text-[10px] text-muted-foreground">Staked</div>
              <div className="font-mono text-lg font-bold text-primary">${totalStaked.toFixed(2)}</div>
            </div>
          </div>

          {/* Last Trade Details */}
          {lastTradeDetails && (
            <div className="bg-card border border-primary/30 rounded-xl p-3">
              <h3 className="text-sm font-semibold mb-2">Last Trade Details</h3>
              <div className="grid grid-cols-4 gap-2 text-center">
                <div>
                  <div className="text-[10px] text-muted-foreground">Entry Tick</div>
                  <div className="font-mono text-sm font-bold">{lastTradeDetails.entry_tick}</div>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground">Exit Tick</div>
                  <div className="font-mono text-sm font-bold">{lastTradeDetails.exit_tick}</div>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground">Result</div>
                  <div className={`font-mono text-sm font-bold ${lastTradeDetails.profit > 0 ? 'text-profit' : 'text-loss'}`}>
                    {lastTradeDetails.profit > 0 ? 'WIN' : 'LOSS'}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground">P/L</div>
                  <div className={`font-mono text-sm font-bold ${lastTradeDetails.profit > 0 ? 'text-profit' : 'text-loss'}`}>
                    ${lastTradeDetails.profit.toFixed(2)}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Activity Log */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-3 py-2 border-b border-border flex items-center justify-between">
              <h3 className="text-sm font-semibold">Activity Log</h3>
              <Button variant="ghost" size="sm" onClick={clearLog} className="h-7 w-7 p-0">
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
            <div className="max-h-[400px] overflow-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/30 sticky top-0">
                  <tr>
                    <th className="text-left p-2">Time</th>
                    <th className="text-left p-2">Market</th>
                    <th className="text-left p-2">Symbol</th>
                    <th className="text-left p-2">Type</th>
                    <th className="text-right p-2">Stake</th>
                    <th className="text-center p-2">Result</th>
                    <th className="text-right p-2">P/L</th>
                  </tr>
                </thead>
                <tbody>
                  {logEntries.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center text-muted-foreground py-8">
                        No trades yet — configure and start the bot
                      </td>
                    </tr>
                  ) : logEntries.map(e => (
                    <tr key={e.id} className={`border-t border-border/30 ${
                      e.market === 'INITIAL' ? 'border-l-2 border-l-profit' : 'border-l-2 border-l-purple-500'
                    }`}>
                      <td className="p-2 font-mono text-[10px]">{e.time}</td>
                      <td className="p-2">
                        <Badge variant={e.market === 'INITIAL' ? 'default' : 'secondary'} className="text-[9px]">
                          {e.market}
                        </Badge>
                      </td>
                      <td className="p-2 font-mono text-[10px]">{e.symbol}</td>
                      <td className="p-2 text-[10px]">{e.contract.replace('DIGIT', '')}</td>
                      <td className="p-2 font-mono text-right">
                        ${e.stake.toFixed(2)}
                        {e.martingaleStep > 0 && <span className="text-warning ml-1">M{e.martingaleStep}</span>}
                      </td>
                      <td className="p-2 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          e.result === 'Win' ? 'bg-profit/20 text-profit' :
                          e.result === 'Loss' ? 'bg-loss/20 text-loss' :
                          'bg-warning/20 text-warning animate-pulse'
                        }`}>
                          {e.result}
                        </span>
                      </td>
                      <td className={`p-2 font-mono text-right ${e.pnl > 0 ? 'text-profit' : e.pnl < 0 ? 'text-loss' : ''}`}>
                        {e.result === 'Pending' ? '...' : `${e.pnl > 0 ? '+' : ''}${e.pnl.toFixed(2)}`}
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
  );
}
