import { CHAPTERS, LEVELS, type Level } from '@five-nines/sim';
import { capitalize, formatMs, formatUsd } from '../format.ts';
import { tierPercent } from '../results/grading.ts';
import { routeHref } from '../routing.ts';
import { useBestGrades } from '../state/index.ts';
import { CampaignMap, cast, CastLine, marks, troublemakerTease, words } from '../theme/index.ts';
import { campaignProgress, NINES_PER_LEVEL, nextUpIndex, ninesForGrade } from './campaign.ts';

const { Arrow, Checkbox, Nines } = marks;

/** `#/`: the level select screen. Every real level is playable; planned chapters show as locked. */
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
            {words.tagline} · <span className="contents__underline">{words.homeLong}</span>
          </p>
          <p className="contents__lede muted">
            Every {words.level} is a system to design. Earn a "9" for each tier: {tierPercent('pass')} pass · {tierPercent('star')}{' '}
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
          <ol className="contents__trios" aria-label={`Nines per ${words.level}`}>
            {LEVELS.map((level, i) => (
              <li key={level.id} title={`${capitalize(words.level)} ${i + 1}: ${level.title}`}>
                <Nines filled={ninesForGrade(best[level.id])} total={NINES_PER_LEVEL} size="sm" />
              </li>
            ))}
          </ol>
        </div>
      </header>

      <div className="contents__body">
        <CampaignMap chapters={CHAPTERS} levels={LEVELS} best={best} nextUp={nextUp} />
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
          {allPassed
            ? `Every ${words.level} passed · chase more nines`
            : `Next up · ${words.level} ${index + 1} of ${LEVELS.length}`}
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
              <Checkbox />
              <span>
                availability <b className="num">≥ {tierPercent('pass')}</b>
              </span>
            </li>
            <li>
              <Checkbox />
              <span>
                p99 latency <b className="num">≤ {formatMs(level.requirements.p99Ms)}</b>
              </span>
            </li>
            <li>
              <Checkbox />
              <span>
                cost <b className="num">≤ {formatUsd(level.requirements.budgetUsdPerMonth)}</b> / month
              </span>
            </li>
          </ul>
        </div>

        <CastLine role="boss" size={96} className="index-card__boss">
          "{cast.bossBrief(level)}"
        </CastLine>
        {tease && (
          <CastLine role="troublemaker" size={60} className="index-card__troublemaker" tone="alarm">
            {tease}
          </CastLine>
        )}
      </div>

      <a className="btn btn--primary index-card__start" href={routeHref({ name: 'level', levelId: level.id })}>
        {allPassed ? `Replay ${words.level} ${index + 1}` : `Start ${words.level} ${index + 1}`}
        <Arrow />
      </a>
    </article>
  );
}
