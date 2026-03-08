import { motion } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { Activity, Shield, TrendingUp, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import bgHero from '@/assets/bg-hero.jpeg';

export default function LoginPage() {
  const { login, isLoading } = useAuth();

  const affiliateUrl = 'https://partners.deriv.com/rx?sidc=12B9BBE9-886B-4B0A-A906-B5FC911F276A&utm_campaign=dynamicworks&utm_medium=affiliate&utm_source=CU15839';

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background image */}
      <div className="absolute inset-0 z-0">
        <img src={bgHero} alt="" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-background/40" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: 'easeOut' }}
        className="w-full max-w-md relative z-10"
      >
        {/* Logo / Brand */}
        <div className="text-center mb-10">
          <motion.div
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.2, type: 'spring', stiffness: 200 }}
            className="inline-flex items-center gap-3 mb-4"
          >
            <div className="w-14 h-14 rounded-2xl gradient-primary flex items-center justify-center glow-primary shadow-lg">
              <Activity className="w-7 h-7 text-primary-foreground" />
            </div>
            <div className="text-left">
              <h1 className="text-3xl font-bold text-foreground leading-tight">
                Ceoramz<span className="text-primary">Traders</span>
              </h1>
              <p className="text-xs text-muted-foreground -mt-0.5">ramztrader.site</p>
            </div>
          </motion.div>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="text-muted-foreground text-sm max-w-xs mx-auto"
          >
            Advanced Digit Analysis & Auto-Trading Platform
          </motion.p>
        </div>

        {/* Login Card */}
        <motion.div
          initial={{ opacity: 0, y: 15, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="bg-card border border-border rounded-2xl p-8 glow-primary backdrop-blur-sm"
        >
          {/* Features */}
          <div className="grid grid-cols-2 gap-3 mb-8">
            {[
              { icon: TrendingUp, label: 'Live Analysis', desc: 'Real-time signals' },
              { icon: Zap, label: 'Auto Trading', desc: 'Smart bots' },
              { icon: Shield, label: 'Secure Login', desc: 'Deriv OAuth' },
              { icon: Activity, label: 'Live Data', desc: 'Tick-by-tick' },
            ].map((feature, i) => (
              <motion.div
                key={feature.label}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 + i * 0.1 }}
                className="flex items-center gap-3 text-sm bg-muted/30 rounded-xl p-3 border border-border/50 hover:border-primary/30 transition-colors"
              >
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <feature.icon className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <div className="font-medium text-foreground text-xs">{feature.label}</div>
                  <div className="text-[10px] text-muted-foreground">{feature.desc}</div>
                </div>
              </motion.div>
            ))}
          </div>

          {/* Login Button */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.9 }}
          >
            <Button
              onClick={login}
              disabled={isLoading}
              className="w-full h-12 text-base font-semibold gradient-primary text-primary-foreground hover:opacity-90 transition-all glow-primary rounded-xl"
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

            {/* Create Account Link */}
            <div className="text-center mt-4 pt-4 border-t border-border/50">
              <p className="text-xs text-muted-foreground mb-2">Don't have a Deriv account?</p>
              <a
                href={affiliateUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:text-primary/80 transition-colors"
              >
                Create Free Account
                <TrendingUp className="w-3.5 h-3.5" />
              </a>
            </div>
          </motion.div>
        </motion.div>
      </motion.div>
    </div>
  );
}
