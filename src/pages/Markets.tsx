import { useState } from 'react';
import { MARKETS, MARKET_GROUPS } from '@/services/deriv-api';
import { Input } from '@/components/ui/input';
import VolatilityCard from '@/components/analyzer/VolatilityCard';

export default function Markets() {
  const [selectedGroup, setSelectedGroup] = useState<string>('vol');
  const [tickCount, setTickCount] = useState(1000);

  const groups = ['all', ...MARKET_GROUPS.map(g => g.value)];
  const filtered = selectedGroup === 'all'
    ? MARKETS
    : MARKETS.filter(m => m.group === selectedGroup);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">Live Markets</h1>
          <p className="text-xs text-muted-foreground">Live digit analysis across all markets</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-[10px] text-muted-foreground">Ticks:</label>
          <Input
            type="number"
            min={50}
            max={1000}
            value={tickCount}
            onChange={(e) => setTickCount(Math.max(50, Math.min(1000, parseInt(e.target.value) || 1000)))}
            className="h-8 w-24 text-xs"
          />
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {groups.map(g => (
          <button
            key={g}
            onClick={() => setSelectedGroup(g)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              selectedGroup === g
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            {g === 'all' ? 'All' : MARKET_GROUPS.find(mg => mg.value === g)?.label || g}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filtered.map(market => (
          <VolatilityCard
            key={market.symbol}
            symbol={market.symbol}
            tickCount={tickCount}
            mode="over"
          />
        ))}
      </div>
    </div>
  );
}
