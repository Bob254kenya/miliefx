import { motion } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { Activity, Shield, TrendingUp, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function LoginPage() {
  const { login, isLoading } = useAuth();

  return (
    <div className="min-h-screen bg-background trading-grid flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="w-full max-w-md"
      >
        {/* Logo / Brand */}
        <div className="text-center mb-8">
          <motion.div
            initial={{ scale: 0.8 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="inline-flex items-center gap-3 mb-4"
          >
            <div className="w-12 h-12 rounded-xl gradient-primary flex items-center justify-center glow-primary">
              <Activity className="w-6 h-6 text-primary-foreground" />
            </div>
            <h1 className="text-3xl font-bold text-foreground">
              Digit<span className="text-primary">Edge</span>
            </h1>
          </motion.div>
          <p className="text-muted-foreground text-sm">
            Advanced Digit Analysis & Auto-Trading Platform
          </p>
        </div>

        {/* Login Card */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="bg-card border border-border rounded-2xl p-8 glow-primary"
        >
          {/* Features */}
          <div className="grid grid-cols-2 gap-3 mb-8">
            {[
              { icon: TrendingUp, label: 'Live Analysis' },
              { icon: Zap, label: 'Auto Trading' },
              { icon: Shield, label: 'Secure OAuth' },
              { icon: Activity, label: 'Real-time Data' },
            ].map((feature, i) => (
              <motion.div
                key={feature.label}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.4 + i * 0.1 }}
                className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded-lg p-3"
              >
                <feature.icon className="w-4 h-4 text-primary" />
                <span>{feature.label}</span>
              </motion.div>
            ))}
          </div>

          {/* Login Button */}
          <Button
            onClick={login}
            disabled={isLoading}
            className="w-full h-12 text-base font-semibold gradient-primary text-primary-foreground hover:opacity-90 transition-opacity glow-primary"
            size="lg"
          >
            {isLoading ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                Connecting...
              </span>
            ) : (
              'Login with Deriv'
            )}
          </Button>

          <p className="text-xs text-muted-foreground text-center mt-4">
            Securely authenticate via Deriv OAuth 2.0
          </p>
        </motion.div>
      </motion.div>
    </div>
  );
}
