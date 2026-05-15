import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from '../config/firebase.js';
import type { VirtualPortfolio, VirtualPosition, VirtualTrade } from '../types/strategy/types.js';

const COL_PORTFOLIO = 'virtualPortfolio';
const DOC_PORTFOLIO = 'main';
const COL_POSITION  = 'virtualPosition';
const DOC_POSITION  = 'current';
const COL_TRADES    = 'virtualTrades';

export const INITIAL_BALANCE = 10_000_000; // 1천만원 초기 자본

// ── 포트폴리오 ─────────────────────────────────────────────────

export async function getPortfolio(): Promise<VirtualPortfolio> {
  const doc = await db.collection(COL_PORTFOLIO).doc(DOC_PORTFOLIO).get();
  if (!doc.exists) {
    return {
      balance:       INITIAL_BALANCE,
      initialBalance: INITIAL_BALANCE,
      dailyPnL:      0,
      totalTrades:   0,
      winTrades:     0,
      isActive:      false,
    };
  }
  const d = doc.data()!;
  return {
    balance:        d.balance         ?? INITIAL_BALANCE,
    initialBalance: d.initialBalance  ?? INITIAL_BALANCE,
    dailyPnL:       d.dailyPnL        ?? 0,
    dailyPnLDate:   d.dailyPnLDate    ?? '',
    totalTrades:    d.totalTrades     ?? 0,
    winTrades:      d.winTrades       ?? 0,
    isActive:       d.isActive        ?? false,
  };
}

export async function savePortfolio(partial: Partial<VirtualPortfolio>): Promise<void> {
  const data: Record<string, unknown> = { ...partial, updatedAt: FieldValue.serverTimestamp() };
  // dailyPnL 저장 시 날짜도 함께 기록 — 다음 날 복구 시 리셋 판단에 사용
  if ('dailyPnL' in partial) {
    data.dailyPnLDate = new Date().toISOString().slice(0, 10);
  }
  await db.collection(COL_PORTFOLIO).doc(DOC_PORTFOLIO).set(data, { merge: true });
}

// ── 포지션 ────────────────────────────────────────────────────

export async function getPosition(): Promise<VirtualPosition | null> {
  const doc = await db.collection(COL_POSITION).doc(DOC_POSITION).get();
  if (!doc.exists) return null;
  const d = doc.data()!;
  return {
    code:              d.code,
    name:              d.name,
    entryPrice:        d.entryPrice,
    quantity:          d.quantity,
    entryTime:         (d.entryTime as Timestamp).toDate(),
    stopLossPrice:     d.stopLossPrice,
    takeProfitPrice:   d.takeProfitPrice,
    currentPrice:      d.currentPrice   ?? d.entryPrice,
    unrealizedPnL:     d.unrealizedPnL  ?? 0,
    unrealizedPnLRate: d.unrealizedPnLRate ?? 0,
    atrAtEntry:        d.atrAtEntry     ?? 0,
    scoreAtEntry:      d.scoreAtEntry   ?? 0,
  };
}

export async function savePosition(pos: VirtualPosition): Promise<void> {
  await db.collection(COL_POSITION).doc(DOC_POSITION).set({
    ...pos,
    entryTime:  Timestamp.fromDate(pos.entryTime),
    updatedAt:  FieldValue.serverTimestamp(),
  });
}

export async function clearPosition(): Promise<void> {
  await db.collection(COL_POSITION).doc(DOC_POSITION).delete();
}

// ── 거래 내역 ─────────────────────────────────────────────────

export async function saveTrade(trade: VirtualTrade): Promise<void> {
  await db.collection(COL_TRADES).add({
    ...trade,
    executedAt: Timestamp.fromDate(trade.executedAt),
    createdAt:  FieldValue.serverTimestamp(),
  });
}

export async function getRecentTrades(limit = 20): Promise<VirtualTrade[]> {
  const snap = await db.collection(COL_TRADES)
    .orderBy('executedAt', 'desc')
    .limit(limit)
    .get();
  return snap.docs.map((doc) => {
    const d = doc.data();
    return {
      code:        d.code,
      name:        d.name,
      side:        d.side,
      price:       d.price,
      quantity:    d.quantity,
      amount:      d.amount,
      executedAt:  (d.executedAt as Timestamp).toDate(),
      realizedPnL: d.realizedPnL,
      pnlRate:     d.pnlRate,
      reason:      d.reason,
    } as VirtualTrade;
  });
}

// ── 초기화 ────────────────────────────────────────────────────

export async function resetPortfolio(): Promise<void> {
  await clearPosition();
  await savePortfolio({
    balance:        INITIAL_BALANCE,
    initialBalance: INITIAL_BALANCE,
    dailyPnL:       0,
    totalTrades:    0,
    winTrades:      0,
    isActive:       false,
  });
}
