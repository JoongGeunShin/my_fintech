import { type Request, type Response, Router } from "express";
import { getOptionalSearchItem } from "../../services/optional/optionalSearchItemService";

const router = Router();

router.get('/', async (req: Request, res: Response) => {
    const sequence = req.query.sequence as string || '0';
    if (typeof sequence !== 'string') {
        res.status(400).json({ success: false, message: '잘못된 요청입니다. sequence는 문자열이어야 합니다.' });
        return;
    }
    try {
        console.log(`[Optional Search Item] 조건 검색 항목 요청 (sequence: ${sequence})`);
        const optionalSearchItem = await getOptionalSearchItem(sequence);
        res.json({
            success: true,
            data: optionalSearchItem,
        });
    } catch (err) {
        const message = err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.';
        console.error(`[Optional Search Item] 조회 실패 (sequence: ${sequence}):`, message);
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
});

export default router; 