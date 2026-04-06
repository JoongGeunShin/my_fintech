import { useEffect, useState } from 'react';

// 런타임에 쓰일 인터페이스 정의
interface WindowSize {
  width: number;
  height: number;
}

export const useWindowSize = (): WindowSize => {
  // 초기 상태를 현재 브라우저 크기로 설정
  const [windowSize, setWindowSize] = useState<WindowSize>({
    width: typeof window !== 'undefined' ? window.innerWidth : 0,
    height: typeof window !== 'undefined' ? window.innerHeight : 0,
  });

  useEffect(() => {
    // 창 크기가 변경될 때 실행될 함수
    const handleResize = () => {
      setWindowSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    // 리스너 등록
    window.addEventListener('resize', handleResize);

    // 컴포넌트 언마운트 시 리스너 제거 (메모리 누수 방지)
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return windowSize;
};