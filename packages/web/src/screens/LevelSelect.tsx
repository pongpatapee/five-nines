import { LEVELS, type Level } from '@five-nines/sim';
import { formatMs, formatUsd } from '../format.ts';
import { bossBriefingLine, CastLine, HandArrow, HandBox, NinesDots, troublemakerTease } from '../notebook/index.ts';
import { tierPercent } from '../results/grading.ts';
import { routeHref } from '../routing.ts';
import { useBestGrades } from '../state/index.ts';
import { CampaignMap } from './CampaignMap.tsx';
import { campaignProgress, NINES_PER_LEVEL, nextUpIndex, ninesForGrade } from './campaign.ts';
import './screens.css';

/** `#/`: the notebook's contents page. Every real level is playable; future chapters show as locked pages. */
export function LevelSelect() {
  const best = useBestGrades();
  const ids = LEVELS.map((level) => level.id);
  const progress = campaignProgress(ids, best);
  const nextUp = nextUpIndex(ids, best);

  return (
    <main className="contents">
      <header className="contents__header">
        <div className="contents__title-block">
          <h1 className="contents__wordmark">
            <span className="contents__swash" aria-hidden />
            <span className="hand">Five Nines</span>
          </h1>
          <p className="contents__tagline">
            an engineer's field notebook · <span className="contents__underline">table of contents</span>
          </p>
          <p className="contents__lede muted">
            Every page is a system to design. Earn a "9" for each tier: {tierPercent('pass')} pass · {tierPercent('star')}{' '}
            star · {tierPercent('mastered')} mastered.
          </p>
        </div>
        <div className="contents__progress">
          <div className="contents__progress-row">
            <span className="hand contents__progress-label">progress</span>
            <span className="contents__progress-count num">
              {progress.earned} / {progress.total} nines
            </span>
          </div>
          <ol className="contents__trios" aria-label="Nines per page">
            {LEVELS.map((level, i) => (
              <li key={level.id} title={`Page ${i + 1}: ${level.title}`}>
                <NinesDots filled={ninesForGrade(best[level.id])} total={NINES_PER_LEVEL} size="sm" />
              </li>
            ))}
          </ol>
        </div>
      </header>

      <div className="contents__body">
        <CampaignMap levels={LEVELS} best={best} nextUp={nextUp} />
        <aside className="contents__side" aria-label="Next up">
          <NextUpCard level={LEVELS[nextUp ?? 0]!} index={nextUp ?? 0} allPassed={nextUp === null} />
        </aside>
      </div>
    </main>
  );
}

function NextUpCard({ level, index, allPassed }: { level: Level; index: number; allPassed: boolean }) {
  const tease = troublemakerTease(level);
  return (
    <article className="index-card" aria-labelledby="next-up-title">
      <span className="tape tape--left" aria-hidden />
      <span className="tape tape--right" aria-hidden />
      <div className="index-card__body">
        <div className="eyebrow">
          {allPassed ? 'Every page passed · chase more nines' : `Next up · page ${index + 1} of ${LEVELS.length}`}
        </div>
        <h2 id="next-up-title" className="hand index-card__title">
          {index + 1}. {level.title}
        </h2>
        <p className="index-card__concept">
          <span className="highlight">{level.concept.toLowerCase()}</span>
        </p>
        <p className="index-card__lede">{level.briefing[0]}</p>

        <div className="index-card__reqs">
          <h3 className="hand index-card__reqs-title">the requirements:</h3>
          <ul className="hand-list">
            <li>
              <HandBox />
              <span>
                availability <b className="num">≥ {tierPercent('pass')}</b>
              </span>
            </li>
            <li>
              <HandBox />
              <span>
                p99 latency <b className="num">≤ {formatMs(level.requirements.p99Ms)}</b>
              </span>
            </li>
            <li>
              <HandBox />
              <span>
                cost <b className="num">≤ {formatUsd(level.requirements.budgetUsdPerMonth)}</b> / month
              </span>
            </li>
          </ul>
        </div>

        <CastLine who="boss" figureSize={96} className="index-card__boss">
          "{bossBriefingLine(level)}"
        </CastLine>
        {tease && (
          <CastLine who="troublemaker" figureSize={60} className="index-card__smudge" tone="alarm">
            {tease}
          </CastLine>
        )}
      </div>

      <a className="btn btn--primary index-card__start" href={routeHref({ name: 'level', levelId: level.id })}>
        {allPassed ? `Replay page ${index + 1}` : `Start page ${index + 1}`}
        <HandArrow />
      </a>
    </article>
  );
}
