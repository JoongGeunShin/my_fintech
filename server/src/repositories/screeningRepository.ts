import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from '../config/firebase.js';

// ── 통과 조건 시퀀스 (이름 포함) ─────────────────────────────
export interface PassedSequenceInfo {
  seq: number;
  conditionName: string;
}

export interface ScreenedStock {
  code: string;
  name: string;
  price: string;
  changeRate: string;
  tradeVolume: string;
  tradeAmount: string;
  high52Price: string;
  low52Price: string;

  passedSequences: number[];            // 하위 호환 유지
  passedSequenceInfos: PassedSequenceInfo[]; // seq + 이름 (요구사항 4)
  score: number;
  updatedAt: Timestamp | FieldValue;
}

export interface ScreeningRun {
  runAt: Timestamp | FieldValue;
  totalStocks: number;
  durationMs: number;
  sequences: number[];
  groupName: string; // 어떤 그룹의 실행인지
}

// ── 컬렉션 이름 헬퍼 ────────────────────────────────────────
const MAIN_GROUP = 'my_fintech';

/** my_fintech 레벨별 컬렉션 */
const COL_LEVEL         = (level: number) => `screenedLevel${level}`;
const COL_PREV_LEVEL    = (level: number) => `previousScreenedLevel${level}`;

/** 그 외 그룹은 groupName 자체가 컬렉션 이름 */
const COL_GROUP         = (groupName: string) => `screened_${groupName}`;
const COL_PREV_GROUP    = (groupName: string) => `previousScreened_${groupName}`;

const COL_RUNS = 'screeningRuns';

// ─────────────────────────────────────────────────────────────
// my_fintech 저장 (레벨 기반)
// ─────────────────────────────────────────────────────────────

/**
 * 1. 현재 레벨 컬렉션 → previousScreenedLevelN 으로 이동 (snapshot 복사)
 * 2. 새 데이터로 screenedLevelN 완전 교체
 * 3. previousScreenedLevelN 에서 48시간 초과 문서 삭제
 */
async function saveLevelResults(
  resultsByLevel: Map<number, ScreenedStock[]>,
  durationMs: number
): Promise<void> {
  const now = new Date();
  const cutoff = Timestamp.fromDate(new Date(now.getTime() - 48 * 60 * 60 * 1000));

  for (const [level, stocks] of resultsByLevel) {
    const curCol  = db.collection(COL_LEVEL(level));
    const prevCol = db.collection(COL_PREV_LEVEL(level));

    // ── step 1: 현재 데이터를 previousScreenedLevelN 으로 복사 ──
    const currentSnap = await curCol.get();
    if (!currentSnap.empty) {
      const copyBatch = db.batch();
      for (const doc of currentSnap.docs) {
        const prevRef = prevCol.doc(doc.id);
        // updatedAt 을 현재 시각으로 찍어 48시간 기준으로 사용
        copyBatch.set(prevRef, {
          ...doc.data(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      await copyBatch.commit();
    }

    // ── step 2: 현재 컬렉션 완전 삭제 후 새 데이터 삽입 ──
    const deleteBatch = db.batch();
    for (const doc of currentSnap.docs) {
      deleteBatch.delete(doc.ref);
    }
    await deleteBatch.commit();

    const insertBatch = db.batch();
    for (const stock of stocks) {
      const ref = curCol.doc(stock.name); // 종목명을 doc ID로 사용
      insertBatch.set(ref, { ...stock, updatedAt: FieldValue.serverTimestamp() });
    }
    await insertBatch.commit();

    // ── step 3: previous 에서 48시간 초과 문서 삭제 ──
    await _deleteOldDocs(prevCol, cutoff);
  }

  // screeningRuns 저장
  const runRef = db.collection(COL_RUNS).doc();
  await runRef.set({
    runAt: FieldValue.serverTimestamp(),
    totalStocks: [...resultsByLevel.values()].reduce((s, arr) => s + arr.length, 0),
    durationMs,
    sequences: [...resultsByLevel.keys()],
    groupName: MAIN_GROUP,
  } satisfies ScreeningRun);

  console.log(
    `[Firebase/my_fintech] 저장 완료: ` +
    [...resultsByLevel.entries()]
      .map(([lvl, s]) => `level${lvl}:${s.length}개`)
      .join(' | ')
  );
}

// ─────────────────────────────────────────────────────────────
// 기타 그룹 저장 (groupName 기반)
// ─────────────────────────────────────────────────────────────

/**
 * groupName 컬렉션으로 저장.
 * 동일하게 현재 → previous 복사 → 교체 → 48h 정리 패턴.
 */
async function saveGroupResults(
  groupName: string,
  stocks: ScreenedStock[],
  durationMs: number
): Promise<void> {
  const now = new Date();
  const cutoff = Timestamp.fromDate(new Date(now.getTime() - 48 * 60 * 60 * 1000));

  const curCol  = db.collection(COL_GROUP(groupName));
  const prevCol = db.collection(COL_PREV_GROUP(groupName));

  // step 1: 현재 → previous 복사
  const currentSnap = await curCol.get();
  if (!currentSnap.empty) {
    const copyBatch = db.batch();
    for (const doc of currentSnap.docs) {
      copyBatch.set(prevCol.doc(doc.id), {
        ...doc.data(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    await copyBatch.commit();
  }

  // step 2: 현재 컬렉션 교체
  const deleteBatch = db.batch();
  for (const doc of currentSnap.docs) deleteBatch.delete(doc.ref);
  await deleteBatch.commit();

  const insertBatch = db.batch();
  for (const stock of stocks) {
    insertBatch.set(curCol.doc(stock.name), {
      ...stock,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  await insertBatch.commit();

  // step 3: previous 48h 정리
  await _deleteOldDocs(prevCol, cutoff);

  // screeningRuns 저장
  await db.collection(COL_RUNS).add({
    runAt: FieldValue.serverTimestamp(),
    totalStocks: stocks.length,
    durationMs,
    sequences: stocks.flatMap((s) => s.passedSequences),
    groupName,
  } satisfies ScreeningRun);

  console.log(`[Firebase/${groupName}] 저장 완료: ${stocks.length}개 종목`);
}

// ─────────────────────────────────────────────────────────────
// 공통 진입점 (screeningPipelineService 에서 호출)
// ─────────────────────────────────────────────────────────────

/**
 * groupName 에 따라 저장 전략 분기.
 *
 * @param groupName       조건 그룹 이름
 * @param resultsByLevel  my_fintech 전용 (레벨 → 종목 맵)
 * @param allStocks       그 외 그룹 전용 (단순 목록)
 * @param durationMs      실행 소요 시간
 */
export async function saveScreeningResults(
  groupName: string,
  resultsByLevel: Map<number, ScreenedStock[]>,
  allStocks: ScreenedStock[],
  durationMs: number
): Promise<void> {
  if (groupName === MAIN_GROUP) {
    await saveLevelResults(resultsByLevel, durationMs);
  } else {
    await saveGroupResults(groupName, allStocks, durationMs);
  }
}

// ─────────────────────────────────────────────────────────────
// 조회
// ─────────────────────────────────────────────────────────────

/** my_fintech: 특정 레벨 이상의 종목 조회 */
export async function getStocksByMinLevel(minLevel: number): Promise<ScreenedStock[]> {
  const snapshot = await db
    .collection(COL_LEVEL(minLevel))
    .orderBy('score', 'desc')
    .get();
  return snapshot.docs.map((d) => d.data() as ScreenedStock);
}

/** 특정 그룹의 종목 조회 */
export async function getStocksByGroup(groupName: string): Promise<ScreenedStock[]> {
  const snapshot = await db.collection(COL_GROUP(groupName)).get();
  return snapshot.docs.map((d) => d.data() as ScreenedStock);
}

/** 최근 스크리닝 실행 기록 */
export async function getRecentRuns(limit = 10): Promise<ScreeningRun[]> {
  const snapshot = await db
    .collection(COL_RUNS)
    .orderBy('runAt', 'desc')
    .limit(limit)
    .get();
  return snapshot.docs.map((d) => d.data() as ScreeningRun);
}

// ─────────────────────────────────────────────────────────────
// 내부 유틸
// ─────────────────────────────────────────────────────────────

/** updatedAt 기준으로 cutoff 이전 문서 일괄 삭제 */
async function _deleteOldDocs(
  col: FirebaseFirestore.CollectionReference,
  cutoff: Timestamp
): Promise<void> {
  // updatedAt 필드가 없는 문서도 포함하려면 별도 처리 필요하지만
  // 우리 데이터는 항상 updatedAt 을 찍으므로 단순 쿼리로 충분
  const oldSnap = await col.where('updatedAt', '<', cutoff).get();
  if (oldSnap.empty) return;

  const batch = db.batch();
  for (const doc of oldSnap.docs) batch.delete(doc.ref);
  await batch.commit();
  console.log(`[Firebase] ${col.id}: ${oldSnap.size}개 만료 문서 삭제`);
}