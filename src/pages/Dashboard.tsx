import { motion } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { TrendingUp, TrendingDown, Activity, DollarSign, BarChart3, Bot } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function Dashboard() {
  const { activeAccount, balance, accountInfo } = useAuth();

  const stats = [
    {
      label: 'Balance',
      value: `${balance.toFixed(2)} ${activeAccount?.currency || ''}`,
      icon: DollarSign,
      color: 'text-profit',
      bg: 'bg-profit/10',
    },
    {
      label: 'Account Type',
      value: activeAccount?.is_virtual ? 'Demo' : 'Real',
      icon: activeAccount?.is_virtual ? Activity : TrendingUp,
      color: 'text-primary',
      bg: 'bg-primary/10',
    },
    {
      label: 'Login ID',
      value: activeAccount?.loginid || '-',
      icon: BarChart3,
      color: 'text-warning',
      bg: 'bg-warning/10',
    },
    {
      label: 'Email',
      value: accountInfo?.email || '-',
      icon: Bot,
      color: 'text-muted-foreground',
      bg: 'bg-muted',
    },
  ];

  const quickLinks = [
    { title: 'Markets', desc: 'View live markets & digit analysis', url: '/markets', icon: BarChart3 },
    { title: 'Analyzer', desc: 'Deep digit analysis with signals', url: '/analyzer', icon: Activity },
    { title: 'Auto Trade', desc: 'Configure and run auto-trading', url: '/auto-trade', icon: Bot },
    { title: 'History', desc: 'View trade history & performance', url: '/history', icon: TrendingDown },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Welcome back, {accountInfo?.fullname || 'Trader'}
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="bg-card border border-border rounded-xl p-4"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-muted-foreground">{stat.label}</span>
              <div className={`w-8 h-8 rounded-lg ${stat.bg} flex items-center justify-center`}>
                <stat.icon className={`w-4 h-4 ${stat.color}`} />
              </div>
            </div>
            <div className="font-mono text-lg font-bold text-foreground truncate">{stat.value}</div>
          </motion.div>
        ))}
      </div>

      {/* Quick Links */}
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-3">Quick Actions</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {quickLinks.map((link, i) => (
            <motion.div
              key={link.title}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 + i * 0.1 }}
            >
              <Link
                to={link.url}
                className="flex items-center gap-4 bg-card border border-border rounded-xl p-4 hover:border-primary/50 hover:bg-card/80 transition-all group"
              >
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                  <link.icon className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <div className="font-medium text-foreground">{link.title}</div>
                  <div className="text-xs text-muted-foreground">{link.desc}</div>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
