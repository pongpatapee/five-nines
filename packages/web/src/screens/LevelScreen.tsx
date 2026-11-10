import { designCostUsdPerMonth, LEVELS, validateDesign, type Evaluation, type Level } from '@five-nines/sim';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { DesignCanvas } from '../canvas/index.ts';
import type { Draft } from '../canvas/types.ts';
import { Editor } from '../editor/index.tsx';
import { runEvaluation } from '../engine/index.ts';
import { Playback } from '../playback/index.tsx';
import { DebriefPanel, ResultsView } from '../results/index.ts';
import { navigate, routeHref } from '../routing.ts';
import { isPassingGrade } from '../format.ts';
import { progressStore, useBestGrade, useDraft } from '../state/index.ts';
import { CostMeter } from './CostMeter.tsx';
import { BriefingPanel } from './BriefingPanel.tsx';
import { INITIAL_MODE, levelModeReducer, type LevelMode, type ResultView } from './levelMode.ts';
import './screens.css';

export interface LevelScreenProps {
  level: Level;
}

/** `#/level/<id>`: briefing on the left, the current mode (build, run, result) on the stage. */
export function LevelScreen({ level }: LevelScreenProps) {
  const [mode, dispatch] = useReducer(levelModeReducer, INITIAL_MODE);
  const [briefingCollapsed, setBriefingCollapsed] = useState(false);
  const [debriefOpen, setDebriefOpen] = useState(false);
  const draft = useDraft(level.id);
  const bestGrade = useBestGrade(level.id);
  const runCounter = useRef(0);
  // One evaluation per run, even when StrictMode replays the effect in development.
  const inflight = useRef<{ runId: number; promise: Promise<Evaluation> } | null>(null);

  const levelIndex = LEVELS.findIndex((l) => l.id === level.id);
  const nextLevel = LEVELS[levelIndex + 1] ?? null;
  const issues = useMemo(() => validateDesign(draft.design, level), [draft.design, level]);
  const hasErrors = issues.some((issue) => issue.severity === 'error');

  // Build-mode callbacks.
  const handleDraftChange = useCallback(
    (next: Draft) => {
      progressStore.getState().updateDraft(level.id, next);
      dispatch({ type: 'edit' });
    },
    [level.id],
  );
  const handleRun = useCallback(() => {
    if (hasErrors) return;
    setDebriefOpen(false);
    dispatch({ type: 'run', runId: ++runCounter.current, draft });
  }, [draft, hasErrors]);
  const handleReset = useCallback(() => {
    progressStore.getState().resetDraft(level.id);
    dispatch({ type: 'edit' });
  }, [level.id]);

  // Esc closes the debrief overlay over the editor.
  useEffect(() => {
    if (!debriefOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDebriefOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [debriefOpen]);

  // Evaluating: run the engine in the worker and feed the result back into the state machine.
  const evaluating = mode.kind === 'evaluating' ? mode : null;
  useEffect(() => {
    if (!evaluating) return;
    const { runId, draft: snapshot } = evaluating;
    if (inflight.current?.runId !== runId) {
      inflight.current = { runId, promise: runEvaluation(level.id, snapshot.design) };
    }
    inflight.current.promise.then(
      (evaluation) => dispatch({ type: 'evaluated', runId, evaluation }),
      (error: unknown) =>
        dispatch({ type: 'evaluationFailed', runId, message: error instanceof Error ? error.message : String(error) }),
    );
  }, [evaluating, level.id]);

  // Run and result callbacks.
  const handleFinished = useCallback(() => dispatch({ type: 'finished' }), []);
  const handleEdit = useCallback(() => dispatch({ type: 'edit' }), []);
  const handleReplay = useCallback(() => dispatch({ type: 'replay' }), []);
  const handleViewChange = useCallback((view: ResultView) => dispatch({ type: 'showView', view }), []);
  const handleNextLevel = useMemo(
    () => (nextLevel ? () => navigate({ name: 'level', levelId: nextLevel.id }) : null),
    [nextLevel],
  );

  const shownDraft = mode.kind === 'build' ? draft : mode.draft;

  return (
    <div className={`level-screen${briefingCollapsed ? ' is-briefing-collapsed' : ''}`}>
      <TopBar
        level={level}
        mode={mode}
        cost={briefingCollapsed ? designCostUsdPerMonth(shownDraft.design) : null}
        onOpenDebrief={mode.kind === 'build' && bestGrade !== undefined ? () => setDebriefOpen(true) : null}
      />
      <div className="level-screen__body">
        <BriefingPanel
          level={level}
          levelNumber={levelIndex + 1}
          design={shownDraft.design}
          collapsed={briefingCollapsed}
          onToggle={() => setBriefingCollapsed((c) => !c)}
        />
        <main className="level-screen__stage" data-mode={mode.kind}>
          {mode.kind === 'build' && (
            <>
              <Editor
                level={level}
                draft={draft}
                onDraftChange={handleDraftChange}
                issues={issues}
                onRun={handleRun}
                onReset={handleReset}
                notice={mode.notice}
                active={!debriefOpen}
              />
              {debriefOpen && (
                <div className="results-overlay">
                  <DebriefPanel level={level} spoilers={!isPassingGrade(bestGrade)} onClose={() => setDebriefOpen(false)} />
                </div>
              )}
            </>
          )}

          {mode.kind === 'evaluating' && (
            <>
              <DesignCanvas mode="readOnly" draft={mode.draft} />
              <div className="stage-status" role="status">
                <span className="stage-status__spinner" aria-hidden />
                Simulating {level.durationSec} seconds of traffic…
              </div>
            </>
          )}

          {mode.kind === 'run' && (
            <Playback
              key={`${mode.runId}:${mode.replay}`}
              level={level}
              draft={mode.draft}
              evaluation={mode.evaluation}
              onFinished={handleFinished}
              onExit={handleEdit}
            />
          )}

          {mode.kind === 'result' && (
            <>
              <DesignCanvas mode="readOnly" draft={mode.draft} />
              <ResultsView
                level={level}
                evaluation={mode.evaluation}
                view={mode.view}
                onViewChange={handleViewChange}
                onBackToEditor={handleEdit}
                onReplay={handleReplay}
                onNextLevel={handleNextLevel}
              />
            </>
          )}
        </main>
      </div>
    </div>
  );
}

const MODE_STEPS = [
  { kind: 'build', label: 'Build' },
  { kind: 'run', label: 'Run' },
  { kind: 'result', label: 'Result' },
] as const;

function TopBar({
  level,
  mode,
  cost,
  onOpenDebrief,
}: {
  level: Level;
  mode: LevelMode;
  /** Shown compactly when the briefing panel (and its cost meter) is collapsed. */
  cost: number | null;
  onOpenDebrief: (() => void) | null;
}) {
  const active = mode.kind === 'evaluating' ? 'run' : mode.kind;
  return (
    <header className="topbar">
      <div className="topbar__title">
        <a className="topbar__back" href={routeHref({ name: 'levels' })}>
          <span className="wordmark wordmark--small">
            Five <span>Nines</span>
          </span>
        </a>
        <span className="topbar__divider" aria-hidden />
        <span className="topbar__level">{level.title}</span>
      </div>
      <ol className="mode-steps" aria-label="Mode">
        {MODE_STEPS.map((step) => (
          <li key={step.kind} className="mode-steps__step" aria-current={active === step.kind ? 'step' : undefined}>
            {step.label}
          </li>
        ))}
      </ol>
      <div className="topbar__actions">
        {cost !== null && (
          <CostMeter costUsdPerMonth={cost} budgetUsdPerMonth={level.requirements.budgetUsdPerMonth} compact />
        )}
        {onOpenDebrief && (
          <button type="button" className="btn btn--sm" onClick={onOpenDebrief}>
            Debrief &amp; solutions
          </button>
        )}
      </div>
    </header>
  );
}
