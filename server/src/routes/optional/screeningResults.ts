import { type Request, type Response, Router } from 'express';
import { getStocksByMinLevel } from '../../repositories/screeningRepository.js';
import { getScreeningResult, runFullScreening } from '../../services/optional/screeningPipelineService.js';

const router = Router();

/**
 * GET /optional/screening
 * 최신 스크리닝 결과 반환 (캐시 우선)
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await getScreeningResult();
    res.json({
      success: true,
      data: {
        runAt: result.runAt,
        topStocks: result.topStocks.slice(0, 50), // 상위 50개
        byLevel: result.byLevel,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    console.error('[Screening Route] 오류:', message);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message } });
  }
});

/**
 * POST /optional/screening/run
 * 수동으로 스크리닝 즉시 실행 (캐시 무시)
 */
router.post('/run', async (_req: Request, res: Response) => {
  try {
    console.log('[Screening Route] 수동 실행 요청');
    const result = await runFullScreening();
    res.json({
      success: true,
      data: {
        runAt: result.runAt,
        totalStocks: result.topStocks.length,
        levelSummary: Object.fromEntries(
          Object.entries(result.byLevel).map(([lvl, stocks]) => [lvl, stocks.length])
        ),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message } });
  }
});

/**
 * GET /optional/screening/level/:level
 * 특정 레벨 이상 종목 조회 (Firebase에서 직접)
 */
router.get('/level/:level', async (req: Request, res: Response) => {
  const level = parseInt(req.params['level'] as string, 10);
  if (isNaN(level) || level < 1) {
    res.status(400).json({ success: false, message: 'level은 1 이상의 정수여야 합니다.' });
    return;
  }
  try {
    const stocks = await getStocksByMinLevel(level);
    res.json({ success: true, data: stocks });
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message } });
  }
});

export default router;
