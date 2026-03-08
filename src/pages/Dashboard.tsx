import { motion } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { TrendingUp, TrendingDown, Activity, DollarSign, BarChart3, Bot, ArrowRight } from 'lucide-react';
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
      glow: 'glow-profit',
    },
    {
      label: 'Account Type',
      value: activeAccount?.is_virtual ? 'Demo' : 'Real',
      icon: activeAccount?.is_virtual ? Activity : TrendingUp,
      color: 'text-primary',
      bg: 'bg-primary/10',
      glow: 'glow-primary',
    },
    {
      label: 'Login ID',
      value: activeAccount?.loginid || '-',
      icon: BarChart3,
      color: 'text-warning',
      bg: 'bg-warning/10',
      glow: '',
    },
    {
      label: 'Email',
      value: accountInfo?.email || '-',
      icon: Bot,
      color: 'text-muted-foreground',
      bg: 'bg-muted/50',
      glow: '',
    },
  ];

  const quickLinks = [
    { title: 'Markets', desc: 'View live markets & digit analysis', url: '/markets', icon: BarChart3, accent: 'group-hover:text-primary' },
    { title: 'Analyzer', desc: 'Deep digit analysis with signals', url: '/analyzer', icon: Activity, accent: 'group-hover:text-primary' },
    { title: 'Auto Trade', desc: 'Configure and run auto-trading', url: '/auto-trade', icon: Bot, accent: 'group-hover:text-profit' },
    { title: 'History', desc: 'View trade history & performance', url: '/history', icon: TrendingDown, accent: 'group-hover:text-warning' },
  ];

  return (
    <div className="space-y-8">
      {/* Welcome header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between"
      >
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Welcome back, <span className="text-primary">{accountInfo?.fullname || 'Trader'}</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Here's your trading overview
          </p>
        </div>
        <div className="hidden sm:flex items-center gap-2 bg-muted/30 rounded-xl px-4 py-2 border border-border/50">
          <div className={`w-2 h-2 rounded-full ${activeAccount?.is_virtual ? 'bg-primary' : 'bg-profit'} animate-pulse`} />
          <span className="text-xs text-muted-foreground">{activeAccount?.is_virtual ? 'Demo Mode' : 'Live Trading'}</span>
        </div>
      </motion.div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1, duration: 0.4 }}
            className={`bg-card border border-border rounded-xl p-5 hover:border-primary/30 transition-all ${stat.glow}`}
          >
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{stat.label}</span>
              <div className={`w-9 h-9 rounded-xl ${stat.bg} flex items-center justify-center`}>
                <stat.icon className={`w-4 h-4 ${stat.color}`} />
              </div>
            </div>
            <div className="font-mono text-xl font-bold text-foreground truncate">{stat.value}</div>
          </motion.div>
        ))}
      </div>

      {/* Quick Links */}
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-4">Quick Actions</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {quickLinks.map((link, i) => (
            <motion.div
              key={link.title}
              initial={{ opacity: 0, x: -15 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 + i * 0.08 }}
            >
              <Link
                to={link.url}
                className="flex items-center gap-4 bg-card border border-border rounded-xl p-5 hover:border-primary/40 hover:bg-card/80 transition-all group"
              >
                <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors shrink-0">
                  <link.icon className={`w-5 h-5 text-muted-foreground ${link.accent} transition-colors`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-foreground">{link.title}</div>
                  <div className="text-xs text-muted-foreground">{link.desc}</div>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-primary group-hover:translate-x-1 transition-all shrink-0" />
              </Link>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
