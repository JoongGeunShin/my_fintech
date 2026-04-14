import cors from 'cors';
import 'dotenv/config';
import express from 'express';
import { errorHandler } from './middleware/errorHandler.js';
import stocksRouter from './routes/stocks.js';

// Express 앱 초기화
const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(express.json());
app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
    methods: ['GET'],
  })
);

// < 서버 상태 >
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// < 단순 조회 >
app.use('/item/stocks', stocksRouter);
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
  console.log('< 단순 조회 >');
  console.log(`주식 조회: http://localhost:${PORT}/item/stocks/?code=005930\n`);

  const requiredEnvVars = [
    'KIS_API_APP_KEY',
    'KIS_API_APP_SECRET_KEY',
    'KIS_ACCOUNT_ID',
  ];
  const missing = requiredEnvVars.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.warn('누락된 환경변수:', missing.join(', '));
    console.warn('server/.env 파일을 확인필요.\n');
  } else {
    console.log('환경변수 로드 완료');
  }
});

export default app;
