import { useState, useRef, useCallback, useEffect } from 'react';
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
import {
  Play, StopCircle, Trash2, Scan,
  Home, RefreshCw, Shield, TrendingUp, DollarSign, X
} from 'lucide-react';

// ============================================
// NOTIFICATION SYSTEM - COMPACT CENTERED POPUP (300px x 200px)
// ============================================

// Animation Styles
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

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes scrollRightToLeft {
  from { transform: translateX(0); }
  to { transform: translateX(-100%); }
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

.animate-slideIn {
  animation: slideIn 0.3s ease-out;
}

.animate-scroll-right-to-left {
  animation: scrollRightToLeft 12s linear infinite;
}
`;

// Helper function to show notification
export const showTPNotification = (type: 'tp' | 'sl', message: string, amount?: number) => {
  if (typeof window !== 'undefined' && (window as any).showTPNotification) {
    (window as any).showTPNotification(type, message, amount);
  }
};

// Compact Notification Component (300px x 200px)
const NotificationPopup = () => {
  const [notification, setNotification] = useState<{ type: 'tp' | 'sl'; message: string; amount?: number } | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isExiting, setIsExiting] = useState(false);

  // Register callback for TP/SL events
  useEffect(() => {
    (window as any).showTPNotification = (type: 'tp' | 'sl', message: string, amount?: number) => {
      setNotification({ type, message, amount });
      setIsVisible(true);
      setIsExiting(false);
      
      // Auto-hide after 8 seconds if not dismissed
      const timeout = setTimeout(() => {
        handleClose();
      }, 80000);
      
      return () => clearTimeout(timeout);
    };
    
    return () => {
      delete (window as any).showTPNotification;
    };
  }, []);

  const handleClose = () => {
    setIsExiting(true);
    setTimeout(() => {
      setIsVisible(false);
      setNotification(null);
      setIsExiting(false);
    }, 300);
  };

  if (!isVisible || !notification) return null;

  const isTP = notification.type === 'tp';
  const amount = notification.amount;

  // Generate animated background icons (compact version)
  const backgroundIcons = () => {
    const icons = [];
    const iconCount = 12;
    const colors = isTP 
      ? ['#10b981', '#34d399', '#6ee7b7', '#059669']
      : ['#f43f5e', '#fb7185', '#fda4af', '#e11d48'];
    
    for (let i = 0; i < iconCount; i++) {
      const size = 12 + Math.random() * 20;
      const left = Math.random() * 100;
      const delay = Math.random() * 12;
      const duration = 6 + Math.random() * 8;
      const color = colors[Math.floor(Math.random() * colors.length)];
      const icon = isTP ? '💰' : '😢';
      
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
      <div 
        className={`
          pointer-events-auto w-[800px] h-[600px] rounded-xl shadow-2xl overflow-hidden
          ${isExiting ? 'animate-slide-down-center' : 'animate-slide-up-center'}
        `}
      >
        <div className={`
          relative w-full h-full overflow-hidden
          ${isTP 
            ? 'bg-gradient-to-br from-emerald-500 to-emerald-700' 
            : 'bg-gradient-to-br from-rose-500 to-rose-700'
          }
        `}>
          <div className="absolute inset-0 overflow-hidden">
            {backgroundIcons()}
          </div>
          
          <div className="absolute inset-0 opacity-5">
            <div className="absolute top-0 right-0 w-32 h-32 bg-white rounded-full -translate-y-1/2 translate-x-1/2" />
            <div className="absolute bottom-0 left-0 w-32 h-32 bg-white rounded-full translate-y-1/2 -translate-x-1/2" />
          </div>
          
          <div className="relative w-full h-full flex flex-col p-3 z-10">
            <div className="flex items-center gap-2 mb-2">
              <div className={`
                w-10 h-10 rounded-full flex items-center justify-center text-xl
                ${isTP 
                  ? 'bg-emerald-400/30' 
                  : 'bg-rose-400/30'
                }
                shadow-lg backdrop-blur-sm
                animate-pulse-slow
                flex-shrink-0
              `}>
                {isTP ? '🎉' : '😢'}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className={`text-sm font-bold text-white truncate`}>
                  {isTP ? 'TAKE PROFIT!' : 'STOP LOSS!'}
                </h3>
                <p className="text-[8px] text-white/70">
                  {new Date().toLocaleTimeString()}
                </p>
              </div>
            </div>
            
            <div className="flex-1 flex flex-col items-center justify-center text-center mb-2">
              <p className="text-white text-xs font-medium leading-tight">
                {notification.message}
              </p>
              {amount && (
                <p className={`text-xl font-bold mt-1 ${isTP ? 'text-emerald-200' : 'text-rose-200'} animate-bounce`}>
                  {isTP ? '+' : '-'}${Math.abs(amount).toFixed(2)}
                </p>
              )}
            </div>
            
            <button
              onClick={handleClose}
              className={`
                w-full py-1.5 rounded-lg font-semibold text-xs transition-all duration-200
                ${isTP 
                  ? 'bg-white/95 text-emerald-600 hover:bg-white hover:scale-[1.02]' 
                  : 'bg-white/95 text-rose-600 hover:bg-white hover:scale-[1.02]'
                }
                transform active:scale-[0.98]
                shadow-lg backdrop-blur-sm
              `}
            >
              OK
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================
// PRO SCANNER BOT
// ============================================

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

type BotStatus = 'idle' | 'trading_m1' | 'recovery' | 'waiting_pattern' | 'pattern_matched' | 'reconnecting';
type M1StrategyType = 
  | 'over0_under9_1'
  | 'over0_under9_2' 
  | 'over0_under9_3' 
  | 'over0_under9_4' 
  | 'over1_under8_2' 
  | 'over1_under8_3'
  | 'over1_under8_4' 
  | 'over2_under7_2' 
  | 'over2_under7_3' 
  | 'over2_under7_4' 
  | 'over2_under7_5'
  | 'over3_under6_4' 
  | 'over4_under5_4'
  | 'over4_under5_5' 
  | 'over4_under5_6' 
  | 'over4_under5_7' 
  | 'disabled';

type M2RecoveryType = 
  | 'odd_even_3'
  | 'odd_even_4' 
  | 'odd_even_5' 
  | 'odd_even_6' 
  | 'odd_even_7' 
  | 'odd_even_8' 
  | 'odd_even_9' 
  | 'over4_under5_5' 
  | 'over4_under5_6' 
  | 'over4_under5_7' 
  | 'over4_under5_8' 
  | 'over4_under5_9' 
  | 'over3_under6_5' 
  | 'over3_under6_7' 
  | 'disabled';

interface LogEntry {
  id: number;
  time: string;
  market: 'M1' | 'M2';
  symbol: string;
  contract: string;
  stake: number;
  martingaleStep: number;
  exitDigit: string;
  result: 'Win' | 'Loss' | 'Pending';
  pnl: number;
  balance: number;
  switchInfo: string;
}

interface DetectedPattern {
  symbol: string;
  name: string;
  patternType: string;
  timestamp: number;
  digits: number[];
}

// Constants
const MAX_SCAN_ATTEMPTS = 100;
const SCAN_INTERVAL = 100;
const CONNECTION_CHECK_INTERVAL = 5000;
const DATA_STALENESS_THRESHOLD = 10000;
const HEARTBEAT_INTERVAL = 30000;
const DEBUG = true;
const BALANCE_SYNC_INTERVAL = 1000;
const IMMEDIATE_BALANCE_SYNC_DELAY = 50; // 50ms delay for immediate balance sync after trade

// Helper function
const logDebug = (...args: any[]) => {
  if (DEBUG) console.log('[DEBUG]', new Date().toISOString(), ...args);
};

function waitForNextTick(symbol: string): Promise<{ quote: number }> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      if (unsub) unsub();
      resolve({ quote: 0 });
    }, 5000);
    
    const unsub = derivApi.onMessage((data: any) => {
      if (data.tick && data.tick.symbol === symbol) { 
        clearTimeout(timeout);
        unsub(); 
        resolve({ quote: data.tick.quote }); 
      }
    });
  });
}

export default function ProScannerBot() {
  const { isAuthorized, balance: apiBalance, activeAccount, refreshBalance } = useAuth();
  const { recordLoss } = useLossRequirement();

  // Local balance tracking for immediate updates
  const [localBalance, setLocalBalance] = useState(apiBalance);
  const localBalanceRef = useRef(apiBalance);
  
  // Track net profit separately for immediate updates
  const [netProfit, setNetProfit] = useState(0);
  const netProfitRef = useRef(0);
  
  // Track pending balance sync promises
  const balanceSyncPromiseRef = useRef<Promise<void> | null>(null);

  // IMMEDIATE BALANCE UPDATE FUNCTION - CRITICAL FIX
  const forceImmediateBalanceUpdate = useCallback(async (expectedPnl?: number): Promise<number> => {
    if (!refreshBalance) return localBalanceRef.current;
    
    try {
      // Force immediate API balance refresh
      await refreshBalance();
      
      // Get the new balance
      const newBalance = apiBalance;
      
      // Update both state and ref immediately
      setLocalBalance(newBalance);
      localBalanceRef.current = newBalance;
      
      // If we have expected PnL, verify it matches (for logging)
      if (expectedPnl !== undefined) {
        const balanceChange = newBalance - (localBalanceRef.current - expectedPnl);
        logDebug(`Balance sync complete - New: $${newBalance}, Expected change: $${expectedPnl}, Actual change: $${balanceChange}`);
      } else {
        logDebug(`Balance sync complete - New balance: $${newBalance}`);
      }
      
      return newBalance;
    } catch (error) {
      logDebug('Balance sync error:', error);
      return localBalanceRef.current;
    }
  }, [apiBalance, refreshBalance]);

  // Sync local balance with API balance with immediate effect
  useEffect(() => {
    const syncBalance = async () => {
      if (refreshBalance) {
        await refreshBalance();
      }
      const newBalance = apiBalance;
      setLocalBalance(newBalance);
      localBalanceRef.current = newBalance;
      logDebug(`Balance synced: $${newBalance}`);
    };
    
    syncBalance();
    
    const interval = setInterval(syncBalance, BALANCE_SYNC_INTERVAL);
    return () => clearInterval(interval);
  }, [apiBalance, refreshBalance]);

  // Update local balance instantly when API balance changes
  useEffect(() => {
    setLocalBalance(apiBalance);
    localBalanceRef.current = apiBalance;
    logDebug(`Balance updated instantly: $${apiBalance}`);
  }, [apiBalance]);

  /* ── Market 1 config ── */
  const [m1Enabled, setM1Enabled] = useState(true);
  const [m1StrategyType, setM1StrategyType] = useState<M1StrategyType>('over1_under8_2');

  /* ── Market 2 config ── */
  const [m2Enabled, setM2Enabled] = useState(true);
  const [m2RecoveryType, setM2RecoveryType] = useState<M2RecoveryType>('odd_even_4');

  /* ── Risk ── */
  const [stake, setStake] = useState('0.6');
  const [martingaleOn, setMartingaleOn] = useState(true);
  const [martingaleMultiplier, setMartingaleMultiplier] = useState('2.0');
  const [martingaleMaxSteps, setMartingaleMaxSteps] = useState('5');
  const [takeProfit, setTakeProfit] = useState('5');
  const [stopLoss, setStopLoss] = useState('30');

  /* ── Strategy Enabled Flags ── */
  const [strategyM1Enabled, setStrategyM1Enabled] = useState(true);
  const [strategyM2Enabled, setStrategyM2Enabled] = useState(true);

  /* ── Scanner ── */
  const [scannerActive, setScannerActive] = useState(true);
  
  /* ── Detected Patterns for Display ── */
  const [detectedPatterns, setDetectedPatterns] = useState<DetectedPattern[]>([]);

  /* ── Bot state ── */
  const [botStatus, setBotStatus] = useState<BotStatus>('idle');
  const [isRunning, setIsRunning] = useState(false);
  const runningRef = useRef(false);
  const [currentMarket, setCurrentMarket] = useState<1 | 2>(1);
  const [wins, setWins] = useState(0);
  const [losses, setLosses] = useState(0);
  const [totalStaked, setTotalStaked] = useState(0);
  const [currentStake, setCurrentStakeState] = useState(0);
  const [martingaleStep, setMartingaleStepState] = useState(0);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const logIdRef = useRef(0);
  
  // Track last trade timestamp per symbol to prevent multiple trades on same pattern
  const lastTradeTimeRef = useRef<Map<string, number>>(new Map());
  // Track last pattern digits to avoid re-trading same pattern
  const lastPatternDigitsRef = useRef<Map<string, string>>(new Map());
  // Track overall last trade time to prevent rapid successive trades
  const lastTradeOverallRef = useRef<number>(0);
  // Track last tick timestamp per symbol
  const lastTickTimeRef = useRef<Map<string, number>>(new Map());
  // Track subscription status
  const subscriptionStatusRef = useRef<Map<string, boolean>>(new Map());
  // Track connection retry count
  const connectionRetryCountRef = useRef<number>(0);
  const MAX_CONNECTION_RETRIES = 3;
  // Track if we're currently reconnecting to avoid loops
  const isReconnectingRef = useRef(false);

  /* ── Tick data ── */
  const tickMapRef = useRef<Map<string, number[]>>(new Map());

  // Track if TP/SL notifications have been shown for current session
  const tpNotifiedRef = useRef(false);
  const slNotifiedRef = useRef(false);
  const lastPnlRef = useRef(0);

  // Connection management - IMPROVED
  const ensureConnection = useCallback(async (): Promise<boolean> => {
    if (derivApi.isConnected) {
      connectionRetryCountRef.current = 0;
      isReconnectingRef.current = false;
      return true;
    }

    if (isReconnectingRef.current) {
      logDebug('Already reconnecting, skipping...');
      return false;
    }

    isReconnectingRef.current = true;
    setBotStatus('reconnecting');
    
    for (let i = 0; i < MAX_CONNECTION_RETRIES; i++) {
      try {
        logDebug(`Connection attempt ${i + 1}/${MAX_CONNECTION_RETRIES}`);
        await derivApi.connect();
        await new Promise(r => setTimeout(r, 2000));
        
        if (derivApi.isConnected) {
          await resubscribeToMarkets();
          setBotStatus(runningRef.current ? 'trading_m1' : 'idle');
          connectionRetryCountRef.current = 0;
          isReconnectingRef.current = false;
          logDebug('Reconnection successful');
          return true;
        }
      } catch (error) {
        logDebug(`Reconnection attempt ${i + 1} failed:`, error);
        await new Promise(r => setTimeout(r, 3000));
      }
    }
    
    setBotStatus('idle');
    isReconnectingRef.current = false;
    logDebug('Reconnection failed after all attempts');
    return false;
  }, []);

  // Subscribe to all markets with retry
  const resubscribeToMarkets = useCallback(async () => {
    if (!derivApi.isConnected) return false;
    
    const results = await Promise.allSettled(
      SCANNER_MARKETS.map(async (market) => {
        try {
          // Unsubscribe first if already subscribed
          if (subscriptionStatusRef.current.get(market.symbol)) {
            try {
              await derivApi.unsubscribeTicks?.(market.symbol as MarketSymbol);
            } catch (e) {
              // Ignore unsubscribe errors
            }
          }
          await derivApi.subscribeTicks(market.symbol as MarketSymbol, () => {});
          subscriptionStatusRef.current.set(market.symbol, true);
          logDebug(`✅ Subscribed to ${market.symbol}`);
          return true;
        } catch (error) {
          logDebug(`❌ Failed to subscribe to ${market.symbol}:`, error);
          subscriptionStatusRef.current.set(market.symbol, false);
          return false;
        }
      })
    );
    
    const successCount = results.filter(r => r.status === 'fulfilled' && r.value === true).length;
    logDebug(`Subscription results: ${successCount}/${SCANNER_MARKETS.length} markets active`);
    return successCount > 0;
  }, []);

  // Connection monitoring - IMPROVED
  useEffect(() => {
    let connectionChecker: NodeJS.Timeout;
    
    if (isRunning) {
      connectionChecker = setInterval(() => {
        if (!derivApi.isConnected && !isReconnectingRef.current) {
          logDebug('Connection lost, attempting to reconnect...');
          ensureConnection().catch(console.error);
        }
      }, CONNECTION_CHECK_INTERVAL);
    }
    
    return () => {
      if (connectionChecker) clearInterval(connectionChecker);
    };
  }, [isRunning, ensureConnection]);

  // Heartbeat mechanism
  useEffect(() => {
    if (!derivApi.isConnected || !isRunning) return;
    
    const heartbeat = setInterval(() => {
      if (!derivApi.isConnected) {
        if (isRunning) stopBot();
      }
    }, HEARTBEAT_INTERVAL);
    
    return () => clearInterval(heartbeat);
  }, [isRunning]);

  // Define stopBot before using it
  const stopBot = useCallback(() => {
    runningRef.current = false;
    setIsRunning(false);
    setBotStatus('idle');
    logDebug('Bot stopped by user');
  }, []);

  // Initial subscription and tick handler - IMPROVED
  useEffect(() => {
    let active = true;
    let reconnectTimeout: NodeJS.Timeout;
    
    const setupSubscriptions = async () => {
      if (!derivApi.isConnected) {
        const connected = await derivApi.connect();
        if (!connected && active) {
          reconnectTimeout = setTimeout(setupSubscriptions, 5000);
          return;
        }
      }
      if (active && derivApi.isConnected) {
        await resubscribeToMarkets();
      }
    };
    
    const handler = (data: any) => {
      if (!data.tick || !active) return;
      
      const sym = data.tick.symbol as string;
      const quote = data.tick.quote;
      const digit = getLastDigit(quote);
      
      if (typeof digit !== 'number' || isNaN(digit) || digit < 0 || digit > 9) {
        return;
      }
      
      lastTickTimeRef.current.set(sym, Date.now());
      
      const map = tickMapRef.current;
      let arr = map.get(sym);
      if (!arr) {
        arr = [];
        map.set(sym, arr);
      }
      arr.push(digit);
      if (arr.length > 200) arr.shift();
      
      // Mark subscription as active if we receive data
      if (!subscriptionStatusRef.current.get(sym)) {
        subscriptionStatusRef.current.set(sym, true);
      }
    };
    
    const unsub = derivApi.onMessage(handler);
    setupSubscriptions();
    
    return () => { 
      active = false; 
      unsub();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      SCANNER_MARKETS.forEach(m => {
        derivApi.unsubscribeTicks?.(m.symbol as MarketSymbol).catch(() => {});
      });
    };
  }, [resubscribeToMarkets]);

  // Monitor TP/SL and show notifications
  useEffect(() => {
    const tpValue = parseFloat(takeProfit);
    const slValue = parseFloat(stopLoss);
    const prevPnl = lastPnlRef.current;
    
    // Check for TP hit (when profit crosses from below TP to above or equal TP)
    if (netProfit >= tpValue && prevPnl < tpValue && netProfit > 0) {
      showTPNotification('tp', `Take Profit Target Hit!`, netProfit);
      tpNotifiedRef.current = true;
      slNotifiedRef.current = false;
    }
    
    // Check for SL hit (when loss crosses from above SL to below or equal -SL)
    if (netProfit <= -slValue && prevPnl > -slValue && netProfit < 0) {
      showTPNotification('sl', `Stop Loss Target Hit!`, Math.abs(netProfit));
      slNotifiedRef.current = true;
      tpNotifiedRef.current = false;
    }
    
    // Reset flags when profit is between TP and SL
    if (netProfit > -slValue && netProfit < tpValue) {
      tpNotifiedRef.current = false;
      slNotifiedRef.current = false;
    }
    
    lastPnlRef.current = netProfit;
  }, [netProfit, takeProfit, stopLoss]);

  // Check if data is fresh
  const isDataFresh = useCallback((symbol: string): boolean => {
    const lastTickTime = lastTickTimeRef.current.get(symbol);
    if (!lastTickTime) {
      logDebug(`No data for ${symbol}`);
      return false;
    }
    const isFresh = Date.now() - lastTickTime < DATA_STALENESS_THRESHOLD;
    if (!isFresh) {
      logDebug(`Stale data for ${symbol}, last tick: ${new Date(lastTickTime).toISOString()}`);
      // Try to resubscribe to stale market
      if (derivApi.isConnected) {
        derivApi.subscribeTicks(symbol as MarketSymbol, () => {}).catch(() => {});
      }
    }
    return isFresh;
  }, []);

  // Helper to get recent digits for a symbol
  const getRecentDigits = useCallback((symbol: string, count: number): number[] => {
    const digits = tickMapRef.current.get(symbol) || [];
    return digits.slice(-count);
  }, []);

  // M1 Pattern Checker - FIXED to check all markets properly
  const checkM1Pattern = useCallback((symbol: string): { matched: boolean; contractType?: string; barrier?: string; patternDigits?: string } => {
    if (!isDataFresh(symbol)) {
      return { matched: false };
    }
    
    const digits = getRecentDigits(symbol, 10);
    if (digits.length === 0) return { matched: false };
    
    switch (m1StrategyType) {
      case 'over0_under9_1': {
        const last1 = digits.slice(-1);
        const patternKey = `${last1.join(',')}`;
        
        if (last1[0] === 0) {
          return { matched: true, contractType: 'DIGITOVER', barrier: '0', patternDigits: patternKey };
        }
        if (last1[0] === 9) {
          return { matched: true, contractType: 'DIGITUNDER', barrier: '9', patternDigits: patternKey };
        }
        return { matched: false };
      }
      
      case 'over0_under9_2': {
        if (digits.length < 2) return { matched: false };
        const last2 = digits.slice(-2);
        const patternKey = `${last2.join(',')}`;
        
        if (last2[0] === 0 && last2[1] === 0) {
          return { matched: true, contractType: 'DIGITOVER', barrier: '0', patternDigits: patternKey };
        }
        if (last2[0] === 9 && last2[1] === 9) {
          return { matched: true, contractType: 'DIGITUNDER', barrier: '9', patternDigits: patternKey };
        }
        return { matched: false };
      }
      
      case 'over0_under9_3': {
        if (digits.length < 3) return { matched: false };
        const last3 = digits.slice(-3);
        const patternKey = `${last3.join(',')}`;
        const allZeros = last3.every(d => d === 0);
        const allNines = last3.every(d => d === 9);
        
        if (allZeros) {
          return { matched: true, contractType: 'DIGITOVER', barrier: '0', patternDigits: patternKey };
        }
        if (allNines) {
          return { matched: true, contractType: 'DIGITUNDER', barrier: '9', patternDigits: patternKey };
        }
        return { matched: false };
      }
      
      case 'over0_under9_4': {
        if (digits.length < 4) return { matched: false };
        const last4 = digits.slice(-4);
        const patternKey = `${last4.join(',')}`;
        const allZeros = last4.every(d => d === 0);
        const allNines = last4.every(d => d === 9);
        
        if (allZeros) {
          return { matched: true, contractType: 'DIGITOVER', barrier: '0', patternDigits: patternKey };
        }
        if (allNines) {
          return { matched: true, contractType: 'DIGITUNDER', barrier: '9', patternDigits: patternKey };
        }
        return { matched: false };
      }
      
      case 'over1_under8_2': {
        if (digits.length < 2) return { matched: false };
        const last2 = digits.slice(-2);
        const patternKey = `${last2.join(',')}`;
        
        if (last2[0] === 0 && last2[1] === 0) {
          return { matched: true, contractType: 'DIGITOVER', barrier: '1', patternDigits: patternKey };
        }
        if (last2[0] === 9 && last2[1] === 9) {
          return { matched: true, contractType: 'DIGITUNDER', barrier: '8', patternDigits: patternKey };
        }
        return { matched: false };
      }
      
      case 'over1_under8_3': {
        if (digits.length < 3) return { matched: false };
        const last3 = digits.slice(-3);
        const patternKey = `${last3.join(',')}`;
        const allZeros = last3.every(d => d === 0);
        const allNines = last3.every(d => d === 9);
        
        if (allZeros) {
          return { matched: true, contractType: 'DIGITOVER', barrier: '1', patternDigits: patternKey };
        }
        if (allNines) {
          return { matched: true, contractType: 'DIGITUNDER', barrier: '8', patternDigits: patternKey };
        }
        return { matched: false };
      }
      
      case 'over1_under8_4': {
        if (digits.length < 4) return { matched: false };
        const last4 = digits.slice(-4);
        const patternKey = `${last4.join(',')}`;
        const allZeros = last4.every(d => d === 0);
        const allNines = last4.every(d => d === 9);
        
        if (allZeros) {
          return { matched: true, contractType: 'DIGITOVER', barrier: '1', patternDigits: patternKey };
        }
        if (allNines) {
          return { matched: true, contractType: 'DIGITUNDER', barrier: '8', patternDigits: patternKey };
        }
        return { matched: false };
      }
      
      case 'over2_under7_2': {
        if (digits.length < 2) return { matched: false };
        const last2 = digits.slice(-2);
        const patternKey = `${last2.join(',')}`;
        const allLessThan2 = last2.every(d => d < 2);
        const allGreaterThan7 = last2.every(d => d > 7);
        
        if (allLessThan2) {
          return { matched: true, contractType: 'DIGITOVER', barrier: '2', patternDigits: patternKey };
        }
        if (allGreaterThan7) {
          return { matched: true, contractType: 'DIGITUNDER', barrier: '7', patternDigits: patternKey };
        }
        return { matched: false };
      }
      
      case 'over2_under7_3': {
        if (digits.length < 3) return { matched: false };
        const last3 = digits.slice(-3);
        const patternKey = `${last3.join(',')}`;
        const allLessThan2 = last3.every(d => d < 2);
        const allGreaterThan7 = last3.every(d => d > 7);
        
        if (allLessThan2) {
          return { matched: true, contractType: 'DIGITOVER', barrier: '2', patternDigits: patternKey };
        }
        if (allGreaterThan7) {
          return { matched: true, contractType: 'DIGITUNDER', barrier: '7', patternDigits: patternKey };
        }
        return { matched: false };
      }
      
      case 'over2_under7_4': {
        if (digits.length < 4) return { matched: false };
        const last4 = digits.slice(-4);
        const patternKey = `${last4.join(',')}`;
        const allLessThan2 = last4.every(d => d < 2);
        const allGreaterThan7 = last4.every(d => d > 7);
        
        if (allLessThan2) {
          return { matched: true, contractType: 'DIGITOVER', barrier: '2', patternDigits: patternKey };
        }
        if (allGreaterThan7) {
          return { matched: true, contractType: 'DIGITUNDER', barrier: '7', patternDigits: patternKey };
        }
        return { matched: false };
      }
      
      case 'over2_under7_5': {
        if (digits.length < 5) return { matched: false };
        const last5 = digits.slice(-5);
        const patternKey = `${last5.join(',')}`;
        const allLessThan2 = last5.every(d => d < 2);
        const allGreaterThan7 = last5.every(d => d > 7);
        
        if (allLessThan2) {
          return { matched: true, contractType: 'DIGITOVER', barrier: '2', patternDigits: patternKey };
        }
        if (allGreaterThan7) {
          return { matched: true, contractType: 'DIGITUNDER', barrier: '7', patternDigits: patternKey };
        }
        return { matched: false };
      }
      
      case 'over3_under6_4': {
        if (digits.length < 4) return { matched: false };
        const last4 = digits.slice(-4);
        const patternKey = `${last4.join(',')}`;
        const allLessThan3 = last4.every(d => d < 3);
        const allGreaterThan6 = last4.every(d => d > 6);
        
        if (allLessThan3) {
          return { matched: true, contractType: 'DIGITOVER', barrier: '3', patternDigits: patternKey };
        }
        if (allGreaterThan6) {
          return { matched: true, contractType: 'DIGITUNDER', barrier: '6', patternDigits: patternKey };
        }
        return { matched: false };
      }
      
      case 'over4_under5_4': {
        if (digits.length < 4) return { matched: false };
        const last4 = digits.slice(-4);
        const patternKey = `${last4.join(',')}`;
        const allOver4 = last4.every(d => d >= 5);
        const allUnder5 = last4.every(d => d <= 4);
        
        if (allOver4) {
          return { matched: true, contractType: 'DIGITOVER', barrier: '4', patternDigits: patternKey };
        }
        if (allUnder5) {
          return { matched: true, contractType: 'DIGITUNDER', barrier: '5', patternDigits: patternKey };
        }
        return { matched: false };
      }
      
      case 'over4_under5_5': {
        if (digits.length < 5) return { matched: false };
        const last5 = digits.slice(-5);
        const patternKey = `${last5.join(',')}`;
        const allOver4 = last5.every(d => d >= 5);
        const allUnder5 = last5.every(d => d <= 4);
        
        if (allOver4) {
          return { matched: true, contractType: 'DIGITOVER', barrier: '4', patternDigits: patternKey };
        }
        if (allUnder5) {
          return { matched: true, contractType: 'DIGITUNDER', barrier: '5', patternDigits: patternKey };
        }
        return { matched: false };
      }
      
      case 'over4_under5_6': {
        if (digits.length < 6) return { matched: false };
        const last6 = digits.slice(-6);
        const patternKey = `${last6.join(',')}`;
        const allOver4 = last6.every(d => d >= 5);
        const allUnder5 = last6.every(d => d <= 4);
        
        if (allOver4) {
          return { matched: true, contractType: 'DIGITOVER', barrier: '4', patternDigits: patternKey };
        }
        if (allUnder5) {
          return { matched: true, contractType: 'DIGITUNDER', barrier: '5', patternDigits: patternKey };
        }
        return { matched: false };
      }
      
      case 'over4_under5_7': {
        if (digits.length < 7) return { matched: false };
        const last7 = digits.slice(-7);
        const patternKey = `${last7.join(',')}`;
        const allOver4 = last7.every(d => d >= 5);
        const allUnder5 = last7.every(d => d <= 4);
        
        if (allOver4) {
          return { matched: true, contractType: 'DIGITOVER', barrier: '4', patternDigits: patternKey };
        }
        if (allUnder5) {
          return { matched: true, contractType: 'DIGITUNDER', barrier: '5', patternDigits: patternKey };
        }
        return { matched: false };
      }
      
      default:
        return { matched: false };
    }
  }, [m1StrategyType, isDataFresh, getRecentDigits]);

  // M2 Pattern Checker - FIXED to check all markets properly
  const checkM2Pattern = useCallback((symbol: string): { matched: boolean; contractType?: string; barrier?: string; patternDigits?: string } => {
    if (!isDataFresh(symbol)) {
      return { matched: false };
    }
    
    const digits = getRecentDigits(symbol, 10);
    if (digits.length === 0) return { matched: false };
    
    switch (m2RecoveryType) {
      case 'odd_even_3': {
        if (digits.length < 3) return { matched: false };
        const last3 = digits.slice(-3);
        const patternKey = `${last3.join(',')}`;
        const allOdd = last3.every(d => d % 2 !== 0);
        const allEven = last3.every(d => d % 2 === 0);
        
        if (allOdd) {
          return { matched: true, contractType: 'DIGITEVEN', patternDigits: patternKey };
        }
        if (allEven) {
          return { matched: true, contractType: 'DIGITODD', patternDigits: patternKey };
        }
        return { matched: false };
      }
      
      case 'odd_even_4': {
        if (digits.length < 4) return { matched: false };
        const last4 = digits.slice(-4);
        const patternKey = `${last4.join(',')}`;
        const allOdd = last4.every(d => d % 2 !== 0);
        const allEven = last4.every(d => d % 2 === 0);
        
        if (allOdd) {
          return { matched: true, contractType: 'DIGITEVEN', patternDigits: patternKey };
        }
        if (allEven) {
          return { matched: true, contractType: 'DIGITODD', patternDigits: patternKey };
        }
        return { matched: false };
      }
      
      case 'odd_even_5': {
        if (digits.length < 5) return { matched: false };
        const last5 = digits.slice(-5);
        const patternKey = `${last5.join(',')}`;
        const allOdd = last5.every(d => d % 2 !== 0);
        const allEven = last5.every(d => d % 2 === 0);
        
        if (allOdd) {
          return { matched: true, contractType: 'DIGITEVEN', patternDigits: patternKey };
        }
        if (allEven) {
          return { matched: true, contractType: 'DIGITODD', patternDigits: patternKey };
        }
        return { matched: false };
      }
      
      case 'odd_even_6': {
        if (digits.length < 6) return { matched: false };
        const last6 = digits.slice(-6);
        const patternKey = `${last6.join(',')}`;
        const allOdd = last6.every(d => d % 2 !== 0);
        const allEven = last6.every(d => d % 2 === 0);
        
        if (allOdd) {
          return { matched: true, contractType: 'DIGITEVEN', patternDigits: patternKey };
        }
        if (allEven) {
          return { matched: true, contractType: 'DIGITODD', patternDigits: patternKey };
        }
        return { matched: false };
      }
      
      case 'odd_even_7': {
        if (digits.length < 7) return { matched: false };
        const last7 = digits.slice(-7);
        const patternKey = `${last7.join(',')}`;
        const allOdd = last7.every(d => d % 2 !== 0);
        const allEven = last7.every(d => d % 2 === 0);
        
        if (allOdd) {
          return { matched: true, contractType: 'DIGITEVEN', patternDigits: patternKey };
        }
        if (allEven) {
          return { matched: true, contractType: 'DIGITODD', patternDigits: patternKey };
        }
        return { matched: false };
      }
      
      case 'odd_even_8': {
        if (digits.length < 8) return { matched: false };
        const last8 = digits.slice(-8);
        const patternKey = `${last8.join(',')}`;
        const allOdd = last8.every(d => d % 2 !== 0);
        const allEven = last8.every(d => d % 2 === 0);
        
        if (allOdd) {
          return { matched: true, contractType: 'DIGITEVEN', patternDigits: patternKey };
        }
        if (allEven) {
          return { matched: true, contractType: 'DIGITODD', patternDigits: patternKey };
        }
        return { matched: false };
      }
      
      case 'odd_even_9': {
        if (digits.length < 9) return { matched: false };
        const last9 = digits.slice(-9);
        const patternKey = `${last9.join(',')}`;
        const allOdd = last9.every(d => d % 2 !== 0);
        const allEven = last9.every(d => d % 2 === 0);
        
        if (allOdd) {
          return { matched: true, contractType: 'DIGITEVEN', patternDigits: patternKey };
        }
        if (allEven) {
          return { matched: true, contractType: 'DIGITODD', patternDigits: patternKey };
        }
        return { matched: false };
      }
      
      case 'over4_under5_5': {
        if (digits.length < 5) return { matched: false };
        const last5 = digits.slice(-5);
        const patternKey = `${last5.join(',')}`;
        const allOver4 = last5.every(d => d >= 5);
        const allUnder5 = last5.every(d => d <= 4);
        
        if (allOver4) {
          return { matched: true, contractType: 'DIGITOVER', barrier: '4', patternDigits: patternKey };
        }
        if (allUnder5) {
          return { matched: true, contractType: 'DIGITUNDER', barrier: '5', patternDigits: patternKey };
        }
        return { matched: false };
      }
      
      case 'over4_under5_6': {
        if (digits.length < 6) return { matched: false };
        const last6 = digits.slice(-6);
        const patternKey = `${last6.join(',')}`;
        const allOver4 = last6.every(d => d >= 5);
        const allUnder5 = last6.every(d => d <= 4);
        
        if (allOver4) {
          return { matched: true, contractType: 'DIGITOVER', barrier: '4', patternDigits: patternKey };
        }
        if (allUnder5) {
          return { matched: true, contractType: 'DIGITUNDER', barrier: '5', patternDigits: patternKey };
        }
        return { matched: false };
      }
      
      case 'over4_under5_7': {
        if (digits.length < 7) return { matched: false };
        const last7 = digits.slice(-7);
        const patternKey = `${last7.join(',')}`;
        const allOver4 = last7.every(d => d >= 5);
        const allUnder5 = last7.every(d => d <= 4);
        
        if (allOver4) {
          return { matched: true, contractType: 'DIGITOVER', barrier: '4', patternDigits: patternKey };
        }
        if (allUnder5) {
          return { matched: true, contractType: 'DIGITUNDER', barrier: '5', patternDigits: patternKey };
        }
        return { matched: false };
      }
      
      case 'over4_under5_8': {
        if (digits.length < 8) return { matched: false };
        const last8 = digits.slice(-8);
        const patternKey = `${last8.join(',')}`;
        const allOver4 = last8.every(d => d >= 5);
        const allUnder5 = last8.every(d => d <= 4);
        
        if (allOver4) {
          return { matched: true, contractType: 'DIGITOVER', barrier: '4', patternDigits: patternKey };
        }
        if (allUnder5) {
          return { matched: true, contractType: 'DIGITUNDER', barrier: '5', patternDigits: patternKey };
        }
        return { matched: false };
      }
      
      case 'over4_under5_9': {
        if (digits.length < 9) return { matched: false };
        const last9 = digits.slice(-9);
        const patternKey = `${last9.join(',')}`;
        const allOver4 = last9.every(d => d >= 5);
        const allUnder5 = last9.every(d => d <= 4);
        
        if (allOver4) {
          return { matched: true, contractType: 'DIGITOVER', barrier: '4', patternDigits: patternKey };
        }
        if (allUnder5) {
          return { matched: true, contractType: 'DIGITUNDER', barrier: '5', patternDigits: patternKey };
        }
        return { matched: false };
      }
      
      case 'over3_under6_5': {
        if (digits.length < 5) return { matched: false };
        const last5 = digits.slice(-5);
        const patternKey = `${last5.join(',')}`;
        const allLessThan3 = last5.every(d => d < 3);
        const allGreaterThan6 = last5.every(d => d > 6);
        
        if (allLessThan3) {
          return { matched: true, contractType: 'DIGITOVER', barrier: '3', patternDigits: patternKey };
        }
        if (allGreaterThan6) {
          return { matched: true, contractType: 'DIGITUNDER', barrier: '6', patternDigits: patternKey };
        }
        return { matched: false };
      }
      
      case 'over3_under6_7': {
        if (digits.length < 7) return { matched: false };
        const last7 = digits.slice(-7);
        const patternKey = `${last7.join(',')}`;
        const allLessThan3 = last7.every(d => d < 3);
        const allGreaterThan6 = last7.every(d => d > 6);
        
        if (allLessThan3) {
          return { matched: true, contractType: 'DIGITOVER', barrier: '3', patternDigits: patternKey };
        }
        if (allGreaterThan6) {
          return { matched: true, contractType: 'DIGITUNDER', barrier: '6', patternDigits: patternKey };
        }
        return { matched: false };
      }
      
      default:
        return { matched: false };
    }
  }, [m2RecoveryType, isDataFresh, getRecentDigits]);

  const addDetectedPattern = useCallback((symbol: string, name: string, patternType: string, digits: number[]) => {
    const newPattern = {
      symbol,
      name,
      patternType,
      timestamp: Date.now(),
      digits: [...digits]
    };
    setDetectedPatterns(prev => [newPattern, ...prev].slice(0, 10));
    setTimeout(() => {
      setDetectedPatterns(prev => prev.filter(p => p.timestamp !== newPattern.timestamp));
    }, 5000);
  }, []);

  // Find M1 match across ALL markets - FIXED to properly check each market
  const findM1Match = useCallback((): { symbol: string; contractType: string; barrier?: string; patternDigits: string } | null => {
    // CRITICAL FIX: Only allow trade if 2 seconds have passed since last trade
    if (Date.now() - lastTradeOverallRef.current < 2000) return null;
    
    // Shuffle markets for fair distribution? No, scan in order but log which we check
    for (const market of SCANNER_MARKETS) {
      // Skip if market has no data or subscription issue
      const hasSubscription = subscriptionStatusRef.current.get(market.symbol);
      if (!hasSubscription) {
        // Try to resubscribe if needed
        if (derivApi.isConnected) {
          derivApi.subscribeTicks(market.symbol as MarketSymbol, () => {}).catch(() => {});
        }
        continue;
      }
      
      const result = checkM1Pattern(market.symbol);
      if (result.matched && result.contractType && result.patternDigits) {
        const digits = getRecentDigits(market.symbol, 5);
        addDetectedPattern(market.symbol, market.name, `M1: ${m1StrategyType}`, digits);
        
        // Check for duplicate pattern on same symbol
        const lastPattern = lastPatternDigitsRef.current.get(market.symbol);
        if (lastPattern === result.patternDigits) {
          logDebug(`[M1] Skipping duplicate pattern for ${market.symbol}: ${result.patternDigits}`);
          continue;
        }
        
        // Check cooldown for this specific symbol (30 seconds)
        const lastTrade = lastTradeTimeRef.current.get(market.symbol) || 0;
        if (Date.now() - lastTrade < 30000) {
          logDebug(`[M1] Cooldown active for ${market.symbol}, last trade: ${new Date(lastTrade).toLocaleTimeString()}`);
          continue;
        }
        
        logDebug(`[M1] ✅ PATTERN FOUND on ${market.symbol}: ${result.patternDigits} (${result.contractType}${result.barrier ? ` barrier ${result.barrier}` : ''})`);
        
        return { 
          symbol: market.symbol, 
          contractType: result.contractType, 
          barrier: result.barrier,
          patternDigits: result.patternDigits 
        };
      }
    }
    return null;
  }, [checkM1Pattern, m1StrategyType, addDetectedPattern, getRecentDigits]);

  // Find M2 match across ALL markets - FIXED to properly check each market
  const findM2Match = useCallback((): { symbol: string; contractType: string; barrier?: string; patternDigits: string } | null => {
    // CRITICAL FIX: Only allow trade if 2 seconds have passed since last trade
    if (Date.now() - lastTradeOverallRef.current < 2000) return null;
    
    for (const market of SCANNER_MARKETS) {
      const hasSubscription = subscriptionStatusRef.current.get(market.symbol);
      if (!hasSubscription) {
        if (derivApi.isConnected) {
          derivApi.subscribeTicks(market.symbol as MarketSymbol, () => {}).catch(() => {});
        }
        continue;
      }
      
      const result = checkM2Pattern(market.symbol);
      if (result.matched && result.contractType && result.patternDigits) {
        const digits = getRecentDigits(market.symbol, 5);
        addDetectedPattern(market.symbol, market.name, `M2: ${m2RecoveryType}`, digits);
        
        const lastPattern = lastPatternDigitsRef.current.get(market.symbol);
        if (lastPattern === result.patternDigits) {
          logDebug(`[M2] Skipping duplicate pattern for ${market.symbol}: ${result.patternDigits}`);
          continue;
        }
        
        const lastTrade = lastTradeTimeRef.current.get(market.symbol) || 0;
        if (Date.now() - lastTrade < 30000) {
          logDebug(`[M2] Cooldown active for ${market.symbol}, last trade: ${new Date(lastTrade).toLocaleTimeString()}`);
          continue;
        }
        
        logDebug(`[M2] ✅ PATTERN FOUND on ${market.symbol}: ${result.patternDigits} (${result.contractType}${result.barrier ? ` barrier ${result.barrier}` : ''})`);
        
        return { 
          symbol: market.symbol, 
          contractType: result.contractType, 
          barrier: result.barrier,
          patternDigits: result.patternDigits 
        };
      }
    }
    return null;
  }, [checkM2Pattern, m2RecoveryType, addDetectedPattern, getRecentDigits]);

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
    tpNotifiedRef.current = false;
    slNotifiedRef.current = false;
    lastPnlRef.current = 0;
    netProfitRef.current = 0;
  }, []);

  // IMMEDIATE balance update function - CRITICAL FIX
  const updateBalanceAndProfit = useCallback(async (pnl: number, contractId?: string): Promise<{ newProfit: number; newBalance: number }> => {
    // First, immediately update local state for UI responsiveness
    const newProfit = netProfitRef.current + pnl;
    const newBalance = localBalanceRef.current + pnl;
    
    netProfitRef.current = newProfit;
    localBalanceRef.current = newBalance;
    
    setNetProfit(newProfit);
    setLocalBalance(newBalance);
    
    logDebug(`Immediate UI update - P&L: ${pnl}, New Profit: ${newProfit}, New Balance: ${newBalance}`);
    
    // CRITICAL: Force immediate API balance sync after trade completion
    // This ensures the next trade uses the most up-to-date balance
    if (refreshBalance) {
      try {
        // Short delay to allow API to process the contract result
        await new Promise(resolve => setTimeout(resolve, IMMEDIATE_BALANCE_SYNC_DELAY));
        
        // Force refresh balance from API
        await refreshBalance();
        
        // Update local state with API balance
        const apiBal = apiBalance;
        if (Math.abs(apiBal - localBalanceRef.current) > 0.01) {
          logDebug(`Balance discrepancy detected - Local: $${localBalanceRef.current}, API: $${apiBal}. Syncing...`);
          setLocalBalance(apiBal);
          localBalanceRef.current = apiBal;
          // Adjust net profit to match actual balance
          const adjustedProfit = apiBal - (localBalanceRef.current - pnl);
          setNetProfit(adjustedProfit);
          netProfitRef.current = adjustedProfit;
        } else {
          logDebug(`Balance verified - API balance: $${apiBal} matches local`);
        }
        
        return { newProfit: netProfitRef.current, newBalance: localBalanceRef.current };
      } catch (error) {
        logDebug('Post-trade balance sync failed:', error);
      }
    }
    
    return { newProfit, newBalance };
  }, [apiBalance, refreshBalance]);

  const executeRealTrade = useCallback(async (
    contractType: string,
    barrier: string | undefined,
    tradeSymbol: string,
    cStake: number,
    mStep: number,
    mkt: 1 | 2,
    currentLocalBalance: number,
    currentNetProfit: number,
    baseStake: number,
    patternDigits: string
  ) => {
    if (!derivApi.isConnected) {
      const connected = await ensureConnection();
      if (!connected) {
        throw new Error('No connection available');
      }
    }
    
    const logId = ++logIdRef.current;
    const now = new Date().toLocaleTimeString();
    setTotalStaked(prev => prev + cStake);
    setCurrentStakeState(cStake);

    // CRITICAL FIX: Immediately record the pattern and trade time to prevent duplicates
    lastPatternDigitsRef.current.set(tradeSymbol, patternDigits);
    lastTradeTimeRef.current.set(tradeSymbol, Date.now());
    lastTradeOverallRef.current = Date.now();

    addLog(logId, {
      time: now, market: mkt === 1 ? 'M1' : 'M2', symbol: tradeSymbol,
      contract: contractType, stake: cStake, martingaleStep: mStep,
      exitDigit: '...', result: 'Pending', pnl: 0, balance: currentLocalBalance,
      switchInfo: `Pattern: ${patternDigits}`,
    });

    let inRecovery = mkt === 2;
    let updatedLocalBalance = currentLocalBalance;
    let updatedNetProfit = currentNetProfit;
    let contractId: string | null = null;

    try {
      await waitForNextTick(tradeSymbol as MarketSymbol);

      const buyParams: any = {
        contract_type: contractType, symbol: tradeSymbol,
        duration: 1, duration_unit: 't', basis: 'stake', amount: cStake,
      };
      if (barrier) buyParams.barrier = barrier;

      const buyResult = await derivApi.buyContract(buyParams);
      contractId = buyResult.contractId;
      
      if (copyTradingService.enabled) {
        copyTradingService.copyTrade({
          ...buyParams,
          masterTradeId: contractId,
        }).catch(err => console.error('Copy trading error:', err));
      }
      
      const result = await derivApi.waitForContractResult(contractId);
      const won = result.status === 'won';
      const pnl = result.profit;
      
      // CRITICAL FIX: IMMEDIATE BALANCE UPDATE - Sync with API right after trade result
      const { newProfit, newBalance } = await updateBalanceAndProfit(pnl, contractId);
      updatedNetProfit = newProfit;
      updatedLocalBalance = newBalance;
      
      if (won) {
        setWins(prev => prev + 1);
      } else {
        setLosses(prev => prev + 1);
        if (activeAccount?.is_virtual) {
          recordLoss(cStake, tradeSymbol, 6000);
        }
      }

      const exitDigit = String(getLastDigit(result.sellPrice || 0));

      let switchInfo = `Pattern: ${patternDigits} | Exit: ${exitDigit}`;
      let shouldResetMartingale = false;
      
      if (won) {
        if (inRecovery) {
          switchInfo += ' ✓ Recovery WIN → Back to M1';
          inRecovery = false;
          shouldResetMartingale = true;
        } else {
          switchInfo += ' ✓ WIN → Continue scanning';
          shouldResetMartingale = true;
        }
      } else {
        if (martingaleOn && mStep < parseInt(martingaleMaxSteps)) {
          cStake = parseFloat((cStake * (parseFloat(martingaleMultiplier) || 2)).toFixed(2));
          mStep++;
          
          if (!inRecovery && m2Enabled) {
            inRecovery = true;
            switchInfo += ` ✗ Loss → Martingale (Step ${mStep}) → M2 Recovery`;
          } else if (!inRecovery && !m2Enabled) {
            switchInfo += ` ✗ Loss → Martingale (Step ${mStep}) → Continue M1`;
          } else if (inRecovery) {
            switchInfo += ` ✗ Loss → Martingale (Step ${mStep}) → Stay M2`;
          }
        } else {
          switchInfo += martingaleOn ? ` ✗ Loss → Max steps reached. Reset.` : ' ✗ Loss → Martingale disabled. Reset.';
          shouldResetMartingale = true;
          
          if (!inRecovery && m2Enabled) {
            inRecovery = true;
            switchInfo += ' → M2 Recovery';
          }
        }
      }
      
      if (shouldResetMartingale) {
        mStep = 0;
        cStake = baseStake;
      }

      setMartingaleStepState(mStep);
      setCurrentStakeState(cStake);

      updateLog(logId, { 
        exitDigit, 
        result: won ? 'Win' : 'Loss', 
        pnl, 
        balance: updatedLocalBalance, 
        switchInfo 
      });

      let shouldBreak = false;
      if (updatedNetProfit >= parseFloat(takeProfit)) {
        showTPNotification('tp', `Take Profit Hit!`, updatedNetProfit);
        shouldBreak = true;
      }
      if (updatedNetProfit <= -parseFloat(stopLoss)) {
        showTPNotification('sl', `Stop Loss Hit!`, Math.abs(updatedNetProfit));
        shouldBreak = true;
      }
      if (updatedLocalBalance < cStake) {
        shouldBreak = true;
      }

      return { 
        localPnl: updatedNetProfit, 
        localBalance: updatedLocalBalance, 
        cStake, 
        mStep, 
        inRecovery, 
        shouldBreak 
      };
    } catch (err: any) {
      logDebug('Trade execution error:', err);
      updateLog(logId, { result: 'Loss', pnl: 0, exitDigit: '-', switchInfo: `Error: ${err.message}` });
      await new Promise(r => setTimeout(r, 2000));
      return { 
        localPnl: updatedNetProfit, 
        localBalance: updatedLocalBalance, 
        cStake, 
        mStep, 
        inRecovery, 
        shouldBreak: false 
      };
    }
  }, [addLog, updateLog, m2Enabled, martingaleOn, martingaleMultiplier, martingaleMaxSteps, takeProfit, stopLoss, activeAccount, recordLoss, ensureConnection, updateBalanceAndProfit]);

  const startBot = useCallback(async () => {
    if (!isAuthorized || isRunning) return;
    
    const connected = await ensureConnection();
    if (!connected) {
      return;
    }
    
    const baseStake = parseFloat(stake);
    if (baseStake < 0.35) { 
      return; 
    }
    if (!m1Enabled && !m2Enabled) { 
      return; 
    }

    setIsRunning(true);
    runningRef.current = true;
    setCurrentMarket(1);
    setBotStatus('trading_m1');
    setCurrentStakeState(baseStake);
    setMartingaleStepState(0);
    
    lastTradeTimeRef.current.clear();
    lastPatternDigitsRef.current.clear();
    lastTradeOverallRef.current = 0;
    tpNotifiedRef.current = false;
    slNotifiedRef.current = false;
    lastPnlRef.current = 0;

    // Force immediate balance sync before starting
    await forceImmediateBalanceUpdate();
    
    // Reset local balance and net profit to current API balance
    const startBalance = localBalanceRef.current;
    setLocalBalance(startBalance);
    setNetProfit(0);
    netProfitRef.current = 0;
    setWins(0);
    setLosses(0);
    setTotalStaked(0);

    let cStake = baseStake;
    let mStep = 0;
    let inRecovery = false;
    let currentNetProfit = 0;
    let currentLocalBalance = startBalance;
    let waitingForPatternAfterLoss = false;

    while (runningRef.current) {
      if (!derivApi.isConnected) {
        const reconnected = await ensureConnection();
        if (!reconnected) {
          break;
        }
      }
      
      const mkt: 1 | 2 = inRecovery ? 2 : 1;
      setCurrentMarket(mkt);

      if (mkt === 1 && !m1Enabled) { if (m2Enabled) { inRecovery = true; continue; } else break; }
      if (mkt === 2 && !m2Enabled) { inRecovery = false; continue; }

      let tradeSymbol: string;
      let contractType: string;
      let barrier: string | undefined;
      let patternDigits: string;

      if (waitingForPatternAfterLoss) {
        logDebug('⏳ Waiting for fresh pattern after loss');
        await new Promise(r => setTimeout(r, 1000));
        waitingForPatternAfterLoss = false;
        continue;
      }

      if (!inRecovery && strategyM1Enabled && m1StrategyType !== 'disabled') {
        setBotStatus('waiting_pattern');

        let matched = false;
        let matchData: { symbol: string; contractType: string; barrier?: string; patternDigits: string } | null = null;
        let attempts = 0;
        
        while (runningRef.current && !matched && attempts < MAX_SCAN_ATTEMPTS) {
          if (!derivApi.isConnected) {
            const reconnected = await ensureConnection();
            if (!reconnected) break;
          }
          
          matchData = findM1Match();
          if (matchData) {
            matched = true;
            logDebug(`M1 pattern matched after ${attempts} attempts`);
          }
          if (!matched) {
            await new Promise<void>(r => setTimeout(r, SCAN_INTERVAL));
            attempts++;
          }
        }
        if (!runningRef.current || !matched) {
          if (!matched) logDebug('M1 scan completed without pattern, continuing...');
          continue;
        }

        setBotStatus('pattern_matched');
        tradeSymbol = matchData!.symbol;
        contractType = matchData!.contractType;
        barrier = matchData!.barrier;
        patternDigits = matchData!.patternDigits;
        await new Promise(r => setTimeout(r, 500));
      }
      else if (inRecovery && strategyM2Enabled && m2RecoveryType !== 'disabled') {
        setBotStatus('waiting_pattern');

        let matched = false;
        let matchData: { symbol: string; contractType: string; barrier?: string; patternDigits: string } | null = null;
        let attempts = 0;
        
        while (runningRef.current && !matched && attempts < MAX_SCAN_ATTEMPTS) {
          if (!derivApi.isConnected) {
            const reconnected = await ensureConnection();
            if (!reconnected) break;
          }
          
          matchData = findM2Match();
          if (matchData) {
            matched = true;
            logDebug(`M2 pattern matched after ${attempts} attempts`);
          }
          if (!matched) {
            await new Promise<void>(r => setTimeout(r, SCAN_INTERVAL));
            attempts++;
          }
        }
        if (!runningRef.current || !matched) {
          if (!matched) logDebug('M2 scan completed without pattern, continuing...');
          continue;
        }

        setBotStatus('pattern_matched');
        tradeSymbol = matchData!.symbol;
        contractType = matchData!.contractType;
        barrier = matchData!.barrier;
        patternDigits = matchData!.patternDigits;
        await new Promise(r => setTimeout(r, 500));
      }
      else {
        setBotStatus(mkt === 1 ? 'trading_m1' : 'recovery');
        tradeSymbol = 'R_100';
        contractType = 'DIGITEVEN';
        barrier = undefined;
        patternDigits = 'default';
      }

      const result = await executeRealTrade(
        contractType, barrier, tradeSymbol, cStake, mStep, mkt, currentLocalBalance, currentNetProfit, baseStake, patternDigits
      );
      if (!result || !runningRef.current) break;
      
      const wasLoss = result.cStake !== cStake || result.mStep !== mStep || result.inRecovery !== inRecovery;
      if (wasLoss && !result.shouldBreak && martingaleOn && result.mStep > 0 && !result.inRecovery) {
        waitingForPatternAfterLoss = true;
      }
      
      currentNetProfit = result.localPnl;
      currentLocalBalance = result.localBalance;
      cStake = result.cStake;
      mStep = result.mStep;
      inRecovery = result.inRecovery;

      if (result.shouldBreak) break;

      await new Promise(r => setTimeout(r, 1000));
    }

    setIsRunning(false);
    runningRef.current = false;
    setBotStatus('idle');
    logDebug('Bot stopped');
  }, [isAuthorized, isRunning, stake, m1Enabled, m2Enabled,
    martingaleOn, martingaleMultiplier, martingaleMaxSteps, takeProfit, stopLoss,
    strategyM1Enabled, strategyM2Enabled, m1StrategyType, m2RecoveryType,
    findM1Match, findM2Match, addLog, updateLog, executeRealTrade, ensureConnection, forceImmediateBalanceUpdate]);

  const statusConfig: Record<BotStatus, { icon: string; label: string; color: string }> = {
    idle: { icon: '⚪', label: 'IDLE', color: 'text-slate-400' },
    trading_m1: { icon: '🟢', label: 'TRADING M1', color: 'text-emerald-400' },
    recovery: { icon: '🟣', label: 'RECOVERY MODE', color: 'text-fuchsia-400' },
    waiting_pattern: { icon: '🟡', label: 'WAITING PATTERN', color: 'text-amber-400' },
    pattern_matched: { icon: '✅', label: 'PATTERN MATCHED', color: 'text-emerald-400' },
    reconnecting: { icon: '🔄', label: 'RECONNECTING...', color: 'text-orange-400' },
  };

  const status = statusConfig[botStatus];
  const winRate = wins + losses > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : '0.0';

  const dollarColors = ['text-emerald-400', 'text-cyan-400', 'text-amber-400', 'text-rose-400', 'text-purple-400', 'text-blue-400', 'text-indigo-400', 'text-pink-400'];

  const getM1DisplayName = (type: M1StrategyType): string => {
    switch (type) {
      case 'over0_under9_1': return '🎯 Over 0 / Under 9 (1 tick)';
      case 'over0_under9_2': return '🎯 Over 0 / Under 9 (2 ticks)';
      case 'over0_under9_3': return '🎯 Over 0 / Under 9 (3 ticks)';
      case 'over0_under9_4': return '🎯 Over 0 / Under 9 (4 ticks)';
      case 'over1_under8_2': return '🎯 Over 1 / Under 8 (2 ticks)';
      case 'over1_under8_3': return '🎯 Over 1 / Under 8 (3 ticks)';
      case 'over1_under8_4': return '🎯 Over 1 / Under 8 (4 ticks)';
      case 'over2_under7_2': return '🎯 Over 2 / Under 7 (2 ticks)';
      case 'over2_under7_3': return '🎯 Over 2 / Under 7 (3 ticks)';
      case 'over2_under7_4': return '🎯 Over 2 / Under 7 (4 ticks)';
      case 'over2_under7_5': return '🎯 Over 2 / Under 7 (5 ticks)';
      case 'over3_under6_4': return '🎯 Over 3 / Under 6 (4 ticks)';
      case 'over4_under5_4': return '🎯 Over 4 / Under 5 (4 ticks)';
      case 'over4_under5_5': return '🎯 Over 4 / Under 5 (5 ticks)';
      case 'over4_under5_6': return '🎯 Over 4 / Under 5 (6 ticks)';
      case 'over4_under5_7': return '🎯 Over 4 / Under 5 (7 ticks)';
      default: return 'Select strategy';
    }
  };

  const getM2DisplayName = (type: M2RecoveryType): string => {
    switch (type) {
      case 'odd_even_3': return '🔄 Even / Odd (3 ticks)';
      case 'odd_even_4': return '🔄 Even / Odd (4 ticks)';
      case 'odd_even_5': return '🔄 Even / Odd (5 ticks)';
      case 'odd_even_6': return '🔄 Even / Odd (6 ticks)';
      case 'odd_even_7': return '🔄 Even / Odd (7 ticks)';
      case 'odd_even_8': return '🔄 Even / Odd (8 ticks)';
      case 'odd_even_9': return '🔄 Even / Odd (9 ticks)';
      case 'over4_under5_5': return '🎯 Over 4 / Under 5 (5 ticks)';
      case 'over4_under5_6': return '🎯 Over 4 / Under 5 (6 ticks)';
      case 'over4_under5_7': return '🎯 Over 4 / Under 5 (7 ticks)';
      case 'over4_under5_8': return '🎯 Over 4 / Under 5 (8 ticks)';
      case 'over4_under5_9': return '🎯 Over 4 / Under 5 (9 ticks)';
      case 'over3_under6_5': return '🎯 Over 3 / Under 6 (5 ticks)';
      case 'over3_under6_7': return '🎯 Over 3 / Under 6 (7 ticks)';
      default: return 'Select strategy';
    }
  };

  return (
    <>
      <style>{notificationStyles}</style>
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-4">
        <div className="space-y-3 max-w-7xl mx-auto">
          {/* Header */}
          <div className="bg-gradient-to-r from-slate-900/80 to-slate-800/80 backdrop-blur-sm border border-slate-700/50 rounded-xl px-4 py-3 shadow-xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-lg shadow-lg">
                  <Scan className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h1 className="text-lg font-bold bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
                    Ramzfx Ultimate 2026 Bot
                  </h1>
                  <p className="text-xs text-slate-400">Ramzfx Advanced Market Scanning & Recovery System</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Badge className={`${status.color} bg-slate-800/50 border-slate-700 text-[10px] px-3 py-1`}>
                  {status.icon} {status.label}
                </Badge>
                {isRunning && (
                  <Badge variant="outline" className="text-[10px] text-amber-400 animate-pulse border-amber-500/30 bg-amber-500/10">
                    P/L: ${netProfit.toFixed(2)}
                  </Badge>
                )}
                {isRunning && (
                  <Badge variant="outline" className={`text-[10px] ${currentMarket === 1 ? 'text-emerald-400 border-emerald-500/30' : 'text-fuchsia-400 border-fuchsia-500/30'} bg-slate-800/50`}>
                    {currentMarket === 1 ? '🏠 M1' : '🔄 M2'}
                  </Badge>
                )}
              </div>
            </div>
          </div>
       
          {/* Markets Row - Horizontal */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Market 1 */}
            <div className="bg-gradient-to-br from-slate-900/90 to-slate-800/90 backdrop-blur-sm border-2 border-emerald-500/30 rounded-xl p-4 shadow-xl">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-bold text-emerald-400 flex items-center gap-2">
                  <Home className="w-4 h-4" /> Market 1 Bot
                </h3>
                <div className="flex items-center gap-2">
                  {currentMarket === 1 && isRunning && <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />}
                  <Switch checked={m1Enabled} onCheckedChange={setM1Enabled} disabled={isRunning} />
                </div>
              </div>
              
              <div className="space-y-3">
                <div>
                  <label className="text-[11px] text-slate-400 mb-1.5 block font-semibold">Strategy Mode</label>
                  <Select value={m1StrategyType} onValueChange={(v: M1StrategyType) => {
                    setM1StrategyType(v);
                    if (v !== 'disabled') {
                      setStrategyM1Enabled(true);
                      setScannerActive(true);
                    }
                  }} disabled={isRunning}>
                    <SelectTrigger className="h-10 text-sm bg-slate-800/50 border-slate-700 text-slate-200">
                      <SelectValue placeholder="Select strategy" />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-800 border-slate-700 max-h-[300px] overflow-y-auto">
                      <SelectItem value="over0_under9_1">🎯 Over 0 / Under 9 (1 tick)</SelectItem>
                      <SelectItem value="over0_under9_2">🎯 Over 0 / Under 9 (2 ticks)</SelectItem>
                      <SelectItem value="over0_under9_3">🎯 Over 0 / Under 9 (3 ticks)</SelectItem>
                      <SelectItem value="over0_under9_4">🎯 Over 0 / Under 9 (4 ticks)</SelectItem>
                      <SelectItem value="over1_under8_2">🎯 Over 1 / Under 8 (2 ticks)</SelectItem>
                      <SelectItem value="over1_under8_3">🎯 Over 1 / Under 8 (3 ticks)</SelectItem>
                      <SelectItem value="over1_under8_4">🎯 Over 1 / Under 8 (4 ticks)</SelectItem>
                      <SelectItem value="over2_under7_2">🎯 Over 2 / Under 7 (2 ticks)</SelectItem>
                      <SelectItem value="over2_under7_3">🎯 Over 2 / Under 7 (3 ticks)</SelectItem>
                      <SelectItem value="over2_under7_4">🎯 Over 2 / Under 7 (4 ticks)</SelectItem>
                      <SelectItem value="over2_under7_5">🎯 Over 2 / Under 7 (5 ticks)</SelectItem>
                      <SelectItem value="over3_under6_4">🎯 Over 3 / Under 6 (4 ticks)</SelectItem>
                      <SelectItem value="over4_under5_4">🎯 Over 4 / Under 5 (4 ticks)</SelectItem>
                      <SelectItem value="over4_under5_5">🎯 Over 4 / Under 5 (5 ticks)</SelectItem>
                      <SelectItem value="over4_under5_6">🎯 Over 4 / Under 5 (6 ticks)</SelectItem>
                      <SelectItem value="over4_under5_7">🎯 Over 4 / Under 5 (7 ticks)</SelectItem>
                    </SelectContent>
                  </Select>
                  {m1StrategyType !== 'disabled' && (
                    <div className="text-[10px] text-emerald-400 mt-2 animate-pulse flex items-center gap-1">
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                      </span>
                      Scanning ALL markets for fresh patterns...
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Market 2 */}
            <div className="bg-gradient-to-br from-slate-900/90 to-slate-800/90 backdrop-blur-sm border-2 border-fuchsia-500/30 rounded-xl p-4 shadow-xl">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-bold text-fuchsia-400 flex items-center gap-2">
                  <RefreshCw className="w-4 h-4" /> Market 2 — Recovery Bot
                </h3>
                <div className="flex items-center gap-2">
                  {currentMarket === 2 && isRunning && <span className="w-2 h-2 rounded-full bg-fuchsia-400 animate-pulse" />}
                  <Switch checked={m2Enabled} onCheckedChange={setM2Enabled} disabled={isRunning} />
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-[11px] text-slate-400 mb-1.5 block font-semibold">Recovery Strategy</label>
                  <Select value={m2RecoveryType} onValueChange={(v: M2RecoveryType) => {
                    setM2RecoveryType(v);
                    if (v !== 'disabled') {
                      setStrategyM2Enabled(true);
                      setScannerActive(true);
                    }
                  }} disabled={isRunning}>
                    <SelectTrigger className="h-10 text-sm bg-slate-800/50 border-slate-700 text-slate-200">
                      <SelectValue placeholder="Select strategy" />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-800 border-slate-700 max-h-[300px] overflow-y-auto">
                      <SelectItem value="odd_even_3">🔄 Even / Odd (3 ticks)</SelectItem>
                      <SelectItem value="odd_even_4">🔄 Even / Odd (4 ticks)</SelectItem>
                      <SelectItem value="odd_even_5">🔄 Even / Odd (5 ticks)</SelectItem>
                      <SelectItem value="odd_even_6">🔄 Even / Odd (6 ticks)</SelectItem>
                      <SelectItem value="odd_even_7">🔄 Even / Odd (7 ticks)</SelectItem>
                      <SelectItem value="odd_even_8">🔄 Even / Odd (8 ticks)</SelectItem>
                      <SelectItem value="odd_even_9">🔄 Even / Odd (9 ticks)</SelectItem>
                      <SelectItem value="over4_under5_5">🎯 Over 4 / Under 5 (5 ticks)</SelectItem>
                      <SelectItem value="over4_under5_6">🎯 Over 4 / Under 5 (6 ticks)</SelectItem>
                      <SelectItem value="over4_under5_7">🎯 Over 4 / Under 5 (7 ticks)</SelectItem>
                      <SelectItem value="over4_under5_8">🎯 Over 4 / Under 5 (8 ticks)</SelectItem>
                      <SelectItem value="over4_under5_9">🎯 Over 4 / Under 5 (9 ticks)</SelectItem>
                      <SelectItem value="over3_under6_5">🎯 Over 3 / Under 6 (5 ticks)</SelectItem>
                      <SelectItem value="over3_under6_7">🎯 Over 3 / Under 6 (7 ticks)</SelectItem>
                    </SelectContent>
                  </Select>
                  {m2RecoveryType !== 'disabled' && (
                    <div className="text-[10px] text-fuchsia-400 mt-2 animate-pulse flex items-center gap-1">
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-fuchsia-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-fuchsia-500"></span>
                      </span>
                      Scanning ALL markets for fresh recovery patterns...
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Risk Management */}
          <div className="bg-gradient-to-br from-slate-900/90 to-slate-800/90 backdrop-blur-sm border border-slate-700/50 rounded-xl p-4 shadow-xl">
            <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2 mb-3">
              <Shield className="w-4 h-4 text-amber-400" /> Bot Configuration 🚦
            </h3>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Stake ($)</label>
                <Input type="number" min="0.35" step="0.01" value={stake} onChange={e => setStake(e.target.value)} disabled={isRunning} className="h-9 text-sm bg-slate-800/50 border-slate-700 text-slate-200" />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Take Profit ($)</label>
                <Input type="number" value={takeProfit} onChange={e => setTakeProfit(e.target.value)} disabled={isRunning} className="h-9 text-sm bg-slate-800/50 border-slate-700 text-slate-200" />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Stop Loss ($)</label>
                <Input type="number" value={stopLoss} onChange={e => setStopLoss(e.target.value)} disabled={isRunning} className="h-9 text-sm bg-slate-800/50 border-slate-700 text-slate-200" />
              </div>
            </div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm text-slate-300 font-semibold">Martingale System</label>
              <Switch checked={martingaleOn} onCheckedChange={setMartingaleOn} disabled={isRunning} />
            </div>
            {martingaleOn && (
              <div className="grid grid-cols-2 gap-3 mt-2">
                <div>
                  <label className="text-[10px] text-slate-400 block mb-1">Multiplier</label>
                  <Input type="number" min="1.1" step="0.1" value={martingaleMultiplier} onChange={e => setMartingaleMultiplier(e.target.value)} disabled={isRunning} className="h-8 text-xs bg-slate-800/50 border-slate-700 text-slate-200" />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 block mb-1">Max Steps</label>
                  <Input type="number" min="1" max="10" value={martingaleMaxSteps} onChange={e => setMartingaleMaxSteps(e.target.value)} disabled={isRunning} className="h-8 text-xs bg-slate-800/50 border-slate-700 text-slate-200" />
                </div>
              </div>
            )}
          </div>

          {/* Single Start/Stop Button */}
          <div className="flex justify-center">
            <button
              onClick={isRunning ? stopBot : startBot}
              disabled={!isRunning && (!isAuthorized || localBalance < parseFloat(stake))}
              className={`
                relative w-[600px] h-14 text-base font-bold rounded-xl transition-all duration-300 ease-out
                overflow-hidden group
                ${isRunning 
                  ? 'bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-400 text-white shadow-lg shadow-red-500/30' 
                  : 'bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white shadow-lg shadow-blue-500/30'
                }
                disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100
                active:scale-95 transform
              `}
            >
              {isRunning && (
                <>
                  <span className="absolute inset-0 bg-white/20 animate-pulse rounded-xl" />
                  <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-shimmer" />
                </>
              )}
              
              <div className="relative flex items-center justify-center gap-3">
                {isRunning ? (
                  <>
                    <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <span className="flex items-center gap-1">
                      STOP BOT
                      <span className="flex gap-0.5 ml-1">
                        <span className="w-1.5 h-1.5 bg-white rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-1.5 h-1.5 bg-white rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-1.5 h-1.5 bg-white rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </span>
                    </span>
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5 transition-transform group-hover:scale-110" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                    <span className="flex  items-center gap-1">
                      RUN BOT
                      <span className="relative flex h-2 w-2 ml-1">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
                      </span>
                    </span>
                  </>
                )}
              </div>
            </button>
          </div>

          {/* Market Scanner Patterns Container */}
          <div className="flex justify-center">
            <div className="w-[1000px] bg-gradient-to-br from-slate-900/90 to-slate-800/90 backdrop-blur-sm border border-slate-700/50 rounded-xl shadow-xl overflow-hidden">
              <div className="p-3 border-b border-slate-700/50">
                <div className="flex items-center gap-2">
                  <div className="p-1 bg-gradient-to-br from-amber-500 to-orange-500 rounded-lg">
                    <Scan className="w-3 h-3 text-white" />
                  </div>
                  <h3 className="text-xs font-bold text-slate-200">Market Scanner - Pattern Detection</h3>
                  {scannerActive && (
                    <div className="flex items-center gap-1 ml-auto">
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                      </span>
                      <span className="text-[8px] text-emerald-400">Active</span>
                    </div>
                  )}
                </div>
              </div>
              
              {/* Animated Dollar Icons Row */}
              <div className="py-2 bg-slate-800/30 overflow-hidden relative">
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <span className="text-[8px] text-slate-400 font-mono bg-slate-800/80 px-2 py-0.5 rounded-full z-10">SCANNING</span>
                </div>
                <div className="flex items-center gap-2 animate-scroll-right-to-left" style={{ animation: 'scrollRightToLeft 12s linear infinite' }}>
                  {[...Array(15)].map((_, i) => (
                    <DollarSign 
                      key={i}
                      className={`w-3 h-3 ${dollarColors[i % dollarColors.length]} animate-pulse`}
                      style={{ 
                        animationDuration: `${0.5 + (i % 3) * 0.2}s`,
                        filter: 'drop-shadow(0 0 1px currentColor)'
                      }}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-2 animate-scroll-right-to-left" style={{ animation: 'scrollRightToLeft 12s linear infinite', position: 'absolute', top: 0, left: '100%' }}>
                  {[...Array(15)].map((_, i) => (
                    <DollarSign 
                      key={`dup-${i}`}
                      className={`w-3 h-3 ${dollarColors[i % dollarColors.length]} animate-pulse`}
                      style={{ 
                        animationDuration: `${0.5 + (i % 3) * 0.2}s`,
                        filter: 'drop-shadow(0 0 1px currentColor)'
                      }}
                    />
                  ))}
                </div>
              </div>
              
              {/* Detected Patterns Display */}
              <div className="h-[60px] overflow-y-auto">
                {detectedPatterns.length === 0 ? (
                  <div className="h-full flex items-center justify-center">
                    {/* Empty - no message shown until patterns found */}
                  </div>
                ) : (
                  <div className="p-2 space-y-1.5">
                    {detectedPatterns.map((pattern) => (
                      <div 
                        key={pattern.timestamp}
                        className="bg-slate-800/50 rounded-lg p-2 border border-slate-700/50 animate-slideIn"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center">
                              <DollarSign className="w-3 h-3 text-amber-400" />
                            </div>
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono text-[10px] font-bold text-slate-200">{pattern.symbol}</span>
                                <Badge className="text-[7px] bg-slate-700/50 text-slate-300 px-1 py-0">{pattern.name}</Badge>
                              </div>
                              <div className="text-[8px] text-amber-400">{pattern.patternType}</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <div className="flex gap-0.5">
                              {pattern.digits.map((digit, i) => (
                                <span 
                                  key={i}
                                  className="w-5 h-5 rounded bg-slate-700 flex items-center justify-center text-[9px] font-mono font-bold text-cyan-400"
                                >
                                  {digit}
                                </span>
                              ))}
                            </div>
                            <Badge className="text-[7px] bg-emerald-500/20 text-emerald-400 border-emerald-500/30 px-1 py-0">
                              FOUND
                            </Badge>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              
              {/* Scanning Animation Text */}
              <div className="p-2 border-t border-slate-700/30">
                <div className="flex items-center justify-between text-[8px] text-slate-500">
                  <span className="flex items-center gap-1">
                    <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse"></span>
                    {SCANNER_MARKETS.length} markets
                  </span>
                  <span className="font-mono text-[7px]">
                    M1: {m1StrategyType !== 'disabled' ? getM1DisplayName(m1StrategyType).substring(0, 25) : 'OFF'} 
                    {' | '}
                    M2: {m2RecoveryType !== 'disabled' ? getM2DisplayName(m2RecoveryType).substring(0, 25) : 'OFF'}
                  </span>
                </div>
              </div>
            </div>
          </div>
          
          {/* Performance Stats Row */}
          <div className="bg-gradient-to-br from-slate-900/80 to-slate-800/80 backdrop-blur-sm border border-slate-700/50 rounded-xl p-4 shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-cyan-400" />
                Trade Report 
              </span>
              <span className="font-mono text-xl font-bold text-cyan-400">${localBalance.toFixed(2)}</span>
            </div>
            <div className="grid grid-cols-6 gap-3">
              <div className="text-center bg-slate-800/30 rounded-lg p-2">
                <div className="text-[9px] text-slate-400 mb-1">Total Trades</div>
                <div className="font-mono text-lg font-bold text-slate-200">{wins + losses}</div>
              </div>
              <div className="text-center bg-slate-800/30 rounded-lg p-2">
                <div className="text-[9px] text-slate-400 mb-1">Win Rate</div>
                <div className="font-mono text-lg font-bold text-emerald-400">{winRate}%</div>
              </div>
              <div className="text-center bg-slate-800/30 rounded-lg p-2">
                <div className="text-[9px] text-slate-400 mb-1">Wins</div>
                <div className="font-mono text-lg font-bold text-emerald-400">{wins}</div>
              </div>
              <div className="text-center bg-slate-800/30 rounded-lg p-2">
                <div className="text-[9px] text-slate-400 mb-1">Losses</div>
                <div className="font-mono text-lg font-bold text-rose-400">{losses}</div>
              </div>
              <div className="text-center bg-slate-800/30 rounded-lg p-2">
                <div className="text-[9px] text-slate-400 mb-1">Total Staked</div>
                <div className="font-mono text-lg font-bold text-amber-400">
                  ${totalStaked.toFixed(2)}
                </div>
              </div>
              <div className="text-center bg-slate-800/30 rounded-lg p-2">
                <div className="text-[9px] text-slate-400 mb-1">Net Profit</div>
                <div className={`font-mono text-lg font-bold ${netProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {netProfit >= 0 ? '+' : ''}{netProfit.toFixed(2)}
                </div>
              </div>
            </div>
          </div>

          {/* Activity Log - Full Width */}
          <div className="bg-gradient-to-br from-slate-900/90 to-slate-800/90 backdrop-blur-sm border border-slate-700/50 rounded-xl overflow-hidden shadow-xl">
            <div className="px-4 py-3 border-b border-slate-700/50 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-cyan-400" />
                Trade Results  
                <Badge className="ml-2 bg-slate-800 text-slate-300 text-[9px]">
                  Current Stake: ${currentStake.toFixed(2)}{martingaleStep > 0 && ` M${martingaleStep}`}
                </Badge>
              </h3>
              <Button variant="ghost" size="sm" onClick={clearLog} className="h-7 w-7 p-0 text-slate-400 hover:text-rose-400 hover:bg-slate-800/50">
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
            <div className="max-h-[500px] overflow-auto">
              <table className="w-full text-[11px]">
                <thead className="text-[10px] text-slate-400 bg-slate-800/50 sticky top-0">
                  <tr>
                    <th className="text-left p-2">Time</th>
                    <th className="text-left p-2">Mkt</th>
                    <th className="text-left p-2">Symbol</th>
                    <th className="text-left p-2">Type</th>
                    <th className="text-right p-2">Stake</th>
                    <th className="text-center p-2">Result</th> 
                    <th className="text-right p-2">P/L</th>
                    <th className="text-right p-2">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {logEntries.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-center text-slate-500 py-12">
                        No trades yet — configure and start the bot
                      </td>
                    </tr>
                  ) : logEntries.map(e => (
                    <tr key={e.id} className={`border-t border-slate-700/30 hover:bg-slate-800/30 transition-colors ${
                      e.market === 'M1' ? 'border-l-2 border-l-emerald-500' : 'border-l-2 border-l-fuchsia-500'
                    }`}>
                      <td className="p-2 font-mono text-[9px] text-slate-400">{e.time}</td>
                      <td className={`p-2 font-bold text-xs ${
                        e.market === 'M1' ? 'text-emerald-400' : 'text-fuchsia-400'
                      }`}>{e.market}</td>
                      <td className="p-2 font-mono text-[9px] text-slate-300">{e.symbol}</td>
                      <td className="p-2 text-[9px] text-slate-300">{e.contract.replace('DIGIT', '')}</td>
                      <td className="p-2 font-mono text-right text-[9px] text-slate-300">
                        ${e.stake.toFixed(2)}
                        {e.martingaleStep > 0 && <span className="text-amber-400 ml-1">M{e.martingaleStep}</span>}
                      </td>
                      <td className="p-2 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${
                          e.result === 'Win' ? 'bg-emerald-500/20 text-emerald-400' :
                          e.result === 'Loss' ? 'bg-rose-500/20 text-rose-400' :
                          'bg-amber-500/20 text-amber-400 animate-pulse'
                        }`}>
                          {e.result === 'Pending' ? '...' : e.result}
                        </span>
                      </td>
                      <td className={`p-2 font-mono text-right text-[9px] font-bold ${
                        e.pnl > 0 ? 'text-emerald-400' : e.pnl < 0 ? 'text-rose-400' : 'text-slate-400'
                      }`}>
                        {e.result === 'Pending' ? '...' : `${e.pnl > 0 ? '+' : ''}${e.pnl.toFixed(2)}`}
                      </td>
                      <td className="p-2 font-mono text-right text-[9px] text-slate-400">
                        ${e.balance.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
      
      {/* Compact Centered Notification Popup */}
      <NotificationPopup />
    </>
  );
         }
