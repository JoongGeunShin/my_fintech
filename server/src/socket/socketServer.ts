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

// ── 이벤트 이름 상수 ─────────────────────────────────────────
export const EVENTS = {
  // 서버 → 클라이언트
  SCREENING_UPDATE:   'screening:update',
  SCREENING_ERROR:    'screening:error',
  CONNECTED:          'connected',
  ORDERBOOK_UPDATE:   'realtime:orderbook',   // 실시간 호가
  TRADE_UPDATE:       'realtime:trade',        // 실시간 체결가

  // 클라이언트 → 서버
  SUBSCRIBE_SCREENING:   'subscribe:screening',
  UNSUBSCRIBE_SCREENING: 'unsubscribe:screening',
  REQUEST_SNAPSHOT:      'request:snapshot',
  SUBSCRIBE_ORDERBOOK:   'subscribe:orderbook', // { code: string }
  UNSUBSCRIBE_ORDERBOOK: 'unsubscribe:orderbook',
  SUBSCRIBE_TRADE:       'subscribe:trade',     // { code: string }
  UNSUBSCRIBE_TRADE:     'unsubscribe:trade',
} as const;

// ── 룸 이름 헬퍼 ─────────────────────────────────────────────
const ROOM_SCREENING       = 'screening';
const ROOM_ORDERBOOK       = (code: string) => `orderbook:${code}`;
const ROOM_TRADE           = (code: string) => `trade:${code}`;

let io: SocketServer | null = null;

// ── 실시간 콜백 (종목별 1개씩만 등록, 다수 클라이언트 공유) ──
const orderbookCallbacks = new Map<string, (d: RealtimeOrderBook) => void>();
const tradeCallbacks     = new Map<string, (d: RealtimeTrade) => void>();

/** 해당 룸의 구독자 수 */
function roomSize(room: string): number {
  return io?.sockets.adapter.rooms.get(room)?.size ?? 0;
}

/** 종목 호가 구독 (처음 구독자가 생기면 KIS WS 등록) */
function ensureOrderBookSubscribed(code: string): void {
  if (orderbookCallbacks.has(code)) return;

  const cb = (data: RealtimeOrderBook) => {
    if (!io) return;
    io.to(ROOM_ORDERBOOK(code)).emit(EVENTS.ORDERBOOK_UPDATE, data);
  };

  orderbookCallbacks.set(code, cb);
  kisWebSocketService.subscribeOrderBook(code, cb);
  console.log(`[Socket] KIS 호가 구독 시작: ${code}`);
}

/** 종목 호가 해제 (마지막 구독자가 빠지면 KIS WS 해제) */
function maybeUnsubscribeOrderBook(code: string): void {
  if (roomSize(ROOM_ORDERBOOK(code)) > 0) return;
  const cb = orderbookCallbacks.get(code);
  if (!cb) return;
  kisWebSocketService.unsubscribeOrderBook(code, cb);
  orderbookCallbacks.delete(code);
  console.log(`[Socket] KIS 호가 구독 해제: ${code}`);
}

/** 종목 체결 구독 */
function ensureTradeSubscribed(code: string): void {
  if (tradeCallbacks.has(code)) return;

  const cb = (data: RealtimeTrade) => {
    if (!io) return;
    io.to(ROOM_TRADE(code)).emit(EVENTS.TRADE_UPDATE, data);
  };

  tradeCallbacks.set(code, cb);
  kisWebSocketService.subscribeTrade(code, cb);
  console.log(`[Socket] KIS 체결 구독 시작: ${code}`);
}

/** 종목 체결 해제 */
function maybeUnsubscribeTrade(code: string): void {
  if (roomSize(ROOM_TRADE(code)) > 0) return;
  const cb = tradeCallbacks.get(code);
  if (!cb) return;
  kisWebSocketService.unsubscribeTrade(code, cb);
  tradeCallbacks.delete(code);
  console.log(`[Socket] KIS 체결 구독 해제: ${code}`);
}

// ─────────────────────────────────────────────────────────────

export function initSocketServer(httpServer: HttpServer): SocketServer {
  io = new SocketServer(httpServer, {
    cors: {
      origin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
      methods: ['GET', 'POST'],
    },
    pingTimeout:  20_000,
    pingInterval: 10_000,
  });

  // KIS 웹소켓 연결 (서버 시작 시 1회)
  kisWebSocketService.connect().catch((err) => {
    console.error('[Socket] KIS WS 초기 연결 실패:', err);
  });

  io.on('connection', (socket: Socket) => {
    console.log(`[Socket] 연결: ${socket.id}`);
    socket.emit(EVENTS.CONNECTED, { socketId: socket.id });

    // ── 스크리닝 구독 ──────────────────────────────────────
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

    // ── 실시간 호가 구독 ────────────────────────────────────
    socket.on(EVENTS.SUBSCRIBE_ORDERBOOK, ({ code }: { code: string }) => {
      if (!code) return;
      socket.join(ROOM_ORDERBOOK(code));
      ensureOrderBookSubscribed(code);
      console.log(`[Socket] ${socket.id} → 호가 구독: ${code}`);
    });

    socket.on(EVENTS.UNSUBSCRIBE_ORDERBOOK, ({ code }: { code: string }) => {
      if (!code) return;
      socket.leave(ROOM_ORDERBOOK(code));
      // 다음 틱에서 룸 사이즈 확인 후 KIS WS 해제 결정
      setImmediate(() => maybeUnsubscribeOrderBook(code));
      console.log(`[Socket] ${socket.id} → 호가 해제: ${code}`);
    });

    // ── 실시간 체결 구독 ────────────────────────────────────
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
      console.log(`[Socket] ${socket.id} → 체결 해제: ${code}`);
    });

    // ── 연결 해제 처리 ──────────────────────────────────────
    socket.on('disconnect', (reason) => {
      console.log(`[Socket] 해제: ${socket.id} (${reason})`);

      // 이 소켓이 구독하던 종목 룸에서 빠졌으므로
      // 구독자가 0이 된 종목은 KIS WS도 해제
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
  if (!io) {
    console.warn('[Socket] io 미초기화 상태에서 broadcast 시도');
    return;
  }
  const subscriberCount = io.sockets.adapter.rooms.get(ROOM_SCREENING)?.size ?? 0;
  if (subscriberCount === 0) return;

  io.to(ROOM_SCREENING).emit(EVENTS.SCREENING_UPDATE, serializeResult(result));
  console.log(`[Socket] 스크리닝 브로드캐스트 → ${subscriberCount}명 (${result.topStocks.length}개 종목)`);
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