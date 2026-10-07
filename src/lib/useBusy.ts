import { useEffect, useRef, useState } from 'react';
import { createSingleFlight, type SingleFlight } from './singleFlight';

/**
 * 等待超过这么久才显示加载状态 —— 更短的等待里一闪而过的转圈比没有更像「卡了一下」。
 * 按下的那一刻另有即时反馈(按钮压下去,见 brutalist.css 的 .qai-lift)。
 */
export const LOADING_DELAY_MS = 150;

/** `flag` 连续为真超过 `delayMs` 才变真;一变假立刻变假 */
export function useDelayedFlag(flag: boolean, delayMs: number = LOADING_DELAY_MS): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!flag) {
      setShown(false);
      return;
    }
    const timer = window.setTimeout(() => setShown(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [flag, delayMs]);
  return flag && shown;
}

/**
 * 一个按钮背后的异步动作:等待期间再按什么都不做(见 lib/singleFlight.ts —— 同步挡,不等渲染)。
 * `busy` 给按钮画「压下去 + 150ms 后转圈」。
 */
export function useSingleFlight(): { run: SingleFlight['run']; busy: boolean } {
  const [busy, setBusy] = useState(false);
  const flight = useRef<SingleFlight | null>(null);
  if (!flight.current) flight.current = createSingleFlight(setBusy);
  return { run: flight.current.run, busy };
}
