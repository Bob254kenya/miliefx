const DERIV_APP_ID = 117223;
const DERIV_WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${DERIV_APP_ID}`;
const DERIV_OAUTH_URL = `https://oauth.deriv.com/oauth2/authorize?app_id=${DERIV_APP_ID}`;

export interface DerivAccount {
  loginid: string;
  token: string;
  currency: string;
  is_virtual: boolean;
}

export interface AuthorizeResponse {
  authorize: {
    loginid: string;
    balance: number;
    currency: string;
    is_virtual: number;
    email: string;
    fullname: string;
    account_list: Array<{
      loginid: string;
      currency: string;
      is_virtual: number;
    }>;
  };
}

export interface TickData {
  tick: {
    symbol: string;
    epoch: number;
    quote: number;
    ask: number;
    bid: number;
  };
}

export interface TickHistoryResponse {
  history: {
    prices: number[];
    times: number[];
  };
}

export type MessageHandler = (data: any) => void;

class DerivAPI {
  private ws: WebSocket | null = null;
  private reqId = 0;
  private handlers: Map<number, (data: any) => void> = new Map();
  private subscriptionHandlers: Map<string, MessageHandler[]> = new Map();
  private globalHandlers: MessageHandler[] = [];
  private connected = false;
  private connectPromise: Promise<void> | null = null;

  get isConnected() { return this.connected; }

  connect(): Promise<void> {
    if (this.connectPromise) return this.connectPromise;
    
    this.connectPromise = new Promise((resolve, reject) => {
      this.ws = new WebSocket(DERIV_WS_URL);
      
      this.ws.onopen = () => {
        this.connected = true;
        resolve();
      };

      this.ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        // Handle request-response
        if (data.req_id && this.handlers.has(data.req_id)) {
          this.handlers.get(data.req_id)!(data);
          this.handlers.delete(data.req_id);
        }

        // Handle tick subscriptions
        if (data.tick) {
          const symbol = data.tick.symbol;
          const handlers = this.subscriptionHandlers.get(symbol) || [];
          handlers.forEach(h => h(data));
        }

        // Global handlers
        this.globalHandlers.forEach(h => h(data));
      };

      this.ws.onclose = () => {
        this.connected = false;
        this.connectPromise = null;
      };

      this.ws.onerror = (err) => {
        this.connected = false;
        this.connectPromise = null;
        reject(err);
      };
    });

    return this.connectPromise;
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.connected = false;
      this.connectPromise = null;
      this.handlers.clear();
      this.subscriptionHandlers.clear();
    }
  }

  private send(data: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not connected'));
        return;
      }
      const reqId = ++this.reqId;
      data.req_id = reqId;
      this.handlers.set(reqId, resolve);
      this.ws.send(JSON.stringify(data));
      
      setTimeout(() => {
        if (this.handlers.has(reqId)) {
          this.handlers.delete(reqId);
          reject(new Error('Request timeout'));
        }
      }, 30000);
    });
  }

  async authorize(token: string): Promise<AuthorizeResponse> {
    await this.connect();
    const response = await this.send({ authorize: token });
    if (response.error) throw new Error(response.error.message);
    return response;
  }

  async getBalance(): Promise<any> {
    const response = await this.send({ balance: 1, subscribe: 1 });
    if (response.error) throw new Error(response.error.message);
    return response;
  }

  async subscribeTicks(symbol: string, handler: MessageHandler) {
    const existing = this.subscriptionHandlers.get(symbol) || [];
    existing.push(handler);
    this.subscriptionHandlers.set(symbol, existing);

    if (existing.length === 1) {
      await this.send({ ticks: symbol, subscribe: 1 });
    }
  }

  async unsubscribeTicks(symbol: string) {
    this.subscriptionHandlers.delete(symbol);
    try {
      await this.send({ forget_all: 'ticks' });
    } catch {}
  }

  async getTickHistory(symbol: string, count: number = 100): Promise<TickHistoryResponse> {
    const response = await this.send({
      ticks_history: symbol,
      count,
      end: 'latest',
      style: 'ticks',
    });
    if (response.error) throw new Error(response.error.message);
    return response;
  }

  async buy(params: {
    contract_type: string;
    symbol: string;
    duration: number;
    duration_unit: string;
    basis: string;
    amount: number;
    barrier?: string;
  }): Promise<any> {
    const proposal = await this.send({
      proposal: 1,
      ...params,
      currency: 'USD',
    });
    if (proposal.error) throw new Error(proposal.error.message);

    const buyResponse = await this.send({
      buy: proposal.proposal.id,
      price: params.amount,
    });
    if (buyResponse.error) throw new Error(buyResponse.error.message);
    return buyResponse;
  }

  onMessage(handler: MessageHandler) {
    this.globalHandlers.push(handler);
    return () => {
      this.globalHandlers = this.globalHandlers.filter(h => h !== handler);
    };
  }
}

export const derivApi = new DerivAPI();

export function getOAuthUrl(): string {
  return DERIV_OAUTH_URL;
}

export function parseOAuthRedirect(search: string): DerivAccount[] {
  const params = new URLSearchParams(search);
  const accounts: DerivAccount[] = [];
  
  let i = 1;
  while (params.has(`acct${i}`)) {
    accounts.push({
      loginid: params.get(`acct${i}`)!,
      token: params.get(`token${i}`)!,
      currency: params.get(`cur${i}`) || 'USD',
      is_virtual: params.get(`acct${i}`)!.startsWith('VRTC'),
    });
    i++;
  }
  
  return accounts;
}

export const MARKETS = [
  { symbol: 'R_10', name: 'Volatility 10', group: 'Volatility' },
  { symbol: 'R_25', name: 'Volatility 25', group: 'Volatility' },
  { symbol: 'R_50', name: 'Volatility 50', group: 'Volatility' },
  { symbol: 'R_75', name: 'Volatility 75', group: 'Volatility' },
  { symbol: 'R_100', name: 'Volatility 100', group: 'Volatility' },
  { symbol: '1HZ10V', name: 'Volatility 10 (1s)', group: '1s Volatility' },
  { symbol: '1HZ25V', name: 'Volatility 25 (1s)', group: '1s Volatility' },
  { symbol: '1HZ50V', name: 'Volatility 50 (1s)', group: '1s Volatility' },
  { symbol: '1HZ75V', name: 'Volatility 75 (1s)', group: '1s Volatility' },
  { symbol: '1HZ100V', name: 'Volatility 100 (1s)', group: '1s Volatility' },
] as const;

export type MarketSymbol = typeof MARKETS[number]['symbol'];
