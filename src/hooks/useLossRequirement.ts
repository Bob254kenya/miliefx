import { useState, useCallback, useEffect } from 'react';

const STORAGE_KEY = 'loss_requirement_state';
const MIN_TRADE_DURATION_MS = 5000;

interface LossState {
  currentLossCount: number;
  requiredLosses: number;
  tradeHistory: { timestamp: number; stake: number; symbol: string; duration: number }[];
  unlocked: boolean;
}

function loadState(): LossState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { currentLossCount: 0, requiredLosses: 5, tradeHistory: [], unlocked: false };
}

function saveState(state: LossState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function useLossRequirement() {
  const [state, setState] = useState<LossState>(loadState);

  useEffect(() => { saveState(state); }, [state]);

  const remaining = Math.max(0, state.requiredLosses - state.currentLossCount);
  const isUnlocked = state.currentLossCount >= state.requiredLosses;

  const recordLoss = useCallback((stake: number, symbol: string, durationMs: number) => {
    setState(prev => {
      // Anti-gaming: minimum duration
      if (durationMs < MIN_TRADE_DURATION_MS) return prev;
      // Anti-gaming: minimum stake
      if (stake < 0.35) return prev;
      // Anti-gaming: no duplicate rapid trades (same symbol within 3s)
      const now = Date.now();
      const recent = prev.tradeHistory.filter(t => now - t.timestamp < 3000 && t.symbol === symbol);
      if (recent.length > 0) return prev;
      // Anti-gaming: require at least 2 different symbols across all losses
      const allSymbols = new Set(prev.tradeHistory.map(t => t.symbol));
      allSymbols.add(symbol);
      // Only enforce variation after 3 losses
      if (prev.currentLossCount >= 3 && allSymbols.size < 2) return prev;

      const newCount = prev.currentLossCount + 1;
      const newHistory = [...prev.tradeHistory, { timestamp: now, stake, symbol, duration: durationMs }].slice(-50);
      return {
        ...prev,
        currentLossCount: newCount,
        tradeHistory: newHistory,
        unlocked: newCount >= prev.requiredLosses,
      };
    });
  }, []);

  const setRequiredLosses = useCallback((n: number) => {
    setState(prev => ({
      ...prev,
      requiredLosses: Math.max(1, n),
      unlocked: prev.currentLossCount >= Math.max(1, n),
    }));
  }, []);

  const resetProgress = useCallback(() => {
    setState(prev => ({
      ...prev,
      currentLossCount: 0,
      tradeHistory: [],
      unlocked: false,
    }));
  }, []);

  return {
    currentLossCount: state.currentLossCount,
    requiredLosses: state.requiredLosses,
    remaining,
    isUnlocked,
    recordLoss,
    setRequiredLosses,
    resetProgress,
  };
}
