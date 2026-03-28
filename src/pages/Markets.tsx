import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MARKETS, MARKET_GROUPS } from '@/services/deriv-api';
import { Input } from '@/components/ui/input';
import VolatilityCard from '@/components/analyzer/VolatilityCard';
import { Sparkles, Filter, TrendingUp, Clock } from 'lucide-react';

export default function Markets() {
  const [selectedGroup, setSelectedGroup] = useState<string>('vol');
  const [tickCount, setTickCount] = useState(1000);
  const [showStrongSignalsOnly, setShowStrongSignalsOnly] = useState(false);
  const [strongSignals, setStrongSignals] = useState<Set<string>>(new Set());

  const groups = ['all', ...MARKET_GROUPS.map(g => g.value)];
  const filtered = selectedGroup === 'all'
    ? MARKETS
    : MARKETS.filter(m => m.group === selectedGroup);

  // Handle strong signals from child components
  const handleStrongSignal = useMemo(() => {
    return (symbol: string, hasSignal: boolean) => {
      setStrongSignals(prev => {
        const newSet = new Set(prev);
        if (hasSignal) {
          newSet.add(symbol);
        } else {
          newSet.delete(symbol);
        }
        return newSet;
      });
    };
  }, []);

  const displayMarkets = showStrongSignalsOnly
    ? filtered.filter(m => strongSignals.has(m.symbol))
    : filtered;

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20">
      <div className="container mx-auto px-3 py-3 max-w-[1600px] space-y-3">
        {/* Header Section */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3"
        >
          <div className="space-y-0.5">
            <div className="flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-primary" />
              <h1 className="text-lg md:text-xl font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
                Live Markets Analyzer
              </h1>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Real-time digit analysis with AI-powered signals
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 bg-muted/50 rounded-md px-2 py-1">
              <Clock className="w-3 h-3 text-muted-foreground" />
              <label className="text-[10px] font-medium">Ticks:</label>
              <Input
                type="number"
                min={50}
                max={1000}
                value={tickCount}
                onChange={(e) => setTickCount(Math.max(50, Math.min(1000, parseInt(e.target.value) || 1000)))}
                className="h-5 w-14 text-[10px] bg-background"
              />
            </div>

            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setShowStrongSignalsOnly(!showStrongSignalsOnly)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium transition-all ${
                showStrongSignalsOnly
                  ? 'bg-gradient-to-r from-green-500 to-emerald-500 text-white shadow-lg'
                  : 'bg-muted hover:bg-muted/80 text-foreground'
              }`}
            >
              <TrendingUp className="w-3 h-3" />
              {showStrongSignalsOnly ? 'Strong Signals' : 'All Markets'}
              {showStrongSignalsOnly && strongSignals.size > 0 && (
                <span className="ml-0.5 px-1 py-0.5 bg-white/20 rounded-full text-[9px]">
                  {strongSignals.size}
                </span>
              )}
            </motion.button>
          </div>
        </motion.div>

        {/* Filter Section */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="space-y-1.5"
        >
          <div className="flex items-center gap-1.5">
            <Filter className="w-3 h-3 text-muted-foreground" />
            <span className="text-[10px] font-medium">Market Groups</span>
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {groups.map((g, idx) => (
              <motion.button
                key={g}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: idx * 0.05 }}
                onClick={() => setSelectedGroup(g)}
                className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-all ${
                  selectedGroup === g
                    ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/25'
                    : 'bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
              >
                {g === 'all' ? 'All Markets' : MARKET_GROUPS.find(mg => mg.value === g)?.label || g}
              </motion.button>
            ))}
          </div>
        </motion.div>

        {/* Markets Grid - 5 columns horizontal */}
        <AnimatePresence mode="wait">
          <motion.div
            key={selectedGroup + (showStrongSignalsOnly ? '-strong' : '-all')}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="grid grid-cols-5 gap-2"
          >
            {displayMarkets.map((market, idx) => (
              <motion.div
                key={market.symbol}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: idx * 0.03 }}
              >
                <VolatilityCard
                  symbol={market.symbol}
                  tickCount={tickCount}
                  mode="over"
                  onStrongSignal={(hasSignal) => handleStrongSignal(market.symbol, hasSignal)}
                />
              </motion.div>
            ))}
          </motion.div>
        </AnimatePresence>

        {/* Empty State */}
        {displayMarkets.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-6"
          >
            <div className="bg-muted/30 rounded-lg p-4">
              <TrendingUp className="w-8 h-8 text-muted-foreground mx-auto mb-1.5" />
              <p className="text-xs text-muted-foreground">No strong signals detected at the moment</p>
              <button
                onClick={() => setShowStrongSignalsOnly(false)}
                className="mt-1.5 text-primary hover:underline text-[10px]"
              >
                View all markets
              </button>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
