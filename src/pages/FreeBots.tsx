import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Gift, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import type { BotConfig } from '@/components/bot-config/ConfigPreview';

interface FreeBotTemplate {
  config: BotConfig & { botName: string };
  description: string;
  premium?: boolean;
}

const FREE_BOTS: FreeBotTemplate[] = [
  {
    config: {"version":1,"botName":"Over 2 Recovery Over 4 Bot","m1":{"enabled":true,"symbol":"1HZ100V","contract":"DIGITOVER","barrier":"2","hookEnabled":true,"virtualLossCount":"2","realCount":"1"},"m2":{"enabled":true,"symbol":"R_100","contract":"DIGITOVER","barrier":"4","hookEnabled":false,"virtualLossCount":"3","realCount":"2"},"risk":{"stake":"0.5","martingaleOn":true,"martingaleMultiplier":"2.0","martingaleMaxSteps":"5","takeProfit":"10","stopLoss":"5"},"strategy":{"m1Enabled":false,"m2Enabled":true,"m1Mode":"pattern","m2Mode":"digit","m1Pattern":"","m1DigitCondition":"==","m1DigitCompare":"5","m1DigitWindow":"3","m2Pattern":"EEEOEEOE","m2DigitCondition":"<=","m2DigitCompare":"4","m2DigitWindow":"6"},"scanner":{"active":true},"turbo":{"enabled":true}},
    description: 'M1 trades Over 2 on V100 1s with Virtual Hook. Recovery switches to Over 4 on Vol 100 with digit strategy.',
  },
  {
    config: {"version":1,"botName":"Over 1 Recovery Odd Bot","m1":{"enabled":true,"symbol":"1HZ100V","contract":"DIGITOVER","barrier":"1","hookEnabled":true,"virtualLossCount":"1","realCount":"1"},"m2":{"enabled":true,"symbol":"R_100","contract":"DIGITODD","barrier":"4","hookEnabled":false,"virtualLossCount":"3","realCount":"2"},"risk":{"stake":"0.5","martingaleOn":true,"martingaleMultiplier":"2.0","martingaleMaxSteps":"5","takeProfit":"10","stopLoss":"5"},"strategy":{"m1Enabled":false,"m2Enabled":true,"m1Mode":"pattern","m2Mode":"pattern","m1Pattern":"","m1DigitCondition":"==","m1DigitCompare":"5","m1DigitWindow":"3","m2Pattern":"EEEOEEOE","m2DigitCondition":"<=","m2DigitCompare":"4","m2DigitWindow":"6"},"scanner":{"active":true},"turbo":{"enabled":true}},
    description: 'M1 enters Over 1 with Virtual Hook on V100 1s. Recovery market uses Odd pattern strategy on Vol 100.',
  },
  {
    config: {"version":1,"botName":"Over 1 Recovery Even Bot","m1":{"enabled":true,"symbol":"1HZ100V","contract":"DIGITOVER","barrier":"1","hookEnabled":true,"virtualLossCount":"1","realCount":"1"},"m2":{"enabled":true,"symbol":"R_100","contract":"DIGITEVEN","barrier":"4","hookEnabled":false,"virtualLossCount":"3","realCount":"2"},"risk":{"stake":"0.5","martingaleOn":true,"martingaleMultiplier":"2.0","martingaleMaxSteps":"5","takeProfit":"10","stopLoss":"5"},"strategy":{"m1Enabled":false,"m2Enabled":true,"m1Mode":"pattern","m2Mode":"pattern","m1Pattern":"","m1DigitCondition":"==","m1DigitCompare":"5","m1DigitWindow":"3","m2Pattern":"OOOOEOEOE","m2DigitCondition":"<=","m2DigitCompare":"4","m2DigitWindow":"6"},"scanner":{"active":true},"turbo":{"enabled":true}},
    description: 'M1 enters Over 1 with Virtual Hook. Recovery uses Even pattern on Vol 100 with OOOOEOEOE sequence.',
  },
  {
    config: {"version":1,"botName":"Even Bot","m1":{"enabled":false,"symbol":"1HZ100V","contract":"DIGITOVER","barrier":"1","hookEnabled":true,"virtualLossCount":"1","realCount":"1"},"m2":{"enabled":true,"symbol":"R_100","contract":"DIGITEVEN","barrier":"4","hookEnabled":false,"virtualLossCount":"3","realCount":"2"},"risk":{"stake":"0.5","martingaleOn":true,"martingaleMultiplier":"2.0","martingaleMaxSteps":"5","takeProfit":"10","stopLoss":"5"},"strategy":{"m1Enabled":false,"m2Enabled":true,"m1Mode":"pattern","m2Mode":"pattern","m1Pattern":"","m1DigitCondition":"==","m1DigitCompare":"5","m1DigitWindow":"3","m2Pattern":"OOOOEOEO","m2DigitCondition":"<=","m2DigitCompare":"4","m2DigitWindow":"6"},"scanner":{"active":true},"turbo":{"enabled":true}},
    description: 'Single-market Even bot on Vol 100. Uses OOOOEOEO pattern matching with martingale recovery.',
  },
  {
    config: {"version":1,"botName":"Odd Bot","m1":{"enabled":false,"symbol":"1HZ100V","contract":"DIGITOVER","barrier":"1","hookEnabled":false,"virtualLossCount":"1","realCount":"1"},"m2":{"enabled":true,"symbol":"R_100","contract":"DIGITEVEN","barrier":"4","hookEnabled":false,"virtualLossCount":"3","realCount":"2"},"risk":{"stake":"0.5","martingaleOn":true,"martingaleMultiplier":"2.0","martingaleMaxSteps":"5","takeProfit":"10","stopLoss":"5"},"strategy":{"m1Enabled":false,"m2Enabled":true,"m1Mode":"pattern","m2Mode":"pattern","m1Pattern":"","m1DigitCondition":"==","m1DigitCompare":"5","m1DigitWindow":"3","m2Pattern":"EEEEEOEO","m2DigitCondition":"<=","m2DigitCompare":"4","m2DigitWindow":"6"},"scanner":{"active":true},"turbo":{"enabled":true}},
    description: 'Single-market Odd bot on Vol 100. Pattern-based with EEEEEOEO sequence and martingale.',
  },
  {
    config: {"version":1,"botName":"Over 2 Bot","m1":{"enabled":false,"symbol":"1HZ100V","contract":"DIGITOVER","barrier":"1","hookEnabled":false,"virtualLossCount":"1","realCount":"1"},"m2":{"enabled":true,"symbol":"R_100","contract":"DIGITOVER","barrier":"2","hookEnabled":false,"virtualLossCount":"3","realCount":"2"},"risk":{"stake":"0.5","martingaleOn":true,"martingaleMultiplier":"2.0","martingaleMaxSteps":"5","takeProfit":"10","stopLoss":"5"},"strategy":{"m1Enabled":false,"m2Enabled":true,"m1Mode":"pattern","m2Mode":"digit","m1Pattern":"","m1DigitCondition":"==","m1DigitCompare":"5","m1DigitWindow":"3","m2Pattern":"EEEEEOEO","m2DigitCondition":"<=","m2DigitCompare":"2","m2DigitWindow":"4"},"scanner":{"active":true},"turbo":{"enabled":true}},
    description: 'Simple Over 2 digit strategy on Vol 100. Enters when last 4 digits are ≤ 2. Turbo + scanner enabled.',
  },
  {
    config: {"version":1,"botName":"Under 7 Bot","m1":{"enabled":false,"symbol":"1HZ100V","contract":"DIGITOVER","barrier":"1","hookEnabled":false,"virtualLossCount":"1","realCount":"1"},"m2":{"enabled":true,"symbol":"R_100","contract":"DIGITUNDER","barrier":"7","hookEnabled":false,"virtualLossCount":"3","realCount":"2"},"risk":{"stake":"0.5","martingaleOn":true,"martingaleMultiplier":"2.0","martingaleMaxSteps":"5","takeProfit":"10","stopLoss":"5"},"strategy":{"m1Enabled":false,"m2Enabled":true,"m1Mode":"pattern","m2Mode":"digit","m1Pattern":"","m1DigitCondition":"==","m1DigitCompare":"5","m1DigitWindow":"3","m2Pattern":"EEEEEOEO","m2DigitCondition":">=","m2DigitCompare":"8","m2DigitWindow":"3"},"scanner":{"active":true},"turbo":{"enabled":true}},
    description: 'Under 7 digit strategy on Vol 100. Enters when last 3 digits are ≥ 8. Great reversal setup.',
  },
];

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
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {FREE_BOTS.map((bot, i) => (
          <motion.div
            key={bot.config.botName}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.07 }}
            className="relative rounded-xl border-2 border-warning/60 bg-gradient-to-br from-amber-50 to-orange-50 dark:from-warning/5 dark:to-amber-900/10 overflow-hidden shadow-md hover:shadow-lg hover:border-warning transition-all"
          >
            {/* Premium-style ribbon */}
            <div className="absolute top-0 right-0 z-10">
              <div className="relative">
                <div className="bg-gradient-to-r from-red-500 to-red-600 text-white text-[10px] font-bold px-3 py-0.5 rounded-bl-lg shadow-sm tracking-wider uppercase">
                  Free
                </div>
                <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 text-warning">★</div>
              </div>
            </div>

            <div className="p-5 space-y-3">
              {/* Bot Name */}
              <h3 className="text-base font-extrabold text-foreground leading-tight pr-14">
                {bot.config.botName}
              </h3>

              {/* Description */}
              <p className="text-xs text-muted-foreground leading-relaxed min-h-[40px]">
                {bot.description}
              </p>

              {/* Load Button */}
              <div className="pt-1">
                <Button
                  onClick={() => handleLoad(bot)}
                  className="h-9 px-5 text-xs font-bold bg-primary hover:bg-primary/90 text-primary-foreground rounded-md shadow-sm"
                >
                  <Play className="w-3.5 h-3.5 mr-1.5 fill-current" />
                  Load Bot
                </Button>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
