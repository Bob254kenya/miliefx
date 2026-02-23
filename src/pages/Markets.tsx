import { useState } from 'react';
import { motion } from 'framer-motion';
import { MARKETS, type MarketSymbol } from '@/services/deriv-api';
import { useMarketTicks } from '@/hooks/useMarketTicks';
import DigitHeatmap from '@/components/DigitHeatmap';
import { getLastDigit } from '@/services/analysis';

function MarketCard({ symbol, name }: { symbol: MarketSymbol; name: string }) {
  const { prices, lastPrice, lastDigit, isSubscribed } = useMarketTicks(symbol, 50);
  
  const prevPrice = prices.length > 1 ? prices[prices.length - 2] : lastPrice;
  const isUp = lastPrice >= prevPrice;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card border border-border rounded-xl p-4 hover:border-primary/30 transition-all"
    >
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-medium text-foreground text-sm">{name}</h3>
          <span className="text-xs text-muted-foreground font-mono">{symbol}</span>
        </div>
        <div className="flex items-center gap-1">
          <div className={`w-2 h-2 rounded-full ${isSubscribed ? 'bg-profit animate-pulse-glow' : 'bg-muted-foreground'}`} />
        </div>
      </div>

      <div className={`font-mono text-xl font-bold mb-1 ${isUp ? 'text-profit' : 'text-loss'}`}>
        {lastPrice.toFixed(4)}
      </div>
      
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs text-muted-foreground">Last digit:</span>
        <span className={`font-mono text-sm font-bold px-2 py-0.5 rounded ${
          lastDigit >= 5 ? 'bg-profit/10 text-profit' : 'bg-loss/10 text-loss'
        }`}>
          {lastDigit}
        </span>
      </div>

      {prices.length > 5 && <DigitHeatmap prices={prices} lastDigit={lastDigit} />}
    </motion.div>
  );
}

export default function Markets() {
  const [selectedGroup, setSelectedGroup] = useState<string>('all');
  const groups = ['all', ...new Set(MARKETS.map(m => m.group))];

  const filtered = selectedGroup === 'all' 
    ? MARKETS 
    : MARKETS.filter(m => m.group === selectedGroup);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Markets</h1>
        <p className="text-sm text-muted-foreground">Live digit analysis across all markets</p>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2 flex-wrap">
        {groups.map(g => (
          <button
            key={g}
            onClick={() => setSelectedGroup(g)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
              selectedGroup === g
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            {g === 'all' ? 'All' : g}
          </button>
        ))}
      </div>

      {/* Market Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filtered.map(market => (
          <MarketCard key={market.symbol} symbol={market.symbol} name={market.name} />
        ))}
      </div>
    </div>
  );
}
