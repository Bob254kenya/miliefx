import { useState, useRef, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { derivApi } from '@/services/deriv-api';
import { useAuth } from '@/contexts/AuthContext';
import { useTickLoader } from '@/hooks/useTickLoader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Play, StopCircle, Pause, TrendingUp, TrendingDown, CircleDot, RefreshCw, Trash2 } from 'lucide-react';

interface MarketAnalysis {
  symbol: string;
  mostAppearing: number;
  secondMost: number;
  leastAppearing: number;
  evenCount: number;
  oddCount: number;
  over3Count: number;
  under6Count: number;
  over8Count: number;
  under3Count: number;
}

interface BotState {
  id: string;
  name: string;
  type: 'over3' | 'under6' | 'even' | 'odd' | 'over1' | 'under8';
  isRunning: boolean;
  isPaused: boolean;
  currentStake: number;
  totalPnl: number;
  trades: number;
  wins: number;
  losses: number;
  contractType: string;
  barrier?: number;
  selectedMarket?: string;
  status: 'idle' | 'waiting' | 'trading' | 'cooldown';
  consecutiveLosses: number;
  entryTriggered: boolean;
  cooldownRemaining: number;
  lastTradeResult?: 'win' | 'loss';
  recoveryMode: boolean;
}

interface TradeLog {
  id: number;
  time: string;
  market: string;
  contract: string;
  stake: number;
  result: 'Pending' | 'Win' | 'Loss';
  pnl: number;
  bot: string;
  lastDigit?: number;
}

const VOLATILITY_MARKETS = [
  'R_10', 'R_25', 'R_50', 'R_75', 'R_100',
  '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V',
  'BOOM300', 'BOOM500', 'BOOM1000',
  'CRASH300', 'CRASH500', 'CRASH1000',
  'RDBEAR', 'RDBULL', 'JD10', 'JD25', 'JD50', 'JD75', 'JD100'
];

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

// Market analysis functions
const analyzeMarket = (digits: number[]): MarketAnalysis => {
  if (digits.length < 700) return {} as MarketAnalysis;
  
  const last700 = digits.slice(-700);
  const counts: Record<number, number> = {};
  for (let i = 0; i <= 9; i++) counts[i] = 0;
  last700.forEach(d => counts[d]++);
  
  const sortedDigits = [...Array(10).keys()].sort((a, b) => counts[b] - counts[a]);
  
  const evenDigits = [0,2,4,6,8];
  const oddDigits = [1,3,5,7,9];
  const evenCount = evenDigits.reduce((sum, d) => sum + counts[d], 0);
  const oddCount = oddDigits.reduce((sum, d) => sum + counts[d], 0);
  
  const over3Count = [4,5,6,7,8,9].reduce((sum, d) => sum + counts[d], 0);
  const under6Count = [0,1,2,3,4,5].reduce((sum, d) => sum + counts[d], 0);
  const over8Count = [9].reduce((sum, d) => sum + counts[d], 0);
  const under3Count = [0,1,2].reduce((sum, d) => sum + counts[d], 0);
  
  return {
    symbol: '',
    mostAppearing: sortedDigits[0],
    secondMost: sortedDigits[1],
    leastAppearing: sortedDigits[9],
    evenCount,
    oddCount,
    over3Count,
    under6Count,
    over8Count,
    under3Count
  };
};

// Entry condition checks
const checkOver3Entry = (digits: number[]): boolean => {
  if (digits.length < 2) return false;
  const lastTwo = digits.slice(-2);
  return lastTwo.every(d => d <= 3);
};

const checkUnder6Entry = (digits: number[]): boolean => {
  if (digits.length < 2) return false;
  const lastTwo = digits.slice(-2);
  return lastTwo.every(d => d >= 6);
};

const checkOver1Entry = (digits: number[]): boolean => {
  if (digits.length < 2) return false;
  const lastTwo = digits.slice(-2);
  return lastTwo.every(d => d <= 1);
};

const checkUnder8Entry = (digits: number[]): boolean => {
  if (digits.length < 2) return false;
  const lastTwo = digits.slice(-2);
  return lastTwo.every(d => d >= 8);
};

const checkEvenEntry = (digits: number[]): boolean => {
  if (digits.length < 3) return false;
  const lastThree = digits.slice(-3);
  return lastThree.every(d => d % 2 === 1);
};

const checkOddEntry = (digits: number[]): boolean => {
  if (digits.length < 3) return false;
  const lastThree = digits.slice(-3);
  return lastThree.every(d => d % 2 === 0);
};

export default function AutoTrade() {
  const { isAuthorized, activeAccount, balance } = useAuth();
  const [activeTradeId, setActiveTradeId] = useState<string | null>(null);
  const [selectedMarket, setSelectedMarket] = useState<string>('R_100');
  const [marketAnalysis, setMarketAnalysis] = useState<Record<string, MarketAnalysis>>({});
  const [isScanning, setIsScanning] = useState(false);
  const [globalStake, setGlobalStake] = useState<number>(0.5);
  const [globalMultiplier, setGlobalMultiplier] = useState<number>(2);
  const [globalStopLoss, setGlobalStopLoss] = useState<number>(30);
  const [globalTakeProfit, setGlobalTakeProfit] = useState<number>(5);
  
  const [trades, setTrades] = useState<TradeLog[]>([]);
  const tradeIdRef = useRef(0);
  const marketDigitsRef = useRef<Record<string, number[]>>({});

  const { digits, prices, isLoading, tickCount } = useTickLoader(selectedMarket, 1000);

  // Update market digits
  useEffect(() => {
    if (digits.length > 0) {
      marketDigitsRef.current[selectedMarket] = digits;
    }
  }, [digits, selectedMarket]);

  // Six bots
  const [bots, setBots] = useState<BotState[]>([
    { 
      id: 'bot1', name: 'OVER 3 BOT', type: 'over3', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, contractType: 'DIGITOVER', barrier: 3,
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, cooldownRemaining: 0, recoveryMode: false
    },
    { 
      id: 'bot2', name: 'UNDER 6 BOT', type: 'under6', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, contractType: 'DIGITUNDER', barrier: 6,
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, cooldownRemaining: 0, recoveryMode: false
    },
    { 
      id: 'bot3', name: 'EVEN BOT', type: 'even', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, contractType: 'DIGITEVEN',
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, cooldownRemaining: 0, recoveryMode: false
    },
    { 
      id: 'bot4', name: 'ODD BOT', type: 'odd', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, contractType: 'DIGITODD',
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, cooldownRemaining: 0, recoveryMode: false
    },
    { 
      id: 'bot5', name: 'OVER 1 BOT', type: 'over1', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, contractType: 'DIGITOVER', barrier: 1,
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, cooldownRemaining: 0, recoveryMode: false
    },
    { 
      id: 'bot6', name: 'UNDER 8 BOT', type: 'under8', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, contractType: 'DIGITUNDER', barrier: 8,
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, cooldownRemaining: 0, recoveryMode: false
    },
  ]);

  const botRunningRefs = useRef<Record<string, boolean>>({});
  const botPausedRefs = useRef<Record<string, boolean>>({});

  // Scan market
  const scanMarket = useCallback(async () => {
    if (isScanning) return;
    
    setIsScanning(true);
    
    try {
      const analysis: Record<string, MarketAnalysis> = {};
      
      for (const market of VOLATILITY_MARKETS) {
        const marketDigits = marketDigitsRef.current[market] || [];
        if (marketDigits.length >= 700) {
          analysis[market] = analyzeMarket(marketDigits);
          analysis[market].symbol = market;
        }
      }
      
      setMarketAnalysis(analysis);
      
      // Auto-select markets for bots based on conditions
      setBots(prev => prev.map(bot => {
        let selectedMarket: string | null = null;
        
        switch (bot.type) {
          case 'over3':
            // Find market where most appearing > 3
            for (const [sym, data] of Object.entries(analysis)) {
              if (data.mostAppearing > 3 && data.secondMost > 3) {
                selectedMarket = sym;
                break;
              }
            }
            break;
          case 'under6':
            // Find market where most appearing < 6
            for (const [sym, data] of Object.entries(analysis)) {
              if (data.mostAppearing < 6 && data.secondMost < 6) {
                selectedMarket = sym;
                break;
              }
            }
            break;
          case 'even':
            // Find market where even count dominates
            for (const [sym, data] of Object.entries(analysis)) {
              if (data.evenCount >= 400) {
                selectedMarket = sym;
                break;
              }
            }
            break;
          case 'odd':
            // Find market where odd count dominates
            for (const [sym, data] of Object.entries(analysis)) {
              if (data.oddCount >= 400) {
                selectedMarket = sym;
                break;
              }
            }
            break;
          case 'over1':
            // Find market with strong over 1 potential
            for (const [sym, data] of Object.entries(analysis)) {
              if (data.over3Count > 350) {
                selectedMarket = sym;
                break;
              }
            }
            break;
          case 'under8':
            // Find market with strong under 8 potential
            for (const [sym, data] of Object.entries(analysis)) {
              if (data.under6Count > 350) {
                selectedMarket = sym;
                break;
              }
            }
            break;
        }
        
        return { ...bot, selectedMarket: selectedMarket || bot.selectedMarket };
      }));
      
      toast.success('Market scan complete');
    } catch (error) {
      console.error('Scan error:', error);
      toast.error('Scan failed');
    } finally {
      setIsScanning(false);
    }
  }, [isScanning]);

  // Clear all data
  const clearAll = () => {
    setTrades([]);
    setBots(prev => prev.map(bot => ({
      ...bot,
      totalPnl: 0,
      trades: 0,
      wins: 0,
      losses: 0,
      currentStake: globalStake,
      status: 'idle',
      consecutiveLosses: 0,
      entryTriggered: false,
      cooldownRemaining: 0,
      recoveryMode: false
    })));
    tradeIdRef.current = 0;
    toast.success('All data cleared');
  };

  // Trading loop
  const runBot = useCallback(async (botId: string) => {
    const bot = bots.find(b => b.id === botId);
    if (!bot || !isAuthorized) return;

    if (balance < globalStake) {
      toast.error(`Insufficient balance for ${bot.name}`);
      stopBot(botId);
      return;
    }

    if (!bot.selectedMarket) {
      toast.error(`${bot.name}: No market selected. Scan first.`);
      return;
    }

    setBots(prev => prev.map(b => b.id === botId ? { 
      ...b, 
      isRunning: true, 
      isPaused: false, 
      currentStake: globalStake,
      status: 'waiting'
    } : b));
    
    botRunningRefs.current[botId] = true;
    botPausedRefs.current[botId] = false;

    let stake = globalStake;
    let totalPnl = bot.totalPnl;
    let tradeCount = bot.trades;
    let wins = bot.wins;
    let losses = bot.losses;
    let consecutiveLosses = 0;
    let entryTriggered = false;
    let cooldownRemaining = 0;
    let recoveryMode = false;

    const currentMarket = bot.selectedMarket;

    while (botRunningRefs.current[botId]) {
      if (botPausedRefs.current[botId]) {
        await new Promise(r => setTimeout(r, 500));
        continue;
      }

      // Check stop loss / take profit
      if (totalPnl <= -globalStopLoss) {
        toast.error(`${bot.name}: Stop Loss! $${totalPnl.toFixed(2)}`);
        break;
      }
      if (totalPnl >= globalTakeProfit) {
        toast.success(`${bot.name}: Take Profit! +$${totalPnl.toFixed(2)}`);
        break;
      }

      // Handle cooldown
      if (cooldownRemaining > 0) {
        setBots(prev => prev.map(b => b.id === botId ? { 
          ...b, 
          status: 'cooldown',
          cooldownRemaining 
        } : b));
        await new Promise(r => setTimeout(r, 1000));
        cooldownRemaining--;
        continue;
      }

      // Get current market digits
      const marketDigits = marketDigitsRef.current[currentMarket] || [];
      const lastDigit = marketDigits.length > 0 ? marketDigits[marketDigits.length - 1] : undefined;

      // Entry condition check
      let entryCondition = false;
      if (!entryTriggered && !recoveryMode) {
        switch (bot.type) {
          case 'over3': entryCondition = checkOver3Entry(marketDigits); break;
          case 'under6': entryCondition = checkUnder6Entry(marketDigits); break;
          case 'even': entryCondition = checkEvenEntry(marketDigits); break;
          case 'odd': entryCondition = checkOddEntry(marketDigits); break;
          case 'over1': entryCondition = checkOver1Entry(marketDigits); break;
          case 'under8': entryCondition = checkUnder8Entry(marketDigits); break;
        }
      }

      if (!entryTriggered && !recoveryMode) {
        setBots(prev => prev.map(b => b.id === botId ? { ...b, status: 'waiting' } : b));
        if (!entryCondition) {
          await new Promise(r => setTimeout(r, 500));
          continue;
        } else {
          entryTriggered = true;
          setBots(prev => prev.map(b => b.id === botId ? { ...b, status: 'trading' } : b));
        }
      }

      try {
        await waitForNextTick(currentMarket);

        if (activeTradeId) {
          await new Promise(r => setTimeout(r, 500));
          continue;
        }

        const params: any = {
          contract_type: bot.contractType,
          symbol: currentMarket,
          duration: 1,
          duration_unit: 't',
          basis: 'stake',
          amount: stake,
        };

        if (bot.barrier !== undefined) {
          params.barrier = bot.barrier.toString();
        }

        const id = ++tradeIdRef.current;
        const now = new Date().toLocaleTimeString();
        const tradeId = `${botId}-${id}`;
        setActiveTradeId(tradeId);

        setTrades(prev => [{
          id,
          time: now,
          market: currentMarket,
          contract: bot.contractType,
          stake,
          result: 'Pending',
          pnl: 0,
          bot: bot.name,
          lastDigit
        }, ...prev].slice(0, 100));

        const { contractId } = await derivApi.buyContract(params);
        const result = await derivApi.waitForContractResult(contractId);
        const won = result.status === 'won';
        const pnl = result.profit;

        setTrades(prev => prev.map(t => t.id === id ? { ...t, result: won ? 'Win' : 'Loss', pnl, lastDigit } : t));

        totalPnl += pnl;
        tradeCount++;
        
        if (won) {
          wins++;
          consecutiveLosses = 0;
          stake = globalStake;
          entryTriggered = false;
          recoveryMode = false;
          cooldownRemaining = 0;
        } else {
          losses++;
          consecutiveLosses++;
          
          // Martingale
          stake = Math.round(stake * globalMultiplier * 100) / 100;
          
          // Enter recovery mode after loss
          recoveryMode = true;
          entryTriggered = false;
          
          // Cooldown for even/odd bots
          if (bot.type === 'even' || bot.type === 'odd') {
            cooldownRemaining = 5;
          }
        }

        setBots(prev => prev.map(b => {
          if (b.id === botId) {
            return {
              ...b,
              totalPnl,
              trades: tradeCount,
              wins,
              losses,
              currentStake: stake,
              consecutiveLosses,
              status: cooldownRemaining > 0 ? 'cooldown' : (recoveryMode ? 'waiting' : (entryTriggered ? 'trading' : 'waiting')),
              cooldownRemaining,
              recoveryMode,
              lastTradeResult: won ? 'win' : 'loss'
            };
          }
          return b;
        }));

        setActiveTradeId(null);
        await new Promise(r => setTimeout(r, 500));

      } catch (err: any) {
        setActiveTradeId(null);
        if (err.message?.includes('Insufficient balance')) {
          toast.error(`Insufficient balance for ${bot.name}`);
          break;
        } else {
          console.error(`Trade error:`, err);
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    }

    setBots(prev => prev.map(b => b.id === botId ? { 
      ...b, 
      isRunning: false, 
      isPaused: false,
      status: 'idle',
      cooldownRemaining: 0
    } : b));
    
    botRunningRefs.current[botId] = false;
  }, [isAuthorized, balance, globalStake, globalMultiplier, globalStopLoss, globalTakeProfit, activeTradeId, bots]);

  // Bot controls
  const startBot = (botId: string) => {
    const bot = bots.find(b => b.id === botId);
    if (!bot || bot.isRunning) return;
    setTimeout(() => runBot(botId), 0);
  };

  const pauseBot = (botId: string) => {
    botPausedRefs.current[botId] = !botPausedRefs.current[botId];
    setBots(prev => prev.map(b => b.id === botId ? { ...b, isPaused: botPausedRefs.current[botId] } : b));
  };

  const stopBot = (botId: string) => {
    botRunningRefs.current[botId] = false;
    setBots(prev => prev.map(b => b.id === botId ? { 
      ...b, 
      isRunning: false, 
      isPaused: false,
      status: 'idle',
      cooldownRemaining: 0
    } : b));
  };

  const stopAllBots = () => {
    bots.forEach(bot => {
      botRunningRefs.current[bot.id] = false;
    });
    setBots(prev => prev.map(b => ({ 
      ...b, 
      isRunning: false, 
      isPaused: false,
      status: 'idle',
      cooldownRemaining: 0
    })));
  };

  // Get market display name
  const getMarketDisplay = (market: string) => {
    if (market.startsWith('1HZ')) return `📊 ${market}`;
    if (market.startsWith('R_')) return `📈 ${market}`;
    return market;
  };

  // Calculate totals
  const totalProfit = bots.reduce((sum, bot) => sum + bot.totalPnl, 0);
  const totalTrades = bots.reduce((sum, bot) => sum + bot.trades, 0);
  const totalWins = bots.reduce((sum, bot) => sum + bot.wins, 0);
  const winRate = totalTrades > 0 ? ((totalWins / totalTrades) * 100).toFixed(1) : '0';

  return (
    <div className="space-y-4 p-4 bg-background min-h-screen">
      {/* Header with totals */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-bold">🤖 6-Bot Trading System</h1>
          <div className="flex items-center gap-2">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={scanMarket}
              disabled={isScanning}
            >
              {isScanning ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1" />}
              Scan Markets
            </Button>
            <Button 
              variant="destructive" 
              size="sm" 
              onClick={clearAll}
            >
              <Trash2 className="w-4 h-4 mr-1" /> Clear
            </Button>
            <Button variant="destructive" size="sm" onClick={stopAllBots} disabled={!bots.some(b => b.isRunning)}>
              <StopCircle className="w-4 h-4 mr-1" /> Stop All
            </Button>
          </div>
        </div>

        {/* Global Stats */}
        <div className="grid grid-cols-5 gap-3 text-sm">
          <div className="bg-muted/30 rounded-lg p-2">
            <div className="text-muted-foreground text-xs">Balance</div>
            <div className="font-bold text-lg">${balance?.toFixed(2) || '0.00'}</div>
          </div>
          <div className="bg-muted/30 rounded-lg p-2">
            <div className="text-muted-foreground text-xs">Total P&L</div>
            <div className={`font-bold text-lg ${totalProfit >= 0 ? 'text-profit' : 'text-loss'}`}>
              ${totalProfit.toFixed(2)}
            </div>
          </div>
          <div className="bg-muted/30 rounded-lg p-2">
            <div className="text-muted-foreground text-xs">Win Rate</div>
            <div className="font-bold text-lg">{winRate}%</div>
          </div>
          <div className="bg-muted/30 rounded-lg p-2">
            <div className="text-muted-foreground text-xs">Total Trades</div>
            <div className="font-bold text-lg">{totalTrades}</div>
          </div>
          <div className="bg-muted/30 rounded-lg p-2">
            <div className="text-muted-foreground text-xs">Active</div>
            <div className="font-bold text-lg">{bots.filter(b => b.isRunning).length}/6</div>
          </div>
        </div>

        {/* Settings */}
        <div className="grid grid-cols-4 gap-3 mt-3">
          <div>
            <label className="text-xs text-muted-foreground">Stake ($)</label>
            <input 
              type="number" 
              value={globalStake} 
              onChange={(e) => setGlobalStake(parseFloat(e.target.value) || 0.5)}
              className="w-full bg-background border border-border rounded-lg px-2 py-1 text-sm"
              step="0.1"
              min="0.1"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Multiplier</label>
            <input 
              type="number" 
              value={globalMultiplier} 
              onChange={(e) => setGlobalMultiplier(parseFloat(e.target.value) || 2)}
              className="w-full bg-background border border-border rounded-lg px-2 py-1 text-sm"
              step="0.1"
              min="1.1"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Stop Loss ($)</label>
            <input 
              type="number" 
              value={globalStopLoss} 
              onChange={(e) => setGlobalStopLoss(parseFloat(e.target.value) || 30)}
              className="w-full bg-background border border-border rounded-lg px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Take Profit ($)</label>
            <input 
              type="number" 
              value={globalTakeProfit} 
              onChange={(e) => setGlobalTakeProfit(parseFloat(e.target.value) || 5)}
              className="w-full bg-background border border-border rounded-lg px-2 py-1 text-sm"
            />
          </div>
        </div>
      </div>

      {/* Bots Grid */}
      <div className="grid grid-cols-3 gap-3">
        {bots.map((bot) => {
          const marketData = bot.selectedMarket ? marketAnalysis[bot.selectedMarket] : null;
          
          return (
            <motion.div
              key={bot.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className={`bg-card border rounded-xl p-3 ${
                bot.isRunning ? 'border-primary ring-1 ring-primary/20' : 'border-border'
              }`}
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className={`p-1.5 rounded-lg ${
                    bot.type === 'over3' || bot.type === 'over1' ? 'bg-blue-500/20 text-blue-400' :
                    bot.type === 'under6' || bot.type === 'under8' ? 'bg-orange-500/20 text-orange-400' :
                    bot.type === 'even' ? 'bg-green-500/20 text-green-400' :
                    'bg-purple-500/20 text-purple-400'
                  }`}>
                    {bot.type.includes('over') ? <TrendingUp className="w-4 h-4" /> :
                     bot.type.includes('under') ? <TrendingDown className="w-4 h-4" /> :
                     <CircleDot className="w-4 h-4" />}
                  </div>
                  <div>
                    <h4 className="font-bold text-sm">{bot.name}</h4>
                    <p className="text-[9px] text-muted-foreground">
                      {bot.contractType} {bot.barrier !== undefined ? `| B${bot.barrier}` : ''}
                    </p>
                  </div>
                </div>
                <Badge variant={bot.isRunning ? "default" : "secondary"} className="text-[9px]">
                  {bot.isRunning ? (bot.isPaused ? '⏸️' : '▶️') : '⏹️'}
                </Badge>
              </div>

              {/* Market & Analysis */}
              <div className="bg-muted/30 rounded-lg p-2 mb-2 text-[10px]">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Market:</span>
                  <span className="font-mono font-bold">
                    {bot.selectedMarket ? getMarketDisplay(bot.selectedMarket) : '—'}
                  </span>
                </div>
                {marketData && (
                  <>
                    <div className="flex justify-between mt-1">
                      <span>Most: {marketData.mostAppearing}</span>
                      <span>2nd: {marketData.secondMost}</span>
                      <span>Least: {marketData.leastAppearing}</span>
                    </div>
                    {(bot.type === 'even' || bot.type === 'odd') && (
                      <div className="flex justify-between mt-1 text-[8px]">
                        <span className={marketData.evenCount >= 400 ? 'text-profit' : ''}>
                          Even: {marketData.evenCount}
                        </span>
                        <span className={marketData.oddCount >= 400 ? 'text-profit' : ''}>
                          Odd: {marketData.oddCount}
                        </span>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-1 text-[10px] mb-2">
                <div>
                  <span className="text-muted-foreground">P&L:</span>
                  <span className={`ml-1 font-mono ${
                    bot.totalPnl > 0 ? 'text-profit' : bot.totalPnl < 0 ? 'text-loss' : ''
                  }`}>
                    ${bot.totalPnl.toFixed(2)}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Wins:</span>
                  <span className="ml-1 font-mono text-profit">{bot.wins}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Losses:</span>
                  <span className="ml-1 font-mono text-loss">{bot.losses}</span>
                </div>
              </div>

              {/* Status */}
              <div className="flex items-center justify-between text-[9px] mb-2">
                <span className="text-muted-foreground">Status:</span>
                <span className={`font-mono ${
                  bot.status === 'trading' ? 'text-green-400' :
                  bot.status === 'waiting' ? 'text-yellow-400' :
                  bot.status === 'cooldown' ? 'text-purple-400' :
                  'text-gray-400'
                }`}>
                  {bot.status === 'trading' ? '📈 Trading' :
                   bot.status === 'waiting' ? '⏳ Waiting' :
                   bot.status === 'cooldown' ? `⏱️ Cooldown ${bot.cooldownRemaining}` :
                   '⚫ Idle'}
                </span>
                <span className="text-muted-foreground">Stake:</span>
                <span className="font-mono">${bot.currentStake.toFixed(2)}</span>
              </div>

              {/* Controls */}
              <div className="flex gap-1">
                {!bot.isRunning ? (
                  <Button
                    onClick={() => startBot(bot.id)}
                    disabled={!isAuthorized || balance < globalStake || activeTradeId !== null || !bot.selectedMarket}
                    size="sm"
                    className="flex-1 h-7 text-xs"
                  >
                    <Play className="w-3 h-3 mr-1" /> Start
                  </Button>
                ) : (
                  <>
                    <Button
                      onClick={() => pauseBot(bot.id)}
                      size="sm"
                      variant="outline"
                      className="flex-1 h-7 text-xs"
                    >
                      <Pause className="w-3 h-3 mr-1" /> {bot.isPaused ? 'Resume' : 'Pause'}
                    </Button>
                    <Button
                      onClick={() => stopBot(bot.id)}
                      size="sm"
                      variant="destructive"
                      className="flex-1 h-7 text-xs"
                    >
                      <StopCircle className="w-3 h-3 mr-1" /> Stop
                    </Button>
                  </>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Trade Log */}
      <div className="bg-card border border-border rounded-xl p-3">
        <h3 className="text-sm font-semibold mb-2">📋 Live Trade Log</h3>
        <div className="space-y-1 max-h-[300px] overflow-y-auto">
          {trades.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">No trades yet</p>
          ) : (
            trades.map((trade, idx) => (
              <div key={idx} className="flex items-center justify-between text-xs py-1 border-b border-border/50 last:border-0">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">{trade.time}</span>
                  <Badge variant="outline" className="text-[8px] px-1 py-0">{trade.bot}</Badge>
                  <span className="font-mono text-[10px]">
                    {trade.market.includes('1HZ') ? '⚡' : '📊'} {trade.market}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-[10px]">
                    Last: {trade.lastDigit !== undefined ? trade.lastDigit : '—'}
                  </span>
                  <span className="font-mono">${trade.stake.toFixed(2)}</span>
                  <span className={`font-mono w-16 text-right ${
                    trade.result === 'Win' ? 'text-profit' : trade.result === 'Loss' ? 'text-loss' : ''
                  }`}>
                    {trade.result === 'Win' ? `+$${trade.pnl.toFixed(2)}` : 
                     trade.result === 'Loss' ? `-$${Math.abs(trade.pnl).toFixed(2)}` : 
                     '⏳'}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
