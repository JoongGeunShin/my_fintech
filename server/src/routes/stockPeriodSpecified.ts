import { type Request, type Response, Router } from 'express';
import { getDomesticPeriodStockPriceSpecified } from '../services/kis/stockPeriodPriceSpecifiedService.js';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
    const code  = req.query.code as string;
    const period = (req.query.period as string) || 'D';
    const startDate = (req.query.startDate as string) || '20200101';
    const endDate = (req.query.endDate as string) || '20201231';

    if (typeof code !== 'string' || typeof startDate !== 'string' || typeof endDate !== 'string') {
        res.status(400).json({ success: false, message: '잘못된 요청입니다.' });
        return;
    }
    try {
        console.log(`[Stock] 기간별 시세 요청: ${code}, 기간: ${startDate} ~ ${endDate}, 단위: ${period}`);
        const stockPeriodPriceSpecified = await getDomesticPeriodStockPriceSpecified(code, 'UN', startDate, endDate, period); 
        res.json({
            success: true,
            data: stockPeriodPriceSpecified,
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
        return res.status(500).json({
            success: false,
            error: { code: 'SERVER_ERROR', message },
        });
    }   
}
);

export default router;