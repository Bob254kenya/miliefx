import { useState, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { MARKETS, derivApi, type MarketSymbol } from '@/services/deriv-api';
import { getLastDigit } from '@/services/analysis';
import { useAuth } from '@/contexts/AuthContext';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Play, Pause, StopCircle } from 'lucide-react';

interface TradeLog {
  id: number;
  time: string;
  market: string;
  contract: string;
  stake: number;
  result: 'Win' | 'Loss' | 'Pending';
  pnl: number;
}

export default function AutoTrade() {
  const { isAuthorized, activeAccount } = useAuth();
  const [market, setMarket] = useState<MarketSymbol>('R_100');
  const [contractType, setContractType] = useState('DIGITOVER');
  const [digit, setDigit] = useState('4');
  const [stake, setStake] = useState('1');
  const [martingale, setMartingale] = useState(false);
  const [multiplier, setMultiplier] = useState('2');
  const [stopLoss, setStopLoss] = useState('10');
  const [takeProfit, setTakeProfit] = useState('20');
  const [maxTrades, setMaxTrades] = useState('50');
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [trades, setTrades] = useState<TradeLog[]>([]);
  const runningRef = useRef(false);
  const pausedRef = useRef(false);
  const tradeIdRef = useRef(0);

  const needsDigit = ['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'].includes(contractType);

  const contractTypes = [
    { value: 'DIGITOVER', label: 'Over' },
    { value: 'DIGITUNDER', label: 'Under' },
    { value: 'DIGITEVEN', label: 'Even' },
    { value: 'DIGITODD', label: 'Odd' },
    { value: 'DIGITMATCH', label: 'Matches' },
    { value: 'DIGITDIFF', label: 'Differs' },
  ];

  const totalPnL = trades.reduce((sum, t) => sum + t.pnl, 0);
  const wins = trades.filter(t => t.result === 'Win').length;
  const losses = trades.filter(t => t.result === 'Loss').length;
  const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0;

  const startTrading = useCallback(async () => {
    if (!isAuthorized || isRunning) return;
    setIsRunning(true);
    runningRef.current = true;
    pausedRef.current = false;
    setIsPaused(false);

    let currentStake = parseFloat(stake);
    let totalPnl = 0;
    let tradeCount = 0;
    const maxTradeCount = parseInt(maxTrades);
    const sl = parseFloat(stopLoss);
    const tp = parseFloat(takeProfit);

    while (runningRef.current && tradeCount < maxTradeCount) {
      if (pausedRef.current) {
        await new Promise(r => setTimeout(r, 500));
        continue;
      }

      try {
        const params: any = {
          contract_type: contractType,
          symbol: market,
          duration: 1,
          duration_unit: 't',
          basis: 'stake',
          amount: currentStake,
        };

        if (needsDigit) {
          params.barrier = digit;
        }

        const id = ++tradeIdRef.current;
        const now = new Date().toLocaleTimeString();
        
        setTrades(prev => [{
          id, time: now, market, contract: contractType,
          stake: currentStake, result: 'Pending' as const, pnl: 0,
        }, ...prev].slice(0, 100));

        const result = await derivApi.buy(params);
        const pnl = result.buy?.profit || 0;
        const won = pnl > 0;

        setTrades(prev => prev.map(t =>
          t.id === id ? { ...t, result: won ? 'Win' : 'Loss', pnl } : t
        ));

        totalPnl += pnl;
        tradeCount++;

        if (martingale && !won) {
          currentStake *= parseFloat(multiplier);
        } else {
          currentStake = parseFloat(stake);
        }

        if (totalPnl <= -sl || totalPnl >= tp) {
          runningRef.current = false;
        }

        // Small delay between trades
        await new Promise(r => setTimeout(r, 1000));
      } catch (err) {
        console.error('Trade error:', err);
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    setIsRunning(false);
    runningRef.current = false;
  }, [isAuthorized, isRunning, stake, market, contractType, digit, needsDigit, martingale, multiplier, maxTrades, stopLoss, takeProfit]);

  const pauseTrading = () => {
    pausedRef.current = !pausedRef.current;
    setIsPaused(!isPaused);
  };

  const stopTrading = () => {
    runningRef.current = false;
    setIsRunning(false);
    setIsPaused(false);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Auto Trade</h1>
        <p className="text-sm text-muted-foreground">Configure and run automated digit trading</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Config Panel */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="bg-card border border-border rounded-xl p-5 space-y-4"
        >
          <h2 className="font-semibold text-foreground">Configuration</h2>
          
          <div>
            <label className="text-xs text-muted-foreground">Market</label>
            <Select value={market} onValueChange={(v) => setMarket(v as MarketSymbol)} disabled={isRunning}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {MARKETS.map(m => (
                  <SelectItem key={m.symbol} value={m.symbol}>{m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-xs text-muted-foreground">Contract Type</label>
            <Select value={contractType} onValueChange={setContractType} disabled={isRunning}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {contractTypes.map(ct => (
                  <SelectItem key={ct.value} value={ct.value}>{ct.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {needsDigit && (
            <div>
              <label className="text-xs text-muted-foreground">Digit (0-9)</label>
              <Input type="number" min="0" max="9" value={digit} onChange={e => setDigit(e.target.value)} disabled={isRunning} />
            </div>
          )}

          <div>
            <label className="text-xs text-muted-foreground">Stake ({activeAccount?.currency || 'USD'})</label>
            <Input type="number" min="0.35" step="0.01" value={stake} onChange={e => setStake(e.target.value)} disabled={isRunning} />
          </div>

          <div className="flex items-center justify-between">
            <label className="text-sm text-foreground">Martingale</label>
            <Switch checked={martingale} onCheckedChange={setMartingale} disabled={isRunning} />
          </div>

          {martingale && (
            <div>
              <label className="text-xs text-muted-foreground">Multiplier</label>
              <Input type="number" min="1.1" step="0.1" value={multiplier} onChange={e => setMultiplier(e.target.value)} disabled={isRunning} />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Stop Loss</label>
              <Input type="number" value={stopLoss} onChange={e => setStopLoss(e.target.value)} disabled={isRunning} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Take Profit</label>
              <Input type="number" value={takeProfit} onChange={e => setTakeProfit(e.target.value)} disabled={isRunning} />
            </div>
          </div>

          <div>
            <label className="text-xs text-muted-foreground">Max Trades</label>
            <Input type="number" value={maxTrades} onChange={e => setMaxTrades(e.target.value)} disabled={isRunning} />
          </div>

          {/* Control Buttons */}
          <div className="flex gap-2 pt-2">
            {!isRunning ? (
              <Button onClick={startTrading} disabled={!isAuthorized} className="flex-1 bg-profit hover:bg-profit/90 text-profit-foreground">
                <Play className="w-4 h-4 mr-1" /> Start
              </Button>
            ) : (
              <>
                <Button onClick={pauseTrading} variant="outline" className="flex-1">
                  <Pause className="w-4 h-4 mr-1" /> {isPaused ? 'Resume' : 'Pause'}
                </Button>
                <Button onClick={stopTrading} variant="destructive" className="flex-1">
                  <StopCircle className="w-4 h-4 mr-1" /> Stop
                </Button>
              </>
            )}
          </div>
        </motion.div>

        {/* Performance + Trade Log */}
        <div className="lg:col-span-2 space-y-4">
          {/* Performance */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1 }}
            className="grid grid-cols-2 sm:grid-cols-4 gap-3"
          >
            <div className="bg-card border border-border rounded-lg p-3 text-center">
              <div className="text-xs text-muted-foreground">Win Rate</div>
              <div className={`font-mono text-lg font-bold ${winRate >= 50 ? 'text-profit' : 'text-loss'}`}>
                {winRate.toFixed(1)}%
              </div>
            </div>
            <div className="bg-card border border-border rounded-lg p-3 text-center">
              <div className="text-xs text-muted-foreground">Total Trades</div>
              <div className="font-mono text-lg font-bold text-foreground">{trades.length}</div>
            </div>
            <div className="bg-card border border-border rounded-lg p-3 text-center">
              <div className="text-xs text-muted-foreground">W / L</div>
              <div className="font-mono text-lg font-bold">
                <span className="text-profit">{wins}</span>
                <span className="text-muted-foreground"> / </span>
                <span className="text-loss">{losses}</span>
              </div>
            </div>
            <div className="bg-card border border-border rounded-lg p-3 text-center">
              <div className="text-xs text-muted-foreground">P/L</div>
              <div className={`font-mono text-lg font-bold ${totalPnL >= 0 ? 'text-profit' : 'text-loss'}`}>
                {totalPnL >= 0 ? '+' : ''}{totalPnL.toFixed(2)}
              </div>
            </div>
          </motion.div>

          {/* Trade Log */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="bg-card border border-border rounded-xl overflow-hidden"
          >
            <div className="p-4 border-b border-border">
              <h2 className="font-semibold text-foreground">Trade Log</h2>
            </div>
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground bg-muted/50 sticky top-0">
                  <tr>
                    <th className="text-left p-2">Time</th>
                    <th className="text-left p-2">Market</th>
                    <th className="text-left p-2">Type</th>
                    <th className="text-right p-2">Stake</th>
                    <th className="text-center p-2">Result</th>
                    <th className="text-right p-2">P/L</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center text-muted-foreground py-8">
                        No trades yet. Configure and start trading.
                      </td>
                    </tr>
                  ) : trades.map(trade => (
                    <tr key={trade.id} className="border-t border-border/50 hover:bg-muted/30">
                      <td className="p-2 font-mono text-xs">{trade.time}</td>
                      <td className="p-2 font-mono text-xs">{trade.market}</td>
                      <td className="p-2 text-xs">{trade.contract}</td>
                      <td className="p-2 font-mono text-xs text-right">{trade.stake.toFixed(2)}</td>
                      <td className="p-2 text-center">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          trade.result === 'Win' ? 'bg-profit/10 text-profit' :
                          trade.result === 'Loss' ? 'bg-loss/10 text-loss' :
                          'bg-warning/10 text-warning'
                        }`}>
                          {trade.result}
                        </span>
                      </td>
                      <td className={`p-2 font-mono text-xs text-right ${
                        trade.pnl > 0 ? 'text-profit' : trade.pnl < 0 ? 'text-loss' : 'text-muted-foreground'
                      }`}>
                        {trade.pnl > 0 ? '+' : ''}{trade.pnl.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
