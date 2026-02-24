import { motion } from 'framer-motion';

interface DigitDisplayProps {
  digits: number[];
  barrier: number;
}

/**
 * Shows last 30 digits as colored boxes.
 * Green = digit > barrier (Over), Red = digit < barrier (Under),
 * Blue border = Even, Orange border = Odd.
 */
export default function DigitDisplay({ digits, barrier }: DigitDisplayProps) {
  const last30 = digits.slice(-30);

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <h3 className="text-sm font-semibold text-foreground mb-3">Last 30 Digits</h3>
      <div className="flex flex-wrap gap-1.5">
        {last30.length === 0 && (
          <p className="text-xs text-muted-foreground">Waiting for ticks…</p>
        )}
        {last30.map((d, i) => {
          const isOver = d > barrier;
          const isUnder = d < barrier;
          const isEven = d % 2 === 0;

          let bgClass = 'bg-muted';
          if (isOver) bgClass = 'bg-profit/20';
          else if (isUnder) bgClass = 'bg-loss/20';

          const borderClass = isEven
            ? 'border-even'
            : 'border-odd';

          return (
            <motion.div
              key={`${i}-${d}`}
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.15 }}
              className={`w-8 h-8 flex items-center justify-center rounded-md font-mono text-xs font-bold border-2 ${bgClass} ${borderClass} text-foreground`}
            >
              {d}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
