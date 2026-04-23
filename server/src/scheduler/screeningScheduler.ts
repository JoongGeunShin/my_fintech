import { runFullScreening } from '../services/optional/screeningPipelineService.js';

const INTERVAL_MS = 5 * 60 * 1000; // 5분

let timer: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

/**
 * 스케줄러 시작
 * - 서버 시작 직후 1회 즉시 실행
 * - 이후 5분마다 반복
 */
export function startScreeningScheduler(): void {
  if (timer) {
    console.warn('[Scheduler] 이미 실행 중입니다.');
    return;
  }

  console.log('[Scheduler] 조건 검색 스케줄러 시작 (5분 간격)');

  // 즉시 1회 실행
  _runSafe();

  timer = setInterval(_runSafe, INTERVAL_MS);
}

export function stopScreeningScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    console.log('[Scheduler] 스케줄러 정지');
  }
}

async function _runSafe(): Promise<void> {
  if (isRunning) {
    console.warn('[Scheduler] 이전 실행이 아직 진행 중 → 스킵');
    return;
  }

  isRunning = true;
  try {
    await runFullScreening();
  } catch (err) {
    console.error('[Scheduler] 스크리닝 실패:', err instanceof Error ? err.message : err);
  } finally {
    isRunning = false;
  }
}
