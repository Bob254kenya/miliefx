import { motion } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { useLossRequirement } from '@/hooks/useLossRequirement';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Shield, RotateCcw, CheckCircle } from 'lucide-react';

export default function SettingsPage() {
  const { activeAccount, accountInfo } = useAuth();
  const {
    currentLossCount, requiredLosses, remaining,
    setRequiredLosses, resetProgress,
  } = useLossRequirement();

  const progress = requiredLosses > 0 ? Math.min(100, (currentLossCount / requiredLosses) * 100) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground">Account information and preferences</p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-card border border-border rounded-xl p-6 space-y-4 max-w-lg"
      >
        <h2 className="font-semibold text-foreground">Account Details</h2>
        {[
          { label: 'Name', value: accountInfo?.fullname || '-' },
          { label: 'Email', value: accountInfo?.email || '-' },
          { label: 'Login ID', value: activeAccount?.loginid || '-' },
          { label: 'Account Type', value: activeAccount?.is_virtual ? 'Demo' : 'Real' },
          { label: 'Currency', value: activeAccount?.currency || '-' },
        ].map(item => (
          <div key={item.label} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
            <span className="text-sm text-muted-foreground">{item.label}</span>
            <span className="text-sm font-mono text-foreground">{item.value}</span>
          </div>
        ))}
      </motion.div>

      {/* Virtual Trading Stats */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-card border border-border rounded-xl p-6 space-y-5 max-w-lg"
      >
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-primary" />
          <h2 className="font-semibold text-foreground">Virtual Trading Stats</h2>
        </div>

        {/* Status Badge - Always unlocked */}
        <div className="flex items-center gap-2 p-3 rounded-lg border bg-profit/10 border-profit/30">
          <CheckCircle className="w-4 h-4 text-profit" />
          <span className="text-sm font-semibold text-profit">Real Trading Available</span>
        </div>

        {/* Progress - Now just for tracking */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Virtual Losses Tracked</span>
            <span className="font-mono font-bold text-foreground">{currentLossCount} / {requiredLosses}</span>
          </div>
          <Progress value={progress} className="h-3" />
          <p className="text-xs text-muted-foreground">
            You've experienced <span className="font-bold text-foreground">{currentLossCount}</span> virtual loss{currentLossCount !== 1 ? 'es' : ''}. 
            {remaining > 0 && ` ${remaining} more to reach target.`}
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-muted/30 rounded-lg p-3 text-center">
            <div className="text-[10px] text-muted-foreground uppercase">Target</div>
            <div className="font-mono text-lg font-bold text-foreground">{requiredLosses}</div>
          </div>
          <div className="bg-muted/30 rounded-lg p-3 text-center">
            <div className="text-[10px] text-muted-foreground uppercase">Current</div>
            <div className="font-mono text-lg font-bold text-loss">{currentLossCount}</div>
          </div>
          <div className="bg-muted/30 rounded-lg p-3 text-center">
            <div className="text-[10px] text-muted-foreground uppercase">To Target</div>
            <div className="font-mono text-lg font-bold text-warning">{remaining}</div>
          </div>
        </div>

        {/* Config */}
        <div className="space-y-3 border-t border-border pt-4">
          <h3 className="text-sm font-semibold text-foreground">Loss Tracking Settings</h3>
          <div>
            <label className="text-xs text-muted-foreground">Target Losses for Tracking</label>
            <Input
              type="number" min="1" max="50"
              value={requiredLosses}
              onChange={e => setRequiredLosses(parseInt(e.target.value) || 5)}
              className="h-9 text-sm mt-1"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={resetProgress}
            className="text-xs gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset Loss Counter
          </Button>
        </div>

        {/* Info - Updated message */}
        <div className="bg-muted/20 border border-border/50 rounded-lg p-3 text-[11px] text-muted-foreground space-y-1">
          <p className="font-semibold text-foreground text-xs">Virtual Trading Stats</p>
          <p>• Trades must last at least 5 seconds to count</p>
          <p>• Minimum stake of $0.35 required</p>
          <p>• Rapid duplicate trades on the same symbol are ignored</p>
          <p>• After 3 losses, trades from multiple symbols are required</p>
          <p className="text-profit mt-2">✓ Real trading is always available - this is just for tracking</p>
        </div>
      </motion.div>
    </div>
  );
}
