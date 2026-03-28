import { useState, useRef, useCallback, useEffect } from 'react';
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
import { Play, StopCircle, Trash2, Zap, TrendingUp, TrendingDown } from 'lucide-react';

const ALL_MARKETS: MarketSymbol[] = [
  'R_10', 'R_25', 'R_50', 'R_75', 'R_100',
  '1HZ10V', '1HZ15V', '1HZ25V', '1HZ30V', '1HZ50V', '1HZ75V', '1HZ90V', '1HZ100V',
  'JD10', 'JD25', 'RDBEAR', 'RDBULL'
];

type InitialTradeType = 'over1_under8' | 'over2_under7' | 'over3_under6';
type RecoveryType = 'even_odd_7' | 'even_odd_6' | 'over4_under5_7' | 'over4_under5_6';

interface Trade {
  id: string;
  time: string;
  symbol: string;
  type: string;
  stake: number;
  entryPrice: number;
  exitPrice?: number;
  entryTick?: number;
  exitTick?: number;
  profit: number;
  status: 'pending' | 'won' | 'lost';
  isRecovery: boolean;
  step: number;
}

interface MarketData {
  symbol: string;
  digits: number[];
  lastPrice: number;
  lastUpdate: number;
}

export default function AutoScannerBot() {
  const { isAuthorized, balance, activeAccount } = useAuth();
  const { recordLoss } = useLossRequirement();

  // Bot Configuration
  const [initialTradeType, setInitialTradeType] = useState<InitialTradeType>('over1_under8');
  const [recoveryType, setRecoveryType] = useState<RecoveryType>('even_odd_7');
  const [stake, setStake] = useState('0.5');
  const [takeProfit, setTakeProfit] = useState('5');
  const [stopLoss, setStopLoss] = useState('30');
  const [martingaleEnabled, setMartingaleEnabled] = useState(false);
  const [martingaleMultiplier, setMartingaleMultiplier] = useState('2');
  const [martingaleMaxSteps, setMartingaleMaxSteps] = useState('5');

  // Bot State
  const [isRunning, setIsRunning] = useState(false);
  const [isRecoveryMode, setIsRecoveryMode] = useState(false);
  const [currentTradeSymbol, setCurrentTradeSymbol] = useState<string>('');
  const [wins, setWins] = useState(0);
  const [losses, setLosses] = useState(0);
  const [totalProfit, setTotalProfit] = useState(0);
  const [currentStake, setCurrentStake] = useState(0.5);
  const [martingaleStep, setMartingaleStep] = useState(0);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [marketData, setMarketData] = useState<Map<string, MarketData>>(new Map());

  const runningRef = useRef(false);
  const tradeIdRef = useRef(0);
  const lastTradeTimeRef = useRef<number>(0);
  const activeContractRef = useRef<{ id: string; symbol: string; isRecovery: boolean; stake: number; step: number } | null>(null);

  // Check initial trade condition for a specific market
  const checkInitialCondition = useCallback((digits: number[]): { shouldTrade: boolean; type: 'OVER' | 'UNDER'; barrier: string; condition: string } => {
    switch (initialTradeType) {
      case 'over1_under8': {
        const lastTwo = digits.slice(-2);
        if (lastTwo.length < 2) return { shouldTrade: false, type: 'OVER', barrier: '1', condition: '' };
        
        const allLessThan1 = lastTwo.every(d => d < 1);
        const allGreaterThan8 = lastTwo.every(d => d > 8);
        
        if (allLessThan1) {
          return { shouldTrade: true, type: 'OVER', barrier: '1', condition: `Last 2 digits [${lastTwo.join(',')}] < 1 → OVER 1` };
        }
        if (allGreaterThan8) {
          return { shouldTrade: true, type: 'UNDER', barrier: '8', condition: `Last 2 digits [${lastTwo.join(',')}] > 8 → UNDER 8` };
        }
        break;
      }
      
      case 'over2_under7': {
        const lastThree = digits.slice(-3);
        if (lastThree.length < 3) return { shouldTrade: false, type: 'OVER', barrier: '2', condition: '' };
        
        const allLessThan2 = lastThree.every(d => d < 2);
        const allGreaterThan7 = lastThree.every(d => d > 7);
        
        if (allLessThan2) {
          return { shouldTrade: true, type: 'OVER', barrier: '2', condition: `Last 3 digits [${lastThree.join(',')}] < 2 → OVER 2` };
        }
        if (allGreaterThan7) {
          return { shouldTrade: true, type: 'UNDER', barrier: '7', condition: `Last 3 digits [${lastThree.join(',')}] > 7 → UNDER 7` };
        }
        break;
      }
      
      case 'over3_under6': {
        const lastFour = digits.slice(-4);
        if (lastFour.length < 4) return { shouldTrade: false, type: 'OVER', barrier: '3', condition: '' };
        
        const allLessThan3 = lastFour.every(d => d < 3);
        const allGreaterThan6 = lastFour.every(d => d > 6);
        
        if (allLessThan3) {
          return { shouldTrade: true, type: 'OVER', barrier: '3', condition: `Last 4 digits [${lastFour.join(',')}] < 3 → OVER 3` };
        }
        if (allGreaterThan6) {
          return { shouldTrade: true, type: 'UNDER', barrier: '6', condition: `Last 4 digits [${lastFour.join(',')}] > 6 → UNDER 6` };
        }
        break;
      }
    }
    
    return { shouldTrade: false, type: 'OVER', barrier: '1', condition: '' };
  }, [initialTradeType]);

  // Check recovery condition for a specific market
  const checkRecoveryCondition = useCallback((digits: number[]): { shouldTrade: boolean; contractType: string; barrier?: string; condition: string } => {
    switch (recoveryType) {
      case 'even_odd_7': {
        const lastSeven = digits.slice(-7);
        if (lastSeven.length < 7) return { shouldTrade: false, contractType: 'DIGITEVEN', condition: '' };
        
        const allOdd = lastSeven.every(d => d % 2 !== 0);
        const allEven = lastSeven.every(d => d % 2 === 0);
        
        if (allOdd) {
          return { shouldTrade: true, contractType: 'DIGITEVEN', condition: `Last 7 digits [${lastSeven.join(',')}] all ODD → Trade EVEN` };
        }
        if (allEven) {
          return { shouldTrade: true, contractType: 'DIGITODD', condition: `Last 7 digits [${lastSeven.join(',')}] all EVEN → Trade ODD` };
        }
        break;
      }
      
      case 'even_odd_6': {
        const lastSix = digits.slice(-6);
        if (lastSix.length < 6) return { shouldTrade: false, contractType: 'DIGITEVEN', condition: '' };
        
        const allOdd = lastSix.every(d => d % 2 !== 0);
        const allEven = lastSix.every(d => d % 2 === 0);
        
        if (allOdd) {
          return { shouldTrade: true, contractType: 'DIGITEVEN', condition: `Last 6 digits [${lastSix.join(',')}] all ODD → Trade EVEN` };
        }
        if (allEven) {
          return { shouldTrade: true, contractType: 'DIGITODD', condition: `Last 6 digits [${lastSix.join(',')}] all EVEN → Trade ODD` };
        }
        break;
      }
      
      case 'over4_under5_7': {
        const lastSeven = digits.slice(-7);
        if (lastSeven.length < 7) return { shouldTrade: false, contractType: 'DIGITOVER', barrier: '4', condition: '' };
        
        const allLessThan4 = lastSeven.every(d => d < 4);
        const allGreaterThan5 = lastSeven.every(d => d > 5);
        
        if (allLessThan4) {
          return { shouldTrade: true, contractType: 'DIGITOVER', barrier: '4', condition: `Last 7 digits [${lastSeven.join(',')}] < 4 → OVER 4` };
        }
        if (allGreaterThan5) {
          return { shouldTrade: true, contractType: 'DIGITUNDER', barrier: '5', condition: `Last 7 digits [${lastSeven.join(',')}] > 5 → UNDER 5` };
        }
        break;
      }
      
      case 'over4_under5_6': {
        const lastSix = digits.slice(-6);
        if (lastSix.length < 6) return { shouldTrade: false, contractType: 'DIGITOVER', barrier: '4', condition: '' };
        
        const allLessThan4 = lastSix.every(d => d < 4);
        const allGreaterThan5 = lastSix.every(d => d > 5);
        
        if (allLessThan4) {
          return { shouldTrade: true, contractType: 'DIGITOVER', barrier: '4', condition: `Last 6 digits [${lastSix.join(',')}] < 4 → OVER 4` };
        }
        if (allGreaterThan5) {
          return { shouldTrade: true, contractType: 'DIGITUNDER', barrier: '5', condition: `Last 6 digits [${lastSix.join(',')}] > 5 → UNDER 5` };
        }
        break;
      }
    }
    
    return { shouldTrade: false, contractType: 'DIGITEVEN', condition: '' };
  }, [recoveryType]);

  // Execute trade on a specific market
  const executeTrade = useCallback(async (symbol: string, digits: number[], isRecovery: boolean, step: number, stakeAmount: number) => {
    const tradeId = (++tradeIdRef.current).toString();
    const now = new Date().toLocaleTimeString();
    
    let contractType = 'DIGITOVER';
    let barrier = '1';
    let tradeType = '';
    let conditionText = '';
    
    if (!isRecovery) {
      const condition = checkInitialCondition(digits);
      if (!condition.shouldTrade) return null;
      contractType = condition.type === 'OVER' ? 'DIGITOVER' : 'DIGITUNDER';
      barrier = condition.barrier;
      tradeType = `${condition.type} ${barrier}`;
      conditionText = condition.condition;
    } else {
      const condition = checkRecoveryCondition(digits);
      if (!condition.shouldTrade) return null;
      contractType = condition.contractType;
      barrier = condition.barrier || '4';
      tradeType = contractType.replace('DIGIT', '') + (condition.barrier ? ` ${condition.barrier}` : '');
      conditionText = condition.condition;
    }

    const newTrade: Trade = {
      id: tradeId,
      time: now,
      symbol,
      type: tradeType,
      stake: stakeAmount,
      entryPrice: 0,
      profit: 0,
      status: 'pending',
      isRecovery,
      step,
    };
    setTrades(prev => [newTrade, ...prev].slice(0, 100));

    try {
      const buyParams: any = {
        contract_type: contractType,
        symbol: symbol,
        duration: 1,
        duration_unit: 't',
        basis: 'stake',
        amount: stakeAmount,
      };
      if (contractType === 'DIGITOVER' || contractType === 'DIGITUNDER' || contractType === 'DIGITMATCH' || contractType === 'DIGITDIFF') {
        buyParams.barrier = barrier;
      }

      const buyResult = await derivApi.buyContract(buyParams);
      const contractId = buyResult.contractId;
      
      activeContractRef.current = {
        id: contractId,
        symbol,
        isRecovery,
        stake: stakeAmount,
        step
      };
      
      toast.info(`📊 Trade placed on ${symbol}: ${conditionText}`);
      
      // Wait for contract result with proper subscription
      const result = await new Promise<any>((resolve) => {
        const unsub = derivApi.onMessage((data: any) => {
          // Check for contract settlement
          if (data.contract && data.contract.id === contractId && data.contract.status === 'settled') {
            unsub();
            resolve(data.contract);
          }
          // Also check proposal_open_contract updates
          if (data.proposal_open_contract && data.proposal_open_contract.id === contractId && data.proposal_open_contract.status === 'settled') {
            unsub();
            resolve(data.proposal_open_contract);
          }
        });
        
        // Subscribe to contract updates
        derivApi.subscribeToContract(contractId);
        
        // Timeout after 30 seconds
        setTimeout(() => {
          unsub();
          resolve(null);
        }, 30000);
      });
      
      activeContractRef.current = null;
      
      if (!result) {
        throw new Error('Contract timeout - no result received');
      }
      
      const won = result.profit > 0;
      const pnl = result.profit;
      const entryPrice = result.entry_tick || result.buy_price || 0;
      const exitPrice = result.exit_tick || result.sell_price || 0;
      const entryTick = result.entry_tick;
      const exitTick = result.exit_tick;
      
      // Update trade record
      setTrades(prev => prev.map(t => 
        t.id === tradeId ? {
          ...t,
          entryPrice,
          exitPrice,
          entryTick,
          exitTick,
          profit: pnl,
          status: won ? 'won' : 'lost',
        } : t
      ));
      
      console.log(`Trade result on ${symbol}: ${won ? 'WIN' : 'LOSS'} | Profit: $${pnl.toFixed(2)} | Entry: ${entryTick} | Exit: ${exitTick}`);
      
      return { won, pnl, contractId, entryTick, exitTick };
      
    } catch (error: any) {
      console.error('Trade error:', error);
      setTrades(prev => prev.map(t => 
        t.id === tradeId ? { ...t, status: 'lost', profit: -stakeAmount } : t
      ));
      toast.error(`Trade failed on ${symbol}: ${error.message}`);
      return null;
    }
  }, [checkInitialCondition, checkRecoveryCondition]);

  // Process tick data and check for trade opportunities
  const processTick = useCallback(async (symbol: string, price: number, digit: number) => {
    if (!runningRef.current) return;
    
    // Update market data
    setMarketData(prev => {
      const newMap = new Map(prev);
      const existing = newMap.get(symbol) || { symbol, digits: [], lastPrice: 0, lastUpdate: 0 };
      existing.digits.push(digit);
      if (existing.digits.length > 50) existing.digits.shift();
      existing.lastPrice = price;
      existing.lastUpdate = Date.now();
      newMap.set(symbol, existing);
      return newMap;
    });
    
    // Get current digits for this market
    const market = marketData.get(symbol);
    const currentDigits = market?.digits || [digit];
    const updatedDigits = [...currentDigits, digit].slice(-50);
    
    // Check if we should trade on this market
    let shouldTrade = false;
    let conditionText = '';
    
    if (!isRecoveryMode) {
      const condition = checkInitialCondition(updatedDigits);
      shouldTrade = condition.shouldTrade;
      conditionText = condition.condition;
    } else {
      const condition = checkRecoveryCondition(updatedDigits);
      shouldTrade = condition.shouldTrade;
      conditionText = condition.condition;
    }
    
    if (shouldTrade && !activeContractRef.current) {
      // Rate limiting - prevent multiple trades too quickly
      const now = Date.now();
      if (now - lastTradeTimeRef.current < 1000) return;
      lastTradeTimeRef.current = now;
      
      setCurrentTradeSymbol(symbol);
      console.log(`🎯 Pattern detected on ${symbol}: ${conditionText}`);
      toast.info(`🎯 Pattern on ${symbol}! ${conditionText}`);
      
      const tradeStake = currentStake;
      const tradeStep = martingaleStep;
      const isRecovery = isRecoveryMode;
      
      const result = await executeTrade(symbol, updatedDigits, isRecovery, tradeStep, tradeStake);
      
      if (result) {
        if (result.won) {
          // WIN: Update stats and reset recovery/martingale
          setWins(prev => prev + 1);
          setTotalProfit(prev => prev + result.pnl);
          
          if (isRecovery) {
            // Recovery win - back to normal mode
            setIsRecoveryMode(false);
            setCurrentStake(parseFloat(stake));
            setMartingaleStep(0);
            toast.success(`✅ Recovery WIN on ${symbol}! +$${result.pnl.toFixed(2)} → Back to normal mode`);
          } else {
            setCurrentStake(parseFloat(stake));
            setMartingaleStep(0);
            toast.success(`✅ WIN on ${symbol}! +$${result.pnl.toFixed(2)}`);
          }
        } else {
          // LOSS: Update stats and switch to recovery mode with martingale
          setLosses(prev => prev + 1);
          setTotalProfit(prev => prev + result.pnl);
          
          if (activeAccount?.is_virtual) {
            recordLoss(tradeStake, symbol, 6000);
          }
          
          if (!isRecovery) {
            // Switch to recovery mode immediately
            setIsRecoveryMode(true);
            
            // Apply martingale if enabled
            if (martingaleEnabled && martingaleStep < parseInt(martingaleMaxSteps)) {
              const newStake = currentStake * parseFloat(martingaleMultiplier);
              setCurrentStake(newStake);
              setMartingaleStep(prev => prev + 1);
              toast.warning(`📈 Loss on ${symbol}! Switching to RECOVERY mode with Martingale step ${martingaleStep + 1} ($${newStake.toFixed(2)})`);
            } else {
              toast.warning(`📉 Loss on ${symbol}! Switching to RECOVERY mode`);
            }
          } else {
            // Already in recovery mode, apply martingale again if needed
            if (martingaleEnabled && martingaleStep < parseInt(martingaleMaxSteps)) {
              const newStake = currentStake * parseFloat(martingaleMultiplier);
              setCurrentStake(newStake);
              setMartingaleStep(prev => prev + 1);
              toast.warning(`📈 Recovery loss on ${symbol}! Martingale step ${martingaleStep + 1} ($${newStake.toFixed(2)})`);
            } else if (martingaleStep >= parseInt(martingaleMaxSteps)) {
              // Max steps reached, reset
              setCurrentStake(parseFloat(stake));
              setMartingaleStep(0);
              toast.warning(`⚠️ Max martingale steps reached on ${symbol}! Resetting stake`);
            }
          }
        }
        
        // Check take profit / stop loss
        const newTotalProfit = totalProfit + result.pnl;
        if (newTotalProfit >= parseFloat(takeProfit)) {
          toast.success(`🎯 Take Profit reached! +$${newTotalProfit.toFixed(2)}. Stopping bot.`);
          runningRef.current = false;
          setIsRunning(false);
        }
        
        if (newTotalProfit <= -parseFloat(stopLoss)) {
          toast.error(`🛑 Stop Loss reached! $${newTotalProfit.toFixed(2)}. Stopping bot.`);
          runningRef.current = false;
          setIsRunning(false);
        }
      }
    }
  }, [marketData, isRecoveryMode, currentStake, martingaleStep, martingaleEnabled, martingaleMultiplier, martingaleMaxSteps, stake, totalProfit, takeProfit, stopLoss, activeAccount, recordLoss, checkInitialCondition, checkRecoveryCondition, executeTrade]);

  // Subscribe to all markets
  useEffect(() => {
    if (!derivApi.isConnected) return;
    
    const handlers = new Map<string, () => void>();
    const marketDataMap = new Map<string, { digits: number[]; lastPrice: number }>();
    
    ALL_MARKETS.forEach(symbol => {
      marketDataMap.set(symbol, { digits: [], lastPrice: 0 });
      
      const handler = (data: any) => {
        if (data.tick && data.tick.symbol === symbol) {
          const price = data.tick.quote;
          const digit = getLastDigit(price);
          processTick(symbol, price, digit);
        }
      };
      
      const unsub = derivApi.onMessage(handler);
      handlers.set(symbol, unsub);
      
      derivApi.subscribeTicks(symbol, () => {}).catch(console.error);
    });
    
    return () => {
      handlers.forEach(unsub => unsub());
      ALL_MARKETS.forEach(symbol => {
        derivApi.unsubscribeTicks(symbol).catch(console.error);
      });
    };
  }, [processTick]);

  const startBot = useCallback(() => {
    if (!isAuthorized) {
      toast.error('Please authorize first');
      return;
    }
    
    const baseStake = parseFloat(stake);
    if (baseStake < 0.35) {
      toast.error('Minimum stake is $0.35');
      return;
    }
    
    setIsRunning(true);
    runningRef.current = true;
    setIsRecoveryMode(false);
    setCurrentStake(baseStake);
    setMartingaleStep(0);
    setWins(0);
    setLosses(0);
    setTotalProfit(0);
    setTrades([]);
    setCurrentTradeSymbol('');
    
    toast.success(`Bot started! Scanning ${ALL_MARKETS.length} markets...`);
    toast.info(`Initial: ${initialTradeType} | Recovery: ${recoveryType}`);
  }, [isAuthorized, stake, initialTradeType, recoveryType]);

  const stopBot = useCallback(() => {
    runningRef.current = false;
    setIsRunning(false);
    toast.info('Bot stopped');
  }, []);

  const clearLogs = useCallback(() => {
    setTrades([]);
    setWins(0);
    setLosses(0);
    setTotalProfit(0);
  }, []);

  const winRate = wins + losses > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : '0';
  const activeMarketsCount = Array.from(marketData.values()).filter(m => m.digits.length > 0).length;

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-4">
      {/* Header Card */}
      <div className="bg-gradient-to-r from-gray-900 to-gray-950 rounded-2xl p-6 border border-gray-800">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
            Auto Scanner Bot
          </h1>
          <Badge className={`px-3 py-1 text-sm ${isRunning ? 'bg-green-500/20 text-green-400 animate-pulse' : 'bg-gray-500/20 text-gray-400'}`}>
            {isRunning ? (isRecoveryMode ? '🔁 RECOVERY MODE' : '🟢 SCANNING') : '⚪ IDLE'}
          </Badge>
        </div>
        
        <div className="grid grid-cols-5 gap-4">
          <div className="text-center">
            <div className="text-xs text-gray-400">Wins</div>
            <div className="text-xl font-bold text-green-400">{wins}</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-gray-400">Losses</div>
            <div className="text-xl font-bold text-red-400">{losses}</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-gray-400">Win Rate</div>
            <div className="text-xl font-bold text-blue-400">{winRate}%</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-gray-400">P/L</div>
            <div className={`text-xl font-bold ${totalProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              ${totalProfit.toFixed(2)}
            </div>
          </div>
          <div className="text-center">
            <div className="text-xs text-gray-400">Current Stake</div>
            <div className="text-xl font-bold text-yellow-400">
              ${currentStake.toFixed(2)}
              {martingaleStep > 0 && <span className="text-xs ml-1">(M{martingaleStep})</span>}
            </div>
          </div>
        </div>
        
        {isRunning && (
          <div className="mt-3 text-center text-xs text-gray-400">
            📊 Active markets: {activeMarketsCount}/{ALL_MARKETS.length}
            {currentTradeSymbol && <span className="ml-2 text-blue-400">Last trade: {currentTradeSymbol}</span>}
          </div>
        )}
      </div>

      {/* Configuration Card */}
      <div className="bg-gray-900 rounded-2xl p-6 border border-gray-800">
        <h2 className="text-lg font-semibold mb-4">Bot Configuration</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-3">
            <label className="text-sm text-gray-400 font-medium">INITIAL TRADE TYPE</label>
            <Select value={initialTradeType} onValueChange={(v) => setInitialTradeType(v as InitialTradeType)} disabled={isRunning}>
              <SelectTrigger className="bg-gray-800 border-gray-700">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="over1_under8">Over 1 / Under 8 (last 2 digits)</SelectItem>
                <SelectItem value="over2_under7">Over 2 / Under 7 (last 3 digits)</SelectItem>
                <SelectItem value="over3_under6">Over 3 / Under 6 (last 4 digits)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <div className="space-y-3">
            <label className="text-sm text-gray-400 font-medium">RECOVERY TYPE</label>
            <Select value={recoveryType} onValueChange={(v) => setRecoveryType(v as RecoveryType)} disabled={isRunning}>
              <SelectTrigger className="bg-gray-800 border-gray-700">
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
        </div>
        
        <div className="grid grid-cols-3 gap-4 mt-6">
          <div className="space-y-2">
            <label className="text-sm text-gray-400 font-medium">STAKE ($)</label>
            <Input
              type="number"
              step="0.01"
              min="0.35"
              value={stake}
              onChange={(e) => setStake(e.target.value)}
              disabled={isRunning}
              className="bg-gray-800 border-gray-700"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm text-gray-400 font-medium">TAKE PROFIT</label>
            <Input
              type="number"
              value={takeProfit}
              onChange={(e) => setTakeProfit(e.target.value)}
              disabled={isRunning}
              className="bg-gray-800 border-gray-700"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm text-gray-400 font-medium">STOP LOSS</label>
            <Input
              type="number"
              value={stopLoss}
              onChange={(e) => setStopLoss(e.target.value)}
              disabled={isRunning}
              className="bg-gray-800 border-gray-700"
            />
          </div>
        </div>
        
        <div className="mt-6 pt-4 border-t border-gray-800 flex items-center justify-between">
          <label className="text-sm text-gray-400 font-medium">Enable Martingale</label>
          <Switch
            checked={martingaleEnabled}
            onCheckedChange={setMartingaleEnabled}
            disabled={isRunning}
          />
        </div>
        
        {martingaleEnabled && (
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs text-gray-500">Multiplier</label>
              <Input
                type="number"
                step="0.1"
                min="1.1"
                value={martingaleMultiplier}
                onChange={(e) => setMartingaleMultiplier(e.target.value)}
                disabled={isRunning}
                className="bg-gray-800 border-gray-700"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs text-gray-500">Max Steps</label>
              <Input
                type="number"
                min="1"
                max="10"
                value={martingaleMaxSteps}
                onChange={(e) => setMartingaleMaxSteps(e.target.value)}
                disabled={isRunning}
                className="bg-gray-800 border-gray-700"
              />
            </div>
          </div>
        )}
      </div>

      {/* Markets Status Card */}
      <div className="bg-gray-900 rounded-2xl p-4 border border-gray-800">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">Markets Being Scanned</h2>
          <Badge variant="outline" className="text-[10px]">
            {activeMarketsCount}/{ALL_MARKETS.length} active
          </Badge>
        </div>
        <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
          {ALL_MARKETS.map(symbol => {
            const data = marketData.get(symbol);
            const hasData = data && data.digits.length > 0;
            const lastDigit = hasData ? data.digits[data.digits.length - 1] : null;
            return (
              <Badge 
                key={symbol} 
                variant={hasData ? 'default' : 'outline'}
                className={`text-[9px] ${hasData ? 'bg-blue-500/20 text-blue-400' : 'text-gray-500'}`}
              >
                {symbol}
                {lastDigit !== null && <span className="ml-1 text-[8px]">({lastDigit})</span>}
              </Badge>
            );
          })}
        </div>
      </div>

      {/* Control Buttons */}
      <div className="grid grid-cols-2 gap-4">
        <Button
          onClick={startBot}
          disabled={isRunning || !isAuthorized}
          className="h-12 text-base font-bold bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700"
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

      {/* Trade History Card */}
      <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Trade History</h2>
          <Button variant="ghost" size="sm" onClick={clearLogs} className="text-gray-400 hover:text-red-400">
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
        
        <div className="overflow-x-auto max-h-96 overflow-y-auto">
          <table className="w-full">
            <thead className="bg-gray-800/50 sticky top-0">
              <tr className="text-xs text-gray-400">
                <th className="p-3 text-left">Time</th>
                <th className="p-3 text-left">Market</th>
                <th className="p-3 text-left">Type</th>
                <th className="p-3 text-right">Stake</th>
                <th className="p-3 text-right">Entry</th>
                <th className="p-3 text-right">Exit</th>
                <th className="p-3 text-right">P/L</th>
                <th className="p-3 text-center">Status</th>
               </tr>
            </thead>
            <tbody>
              {trades.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-gray-500">
                    No trades yet — start the bot to begin scanning
                  </td>
                </tr>
              ) : (
                trades.map((trade) => (
                  <tr key={trade.id} className="border-t border-gray-800 text-sm">
                    <td className="p-3 text-gray-400 font-mono text-xs">{trade.time}</td>
                    <td className="p-3 font-mono text-xs">{trade.symbol}</td>
                    <td className="p-3 text-xs">
                      <span className={`${trade.isRecovery ? 'text-purple-400' : 'text-blue-400'}`}>
                        {trade.type}
                        {trade.step > 0 && <span className="text-yellow-400 ml-1">(M{trade.step})</span>}
                      </span>
                    </td>
                    <td className="p-3 text-right font-mono">${trade.stake.toFixed(2)}</td>
                    <td className="p-3 text-right font-mono text-xs text-gray-500">
                      {trade.entryTick || '-'}
                    </td>
                    <td className="p-3 text-right font-mono text-xs text-gray-500">
                      {trade.exitTick || '-'}
                    </td>
                    <td className={`p-3 text-right font-mono font-bold ${trade.profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {trade.status === 'pending' ? '...' : `${trade.profit >= 0 ? '+' : ''}${trade.profit.toFixed(2)}`}
                    </td>
                    <td className="p-3 text-center">
                      <Badge className={`text-xs ${
                        trade.status === 'pending' ? 'bg-yellow-500/20 text-yellow-400' :
                        trade.status === 'won' ? 'bg-green-500/20 text-green-400' :
                        'bg-red-500/20 text-red-400'
                      }`}>
                        {trade.status === 'pending' ? '⏳' : trade.status === 'won' ? '✓ WIN' : '✗ LOSS'}
                      </Badge>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      
      {/* Stats Footer */}
      <div className="bg-gray-900/50 rounded-xl p-3 text-center text-xs text-gray-500">
        <div className="flex justify-center gap-6 flex-wrap">
          <span>📊 Win Rate: {winRate}%</span>
          <span>💰 Total P/L: ${totalProfit.toFixed(2)}</span>
          <span>🎲 Mode: {isRecoveryMode ? 'RECOVERY ACTIVE' : 'NORMAL'}</span>
          <span>⚡ Scanning {ALL_MARKETS.length} markets</span>
          {martingaleStep > 0 && <span>📈 Martingale Step: {martingaleStep}</span>}
        </div>
      </div>
    </div>
  );
}
