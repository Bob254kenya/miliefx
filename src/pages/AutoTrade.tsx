import { useState, useRef, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { derivApi } from '@/services/deriv-api';
import { useAuth } from '@/contexts/AuthContext';
import { useTickLoader } from '@/hooks/useTickLoader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  Loader2, Play, StopCircle, Pause, TrendingUp, TrendingDown, 
  CircleDot, RefreshCw, Trash2, DollarSign, Sparkles, ChevronDown, 
  ChevronUp, Activity, Zap, Target, BarChart3, Clock, Award,
  Scan, AlertCircle, CheckCircle2, XCircle, HelpCircle
} from 'lucide-react';

// ... (keep all interfaces and helper functions the same)

export default function AutoTrade() {
  const { isAuthorized, activeAccount, balance } = useAuth();
  const [activeTradeId, setActiveTradeId] = useState<string | null>(null);
  const [selectedMarket, setSelectedMarket] = useState<string>('R_100');
  const [marketAnalysis, setMarketAnalysis] = useState<Record<string, MarketAnalysis>>({});
  const [marketSignals, setMarketSignals] = useState<Record<string, Record<string, boolean>>>({});
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [globalStake, setGlobalStake] = useState<number>(0.5);
  const [globalMultiplier, setGlobalMultiplier] = useState<number>(2);
  const [globalStopLoss, setGlobalStopLoss] = useState<number>(30);
  const [globalTakeProfit, setGlobalTakeProfit] = useState<number>(5);
  const [selectedMarketForScan, setSelectedMarketForScan] = useState<string>('R_100');
  const [autoStartAll, setAutoStartAll] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showSignals, setShowSignals] = useState(false);
  const [showTradeLog, setShowTradeLog] = useState(false);
  const [activeTab, setActiveTab] = useState<'bots' | 'signals' | 'trades'>('bots');
  
  const [trades, setTrades] = useState<TradeLog[]>([]);
  const tradeIdRef = useRef(0);
  const marketDigitsRef = useRef<Record<string, number[]>>({});
  const scanTimeoutRef = useRef<NodeJS.Timeout>();

  const { digits, prices, isLoading, tickCount } = useTickLoader(selectedMarketForScan, 1000);

  // ... (keep all the existing functions - scanMarket, runBot, etc.)

  // Play scanning sound
  const playScanSound = () => {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(880, audioContext.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(440, audioContext.currentTime + 0.2);
      
      gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.2);
    } catch (e) {
      console.log('Audio not supported');
    }
  };

  // ... (keep all market analysis functions)

  // Modern color palette
  const colors = {
    primary: {
      from: '#3B82F6', // blue-500
      to: '#8B5CF6', // purple-500
      gradient: 'from-blue-500 to-purple-500',
      light: 'from-blue-400 to-purple-400',
      dark: 'from-blue-600 to-purple-600',
    },
    success: {
      main: '#10B981', // emerald-500
      light: '#34D399', // emerald-400
      dark: '#059669', // emerald-600
      gradient: 'from-emerald-500 to-teal-500',
    },
    warning: {
      main: '#F59E0B', // amber-500
      light: '#FBBF24', // amber-400
      dark: '#D97706', // amber-600
      gradient: 'from-amber-500 to-orange-500',
    },
    danger: {
      main: '#EF4444', // red-500
      light: '#F87171', // red-400
      dark: '#DC2626', // red-600
      gradient: 'from-rose-500 to-red-500',
    },
    info: {
      main: '#6366F1', // indigo-500
      light: '#818CF8', // indigo-400
      dark: '#4F46E5', // indigo-600
      gradient: 'from-indigo-500 to-blue-500',
    },
    background: {
      dark: '#0F172A', // slate-900
      darker: '#020617', // slate-950
      card: 'rgba(15, 23, 42, 0.7)',
      overlay: 'rgba(2, 6, 23, 0.8)',
    }
  };

  const getMarketDisplay = (market: string) => {
    if (market.startsWith('1HZ')) return { icon: '⚡', name: market, color: 'text-yellow-400' };
    if (market.startsWith('R_')) return { icon: '📊', name: market, color: 'text-blue-400' };
    if (market.startsWith('BOOM')) return { icon: '💥', name: market, color: 'text-orange-400' };
    if (market.startsWith('CRASH')) return { icon: '📉', name: market, color: 'text-red-400' };
    return { icon: '🎯', name: market, color: 'text-purple-400' };
  };

  const totalProfit = bots.reduce((sum, bot) => sum + bot.totalPnl, 0);
  const totalTrades = bots.reduce((sum, bot) => sum + bot.trades, 0);
  const totalWins = bots.reduce((sum, bot) => sum + bot.wins, 0);
  const winRate = totalTrades > 0 ? ((totalWins / totalTrades) * 100).toFixed(1) : '0';
  const activeSignals = bots.filter(b => b.signal).length;

  return (
    <div className="relative min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-950">
      {/* Animated Background Elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        {/* Gradient Orbs */}
        <motion.div
          className="absolute top-0 -left-4 w-72 h-72 bg-purple-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob"
          animate={{
            x: [0, 100, 0],
            y: [0, 50, 0],
          }}
          transition={{
            duration: 20,
            repeat: Infinity,
            ease: "linear"
          }}
        />
        <motion.div
          className="absolute top-0 -right-4 w-72 h-72 bg-blue-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-2000"
          animate={{
            x: [0, -100, 0],
            y: [0, 100, 0],
          }}
          transition={{
            duration: 25,
            repeat: Infinity,
            ease: "linear"
          }}
        />
        <motion.div
          className="absolute bottom-0 left-20 w-72 h-72 bg-indigo-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-4000"
          animate={{
            x: [0, 50, 0],
            y: [0, -50, 0],
          }}
          transition={{
            duration: 30,
            repeat: Infinity,
            ease: "linear"
          }}
        />

        {/* Grid Pattern */}
        <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg width="60" height="60" viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg"%3E%3Cg fill="none" fill-rule="evenodd"%3E%3Cg fill="%239C92AC" fill-opacity="0.05"%3E%3Cpath d="M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z"/%3E%3C/g%3E%3C/g%3E%3C/svg%3E')] opacity-20" />
      </div>

      {/* Main Content */}
      <div className="relative z-10 max-w-7xl mx-auto px-2 sm:px-3 py-2 space-y-2">
        {/* Header with Balance and Actions */}
        <motion.div
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="bg-slate-900/80 backdrop-blur-xl rounded-2xl border border-indigo-500/20 p-3 shadow-2xl"
        >
          <div className="flex items-center justify-between flex-wrap gap-2">
            {/* Logo and Title */}
            <motion.div 
              className="flex items-center gap-2"
              whileHover={{ scale: 1.02 }}
            >
              <div className="relative">
                <motion.div
                  animate={{ 
                    rotate: [0, 360],
                    scale: [1, 1.1, 1],
                  }}
                  transition={{ 
                    rotate: { duration: 20, repeat: Infinity, ease: "linear" },
                    scale: { duration: 2, repeat: Infinity, ease: "easeInOut" }
                  }}
                  className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-500 rounded-lg flex items-center justify-center"
                >
                  <Zap className="w-4 h-4 text-white" />
                </motion.div>
                <motion.div
                  animate={{ scale: [1, 1.5, 1], opacity: [0.5, 0, 0.5] }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="absolute inset-0 bg-blue-500 rounded-lg blur-md -z-10"
                />
              </div>
              <div>
                <h1 className="text-sm sm:text-base font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                  AI Auto Trading
                </h1>
                <p className="text-[8px] sm:text-[10px] text-slate-400">6-Bot Neural System</p>
              </div>
            </motion.div>

            {/* Balance Display */}
            <motion.div
              whileHover={{ scale: 1.05 }}
              className="bg-gradient-to-r from-emerald-500/20 to-teal-500/20 rounded-xl px-3 py-1 border border-emerald-500/30"
            >
              <p className="text-[8px] text-emerald-400/60">BALANCE</p>
              <p className="text-sm sm:text-base font-bold text-emerald-400">
                ${balance?.toFixed(2) || '0.00'}
              </p>
            </motion.div>

            {/* Quick Actions */}
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={clearAll}
                className="h-7 px-2 border-rose-500/30 text-rose-400 hover:bg-rose-500/20 text-xs"
              >
                <Trash2 className="w-3 h-3 mr-1" />
                <span className="hidden sm:inline">Clear</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={stopAllBots}
                disabled={!bots.some(b => b.isRunning)}
                className="h-7 px-2 border-red-500/30 text-red-400 hover:bg-red-500/20 text-xs"
              >
                <StopCircle className="w-3 h-3 mr-1" />
                <span className="hidden sm:inline">Stop All</span>
              </Button>
            </div>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-6 gap-1 mt-2">
            {[
              { label: 'Total P&L', value: `$${totalProfit.toFixed(2)}`, color: totalProfit >= 0 ? 'text-emerald-400' : 'text-rose-400', icon: DollarSign },
              { label: 'Win Rate', value: `${winRate}%`, color: 'text-amber-400', icon: Target },
              { label: 'Trades', value: totalTrades.toString(), color: 'text-blue-400', icon: BarChart3 },
              { label: 'Active', value: `${bots.filter(b => b.isRunning).length}/6`, color: 'text-purple-400', icon: Activity },
              { label: 'Signals', value: activeSignals.toString(), color: 'text-indigo-400', icon: Sparkles },
              { label: 'Win/Loss', value: `${totalWins}/${totalTrades - totalWins}`, color: 'text-slate-400', icon: Award },
            ].map((stat, i) => (
              <motion.div
                key={i}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: i * 0.05 }}
                className="bg-slate-800/50 backdrop-blur rounded-lg p-1 border border-indigo-500/10"
              >
                <div className="flex items-center gap-1">
                  <stat.icon className={`w-2 h-2 ${stat.color}`} />
                  <span className="text-[6px] sm:text-[8px] text-slate-400">{stat.label}</span>
                </div>
                <p className={`text-[10px] sm:text-xs font-bold ${stat.color}`}>{stat.value}</p>
              </motion.div>
            ))}
          </div>

          {/* Mobile Tabs */}
          <div className="flex sm:hidden gap-1 mt-2">
            {[
              { id: 'bots', label: 'Bots', icon: Activity },
              { id: 'signals', label: 'Signals', icon: Sparkles },
              { id: 'trades', label: 'Trades', icon: BarChart3 },
            ].map((tab) => (
              <Button
                key={tab.id}
                variant={activeTab === tab.id ? 'default' : 'outline'}
                size="sm"
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex-1 h-7 text-xs ${
                  activeTab === tab.id
                    ? 'bg-gradient-to-r from-blue-500 to-purple-500 text-white'
                    : 'border-indigo-500/30 text-slate-400'
                }`}
              >
                <tab.icon className="w-3 h-3 mr-1" />
                {tab.label}
              </Button>
            ))}
          </div>
        </motion.div>

        {/* CENTERED SCANNER BUTTON - Hero Section */}
        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 20 }}
          className="relative py-4 flex justify-center"
        >
          {/* Animated Rings */}
          <motion.div
            animate={{ 
              scale: [1, 1.5, 1],
              opacity: [0.3, 0, 0.3],
            }}
            transition={{ duration: 3, repeat: Infinity }}
            className="absolute inset-0 bg-blue-500 rounded-full blur-3xl"
          />
          <motion.div
            animate={{ 
              scale: [1, 1.3, 1],
              opacity: [0.2, 0, 0.2],
            }}
            transition={{ duration: 2.5, repeat: Infinity, delay: 0.5 }}
            className="absolute inset-0 bg-purple-500 rounded-full blur-3xl"
          />
          
          {/* Main Scanner Button */}
          <motion.button
            onClick={scanMarket}
            disabled={isScanning}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
            className="relative group"
          >
            {/* Outer Glow */}
            <motion.div
              animate={{ 
                boxShadow: [
                  '0 0 20px rgba(59,130,246,0.5)',
                  '0 0 40px rgba(139,92,246,0.5)',
                  '0 0 20px rgba(59,130,246,0.5)',
                ]
              }}
              transition={{ duration: 2, repeat: Infinity }}
              className="absolute inset-0 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full blur-xl"
            />
            
            {/* Button Content */}
            <div className={`relative flex items-center gap-3 px-8 py-4 bg-slate-900 rounded-full border-2 border-transparent bg-gradient-to-r from-blue-500 to-purple-500 bg-clip-border ${
              isScanning ? 'animate-pulse' : ''
            }`}>
              {isScanning ? (
                <>
                  <Loader2 className="w-6 h-6 text-white animate-spin" />
                  <span className="text-white font-bold text-lg">SCANNING MARKETS...</span>
                  <span className="text-white/80 text-sm ml-2">{Math.round(scanProgress)}%</span>
                </>
              ) : (
                <>
                  <Scan className="w-6 h-6 text-white" />
                  <span className="text-white font-bold text-lg">START MARKET SCAN</span>
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
                  >
                    <RefreshCw className="w-5 h-5 text-white/80" />
                  </motion.div>
                </>
              )}
            </div>

            {/* Particle Effects */}
            {!isScanning && (
              <>
                {[...Array(8)].map((_, i) => (
                  <motion.div
                    key={i}
                    className="absolute w-1 h-1 bg-blue-400 rounded-full"
                    initial={{ 
                      x: 0, 
                      y: 0,
                      opacity: 0 
                    }}
                    animate={{ 
                      x: Math.cos(i * 45 * Math.PI / 180) * 100,
                      y: Math.sin(i * 45 * Math.PI / 180) * 100,
                      opacity: [0, 1, 0],
                    }}
                    transition={{ 
                      duration: 2,
                      repeat: Infinity,
                      delay: i * 0.25,
                      ease: "easeOut"
                    }}
                  />
                ))}
              </>
            )}
          </motion.button>

          {/* Progress Bar */}
          {isScanning && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: '100%', opacity: 1 }}
              className="absolute bottom-0 left-0 right-0 h-1 bg-slate-800 rounded-full overflow-hidden"
            >
              <motion.div
                className="h-full bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500"
                initial={{ width: 0 }}
                animate={{ width: `${scanProgress}%` }}
                transition={{ duration: 0.1 }}
              />
            </motion.div>
          )}
        </motion.div>

        {/* Market Selector - Below Scanner */}
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="flex justify-center"
        >
          <div className="bg-slate-900/50 backdrop-blur rounded-full p-1 border border-indigo-500/20 inline-flex items-center gap-1">
            <Select value={selectedMarketForScan} onValueChange={setSelectedMarketForScan}>
              <SelectTrigger className="w-[140px] h-7 bg-transparent border-0 text-indigo-400 text-xs">
                <SelectValue placeholder="Select market" />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-indigo-500/30">
                {VOLATILITY_MARKETS.map(market => {
                  const display = getMarketDisplay(market);
                  return (
                    <SelectItem key={market} value={market} className="text-xs">
                      <span className={display.color}>{display.icon} {display.name}</span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            <Badge variant="outline" className="border-indigo-500/30 text-indigo-400 text-[8px]">
              {tickCount} ticks
            </Badge>
          </div>
        </motion.div>

        {/* Settings Toggle */}
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="flex justify-center"
        >
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowSettings(!showSettings)}
            className="h-7 text-xs border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/20 rounded-full px-4"
          >
            {showSettings ? <ChevronUp className="w-3 h-3 mr-1" /> : <ChevronDown className="w-3 h-3 mr-1" />}
            {showSettings ? 'Hide Settings' : 'Configure Trading Parameters'}
          </Button>
        </motion.div>

        {/* Settings Panel */}
        <AnimatePresence>
          {showSettings && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="bg-slate-900/80 backdrop-blur-xl rounded-2xl border border-indigo-500/20 p-3">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { label: 'Stake ($)', value: globalStake, setter: setGlobalStake, step: '0.1', min: '0.1', icon: DollarSign, color: 'from-blue-500 to-indigo-500' },
                    { label: 'Multiplier', value: globalMultiplier, setter: setGlobalMultiplier, step: '0.1', min: '1.1', icon: TrendingUp, color: 'from-purple-500 to-pink-500' },
                    { label: 'Stop Loss', value: globalStopLoss, setter: setGlobalStopLoss, step: '1', min: '1', icon: XCircle, color: 'from-rose-500 to-red-500' },
                    { label: 'Take Profit', value: globalTakeProfit, setter: setGlobalTakeProfit, step: '1', min: '1', icon: CheckCircle2, color: 'from-emerald-500 to-teal-500' },
                  ].map((setting, i) => (
                    <motion.div
                      key={i}
                      whileHover={{ scale: 1.02 }}
                      className="bg-slate-800/50 backdrop-blur rounded-xl p-2 border border-indigo-500/10"
                    >
                      <div className="flex items-center gap-1 mb-1">
                        <div className={`w-5 h-5 rounded-full bg-gradient-to-r ${setting.color} flex items-center justify-center`}>
                          <setting.icon className="w-3 h-3 text-white" />
                        </div>
                        <span className="text-[10px] text-slate-400">{setting.label}</span>
                      </div>
                      <input
                        type="number"
                        value={setting.value}
                        onChange={(e) => setting.setter(parseFloat(e.target.value) || 0.5)}
                        className="w-full bg-slate-900 border border-indigo-500/30 rounded-lg px-2 py-1 text-xs text-indigo-400 focus:outline-none focus:border-indigo-400"
                        step={setting.step}
                        min={setting.min}
                      />
                    </motion.div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Main Content - Bots Grid (Desktop) / Active Tab (Mobile) */}
        <div className="hidden sm:block">
          {/* Desktop Bots Grid */}
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="grid grid-cols-2 lg:grid-cols-3 gap-2"
          >
            {bots.map((bot, index) => (
              <BotCard
                key={bot.id}
                bot={bot}
                marketData={bot.selectedMarket ? marketAnalysis[bot.selectedMarket] : null}
                marketSignal={bot.selectedMarket && marketSignals[bot.selectedMarket]?.[bot.type] || false}
                isAuthorized={isAuthorized}
                balance={balance}
                globalStake={globalStake}
                activeTradeId={activeTradeId}
                onStart={startBot}
                onPause={pauseBot}
                onStop={stopBot}
                getMarketDisplay={getMarketDisplay}
                index={index}
              />
            ))}
          </motion.div>
        </div>

        <div className="sm:hidden">
          {/* Mobile Tab Content */}
          <AnimatePresence mode="wait">
            {activeTab === 'bots' && (
              <motion.div
                key="bots"
                initial={{ x: -20, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: 20, opacity: 0 }}
                className="space-y-2"
              >
                {bots.map((bot, index) => (
                  <BotCard
                    key={bot.id}
                    bot={bot}
                    marketData={bot.selectedMarket ? marketAnalysis[bot.selectedMarket] : null}
                    marketSignal={bot.selectedMarket && marketSignals[bot.selectedMarket]?.[bot.type] || false}
                    isAuthorized={isAuthorized}
                    balance={balance}
                    globalStake={globalStake}
                    activeTradeId={activeTradeId}
                    onStart={startBot}
                    onPause={pauseBot}
                    onStop={stopBot}
                    getMarketDisplay={getMarketDisplay}
                    index={index}
                    compact
                  />
                ))}
              </motion.div>
            )}

            {activeTab === 'signals' && (
              <motion.div
                key="signals"
                initial={{ x: -20, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: 20, opacity: 0 }}
              >
                <SignalsPanel marketSignals={marketSignals} getMarketDisplay={getMarketDisplay} />
              </motion.div>
            )}

            {activeTab === 'trades' && (
              <motion.div
                key="trades"
                initial={{ x: -20, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: 20, opacity: 0 }}
              >
                <TradeLog trades={trades} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Desktop Signals and Trade Log */}
        <div className="hidden sm:grid sm:grid-cols-2 gap-2 mt-2">
          <SignalsPanel marketSignals={marketSignals} getMarketDisplay={getMarketDisplay} />
          <TradeLog trades={trades} />
        </div>
      </div>

      {/* Add animation keyframes */}
      <style jsx>{`
        @keyframes blob {
          0% { transform: translate(0px, 0px) scale(1); }
          33% { transform: translate(30px, -50px) scale(1.1); }
          66% { transform: translate(-20px, 20px) scale(0.9); }
          100% { transform: translate(0px, 0px) scale(1); }
        }
        .animate-blob {
          animation: blob 7s infinite;
        }
        .animation-delay-2000 {
          animation-delay: 2s;
        }
        .animation-delay-4000 {
          animation-delay: 4s;
        }
      `}</style>
    </div>
  );
}

// Extracted Bot Card Component
function BotCard({ bot, marketData, marketSignal, isAuthorized, balance, globalStake, activeTradeId, onStart, onPause, onStop, getMarketDisplay, index, compact = false }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      whileHover={{ scale: 1.02 }}
      className={`bg-slate-900/80 backdrop-blur-xl border rounded-xl p-2 shadow-lg ${
        bot.isRunning 
          ? 'border-emerald-500/50 ring-2 ring-emerald-500/20' 
          : bot.signal 
            ? 'border-amber-500/50 ring-2 ring-amber-500/20'
            : 'border-indigo-500/20'
      }`}
    >
      {/* Bot Header */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1">
          <div className={`p-1 rounded-lg bg-gradient-to-br ${
            bot.type.includes('over') ? 'from-blue-500 to-indigo-500' :
            bot.type.includes('under') ? 'from-orange-500 to-red-500' :
            bot.type === 'even' ? 'from-emerald-500 to-teal-500' :
            'from-purple-500 to-pink-500'
          }`}>
            {bot.type.includes('over') ? <TrendingUp className="w-3 h-3 text-white" /> :
             bot.type.includes('under') ? <TrendingDown className="w-3 h-3 text-white" /> :
             <CircleDot className="w-3 h-3 text-white" />}
          </div>
          <div>
            <h4 className={`font-bold ${compact ? 'text-[10px]' : 'text-xs'} text-white`}>
              {bot.name}
            </h4>
            <p className="text-[7px] text-slate-400">
              {bot.contractType}{bot.barrier ? ` | B${bot.barrier}` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {bot.signal && (
            <Badge className="bg-amber-500/20 text-amber-400 text-[6px] px-1 border-amber-500/30">
              SIGNAL
            </Badge>
          )}
          <div className={`w-2 h-2 rounded-full ${
            bot.isRunning ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'
          }`} />
        </div>
      </div>

      {/* Market Info */}
      <div className="bg-slate-800/50 rounded-lg p-1 mb-1">
        <div className="flex items-center justify-between text-[8px]">
          <span className="text-slate-400">Market:</span>
          {bot.selectedMarket ? (
            <span className={`font-mono font-bold ${getMarketDisplay(bot.selectedMarket).color}`}>
              {getMarketDisplay(bot.selectedMarket).icon} {bot.selectedMarket}
            </span>
          ) : (
            <span className="text-slate-500">—</span>
          )}
        </div>
        {marketData && (
          <div className="flex items-center justify-between text-[7px] mt-0.5">
            <span className="text-slate-400">Last: {marketData.lastDigit}</span>
            <span className="text-slate-400">Prev: {marketData.previousDigit}</span>
            <span className={marketSignal ? 'text-amber-400' : 'text-slate-500'}>
              Signal: {marketSignal ? '✅' : '❌'}
            </span>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-0.5 text-[8px] mb-1">
        <div>
          <span className="text-slate-400">P&L:</span>
          <span className={`ml-0.5 font-mono ${
            bot.totalPnl > 0 ? 'text-emerald-400' : 
            bot.totalPnl < 0 ? 'text-rose-400' : 'text-slate-400'
          }`}>
            ${bot.totalPnl.toFixed(2)}
          </span>
        </div>
        <div>
          <span className="text-slate-400">W:</span>
          <span className="ml-0.5 font-mono text-emerald-400">{bot.wins}</span>
        </div>
        <div>
          <span className="text-slate-400">L:</span>
          <span className="ml-0.5 font-mono text-rose-400">{bot.losses}</span>
        </div>
      </div>

      {/* Status */}
      <div className="flex items-center justify-between text-[7px] mb-1">
        <span className="text-slate-400">Status:</span>
        <span className={`font-mono ${
          bot.status === 'trading' ? 'text-emerald-400' :
          bot.status === 'waiting' ? 'text-amber-400' :
          bot.status === 'cooldown' ? 'text-purple-400' :
          'text-slate-500'
        }`}>
          {bot.status === 'trading' ? '📈 Trading' :
           bot.status === 'waiting' ? '⏳ Waiting' :
           bot.status === 'cooldown' ? `⏱️ Cooldown ${bot.cooldownRemaining}` :
           '⚫ Idle'}
        </span>
        <span className="text-slate-400">Stake:</span>
        <span className="font-mono text-emerald-400">${bot.currentStake.toFixed(2)}</span>
      </div>

      {/* Controls */}
      <div className="flex gap-1">
        {!bot.isRunning ? (
          <Button
            onClick={() => onStart(bot.id)}
            disabled={!isAuthorized || balance < globalStake || activeTradeId !== null || !bot.selectedMarket}
            size="sm"
            className={`flex-1 h-6 ${compact ? 'text-[8px]' : 'text-[9px]'} bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 text-white border-0`}
          >
            <Play className="w-2 h-2 mr-0.5" /> Start
          </Button>
        ) : (
          <>
            <Button
              onClick={() => onPause(bot.id)}
              size="sm"
              variant="outline"
              className={`flex-1 h-6 ${compact ? 'text-[8px]' : 'text-[9px]'} border-amber-500/30 text-amber-400 hover:bg-amber-500/20`}
            >
              <Pause className="w-2 h-2 mr-0.5" /> {bot.isPaused ? 'Res' : 'Pau'}
            </Button>
            <Button
              onClick={() => onStop(bot.id)}
              size="sm"
              className={`flex-1 h-6 ${compact ? 'text-[8px]' : 'text-[9px]'} bg-gradient-to-r from-rose-500 to-red-500 hover:from-rose-600 hover:to-red-600 text-white border-0`}
            >
              <StopCircle className="w-2 h-2 mr-0.5" /> Stop
            </Button>
          </>
        )}
      </div>
    </motion.div>
  );
}

// Signals Panel Component
function SignalsPanel({ marketSignals, getMarketDisplay }) {
  const activeMarkets = Object.entries(marketSignals).filter(([_, signals]) => 
    Object.values(signals).some(v => v)
  );

  return (
    <motion.div
      initial={{ y: 20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="bg-slate-900/80 backdrop-blur-xl border border-indigo-500/20 rounded-xl p-2"
    >
      <h3 className="text-xs font-semibold mb-1 text-indigo-400 flex items-center gap-1">
        <Sparkles className="w-3 h-3 text-amber-400" />
        Live Signals
        <Badge className="ml-1 bg-amber-500/20 text-amber-400 text-[8px] border-amber-500/30">
          {activeMarkets.length} active
        </Badge>
      </h3>
      
      <div className="space-y-1 max-h-[200px] overflow-y-auto">
        {activeMarkets.length === 0 ? (
          <p className="text-[10px] text-slate-400 text-center py-4">
            <Scan className="w-4 h-4 mx-auto mb-1 opacity-50" />
            No active signals
          </p>
        ) : (
          activeMarkets.map(([market, signals]) => {
            const display = getMarketDisplay(market);
            return (
              <motion.div
                key={market}
                initial={{ x: -10, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                className="bg-slate-800/50 rounded-lg p-1 border border-indigo-500/10"
              >
                <div className="flex items-center justify-between mb-0.5">
                  <span className={`text-[9px] font-bold ${display.color}`}>
                    {display.icon} {market}
                  </span>
                  <Badge className="bg-amber-500/20 text-amber-400 text-[6px] px-1 border-amber-500/30">
                    SIGNAL
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-0.5">
                  {signals.over3 && <SignalBadge type="OVER 3" color="blue" />}
                  {signals.under6 && <SignalBadge type="UNDER 6" color="orange" />}
                  {signals.over1 && <SignalBadge type="OVER 1" color="blue" />}
                  {signals.under8 && <SignalBadge type="UNDER 8" color="orange" />}
                  {signals.even && <SignalBadge type="EVEN" color="emerald" />}
                  {signals.odd && <SignalBadge type="ODD" color="purple" />}
                </div>
              </motion.div>
            );
          })
        )}
      </div>
    </motion.div>
  );
}

// Signal Badge Component
function SignalBadge({ type, color }) {
  const colorClasses = {
    blue: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    orange: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    emerald: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    purple: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  };

  return (
    <Badge className={`${colorClasses[color]} text-[6px] px-1 py-0`}>
      {type}
    </Badge>
  );
}

// Trade Log Component
function TradeLog({ trades }) {
  return (
    <motion.div
      initial={{ y: 20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="bg-slate-900/80 backdrop-blur-xl border border-indigo-500/20 rounded-xl p-2"
    >
      <h3 className="text-xs font-semibold mb-1 text-indigo-400 flex items-center gap-1">
        <BarChart3 className="w-3 h-3" />
        Trade History
        <Badge className="ml-1 bg-indigo-500/20 text-indigo-400 text-[8px] border-indigo-500/30">
          {trades.length} trades
        </Badge>
      </h3>

      <div className="space-y-1 max-h-[200px] overflow-y-auto">
        {trades.length === 0 ? (
          <p className="text-[10px] text-slate-400 text-center py-4">
            <Clock className="w-4 h-4 mx-auto mb-1 opacity-50" />
            No trades yet
          </p>
        ) : (
          trades.map((trade, idx) => (
            <motion.div
              key={idx}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.01 }}
              className="flex items-center justify-between text-[8px] py-1 border-b border-indigo-500/10 last:border-0"
            >
              <div className="flex items-center gap-1 min-w-0 flex-1">
                <span className="text-slate-400">{trade.time.slice(-5)}</span>
                <Badge variant="outline" className="text-[6px] px-1 py-0 border-indigo-500/30 text-indigo-400">
                  {trade.bot.slice(0,3)}
                </Badge>
                <span className="font-mono truncate text-slate-300">
                  {trade.market.slice(-4)}
                </span>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <span className="font-mono text-slate-400">${trade.stake.toFixed(2)}</span>
                <span className={`font-mono w-12 text-right ${
                  trade.result === 'Win' ? 'text-emerald-400' : 
                  trade.result === 'Loss' ? 'text-rose-400' : 'text-amber-400'
                }`}>
                  {trade.result === 'Win' ? `+$${trade.pnl.toFixed(2)}` : 
                   trade.result === 'Loss' ? `-$${Math.abs(trade.pnl).toFixed(2)}` : 
                   '⏳'}
                </span>
              </div>
            </motion.div>
          ))
        )}
      </div>
    </motion.div>
  );
}
