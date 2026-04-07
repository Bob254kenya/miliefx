import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { type BotConfig } from '@/components/bot-config/ConfigPreview';
import { Gift } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface FreeBotTemplate {
  config: BotConfig & { botName: string };
  description: string;
}

const FREE_BOT_TEMPLATES: FreeBotTemplate[] = [
  {
    config: {"version":1,"botName":"Matches bot","m1":{"enabled":true,"symbol":"1HZ50V","contract":"DIGITMATCH","barrier":"6","hookEnabled":true,"virtualLossCount":"6","realCount":"4"},"m2":{"enabled":false,"symbol":"R_50","contract":"DIGITODD","barrier":"5","hookEnabled":false,"virtualLossCount":"3","realCount":"2"},"risk":{"stake":"0.35","martingaleOn":true,"martingaleMultiplier":"1.6","martingaleMaxSteps":"5","takeProfit":"0.2","stopLoss":"16"},"strategy":{"m1Enabled":false,"m2Enabled":false,"m1Mode":"pattern","m2Mode":"pattern","m1Pattern":"","m1DigitCondition":"==","m1DigitCompare":"5","m1DigitWindow":"3","m2Pattern":"","m2DigitCondition":"==","m2DigitCompare":"5","m2DigitWindow":"3"},"scanner":{"active":true},"turbo":{"enabled":false}},
    description: 'M1 trades Match 6 on V50 1s with Virtual Hook. Uses 6 virtual losses and 4 real counts for precise entries.',
  },
  {
    config: {"version":1,"botName":"Over 6 bot","m1":{"enabled":true,"symbol":"1HZ50V","contract":"DIGITOVER","barrier":"6","hookEnabled":true,"virtualLossCount":"6","realCount":"4"},"m2":{"enabled":false,"symbol":"R_50","contract":"DIGITODD","barrier":"5","hookEnabled":false,"virtualLossCount":"3","realCount":"2"},"risk":{"stake":"0.35","martingaleOn":true,"martingaleMultiplier":"1.6","martingaleMaxSteps":"5","takeProfit":"3","stopLoss":"16"},"strategy":{"m1Enabled":false,"m2Enabled":false,"m1Mode":"pattern","m2Mode":"pattern","m1Pattern":"","m1DigitCondition":"==","m1DigitCompare":"5","m1DigitWindow":"3","m2Pattern":"","m2DigitCondition":"==","m2DigitCompare":"5","m2DigitWindow":"3"},"scanner":{"active":true},"turbo":{"enabled":false}},
    description: 'M1 trades Over 6 on V50 1s with Virtual Hook. Features 6 virtual losses, 4 real counts, and 3 TP for consistent profits.',
  },
  {
    config: {"version":1,"botName":"ODD BOT Bes (2026)","m1":{"enabled":true,"symbol":"1HZ10V","contract":"DIGITODD","barrier":"7","hookEnabled":true,"virtualLossCount":"3","realCount":"4"},"m2":{"enabled":false,"symbol":"R_50","contract":"DIGITODD","barrier":"5","hookEnabled":false,"virtualLossCount":"3","realCount":"2"},"risk":{"stake":"0.35","martingaleOn":true,"martingaleMultiplier":"2","martingaleMaxSteps":"50","takeProfit":"55","stopLoss":"16"},"strategy":{"m1Enabled":false,"m2Enabled":false,"m1Mode":"pattern","m2Mode":"pattern","m1Pattern":"","m1DigitCondition":"==","m1DigitCompare":"5","m1DigitWindow":"3","m2Pattern":"","m2DigitCondition":"==","m2DigitCompare":"5","m2DigitWindow":"3"},"scanner":{"active":true},"turbo":{"enabled":false}},
    description: 'M1 trades Odd on V10 1s with Virtual Hook. Extended martingale up to 50 steps with 55 TP and 16 SL.',
  },
  {
    config: {"version":1,"botName":"OVER 2 RECOVERY OVER 4 BOT","m1":{"enabled":true,"symbol":"1HZ100V","contract":"DIGITOVER","barrier":"2","hookEnabled":true,"virtualLossCount":"2","realCount":"1"},"m2":{"enabled":true,"symbol":"R_100","contract":"DIGITOVER","barrier":"4","hookEnabled":false,"virtualLossCount":"3","realCount":"2"},"risk":{"stake":"0.5","martingaleOn":true,"martingaleMultiplier":"2.0","martingaleMaxSteps":"5","takeProfit":"10","stopLoss":"5"},"strategy":{"m1Enabled":false,"m2Enabled":true,"m1Mode":"pattern","m2Mode":"digit","m1Pattern":"","m1DigitCondition":"==","m1DigitCompare":"5","m1DigitWindow":"3","m2Pattern":"EEEOEEOE","m2DigitCondition":"<=","m2DigitCompare":"4","m2DigitWindow":"6"},"scanner":{"active":true},"turbo":{"enabled":true}},
    description: 'M1 trades Over 2 on V100 1s with Virtual Hook. Recovery switches to Over 4 on Vol 100 with digit strategy.',
  },
  {
    config: {"version":1,"botName":"OVER 1 RECOVERY ODD BOT","m1":{"enabled":true,"symbol":"1HZ100V","contract":"DIGITOVER","barrier":"1","hookEnabled":true,"virtualLossCount":"1","realCount":"1"},"m2":{"enabled":true,"symbol":"R_100","contract":"DIGITODD","barrier":"4","hookEnabled":false,"virtualLossCount":"3","realCount":"2"},"risk":{"stake":"0.5","martingaleOn":true,"martingaleMultiplier":"2.0","martingaleMaxSteps":"5","takeProfit":"10","stopLoss":"5"},"strategy":{"m1Enabled":false,"m2Enabled":true,"m1Mode":"pattern","m2Mode":"pattern","m1Pattern":"","m1DigitCondition":"==","m1DigitCompare":"5","m1DigitWindow":"3","m2Pattern":"EEEOEEOE","m2DigitCondition":"<=","m2DigitCompare":"4","m2DigitWindow":"6"},"scanner":{"active":true},"turbo":{"enabled":true}},
    description: 'M1 enters Over 1 with Virtual Hook on V100 1s. Recovery market uses Odd pattern strategy on Vol 100.',
  },
  {
    config: {"version":1,"botName":"OVER 1 RECOVERY EVEN BOT","m1":{"enabled":true,"symbol":"1HZ100V","contract":"DIGITOVER","barrier":"1","hookEnabled":true,"virtualLossCount":"1","realCount":"1"},"m2":{"enabled":true,"symbol":"R_100","contract":"DIGITEVEN","barrier":"4","hookEnabled":false,"virtualLossCount":"3","realCount":"2"},"risk":{"stake":"0.5","martingaleOn":true,"martingaleMultiplier":"2.0","martingaleMaxSteps":"5","takeProfit":"10","stopLoss":"5"},"strategy":{"m1Enabled":false,"m2Enabled":true,"m1Mode":"pattern","m2Mode":"pattern","m1Pattern":"","m1DigitCondition":"==","m1DigitCompare":"5","m1DigitWindow":"3","m2Pattern":"OOOOEOEOE","m2DigitCondition":"<=","m2DigitCompare":"4","m2DigitWindow":"6"},"scanner":{"active":true},"turbo":{"enabled":true}},
    description: 'M1 enters Over 1 with Virtual Hook. Recovery uses Even pattern on Vol 100 with OOOOEOEOE sequence.',
  },
  {
    config: {"version":1,"botName":"EVEN BOT","m1":{"enabled":false,"symbol":"1HZ100V","contract":"DIGITOVER","barrier":"1","hookEnabled":true,"virtualLossCount":"1","realCount":"1"},"m2":{"enabled":true,"symbol":"R_100","contract":"DIGITEVEN","barrier":"4","hookEnabled":false,"virtualLossCount":"3","realCount":"2"},"risk":{"stake":"0.5","martingaleOn":true,"martingaleMultiplier":"2.0","martingaleMaxSteps":"5","takeProfit":"10","stopLoss":"5"},"strategy":{"m1Enabled":false,"m2Enabled":true,"m1Mode":"pattern","m2Mode":"pattern","m1Pattern":"","m1DigitCondition":"==","m1DigitCompare":"5","m1DigitWindow":"3","m2Pattern":"OOOOEOEO","m2DigitCondition":"<=","m2DigitCompare":"4","m2DigitWindow":"6"},"scanner":{"active":true},"turbo":{"enabled":true}},
    description: 'Single-market Even bot on Vol 100. Uses OOOOEOEO pattern matching with martingale recovery.',
  },
  {
    config: {"version":1,"botName":"ODD BOT","m1":{"enabled":false,"symbol":"1HZ100V","contract":"DIGITOVER","barrier":"1","hookEnabled":false,"virtualLossCount":"1","realCount":"1"},"m2":{"enabled":true,"symbol":"R_100","contract":"DIGITEVEN","barrier":"4","hookEnabled":false,"virtualLossCount":"3","realCount":"2"},"risk":{"stake":"0.5","martingaleOn":true,"martingaleMultiplier":"2.0","martingaleMaxSteps":"5","takeProfit":"10","stopLoss":"5"},"strategy":{"m1Enabled":false,"m2Enabled":true,"m1Mode":"pattern","m2Mode":"pattern","m1Pattern":"","m1DigitCondition":"==","m1DigitCompare":"5","m1DigitWindow":"3","m2Pattern":"EEEEEOEO","m2DigitCondition":"<=","m2DigitCompare":"4","m2DigitWindow":"6"},"scanner":{"active":true},"turbo":{"enabled":true}},
    description: 'Single-market Odd bot on Vol 100. Pattern-based with EEEEEOEO sequence and martingale.',
  },
  {
    config: {"version":1,"botName":"OVER 2 BOT","m1":{"enabled":false,"symbol":"1HZ100V","contract":"DIGITOVER","barrier":"1","hookEnabled":false,"virtualLossCount":"1","realCount":"1"},"m2":{"enabled":true,"symbol":"R_100","contract":"DIGITOVER","barrier":"2","hookEnabled":false,"virtualLossCount":"3","realCount":"2"},"risk":{"stake":"0.5","martingaleOn":true,"martingaleMultiplier":"2.0","martingaleMaxSteps":"5","takeProfit":"10","stopLoss":"5"},"strategy":{"m1Enabled":false,"m2Enabled":true,"m1Mode":"pattern","m2Mode":"digit","m1Pattern":"","m1DigitCondition":"==","m1DigitCompare":"5","m1DigitWindow":"3","m2Pattern":"EEEEEOEO","m2DigitCondition":"<=","m2DigitCompare":"2","m2DigitWindow":"4"},"scanner":{"active":true},"turbo":{"enabled":true}},
    description: 'Simple Over 2 digit strategy on Vol 100. Enters when last 4 digits are ≤ 2. Turbo + scanner enabled.',
  },
  {
    config: {"version":1,"botName":"UNDER 7 BOT","m1":{"enabled":false,"symbol":"1HZ100V","contract":"DIGITOVER","barrier":"1","hookEnabled":false,"virtualLossCount":"1","realCount":"1"},"m2":{"enabled":true,"symbol":"R_100","contract":"DIGITUNDER","barrier":"7","hookEnabled":false,"virtualLossCount":"3","realCount":"2"},"risk":{"stake":"0.5","martingaleOn":true,"martingaleMultiplier":"2.0","martingaleMaxSteps":"5","takeProfit":"10","stopLoss":"5"},"strategy":{"m1Enabled":false,"m2Enabled":true,"m1Mode":"pattern","m2Mode":"digit","m1Pattern":"","m1DigitCondition":"==","m1DigitCompare":"5","m1DigitWindow":"3","m2Pattern":"EEEEEOEO","m2DigitCondition":">=","m2DigitCompare":"8","m2DigitWindow":"3"},"scanner":{"active":true},"turbo":{"enabled":true}},
    description: 'Under 7 digit strategy on Vol 100. Enters when last 3 digits are ≥ 8. Great reversal setup.',
  },
  // NEW BOTS - Fixed to match BotConfig type
  {
    config: {
      version: 1,
      botName: "Over 1 recovery over 5 risk management bot",
      m1: {
        enabled: true,
        symbol: "R_10",
        contract: "DIGITOVER",
        barrier: "1",
        hookEnabled: true,
        virtualLossCount: "1",
        realCount: "1"
      },
      m2: {
        enabled: true,
        symbol: "1HZ10V",
        contract: "DIGITOVER",
        barrier: "5",
        hookEnabled: true,
        virtualLossCount: "3",
        realCount: "3"
      },
      risk: {
        stake: "0.35",
        martingaleOn: true,
        martingaleMultiplier: "1.5",
        martingaleMaxSteps: "5",
        takeProfit: "2.5",
        stopLoss: "50"
      },
      strategy: {
        m1Enabled: false,
        m2Enabled: false,
        m1Mode: "pattern",
        m2Mode: "pattern",
        m1Pattern: "",
        m1DigitCondition: "==",
        m1DigitCompare: "5",
        m1DigitWindow: "3",
        m2Pattern: "",
        m2DigitCondition: "==",
        m2DigitCompare: "5",
        m2DigitWindow: "3"
      },
      scanner: {
        active: false
      },
      turbo: {
        enabled: true
      }
    },
    description: 'Risk-managed bot trading Over 1 on R10 with recovery Over 5 on V10. Features 1.5x martingale with 2.5 TP and 50 SL.',
  },
  {
    config: {
      version: 1,
      botName: "RAMZ ULTIMATE EVEN BOT",
      m1: {
        enabled: true,
        symbol: "R_100",
        contract: "DIGITEVEN",
        barrier: "5",
        hookEnabled: false,
        virtualLossCount: "3",
        realCount: "2"
      },
      m2: {
        enabled: true,
        symbol: "R_50",
        contract: "DIGITEVEN",
        barrier: "5",
        hookEnabled: false,
        virtualLossCount: "3",
        realCount: "2"
      },
      risk: {
        stake: "0.6",
        martingaleOn: true,
        martingaleMultiplier: "2.0",
        martingaleMaxSteps: "5",
        takeProfit: "5",
        stopLoss: "30"
      },
      strategy: {
        m1Enabled: true,
        m2Enabled: true,
        m1Mode: "pattern",
        m2Mode: "pattern",
        m1Pattern: "OOO",
        m1DigitCondition: "==",
        m1DigitCompare: "5",
        m1DigitWindow: "3",
        m2Pattern: "EOEOEEE",
        m2DigitCondition: "==",
        m2DigitCompare: "5",
        m2DigitWindow: "3"
      },
      scanner: {
        active: true
      },
      turbo: {
        enabled: false
      }
    },
    description: 'Ultimate Even bot scanning R100 & R50. Uses OOO pattern on M1 and EOEOEEE on M2 with $0.6 stake.',
  },
  {
    config: {
      version: 1,
      botName: "Over 1 Recovery Odd bot 2026",
      m1: {
        enabled: true,
        symbol: "1HZ30V",
        contract: "DIGITOVER",
        barrier: "1",
        hookEnabled: true,
        virtualLossCount: "2",
        realCount: "1"
      },
      m2: {
        enabled: true,
        symbol: "1HZ100V",
        contract: "DIGITODD",
        barrier: "",
        hookEnabled: true,
        virtualLossCount: "3",
        realCount: "3"
      },
      risk: {
        stake: "1",
        martingaleOn: true,
        martingaleMultiplier: "2.0",
        martingaleMaxSteps: "5",
        takeProfit: "5",
        stopLoss: "30"
      },
      strategy: {
        m1Enabled: false,
        m2Enabled: false,
        m1Mode: "pattern",
        m2Mode: "pattern",
        m1Pattern: "",
        m1DigitCondition: "==",
        m1DigitCompare: "5",
        m1DigitWindow: "3",
        m2Pattern: "",
        m2DigitCondition: "==",
        m2DigitCompare: "5",
        m2DigitWindow: "3"
      },
      scanner: {
        active: true
      },
      turbo: {
        enabled: false
      }
    },
    description: 'Recovery bot trading Over 1 on V30 and switching to Odd on V100. Active scanner with $1 stake.',
  },
  {
    config: {
      version: 1,
      botName: "Over 1 under 8 bot 2026",
      m1: {
        enabled: true,
        symbol: "1HZ30V",
        contract: "DIGITOVER",
        barrier: "1",
        hookEnabled: true,
        virtualLossCount: "2",
        realCount: "1"
      },
      m2: {
        enabled: true,
        symbol: "JD10",
        contract: "DIGITUNDER",
        barrier: "8",
        hookEnabled: true,
        virtualLossCount: "2",
        realCount: "1"
      },
      risk: {
        stake: "1",
        martingaleOn: false,
        martingaleMultiplier: "2.0",
        martingaleMaxSteps: "5",
        takeProfit: "5",
        stopLoss: "30"
      },
      strategy: {
        m1Enabled: false,
        m2Enabled: false,
        m1Mode: "pattern",
        m2Mode: "pattern",
        m1Pattern: "",
        m1DigitCondition: "==",
        m1DigitCompare: "5",
        m1DigitWindow: "3",
        m2Pattern: "",
        m2DigitCondition: "==",
        m2DigitCompare: "5",
        m2DigitWindow: "3"
      },
      scanner: {
        active: true
      },
      turbo: {
        enabled: false
      }
    },
    description: 'Dual-market bot trading Over 1 on V30 and Under 8 on JD10. Martingale disabled, scanner active.',
  },
  {
    config: {
      version: 1,
      botName: "OVER 2 BOT Recovery Over 4",
      m1: {
        enabled: true,
        symbol: "1HZ100V",
        contract: "DIGITOVER",
        barrier: "1",
        hookEnabled: true,
        virtualLossCount: "1",
        realCount: "1"
      },
      m2: {
        enabled: false,
        symbol: "1HZ75V",
        contract: "DIGITOVER",
        barrier: "4",
        hookEnabled: true,
        virtualLossCount: "3",
        realCount: "3"
      },
      risk: {
        stake: "0.5",
        martingaleOn: true,
        martingaleMultiplier: "2.0",
        martingaleMaxSteps: "5",
        takeProfit: "10",
        stopLoss: "5"
      },
      strategy: {
        m1Enabled: false,
        m2Enabled: false,
        m1Mode: "pattern",
        m2Mode: "digit",
        m1Pattern: "",
        m1DigitCondition: "==",
        m1DigitCompare: "5",
        m1DigitWindow: "3",
        m2Pattern: "EEEEEOEO",
        m2DigitCondition: "<=",
        m2DigitCompare: "2",
        m2DigitWindow: "4"
      },
      scanner: {
        active: true
      },
      turbo: {
        enabled: true
      }
    },
    description: 'Recovery bot with Over 1 on V100 and digit strategy on V75. Turbo enabled for fast execution.',
  },
  {
    config: {
      version: 1,
      botName: "Even Odd Bot (EEEEEOO)",
      m1: {
        enabled: true,
        symbol: "R_100",
        contract: "DIGITODD",
        barrier: "1",
        hookEnabled: true,
        virtualLossCount: "3",
        realCount: "1"
      },
      m2: {
        enabled: true,
        symbol: "1HZ75V",
        contract: "DIGITEVEN",
        barrier: "4",
        hookEnabled: false,
        virtualLossCount: "3",
        realCount: "3"
      },
      risk: {
        stake: "0.5",
        martingaleOn: true,
        martingaleMultiplier: "2.0",
        martingaleMaxSteps: "5",
        takeProfit: "10",
        stopLoss: "5"
      },
      strategy: {
        m1Enabled: false,
        m2Enabled: true,
        m1Mode: "pattern",
        m2Mode: "pattern",
        m1Pattern: "",
        m1DigitCondition: "==",
        m1DigitCompare: "5",
        m1DigitWindow: "3",
        m2Pattern: "EEEEEOO",
        m2DigitCondition: "<=",
        m2DigitCompare: "2",
        m2DigitWindow: "4"
      },
      scanner: {
        active: true
      },
      turbo: {
        enabled: true
      }
    },
    description: 'Even/Odd hybrid bot. Trades Odd on R100 with recovery on Even V75 using EEEEEOO pattern.',
  },
];

export default function FreeBotTemplatesPage() {
  const navigate = useNavigate();

  const handleLoad = (bot: FreeBotTemplate) => {
    navigate('/', { state: { loadConfig: bot.config } });
    toast.success(`"${bot.config.botName}" loaded into Pro Scanner Bot`);
  };

  // Animation variants for cards
  const cardVariants = {
    hidden: { opacity: 0, y: 30 },
    visible: (i: number) => ({
      opacity: 1,
      y: 0,
      transition: {
        delay: i * 0.05,
        duration: 0.4,
        ease: "easeOut",
      },
    }),
    hover: {
      y: -8,
      scale: 1.02,
      transition: {
        duration: 0.2,
        ease: "easeInOut",
      },
    },
    tap: {
      scale: 0.98,
    },
  };

  // Ribbon animation
  const ribbonVariants = {
    initial: { x: 20, opacity: 0 },
    animate: { x: 0, opacity: 1, transition: { delay: 0.1, duration: 0.3 } },
  };

  return (
    <div className="space-y-4 p-4">
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.3 }}
        className="flex items-center gap-3"
      >
        <div className="w-9 h-9 rounded-xl bg-warning/10 flex items-center justify-center">
          <Gift className="w-5 h-5 text-warning" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-foreground">Free Bot Templates</h2>
          <p className="text-[10px] text-muted-foreground">Tap "Load Bot" to use in Pro Scanner Bot</p>
        </div>
      </motion.div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {FREE_BOT_TEMPLATES.map((bot, i) => (
          <motion.div
            key={bot.config.botName}
            custom={i}
            initial="hidden"
            animate="visible"
            whileHover="hover"
            whileTap="tap"
            variants={cardVariants}
            className="relative rounded-xl border-2 border-warning/60 bg-gradient-to-br from-amber-50 to-orange-50 dark:from-warning/5 dark:to-amber-900/10 overflow-hidden shadow-md hover:shadow-lg hover:border-warning transition-all cursor-pointer"
            onClick={() => handleLoad(bot)}
          >
            {/* Animated Free ribbon */}
            <motion.div
              variants={ribbonVariants}
              initial="initial"
              animate="animate"
              className="absolute top-0 right-0 z-10"
            >
              <div className="bg-gradient-to-r from-red-500 to-red-600 text-white text-[10px] font-bold px-3 py-0.5 rounded-bl-lg shadow-sm tracking-wider uppercase">
                Free
              </div>
            </motion.div>

            {/* Animated shine effect on hover */}
            <motion.div
              className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none"
              whileHover={{ x: "200%", transition: { duration: 0.6, ease: "easeInOut" } }}
            />

            <div className="p-4 space-y-2.5 relative z-0">
              <motion.h3
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: i * 0.05 + 0.1 }}
                className="text-sm font-extrabold text-foreground leading-tight pr-12"
              >
                {bot.config.botName}
              </motion.h3>
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: i * 0.05 + 0.15 }}
                className="text-[10px] text-muted-foreground leading-relaxed min-h-[32px]"
              >
                {bot.description}
              </motion.p>
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.05 + 0.2 }}
              >
                <Button
                  className="h-8 px-4 text-xs font-bold bg-primary hover:bg-primary/90 text-primary-foreground rounded-md shadow-sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleLoad(bot);
                  }}
                >
                  Load Bot
                </Button>
              </motion.div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
