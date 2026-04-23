import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from '../config/firebase.js';

export interface ScreenedStock {
  code: string;
  name: string;
  price: string;
  changeRate: string;
  tradeVolume: string;
  tradeAmount: string;
  high52Price: string;
  low52Price: string;

  passedSequences: number[];
  score: number;  // 레벨 1=필수통과 2=필수+보조통과 3=필수+보조+세부하나이상
  updatedAt: Timestamp | FieldValue;
}

export interface ScreeningRun {
  runAt: Timestamp | FieldValue;
  totalStocks: number;
  durationMs: number;
  sequences: number[];
}

// ─── 컬렉션명 상수 ───────────────────────────────────────
const COL_RUNS = 'screeningRuns';
const COL_LEVEL = (level: number) => `screenedLevel${level}`; // level1, level2, ...

/**
 * 스크리닝 결과를 Firebase에 저장
 * - 레벨별 컬렉션(screenedLevel1~N)에 종목 upsert
 * - screeningRuns 에 실행 메타데이터 저장
 */
export async function saveScreeningResults(
  resultsByLevel: Map<number, ScreenedStock[]>,
  durationMs: number
): Promise<void> {
  const batch = db.batch();
  const allCodes = new Set<string>();

  for (const [level, stocks] of resultsByLevel) {
    const col = db.collection(COL_LEVEL(level));
    for (const stock of stocks) {
      allCodes.add(stock.code);
      const ref = col.doc(stock.name);
      batch.set(ref, { ...stock, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
  }

  // 실행 메타 저장
  const runRef = db.collection(COL_RUNS).doc();
  const sequences = [...resultsByLevel.keys()];
  batch.set(runRef, {
    runAt: FieldValue.serverTimestamp(),
    totalStocks: allCodes.size,
    durationMs,
    sequences,
  } satisfies ScreeningRun);

  await batch.commit();
  console.log(`[Firebase] 저장 완료: ${allCodes.size}개 종목, 레벨 ${sequences.join(',')}`);
}

/**
 * 특정 레벨 이상의 종목 조회
 */
export async function getStocksByMinLevel(minLevel: number): Promise<ScreenedStock[]> {
  const snapshot = await db
    .collection(COL_LEVEL(minLevel))
    .orderBy('score', 'desc')
    .get();

  return snapshot.docs.map((d) => d.data() as ScreenedStock);
}

/**
 * 최근 스크리닝 실행 기록 조회
 */
export async function getRecentRuns(limit = 10): Promise<ScreeningRun[]> {
  const snapshot = await db
    .collection(COL_RUNS)
    .orderBy('runAt', 'desc')
    .limit(limit)
    .get();

  return snapshot.docs.map((d) => d.data() as ScreeningRun);
}