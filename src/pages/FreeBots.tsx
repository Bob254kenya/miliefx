import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Gift, Play, Shield, Zap, TrendingUp, TrendingDown, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import type { BotConfig } from '@/components/bot-config/ConfigPreview';

interface FreeBotTemplate {
  config: BotConfig & { botName: string };
  description: string;
  tags: string[];
  icon: React.ReactNode;
  gradient: string;
  risk: 'Low' | 'Medium' | 'High';
}

const FREE_BOTS: FreeBotTemplate[] = [
  {
    config: {"version":1,"botName":"OVER 2 RECOVERY OVER 4 BOT","m1":{"enabled":true,"symbol":"1HZ100V","contract":"DIGITOVER","barrier":"2","hookEnabled":true,"virtualLossCount":"2","realCount":"1"},"m2":{"enabled":true,"symbol":"R_100","contract":"DIGITOVER","barrier":"4","hookEnabled":false,"virtualLossCount":"3","realCount":"2"},"risk":{"stake":"0.5","martingaleOn":true,"martingaleMultiplier":"2.0","martingaleMaxSteps":"5","takeProfit":"10","stopLoss":"5"},"strategy":{"m1Enabled":false,"m2Enabled":true,"m1Mode":"pattern","m2Mode":"digit","m1Pattern":"","m1DigitCondition":"==","m1DigitCompare":"5","m1DigitWindow":"3","m2Pattern":"EEEOEEOE","m2DigitCondition":"<=","m2DigitCompare":"4","m2DigitWindow":"6"},"scanner":{"active":true},"turbo":{"enabled":true}},
    description: 'M1 trades Over 2 on V100 1s with Virtual Hook. Recovery switches to Over 4 on Vol 100 with digit strategy.',
    tags: ['Over', 'Recovery', 'Virtual Hook', 'Martingale'],
    icon: <TrendingUp className="w-5 h-5" />,
    gradient: 'from-emerald-500/20 to-emerald-600/5',
    risk: 'Medium',
  },
  {
    config: {"version":1,"botName":"OVER 1 RECOVERY ODD BOT","m1":{"enabled":true,"symbol":"1HZ100V","contract":"DIGITOVER","barrier":"1","hookEnabled":true,"virtualLossCount":"1","realCount":"1"},"m2":{"enabled":true,"symbol":"R_100","contract":"DIGITODD","barrier":"4","hookEnabled":false,"virtualLossCount":"3","realCount":"2"},"risk":{"stake":"0.5","martingaleOn":true,"martingaleMultiplier":"2.0","martingaleMaxSteps":"5","takeProfit":"10","stopLoss":"5"},"strategy":{"m1Enabled":false,"m2Enabled":true,"m1Mode":"pattern","m2Mode":"pattern","m1Pattern":"","m1DigitCondition":"==","m1DigitCompare":"5","m1DigitWindow":"3","m2Pattern":"EEEOEEOE","m2DigitCondition":"<=","m2DigitCompare":"4","m2DigitWindow":"6"},"scanner":{"active":true},"turbo":{"enabled":true}},
    description: 'M1 enters Over 1 with Virtual Hook on V100 1s. Recovery market uses Odd pattern strategy on Vol 100.',
    tags: ['Over', 'Odd', 'Virtual Hook', 'Pattern'],
    icon: <Zap className="w-5 h-5" />,
    gradient: 'from-blue-500/20 to-blue-600/5',
    risk: 'Low',
  },
  {
    config: {"version":1,"botName":"OVER 1 RECOVERY EVEN BOT","m1":{"enabled":true,"symbol":"1HZ100V","contract":"DIGITOVER","barrier":"1","hookEnabled":true,"virtualLossCount":"1","realCount":"1"},"m2":{"enabled":true,"symbol":"R_100","contract":"DIGITEVEN","barrier":"4","hookEnabled":false,"virtualLossCount":"3","realCount":"2"},"risk":{"stake":"0.5","martingaleOn":true,"martingaleMultiplier":"2.0","martingaleMaxSteps":"5","takeProfit":"10","stopLoss":"5"},"strategy":{"m1Enabled":false,"m2Enabled":true,"m1Mode":"pattern","m2Mode":"pattern","m1Pattern":"","m1DigitCondition":"==","m1DigitCompare":"5","m1DigitWindow":"3","m2Pattern":"OOOOEOEOE","m2DigitCondition":"<=","m2DigitCompare":"4","m2DigitWindow":"6"},"scanner":{"active":true},"turbo":{"enabled":true}},
    description: 'M1 enters Over 1 with Virtual Hook. Recovery uses Even pattern on Vol 100 with OOOOEOEOE sequence.',
    tags: ['Over', 'Even', 'Virtual Hook', 'Pattern'],
    icon: <Layers className="w-5 h-5" />,
    gradient: 'from-violet-500/20 to-violet-600/5',
    risk: 'Low',
  },
  {
    config: {"version":1,"botName":"EVEN BOT","m1":{"enabled":false,"symbol":"1HZ100V","contract":"DIGITOVER","barrier":"1","hookEnabled":true,"virtualLossCount":"1","realCount":"1"},"m2":{"enabled":true,"symbol":"R_100","contract":"DIGITEVEN","barrier":"4","hookEnabled":false,"virtualLossCount":"3","realCount":"2"},"risk":{"stake":"0.5","martingaleOn":true,"martingaleMultiplier":"2.0","martingaleMaxSteps":"5","takeProfit":"10","stopLoss":"5"},"strategy":{"m1Enabled":false,"m2Enabled":true,"m1Mode":"pattern","m2Mode":"pattern","m1Pattern":"","m1DigitCondition":"==","m1DigitCompare":"5","m1DigitWindow":"3","m2Pattern":"OOOOEOEO","m2DigitCondition":"<=","m2DigitCompare":"4","m2DigitWindow":"6"},"scanner":{"active":true},"turbo":{"enabled":true}},
    description: 'Single-market Even bot on Vol 100. Uses OOOOEOEO pattern matching with martingale recovery.',
    tags: ['Even', 'Pattern', 'Single Market', 'Martingale'],
    icon: <Shield className="w-5 h-5" />,
    gradient: 'from-cyan-500/20 to-cyan-600/5',
    risk: 'Medium',
  },
  {
    config: {"version":1,"botName":"ODD BOT","m1":{"enabled":false,"symbol":"1HZ100V","contract":"DIGITOVER","barrier":"1","hookEnabled":false,"virtualLossCount":"1","realCount":"1"},"m2":{"enabled":true,"symbol":"R_100","contract":"DIGITEVEN","barrier":"4","hookEnabled":false,"virtualLossCount":"3","realCount":"2"},"risk":{"stake":"0.5","martingaleOn":true,"martingaleMultiplier":"2.0","martingaleMaxSteps":"5","takeProfit":"10","stopLoss":"5"},"strategy":{"m1Enabled":false,"m2Enabled":true,"m1Mode":"pattern","m2Mode":"pattern","m1Pattern":"","m1DigitCondition":"==","m1DigitCompare":"5","m1DigitWindow":"3","m2Pattern":"EEEEEOEO","m2DigitCondition":"<=","m2DigitCompare":"4","m2DigitWindow":"6"},"scanner":{"active":true},"turbo":{"enabled":true}},
    description: 'Single-market Odd bot on Vol 100. Pattern-based with EEEEEOEO sequence and martingale.',
    tags: ['Odd', 'Pattern', 'Single Market', 'Martingale'],
    icon: <TrendingDown className="w-5 h-5" />,
    gradient: 'from-orange-500/20 to-orange-600/5',
    risk: 'Medium',
  },
  {
    config: {"version":1,"botName":"OVER 2 BOT","m1":{"enabled":false,"symbol":"1HZ100V","contract":"DIGITOVER","barrier":"1","hookEnabled":false,"virtualLossCount":"1","realCount":"1"},"m2":{"enabled":true,"symbol":"R_100","contract":"DIGITOVER","barrier":"2","hookEnabled":false,"virtualLossCount":"3","realCount":"2"},"risk":{"stake":"0.5","martingaleOn":true,"martingaleMultiplier":"2.0","martingaleMaxSteps":"5","takeProfit":"10","stopLoss":"5"},"strategy":{"m1Enabled":false,"m2Enabled":true,"m1Mode":"pattern","m2Mode":"digit","m1Pattern":"","m1DigitCondition":"==","m1DigitCompare":"5","m1DigitWindow":"3","m2Pattern":"EEEEEOEO","m2DigitCondition":"<=","m2DigitCompare":"2","m2DigitWindow":"4"},"scanner":{"active":true},"turbo":{"enabled":true}},
    description: 'Simple Over 2 digit strategy on Vol 100. Enters when last 4 digits are ≤ 2. Turbo + scanner enabled.',
    tags: ['Over', 'Digit', 'Simple', 'Turbo'],
    icon: <TrendingUp className="w-5 h-5" />,
    gradient: 'from-green-500/20 to-green-600/5',
    risk: 'Low',
  },
  {
    config: {"version":1,"botName":"UNDER 7 BOT","m1":{"enabled":false,"symbol":"1HZ100V","contract":"DIGITOVER","barrier":"1","hookEnabled":false,"virtualLossCount":"1","realCount":"1"},"m2":{"enabled":true,"symbol":"R_100","contract":"DIGITUNDER","barrier":"7","hookEnabled":false,"virtualLossCount":"3","realCount":"2"},"risk":{"stake":"0.5","martingaleOn":true,"martingaleMultiplier":"2.0","martingaleMaxSteps":"5","takeProfit":"10","stopLoss":"5"},"strategy":{"m1Enabled":false,"m2Enabled":true,"m1Mode":"pattern","m2Mode":"digit","m1Pattern":"","m1DigitCondition":"==","m1DigitCompare":"5","m1DigitWindow":"3","m2Pattern":"EEEEEOEO","m2DigitCondition":">=","m2DigitCompare":"8","m2DigitWindow":"3"},"scanner":{"active":true},"turbo":{"enabled":true}},
    description: 'Under 7 digit strategy on Vol 100. Enters when last 3 digits are ≥ 8. Great reversal setup.',
    tags: ['Under', 'Digit', 'Reversal', 'Turbo'],
    icon: <TrendingDown className="w-5 h-5" />,
    gradient: 'from-red-500/20 to-red-600/5',
    risk: 'Medium',
  },
];

const riskColor = (r: string) =>
  r === 'Low' ? 'text-profit bg-profit/10 border-profit/20' :
  r === 'Medium' ? 'text-warning bg-warning/10 border-warning/20' :
  'text-loss bg-loss/10 border-loss/20';

export default function FreeBots() {
  const navigate = useNavigate();

  const handleLoad = (bot: FreeBotTemplate) => {
    navigate('/', { state: { loadConfig: bot.config } });
    toast.success(`"${bot.config.botName}" loaded into Pro Scanner Bot`);
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <Gift className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground">Free Bot Templates</h1>
          <p className="text-xs text-muted-foreground">
            Pre-configured strategies — tap "Load Bot" to use in Pro Scanner Bot
          </p>
        </div>
      </div>

      {/* Bot Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {FREE_BOTS.map((bot, i) => (
          <motion.div
            key={bot.config.botName}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
            className={`group relative bg-card border border-border rounded-xl overflow-hidden hover:border-primary/40 transition-colors`}
          >
            {/* Gradient top strip */}
            <div className={`h-1.5 bg-gradient-to-r ${bot.gradient}`} />

            <div className="p-4 space-y-3">
              {/* Title row */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${bot.gradient} flex items-center justify-center text-foreground`}>
                    {bot.icon}
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-foreground leading-tight">{bot.config.botName}</h3>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ${riskColor(bot.risk)}`}>
                        {bot.risk} Risk
                      </Badge>
                      {bot.config.m1.enabled && bot.config.m2.enabled && (
                        <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-primary border-primary/20">
                          Dual Market
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Description */}
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {bot.description}
              </p>

              {/* Config summary */}
              <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                <div className="bg-muted/50 rounded px-2 py-1">
                  <span className="text-muted-foreground">Stake:</span>{' '}
                  <span className="font-mono font-semibold text-foreground">${bot.config.risk.stake}</span>
                </div>
                <div className="bg-muted/50 rounded px-2 py-1">
                  <span className="text-muted-foreground">TP/SL:</span>{' '}
                  <span className="font-mono font-semibold text-profit">${bot.config.risk.takeProfit}</span>
                  <span className="text-muted-foreground">/</span>
                  <span className="font-mono font-semibold text-loss">${bot.config.risk.stopLoss}</span>
                </div>
                <div className="bg-muted/50 rounded px-2 py-1">
                  <span className="text-muted-foreground">Contract:</span>{' '}
                  <span className="font-semibold text-foreground">{bot.config.m2.contract.replace('DIGIT', '')}</span>
                </div>
                <div className="bg-muted/50 rounded px-2 py-1">
                  <span className="text-muted-foreground">Martingale:</span>{' '}
                  <span className="font-semibold text-foreground">
                    {bot.config.risk.martingaleOn ? `×${bot.config.risk.martingaleMultiplier}` : 'Off'}
                  </span>
                </div>
              </div>

              {/* Tags */}
              <div className="flex flex-wrap gap-1">
                {bot.tags.map(tag => (
                  <span key={tag} className="text-[9px] bg-muted rounded-full px-2 py-0.5 text-muted-foreground">
                    {tag}
                  </span>
                ))}
              </div>

              {/* Load Button */}
              <Button
                onClick={() => handleLoad(bot)}
                className="w-full h-8 text-xs font-bold bg-primary hover:bg-primary/90 text-primary-foreground gap-1.5"
              >
                <Play className="w-3.5 h-3.5" /> Load Bot
              </Button>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
