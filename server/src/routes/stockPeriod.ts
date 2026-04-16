import { Router, type Request, type Response } from 'express';
import { getDomesticPeriodStockPrice } from '../services/stockPeriodPriceServices.js';

const router = Router();


const isValidStockCode = (code: string): boolean => /^\d{6}$/.test(code);

router.get('/', async (req: Request, res: Response) => {
  const code  = req.query.code as string;
  const period = (req.query.period as string) || 'D';
  if (typeof code !== 'string') {
    res.status(400).json({ success: false, message: '잘못된 요청입니다.' });
    return;
  }
  if (!isValidStockCode(code)) {
    res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_CODE',
        message: '기간별 조회는 ?code=005930&period=D 형식으로 요청해야 합니다.',
      },
    });
    return;
  }

  try {
    console.log(`[Stock] 일자별 시세 요청: ${code}`);
    const stockPeriodPrice = await getDomesticPeriodStockPrice(code, 'UN', period);

    res.json({
      success: true,
      data: stockPeriodPrice,
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
