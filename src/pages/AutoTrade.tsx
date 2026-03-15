import { useState, useRef, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { derivApi } from '@/services/deriv-api';
import { useAuth } from '@/contexts/AuthContext';
import { useTickLoader } from '@/hooks/useTickLoader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Play, StopCircle, Pause, TrendingUp, TrendingDown, CircleDot, RefreshCw, Trash2, DollarSign, Sparkles, ChevronDown, ChevronUp } from 'lucide-react';

// ... (keep all interfaces and helper functions the same as before)

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
  
  const [trades, setTrades] = useState<TradeLog[]>([]);
  const tradeIdRef = useRef(0);
  const marketDigitsRef = useRef<Record<string, number[]>>({});
  const scanTimeoutRef = useRef<NodeJS.Timeout>();

  const { digits, prices, isLoading, tickCount } = useTickLoader(selectedMarketForScan, 1000);

  // ... (keep all useEffect and other hooks the same)

  // Keep all the existing functions (scanMarket, runBot, etc.) exactly as they are

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      {/* Animated Background - Reduced for mobile */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden opacity-30">
        {[...Array(20)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute text-green-500/10"
            initial={{
              x: Math.random() * window.innerWidth,
              y: Math.random() * window.innerHeight,
              rotate: Math.random() * 360,
              scale: Math.random() * 0.3 + 0.2,
            }}
            animate={{
              y: [null, -100, window.innerHeight + 100],
              rotate: [null, Math.random() * 720, Math.random() * 360],
              opacity: [0.05, 0.15, 0.05],
            }}
            transition={{
              duration: Math.random() * 20 + 10,
              repeat: Infinity,
              ease: "linear",
              delay: Math.random() * 10,
            }}
          >
            <DollarSign className="w-8 h-8" />
          </motion.div>
        ))}
      </div>

      {/* Main Content - Mobile Optimized */}
      <div className="relative z-10 space-y-3 p-2 sm:p-3 max-w-full overflow-x-hidden">
        {/* Header with totals - Mobile Optimized */}
        <motion.div 
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="bg-black/40 backdrop-blur-xl border border-green-500/20 rounded-xl p-2 sm:p-3 shadow-2xl shadow-green-500/5"
        >
          {/* Top Bar - Mobile Optimized */}
          <div className="flex flex-col gap-2 mb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1 min-w-0">
                <motion.div
                  animate={{ rotate: [0, 360] }}
                  transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
                  className="flex-shrink-0"
                >
                  <DollarSign className="w-5 h-5 sm:w-6 sm:h-6 text-green-400" />
                </motion.div>
                <h1 className="text-sm sm:text-base font-bold bg-gradient-to-r from-green-400 to-yellow-400 bg-clip-text text-transparent truncate">
                  6-Bot System
                </h1>
              </div>
              
              <div className="flex items-center gap-1 flex-shrink-0">
                {/* Scan Button - Mobile Optimized */}
                <motion.div
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className="relative flex items-center cursor-pointer"
                  onClick={scanMarket}
                >
                  <motion.div
                    animate={isScanning ? {
                      rotate: 360,
                      scale: [1, 1.2, 1],
                    } : {}}
                    transition={isScanning ? {
                      rotate: { duration: 2, repeat: Infinity, ease: "linear" },
                      scale: { duration: 1, repeat: Infinity, ease: "easeInOut" }
                    } : {}}
                  >
                    <DollarSign className={`w-5 h-5 sm:w-6 sm:h-6 ${isScanning ? 'text-yellow-400' : 'text-green-400'}`} />
                  </motion.div>
                  {isScanning && (
                    <div className="absolute -top-1 -right-1">
                      <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-yellow-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-yellow-500"></span>
                    </div>
                  )}
                </motion.div>
                
                {/* Market Select - Mobile Optimized */}
                <Select value={selectedMarketForScan} onValueChange={setSelectedMarketForScan}>
                  <SelectTrigger className="w-[100px] sm:w-[140px] h-7 text-xs bg-black/50 border-green-500/30 text-green-400">
                    <SelectValue placeholder="Market" />
                  </SelectTrigger>
                  <SelectContent className="bg-black/90 border-green-500/30 max-h-[300px]">
                    {VOLATILITY_MARKETS.map(market => (
                      <SelectItem key={market} value={market} className="text-xs text-green-400 hover:bg-green-500/20">
                        {market}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                
                {/* Action Buttons - Mobile Optimized */}
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={scanMarket}
                  disabled={isScanning}
                  className="h-7 px-2 border-green-500/30 text-green-400 hover:bg-green-500/20"
                >
                  {isScanning ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                  <span className="hidden xs:inline ml-1 text-xs">Scan</span>
                </Button>
                
                <Button 
                  variant="destructive" 
                  size="sm" 
                  onClick={clearAll}
                  className="h-7 w-7 p-0 bg-red-500/20 hover:bg-red-500/30 border-red-500/30"
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
                
                <Button 
                  variant="destructive" 
                  size="sm" 
                  onClick={stopAllBots} 
                  disabled={!bots.some(b => b.isRunning)}
                  className="h-7 w-7 p-0 bg-red-500/20 hover:bg-red-500/30 border-red-500/30"
                >
                  <StopCircle className="w-3 h-3" />
                </Button>
              </div>
            </div>

            {/* Scan Progress Bar */}
            {isScanning && (
              <motion.div 
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-full"
              >
                <div className="flex justify-between text-[8px] sm:text-xs text-green-400 mb-0.5">
                  <span>Scanning...</span>
                  <span>{Math.round(scanProgress)}%</span>
                </div>
                <div className="w-full h-1 bg-black/50 rounded-full overflow-hidden border border-green-500/30">
                  <motion.div 
                    className="h-full bg-gradient-to-r from-green-400 via-yellow-400 to-green-400"
                    initial={{ width: 0 }}
                    animate={{ width: `${scanProgress}%` }}
                    transition={{ duration: 0.1 }}
                  />
                </div>
              </motion.div>
            )}
          </div>

          {/* Global Stats - Mobile Optimized Grid */}
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-1 sm:gap-2 mb-2">
            {[
              { label: 'Bal', value: `$${balance?.toFixed(2) || '0.00'}`, color: 'text-green-400' },
              { label: 'P&L', value: `$${totalProfit.toFixed(2)}`, color: totalProfit >= 0 ? 'text-green-400' : 'text-red-400' },
              { label: 'WR', value: `${winRate}%`, color: 'text-yellow-400' },
              { label: 'Trades', value: totalTrades.toString(), color: 'text-blue-400' },
              { label: 'Active', value: `${bots.filter(b => b.isRunning).length}/6`, color: 'text-purple-400' },
              { label: 'Signals', value: activeSignals.toString(), color: 'text-yellow-400' },
            ].map((stat, i) => (
              <motion.div
                key={i}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: i * 0.05 }}
                className="bg-black/40 backdrop-blur border border-green-500/20 rounded-lg p-1 text-center"
              >
                <div className="text-[8px] sm:text-xs text-green-400/60">{stat.label}</div>
                <div className={`font-bold text-[10px] sm:text-sm truncate ${stat.color}`}>{stat.value}</div>
              </motion.div>
            ))}
          </div>

          {/* Settings Toggle - Mobile */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowSettings(!showSettings)}
            className="w-full h-7 mb-2 text-xs border-green-500/30 text-green-400 hover:bg-green-500/20"
          >
            {showSettings ? <ChevronUp className="w-3 h-3 mr-1" /> : <ChevronDown className="w-3 h-3 mr-1" />}
            {showSettings ? 'Hide Settings' : 'Show Settings'}
          </Button>

          {/* Settings - Collapsible */}
          {showSettings && (
            <motion.div 
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="grid grid-cols-2 sm:grid-cols-4 gap-1 sm:gap-2 mb-1"
            >
              {[
                { label: 'Stake', value: globalStake, setter: setGlobalStake, step: '0.1', min: '0.1' },
                { label: 'Multi', value: globalMultiplier, setter: setGlobalMultiplier, step: '0.1', min: '1.1' },
                { label: 'Stop', value: globalStopLoss, setter: setGlobalStopLoss, step: '1', min: '1' },
                { label: 'Profit', value: globalTakeProfit, setter: setGlobalTakeProfit, step: '1', min: '1' },
              ].map((setting, i) => (
                <div key={i} className="bg-black/40 backdrop-blur border border-green-500/20 rounded-lg p-1">
                  <label className="text-[8px] sm:text-xs text-green-400/60 block">{setting.label}</label>
                  <input 
                    type="number" 
                    value={setting.value} 
                    onChange={(e) => setting.setter(parseFloat(e.target.value) || 0.5)}
                    className="w-full bg-black/50 border border-green-500/30 rounded px-1 py-0.5 text-[10px] sm:text-xs text-green-400 focus:outline-none focus:border-green-400"
                    step={setting.step}
                    min={setting.min}
                  />
                </div>
              ))}
            </motion.div>
          )}
        </motion.div>

        {/* Bots Grid - Mobile Optimized */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {bots.map((bot, index) => {
            const marketData = bot.selectedMarket ? marketAnalysis[bot.selectedMarket] : null;
            const marketSignal = bot.selectedMarket && marketSignals[bot.selectedMarket] 
              ? marketSignals[bot.selectedMarket][bot.type] 
              : false;
            
            return (
              <motion.div
                key={bot.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.05 }}
                className={`bg-black/40 backdrop-blur-xl border rounded-lg p-2 shadow-lg ${
                  bot.isRunning ? 'border-green-400 ring-1 ring-green-400/20' : 'border-green-500/20'
                } ${bot.signal ? 'ring-2 ring-yellow-500/30' : ''}`}
              >
                {/* Header */}
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1 min-w-0">
                    <motion.div
                      animate={bot.isRunning ? { rotate: 360 } : {}}
                      transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                      className={`p-1 rounded-lg flex-shrink-0 ${
                        bot.type.includes('over') ? 'bg-blue-500/20 text-blue-400' :
                        bot.type.includes('under') ? 'bg-orange-500/20 text-orange-400' :
                        bot.type === 'even' ? 'bg-green-500/20 text-green-400' :
                        'bg-purple-500/20 text-purple-400'
                      }`}
                    >
                      {bot.type.includes('over') ? <TrendingUp className="w-3 h-3" /> :
                       bot.type.includes('under') ? <TrendingDown className="w-3 h-3" /> :
                       <CircleDot className="w-3 h-3" />}
                    </motion.div>
                    <div className="min-w-0">
                      <h4 className="font-bold text-[10px] sm:text-xs text-green-400 truncate">{bot.name}</h4>
                      <p className="text-[7px] sm:text-[8px] text-green-400/60 truncate">
                        {bot.contractType}{bot.barrier ? `|B${bot.barrier}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {bot.signal && (
                      <Badge variant="default" className="bg-yellow-500/20 text-yellow-400 text-[6px] px-1 py-0 border-yellow-500/30">
                        SIG
                      </Badge>
                    )}
                    <Badge variant={bot.isRunning ? "default" : "secondary"} className={`text-[7px] px-1 ${
                      bot.isRunning ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'
                    }`}>
                      {bot.isRunning ? (bot.isPaused ? '⏸️' : '▶️') : '⏹️'}
                    </Badge>
                  </div>
                </div>

                {/* Market & Analysis - Mobile Optimized */}
                <div className="bg-black/40 backdrop-blur border border-green-500/20 rounded p-1 mb-1 text-[8px] sm:text-[9px]">
                  <div className="flex justify-between items-center">
                    <span className="text-green-400/60">Market:</span>
                    <span className="font-mono font-bold text-green-400 truncate ml-1">
                      {bot.selectedMarket ? bot.selectedMarket : '—'}
                    </span>
                  </div>
                  {marketData && (
                    <>
                      <div className="flex justify-between mt-0.5 text-green-400/80">
                        <span>M:{marketData.mostAppearing}</span>
                        <span>2:{marketData.secondMost}</span>
                        <span>L:{marketData.leastAppearing}</span>
                      </div>
                      <div className="flex justify-between mt-0.5 text-[7px]">
                        <span className="text-green-400/60">L:{marketData.lastDigit}</span>
                        <span className="text-green-400/60">P:{marketData.previousDigit}</span>
                        <span className={marketSignal ? 'text-yellow-400' : 'text-green-400/60'}>
                          Sig:{marketSignal ? '✅' : '❌'}
                        </span>
                      </div>
                    </>
                  )}
                </div>

                {/* Stats - Mobile Optimized */}
                <div className="grid grid-cols-3 gap-0.5 text-[8px] sm:text-[9px] mb-1">
                  <div className="truncate">
                    <span className="text-green-400/60">P&L:</span>
                    <span className={`ml-0.5 font-mono ${
                      bot.totalPnl > 0 ? 'text-green-400' : bot.totalPnl < 0 ? 'text-red-400' : 'text-yellow-400'
                    }`}>
                      ${bot.totalPnl.toFixed(2)}
                    </span>
                  </div>
                  <div className="truncate">
                    <span className="text-green-400/60">W:</span>
                    <span className="ml-0.5 font-mono text-green-400">{bot.wins}</span>
                  </div>
                  <div className="truncate">
                    <span className="text-green-400/60">L:</span>
                    <span className="ml-0.5 font-mono text-red-400">{bot.losses}</span>
                  </div>
                </div>

                {/* Status & Controls - Mobile Optimized */}
                <div className="flex items-center justify-between text-[7px] sm:text-[8px] mb-1">
                  <span className="text-green-400/60">Status:</span>
                  <span className={`font-mono ${
                    bot.status === 'trading' ? 'text-green-400' :
                    bot.status === 'waiting' ? 'text-yellow-400' :
                    bot.status === 'cooldown' ? 'text-purple-400' :
                    'text-gray-400'
                  }`}>
                    {bot.status === 'trading' ? '📈' :
                     bot.status === 'waiting' ? '⏳' :
                     bot.status === 'cooldown' ? `⏱️${bot.cooldownRemaining}` :
                     '⚫'}
                  </span>
                  <span className="text-green-400/60">Stake:</span>
                  <span className="font-mono text-green-400">${bot.currentStake.toFixed(2)}</span>
                </div>

                {/* Controls - Mobile Optimized */}
                <div className="flex gap-1">
                  {!bot.isRunning ? (
                    <Button
                      onClick={() => startBot(bot.id)}
                      disabled={!isAuthorized || balance < globalStake || activeTradeId !== null || !bot.selectedMarket}
                      size="sm"
                      className="flex-1 h-6 text-[9px] px-1 bg-green-500/20 hover:bg-green-500/30 text-green-400 border border-green-500/30"
                    >
                      <Play className="w-2 h-2 mr-0.5" /> Start
                    </Button>
                  ) : (
                    <>
                      <Button
                        onClick={() => pauseBot(bot.id)}
                        size="sm"
                        variant="outline"
                        className="flex-1 h-6 text-[9px] px-1 border-green-500/30 text-green-400 hover:bg-green-500/20"
                      >
                        <Pause className="w-2 h-2 mr-0.5" /> {bot.isPaused ? 'Res' : 'Pau'}
                      </Button>
                      <Button
                        onClick={() => stopBot(bot.id)}
                        size="sm"
                        variant="destructive"
                        className="flex-1 h-6 text-[9px] px-1 bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30"
                      >
                        <StopCircle className="w-2 h-2 mr-0.5" /> Stop
                      </Button>
                    </>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Signals Toggle - Mobile */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowSignals(!showSignals)}
          className="w-full h-7 text-xs border-green-500/30 text-green-400 hover:bg-green-500/20"
        >
          <Sparkles className="w-3 h-3 mr-1" />
          {showSignals ? <ChevronUp className="w-3 h-3 ml-1" /> : <ChevronDown className="w-3 h-3 ml-1" />}
          {showSignals ? ' Hide Signals' : ' Show Live Signals'}
        </Button>

        {/* Live Signals Panel - Collapsible */}
        {showSignals && (
          <motion.div 
            initial={{ y: 10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="bg-black/40 backdrop-blur-xl border border-green-500/20 rounded-lg p-2"
          >
            <h3 className="text-xs font-semibold mb-1 text-green-400 flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-yellow-400" />
              📡 Active Signals
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 max-h-[150px] overflow-y-auto">
              {Object.entries(marketSignals).map(([market, signals]) => {
                const hasAnySignal = Object.values(signals).some(v => v);
                if (!hasAnySignal) return null;
                
                return (
                  <motion.div 
                    key={market} 
                    className="bg-black/40 backdrop-blur border border-yellow-500/30 rounded p-1 text-[8px]"
                  >
                    <div className="font-bold mb-0.5 text-yellow-400 truncate">{market}</div>
                    <div className="flex flex-wrap gap-0.5">
                      {signals.over3 && <Badge className="bg-blue-500/20 text-blue-400 text-[6px] px-1 border-blue-500/30">O3</Badge>}
                      {signals.under6 && <Badge className="bg-orange-500/20 text-orange-400 text-[6px] px-1 border-orange-500/30">U6</Badge>}
                      {signals.over1 && <Badge className="bg-blue-500/20 text-blue-400 text-[6px] px-1 border-blue-500/30">O1</Badge>}
                      {signals.under8 && <Badge className="bg-orange-500/20 text-orange-400 text-[6px] px-1 border-orange-500/30">U8</Badge>}
                      {signals.even && <Badge className="bg-green-500/20 text-green-400 text-[6px] px-1 border-green-500/30">E</Badge>}
                      {signals.odd && <Badge className="bg-purple-500/20 text-purple-400 text-[6px] px-1 border-purple-500/30">O</Badge>}
                    </div>
                  </motion.div>
                );
              })}
              {Object.keys(marketSignals).length === 0 && (
                <p className="text-xs text-green-400/60 col-span-3 text-center py-2">
                  🔍 No active signals
                </p>
              )}
            </div>
          </motion.div>
        )}

        {/* Trade Log Toggle - Mobile */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowTradeLog(!showTradeLog)}
          className="w-full h-7 text-xs border-green-500/30 text-green-400 hover:bg-green-500/20"
        >
          📋 Trade Log
          {showTradeLog ? <ChevronUp className="w-3 h-3 ml-1" /> : <ChevronDown className="w-3 h-3 ml-1" />}
        </Button>

        {/* Trade Log - Collapsible */}
        {showTradeLog && (
          <motion.div 
            initial={{ y: 10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="bg-black/40 backdrop-blur-xl border border-green-500/20 rounded-lg p-2"
          >
            <div className="space-y-1 max-h-[200px] overflow-y-auto">
              {trades.length === 0 ? (
                <p className="text-xs text-green-400/60 text-center py-2">No trades yet</p>
              ) : (
                trades.map((trade, idx) => (
                  <motion.div 
                    key={idx} 
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.01 }}
                    className="flex items-center justify-between text-[8px] sm:text-[9px] py-1 border-b border-green-500/10 last:border-0"
                  >
                    <div className="flex items-center gap-1 min-w-0 flex-1">
                      <span className="text-green-400/60 flex-shrink-0">{trade.time.slice(-5)}</span>
                      <Badge variant="outline" className="text-[6px] px-1 py-0 border-green-500/30 text-green-400 flex-shrink-0">
                        {trade.bot.slice(0,3)}
                      </Badge>
                      <span className="font-mono truncate text-green-400">
                        {trade.market.slice(-6)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <span className="font-mono text-green-400">${trade.stake.toFixed(2)}</span>
                      <span className={`font-mono w-12 text-right ${
                        trade.result === 'Win' ? 'text-green-400' : 
                        trade.result === 'Loss' ? 'text-red-400' : 'text-yellow-400'
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
        )}
      </div>
    </div>
  );
}
