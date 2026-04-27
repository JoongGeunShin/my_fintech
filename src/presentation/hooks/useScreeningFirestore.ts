import { collection, limit, onSnapshot, query, Timestamp } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { db } from '../../data/sources/firebase';

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
  topStocks: ScreenedStockClient[];
  lastRun: ScreeningRun | null;
  isLoading: boolean;
  error: string | null;
}

/** "00000001500.0000" 형식 → 1500 */
export function parsePrice(raw: string): number {
  return parseFloat(raw) || 0;
}

const COL_LEVEL = (level: number) => `screenedLevel${level}`;
const MAX_LEVELS = 3;

export function useScreeningFirestore(): ScreeningDataFirestore {
  const [byLevel, setByLevel] = useState<Record<number, ScreenedStockClient[]>>({});
  const [lastRun, setLastRun] = useState<ScreeningRun | null>(null);
  // levels(3) + screeningRuns(1)
  const [loadingCount, setLoadingCount] = useState(MAX_LEVELS + 1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubs: (() => void)[] = [];

    // 정렬은 클라이언트에서 처리
    for (let level = 1; level <= MAX_LEVELS; level++) {
      const lv = level;
      const q = query(collection(db, COL_LEVEL(lv)), limit(200));

      const unsub = onSnapshot(
        q,
        (snapshot) => {
          const stocks: ScreenedStockClient[] = snapshot.docs
            .map((doc) => doc.data() as ScreenedStockClient)
            .sort(
              (a, b) =>
                b.passedSequences.length - a.passedSequences.length ||
                a.name.localeCompare(b.name, 'ko')
            );

          setByLevel((prev) => ({ ...prev, [lv]: stocks }));
          setLoadingCount((c) => Math.max(0, c - 1));
        },
        (err) => {
          console.error(`[Firestore] level${lv} 오류:`, err.code, err.message);
          setError(`Firestore 오류 (level${lv}): ${err.message}`);
          setLoadingCount((c) => Math.max(0, c - 1));
        }
      );
      unsubs.push(unsub);
    }

    // screeningRuns - 최신 10개 가져와서 클라이언트에서 최신 1건 선택
    const runUnsub = onSnapshot(
      query(collection(db, 'screeningRuns'), limit(10)),
      (snapshot) => {
        if (!snapshot.empty) {
          const sorted = snapshot.docs
            .map((d) => d.data() as ScreeningRun)
            .sort((a, b) => b.runAt.seconds - a.runAt.seconds);
          setLastRun(sorted[0]);
        }
        setLoadingCount((c) => Math.max(0, c - 1));
      },
      (err) => {
        console.error('[Firestore] screeningRuns 오류:', err.message);
        setLoadingCount((c) => Math.max(0, c - 1));
      }
    );
    unsubs.push(runUnsub);

    return () => unsubs.forEach((u) => u());
  }, []);

  // 높은 레벨 우선, 중복 코드 제거
  const seen = new Set<string>();
  const topStocks = [3, 2, 1]
    .flatMap((lv) => byLevel[lv] ?? [])
    .filter((s) => {
      if (seen.has(s.code)) return false;
      seen.add(s.code);
      return true;
    });

  return {
    byLevel,
    topStocks,
    lastRun,
    isLoading: loadingCount > 0,
    error,
  };
}