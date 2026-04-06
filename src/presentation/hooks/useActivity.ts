import { useEffect, useState } from 'react';

export const useActivity = () => {
  const [typeCount, setTypeCount] = useState(0);

  useEffect(() => {
    const handleKeyDown = () => setTypeCount(prev => prev + 1);
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return { typeCount };
};