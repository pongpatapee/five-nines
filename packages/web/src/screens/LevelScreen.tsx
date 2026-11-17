import { designCostUsdPerMonth, LEVELS, validateDesign, type Design, type Evaluation, type Level } from '@five-nines/sim';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { playCue } from '../audio/sfx.ts';
import { SoundToggle } from '../audio/SoundToggle.tsx';
import { DesignCanvas, draftFromDesign } from '../canvas/index.ts';
import type { Draft } from '../canvas/types.ts';
import { Editor } from '../editor/index.tsx';
import { runEvaluation } from '../engine/index.ts';
import { Playback } from '../playback/index.tsx';
import { DebriefPanel, ResultsView } from '../results/index.ts';
import { navigate, routeHref } from '../routing.ts';
import { formatDuration } from '../format.ts';
import { peekCosts } from '../progression/index.ts';
import { progressStore, useBestGrade, useDraft, useEstimate, usePeeked, useStashedDraft } from '../state/index.ts';
import { FieldGuideProvider, useFieldGuide } from '../guide/FieldGuideProvider.tsx';
import { cast, fieldGuide, marks, words } from '../theme/index.ts';
import { useEscape } from './escape.ts';
import { GiveUpConfirm } from './GiveUpConfirm.tsx';
import { HintsDialog } from './HintsDialog.tsx';
import { useHints } from './useHints.ts';
import { EstimateStep } from './EstimateStep.tsx';
import { CostMeter } from './CostMeter.tsx';
import { BriefingPanel } from './BriefingPanel.tsx';
import { useCampaign } from './campaign.ts';
import { INITIAL_MODE, levelModeReducer, type LevelMode, type ResultView } from './levelMode.ts';

export interface LevelScreenProps {
  level: Level;
}

/** `#/level/<id>`: briefing on the left, the current mode (build, run, result) on the stage; the field guide over it. */
export function LevelScreen({ level }: LevelScreenProps) {
  return (
    <FieldGuideProvider>
      <LevelPage level={level} />
    </FieldGuideProvider>
  );
}

function LevelPage({ level }: LevelScreenProps) {
  const guide = useFieldGuide();
  const [mode, dispatch] = useReducer(levelModeReducer, INITIAL_MODE);
  const [briefingCollapsed, setBriefingCollapsed] = useState(false);
  const [debriefOpen, setDebriefOpen] = useState(false);
  const [hintsOpen, setHintsOpen] = useState(false);
  const hints = useHints(level, mode);
  const peeked = usePeeked(level.id);
  const stashed = useStashedDraft(level.id);
  // The solution, once the player has confirmed what it costs: what to open after the confirm.
  const [confirmingPeek, setConfirmingPeek] = useState<(() => void) | null>(null);
  const draft = useDraft(level.id);
  const bestGrade = useBestGrade(level.id);
  const estimateRecord = useEstimate(level.id);
  // The napkin-math step opens on its question before building, the first time a level with one is visited. Null
  // when closed; `review` opens it on the worked solution.
  const [estimateOpen, setEstimateOpen] = useState<'ask' | 'review' | null>(() =>
    level.estimate !== undefined && progressStore.getState().estimates[level.id] === undefined ? 'ask' : null,
  );
  const runCounter = useRef(0);
  // One evaluation per run, even when StrictMode replays the effect in development.
  const inflight = useRef<{ runId: number; promise: Promise<Evaluation> } | null>(null);

  const levelIndex = LEVELS.findIndex((l) => l.id === level.id);
  const campaign = useCampaign();
  const following = LEVELS[levelIndex + 1] ?? null;
  // "Next page" only leads somewhere open: passing this page opens the next, unless its chapter needs more nines.
  const nextLevel = following && campaign.access[following.id]?.kind === 'open' ? following : null;
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

  const handleEstimateAnswer = useCallback(
    (guess: number, close: boolean) => {
      playCue('hint');
      return progressStore.getState().recordEstimate(level.id, guess, close);
    },
    [level.id],
  );
  const handleEstimateSkip = useCallback(() => {
    progressStore.getState().recordEstimate(level.id, null, false);
  }, [level.id]);
  const handleEstimateClose = useCallback(() => setEstimateOpen(null), []);
  // The worked solution, from the briefing, once the question was answered or skipped.
  const canReviewEstimate = mode.kind === 'build' && level.estimate !== undefined && estimateRecord !== undefined;

  // Esc closes the debrief overlay over the editor.
  useEscape(() => setDebriefOpen(false), debriefOpen);

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
  // Giving up: the solution, behind a confirm while seeing it still costs something (progression/peek.ts).
  const solutionCosts = peekCosts(bestGrade, peeked);
  const showSolution = useCallback(() => {
    const open = () => {
      setHintsOpen(false);
      if (mode.kind === 'result') dispatch({ type: 'showView', view: 'debrief' });
      else setDebriefOpen(true);
    };
    if (solutionCosts) setConfirmingPeek(() => open);
    else open();
  }, [mode.kind, solutionCosts]);
  const confirmPeek = useCallback(() => {
    progressStore.getState().recordPeek(level.id);
    const open = confirmingPeek;
    setConfirmingPeek(null);
    open?.();
  }, [confirmingPeek, level.id]);
  const handleLoadSolution = useCallback(
    (design: Design) => {
      progressStore.getState().loadSolution(level.id, draftFromDesign(design));
      setDebriefOpen(false);
      dispatch({ type: 'edit' });
    },
    [level.id],
  );
  const handleSwitchBack = useCallback(() => {
    progressStore.getState().restoreStashedDraft(level.id);
    setDebriefOpen(false);
    dispatch({ type: 'edit' });
  }, [level.id]);

  const handleNextLevel = useMemo(
    () => (nextLevel ? () => navigate({ name: 'level', levelId: nextLevel.id }) : null),
    [nextLevel],
  );

  const shownDraft = mode.kind === 'build' ? draft : mode.draft;

  return (
    <div className={`level-screen${briefingCollapsed ? ' is-briefing-collapsed' : ''}`}>
      <TopBar
        level={level}
        levelNumber={levelIndex + 1}
        mode={mode}
        cost={briefingCollapsed ? designCostUsdPerMonth(shownDraft.design) : null}
        onShowSolution={mode.kind === 'build' || mode.kind === 'result' ? showSolution : null}
        solutionLabel={solutionCosts ? cast.giveUp.show : cast.giveUp.showFree}
        onSwitchBack={mode.kind === 'build' && stashed ? handleSwitchBack : null}
        onOpenEstimate={mode.kind === 'build' && level.estimate && !estimateOpen ? () => setEstimateOpen('ask') : null}
        estimateBonus={estimateRecord?.close ?? false}
        onOpenGuide={guide ? () => guide.open() : null}
        onOpenHints={hints && (mode.kind === 'build' || mode.kind === 'result') ? () => setHintsOpen(true) : null}
      />
      <div className="level-screen__body">
        <BriefingPanel
          level={level}
          levelNumber={levelIndex + 1}
          design={shownDraft.design}
          collapsed={briefingCollapsed}
          onToggle={() => setBriefingCollapsed((c) => !c)}
          onShowEstimateWorking={canReviewEstimate && !estimateOpen ? () => setEstimateOpen('review') : null}
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
                active={!debriefOpen && !estimateOpen && !hintsOpen && !confirmingPeek && !guide?.isOpen}
              />
              {estimateOpen && level.estimate && (
                <EstimateStep
                  key={estimateOpen}
                  start={estimateOpen}
                  level={level}
                  estimate={level.estimate}
                  record={estimateRecord}
                  onAnswer={handleEstimateAnswer}
                  onSkip={handleEstimateSkip}
                  onClose={handleEstimateClose}
                />
              )}
              {debriefOpen && (
                <div className="results-overlay">
                  <DebriefPanel
                    level={level}
                    peeked={peeked}
                    onClose={() => setDebriefOpen(false)}
                    onLoad={handleLoadSolution}
                    onSwitchBack={stashed ? handleSwitchBack : null}
                  />
                </div>
              )}
            </>
          )}

          {mode.kind === 'evaluating' && (
            <>
              <DesignCanvas mode="readOnly" draft={mode.draft} />
              <div className="stage-status" role="status">
                <span className="stage-status__spinner" aria-hidden />
                Simulating {formatDuration(level.durationSec)} of traffic…
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
                design={mode.draft.design}
                evaluation={mode.evaluation}
                view={mode.view}
                onViewChange={handleViewChange}
                onBackToEditor={handleEdit}
                onReplay={handleReplay}
                onNextLevel={handleNextLevel}
                hints={hints}
                onShowSolution={showSolution}
                solutionCosts={solutionCosts}
                peeked={peeked}
                onLoadSolution={handleLoadSolution}
                onSwitchBack={stashed ? handleSwitchBack : null}
              />
            </>
          )}
        </main>
      </div>
      {hintsOpen && hints && (
        <HintsDialog
          hints={hints}
          onClose={() => setHintsOpen(false)}
          solution={
            <button type="button" className="btn btn--sm" onClick={showSolution}>
              {solutionCosts ? cast.giveUp.show : cast.giveUp.showFree}
            </button>
          }
        />
      )}
      {confirmingPeek && <GiveUpConfirm onConfirm={confirmPeek} onCancel={() => setConfirmingPeek(null)} />}
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
  levelNumber,
  mode,
  cost,
  onShowSolution,
  solutionLabel,
  onSwitchBack,
  onOpenEstimate,
  estimateBonus,
  onOpenGuide,
  onOpenHints,
}: {
  level: Level;
  levelNumber: number;
  mode: LevelMode;
  /** Shown compactly when the briefing panel (and its cost meter) is collapsed. */
  cost: number | null;
  /** The solution page, behind a confirm while it costs something. Null when it can't open now. */
  onShowSolution: (() => void) | null;
  solutionLabel: string;
  /** Back to the player's own design, while a solution is on the canvas. */
  onSwitchBack: (() => void) | null;
  /** Reopens the napkin-math step; null when the level has none or it can't open now. */
  onOpenEstimate: (() => void) | null;
  /** Whether the napkin-math bonus is earned on this level. */
  estimateBonus: boolean;
  onOpenGuide: (() => void) | null;
  /** Opens the hints: null when the level has none or they can't open now. */
  onOpenHints: (() => void) | null;
}) {
  const active = mode.kind === 'evaluating' ? 'run' : mode.kind;
  return (
    <header className="topbar">
      <div className="topbar__title">
        <a className="topbar__back" href={routeHref({ name: 'levels' })} title={`Back to the ${words.homeLong}`}>
          <marks.Logo size={28} />
          <span className="hand topbar__wordmark">Five Nines</span>
          <span className="topbar__back-hint">{words.home}</span>
        </a>
        <span className="topbar__divider" aria-hidden />
        <span className="topbar__level hand">
          {words.levelShort(levelNumber)} · {level.title}
        </span>
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
        {onOpenEstimate && (
          <button type="button" className="btn btn--sm btn--ghost topbar__estimate" onClick={onOpenEstimate}>
            Napkin math
            {estimateBonus && <marks.Met label={cast.mentorEstimate.bonus} />}
          </button>
        )}
        {onOpenHints && (
          <button type="button" className="btn btn--sm btn--ghost" onClick={onOpenHints}>
            Hints
          </button>
        )}
        {onOpenGuide && (
          <button type="button" className="btn btn--sm btn--ghost" onClick={onOpenGuide}>
            {fieldGuide.title}
          </button>
        )}
        {onSwitchBack && (
          <button type="button" className="btn btn--sm btn--ghost" onClick={onSwitchBack}>
            {cast.giveUp.switchBack}
          </button>
        )}
        {onShowSolution && (
          <button type="button" className="btn btn--sm" onClick={onShowSolution}>
            {solutionLabel}
          </button>
        )}
        <SoundToggle />
      </div>
    </header>
  );
}
