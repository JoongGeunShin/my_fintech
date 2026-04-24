import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

// ── 타입 ─────────────────────────────────────────────
export interface ScreenedStockClient {
  code: string;
  name: string;
  price: string;
  changeRate: string;
  tradeVolume: string;
  score: number;
  passedSequences: number[];
}

export interface ScreeningData {
  runAt: string;
  topStocks: ScreenedStockClient[];
  byLevel: Record<string, ScreenedStockClient[]>;
}

// 서버 이벤트 이름 (socketServer.ts의 EVENTS와 동일)
const EVENTS = {
  SCREENING_UPDATE: 'screening:update',
  SCREENING_ERROR: 'screening:error',
  CONNECTED: 'connected',
  SUBSCRIBE_SCREENING: 'subscribe:screening',
  UNSUBSCRIBE_SCREENING: 'unsubscribe:screening',
  REQUEST_SNAPSHOT: 'request:snapshot',
} as const;

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001';

// ── 훅 ───────────────────────────────────────────────
export function useScreening() {
  const [data, setData] = useState<ScreeningData | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = io(SERVER_URL, {
      // 자동 재연결 설정
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 10_000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setIsConnected(true);
      setError(null);
      // 연결되면 스크리닝 룸 구독
      socket.emit(EVENTS.SUBSCRIBE_SCREENING);
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
    });

    socket.on(EVENTS.SCREENING_UPDATE, (payload: ScreeningData) => {
      setData(payload);
      setError(null);
    });

    socket.on(EVENTS.SCREENING_ERROR, ({ message }: { message: string }) => {
      setError(message);
    });

    return () => {
      socket.emit(EVENTS.UNSUBSCRIBE_SCREENING);
      socket.disconnect();
    };
  }, []);

  // 수동으로 최신 데이터 요청
  const requestSnapshot = () => {
    socketRef.current?.emit(EVENTS.REQUEST_SNAPSHOT);
  };

  return { data, isConnected, error, requestSnapshot };
}