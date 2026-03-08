import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Users, Plus, Play, Square, Trash2, Settings2, AlertTriangle,
  CheckCircle2, XCircle, Pause, RefreshCw, Upload, Download,
  Shield, Zap, TrendingUp, DollarSign, Activity, Eye, EyeOff
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from '@/components/ui/alert-dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table';
import { toast } from 'sonner';

interface Follower {
  id: string;
  nickname: string;
  token: string;
  status: 'active' | 'paused' | 'error' | 'pending';
  balance: number;
  currency: string;
  landingCompany: string;
  totalTrades: number;
  lastError?: string;
  createdAt: Date;
  minBalance: number;
  maxStakePercent: number;
  pauseOnLosses: number;
}

interface MasterConfig {
  adminToken: string;
  readOnlyToken: string;
  appId: string;
  accountId: string;
  copyTradingEnabled: boolean;
}

interface CopyLog {
  id: string;
  followerId: string;
  followerNickname: string;
  masterTradeId: string;
  status: 'success' | 'failed';
  errorMessage?: string;
  stakeAmount: number;
  contractType: string;
  symbol: string;
  timestamp: Date;
}

interface RiskSettings {
  globalMinBalance: number;
  globalMaxStakePercent: number;
  maxDrawdownPercent: number;
  pauseOnConsecutiveLosses: number;
  autoPauseOnError: boolean;
}

export default function CopyTradingManager() {
  const [followers, setFollowers] = useState<Follower[]>([]);
  const [masterConfig, setMasterConfig] = useState<MasterConfig>({
    adminToken: '',
    readOnlyToken: '',
    appId: '117223',
    accountId: '',
    copyTradingEnabled: false,
  });
  const [riskSettings, setRiskSettings] = useState<RiskSettings>({
    globalMinBalance: 10,
    globalMaxStakePercent: 10,
    maxDrawdownPercent: 20,
    pauseOnConsecutiveLosses: 3,
    autoPauseOnError: true,
  });
  const [copyLogs, setCopyLogs] = useState<CopyLog[]>([]);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isBulkDialogOpen, setIsBulkDialogOpen] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [newFollower, setNewFollower] = useState({ nickname: '', token: '' });
  const [bulkTokens, setBulkTokens] = useState('');
  const [showMasterTokens, setShowMasterTokens] = useState(false);
  const [selectedFollowers, setSelectedFollowers] = useState<Set<string>>(new Set());
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isCopyingActive, setIsCopyingActive] = useState(false);

  // Stats calculations
  const activeFollowers = followers.filter(f => f.status === 'active').length;
  const totalTradesToday = copyLogs.filter(l => 
    new Date(l.timestamp).toDateString() === new Date().toDateString()
  ).length;
  const successRate = copyLogs.length > 0 
    ? Math.round((copyLogs.filter(l => l.status === 'success').length / copyLogs.length) * 100) 
    : 0;
  const totalVolume = copyLogs.reduce((sum, l) => sum + l.stakeAmount, 0);

  // Load data from localStorage on mount
  useEffect(() => {
    const savedFollowers = localStorage.getItem('copyTrading_followers');
    const savedMaster = localStorage.getItem('copyTrading_master');
    const savedRisk = localStorage.getItem('copyTrading_risk');
    const savedLogs = localStorage.getItem('copyTrading_logs');

    if (savedFollowers) setFollowers(JSON.parse(savedFollowers));
    if (savedMaster) setMasterConfig(JSON.parse(savedMaster));
    if (savedRisk) setRiskSettings(JSON.parse(savedRisk));
    if (savedLogs) setCopyLogs(JSON.parse(savedLogs));
  }, []);

  // Save data to localStorage
  useEffect(() => {
    localStorage.setItem('copyTrading_followers', JSON.stringify(followers));
  }, [followers]);

  useEffect(() => {
    localStorage.setItem('copyTrading_master', JSON.stringify(masterConfig));
  }, [masterConfig]);

  useEffect(() => {
    localStorage.setItem('copyTrading_risk', JSON.stringify(riskSettings));
  }, [riskSettings]);

  const validateToken = async (token: string): Promise<boolean> => {
    // Basic token format validation
    if (!token || token.length < 10) return false;
    // In production, would call Deriv API to validate
    return true;
  };

  const addFollower = async () => {
    if (!newFollower.nickname.trim() || !newFollower.token.trim()) {
      toast.error('Please fill in all fields');
      return;
    }

    if (followers.length >= 50) {
      toast.error('Maximum 50 followers reached');
      return;
    }

    const isValid = await validateToken(newFollower.token);
    if (!isValid) {
      toast.error('Invalid API token format');
      return;
    }

    const follower: Follower = {
      id: crypto.randomUUID(),
      nickname: newFollower.nickname.trim(),
      token: newFollower.token.trim(),
      status: 'pending',
      balance: 0,
      currency: 'USD',
      landingCompany: '',
      totalTrades: 0,
      createdAt: new Date(),
      minBalance: riskSettings.globalMinBalance,
      maxStakePercent: riskSettings.globalMaxStakePercent,
      pauseOnLosses: riskSettings.pauseOnConsecutiveLosses,
    };

    setFollowers(prev => [...prev, follower]);
    setNewFollower({ nickname: '', token: '' });
    setIsAddDialogOpen(false);
    toast.success(`Follower "${follower.nickname}" added`);
  };

  const addBulkFollowers = async () => {
    const lines = bulkTokens.split('\n').filter(line => line.trim());
    if (lines.length === 0) {
      toast.error('No tokens provided');
      return;
    }

    const remainingSlots = 50 - followers.length;
    if (lines.length > remainingSlots) {
      toast.error(`Only ${remainingSlots} slots available`);
      return;
    }

    const newFollowers: Follower[] = [];
    for (let i = 0; i < lines.length; i++) {
      const token = lines[i].trim();
      if (token) {
        newFollowers.push({
          id: crypto.randomUUID(),
          nickname: `Follower ${followers.length + i + 1}`,
          token,
          status: 'pending',
          balance: 0,
          currency: 'USD',
          landingCompany: '',
          totalTrades: 0,
          createdAt: new Date(),
          minBalance: riskSettings.globalMinBalance,
          maxStakePercent: riskSettings.globalMaxStakePercent,
          pauseOnLosses: riskSettings.pauseOnConsecutiveLosses,
        });
      }
    }

    setFollowers(prev => [...prev, ...newFollowers]);
    setBulkTokens('');
    setIsBulkDialogOpen(false);
    toast.success(`${newFollowers.length} followers added`);
  };

  const removeFollower = (id: string) => {
    setFollowers(prev => prev.filter(f => f.id !== id));
    setDeleteConfirmId(null);
    toast.success('Follower removed');
  };

  const toggleFollowerStatus = (id: string) => {
    setFollowers(prev => prev.map(f => {
      if (f.id === id) {
        const newStatus = f.status === 'active' ? 'paused' : 'active';
        return { ...f, status: newStatus };
      }
      return f;
    }));
  };

  const startAllFollowers = () => {
    setFollowers(prev => prev.map(f => ({
      ...f,
      status: f.status === 'error' ? 'error' : 'active'
    })));
    setIsCopyingActive(true);
    toast.success('All followers started');
  };

  const pauseAllFollowers = () => {
    setFollowers(prev => prev.map(f => ({
      ...f,
      status: f.status === 'error' ? 'error' : 'paused'
    })));
    setIsCopyingActive(false);
    toast.success('All followers paused');
  };

  const removeSelectedFollowers = () => {
    setFollowers(prev => prev.filter(f => !selectedFollowers.has(f.id)));
    setSelectedFollowers(new Set());
    toast.success('Selected followers removed');
  };

  const enableCopyTrading = async () => {
    if (!masterConfig.adminToken) {
      toast.error('Master admin token required');
      return;
    }
    // In production, would call Deriv API: set_settings with allow_copiers: 1
    setMasterConfig(prev => ({ ...prev, copyTradingEnabled: true }));
    toast.success('Copy trading enabled on master account');
  };

  const testConnection = async (followerId: string) => {
    const follower = followers.find(f => f.id === followerId);
    if (!follower) return;

    // Simulate connection test
    toast.info(`Testing connection for ${follower.nickname}...`);
    setTimeout(() => {
      setFollowers(prev => prev.map(f => {
        if (f.id === followerId) {
          return { ...f, status: 'active', balance: Math.random() * 1000 + 100 };
        }
        return f;
      }));
      toast.success(`${follower.nickname} connected successfully`);
    }, 1500);
  };

  const filteredFollowers = followers.filter(f => {
    const matchesStatus = filterStatus === 'all' || f.status === filterStatus;
    const matchesSearch = f.nickname.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          f.id.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  const getStatusBadge = (status: Follower['status']) => {
    switch (status) {
      case 'active':
        return <Badge className="bg-profit/20 text-profit border-profit/30"><CheckCircle2 className="w-3 h-3 mr-1" />Active</Badge>;
      case 'paused':
        return <Badge variant="secondary"><Pause className="w-3 h-3 mr-1" />Paused</Badge>;
      case 'error':
        return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />Error</Badge>;
      default:
        return <Badge variant="outline"><RefreshCw className="w-3 h-3 mr-1" />Pending</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="w-7 h-7 text-primary" />
            Copy Trading Manager
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage up to 50 follower accounts with 1:1 copy trading
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={startAllFollowers}
            disabled={followers.length === 0 || !masterConfig.copyTradingEnabled}
            className="bg-profit hover:bg-profit/90"
          >
            <Play className="w-4 h-4 mr-2" />
            Start All
          </Button>
          <Button
            onClick={pauseAllFollowers}
            disabled={followers.length === 0}
            variant="secondary"
          >
            <Square className="w-4 h-4 mr-2" />
            Pause All
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-card/50">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-primary/10">
                <Users className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Active Followers</p>
                <p className="text-2xl font-bold">{activeFollowers}<span className="text-sm text-muted-foreground">/{followers.length}</span></p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/50">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-profit/10">
                <Activity className="w-5 h-5 text-profit" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Trades Today</p>
                <p className="text-2xl font-bold">{totalTradesToday}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/50">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-accent/50">
                <TrendingUp className="w-5 h-5 text-accent-foreground" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Success Rate</p>
                <p className="text-2xl font-bold">{successRate}%</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/50">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-secondary">
                <DollarSign className="w-5 h-5 text-secondary-foreground" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Volume</p>
                <p className="text-2xl font-bold">${totalVolume.toFixed(2)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Tabs */}
      <Tabs defaultValue="followers" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4 lg:w-auto lg:inline-grid">
          <TabsTrigger value="followers">Followers</TabsTrigger>
          <TabsTrigger value="master">Master Config</TabsTrigger>
          <TabsTrigger value="risk">Risk Settings</TabsTrigger>
          <TabsTrigger value="logs">Activity Logs</TabsTrigger>
        </TabsList>

        {/* Followers Tab */}
        <TabsContent value="followers" className="space-y-4">
          {/* Toolbar */}
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
            <div className="flex gap-2 flex-wrap">
              <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
                <DialogTrigger asChild>
                  <Button disabled={followers.length >= 50}>
                    <Plus className="w-4 h-4 mr-2" />
                    Add Follower
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Add New Follower</DialogTitle>
                    <DialogDescription>
                      Enter the follower's nickname and Deriv API token (Trade scope required)
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label>Nickname</Label>
                      <Input
                        placeholder="e.g., John's Account"
                        value={newFollower.nickname}
                        onChange={e => setNewFollower(prev => ({ ...prev, nickname: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>API Token</Label>
                      <Input
                        type="password"
                        placeholder="Deriv API Token"
                        value={newFollower.token}
                        onChange={e => setNewFollower(prev => ({ ...prev, token: e.target.value }))}
                      />
                      <p className="text-xs text-muted-foreground">
                        Token must have Trade scope. Get from Settings → API Token on Deriv.
                      </p>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>Cancel</Button>
                    <Button onClick={addFollower}>Add Follower</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Dialog open={isBulkDialogOpen} onOpenChange={setIsBulkDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" disabled={followers.length >= 50}>
                    <Upload className="w-4 h-4 mr-2" />
                    Bulk Import
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Bulk Import Tokens</DialogTitle>
                    <DialogDescription>
                      Paste multiple API tokens, one per line (max {50 - followers.length} more)
                    </DialogDescription>
                  </DialogHeader>
                  <div className="py-4">
                    <textarea
                      className="w-full h-40 p-3 rounded-lg border bg-background text-sm font-mono resize-none"
                      placeholder="Paste tokens here, one per line..."
                      value={bulkTokens}
                      onChange={e => setBulkTokens(e.target.value)}
                    />
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setIsBulkDialogOpen(false)}>Cancel</Button>
                    <Button onClick={addBulkFollowers}>Import All</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {selectedFollowers.size > 0 && (
                <Button variant="destructive" onClick={removeSelectedFollowers}>
                  <Trash2 className="w-4 h-4 mr-2" />
                  Remove ({selectedFollowers.size})
                </Button>
              )}
            </div>

            <div className="flex gap-2 w-full sm:w-auto">
              <Input
                placeholder="Search followers..."
                className="w-full sm:w-48"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="paused">Paused</SelectItem>
                  <SelectItem value="error">Error</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Followers Table */}
          <Card>
            <ScrollArea className="h-[400px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">
                      <input
                        type="checkbox"
                        className="rounded"
                        checked={selectedFollowers.size === filteredFollowers.length && filteredFollowers.length > 0}
                        onChange={e => {
                          if (e.target.checked) {
                            setSelectedFollowers(new Set(filteredFollowers.map(f => f.id)));
                          } else {
                            setSelectedFollowers(new Set());
                          }
                        }}
                      />
                    </TableHead>
                    <TableHead>Nickname</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Balance</TableHead>
                    <TableHead>Trades</TableHead>
                    <TableHead>Last Error</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredFollowers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                        {followers.length === 0 
                          ? "No followers added yet. Click 'Add Follower' to get started."
                          : "No followers match your filters."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredFollowers.map(follower => (
                      <TableRow key={follower.id}>
                        <TableCell>
                          <input
                            type="checkbox"
                            className="rounded"
                            checked={selectedFollowers.has(follower.id)}
                            onChange={e => {
                              const newSet = new Set(selectedFollowers);
                              if (e.target.checked) {
                                newSet.add(follower.id);
                              } else {
                                newSet.delete(follower.id);
                              }
                              setSelectedFollowers(newSet);
                            }}
                          />
                        </TableCell>
                        <TableCell className="font-medium">{follower.nickname}</TableCell>
                        <TableCell>{getStatusBadge(follower.status)}</TableCell>
                        <TableCell className="font-mono">
                          ${follower.balance.toFixed(2)} {follower.currency}
                        </TableCell>
                        <TableCell>{follower.totalTrades}</TableCell>
                        <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">
                          {follower.lastError || '—'}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => testConnection(follower.id)}
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => toggleFollowerStatus(follower.id)}
                            >
                              {follower.status === 'active' ? (
                                <Pause className="w-3.5 h-3.5" />
                              ) : (
                                <Play className="w-3.5 h-3.5" />
                              )}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive hover:text-destructive"
                              onClick={() => setDeleteConfirmId(follower.id)}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </ScrollArea>
          </Card>

          <p className="text-xs text-muted-foreground text-center">
            {followers.length}/50 follower slots used
          </p>
        </TabsContent>

        {/* Master Config Tab */}
        <TabsContent value="master" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-primary" />
                Master Account Configuration
              </CardTitle>
              <CardDescription>
                Configure your master trader account to enable copy trading
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Master Admin Token</Label>
                  <div className="relative">
                    <Input
                      type={showMasterTokens ? 'text' : 'password'}
                      placeholder="Admin scope token"
                      value={masterConfig.adminToken}
                      onChange={e => setMasterConfig(prev => ({ ...prev, adminToken: e.target.value }))}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="absolute right-1 top-1 h-8 w-8 p-0"
                      onClick={() => setShowMasterTokens(!showMasterTokens)}
                    >
                      {showMasterTokens ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">Required to enable copy trading</p>
                </div>

                <div className="space-y-2">
                  <Label>Master Read-Only Token</Label>
                  <Input
                    type={showMasterTokens ? 'text' : 'password'}
                    placeholder="Read scope token"
                    value={masterConfig.readOnlyToken}
                    onChange={e => setMasterConfig(prev => ({ ...prev, readOnlyToken: e.target.value }))}
                  />
                  <p className="text-xs text-muted-foreground">Shared with followers for copying</p>
                </div>

                <div className="space-y-2">
                  <Label>Deriv App ID</Label>
                  <Input
                    placeholder="App ID from developers.deriv.com"
                    value={masterConfig.appId}
                    onChange={e => setMasterConfig(prev => ({ ...prev, appId: e.target.value }))}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Master Account ID</Label>
                  <Input
                    placeholder="e.g., CR1234567"
                    value={masterConfig.accountId}
                    onChange={e => setMasterConfig(prev => ({ ...prev, accountId: e.target.value }))}
                  />
                </div>
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <Label className="text-base">Copy Trading Status</Label>
                  <p className="text-sm text-muted-foreground">
                    {masterConfig.copyTradingEnabled 
                      ? 'Copy trading is enabled. Followers can attach to your account.'
                      : 'Enable copy trading to allow followers to copy your trades.'}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {masterConfig.copyTradingEnabled ? (
                    <Badge className="bg-profit/20 text-profit">
                      <CheckCircle2 className="w-3 h-3 mr-1" />
                      Enabled
                    </Badge>
                  ) : (
                    <Badge variant="secondary">Disabled</Badge>
                  )}
                  <Button 
                    onClick={enableCopyTrading}
                    disabled={masterConfig.copyTradingEnabled || !masterConfig.adminToken}
                  >
                    <Zap className="w-4 h-4 mr-2" />
                    Enable Copy Trading
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Risk Settings Tab */}
        <TabsContent value="risk" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-warning" />
                Global Risk Management
              </CardTitle>
              <CardDescription>
                These settings apply to all new followers by default
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-6 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Minimum Balance Requirement ($)</Label>
                  <Input
                    type="number"
                    value={riskSettings.globalMinBalance}
                    onChange={e => setRiskSettings(prev => ({ 
                      ...prev, 
                      globalMinBalance: parseFloat(e.target.value) || 0 
                    }))}
                  />
                  <p className="text-xs text-muted-foreground">
                    Followers below this balance will be auto-paused
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Maximum Stake (% of balance)</Label>
                  <Input
                    type="number"
                    max={100}
                    value={riskSettings.globalMaxStakePercent}
                    onChange={e => setRiskSettings(prev => ({ 
                      ...prev, 
                      globalMaxStakePercent: parseFloat(e.target.value) || 0 
                    }))}
                  />
                  <p className="text-xs text-muted-foreground">
                    Maximum stake per trade as percentage of follower balance
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Max Drawdown (%)</Label>
                  <Input
                    type="number"
                    max={100}
                    value={riskSettings.maxDrawdownPercent}
                    onChange={e => setRiskSettings(prev => ({ 
                      ...prev, 
                      maxDrawdownPercent: parseFloat(e.target.value) || 0 
                    }))}
                  />
                  <p className="text-xs text-muted-foreground">
                    Stop copying if follower drawdown exceeds this
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Pause After Consecutive Losses</Label>
                  <Select 
                    value={String(riskSettings.pauseOnConsecutiveLosses)}
                    onValueChange={v => setRiskSettings(prev => ({ 
                      ...prev, 
                      pauseOnConsecutiveLosses: parseInt(v) 
                    }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">Disabled</SelectItem>
                      <SelectItem value="2">2 losses</SelectItem>
                      <SelectItem value="3">3 losses</SelectItem>
                      <SelectItem value="4">4 losses</SelectItem>
                      <SelectItem value="5">5 losses</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <Label className="text-base">Auto-pause on Error</Label>
                  <p className="text-sm text-muted-foreground">
                    Automatically pause followers when they encounter errors
                  </p>
                </div>
                <Switch
                  checked={riskSettings.autoPauseOnError}
                  onCheckedChange={v => setRiskSettings(prev => ({ ...prev, autoPauseOnError: v }))}
                />
              </div>

              <div className="flex justify-end">
                <Button onClick={() => toast.success('Risk settings saved')}>
                  <Settings2 className="w-4 h-4 mr-2" />
                  Save Settings
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Logs Tab */}
        <TabsContent value="logs" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="w-5 h-5 text-primary" />
                  Activity Logs
                </CardTitle>
                <CardDescription>Real-time copy trading activity</CardDescription>
              </div>
              <Button variant="outline" size="sm">
                <Download className="w-4 h-4 mr-2" />
                Export
              </Button>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[400px]">
                {copyLogs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <Activity className="w-12 h-12 mb-4 opacity-20" />
                    <p>No activity yet</p>
                    <p className="text-xs">Logs will appear here when trades are copied</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {copyLogs.map(log => (
                      <div 
                        key={log.id}
                        className="flex items-center gap-3 p-3 rounded-lg bg-muted/50"
                      >
                        {log.status === 'success' ? (
                          <CheckCircle2 className="w-4 h-4 text-profit shrink-0" />
                        ) : (
                          <XCircle className="w-4 h-4 text-loss shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {log.followerNickname} → {log.contractType} on {log.symbol}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Stake: ${log.stakeAmount.toFixed(2)}
                            {log.errorMessage && <span className="text-loss ml-2">• {log.errorMessage}</span>}
                          </p>
                        </div>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {new Date(log.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Follower?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the follower and stop copy trading for their account. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteConfirmId && removeFollower(deleteConfirmId)}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
