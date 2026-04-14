import type { ErrorRequestHandler } from 'express';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error('[Server] 처리되지 않은 오류:', err);

  const message = err instanceof Error ? err.message : '서버 내부 오류가 발생했습니다.';

  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message,
    },
  });
};
