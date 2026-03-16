import { useState, useRef, useCallback, useEffect, memo } from 'react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Play, Pause, Square, TrendingUp, TrendingDown, 
  CircleDot, RefreshCw, Trash2, DollarSign, Scan, 
  Target, Activity, Power, Zap, AlertCircle, CheckCircle2, 
  Timer, BarChart, Hash, Percent, ArrowUp, ArrowDown, Brain,
  Rocket, Shield, Crown, Gauge, Radar, LineChart, Layers,
  Eye, EyeOff, Lock, Unlock, Volume2, VolumeX, Settings2,
  Plus, Minus, ChevronUp, ChevronDown, Maximize2, Minimize2,
  Grid3X3, List, Filter, Download, Upload, Copy, Check,
  Clock, Calendar, Bell, Moon, Sun, Wifi, WifiOff,
  Loader2, X
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Slider } from '@/components/ui/slider';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

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
  lastQuote: number;
  evenPercent: number;
  oddPercent: number;
  lowPercent: number;
  highPercent: number;
  volatility: number;
  trend: 'BULL' | 'BEAR' | 'NEUTRAL';
  signal: 'EVEN' | 'ODD' | 'OVER' | 'UNDER' | null;
  confidence: number;
  updateTime: number;
}

interface BotStrategy {
  id: string;
  name: string;
  type: 'EVEN' | 'ODD' | 'OVER' | 'UNDER';
  icon: React.ElementType;
  color: string;
  conditions: {
    dominantPercent: number;
    consecutiveRequired: number;
    predictionType: string;
  };
}

interface BotConfig {
  id: string;
  name: string;
  strategy: BotStrategy;
  market: string | null;
  enabled: boolean;
  running: boolean;
  paused: boolean;
  status: 'IDLE' | 'WAITING_ENTRY' | 'ANALYZING' | 'READY' | 'TRADING' | 'COOLDOWN' | 'STOPPED';
  entryEnabled: boolean;
  entryDigit: number;
  entryCondition: 'EQUAL' | 'GREATER' | 'LESS';
  entryTriggered: boolean;
  stake: number;
  stakeType: 'FIXED' | 'MARTINGALE';
  martingaleMultiplier: number;
  takeProfit: number;
  stopLoss: number;
  maxTrades: number;
  trades: number;
  wins: number;
  losses: number;
  totalPnl: number;
  currentStake: number;
  consecutiveLosses: number;
  cooldownRemaining: number;
  lastSignal: boolean;
  expanded: boolean;
}

interface TradeLog {
  id: string;
  time: number;
  botId: string;
  botName: string;
  market: string;
  strategy: string;
  stake: number;
  entry: number;
  exit: number;
  result: 'WIN' | 'LOSS';
  pnl: number;
  confidence: number;
}

// ==================== CONSTANTS ====================
const MARKETS = [
  { id: 'R_10', name: 'R 10', type: 'Volatility', icon: '📊' },
  { id: 'R_25', name: 'R 25', type: 'Volatility', icon: '📊' },
  { id: 'R_50', name: 'R 50', type: 'Volatility', icon: '📊' },
  { id: 'R_75', name: 'R 75', type: 'Volatility', icon: '📊' },
  { id: 'R_100', name: 'R 100', type: 'Volatility', icon: '📊' },
  { id: '1HZ10V', name: '1HZ 10V', type: '1HZ', icon: '⚡' },
  { id: '1HZ25V', name: '1HZ 25V', type: '1HZ', icon: '⚡' },
  { id: '1HZ50V', name: '1HZ 50V', type: '1HZ', icon: '⚡' },
  { id: '1HZ75V', name: '1HZ 75V', type: '1HZ', icon: '⚡' },
  { id: '1HZ100V', name: '1HZ 100V', type: '1HZ', icon: '⚡' },
  { id: 'JD10', name: 'JD 10', type: 'Jump', icon: '🦘' },
  { id: 'JD25', name: 'JD 25', type: 'Jump', icon: '🦘' },
  { id: 'JD50', name: 'JD 50', type: 'Jump', icon: '🦘' },
  { id: 'JD75', name: 'JD 75', type: 'Jump', icon: '🦘' },
  { id: 'JD100', name: 'JD 100', type: 'Jump', icon: '🦘' },
  { id: 'BOOM300', name: 'BOOM 300', type: 'Boom', icon: '💥' },
  { id: 'BOOM500', name: 'BOOM 500', type: 'Boom', icon: '💥' },
  { id: 'BOOM1000', name: 'BOOM 1000', type: 'Boom', icon: '💥' },
  { id: 'CRASH300', name: 'CRASH 300', type: 'Crash', icon: '📉' },
  { id: 'CRASH500', name: 'CRASH 500', type: 'Crash', icon: '📉' },
  { id: 'CRASH1000', name: 'CRASH 1000', type: 'Crash', icon: '📉' },
  { id: 'RDBEAR', name: 'Bear Market', type: 'Bear', icon: '🐻' },
  { id: 'RDBULL', name: 'Bull Market', type: 'Bull', icon: '🐂' },
];

const STRATEGIES: BotStrategy[] = [
  {
    id: 'even',
    name: 'EVEN',
    type: 'EVEN',
    icon: CircleDot,
    color: 'emerald',
    conditions: { dominantPercent: 60, consecutiveRequired: 2, predictionType: 'EVEN' }
  },
  {
    id: 'odd',
    name: 'ODD',
    type: 'ODD',
    icon: CircleDot,
    color: 'purple',
    conditions: { dominantPercent: 60, consecutiveRequired: 2, predictionType: 'ODD' }
  },
  {
    id: 'over',
    name: 'OVER',
    type: 'OVER',
    icon: TrendingUp,
    color: 'blue',
    conditions: { dominantPercent: 65, consecutiveRequired: 2, predictionType: 'OVER5' }
  },
  {
    id: 'under',
    name: 'UNDER',
    type: 'UNDER',
    icon: TrendingDown,
    color: 'orange',
    conditions: { dominantPercent: 65, consecutiveRequired: 2, predictionType: 'UNDER4' }
  }
];

// Color mapping for Tailwind classes
const COLOR_CLASSES = {
  emerald: {
    bg: 'bg-emerald-500/20',
    text: 'text-emerald-400',
    border: 'border-emerald-500/30',
    hover: 'hover:bg-emerald-600',
    bgLight: 'bg-emerald-500/10'
  },
  purple: {
    bg: 'bg-purple-500/20',
    text: 'text-purple-400',
    border: 'border-purple-500/30',
    hover: 'hover:bg-purple-600',
    bgLight: 'bg-purple-500/10'
  },
  blue: {
    bg: 'bg-blue-500/20',
    text: 'text-blue-400',
    border: 'border-blue-500/30',
    hover: 'hover:bg-blue-600',
    bgLight: 'bg-blue-500/10'
  },
  orange: {
    bg: 'bg-orange-500/20',
    text: 'text-orange-400',
    border: 'border-orange-500/30',
    hover: 'hover:bg-orange-600',
    bgLight: 'bg-orange-500/10'
  }
};

// Status color mapping
const STATUS_CLASSES = {
  TRADING: { text: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30' },
  READY: { text: 'text-green-400', bg: 'bg-green-500/10 border-green-500/30' },
  ANALYZING: { text: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/30' },
  WAITING_ENTRY: { text: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/30' },
  COOLDOWN: { text: 'text-purple-400', bg: 'bg-purple-500/10 border-purple-500/30' },
  STOPPED: { text: 'text-rose-400', bg: 'bg-rose-500/10 border-rose-500/30' },
  IDLE: { text: 'text-slate-400', bg: 'bg-slate-800/50 border-slate-700' }
};

// ==================== MOCK API SERVICE ====================
const derivApi = {
  async getTicks(symbol: string, count: number): Promise<any[]> {
    // Mock implementation - replace with actual API
    return Array.from({ length: count }, (_, i) => ({
      epoch: Date.now() / 1000 - (count - i),
      quote: 1000 + Math.random() * 100
    }));
  },
  
  subscribeTicks(symbols: string[], callback: (tick: any) => void): () => void {
    // Mock implementation - replace with actual WebSocket
    const interval = setInterval(() => {
      symbols.forEach(symbol => {
        callback({
          symbol,
          epoch: Date.now() / 1000,
          quote: 1000 + Math.random() * 100
        });
      });
    }, 1000);
    
    return () => clearInterval(interval);
  },
  
  async buyContract(params: any): Promise<{ contractId: string }> {
    // Mock implementation
    return { contractId: `contract-${Date.now()}` };
  },
  
  async waitForContractResult(contractId: string): Promise<{ status: string; profit: number; digit: number }> {
    // Mock implementation
    await new Promise(r => setTimeout(r, 1000));
    const won = Math.random() > 0.5;
    return {
      status: won ? 'won' : 'lost',
      profit: won ? 0.8 : -1,
      digit: Math.floor(Math.random() * 10)
    };
  }
};

// ==================== MOCK AUTH CONTEXT ====================
const useAuth = () => ({
  isAuthorized: true,
  balance: 1000
});

// ==================== UTILITIES ====================
const analyzeMarket = (ticks: MarketTick[]): Partial<MarketData> => {
  if (ticks.length < 100) return {};
  
  const recent = ticks.slice(-100);
  const last = recent[recent.length - 1];
  
  let even = 0, odd = 0, low = 0, high = 0;
  recent.forEach(t => {
    if (t.digit % 2 === 0) even++;
    else odd++;
    if (t.digit <= 4) low++;
    if (t.digit >= 5) high++;
  });
  
  const evenPercent = (even / 100) * 100;
  const oddPercent = (odd / 100) * 100;
  const lowPercent = (low / 100) * 100;
  const highPercent = (high / 100) * 100;
  
  const digits = recent.map(t => t.digit);
  const mean = digits.reduce((a, b) => a + b, 0) / 100;
  const variance = digits.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / 100;
  const volatility = Math.sqrt(variance);
  
  const last10 = recent.slice(-10).map(t => t.digit);
  const avg10 = last10.reduce((a, b) => a + b, 0) / 10;
  const trend = avg10 > mean ? 'BULL' : avg10 < mean ? 'BEAR' : 'NEUTRAL';
  
  let signal = null;
  let confidence = 0;
  
  if (oddPercent > 60) {
    signal = 'EVEN';
    confidence = oddPercent;
  } else if (evenPercent > 60) {
    signal = 'ODD';
    confidence = evenPercent;
  } else if (lowPercent > 65) {
    signal = 'OVER';
    confidence = lowPercent;
  } else if (highPercent > 65) {
    signal = 'UNDER';
    confidence = highPercent;
  }
  
  return {
    lastDigit: last?.digit,
    lastQuote: last?.quote,
    evenPercent,
    oddPercent,
    lowPercent,
    highPercent,
    volatility,
    trend: trend as 'BULL' | 'BEAR' | 'NEUTRAL',
    signal: signal as 'EVEN' | 'ODD' | 'OVER' | 'UNDER' | null,
    confidence,
    updateTime: Date.now()
  };
};

const checkConsecutive = (ticks: MarketTick[], count: number, condition: (d: number) => boolean): boolean => {
  if (ticks.length < count) return false;
  return ticks.slice(-count).every(t => condition(t.digit));
};

// ==================== MARKET DATA HOOK ====================
const useMarketData = (symbols: string[]) => {
  const [data, setData] = useState<Record<string, MarketData>>({});
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  
  const ticksRef = useRef<Record<string, MarketTick[]>>({});
  const subsRef = useRef<(() => void) | null>(null);
  const frameRef = useRef<number>();

  useEffect(() => {
    let isMounted = true;
    
    const init = async () => {
      setLoading(true);
      
      for (const symbol of symbols) {
        try {
          const ticks = await derivApi.getTicks(symbol, 1000);
          ticksRef.current[symbol] = ticks.map((t: any) => ({
            epoch: t.epoch,
            quote: t.quote,
            digit: Math.floor(t.quote % 10)
          }));
        } catch (error) {
          console.error(`Failed to fetch ${symbol}:`, error);
          ticksRef.current[symbol] = [];
        }
      }
      
      subsRef.current = derivApi.subscribeTicks(symbols, (tick: any) => {
        const symbol = tick.symbol;
        const newTick = {
          epoch: tick.epoch,
          quote: tick.quote,
          digit: Math.floor(tick.quote % 10)
        };
        
        if (!ticksRef.current[symbol]) {
          ticksRef.current[symbol] = [];
        }
        
        ticksRef.current[symbol].push(newTick);
        if (ticksRef.current[symbol].length > 1000) {
          ticksRef.current[symbol] = ticksRef.current[symbol].slice(-1000);
        }
        
        if (frameRef.current) cancelAnimationFrame(frameRef.current);
        frameRef.current = requestAnimationFrame(updateData);
      });
      
      if (isMounted) {
        setConnected(true);
        setLoading(false);
        updateData();
      }
    };
    
    const updateData = () => {
      const newData: Record<string, MarketData> = {};
      
      symbols.forEach(symbol => {
        const ticks = ticksRef.current[symbol] || [];
        const analysis = analyzeMarket(ticks);
        
        newData[symbol] = {
          symbol,
          ticks,
          lastDigit: analysis.lastDigit || 0,
          lastQuote: analysis.lastQuote || 0,
          evenPercent: analysis.evenPercent || 0,
          oddPercent: analysis.oddPercent || 0,
          lowPercent: analysis.lowPercent || 0,
          highPercent: analysis.highPercent || 0,
          volatility: analysis.volatility || 0,
          trend: analysis.trend || 'NEUTRAL',
          signal: analysis.signal || null,
          confidence: analysis.confidence || 0,
          updateTime: Date.now()
        };
      });
      
      if (isMounted) {
        setData(newData);
      }
    };
    
    init();
    
    return () => {
      isMounted = false;
      if (subsRef.current) subsRef.current();
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [symbols]);
  
  return { data, loading, connected };
};

// ==================== COMPACT BOT CARD ====================
const BotCard = memo(({ 
  bot, 
  market,
  onStart,
  onStop,
  onPause,
  onUpdate,
  onExpand
}: { 
  bot: BotConfig;
  market?: MarketData;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onPause: (id: string) => void;
  onUpdate: (id: string, updates: Partial<BotConfig>) => void;
  onExpand: (id: string) => void;
}) => {
  const StrategyIcon = bot.strategy.icon;
  const statusClass = STATUS_CLASSES[bot.status] || STATUS_CLASSES.IDLE;
  const strategyColor = COLOR_CLASSES[bot.strategy.color as keyof typeof COLOR_CLASSES] || COLOR_CLASSES.emerald;
  
  const getStatusColor = () => statusClass.text;
  const getStatusBg = () => statusClass.bg;
  
  const getTrendColor = (trend: string) => {
    switch (trend) {
      case 'BULL': return 'text-emerald-400';
      case 'BEAR': return 'text-rose-400';
      default: return 'text-slate-400';
    }
  };
  
  const getSignalBadgeClass = (signal: string) => {
    switch (signal) {
      case 'EVEN': return 'bg-emerald-500/20 text-emerald-400';
      case 'ODD': return 'bg-purple-500/20 text-purple-400';
      case 'OVER': return 'bg-blue-500/20 text-blue-400';
      case 'UNDER': return 'bg-orange-500/20 text-orange-400';
      default: return 'bg-slate-500/20 text-slate-400';
    }
  };
  
  return (
    <div className={`relative rounded-md border ${getStatusBg()} transition-all duration-200 hover:shadow-lg hover:shadow-black/20 overflow-hidden`}>
      {/* Header - Ultra Compact */}
      <div className="px-2 py-1.5 bg-slate-900/50 flex items-center justify-between border-b border-slate-700/50">
        <div className="flex items-center gap-1.5">
          <div className={`p-0.5 rounded ${strategyColor.bg}`}>
            <StrategyIcon className={`w-3 h-3 ${strategyColor.text}`} />
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] font-semibold text-slate-200 leading-tight">{bot.name}</span>
            <div className="flex items-center gap-1">
              <span className={`text-[8px] font-medium ${getStatusColor()}`}>{bot.status}</span>
              {bot.cooldownRemaining > 0 && (
                <span className="text-[8px] text-purple-400">({bot.cooldownRemaining}s)</span>
              )}
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-1">
          <button
            onClick={() => onExpand(bot.id)}
            className="p-0.5 hover:bg-slate-700 rounded transition-colors"
          >
            <Settings2 className="w-3 h-3 text-slate-500 hover:text-slate-300" />
          </button>
          <Switch
            checked={bot.enabled}
            onCheckedChange={(checked) => onUpdate(bot.id, { enabled: checked })}
            className="scale-60 data-[state=checked]:bg-emerald-500"
          />
        </div>
      </div>

      {/* Market Selector */}
      <div className="px-2 py-1 border-b border-slate-700/30">
        <Select
          value={bot.market || ''}
          onValueChange={(value) => onUpdate(bot.id, { market: value })}
        >
          <SelectTrigger className="h-5 text-[9px] bg-slate-900/50 border-slate-700/50 px-1.5 py-0">
            <SelectValue placeholder="Select market" />
          </SelectTrigger>
          <SelectContent className="bg-slate-900 border-slate-700 text-[9px]">
            {MARKETS.map(m => (
              <SelectItem key={m.id} value={m.id} className="text-[9px] py-1">
                <span className="flex items-center gap-1">
                  <span>{m.icon}</span>
                  <span className="text-slate-200">{m.name}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Live Data Grid */}
      {market && (
        <div className="px-2 py-1 grid grid-cols-4 gap-1 border-b border-slate-700/30 bg-slate-800/20">
          <div className="text-center">
            <div className="text-[7px] text-slate-500 uppercase tracking-wider">Digit</div>
            <div className="text-[11px] font-bold font-mono text-slate-200">{market.lastDigit}</div>
          </div>
          <div className="text-center">
            <div className="text-[7px] text-slate-500 uppercase tracking-wider">Quote</div>
            <div className="text-[9px] font-mono text-slate-300 truncate">{market.lastQuote.toFixed(4)}</div>
          </div>
          <div className="text-center">
            <div className="text-[7px] text-slate-500 uppercase tracking-wider">Vol</div>
            <div className="text-[9px] font-mono text-slate-300">{market.volatility.toFixed(1)}</div>
          </div>
          <div className="text-center">
            <div className="text-[7px] text-slate-500 uppercase tracking-wider">Trend</div>
            <div className={`text-[9px] font-bold ${getTrendColor(market.trend)}`}>
              {market.trend === 'BULL' ? '↑' : market.trend === 'BEAR' ? '↓' : '→'}
            </div>
          </div>
        </div>
      )}

      {/* Percentage Bars */}
      {market && (
        <div className="px-2 py-1 space-y-1 border-b border-slate-700/30">
          <div className="flex items-center gap-2">
            <span className="text-[8px] text-slate-500 w-8">Even</span>
            <div className="flex-1 h-1.5 bg-slate-700/50 rounded-full overflow-hidden">
              <div 
                className="h-full bg-emerald-500 transition-all duration-300" 
                style={{ width: `${market.evenPercent}%` }}
              />
            </div>
            <span className="text-[8px] font-mono text-emerald-400 w-8 text-right">{market.evenPercent.toFixed(0)}%</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[8px] text-slate-500 w-8">Odd</span>
            <div className="flex-1 h-1.5 bg-slate-700/50 rounded-full overflow-hidden">
              <div 
                className="h-full bg-purple-500 transition-all duration-300" 
                style={{ width: `${market.oddPercent}%` }}
              />
            </div>
            <span className="text-[8px] font-mono text-purple-400 w-8 text-right">{market.oddPercent.toFixed(0)}%</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[8px] text-slate-500 w-8">Low</span>
            <div className="flex-1 h-1.5 bg-slate-700/50 rounded-full overflow-hidden">
              <div 
                className="h-full bg-blue-500 transition-all duration-300" 
                style={{ width: `${market.lowPercent}%` }}
              />
            </div>
            <span className="text-[8px] font-mono text-blue-400 w-8 text-right">{market.lowPercent.toFixed(0)}%</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[8px] text-slate-500 w-8">High</span>
            <div className="flex-1 h-1.5 bg-slate-700/50 rounded-full overflow-hidden">
              <div 
                className="h-full bg-orange-500 transition-all duration-300" 
                style={{ width: `${market.highPercent}%` }}
              />
            </div>
            <span className="text-[8px] font-mono text-orange-400 w-8 text-right">{market.highPercent.toFixed(0)}%</span>
          </div>
        </div>
      )}

      {/* Signal Display */}
      {market?.signal && (
        <div className="px-2 py-1 border-b border-slate-700/30 bg-slate-800/30">
          <div className="flex items-center justify-between">
            <span className="text-[8px] text-slate-500">Signal</span>
            <Badge className={`h-4 px-1.5 text-[8px] font-bold border-0 ${getSignalBadgeClass(market.signal)}`}>
              {market.signal} {market.confidence.toFixed(0)}%
            </Badge>
          </div>
        </div>
      )}

      {/* Entry System Indicator */}
      {bot.entryEnabled && (
        <div className="px-2 py-0.5 border-b border-slate-700/30 bg-yellow-500/5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <Target className="w-2.5 h-2.5 text-yellow-500" />
              <span className="text-[8px] text-yellow-500">Entry: {bot.entryCondition} {bot.entryDigit}</span>
            </div>
            {bot.entryTriggered ? (
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
            ) : (
              <Clock className="w-3 h-3 text-slate-500" />
            )}
          </div>
        </div>
      )}

      {/* Stats Row */}
      <div className="px-2 py-1 grid grid-cols-3 gap-1 border-b border-slate-700/30 bg-slate-800/20">
        <div className="text-center">
          <div className="text-[7px] text-slate-500">P&L</div>
          <div className={`text-[9px] font-bold font-mono ${bot.totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            ${bot.totalPnl.toFixed(2)}
          </div>
        </div>
        <div className="text-center">
          <div className="text-[7px] text-slate-500">W/L</div>
          <div className="text-[9px] font-mono">
            <span className="text-emerald-400">{bot.wins}</span>
            <span className="text-slate-600 mx-0.5">/</span>
            <span className="text-rose-400">{bot.losses}</span>
          </div>
        </div>
        <div className="text-center">
          <div className="text-[7px] text-slate-500">Win%</div>
          <div className="text-[9px] font-bold font-mono text-yellow-400">
            {bot.trades > 0 ? ((bot.wins / bot.trades) * 100).toFixed(0) : 0}%
          </div>
        </div>
      </div>

      {/* Stake Info */}
      <div className="px-2 py-1 flex items-center justify-between border-b border-slate-700/30">
        <span className="text-[8px] text-slate-500">Stake</span>
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] font-mono text-emerald-400">${bot.currentStake.toFixed(2)}</span>
          {bot.stakeType === 'MARTINGALE' && (
            <Badge variant="outline" className="h-3 px-1 text-[6px] border-slate-600 text-slate-400">
              M{bot.martingaleMultiplier}x
            </Badge>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="p-1.5 bg-slate-900/30">
        {!bot.running ? (
          <Button
            onClick={() => onStart(bot.id)}
            disabled={!bot.enabled || !bot.market}
            size="sm"
            className="w-full h-6 text-[9px] bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Play className="w-3 h-3 mr-1" />
            START BOT
          </Button>
        ) : (
          <div className="grid grid-cols-4 gap-1">
            <Button
              onClick={() => onPause(bot.id)}
              size="sm"
              variant="outline"
              className="h-6 text-[8px] border-slate-600 hover:bg-slate-700 col-span-1 px-1"
            >
              {bot.paused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
            </Button>
            <Button
              onClick={() => onStop(bot.id)}
              size="sm"
              variant="destructive"
              className="h-6 text-[9px] col-span-3 bg-rose-600 hover:bg-rose-700"
            >
              <Square className="w-3 h-3 mr-1" />
              STOP
            </Button>
          </div>
        )}
      </div>

      {/* Expanded Settings */}
      <AnimatePresence>
        {bot.expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden bg-slate-900/50 border-t border-slate-700/50"
          >
            <div className="p-2 space-y-2">
              {/* Strategy Selector */}
              <div className="space-y-1">
                <Label className="text-[8px] text-slate-400 uppercase">Strategy</Label>
                <Select
                  value={bot.strategy.id}
                  onValueChange={(value) => {
                    const strategy = STRATEGIES.find(s => s.id === value);
                    if (strategy) onUpdate(bot.id, { strategy });
                  }}
                >
                  <SelectTrigger className="h-6 text-[9px] bg-slate-800 border-slate-700">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700">
                    {STRATEGIES.map(s => (
                      <SelectItem key={s.id} value={s.id} className="text-[9px]">
                        <span className="flex items-center gap-2">
                          <s.icon className="w-3 h-3" />
                          {s.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Separator className="bg-slate-700/50" />

              {/* Entry System */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-[8px] text-slate-400 uppercase">Entry System</Label>
                  <Switch
                    checked={bot.entryEnabled}
                    onCheckedChange={(checked) => onUpdate(bot.id, { entryEnabled: checked })}
                    className="scale-75"
                  />
                </div>
                
                {bot.entryEnabled && (
                  <div className="flex items-center gap-2">
                    <Select
                      value={bot.entryCondition}
                      onValueChange={(value: 'EQUAL' | 'GREATER' | 'LESS') => onUpdate(bot.id, { entryCondition: value })}
                    >
                      <SelectTrigger className="h-6 w-16 text-[9px] bg-slate-800 border-slate-700">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-800 border-slate-700">
                        <SelectItem value="EQUAL" className="text-[9px]">=</SelectItem>
                        <SelectItem value="GREATER" className="text-[9px]">&gt;</SelectItem>
                        <SelectItem value="LESS" className="text-[9px]">&lt;</SelectItem>
                      </SelectContent>
                    </Select>
                    
                    <Input
                      type="number"
                      min="0"
                      max="9"
                      value={bot.entryDigit}
                      onChange={(e) => onUpdate(bot.id, { entryDigit: parseInt(e.target.value) || 0 })}
                      className="h-6 w-14 text-[9px] bg-slate-800 border-slate-700"
                    />
                    
                    <Badge className={`h-5 text-[7px] border-0 ml-auto ${
                      bot.entryTriggered ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-700 text-slate-400'
                    }`}>
                      {bot.entryTriggered ? 'TRIGGERED' : 'WAITING'}
                    </Badge>
                  </div>
                )}
              </div>

              <Separator className="bg-slate-700/50" />

              {/* Risk Management */}
              <div className="space-y-1.5">
                <Label className="text-[8px] text-slate-400 uppercase">Risk Management</Label>
                
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-0.5">
                    <span className="text-[7px] text-slate-500">Take Profit ($)</span>
                    <Input
                      type="number"
                      value={bot.takeProfit}
                      onChange={(e) => onUpdate(bot.id, { takeProfit: parseFloat(e.target.value) || 0 })}
                      className="h-6 text-[9px] bg-slate-800 border-slate-700"
                    />
                  </div>
                  <div className="space-y-0.5">
                    <span className="text-[7px] text-slate-500">Stop Loss ($)</span>
                    <Input
                      type="number"
                      value={bot.stopLoss}
                      onChange={(e) => onUpdate(bot.id, { stopLoss: parseFloat(e.target.value) || 0 })}
                      className="h-6 text-[9px] bg-slate-800 border-slate-700"
                    />
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-0.5">
                    <span className="text-[7px] text-slate-500">Initial Stake ($)</span>
                    <Input
                      type="number"
                      step="0.1"
                      value={bot.stake}
                      onChange={(e) => onUpdate(bot.id, { stake: parseFloat(e.target.value) || 0 })}
                      className="h-6 text-[9px] bg-slate-800 border-slate-700"
                    />
                  </div>
                  <div className="space-y-0.5">
                    <span className="text-[7px] text-slate-500">Max Trades</span>
                    <Input
                      type="number"
                      value={bot.maxTrades}
                      onChange={(e) => onUpdate(bot.id, { maxTrades: parseInt(e.target.value) || 0 })}
                      className="h-6 text-[9px] bg-slate-800 border-slate-700"
                    />
                  </div>
                </div>
                
                <div className="flex items-center justify-between pt-1">
                  <span className="text-[7px] text-slate-500">Stake Type</span>
                  <Select
                    value={bot.stakeType}
                    onValueChange={(value: 'FIXED' | 'MARTINGALE') => onUpdate(bot.id, { stakeType: value })}
                  >
                    <SelectTrigger className="h-6 w-24 text-[9px] bg-slate-800 border-slate-700">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-800 border-slate-700">
                      <SelectItem value="FIXED" className="text-[9px]">Fixed</SelectItem>
                      <SelectItem value="MARTINGALE" className="text-[9px]">Martingale</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                {bot.stakeType === 'MARTINGALE' && (
                  <div className="flex items-center justify-between">
                    <span className="text-[7px] text-slate-500">Multiplier</span>
                    <Input
                      type="number"
                      min="1.1"
                      step="0.1"
                      value={bot.martingaleMultiplier}
                      onChange={(e) => onUpdate(bot.id, { martingaleMultiplier: parseFloat(e.target.value) || 2 })}
                      className="h-6 w-16 text-[9px] bg-slate-800 border-slate-700"
                    />
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

BotCard.displayName = 'BotCard';

// ==================== MAIN COMPONENT ====================
export default function AutoTrade() {
  const { isAuthorized, balance } = useAuth();
  const [bots, setBots] = useState<BotConfig[]>([]);
  const [trades, setTrades] = useState<TradeLog[]>([]);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [lastScan, setLastScan] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState('bots');
  
  const { data: marketData, loading, connected } = useMarketData(MARKETS.map(m => m.id));
  const runningRefs = useRef<Record<string, boolean>>({});
  const audioContext = useRef<AudioContext | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Initialize bots - 12 bots for grid layout
  useEffect(() => {
    const initial: BotConfig[] = [];
    for (let i = 0; i < 12; i++) {
      const strategy = STRATEGIES[i % 4];
      initial.push({
        id: `bot-${i}`,
        name: `Bot ${i + 1}`,
        strategy,
        market: null,
        enabled: true,
        running: false,
        paused: false,
        status: 'IDLE',
        entryEnabled: false,
        entryDigit: 0,
        entryCondition: 'EQUAL',
        entryTriggered: false,
        stake: 0.5,
        stakeType: 'FIXED',
        martingaleMultiplier: 2,
        takeProfit: 5,
        stopLoss: 30,
        maxTrades: 100,
        trades: 0,
        wins: 0,
        losses: 0,
        totalPnl: 0,
        currentStake: 0.5,
        consecutiveLosses: 0,
        cooldownRemaining: 0,
        lastSignal: false,
        expanded: false
      });
    }
    setBots(initial);
  }, []);

  // Play sound effects
  const playSound = useCallback((type: 'entry' | 'win' | 'loss') => {
    if (!soundEnabled) return;
    
    try {
      if (!audioContext.current) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        audioContext.current = new AudioContextClass();
      }
      
      if (audioContext.current.state === 'suspended') {
        audioContext.current.resume();
      }
      
      const ctx = audioContext.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      if (type === 'win') {
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.3);
      } else if (type === 'loss') {
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(220, ctx.currentTime + 0.2);
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.3);
      } else {
        osc.frequency.setValueAtTime(660, ctx.currentTime);
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.1);
      }
    } catch (e) {
      console.error('Audio error:', e);
    }
  }, [soundEnabled]);

  // Auto scan best markets
  const scanMarkets = useCallback(() => {
    const markets = Object.entries(marketData)
      .map(([symbol, data]) => ({
        symbol,
        volatility: data.volatility,
        signal: data.signal,
        confidence: data.confidence
      }))
      .sort((a, b) => b.volatility - a.volatility);
    
    if (markets.length > 0) {
      setBots(prev => prev.map((bot, i) => {
        const bestMarket = markets[i % markets.length];
        return { ...bot, market: bestMarket?.symbol || null };
      }));
      
      setLastScan(Date.now());
      toast.success(`Markets scanned: Assigned top ${Math.min(markets.length, 12)} volatile markets`);
      playSound('entry');
    }
  }, [marketData, playSound]);

  // Bot trading logic
  const runBot = useCallback(async (botId: string) => {
    const bot = bots.find(b => b.id === botId);
    if (!bot || !bot.market || !isAuthorized) return;
    
    const market = marketData[bot.market];
    if (!market) return;
    
    if (balance < bot.currentStake) {
      toast.error(`${bot.name}: Insufficient balance`);
      stopBot(botId);
      return;
    }
    
    setBots(prev => prev.map(b => 
      b.id === botId ? { 
        ...b, 
        running: true,
        status: bot.entryEnabled ? 'WAITING_ENTRY' : 'ANALYZING',
        currentStake: bot.stake,
        entryTriggered: !bot.entryEnabled
      } : b
    ));
    
    runningRefs.current[botId] = true;
    
    // Initialize local variables
    let trades = bot.trades;
    let wins = bot.wins;
    let losses = bot.losses;
    let totalPnl = bot.totalPnl;
    let currentStake = bot.stake;
    let consecutiveLosses = 0;
    let entryTriggered = !bot.entryEnabled;
    let cooldown = 0;
    
    // Create abort controller for this bot
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    
    while (runningRefs.current[botId] && !abortController.signal.aborted) {
      // Check if bot should stop
      if (!runningRefs.current[botId]) break;
      
      // Check profit/loss limits
      if (totalPnl <= -bot.stopLoss) {
        toast.error(`${bot.name}: Stop Loss reached ($${totalPnl.toFixed(2)})`);
        playSound('loss');
        break;
      }
      if (totalPnl >= bot.takeProfit) {
        toast.success(`${bot.name}: Take Profit reached ($${totalPnl.toFixed(2)})`);
        playSound('win');
        break;
      }
      if (trades >= bot.maxTrades) {
        toast.info(`${bot.name}: Max trades reached`);
        break;
      }
      
      // Handle cooldown
      if (cooldown > 0) {
        setBots(prev => prev.map(b => 
          b.id === botId ? { ...b, status: 'COOLDOWN', cooldownRemaining: cooldown } : b
        ));
        await new Promise(r => setTimeout(r, 1000));
        cooldown--;
        continue;
      }
      
      const currentMarket = marketData[bot.market!];
      if (!currentMarket) {
        await new Promise(r => setTimeout(r, 500));
        continue;
      }
      
      const ticks = currentMarket.ticks;
      const lastDigit = ticks[ticks.length - 1]?.digit;
      
      // Check entry condition
      if (!entryTriggered && bot.entryEnabled) {
        let entryMet = false;
        switch (bot.entryCondition) {
          case 'EQUAL': entryMet = lastDigit === bot.entryDigit; break;
          case 'GREATER': entryMet = lastDigit > bot.entryDigit; break;
          case 'LESS': entryMet = lastDigit < bot.entryDigit; break;
        }
        
        if (entryMet) {
          entryTriggered = true;
          setBots(prev => prev.map(b => 
            b.id === botId ? { ...b, status: 'ANALYZING', entryTriggered: true } : b
          ));
          playSound('entry');
          toast.success(`${bot.name}: Entry condition met (${bot.entryCondition} ${bot.entryDigit})`);
        } else {
          await new Promise(r => setTimeout(r, 500));
          continue;
        }
      }
      
      // Analyze for signal
      setBots(prev => prev.map(b => b.id === botId ? { ...b, status: 'ANALYZING' } : b));
      
      let shouldEnter = false;
      let prediction = '';
      
      switch (bot.strategy.type) {
        case 'EVEN':
          if (currentMarket.oddPercent > bot.strategy.conditions.dominantPercent) {
            shouldEnter = checkConsecutive(ticks, 2, d => d % 2 === 1);
            prediction = 'EVEN';
          }
          break;
        case 'ODD':
          if (currentMarket.evenPercent > bot.strategy.conditions.dominantPercent) {
            shouldEnter = checkConsecutive(ticks, 2, d => d % 2 === 0);
            prediction = 'ODD';
          }
          break;
        case 'OVER':
          if (currentMarket.lowPercent > bot.strategy.conditions.dominantPercent) {
            shouldEnter = checkConsecutive(ticks, 2, d => d <= 4);
            prediction = 'OVER5';
          }
          break;
        case 'UNDER':
          if (currentMarket.highPercent > bot.strategy.conditions.dominantPercent) {
            shouldEnter = checkConsecutive(ticks, 2, d => d >= 5);
            prediction = 'UNDER4';
          }
          break;
      }
      
      setBots(prev => prev.map(b => b.id === botId ? { ...b, lastSignal: shouldEnter } : b));
      
      if (!shouldEnter) {
        await new Promise(r => setTimeout(r, 500));
        continue;
      }
      
      // Ready to trade
      setBots(prev => prev.map(b => b.id === botId ? { ...b, status: 'READY' } : b));
      await new Promise(r => setTimeout(r, 200));
      
      // Execute trade
      setBots(prev => prev.map(b => b.id === botId ? { ...b, status: 'TRADING' } : b));
      
      try {
        const contractType = 
          prediction === 'EVEN' ? 'DIGITEVEN' :
          prediction === 'ODD' ? 'DIGITODD' :
          prediction === 'OVER5' ? 'DIGITOVER' : 'DIGITUNDER';
        
        const barrier = prediction === 'OVER5' ? '5' : prediction === 'UNDER4' ? '4' : undefined;
        
        const params: any = {
          contract_type: contractType,
          symbol: bot.market,
          duration: 1,
          duration_unit: 't',
          basis: 'stake',
          amount: currentStake,
        };
        
        if (barrier) params.barrier = barrier;
        
        const tradeId = `${botId}-${Date.now()}`;
        const { contractId } = await derivApi.buyContract(params);
        const result = await derivApi.waitForContractResult(contractId);
        
        const won = result.status === 'won';
        const pnl = result.profit;
        
        trades++;
        totalPnl += pnl;
        
        if (won) {
          wins++;
          consecutiveLosses = 0;
          currentStake = bot.stake;
          playSound('win');
        } else {
          losses++;
          consecutiveLosses++;
          if (bot.stakeType === 'MARTINGALE') {
            currentStake = Math.round(currentStake * bot.martingaleMultiplier * 100) / 100;
          }
          playSound('loss');
        }
        
        setTrades(prev => [{
          id: tradeId,
          time: Date.now(),
          botId,
          botName: bot.name,
          market: bot.market!,
          strategy: bot.strategy.name,
          stake: currentStake,
          entry: lastDigit || 0,
          exit: result.digit,
          result: won ? 'WIN' : 'LOSS',
          pnl,
          confidence: currentMarket.confidence
        }, ...prev].slice(0, 100));
        
        setBots(prev => prev.map(b => {
          if (b.id === botId) {
            return {
              ...b,
              trades,
              wins,
              losses,
              totalPnl,
              currentStake: won ? bot.stake : currentStake,
              consecutiveLosses,
              status: 'ANALYZING',
              cooldownRemaining: !won ? 2 : 0
            };
          }
          return b;
        }));
        
      } catch (err: any) {
        console.error('Trade error:', err);
        if (err.message?.includes('Insufficient balance')) {
          toast.error(`${bot.name}: Insufficient balance`);
          break;
        }
      }
      
      await new Promise(r => setTimeout(r, 1000));
    }
    
    setBots(prev => prev.map(b => 
      b.id === botId ? { 
        ...b, 
        running: false, 
        status: 'STOPPED',
        cooldownRemaining: 0,
        entryTriggered: false
      } : b
    ));
    
    runningRefs.current[botId] = false;
  }, [bots, marketData, isAuthorized, balance, playSound]);

  const startBot = useCallback((id: string) => {
    const bot = bots.find(b => b.id === id);
    if (!bot || bot.running) return;
    runBot(id);
  }, [bots, runBot]);

  const pauseBot = useCallback((id: string) => {
    setBots(prev => prev.map(b => b.id === id ? { ...b, paused: !b.paused } : b));
  }, []);

  const stopBot = useCallback((id: string) => {
    runningRefs.current[id] = false;
    setBots(prev => prev.map(b => 
      b.id === id ? { 
        ...b, 
        running: false, 
        paused: false,
        status: 'STOPPED',
        cooldownRemaining: 0,
        entryTriggered: false
      } : b
    ));
  }, []);

  const stopAllBots = useCallback(() => {
    Object.keys(runningRefs.current).forEach(id => {
      runningRefs.current[id] = false;
    });
    setBots(prev => prev.map(b => ({ 
      ...b, 
      running: false, 
      paused: false,
      status: 'STOPPED',
      cooldownRemaining: 0,
      entryTriggered: false
    })));
    toast.success('All bots stopped');
  }, []);

  const updateBot = useCallback((id: string, updates: Partial<BotConfig>) => {
    setBots(prev => prev.map(b => b.id === id ? { ...b, ...updates } : b));
  }, []);

  const clearAll = useCallback(() => {
    stopAllBots();
    setTrades([]);
    setBots(prev => prev.map(b => ({
      ...b,
      trades: 0,
      wins: 0,
      losses: 0,
      totalPnl: 0,
      currentStake: b.stake,
      consecutiveLosses: 0,
      status: 'IDLE',
      entryTriggered: false
    })));
    toast.success('All statistics cleared');
  }, [stopAllBots]);

  const totalPnl = bots.reduce((sum, b) => sum + b.totalPnl, 0);
  const totalTrades = bots.reduce((sum, b) => sum + b.trades, 0);
  const totalWins = bots.reduce((sum, b) => sum + b.wins, 0);
  const winRate = totalTrades > 0 ? ((totalWins / totalTrades) * 100).toFixed(1) : '0';
  const activeBots = bots.filter(b => b.running).length;

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-200 font-sans antialiased selection:bg-emerald-500/30">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-[#0f172a]/95 backdrop-blur-md border-b border-slate-800/50 shadow-lg shadow-black/20">
        <div className="px-3 py-2">
          <div className="flex items-center justify-between">
            {/* Logo & Title */}
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-gradient-to-br from-emerald-500/20 to-blue-500/20 rounded-lg border border-emerald-500/20">
                <Brain className="w-4 h-4 text-emerald-400" />
              </div>
              <div>
                <h1 className="text-sm font-bold bg-gradient-to-r from-emerald-400 to-blue-400 bg-clip-text text-transparent">
                  AI Trading System
                </h1>
                <p className="text-[9px] text-slate-500 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  v2.0 • {bots.length} Bots • {activeBots} Active
                </p>
              </div>
            </div>

            {/* Stats */}
            <div className="flex items-center gap-1.5">
              <div className="px-2 py-1 bg-slate-800/50 rounded-md border border-slate-700/50">
                <div className="text-[7px] text-slate-500 uppercase tracking-wider">Balance</div>
                <div className="text-[10px] font-mono font-bold text-slate-200">${balance?.toFixed(2) || '0.00'}</div>
              </div>
              
              <div className={`px-2 py-1 rounded-md border ${totalPnl >= 0 ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-rose-500/10 border-rose-500/30'}`}>
                <div className={`text-[7px] uppercase tracking-wider ${totalPnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>P&L</div>
                <div className={`text-[10px] font-mono font-bold ${totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}
                </div>
              </div>

              <div className="px-2 py-1 bg-slate-800/50 rounded-md border border-slate-700/50">
                <div className="text-[7px] text-slate-500 uppercase tracking-wider">Win Rate</div>
                <div className="text-[10px] font-mono font-bold text-yellow-400">{winRate}%</div>
              </div>

              <div className="px-2 py-1 bg-slate-800/50 rounded-md border border-slate-700/50">
                <div className="text-[7px] text-slate-500 uppercase tracking-wider">Trades</div>
                <div className="text-[10px] font-mono font-bold text-blue-400">{totalTrades}</div>
              </div>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-1">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      onClick={scanMarkets}
                      size="sm"
                      className="h-7 px-2 text-[10px] bg-emerald-600 hover:bg-emerald-700 border-0"
                    >
                      <Scan className="w-3 h-3 mr-1" />
                      SCAN
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-[10px]">
                    Auto-assign best markets
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      onClick={stopAllBots}
                      size="sm"
                      variant="destructive"
                      className="h-7 px-2 text-[10px] bg-rose-600 hover:bg-rose-700 border-0"
                      disabled={activeBots === 0}
                    >
                      <Square className="w-3 h-3 mr-1" />
                      STOP ALL
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-[10px]">
                    Stop all running bots
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      onClick={clearAll}
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-[10px] border-slate-700 hover:bg-slate-800"
                    >
                      <Trash2 className="w-3 h-3 mr-1" />
                      CLEAR
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-[10px]">
                    Reset all statistics
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <div className="w-px h-6 bg-slate-700 mx-1" />

              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
              >
                {viewMode === 'grid' ? (
                  <List className="w-3.5 h-3.5 text-slate-400" />
                ) : (
                  <Grid3X3 className="w-3.5 h-3.5 text-slate-400" />
                )}
              </Button>

              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setSoundEnabled(!soundEnabled)}
              >
                {soundEnabled ? (
                  <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <VolumeX className="w-3.5 h-3.5 text-slate-500" />
                )}
              </Button>
            </div>
          </div>

          {/* Connection Status */}
          <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-slate-800/50">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className={`h-4 px-1.5 text-[8px] border-0 ${
                connected ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
              }`}>
                {connected ? <Wifi className="w-2.5 h-2.5 mr-1" /> : <WifiOff className="w-2.5 h-2.5 mr-1" />}
                {connected ? 'Connected' : 'Disconnected'}
              </Badge>
              {lastScan && (
                <span className="text-[8px] text-slate-600">
                  Last scan: {new Date(lastScan).toLocaleTimeString()}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[8px] text-slate-600">Active:</span>
              <span className="text-[9px] font-mono text-emerald-400">{activeBots}</span>
              <span className="text-[8px] text-slate-600">/ {bots.length}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="p-2">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="w-full grid grid-cols-2 bg-slate-800/50 p-0.5 h-8 mb-2">
            <TabsTrigger value="bots" className="text-[10px] data-[state=active]:bg-slate-700">
              <Grid3X3 className="w-3 h-3 mr-1" />
              Trading Bots ({bots.length})
            </TabsTrigger>
            <TabsTrigger value="trades" className="text-[10px] data-[state=active]:bg-slate-700">
              <Activity className="w-3 h-3 mr-1" />
              Trade Log ({trades.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="bots" className="mt-0">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-12 space-y-2">
                <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
                <span className="text-[10px] text-slate-500">Initializing market data...</span>
              </div>
            ) : (
              <div className={viewMode === 'grid' 
                ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2" 
                : "grid grid-cols-1 gap-2"
              }>
                {bots.map(bot => (
                  <BotCard
                    key={bot.id}
                    bot={bot}
                    market={bot.market ? marketData[bot.market] : undefined}
                    onStart={startBot}
                    onStop={stopBot}
                    onPause={pauseBot}
                    onUpdate={updateBot}
                    onExpand={(id) => updateBot(id, { expanded: !bots.find(b => b.id === id)?.expanded })}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="trades" className="mt-0">
            <div className="bg-[#1e293b] rounded-lg border border-slate-700/50 overflow-hidden">
              <div className="px-3 py-2 bg-slate-800/50 border-b border-slate-700/50 flex items-center justify-between">
                <h2 className="text-[10px] font-semibold text-slate-300 uppercase tracking-wider">Recent Trades</h2>
                <Badge variant="outline" className="h-4 px-1.5 text-[8px] border-slate-700">
                  {trades.length} total
                </Badge>
              </div>
              
              <div className="max-h-[calc(100vh-200px)] overflow-y-auto">
                {trades.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-slate-600">
                    <Activity className="w-8 h-8 mb-2 opacity-50" />
                    <span className="text-[10px]">No trades executed yet</span>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-700/30">
                    {trades.map((trade) => (
                      <div
                        key={trade.id}
                        className="px-3 py-2 flex items-center justify-between hover:bg-slate-800/30 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                            trade.result === 'WIN' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                          }`}>
                            {trade.result === 'WIN' ? 'W' : 'L'}
                          </div>
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-[9px] font-medium text-slate-300">{trade.botName}</span>
                              <Badge className="h-3 px-1 text-[6px] bg-slate-700 text-slate-400 border-0">
                                {trade.strategy}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-2 text-[8px] text-slate-500">
                              <span>{trade.market}</span>
                              <span>•</span>
                              <span>{new Date(trade.time).toLocaleTimeString()}</span>
                            </div>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <div className="text-[9px] font-mono text-slate-400">
                              Entry: {trade.entry} → Exit: {trade.exit}
                            </div>
                            <div className="text-[8px] text-slate-500">
                              Stake: ${trade.stake.toFixed(2)}
                            </div>
                          </div>
                          <div className={`text-right min-w-[60px] ${
                            trade.result === 'WIN' ? 'text-emerald-400' : 'text-rose-400'
                          }`}>
                            <div className="text-[11px] font-bold font-mono">
                              {trade.result === 'WIN' ? '+' : ''}${trade.pnl.toFixed(2)}
                            </div>
                            <div className="text-[8px] text-slate-500">
                              {trade.confidence.toFixed(0)}% conf
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </main>

      {/* Footer */}
      <footer className="fixed bottom-0 left-0 right-0 bg-[#0f172a]/95 backdrop-blur border-t border-slate-800/50 px-3 py-1">
        <div className="flex items-center justify-between text-[8px] text-slate-600">
          <span>AI Trading System v2.0</span>
          <span>Real-time Market Analysis • {Object.keys(marketData).length} Markets</span>
        </div>
      </footer>
      
      {/* Spacer for fixed footer */}
      <div className="h-6" />
    </div>
  );
  }
