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
}

export interface RealtimeTrade {
  code: string;
  timestamp: string;
  tradePrice: number;
  tradeVolume: number;
  tradeAmount: number;
  changePrice: number;
  changeRate: number;
  changeSign: string; // '1':상한 '2':상승 '3':보합 '4':하락 '5':하한
  accVolume: number;
  accAmount: number;
  highPrice: number;
  lowPrice: number;
  openPrice: number;
  bidReqCount: number;
  askReqCount: number;
  netBidVolume: number;
}

// ── 이벤트 상수 (socketServer.ts 와 동일) ────────────────────
const EVENTS = {
  ORDERBOOK_UPDATE:      'realtime:orderbook',
  TRADE_UPDATE:          'realtime:trade',
  SUBSCRIBE_ORDERBOOK:   'subscribe:orderbook',
  UNSUBSCRIBE_ORDERBOOK: 'unsubscribe:orderbook',
  SUBSCRIBE_TRADE:       'subscribe:trade',
  UNSUBSCRIBE_TRADE:     'unsubscribe:trade',
} as const;

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001';

// ── 공유 소켓 싱글턴 ─────────────────────────────────────────
let _sharedSocket: Socket | null = null;
let _refCount = 0;
let _disconnectTimer: ReturnType<typeof setTimeout> | null = null;

function acquireSocket(): Socket {
  // 지연 해제 예약이 있으면 취소 (StrictMode 이중 마운트 대응)
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
    });
  }
  _refCount++;
  return _sharedSocket;
}

function releaseSocket(): void {
  _refCount = Math.max(0, _refCount - 1);
  if (_refCount === 0) {
    // StrictMode 의 cleanup → 즉시 재마운트 패턴을 허용하기 위해 지연 해제
    _disconnectTimer = setTimeout(() => {
      if (_refCount === 0 && _sharedSocket) {
        _sharedSocket.disconnect();
        _sharedSocket = null;
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
  // 항상 최신 code 를 onConnect 에서 참조하기 위한 ref
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

    // codeRef 를 참조해 재연결 시에도 현재 code 로 구독
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

    // 이미 연결 중이면 즉시 구독
    if (socket.connected && codeRef.current) {
      setIsConnected(true);
      subscribe(socket, codeRef.current);
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

  // code 변경 시 구독 전환
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;

    if (activeCode.current && activeCode.current !== code) {
      unsubscribe(socket, activeCode.current);
      setOrderBook(null);
    }
    // 소켓이 연결된 경우만 여기서 구독; 미연결이면 onConnect 가 처리
    if (code && socket.connected) {
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

    if (socket.connected && codeRef.current) {
      setIsConnected(true);
      subscribe(socket, codeRef.current);
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
      subscribe(socket, code);
    }
  }, [code, subscribe, unsubscribe]);

  return { latestTrade, trades, isConnected };
}
