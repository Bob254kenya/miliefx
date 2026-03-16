import { useState, useRef, useCallback, useEffect, memo } from 'react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { derivApi } from '@/services/deriv-api';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2, Play, StopCircle, Pause, TrendingUp, TrendingDown, CircleDot, RefreshCw, Trash2, DollarSign, Scan, Gauge, Target, Activity, Power, Settings, Zap, AlertCircle, CheckCircle2, Timer, BarChart, Hash, Percent, ArrowUp, ArrowDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

// ==================== TYPES ====================
interface MarketTick {
  epoch: number;
  quote: number;
  digit: number;
}

interface MarketData {
  symbol: string;
  ticks: MarketTick[];
  lastDigit: number;
  evenPercentage: number;
  oddPercentage: number;
  over5Percentage: number;
  under4Percentage: number;
  volatility: number;
  lastUpdate: number;
}

interface BotStrategy {
  id: string;
  name: string;
  type: 'EVEN' | 'ODD' | 'OVER' | 'UNDER';
  conditions: {
    dominantPercentage: number;
    consecutiveRequired: number;
    predictionType: 'EVEN' | 'ODD' | 'OVER5' | 'UNDER4';
  };
}

interface BotConfig {
  id: string;
  name: string;
  enabled: boolean;
  strategy: BotStrategy;
  selectedMarket: string | null;
  entryEnabled: boolean;
  entryDigit: number;
  entryCondition: 'EQUAL' | 'GREATER' | 'LESS';
  stake: number;
  stakeType: 'FIXED' | 'MARTINGALE';
  martingaleMultiplier: number;
  takeProfit: number;
  stopLoss: number;
  maxTrades: number;
  tradeCount: number;
  totalPnl: number;
  wins: number;
  losses: number;
  isRunning: boolean;
  isPaused: boolean;
  status: 'IDLE' | 'WAITING_ENTRY' | 'WAITING_SIGNAL' | 'TRADING' | 'COOLDOWN';
  currentStake: number;
  consecutiveLosses: number;
  cooldownRemaining: number;
  lastSignal: boolean;
  entryTriggered: boolean;
}

interface TradeLog {
  id: number;
  timestamp: number;
  botId: string;
  botName: string;
  market: string;
  strategy: string;
  stake: number;
  result: 'WIN' | 'LOSS' | 'PENDING';
  pnl: number;
  entryDigit: number;
  exitDigit: number;
  contractId: string;
}

// ==================== CONSTANTS ====================
const VOLATILITY_MARKETS = [
  // Volatility Indices
  'R_10', 'R_25', 'R_50', 'R_75', 'R_100',
  // 1HZ Indices
  '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V',
  // Jump Indices
  'JD10', 'JD25', 'JD50', 'JD75', 'JD100',
  // Boom & Crash
  'BOOM300', 'BOOM500', 'BOOM1000',
  'CRASH300', 'CRASH500', 'CRASH1000',
  // Bear & Bull
  'RDBEAR', 'RDBULL'
];

const STRATEGIES: BotStrategy[] = [
  {
    id: 'even',
    name: 'EVEN Strategy',
    type: 'EVEN',
    conditions: {
      dominantPercentage: 60,
      consecutiveRequired: 2,
      predictionType: 'EVEN'
    }
  },
  {
    id: 'odd',
    name: 'ODD Strategy',
    type: 'ODD',
    conditions: {
      dominantPercentage: 60,
      consecutiveRequired: 2,
      predictionType: 'ODD'
    }
  },
  {
    id: 'over',
    name: 'OVER Strategy',
    type: 'OVER',
    conditions: {
      dominantPercentage: 65,
      consecutiveRequired: 2,
      predictionType: 'OVER5'
    }
  },
  {
    id: 'under',
    name: 'UNDER Strategy',
    type: 'UNDER',
    conditions: {
      dominantPercentage: 65,
      consecutiveRequired: 2,
      predictionType: 'UNDER4'
    }
  }
];

// ==================== UTILITIES ====================
const calculateDigitStats = (ticks: MarketTick[]): { even: number; odd: number; over5: number; under4: number } => {
  if (ticks.length === 0) return { even: 0, odd: 0, over5: 0, under4: 0 };
  
  const recentTicks = ticks.slice(-100);
  let even = 0, odd = 0, over5 = 0, under4 = 0;
  
  recentTicks.forEach(tick => {
    if (tick.digit % 2 === 0) even++;
    else odd++;
    if (tick.digit > 5) over5++;
    if (tick.digit < 4) under4++;
  });
  
  const total = recentTicks.length;
  return {
    even: (even / total) * 100,
    odd: (odd / total) * 100,
    over5: (over5 / total) * 100,
    under4: (under4 / total) * 100
  };
};

const calculateVolatility = (ticks: MarketTick[]): number => {
  if (ticks.length < 100) return 0;
  const recent = ticks.slice(-100).map(t => t.digit);
  const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
  const variance = recent.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / recent.length;
  return Math.sqrt(variance);
};

const checkConsecutiveDigits = (ticks: MarketTick[], count: number, condition: (digit: number) => boolean): boolean => {
  if (ticks.length < count) return false;
  const lastTicks = ticks.slice(-count);
  return lastTicks.every(tick => condition(tick.digit));
};

// ==================== MARKET DATA HOOK ====================
const useMarketData = (symbols: string[]) => {
  const [marketData, setMarketData] = useState<Record<string, MarketData>>({});
  const [isLoading, setIsLoading] = useState(true);
  const dataRef = useRef<Record<string, MarketTick[]>>({});
  const subscriptionRef = useRef<(() => void) | null>(null);
  const animationFrameRef = useRef<number>();

  useEffect(() => {
    const initializeMarkets = async () => {
      setIsLoading(true);
      
      // Fetch historical ticks for all markets
      const initialData: Record<string, MarketTick[]> = {};
      
      for (const symbol of symbols) {
        try {
          // Fetch last 1000 ticks
          const ticks = await derivApi.getTicks(symbol, 1000);
          initialData[symbol] = ticks.map((t: any) => ({
            epoch: t.epoch,
            quote: t.quote,
            digit: Math.floor(t.quote % 10)
          }));
        } catch (error) {
          console.error(`Failed to fetch ticks for ${symbol}:`, error);
          initialData[symbol] = [];
        }
      }
      
      dataRef.current = initialData;
      updateMarketData();
      
      // Subscribe to real-time ticks
      subscriptionRef.current = derivApi.subscribeTicks(symbols, (tick: any) => {
        const symbol = tick.symbol;
        const newTick: MarketTick = {
          epoch: tick.epoch,
          quote: tick.quote,
          digit: Math.floor(tick.quote % 10)
        };
        
        if (!dataRef.current[symbol]) {
          dataRef.current[symbol] = [];
        }
        
        dataRef.current[symbol].push(newTick);
        
        // Keep only last 1000 ticks
        if (dataRef.current[symbol].length > 1000) {
          dataRef.current[symbol] = dataRef.current[symbol].slice(-1000);
        }
        
        // Throttle UI updates
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
        }
        
        animationFrameRef.current = requestAnimationFrame(() => {
          updateMarketData();
        });
      });
      
      setIsLoading(false);
    };
    
    const updateMarketData = () => {
      const updated: Record<string, MarketData> = {};
      
      symbols.forEach(symbol => {
        const ticks = dataRef.current[symbol] || [];
        const stats = calculateDigitStats(ticks);
        const lastTick = ticks[ticks.length - 1];
        
        updated[symbol] = {
          symbol,
          ticks,
          lastDigit: lastTick?.digit ?? 0,
          evenPercentage: stats.even,
          oddPercentage: stats.odd,
          over5Percentage: stats.over5,
          under4Percentage: stats.under4,
          volatility: calculateVolatility(ticks),
          lastUpdate: Date.now()
        };
      });
      
      setMarketData(updated);
    };
    
    initializeMarkets();
    
    return () => {
      if (subscriptionRef.current) {
        subscriptionRef.current();
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [symbols]);
  
  return { marketData, isLoading };
};

// ==================== BOT CARD COMPONENT ====================
const BotCard = memo(({ 
  bot, 
  marketData,
  onStart,
  onStop,
  onPause,
  onConfigChange
}: { 
  bot: BotConfig;
  marketData?: MarketData;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onPause: (id: string) => void;
  onConfigChange: (id: string, updates: Partial<BotConfig>) => void;
}) => {
  const getStatusColor = () => {
    switch (bot.status) {
      case 'TRADING': return 'text-emerald-400';
      case 'WAITING_ENTRY': return 'text-yellow-400';
      case 'WAITING_SIGNAL': return 'text-blue-400';
      case 'COOLDOWN': return 'text-purple-400';
      default: return 'text-slate-400';
    }
  };

  const getStatusIcon = () => {
    switch (bot.status) {
      case 'TRADING': return <Zap className="w-3 h-3" />;
      case 'WAITING_ENTRY': return <Timer className="w-3 h-3" />;
      case 'WAITING_SIGNAL': return <Activity className="w-3 h-3" />;
      case 'COOLDOWN': return <RefreshCw className="w-3 h-3" />;
      default: return <CircleDot className="w-3 h-3" />;
    }
  };

  return (
    <Card className="bg-[#1e293b] border-slate-700 hover:border-slate-600 transition-all">
      <CardHeader className="p-3 pb-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`p-1.5 rounded ${bot.isRunning ? 'bg-emerald-500/20' : 'bg-slate-700'}`}>
              {bot.strategy.type === 'EVEN' && <CircleDot className="w-4 h-4 text-emerald-400" />}
              {bot.strategy.type === 'ODD' && <CircleDot className="w-4 h-4 text-purple-400" />}
              {bot.strategy.type === 'OVER' && <TrendingUp className="w-4 h-4 text-blue-400" />}
              {bot.strategy.type === 'UNDER' && <TrendingDown className="w-4 h-4 text-orange-400" />}
            </div>
            <div>
              <CardTitle className="text-sm font-medium text-slate-200">{bot.name}</CardTitle>
              <p className="text-[10px] text-slate-400">{bot.strategy.name}</p>
            </div>
          </div>
          <Switch
            checked={bot.enabled}
            onCheckedChange={(checked) => onConfigChange(bot.id, { enabled: checked })}
            className="scale-75"
          />
        </div>
      </CardHeader>
      
      <CardContent className="p-3 space-y-2">
        {/* Market Info */}
        <div className="bg-slate-800 rounded p-2 text-[10px]">
          <div className="flex justify-between items-center mb-1">
            <span className="text-slate-400">Market:</span>
            <Select
              value={bot.selectedMarket || ''}
              onValueChange={(value) => onConfigChange(bot.id, { selectedMarket: value })}
            >
              <SelectTrigger className="h-5 text-[9px] bg-slate-700 border-slate-600">
                <SelectValue placeholder="Select market" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700">
                {VOLATILITY_MARKETS.map(market => (
                  <SelectItem key={market} value={market} className="text-[10px]">
                    {market}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          {marketData && (
            <>
              <div className="grid grid-cols-3 gap-1 mt-1">
                <div>
                  <span className="text-slate-400">Last:</span>
                  <span className="ml-1 font-mono text-slate-200">{marketData.lastDigit}</span>
                </div>
                <div>
                  <span className="text-slate-400">Vol:</span>
                  <span className="ml-1 font-mono text-slate-200">{marketData.volatility.toFixed(1)}</span>
                </div>
                <div>
                  <span className="text-slate-400">Signal:</span>
                  <span className={`ml-1 font-mono ${bot.lastSignal ? 'text-emerald-400' : 'text-slate-400'}`}>
                    {bot.lastSignal ? '✓' : '✗'}
                  </span>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-1 mt-1">
                <div className="flex items-center gap-1">
                  <ArrowUp className="w-2 h-2 text-emerald-400" />
                  <span className="text-slate-400">Even:</span>
                  <span className="font-mono text-emerald-400">{marketData.evenPercentage.toFixed(1)}%</span>
                </div>
                <div className="flex items-center gap-1">
                  <ArrowDown className="w-2 h-2 text-rose-400" />
                  <span className="text-slate-400">Odd:</span>
                  <span className="font-mono text-rose-400">{marketData.oddPercentage.toFixed(1)}%</span>
                </div>
                <div className="flex items-center gap-1">
                  <ArrowUp className="w-2 h-2 text-blue-400" />
                  <span className="text-slate-400">Over5:</span>
                  <span className="font-mono text-blue-400">{marketData.over5Percentage.toFixed(1)}%</span>
                </div>
                <div className="flex items-center gap-1">
                  <ArrowDown className="w-2 h-2 text-orange-400" />
                  <span className="text-slate-400">Under4:</span>
                  <span className="font-mono text-orange-400">{marketData.under4Percentage.toFixed(1)}%</span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Entry Settings */}
        <div className="bg-slate-800 rounded p-2 text-[10px]">
          <div className="flex items-center justify-between mb-1">
            <span className="text-slate-400 flex items-center gap-1">
              <Target className="w-3 h-3" /> Entry System
            </span>
            <Switch
              checked={bot.entryEnabled}
              onCheckedChange={(checked) => onConfigChange(bot.id, { entryEnabled: checked })}
              className="scale-50"
            />
          </div>
          
          {bot.entryEnabled && (
            <div className="flex items-center gap-1 mt-1">
              <Input
                type="number"
                min="0"
                max="9"
                value={bot.entryDigit}
                onChange={(e) => onConfigChange(bot.id, { entryDigit: parseInt(e.target.value) || 0 })}
                className="h-5 w-12 text-[9px] bg-slate-700 border-slate-600"
              />
              <Select
                value={bot.entryCondition}
                onValueChange={(value: any) => onConfigChange(bot.id, { entryCondition: value })}
              >
                <SelectTrigger className="h-5 text-[9px] bg-slate-700 border-slate-600">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  <SelectItem value="EQUAL" className="text-[10px]">=</SelectItem>
                  <SelectItem value="GREATER" className="text-[10px]">></SelectItem>
                  <SelectItem value="LESS" className="text-[10px]">{'<'}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-1 text-[9px]">
          <div className="bg-slate-800 rounded p-1">
            <span className="text-slate-400 block">P&L</span>
            <span className={`font-mono ${bot.totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              ${bot.totalPnl.toFixed(2)}
            </span>
          </div>
          <div className="bg-slate-800 rounded p-1">
            <span className="text-slate-400 block">W/L</span>
            <span className="font-mono text-emerald-400">{bot.wins}</span>
            <span className="font-mono text-rose-400 ml-1">/{bot.losses}</span>
          </div>
          <div className="bg-slate-800 rounded p-1">
            <span className="text-slate-400 block">Win%</span>
            <span className="font-mono text-yellow-400">
              {bot.tradeCount > 0 ? ((bot.wins / bot.tradeCount) * 100).toFixed(0) : 0}%
            </span>
          </div>
        </div>

        {/* Status Bar */}
        <div className="flex items-center justify-between text-[9px] bg-slate-800 rounded p-1">
          <div className="flex items-center gap-1">
            {getStatusIcon()}
            <span className={getStatusColor()}>
              {bot.status === 'COOLDOWN' ? `${bot.status} ${bot.cooldownRemaining}s` : bot.status}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-400">Stake:</span>
            <span className="font-mono text-emerald-400">${bot.currentStake.toFixed(2)}</span>
          </div>
        </div>

        {/* Controls */}
        <div className="grid grid-cols-3 gap-1">
          {!bot.isRunning ? (
            <Button
              onClick={() => onStart(bot.id)}
              disabled={!bot.enabled || !bot.selectedMarket}
              size="sm"
              className="col-span-3 h-6 text-[9px] bg-emerald-600 hover:bg-emerald-700"
            >
              <Play className="w-3 h-3 mr-1" /> START
            </Button>
          ) : (
            <>
              <Button
                onClick={() => onPause(bot.id)}
                size="sm"
                variant="outline"
                className="h-6 text-[9px] border-slate-600 hover:bg-slate-700"
              >
                <Pause className="w-3 h-3" />
              </Button>
              <Button
                onClick={() => onStop(bot.id)}
                size="sm"
                variant="destructive"
                className="h-6 text-[9px] col-span-2"
              >
                <StopCircle className="w-3 h-3 mr-1" /> STOP
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
});

BotCard.displayName = 'BotCard';

// ==================== MAIN COMPONENT ====================
export default function AutoTrade() {
  const { isAuthorized, balance } = useAuth();
  const [bots, setBots] = useState<BotConfig[]>([]);
  const [trades, setTrades] = useState<TradeLog[]>([]);
  const [globalSettings, setGlobalSettings] = useState({
    defaultStake: 0.5,
    defaultMartingaleMultiplier: 2,
    defaultTakeProfit: 5,
    defaultStopLoss: 30,
    defaultMaxTrades: 100
  });
  
  const { marketData, isLoading } = useMarketData(VOLATILITY_MARKETS);
  const botRunningRefs = useRef<Record<string, boolean>>({});
  const tradeIdRef = useRef(0);

  // Initialize bots
  useEffect(() => {
    const initialBots: BotConfig[] = [];
    
    // Create 2 bots per row (6 rows = 12 bots)
    for (let i = 0; i < 12; i++) {
      const strategyIndex = i % 4;
      initialBots.push({
        id: `bot-${i}`,
        name: `Bot ${i + 1}`,
        enabled: true,
        strategy: STRATEGIES[strategyIndex],
        selectedMarket: null,
        entryEnabled: false,
        entryDigit: 0,
        entryCondition: 'EQUAL',
        stake: globalSettings.defaultStake,
        stakeType: 'FIXED',
        martingaleMultiplier: globalSettings.defaultMartingaleMultiplier,
        takeProfit: globalSettings.defaultTakeProfit,
        stopLoss: globalSettings.defaultStopLoss,
        maxTrades: globalSettings.defaultMaxTrades,
        tradeCount: 0,
        totalPnl: 0,
        wins: 0,
        losses: 0,
        isRunning: false,
        isPaused: false,
        status: 'IDLE',
        currentStake: globalSettings.defaultStake,
        consecutiveLosses: 0,
        cooldownRemaining: 0,
        lastSignal: false,
        entryTriggered: false
      });
    }
    
    setBots(initialBots);
  }, []);

  // Auto-assign best markets based on volatility
  const scanMarkets = useCallback(() => {
    const marketsWithVolatility = Object.entries(marketData)
      .map(([symbol, data]) => ({
        symbol,
        volatility: data.volatility,
        evenBias: data.evenPercentage,
        oddBias: data.oddPercentage,
        overBias: data.over5Percentage,
        underBias: data.under4Percentage
      }))
      .sort((a, b) => b.volatility - a.volatility);

    setBots(prev => prev.map((bot, index) => {
      const bestMarket = marketsWithVolatility[index % marketsWithVolatility.length];
      return {
        ...bot,
        selectedMarket: bestMarket?.symbol || null
      };
    }));

    toast.success(`Assigned best markets to ${bots.length} bots based on volatility`);
  }, [marketData]);

  // Bot trading logic
  const runBot = useCallback(async (botId: string) => {
    const bot = bots.find(b => b.id === botId);
    if (!bot || !bot.selectedMarket || !isAuthorized) return;

    const market = marketData[bot.selectedMarket];
    if (!market) return;

    if (balance < bot.currentStake) {
      toast.error(`Insufficient balance for ${bot.name}`);
      stopBot(botId);
      return;
    }

    setBots(prev => prev.map(b => 
      b.id === botId ? { 
        ...b, 
        isRunning: true, 
        status: bot.entryEnabled ? 'WAITING_ENTRY' : 'WAITING_SIGNAL',
        currentStake: bot.stake
      } : b
    ));
    
    botRunningRefs.current[botId] = true;

    let tradeCount = bot.tradeCount;
    let totalPnl = bot.totalPnl;
    let wins = bot.wins;
    let losses = bot.losses;
    let currentStake = bot.stake;
    let consecutiveLosses = 0;
    let entryTriggered = !bot.entryEnabled;
    let cooldownRemaining = 0;

    while (botRunningRefs.current[botId]) {
      // Check stop loss / take profit
      if (totalPnl <= -bot.stopLoss) {
        toast.error(`${bot.name}: Stop Loss reached`);
        break;
      }
      if (totalPnl >= bot.takeProfit) {
        toast.success(`${bot.name}: Take Profit reached`);
        break;
      }
      if (tradeCount >= bot.maxTrades) {
        toast.info(`${bot.name}: Max trades reached`);
        break;
      }

      // Cooldown
      if (cooldownRemaining > 0) {
        setBots(prev => prev.map(b => 
          b.id === botId ? { ...b, status: 'COOLDOWN', cooldownRemaining } : b
        ));
        await new Promise(r => setTimeout(r, 1000));
        cooldownRemaining--;
        continue;
      }

      const currentMarket = marketData[bot.selectedMarket!];
      if (!currentMarket) {
        await new Promise(r => setTimeout(r, 500));
        continue;
      }

      const ticks = currentMarket.ticks;
      const lastDigit = ticks[ticks.length - 1]?.digit;

      // Entry condition check
      if (!entryTriggered && bot.entryEnabled) {
        let entryMet = false;
        switch (bot.entryCondition) {
          case 'EQUAL':
            entryMet = lastDigit === bot.entryDigit;
            break;
          case 'GREATER':
            entryMet = lastDigit > bot.entryDigit;
            break;
          case 'LESS':
            entryMet = lastDigit < bot.entryDigit;
            break;
        }

        if (entryMet) {
          entryTriggered = true;
          setBots(prev => prev.map(b => 
            b.id === botId ? { ...b, status: 'WAITING_SIGNAL' } : b
          ));
        } else {
          await new Promise(r => setTimeout(r, 500));
          continue;
        }
      }

      // Check strategy conditions
      let shouldTrade = false;
      let prediction = '';

      switch (bot.strategy.type) {
        case 'EVEN':
          if (currentMarket.oddPercentage > bot.strategy.conditions.dominantPercentage) {
            shouldTrade = checkConsecutiveDigits(ticks, 2, d => d % 2 === 1);
            prediction = 'EVEN';
          }
          break;
        case 'ODD':
          if (currentMarket.evenPercentage > bot.strategy.conditions.dominantPercentage) {
            shouldTrade = checkConsecutiveDigits(ticks, 2, d => d % 2 === 0);
            prediction = 'ODD';
          }
          break;
        case 'OVER':
          if (currentMarket.under4Percentage > bot.strategy.conditions.dominantPercentage) {
            shouldTrade = checkConsecutiveDigits(ticks, 2, d => d <= 3);
            prediction = 'OVER5';
          }
          break;
        case 'UNDER':
          if (currentMarket.over5Percentage > bot.strategy.conditions.dominantPercentage) {
            shouldTrade = checkConsecutiveDigits(ticks, 2, d => d >= 6);
            prediction = 'UNDER4';
          }
          break;
      }

      setBots(prev => prev.map(b => 
        b.id === botId ? { ...b, lastSignal: shouldTrade } : b
      ));

      if (!shouldTrade) {
        await new Promise(r => setTimeout(r, 500));
        continue;
      }

      // Place trade
      setBots(prev => prev.map(b => 
        b.id === botId ? { ...b, status: 'TRADING' } : b
      ));

      try {
        const contractType = 
          prediction === 'EVEN' ? 'DIGITEVEN' :
          prediction === 'ODD' ? 'DIGITODD' :
          prediction === 'OVER5' ? 'DIGITOVER' :
          'DIGITUNDER';

        const barrier = prediction === 'OVER5' ? '5' : prediction === 'UNDER4' ? '4' : undefined;

        const params: any = {
          contract_type: contractType,
          symbol: bot.selectedMarket,
          duration: 1,
          duration_unit: 't',
          basis: 'stake',
          amount: currentStake,
        };

        if (barrier) {
          params.barrier = barrier;
        }

        const id = ++tradeIdRef.current;
        const { contractId } = await derivApi.buyContract(params);
        
        // Wait for result
        const result = await derivApi.waitForContractResult(contractId);
        const won = result.status === 'won';
        const pnl = result.profit;

        // Update trade log
        setTrades(prev => [{
          id,
          timestamp: Date.now(),
          botId,
          botName: bot.name,
          market: bot.selectedMarket!,
          strategy: bot.strategy.name,
          stake: currentStake,
          result: won ? 'WIN' : 'LOSS',
          pnl,
          entryDigit: lastDigit!,
          exitDigit: result.digit,
          contractId
        }, ...prev].slice(0, 100));

        // Update bot stats
        tradeCount++;
        totalPnl += pnl;
        
        if (won) {
          wins++;
          consecutiveLosses = 0;
          currentStake = bot.stake; // Reset stake on win
        } else {
          losses++;
          consecutiveLosses++;
          
          if (bot.stakeType === 'MARTINGALE') {
            currentStake = Math.round(currentStake * bot.martingaleMultiplier * 100) / 100;
          }
        }

        setBots(prev => prev.map(b => {
          if (b.id === botId) {
            return {
              ...b,
              tradeCount,
              totalPnl,
              wins,
              losses,
              currentStake,
              consecutiveLosses,
              status: 'WAITING_SIGNAL',
              cooldownRemaining: !won && (bot.strategy.type === 'EVEN' || bot.strategy.type === 'ODD') ? 3 : 0
            };
          }
          return b;
        }));

      } catch (err: any) {
        console.error('Trade error:', err);
        if (err.message?.includes('Insufficient balance')) {
          toast.error(`Insufficient balance for ${bot.name}`);
          break;
        }
      }

      await new Promise(r => setTimeout(r, 1000));
    }

    setBots(prev => prev.map(b => 
      b.id === botId ? { 
        ...b, 
        isRunning: false, 
        status: 'IDLE',
        cooldownRemaining: 0,
        entryTriggered: false
      } : b
    ));
    
    botRunningRefs.current[botId] = false;
  }, [bots, marketData, isAuthorized, balance]);

  const startBot = (botId: string) => {
    const bot = bots.find(b => b.id === botId);
    if (!bot || bot.isRunning) return;
    runBot(botId);
  };

  const pauseBot = (botId: string) => {
    setBots(prev => prev.map(b => 
      b.id === botId ? { ...b, isPaused: !b.isPaused } : b
    ));
  };

  const stopBot = (botId: string) => {
    botRunningRefs.current[botId] = false;
    setBots(prev => prev.map(b => 
      b.id === botId ? { 
        ...b, 
        isRunning: false, 
        isPaused: false,
        status: 'IDLE',
        cooldownRemaining: 0,
        entryTriggered: false
      } : b
    ));
  };

  const stopAllBots = () => {
    bots.forEach(bot => {
      botRunningRefs.current[bot.id] = false;
    });
    setBots(prev => prev.map(b => ({ 
      ...b, 
      isRunning: false, 
      isPaused: false,
      status: 'IDLE',
      cooldownRemaining: 0,
      entryTriggered: false
    })));
    toast.success('All bots stopped');
  };

  const updateBotConfig = (botId: string, updates: Partial<BotConfig>) => {
    setBots(prev => prev.map(b => b.id === botId ? { ...b, ...updates } : b));
  };

  const clearAll = () => {
    stopAllBots();
    setTrades([]);
    setBots(prev => prev.map(bot => ({
      ...bot,
      totalPnl: 0,
      tradeCount: 0,
      wins: 0,
      losses: 0,
      currentStake: bot.stake,
      consecutiveLosses: 0,
      status: 'IDLE'
    })));
    tradeIdRef.current = 0;
    toast.success('All data cleared');
  };

  const totalProfit = bots.reduce((sum, bot) => sum + bot.totalPnl, 0);
  const totalTrades = bots.reduce((sum, bot) => sum + bot.tradeCount, 0);
  const totalWins = bots.reduce((sum, bot) => sum + bot.wins, 0);
  const winRate = totalTrades > 0 ? ((totalWins / totalTrades) * 100).toFixed(1) : '0';

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-200">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-[#0f172a]/95 backdrop-blur border-b border-slate-800">
        <div className="max-w-[1920px] mx-auto p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Gauge className="w-5 h-5 text-emerald-400" />
              <h1 className="text-base font-semibold text-slate-200">AI Trading System</h1>
              <Badge variant="outline" className="text-[10px] border-slate-700">
                v2.0
              </Badge>
            </div>
            
            <div className="flex items-center gap-2">
              <Badge className="bg-slate-800 text-slate-300 border-slate-700 text-[10px]">
                Balance: ${balance?.toFixed(2) || '0.00'}
              </Badge>
              <Badge className="bg-slate-800 text-slate-300 border-slate-700 text-[10px]">
                P&L: <span className={totalProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                  ${totalProfit.toFixed(2)}
                </span>
              </Badge>
              <Badge className="bg-slate-800 text-slate-300 border-slate-700 text-[10px]">
                Win Rate: {winRate}%
              </Badge>
            </div>

            <div className="flex items-center gap-2">
              <Button
                onClick={scanMarkets}
                size="sm"
                className="h-7 text-[10px] bg-emerald-600 hover:bg-emerald-700"
              >
                <Scan className="w-3 h-3 mr-1" />
                Scan Markets
              </Button>
              <Button
                onClick={stopAllBots}
                size="sm"
                variant="destructive"
                className="h-7 text-[10px]"
                disabled={!bots.some(b => b.isRunning)}
              >
                <StopCircle className="w-3 h-3 mr-1" />
                Stop All
              </Button>
              <Button
                onClick={clearAll}
                size="sm"
                variant="outline"
                className="h-7 text-[10px] border-slate-700"
              >
                <Trash2 className="w-3 h-3 mr-1" />
                Clear
              </Button>
            </div>
          </div>

          {/* Global Settings */}
          <div className="grid grid-cols-5 gap-2 mt-2">
            <div className="flex items-center gap-1 bg-slate-800/50 rounded px-2 py-1">
              <DollarSign className="w-3 h-3 text-slate-400" />
              <span className="text-[9px] text-slate-400">Stake:</span>
              <Input
                type="number"
                value={globalSettings.defaultStake}
                onChange={(e) => setGlobalSettings(prev => ({ ...prev, defaultStake: parseFloat(e.target.value) || 0.5 }))}
                className="h-4 w-16 text-[9px] bg-slate-700 border-slate-600"
              />
            </div>
            <div className="flex items-center gap-1 bg-slate-800/50 rounded px-2 py-1">
              <RefreshCw className="w-3 h-3 text-slate-400" />
              <span className="text-[9px] text-slate-400">Martingale:</span>
              <Input
                type="number"
                value={globalSettings.defaultMartingaleMultiplier}
                onChange={(e) => setGlobalSettings(prev => ({ ...prev, defaultMartingaleMultiplier: parseFloat(e.target.value) || 2 }))}
                className="h-4 w-16 text-[9px] bg-slate-700 border-slate-600"
              />
            </div>
            <div className="flex items-center gap-1 bg-slate-800/50 rounded px-2 py-1">
              <Target className="w-3 h-3 text-slate-400" />
              <span className="text-[9px] text-slate-400">TP:</span>
              <Input
                type="number"
                value={globalSettings.defaultTakeProfit}
                onChange={(e) => setGlobalSettings(prev => ({ ...prev, defaultTakeProfit: parseFloat(e.target.value) || 5 }))}
                className="h-4 w-16 text-[9px] bg-slate-700 border-slate-600"
              />
            </div>
            <div className="flex items-center gap-1 bg-slate-800/50 rounded px-2 py-1">
              <Shield className="w-3 h-3 text-slate-400" />
              <span className="text-[9px] text-slate-400">SL:</span>
              <Input
                type="number"
                value={globalSettings.defaultStopLoss}
                onChange={(e) => setGlobalSettings(prev => ({ ...prev, defaultStopLoss: parseFloat(e.target.value) || 30 }))}
                className="h-4 w-16 text-[9px] bg-slate-700 border-slate-600"
              />
            </div>
            <div className="flex items-center gap-1 bg-slate-800/50 rounded px-2 py-1">
              <BarChart className="w-3 h-3 text-slate-400" />
              <span className="text-[9px] text-slate-400">Max Trades:</span>
              <Input
                type="number"
                value={globalSettings.defaultMaxTrades}
                onChange={(e) => setGlobalSettings(prev => ({ ...prev, defaultMaxTrades: parseInt(e.target.value) || 100 }))}
                className="h-4 w-16 text-[9px] bg-slate-700 border-slate-600"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-[1920px] mx-auto p-3">
        {/* Bots Grid - 2 bots per row */}
        <div className="grid grid-cols-2 gap-2">
          {bots.map((bot) => (
            <BotCard
              key={bot.id}
              bot={bot}
              marketData={bot.selectedMarket ? marketData[bot.selectedMarket] : undefined}
              onStart={startBot}
              onStop={stopBot}
              onPause={pauseBot}
              onConfigChange={updateBotConfig}
            />
          ))}
        </div>

        {/* Trade Log */}
        <Card className="mt-3 bg-[#1e293b] border-slate-700">
          <CardHeader className="p-3">
            <CardTitle className="text-sm font-medium text-slate-200">Trade Log</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-[200px] overflow-y-auto">
              {trades.length === 0 ? (
                <div className="text-center py-4 text-[11px] text-slate-400">
                  No trades yet
                </div>
              ) : (
                trades.map((trade) => (
                  <div
                    key={trade.id}
                    className="flex items-center justify-between px-3 py-1.5 border-b border-slate-800 last:border-0 text-[10px] hover:bg-slate-800/50"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-slate-400">
                        {new Date(trade.timestamp).toLocaleTimeString()}
                      </span>
                      <Badge className="bg-slate-800 text-slate-300 border-slate-700 text-[8px]">
                        {trade.botName}
                      </Badge>
                      <span className="text-slate-300">{trade.market}</span>
                      <span className="text-slate-400">{trade.strategy}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-slate-300">${trade.stake.toFixed(2)}</span>
                      <span className={`font-mono ${trade.result === 'WIN' ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {trade.result === 'WIN' ? '+' : '-'}${Math.abs(trade.pnl).toFixed(2)}
                      </span>
                      <Badge className={`${trade.result === 'WIN' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'} text-[8px] border-0`}>
                        {trade.result}
                      </Badge>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
  }
