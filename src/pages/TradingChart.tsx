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
import { toast } from 'sonner';
import {
  Play, StopCircle, Trash2, Scan,
  Home, RefreshCw, Shield, Zap, Eye, Activity, TrendingUp, TrendingDown
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

const INITIAL_TRADE_TYPES = [
  { id: 1, name: 'Over 1 / Under 8', window: 2, over: 1, under: 8 },
  { id: 2, name: 'Over 2 / Under 7', window: 3, over: 2, under: 7 },
  { id: 3, name: 'Over 3 / Under 6', window: 4, over: 3, under: 6 },
] as const;

const RECOVERY_TYPES = [
  { id: 1, name: 'Even/Odd (last 7)', window: 7, type: 'evenodd' },
  { id: 2, name: 'Even/Odd (last 6)', window: 6, type: 'evenodd' },
  { id: 3, name: 'Over/Under (last 7)', window: 7, type: 'overunder', over: 4, under: 5 },
  { id: 4, name: 'Over/Under (last 6)', window: 6, type: 'overunder', over: 4, under: 5 },
] as const;

interface TickData {
  digit: number;
  quote: number;
  timestamp: number;
}

interface TradeDetails {
  entry_tick: number;
  exit_tick: number;
  entry_tick_time: number;
  exit_tick_time: number;
  profit: number;
  buy_price: number;
  sell_price: number;
}

interface LogEntry {
  id: number;
  time: string;
  type: 'INITIAL' | 'RECOVERY';
  symbol: string;
  contract: string;
  stake: number;
  step: number;
  entryTick: number;
  exitTick: number;
  result: 'Win' | 'Loss';
  pnl: number;
  balance: number;
  condition: string;
}

type BotStatus = 'idle' | 'scanning' | 'trading' | 'recovery';

export default function ProScannerBot() {
  const { isAuthorized, balance, activeAccount } = useAuth();
  const { recordLoss } = useLossRequirement();
  const location = useLocation();

  // Configuration
  const [initialTradeType, setInitialTradeType] = useState(1);
  const [recoveryType, setRecoveryType] = useState(1);
  const [stake, setStake] = useState('0.35');
  const [martingaleOn, setMartingaleOn] = useState(false);
  const [martingaleMultiplier, setMartingaleMultiplier] = useState('2');
  const [martingaleMaxSteps, setMartingaleMaxSteps] = useState('3');
  const [takeProfit, setTakeProfit] = useState('10');
  const [stopLoss, setStopLoss] = useState('5');
  const [turboMode, setTurboMode] = useState(false);

  // Bot State
  const [isRunning, setIsRunning] = useState(false);
  const [botStatus, setBotStatus] = useState<BotStatus>('idle');
  const [currentSymbol, setCurrentSymbol] = useState('');
  const [wins, setWins] = useState(0);
  const [losses, setLosses] = useState(0);
  const [totalStaked, setTotalStaked] = useState(0);
  const [netProfit, setNetProfit] = useState(0);
  const [currentStake, setCurrentStake] = useState(0);
  const [martingaleStep, setMartingaleStep] = useState(0);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [activeDigits, setActiveDigits] = useState<number[]>([]);
  const [lastTradeDetails, setLastTradeDetails] = useState<TradeDetails | null>(null);
  
  // Refs
  const runningRef = useRef(false);
  const tickBuffersRef = useRef<Map<string, TickData[]>>(new Map());
  const logIdRef = useRef(0);

  // Initialize tick buffers
  useEffect(() => {
    if (!derivApi.isConnected) return;

    const handleTick = (data: any) => {
      if (!data.tick) return;
      
      const symbol = data.tick.symbol as string;
      const digit = getLastDigit(data.tick.quote);
      const tickData: TickData = {
        digit,
        quote: data.tick.quote,
        timestamp: Date.now()
      };
      
      if (!tickBuffersRef.current.has(symbol)) {
        tickBuffersRef.current.set(symbol, []);
      }
      
      const buffer = tickBuffersRef.current.get(symbol)!;
      buffer.push(tickData);
      
      // Keep last 100 ticks
      while (buffer.length > 100) buffer.shift();
      
      // Update active digits for current symbol
      if (symbol === currentSymbol || (!currentSymbol && symbol === SCANNER_MARKETS[0].symbol)) {
        const digits = buffer.slice(-8).map(t => t.digit);
        setActiveDigits(digits);
      }
    };

    const unsubscribe = derivApi.onMessage(handleTick);
    
    // Subscribe to all markets
    SCANNER_MARKETS.forEach(market => {
      derivApi.subscribeTicks(market.symbol as MarketSymbol, () => {}).catch(console.error);
    });

    return () => unsubscribe();
  }, [currentSymbol]);

  // Check initial trade condition
  const checkInitialCondition = useCallback((digits: number[]): { shouldTrade: boolean; contractType: string; barrier: string; condition: string } | null => {
    const config = INITIAL_TRADE_TYPES.find(t => t.id === initialTradeType);
    if (!config || digits.length < config.window) return null;
    
    const lastDigits = digits.slice(-config.window);
    const allUnderOver = lastDigits.every(d => d < config.over);
    const allOverUnder = lastDigits.every(d => d > config.under);
    
    if (allUnderOver) {
      return {
        shouldTrade: true,
        contractType: 'DIGITOVER',
        barrier: config.over.toString(),
        condition: `Last ${config.window} digits [${lastDigits.join(',')}] all < ${config.over} → OVER ${config.over}`
      };
    } else if (allOverUnder) {
      return {
        shouldTrade: true,
        contractType: 'DIGITUNDER',
        barrier: config.under.toString(),
        condition: `Last ${config.window} digits [${lastDigits.join(',')}] all > ${config.under} → UNDER ${config.under}`
      };
    }
    
    return null;
  }, [initialTradeType]);

  // Check recovery condition
  const checkRecoveryCondition = useCallback((digits: number[]): { shouldTrade: boolean; contractType: string; barrier?: string; condition: string } | null => {
    const config = RECOVERY_TYPES.find(t => t.id === recoveryType);
    if (!config || digits.length < config.window) return null;
    
    const lastDigits = digits.slice(-config.window);
    
    if (config.type === 'evenodd') {
      const allOdd = lastDigits.every(d => d % 2 === 1);
      const allEven = lastDigits.every(d => d % 2 === 0);
      
      if (allOdd) {
        return {
          shouldTrade: true,
          contractType: 'DIGITEVEN',
          condition: `Last ${config.window} digits [${lastDigits.join(',')}] all odd → EVEN`
        };
      } else if (allEven) {
        return {
          shouldTrade: true,
          contractType: 'DIGITODD',
          condition: `Last ${config.window} digits [${lastDigits.join(',')}] all even → ODD`
        };
      }
    } else if (config.type === 'overunder') {
      const allUnderOver = lastDigits.every(d => d < config.over);
      const allOverUnder = lastDigits.every(d => d > config.under);
      
      if (allUnderOver) {
        return {
          shouldTrade: true,
          contractType: 'DIGITOVER',
          barrier: config.over.toString(),
          condition: `Last ${config.window} digits [${lastDigits.join(',')}] all < ${config.over} → OVER ${config.over}`
        };
      } else if (allOverUnder) {
        return {
          shouldTrade: true,
          contractType: 'DIGITUNDER',
          barrier: config.under.toString(),
          condition: `Last ${config.window} digits [${lastDigits.join(',')}] all > ${config.under} → UNDER ${config.under}`
        };
      }
    }
    
    return null;
  }, [recoveryType]);

  // Get contract details with proper tick information
  const getContractDetails = useCallback(async (contractId: string): Promise<TradeDetails | null> => {
    return new Promise((resolve) => {
      let attempts = 0;
      const maxAttempts = 20;
      
      const fetchContract = () => {
        derivApi.sendMessage({
          proposal_open_contract: 1,
          contract_id: contractId,
          subscribe: 1
        }).catch(() => {});
      };
      
      const unsubscribe = derivApi.onMessage((data: any) => {
        if (data.proposal_open_contract && data.proposal_open_contract.contract_id === contractId) {
          const contract = data.proposal_open_contract;
          
          // Check if contract is sold/closed
          if (contract.is_sold === 1 || contract.status === 'sold') {
            unsubscribe();
            resolve({
              entry_tick: contract.entry_tick || 0,
              exit_tick: contract.exit_tick || 0,
              entry_tick_time: contract.entry_tick_time || 0,
              exit_tick_time: contract.exit_tick_time || 0,
              profit: contract.profit || 0,
              buy_price: contract.buy_price || 0,
              sell_price: contract.sell_price || 0
            });
          } else if (attempts >= maxAttempts) {
            unsubscribe();
            resolve(null);
          } else {
            attempts++;
            setTimeout(fetchContract, 1000);
          }
        }
      });
      
      fetchContract();
      
      // Timeout after 30 seconds
      setTimeout(() => {
        unsubscribe();
        resolve(null);
      }, 30000);
    });
  }, []);

  // Execute a single trade
  const executeTrade = useCallback(async (
    symbol: string,
    contractType: string,
    barrier: string | undefined,
    stakeAmount: number,
    step: number,
    condition: string,
    isRecovery: boolean
  ): Promise<{ success: boolean; pnl: number; details: TradeDetails | null }> => {
    const logId = ++logIdRef.current;
    const now = new Date().toLocaleTimeString();
    
    setTotalStaked(prev => prev + stakeAmount);
    setCurrentStake(stakeAmount);
    
    // Add pending log
    setLogEntries(prev => [{
      id: logId,
      time: now,
      type: isRecovery ? 'RECOVERY' : 'INITIAL',
      symbol,
      contract: contractType,
      stake: stakeAmount,
      step,
      entryTick: 0,
      exitTick: 0,
      result: 'Win',
      pnl: 0,
      balance: balance + netProfit,
      condition
    }, ...prev].slice(0, 100));
    
    try {
      // Wait for next tick if not in turbo mode
      if (!turboMode) {
        await new Promise<void>((resolve) => {
          const unsubscribe = derivApi.onMessage((data: any) => {
            if (data.tick && data.tick.symbol === symbol) {
              unsubscribe();
              resolve();
            }
          });
        });
      }
      
      // Prepare buy parameters
      const buyParams: any = {
        contract_type: contractType,
        symbol: symbol,
        duration: 1,
        duration_unit: 't',
        basis: 'stake',
        amount: stakeAmount,
      };
      
      if (barrier && (contractType === 'DIGITOVER' || contractType === 'DIGITUNDER')) {
        buyParams.barrier = barrier;
      }
      
      // Buy contract
      const { contractId } = await derivApi.buyContract(buyParams);
      
      // Wait for contract result
      const result = await derivApi.waitForContractResult(contractId);
      const won = result.status === 'won';
      const pnl = result.profit;
      
      // Get detailed contract info
      const details = await getContractDetails(contractId);
      
      // Update log entry
      setLogEntries(prev => prev.map(entry => 
        entry.id === logId ? {
          ...entry,
          entryTick: details?.entry_tick || 0,
          exitTick: details?.exit_tick || 0,
          result: won ? 'Win' : 'Loss',
          pnl,
          balance: balance + netProfit + pnl
        } : entry
      ));
      
      setLastTradeDetails(details);
      
      return { success: won, pnl, details };
    } catch (error: any) {
      console.error('Trade error:', error);
      
      // Update log with error
      setLogEntries(prev => prev.map(entry => 
        entry.id === logId ? {
          ...entry,
          result: 'Loss',
          pnl: 0,
          condition: `Error: ${error.message}`
        } : entry
      ));
      
      return { success: false, pnl: 0, details: null };
    }
  }, [turboMode, balance, netProfit, getContractDetails]);

  // Find symbol matching condition
  const findMatchingSymbol = useCallback((
    checkFn: (digits: number[]) => { shouldTrade: boolean } | null
  ): { symbol: string; condition: any } | null => {
    for (const market of SCANNER_MARKETS) {
      const buffer = tickBuffersRef.current.get(market.symbol);
      if (buffer && buffer.length > 0) {
        const digits = buffer.map(t => t.digit);
        const result = checkFn(digits);
        if (result?.shouldTrade) {
          return { symbol: market.symbol, condition: result };
        }
      }
    }
    return null;
  }, []);

  // Main bot loop
  const startBot = useCallback(async () => {
    if (!isAuthorized || isRunning) {
      toast.error('Please connect your account first');
      return;
    }
    
    const baseStake = parseFloat(stake);
    if (baseStake < 0.35) {
      toast.error('Minimum stake is $0.35');
      return;
    }
    
    setIsRunning(true);
    runningRef.current = true;
    setBotStatus('scanning');
    
    let currentStakeAmount = baseStake;
    let currentStep = 0;
    let currentPnl = 0;
    let inRecovery = false;
    
    while (runningRef.current) {
      setBotStatus(inRecovery ? 'recovery' : 'scanning');
      
      // Find matching symbol and condition
      let match: { symbol: string; condition: any } | null = null;
      
      if (!inRecovery) {
        match = findMatchingSymbol((digits) => checkInitialCondition(digits));
      } else {
        match = findMatchingSymbol((digits) => checkRecoveryCondition(digits));
      }
      
      if (match) {
        setCurrentSymbol(match.symbol);
        setBotStatus('trading');
        
        const { success, pnl, details } = await executeTrade(
          match.symbol,
          match.condition.contractType,
          match.condition.barrier,
          currentStakeAmount,
          currentStep,
          match.condition.condition,
          inRecovery
        );
        
        currentPnl += pnl;
        setNetProfit(currentPnl);
        
        if (success) {
          setWins(prev => prev + 1);
          currentStep = 0;
          currentStakeAmount = baseStake;
          inRecovery = false;
        } else {
          setLosses(prev => prev + 1);
          
          // Record loss for virtual trading
          if (activeAccount?.is_virtual) {
            recordLoss(currentStakeAmount, match.symbol, 6000);
          }
          
          if (!inRecovery) {
            // Switch to recovery mode
            inRecovery = true;
            toast.info('Loss detected - Switching to recovery mode');
          } else if (martingaleOn && currentStep < parseInt(martingaleMaxSteps)) {
            // Increase stake for martingale
            const multiplier = parseFloat(martingaleMultiplier);
            currentStakeAmount = parseFloat((currentStakeAmount * multiplier).toFixed(2));
            currentStep++;
            setMartingaleStep(currentStep);
            toast.info(`Martingale step ${currentStep} - Stake increased to $${currentStakeAmount}`);
          } else {
            // Reset after max steps
            currentStep = 0;
            currentStakeAmount = baseStake;
            inRecovery = false;
          }
        }
        
        setCurrentStake(currentStakeAmount);
        setMartingaleStep(currentStep);
        
        // Check TP/SL
        if (currentPnl >= parseFloat(takeProfit)) {
          toast.success(`🎯 Take Profit reached! +$${currentPnl.toFixed(2)}`);
          break;
        }
        if (currentPnl <= -parseFloat(stopLoss)) {
          toast.error(`🛑 Stop Loss reached! $${currentPnl.toFixed(2)}`);
          break;
        }
        
        // Small delay between trades
        if (!turboMode) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } else {
        // No condition met, wait for ticks
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    setIsRunning(false);
    runningRef.current = false;
    setBotStatus('idle');
  }, [isAuthorized, isRunning, stake, initialTradeType, recoveryType, martingaleOn, 
      martingaleMultiplier, martingaleMaxSteps, takeProfit, stopLoss, turboMode, 
      activeAccount, recordLoss, findMatchingSymbol, checkInitialCondition, 
      checkRecoveryCondition, executeTrade]);

  const stopBot = useCallback(() => {
    runningRef.current = false;
    setIsRunning(false);
    setBotStatus('idle');
    toast.info('Bot stopped');
  }, []);

  const clearLog = useCallback(() => {
    setLogEntries([]);
    setWins(0);
    setLosses(0);
    setTotalStaked(0);
    setNetProfit(0);
    setMartingaleStep(0);
    setLastTradeDetails(null);
  }, []);

  const winRate = wins + losses > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : '0';

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-background/95 p-4">
      <div className="max-w-7xl mx-auto space-y-4">
        {/* Header */}
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="bg-primary/10 p-2 rounded-lg">
                <Scan className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h1 className="text-xl font-bold">Pro Scanner Bot</h1>
                <p className="text-xs text-muted-foreground">Auto-scan & trade across all markets</p>
              </div>
            </div>
            
            <div className="flex items-center gap-4">
              <div className="text-right">
                <div className="text-xs text-muted-foreground">Balance</div>
                <div className="font-mono text-xl font-bold">${balance.toFixed(2)}</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-muted-foreground">P/L</div>
                <div className={`font-mono text-xl font-bold ${netProfit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  {netProfit >= 0 ? '+' : ''}{netProfit.toFixed(2)}
                </div>
              </div>
              <Badge className={`text-sm px-3 py-1 ${
                botStatus === 'idle' ? 'bg-muted' :
                botStatus === 'scanning' ? 'bg-blue-500' :
                botStatus === 'trading' ? 'bg-green-500' :
                'bg-purple-500'
              }`}>
                {botStatus.toUpperCase()}
              </Badge>
            </div>
          </div>
        </div>

        <div className="grid lg:grid-cols-12 gap-4">
          {/* Left Panel - Configuration */}
          <div className="lg:col-span-5 space-y-4">
            {/* Initial Trade Type */}
            <div className="bg-card border-2 border-green-500/30 rounded-xl p-4">
              <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-green-500" />
                Initial Trade
              </h2>
              <div className="space-y-2">
                {INITIAL_TRADE_TYPES.map(type => (
                  <label key={type.id} className="flex items-start gap-3 p-3 rounded-lg hover:bg-muted/50 cursor-pointer border border-transparent hover:border-border transition-all">
                    <input
                      type="radio"
                      name="initialTrade"
                      checked={initialTradeType === type.id}
                      onChange={() => setInitialTradeType(type.id)}
                      disabled={isRunning}
                      className="mt-1"
                    />
                    <div className="flex-1">
                      <div className="font-medium">{type.name}</div>
                      <div className="text-xs text-muted-foreground">
                        Last {type.window} digits all &lt; {type.over} → OVER {type.over} | 
                        All &gt; {type.under} → UNDER {type.under}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Recovery Type */}
            <div className="bg-card border-2 border-purple-500/30 rounded-xl p-4">
              <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <RefreshCw className="w-5 h-5 text-purple-500" />
                Recovery Mode
              </h2>
              <div className="space-y-2">
                {RECOVERY_TYPES.map(type => (
                  <label key={type.id} className="flex items-start gap-3 p-3 rounded-lg hover:bg-muted/50 cursor-pointer border border-transparent hover:border-border transition-all">
                    <input
                      type="radio"
                      name="recoveryType"
                      checked={recoveryType === type.id}
                      onChange={() => setRecoveryType(type.id)}
                      disabled={isRunning}
                      className="mt-1"
                    />
                    <div className="flex-1">
                      <div className="font-medium">{type.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {type.type === 'evenodd' 
                          ? `Last ${type.window} digits all odd → EVEN | All even → ODD`
                          : `Last ${type.window} digits all < ${type.over} → OVER ${type.over} | All > ${type.under} → UNDER ${type.under}`
                        }
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Risk Settings */}
            <div className="bg-card border border-border rounded-xl p-4">
              <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <Shield className="w-5 h-5" />
                Risk Management
              </h2>
              
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Stake ($)</label>
                  <Input
                    type="number"
                    min="0.35"
                    step="0.01"
                    value={stake}
                    onChange={e => setStake(e.target.value)}
                    disabled={isRunning}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Take Profit ($)</label>
                  <Input
                    type="number"
                    value={takeProfit}
                    onChange={e => setTakeProfit(e.target.value)}
                    disabled={isRunning}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Stop Loss ($)</label>
                  <Input
                    type="number"
                    value={stopLoss}
                    onChange={e => setStopLoss(e.target.value)}
                    disabled={isRunning}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <label className="text-sm">Turbo Mode</label>
                  <Switch checked={turboMode} onCheckedChange={setTurboMode} disabled={isRunning} />
                </div>
              </div>
              
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm">Martingale</label>
                <Switch checked={martingaleOn} onCheckedChange={setMartingaleOn} disabled={isRunning} />
              </div>
              
              {martingaleOn && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Multiplier</label>
                    <Input
                      type="number"
                      min="1.1"
                      step="0.1"
                      value={martingaleMultiplier}
                      onChange={e => setMartingaleMultiplier(e.target.value)}
                      disabled={isRunning}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Max Steps</label>
                    <Input
                      type="number"
                      min="1"
                      max="10"
                      value={martingaleMaxSteps}
                      onChange={e => setMartingaleMaxSteps(e.target.value)}
                      disabled={isRunning}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Control Buttons */}
            <div className="grid grid-cols-2 gap-3">
              <Button
                onClick={startBot}
                disabled={isRunning || !isAuthorized}
                className="h-12 bg-green-500 hover:bg-green-600 text-white"
              >
                <Play className="w-4 h-4 mr-2" />
                START BOT
              </Button>
              <Button
                onClick={stopBot}
                disabled={!isRunning}
                variant="destructive"
                className="h-12"
              >
                <StopCircle className="w-4 h-4 mr-2" />
                STOP
              </Button>
            </div>
          </div>

          {/* Right Panel - Live Data */}
          <div className="lg:col-span-7 space-y-4">
            {/* Live Digits */}
            <div className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold">Live Digits</h2>
                <Badge variant="outline" className="text-sm">
                  Win Rate: {winRate}%
                </Badge>
              </div>
              <div className="flex gap-2 justify-center flex-wrap">
                {activeDigits.length === 0 ? (
                  <div className="text-center text-muted-foreground py-8">
                    Waiting for market data...
                  </div>
                ) : activeDigits.map((digit, i) => {
                  const isOver = digit >= 5;
                  const isEven = digit % 2 === 0;
                  const isLast = i === activeDigits.length - 1;
                  return (
                    <div
                      key={i}
                      className={`w-14 h-16 rounded-lg flex flex-col items-center justify-center border-2 transition-all ${
                        isLast ? 'ring-2 ring-primary scale-105' : ''
                      } ${isOver ? 'bg-red-500/10 border-red-500/50' : 'bg-green-500/10 border-green-500/50'}`}
                    >
                      <span className="text-2xl font-mono font-bold">{digit}</span>
                      <span className="text-[10px] mt-1">
                        {isOver ? 'OVER' : 'UNDER'} | {isEven ? 'EVEN' : 'ODD'}
                      </span>
                    </div>
                  );
                })}
              </div>
              {currentSymbol && (
                <div className="text-center text-xs text-muted-foreground mt-3">
                  Current Market: {currentSymbol}
                </div>
              )}
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-4 gap-3">
              <div className="bg-card border border-border rounded-lg p-3 text-center">
                <div className="text-xs text-muted-foreground">Total Trades</div>
                <div className="text-2xl font-bold">{wins + losses}</div>
              </div>
              <div className="bg-card border border-border rounded-lg p-3 text-center">
                <div className="text-xs text-muted-foreground">Wins</div>
                <div className="text-2xl font-bold text-green-500">{wins}</div>
              </div>
              <div className="bg-card border border-border rounded-lg p-3 text-center">
                <div className="text-xs text-muted-foreground">Losses</div>
                <div className="text-2xl font-bold text-red-500">{losses}</div>
              </div>
              <div className="bg-card border border-border rounded-lg p-3 text-center">
                <div className="text-xs text-muted-foreground">Total Staked</div>
                <div className="text-2xl font-bold">${totalStaked.toFixed(2)}</div>
              </div>
            </div>

            {/* Last Trade Details */}
            {lastTradeDetails && (
              <div className="bg-card border border-primary/30 rounded-xl p-4">
                <h3 className="text-sm font-semibold mb-2">Last Trade Details</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div>
                    <div className="text-xs text-muted-foreground">Entry Tick</div>
                    <div className="font-mono text-lg font-bold">{lastTradeDetails.entry_tick || 'N/A'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Exit Tick</div>
                    <div className="font-mono text-lg font-bold">{lastTradeDetails.exit_tick || 'N/A'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Entry Price</div>
                    <div className="font-mono text-lg font-bold">${lastTradeDetails.buy_price?.toFixed(2) || 'N/A'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Exit Price</div>
                    <div className="font-mono text-lg font-bold">${lastTradeDetails.sell_price?.toFixed(2) || 'N/A'}</div>
                  </div>
                </div>
              </div>
            )}

            {/* Activity Log */}
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <h2 className="text-lg font-semibold">Activity Log</h2>
                <Button variant="ghost" size="sm" onClick={clearLog}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
              <div className="max-h-[400px] overflow-auto">
                {logEntries.length === 0 ? (
                  <div className="text-center text-muted-foreground py-12">
                    No trades yet. Start the bot to begin trading.
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr>
                        <th className="text-left p-3">Time</th>
                        <th className="text-left p-3">Type</th>
                        <th className="text-left p-3">Symbol</th>
                        <th className="text-right p-3">Stake</th>
                        <th className="text-center p-3">Result</th>
                        <th className="text-right p-3">P/L</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logEntries.map(entry => (
                        <tr key={entry.id} className="border-t border-border/50 hover:bg-muted/30">
                          <td className="p-3 font-mono text-xs">{entry.time}</td>
                          <td className="p-3">
                            <Badge variant={entry.type === 'INITIAL' ? 'default' : 'secondary'} className="text-xs">
                              {entry.type}
                            </Badge>
                          </td>
                          <td className="p-3 font-mono text-xs">{entry.symbol}</td>
                          <td className="p-3 text-right font-mono">
                            ${entry.stake.toFixed(2)}
                            {entry.step > 0 && <span className="text-orange-500 ml-1">M{entry.step}</span>}
                          </td>
                          <td className="p-3 text-center">
                            <Badge className={entry.result === 'Win' ? 'bg-green-500' : 'bg-red-500'}>
                              {entry.result}
                            </Badge>
                          </td>
                          <td className={`p-3 text-right font-mono font-bold ${entry.pnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                            {entry.pnl >= 0 ? '+' : ''}{entry.pnl.toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
