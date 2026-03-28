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
  profit: number;
  status: 'pending' | 'won' | 'lost';
  isRecovery: boolean;
  step: number;
}

interface MarketTickData {
  symbol: string;
  digits: number[];
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
  const [currentMarket, setCurrentMarket] = useState<string>('');
  const [wins, setWins] = useState(0);
  const [losses, setLosses] = useState(0);
  const [totalProfit, setTotalProfit] = useState(0);
  const [currentStake, setCurrentStake] = useState(0.5);
  const [martingaleStep, setMartingaleStep] = useState(0);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [activeMarkets, setActiveMarkets] = useState<Map<string, number[]>>(new Map());

  const runningRef = useRef(false);
  const tradeIdRef = useRef(0);
  const lastTradeTimeRef = useRef<number>(0);

  // Check initial trade condition
  const checkInitialCondition = useCallback((digits: number[]): { shouldTrade: boolean; type: 'OVER' | 'UNDER'; barrier: string } => {
    switch (initialTradeType) {
      case 'over1_under8': {
        const lastTwo = digits.slice(-2);
        if (lastTwo.length < 2) return { shouldTrade: false, type: 'OVER', barrier: '1' };
        
        const allLessThan1 = lastTwo.every(d => d < 1);
        const allGreaterThan8 = lastTwo.every(d => d > 8);
        
        if (allLessThan1) return { shouldTrade: true, type: 'OVER', barrier: '1' };
        if (allGreaterThan8) return { shouldTrade: true, type: 'UNDER', barrier: '8' };
        break;
      }
      
      case 'over2_under7': {
        const lastThree = digits.slice(-3);
        if (lastThree.length < 3) return { shouldTrade: false, type: 'OVER', barrier: '2' };
        
        const allLessThan2 = lastThree.every(d => d < 2);
        const allGreaterThan7 = lastThree.every(d => d > 7);
        
        if (allLessThan2) return { shouldTrade: true, type: 'OVER', barrier: '2' };
        if (allGreaterThan7) return { shouldTrade: true, type: 'UNDER', barrier: '7' };
        break;
      }
      
      case 'over3_under6': {
        const lastFour = digits.slice(-4);
        if (lastFour.length < 4) return { shouldTrade: false, type: 'OVER', barrier: '3' };
        
        const allLessThan3 = lastFour.every(d => d < 3);
        const allGreaterThan6 = lastFour.every(d => d > 6);
        
        if (allLessThan3) return { shouldTrade: true, type: 'OVER', barrier: '3' };
        if (allGreaterThan6) return { shouldTrade: true, type: 'UNDER', barrier: '6' };
        break;
      }
    }
    
    return { shouldTrade: false, type: 'OVER', barrier: '1' };
  }, [initialTradeType]);

  // Check recovery condition
  const checkRecoveryCondition = useCallback((digits: number[]): { shouldTrade: boolean; contractType: string; barrier?: string } => {
    switch (recoveryType) {
      case 'even_odd_7': {
        const lastSeven = digits.slice(-7);
        if (lastSeven.length < 7) return { shouldTrade: false, contractType: 'DIGITEVEN' };
        
        const allOdd = lastSeven.every(d => d % 2 !== 0);
        const allEven = lastSeven.every(d => d % 2 === 0);
        
        if (allOdd) return { shouldTrade: true, contractType: 'DIGITEVEN' };
        if (allEven) return { shouldTrade: true, contractType: 'DIGITODD' };
        break;
      }
      
      case 'even_odd_6': {
        const lastSix = digits.slice(-6);
        if (lastSix.length < 6) return { shouldTrade: false, contractType: 'DIGITEVEN' };
        
        const allOdd = lastSix.every(d => d % 2 !== 0);
        const allEven = lastSix.every(d => d % 2 === 0);
        
        if (allOdd) return { shouldTrade: true, contractType: 'DIGITEVEN' };
        if (allEven) return { shouldTrade: true, contractType: 'DIGITODD' };
        break;
      }
      
      case 'over4_under5_7': {
        const lastSeven = digits.slice(-7);
        if (lastSeven.length < 7) return { shouldTrade: false, contractType: 'DIGITOVER', barrier: '4' };
        
        const allLessThan4 = lastSeven.every(d => d < 4);
        const allGreaterThan5 = lastSeven.every(d => d > 5);
        
        if (allLessThan4) return { shouldTrade: true, contractType: 'DIGITOVER', barrier: '4' };
        if (allGreaterThan5) return { shouldTrade: true, contractType: 'DIGITUNDER', barrier: '5' };
        break;
      }
      
      case 'over4_under5_6': {
        const lastSix = digits.slice(-6);
        if (lastSix.length < 6) return { shouldTrade: false, contractType: 'DIGITOVER', barrier: '4' };
        
        const allLessThan4 = lastSix.every(d => d < 4);
        const allGreaterThan5 = lastSix.every(d => d > 5);
        
        if (allLessThan4) return { shouldTrade: true, contractType: 'DIGITOVER', barrier: '4' };
        if (allGreaterThan5) return { shouldTrade: true, contractType: 'DIGITUNDER', barrier: '5' };
        break;
      }
    }
    
    return { shouldTrade: false, contractType: 'DIGITEVEN' };
  }, [recoveryType]);

  // Execute trade on a specific market
  const executeTrade = useCallback(async (symbol: string, digits: number[], isRecovery: boolean, step: number) => {
    const tradeStake = currentStake;
    
    if (tradeStake > balance) {
      toast.error('Insufficient balance');
      return null;
    }

    const tradeId = (++tradeIdRef.current).toString();
    const now = new Date().toLocaleTimeString();
    
    let contractType = 'DIGITOVER';
    let barrier = '1';
    let tradeType = '';
    
    if (!isRecovery) {
      const condition = checkInitialCondition(digits);
      if (!condition.shouldTrade) return null;
      contractType = condition.type === 'OVER' ? 'DIGITOVER' : 'DIGITUNDER';
      barrier = condition.barrier;
      tradeType = `${condition.type} ${barrier}`;
    } else {
      const condition = checkRecoveryCondition(digits);
      if (!condition.shouldTrade) return null;
      contractType = condition.contractType;
      barrier = condition.barrier || '4';
      tradeType = contractType.replace('DIGIT', '') + (condition.barrier ? ` ${condition.barrier}` : '');
    }

    const newTrade: Trade = {
      id: tradeId,
      time: now,
      symbol,
      type: tradeType,
      stake: tradeStake,
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
        amount: tradeStake,
      };
      if (needsBarrier(contractType)) buyParams.barrier = barrier;

      const { contractId, entry_tick, entry_tick_time } = await derivApi.buyContract(buyParams);
      
      const result = await new Promise<any>((resolve) => {
        const unsub = derivApi.onMessage((data: any) => {
          if (data.contract && data.contract.id === contractId && data.contract.status === 'settled') {
            unsub();
            resolve(data.contract);
          }
        });
        derivApi.subscribeToContract(contractId);
      });

      const won = result.profit > 0;
      const pnl = result.profit;
      
      setTrades(prev => prev.map(t => 
        t.id === tradeId ? {
          ...t,
          exitPrice: result.exit_tick || result.sell_price,
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
          toast.success(`✅ Recovery Win on ${symbol}! +$${pnl.toFixed(2)}`);
        } else {
          toast.success(`✅ Win on ${symbol}! +$${pnl.toFixed(2)}`);
        }
      } else {
        setLosses(prev => prev + 1);
        setTotalProfit(prev => prev + pnl);
        toast.error(`❌ Loss on ${symbol}! $${pnl.toFixed(2)}`);
        
        if (!isRecovery) {
          setIsRecoveryMode(true);
          
          if (martingaleEnabled && martingaleStep < parseInt(martingaleMaxSteps)) {
            const newStake = currentStake * parseFloat(martingaleMultiplier);
            setCurrentStake(newStake);
            setMartingaleStep(prev => prev + 1);
          }
        } else {
          if (martingaleEnabled && martingaleStep < parseInt(martingaleMaxSteps)) {
            const newStake = currentStake * parseFloat(martingaleMultiplier);
            setCurrentStake(newStake);
            setMartingaleStep(prev => prev + 1);
          }
        }
      }
      
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
      toast.error(`Trade failed on ${symbol}: ${error.message}`);
      return null;
    }
  }, [balance, currentStake, martingaleEnabled, martingaleMultiplier, martingaleMaxSteps, martingaleStep, totalProfit, takeProfit, stopLoss, stake, checkInitialCondition, checkRecoveryCondition]);

  // Process tick data and check for trade opportunities
  const processTick = useCallback(async (symbol: string, digit: number) => {
    if (!runningRef.current) return;
    
    // Update market data
    setActiveMarkets(prev => {
      const newMap = new Map(prev);
      const digits = newMap.get(symbol) || [];
      digits.push(digit);
      if (digits.length > 50) digits.shift();
      newMap.set(symbol, digits);
      return newMap;
    });
    
    const marketDigits = activeMarkets.get(symbol) || [digit];
    const updatedDigits = [...marketDigits, digit].slice(-50);
    
    // Check if we should trade on this market
    let shouldTrade = false;
    let tradeType = '';
    
    if (!isRecoveryMode) {
      const condition = checkInitialCondition(updatedDigits);
      shouldTrade = condition.shouldTrade;
      tradeType = `INITIAL: ${condition.type} ${condition.barrier}`;
    } else {
      const condition = checkRecoveryCondition(updatedDigits);
      shouldTrade = condition.shouldTrade;
      tradeType = `RECOVERY: ${condition.contractType}`;
    }
    
    if (shouldTrade) {
      // Rate limiting - prevent too many trades
      const now = Date.now();
      if (now - lastTradeTimeRef.current < 1000) return;
      lastTradeTimeRef.current = now;
      
      setCurrentMarket(symbol);
      toast.info(`🎯 Pattern detected on ${symbol}! ${tradeType}`);
      
      await executeTrade(symbol, updatedDigits, isRecoveryMode, martingaleStep);
    }
  }, [activeMarkets, isRecoveryMode, checkInitialCondition, checkRecoveryCondition, executeTrade, martingaleStep]);

  // Subscribe to all markets
  useEffect(() => {
    if (!derivApi.isConnected) return;
    
    const handlers = new Map<string, () => void>();
    
    ALL_MARKETS.forEach(symbol => {
      const handler = (data: any) => {
        if (data.tick && data.tick.symbol === symbol) {
          const digit = getLastDigit(data.tick.quote);
          processTick(symbol, digit);
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
    
    toast.success('Bot started! Scanning all markets...');
  }, [isAuthorized, stake]);

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
              {martingaleStep > 0 && <span className="text-xs ml-1">(x{martingaleStep})</span>}
            </div>
          </div>
        </div>
        
        {isRunning && currentMarket && (
          <div className="mt-3 text-center text-xs text-gray-400">
            Last trade on: <span className="text-blue-400 font-mono">{currentMarket}</span>
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
            {ALL_MARKETS.length} markets active
          </Badge>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {ALL_MARKETS.map(symbol => {
            const digits = activeMarkets.get(symbol) || [];
            const hasData = digits.length > 0;
            return (
              <Badge 
                key={symbol} 
                variant={hasData ? 'default' : 'outline'}
                className={`text-[9px] ${hasData ? 'bg-blue-500/20 text-blue-400' : 'text-gray-500'}`}
              >
                {symbol}
                {hasData && <span className="ml-1 text-[8px]">({digits.length})</span>}
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
                <th className="p-3 text-right">P/L</th>
                <th className="p-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {trades.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-gray-500">
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
                      </span>
                    </td>
                    <td className="p-3 text-right font-mono">${trade.stake.toFixed(2)}</td>
                    <td className={`p-3 text-right font-mono font-bold ${trade.profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {trade.status === 'pending' ? '...' : `${trade.profit >= 0 ? '+' : ''}${trade.profit.toFixed(2)}`}
                    </td>
                    <td className="p-3 text-center">
                      <Badge className={`text-xs ${
                        trade.status === 'pending' ? 'bg-yellow-500/20 text-yellow-400' :
                        trade.status === 'won' ? 'bg-green-500/20 text-green-400' :
                        'bg-red-500/20 text-red-400'
                      }`}>
                        {trade.status === 'pending' ? '⏳' : trade.status === 'won' ? '✓ WON' : '✗ LOST'}
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
          <span>🎲 Mode: {isRecoveryMode ? 'RECOVERY ACTIVE' : 'NORMAL'}</span>
          <span>⚡ Scanning {ALL_MARKETS.length} markets</span>
        </div>
      </div>
    </div>
  );
}

// Helper function
function needsBarrier(contractType: string): boolean {
  return ['DIGITMATCH', 'DIGITDIFF', 'DIGITOVER', 'DIGITUNDER'].includes(contractType);
}
