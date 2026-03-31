import { useState, useCallback } from 'react';

export function useRouter(initialScreen = 'home') {
  const [stack, setStack] = useState([initialScreen]);

  const current = stack[stack.length - 1];
  const breadcrumb = stack.map(s => s.charAt(0).toUpperCase() + s.slice(1));

  const push = useCallback((screen) => {
    setStack(prev => [...prev, screen]);
  }, []);

  const pop = useCallback(() => {
    setStack(prev => prev.length > 1 ? prev.slice(0, -1) : prev);
  }, []);

  const reset = useCallback((screen = 'home') => {
    setStack([screen]);
  }, []);

  const canGoBack = stack.length > 1;

  return { current, breadcrumb, push, pop, reset, canGoBack };
}
