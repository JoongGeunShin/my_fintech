import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3000';

// ── 서버 타입 미러 ────────────────────────────────────────────

export interface VirtualPortfolio {
  balance: number;
  initialBalance: number;
  dailyPnL: number;
  totalTrades: number;
  winTrades: number;
  isActive: boolean;
}

export interface VirtualPosition {
  code: string;
  name: string;
  entryPrice: number;
  quantity: number;
  entryTime: string;       // ISO string (JSON 직렬화)
  stopLossPrice: number;
  takeProfitPrice: number;
  currentPrice: number;
  unrealizedPnL: number;
  unrealizedPnLRate: number;
  atrAtEntry: number;
  scoreAtEntry: number;
}

export interface VirtualTrade {
  code: string;
  name: string;
  side: 'BUY' | 'SELL';
  price: number;
  quantity: number;
  amount: number;
  executedAt: string;
  realizedPnL?: number;
  pnlRate?: number;
  reason: string;
}

export interface TopSignal {
  code: string;
  name: string;
  score: number;
  signal: string;
}

export interface TradingStatus {
  isRunning: boolean;
  portfolio: VirtualPortfolio;
  position: VirtualPosition | null;
  monitoredStockCount: number;
  topSignals: TopSignal[];
  lastUpdated: string;
}

// ─────────────────────────────────────────────────────────────

export function useTradingEngine() {
  const [status,      setStatus]      = useState<TradingStatus | null>(null);
  const [trades,      setTrades]      = useState<VirtualTrade[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [halted,      setHalted]      = useState<{ reason: string; dailyPnL: number } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res  = await fetch('/trading/status');
      const json = await res.json() as { success: boolean; data: TradingStatus };
      if (json.success) setStatus(json.data);
    } catch { /* ignore */ }
  }, []);

  const fetchTrades = useCallback(async () => {
    try {
      const res  = await fetch('/trading/trades?limit=20');
      const json = await res.json() as { success: boolean; data: VirtualTrade[] };
      if (json.success) setTrades(json.data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchStatus();
    fetchTrades();

    const socket = io(SERVER_URL, {
      transports: ['polling', 'websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1_000,
    });
    socketRef.current = socket;

    socket.on('connect',    () => setIsConnected(true));
    socket.on('disconnect', () => setIsConnected(false));

    socket.on('trading:status', (data: TradingStatus) => setStatus(data));

    socket.on('trading:order', ({ trade }: { side: string; trade: VirtualTrade }) => {
      setTrades((prev) => [trade, ...prev].slice(0, 30));
    });

    socket.on('trading:halted', (data: { reason: string; dailyPnL: number }) => {
      setHalted(data);
    });

    return () => { socket.disconnect(); };
  }, [fetchStatus, fetchTrades]);

  // ── 제어 액션 ────────────────────────────────────────────────

  const start = useCallback(async () => {
    setActionLoading(true);
    try { await fetch('/trading/start', { method: 'POST' }); }
    finally { setActionLoading(false); }
  }, []);

  const stop = useCallback(async () => {
    setActionLoading(true);
    try { await fetch('/trading/stop', { method: 'POST' }); }
    finally { setActionLoading(false); }
  }, []);

  const reset = useCallback(async () => {
    const ok = window.confirm('포트폴리오를 초기화하면 가상 잔고가 1천만원으로 리셋됩니다. 계속하시겠습니까?');
    if (!ok) return;
    setActionLoading(true);
    try {
      await fetch('/trading/reset', { method: 'POST' });
      await Promise.all([fetchStatus(), fetchTrades()]);
      setHalted(null);
    } finally { setActionLoading(false); }
  }, [fetchStatus, fetchTrades]);

  return { status, trades, isConnected, halted, actionLoading, start, stop, reset };
}
