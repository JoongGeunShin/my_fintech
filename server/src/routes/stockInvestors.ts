import { Request, Response, Router } from 'express';
import { getStockInvestorInfo } from '../services/kis/stockInvestorService.js';

const router = Router();

router.get('/', async (req:Request, res: Response) => {
    const code = req.query.code as string;
    const market = (req.query.market as string) || 'UN';
    if( typeof code !== 'string' || !/^\d{6}$/.test(code)) {
        res.status(400).json({ success: false, message: '잘못된 요청입니다. ?code=005930 형식으로 요청해야 합니다.' });
        return;
    }
    try {
        console.log(`[Stock] 투자자 요청: ${code}`);
        const StockInvestor = await getStockInvestorInfo(code, market);
        res.json({
            success: true,
            data: StockInvestor,
        });
    } catch (err) {        
        const message = err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.';
        console.error(`[Stock] 투자자 조회 실패 (${code}):`, message);
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
})

export default router;
