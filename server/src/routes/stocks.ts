import { Router, type Request, type Response } from 'express';
import { getDomesticStockPrice } from '../services/stockService.js';

const router = Router();


const isValidStockCode = (code: string): boolean => /^\d{6}$/.test(code);

router.get('/', async (req: Request, res: Response) => {
  const code  = req.query.code as string;
  if (typeof code !== 'string') {
    res.status(400).json({ success: false, message: '잘못된 요청입니다.' });
    return;
  }
  if (!isValidStockCode(code)) {
    res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_CODE',
        message: '종목 코드가 쿼리 스트링이어야 합니다. (예: ?code=005930)',
      },
    });
    return;
  }

  try {
    console.log(`[Stock] 조회 요청: ${code}`);
    const stockPrice = await getDomesticStockPrice(code);

    res.json({
      success: true,
      data: stockPrice,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.';
    console.error(`[Stock] 조회 실패 (${code}):`, message);

    if (message.includes('인증 토큰')) {
      res.status(401).json({
        success: false,
        error: { code: 'AUTH_ERROR', message },
      });
      return;
    }

    if (message.includes('KIS API 오류')) {
      res.status(422).json({
        success: false,
        error: { code: 'KIS_API_ERROR', message },
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message },
    });
  }
});

export default router;
