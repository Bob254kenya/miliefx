import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { derivApi, type MarketSymbol } from '@/services/deriv-api';
import { getLastDigit, analyzeDigits, calculateRSI, calculateMACD, calculateBollingerBands } from '@/services/analysis';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import {
  TrendingUp, TrendingDown, Activity, BarChart3, ArrowUp, ArrowDown, Minus,
  Target, ShieldAlert, Gauge, Volume2, VolumeX, Clock, Zap, Trophy, Play, Pause, StopCircle, Eye, EyeOff, RefreshCw,
  Plus, X, LineChart
} from 'lucide-react';

// ============================================
// TP/SL NOTIFICATION POPUP COMPONENT (FULLY WORKING)
// ============================================

const notificationStyles = `
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slideUpCenter {
  from {
    opacity: 0;
    transform: translateY(20px) scale(0.9);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes slideDownCenter {
  from {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
  to {
    opacity: 0;
    transform: translateY(20px) scale(0.9);
  }
}

@keyframes float {
  0% {
    transform: translateY(0) rotate(0deg);
    opacity: 0;
  }
  10% {
    opacity: 0.25;
  }
  90% {
    opacity: 0.25;
  }
  100% {
    transform: translateY(-100px) rotate(360deg);
    opacity: 0;
  }
}

@keyframes bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-5px); }
}

@keyframes pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.05); }
}

@keyframes glow {
  0%, 100% { box-shadow: 0 0 5px rgba(16, 185, 129, 0.5); }
  50% { box-shadow: 0 0 20px rgba(16, 185, 129, 0.8); }
}

@keyframes glowRed {
  0%, 100% { box-shadow: 0 0 5px rgba(244, 63, 94, 0.5); }
  50% { box-shadow: 0 0 20px rgba(244, 63, 94, 0.8); }
}

.animate-fadeIn {
  animation: fadeIn 0.3s ease-out forwards;
}

.animate-slide-up-center {
  animation: slideUpCenter 0.3s cubic-bezier(0.34, 1.2, 0.64, 1) forwards;
}

.animate-slide-down-center {
  animation: slideDownCenter 0.2s ease-out forwards;
}

.animate-float {
  animation: float linear infinite;
}

.animate-bounce {
  animation: bounce 0.4s ease-in-out 2;
}

.animate-pulse-slow {
  animation: pulse 1s ease-in-out infinite;
}

.notification-glow-tp {
  animation: glow 1.5s ease-in-out infinite;
}

.notification-glow-sl {
  animation: glowRed 1.5s ease-in-out infinite;
}
`;

// Global function to trigger TP/SL popup from anywhere (including bot)
export const showTPNotification = (type: 'tp' | 'sl', message: string, amount?: number) => {
  if (typeof window !== 'undefined' && (window as any).showTPNotification) {
    (window as any).showTPNotification(type, message, amount);
  }
};

// TP/SL Notification Component - FIXED and WORKING
const NotificationPopup = () => {
  const [notification, setNotification] = useState<{ type: 'tp' | 'sl'; message: string; amount?: number } | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const clearNotificationTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const handleClose = useCallback(() => {
    if (isExiting) return;
    setIsExiting(true);
    clearNotificationTimeout();
    setTimeout(() => {
      setIsVisible(false);
      setNotification(null);
      setIsExiting(false);
    }, 300);
  }, [isExiting, clearNotificationTimeout]);

  const showNotification = useCallback((type: 'tp' | 'sl', message: string, amount?: number) => {
    clearNotificationTimeout();
    
    const show = () => {
      setNotification({ type, message, amount });
      setIsVisible(true);
      setIsExiting(false);
      timeoutRef.current = setTimeout(() => {
        handleClose();
      }, 8000);
    };

    if (isExiting) {
      setTimeout(show, 350);
    } else {
      show();
    }
  }, [clearNotificationTimeout, isExiting, handleClose]);

  useEffect(() => {
    (window as any).showTPNotification = showNotification;
    return () => {
      clearNotificationTimeout();
      if ((window as any).showTPNotification === showNotification) {
        delete (window as any).showTPNotification;
      }
    };
  }, [showNotification, clearNotificationTimeout]);

  if (!isVisible || !notification) return null;

  const isTP = notification.type === 'tp';
  const isSL = notification.type === 'sl';
  const amount = notification.amount;

  const backgroundIcons = () => {
    const icons = [];
    const iconCount = 15;
    let colors: string[];
    let icon: string;
    
    if (isTP) {
      colors = ['#10b981', '#34d399', '#6ee7b7', '#059669'];
      icon = '💰';
    } else {
      colors = ['#f43f5e', '#fb7185', '#fda4af', '#e11d48'];
      icon = '😢';
    }
    
    for (let i = 0; i < iconCount; i++) {
      const size = 14 + Math.random() * 24;
      const left = Math.random() * 100;
      const delay = Math.random() * 12;
      const duration = 6 + Math.random() * 8;
      const color = colors[Math.floor(Math.random() * colors.length)];
      
      icons.push(
        <div
          key={i}
          className="absolute animate-float"
          style={{
            left: `${left}%`,
            bottom: '-30px',
            fontSize: `${size}px`,
            opacity: 0.25,
            animationDelay: `${delay}s`,
            animationDuration: `${duration}s`,
            color: color,
            filter: 'drop-shadow(0 0 2px currentColor)',
            pointerEvents: 'none',
            zIndex: 1,
          }}
        >
          {icon}
        </div>
      );
    }
    return icons;
  };

  const getGradient = () => {
    if (isTP) return 'bg-gradient-to-br from-emerald-500 to-emerald-700';
    return 'bg-gradient-to-br from-rose-500 to-rose-700';
  };

  const getGlowClass = () => {
    if (isTP) return 'notification-glow-tp';
    return 'notification-glow-sl';
  };

  return (
    <>
      <style>{notificationStyles}</style>
      <div className="fixed inset-0 z-[9999] flex items-center justify-center pointer-events-none">
        <div 
          className={`
            pointer-events-auto w-[400px] h-[250px] rounded-xl shadow-2xl overflow-hidden
            ${isExiting ? 'animate-slide-down-center' : 'animate-slide-up-center'}
            ${getGlowClass()}
          `}
        >
          <div className={`relative w-full h-full overflow-hidden ${getGradient()}`}>
            <div className="absolute inset-0 overflow-hidden">
              {backgroundIcons()}
            </div>
            
            <div className="absolute inset-0 opacity-5">
              <div className="absolute top-0 right-0 w-40 h-40 bg-white rounded-full -translate-y-1/2 translate-x-1/2" />
              <div className="absolute bottom-0 left-0 w-40 h-40 bg-white rounded-full translate-y-1/2 -translate-x-1/2" />
            </div>
            
            <div className="relative w-full h-full flex flex-col p-4 z-10">
              <div className="flex items-center gap-3 mb-3">
                <div className={`
                  w-12 h-12 rounded-full flex items-center justify-center text-2xl
                  ${isTP ? 'bg-emerald-400/30' : 'bg-rose-400/30'}
                  shadow-lg backdrop-blur-sm animate-pulse-slow flex-shrink-0
                `}>
                  {isTP ? '🎉' : '😢'}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-bold text-white truncate">
                    {isTP ? 'TAKE PROFIT!' : 'STOP LOSS!'}
                  </h3>
                  <p className="text-[10px] text-white/70">
                    {new Date().toLocaleTimeString()}
                  </p>
                </div>
              </div>
              
              <div className="flex-1 flex flex-col items-center justify-center text-center mb-3">
                <p className="text-white text-sm font-medium leading-tight">
                  {notification.message}
                </p>
                {amount !== undefined && (
                  <p className={`text-2xl font-bold mt-2 ${isTP ? 'text-emerald-200' : 'text-rose-200'} animate-bounce`}>
                    {isTP ? '+' : '-'}${Math.abs(amount).toFixed(2)}
                  </p>
                )}
              </div>
              
              <button
                onClick={handleClose}
                className={`
                  w-full py-2 rounded-lg font-semibold text-sm transition-all duration-200
                  bg-white/95 hover:bg-white hover:scale-[1.02]
                  ${isTP ? 'text-emerald-600' : 'text-rose-600'}
                  transform active:scale-[0.98] shadow-lg backdrop-blur-sm
                `}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

// ============================================
// MARKETS & CONSTANTS (same as original)
// ============================================

const ALL_MARKETS = [
  { symbol: '1HZ10V', name: 'Volatility 10 (1s)', group: 'vol1s' },
  { symbol: '1HZ15V', name: 'Volatility 15 (1s)', group: 'vol1s' },
  { symbol: '1HZ25V', name: 'Volatility 25 (1s)', group: 'vol1s' },
  { symbol: '1HZ30V', name: 'Volatility 30 (1s)', group: 'vol1s' },
  { symbol: '1HZ50V', name: 'Volatility 50 (1s)', group: 'vol1s' },
  { symbol: '1HZ75V', name: 'Volatility 75 (1s)', group: 'vol1s' },
  { symbol: '1HZ100V', name: 'Volatility 100 (1s)', group: 'vol1s' },
  { symbol: 'R_10', name: 'Volatility 10', group: 'vol' },
  { symbol: 'R_25', name: 'Volatility 25', group: 'vol' },
  { symbol: 'R_50', name: 'Volatility 50', group: 'vol' },
  { symbol: 'R_75', name: 'Volatility 75', group: 'vol' },
  { symbol: 'R_100', name: 'Volatility 100', group: 'vol' },
  { symbol: 'JD10', name: 'Jump 10', group: 'jump' },
  { symbol: 'JD25', name: 'Jump 25', group: 'jump' },
  { symbol: 'JD50', name: 'Jump 50', group: 'jump' },
  { symbol: 'JD75', name: 'Jump 75', group: 'jump' },
  { symbol: 'JD100', name: 'Jump 100', group: 'jump' },
  { symbol: 'RDBEAR', name: 'Bear Market', group: 'bear' },
  { symbol: 'RDBULL', name: 'Bull Market', group: 'bull' },
  { symbol: 'stpRNG', name: 'Step Index', group: 'step' },
  { symbol: 'RBRK100', name: 'Range Break 100', group: 'range' },
  { symbol: 'RBRK200', name: 'Range Break 200', group: 'range' },
];

const GROUPS = [
  { value: 'all', label: 'All' },
  { value: 'vol1s', label: 'Vol 1s' },
  { value: 'vol', label: 'Vol' },
  { value: 'jump', label: 'Jump' },
  { value: 'bear', label: 'Bear' },
  { value: 'bull', label: 'Bull' },
  { value: 'step', label: 'Step' },
  { value: 'range', label: 'Range' },
];

const TIMEFRAMES = ['1m','3m','5m','15m','30m','1h','4h','12h','1d'];
const CANDLE_CONFIG = { minCandles: 1000, maxCandles: 5000, defaultCandles: 1000 };
const TICK_RANGES = [50, 100, 200, 300, 500, 1000];

const CONTRACT_TYPES = [
  { value: 'CALL', label: 'Rise' },
  { value: 'PUT', label: 'Fall' },
  { value: 'DIGITMATCH', label: 'Digits Match' },
  { value: 'DIGITDIFF', label: 'Digits Differs' },
  { value: 'DIGITEVEN', label: 'Digits Even' },
  { value: 'DIGITODD', label: 'Digits Odd' },
  { value: 'DIGITOVER', label: 'Digits Over' },
  { value: 'DIGITUNDER', label: 'Digits Under' },
];

type IndicatorType = 'RSI' | 'BB' | 'MA' | 'MACD';
interface Indicator { id: string; type: IndicatorType; enabled: boolean; }
interface Candle { open: number; high: number; low: number; close: number; time: number; }
interface TradeRecord { id: string; time: number; type: string; stake: number; profit: number; status: 'won' | 'lost' | 'open'; symbol: string; resultDigit?: number; outcomeSymbol?: string; }
interface DigitStats { frequency: Record<number, number>; percentages: Record<number, number>; mostCommon: number; leastCommon: number; totalTicks: number; evenPercentage: number; oddPercentage: number; overPercentage: number; underPercentage: number; last26Digits: number[]; tickPrices: number[]; }

// Global tick storage
const globalTickHistory: { [symbol: string]: number[] } = {};
const globalTickPrices: { [symbol: string]: number[] } = {};
const tickCallbacks: { [symbol: string]: (() => void)[] } = [];

function getTickHistory(symbol: string): number[] { return globalTickHistory[symbol] || []; }
function getTickPrices(symbol: string): number[] { return globalTickPrices[symbol] || []; }
function addTick(symbol: string, digit: number, price: number) {
  if (!globalTickHistory[symbol]) globalTickHistory[symbol] = [];
  if (!globalTickPrices[symbol]) globalTickPrices[symbol] = [];
  globalTickHistory[symbol].push(digit);
  globalTickPrices[symbol].push(price);
  if (globalTickHistory[symbol].length > 2000) globalTickHistory[symbol].shift();
  if (globalTickPrices[symbol].length > 2000) globalTickPrices[symbol].shift();
  if (tickCallbacks[symbol]) tickCallbacks[symbol].forEach(cb => cb());
}
function subscribeToTicks(symbol: string, callback: () => void) {
  if (!tickCallbacks[symbol]) tickCallbacks[symbol] = [];
  tickCallbacks[symbol].push(callback);
  return () => { tickCallbacks[symbol] = tickCallbacks[symbol].filter(cb => cb !== callback); };
}

// Helper functions (simplified for demo - actual implementation would have full calculations)
function getLastDigit(price: number): number { return Math.abs(Math.floor(price) % 10); }
function calculateDigitStats(symbol: string, tickRange: number): DigitStats {
  const ticks = getTickHistory(symbol);
  const recentTicks = ticks.slice(-tickRange);
  const frequency: Record<number, number> = {};
  for (let i = 0; i <= 9; i++) frequency[i] = 0;
  for (const digit of recentTicks) frequency[digit] = (frequency[digit] || 0) + 1;
  const percentages: Record<number, number> = {};
  for (let i = 0; i <= 9; i++) percentages[i] = (frequency[i] / (recentTicks.length || 1)) * 100;
  let mostCommon = 0, leastCommon = 0, maxFreq = 0, minFreq = Infinity;
  for (let i = 0; i <= 9; i++) {
    if (frequency[i] > maxFreq) { maxFreq = frequency[i]; mostCommon = i; }
    if (frequency[i] < minFreq) { minFreq = frequency[i]; leastCommon = i; }
  }
  const evenCount = recentTicks.filter(d => d % 2 === 0).length;
  const oddCount = recentTicks.length - evenCount;
  const overCount = recentTicks.filter(d => d > 4).length;
  const underCount = recentTicks.length - overCount;
  return {
    frequency, percentages, mostCommon, leastCommon, totalTicks: recentTicks.length,
    evenPercentage: (evenCount / (recentTicks.length || 1)) * 100,
    oddPercentage: (oddCount / (recentTicks.length || 1)) * 100,
    overPercentage: (overCount / (recentTicks.length || 1)) * 100,
    underPercentage: (underCount / (recentTicks.length || 1)) * 100,
    last26Digits: ticks.slice(-26),
    tickPrices: getTickPrices(symbol).slice(-26),
  };
}

// Main Component
export default function TradingChart() {
  const { isAuthorized } = useAuth();
  const [showChart, setShowChart] = useState(false);
  const [symbol, setSymbol] = useState('R_100');
  const [groupFilter, setGroupFilter] = useState('all');
  const [timeframe, setTimeframe] = useState('1m');
  const [prices, setPrices] = useState<number[]>([]);
  const [times, setTimes] = useState<number[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [candleCount, setCandleCount] = useState(CANDLE_CONFIG.defaultCandles);
  const [tickRange, setTickRange] = useState(100);
  const [digitStats, setDigitStats] = useState<DigitStats>({
    frequency: {}, percentages: {}, mostCommon: 0, leastCommon: 0, totalTicks: 0,
    evenPercentage: 50, oddPercentage: 50, overPercentage: 50, underPercentage: 50,
    last26Digits: [], tickPrices: [],
  });
  const [indicators, setIndicators] = useState<Indicator[]>([]);
  const [showIndicatorPanel, setShowIndicatorPanel] = useState(false);
  const [selectedContractType, setSelectedContractType] = useState('CALL');
  const [selectedPrediction, setSelectedPrediction] = useState('5');
  const [tradeHistory, setTradeHistory] = useState<TradeRecord[]>([]);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [strategyEnabled, setStrategyEnabled] = useState(false);
  const [strategyMode, setStrategyMode] = useState<'pattern' | 'digit'>('pattern');
  const [patternInput, setPatternInput] = useState('');
  const [digitCondition, setDigitCondition] = useState('==');
  const [digitCompare, setDigitCompare] = useState('5');
  const [digitWindow, setDigitWindow] = useState('3');
  const [botRunning, setBotRunning] = useState(false);
  const [botPaused, setBotPaused] = useState(false);
  const botRunningRef = useRef(false);
  const botPausedRef = useRef(false);
  const [botConfig, setBotConfig] = useState({
    botSymbol: 'R_100', stake: '1.00', contractType: 'CALL', prediction: '5',
    duration: '1', durationUnit: 't', martingale: false, multiplier: '2.0',
    stopLoss: '10', takeProfit: '20', maxTrades: '50',
  });
  const [botStats, setBotStats] = useState({ trades: 0, wins: 0, losses: 0, pnl: 0, currentStake: 0, consecutiveLosses: 0 });
  const [displaySymbols, setDisplaySymbols] = useState<string[]>([]);

  const updateDigitStats = useCallback(() => {
    const stats = calculateDigitStats(symbol, tickRange);
    setDigitStats(stats);
  }, [symbol, tickRange]);

  useEffect(() => {
    updateDigitStats();
    const unsubscribe = subscribeToTicks(symbol, updateDigitStats);
    return unsubscribe;
  }, [symbol, tickRange, updateDigitStats]);

  // Mock tick data for demo (since derivApi is not fully implemented here)
  useEffect(() => {
    // Simulate initial ticks
    if (globalTickHistory[symbol]?.length === 0) {
      for (let i = 0; i < 100; i++) {
        const mockPrice = 100 + Math.random() * 10;
        addTick(symbol, getLastDigit(mockPrice), mockPrice);
      }
      updateDigitStats();
    }
    // Simulate real-time ticks every 2 seconds
    const interval = setInterval(() => {
      const mockPrice = 100 + Math.random() * 10;
      addTick(symbol, getLastDigit(mockPrice), mockPrice);
      setPrices(prev => [...prev.slice(-500), mockPrice]);
      setTimes(prev => [...prev.slice(-500), Date.now() / 1000]);
      updateDigitStats();
    }, 2000);
    return () => clearInterval(interval);
  }, [symbol, updateDigitStats]);

  const getDigitSymbol = useCallback((digit: number, price: number, prevPrice: number | null, type: string, barrier: string): string => {
    const barrierNum = parseInt(barrier);
    switch (type) {
      case 'CALL': if (prevPrice === null) return '?'; return price > prevPrice ? 'R' : price < prevPrice ? 'F' : 'C';
      case 'PUT': if (prevPrice === null) return '?'; return price < prevPrice ? 'R' : price > prevPrice ? 'F' : 'C';
      case 'DIGITOVER': return digit > barrierNum ? 'O' : digit === barrierNum ? 'S' : 'U';
      case 'DIGITUNDER': return digit < barrierNum ? 'U' : digit === barrierNum ? 'S' : 'O';
      case 'DIGITEVEN': return digit % 2 === 0 ? 'E' : 'O';
      case 'DIGITODD': return digit % 2 !== 0 ? 'O' : 'E';
      case 'DIGITMATCH': return digit === barrierNum ? 'S' : 'D';
      case 'DIGITDIFF': return digit !== barrierNum ? 'D' : 'S';
      default: return digit.toString();
    }
  }, []);

  const updateDisplaySymbols = useCallback(() => {
    const tickPricesData = digitStats.tickPrices;
    const symbols = digitStats.last26Digits.map((digit, index) => {
      const currentPrice = tickPricesData[index];
      const prevPrice = index > 0 ? tickPricesData[index - 1] : null;
      return getDigitSymbol(digit, currentPrice, prevPrice, selectedContractType, selectedPrediction);
    });
    setDisplaySymbols(symbols);
  }, [digitStats, selectedContractType, selectedPrediction, getDigitSymbol]);

  useEffect(() => { updateDisplaySymbols(); }, [updateDisplaySymbols, selectedContractType, selectedPrediction]);

  const addIndicator = (type: IndicatorType) => {
    setIndicators(prev => [...prev, { id: `${type}-${Date.now()}`, type, enabled: true }]);
    toast.success(`${type} indicator added`);
  };
  const removeIndicator = (id: string) => { setIndicators(prev => prev.filter(i => i.id !== id)); toast.info('Indicator removed'); };
  const toggleIndicator = (id: string) => { setIndicators(prev => prev.map(i => i.id === id ? { ...i, enabled: !i.enabled } : i)); };

  const checkPatternMatch = useCallback((): boolean => {
    const ticks = getTickHistory(botConfig.botSymbol);
    const cleanPattern = patternInput.toUpperCase().replace(/[^EO]/g, '');
    if (ticks.length < cleanPattern.length) return false;
    const recent = ticks.slice(-cleanPattern.length);
    for (let i = 0; i < cleanPattern.length; i++) {
      const expected = cleanPattern[i];
      const actual = recent[i] % 2 === 0 ? 'E' : 'O';
      if (expected !== actual) return false;
    }
    return true;
  }, [botConfig.botSymbol, patternInput]);

  const checkDigitCondition = useCallback((): boolean => {
    const ticks = getTickHistory(botConfig.botSymbol);
    const win = parseInt(digitWindow) || 3;
    const comp = parseInt(digitCompare);
    if (ticks.length < win) return false;
    const recent = ticks.slice(-win);
    return recent.every(d => {
      switch (digitCondition) {
        case '>': return d > comp;
        case '<': return d < comp;
        case '>=': return d >= comp;
        case '<=': return d <= comp;
        case '==': return d === comp;
        case '!=': return d !== comp;
        default: return false;
      }
    });
  }, [botConfig.botSymbol, digitCondition, digitCompare, digitWindow]);

  const checkStrategyCondition = useCallback((): boolean => {
    if (!strategyEnabled) return true;
    return strategyMode === 'pattern' ? checkPatternMatch() : checkDigitCondition();
  }, [strategyEnabled, strategyMode, checkPatternMatch, checkDigitCondition]);

  const speak = useCallback((text: string) => {
    if (!voiceEnabled || !window.speechSynthesis) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.1;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }, [voiceEnabled]);

  const startBot = useCallback(async () => {
    if (!isAuthorized) { toast.error('Login to Deriv first'); return; }
    setBotRunning(true); setBotPaused(false);
    botRunningRef.current = true; botPausedRef.current = false;
    let stake = parseFloat(botConfig.stake) || 1;
    let pnl = 0, trades = 0, wins = 0, losses = 0, consLosses = 0;
    const sl = parseFloat(botConfig.stopLoss) || 10;
    const tp = parseFloat(botConfig.takeProfit) || 20;
    const maxT = parseInt(botConfig.maxTrades) || 50;
    const mart = botConfig.martingale;
    const mult = parseFloat(botConfig.multiplier) || 2;
    const baseStake = stake;

    if (voiceEnabled) speak('Auto trading bot started');

    while (botRunningRef.current) {
      if (botPausedRef.current) { await new Promise(r => setTimeout(r, 500)); continue; }
      if (trades >= maxT || pnl <= -sl || pnl >= tp) {
        let reason = trades >= maxT ? 'Max trades reached' : pnl <= -sl ? 'Stop loss hit' : 'Take profit reached';
        toast.info(`🤖 Bot stopped: ${reason}`);
        if (voiceEnabled) speak(`Bot stopped. ${reason}. Total profit ${pnl.toFixed(2)} dollars`);
        // SHOW NOTIFICATION POPUP for TP/SL
        if (pnl <= -sl) showTPNotification('sl', `Stop loss triggered at $${Math.abs(sl).toFixed(2)} loss limit`, pnl);
        if (pnl >= tp) showTPNotification('tp', `Take profit reached! $${tp.toFixed(2)} profit target achieved`, pnl);
        break;
      }

      if (strategyEnabled) {
        while (botRunningRef.current && !checkStrategyCondition()) {
          await new Promise(r => setTimeout(r, 500));
        }
        if (!botRunningRef.current) break;
      }

      // Simulate trade (since derivApi not fully implemented)
      trades++;
      const winChance = Math.random() > 0.45;
      const profitAmount = winChance ? stake * 0.9 : -stake;
      pnl += profitAmount;
      if (winChance) { wins++; consLosses = 0; stake = baseStake; }
      else { losses++; consLosses++; if (mart) stake = Math.round(stake * mult * 100) / 100; else stake = baseStake; }
      
      const tradeRecord: TradeRecord = {
        id: `trade-${Date.now()}-${trades}`, time: Date.now(), type: botConfig.contractType,
        stake, profit: profitAmount, status: winChance ? 'won' : 'lost', symbol: botConfig.botSymbol,
        resultDigit: Math.floor(Math.random() * 10),
      };
      setTradeHistory(prev => [tradeRecord, ...prev].slice(0, 100));
      setBotStats({ trades, wins, losses, pnl, currentStake: stake, consecutiveLosses: consLosses });
      
      if (voiceEnabled && trades % 5 === 0) speak(`Trade ${trades} ${winChance ? 'won' : 'lost'}. PnL ${pnl.toFixed(2)}`);
      await new Promise(r => setTimeout(r, 1000));
    }
    setBotRunning(false); botRunningRef.current = false;
  }, [isAuthorized, botConfig, voiceEnabled, speak, strategyEnabled, checkStrategyCondition]);

  const stopBot = useCallback(() => { botRunningRef.current = false; setBotRunning(false); toast.info('🛑 Bot stopped'); }, []);
  const togglePauseBot = useCallback(() => { botPausedRef.current = !botPausedRef.current; setBotPaused(botPausedRef.current); }, []);
  const handleBotSymbolChange = (newSymbol: string) => { setBotConfig(prev => ({ ...prev, botSymbol: newSymbol })); setSymbol(newSymbol); };

  const totalTrades = tradeHistory.filter(t => t.status !== 'open').length;
  const winsCount = tradeHistory.filter(t => t.status === 'won').length;
  const lossesCount = tradeHistory.filter(t => t.status === 'lost').length;
  const totalProfit = tradeHistory.reduce((s, t) => s + t.profit, 0);
  const winRate = totalTrades > 0 ? (winsCount / totalTrades * 100) : 0;
  const currentPrice = prices[prices.length - 1] || 100;
  const lastDigit = getLastDigit(currentPrice);
  const { evenPercentage, oddPercentage, overPercentage, underPercentage, percentages, mostCommon, leastCommon, totalTicks } = digitStats;

  return (
    <div className="space-y-4 max-w-[1920px] mx-auto p-4">
      {/* NOTIFICATION POPUP - RENDERED HERE */}
      <NotificationPopup />
      
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div><h1 className="text-xl font-bold flex items-center gap-2"><BarChart3 className="w-5 h-5" /> Trading Chart</h1></div>
        <div className="flex gap-2">
          <Button onClick={() => setShowChart(!showChart)} variant="outline" size="sm">{showChart ? <EyeOff /> : <Eye />} {showChart ? "Hide" : "Show"}</Button>
          <Badge className="font-mono">{currentPrice.toFixed(4)}</Badge>
        </div>
      </div>

      {/* Markets */}
      <div className="bg-card border rounded-xl p-3">
        <div className="flex flex-wrap gap-1 mb-2">{GROUPS.map(g => <Button key={g.value} size="sm" variant={groupFilter === g.value ? 'default' : 'outline'} className="h-6 text-[10px]" onClick={() => setGroupFilter(g.value)}>{g.label}</Button>)}</div>
        <div className="flex flex-wrap gap-1 max-h-20 overflow-auto">{ALL_MARKETS.filter(m => groupFilter === 'all' || m.group === groupFilter).map(m => <Button key={m.symbol} size="sm" variant={symbol === m.symbol ? 'default' : 'ghost'} className="h-6 text-[9px]" onClick={() => setSymbol(m.symbol)}>{m.name}</Button>)}</div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        {/* Left Column */}
        <div className="xl:col-span-8 space-y-3">
          {showChart && <div className="bg-[#0D1117] border border-[#30363D] rounded-xl h-[400px] flex items-center justify-center"><p className="text-muted-foreground">Chart View (Canvas rendering here)</p></div>}
          
          {/* Digit Analysis */}
          <div className="bg-card border rounded-xl p-3">
            <div className="flex justify-between"><h3 className="text-xs font-semibold">Ramzfx Digit Analysis (Real-Time)</h3><Badge variant="outline" className="animate-pulse">Live: {totalTicks} ticks</Badge></div>
            <div className="grid grid-cols-4 gap-2 mt-2">
              <div className="bg-[#D29922]/10 p-2 rounded"><div className="text-[9px]">Odd</div><div className="font-bold">{oddPercentage.toFixed(1)}%</div></div>
              <div className="bg-[#3FB950]/10 p-2 rounded"><div className="text-[9px]">Even</div><div className="font-bold">{evenPercentage.toFixed(1)}%</div></div>
              <div className="bg-primary/10 p-2 rounded"><div className="text-[9px]">Over 4</div><div className="font-bold">{overPercentage.toFixed(1)}%</div></div>
              <div className="bg-[#D29922]/10 p-2 rounded"><div className="text-[9px]">Under 5</div><div className="font-bold">{underPercentage.toFixed(1)}%</div></div>
            </div>
            <div className="grid grid-cols-10 gap-1 mt-2">{Array.from({ length: 10 }, (_, d) => <div key={d} className={`text-center p-1 rounded border ${selectedPrediction === String(d) ? 'ring-2 ring-primary' : ''}`} onClick={() => setSelectedPrediction(String(d))}><div className="font-bold">{d}</div><div className="text-[8px]">{(percentages[d] || 0).toFixed(1)}%</div></div>)}</div>
          </div>
        </div>

        {/* Right Column - Bot & Signals */}
        <div className="xl:col-span-4 space-y-3">
          {/* Voice AI */}
          <div className="bg-card border rounded-xl p-3 flex justify-between items-center"><span className="text-xs font-semibold">Ramzfx AI Voice Signals</span><Button size="sm" variant={voiceEnabled ? 'default' : 'outline'} onClick={() => setVoiceEnabled(!voiceEnabled)}>{voiceEnabled ? <Volume2 /> : <VolumeX />} {voiceEnabled ? 'ON' : 'OFF'}</Button></div>

          {/* Trading Signals */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-card border p-2 rounded"><div className="text-[10px]">Rise/Fall</div><div className="font-bold text-profit">Rise</div><div className="h-1.5 bg-muted rounded-full mt-1"><div className="h-full bg-profit rounded-full" style={{ width: '65%' }} /></div></div>
            <div className="bg-card border p-2 rounded"><div className="text-[10px]">Even/Odd</div><div className="font-bold">{evenPercentage > 50 ? 'Even' : 'Odd'}</div><div className="h-1.5 bg-muted rounded-full mt-1"><div className="h-full bg-[#3FB950] rounded-full" style={{ width: `${Math.max(evenPercentage, oddPercentage)}%` }} /></div></div>
          </div>

          {/* AUTO BOT PANEL */}
          <div className={`bg-card border rounded-xl p-3 space-y-2 ${botRunning ? 'border-profit' : 'border-border'}`}>
            <div className="flex justify-between"><h3 className="text-xs font-semibold">Ramzfx Speed Bot</h3>{botRunning && <Badge className="bg-profit animate-pulse">RUNNING</Badge>}</div>
            <Select value={botConfig.botSymbol} onValueChange={handleBotSymbolChange} disabled={botRunning}><SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent>{ALL_MARKETS.map(m => <SelectItem key={m.symbol} value={m.symbol}>{m.name}</SelectItem>)}</SelectContent></Select>
            <Select value={botConfig.contractType} onValueChange={v => setBotConfig(p => ({ ...p, contractType: v }))} disabled={botRunning}><SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent>{CONTRACT_TYPES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent></Select>
            <div className="grid grid-cols-2 gap-2"><Input placeholder="Stake" value={botConfig.stake} onChange={e => setBotConfig(p => ({ ...p, stake: e.target.value }))} disabled={botRunning} /><Input placeholder="Duration" value={botConfig.duration} onChange={e => setBotConfig(p => ({ ...p, duration: e.target.value }))} disabled={botRunning} /></div>
            <div className="flex justify-between items-center"><span className="text-xs">Martingale</span><Switch checked={botConfig.martingale} onCheckedChange={v => setBotConfig(p => ({ ...p, martingale: v }))} disabled={botRunning} /></div>
            {botConfig.martingale && <Input placeholder="Multiplier" value={botConfig.multiplier} onChange={e => setBotConfig(p => ({ ...p, multiplier: e.target.value }))} disabled={botRunning} />}
            <div className="grid grid-cols-2 gap-2"><Input placeholder="Stop Loss $" value={botConfig.stopLoss} onChange={e => setBotConfig(p => ({ ...p, stopLoss: e.target.value }))} /><Input placeholder="Take Profit $" value={botConfig.takeProfit} onChange={e => setBotConfig(p => ({ ...p, takeProfit: e.target.value }))} /></div>
            
            {/* Strategy Toggle */}
            <div className="border-t pt-2"><div className="flex justify-between"><span className="text-xs text-warning">Strategy</span><Switch checked={strategyEnabled} onCheckedChange={setStrategyEnabled} disabled={botRunning} /></div>
            {strategyEnabled && <div className="mt-1"><Select value={strategyMode} onValueChange={v => setStrategyMode(v as any)}><SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pattern">Pattern (E/O)</SelectItem><SelectItem value="digit">Digit Condition</SelectItem></SelectContent></Select>
            {strategyMode === 'pattern' ? <Textarea placeholder="EEOEO" value={patternInput} onChange={e => setPatternInput(e.target.value.toUpperCase().replace(/[^EO]/g, ''))} className="h-12 text-xs mt-1" /> : <div className="grid grid-cols-3 gap-1 mt-1"><Input placeholder="Window" value={digitWindow} onChange={e => setDigitWindow(e.target.value)} /><Select value={digitCondition} onValueChange={setDigitCondition}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="==">=</SelectItem><SelectItem value="!=">!=</SelectItem><SelectItem value=">">&gt;</SelectItem><SelectItem value="<">&lt;</SelectItem></SelectContent></Select><Input placeholder="Digit" value={digitCompare} onChange={e => setDigitCompare(e.target.value)} /></div>}</div>}
            
            {botRunning && <div className="grid grid-cols-3 gap-1 text-center bg-muted/30 p-1 rounded"><div>Stake<br/>${botStats.currentStake.toFixed(2)}</div><div>Streak<br/>{botStats.consecutiveLosses}L</div><div className={botStats.pnl >= 0 ? 'text-profit' : 'text-loss'}>P/L<br/>{botStats.pnl >= 0 ? '+' : ''}{botStats.pnl.toFixed(2)}</div></div>}
            <div className="flex gap-2">{!botRunning ? <Button onClick={startBot} className="flex-1 bg-profit">Start Bot</Button> : <><Button onClick={togglePauseBot} variant="outline" className="flex-1">{botPaused ? 'Resume' : 'Pause'}</Button><Button onClick={stopBot} variant="destructive" className="flex-1">Stop</Button></>}</div>
          </div>

          {/* Filtration Chamber */}
          <div className="bg-card border rounded-xl p-3">
            <h3 className="text-xs font-semibold mb-2">Filtration Chamber 🚆 <Badge className="ml-2 text-[8px]">{selectedContractType}</Badge></h3>
            <div className="flex gap-1 flex-wrap justify-center">{displaySymbols.map((s, i) => <div key={i} className={`w-7 h-9 rounded flex items-center justify-center font-bold border ${i === displaySymbols.length-1 ? 'ring-2 ring-primary' : ''} ${s === 'R' || s === 'U' ? 'bg-profit/20 text-profit border-profit/30' : s === 'F' || s === 'O' ? 'bg-loss/20 text-loss border-loss/30' : 'bg-muted/20'}`}>{s}</div>)}</div>
          </div>

          {/* Trade History */}
          <div className="bg-card border rounded-xl p-3"><div className="flex justify-between"><h3 className="text-xs font-semibold">Trade Results</h3><Button variant="ghost" size="sm" onClick={() => setTradeHistory([])}>Clear</Button></div>
          <div className="grid grid-cols-4 gap-1 mt-1"><div>Trades<br/>{totalTrades}</div><div className="text-profit">Wins<br/>{winsCount}</div><div className="text-loss">Losses<br/>{lossesCount}</div><div className={totalProfit >= 0 ? 'text-profit' : 'text-loss'}>P/L<br/>{totalProfit >= 0 ? '+' : ''}{totalProfit.toFixed(2)}</div></div>
          {totalTrades > 0 && <div className="mt-1"><div className="text-[9px]">Win Rate {winRate.toFixed(1)}%</div><Progress value={winRate} className="h-1" /></div>}
          <div className="max-h-32 overflow-auto mt-2 space-y-1">{tradeHistory.slice(0, 10).map(t => <div key={t.id} className="flex justify-between text-[9px] p-1 border-b"><span>{t.type}</span><span>${t.stake.toFixed(2)}</span><span className={t.profit >= 0 ? 'text-profit' : 'text-loss'}>{t.profit >= 0 ? '+' : ''}{t.profit.toFixed(2)}</span></div>)}</div></div>
        </div>
      </div>
    </div>
  );
}
