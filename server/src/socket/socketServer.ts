import { Server as HttpServer } from 'http';
import { Socket, Server as SocketServer } from 'socket.io';
import { getScreeningResult, ScreeningResult } from '../services/optional/screeningPipelineService.js';

// ── 이벤트 이름 상수 ────────────────────────────────────
export const EVENTS = {
  // 서버 → 클라이언트
  SCREENING_UPDATE: 'screening:update',   // 스크리닝 결과 push
  SCREENING_ERROR: 'screening:error',     // 스크리닝 오류
  CONNECTED: 'connected',                 // 연결 확인

  // 클라이언트 → 서버
  SUBSCRIBE_SCREENING: 'subscribe:screening',   // 스크리닝 구독
  UNSUBSCRIBE_SCREENING: 'unsubscribe:screening',
  REQUEST_SNAPSHOT: 'request:snapshot',         // 즉시 현재 결과 요청
} as const;

// 스크리닝 구독자 룸 이름
const ROOM_SCREENING = 'screening';

let io: SocketServer | null = null;

export function initSocketServer(httpServer: HttpServer): SocketServer {
  io = new SocketServer(httpServer, {
    cors: {
      origin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
      methods: ['GET', 'POST'],
    },
    // 연결 끊김 감지 주기
    pingTimeout: 20_000,
    pingInterval: 10_000,
  });

  io.on('connection', (socket: Socket) => {
    console.log(`[Socket] 연결: ${socket.id}`);

    socket.emit(EVENTS.CONNECTED, { socketId: socket.id });

    // ── 스크리닝 구독 ──────────────────────────────────
    socket.on(EVENTS.SUBSCRIBE_SCREENING, async () => {
      socket.join(ROOM_SCREENING);
      console.log(`[Socket] ${socket.id} → 스크리닝 구독`);

      // 구독 즉시 현재 캐시 결과 전송
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
      console.log(`[Socket] ${socket.id} → 스크리닝 구독 해제`);
    });

    // ── 스냅샷 요청 (캐시 무시하고 즉시 반환) ──────────
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

    socket.on('disconnect', (reason) => {
      console.log(`[Socket] 해제: ${socket.id} (${reason})`);
    });
  });

  console.log('[Socket] socket.io 서버 초기화 완료');
  return io;
}

/**
 * 스케줄러에서 새 스크리닝 결과가 나오면 이 함수로 브로드캐스트
 */
export function broadcastScreeningUpdate(result: ScreeningResult): void {
  if (!io) {
    console.warn('[Socket] io 미초기화 상태에서 broadcast 시도');
    return;
  }

  const subscriberCount = io.sockets.adapter.rooms.get(ROOM_SCREENING)?.size ?? 0;
  if (subscriberCount === 0) return;

  io.to(ROOM_SCREENING).emit(EVENTS.SCREENING_UPDATE, serializeResult(result));
  console.log(`[Socket] 브로드캐스트 → ${subscriberCount}명 (${result.topStocks.length}개 종목)`);
}

// Timestamp 등 직렬화 불가 타입 처리
function serializeResult(result: ScreeningResult) {
  return {
    runAt: result.runAt.toISOString(),
    topStocks: result.topStocks.slice(0, 50),
    byLevel: Object.fromEntries(
      Object.entries(result.byLevel).map(([lvl, stocks]) => [
        lvl,
        stocks.map((s) => ({
          ...s,
          updatedAt: undefined, // Firestore Timestamp 제거
        })),
      ])
    ),
  };
}