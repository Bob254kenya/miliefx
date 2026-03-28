import { NavLink } from '@/components/NavLink';
import { useAuth } from '@/contexts/AuthContext';
import {
  LayoutDashboard, BarChart3, Activity, Bot, History, Settings, LogOut, ChevronDown, Cpu, Zap, Scan, Gift,
} from 'lucide-react';
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
} from '@/components/ui/sidebar';
import { Rocket } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useState } from 'react';

const navItems = [
  { title: 'Pro Scanner Bot', url: '/', icon: Scan },
  { title: 'Free Bots', url: '/free-bots', icon: Gift },
  { title: 'Dashboard', url: '/dashboard', icon: LayoutDashboard },
  { title: 'Markets', url: '/markets', icon: BarChart3 },
  { title: 'Analyzer', url: '/analyzer', icon: Activity },
  { title: 'Auto Trade', url: '/auto-trade', icon: Bot },
  { title: 'Smart Bots', url: '/bots', icon: Cpu },
  { title: 'Free bots', url: '/smart-bot', icon: Zap },
  { title: 'Ramz Bot', url: '/ramz-bot', icon: Rocket },
  { title: 'Trade History', url: '/history', icon: History },
  { title: 'Settings', url: '/settings', icon: Settings },
];

// Helper component for currency icon
const CurrencyIcon = ({ currency, isVirtual }: { currency: string; isVirtual: boolean }) => {
  const [imageError, setImageError] = useState(false);
  
  if (isVirtual) {
    return (
      <div className="w-6 h-6 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center flex-shrink-0">
        <span className="text-xs font-bold text-white">🎮</span>
      </div>
    );
  }

  const currencyLower = currency.toLowerCase();
  
  // Crypto currencies
  if (currencyLower === 'usdt') {
    return (
      <div className="w-6 h-6 rounded-full bg-gradient-to-br from-green-400 to-emerald-600 flex items-center justify-center flex-shrink-0 shadow-sm">
        <span className="text-xs font-bold text-white">₮</span>
      </div>
    );
  }

  if (currencyLower === 'btc') {
    return (
      <div className="w-6 h-6 rounded-full bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center flex-shrink-0 shadow-sm">
        <span className="text-xs font-bold text-white">₿</span>
      </div>
    );
  }

  if (currencyLower === 'eth') {
    return (
      <div className="w-6 h-6 rounded-full bg-gradient-to-br from-purple-400 to-purple-700 flex items-center justify-center flex-shrink-0 shadow-sm">
        <span className="text-xs font-bold text-white">Ξ</span>
      </div>
    );
  }

  // Fiat currencies with flags
  const flagCode = currencyLower === 'usd' ? 'us' : 
                   currencyLower === 'eur' ? 'eu' :
                   currencyLower === 'gbp' ? 'gb' :
                   currencyLower === 'jpy' ? 'jp' :
                   currencyLower === 'aud' ? 'au' :
                   currencyLower === 'cad' ? 'ca' :
                   currencyLower === 'chf' ? 'ch' : currencyLower;

  if (!imageError) {
    return (
      <div className="w-6 h-6 rounded-full overflow-hidden shadow-sm flex-shrink-0">
        <img 
          src={`https://flagcdn.com/${flagCode}.svg`}
          className="w-full h-full object-cover"
          alt={currency}
          onError={() => setImageError(true)}
        />
      </div>
    );
  }

  // Fallback for flag errors
  return (
    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center flex-shrink-0 shadow-sm">
      <span className="text-xs font-bold text-white">{currency.charAt(0)}</span>
    </div>
  );
};

export function AppSidebar() {
  const { activeAccount, accounts, balance, logout, switchAccount } = useAuth();

  return (
    <Sidebar className="border-r border-sidebar-border">
      <div className="p-4 border-b border-sidebar-border">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg gradient-primary flex items-center justify-center">
            <Cpu className="w-4 h-4 text-primary-foreground" />
          </div>
          <span className="font-bold text-foreground text-lg">
            Ceoramz<span className="text-primary">Traders</span>
          </span>
        </div>
      </div>

      {activeAccount && (
        <div className="p-3 border-b border-sidebar-border">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="w-full justify-between h-auto p-2 text-left hover:bg-sidebar-accent transition-colors">
                <div className="flex items-center gap-3 flex-1">
                  <CurrencyIcon currency={activeAccount.currency} isVirtual={activeAccount.is_virtual} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-muted-foreground">
                      {activeAccount.is_virtual ? 'Demo Account' : 'Real Account'}
                    </div>
                    <div className="font-mono text-sm font-semibold text-foreground truncate">
                      {balance?.toFixed(2)} {activeAccount.currency}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">{activeAccount.loginid}</div>
                  </div>
                </div>
                <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64" sideOffset={5}>
              {accounts?.map(acc => (
                <DropdownMenuItem
                  key={acc.loginid}
                  onClick={() => switchAccount(acc.loginid)}
                  className={`py-2.5 px-2 cursor-pointer ${acc.loginid === activeAccount.loginid ? 'bg-accent' : ''}`}
                >
                  <div className="flex items-center gap-3 w-full">
                    <CurrencyIcon currency={acc.currency} isVirtual={acc.is_virtual} />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{acc.loginid}</div>
                      <div className="text-xs text-muted-foreground">
                        {acc.is_virtual ? 'Demo' : 'Real'} • {acc.currency}
                      </div>
                    </div>
                  </div>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end={item.url === '/'}
                      className="hover:bg-sidebar-accent"
                      activeClassName="bg-sidebar-accent text-primary font-medium"
                    >
                      <item.icon className="mr-2 h-4 w-4" />
                      <span>{item.title}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <div className="mt-auto p-3 border-t border-sidebar-border">
        <Button variant="ghost" onClick={logout} className="w-full justify-start text-muted-foreground hover:text-loss">
          <LogOut className="mr-2 h-4 w-4" /> Logout
        </Button>
      </div>
    </Sidebar>
  );
}
