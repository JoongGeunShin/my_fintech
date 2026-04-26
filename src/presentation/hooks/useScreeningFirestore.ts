import {
    collection,
    limit,
    onSnapshot,
    orderBy,
    query,
    Timestamp,
} from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { db } from '../../data/sources/firebase';

// ── 타입 (screeningRepository.ts의 ScreenedStock과 동일) ──
export interface ScreenedStockClient {
  code: string;
  name: string;
  price: string;
  changeRate: string;
  tradeVolume: string;
  tradeAmount: string;
  high52Price: string;
  low52Price: string;
  passedSequences: number[];
  score: number;
  updatedAt?: Timestamp;
}

export interface ScreeningRun {
  runAt: Timestamp;
  totalStocks: number;
  durationMs: number;
  sequences: number[];
}

export interface ScreeningDataFirestore {
  byLevel: Record<number, ScreenedStockClient[]>;
  topStocks: ScreenedStockClient[];          // score 높은 순 전체
  lastRun: ScreeningRun | null;
  isLoading: boolean;
  error: string | null;
}

const COL_LEVEL = (level: number) => `screenedLevel${level}`;
const MAX_LEVELS = 3;

export function useScreeningFirestore(): ScreeningDataFirestore {
  const [byLevel, setByLevel] = useState<Record<number, ScreenedStockClient[]>>({});
  const [lastRun, setLastRun] = useState<ScreeningRun | null>(null);
  const [loadingLevels, setLoadingLevels] = useState<Set<number>>(new Set([1, 2, 3]));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubs: (() => void)[] = [];

    // 레벨 1~3 각각 실시간 구독
    for (let level = 1; level <= MAX_LEVELS; level++) {
      const lv = level; // 클로저용 캡처
      const q = query(
        collection(db, COL_LEVEL(lv)),
        orderBy('score', 'desc'),
        limit(100)
      );

      const unsub = onSnapshot(
        q,
        (snapshot) => {
          const stocks: ScreenedStockClient[] = snapshot.docs.map(
            (doc) => doc.data() as ScreenedStockClient
          );
          setByLevel((prev) => ({ ...prev, [lv]: stocks }));
          setLoadingLevels((prev) => {
            const next = new Set(prev);
            next.delete(lv);
            return next;
          });
        },
        (err) => {
          console.error(`[Firestore] level${lv} 구독 오류:`, err);
          setError(`Firestore 연결 오류: ${err.message}`);
          setLoadingLevels((prev) => {
            const next = new Set(prev);
            next.delete(lv);
            return next;
          });
        }
      );

      unsubs.push(unsub);
    }

    // 최근 스크리닝 실행 기록 구독
    const runQ = query(
      collection(db, 'screeningRuns'),
      orderBy('runAt', 'desc'),
      limit(1)
    );
    const runUnsub = onSnapshot(
      runQ,
      (snapshot) => {
        if (!snapshot.empty) {
          setLastRun(snapshot.docs[0].data() as ScreeningRun);
        }
      },
      (err) => {
        console.error('[Firestore] screeningRuns 구독 오류:', err);
      }
    );
    unsubs.push(runUnsub);

    return () => unsubs.forEach((unsub) => unsub());
  }, []);

  // 전체 topStocks: score 높은 순 정렬 (중복 없이 가장 높은 레벨만)
  const topStocks: ScreenedStockClient[] = Object.values(byLevel)
    .flat()
    .sort((a, b) => b.score - a.score || b.passedSequences.length - a.passedSequences.length);

  // 중복 코드 제거 (가장 높은 score 유지)
  const seen = new Set<string>();
  const deduped = topStocks.filter((s) => {
    if (seen.has(s.code)) return false;
    seen.add(s.code);
    return true;
  });

  return {
    byLevel,
    topStocks: deduped,
    lastRun,
    isLoading: loadingLevels.size > 0,
    error,
  };
}