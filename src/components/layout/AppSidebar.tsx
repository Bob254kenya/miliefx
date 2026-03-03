import { NavLink } from '@/components/NavLink';
import { useAuth } from '@/contexts/AuthContext';
import {
  LayoutDashboard, BarChart3, Activity, Bot, History, Settings, LogOut, ChevronDown, Cpu, Zap,
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
  { title: 'Dashboard', url: '/', icon: LayoutDashboard },
  { title: 'Markets', url: '/markets', icon: BarChart3 },
  { title: 'Analyzer', url: '/analyzer', icon: Activity },
  { title: 'Auto Trade', url: '/auto-trade', icon: Bot },
  { title: 'Smart Bots', url: '/bots', icon: Cpu },
  { title: 'Smart Signal Bot', url: '/smart-bot', icon: Zap },
  { title: 'Ramz Bot', url: '/ramz-bot', icon: Rocket },
  { title: 'Trade History', url: '/history', icon: History },
  { title: 'Settings', url: '/settings', icon: Settings },
];

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
              <Button variant="ghost" className="w-full justify-between h-auto p-2 text-left">
                <div>
                  <div className="text-xs text-muted-foreground">
                    {activeAccount.is_virtual ? '🎮 Demo' : '💰 Real'}
                  </div>
                  <div className="font-mono text-sm font-semibold text-foreground">
                    {balance.toFixed(2)} {activeAccount.currency}
                  </div>
                  <div className="text-xs text-muted-foreground">{activeAccount.loginid}</div>
                </div>
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              {accounts.map(acc => (
                <DropdownMenuItem
                  key={acc.loginid}
                  onClick={() => switchAccount(acc.loginid)}
                  className={acc.loginid === activeAccount.loginid ? 'bg-accent' : ''}
                >
                  <span className="mr-2">{acc.is_virtual ? '🎮' : '💰'}</span>
                  {acc.loginid} ({acc.currency})
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
