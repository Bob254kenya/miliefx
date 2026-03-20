import { useState, useRef, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { derivApi } from '@/services/deriv-api';
import { useAuth } from '@/contexts/AuthContext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Play, StopCircle, Pause, TrendingUp, TrendingDown, 
  CircleDot, RefreshCw, Trash2, DollarSign, Volume2,
  CheckCircle2, Clock, Zap, Target, Activity,
  LineChart, Radio, ScanLine, Sparkles
} from 'lucide-react';

interface DigitFrequency {
  digit: number;
  count: number;
  percentage: number;
}

interface MarketAnalysis {
  symbol: string;
  displayName: string;
  mostAppearing: number;
  secondMost: number;
  thirdMost: number;
  leastAppearing: number;
  digitFrequencies: DigitFrequency[];
  evenPercentage: number;
  oddPercentage: number;
  lowDigitsPercentage: number;
  highDigitsPercentage: number;
  overUnderStats: {
    over3: number;
    under6: number;
    over1: number;
    under8: number;
  };
  conditions: {
    typeA: boolean;
    typeB: boolean;
    evenDominant: boolean;
  };
  recommendedEntry: number;
  botType: 'TYPE_A' | 'TYPE_B' | 'EVEN_ODD' | null;
}

interface BotInstance {
  id: string;
  market: string;
  displayName: string;
  botType: string;
  entryDigit: number;
  stake: number;
  multiplier: number;
  stopCondition: 'profit';
  recoveryActive: boolean;
  isRunning: boolean;
  isPaused: boolean;
  currentStake: number;
  originalStake: number;
  totalPnl: number;
  trades: number;
  wins: number;
  losses: number;
  consecutiveLosses: number;
  contractsExecuted: number;
  lastTradeResult?: 'win' | 'loss';
  inRecovery: boolean;
}

const ALL_MARKETS = [
  { symbol: 'R_10', name: 'Volatility 10', icon: '📈' },
  { symbol: 'R_25', name: 'Volatility 25', icon: '📈' },
  { symbol: 'R_50', name: 'Volatility 50', icon: '📈' },
  { symbol: 'R_75', name: 'Volatility 75', icon: '📈' },
  { symbol: 'R_100', name: 'Volatility 100', icon: '📈' },
  { symbol: '1HZ_10', name: '1HZ Volatility 10', icon: '⚡' },
  { symbol: '1HZ_25', name: '1HZ Volatility 25', icon: '⚡' },
  { symbol: '1HZ_50', name: '1HZ Volatility 50', icon: '⚡' },
  { symbol: '1HZ_75', name: '1HZ Volatility 75', icon: '⚡' },
  { symbol: '1HZ_100', name: '1HZ Volatility 100', icon: '⚡' },
  { symbol: 'Jump Bull', name: 'Jump Bull', icon: '🐂' },
  { symbol: 'Jump Bear', name: 'Jump Bear', icon: '🐻' }
];

const CONTRACT_PAYOUT = 9.5;

export default function AutoTrade() {
  const { isAuthorized, balance } = useAuth();
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanningMarket, setScanningMarket] = useState('');
  const [marketAnalyses, setMarketAnalyses] = useState<Record<string, MarketAnalysis>>({});
  const [availableSignals, setAvailableSignals] = useState<MarketAnalysis[]>([]);
  const [noSignal, setNoSignal] = useState(false);
  const [activeTab, setActiveTab] = useState('signals');
  
  const [botInstances, setBotInstances] = useState<BotInstance[]>([]);
  const [globalStake, setGlobalStake] = useState(1.00);
  const [globalMultiplier, setGlobalMultiplier] = useState(2.0);
  const [tradeHistory, setTradeHistory] = useState<Array<{time: string, message: string, type: string}>>([]);
  
  const scanIntervalRef = useRef<NodeJS.Timeout>();

  const fetchTicks = async (market: string): Promise<number[]> => {
    try {
      const ticks = await derivApi.getTicks(market, 1000);
      return ticks.map((tick: any) => {
        const quote = tick.quote.toString();
        return parseInt(quote.charAt(quote.length - 1));
      });
    } catch (error) {
      console.error(`Error fetching ticks for ${market}:`, error);
      return [];
    }
  };

  const analyzeDigits = (symbol: string, digits: number[]): MarketAnalysis => {
    const total = digits.length;
    const freq = Array(10).fill(0);
    digits.forEach(d => freq[d]++);
    
    const percentages = freq.map(c => (c / total) * 100);
    const frequencies: DigitFrequency[] = percentages.map((p, i) => ({ digit: i, count: freq[i], percentage: p }));
    frequencies.sort((a, b) => b.count - a.count);
    
    const evenCount = digits.filter(d => d % 2 === 0).length;
    const oddCount = digits.filter(d => d % 2 === 1).length;
    const evenPercentage = (evenCount / total) * 100;
    const oddPercentage = (oddCount / total) * 100;
    
    const lowDigitsPercentage = percentages[0] + percentages[1] + percentages[2];
    const conditionTypeA = lowDigitsPercentage < 10;
    
    const highDigitsPercentage = percentages[7] + percentages[8] + percentages[9];
    const conditionTypeB = highDigitsPercentage < 10;
    
    const conditionEvenDominant = evenPercentage > 55;
    
    let recommendedEntry = 0;
    let botType: 'TYPE_A' | 'TYPE_B' | 'EVEN_ODD' | null = null;
    
    if (conditionTypeA) {
      botType = 'TYPE_A';
      let best = 0;
      if (percentages[1] > percentages[best]) best = 1;
      if (percentages[2] > percentages[best]) best = 2;
      recommendedEntry = best;
    } else if (conditionTypeB) {
      botType = 'TYPE_B';
      let best = 7;
      if (percentages[8] > percentages[best]) best = 8;
      if (percentages[9] > percentages[best]) best = 9;
      recommendedEntry = best;
    } else if (conditionEvenDominant) {
      botType = 'EVEN_ODD';
      const evens = [0, 2, 4, 6, 8];
      let bestEven = evens.reduce((a, b) => percentages[a] > percentages[b] ? a : b, 4);
      recommendedEntry = bestEven;
    }
    
    const marketInfo = ALL_MARKETS.find(m => m.symbol === symbol);
    
    return {
      symbol,
      displayName: marketInfo?.name || symbol,
      mostAppearing: frequencies[0].digit,
      secondMost: frequencies[1].digit,
      thirdMost: frequencies[2].digit,
      leastAppearing: frequencies[9].digit,
      digitFrequencies: frequencies,
      evenPercentage,
      oddPercentage,
      lowDigitsPercentage,
      highDigitsPercentage,
      overUnderStats: {
        over3: digits.filter(d => d > 3).length / total * 100,
        under6: digits.filter(d => d < 6).length / total * 100,
        over1: digits.filter(d => d > 1).length / total * 100,
        under8: digits.filter(d => d < 8).length / total * 100
      },
      conditions: {
        typeA: conditionTypeA,
        typeB: conditionTypeB,
        evenDominant: conditionEvenDominant
      },
      recommendedEntry,
      botType
    };
  };

  const addTradeLog = (message: string, type: 'win' | 'loss' | 'info' = 'info') => {
    const time = new Date().toLocaleTimeString();
    setTradeHistory(prev => [{ time, message, type }, ...prev].slice(0, 200));
  };

  const executeTrade = async (bot: BotInstance): Promise<boolean> => {
    try {
      const ticks = await derivApi.getTicks(bot.market, 1);
      const lastDigit = parseInt(ticks[0].quote.toString().slice(-1));
      const isWin = lastDigit === bot.entryDigit;
      
      let profit = 0;
      if (isWin) {
        profit = bot.currentStake * (CONTRACT_PAYOUT - 1);
        bot.totalPnl += profit;
        bot.wins++;
        bot.consecutiveLosses = 0;
        addTradeLog(`✅ ${bot.displayName} | Predicted ${bot.entryDigit} | Actual ${lastDigit} | WIN +$${profit.toFixed(2)}`, 'win');
      } else {
        profit = -bot.currentStake;
        bot.totalPnl += profit;
        bot.losses++;
        bot.consecutiveLosses++;
        addTradeLog(`❌ ${bot.displayName} | Predicted ${bot.entryDigit} | Actual ${lastDigit} | LOSS -$${bot.currentStake.toFixed(2)}`, 'loss');
      }
      
      bot.trades++;
      bot.lastTradeResult = isWin ? 'win' : 'loss';
      
      return isWin;
    } catch (error) {
      addTradeLog(`⚠️ Trade execution error on ${bot.displayName}`, 'info');
      return false;
    }
  };

  const runBot = useCallback(async (botId: string) => {
    const botIndex = botInstances.findIndex(b => b.id === botId);
    if (botIndex === -1) return;
    
    let bot = { ...botInstances[botIndex] };
    if (!bot.isRunning || bot.isPaused) return;
    
    addTradeLog(`🤖 ${bot.displayName} (${bot.botType}) started | Entry: ${bot.entryDigit} | Stake: $${bot.stake}`, 'info');
    
    let contractsExecuted = 0;
    const maxContracts = 3;
    let currentStake = bot.stake;
    let recoveryAttempts = 0;
    const maxRecoveryAttempts = 5;
    
    while (contractsExecuted < maxContracts && bot.isRunning && !bot.isPaused) {
      if (bot.totalPnl > 0) {
        addTradeLog(`🏁 ${bot.displayName} | Profit achieved ($${bot.totalPnl.toFixed(2)}). Stopping bot.`, 'info');
        bot.isRunning = false;
        break;
      }
      
      bot.currentStake = currentStake;
      const isWin = await executeTrade(bot);
      contractsExecuted++;
      
      if (isWin) {
        addTradeLog(`🎯 ${bot.displayName} | Win achieved! Total PnL: $${bot.totalPnl.toFixed(2)}. Stopping.`, 'win');
        bot.isRunning = false;
        break;
      } else {
        if (recoveryAttempts < maxRecoveryAttempts && bot.totalPnl <= 0) {
          recoveryAttempts++;
          currentStake = bot.stake * Math.pow(bot.multiplier, recoveryAttempts);
          addTradeLog(`🔄 ${bot.displayName} | Recovery #${recoveryAttempts} | New stake: $${currentStake.toFixed(2)}`, 'info');
          contractsExecuted--;
        } else if (recoveryAttempts >= maxRecoveryAttempts) {
          addTradeLog(`⚠️ ${bot.displayName} | Max recovery attempts reached. Stopping.`, 'info');
          bot.isRunning = false;
          break;
        }
      }
    }
    
    if (contractsExecuted >= maxContracts && bot.totalPnl <= 0 && bot.isRunning) {
      addTradeLog(`📊 ${bot.displayName} | Completed ${maxContracts} contracts without profit. Stopping.`, 'info');
      bot.isRunning = false;
    }
    
    setBotInstances(prev => prev.map(b => b.id === botId ? bot : b));
  }, [botInstances]);

  const startBot = (analysis: MarketAnalysis, stake: number, multiplier: number) => {
    if (!isAuthorized) {
      toast.error('Please connect your account first');
      return;
    }
    
    if ((balance || 0) < stake) {
      toast.error('Insufficient balance');
      return;
    }
    
    const botTypeName = analysis.botType === 'TYPE_A' ? 'Type A (0,1,2 < 10%)' :
                        analysis.botType === 'TYPE_B' ? 'Type B (7,8,9 < 10%)' :
                        'Even/Odd Bot';
    
    const newBot: BotInstance = {
      id: `${analysis.symbol}-${Date.now()}`,
      market: analysis.symbol,
      displayName: analysis.displayName,
      botType: botTypeName,
      entryDigit: analysis.recommendedEntry,
      stake: stake,
      multiplier: multiplier,
      stopCondition: 'profit',
      recoveryActive: true,
      isRunning: true,
      isPaused: false,
      currentStake: stake,
      originalStake: stake,
      totalPnl: 0,
      trades: 0,
      wins: 0,
      losses: 0,
      consecutiveLosses: 0,
      contractsExecuted: 0,
      inRecovery: false
    };
    
    setBotInstances(prev => [...prev, newBot]);
    addTradeLog(`🚀 Started ${botTypeName} on ${analysis.displayName} | Entry: ${analysis.recommendedEntry} | Stake: $${stake} | Multiplier: ${multiplier}x`, 'info');
    
    setTimeout(() => runBot(newBot.id), 100);
  };

  const stopBot = (botId: string) => {
    setBotInstances(prev => prev.map(bot => 
      bot.id === botId ? { ...bot, isRunning: false } : bot
    ));
    const bot = botInstances.find(b => b.id === botId);
    if (bot) {
      addTradeLog(`⏹️ Stopped bot on ${bot.displayName}`, 'info');
    }
  };

  const togglePauseBot = (botId: string) => {
    setBotInstances(prev => prev.map(bot =>
      bot.id === botId ? { ...bot, isPaused: !bot.isPaused } : bot
    ));
  };

  const startScan = useCallback(async () => {
    if (isScanning) return;
    
    setIsScanning(true);
    setNoSignal(false);
    setAvailableSignals([]);
    setScanProgress(0);
    setMarketAnalyses({});
    
    const newAnalyses: Record<string, MarketAnalysis> = {};
    const newSignals: MarketAnalysis[] = [];
    
    try {
      for (let i = 0; i < ALL_MARKETS.length; i++) {
        const market = ALL_MARKETS[i];
        setScanProgress(Math.round(((i + 1) / ALL_MARKETS.length) * 100));
        setScanningMarket(market.symbol);
        
        const digits = await fetchTicks(market.symbol);
        if (digits.length >= 1000) {
          const analysis = analyzeDigits(market.symbol, digits);
          newAnalyses[market.symbol] = analysis;
          
          if (analysis.botType) {
            newSignals.push(analysis);
          }
        }
        
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      
      setMarketAnalyses(newAnalyses);
      setAvailableSignals(newSignals);
      
      if (newSignals.length > 0) {
        toast.success(`Found ${newSignals.length} trading signals!`);
        addTradeLog(`🔍 Scan complete | Found ${newSignals.length} markets with favorable conditions`, 'info');
      } else {
        setNoSignal(true);
        toast.info('NO SIGNAL FOUND');
        addTradeLog(`🔍 Scan complete | No favorable conditions detected`, 'info');
      }
      
    } catch (error) {
      console.error('Scan error:', error);
      toast.error('Scan failed');
    } finally {
      setIsScanning(false);
      setScanningMarket('');
    }
  }, [isScanning]);

  useEffect(() => {
    return () => {
      if (scanIntervalRef.current) {
        clearInterval(scanIntervalRef.current);
      }
    };
  }, []);

  const totalStats = {
    activeBots: botInstances.filter(b => b.isRunning).length,
    totalPnl: botInstances.reduce((sum, bot) => sum + bot.totalPnl, 0),
    totalTrades: botInstances.reduce((sum, bot) => sum + bot.trades, 0),
    totalWins: botInstances.reduce((sum, bot) => sum + bot.wins, 0),
    winRate: (() => {
      const activeWithTrades = botInstances.filter(b => b.trades > 0);
      if (activeWithTrades.length === 0) return 0;
      return activeWithTrades.reduce((sum, bot) => sum + (bot.wins / (bot.trades || 1)) * 100, 0) / activeWithTrades.length;
    })()
  };

  const getBotColor = (botType: string | null) => {
    if (botType === 'TYPE_A') return 'border-emerald-500/50 bg-emerald-500/10';
    if (botType === 'TYPE_B') return 'border-blue-500/50 bg-blue-500/10';
    if (botType === 'EVEN_ODD') return 'border-purple-500/50 bg-purple-500/10';
    return 'border-gray-500/50';
  };

  const getBotIcon = (botType: string | null) => {
    if (botType === 'TYPE_A') return <TrendingUp className="w-5 h-5 text-emerald-400" />;
    if (botType === 'TYPE_B') return <TrendingDown className="w-5 h-5 text-blue-400" />;
    if (botType === 'EVEN_ODD') return <CircleDot className="w-5 h-5 text-purple-400" />;
    return <Zap className="w-5 h-5" />;
  };

  return (
    <div className="relative min-h-screen bg-gradient-to-b from-gray-900 to-gray-950">
      <div className="relative z-10 container mx-auto p-6 max-w-7xl">
        <motion.div 
          className="text-center mb-8"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <h1 className="text-5xl font-bold mb-3 bg-gradient-to-r from-emerald-400 via-cyan-400 to-purple-600 bg-clip-text text-transparent">
            Deriv Trading Bot
          </h1>
          <p className="text-gray-400 text-lg">Digit Analysis • 3-Contract Runs • Martingale Recovery</p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <Card className="bg-gray-800/50 border-gray-700">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-400">Balance</p>
                  <p className="text-2xl font-bold text-white">${balance?.toFixed(2) || '1000.00'}</p>
                </div>
                <DollarSign className="w-8 h-8 text-emerald-400" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gray-800/50 border-gray-700">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-400">Active Bots</p>
                  <p className="text-2xl font-bold text-white">{totalStats.activeBots}</p>
                </div>
                <Zap className="w-8 h-8 text-yellow-400" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gray-800/50 border-gray-700">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-400">Total P&L</p>
                  <p className={`text-2xl font-bold ${totalStats.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    ${totalStats.totalPnl.toFixed(2)}
                  </p>
                </div>
                <LineChart className="w-8 h-8 text-blue-400" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gray-800/50 border-gray-700">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-400">Win Rate</p>
                  <p className="text-2xl font-bold text-white">{totalStats.winRate.toFixed(1)}%</p>
                </div>
                <Target className="w-8 h-8 text-purple-400" />
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="bg-gray-800/50 border-gray-700 mb-6">
          <CardContent className="p-4">
            <div className="flex items-center gap-6 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-400">Default Stake:</span>
                <input
                  type="number"
                  value={globalStake}
                  onChange={(e) => setGlobalStake(parseFloat(e.target.value) || 1)}
                  step="0.5"
                  min="0.5"
                  className="w-24 px-3 py-1 bg-gray-700 border border-gray-600 rounded-lg text-white"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-400">Martingale Multiplier:</span>
                <input
                  type="number"
                  value={globalMultiplier}
                  onChange={(e) => setGlobalMultiplier(parseFloat(e.target.value) || 2)}
                  step="0.2"
                  min="1.2"
                  className="w-24 px-3 py-1 bg-gray-700 border border-gray-600 rounded-lg text-white"
                />
              </div>
              <div className="flex-1" />
              <Badge variant="outline" className="border-emerald-500 text-emerald-400">
                <Volume2 className="w-3 h-3 mr-1" />
                3 Contracts • Stop on Profit
              </Badge>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-center mb-8">
          <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
            <Button
              onClick={startScan}
              disabled={isScanning || !isAuthorized}
              size="lg"
              className="relative w-64 h-64 rounded-full bg-gradient-to-r from-emerald-500 via-cyan-500 to-purple-600 hover:from-emerald-600 hover:via-cyan-600 hover:to-purple-700 shadow-2xl"
            >
              <div className="absolute inset-0 rounded-full bg-white/20 animate-ping opacity-75" />
              <div className="relative flex flex-col items-center">
                {isScanning ? (
                  <>
                    <ScanLine className="w-16 h-16 mb-3 animate-spin text-white" />
                    <span className="text-2xl font-bold text-white">SCANNING</span>
                    <span className="text-lg mt-2 text-white/90">{scanProgress}%</span>
                    <span className="text-xs mt-1 text-white/70">{scanningMarket}</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-16 h-16 mb-3 text-white" />
                    <span className="text-2xl font-bold text-white">SCAN</span>
                    <span className="text-sm mt-2 text-white/80">{ALL_MARKETS.length} Markets</span>
                  </>
                )}
              </div>
            </Button>
          </motion.div>
        </div>

        {isScanning && (
          <div className="mb-8">
            <Progress value={scanProgress} className="h-2 bg-gray-700" />
          </div>
        )}

        <AnimatePresence>
          {noSignal && !isScanning && (
            <motion.div 
              className="text-center py-12"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
            >
              <div className="text-7xl mb-4">🔍</div>
              <h2 className="text-4xl font-bold text-gray-400 mb-2">NO SIGNAL FOUND</h2>
              <p className="text-gray-500 text-lg">No markets with digits 0,1,2 {'<10%'} or 7,8,9 {'<10%'} or Even {'>55%'}</p>
              <Button 
                variant="outline" 
                className="mt-4 border-gray-600 text-gray-300"
                onClick={startScan}
                disabled={isScanning}
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Scan Again
              </Button>
            </motion.div>
          )}
        </AnimatePresence>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-6">
          <TabsList className="grid grid-cols-3 w-[400px] mx-auto mb-6 bg-gray-800">
            <TabsTrigger value="signals" className="data-[state=active]:bg-gray-700">Signals ({availableSignals.length})</TabsTrigger>
            <TabsTrigger value="bots" className="data-[state=active]:bg-gray-700">Active Bots ({totalStats.activeBots})</TabsTrigger>
            <TabsTrigger value="logs" className="data-[state=active]:bg-gray-700">Trade Logs</TabsTrigger>
          </TabsList>

          <TabsContent value="signals">
            {availableSignals.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {availableSignals.map((signal, index) => {
                  const isBotActive = botInstances.some(b => b.market === signal.symbol && b.isRunning);
                  
                  return (
                    <motion.div
                      key={signal.symbol}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.05 }}
                    >
                      <Card className={`bg-gray-800/80 border-2 ${getBotColor(signal.botType)} hover:shadow-lg transition-all`}>
                        <CardHeader className="pb-2">
                          <div className="flex items-start justify-between">
                            <div className="flex items-center gap-3">
                              <div className="w-12 h-12 rounded-full bg-gray-700 flex items-center justify-center text-2xl">
                                {ALL_MARKETS.find(m => m.symbol === signal.symbol)?.icon || '📊'}
                              </div>
                              <div>
                                <CardTitle className="text-lg text-white">{signal.displayName}</CardTitle>
                                <Badge className={signal.botType === 'TYPE_A' ? 'bg-emerald-500/20 text-emerald-400' : signal.botType === 'TYPE_B' ? 'bg-blue-500/20 text-blue-400' : 'bg-purple-500/20 text-purple-400'}>
                                  {getBotIcon(signal.botType)}
                                  <span className="ml-1">{signal.botType === 'TYPE_A' ? 'Type A (0,1,2 <10%)' : signal.botType === 'TYPE_B' ? 'Type B (7,8,9 <10%)' : 'Even/Odd (>55%)'}</span>
                                </Badge>
                              </div>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent>
                          <div className="bg-gray-900/50 rounded-lg p-3 mb-3">
                            <div className="grid grid-cols-3 gap-2 text-center mb-3">
                              <div>
                                <div className="text-xs text-gray-400">Even %</div>
                                <div className="text-lg font-bold text-white">{signal.evenPercentage.toFixed(1)}%</div>
                              </div>
                              <div>
                                <div className="text-xs text-gray-400">Odd %</div>
                                <div className="text-lg font-bold text-white">{signal.oddPercentage.toFixed(1)}%</div>
                              </div>
                              <div>
                                <div className="text-xs text-gray-400">Entry</div>
                                <div className="text-lg font-bold text-emerald-400">{signal.recommendedEntry}</div>
                              </div>
                            </div>
                            
                            <div className="flex justify-between text-xs mb-2">
                              <span className="text-gray-400">0,1,2: <span className={signal.lowDigitsPercentage < 10 ? 'text-emerald-400' : 'text-gray-300'}>{signal.lowDigitsPercentage.toFixed(1)}%</span></span>
                              <span className="text-gray-400">7,8,9: <span className={signal.highDigitsPercentage < 10 ? 'text-emerald-400' : 'text-gray-300'}>{signal.highDigitsPercentage.toFixed(1)}%</span></span>
                            </div>
                            
                            <div className="space-y-1">
                              {signal.digitFrequencies.slice(0, 5).map((f, i) => (
                                <div key={i} className="flex items-center gap-2">
                                  <span className="text-xs text-gray-400 w-4">{f.digit}</span>
                                  <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                                    <motion.div 
                                      className={`h-full ${signal.botType === 'TYPE_A' ? 'bg-emerald-500' : signal.botType === 'TYPE_B' ? 'bg-blue-500' : 'bg-purple-500'}`}
                                      initial={{ width: 0 }}
                                      animate={{ width: `${f.percentage}%` }}
                                    />
                                  </div>
                                  <span className="text-xs text-gray-400">{f.percentage.toFixed(1)}%</span>
                                </div>
                              ))}
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-2 mb-3">
                            <div>
                              <label className="text-xs text-gray-400">Stake ($)</label>
                              <input
                                type="number"
                                id={`stake-${signal.symbol}`}
                                defaultValue={globalStake}
                                step="0.5"
                                min="0.5"
                                className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-sm text-white"
                              />
                            </div>
                            <div>
                              <label className="text-xs text-gray-400">Multiplier</label>
                              <input
                                type="number"
                                id={`mult-${signal.symbol}`}
                                defaultValue={globalMultiplier}
                                step="0.2"
                                min="1.2"
                                className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-sm text-white"
                              />
                            </div>
                          </div>

                          {!isBotActive ? (
                            <Button 
                              className="w-full bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800"
                              onClick={() => {
                                const stakeInput = document.getElementById(`stake-${signal.symbol}`) as HTMLInputElement;
                                const multInput = document.getElementById(`mult-${signal.symbol}`) as HTMLInputElement;
                                const stake = parseFloat(stakeInput?.value || globalStake.toString());
                                const mult = parseFloat(multInput?.value || globalMultiplier.toString());
                                startBot(signal, stake, mult);
                              }}
                              disabled={!isAuthorized}
                            >
                              <Play className="w-4 h-4 mr-2" />
                              Start Bot
                            </Button>
                          ) : (
                            <Button className="w-full bg-gray-600 cursor-not-allowed" disabled>
                              <CheckCircle2 className="w-4 h-4 mr-2" />
                              Already Active
                            </Button>
                          )}
                        </CardContent>
                      </Card>
                    </motion.div>
                  );
                })}
              </div>
            ) : (
              !noSignal && !isScanning && (
                <div className="text-center py-12 text-gray-500">
                  <Radio className="w-16 h-16 mx-auto mb-4 opacity-50" />
                  <p className="text-lg">Click SCAN to analyze all markets for trading signals.</p>
                  <p className="text-sm mt-2">Looking for: digits 0,1,2 {'<10%'} OR digits 7,8,9 {'<10%'} OR Even% {'>55%'}</p>
                </div>
              )
            )}
          </TabsContent>

          <TabsContent value="bots">
            {botInstances.filter(b => b.isRunning).length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {botInstances.filter(b => b.isRunning).map((bot) => (
                  <motion.div key={bot.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                    <Card className={`bg-gray-800/80 border-2 ${getBotColor(bot.botType.includes('TYPE_A') ? 'TYPE_A' : bot.botType.includes('TYPE_B') ? 'TYPE_B' : 'EVEN_ODD')}`}>
                      <CardHeader className="pb-2">
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-lg ${bot.botType.includes('TYPE_A') ? 'bg-emerald-500/20' : bot.botType.includes('TYPE_B') ? 'bg-blue-500/20' : 'bg-purple-500/20'}`}>
                              {getBotIcon(bot.botType.includes('TYPE_A') ? 'TYPE_A' : bot.botType.includes('TYPE_B') ? 'TYPE_B' : 'EVEN_ODD')}
                            </div>
                            <div>
                              <CardTitle className="text-white">{bot.displayName}</CardTitle>
                              <p className="text-xs text-gray-400">{bot.botType}</p>
                            </div>
                          </div>
                          <Badge className={bot.isPaused ? 'bg-yellow-500' : 'bg-emerald-500'}>
                            {bot.isPaused ? 'PAUSED' : 'RUNNING'}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-4 gap-2 mb-3">
                          <div className="bg-gray-900/50 rounded p-2 text-center">
                            <div className="text-xs text-gray-400">P&L</div>
                            <div className={`font-bold ${bot.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                              ${bot.totalPnl.toFixed(2)}
                            </div>
                          </div>
                          <div className="bg-gray-900/50 rounded p-2 text-center">
                            <div className="text-xs text-gray-400">Trades</div>
                            <div className="font-bold text-white">{bot.trades}</div>
                          </div>
                          <div className="bg-gray-900/50 rounded p-2 text-center">
                            <div className="text-xs text-gray-400">Wins</div>
                            <div className="font-bold text-emerald-400">{bot.wins}</div>
                          </div>
                          <div className="bg-gray-900/50 rounded p-2 text-center">
                            <div className="text-xs text-gray-400">Losses</div>
                            <div className="font-bold text-red-400">{bot.losses}</div>
                          </div>
                        </div>

                        <div className="bg-gray-900/50 rounded-lg p-3 mb-3">
                          <div className="flex justify-between items-center">
                            <span className="text-gray-400">Entry Digit:</span>
                            <span className="font-bold text-xl text-emerald-400">{bot.entryDigit}</span>
                          </div>
                          <div className="flex justify-between items-center mt-1">
                            <span className="text-gray-400">Current Stake:</span>
                            <span className="font-bold text-white">${bot.currentStake.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between items-center mt-1">
                            <span className="text-gray-400">Consecutive Losses:</span>
                            <span className="font-bold text-white">{bot.consecutiveLosses}</span>
                          </div>
                        </div>

                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            className={`flex-1 ${bot.isPaused ? 'border-yellow-500 text-yellow-400' : 'border-gray-600'}`}
                            onClick={() => togglePauseBot(bot.id)}
                          >
                            {bot.isPaused ? (
                              <><Play className="w-4 h-4 mr-2" />Resume</>
                            ) : (
                              <><Pause className="w-4 h-4 mr-2" />Pause</>
                            )}
                          </Button>
                          <Button
                            variant="destructive"
                            className="flex-1"
                            onClick={() => stopBot(bot.id)}
                          >
                            <StopCircle className="w-4 h-4 mr-2" />
                            Stop
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-gray-500">
                <Zap className="w-16 h-16 mx-auto mb-4 opacity-50" />
                <p className="text-lg">No active bots. Start a bot from the Signals tab.</p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="logs">
            <Card className="bg-gray-800/80 border-gray-700">
              <CardHeader className="pb-2">
                <div className="flex justify-between items-center">
                  <CardTitle className="text-white text-lg">Trade History</CardTitle>
                  <Button variant="outline" size="sm" onClick={() => setTradeHistory([])}>
                    <Trash2 className="w-4 h-4 mr-2" />
                    Clear
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 max-h-[500px] overflow-y-auto">
                  {tradeHistory.length > 0 ? (
                    tradeHistory.map((log, idx) => (
                      <div key={idx} className={`border-l-4 p-3 rounded-r-lg ${
                        log.type === 'win' ? 'border-emerald-500 bg-emerald-500/10' :
                        log.type === 'loss' ? 'border-red-500 bg-red-500/10' :
                        'border-cyan-500 bg-cyan-500/10'
                      }`}>
                        <div className="flex gap-2">
                          <span className="text-xs text-gray-400">{log.time}</span>
                          <span className="text-sm text-gray-200">{log.message}</span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-8 text-gray-500">
                      <Clock className="w-12 h-12 mx-auto mb-3 opacity-50" />
                      <p>No trade history yet</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
