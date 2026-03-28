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

// Helper function to get currency icon/flag
const getCurrencyIcon = (currency: string, isVirtual: boolean) => {
  if (isVirtual) {
    return (
      <div className="w-5 h-5 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
        <span className="text-[10px] font-bold text-white">🎮</span>
      </div>
    );
  }

  const currencyLower = currency.toLowerCase();
  
  // Map currencies to flag codes
  const flagMap: { [key: string]: string } = {
    usd: 'us',
    eur: 'eu',
    gbp: 'gb',
    jpy: 'jp',
    aud: 'au',
    cad: 'ca',
    chf: 'ch',
    cny: 'cn',
    inr: 'in',
    btc: 'btc',
    eth: 'eth',
    usdt: 'usdt',
  };

  const flagCode = flagMap[currencyLower] || currencyLower;

  if (currencyLower === 'usdt') {
    return (
      <div className="w-5 h-5 rounded-full bg-gradient-to-br from-green-400 to-emerald-600 flex items-center justify-center shadow-sm">
        <span className="text-[10px] font-bold text-white">₮</span>
      </div>
    );
  }

  if (currencyLower === 'btc') {
    return (
      <div className="w-5 h-5 rounded-full bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center shadow-sm">
        <span className="text-[10px] font-bold text-white">₿</span>
      </div>
    );
  }

  if (currencyLower === 'eth') {
    return (
      <div className="w-5 h-5 rounded-full bg-gradient-to-br from-purple-400 to-purple-700 flex items-center justify-center shadow-sm">
        <span className="text-[10px] font-bold text-white">Ξ</span>
      </div>
    );
  }

  return (
    <div className="w-5 h-5 rounded-full overflow-hidden shadow-sm flex-shrink-0">
      <img 
        src={`https://flagcdn.com/${flagCode}.svg`} 
        className="w-full h-full object-cover"
        alt={currency}
        onError={(e) => {
          // Fallback for unsupported flags
          e.currentTarget.style.display = 'none';
          const parent = e.currentTarget.parentElement;
          if (parent) {
            parent.innerHTML = `<span class="text-[10px] font-bold text-gray-600">${currency.charAt(0)}</span>`;
          }
        }}
      />
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
                <div className="flex items-center gap-3">
                  {getCurrencyIcon(activeAccount.currency, activeAccount.is_virtual)}
                  <div className="flex-1">
                    <div className="text-xs text-muted-foreground">
                      {activeAccount.is_virtual ? 'Demo Account' : 'Real Account'}
                    </div>
                    <div className="font-mono text-sm font-semibold text-foreground">
                      {balance.toFixed(2)} {activeAccount.currency}
                    </div>
                    <div className="text-xs text-muted-foreground">{activeAccount.loginid}</div>
                  </div>
                </div>
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              {accounts.map(acc => (
                <DropdownMenuItem
                  key={acc.loginid}
                  onClick={() => switchAccount(acc.loginid)}
                  className={`py-3 px-2 cursor-pointer ${acc.loginid === activeAccount.loginid ? 'bg-accent' : ''}`}
                >
                  <div className="flex items-center gap-3 w-full">
                    {getCurrencyIcon(acc.currency, acc.is_virtual)}
                    <div className="flex-1">
                      <div className="font-medium text-sm">{acc.loginid}</div>
                      <div className="text-xs text-muted-foreground">
                        {acc.is_virtual ? 'Demo Account' : 'Real Account'} • {acc.currency}
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
