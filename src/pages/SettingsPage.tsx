import { motion } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';

export default function SettingsPage() {
  const { activeAccount, accountInfo } = useAuth();

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
    </div>
  );
}
