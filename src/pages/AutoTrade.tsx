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
    Compass,
    History,
    Lock,
    Unlock,
    DollarSign,
    TrendingUpIcon,
    TrendingDownIcon
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
    overPercentage: number;
    underPercentage: number;
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
        type: 'EVEN' | 'ODD' | 'OVER' | 'UNDER' | 'NONE';
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

interface Bot {
    id: string;
    name: string;
    type: 'even' | 'odd' | 'over' | 'under';
    mode: 'trend' | 'reversal';
    market: string;
    stake: number;
    duration: number;
    multiplier: number;
    maxSteps: number;
    takeProfit: number;
    stopLoss: number;
    useMartingale: boolean;
    useEntryFilter: boolean;
    minVolatility: number;
    maxVolatility: number;
    isRunning: boolean;
    status: 'idle' | 'watching' | 'confirming' | 'trading' | 'recovery' | 'stopped';
    currentStake: number;
    totalPnl: number;
    trades: number;
    wins: number;
    losses: number;
    currentRun: number;
    recoveryStep: number;
    consecutiveOpposite: number;
    lastEntrySignal: number | null;
    lastAnalysis: MarketAnalysis | null;
    expanded: boolean;
    enabled: boolean;
}

interface Trade {
    id: string;
    botId: string;
    botName: string;
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

const BOT_CONFIGS = [
    { id: 'bot1', type: 'over', mode: 'trend', name: 'OVER BOT (TREND)', icon: <ArrowUp className="w-4 h-4" />, color: 'blue', bg: 'from-blue-500/20 to-blue-600/10' },
    { id: 'bot2', type: 'over', mode: 'reversal', name: 'OVER BOT (RECOVERY)', icon: <RefreshCw className="w-4 h-4" />, color: 'cyan', bg: 'from-cyan-500/20 to-cyan-600/10' },
    { id: 'bot3', type: 'even', mode: 'trend', name: 'EVEN BOT', icon: <CircleDot className="w-4 h-4" />, color: 'purple', bg: 'from-purple-500/20 to-purple-600/10' },
    { id: 'bot4', type: 'odd', mode: 'trend', name: 'ODD BOT', icon: <Hash className="w-4 h-4" />, color: 'orange', bg: 'from-orange-500/20 to-orange-600/10' },
    { id: 'bot5', type: 'over', mode: 'trend', name: 'OVER BOT 2', icon: <MoveUp className="w-4 h-4" />, color: 'emerald', bg: 'from-emerald-500/20 to-emerald-600/10' },
    { id: 'bot6', type: 'under', mode: 'trend', name: 'UNDER BOT', icon: <MoveDown className="w-4 h-4" />, color: 'red', bg: 'from-red-500/20 to-red-600/10' }
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
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [loginError, setLoginError] = useState('');

    // WebSocket Refs
    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
    const ticksRef = useRef<TickData[]>([]);
    const runningBotsRef = useRef<Set<string>>(new Set());
    const pingIntervalRef = useRef<NodeJS.Timeout>();
    const isTradingRef = useRef<boolean>(false);

    // Initialize 6 bots with selected market
    useEffect(() => {
        const initialBots: Bot[] = BOT_CONFIGS.map(config => ({
            id: config.id,
            name: config.name,
            type: config.type as any,
            mode: config.mode as any,
            market: selectedMarket,
            stake: 1,
            duration: 5,
            multiplier: 2,
            maxSteps: 3,
            takeProfit: 20,
            stopLoss: 30,
            useMartingale: true,
            useEntryFilter: true,
            minVolatility: 0,
            maxVolatility: 100,
            isRunning: false,
            status: 'idle',
            currentStake: 1,
            totalPnl: 0,
            trades: 0,
            wins: 0,
            losses: 0,
            currentRun: 0,
            recoveryStep: 0,
            consecutiveOpposite: 0,
            lastEntrySignal: null,
            lastAnalysis: null,
            expanded: false,
            enabled: true
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
        setLoginError('');
        
        try {
            const ws = new WebSocket(DERIV_WS_URL);
            
            ws.onopen = () => {
                wsRef.current = ws;
                setIsConnected(true);
                setIsConnecting(false);
                
                // Start ping interval to check connection quality
                if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
                
                let lastPing = Date.now();
                pingIntervalRef.current = setInterval(() => {
                    const now = Date.now();
                    const latency = now - lastPing;
                    
                    if (latency < 100) setConnectionQuality('excellent');
                    else if (latency < 300) setConnectionQuality('good');
                    else setConnectionQuality('poor');
                    
                    lastPing = now;
                }, 5000);
                
                // Subscribe to selected market
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
                setLoginError('Connection error occurred');
            };

            ws.onclose = () => {
                setIsConnected(false);
                setIsConnecting(false);
                
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
            setLoginError('Failed to connect');
        }
    }, [selectedMarket]);

    // Handle login
    const handleLogin = () => {
        setIsLoggedIn(true);
        connectWebSocket();
        toast({
            title: 'Logged In',
            description: 'Successfully logged in to Deriv trading platform',
        });
    };

    // Handle logout
    const handleLogout = () => {
        if (wsRef.current) {
            wsRef.current.close();
        }
        setIsLoggedIn(false);
        setIsConnected(false);
        setBalance(10000);
        setTrades([]);
        stopAllBots();
        toast({
            title: 'Logged Out',
            description: 'Logged out from Deriv trading platform',
        });
    };

    // Subscribe to market
    const subscribeToMarket = (symbol: string) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        
        setDataLoaded(false);
        setLoadingProgress(0);
        
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
                title: 'Error',
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
            timestamp: times[index] ? times[index] * 1000 : Date.now() - (prices.length - index) * 100,
            digit: Math.floor(parseFloat(price) % 10)
        }));
        
        ticks.sort((a, b) => a.timestamp - b.timestamp);
        
        ticksRef.current = ticks;
        setTickCount(ticks.length);
        setDataLoaded(true);
        setLoadingProgress(100);
        updateAnalysis();
        
        toast({
            title: 'Data Loaded',
            description: `Loaded ${ticks.length} ticks for ${selectedMarket}`,
        });
    };

    // Handle live tick
    const handleTick = (tick: any) => {
        const digit = Math.floor(parseFloat(tick.quote) % 10);
        
        setLastDigit(digit);
        
        const newTick: TickData = {
            quote: parseFloat(tick.quote),
            symbol: tick.symbol,
            timestamp: Date.now(),
            digit
        };
        
        ticksRef.current.push(newTick);
        
        // Keep only last 1000 ticks
        if (ticksRef.current.length > 1000) {
            ticksRef.current = ticksRef.current.slice(-1000);
        }
        
        setTickCount(ticksRef.current.length);
        updateAnalysis();
    };

    // Update analysis
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
            digitPercentages[i] = (digitCounts[i] / 10);
        }

        // Even/Odd percentages
        let evenCount = 0, oddCount = 0;
        [0,2,4,6,8].forEach(d => evenCount += digitCounts[d]);
        [1,3,5,7,9].forEach(d => oddCount += digitCounts[d]);
        
        const evenPercentage = (evenCount / 1000) * 100;
        const oddPercentage = (oddCount / 1000) * 100;

        // Over/Under percentages
        let overCount = 0, underCount = 0;
        [5,6,7,8,9].forEach(d => overCount += digitCounts[d]);
        [0,1,2,3,4].forEach(d => underCount += digitCounts[d]);
        
        const overPercentage = (overCount / 1000) * 100;
        const underPercentage = (underCount / 1000) * 100;

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

        // Determine signal
        let signalType: 'EVEN' | 'ODD' | 'OVER' | 'UNDER' | 'NONE' = 'NONE';
        let confidence = 0;
        let strength: 'STRONG' | 'MEDIUM' | 'WEAK' = 'WEAK';
        let mode: 'TREND' | 'REVERSAL' = 'TREND';

        // Check Even/Odd signals
        if (evenPercentage >= 65) {
            signalType = 'ODD';
            mode = 'REVERSAL';
            confidence = evenPercentage;
        } else if (oddPercentage >= 65) {
            signalType = 'EVEN';
            mode = 'REVERSAL';
            confidence = oddPercentage;
        } else if (evenPercentage >= 55) {
            signalType = 'EVEN';
            mode = 'TREND';
            confidence = evenPercentage;
        } else if (oddPercentage >= 55) {
            signalType = 'ODD';
            mode = 'TREND';
            confidence = oddPercentage;
        }
        
        // Check Over/Under signals (override if stronger)
        if (overPercentage >= 65 && overPercentage > confidence) {
            signalType = 'UNDER';
            mode = 'REVERSAL';
            confidence = overPercentage;
        } else if (underPercentage >= 65 && underPercentage > confidence) {
            signalType = 'OVER';
            mode = 'REVERSAL';
            confidence = underPercentage;
        } else if (overPercentage >= 55 && overPercentage > confidence) {
            signalType = 'OVER';
            mode = 'TREND';
            confidence = overPercentage;
        } else if (underPercentage >= 55 && underPercentage > confidence) {
            signalType = 'UNDER';
            mode = 'TREND';
            confidence = underPercentage;
        }

        // Determine strength
        if (confidence >= 70) strength = 'STRONG';
        else if (confidence >= 55) strength = 'MEDIUM';
        else strength = 'WEAK';

        const analysis: MarketAnalysis = {
            symbol: selectedMarket,
            ticks: last1000,
            digitCounts,
            digitPercentages,
            evenPercentage,
            oddPercentage,
            overPercentage,
            underPercentage,
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
                type: signalType,
                confidence,
                strength,
                mode
            },
            volatility: {
                averageChange: avgChange,
                level: volatilityLevel,
                score: volatilityScore
            }
        };

        setAnalysis(analysis);
        checkBotEntries(analysis);
    };

    // Check entry conditions for all bots
    const checkBotEntries = (analysis: MarketAnalysis) => {
        if (isTradingRef.current) return; // Prevent multiple simultaneous trades
        
        setBots(prev => prev.map(bot => {
            if (!bot.isRunning || !bot.enabled) return bot;
            if (isTradingRef.current) return bot;

            // Check volatility range
            if (analysis.volatility.score < bot.minVolatility || 
                analysis.volatility.score > bot.maxVolatility) {
                return bot;
            }

            const lastDigits = analysis.lastDigits;
            const currentDigit = lastDigits[lastDigits.length - 1];
            
            // Determine what we're looking for
            let targetCondition: boolean;
            let oppositeCondition: boolean;
            
            if (bot.type === 'even') {
                targetCondition = currentDigit % 2 === 0;
                oppositeCondition = currentDigit % 2 === 1;
            } else if (bot.type === 'odd') {
                targetCondition = currentDigit % 2 === 1;
                oppositeCondition = currentDigit % 2 === 0;
            } else if (bot.type === 'over') {
                targetCondition = currentDigit >= 5;
                oppositeCondition = currentDigit <= 4;
            } else { // under
                targetCondition = currentDigit <= 4;
                oppositeCondition = currentDigit >= 5;
            }

            // Check if we should enter based on mode
            let shouldEnter = false;
            
            if (bot.mode === 'trend') {
                // Trend mode: look for target
                shouldEnter = targetCondition;
                
                // Reset opposite counter if we see target
                if (targetCondition) {
                    bot.consecutiveOpposite = 0;
                } else if (oppositeCondition) {
                    bot.consecutiveOpposite++;
                }
            } else {
                // Reversal mode: look for 2 consecutive opposites then target
                if (oppositeCondition) {
                    bot.consecutiveOpposite++;
                } else {
                    bot.consecutiveOpposite = 0;
                }
                
                if (bot.consecutiveOpposite >= 2 && targetCondition) {
                    shouldEnter = true;
                    bot.consecutiveOpposite = 0;
                }
            }

            // Apply entry filter if enabled
            if (bot.useEntryFilter && shouldEnter) {
                // Check confidence based on bot type
                if (bot.type === 'even' || bot.type === 'odd') {
                    const relevantPercentage = bot.type === 'even' ? 
                        analysis.evenPercentage : analysis.oddPercentage;
                    shouldEnter = relevantPercentage >= (bot.mode === 'trend' ? 55 : 65);
                } else {
                    const relevantPercentage = bot.type === 'over' ? 
                        analysis.overPercentage : analysis.underPercentage;
                    shouldEnter = relevantPercentage >= (bot.mode === 'trend' ? 55 : 65);
                }
            }

            if (shouldEnter) {
                bot.status = 'confirming';
                bot.lastEntrySignal = Date.now();
                
                // Execute trade
                executeTrade(bot, analysis);
                isTradingRef.current = true;
            } else {
                bot.status = 'watching';
            }

            return bot;
        }));
    };

    // Execute trade
    const executeTrade = (bot: Bot, analysis: MarketAnalysis) => {
        if (!demoMode && !isConnected) {
            toast({
                title: 'Not Connected',
                description: 'Cannot execute live trade',
                variant: 'destructive',
            });
            isTradingRef.current = false;
            return;
        }

        const lastTick = analysis.ticks[analysis.ticks.length - 1];
        
        // Simulate trade with realistic probability based on percentages
        setTimeout(() => {
            const winProbability = bot.type === 'even' ? analysis.evenPercentage / 100 :
                                  bot.type === 'odd' ? analysis.oddPercentage / 100 :
                                  bot.type === 'over' ? analysis.overPercentage / 100 :
                                  analysis.underPercentage / 100;
            
            const won = Math.random() < winProbability;
            const profit = won ? bot.currentStake * 0.95 : -bot.currentStake;

            // Generate result digit based on outcome
            let resultDigit;
            if (won) {
                // Generate a digit that satisfies the condition
                if (bot.type === 'even') {
                    const evens = [0,2,4,6,8];
                    resultDigit = evens[Math.floor(Math.random() * evens.length)];
                } else if (bot.type === 'odd') {
                    const odds = [1,3,5,7,9];
                    resultDigit = odds[Math.floor(Math.random() * odds.length)];
                } else if (bot.type === 'over') {
                    resultDigit = 5 + Math.floor(Math.random() * 5);
                } else {
                    resultDigit = Math.floor(Math.random() * 5);
                }
            } else {
                // Generate a digit that fails the condition
                if (bot.type === 'even') {
                    const odds = [1,3,5,7,9];
                    resultDigit = odds[Math.floor(Math.random() * odds.length)];
                } else if (bot.type === 'odd') {
                    const evens = [0,2,4,6,8];
                    resultDigit = evens[Math.floor(Math.random() * evens.length)];
                } else if (bot.type === 'over') {
                    resultDigit = Math.floor(Math.random() * 5);
                } else {
                    resultDigit = 5 + Math.floor(Math.random() * 5);
                }
            }

            const trade: Trade = {
                id: `trade-${Date.now()}-${Math.random()}`,
                botId: bot.id,
                botName: bot.name,
                type: bot.type,
                mode: bot.mode,
                market: bot.market,
                entry: bot.type,
                stake: bot.currentStake,
                result: won ? 'win' : 'loss',
                profit,
                entryDigit: lastTick.digit,
                resultDigit,
                timestamp: Date.now(),
                confidence: analysis.signal.confidence
            };

            setActiveTrade(trade);
            setTrades(prev => [trade, ...prev].slice(0, 100));

            // Update bot stats
            setBots(prev => prev.map(b => {
                if (b.id === bot.id) {
                    const newTrades = b.trades + 1;
                    const newWins = won ? b.wins + 1 : b.wins;
                    const newLosses = won ? b.losses : b.losses + 1;
                    const newPnl = b.totalPnl + profit;

                    // Update stake based on martingale
                    let newStake = b.stake;
                    let newRecoveryStep = 0;
                    let newCurrentRun = b.currentRun;
                    
                    if (b.useMartingale) {
                        if (won) {
                            newStake = b.stake;
                            newRecoveryStep = 0;
                            newCurrentRun = b.currentRun + 1;
                        } else {
                            newRecoveryStep = b.recoveryStep + 1;
                            if (newRecoveryStep <= b.maxSteps) {
                                newStake = b.stake * Math.pow(b.multiplier, newRecoveryStep);
                            }
                        }
                    }

                    // Check stop loss / take profit
                    if (newPnl <= -b.stopLoss || newPnl >= b.takeProfit) {
                        stopBot(b.id);
                    }

                    return {
                        ...b,
                        trades: newTrades,
                        wins: newWins,
                        losses: newLosses,
                        totalPnl: newPnl,
                        currentStake: newStake,
                        recoveryStep: newRecoveryStep,
                        currentRun: newCurrentRun,
                        status: 'watching'
                    };
                }
                return b;
            }));

            // Update balance
            if (demoMode) {
                setBalance(prev => prev + profit);
            }

            // Show toast for trade result
            toast({
                title: won ? 'Trade Won! 🎉' : 'Trade Lost 💔',
                description: `${bot.name} | Profit: $${profit.toFixed(2)}`,
                variant: won ? 'default' : 'destructive',
            });

            setTimeout(() => {
                setActiveTrade(null);
                isTradingRef.current = false;
            }, 3000);
        }, 1500);
    };

    // Start bot
    const startBot = (botId: string) => {
        const bot = bots.find(b => b.id === botId);
        if (!bot) return;
        
        if (!isLoggedIn) {
            toast({
                title: 'Not Logged In',
                description: 'Please login first',
                variant: 'destructive',
            });
            return;
        }

        if (!isConnected) {
            toast({
                title: 'Not Connected',
                description: 'Please wait for WebSocket connection',
                variant: 'destructive',
            });
            return;
        }

        if (!analysis || !dataLoaded) {
            toast({
                title: 'No Data',
                description: 'Waiting for market data',
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
                    currentStake: b.stake,
                    recoveryStep: 0,
                    consecutiveOpposite: 0,
                    currentRun: 0
                };
            }
            return b;
        }));

        toast({
            title: 'Bot Started',
            description: `${bot.name} is now watching for signals`,
        });
    };

    // Stop bot
    const stopBot = (botId: string) => {
        runningBotsRef.current.delete(botId);
        
        setBots(prev => prev.map(b => {
            if (b.id === botId) {
                return { ...b, isRunning: false, status: 'stopped' };
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
        if (!isLoggedIn) {
            toast({
                title: 'Not Logged In',
                description: 'Please login first',
                variant: 'destructive',
            });
            return;
        }

        if (!isConnected) {
            toast({
                title: 'Not Connected',
                description: 'Please wait for WebSocket connection',
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
        isTradingRef.current = false;
        
        setBots(prev => prev.map(b => ({
            ...b,
            isRunning: false,
            status: 'stopped'
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
                    currentStake: b.stake,
                    consecutiveOpposite: 0
                };
            }
            return b;
        }));
    };

    // Reset all stats
    const resetAllStats = () => {
        setBots(prev => prev.map(b => ({
            ...b,
            totalPnl: 0,
            trades: 0,
            wins: 0,
            losses: 0,
            currentRun: 0,
            recoveryStep: 0,
            currentStake: b.stake,
            consecutiveOpposite: 0
        })));
        setTrades([]);
        setBalance(10000);
        
        toast({
            title: 'Stats Reset',
            description: 'All bot statistics have been reset',
        });
    };

    // Calculate stats
    const totalTrades = trades.filter(t => t.result !== 'pending').length;
    const totalWins = trades.filter(t => t.result === 'win').length;
    const totalPnl = bots.reduce((sum, b) => sum + b.totalPnl, 0);
    const activeBots = bots.filter(b => b.isRunning).length;
    const winRate = totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0;

    // Connect on login
    useEffect(() => {
        if (isLoggedIn) {
            connectWebSocket();
        }
        
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
    }, [isLoggedIn]);

    // Change market
    useEffect(() => {
        if (isConnected && isLoggedIn) {
            subscribeToMarket(selectedMarket);
            ticksRef.current = [];
            setAnalysis(null);
            setDataLoaded(false);
            setLoadingProgress(0);
        }
    }, [selectedMarket, isConnected, isLoggedIn]);

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
                                {/* Login/Logout Section */}
                                {!isLoggedIn ? (
                                    <div className="flex items-center space-x-2">
                                        <Button
                                            size="sm"
                                            onClick={handleLogin}
                                            className="h-8 bg-gradient-to-r from-green-500 to-emerald-600"
                                        >
                                            <Unlock className="h-3 w-3 mr-1" />
                                            Login
                                        </Button>
                                    </div>
                                ) : (
                                    <div className="flex items-center space-x-3">
                                        <div className="px-3 py-1.5 bg-gray-700/50 rounded-lg">
                                            <span className="text-xs text-gray-400">Balance:</span>
                                            <span className="ml-2 text-sm font-bold text-green-400">
                                                ${balance.toFixed(2)}
                                            </span>
                                        </div>
                                        <Badge className={`px-3 py-1 ${demoMode ? 'bg-yellow-500/20 text-yellow-400' : 'bg-red-500/20 text-red-400'}`}>
                                            {demoMode ? 'DEMO' : 'REAL'}
                                        </Badge>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={handleLogout}
                                            className="text-gray-400 hover:text-white hover:bg-gray-700"
                                        >
                                            <LogOut className="h-4 w-4" />
                                        </Button>
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
                        {loginError && (
                            <div className="mt-2 text-xs text-red-400">
                                {loginError}
                            </div>
                        )}
                    </CardHeader>

                    {/* Stats Cards */}
                    <CardContent className="pb-2">
                        <div className="grid grid-cols-5 gap-3">
                            <div className="bg-gray-700/50 rounded-lg p-3 border border-gray-600">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-gray-400">Mode</span>
                                    <Badge variant={demoMode ? "outline" : "default"} className="text-xs">
                                        {demoMode ? 'DEMO' : 'LIVE'}
                                    </Badge>
                                </div>
                                <Switch checked={!demoMode} onCheckedChange={(v) => setDemoMode(!v)} className="mt-2" disabled={!isLoggedIn} />
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
                        </div>
                    </CardContent>

                    {/* Global Settings */}
                    {showSettings && isLoggedIn && (
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
                            <Select value={selectedMarket} onValueChange={setSelectedMarket} disabled={!isLoggedIn}>
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
                                disabled={!isLoggedIn || !isConnected || !dataLoaded}
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
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={resetAllStats}
                                disabled={!isLoggedIn}
                                className="border-gray-600 text-gray-300 hover:bg-gray-700"
                            >
                                <RefreshCw className="h-4 w-4 mr-2" />
                                Reset All
                            </Button>
                        </div>

                        <div className="flex items-center space-x-4">
                            <div className="flex items-center space-x-2 bg-gray-700/30 px-3 py-1.5 rounded-lg">
                                <Signal className="h-4 w-4 text-blue-400" />
                                <span className="text-xs text-gray-300">Ticks: {tickCount}</span>
                            </div>
                            {!dataLoaded && isConnected && (
                                <div className="w-24">
                                    <Progress value={loadingProgress} className="h-1.5" />
                                </div>
                            )}
                        </div>
                    </CardFooter>
                </Card>

                {/* Live Analysis Dashboard - Only show when logged in */}
                {analysis && dataLoaded && isLoggedIn && (
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

                                {/* Percentages */}
                                <div className="col-span-3 bg-gray-700/30 rounded-lg p-3 border border-gray-600">
                                    <div className="text-xs text-gray-400 mb-2 flex items-center">
                                        <PieChart className="h-3 w-3 mr-1" />
                                        Market Statistics
                                    </div>
                                    <div className="space-y-3">
                                        <div>
                                            <div className="flex justify-between text-xs mb-1">
                                                <span className="text-purple-400">Even</span>
                                                <span className="text-purple-400 font-bold">{analysis.evenPercentage.toFixed(1)}%</span>
                                            </div>
                                            <Progress value={analysis.evenPercentage} className="h-1.5" />
                                        </div>
                                        <div>
                                            <div className="flex justify-between text-xs mb-1">
                                                <span className="text-orange-400">Odd</span>
                                                <span className="text-orange-400 font-bold">{analysis.oddPercentage.toFixed(1)}%</span>
                                            </div>
                                            <Progress value={analysis.oddPercentage} className="h-1.5" />
                                        </div>
                                        <div>
                                            <div className="flex justify-between text-xs mb-1">
                                                <span className="text-blue-400">Over (5-9)</span>
                                                <span className="text-blue-400 font-bold">{analysis.overPercentage.toFixed(1)}%</span>
                                            </div>
                                            <Progress value={analysis.overPercentage} className="h-1.5" />
                                        </div>
                                        <div>
                                            <div className="flex justify-between text-xs mb-1">
                                                <span className="text-green-400">Under (0-4)</span>
                                                <span className="text-green-400 font-bold">{analysis.underPercentage.toFixed(1)}%</span>
                                            </div>
                                            <Progress value={analysis.underPercentage} className="h-1.5" />
                                        </div>
                                    </div>
                                </div>

                                {/* Current Signal & Streaks */}
                                <div className="col-span-3 bg-gray-700/30 rounded-lg p-3 border border-gray-600">
                                    <div className="text-xs text-gray-400 mb-2 flex items-center">
                                        <Radio className="h-3 w-3 mr-1" />
                                        Current Signal
                                    </div>
                                    {analysis.signal.type !== 'NONE' ? (
                                        <div className="space-y-3">
                                            <div className="flex items-center justify-between">
                                                <Badge className={`
                                                    px-3 py-1 text-sm
                                                    ${analysis.signal.type === 'EVEN' ? 'bg-purple-500' : ''}
                                                    ${analysis.signal.type === 'ODD' ? 'bg-orange-500' : ''}
                                                    ${analysis.signal.type === 'OVER' ? 'bg-blue-500' : ''}
                                                    ${analysis.signal.type === 'UNDER' ? 'bg-green-500' : ''}
                                                `}>
                                                    BUY {analysis.signal.type}
                                                </Badge>
                                                <Badge variant="outline" className="text-xs border-gray-600">
                                                    {analysis.signal.mode}
                                                </Badge>
                                            </div>
                                            <div>
                                                <div className="flex justify-between text-xs mb-1">
                                                    <span className="text-gray-400">Confidence</span>
                                                    <span className="text-yellow-400">{analysis.signal.confidence.toFixed(0)}%</span>
                                                </div>
                                                <Progress value={analysis.signal.confidence} className="h-1.5" />
                                            </div>
                                            <div className="grid grid-cols-2 gap-2 text-xs">
                                                <div className="bg-gray-800/50 rounded p-2">
                                                    <div className="text-gray-500">Even Streak</div>
                                                    <div className="text-lg font-bold text-purple-400">{analysis.currentEvenStreak}</div>
                                                </div>
                                                <div className="bg-gray-800/50 rounded p-2">
                                                    <div className="text-gray-500">Odd Streak</div>
                                                    <div className="text-lg font-bold text-orange-400">{analysis.currentOddStreak}</div>
                                                </div>
                                                <div className="bg-gray-800/50 rounded p-2">
                                                    <div className="text-gray-500">Over Streak</div>
                                                    <div className="text-lg font-bold text-blue-400">{analysis.currentOverStreak}</div>
                                                </div>
                                                <div className="bg-gray-800/50 rounded p-2">
                                                    <div className="text-gray-500">Under Streak</div>
                                                    <div className="text-lg font-bold text-green-400">{analysis.currentUnderStreak}</div>
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="h-32 flex items-center justify-center text-gray-500">
                                            No clear signal
                                        </div>
                                    )}
                                </div>

                                {/* Volatility & Trends */}
                                <div className="col-span-2 bg-gray-700/30 rounded-lg p-3 border border-gray-600">
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

                {/* Login Prompt if not logged in */}
                {!isLoggedIn && (
                    <Card className="bg-gray-800/90 backdrop-blur-xl border-gray-700 shadow-xl">
                        <CardContent className="p-12 text-center">
                            <Lock className="h-16 w-16 mx-auto mb-4 text-gray-600" />
                            <h3 className="text-xl font-bold text-white mb-2">Not Logged In</h3>
                            <p className="text-gray-400 mb-6">Please login to start trading</p>
                            <Button
                                onClick={handleLogin}
                                className="bg-gradient-to-r from-blue-500 to-purple-600"
                            >
                                <Unlock className="h-4 w-4 mr-2" />
                                Login to Deriv Trading
                            </Button>
                        </CardContent>
                    </Card>
                )}

                {/* Bots Grid - Only show when logged in */}
                {isLoggedIn && (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {bots.map((bot, index) => {
                            const config = BOT_CONFIGS[index];
                            
                            return (
                                <Card 
                                    key={bot.id} 
                                    className={`
                                        bg-gray-800/90 backdrop-blur-xl border-gray-700 shadow-xl overflow-hidden
                                        transition-all duration-300 hover:shadow-2xl hover:scale-[1.02]
                                        ${bot.isRunning ? `ring-2 ring-${config.color}-500/50` : ''}
                                        ${!bot.enabled ? 'opacity-50' : ''}
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
                                                        {bot.status.toUpperCase()}
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
                                        {bot.recoveryStep > 0 && (
                                            <div className="mb-3">
                                                <div className="flex justify-between text-[8px] mb-1">
                                                    <span className="text-gray-400">Recovery Step {bot.recoveryStep}/{bot.maxSteps}</span>
                                                    <span className="text-orange-400">${bot.currentStake.toFixed(2)}</span>
                                                </div>
                                                <Progress 
                                                    value={(bot.recoveryStep / bot.maxSteps) * 100} 
                                                    className="h-1 bg-gray-700"
                                                />
                                            </div>
                                        )}

                                        {/* Run Progress */}
                                        <div className="flex space-x-1">
                                            {[1,2,3].map(step => (
                                                <div
                                                    key={step}
                                                    className={`flex-1 h-1 rounded-full ${
                                                        step <= bot.currentRun ? `bg-${config.color}-500` : 'bg-gray-700'
                                                    }`}
                                                />
                                            ))}
                                        </div>

                                        {/* Consecutive Opposite Counter */}
                                        {bot.consecutiveOpposite > 0 && (
                                            <div className="mt-2 text-center">
                                                <Badge variant="outline" className="text-[8px] bg-blue-500/20 text-blue-400 border-blue-500/30">
                                                    {bot.consecutiveOpposite}/2 opposites
                                                </Badge>
                                            </div>
                                        )}

                                        {/* Expanded Settings */}
                                        {bot.expanded && (
                                            <>
                                                <Separator className="my-3 bg-gray-700" />
                                                <div className="grid grid-cols-2 gap-2">
                                                    <div>
                                                        <Label className="text-[8px] text-gray-400">Stake ($)</Label>
                                                        <Input
                                                            type="number"
                                                            value={bot.stake}
                                                            onChange={e => setBots(prev => prev.map(b => 
                                                                b.id === bot.id ? { ...b, stake: parseFloat(e.target.value) || 0.1 } : b
                                                            ))}
                                                            disabled={bot.isRunning}
                                                            className="h-6 text-xs bg-gray-700 border-gray-600 text-gray-200"
                                                            step="0.1"
                                                            min="0.1"
                                                        />
                                                    </div>
                                                    <div>
                                                        <Label className="text-[8px] text-gray-400">Duration</Label>
                                                        <Select
                                                            value={bot.duration.toString()}
                                                            onValueChange={v => setBots(prev => prev.map(b => 
                                                                b.id === bot.id ? { ...b, duration: parseInt(v) } : b
                                                            ))}
                                                            disabled={bot.isRunning}
                                                        >
                                                            <SelectTrigger className="h-6 text-xs bg-gray-700 border-gray-600 text-gray-200">
                                                                <SelectValue />
                                                            </SelectTrigger>
                                                            <SelectContent className="bg-gray-800 border-gray-700">
                                                                {[1,2,3,4,5,6,7,8,9,10].map(d => (
                                                                    <SelectItem key={d} value={d.toString()} className="text-xs text-gray-200">
                                                                        {d} ticks
                                                                    </SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                    </div>
                                                    <div>
                                                        <Label className="text-[8px] text-gray-400">Take Profit</Label>
                                                        <Input
                                                            type="number"
                                                            value={bot.takeProfit}
                                                            onChange={e => setBots(prev => prev.map(b => 
                                                                b.id === bot.id ? { ...b, takeProfit: parseFloat(e.target.value) || 0 } : b
                                                            ))}
                                                            disabled={bot.isRunning}
                                                            className="h-6 text-xs bg-gray-700 border-gray-600 text-gray-200"
                                                        />
                                                    </div>
                                                    <div>
                                                        <Label className="text-[8px] text-gray-400">Stop Loss</Label>
                                                        <Input
                                                            type="number"
                                                            value={bot.stopLoss}
                                                            onChange={e => setBots(prev => prev.map(b => 
                                                                b.id === bot.id ? { ...b, stopLoss: parseFloat(e.target.value) || 0 } : b
                                                            ))}
                                                            disabled={bot.isRunning}
                                                            className="h-6 text-xs bg-gray-700 border-gray-600 text-gray-200"
                                                        />
                                                    </div>
                                                    <div className="col-span-2">
                                                        <div className="flex items-center justify-between">
                                                            <Label className="text-[8px] text-gray-400">Martingale</Label>
                                                            <Switch
                                                                checked={bot.useMartingale}
                                                                onCheckedChange={v => setBots(prev => prev.map(b => 
                                                                    b.id === bot.id ? { ...b, useMartingale: v } : b
                                                                ))}
                                                                disabled={bot.isRunning}
                                                                className="scale-75"
                                                            />
                                                        </div>
                                                        {bot.useMartingale && (
                                                            <div className="grid grid-cols-2 gap-2 mt-2">
                                                                <div>
                                                                    <Label className="text-[8px] text-gray-400">Multiplier</Label>
                                                                    <Input
                                                                        type="number"
                                                                        value={bot.multiplier}
                                                                        onChange={e => setBots(prev => prev.map(b => 
                                                                            b.id === bot.id ? { ...b, multiplier: parseFloat(e.target.value) || 1.5 } : b
                                                                        ))}
                                                                        disabled={bot.isRunning}
                                                                        className="h-6 text-xs bg-gray-700 border-gray-600 text-gray-200"
                                                                        step="0.1"
                                                                        min="1.1"
                                                                    />
                                                                </div>
                                                                <div>
                                                                    <Label className="text-[8px] text-gray-400">Max Steps</Label>
                                                                    <Input
                                                                        type="number"
                                                                        value={bot.maxSteps}
                                                                        onChange={e => setBots(prev => prev.map(b => 
                                                                            b.id === bot.id ? { ...b, maxSteps: parseInt(e.target.value) || 1 } : b
                                                                        ))}
                                                                        disabled={bot.isRunning}
                                                                        className="h-6 text-xs bg-gray-700 border-gray-600 text-gray-200"
                                                                        min="1"
                                                                        max="5"
                                                                    />
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div className="col-span-2">
                                                        <div className="flex items-center justify-between">
                                                            <Label className="text-[8px] text-gray-400">Entry Filter</Label>
                                                            <Switch
                                                                checked={bot.useEntryFilter}
                                                                onCheckedChange={v => setBots(prev => prev.map(b => 
                                                                    b.id === bot.id ? { ...b, useEntryFilter: v } : b
                                                                ))}
                                                                disabled={bot.isRunning}
                                                                className="scale-75"
                                                            />
                                                        </div>
                                                    </div>
                                                    <div className="col-span-2">
                                                        <Label className="text-[8px] text-gray-400">Volatility Range</Label>
                                                        <div className="flex items-center space-x-2">
                                                            <Input
                                                                type="number"
                                                                value={bot.minVolatility}
                                                                onChange={e => setBots(prev => prev.map(b => 
                                                                    b.id === bot.id ? { ...b, minVolatility: parseInt(e.target.value) || 0 } : b
                                                                ))}
                                                                disabled={bot.isRunning}
                                                                className="h-6 text-xs bg-gray-700 border-gray-600 text-gray-200"
                                                                min="0"
                                                                max="100"
                                                                placeholder="Min"
                                                            />
                                                            <span className="text-gray-400">-</span>
                                                            <Input
                                                                type="number"
                                                                value={bot.maxVolatility}
                                                                onChange={e => setBots(prev => prev.map(b => 
                                                                    b.id === bot.id ? { ...b, maxVolatility: parseInt(e.target.value) || 100 } : b
                                                                ))}
                                                                disabled={bot.isRunning}
                                                                className="h-6 text-xs bg-gray-700 border-gray-600 text-gray-200"
                                                                min="0"
                                                                max="100"
                                                                placeholder="Max"
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
                                                disabled={!bot.enabled || !isConnected || !analysis || !dataLoaded}
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
                )}

                {/* Tabs - Only show when logged in */}
                {isLoggedIn && (
                    <Tabs value={selectedTab} onValueChange={setSelectedTab} className="mt-6">
                        <TabsList className="bg-gray-800 border-gray-700">
                            <TabsTrigger value="bots" className="data-[state=active]:bg-gray-700">Bots</TabsTrigger>
                            <TabsTrigger value="trades" className="data-[state=active]:bg-gray-700">Trade History ({trades.length})</TabsTrigger>
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
                    </Tabs>
                )}

                {/* Status Bar */}
                {isLoggedIn && (
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
                )}
            </div>
        </div>
    );
}
