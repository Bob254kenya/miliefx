import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { MARKETS, type MarketSymbol } from '@/services/deriv-api';
import { useMarketTicks } from '@/hooks/useMarketTicks';
import DigitHeatmap from '@/components/DigitHeatmap';
import SignalCard from '@/components/SignalCard';
import { calculateRSI, calculateMACD, calculateMA, calculateBollingerBands, generateSignals } from '@/services/analysis';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';

export default function Analyzer() {
  const [selectedMarket, setSelectedMarket] = useState<MarketSymbol>('R_100');
  const [tickCount, setTickCount] = useState(100);
  const { prices, lastDigit } = useMarketTicks(selectedMarket, tickCount);

  const indicators = useMemo(() => {
    if (prices.length < 20) return null;
    return {
      rsi: calculateRSI(prices),
      macd: calculateMACD(prices),
      ma: calculateMA(prices),
      bb: calculateBollingerBands(prices),
    };
  }, [prices]);

  const signals = useMemo(() => {
    if (prices.length < 20) return null;
    return generateSignals(prices);
  }, [prices]);

  const marketName = MARKETS.find(m => m.symbol === selectedMarket)?.name || selectedMarket;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Analyzer</h1>
        <p className="text-sm text-muted-foreground">Deep digit analysis with technical indicators</p>
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="w-full sm:w-64">
          <label className="text-xs text-muted-foreground mb-1 block">Market</label>
          <Select value={selectedMarket} onValueChange={(v) => setSelectedMarket(v as MarketSymbol)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {MARKETS.map(m => (
                <SelectItem key={m.symbol} value={m.symbol}>{m.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-full sm:w-64">
          <label className="text-xs text-muted-foreground mb-1 block">Tick Count: {tickCount}</label>
          <Slider
            value={[tickCount]}
            onValueChange={([v]) => setTickCount(v)}
            min={25}
            max={200}
            step={25}
            className="mt-3"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Digit Heatmap */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="bg-card border border-border rounded-xl p-5"
        >
          <h2 className="text-lg font-semibold text-foreground mb-4">Digit Frequency — {marketName}</h2>
          {prices.length > 5 ? (
            <DigitHeatmap prices={prices} lastDigit={lastDigit} />
          ) : (
            <div className="text-muted-foreground text-sm">Waiting for tick data...</div>
          )}
        </motion.div>

        {/* Signals */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="bg-card border border-border rounded-xl p-5"
        >
          <h2 className="text-lg font-semibold text-foreground mb-4">Signals</h2>
          {signals ? (
            <div className="space-y-3">
              <SignalCard
                title={signals.overUnder.type}
                direction={signals.overUnder.direction}
                strength={signals.overUnder.strength}
              />
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-muted rounded-lg p-3 text-center">
                  <div className="text-xs text-muted-foreground">Over 2</div>
                  <div className="font-mono text-sm font-bold text-profit">
                    {prices.length > 0
                      ? ((prices.slice(-20).filter(p => parseInt(p.toString().slice(-1)) > 2).length / Math.min(20, prices.length)) * 100).toFixed(0)
                      : 0}%
                  </div>
                </div>
                <div className="bg-muted rounded-lg p-3 text-center">
                  <div className="text-xs text-muted-foreground">Under 7</div>
                  <div className="font-mono text-sm font-bold text-loss">
                    {prices.length > 0
                      ? ((prices.slice(-20).filter(p => parseInt(p.toString().slice(-1)) < 7).length / Math.min(20, prices.length)) * 100).toFixed(0)
                      : 0}%
                  </div>
                </div>
              </div>
              <SignalCard
                title={signals.evenOdd.type}
                direction={signals.evenOdd.direction}
                strength={signals.evenOdd.strength}
              />
              <SignalCard
                title={signals.matchesDiffers.type}
                direction={signals.matchesDiffers.direction}
                strength={signals.matchesDiffers.strength}
              />
            </div>
          ) : (
            <div className="text-muted-foreground text-sm">Waiting for data...</div>
          )}
        </motion.div>
      </div>

      {/* Technical Indicators */}
      {indicators && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-card border border-border rounded-xl p-5"
        >
          <h2 className="text-lg font-semibold text-foreground mb-4">Technical Indicators</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-muted rounded-lg p-4">
              <div className="text-xs text-muted-foreground mb-1">RSI (14)</div>
              <div className={`font-mono text-xl font-bold ${
                indicators.rsi > 70 ? 'text-loss' : indicators.rsi < 30 ? 'text-profit' : 'text-foreground'
              }`}>
                {indicators.rsi.toFixed(1)}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {indicators.rsi > 70 ? 'Overbought' : indicators.rsi < 30 ? 'Oversold' : 'Neutral'}
              </div>
            </div>

            <div className="bg-muted rounded-lg p-4">
              <div className="text-xs text-muted-foreground mb-1">MACD</div>
              <div className={`font-mono text-xl font-bold ${
                indicators.macd.histogram > 0 ? 'text-profit' : 'text-loss'
              }`}>
                {indicators.macd.macd.toFixed(4)}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Signal: {indicators.macd.signal.toFixed(4)}
              </div>
            </div>

            <div className="bg-muted rounded-lg p-4">
              <div className="text-xs text-muted-foreground mb-1">MA (20)</div>
              <div className="font-mono text-xl font-bold text-foreground">
                {indicators.ma.toFixed(4)}
              </div>
              <div className={`text-xs mt-1 ${
                prices[prices.length - 1] > indicators.ma ? 'text-profit' : 'text-loss'
              }`}>
                {prices[prices.length - 1] > indicators.ma ? 'Above MA' : 'Below MA'}
              </div>
            </div>

            <div className="bg-muted rounded-lg p-4">
              <div className="text-xs text-muted-foreground mb-1">Bollinger</div>
              <div className="font-mono text-sm">
                <div className="text-loss">U: {indicators.bb.upper.toFixed(4)}</div>
                <div className="text-foreground">M: {indicators.bb.middle.toFixed(4)}</div>
                <div className="text-profit">L: {indicators.bb.lower.toFixed(4)}</div>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
