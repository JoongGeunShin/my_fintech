// server/src/socket/socketServer.ts
import { Server as HttpServer } from 'http';
import { Socket, Server as SocketServer } from 'socket.io';
import type {
  RealtimeOrderBook,
  RealtimeTrade,
} from '../services/kis/kisWebSocketService.js';
import { kisWebSocketService } from '../services/kis/kisWebSocketService.js';
import {
  getScreeningResult,
  ScreeningResult,
} from '../services/optional/screeningPipelineService.js';

export const EVENTS = {
  SCREENING_UPDATE:      'screening:update',
  SCREENING_ERROR:       'screening:error',
  CONNECTED:             'connected',
  ORDERBOOK_UPDATE:      'realtime:orderbook',
  TRADE_UPDATE:          'realtime:trade',
  SUBSCRIBE_SCREENING:   'subscribe:screening',
  UNSUBSCRIBE_SCREENING: 'unsubscribe:screening',
  REQUEST_SNAPSHOT:      'request:snapshot',
  SUBSCRIBE_ORDERBOOK:   'subscribe:orderbook',
  UNSUBSCRIBE_ORDERBOOK: 'unsubscribe:orderbook',
  SUBSCRIBE_TRADE:       'subscribe:trade',
  UNSUBSCRIBE_TRADE:     'unsubscribe:trade',
} as const;

const ROOM_SCREENING = 'screening';
const ROOM_ORDERBOOK = (code: string) => `orderbook:${code}`;
const ROOM_TRADE     = (code: string) => `trade:${code}`;

let io: SocketServer | null = null;

const orderbookCallbacks = new Map<string, (d: RealtimeOrderBook) => void>();
const tradeCallbacks     = new Map<string, (d: RealtimeTrade) => void>();

function roomSize(room: string): number {
  return io?.sockets.adapter.rooms.get(room)?.size ?? 0;
}

function ensureOrderBookSubscribed(code: string): void {
  if (orderbookCallbacks.has(code)) return;
  const cb = (data: RealtimeOrderBook) => {
    io?.to(ROOM_ORDERBOOK(code)).emit(EVENTS.ORDERBOOK_UPDATE, data);
  };
  orderbookCallbacks.set(code, cb);
  kisWebSocketService.subscribeOrderBook(code, cb);
  console.log(`[Socket] KIS 호가 구독 시작: ${code}`);
}

function maybeUnsubscribeOrderBook(code: string): void {
  if (roomSize(ROOM_ORDERBOOK(code)) > 0) return;
  const cb = orderbookCallbacks.get(code);
  if (!cb) return;
  kisWebSocketService.unsubscribeOrderBook(code, cb);
  orderbookCallbacks.delete(code);
  console.log(`[Socket] KIS 호가 구독 해제: ${code}`);
}

function ensureTradeSubscribed(code: string): void {
  if (tradeCallbacks.has(code)) return;
  const cb = (data: RealtimeTrade) => {
    io?.to(ROOM_TRADE(code)).emit(EVENTS.TRADE_UPDATE, data);
  };
  tradeCallbacks.set(code, cb);
  kisWebSocketService.subscribeTrade(code, cb);
  console.log(`[Socket] KIS 체결 구독 시작: ${code}`);
}

function maybeUnsubscribeTrade(code: string): void {
  if (roomSize(ROOM_TRADE(code)) > 0) return;
  const cb = tradeCallbacks.get(code);
  if (!cb) return;
  kisWebSocketService.unsubscribeTrade(code, cb);
  tradeCallbacks.delete(code);
  console.log(`[Socket] KIS 체결 구독 해제: ${code}`);
}

export function initSocketServer(httpServer: HttpServer): SocketServer {
  // ✅ CORS: 배열로 여러 origin 허용 + credentials
  const allowedOrigins = [
    process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
    'http://localhost:5173',
    'http://localhost:3000',
  ];

  io = new SocketServer(httpServer, {
    cors: {
      origin: (origin, callback) => {
        // origin이 없는 경우(같은 서버 요청)도 허용
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          console.warn(`[Socket] CORS 차단: ${origin}`);
          callback(null, true); // 개발 중엔 전부 허용
        }
      },
      methods: ['GET', 'POST'],
      credentials: true,
    },
    pingTimeout:  20_000,
    pingInterval: 10_000,
    // polling + websocket 둘 다 허용
    transports: ['polling', 'websocket'],
  });

  kisWebSocketService.connect().catch((err) => {
    console.error('[Socket] KIS WS 초기 연결 실패:', err);
  });

  io.on('connection', (socket: Socket) => {
    console.log(`[Socket] 연결: ${socket.id}`);
    socket.emit(EVENTS.CONNECTED, { socketId: socket.id });

    socket.on(EVENTS.SUBSCRIBE_SCREENING, async () => {
      socket.join(ROOM_SCREENING);
      try {
        const result = await getScreeningResult();
        socket.emit(EVENTS.SCREENING_UPDATE, serializeResult(result));
      } catch (err) {
        socket.emit(EVENTS.SCREENING_ERROR, {
          message: err instanceof Error ? err.message : '알 수 없는 오류',
        });
      }
    });

    socket.on(EVENTS.UNSUBSCRIBE_SCREENING, () => {
      socket.leave(ROOM_SCREENING);
    });

    socket.on(EVENTS.REQUEST_SNAPSHOT, async () => {
      try {
        const result = await getScreeningResult();
        socket.emit(EVENTS.SCREENING_UPDATE, serializeResult(result));
      } catch (err) {
        socket.emit(EVENTS.SCREENING_ERROR, {
          message: err instanceof Error ? err.message : '알 수 없는 오류',
        });
      }
    });

    socket.on(EVENTS.SUBSCRIBE_ORDERBOOK, ({ code }: { code: string }) => {
      if (!code) return;
      socket.join(ROOM_ORDERBOOK(code));
      ensureOrderBookSubscribed(code);
      console.log(`[Socket] ${socket.id} → 호가 구독: ${code}`);
    });

    socket.on(EVENTS.UNSUBSCRIBE_ORDERBOOK, ({ code }: { code: string }) => {
      if (!code) return;
      socket.leave(ROOM_ORDERBOOK(code));
      setImmediate(() => maybeUnsubscribeOrderBook(code));
    });

    socket.on(EVENTS.SUBSCRIBE_TRADE, ({ code }: { code: string }) => {
      if (!code) return;
      socket.join(ROOM_TRADE(code));
      ensureTradeSubscribed(code);
      console.log(`[Socket] ${socket.id} → 체결 구독: ${code}`);
    });

    socket.on(EVENTS.UNSUBSCRIBE_TRADE, ({ code }: { code: string }) => {
      if (!code) return;
      socket.leave(ROOM_TRADE(code));
      setImmediate(() => maybeUnsubscribeTrade(code));
    });

    socket.on('disconnect', (reason) => {
      console.log(`[Socket] 해제: ${socket.id} (${reason})`);
      setImmediate(() => {
        for (const code of orderbookCallbacks.keys()) maybeUnsubscribeOrderBook(code);
        for (const code of tradeCallbacks.keys())     maybeUnsubscribeTrade(code);
      });
    });
  });

  console.log('[Socket] socket.io 서버 초기화 완료');
  return io;
}

export function broadcastScreeningUpdate(result: ScreeningResult): void {
  if (!io) return;
  const count = io.sockets.adapter.rooms.get(ROOM_SCREENING)?.size ?? 0;
  if (count === 0) return;
  io.to(ROOM_SCREENING).emit(EVENTS.SCREENING_UPDATE, serializeResult(result));
  console.log(`[Socket] 스크리닝 브로드캐스트 → ${count}명`);
}

function serializeResult(result: ScreeningResult) {
  return {
    runAt: result.runAt.toISOString(),
    topStocks: result.topStocks.slice(0, 50),
    byLevel: Object.fromEntries(
      Object.entries(result.byLevel).map(([lvl, stocks]) => [
        lvl,
        stocks.map((s) => ({ ...s, updatedAt: undefined })),
      ])
    ),
  };
}