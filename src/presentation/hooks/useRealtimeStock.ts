// src/presentation/hooks/useRealtimeStock.ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

// ── 서버와 공유하는 타입 ──────────────────────────────────────

export interface RealtimeOrderBook {
  code: string;
  timestamp: string;
  totalAskVolume: number;
  totalBidVolume: number;
  askPrices: number[];
  askVolumes: number[];
  bidPrices: number[];
  bidVolumes: number[];
  askLevelPrices: number[];
  bidLevelPrices: number[];
  isAfterHours?: boolean;
}

export interface RealtimeTrade {
  code: string;
  timestamp: string;
  tradePrice: number;
  tradeVolume: number;
  tradeAmount: number;
  changePrice: number;
  changeRate: number;
  changeSign: string;
  accVolume: number;
  accAmount: number;
  highPrice: number;
  lowPrice: number;
  openPrice: number;
  bidReqCount: number;
  askReqCount: number;
  netBidVolume: number;
  isAfterHours?: boolean;
}

// ── 이벤트 상수 ───────────────────────────────────────────────
const EVENTS = {
  ORDERBOOK_UPDATE:      'realtime:orderbook',
  TRADE_UPDATE:          'realtime:trade',
  SUBSCRIBE_ORDERBOOK:   'subscribe:orderbook',
  UNSUBSCRIBE_ORDERBOOK: 'unsubscribe:orderbook',
  SUBSCRIBE_TRADE:       'subscribe:trade',
  UNSUBSCRIBE_TRADE:     'unsubscribe:trade',
} as const;

// ── Socket.IO 서버 URL ────────────────────────────────────────
// Socket.IO는 Vite proxy를 거치지 않고 서버에 직접 연결
// VITE_SERVER_URL이 없으면 PORT=3000 서버로 직접 연결
const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3000';

// ── 공유 소켓 싱글턴 ─────────────────────────────────────────
let _sharedSocket: Socket | null = null;
let _refCount = 0;
let _disconnectTimer: ReturnType<typeof setTimeout> | null = null;

function acquireSocket(): Socket {
  if (_disconnectTimer) {
    clearTimeout(_disconnectTimer);
    _disconnectTimer = null;
  }
  if (!_sharedSocket) {
    _sharedSocket = io(SERVER_URL, {
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 10_000,
      // polling 우선 → websocket 업그레이드 (Vite proxy 환경에서 안정적)
      transports: ['polling', 'websocket'],
    });
    console.log('[Socket] 새 소켓 생성:', SERVER_URL);
  }
  _refCount++;
  return _sharedSocket;
}

function releaseSocket(): void {
  _refCount = Math.max(0, _refCount - 1);
  if (_refCount === 0) {
    _disconnectTimer = setTimeout(() => {
      if (_refCount === 0 && _sharedSocket) {
        _sharedSocket.disconnect();
        _sharedSocket = null;
        console.log('[Socket] 소켓 해제');
      }
      _disconnectTimer = null;
    }, 150);
  }
}

// ─────────────────────────────────────────────────────────────
// useRealtimeOrderBook
// ─────────────────────────────────────────────────────────────

export function useRealtimeOrderBook(code: string | null) {
  const [orderBook,   setOrderBook]   = useState<RealtimeOrderBook | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const socketRef  = useRef<Socket | null>(null);
  const activeCode = useRef<string | null>(null);
  const codeRef    = useRef<string | null>(code);
  codeRef.current  = code;

  const subscribe = useCallback((socket: Socket, c: string) => {
    socket.emit(EVENTS.SUBSCRIBE_ORDERBOOK, { code: c });
    activeCode.current = c;
    console.log('[OrderBook] 구독 emit:', c);
  }, []);

  const unsubscribe = useCallback((socket: Socket, c: string) => {
    socket.emit(EVENTS.UNSUBSCRIBE_ORDERBOOK, { code: c });
    activeCode.current = null;
  }, []);

  useEffect(() => {
    const socket = acquireSocket();
    socketRef.current = socket;

    const onConnect = () => {
      setIsConnected(true);
      if (codeRef.current) subscribe(socket, codeRef.current);
    };
    const onDisconnect = () => setIsConnected(false);
    const onData = (d: RealtimeOrderBook) => {
      if (d.code === codeRef.current) setOrderBook(d);
    };

    socket.on('connect',               onConnect);
    socket.on('disconnect',            onDisconnect);
    socket.on(EVENTS.ORDERBOOK_UPDATE, onData);

    if (socket.connected) {
      setIsConnected(true);
      if (codeRef.current) subscribe(socket, codeRef.current);
    }

    return () => {
      socket.off('connect',               onConnect);
      socket.off('disconnect',            onDisconnect);
      socket.off(EVENTS.ORDERBOOK_UPDATE, onData);
      if (activeCode.current) unsubscribe(socket, activeCode.current);
      releaseSocket();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;
    if (activeCode.current && activeCode.current !== code) {
      unsubscribe(socket, activeCode.current);
      setOrderBook(null);
    }
    if (code && socket.connected) {
      setIsConnected(true);
      subscribe(socket, code);
    }
  }, [code, subscribe, unsubscribe]);

  return { orderBook, isConnected };
}

// ─────────────────────────────────────────────────────────────
// useRealtimeTrade
// ─────────────────────────────────────────────────────────────

export function useRealtimeTrade(code: string | null, maxHistory = 60) {
  const [latestTrade, setLatestTrade] = useState<RealtimeTrade | null>(null);
  const [trades,      setTrades]      = useState<RealtimeTrade[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const socketRef  = useRef<Socket | null>(null);
  const activeCode = useRef<string | null>(null);
  const codeRef    = useRef<string | null>(code);
  codeRef.current  = code;

  const subscribe = useCallback((socket: Socket, c: string) => {
    socket.emit(EVENTS.SUBSCRIBE_TRADE, { code: c });
    activeCode.current = c;
    console.log('[Trade] 구독 emit:', c);
  }, []);

  const unsubscribe = useCallback((socket: Socket, c: string) => {
    socket.emit(EVENTS.UNSUBSCRIBE_TRADE, { code: c });
    activeCode.current = null;
  }, []);

  useEffect(() => {
    const socket = acquireSocket();
    socketRef.current = socket;

    const onConnect = () => {
      setIsConnected(true);
      if (codeRef.current) subscribe(socket, codeRef.current);
    };
    const onDisconnect = () => setIsConnected(false);
    const onData = (d: RealtimeTrade) => {
      if (d.code !== codeRef.current) return;
      setLatestTrade(d);
      setTrades((prev) => [d, ...prev].slice(0, maxHistory));
    };

    socket.on('connect',           onConnect);
    socket.on('disconnect',        onDisconnect);
    socket.on(EVENTS.TRADE_UPDATE, onData);

    if (socket.connected) {
      setIsConnected(true);
      if (codeRef.current) subscribe(socket, codeRef.current);
    }

    return () => {
      socket.off('connect',          onConnect);
      socket.off('disconnect',       onDisconnect);
      socket.off(EVENTS.TRADE_UPDATE, onData);
      if (activeCode.current) unsubscribe(socket, activeCode.current);
      releaseSocket();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;
    if (activeCode.current && activeCode.current !== code) {
      unsubscribe(socket, activeCode.current);
      setLatestTrade(null);
      setTrades([]);
    }
    if (code && socket.connected) {
      setIsConnected(true);
      subscribe(socket, code);
    }
  }, [code, subscribe, unsubscribe]);

  return { latestTrade, trades, isConnected };
}