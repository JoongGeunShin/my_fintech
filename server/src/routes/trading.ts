import { Router } from 'express';
import { getRecentTrades } from '../repositories/virtualPortfolioRepository.js';
import { getAvailableCash, getRealPositions } from '../services/kis/kisOrderService.js';
import { quantMetricsService } from '../services/strategy/quantMetricsService.js';
import { tradingEngineService } from '../services/strategy/tradingEngineService.js';
import type { TradingMode } from '../types/strategy/types.js';

const router = Router();

/** GET /trading/status — 엔진 상태 + 포트폴리오 + 포지션 */
router.get('/status', (_req, res, next) => {
  try {
    res.json({ success: true, data: tradingEngineService.getStatus() });
  } catch (err) { next(err); }
});

/** GET /trading/metrics — 현재 모니터링 중인 종목별 퀀트 지표 */
router.get('/metrics', (_req, res, next) => {
  try {
    const states = quantMetricsService.getAllStates().map((s) => ({
      code:          s.code,
      name:          s.name,
      score:         s.score,
      signal:        s.signal,
      bor:           s.bor,
      tis:           s.tis,
      cvd:           s.cvd,
      cvdDirection:  s.cvdDirection,
      vwap:          s.vwap,
      vwapDeviation: s.vwapDeviation,
      vrate:         s.vrate,
      vrateReliable: s.vrateReliable,
      currentPrice:  s.currentPrice,
      atr:           s.atr,
      hasWallAsk:    s.hasWallAsk,
      hasWallBid:    s.hasWallBid,
      lastUpdated:   s.lastUpdated,
    }));
    res.json({ success: true, data: states });
  } catch (err) { next(err); }
});

/** GET /trading/trades?limit=20 — 최근 가상 거래 내역 */
router.get('/trades', async (req, res, next) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit as string) || 20, 50);
    const trades = await getRecentTrades(limit);
    res.json({ success: true, data: trades });
  } catch (err) { next(err); }
});

/**
 * POST /trading/start
 * body: { mode?: 'virtual' | 'real', secret?: string }
 * 실전 모드는 REAL_MODE_SECRET 일치 필요
 */
router.post('/start', async (req, res, next) => {
  try {
    const mode: TradingMode = req.body?.mode === 'real' ? 'real' : 'virtual';

    if (mode === 'real') {
      const envSecret = process.env.REAL_MODE_SECRET;
      if (!envSecret) {
        res.status(503).json({ success: false, message: '서버에 REAL_MODE_SECRET이 설정되지 않았습니다.' });
        return;
      }
      if (req.body?.secret !== envSecret) {
        res.status(401).json({ success: false, message: '실전 모드 비밀번호가 올바르지 않습니다.' });
        return;
      }
    }

    await tradingEngineService.start(mode);
    res.json({ success: true, mode, message: `트레이딩 엔진 시작됨 (${mode} 모드)` });
  } catch (err) { next(err); }
});

/** POST /trading/stop — 엔진 중지 */
router.post('/stop', async (_req, res, next) => {
  try {
    await tradingEngineService.stop();
    res.json({ success: true, message: '트레이딩 엔진 중지됨' });
  } catch (err) { next(err); }
});

/** POST /trading/reset — 가상 포트폴리오 초기화 (virtual 모드 전용) */
router.post('/reset', async (_req, res, next) => {
  try {
    if (tradingEngineService.getMode() === 'real') {
      res.status(400).json({ success: false, message: '실전 모드에서는 초기화할 수 없습니다.' });
      return;
    }
    await tradingEngineService.reset();
    res.json({ success: true, message: '가상 포트폴리오 초기화 완료' });
  } catch (err) { next(err); }
});

/** GET /trading/real/balance — 실전 계좌 잔고 조회 */
router.get('/real/balance', async (_req, res, next) => {
  try {
    const [availableCash, positions] = await Promise.all([
      getAvailableCash(),
      getRealPositions(),
    ]);
    res.json({ success: true, data: { availableCash, positions } });
  } catch (err) { next(err); }
});

export default router;
