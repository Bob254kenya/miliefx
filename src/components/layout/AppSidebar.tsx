import { useState } from 'react';
import { Plus, ChevronRight, TrendingUp, Shield, Star, Wallet, DollarSign } from 'lucide-react';

interface Account {
  id: string;
  type: 'real' | 'demo';
  currency: string;
  balance: number;
  loginid: string;
  isDefault?: boolean;
}

interface OptionsAccountsProps {
  accounts: Account[];
  activeAccountId?: string;
  onSelectAccount: (accountId: string) => void;
  onManageFunds: () => void;
}

// Demo Icon Component - Maroon gradient with split text (64x40px)
const DemoIcon = () => (
  <div className="w-16 h-10 rounded-lg bg-gradient-to-br from-[#8B0000] to-[#4a0000] flex items-center justify-center shadow-md relative overflow-hidden">
    <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent"></div>
    <div className="relative z-10 flex items-center gap-0.5">
      <span className="text-white font-bold text-xs tracking-wide">deriv</span>
      <span className="text-amber-400 font-bold text-xs">demo</span>
    </div>
  </div>
);

// Real Account Icon Component - USA Flag (40x40px)
const RealAccountIcon = ({ currency }: { currency: string }) => {
  const [imageError, setImageError] = useState(false);
  const currencyLower = currency.toLowerCase();

  if (currencyLower === 'usd') {
    if (!imageError) {
      return (
        <div className="w-10 h-10 rounded-lg overflow-hidden shadow-md">
          <img 
            src="https://flagcdn.com/us.svg"
            className="w-full h-full object-cover"
            alt="USA Flag"
            onError={() => setImageError(true)}
          />
        </div>
      );
    }
    return (
      <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center">
        <span className="text-lg font-bold text-white">$</span>
      </div>
    );
  }

  // Handle other currencies
  return (
    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-gray-500 to-gray-700 flex items-center justify-center">
      <span className="text-lg font-bold text-white">{currency.charAt(0)}</span>
    </div>
  );
};

const OptionsAccounts = ({ 
  accounts, 
  activeAccountId, 
  onSelectAccount, 
  onManageFunds 
}: OptionsAccountsProps) => {
  const [hoveredAccount, setHoveredAccount] = useState<string | null>(null);

  const realAccounts = accounts.filter(acc => acc.type === 'real');
  const demoAccounts = accounts.filter(acc => acc.type === 'demo');

  const formatBalance = (balance: number, currency: string) => {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(balance) + ' ' + currency;
  };

  const AccountCard = ({ account }: { account: Account }) => {
    const isActive = account.id === activeAccountId;
    const isHovered = hoveredAccount === account.id;

    return (
      <div
        onClick={() => onSelectAccount(account.id)}
        onMouseEnter={() => setHoveredAccount(account.id)}
        onMouseLeave={() => setHoveredAccount(null)}
        className={`
          relative flex items-center gap-4 p-4 rounded-xl cursor-pointer
          transition-all duration-200 ease-in-out
          ${isActive 
            ? 'bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 border-2 border-blue-500 dark:border-blue-400 shadow-lg' 
            : 'bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700/50 border border-gray-200 dark:border-gray-700'
          }
          ${isHovered && !isActive ? 'transform scale-[1.02] shadow-md' : ''}
        `}
      >
        {/* Account Icon */}
        <div className="flex-shrink-0">
          {account.type === 'real' ? (
            <RealAccountIcon currency={account.currency} />
          ) : (
            <DemoIcon />
          )}
        </div>

        {/* Account Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h3 className="font-semibold text-gray-900 dark:text-white text-base">
              {account.type === 'real' ? `${account.currency} Wallet` : 'Demo Wallet'}
            </h3>
            {account.isDefault && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 text-xs rounded-full">
                <Star className="w-3 h-3" />
                Default
              </span>
            )}
            {account.type === 'real' && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs rounded-full">
                <Shield className="w-3 h-3" />
                Real
              </span>
            )}
          </div>
          
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-xs text-gray-500 dark:text-gray-400 font-mono">
              {account.loginid}
            </p>
            {account.type === 'demo' && (
              <span className="text-xs text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20 px-2 py-0.5 rounded-full font-medium">
                Demo Account
              </span>
            )}
          </div>
        </div>

        {/* Balance */}
        <div className="text-right flex-shrink-0">
          <div className="font-mono font-bold text-gray-900 dark:text-white text-sm">
            {formatBalance(account.balance, account.currency)}
          </div>
          {account.type === 'real' && (
            <div className="text-xs text-green-600 dark:text-green-400 mt-0.5 flex items-center gap-1 justify-end">
              <TrendingUp className="w-3 h-3" />
              <span>Active</span>
            </div>
          )}
          {account.type === 'demo' && (
            <div className="text-xs text-purple-600 dark:text-purple-400 mt-0.5 flex items-center gap-1 justify-end">
              <Wallet className="w-3 h-3" />
              <span>Practice</span>
            </div>
          )}
        </div>

        {/* Active Indicator */}
        {isActive && (
          <div className="absolute -right-0.5 top-1/2 transform -translate-y-1/2 w-1 h-10 bg-blue-500 rounded-l-full"></div>
        )}
      </div>
    );
  };

  return (
    <div className="w-full max-w-2xl mx-auto p-4 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            Options Accounts
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Manage your trading accounts
          </p>
        </div>
        <button 
          onClick={onManageFunds}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" />
          <span className="font-medium">Manage Funds</span>
        </button>
      </div>

      {/* Real Accounts Section */}
      {realAccounts.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider flex items-center gap-2">
              <DollarSign className="w-4 h-4" />
              Real Accounts
            </h3>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {realAccounts.length} account{realAccounts.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="space-y-3">
            {realAccounts.map(account => (
              <AccountCard key={account.id} account={account} />
            ))}
          </div>
        </div>
      )}

      {/* Demo Accounts Section */}
      {demoAccounts.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider flex items-center gap-2">
              <Wallet className="w-4 h-4" />
              Demo Accounts
            </h3>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {demoAccounts.length} account{demoAccounts.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="space-y-3">
            {demoAccounts.map(account => (
              <AccountCard key={account.id} account={account} />
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {accounts.length === 0 && (
        <div className="text-center py-12">
          <div className="w-20 h-20 mx-auto mb-4 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
            <Wallet className="w-10 h-10 text-gray-400" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            No accounts found
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Get started by adding your first trading account
          </p>
          <button
            onClick={onManageFunds}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Account
          </button>
        </div>
      )}

      {/* Manage Funds CTA Button */}
      {accounts.length > 0 && (
        <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onManageFunds}
            className="w-full flex items-center justify-between px-4 py-3 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white rounded-xl transition-all shadow-md hover:shadow-lg"
          >
            <div className="flex items-center gap-2">
              <Wallet className="w-5 h-5" />
              <span className="font-semibold">Manage Funds</span>
            </div>
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      )}
    </div>
  );
};

export default OptionsAccounts;
