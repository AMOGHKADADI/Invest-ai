import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { TradeModal } from '../components/TradeModal';

export type ToastTone = 'ok' | 'warn' | 'error';

export interface Toast {
  id: number;
  tone: ToastTone;
  text: string;
}

interface OverlayValue {
  /** Transient feedback for an action the user just took. */
  toast: (text: string, tone?: ToastTone) => void;
  /** Open the paper order ticket for an instrument from anywhere. */
  openTrade: (symbol: string, side?: 'buy' | 'sell') => void;
}

const OverlayContext = createContext<OverlayValue | null>(null);

let nextToastId = 1;

/**
 * App-wide overlay layer: a minimalist toast stack and the global order
 * ticket. Mounted once inside the store provider so both have access to
 * market state.
 */
export function OverlayProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [target, setTarget] = useState<{ symbol: string; side: 'buy' | 'sell' } | null>(null);

  const toast = useCallback((text: string, tone: ToastTone = 'ok') => {
    const id = nextToastId++;
    setToasts((prev) => [...prev.slice(-2), { id, tone, text }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  }, []);

  const openTrade = useCallback((symbol: string, side: 'buy' | 'sell' = 'buy') => {
    setTarget({ symbol, side });
  }, []);

  const value = useMemo(() => ({ toast, openTrade }), [toast, openTrade]);

  return (
    <OverlayContext.Provider value={value}>
      {children}
      <TradeModal target={target} onClose={() => setTarget(null)} />
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.tone}`}>
            {t.text}
          </div>
        ))}
      </div>
    </OverlayContext.Provider>
  );
}

export function useOverlay(): OverlayValue {
  const ctx = useContext(OverlayContext);
  if (!ctx) throw new Error('useOverlay must be used inside <OverlayProvider>');
  return ctx;
}
