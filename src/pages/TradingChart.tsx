// pages/DigitBot.tsx
import { useState, useRef, useCallback, useEffect } from 'react';
import { derivApi, type MarketSymbol } from '@/services/deriv-api';
import { getLastDigit } from '@/services/analysis';
import { useAuth } from '@/contexts/AuthContext';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Play, StopCircle, Trash2, TrendingUp, TrendingDown } from 'lucide-react';

// Types
type InitialTradeType = 'over1_under8' | 'over2_under7' | 'over3_under6';
type RecoveryType = 'even_odd_7' | 'even_odd_6' | 'over4_under5_7' | 'over4_under5_6';

interface Trade {
  id: string;
  time: string;
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

interface TickData {
  digit: number;
  price: number;
  time: number;
}

// Tick Buffer
class TickBuffer {
  private ticks: TickData[] = [];
  private maxSize: number;

  constructor(maxSize: number = 50) {
    this.maxSize = maxSize;
  }

  push(digit: number, price: number, time: number): void {
    this.ticks.push({ digit, price, time });
    if (this.ticks.length > this.maxSize) {
      this.ticks.shift();
    }
  }

  getDigits(): number[] {
    return this.ticks.map(t => t.digit);
  }

  last(n: number): number[] {
    return this.ticks.slice(-n).map(t => t.digit);
  }

  lastTicks(n: number): TickData[] {
    return this.ticks.slice(-n);
  }

  length(): number {
    return this.ticks.length;
  }

  clear(): void {
    this.ticks = [];
  }
}

export default function DigitBot() {
  const { isAuthorized, balance } = useAuth();

  // Bot Configuration
  const [initialTradeType, setInitialTradeType] = useState<InitialTradeType>('over1_under8');
  const [recoveryType, setRecoveryType] = useState<RecoveryType>('even_odd_7');
  const [stake, setStake] = useState('0.5');
  const [takeProfit, setTakeProfit] = useState('5');
  const [stopLoss, setStopLoss] = useState('30');
  const [martingaleEnabled, setMartingaleEnabled] = useState(false);
  const [martingaleMultiplier, setMartingaleMultiplier] = useState('2');
  const [symbol, setSymbol] = useState<MarketSymbol>('R_100');

  // Bot State
  const [isRunning, setIsRunning] = useState(false);
  const [isRecoveryMode, setIsRecoveryMode] = useState(false);
  const [wins, setWins] = useState(0);
  const [losses, setLosses] = useState(0);
  const [totalProfit, setTotalProfit] = useState(0);
  const [currentStake, setCurrentStake] = useState(0.5);
  const [martingaleStep, setMartingaleStep] = useState(0);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [lastDigits, setLastDigits] = useState<number[]>([]);
  const [currentPrice, setCurrentPrice] = useState<number>(0);

  const runningRef = useRef(false);
  const tickBufferRef = useRef<TickBuffer>(new TickBuffer(50));
  const tradeIdRef = useRef(0);

  // Check initial trade condition based on selected type
  const checkInitialTradeCondition = useCallback((): { shouldTrade: boolean; type: 'OVER' | 'UNDER'; barrier: string } => {
    const digits = tickBufferRef.current.getDigits();
    
    switch (initialTradeType) {
      case 'over1_under8': {
        const lastTwo = tickBufferRef.current.last(2);
        if (lastTwo.length < 2) return { shouldTrade: false, type: 'OVER', barrier: '1' };
        
        const allLessThan1 = lastTwo.every(d => d < 1);
        const allGreaterThan8 = lastTwo.every(d => d > 8);
        
        if (allLessThan1) {
          return { shouldTrade: true, type: 'OVER', barrier: '1' };
        }
        if (allGreaterThan8) {
          return { shouldTrade: true, type: 'UNDER', barrier: '8' };
        }
        break;
      }
      
      case 'over2_under7': {
        const lastThree = tickBufferRef.current.last(3);
        if (lastThree.length < 3) return { shouldTrade: false, type: 'OVER', barrier: '2' };
        
        const allLessThan2 = lastThree.every(d => d < 2);
        const allGreaterThan7 = lastThree.every(d => d > 7);
        
        if (allLessThan2) {
          return { shouldTrade: true, type: 'OVER', barrier: '2' };
        }
        if (allGreaterThan7) {
          return { shouldTrade: true, type: 'UNDER', barrier: '7' };
        }
        break;
      }
      
      case 'over3_under6': {
        const lastFour = tickBufferRef.current.last(4);
        if (lastFour.length < 4) return { shouldTrade: false, type: 'OVER', barrier: '3' };
        
        const allLessThan3 = lastFour.every(d => d < 3);
        const allGreaterThan6 = lastFour.every(d => d > 6);
        
        if (allLessThan3) {
          return { shouldTrade: true, type: 'OVER', barrier: '3' };
        }
        if (allGreaterThan6) {
          return { shouldTrade: true, type: 'UNDER', barrier: '6' };
        }
        break;
      }
    }
    
    return { shouldTrade: false, type: 'OVER', barrier: '1' };
  }, [initialTradeType]);

  // Check recovery condition based on selected type
  const checkRecoveryCondition = useCallback((): { shouldTrade: boolean; contractType: string; barrier?: string } => {
    const digits = tickBufferRef.current.getDigits();
    
    switch (recoveryType) {
      case 'even_odd_7': {
        const lastSeven = tickBufferRef.current.last(7);
        if (lastSeven.length < 7) return { shouldTrade: false, contractType: 'DIGITEVEN' };
        
        const allOdd = lastSeven.every(d => d % 2 !== 0);
        const allEven = lastSeven.every(d => d % 2 === 0);
        
        if (allOdd) {
          return { shouldTrade: true, contractType: 'DIGITEVEN' };
        }
        if (allEven) {
          return { shouldTrade: true, contractType: 'DIGITODD' };
        }
        break;
      }
      
      case 'even_odd_6': {
        const lastSix = tickBufferRef.current.last(6);
        if (lastSix.length < 6) return { shouldTrade: false, contractType: 'DIGITEVEN' };
        
        const allOdd = lastSix.every(d => d % 2 !== 0);
        const allEven = lastSix.every(d => d % 2 === 0);
        
        if (allOdd) {
          return { shouldTrade: true, contractType: 'DIGITEVEN' };
        }
        if (allEven) {
          return { shouldTrade: true, contractType: 'DIGITODD' };
        }
        break;
      }
      
      case 'over4_under5_7': {
        const lastSeven = tickBufferRef.current.last(7);
        if (lastSeven.length < 7) return { shouldTrade: false, contractType: 'DIGITOVER', barrier: '4' };
        
        const allLessThan4 = lastSeven.every(d => d < 4);
        const allGreaterThan5 = lastSeven.every(d => d > 5);
        
        if (allLessThan4) {
          return { shouldTrade: true, contractType: 'DIGITOVER', barrier: '4' };
        }
        if (allGreaterThan5) {
          return { shouldTrade: true, contractType: 'DIGITUNDER', barrier: '5' };
        }
        break;
      }
      
      case 'over4_under5_6': {
        const lastSix = tickBufferRef.current.last(6);
        if (lastSix.length < 6) return { shouldTrade: false, contractType: 'DIGITOVER', barrier: '4' };
        
        const allLessThan4 = lastSix.every(d => d < 4);
        const allGreaterThan5 = lastSix.every(d => d > 5);
        
        if (allLessThan4) {
          return { shouldTrade: true, contractType: 'DIGITOVER', barrier: '4' };
        }
        if (allGreaterThan5) {
          return { shouldTrade: true, contractType: 'DIGITUNDER', barrier: '5' };
        }
        break;
      }
    }
    
    return { shouldTrade: false, contractType: 'DIGITEVEN' };
  }, [recoveryType]);

  // Execute a trade
  const executeTrade = useCallback(async (isRecovery: boolean, step: number) => {
    const tradeStake = isRecovery ? currentStake : parseFloat(stake);
    
    if (tradeStake > balance) {
      toast.error('Insufficient balance');
      runningRef.current = false;
      setIsRunning(false);
      return null;
    }

    const tradeId = (++tradeIdRef.current).toString();
    const now = new Date().toLocaleTimeString();
    
    let contractType = 'DIGITOVER';
    let barrier = '1';
    
    if (!isRecovery) {
      const condition = checkInitialTradeCondition();
      if (!condition.shouldTrade) return null;
      contractType = condition.type === 'OVER' ? 'DIGITOVER' : 'DIGITUNDER';
      barrier = condition.barrier;
    } else {
      const condition = checkRecoveryCondition();
      if (!condition.shouldTrade) return null;
      contractType = condition.contractType;
      barrier = condition.barrier || '4';
    }

    // Add pending trade to log
    const newTrade: Trade = {
      id: tradeId,
      time: now,
      type: isRecovery ? `Recovery (${contractType})` : `Initial (${contractType} ${barrier})`,
      stake: tradeStake,
      entryPrice: currentPrice,
      profit: 0,
      status: 'pending',
      isRecovery,
      step,
    };
    setTrades(prev => [newTrade, ...prev].slice(0, 50));

    try {
      // Wait for next tick before buying
      await new Promise<void>((resolve) => {
        const unsub = derivApi.onMessage((data: any) => {
          if (data.tick && data.tick.symbol === symbol) {
            unsub();
            resolve();
          }
        });
      });

      // Buy contract
      const buyParams: any = {
        contract_type: contractType,
        symbol: symbol,
        duration: 1,
        duration_unit: 't',
        basis: 'stake',
        amount: tradeStake,
      };
      if (contractType === 'DIGITOVER' || contractType === 'DIGITUNDER') {
        buyParams.barrier = barrier;
      }

      const { contractId, entry_tick, entry_tick_time } = await derivApi.buyContract(buyParams);
      
      // Wait for contract result with subscription
      const result = await new Promise<any>((resolve) => {
        const unsub = derivApi.onMessage((data: any) => {
          if (data.contract && data.contract.id === contractId && data.contract.status === 'settled') {
            unsub();
            resolve(data.contract);
          }
        });
        
        // Also listen for proposal_open_contract updates
        derivApi.subscribeToContract(contractId);
      });

      const won = result.profit > 0;
      const pnl = result.profit;
      
      // Update trade record
      setTrades(prev => prev.map(t => 
        t.id === tradeId ? {
          ...t,
          exitPrice: result.exit_tick || result.sell_price,
          exitTick: result.exit_tick,
          profit: pnl,
          status: won ? 'won' : 'lost',
        } : t
      ));

      if (won) {
        setWins(prev => prev + 1);
        setTotalProfit(prev => prev + pnl);
        
        if (isRecovery) {
          setIsRecoveryMode(false);
          setCurrentStake(parseFloat(stake));
          setMartingaleStep(0);
          toast.success(`✅ Recovery Win! +$${pnl.toFixed(2)}`);
        } else {
          toast.success(`✅ Win! +$${pnl.toFixed(2)}`);
        }
      } else {
        setLosses(prev => prev + 1);
        setTotalProfit(prev => prev + pnl);
        toast.error(`❌ Loss! $${pnl.toFixed(2)}`);
        
        if (!isRecovery) {
          // Switch to recovery mode
          setIsRecoveryMode(true);
          
          // Apply martingale if enabled
          if (martingaleEnabled && martingaleStep < 5) {
            const newStake = currentStake * parseFloat(martingaleMultiplier);
            setCurrentStake(newStake);
            setMartingaleStep(prev => prev + 1);
          }
        } else {
          // Stay in recovery, maybe increase martingale
          if (martingaleEnabled && martingaleStep < 5) {
            const newStake = currentStake * parseFloat(martingaleMultiplier);
            setCurrentStake(newStake);
            setMartingaleStep(prev => prev + 1);
          }
        }
      }
      
      // Check take profit / stop loss
      if (totalProfit + pnl >= parseFloat(takeProfit)) {
        toast.success(`🎯 Take Profit reached! Stopping bot.`);
        runningRef.current = false;
        setIsRunning(false);
      }
      
      if (totalProfit + pnl <= -parseFloat(stopLoss)) {
        toast.error(`🛑 Stop Loss reached! Stopping bot.`);
        runningRef.current = false;
        setIsRunning(false);
      }
      
      return { won, pnl };
      
    } catch (error: any) {
      console.error('Trade error:', error);
      setTrades(prev => prev.map(t => 
        t.id === tradeId ? { ...t, status: 'lost', profit: -tradeStake } : t
      ));
      toast.error(`Trade failed: ${error.message}`);
      return null;
    }
  }, [balance, stake, currentStake, martingaleEnabled, martingaleMultiplier, martingaleStep, symbol, currentPrice, totalProfit, takeProfit, stopLoss, checkInitialTradeCondition, checkRecoveryCondition]);

  // Main bot loop
  const startBot = useCallback(async () => {
    if (!isAuthorized || isRunning) return;
    
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
    
    while (runningRef.current) {
      // Check if we should trade
      let shouldTrade = false;
      let isRecovery = isRecoveryMode;
      
      if (!isRecoveryMode) {
        const condition = checkInitialTradeCondition();
        shouldTrade = condition.shouldTrade;
      } else {
        const condition = checkRecoveryCondition();
        shouldTrade = condition.shouldTrade;
      }
      
      if (shouldTrade) {
        await executeTrade(isRecoveryMode, martingaleStep);
        
        // Small delay between trades
        await new Promise(r => setTimeout(r, 500));
      } else {
        // Wait for more ticks
        await new Promise(r => setTimeout(r, 200));
      }
    }
    
    setIsRunning(false);
  }, [isAuthorized, isRunning, stake, isRecoveryMode, martingaleStep, checkInitialTradeCondition, checkRecoveryCondition, executeTrade]);

  const stopBot = useCallback(() => {
    runningRef.current = false;
    setIsRunning(false);
  }, []);

  const clearLogs = useCallback(() => {
    setTrades([]);
    setWins(0);
    setLosses(0);
    setTotalProfit(0);
  }, []);

  // Subscribe to ticks
  useEffect(() => {
    if (!derivApi.isConnected) return;
    
    const handler = (data: any) => {
      if (data.tick && data.tick.symbol === symbol) {
        const price = data.tick.quote;
        const digit = getLastDigit(price);
        const now = Date.now();
        
        tickBufferRef.current.push(digit, price, now);
        setCurrentPrice(price);
        setLastDigits(tickBufferRef.current.last(8));
      }
    };
    
    const unsub = derivApi.onMessage(handler);
    derivApi.subscribeTicks(symbol, () => {}).catch(console.error);
    
    return () => {
      unsub();
      derivApi.unsubscribeTicks(symbol);
    };
  }, [symbol]);

  const winRate = wins + losses > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : '0';
  const activeDigits = lastDigits;

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-4">
      {/* Header Card */}
      <div className="bg-gradient-to-r from-gray-900 to-gray-950 rounded-2xl p-6 border border-gray-800">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
            Deriv Digit Bot
          </h1>
          <Badge className={`px-3 py-1 text-sm ${isRunning ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'}`}>
            {isRunning ? (isRecoveryMode ? '🔁 RECOVERY MODE' : '🟢 ACTIVE') : '⚪ IDLE'}
          </Badge>
        </div>
        
        <div className="grid grid-cols-4 gap-4">
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
        </div>
      </div>

      {/* Configuration Card */}
      <div className="bg-gray-900 rounded-2xl p-6 border border-gray-800">
        <h2 className="text-lg font-semibold mb-4">Configuration</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Initial Trade Settings */}
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
          
          {/* Recovery Settings */}
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
          
          {/* Risk Settings */}
          <div className="space-y-3">
            <label className="text-sm text-gray-400 font-medium">STAKE</label>
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
          
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-3">
              <label className="text-sm text-gray-400 font-medium">TP</label>
              <Input
                type="number"
                value={takeProfit}
                onChange={(e) => setTakeProfit(e.target.value)}
                disabled={isRunning}
                className="bg-gray-800 border-gray-700"
              />
            </div>
            <div className="space-y-3">
              <label className="text-sm text-gray-400 font-medium">SL</label>
              <Input
                type="number"
                value={stopLoss}
                onChange={(e) => setStopLoss(e.target.value)}
                disabled={isRunning}
                className="bg-gray-800 border-gray-700"
              />
            </div>
          </div>
        </div>
        
        {/* Martingale */}
        <div className="mt-6 pt-4 border-t border-gray-800 flex items-center justify-between">
          <label className="text-sm text-gray-400 font-medium">Enable Martingale</label>
          <Switch
            checked={martingaleEnabled}
            onCheckedChange={setMartingaleEnabled}
            disabled={isRunning}
          />
        </div>
        
        {martingaleEnabled && (
          <div className="mt-3 grid grid-cols-2 gap-3">
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
              <label className="text-xs text-gray-500">Current Stake</label>
              <div className="bg-gray-800 rounded-lg p-2 text-center font-mono text-yellow-400">
                ${currentStake.toFixed(2)}
                {martingaleStep > 0 && <span className="text-xs ml-1">(Step {martingaleStep})</span>}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Live Digits Card */}
      <div className="bg-gray-900 rounded-2xl p-6 border border-gray-800">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Live Digits</h2>
          <span className="text-xs text-gray-500">Symbol: {symbol}</span>
        </div>
        
        <div className="flex gap-2 justify-center flex-wrap">
          {activeDigits.length === 0 ? (
            <div className="text-gray-500">Waiting for ticks...</div>
          ) : (
            activeDigits.map((digit, i) => {
              const isEven = digit % 2 === 0;
              const isOver = digit >= 5;
              const isLast = i === activeDigits.length - 1;
              return (
                <div
                  key={i}
                  className={`w-12 h-14 rounded-xl flex flex-col items-center justify-center font-mono font-bold border-2 transition-all
                    ${isLast ? 'border-blue-500 shadow-lg shadow-blue-500/20' : 'border-gray-700'}
                    ${isOver ? 'bg-red-500/10 text-red-400' : 'bg-green-500/10 text-green-400'}`}
                >
                  <span className="text-xl">{digit}</span>
                  <span className="text-[10px] opacity-60">{isEven ? 'EVEN' : 'ODD'} • {isOver ? 'OVER' : 'UNDER'}</span>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Control Buttons */}
      <div className="grid grid-cols-2 gap-4">
        <Button
          onClick={startBot}
          disabled={isRunning || !isAuthorized}
          className="h-14 text-lg font-bold bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700"
        >
          <Play className="w-5 h-5 mr-2" /> START BOT
        </Button>
        <Button
          onClick={stopBot}
          disabled={!isRunning}
          variant="destructive"
          className="h-14 text-lg font-bold"
        >
          <StopCircle className="w-5 h-5 mr-2" /> STOP
        </Button>
      </div>

      {/* Trade History Card */}
      <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Trade History</h2>
          <Button variant="ghost" size="sm" onClick={clearLogs} className="text-gray-400 hover:text-red-400">
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
        
        <div className="overflow-x-auto max-h-96 overflow-y-auto">
          <table className="w-full">
            <thead className="bg-gray-800/50 sticky top-0">
              <tr className="text-xs text-gray-400">
                <th className="p-3 text-left">Time</th>
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
                  <td colSpan={7} className="p-8 text-center text-gray-500">
                    No trades yet — configure and start the bot
                  </td>
                </tr>
              ) : (
                trades.map((trade) => (
                  <tr key={trade.id} className="border-t border-gray-800 text-sm">
                    <td className="p-3 text-gray-400">{trade.time}</td>
                    <td className="p-3 font-mono text-xs">{trade.type}</td>
                    <td className="p-3 text-right font-mono">${trade.stake.toFixed(2)}</td>
                    <td className="p-3 text-right font-mono text-gray-400">
                      {trade.entryPrice ? trade.entryPrice.toFixed(2) : '-'}
                    </td>
                    <td className="p-3 text-right font-mono text-gray-400">
                      {trade.exitPrice ? trade.exitPrice.toFixed(2) : '-'}
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
                        {trade.status === 'pending' ? '⏳' : trade.status === 'won' ? '✓' : '✗'}
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
        <div className="flex justify-center gap-6">
          <span>📊 Win Rate: {winRate}%</span>
          <span>💰 Total P/L: ${totalProfit.toFixed(2)}</span>
          <span>🎲 Last Digit Pattern: {isRecoveryMode ? 'RECOVERY ACTIVE' : 'NORMAL MODE'}</span>
        </div>
      </div>
    </div>
  );
}
