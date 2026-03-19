import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/components/ui/use-toast';
import {
    Activity,
    AlertCircle,
    BarChart3,
    Brain,
    ChevronDown,
    ChevronUp,
    CircleDot,
    Copy,
    Download,
    Eye,
    Gauge,
    Hash,
    Loader2,
    LogOut,
    Play,
    Plus,
    RefreshCw,
    Save,
    Scan,
    Settings,
    StopCircle,
    Timer,
    TrendingDown,
    TrendingUp,
    Trash2,
    Upload,
    Volume2,
    VolumeX,
    Waves,
    Wind,
    XCircle,
    Zap,
    Target,
    Clock,
    Flame,
    Snowflake,
    Wifi,
    WifiOff,
    ArrowUp,
    ArrowDown,
    Minus,
    CheckCircle2,
    AlertTriangle,
    MoveUp,
    MoveDown,
    Cpu,
    Network,
    Radio,
    Signal,
    Globe,
    ZapOff,
    BarChart,
    LineChart,
    PieChart,
    Settings2,
    Sliders,
    Layers,
    Rocket,
    Shield,
    Award,
    ZapIcon,
    Compass,
    TrendingUpIcon,
    TrendingDownIcon,
    ActivityIcon,
    History,
    TrendingUp as TrendUp,
    TrendingDown as TrendDown
} from 'lucide-react';

// Types
interface TickData {
    quote: number;
    symbol: string;
    timestamp: number;
    digit: number;
}

interface MarketAnalysis {
    symbol: string;
    ticks: TickData[];
    digitCounts: Record<number, number>;
    digitPercentages: Record<number, number>;
    evenPercentage: number;
    oddPercentage: number;
    over4Percentage: number;
    under5Percentage: number;
    over1Percentage: number;
    under8Percentage: number;
    over3Percentage: number;
    under5RecoveryPercentage: number;
    lastDigits: number[];
    last20Digits: number[];
    last50Digits: number[];
    currentEvenStreak: number;
    currentOddStreak: number;
    currentOverStreak: number;
    currentUnderStreak: number;
    momentum20: number;
    trend50: 'UP' | 'DOWN' | 'SIDEWAYS';
    signal: {
        type: 'EVEN' | 'ODD' | 'OVER4' | 'UNDER5' | 'OVER1' | 'UNDER8' | 'OVER3' | 'UNDER5R' | 'NONE';
        confidence: number;
        strength: 'STRONG' | 'MEDIUM' | 'WEAK';
        mode: 'TREND' | 'REVERSAL';
    };
    volatility: {
        averageChange: number;
        level: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
        score: number;
    };
}

interface StrategySettings {
    stake: number;
    martingaleMultiplier: number;
    stopLoss: number;
    takeProfit: number;
    runs: number;
    enabled: boolean;
    minConfidence: number;
    maxSpread: number;
    recoverySteps: number;
    useRecovery: boolean;
}

interface RecoveryState {
    active: boolean;
    originalType: string;
    currentType: string;
    step: number;
    maxSteps: number;
    entryStake: number;
    losses: number;
}

interface Bot {
    id: string;
    name: string;
    type: 'even' | 'odd' | 'over' | 'under';
    strategyType: 'OVER4' | 'UNDER5' | 'OVER1_RECOVERY' | 'UNDER8_RECOVERY' | 'EVEN' | 'ODD' | 'CUSTOM';
    mode: 'trend' | 'reversal';
    market: string;
    settings: StrategySettings;
    duration: number;
    multiplier: number;
    maxSteps: number;
    useMartingale: boolean;
    useEntryFilter: boolean;
    minVolatility: number;
    maxVolatility: number;
    isRunning: boolean;
    status: 'idle' | 'watching' | 'confirming' | 'trading' | 'recovery' | 'stopped' | 'waiting';
    currentStake: number;
    totalPnl: number;
    trades: number;
    wins: number;
    losses: number;
    currentRun: number;
    recoveryStep: number;
    recoveryState: RecoveryState | null;
    consecutiveOpposite: number;
    lastEntrySignal: number | null;
    lastAnalysis: MarketAnalysis | null;
    expanded: boolean;
    enabled: boolean;
    activeContractId: string | null;
    isTrading: boolean;
    initialStake: number;
    lastTradeTime: number | null;
    confirmationCount: number;
    waitingForTick: boolean;
}

interface Trade {
    id: string;
    botId: string;
    botName: string;
    strategyType: string;
    type: string;
    mode: string;
    market: string;
    entry: string;
    stake: number;
    result: 'win' | 'loss' | 'pending';
    profit: number;
    entryDigit: number;
    resultDigit: number;
    timestamp: number;
    confidence: number;
    recoveryStep: number;
    entryPrice: number;
    exitPrice: number;
    contractType: string;
    barrier: string;
}

// Constants
const DERIV_WS_URL = 'wss://ws.derivws.com/websockets/v3?app_id=1089';

const MARKETS = [
    { value: 'R_10', label: 'Volatility 10', icon: '📊', group: 'Volatility', color: 'blue' },
    { value: 'R_25', label: 'Volatility 25', icon: '📊', group: 'Volatility', color: 'cyan' },
    { value: 'R_50', label: 'Volatility 50', icon: '📊', group: 'Volatility', color: 'green' },
    { value: 'R_75', label: 'Volatility 75', icon: '📊', group: 'Volatility', color: 'yellow' },
    { value: 'R_100', label: 'Volatility 100', icon: '📊', group: 'Volatility', color: 'orange' },
    { value: '1HZ10V', label: '1HZ 10', icon: '⚡', group: '1HZ', color: 'purple' },
    { value: '1HZ25V', label: '1HZ 25', icon: '⚡', group: '1HZ', color: 'pink' },
    { value: '1HZ50V', label: '1HZ 50', icon: '⚡', group: '1HZ', color: 'indigo' },
    { value: '1HZ75V', label: '1HZ 75', icon: '⚡', group: '1HZ', color: 'violet' },
    { value: '1HZ100V', label: '1HZ 100', icon: '⚡', group: '1HZ', color: 'rose' }
];

const STRATEGY_CONFIGS = [
    { 
        id: 'over4', 
        type: 'OVER4', 
        name: 'OVER 4 BOT', 
        icon: <ArrowUp className="w-4 h-4" />, 
        color: 'blue', 
        bg: 'from-blue-500/20 to-blue-600/10',
        description: 'Trades when Over 4 probability > 60%',
        entryThreshold: 60,
        contractType: 'DIGITOVER',
        barrier: '4',
        recoveryType: null
    },
    { 
        id: 'under5', 
        type: 'UNDER5', 
        name: 'UNDER 5 BOT', 
        icon: <ArrowDown className="w-4 h-4" />, 
        color: 'green', 
        bg: 'from-green-500/20 to-green-600/10',
        description: 'Trades when Under 5 probability > 60%',
        entryThreshold: 60,
        contractType: 'DIGITUNDER',
        barrier: '5',
        recoveryType: null
    },
    { 
        id: 'over1', 
        type: 'OVER1_RECOVERY', 
        name: 'OVER 1 → OVER 3', 
        icon: <RefreshCw className="w-4 h-4" />, 
        color: 'purple', 
        bg: 'from-purple-500/20 to-purple-600/10',
        description: 'Over 1 with Over 3 recovery on loss',
        entryThreshold: 55,
        recoveryThreshold: 50,
        contractType: 'DIGITOVER',
        barrier: '1',
        recoveryBarrier: '3',
        recoveryType: 'OVER3'
    },
    { 
        id: 'under8', 
        type: 'UNDER8_RECOVERY', 
        name: 'UNDER 8 → UNDER 5', 
        icon: <MoveDown className="w-4 h-4" />, 
        color: 'orange', 
        bg: 'from-orange-500/20 to-orange-600/10',
        description: 'Under 8 with Under 5 recovery on loss',
        entryThreshold: 55,
        recoveryThreshold: 50,
        contractType: 'DIGITUNDER',
        barrier: '8',
        recoveryBarrier: '5',
        recoveryType: 'UNDER5'
    },
    { 
        id: 'even', 
        type: 'EVEN', 
        name: 'EVEN BOT', 
        icon: <CircleDot className="w-4 h-4" />, 
        color: 'pink', 
        bg: 'from-pink-500/20 to-pink-600/10',
        description: 'Trades when Even probability > 55%',
        entryThreshold: 55,
        contractType: 'DIGITEVEN',
        barrier: null,
        recoveryType: null
    },
    { 
        id: 'odd', 
        type: 'ODD', 
        name: 'ODD BOT', 
        icon: <Hash className="w-4 h-4" />, 
        color: 'yellow', 
        bg: 'from-yellow-500/20 to-yellow-600/10',
        description: 'Trades when Odd probability > 55%',
        entryThreshold: 55,
        contractType: 'DIGITODD',
        barrier: null,
        recoveryType: null
    }
];

const VOLATILITY_ICONS = {
    LOW: <Snowflake className="w-3 h-3 text-blue-400" />,
    MEDIUM: <Wind className="w-3 h-3 text-yellow-400" />,
    HIGH: <Waves className="w-3 h-3 text-orange-400" />,
    EXTREME: <Flame className="w-3 h-3 text-red-400" />
};

// Main Component
export default function DerivTradingBot() {
    const { toast } = useToast();
    
    // State
    const [isConnected, setIsConnected] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);
    const [balance, setBalance] = useState(10000);
    const [demoMode, setDemoMode] = useState(true);
    const [sound, setSound] = useState(true);
    const [scanning, setScanning] = useState(false);
    const [selectedMarket, setSelectedMarket] = useState('R_100');
    const [analysis, setAnalysis] = useState<MarketAnalysis | null>(null);
    const [bots, setBots] = useState<Bot[]>([]);
    const [trades, setTrades] = useState<Trade[]>([]);
    const [activeTrade, setActiveTrade] = useState<Trade | null>(null);
    const [selectedTab, setSelectedTab] = useState('bots');
    const [globalVolatility, setGlobalVolatility] = useState({ min: 0, max: 100 });
    const [lastDigit, setLastDigit] = useState<number | null>(null);
    const [tickCount, setTickCount] = useState(0);
    const [connectionQuality, setConnectionQuality] = useState<'excellent' | 'good' | 'poor'>('good');
    const [showSettings, setShowSettings] = useState(false);
    const [dataLoaded, setDataLoaded] = useState(false);
    const [loadingProgress, setLoadingProgress] = useState(0);
    const [globalSettings, setGlobalSettings] = useState({
        defaultStake: 1,
        defaultMartingale: 2,
        defaultStopLoss: 50,
        defaultTakeProfit: 100,
        defaultRuns: 5,
        defaultRecoverySteps: 3
    });

    // WebSocket Refs
    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
    const ticksRef = useRef<TickData[]>([]);
    const runningBotsRef = useRef<Set<string>>(new Set());
    const pingIntervalRef = useRef<NodeJS.Timeout>();
    const tradingBotsRef = useRef<Map<string, boolean>>(new Map());
    const lastTickTimeRef = useRef<number>(Date.now());
    const tickRateRef = useRef<number[]>([]);

    // Initialize 6 bots with selected market and strategy configs
    useEffect(() => {
        const initialBots: Bot[] = STRATEGY_CONFIGS.map((config, index) => ({
            id: `bot-${index + 1}`,
            name: config.name,
            type: config.type === 'EVEN' ? 'even' : 
                  config.type === 'ODD' ? 'odd' : 
                  config.type === 'OVER4' ? 'over' :
                  config.type === 'UNDER5' ? 'under' :
                  config.type === 'OVER1_RECOVERY' ? 'over' : 'under',
            strategyType: config.type as any,
            mode: config.type.includes('RECOVERY') ? 'reversal' : 'trend',
            market: selectedMarket,
            settings: {
                stake: globalSettings.defaultStake,
                martingaleMultiplier: globalSettings.defaultMartingale,
                stopLoss: globalSettings.defaultStopLoss,
                takeProfit: globalSettings.defaultTakeProfit,
                runs: globalSettings.defaultRuns,
                enabled: true,
                minConfidence: config.entryThreshold,
                maxSpread: 100,
                recoverySteps: globalSettings.defaultRecoverySteps,
                useRecovery: config.type.includes('RECOVERY')
            },
            duration: 5,
            multiplier: globalSettings.defaultMartingale,
            maxSteps: 3,
            useMartingale: true,
            useEntryFilter: true,
            minVolatility: 0,
            maxVolatility: 100,
            isRunning: false,
            status: 'idle',
            currentStake: globalSettings.defaultStake,
            initialStake: globalSettings.defaultStake,
            totalPnl: 0,
            trades: 0,
            wins: 0,
            losses: 0,
            currentRun: 0,
            recoveryStep: 0,
            recoveryState: null,
            consecutiveOpposite: 0,
            lastEntrySignal: null,
            lastAnalysis: null,
            expanded: false,
            enabled: true,
            activeContractId: null,
            isTrading: false,
            lastTradeTime: null,
            confirmationCount: 0,
            waitingForTick: false
        }));
        
        setBots(initialBots);
    }, []);

    // Update all bots when market changes
    useEffect(() => {
        setBots(prev => prev.map(bot => ({
            ...bot,
            market: selectedMarket
        })));
    }, [selectedMarket]);

    // Connect WebSocket
    const connectWebSocket = useCallback(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) return;

        setIsConnecting(true);
        setLoadingProgress(0);
        
        try {
            const ws = new WebSocket(DERIV_WS_URL);
            
            ws.onopen = () => {
                wsRef.current = ws;
                setIsConnected(true);
                setIsConnecting(false);
                
                if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
                
                let lastPing = Date.now();
                pingIntervalRef.current = setInterval(() => {
                    const now = Date.now();
                    const latency = now - lastPing;
                    
                    if (latency < 100) setConnectionQuality('excellent');
                    else if (latency < 300) setConnectionQuality('good');
                    else setConnectionQuality('poor');
                    
                    lastPing = now;
                    
                    // Calculate tick rate
                    const now2 = Date.now();
                    const recentTicks = tickRateRef.current.filter(t => now2 - t < 10000);
                    tickRateRef.current = recentTicks;
                }, 5000);
                
                subscribeToMarket(selectedMarket);
                
                toast({
                    title: 'Connected',
                    description: 'WebSocket connection established',
                });
            };

            ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                handleWebSocketMessage(data);
            };

            ws.onerror = () => {
                setIsConnected(false);
                setConnectionQuality('poor');
            };

            ws.onclose = () => {
                setIsConnected(false);
                setIsConnecting(false);
                setDataLoaded(false);
                
                if (pingIntervalRef.current) {
                    clearInterval(pingIntervalRef.current);
                }
                
                if (reconnectTimeoutRef.current) {
                    clearTimeout(reconnectTimeoutRef.current);
                }
                
                reconnectTimeoutRef.current = setTimeout(() => {
                    connectWebSocket();
                }, 3000);
            };

            wsRef.current = ws;
        } catch (error) {
            console.error('Connection error:', error);
            setIsConnected(false);
            setIsConnecting(false);
        }
    }, [selectedMarket]);

    // Subscribe to market
    const subscribeToMarket = (symbol: string) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        
        // First request history
        wsRef.current.send(JSON.stringify({
            ticks_history: symbol,
            adjust_start_time: 1,
            count: 1000,
            end: 'latest',
            start: 1,
            style: 'ticks',
            subscribe: 1
        }));
    };

    // Handle WebSocket messages
    const handleWebSocketMessage = (data: any) => {
        if (data.tick) {
            handleTick(data.tick);
        } else if (data.history) {
            handleHistory(data);
        } else if (data.error) {
            toast({
                title: 'API Error',
                description: data.error.message,
                variant: 'destructive',
            });
        }
    };

    // Handle history data
    const handleHistory = (data: any) => {
        if (!data.history?.prices) return;
        
        const prices = data.history.prices;
        const times = data.history.times || [];
        
        const ticks: TickData[] = prices.map((price: string, index: number) => ({
            quote: parseFloat(price),
            symbol: data.echo_req.ticks_history,
            timestamp: times[index] ? times[index] * 1000 : Date.now() - (prices.length - index) * 1000,
            digit: Math.floor(parseFloat(price) % 10)
        }));
        
        // Sort by timestamp
        ticks.sort((a, b) => a.timestamp - b.timestamp);
        
        ticksRef.current = ticks;
        setTickCount(ticks.length);
        setDataLoaded(true);
        setLoadingProgress(100);
        
        // Update analysis with historical data
        updateAnalysis();
        
        toast({
            title: 'Data Loaded',
            description: `Loaded ${ticks.length} ticks for ${selectedMarket}`,
        });
    };

    // Handle live tick
    const handleTick = (tick: any) => {
        const now = Date.now();
        lastTickTimeRef.current = now;
        tickRateRef.current.push(now);
        
        const quote = parseFloat(tick.quote);
        const digit = Math.floor(quote % 10);
        
        setLastDigit(digit);
        
        const newTick: TickData = {
            quote: quote,
            symbol: tick.symbol,
            timestamp: now,
            digit
        };
        
        ticksRef.current.push(newTick);
        
        // Keep only last 2000 ticks for performance
        if (ticksRef.current.length > 2000) {
            ticksRef.current = ticksRef.current.slice(-2000);
        }
        
        setTickCount(ticksRef.current.length);
        
        // Update analysis with new tick
        updateAnalysis();
    };

    // Update analysis with fetched data
    const updateAnalysis = () => {
        const ticks = ticksRef.current;
        if (ticks.length < 100) {
            setLoadingProgress(Math.floor((ticks.length / 100) * 100));
            return;
        }

        const last1000 = ticks.slice(-1000);
        const last50 = ticks.slice(-50);
        const last20 = ticks.slice(-20);
        const last10 = ticks.slice(-10);

        // Count digits
        const digitCounts: Record<number, number> = {};
        for (let i = 0; i <= 9; i++) digitCounts[i] = 0;
        
        last1000.forEach(t => digitCounts[t.digit]++);

        // Calculate percentages
        const digitPercentages: Record<number, number> = {};
        for (let i = 0; i <= 9; i++) {
            digitPercentages[i] = (digitCounts[i] / last1000.length) * 100;
        }

        // Even/Odd percentages
        let evenCount = 0, oddCount = 0;
        [0,2,4,6,8].forEach(d => evenCount += digitCounts[d]);
        [1,3,5,7,9].forEach(d => oddCount += digitCounts[d]);
        
        const evenPercentage = (evenCount / last1000.length) * 100;
        const oddPercentage = (oddCount / last1000.length) * 100;

        // Strategy-specific percentages
        let over4Count = 0;
        for (let i = 5; i <= 9; i++) over4Count += digitCounts[d];
        const over4Percentage = (over4Count / last1000.length) * 100;
        
        let under5Count = 0;
        for (let i = 0; i <= 4; i++) under5Count += digitCounts[i];
        const under5Percentage = (under5Count / last1000.length) * 100;
        
        let over1Count = 0;
        for (let i = 2; i <= 9; i++) over1Count += digitCounts[i];
        const over1Percentage = (over1Count / last1000.length) * 100;
        
        let under8Count = 0;
        for (let i = 0; i <= 7; i++) under8Count += digitCounts[i];
        const under8Percentage = (under8Count / last1000.length) * 100;
        
        let over3Count = 0;
        for (let i = 4; i <= 9; i++) over3Count += digitCounts[i];
        const over3Percentage = (over3Count / last1000.length) * 100;

        // Current streaks
        let evenStreak = 0, oddStreak = 0, overStreak = 0, underStreak = 0;
        
        for (let i = last10.length - 1; i >= 0; i--) {
            if (last10[i].digit % 2 === 0) evenStreak++;
            else break;
        }
        
        for (let i = last10.length - 1; i >= 0; i--) {
            if (last10[i].digit % 2 === 1) oddStreak++;
            else break;
        }
        
        for (let i = last10.length - 1; i >= 0; i--) {
            if (last10[i].digit >= 5) overStreak++;
            else break;
        }
        
        for (let i = last10.length - 1; i >= 0; i--) {
            if (last10[i].digit <= 4) underStreak++;
            else break;
        }

        // Momentum (last 20 ticks)
        const first10Avg = last20.slice(0, 10).reduce((sum, t) => sum + t.quote, 0) / 10;
        const last10Avg = last20.slice(-10).reduce((sum, t) => sum + t.quote, 0) / 10;
        const momentum20 = ((last10Avg - first10Avg) / first10Avg) * 100;

        // Trend (last 50 ticks)
        const first25Avg = last50.slice(0, 25).reduce((sum, t) => sum + t.quote, 0) / 25;
        const last25Avg = last50.slice(-25).reduce((sum, t) => sum + t.quote, 0) / 25;
        const trend50 = last25Avg > first25Avg ? 'UP' : last25Avg < first25Avg ? 'DOWN' : 'SIDEWAYS';

        // Volatility
        const changes: number[] = [];
        for (let i = 1; i < last1000.length; i++) {
            changes.push(Math.abs(last1000[i].quote - last1000[i-1].quote));
        }
        const avgChange = changes.reduce((a,b) => a + b, 0) / changes.length;
        
        let volatilityLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME' = 'LOW';
        let volatilityScore = 0;
        
        if (avgChange < 0.5) {
            volatilityLevel = 'LOW';
            volatilityScore = 25;
        } else if (avgChange < 1.5) {
            volatilityLevel = 'MEDIUM';
            volatilityScore = 50;
        } else if (avgChange < 3) {
            volatilityLevel = 'HIGH';
            volatilityScore = 75;
        } else {
            volatilityLevel = 'EXTREME';
            volatilityScore = 100;
        }

        // Determine strongest signal based on fetched data
        const signals = [
            { type: 'OVER4', value: over4Percentage, threshold: 60 },
            { type: 'UNDER5', value: under5Percentage, threshold: 60 },
            { type: 'OVER1', value: over1Percentage, threshold: 55 },
            { type: 'UNDER8', value: under8Percentage, threshold: 55 },
            { type: 'EVEN', value: evenPercentage, threshold: 55 },
            { type: 'ODD', value: oddPercentage, threshold: 55 }
        ];

        let bestSignal = signals.reduce((best, current) => 
            current.value > best.value ? current : best
        );

        const analysis: MarketAnalysis = {
            symbol: selectedMarket,
            ticks: last1000,
            digitCounts,
            digitPercentages,
            evenPercentage,
            oddPercentage,
            over4Percentage,
            under5Percentage,
            over1Percentage,
            under8Percentage,
            over3Percentage,
            under5RecoveryPercentage: under5Percentage,
            lastDigits: last10.map(t => t.digit),
            last20Digits: last20.map(t => t.digit),
            last50Digits: last50.map(t => t.digit),
            currentEvenStreak: evenStreak,
            currentOddStreak: oddStreak,
            currentOverStreak: overStreak,
            currentUnderStreak: underStreak,
            momentum20,
            trend50,
            signal: {
                type: bestSignal.type as any,
                confidence: bestSignal.value,
                strength: bestSignal.value >= 70 ? 'STRONG' : bestSignal.value >= 60 ? 'MEDIUM' : 'WEAK',
                mode: 'TREND'
            },
            volatility: {
                averageChange: avgChange,
                level: volatilityLevel,
                score: volatilityScore
            }
        };

        setAnalysis(analysis);
        
        // Check entry conditions with fetched data
        checkBotEntries(analysis);
    };

    // Check entry conditions for each strategy using fetched data
    const checkBotEntries = (analysis: MarketAnalysis) => {
        setBots(prev => prev.map(bot => {
            if (!bot.isRunning || !bot.enabled || bot.isTrading) return bot;

            // Check if we have enough data
            if (analysis.ticks.length < 100) return bot;

            // Check volatility range
            if (analysis.volatility.score < bot.minVolatility || 
                analysis.volatility.score > bot.maxVolatility) {
                return bot;
            }

            const config = STRATEGY_CONFIGS.find(c => c.type === bot.strategyType);
            if (!config) return bot;

            let shouldEnter = false;
            let targetPercentage = 0;
            let requiredThreshold = bot.settings.minConfidence;

            // Check based on strategy type using fetched percentages
            switch (bot.strategyType) {
                case 'OVER4':
                    targetPercentage = analysis.over4Percentage;
                    shouldEnter = targetPercentage >= requiredThreshold;
                    break;
                case 'UNDER5':
                    targetPercentage = analysis.under5Percentage;
                    shouldEnter = targetPercentage >= requiredThreshold;
                    break;
                case 'OVER1_RECOVERY':
                    if (bot.recoveryState?.active) {
                        targetPercentage = analysis.over3Percentage;
                        shouldEnter = targetPercentage >= (config.recoveryThreshold || 50);
                    } else {
                        targetPercentage = analysis.over1Percentage;
                        shouldEnter = targetPercentage >= requiredThreshold;
                    }
                    break;
                case 'UNDER8_RECOVERY':
                    if (bot.recoveryState?.active) {
                        targetPercentage = analysis.under5Percentage;
                        shouldEnter = targetPercentage >= (config.recoveryThreshold || 50);
                    } else {
                        targetPercentage = analysis.under8Percentage;
                        shouldEnter = targetPercentage >= requiredThreshold;
                    }
                    break;
                case 'EVEN':
                    targetPercentage = analysis.evenPercentage;
                    shouldEnter = targetPercentage >= requiredThreshold;
                    break;
                case 'ODD':
                    targetPercentage = analysis.oddPercentage;
                    shouldEnter = targetPercentage >= requiredThreshold;
                    break;
            }

            // Update bot status based on fetched data
            if (shouldEnter) {
                // Increment confirmation count
                const newConfirmationCount = bot.confirmationCount + 1;
                
                // Require 2 consecutive confirmations
                if (newConfirmationCount >= 2) {
                    bot.status = 'confirming';
                    bot.lastEntrySignal = Date.now();
                    bot.confirmationCount = 0;
                    
                    // Execute trade immediately with fetched data
                    executeTrade(bot, analysis);
                } else {
                    bot.status = 'waiting';
                    bot.confirmationCount = newConfirmationCount;
                }
            } else {
                bot.status = 'watching';
                bot.confirmationCount = 0;
            }

            return bot;
        }));
    };

    // Execute trade with fetched data
    const executeTrade = (bot: Bot, analysis: MarketAnalysis) => {
        // Prevent duplicate trades
        if (tradingBotsRef.current.get(bot.id)) return;
        tradingBotsRef.current.set(bot.id, true);

        const config = STRATEGY_CONFIGS.find(c => c.type === bot.strategyType);
        if (!config) return;

        const lastTick = analysis.ticks[analysis.ticks.length - 1];
        const currentStake = bot.currentStake;
        
        // Determine contract type and barrier based on strategy and recovery state
        let contractType = config.contractType;
        let barrier = config.barrier;
        
        if (bot.recoveryState?.active) {
            if (bot.strategyType === 'OVER1_RECOVERY') {
                barrier = '3';
            } else if (bot.strategyType === 'UNDER8_RECOVERY') {
                barrier = '5';
            }
        }

        // Calculate win probability based on fetched percentages
        let winProbability = 0;
        switch (bot.strategyType) {
            case 'OVER4':
                winProbability = analysis.over4Percentage / 100;
                break;
            case 'UNDER5':
                winProbability = analysis.under5Percentage / 100;
                break;
            case 'OVER1_RECOVERY':
                winProbability = bot.recoveryState?.active ? 
                    analysis.over3Percentage / 100 : analysis.over1Percentage / 100;
                break;
            case 'UNDER8_RECOVERY':
                winProbability = bot.recoveryState?.active ? 
                    analysis.under5Percentage / 100 : analysis.under8Percentage / 100;
                break;
            case 'EVEN':
                winProbability = analysis.evenPercentage / 100;
                break;
            case 'ODD':
                winProbability = analysis.oddPercentage / 100;
                break;
        }

        // Create trade record
        const tradeId = `trade-${Date.now()}-${Math.random()}`;
        
        const trade: Trade = {
            id: tradeId,
            botId: bot.id,
            botName: bot.name,
            strategyType: bot.strategyType,
            type: bot.type,
            mode: bot.mode,
            market: bot.market,
            entry: bot.strategyType,
            stake: currentStake,
            result: 'pending',
            profit: 0,
            entryDigit: lastTick.digit,
            resultDigit: 0,
            timestamp: Date.now(),
            confidence: analysis.signal.confidence,
            recoveryStep: bot.recoveryStep,
            entryPrice: lastTick.quote,
            exitPrice: 0,
            contractType,
            barrier: barrier || ''
        };

        setActiveTrade(trade);
        setTrades(prev => [trade, ...prev].slice(0, 100));

        // Update bot trading state
        setBots(prev => prev.map(b => {
            if (b.id === bot.id) {
                return {
                    ...b,
                    status: 'trading',
                    isTrading: true,
                    activeContractId: tradeId,
                    lastTradeTime: Date.now()
                };
            }
            return b;
        }));

        // Simulate trade execution with delay (in real app, this would be an API call)
        setTimeout(() => {
            // Determine trade outcome based on probability
            const won = Math.random() < winProbability;
            const profit = won ? currentStake * 0.95 : -currentStake;

            // Generate result digit based on outcome
            let resultDigit;
            if (won) {
                // Generate a digit that satisfies the condition
                if (bot.strategyType === 'EVEN') {
                    const evens = [0,2,4,6,8];
                    resultDigit = evens[Math.floor(Math.random() * evens.length)];
                } else if (bot.strategyType === 'ODD') {
                    const odds = [1,3,5,7,9];
                    resultDigit = odds[Math.floor(Math.random() * odds.length)];
                } else if (bot.strategyType.includes('OVER')) {
                    resultDigit = 5 + Math.floor(Math.random() * 5);
                } else {
                    resultDigit = Math.floor(Math.random() * 5);
                }
            } else {
                // Generate a digit that fails the condition
                if (bot.strategyType === 'EVEN') {
                    const odds = [1,3,5,7,9];
                    resultDigit = odds[Math.floor(Math.random() * odds.length)];
                } else if (bot.strategyType === 'ODD') {
                    const evens = [0,2,4,6,8];
                    resultDigit = evens[Math.floor(Math.random() * evens.length)];
                } else if (bot.strategyType.includes('OVER')) {
                    resultDigit = Math.floor(Math.random() * 5);
                } else {
                    resultDigit = 5 + Math.floor(Math.random() * 5);
                }
            }

            // Generate exit price based on result
            const exitPrice = won ? lastTick.quote * (1 + Math.random() * 0.01) : lastTick.quote * (1 - Math.random() * 0.01);

            // Update trade with result
            setTrades(prev => prev.map(t => {
                if (t.id === tradeId) {
                    return {
                        ...t,
                        result: won ? 'win' : 'loss',
                        profit,
                        resultDigit,
                        exitPrice
                    };
                }
                return t;
            }));

            // Update bot stats and handle martingale/runs logic
            setBots(prev => prev.map(b => {
                if (b.id === bot.id) {
                    const newTrades = b.trades + 1;
                    const newWins = won ? b.wins + 1 : b.wins;
                    const newLosses = won ? b.losses : b.losses + 1;
                    const newPnl = b.totalPnl + profit;

                    let newStake = b.settings.stake;
                    let newRecoveryStep = 0;
                    let newCurrentRun = b.currentRun;
                    let newRecoveryState = b.recoveryState;

                    // Martingale logic
                    if (b.useMartingale) {
                        if (won) {
                            newStake = b.settings.stake;
                            newRecoveryStep = 0;
                            newCurrentRun = b.currentRun + 1;
                            
                            // Reset recovery state on win
                            if (newRecoveryState) {
                                newRecoveryState = null;
                            }
                        } else {
                            newRecoveryStep = b.recoveryStep + 1;
                            if (newRecoveryStep <= b.maxSteps) {
                                newStake = b.currentStake * b.settings.martingaleMultiplier;
                            }
                            
                            // Activate recovery for specific strategies
                            if (b.settings.useRecovery && (b.strategyType === 'OVER1_RECOVERY' || b.strategyType === 'UNDER8_RECOVERY') && !newRecoveryState) {
                                newRecoveryState = {
                                    active: true,
                                    originalType: b.strategyType,
                                    currentType: b.strategyType === 'OVER1_RECOVERY' ? 'OVER3' : 'UNDER5',
                                    step: 1,
                                    maxSteps: b.settings.recoverySteps,
                                    entryStake: b.settings.stake,
                                    losses: 1
                                };
                            }
                        }
                    }

                    // Runs reset logic
                    if (newCurrentRun >= b.settings.runs) {
                        newCurrentRun = 0;
                        toast({
                            title: 'Runs Completed',
                            description: `${b.name} completed ${b.settings.runs} runs, resetting...`,
                        });
                    }

                    // Stop loss / take profit check
                    const totalPnlAfterTrade = b.totalPnl + profit;
                    
                    if (totalPnlAfterTrade <= -b.settings.stopLoss) {
                        setTimeout(() => stopBot(b.id), 100);
                        toast({
                            title: 'Stop Loss Triggered',
                            description: `${b.name} stopped at -$${Math.abs(totalPnlAfterTrade).toFixed(2)}`,
                            variant: 'destructive',
                        });
                    } else if (totalPnlAfterTrade >= b.settings.takeProfit) {
                        setTimeout(() => stopBot(b.id), 100);
                        toast({
                            title: 'Take Profit Reached!',
                            description: `${b.name} profit: $${totalPnlAfterTrade.toFixed(2)}`,
                        });
                    }

                    // Update balance in demo mode
                    if (demoMode) {
                        setBalance(prev => prev + profit);
                    }

                    tradingBotsRef.current.delete(b.id);

                    return {
                        ...b,
                        trades: newTrades,
                        wins: newWins,
                        losses: newLosses,
                        totalPnl: newPnl,
                        currentStake: newStake,
                        recoveryStep: newRecoveryStep,
                        currentRun: newCurrentRun,
                        recoveryState: newRecoveryState,
                        status: 'watching',
                        isTrading: false,
                        activeContractId: null,
                        confirmationCount: 0
                    };
                }
                return b;
            }));

            // Show toast for trade result
            toast({
                title: won ? 'Trade Won! 🎉' : 'Trade Lost 💔',
                description: `${bot.name} | Profit: $${profit.toFixed(2)} | Step: ${bot.recoveryStep + 1}`,
                variant: won ? 'default' : 'destructive',
            });

            setTimeout(() => {
                setActiveTrade(null);
            }, 3000);
        }, 2000);
    };

    // Start bot
    const startBot = (botId: string) => {
        const bot = bots.find(b => b.id === botId);
        if (!bot) return;
        
        if (!isConnected) {
            toast({
                title: 'Not Connected',
                description: 'Please wait for WebSocket connection',
                variant: 'destructive',
            });
            return;
        }

        if (!analysis || analysis.ticks.length < 100) {
            toast({
                title: 'Insufficient Data',
                description: 'Waiting for at least 100 ticks of market data',
                variant: 'destructive',
            });
            return;
        }

        setBots(prev => prev.map(b => {
            if (b.id === botId) {
                runningBotsRef.current.add(botId);
                return { 
                    ...b, 
                    isRunning: true, 
                    status: 'watching',
                    currentStake: b.settings.stake,
                    initialStake: b.settings.stake,
                    recoveryStep: 0,
                    consecutiveOpposite: 0,
                    currentRun: 0,
                    recoveryState: null,
                    isTrading: false,
                    activeContractId: null,
                    confirmationCount: 0,
                    waitingForTick: false
                };
            }
            return b;
        }));

        toast({
            title: 'Bot Started',
            description: `${bot.name} is now watching for signals using fetched data`,
        });
    };

    // Stop bot
    const stopBot = (botId: string) => {
        runningBotsRef.current.delete(botId);
        tradingBotsRef.current.delete(botId);
        
        setBots(prev => prev.map(b => {
            if (b.id === botId) {
                return { 
                    ...b, 
                    isRunning: false, 
                    status: 'stopped',
                    isTrading: false,
                    confirmationCount: 0
                };
            }
            return b;
        }));

        toast({
            title: 'Bot Stopped',
            description: 'Bot has been stopped',
        });
    };

    // Start all bots
    const startAllBots = () => {
        if (!isConnected) {
            toast({
                title: 'Not Connected',
                description: 'Please wait for WebSocket connection',
                variant: 'destructive',
            });
            return;
        }

        if (!analysis || analysis.ticks.length < 100) {
            toast({
                title: 'Insufficient Data',
                description: 'Waiting for at least 100 ticks of market data',
                variant: 'destructive',
            });
            return;
        }

        bots.forEach(bot => {
            if (bot.enabled && !bot.isRunning) {
                startBot(bot.id);
            }
        });
    };

    // Stop all bots
    const stopAllBots = () => {
        runningBotsRef.current.clear();
        tradingBotsRef.current.clear();
        
        setBots(prev => prev.map(b => ({
            ...b,
            isRunning: false,
            status: 'stopped',
            isTrading: false,
            confirmationCount: 0
        })));

        toast({
            title: 'All Bots Stopped',
            description: 'All trading bots have been stopped',
        });
    };

    // Toggle bot enabled
    const toggleBotEnabled = (botId: string) => {
        setBots(prev => prev.map(b => {
            if (b.id === botId) {
                if (b.isRunning) {
                    stopBot(botId);
                }
                return { ...b, enabled: !b.enabled };
            }
            return b;
        }));
    };

    // Reset bot stats
    const resetBot = (botId: string) => {
        setBots(prev => prev.map(b => {
            if (b.id === botId) {
                return {
                    ...b,
                    totalPnl: 0,
                    trades: 0,
                    wins: 0,
                    losses: 0,
                    currentRun: 0,
                    recoveryStep: 0,
                    currentStake: b.settings.stake,
                    initialStake: b.settings.stake,
                    recoveryState: null,
                    consecutiveOpposite: 0,
                    confirmationCount: 0
                };
            }
            return b;
        }));
    };

    // Update bot settings
    const updateBotSettings = (botId: string, updates: Partial<StrategySettings>) => {
        setBots(prev => prev.map(b => {
            if (b.id === botId) {
                const newSettings = { ...b.settings, ...updates };
                return {
                    ...b,
                    settings: newSettings,
                    currentStake: newSettings.stake,
                    initialStake: newSettings.stake
                };
            }
            return b;
        }));
    };

    // Calculate stats
    const totalTrades = trades.filter(t => t.result !== 'pending').length;
    const totalWins = trades.filter(t => t.result === 'win').length;
    const totalPnl = bots.reduce((sum, b) => sum + b.totalPnl, 0);
    const activeBots = bots.filter(b => b.isRunning).length;
    const winRate = totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0;
    const tickRate = tickRateRef.current.length / 10; // ticks per second over last 10 seconds

    // Connect on mount
    useEffect(() => {
        connectWebSocket();
        
        return () => {
            if (wsRef.current) {
                wsRef.current.close();
            }
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
            }
            if (pingIntervalRef.current) {
                clearInterval(pingIntervalRef.current);
            }
        };
    }, []);

    // Change market
    useEffect(() => {
        if (isConnected) {
            subscribeToMarket(selectedMarket);
            ticksRef.current = [];
            setAnalysis(null);
            setDataLoaded(false);
            setLoadingProgress(0);
        }
    }, [selectedMarket, isConnected]);

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-900 via-slate-900 to-gray-900 text-gray-100">
            {/* Animated Background */}
            <div className="fixed inset-0 overflow-hidden pointer-events-none">
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-blue-900/20 via-gray-900 to-gray-900"></div>
                <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-blue-500 to-transparent"></div>
                <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-purple-500 to-transparent"></div>
            </div>

            <div className="relative max-w-7xl mx-auto p-4 space-y-4">
                {/* Header with Glassmorphism */}
                <Card className="bg-gray-800/90 backdrop-blur-xl border-gray-700 shadow-2xl">
                    <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-4">
                                <div className="p-3 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl shadow-lg">
                                    <Brain className="h-8 w-8 text-white" />
                                </div>
                                <div>
                                    <CardTitle className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                                        Deriv Trading Bot System
                                    </CardTitle>
                                    <CardDescription className="text-gray-400">
                                        6 Advanced Bots • Real-time Analysis • Smart Entry Filters
                                    </CardDescription>
                                </div>
                            </div>
                            <div className="flex items-center space-x-3">
                                {/* Data Loading Indicator */}
                                {!dataLoaded && isConnected && (
                                    <div className="flex items-center space-x-2 px-3 py-1.5 bg-blue-500/20 rounded-lg">
                                        <Loader2 className="h-3 w-3 text-blue-400 animate-spin" />
                                        <span className="text-xs text-blue-400">Loading {loadingProgress}%</span>
                                    </div>
                                )}
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setSound(!sound)}
                                    className="text-gray-400 hover:text-white hover:bg-gray-700"
                                >
                                    {sound ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setShowSettings(!showSettings)}
                                    className="text-gray-400 hover:text-white hover:bg-gray-700"
                                >
                                    <Settings2 className="h-4 w-4" />
                                </Button>
                                <div className="flex items-center space-x-2 px-3 py-1.5 bg-gray-700/50 rounded-lg">
                                    <div className={`w-2 h-2 rounded-full ${
                                        connectionQuality === 'excellent' ? 'bg-green-400 animate-pulse' :
                                        connectionQuality === 'good' ? 'bg-yellow-400' : 'bg-red-400'
                                    }`} />
                                    <span className="text-xs text-gray-300">
                                        {connectionQuality === 'excellent' ? 'Excellent' :
                                         connectionQuality === 'good' ? 'Good' : 'Poor'}
                                    </span>
                                </div>
                                <Badge variant="outline" className={`px-3 py-1 ${
                                    isConnected ? 'bg-green-500/20 text-green-400 border-green-500/30' : 
                                    'bg-red-500/20 text-red-400 border-red-500/30'
                                }`}>
                                    {isConnected ? <Wifi className="h-3 w-3 mr-1" /> : <WifiOff className="h-3 w-3 mr-1" />}
                                    {isConnected ? 'LIVE' : 'OFFLINE'}
                                </Badge>
                            </div>
                        </div>
                    </CardHeader>

                    {/* Stats Cards */}
                    <CardContent className="pb-2">
                        <div className="grid grid-cols-6 gap-3">
                            <div className="bg-gray-700/50 rounded-lg p-3 border border-gray-600">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-gray-400">Mode</span>
                                    <Badge variant={demoMode ? "outline" : "default"} className="text-xs">
                                        {demoMode ? 'DEMO' : 'LIVE'}
                                    </Badge>
                                </div>
                                <Switch checked={!demoMode} onCheckedChange={(v) => setDemoMode(!v)} className="mt-2" />
                            </div>
                            
                            <div className="bg-gray-700/50 rounded-lg p-3 border border-gray-600">
                                <div className="text-xs text-gray-400 mb-1">Balance</div>
                                <div className="text-xl font-bold text-green-400">${balance.toFixed(2)}</div>
                                <div className="text-xs text-gray-500">Available</div>
                            </div>
                            
                            <div className="bg-gray-700/50 rounded-lg p-3 border border-gray-600">
                                <div className="text-xs text-gray-400 mb-1">Total P&L</div>
                                <div className={`text-xl font-bold ${totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                    ${totalPnl.toFixed(2)}
                                </div>
                                <div className="text-xs text-gray-500">All bots</div>
                            </div>
                            
                            <div className="bg-gray-700/50 rounded-lg p-3 border border-gray-600">
                                <div className="text-xs text-gray-400 mb-1">Active Bots</div>
                                <div className="text-xl font-bold text-blue-400">{activeBots}/6</div>
                                <Progress value={(activeBots / 6) * 100} className="h-1 mt-1" />
                            </div>
                            
                            <div className="bg-gray-700/50 rounded-lg p-3 border border-gray-600">
                                <div className="text-xs text-gray-400 mb-1">Win Rate</div>
                                <div className="text-xl font-bold text-purple-400">{winRate.toFixed(1)}%</div>
                                <div className="text-xs text-gray-500">{totalWins}/{totalTrades} wins</div>
                            </div>

                            <div className="bg-gray-700/50 rounded-lg p-3 border border-gray-600">
                                <div className="text-xs text-gray-400 mb-1">Tick Rate</div>
                                <div className="text-xl font-bold text-orange-400">{tickRate.toFixed(1)}/s</div>
                                <div className="text-xs text-gray-500">{tickCount} ticks</div>
                            </div>
                        </div>
                    </CardContent>

                    {/* Global Settings Panel */}
                    {showSettings && (
                        <CardContent className="pt-2 pb-2 border-t border-gray-700">
                            <div className="flex items-center space-x-4">
                                <div className="flex items-center space-x-2">
                                    <Label className="text-xs text-gray-400">Default Stake</Label>
                                    <Input
                                        type="number"
                                        value={globalSettings.defaultStake}
                                        onChange={(e) => setGlobalSettings(prev => ({ ...prev, defaultStake: parseFloat(e.target.value) || 1 }))}
                                        className="w-20 h-7 text-xs bg-gray-700 border-gray-600 text-gray-200"
                                        min="0.1"
                                        step="0.1"
                                    />
                                </div>
                                <div className="flex items-center space-x-2">
                                    <Label className="text-xs text-gray-400">Martingale</Label>
                                    <Input
                                        type="number"
                                        value={globalSettings.defaultMartingale}
                                        onChange={(e) => setGlobalSettings(prev => ({ ...prev, defaultMartingale: parseFloat(e.target.value) || 2 }))}
                                        className="w-16 h-7 text-xs bg-gray-700 border-gray-600 text-gray-200"
                                        min="1.1"
                                        step="0.1"
                                    />
                                </div>
                                <div className="flex items-center space-x-2">
                                    <Label className="text-xs text-gray-400">Stop Loss</Label>
                                    <Input
                                        type="number"
                                        value={globalSettings.defaultStopLoss}
                                        onChange={(e) => setGlobalSettings(prev => ({ ...prev, defaultStopLoss: parseFloat(e.target.value) || 50 }))}
                                        className="w-16 h-7 text-xs bg-gray-700 border-gray-600 text-gray-200"
                                        min="10"
                                    />
                                </div>
                                <div className="flex items-center space-x-2">
                                    <Label className="text-xs text-gray-400">Take Profit</Label>
                                    <Input
                                        type="number"
                                        value={globalSettings.defaultTakeProfit}
                                        onChange={(e) => setGlobalSettings(prev => ({ ...prev, defaultTakeProfit: parseFloat(e.target.value) || 100 }))}
                                        className="w-16 h-7 text-xs bg-gray-700 border-gray-600 text-gray-200"
                                        min="10"
                                    />
                                </div>
                                <div className="flex items-center space-x-2">
                                    <Label className="text-xs text-gray-400">Runs</Label>
                                    <Input
                                        type="number"
                                        value={globalSettings.defaultRuns}
                                        onChange={(e) => setGlobalSettings(prev => ({ ...prev, defaultRuns: parseInt(e.target.value) || 5 }))}
                                        className="w-16 h-7 text-xs bg-gray-700 border-gray-600 text-gray-200"
                                        min="1"
                                        max="20"
                                    />
                                </div>
                                <div className="flex items-center space-x-2">
                                    <Label className="text-xs text-gray-400">Recovery Steps</Label>
                                    <Input
                                        type="number"
                                        value={globalSettings.defaultRecoverySteps}
                                        onChange={(e) => setGlobalSettings(prev => ({ ...prev, defaultRecoverySteps: parseInt(e.target.value) || 3 }))}
                                        className="w-16 h-7 text-xs bg-gray-700 border-gray-600 text-gray-200"
                                        min="1"
                                        max="5"
                                    />
                                </div>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs border-gray-600 text-gray-300 hover:bg-gray-700"
                                    onClick={() => {
                                        setBots(prev => prev.map(bot => ({
                                            ...bot,
                                            settings: {
                                                ...bot.settings,
                                                stake: globalSettings.defaultStake,
                                                martingaleMultiplier: globalSettings.defaultMartingale,
                                                stopLoss: globalSettings.defaultStopLoss,
                                                takeProfit: globalSettings.defaultTakeProfit,
                                                runs: globalSettings.defaultRuns,
                                                recoverySteps: globalSettings.defaultRecoverySteps
                                            },
                                            currentStake: globalSettings.defaultStake,
                                            initialStake: globalSettings.defaultStake
                                        })));
                                        toast({
                                            title: 'Settings Applied',
                                            description: 'Global settings applied to all bots',
                                        });
                                    }}
                                >
                                    Apply to All
                                </Button>
                            </div>
                        </CardContent>
                    )}

                    {/* Control Bar */}
                    <CardFooter className="flex justify-between pt-2">
                        <div className="flex space-x-3">
                            <Select value={selectedMarket} onValueChange={setSelectedMarket}>
                                <SelectTrigger className="w-[240px] bg-gray-700 border-gray-600 text-gray-200">
                                    <SelectValue placeholder="Select Market" />
                                </SelectTrigger>
                                <SelectContent className="bg-gray-800 border-gray-700">
                                    {MARKETS.map(m => (
                                        <SelectItem key={m.value} value={m.value} className="text-gray-200 hover:bg-gray-700">
                                            <span className="flex items-center">
                                                <span className="mr-2">{m.icon}</span>
                                                <span>{m.label}</span>
                                                <Badge variant="outline" className="ml-2 text-[8px] bg-gray-700">
                                                    {m.group}
                                                </Badge>
                                            </span>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            
                            <Button 
                                variant="default" 
                                size="sm"
                                onClick={startAllBots}
                                disabled={!dataLoaded || !isConnected}
                                className="bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700"
                            >
                                <Play className="h-4 w-4 mr-2" />
                                Start All
                            </Button>
                            <Button 
                                variant="destructive" 
                                size="sm"
                                onClick={stopAllBots}
                                disabled={activeBots === 0}
                                className="bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700"
                            >
                                <StopCircle className="h-4 w-4 mr-2" />
                                Stop All
                            </Button>
                        </div>

                        <div className="flex items-center space-x-4">
                            <div className="flex items-center space-x-2 bg-gray-700/30 px-3 py-1.5 rounded-lg">
                                <History className="h-4 w-4 text-blue-400" />
                                <span className="text-xs text-gray-300">Data: {dataLoaded ? 'Loaded' : 'Loading'}</span>
                            </div>
                            <div className="flex items-center space-x-2">
                                <Label className="text-xs text-gray-400">Min Vol</Label>
                                <Input 
                                    type="number"
                                    value={globalVolatility.min}
                                    onChange={(e) => setGlobalVolatility(prev => ({ ...prev, min: parseInt(e.target.value) || 0 }))}
                                    className="w-16 h-7 text-xs bg-gray-700 border-gray-600 text-gray-200"
                                    min="0"
                                    max="100"
                                />
                            </div>
                            <div className="flex items-center space-x-2">
                                <Label className="text-xs text-gray-400">Max Vol</Label>
                                <Input 
                                    type="number"
                                    value={globalVolatility.max}
                                    onChange={(e) => setGlobalVolatility(prev => ({ ...prev, max: parseInt(e.target.value) || 100 }))}
                                    className="w-16 h-7 text-xs bg-gray-700 border-gray-600 text-gray-200"
                                    min="0"
                                    max="100"
                                />
                            </div>
                        </div>
                    </CardFooter>
                </Card>

                {/* Live Analysis Dashboard - Only show when data is loaded */}
                {analysis && dataLoaded && (
                    <Card className="bg-gray-800/90 backdrop-blur-xl border-gray-700 shadow-xl overflow-hidden">
                        <div className="absolute inset-0 bg-gradient-to-r from-blue-500/5 to-purple-500/5"></div>
                        <CardHeader className="relative pb-2">
                            <div className="flex items-center justify-between">
                                <CardTitle className="text-lg flex items-center">
                                    <Activity className="h-5 w-5 mr-2 text-blue-400" />
                                    Live Market Analysis - {selectedMarket}
                                </CardTitle>
                                <Badge className={`px-3 py-1 ${
                                    analysis.signal.strength === 'STRONG' ? 'bg-green-500/20 text-green-400' :
                                    analysis.signal.strength === 'MEDIUM' ? 'bg-yellow-500/20 text-yellow-400' :
                                    'bg-gray-500/20 text-gray-400'
                                }`}>
                                    {analysis.signal.strength} SIGNAL
                                </Badge>
                            </div>
                        </CardHeader>
                        <CardContent className="relative">
                            <div className="grid grid-cols-12 gap-4">
                                {/* Digit Distribution */}
                                <div className="col-span-4 bg-gray-700/30 rounded-lg p-3 border border-gray-600">
                                    <div className="text-xs text-gray-400 mb-2 flex items-center">
                                        <BarChart className="h-3 w-3 mr-1" />
                                        Digit Distribution (1000 ticks)
                                    </div>
                                    <div className="grid grid-cols-5 gap-2">
                                        {[0,1,2,3,4,5,6,7,8,9].map(d => (
                                            <div key={d} className="text-center">
                                                <div className={`text-sm font-bold ${
                                                    d === analysis.lastDigits[analysis.lastDigits.length - 1] 
                                                        ? 'text-yellow-400' 
                                                        : 'text-gray-300'
                                                }`}>
                                                    {d}
                                                </div>
                                                <Progress 
                                                    value={analysis.digitPercentages[d]} 
                                                    className="h-1.5 mt-1"
                                                />
                                                <div className="text-[8px] text-gray-500 mt-1">
                                                    {analysis.digitPercentages[d].toFixed(1)}%
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Strategy Percentages */}
                                <div className="col-span-5 bg-gray-700/30 rounded-lg p-3 border border-gray-600">
                                    <div className="text-xs text-gray-400 mb-2 flex items-center">
                                        <Target className="h-3 w-3 mr-1" />
                                        Strategy Signals
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <div className="flex justify-between text-xs mb-1">
                                                <span className="text-blue-400">Over 4</span>
                                                <span className="text-blue-400 font-bold">{analysis.over4Percentage.toFixed(1)}%</span>
                                            </div>
                                            <Progress value={analysis.over4Percentage} className="h-1.5" />
                                            {analysis.over4Percentage >= 60 && (
                                                <Badge className="mt-1 text-[8px] bg-blue-500/20 text-blue-400">ENTRY</Badge>
                                            )}
                                        </div>
                                        <div>
                                            <div className="flex justify-between text-xs mb-1">
                                                <span className="text-green-400">Under 5</span>
                                                <span className="text-green-400 font-bold">{analysis.under5Percentage.toFixed(1)}%</span>
                                            </div>
                                            <Progress value={analysis.under5Percentage} className="h-1.5" />
                                            {analysis.under5Percentage >= 60 && (
                                                <Badge className="mt-1 text-[8px] bg-green-500/20 text-green-400">ENTRY</Badge>
                                            )}
                                        </div>
                                        <div>
                                            <div className="flex justify-between text-xs mb-1">
                                                <span className="text-purple-400">Over 1</span>
                                                <span className="text-purple-400 font-bold">{analysis.over1Percentage.toFixed(1)}%</span>
                                            </div>
                                            <Progress value={analysis.over1Percentage} className="h-1.5" />
                                            {analysis.over1Percentage >= 55 && (
                                                <Badge className="mt-1 text-[8px] bg-purple-500/20 text-purple-400">ENTRY</Badge>
                                            )}
                                        </div>
                                        <div>
                                            <div className="flex justify-between text-xs mb-1">
                                                <span className="text-orange-400">Under 8</span>
                                                <span className="text-orange-400 font-bold">{analysis.under8Percentage.toFixed(1)}%</span>
                                            </div>
                                            <Progress value={analysis.under8Percentage} className="h-1.5" />
                                            {analysis.under8Percentage >= 55 && (
                                                <Badge className="mt-1 text-[8px] bg-orange-500/20 text-orange-400">ENTRY</Badge>
                                            )}
                                        </div>
                                        <div>
                                            <div className="flex justify-between text-xs mb-1">
                                                <span className="text-pink-400">Even</span>
                                                <span className="text-pink-400 font-bold">{analysis.evenPercentage.toFixed(1)}%</span>
                                            </div>
                                            <Progress value={analysis.evenPercentage} className="h-1.5" />
                                            {analysis.evenPercentage >= 55 && (
                                                <Badge className="mt-1 text-[8px] bg-pink-500/20 text-pink-400">ENTRY</Badge>
                                            )}
                                        </div>
                                        <div>
                                            <div className="flex justify-between text-xs mb-1">
                                                <span className="text-yellow-400">Odd</span>
                                                <span className="text-yellow-400 font-bold">{analysis.oddPercentage.toFixed(1)}%</span>
                                            </div>
                                            <Progress value={analysis.oddPercentage} className="h-1.5" />
                                            {analysis.oddPercentage >= 55 && (
                                                <Badge className="mt-1 text-[8px] bg-yellow-500/20 text-yellow-400">ENTRY</Badge>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Market Conditions */}
                                <div className="col-span-3 bg-gray-700/30 rounded-lg p-3 border border-gray-600">
                                    <div className="text-xs text-gray-400 mb-2 flex items-center">
                                        <Gauge className="h-3 w-3 mr-1" />
                                        Market Conditions
                                    </div>
                                    <div className="space-y-3">
                                        <div className="bg-gray-800/50 rounded p-2">
                                            <div className="text-xs text-gray-500">Volatility</div>
                                            <div className="flex items-center justify-between mt-1">
                                                <div className="flex items-center space-x-1">
                                                    {VOLATILITY_ICONS[analysis.volatility.level]}
                                                    <span className="text-sm font-bold">{analysis.volatility.level}</span>
                                                </div>
                                                <Badge variant="outline" className="text-[8px] border-gray-600">
                                                    Δ{analysis.volatility.averageChange.toFixed(2)}
                                                </Badge>
                                            </div>
                                        </div>
                                        <div className="bg-gray-800/50 rounded p-2">
                                            <div className="text-xs text-gray-500">50-Tick Trend</div>
                                            <div className="flex items-center justify-between mt-1">
                                                <span className={`text-sm font-bold ${
                                                    analysis.trend50 === 'UP' ? 'text-green-400' :
                                                    analysis.trend50 === 'DOWN' ? 'text-red-400' : 'text-yellow-400'
                                                }`}>
                                                    {analysis.trend50}
                                                </span>
                                                <Badge variant="outline" className="text-[8px] border-gray-600">
                                                    {analysis.momentum20 > 0 ? '+' : ''}{analysis.momentum20.toFixed(1)}%
                                                </Badge>
                                            </div>
                                        </div>
                                        <div className="bg-gray-800/50 rounded p-2">
                                            <div className="text-xs text-gray-500">Last Digit</div>
                                            <div className="text-2xl font-bold text-center text-yellow-400">
                                                {analysis.lastDigits[analysis.lastDigits.length - 1]}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Last 20 Digits */}
                            <div className="mt-4 bg-gray-700/30 rounded-lg p-3 border border-gray-600">
                                <div className="text-xs text-gray-400 mb-2">Last 20 Digits</div>
                                <div className="flex space-x-1">
                                    {analysis.last20Digits.map((d, i) => (
                                        <div
                                            key={i}
                                            className={`
                                                w-8 h-8 flex items-center justify-center text-xs font-bold rounded-lg
                                                ${d >= 5 ? 'bg-blue-500/20 text-blue-400' : 'bg-green-500/20 text-green-400'}
                                                ${i === analysis.last20Digits.length - 1 ? 'ring-2 ring-yellow-400' : ''}
                                            `}
                                        >
                                            {d}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                )}

                {/* Bots Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {bots.map((bot) => {
                        const config = STRATEGY_CONFIGS.find(c => c.type === bot.strategyType);
                        if (!config) return null;
                        
                        return (
                            <Card 
                                key={bot.id} 
                                className={`
                                    bg-gray-800/90 backdrop-blur-xl border-gray-700 shadow-xl overflow-hidden
                                    transition-all duration-300 hover:shadow-2xl hover:scale-[1.02]
                                    ${bot.isRunning ? `ring-2 ring-${config.color}-500/50` : ''}
                                    ${!bot.enabled ? 'opacity-50' : ''}
                                    ${bot.recoveryState?.active ? 'ring-2 ring-orange-500/50' : ''}
                                `}
                            >
                                <div className={`absolute inset-0 bg-gradient-to-br ${config.bg} opacity-20`}></div>
                                
                                <CardHeader className="relative p-3">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center space-x-3">
                                            <div className={`p-2 rounded-lg bg-${config.color}-500/20`}>
                                                {config.icon}
                                            </div>
                                            <div>
                                                <CardTitle className="text-sm font-bold text-white">
                                                    {bot.name}
                                                </CardTitle>
                                                <CardDescription className="text-xs text-gray-400">
                                                    {bot.market} • {bot.mode}
                                                </CardDescription>
                                            </div>
                                        </div>
                                        <div className="flex items-center space-x-1">
                                            <Switch
                                                checked={bot.enabled}
                                                onCheckedChange={() => toggleBotEnabled(bot.id)}
                                                className="scale-75"
                                            />
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-6 w-6 p-0 text-gray-400 hover:text-white hover:bg-gray-700"
                                                onClick={() => setBots(prev => prev.map(b => 
                                                    b.id === bot.id ? { ...b, expanded: !b.expanded } : b
                                                ))}
                                            >
                                                {bot.expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                                            </Button>
                                        </div>
                                    </div>
                                </CardHeader>

                                <CardContent className="relative p-3 pt-0">
                                    {/* Status Badge */}
                                    <div className="flex items-center justify-between mb-3">
                                        <Badge 
                                            variant="outline" 
                                            className={`
                                                px-2 py-0.5 text-xs border
                                                ${bot.isRunning ? 
                                                    bot.status === 'trading' ? 'bg-green-500/20 text-green-400 border-green-500/30' :
                                                    bot.status === 'watching' ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' :
                                                    bot.status === 'recovery' ? 'bg-orange-500/20 text-orange-400 border-orange-500/30' :
                                                    bot.status === 'confirming' ? 'bg-blue-500/20 text-blue-400 border-blue-500/30' :
                                                    bot.status === 'waiting' ? 'bg-purple-500/20 text-purple-400 border-purple-500/30' :
                                                    'bg-gray-500/20 text-gray-400 border-gray-500/30'
                                                : 'bg-gray-700 text-gray-400 border-gray-600'
                                                }
                                            `}
                                        >
                                            {bot.isRunning ? (
                                                <>
                                                    {bot.status === 'trading' && <Activity className="h-3 w-3 mr-1 animate-pulse" />}
                                                    {bot.status === 'watching' && <Eye className="h-3 w-3 mr-1" />}
                                                    {bot.status === 'recovery' && <RefreshCw className="h-3 w-3 mr-1 animate-spin" />}
                                                    {bot.status === 'confirming' && <Timer className="h-3 w-3 mr-1" />}
                                                    {bot.status === 'waiting' && <Clock className="h-3 w-3 mr-1" />}
                                                    {bot.status === 'recovery' ? 'RECOVERY' : bot.status.toUpperCase()}
                                                </>
                                            ) : 'STOPPED'}
                                        </Badge>
                                        
                                        <div className="flex items-center space-x-2">
                                            <span className="text-xs text-gray-400">P&L:</span>
                                            <span className={`text-xs font-bold ${
                                                bot.totalPnl >= 0 ? 'text-green-400' : 'text-red-400'
                                            }`}>
                                                ${bot.totalPnl.toFixed(2)}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Strategy Info */}
                                    <div className="mb-2 text-[10px] text-gray-400">
                                        {config.description}
                                    </div>

                                    {/* Current Stake & Step */}
                                    <div className="grid grid-cols-2 gap-2 mb-3">
                                        <div className="bg-gray-700/30 rounded p-2">
                                            <div className="text-[8px] text-gray-500">Current Stake</div>
                                            <div className="text-sm font-bold text-white">${bot.currentStake.toFixed(2)}</div>
                                        </div>
                                        <div className="bg-gray-700/30 rounded p-2">
                                            <div className="text-[8px] text-gray-500">Martingale Step</div>
                                            <div className="text-sm font-bold text-orange-400">{bot.recoveryStep}/{bot.maxSteps}</div>
                                        </div>
                                    </div>

                                    {/* Stats Grid */}
                                    <div className="grid grid-cols-3 gap-2 mb-3">
                                        <div className="bg-gray-700/30 rounded p-2">
                                            <div className="text-[8px] text-gray-500">Trades</div>
                                            <div className="text-sm font-bold text-white">{bot.trades}</div>
                                        </div>
                                        <div className="bg-gray-700/30 rounded p-2">
                                            <div className="text-[8px] text-gray-500">Wins</div>
                                            <div className="text-sm font-bold text-green-400">{bot.wins}</div>
                                        </div>
                                        <div className="bg-gray-700/30 rounded p-2">
                                            <div className="text-[8px] text-gray-500">Losses</div>
                                            <div className="text-sm font-bold text-red-400">{bot.losses}</div>
                                        </div>
                                    </div>

                                    {/* Recovery Progress */}
                                    {bot.recoveryState?.active && (
                                        <div className="mb-3">
                                            <div className="flex justify-between text-[8px] mb-1">
                                                <span className="text-orange-400">Recovery Mode - Step {bot.recoveryState.step}/{bot.recoveryState.maxSteps}</span>
                                                <span className="text-orange-400">${bot.currentStake.toFixed(2)}</span>
                                            </div>
                                            <Progress 
                                                value={(bot.recoveryState.step / bot.recoveryState.maxSteps) * 100} 
                                                className="h-1 bg-gray-700"
                                            />
                                        </div>
                                    )}

                                    {/* Confirmation Progress */}
                                    {bot.status === 'waiting' && (
                                        <div className="mb-3">
                                            <div className="flex justify-between text-[8px] mb-1">
                                                <span className="text-purple-400">Confirming Signal</span>
                                                <span className="text-purple-400">{bot.confirmationCount}/2</span>
                                            </div>
                                            <Progress 
                                                value={(bot.confirmationCount / 2) * 100} 
                                                className="h-1 bg-gray-700"
                                            />
                                        </div>
                                    )}

                                    {/* Run Progress */}
                                    <div className="flex space-x-1 mb-2">
                                        {[1,2,3,4,5].map(step => (
                                            <div
                                                key={step}
                                                className={`flex-1 h-1 rounded-full ${
                                                    step <= bot.currentRun ? `bg-${config.color}-500` : 'bg-gray-700'
                                                }`}
                                            />
                                        ))}
                                    </div>

                                    {/* Settings Panel */}
                                    {bot.expanded && (
                                        <>
                                            <Separator className="my-3 bg-gray-700" />
                                            <div className="space-y-3">
                                                <h4 className="text-xs font-semibold text-gray-300 flex items-center">
                                                    <Settings className="h-3 w-3 mr-1" />
                                                    Strategy Settings
                                                </h4>
                                                <div className="grid grid-cols-2 gap-2">
                                                    <div>
                                                        <Label className="text-[8px] text-gray-400">Stake ($)</Label>
                                                        <Input
                                                            type="number"
                                                            value={bot.settings.stake}
                                                            onChange={e => updateBotSettings(bot.id, { stake: parseFloat(e.target.value) || 0.1 })}
                                                            disabled={bot.isRunning}
                                                            className="h-6 text-xs bg-gray-700 border-gray-600 text-gray-200"
                                                            step="0.1"
                                                            min="0.1"
                                                        />
                                                    </div>
                                                    <div>
                                                        <Label className="text-[8px] text-gray-400">Martingale</Label>
                                                        <Input
                                                            type="number"
                                                            value={bot.settings.martingaleMultiplier}
                                                            onChange={e => updateBotSettings(bot.id, { martingaleMultiplier: parseFloat(e.target.value) || 1.5 })}
                                                            disabled={bot.isRunning}
                                                            className="h-6 text-xs bg-gray-700 border-gray-600 text-gray-200"
                                                            step="0.1"
                                                            min="1.1"
                                                        />
                                                    </div>
                                                    <div>
                                                        <Label className="text-[8px] text-gray-400">Stop Loss</Label>
                                                        <Input
                                                            type="number"
                                                            value={bot.settings.stopLoss}
                                                            onChange={e => updateBotSettings(bot.id, { stopLoss: parseFloat(e.target.value) || 10 })}
                                                            disabled={bot.isRunning}
                                                            className="h-6 text-xs bg-gray-700 border-gray-600 text-gray-200"
                                                        />
                                                    </div>
                                                    <div>
                                                        <Label className="text-[8px] text-gray-400">Take Profit</Label>
                                                        <Input
                                                            type="number"
                                                            value={bot.settings.takeProfit}
                                                            onChange={e => updateBotSettings(bot.id, { takeProfit: parseFloat(e.target.value) || 20 })}
                                                            disabled={bot.isRunning}
                                                            className="h-6 text-xs bg-gray-700 border-gray-600 text-gray-200"
                                                        />
                                                    </div>
                                                    <div className="col-span-2">
                                                        <Label className="text-[8px] text-gray-400">Runs</Label>
                                                        <Input
                                                            type="number"
                                                            value={bot.settings.runs}
                                                            onChange={e => updateBotSettings(bot.id, { runs: parseInt(e.target.value) || 5 })}
                                                            disabled={bot.isRunning}
                                                            className="h-6 text-xs bg-gray-700 border-gray-600 text-gray-200"
                                                            min="1"
                                                            max="20"
                                                        />
                                                    </div>
                                                    <div className="col-span-2">
                                                        <Label className="text-[8px] text-gray-400">Min Confidence</Label>
                                                        <Input
                                                            type="number"
                                                            value={bot.settings.minConfidence}
                                                            onChange={e => updateBotSettings(bot.id, { minConfidence: parseInt(e.target.value) || 55 })}
                                                            disabled={bot.isRunning}
                                                            className="h-6 text-xs bg-gray-700 border-gray-600 text-gray-200"
                                                            min="50"
                                                            max="90"
                                                        />
                                                    </div>
                                                    <div className="col-span-2">
                                                        <Label className="text-[8px] text-gray-400">Recovery Steps</Label>
                                                        <Input
                                                            type="number"
                                                            value={bot.settings.recoverySteps}
                                                            onChange={e => updateBotSettings(bot.id, { recoverySteps: parseInt(e.target.value) || 3 })}
                                                            disabled={bot.isRunning}
                                                            className="h-6 text-xs bg-gray-700 border-gray-600 text-gray-200"
                                                            min="1"
                                                            max="5"
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        </>
                                    )}
                                </CardContent>

                                <CardFooter className="relative p-3 pt-0 flex space-x-2">
                                    {!bot.isRunning ? (
                                        <Button
                                            className="flex-1 h-7 text-xs bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700"
                                            onClick={() => startBot(bot.id)}
                                            disabled={!bot.enabled || !isConnected || !dataLoaded}
                                        >
                                            <Play className="h-3 w-3 mr-1" />
                                            Start Bot
                                        </Button>
                                    ) : (
                                        <Button
                                            variant="destructive"
                                            className="flex-1 h-7 text-xs bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700"
                                            onClick={() => stopBot(bot.id)}
                                        >
                                            <StopCircle className="h-3 w-3 mr-1" />
                                            Stop Bot
                                        </Button>
                                    )}
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-7 w-7 p-0 border-gray-600 text-gray-400 hover:text-white hover:bg-gray-700"
                                        onClick={() => resetBot(bot.id)}
                                        disabled={bot.isRunning}
                                    >
                                        <RefreshCw className="h-3 w-3" />
                                    </Button>
                                </CardFooter>
                            </Card>
                        );
                    })}
                </div>

                {/* Tabs */}
                <Tabs value={selectedTab} onValueChange={setSelectedTab} className="mt-6">
                    <TabsList className="bg-gray-800 border-gray-700">
                        <TabsTrigger value="bots" className="data-[state=active]:bg-gray-700">Bots</TabsTrigger>
                        <TabsTrigger value="trades" className="data-[state=active]:bg-gray-700">Trade History ({trades.length})</TabsTrigger>
                        <TabsTrigger value="performance" className="data-[state=active]:bg-gray-700">Performance</TabsTrigger>
                    </TabsList>

                    <TabsContent value="trades">
                        <Card className="bg-gray-800/90 backdrop-blur-xl border-gray-700">
                            <CardHeader>
                                <CardTitle className="text-lg text-white">Trade History</CardTitle>
                                <CardDescription className="text-gray-400">Last 100 trades</CardDescription>
                            </CardHeader>
                            <CardContent>
                                {trades.length === 0 ? (
                                    <div className="text-center text-gray-500 py-12">
                                        <Activity className="h-12 w-12 mx-auto mb-3 opacity-30" />
                                        <p>No trades yet</p>
                                        <p className="text-sm">Start bots to see trades</p>
                                    </div>
                                ) : (
                                    <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
                                        {trades.map((trade, i) => (
                                            <div
                                                key={i}
                                                className={`
                                                    flex items-center justify-between p-3 rounded-lg text-sm
                                                    ${trade.result === 'win' ? 'bg-green-500/10 border border-green-500/20' : 
                                                      'bg-red-500/10 border border-red-500/20'}
                                                    ${activeTrade?.id === trade.id ? 'ring-2 ring-yellow-400' : ''}
                                                `}
                                            >
                                                <div className="flex items-center space-x-3">
                                                    <span className="text-xs text-gray-400">
                                                        {new Date(trade.timestamp).toLocaleTimeString()}
                                                    </span>
                                                    <Badge variant="outline" className="text-[8px] border-gray-600">
                                                        {trade.botName}
                                                    </Badge>
                                                    <span className="text-xs text-gray-300">
                                                        {trade.entryDigit} → {trade.resultDigit}
                                                    </span>
                                                    {trade.recoveryStep > 0 && (
                                                        <Badge variant="outline" className="text-[8px] bg-orange-500/20 text-orange-400 border-orange-500/30">
                                                            Step {trade.recoveryStep}
                                                        </Badge>
                                                    )}
                                                </div>
                                                <div className="flex items-center space-x-4">
                                                    <Badge variant="outline" className="text-[8px] border-gray-600">
                                                        {trade.confidence.toFixed(0)}%
                                                    </Badge>
                                                    <span className="text-xs text-gray-400">
                                                        ${trade.stake.toFixed(2)}
                                                    </span>
                                                    <span className={`text-xs font-bold w-16 text-right ${
                                                        trade.result === 'win' ? 'text-green-400' : 'text-red-400'
                                                    }`}>
                                                        {trade.result === 'win' ? '+' : '-'}${Math.abs(trade.profit).toFixed(2)}
                                                    </span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>

                    <TabsContent value="performance">
                        <Card className="bg-gray-800/90 backdrop-blur-xl border-gray-700">
                            <CardHeader>
                                <CardTitle className="text-lg text-white">Performance Overview</CardTitle>
                                <CardDescription className="text-gray-400">Bot statistics and analytics</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                                    <div className="bg-gray-700/50 rounded-lg p-4 text-center">
                                        <div className="text-2xl font-bold text-white">{totalTrades}</div>
                                        <div className="text-xs text-gray-400">Total Trades</div>
                                    </div>
                                    <div className="bg-gray-700/50 rounded-lg p-4 text-center">
                                        <div className="text-2xl font-bold text-green-400">{totalWins}</div>
                                        <div className="text-xs text-gray-400">Wins</div>
                                    </div>
                                    <div className="bg-gray-700/50 rounded-lg p-4 text-center">
                                        <div className="text-2xl font-bold text-red-400">{totalTrades - totalWins}</div>
                                        <div className="text-xs text-gray-400">Losses</div>
                                    </div>
                                    <div className="bg-gray-700/50 rounded-lg p-4 text-center">
                                        <div className={`text-2xl font-bold ${totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                            ${totalPnl.toFixed(2)}
                                        </div>
                                        <div className="text-xs text-gray-400">Total P&L</div>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    {bots.map(bot => {
                                        const winRate = bot.trades > 0 ? (bot.wins / bot.trades) * 100 : 0;
                                        return (
                                            <div key={bot.id} className="bg-gray-700/30 rounded-lg p-3">
                                                <div className="flex items-center justify-between mb-2">
                                                    <div className="flex items-center space-x-2">
                                                        <span className="text-sm font-bold text-white">{bot.name}</span>
                                                        <Badge variant="outline" className="text-[8px] border-gray-600">
                                                            {bot.trades} trades
                                                        </Badge>
                                                    </div>
                                                    <span className={`text-sm font-bold ${bot.totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                                        ${bot.totalPnl.toFixed(2)}
                                                    </span>
                                                </div>
                                                <div className="grid grid-cols-3 gap-2 text-xs">
                                                    <div>
                                                        <span className="text-gray-400">Win Rate:</span>
                                                        <span className="ml-1 text-green-400">{winRate.toFixed(1)}%</span>
                                                    </div>
                                                    <div>
                                                        <span className="text-gray-400">Avg Stake:</span>
                                                        <span className="ml-1 text-white">${bot.settings.stake.toFixed(2)}</span>
                                                    </div>
                                                    <div>
                                                        <span className="text-gray-400">Runs:</span>
                                                        <span className="ml-1 text-blue-400">{bot.currentRun}/{bot.settings.runs}</span>
                                                    </div>
                                                </div>
                                                <Progress 
                                                    value={winRate} 
                                                    className="h-1 mt-2"
                                                />
                                            </div>
                                        );
                                    })}
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>
                </Tabs>

                {/* Status Bar */}
                <div className="fixed bottom-4 right-4 flex space-x-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={connectWebSocket}
                        disabled={isConnected}
                        className="bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700"
                    >
                        <RefreshCw className={`h-4 w-4 mr-2 ${isConnecting ? 'animate-spin' : ''}`} />
                        {isConnecting ? 'Connecting...' : isConnected ? 'Connected' : 'Reconnect'}
                    </Button>
                    <Button
                        variant="destructive"
                        size="sm"
                        onClick={stopAllBots}
                        disabled={activeBots === 0}
                        className="bg-red-500/20 text-red-400 border-red-500/30 hover:bg-red-500/30"
                    >
                        <StopCircle className="h-4 w-4 mr-2" />
                        Stop All ({activeBots})
                    </Button>
                </div>
            </div>
        </div>
    );
}
