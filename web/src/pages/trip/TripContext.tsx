import { createContext, useContext } from 'react';
import type { Category, Member, Summary, TripDetail } from '../../types.ts';

export interface TripContextValue extends TripDetail {
  summary: Summary;
  /** Reload trip + summary after any change. */
  refresh: () => Promise<void>;
  memberName: (id: string | null | undefined) => string;
  member: (id: string | null | undefined) => Member | undefined;
  category: (id: string | null | undefined) => Category | undefined;
  base: string;
}

export const TripContext = createContext<TripContextValue | null>(null);

export function useTrip(): TripContextValue {
  const value = useContext(TripContext);
  if (!value) throw new Error('useTrip must be used inside TripLayout');
  return value;
}
