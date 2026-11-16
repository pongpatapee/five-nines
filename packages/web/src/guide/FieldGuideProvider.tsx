/**
 * The field guide, reachable from anywhere on a level page: the top bar, a napkin working, a hint, the inspector. The
 * provider holds whether it's open and at which entry, and lays the theme's guide over the page; `GuideLink` opens it
 * at one entry, and draws nothing for an entry the player hasn't met (the guide never spoils ahead).
 */
import { LEVELS } from '@five-nines/sim';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useEscape, useRestoreFocus } from '../screens/escape.ts';
import { useCampaign } from '../screens/campaign.ts';
import { fieldGuide, FieldGuide } from '../theme/index.ts';
import { isMet, metEntries, specTable, type GuideEntryId, type MetEntries } from './guide.ts';

interface GuideApi {
  met: MetEntries;
  /** Opens the guide at `entry`, or at its contents. An entry the player hasn't met opens the contents. */
  open(entry?: GuideEntryId): void;
  isOpen: boolean;
}

const GuideContext = createContext<GuideApi | null>(null);

export function useFieldGuide(): GuideApi | null {
  return useContext(GuideContext);
}

export function FieldGuideProvider({ children }: { children: ReactNode }) {
  const { access } = useCampaign();
  const met = useMemo(() => metEntries(LEVELS, access), [access]);
  const [focus, setFocus] = useState<GuideEntryId | null | undefined>(undefined);
  const open = useCallback((entry?: GuideEntryId) => setFocus(entry && isMet(met, entry) ? entry : null), [met]);
  const close = useCallback(() => setFocus(undefined), []);
  const api = useMemo(() => ({ met, open, isOpen: focus !== undefined }), [met, open, focus]);
  return (
    <GuideContext.Provider value={api}>
      {children}
      {focus !== undefined && <GuideOverlay met={met} focus={focus} onClose={close} />}
    </GuideContext.Provider>
  );
}

function GuideOverlay({ met, focus, onClose }: { met: MetEntries; focus: GuideEntryId | null; onClose(): void }) {
  useEscape(onClose);
  useRestoreFocus();
  const components = useMemo(() => met.components.map((kind) => ({ kind, table: specTable(kind) })), [met]);
  return (
    <div className="guide-overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <FieldGuide components={components} concepts={met.concepts} unmet={met.unmet} focus={focus} onClose={onClose} />
    </div>
  );
}

/** "More in the field guide", opening it at `entry`. Nothing when the player hasn't met the entry, or off a level. */
export function GuideLink({ entry, className }: { entry: GuideEntryId; className?: string }) {
  const guide = useFieldGuide();
  if (!guide || !isMet(guide.met, entry)) return null;
  return (
    <button
      type="button"
      className={`guide-link${className ? ` ${className}` : ''}`}
      onClick={() => guide.open(entry)}
      aria-label={`${fieldGuide.more}: ${fieldGuide.entryName(entry)}`}
    >
      {fieldGuide.more}
    </button>
  );
}
