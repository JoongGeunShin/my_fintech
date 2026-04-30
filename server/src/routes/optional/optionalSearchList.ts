import { type Request, type Response, Router } from 'express';
import { getOptionalSearchList } from '../../services/optional/optionalSearchListService.js';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
    try {
        console.log(`[Optional Search List] 서버 환경변수 계정으로 조건 검색 리스트 요청 중...`);
        const optionalSearchList = await getOptionalSearchList();
        res.json({
            success: true,
            data: optionalSearchList,
        });
    } catch (err) {         
        const message = err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.';
        console.error(`[Optional Search List] 조회 실패:`, message);
        res.status(500).json({
            success: false,
            error: { code: 'SERVER_ERROR', message },
        });
    }
});

export default router;