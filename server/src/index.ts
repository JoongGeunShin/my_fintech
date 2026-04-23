import cors from 'cors';
import 'dotenv/config';
import express from 'express';

// Firebase Admin 초기화 
import './config/firebase.js';

import { errorHandler } from './middleware/errorHandler.js';
import optionalSearchItemRouter from './routes/optional/optionalSearchItem.js';
import optionalSearchListRouter from './routes/optional/optionalSearchList.js';
import screeningResultsRouter from './routes/optional/screeningResults.js';
import stockInvestorRouter from './routes/stockInvestors.js';
import stockPeriodRouter from './routes/stockPeriod.js';
import stockPeriodSpecifiedRouter from './routes/stockPeriodSpecified.js';
import stocksRouter from './routes/stocks.js';
import { startScreeningScheduler } from './scheduler/screeningScheduler.js';

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(express.json());
app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
    methods: ['GET', 'POST'],
  })
);

// ── 서버 상태 ──────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── 단순 조회 ──────────────────────────────────────────
app.use('/item/stocks', stocksRouter);
app.use('/item/stocks/investor', stockInvestorRouter);
app.use('/item/stocks/period', stockPeriodRouter);
app.use('/item/stocks/period/specified', stockPeriodSpecifiedRouter);

// ── 조건 검색 ──────────────────────────────────────────
app.use('/optional/search-list', optionalSearchListRouter);
app.use('/optional/search-list/sequence', optionalSearchItemRouter);

// ── 스크리닝 파이프라인 ─────────────────────────────────
// GET  /optional/screening          → 최신 결과 (캐시 우선)
// POST /optional/screening/run      → 수동 즉시 실행
// GET  /optional/screening/level/:n → 레벨 n 이상 종목
app.use('/optional/screening', screeningResultsRouter);

// ── 404 ────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: '요청한 경로를 찾을 수 없습니다.' },
  });
});

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`\n서버가 실행 중입니다: http://localhost:${PORT}`);
  console.log(`서버 상태: http://localhost:${PORT}/health`);
  console.log('\n< 단순 조회 >');
  console.log(`  주식 조회: http://localhost:${PORT}/item/stocks/?code=005930`);
  console.log(`  기간별: http://localhost:${PORT}/item/stocks/period?code=005930&period=D`);
  console.log(`  기간별(상세): http://localhost:${PORT}/item/stocks/period/specified?code=005930&startDate=20200101&endDate=20201231`);
  console.log(`  투자자별: http://localhost:${PORT}/item/stocks/investor?code=005930`);
  console.log('\n< 조건 검색 >');
  console.log(`  조건 리스트: http://localhost:${PORT}/optional/search-list`);
  console.log(`  조건 항목: http://localhost:${PORT}/optional/search-list/sequence?sequence=0`);
  console.log('\n< 스크리닝 >');
  console.log(`  최신 결과: http://localhost:${PORT}/optional/screening`);
  console.log(`  수동 실행: POST http://localhost:${PORT}/optional/screening/run`);
  console.log(`  레벨별: http://localhost:${PORT}/optional/screening/level/2`);

  const requiredEnvVars = [
    'KIS_API_APP_KEY',
    'KIS_API_APP_SECRET_KEY',
    'KIS_ACCOUNT_ID',
    'FIREBASE_PROJECT_ID',
    'FIREBASE_CLIENT_EMAIL',
    'FIREBASE_PRIVATE_KEY',
  ];
  const missing = requiredEnvVars.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.warn('\n⚠️  누락된 환경변수:', missing.join(', '));
  } else {
    console.log('\n✅ 환경변수 로드 완료');
  }

  const firebaseReady =
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY;

  if (firebaseReady) {
    startScreeningScheduler();
  } else {
    console.warn('[Scheduler] Firebase 환경변수 미설정으로 스케줄러를 시작하지 않습니다.');
  }
});

export default app;