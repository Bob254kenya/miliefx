import { useState, useRef, useCallback, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { derivApi, type MarketSymbol } from '@/services/deriv-api';
import { copyTradingService } from '@/services/copy-trading-service';
import { getLastDigit } from '@/services/analysis';
import { useAuth } from '@/contexts/AuthContext';
import { useLossRequirement } from '@/hooks/useLossRequirement';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import {
  Play, StopCircle, Trash2, Scan,
  Home, RefreshCw, Shield, TrendingUp, DollarSign,
  History, BookOpen, BarChart3, Download, Filter
} from 'lucide-react';

// ... (keep your existing SCANNER_MARKETS, BotStatus, M1StrategyType, M2RecoveryType, LogEntry, DetectedPattern definitions)

// NEW: Transaction and Journal Types
interface Transaction {
  transaction_id: string;
  action: string;
  amount: number;
  balance_after: number;
  currency: string;
  transaction_time: string;
  contract_id: number;
  description: string;
  profit_loss: number;
  purchase_time: string;
  sell_time: string;
  status: 'pending' | 'completed' | 'failed';
}

interface JournalEntry {
  id: string;
  timestamp: string;
  type: 'BUY' | 'SELL' | 'PROFIT' | 'LOSS' | 'ERROR' | 'INFO';
  message: string;
  contract_id?: number;
  amount?: number;
  profit_loss?: number;
  balance_after?: number;
}

interface SummaryData {
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  total_profit_loss: number;
  total_stake: number;
  total_payout: number;
  win_rate: number;
  avg_profit_per_trade: number;
  avg_loss_per_trade: number;
  largest_win: number;
  largest_loss: number;
  longest_winning_streak: number;
  longest_losing_streak: number;
  current_streak: number;
  current_streak_type: 'win' | 'loss' | null;
  total_duration_seconds: number;
  start_time: string | null;
  end_time: string | null;
}

export default function ProScannerBot() {
  const { isAuthorized, balance, activeAccount } = useAuth();
  const { recordLoss } = useLossRequirement();

  // ... (keep all your existing state declarations)

  // NEW: Summary, Transactions, and Journal State
  const [summaryData, setSummaryData] = useState<SummaryData>({
    total_trades: 0,
    winning_trades: 0,
    losing_trades: 0,
    total_profit_loss: 0,
    total_stake: 0,
    total_payout: 0,
    win_rate: 0,
    avg_profit_per_trade: 0,
    avg_loss_per_trade: 0,
    largest_win: 0,
    largest_loss: 0,
    longest_winning_streak: 0,
    longest_losing_streak: 0,
    current_streak: 0,
    current_streak_type: null,
    total_duration_seconds: 0,
    start_time: null,
    end_time: null,
  });
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [isLoadingSummary, setIsLoadingSummary] = useState(false);
  const [isLoadingTransactions, setIsLoadingTransactions] = useState(false);
  const [transactionFilter, setTransactionFilter] = useState<'all' | 'wins' | 'losses'>('all');
  const [dateRange, setDateRange] = useState<{ from: Date | null; to: Date | null }>({ from: null, to: null });
  const botStartTimeRef = useRef<Date | null>(null);
  const winningStreakRef = useRef(0);
  const losingStreakRef = useRef(0);
  const currentStreakRef = useRef(0);
  const currentStreakTypeRef = useRef<'win' | 'loss' | null>(null);

  // ... (keep all your existing refs and existing useEffect hooks)

  // NEW: Fetch Reality Check Summary from Deriv API
  const fetchRealityCheckSummary = useCallback(async () => {
    if (!derivApi.isConnected) return;
    
    setIsLoadingSummary(true);
    try {
      const response = await new Promise((resolve, reject) => {
        const requestId = Date.now();
        const timeout = setTimeout(() => reject(new Error('Timeout')), 10000);
        
        const unsubscribe = derivApi.onMessage((data: any) => {
          if (data.msg_type === 'reality_check' && data.req_id === requestId) {
            clearTimeout(timeout);
            unsubscribe();
            resolve(data);
          }
        });
        
        derivApi.sendMessage({ reality_check: 1, req_id: requestId });
      });
      
      const realityData: any = response;
      if (realityData.error) {
        console.error('Reality check error:', realityData.error);
        return;
      }
      
      // Update summary with reality check data
      setSummaryData(prev => ({
        ...prev,
        total_duration_seconds: realityData.reality_check?.elapsed_time || 0,
        start_time: realityData.reality_check?.start_time || prev.start_time,
      }));
      
    } catch (error) {
      console.error('Failed to fetch reality check:', error);
    } finally {
      setIsLoadingSummary(false);
    }
  }, []);

  // NEW: Fetch Transaction Statement from Deriv API
  const fetchStatement = useCallback(async (limit: number = 100, offset: number = 0) => {
    if (!derivApi.isConnected) return;
    
    setIsLoadingTransactions(true);
    try {
      const response = await new Promise((resolve, reject) => {
        const requestId = Date.now();
        const timeout = setTimeout(() => reject(new Error('Timeout')), 10000);
        
        const unsubscribe = derivApi.onMessage((data: any) => {
          if (data.msg_type === 'statement' && data.req_id === requestId) {
            clearTimeout(timeout);
            unsubscribe();
            resolve(data);
          }
        });
        
        derivApi.sendMessage({ 
          statement: 1, 
          limit, 
          offset, 
          req_id: requestId 
        });
      });
      
      const statementData: any = response;
      if (statementData.error) {
        console.error('Statement error:', statementData.error);
        return;
      }
      
      const fetchedTransactions: Transaction[] = statementData.statement?.transactions?.map((tx: any) => ({
        transaction_id: tx.transaction_id,
        action: tx.action,
        amount: tx.amount,
        balance_after: tx.balance_after,
        currency: tx.currency,
        transaction_time: tx.transaction_time,
        contract_id: tx.contract_id,
        description: tx.longcode || tx.action,
        profit_loss: tx.profit_loss || 0,
        purchase_time: tx.purchase_time,
        sell_time: tx.sell_time,
        status: tx.sell_time ? 'completed' : 'pending',
      })) || [];
      
      setTransactions(prev => {
        // Merge new transactions with existing, avoiding duplicates
        const existingIds = new Set(prev.map(t => t.transaction_id));
        const newTransactions = fetchedTransactions.filter(t => !existingIds.has(t.transaction_id));
        return [...newTransactions, ...prev].slice(0, 500); // Keep last 500
      });
      
    } catch (error) {
      console.error('Failed to fetch statement:', error);
    } finally {
      setIsLoadingTransactions(false);
    }
  }, []);

  // NEW: Subscribe to Real-time Transaction Stream (Journal)
  const subscribeToTransactionStream = useCallback(() => {
    if (!derivApi.isConnected) return () => {};
    
    let isSubscribed = true;
    
    const handleTransaction = (data: any) => {
      if (!isSubscribed) return;
      
      if (data.msg_type === 'transaction' && data.transaction) {
        const tx = data.transaction;
        const journalEntry: JournalEntry = {
          id: `${tx.transaction_id || Date.now()}`,
          timestamp: new Date().toISOString(),
          type: tx.profit_loss > 0 ? 'PROFIT' : tx.profit_loss < 0 ? 'LOSS' : 'INFO',
          message: tx.longcode || `${tx.action} of ${tx.amount} ${tx.currency}`,
          contract_id: tx.contract_id,
          amount: tx.amount,
          profit_loss: tx.profit_loss,
          balance_after: tx.balance_after,
        };
        
        setJournalEntries(prev => [journalEntry, ...prev].slice(0, 200));
        
        // Update transaction list
        const newTransaction: Transaction = {
          transaction_id: tx.transaction_id,
          action: tx.action,
          amount: tx.amount,
          balance_after: tx.balance_after,
          currency: tx.currency,
          transaction_time: tx.transaction_time,
          contract_id: tx.contract_id,
          description: tx.longcode || tx.action,
          profit_loss: tx.profit_loss || 0,
          purchase_time: tx.purchase_time,
          sell_time: tx.sell_time,
          status: tx.sell_time ? 'completed' : 'pending',
        };
        
        setTransactions(prev => [newTransaction, ...prev].slice(0, 500));
        
        // Update summary statistics in real-time
        updateSummaryFromTransaction(newTransaction);
      }
    };
    
    const unsubscribe = derivApi.onMessage(handleTransaction);
    
    // Subscribe to transaction stream
    derivApi.sendMessage({ transaction_stream: 1, subscribe: 1 });
    
    return () => {
      isSubscribed = false;
      unsubscribe();
      derivApi.sendMessage({ transaction_stream: 0, unsubscribe: 1 });
    };
  }, []);

  // NEW: Update summary statistics from a transaction
  const updateSummaryFromTransaction = useCallback((transaction: Transaction) => {
    setSummaryData(prev => {
      const isWin = transaction.profit_loss > 0;
      const isLoss = transaction.profit_loss < 0;
      
      // Update streaks
      if (isWin) {
        if (currentStreakTypeRef.current === 'win') {
          currentStreakRef.current++;
        } else {
          currentStreakRef.current = 1;
          currentStreakTypeRef.current = 'win';
        }
        winningStreakRef.current = Math.max(winningStreakRef.current, currentStreakRef.current);
      } else if (isLoss) {
        if (currentStreakTypeRef.current === 'loss') {
          currentStreakRef.current++;
        } else {
          currentStreakRef.current = 1;
          currentStreakTypeRef.current = 'loss';
        }
        losingStreakRef.current = Math.max(losingStreakRef.current, currentStreakRef.current);
      }
      
      const newTotalTrades = prev.total_trades + 1;
      const newWinningTrades = prev.winning_trades + (isWin ? 1 : 0);
      const newLosingTrades = prev.losing_trades + (isLoss ? 1 : 0);
      const newTotalProfitLoss = prev.total_profit_loss + transaction.profit_loss;
      const newTotalStake = prev.total_stake + (transaction.action === 'buy' ? Math.abs(transaction.amount) : 0);
      const newTotalPayout = prev.total_payout + (transaction.action === 'sell' ? Math.abs(transaction.amount) : 0);
      
      // Update largest win/loss
      const newLargestWin = isWin ? Math.max(prev.largest_win, transaction.profit_loss) : prev.largest_win;
      const newLargestLoss = isLoss ? Math.min(prev.largest_loss, transaction.profit_loss) : prev.largest_loss;
      
      // Update averages
      const avgProfitPerTrade = newWinningTrades > 0 
        ? (prev.avg_profit_per_trade * prev.winning_trades + (isWin ? transaction.profit_loss : 0)) / newWinningTrades 
        : prev.avg_profit_per_trade;
      
      const avgLossPerTrade = newLosingTrades > 0 
        ? (prev.avg_loss_per_trade * prev.losing_trades + (isLoss ? Math.abs(transaction.profit_loss) : 0)) / newLosingTrades 
        : prev.avg_loss_per_trade;
      
      return {
        ...prev,
        total_trades: newTotalTrades,
        winning_trades: newWinningTrades,
        losing_trades: newLosingTrades,
        total_profit_loss: newTotalProfitLoss,
        total_stake: newTotalStake,
        total_payout: newTotalPayout,
        win_rate: newTotalTrades > 0 ? (newWinningTrades / newTotalTrades) * 100 : 0,
        avg_profit_per_trade: avgProfitPerTrade,
        avg_loss_per_trade: avgLossPerTrade,
        largest_win: newLargestWin,
        largest_loss: newLargestLoss,
        longest_winning_streak: winningStreakRef.current,
        longest_losing_streak: losingStreakRef.current,
        current_streak: currentStreakRef.current,
        current_streak_type: currentStreakTypeRef.current,
      };
    });
  }, []);

  // NEW: Export transactions to CSV
  const exportTransactionsToCSV = useCallback(() => {
    const filteredTransactions = getFilteredTransactions();
    const headers = ['Transaction ID', 'Action', 'Amount', 'Balance After', 'Currency', 'Time', 'Profit/Loss', 'Status'];
    const csvData = filteredTransactions.map(t => [
      t.transaction_id,
      t.action,
      t.amount,
      t.balance_after,
      t.currency,
      new Date(t.transaction_time).toLocaleString(),
      t.profit_loss,
      t.status,
    ]);
    
    const csvContent = [headers, ...csvData].map(row => row.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transactions_${new Date().toISOString()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    
    toast.success('Transactions exported successfully');
  }, [transactions, transactionFilter, dateRange]);

  // NEW: Get filtered transactions based on filter and date range
  const getFilteredTransactions = useCallback(() => {
    let filtered = [...transactions];
    
    // Filter by win/loss
    if (transactionFilter === 'wins') {
      filtered = filtered.filter(t => t.profit_loss > 0);
    } else if (transactionFilter === 'losses') {
      filtered = filtered.filter(t => t.profit_loss < 0);
    }
    
    // Filter by date range
    if (dateRange.from) {
      filtered = filtered.filter(t => new Date(t.transaction_time) >= dateRange.from!);
    }
    if (dateRange.to) {
      filtered = filtered.filter(t => new Date(t.transaction_time) <= dateRange.to!);
    }
    
    return filtered;
  }, [transactions, transactionFilter, dateRange]);

  // NEW: Add journal entry for bot actions
  const addJournalEntry = useCallback((type: JournalEntry['type'], message: string, data?: Partial<JournalEntry>) => {
    const entry: JournalEntry = {
      id: `${Date.now()}-${Math.random()}`,
      timestamp: new Date().toISOString(),
      type,
      message,
      ...data,
    };
    setJournalEntries(prev => [entry, ...prev].slice(0, 200));
  }, []);

  // NEW: Reset summary data when bot starts
  const resetSummaryData = useCallback(() => {
    setSummaryData({
      total_trades: 0,
      winning_trades: 0,
      losing_trades: 0,
      total_profit_loss: 0,
      total_stake: 0,
      total_payout: 0,
      win_rate: 0,
      avg_profit_per_trade: 0,
      avg_loss_per_trade: 0,
      largest_win: 0,
      largest_loss: 0,
      longest_winning_streak: 0,
      longest_losing_streak: 0,
      current_streak: 0,
      current_streak_type: null,
      total_duration_seconds: 0,
      start_time: new Date().toISOString(),
      end_time: null,
    });
    
    winningStreakRef.current = 0;
    losingStreakRef.current = 0;
    currentStreakRef.current = 0;
    currentStreakTypeRef.current = null;
    botStartTimeRef.current = new Date();
    
    addJournalEntry('INFO', 'Bot session started');
  }, [addJournalEntry]);

  // NEW: Update end time when bot stops
  const updateEndTime = useCallback(() => {
    setSummaryData(prev => ({
      ...prev,
      end_time: new Date().toISOString(),
    }));
    addJournalEntry('INFO', 'Bot session ended');
  }, [addJournalEntry]);

  // Modified startBot to include summary reset and journal
  const originalStartBot = useCallback(async () => {
    if (!isAuthorized || isRunning) return;
    const baseStake = parseFloat(stake);
    if (baseStake < 0.35) { toast.error('Min stake $0.35'); return; }
    if (!m1Enabled && !m2Enabled) { toast.error('Enable at least one market'); return; }

    setIsRunning(true);
    runningRef.current = true;
    setCurrentMarket(1);
    setBotStatus('trading_m1');
    setCurrentStakeState(baseStake);
    setMartingaleStepState(0);
    
    // Reset summary and add journal entry
    resetSummaryData();
    
    lastTradeTimeRef.current.clear();
    lastPatternDigitsRef.current.clear();
    lastTradeOverallRef.current = 0;

    let cStake = baseStake;
    let mStep = 0;
    let inRecovery = false;
    let localPnl = 0;
    let localBalance = balance;
    let waitingForPatternAfterLoss = false;

    while (runningRef.current) {
      // ... (rest of your existing bot logic)
      
      // Add journal entries for trades
      addJournalEntry('INFO', `${inRecovery ? 'Recovery' : 'M1'} trade on ${tradeSymbol}`, {
        contract_id: parseInt(result.contractId),
        amount: cStake,
      });
    }

    setIsRunning(false);
    runningRef.current = false;
    setBotStatus('idle');
    updateEndTime();
  }, [isAuthorized, isRunning, balance, stake, m1Enabled, m2Enabled,
    martingaleOn, martingaleMultiplier, martingaleMaxSteps, takeProfit, stopLoss,
    strategyM1Enabled, strategyM2Enabled, m1StrategyType, m2RecoveryType,
    findM1Match, findM2Match, addLog, updateLog, executeRealTrade, resetSummaryData, updateEndTime, addJournalEntry]);

  // Modified stopBot to update end time
  const originalStopBot = useCallback(() => {
    runningRef.current = false;
    setIsRunning(false);
    setBotStatus('idle');
    updateEndTime();
  }, [updateEndTime]);

  // Override startBot and stopBot
  const startBot = originalStartBot;
  const stopBot = originalStopBot;

  // Initialize data fetching on component mount
  useEffect(() => {
    if (derivApi.isConnected && isAuthorized) {
      fetchRealityCheckSummary();
      fetchStatement(100, 0);
      const unsubscribe = subscribeToTransactionStream();
      
      // Fetch statement periodically (every 30 seconds)
      const interval = setInterval(() => {
        fetchStatement(50, 0);
      }, 30000);
      
      return () => {
        unsubscribe();
        clearInterval(interval);
      };
    }
  }, [derivApi.isConnected, isAuthorized, fetchRealityCheckSummary, fetchStatement, subscribeToTransactionStream]);

  // ... (keep all your existing render code)

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-4">
      <div className="space-y-3 max-w-7xl mx-auto">
        {/* Header - keep your existing header */}
        
        {/* NEW: Tabs for Summary, Transactions, and Journal */}
        <Tabs defaultValue="bot" className="w-full">
          <TabsList className="grid w-full grid-cols-4 bg-slate-800/50 border border-slate-700/50 rounded-xl p-1">
            <TabsTrigger value="bot" className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-cyan-500 data-[state=active]:to-blue-600 data-[state=active]:text-white">
              <Play className="w-4 h-4 mr-2" /> Bot Control
            </TabsTrigger>
            <TabsTrigger value="summary" className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-emerald-500 data-[state=active]:to-teal-600 data-[state=active]:text-white">
              <BarChart3 className="w-4 h-4 mr-2" /> Summary
            </TabsTrigger>
            <TabsTrigger value="transactions" className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-500 data-[state=active]:to-indigo-600 data-[state=active]:text-white">
              <History className="w-4 h-4 mr-2" /> Transactions
            </TabsTrigger>
            <TabsTrigger value="journal" className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-purple-500 data-[state=active]:to-pink-600 data-[state=active]:text-white">
              <BookOpen className="w-4 h-4 mr-2" /> Journal
            </TabsTrigger>
          </TabsList>

          {/* Bot Control Tab - Keep all your existing bot UI */}
          <TabsContent value="bot" className="space-y-3 mt-3">
            {/* Your existing bot UI goes here */}
            {/* Markets Row, Risk Management, Start/Stop Button, etc. */}
          </TabsContent>

          {/* SUMMARY TAB */}
          <TabsContent value="summary" className="mt-3">
            <Card className="bg-gradient-to-br from-slate-900/90 to-slate-800/90 backdrop-blur-sm border-slate-700/50 shadow-xl">
              <CardHeader>
                <CardTitle className="text-slate-200 flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-emerald-400" />
                  Trading Summary
                </CardTitle>
                <CardDescription className="text-slate-400">
                  Overall performance statistics for this bot session
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Key Metrics Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-slate-800/50 rounded-lg p-3 text-center">
                    <div className="text-[10px] text-slate-400 mb-1">Total Trades</div>
                    <div className="text-2xl font-bold text-slate-200">{summaryData.total_trades}</div>
                  </div>
                  <div className="bg-slate-800/50 rounded-lg p-3 text-center">
                    <div className="text-[10px] text-slate-400 mb-1">Win Rate</div>
                    <div className={`text-2xl font-bold ${summaryData.win_rate >= 50 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {summaryData.win_rate.toFixed(1)}%
                    </div>
                  </div>
                  <div className="bg-slate-800/50 rounded-lg p-3 text-center">
                    <div className="text-[10px] text-slate-400 mb-1">Total P/L</div>
                    <div className={`text-2xl font-bold ${summaryData.total_profit_loss >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      ${summaryData.total_profit_loss.toFixed(2)}
                    </div>
                  </div>
                  <div className="bg-slate-800/50 rounded-lg p-3 text-center">
                    <div className="text-[10px] text-slate-400 mb-1">Total Stake</div>
                    <div className="text-2xl font-bold text-slate-200">${summaryData.total_stake.toFixed(2)}</div>
                  </div>
                </div>

                {/* Detailed Stats */}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <div className="bg-slate-800/30 rounded-lg p-2">
                    <div className="text-[9px] text-slate-400">Wins / Losses</div>
                    <div className="text-sm font-mono font-bold">
                      <span className="text-emerald-400">{summaryData.winning_trades}</span>
                      <span className="text-slate-500"> / </span>
                      <span className="text-rose-400">{summaryData.losing_trades}</span>
                    </div>
                  </div>
                  <div className="bg-slate-800/30 rounded-lg p-2">
                    <div className="text-[9px] text-slate-400">Avg Profit / Loss</div>
                    <div className="text-sm font-mono font-bold">
                      <span className="text-emerald-400">+${summaryData.avg_profit_per_trade.toFixed(2)}</span>
                      <span className="text-slate-500"> / </span>
                      <span className="text-rose-400">-${summaryData.avg_loss_per_trade.toFixed(2)}</span>
                    </div>
                  </div>
                  <div className="bg-slate-800/30 rounded-lg p-2">
                    <div className="text-[9px] text-slate-400">Largest Win / Loss</div>
                    <div className="text-sm font-mono font-bold">
                      <span className="text-emerald-400">+${summaryData.largest_win.toFixed(2)}</span>
                      <span className="text-slate-500"> / </span>
                      <span className="text-rose-400">${summaryData.largest_loss.toFixed(2)}</span>
                    </div>
                  </div>
                  <div className="bg-slate-800/30 rounded-lg p-2">
                    <div className="text-[9px] text-slate-400">Current Streak</div>
                    <div className={`text-sm font-mono font-bold ${
                      summaryData.current_streak_type === 'win' ? 'text-emerald-400' : 'text-rose-400'
                    }`}>
                      {summaryData.current_streak} {summaryData.current_streak_type}
                    </div>
                  </div>
                  <div className="bg-slate-800/30 rounded-lg p-2">
                    <div className="text-[9px] text-slate-400">Longest Streak</div>
                    <div className="text-sm font-mono font-bold">
                      <span className="text-emerald-400">{summaryData.longest_winning_streak}W</span>
                      <span className="text-slate-500"> / </span>
                      <span className="text-rose-400">{summaryData.longest_losing_streak}L</span>
                    </div>
                  </div>
                  <div className="bg-slate-800/30 rounded-lg p-2">
                    <div className="text-[9px] text-slate-400">Total Payout</div>
                    <div className="text-sm font-mono font-bold text-cyan-400">
                      ${summaryData.total_payout.toFixed(2)}
                    </div>
                  </div>
                </div>

                {/* Session Duration */}
                {summaryData.start_time && (
                  <div className="bg-slate-800/30 rounded-lg p-2 text-center">
                    <div className="text-[9px] text-slate-400">Session Duration</div>
                    <div className="text-xs font-mono text-slate-300">
                      Started: {new Date(summaryData.start_time).toLocaleString()}
                      {summaryData.end_time && ` | Ended: ${new Date(summaryData.end_time).toLocaleString()}`}
                    </div>
                  </div>
                )}

                <Button 
                  onClick={fetchRealityCheckSummary}
                  disabled={isLoadingSummary}
                  variant="outline"
                  className="w-full bg-slate-800/50 border-slate-700 text-slate-300 hover:bg-slate-700/50"
                >
                  <RefreshCw className={`w-4 h-4 mr-2 ${isLoadingSummary ? 'animate-spin' : ''}`} />
                  Refresh Summary
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* TRANSACTIONS TAB */}
          <TabsContent value="transactions" className="mt-3">
            <Card className="bg-gradient-to-br from-slate-900/90 to-slate-800/90 backdrop-blur-sm border-slate-700/50 shadow-xl">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-slate-200 flex items-center gap-2">
                      <History className="w-5 h-5 text-blue-400" />
                      Transaction History
                    </CardTitle>
                    <CardDescription className="text-slate-400">
                      All buy/sell transactions from your trading activity
                    </CardDescription>
                  </div>
                  <Button 
                    onClick={exportTransactionsToCSV}
                    variant="outline"
                    size="sm"
                    className="bg-slate-800/50 border-slate-700 text-slate-300"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Export CSV
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {/* Filters */}
                <div className="flex gap-2 mb-4">
                  <Button 
                    variant={transactionFilter === 'all' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setTransactionFilter('all')}
                    className={transactionFilter === 'all' ? 'bg-blue-600' : 'bg-slate-800/50 border-slate-700'}
                  >
                    All
                  </Button>
                  <Button 
                    variant={transactionFilter === 'wins' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setTransactionFilter('wins')}
                    className={transactionFilter === 'wins' ? 'bg-emerald-600' : 'bg-slate-800/50 border-slate-700'}
                  >
                    Wins
                  </Button>
                  <Button 
                    variant={transactionFilter === 'losses' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setTransactionFilter('losses')}
                    className={transactionFilter === 'losses' ? 'bg-rose-600' : 'bg-slate-800/50 border-slate-700'}
                  >
                    Losses
                  </Button>
                </div>

                {/* Transactions Table */}
                <div className="max-h-[500px] overflow-auto">
                  <table className="w-full text-[11px]">
                    <thead className="text-[10px] text-slate-400 bg-slate-800/50 sticky top-0">
                      <tr>
                        <th className="text-left p-2">Time</th>
                        <th className="text-left p-2">Action</th>
                        <th className="text-right p-2">Amount</th>
                        <th className="text-right p-2">Balance</th>
                        <th className="text-right p-2">P/L</th>
                        <th className="text-left p-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {getFilteredTransactions().length === 0 ? (
                        <tr>
                          <td colSpan={6} className="text-center text-slate-500 py-12">
                            No transactions found
                          </td>
                        </tr>
                      ) : (
                        getFilteredTransactions().map((tx) => (
                          <tr key={tx.transaction_id} className="border-t border-slate-700/30 hover:bg-slate-800/30">
                            <td className="p-2 font-mono text-[9px] text-slate-400">
                              {new Date(tx.transaction_time).toLocaleTimeString()}
                            </td>
                            <td className="p-2 text-[10px]">
                              <Badge variant="outline" className="bg-slate-800 text-slate-300">
                                {tx.action}
                              </Badge>
                            </td>
                            <td className={`p-2 font-mono text-right text-[10px] font-bold ${
                              tx.action === 'buy' ? 'text-amber-400' : 'text-cyan-400'
                            }`}>
                              {tx.action === 'buy' ? '-' : '+'}${Math.abs(tx.amount).toFixed(2)}
                            </td>
                            <td className="p-2 font-mono text-right text-[10px] text-slate-300">
                              ${tx.balance_after?.toFixed(2) || '0'}
                            </td>
                            <td className={`p-2 font-mono text-right text-[10px] font-bold ${
                              tx.profit_loss > 0 ? 'text-emerald-400' : tx.profit_loss < 0 ? 'text-rose-400' : 'text-slate-400'
                            }`}>
                              {tx.profit_loss !== 0 && (tx.profit_loss > 0 ? '+' : '')}{tx.profit_loss?.toFixed(2)}
                            </td>
                            <td className="p-2">
                              <Badge className={`text-[8px] ${
                                tx.status === 'completed' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'
                              }`}>
                                {tx.status}
                              </Badge>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {isLoadingTransactions && (
                  <div className="text-center py-4">
                    <RefreshCw className="w-4 h-4 animate-spin mx-auto text-slate-400" />
                  </div>
                )}

                <Button 
                  onClick={() => fetchStatement(100, 0)}
                  variant="outline"
                  size="sm"
                  className="w-full mt-4 bg-slate-800/50 border-slate-700 text-slate-300"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Load More Transactions
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* JOURNAL TAB */}
          <TabsContent value="journal" className="mt-3">
            <Card className="bg-gradient-to-br from-slate-900/90 to-slate-800/90 backdrop-blur-sm border-slate-700/50 shadow-xl">
              <CardHeader>
                <CardTitle className="text-slate-200 flex items-center gap-2">
                  <BookOpen className="w-5 h-5 text-purple-400" />
                  Trading Journal
                </CardTitle>
                <CardDescription className="text-slate-400">
                  Real-time log of all trading activities and system events
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 max-h-[500px] overflow-y-auto">
                  {journalEntries.length === 0 ? (
                    <div className="text-center text-slate-500 py-12">
                      No journal entries yet
                    </div>
                  ) : (
                    journalEntries.map((entry) => (
                      <div 
                        key={entry.id}
                        className={`p-3 rounded-lg border-l-4 ${
                          entry.type === 'PROFIT' ? 'border-l-emerald-500 bg-emerald-500/5' :
                          entry.type === 'LOSS' ? 'border-l-rose-500 bg-rose-500/5' :
                          entry.type === 'BUY' ? 'border-l-blue-500 bg-blue-500/5' :
                          entry.type === 'SELL' ? 'border-l-cyan-500 bg-cyan-500/5' :
                          entry.type === 'ERROR' ? 'border-l-red-500 bg-red-500/5' :
                          'border-l-slate-500 bg-slate-500/5'
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge className={`text-[8px] ${
                                entry.type === 'PROFIT' ? 'bg-emerald-500/20 text-emerald-400' :
                                entry.type === 'LOSS' ? 'bg-rose-500/20 text-rose-400' :
                                entry.type === 'BUY' ? 'bg-blue-500/20 text-blue-400' :
                                entry.type === 'SELL' ? 'bg-cyan-500/20 text-cyan-400' :
                                entry.type === 'ERROR' ? 'bg-red-500/20 text-red-400' :
                                'bg-slate-500/20 text-slate-400'
                              }`}>
                                {entry.type}
                              </Badge>
                              <span className="text-[9px] font-mono text-slate-500">
                                {new Date(entry.timestamp).toLocaleTimeString()}
                              </span>
                            </div>
                            <div className="text-xs text-slate-300">{entry.message}</div>
                            {entry.contract_id && (
                              <div className="text-[9px] font-mono text-slate-500 mt-1">
                                Contract ID: {entry.contract_id}
                              </div>
                            )}
                          </div>
                          {entry.profit_loss !== undefined && (
                            <div className={`text-right font-mono text-sm font-bold ${
                              entry.profit_loss > 0 ? 'text-emerald-400' : entry.profit_loss < 0 ? 'text-rose-400' : 'text-slate-400'
                            }`}>
                              {entry.profit_loss > 0 ? '+' : ''}{entry.profit_loss.toFixed(2)}
                            </div>
                          )}
                        </div>
                      </div>
                    ))
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
