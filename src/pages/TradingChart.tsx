// Add these imports at the top of your file
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
  History, BookOpen, BarChart3, Download, Filter, X
} from 'lucide-react';

// ... keep all your existing type definitions (SCANNER_MARKETS, BotStatus, M1StrategyType, M2RecoveryType, LogEntry, DetectedPattern)

// NEW: Types for Summary, Transactions, and Journal
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

interface SummaryStats {
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  total_profit_loss: number;
  total_stake: number;
  total_payout: number;
  win_rate: number;
  avg_profit: number;
  avg_loss: number;
  largest_win: number;
  largest_loss: number;
  best_streak: number;
  worst_streak: number;
  current_streak: number;
  current_streak_type: 'win' | 'loss' | null;
}

export default function ProScannerBot() {
  const { isAuthorized, balance, activeAccount } = useAuth();
  const { recordLoss } = useLossRequirement();

  // ... KEEP ALL YOUR EXISTING STATE DECLARATIONS (m1Enabled, m2Enabled, stake, etc.)
  
  // NEW: Summary, Transactions, and Journal State
  const [activeTab, setActiveTab] = useState('bot');
  const [summaryStats, setSummaryStats] = useState<SummaryStats>({
    total_trades: 0,
    winning_trades: 0,
    losing_trades: 0,
    total_profit_loss: 0,
    total_stake: 0,
    total_payout: 0,
    win_rate: 0,
    avg_profit: 0,
    avg_loss: 0,
    largest_win: 0,
    largest_loss: 0,
    best_streak: 0,
    worst_streak: 0,
    current_streak: 0,
    current_streak_type: null,
  });
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [transactionFilter, setTransactionFilter] = useState<'all' | 'wins' | 'losses'>('all');
  const [showTransactionDetails, setShowTransactionDetails] = useState<string | null>(null);
  
  // Refs for tracking streaks
  const currentStreakRef = useRef(0);
  const currentStreakTypeRef = useRef<'win' | 'loss' | null>(null);
  const bestStreakRef = useRef(0);
  const worstStreakRef = useRef(0);

  // NEW: Add journal entry
  const addJournalEntry = useCallback((type: JournalEntry['type'], message: string, data?: Partial<JournalEntry>) => {
    const entry: JournalEntry = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      type,
      message,
      ...data,
    };
    setJournalEntries(prev => [entry, ...prev].slice(0, 200));
    
    // Also log to console for debugging
    console.log(`[JOURNAL][${type}]`, message, data);
  }, []);

  // NEW: Update summary from trade result
  const updateSummaryFromTrade = useCallback((won: boolean, profit: number, stakeAmount: number) => {
    setSummaryStats(prev => {
      const newTotalTrades = prev.total_trades + 1;
      const newWinningTrades = prev.winning_trades + (won ? 1 : 0);
      const newLosingTrades = prev.losing_trades + (won ? 0 : 1);
      const newTotalProfitLoss = prev.total_profit_loss + profit;
      const newTotalStake = prev.total_stake + stakeAmount;
      const newTotalPayout = prev.total_payout + (won ? stakeAmount + profit : 0);
      const newWinRate = newTotalTrades > 0 ? (newWinningTrades / newTotalTrades) * 100 : 0;
      
      // Update streaks
      let newCurrentStreak = prev.current_streak;
      let newCurrentStreakType = prev.current_streak_type;
      let newBestStreak = prev.best_streak;
      let newWorstStreak = prev.worst_streak;
      
      if (won) {
        if (newCurrentStreakType === 'win') {
          newCurrentStreak++;
        } else {
          newCurrentStreak = 1;
          newCurrentStreakType = 'win';
        }
        newBestStreak = Math.max(newBestStreak, newCurrentStreak);
      } else {
        if (newCurrentStreakType === 'loss') {
          newCurrentStreak++;
        } else {
          newCurrentStreak = 1;
          newCurrentStreakType = 'loss';
        }
        newWorstStreak = Math.max(newWorstStreak, newCurrentStreak);
      }
      
      // Update averages
      const newAvgProfit = newWinningTrades > 0 
        ? ((prev.avg_profit * prev.winning_trades) + (won ? profit : 0)) / newWinningTrades
        : prev.avg_profit;
      
      const newAvgLoss = newLosingTrades > 0
        ? ((prev.avg_loss * prev.losing_trades) + (!won ? Math.abs(profit) : 0)) / newLosingTrades
        : prev.avg_loss;
      
      // Update largest win/loss
      const newLargestWin = won ? Math.max(prev.largest_win, profit) : prev.largest_win;
      const newLargestLoss = !won ? Math.min(prev.largest_loss, profit) : prev.largest_loss;
      
      return {
        ...prev,
        total_trades: newTotalTrades,
        winning_trades: newWinningTrades,
        losing_trades: newLosingTrades,
        total_profit_loss: newTotalProfitLoss,
        total_stake: newTotalStake,
        total_payout: newTotalPayout,
        win_rate: newWinRate,
        avg_profit: newAvgProfit,
        avg_loss: newAvgLoss,
        largest_win: newLargestWin,
        largest_loss: newLargestLoss,
        best_streak: newBestStreak,
        worst_streak: newWorstStreak,
        current_streak: newCurrentStreak,
        current_streak_type: newCurrentStreakType,
      };
    });
  }, []);

  // NEW: Add transaction record
  const addTransaction = useCallback((tradeData: {
    action: string;
    amount: number;
    balance_after: number;
    contract_id: number;
    profit_loss: number;
    description: string;
  }) => {
    const transaction: Transaction = {
      transaction_id: `${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      action: tradeData.action,
      amount: tradeData.amount,
      balance_after: tradeData.balance_after,
      currency: 'USD',
      transaction_time: new Date().toISOString(),
      contract_id: tradeData.contract_id,
      description: tradeData.description,
      profit_loss: tradeData.profit_loss,
      status: 'completed',
    };
    
    setTransactions(prev => [transaction, ...prev].slice(0, 500));
    
    // Add journal entry for this transaction
    if (tradeData.action === 'buy') {
      addJournalEntry('BUY', `Bought contract ${tradeData.contract_id} for $${tradeData.amount}`, {
        contract_id: tradeData.contract_id,
        amount: tradeData.amount,
      });
    } else if (tradeData.action === 'sell') {
      const resultType = tradeData.profit_loss > 0 ? 'PROFIT' : 'LOSS';
      addJournalEntry(resultType, `Sold contract ${tradeData.contract_id}: ${tradeData.profit_loss > 0 ? 'Win' : 'Loss'} of $${Math.abs(tradeData.profit_loss).toFixed(2)}`, {
        contract_id: tradeData.contract_id,
        profit_loss: tradeData.profit_loss,
        balance_after: tradeData.balance_after,
      });
    }
    
    // Update summary stats
    if (tradeData.action === 'sell') {
      updateSummaryFromTrade(
        tradeData.profit_loss > 0,
        tradeData.profit_loss,
        tradeData.amount
      );
    }
  }, [addJournalEntry, updateSummaryFromTrade]);

  // NEW: Fetch historical transactions (using localStorage as fallback since Deriv API might need special setup)
  const fetchHistoricalData = useCallback(async () => {
    setIsLoadingData(true);
    
    try {
      // Try to load from localStorage first
      const savedTransactions = localStorage.getItem('bot_transactions');
      const savedJournal = localStorage.getItem('bot_journal');
      const savedSummary = localStorage.getItem('bot_summary');
      
      if (savedTransactions) {
        setTransactions(JSON.parse(savedTransactions));
      }
      if (savedJournal) {
        setJournalEntries(JSON.parse(savedJournal));
      }
      if (savedSummary) {
        setSummaryStats(JSON.parse(savedSummary));
      }
      
      // If Deriv API has statement method, try to fetch real data
      if (derivApi && typeof (derivApi as any).getStatement === 'function') {
        const statement = await (derivApi as any).getStatement({ limit: 50 });
        if (statement && statement.transactions) {
          const formattedTransactions = statement.transactions.map((tx: any) => ({
            transaction_id: tx.transaction_id,
            action: tx.action,
            amount: Math.abs(tx.amount),
            balance_after: tx.balance_after,
            currency: tx.currency || 'USD',
            transaction_time: tx.transaction_time,
            contract_id: tx.contract_id,
            description: tx.longcode || tx.action,
            profit_loss: tx.profit_loss || 0,
            status: 'completed',
          }));
          setTransactions(formattedTransactions);
        }
      }
      
    } catch (error) {
      console.error('Failed to load historical data:', error);
    } finally {
      setIsLoadingData(false);
    }
  }, []);

  // NEW: Save data to localStorage
  const saveDataToStorage = useCallback(() => {
    localStorage.setItem('bot_transactions', JSON.stringify(transactions.slice(0, 100)));
    localStorage.setItem('bot_journal', JSON.stringify(journalEntries.slice(0, 100)));
    localStorage.setItem('bot_summary', JSON.stringify(summaryStats));
  }, [transactions, journalEntries, summaryStats]);

  // Save data when it changes
  useEffect(() => {
    saveDataToStorage();
  }, [transactions, journalEntries, summaryStats, saveDataToStorage]);

  // Load data on mount
  useEffect(() => {
    fetchHistoricalData();
  }, [fetchHistoricalData]);

  // NEW: Export transactions to CSV
  const exportToCSV = useCallback(() => {
    const filtered = getFilteredTransactions();
    const headers = ['Date', 'Action', 'Amount', 'Balance', 'Profit/Loss', 'Contract ID', 'Description'];
    const rows = filtered.map(t => [
      new Date(t.transaction_time).toLocaleString(),
      t.action,
      t.amount.toFixed(2),
      t.balance_after.toFixed(2),
      t.profit_loss.toFixed(2),
      t.contract_id,
      t.description,
    ]);
    
    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trading_history_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    
    toast.success('Exported successfully');
  }, [transactions, transactionFilter]);

  // NEW: Get filtered transactions
  const getFilteredTransactions = useCallback(() => {
    let filtered = [...transactions];
    if (transactionFilter === 'wins') {
      filtered = filtered.filter(t => t.profit_loss > 0);
    } else if (transactionFilter === 'losses') {
      filtered = filtered.filter(t => t.profit_loss < 0);
    }
    return filtered;
  }, [transactions, transactionFilter]);

  // NEW: Clear all data
  const clearAllData = useCallback(() => {
    if (confirm('Are you sure you want to clear all transaction and journal data?')) {
      setTransactions([]);
      setJournalEntries([]);
      setSummaryStats({
        total_trades: 0,
        winning_trades: 0,
        losing_trades: 0,
        total_profit_loss: 0,
        total_stake: 0,
        total_payout: 0,
        win_rate: 0,
        avg_profit: 0,
        avg_loss: 0,
        largest_win: 0,
        largest_loss: 0,
        best_streak: 0,
        worst_streak: 0,
        current_streak: 0,
        current_streak_type: null,
      });
      localStorage.removeItem('bot_transactions');
      localStorage.removeItem('bot_journal');
      localStorage.removeItem('bot_summary');
      toast.success('All data cleared');
    }
  }, []);

  // MODIFY your existing executeRealTrade function to record transactions
  // Find this function in your code and add the transaction recording
  // Here's the modified version - replace your existing executeRealTrade with this:
  
  const originalExecuteRealTrade = useCallback(async (
    contractType: string,
    barrier: string | undefined,
    tradeSymbol: string,
    cStake: number,
    mStep: number,
    mkt: 1 | 2,
    localBalance: number,
    localPnl: number,
    baseStake: number,
    patternDigits: string
  ) => {
    const logId = ++logIdRef.current;
    const now = new Date().toLocaleTimeString();
    setTotalStaked(prev => prev + cStake);
    setCurrentStakeState(cStake);

    lastPatternDigitsRef.current.set(tradeSymbol, patternDigits);
    lastTradeTimeRef.current.set(tradeSymbol, Date.now());
    lastTradeOverallRef.current = Date.now();

    // Record buy transaction
    addTransaction({
      action: 'buy',
      amount: cStake,
      balance_after: localBalance - cStake,
      contract_id: 0, // Will be updated after purchase
      profit_loss: 0,
      description: `${contractType} on ${tradeSymbol}`,
    });

    addLog(logId, {
      time: now, market: mkt === 1 ? 'M1' : 'M2', symbol: tradeSymbol,
      contract: contractType, stake: cStake, martingaleStep: mStep,
      exitDigit: '...', result: 'Pending', pnl: 0, balance: localBalance,
      switchInfo: `Pattern: ${patternDigits}`,
    });

    let inRecovery = mkt === 2;

    try {
      await waitForNextTick(tradeSymbol as MarketSymbol);

      const buyParams: any = {
        contract_type: contractType, symbol: tradeSymbol,
        duration: 1, duration_unit: 't', basis: 'stake', amount: cStake,
      };
      if (barrier) buyParams.barrier = barrier;

      const { contractId } = await derivApi.buyContract(buyParams);
      
      // Update transaction with contract ID
      setTransactions(prev => prev.map((t, idx) => 
        idx === 0 && t.action === 'buy' && t.contract_id === 0 
          ? { ...t, contract_id: contractId }
          : t
      ));
      
      if (copyTradingService.enabled) {
        copyTradingService.copyTrade({
          ...buyParams,
          masterTradeId: contractId,
        }).catch(err => console.error('Copy trading error:', err));
      }
      
      const result = await derivApi.waitForContractResult(contractId);
      const won = result.status === 'won';
      const pnl = result.profit;
      localPnl += pnl;
      localBalance += pnl;

      const exitDigit = String(getLastDigit(result.sellPrice || 0));

      // Record sell transaction
      addTransaction({
        action: 'sell',
        amount: cStake,
        balance_after: localBalance,
        contract_id: contractId,
        profit_loss: pnl,
        description: `${won ? 'Win' : 'Loss'} on ${tradeSymbol} - ${contractType}`,
      });

      let switchInfo = `Pattern: ${patternDigits} | Exit: ${exitDigit}`;
      let shouldResetMartingale = false;
      
      if (won) {
        setWins(prev => prev + 1);
        if (inRecovery) {
          switchInfo += ' ✓ Recovery WIN → Back to M1';
          inRecovery = false;
          shouldResetMartingale = true;
        } else {
          switchInfo += ' ✓ WIN → Continue scanning';
          shouldResetMartingale = true;
        }
      } else {
        setLosses(prev => prev + 1);
        if (activeAccount?.is_virtual) {
          recordLoss(cStake, tradeSymbol, 6000);
        }
        
        if (martingaleOn && mStep < parseInt(martingaleMaxSteps)) {
          cStake = parseFloat((cStake * (parseFloat(martingaleMultiplier) || 2)).toFixed(2));
          mStep++;
          
          if (!inRecovery && m2Enabled) {
            inRecovery = true;
            switchInfo += ` ✗ Loss → Martingale (Step ${mStep}) → M2 Recovery`;
          } else if (!inRecovery && !m2Enabled) {
            switchInfo += ` ✗ Loss → Martingale (Step ${mStep}) → Continue M1`;
          } else if (inRecovery) {
            switchInfo += ` ✗ Loss → Martingale (Step ${mStep}) → Stay M2`;
          }
        } else {
          switchInfo += martingaleOn ? ` ✗ Loss → Max steps reached. Reset.` : ' ✗ Loss → Martingale disabled. Reset.';
          shouldResetMartingale = true;
          
          if (!inRecovery && m2Enabled) {
            inRecovery = true;
            switchInfo += ' → M2 Recovery';
          }
        }
      }
      
      if (shouldResetMartingale) {
        mStep = 0;
        cStake = baseStake;
      }

      setNetProfit(prev => prev + pnl);
      setMartingaleStepState(mStep);
      setCurrentStakeState(cStake);

      updateLog(logId, { exitDigit, result: won ? 'Win' : 'Loss', pnl, balance: localBalance, switchInfo });

      let shouldBreak = false;
      if (localPnl >= parseFloat(takeProfit)) {
        toast.success(`🎯 Take Profit! +$${localPnl.toFixed(2)}`);
        addJournalEntry('PROFIT', `Take profit reached: $${localPnl.toFixed(2)}`, { profit_loss: localPnl });
        shouldBreak = true;
      }
      if (localPnl <= -parseFloat(stopLoss)) {
        toast.error(`🛑 Stop Loss! $${localPnl.toFixed(2)}`);
        addJournalEntry('LOSS', `Stop loss reached: $${localPnl.toFixed(2)}`, { profit_loss: localPnl });
        shouldBreak = true;
      }
      if (localBalance < cStake) {
        toast.error('Insufficient balance');
        addJournalEntry('ERROR', 'Insufficient balance for next trade');
        shouldBreak = true;
      }

      return { localPnl, localBalance, cStake, mStep, inRecovery, shouldBreak };
    } catch (err: any) {
      updateLog(logId, { result: 'Loss', pnl: 0, exitDigit: '-', switchInfo: `Error: ${err.message}` });
      addJournalEntry('ERROR', `Trade failed: ${err.message}`, { contract_id: 0 });
      await new Promise(r => setTimeout(r, 2000));
      return { localPnl, localBalance, cStake, mStep, inRecovery, shouldBreak: false };
    }
  }, [addLog, updateLog, m2Enabled, martingaleOn, martingaleMultiplier, martingaleMaxSteps, takeProfit, stopLoss, activeAccount, recordLoss, addTransaction, addJournalEntry]);

  // Use the modified function
  const executeRealTrade = originalExecuteRealTrade;

  // ... KEEP ALL YOUR OTHER EXISTING FUNCTIONS (checkM1Pattern, checkM2Pattern, findM1Match, findM2Match, startBot, stopBot, etc.)
  // ... BUT make sure to use executeRealTrade as defined above

  // Now add the Tab UI at the bottom of your return statement, right before the closing div
  
  // ... Your existing return statement with all the bot UI, then add this:

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-4">
      <div className="space-y-3 max-w-7xl mx-auto">
        
        {/* TABS */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-4 bg-slate-800/50 border border-slate-700/50 rounded-xl p-1">
            <TabsTrigger value="bot" className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-cyan-500 data-[state=active]:to-blue-600">
              <Play className="w-4 h-4 mr-2" /> Bot
            </TabsTrigger>
            <TabsTrigger value="summary" className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-emerald-500 data-[state=active]:to-teal-600">
              <BarChart3 className="w-4 h-4 mr-2" /> Summary
            </TabsTrigger>
            <TabsTrigger value="transactions" className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-500 data-[state=active]:to-indigo-600">
              <History className="w-4 h-4 mr-2" /> Transactions
            </TabsTrigger>
            <TabsTrigger value="journal" className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-purple-500 data-[state=active]:to-pink-600">
              <BookOpen className="w-4 h-4 mr-2" /> Journal
            </TabsTrigger>
          </TabsList>

          {/* BOT TAB - Your existing UI */}
          <TabsContent value="bot" className="space-y-3 mt-3">
            {/* Copy all your existing bot UI here - Markets, Risk, Start/Stop button, etc. */}
            {/* ... existing bot UI code ... */}
          </TabsContent>

          {/* SUMMARY TAB */}
          <TabsContent value="summary" className="mt-3">
            <Card className="bg-gradient-to-br from-slate-900/90 to-slate-800/90 border-slate-700/50">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-slate-200">Trading Summary</CardTitle>
                  <Button variant="ghost" size="sm" onClick={clearAllData} className="text-slate-400 hover:text-rose-400">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
                <CardDescription>Performance statistics for this session</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Main Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-slate-800/50 rounded-lg p-3 text-center">
                    <div className="text-xs text-slate-400">Total Trades</div>
                    <div className="text-2xl font-bold text-slate-200">{summaryStats.total_trades}</div>
                  </div>
                  <div className="bg-slate-800/50 rounded-lg p-3 text-center">
                    <div className="text-xs text-slate-400">Win Rate</div>
                    <div className={`text-2xl font-bold ${summaryStats.win_rate >= 50 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {summaryStats.win_rate.toFixed(1)}%
                    </div>
                  </div>
                  <div className="bg-slate-800/50 rounded-lg p-3 text-center">
                    <div className="text-xs text-slate-400">Total P/L</div>
                    <div className={`text-2xl font-bold ${summaryStats.total_profit_loss >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      ${summaryStats.total_profit_loss.toFixed(2)}
                    </div>
                  </div>
                  <div className="bg-slate-800/50 rounded-lg p-3 text-center">
                    <div className="text-xs text-slate-400">Total Stake</div>
                    <div className="text-2xl font-bold text-slate-200">${summaryStats.total_stake.toFixed(2)}</div>
                  </div>
                </div>

                {/* Detailed Stats */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-slate-800/30 rounded-lg p-2">
                    <div className="text-xs text-slate-400">Wins / Losses</div>
                    <div className="text-lg font-mono font-bold">
                      <span className="text-emerald-400">{summaryStats.winning_trades}</span>
                      <span className="text-slate-500"> / </span>
                      <span className="text-rose-400">{summaryStats.losing_trades}</span>
                    </div>
                  </div>
                  <div className="bg-slate-800/30 rounded-lg p-2">
                    <div className="text-xs text-slate-400">Avg Win / Loss</div>
                    <div className="text-sm font-mono font-bold">
                      <span className="text-emerald-400">+${summaryStats.avg_profit.toFixed(2)}</span>
                      <span className="text-slate-500"> / </span>
                      <span className="text-rose-400">-${summaryStats.avg_loss.toFixed(2)}</span>
                    </div>
                  </div>
                  <div className="bg-slate-800/30 rounded-lg p-2">
                    <div className="text-xs text-slate-400">Best / Worst Streak</div>
                    <div className="text-sm font-mono font-bold">
                      <span className="text-emerald-400">{summaryStats.best_streak}W</span>
                      <span className="text-slate-500"> / </span>
                      <span className="text-rose-400">{summaryStats.worst_streak}L</span>
                    </div>
                  </div>
                  <div className="bg-slate-800/30 rounded-lg p-2">
                    <div className="text-xs text-slate-400">Current Streak</div>
                    <div className={`text-sm font-mono font-bold ${
                      summaryStats.current_streak_type === 'win' ? 'text-emerald-400' : 'text-rose-400'
                    }`}>
                      {summaryStats.current_streak} {summaryStats.current_streak_type?.toUpperCase() || '-'}
                    </div>
                  </div>
                  <div className="bg-slate-800/30 rounded-lg p-2">
                    <div className="text-xs text-slate-400">Largest Win</div>
                    <div className="text-sm font-mono font-bold text-emerald-400">
                      +${summaryStats.largest_win.toFixed(2)}
                    </div>
                  </div>
                  <div className="bg-slate-800/30 rounded-lg p-2">
                    <div className="text-xs text-slate-400">Largest Loss</div>
                    <div className="text-sm font-mono font-bold text-rose-400">
                      ${summaryStats.largest_loss.toFixed(2)}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* TRANSACTIONS TAB */}
          <TabsContent value="transactions" className="mt-3">
            <Card className="bg-gradient-to-br from-slate-900/90 to-slate-800/90 border-slate-700/50">
              <CardHeader>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <CardTitle className="text-slate-200">Transaction History</CardTitle>
                    <CardDescription>All buy/sell records</CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <div className="flex gap-1">
                      <Button size="sm" variant={transactionFilter === 'all' ? 'default' : 'outline'} onClick={() => setTransactionFilter('all')} className="h-8 px-2 text-xs">
                        All
                      </Button>
                      <Button size="sm" variant={transactionFilter === 'wins' ? 'default' : 'outline'} onClick={() => setTransactionFilter('wins')} className="h-8 px-2 text-xs bg-emerald-600 hover:bg-emerald-700">
                        Wins
                      </Button>
                      <Button size="sm" variant={transactionFilter === 'losses' ? 'default' : 'outline'} onClick={() => setTransactionFilter('losses')} className="h-8 px-2 text-xs bg-rose-600 hover:bg-rose-700">
                        Losses
                      </Button>
                    </div>
                    <Button size="sm" onClick={exportToCSV} className="h-8 px-2 text-xs">
                      <Download className="w-3 h-3 mr-1" /> Export
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="max-h-[400px] overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-slate-800/90">
                      <tr className="text-slate-400 border-b border-slate-700">
                        <th className="text-left p-2">Time</th>
                        <th className="text-left p-2">Action</th>
                        <th className="text-right p-2">Amount</th>
                        <th className="text-right p-2">P/L</th>
                        <th className="text-left p-2">Contract</th>
                      </tr>
                    </thead>
                    <tbody>
                      {getFilteredTransactions().slice(0, 50).map((tx) => (
                        <tr key={tx.transaction_id} className="border-b border-slate-700/50 hover:bg-slate-800/30 cursor-pointer" onClick={() => setShowTransactionDetails(showTransactionDetails === tx.transaction_id ? null : tx.transaction_id)}>
                          <td className="p-2 font-mono text-slate-400">{new Date(tx.transaction_time).toLocaleTimeString()}</td>
                          <td className="p-2">
                            <Badge variant="outline" className={`text-[10px] ${tx.action === 'buy' ? 'border-amber-500 text-amber-400' : 'border-cyan-500 text-cyan-400'}`}>
                              {tx.action}
                            </Badge>
                          </td>
                          <td className={`p-2 text-right font-mono font-bold ${tx.action === 'buy' ? 'text-amber-400' : 'text-cyan-400'}`}>
                            ${tx.amount.toFixed(2)}
                          </td>
                          <td className={`p-2 text-right font-mono font-bold ${tx.profit_loss > 0 ? 'text-emerald-400' : tx.profit_loss < 0 ? 'text-rose-400' : 'text-slate-400'}`}>
                            {tx.profit_loss !== 0 && (tx.profit_loss > 0 ? '+' : '')}{tx.profit_loss.toFixed(2)}
                          </td>
                          <td className="p-2 font-mono text-slate-400 text-[10px]">{tx.contract_id || '-'}</td>
                        </tr>
                      ))}
                      {getFilteredTransactions().length === 0 && (
                        <tr>
                          <td colSpan={5} className="text-center text-slate-500 py-8">No transactions yet</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* JOURNAL TAB */}
          <TabsContent value="journal" className="mt-3">
            <Card className="bg-gradient-to-br from-slate-900/90 to-slate-800/90 border-slate-700/50">
              <CardHeader>
                <CardTitle className="text-slate-200">Trading Journal</CardTitle>
                <CardDescription>Real-time activity log</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 max-h-[400px] overflow-y-auto">
                  {journalEntries.map((entry) => (
                    <div key={entry.id} className={`p-3 rounded-lg border-l-4 ${
                      entry.type === 'PROFIT' ? 'border-l-emerald-500 bg-emerald-500/5' :
                      entry.type === 'LOSS' ? 'border-l-rose-500 bg-rose-500/5' :
                      entry.type === 'BUY' ? 'border-l-blue-500 bg-blue-500/5' :
                      entry.type === 'SELL' ? 'border-l-cyan-500 bg-cyan-500/5' :
                      entry.type === 'ERROR' ? 'border-l-red-500 bg-red-500/5' :
                      'border-l-slate-500 bg-slate-500/5'
                    }`}>
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge className={`text-[9px] ${
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
                            <div className="text-[9px] font-mono text-slate-500 mt-1">ID: {entry.contract_id}</div>
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
                  ))}
                  {journalEntries.length === 0 && (
                    <div className="text-center text-slate-500 py-8">No journal entries yet</div>
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
