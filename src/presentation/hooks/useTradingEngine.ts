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
  entryTime: string;
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

export type TradingMode = 'virtual' | 'real';

export interface TradingStatus {
  isRunning: boolean;
  mode: TradingMode;
  portfolio: VirtualPortfolio;
  position: VirtualPosition | null;
  monitoredStockCount: number;
  topSignals: TopSignal[];
  lastUpdated: string;
}

export interface RealPosition {
  code: string;
  name: string;
  quantity: number;
  avgPrice: number;
  currentValue: number;
}

export interface RealBalance {
  availableCash: number;
  positions: RealPosition[];
}

// ─────────────────────────────────────────────────────────────

export function useTradingEngine() {
  const [status,        setStatus]        = useState<TradingStatus | null>(null);
  const [trades,        setTrades]        = useState<VirtualTrade[]>([]);
  const [isConnected,   setIsConnected]   = useState(false);
  const [halted,        setHalted]        = useState<{ reason: string; dailyPnL: number } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [selectedMode,  setSelectedMode]  = useState<TradingMode>('virtual');
  const [realBalance,   setRealBalance]   = useState<RealBalance | null>(null);
  const socketRef   = useRef<Socket | null>(null);
  const realSecretRef = useRef<string>('');

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

  const fetchRealBalance = useCallback(async () => {
    try {
      const res  = await fetch('/trading/real/balance');
      const json = await res.json() as { success: boolean; data: RealBalance };
      if (json.success) setRealBalance(json.data);
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

  // 실전 모드 전환 시 KIS 잔고 조회
  useEffect(() => {
    if (selectedMode === 'real') {
      fetchRealBalance();
    } else {
      setRealBalance(null);
    }
  }, [selectedMode, fetchRealBalance]);

  // ── 모드 전환 핸들러 ─────────────────────────────────────────

  const handleModeChange = useCallback((mode: TradingMode) => {
    if (mode === 'real') {
      const input = window.prompt('실전 모드 비밀번호를 입력하세요:');
      if (!input) return;
      realSecretRef.current = input;
      setSelectedMode('real');
    } else {
      realSecretRef.current = '';
      setSelectedMode('virtual');
      setRealBalance(null);
    }
  }, []);

  // ── 제어 액션 ────────────────────────────────────────────────

  const start = useCallback(async (mode: TradingMode = selectedMode) => {
    if (mode === 'real') {
      const ok = window.confirm(
        '⚠ 실전 모드로 시작합니다.\n\n' +
        '실제 KIS 계좌에서 주문이 발생합니다.\n' +
        '일간 손익 ±5% 한도가 자동 적용됩니다.\n\n' +
        '계속하시겠습니까?'
      );
      if (!ok) return;
    }

    setActionLoading(true);
    try {
      const res = await fetch('/trading/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, secret: mode === 'real' ? realSecretRef.current : undefined }),
      });
      const json = await res.json() as { success: boolean; message?: string };
      if (!json.success) {
        window.alert(json.message ?? '시작 실패');
        if (mode === 'real') {
          realSecretRef.current = '';
          setSelectedMode('virtual');
          setRealBalance(null);
        }
      }
    } finally { setActionLoading(false); }
  }, [selectedMode]);

  const stop = useCallback(async () => {
    setActionLoading(true);
    try { await fetch('/trading/stop', { method: 'POST' }); }
    finally { setActionLoading(false); }
  }, []);

  const reset = useCallback(async () => {
    if (status?.mode === 'real') {
      window.alert('실전 모드에서는 초기화할 수 없습니다.');
      return;
    }
    const ok = window.confirm('포트폴리오를 초기화하면 가상 잔고가 1천만원으로 리셋됩니다. 계속하시겠습니까?');
    if (!ok) return;
    setActionLoading(true);
    try {
      await fetch('/trading/reset', { method: 'POST' });
      await Promise.all([fetchStatus(), fetchTrades()]);
      setHalted(null);
    } finally { setActionLoading(false); }
  }, [fetchStatus, fetchTrades, status?.mode]);

  return {
    status, trades, isConnected, halted, actionLoading,
    selectedMode, handleModeChange,
    realBalance, fetchRealBalance,
    start, stop, reset,
  };
}
