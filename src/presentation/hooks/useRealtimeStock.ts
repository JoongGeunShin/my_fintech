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

// ── REST fallback 타입 ───────────────────────────────────────
interface RestStockPrice {
  currentPrice: number;
  change: number;
  changeSign: string; // '상한'|'상승'|'보합'|'하락'|'하한'
  changeRate: number;
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  volume: number;
  askPrice: number;
  bidPrice: number;
}

const SIGN_CODE: Record<string, string> = {
  '상한': '1', '상승': '2', '보합': '3', '하락': '4', '하한': '5',
};

function nowTs(): string {
  const n = new Date();
  return n.getHours().toString().padStart(2, '0') +
         n.getMinutes().toString().padStart(2, '0') +
         n.getSeconds().toString().padStart(2, '0');
}

async function fetchRestPrice(code: string): Promise<RestStockPrice | null> {
  try {
    const res = await fetch(`/item/stocks?code=${code}`);
    if (!res.ok) return null;
    const json = await res.json() as { success: boolean; data?: RestStockPrice };
    return json.success && json.data ? json.data : null;
  } catch {
    return null;
  }
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
  const socketRef    = useRef<Socket | null>(null);
  const activeCode   = useRef<string | null>(null);
  const codeRef      = useRef<string | null>(code);
  const orderBookRef = useRef<RealtimeOrderBook | null>(null);
  codeRef.current    = code;
  orderBookRef.current = orderBook;

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

  // REST polling:
  //   - 구독 후 2초 이내 실시간 데이터 없으면 REST로 호가 초기화
  //   - 이후 10초마다 갱신 (H0STBSP0가 오면 자동으로 교체됨)
  //   - isAfterHours=false인 live 데이터가 이미 있으면 건너뜀
  useEffect(() => {
    if (!code) return;
    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      const d = await fetchRestPrice(code);
      if (cancelled || !d) return;
      const askP = d.askPrice  || d.currentPrice;
      const bidP = d.bidPrice  || d.currentPrice;
      setOrderBook(prev => {
        if (prev && prev.isAfterHours === false) return prev;
        return {
          code,
          timestamp:      nowTs(),
          totalAskVolume: 0,
          totalBidVolume: 0,
          askPrices:      [askP],
          askVolumes:     [0],
          bidPrices:      [bidP],
          bidVolumes:     [0],
          askLevelPrices: [],
          bidLevelPrices: [],
          isAfterHours:   true,
        };
      });
    };

    const initial  = setTimeout(poll, 2_000);
    const interval = setInterval(poll, 10_000);

    return () => {
      cancelled = true;
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [code]);

  return { orderBook, isConnected };
}

// ─────────────────────────────────────────────────────────────
// useRealtimeTrade
// ─────────────────────────────────────────────────────────────

export function useRealtimeTrade(code: string | null, maxHistory = 60) {
  const [latestTrade, setLatestTrade] = useState<RealtimeTrade | null>(null);
  const [trades,      setTrades]      = useState<RealtimeTrade[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const socketRef      = useRef<Socket | null>(null);
  const activeCode     = useRef<string | null>(null);
  const codeRef        = useRef<string | null>(code);
  const latestTradeRef = useRef<RealtimeTrade | null>(null);
  codeRef.current      = code;
  latestTradeRef.current = latestTrade;

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

  // REST fallback: 구독 후 2초 이내 실시간 데이터가 없으면 현재가로 초기화
  // (시간외 단일가 10분 체결 공백, 시간외 데이터 없는 종목 대응)
  useEffect(() => {
    if (!code) return;
    const timer = setTimeout(async () => {
      if (latestTradeRef.current !== null) return;
      const d = await fetchRestPrice(code);
      if (!d || latestTradeRef.current !== null) return;
      const synthetic: RealtimeTrade = {
        code,
        timestamp:    nowTs(),
        tradePrice:   d.currentPrice,
        tradeVolume:  0,
        tradeAmount:  0,
        changePrice:  d.change,
        changeRate:   d.changeRate,
        changeSign:   SIGN_CODE[d.changeSign] ?? '3',
        accVolume:    d.volume,
        accAmount:    0,
        highPrice:    d.highPrice,
        lowPrice:     d.lowPrice,
        openPrice:    d.openPrice,
        bidReqCount:  0,
        askReqCount:  0,
        netBidVolume: 0,
        isAfterHours: true,
      };
      setLatestTrade(synthetic);
      setTrades([synthetic]);
    }, 2_000);
    return () => clearTimeout(timer);
  }, [code]);

  return { latestTrade, trades, isConnected };
}