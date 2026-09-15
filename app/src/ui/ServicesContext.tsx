import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { ServiceContext } from '../services/context.ts';
import { errorMessage } from './format.ts';

interface ServicesValue {
  readonly context: ServiceContext;
  /** 每次資料變更後遞增，讓查詢重新載入。 */
  readonly revision: number;
  readonly notifyChanged: () => void;
}

const ServicesReactContext = createContext<ServicesValue | undefined>(undefined);

export function ServicesProvider({
  context,
  children,
}: {
  readonly context: ServiceContext;
  readonly children: ReactNode;
}) {
  const [revision, setRevision] = useState(0);
  const notifyChanged = useCallback(() => {
    setRevision((value) => value + 1);
  }, []);
  const value = useMemo(
    () => ({ context, revision, notifyChanged }),
    [context, revision, notifyChanged],
  );
  return <ServicesReactContext value={value}>{children}</ServicesReactContext>;
}

export function useServices(): ServicesValue {
  const value = useContext(ServicesReactContext);
  if (value === undefined) {
    throw new Error('useServices 必須在 ServicesProvider 內使用');
  }
  return value;
}

interface QueryState<T> {
  readonly data: T | undefined;
  readonly error: string | undefined;
}

/** 資料變更（revision 遞增）時重新載入；重新載入期間保留上一次的資料。load 必須是穩定的函式。 */
export function useServiceQuery<T>(load: (context: ServiceContext) => Promise<T>): QueryState<T> {
  const { context, revision } = useServices();
  const [state, setState] = useState<QueryState<T>>({ data: undefined, error: undefined });
  useEffect(() => {
    let cancelled = false;
    load(context).then(
      (data) => {
        if (!cancelled) {
          setState({ data, error: undefined });
        }
      },
      (error: unknown) => {
        if (!cancelled) {
          setState((previous) => ({ data: previous.data, error: errorMessage(error) }));
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [context, revision, load]);
  return state;
}
