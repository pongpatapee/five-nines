import { CHAPTERS, isWritten, LEVELS, type Level } from '@five-nines/sim';
import { SoundToggle } from '../audio/SoundToggle.tsx';
import { formatMs, formatUsd } from '../format.ts';
import { NINES_FOR_GRADE, chapterThreshold, type LevelAccess } from '../progression/index.ts';
import { tierPercent } from '../results/grading.ts';
import { routeHref } from '../routing.ts';
import { useBadges } from '../state/index.ts';
import { BadgeShelf, CampaignMap, cast, CastLine, lockSituation, marks, troublemakerTease, words } from '../theme/index.ts';
import { useCampaign, type CampaignState } from './campaign.ts';

const { Arrow, Checkbox } = marks;

/** `#/`: the level select screen. Levels open as the player passes them; chapters open with nines. */
export function LevelSelect() {
  const campaign = useCampaign();
  const badges = useBadges();
  const { best, nines, nextUp } = campaign;
  const target = nextChapterTarget(campaign);

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
            {`Every ${words.level} is a system to design, and pays in nines: ${NINES_FOR_GRADE.pass} for a pass (${tierPercent('pass')}), ${NINES_FOR_GRADE.star} for a star (${tierPercent('star')}), ${NINES_FOR_GRADE.mastered} for mastered (${tierPercent('mastered')}). Nines open new chapters.`}
          </p>
        </div>
        <div className="contents__progress">
          <div className="contents__progress-row">
            <span className="hand contents__progress-label">progress</span>
            <span className="contents__progress-count num">
              {nines.earned} / {nines.total} nines
            </span>
            <SoundToggle className="contents__sound" />
          </div>
          <p className="contents__target">{target}</p>
        </div>
      </header>

      <div className="contents__body">
        <CampaignMap
          chapters={CHAPTERS}
          levels={LEVELS}
          best={best}
          nextUp={nextUp}
          access={campaign.access}
          chapterAccess={campaign.chapterAccess}
        />
        <aside className="contents__side" aria-label="Next up and badges">
          <NextUpCard
            level={LEVELS[nextUp ?? 0]!}
            index={nextUp ?? 0}
            allPassed={nextUp === null}
            access={nextUp === null ? { kind: 'open' } : campaign.access[LEVELS[nextUp]!.id]!}
            replay={replaySuggestion(campaign)}
          />
          <BadgeShelf earned={badges} levelLabel={levelLabel} />
        </aside>
      </div>
    </main>
  );
}

function levelLabel(levelId: string): string {
  const index = LEVELS.findIndex((level) => level.id === levelId);
  return index === -1 ? levelId : `${words.levelShort(index + 1)} ${LEVELS[index]!.title}`;
}

/** The next chapter still closed, and what opens it: "Ch. 3, Hypergrowth, opens at 22 nines (13 to go)". */
function nextChapterTarget({ chapterAccess, nines }: CampaignState): string {
  const index = CHAPTERS.findIndex((chapter) => chapterAccess[chapter.id]?.kind === 'locked');
  if (index === -1) return 'Every chapter is open.';
  const chapter = CHAPTERS[index]!;
  const needed = chapterThreshold(chapter.id);
  const soon = isWritten(chapter) ? '' : ' (coming soon)';
  return `Ch. ${index + 1}, ${chapter.title}${soon}, opens at ${needed} nines: ${needed - nines.earned} to go.`;
}

/** The earliest open level not yet mastered: where more nines are waiting. Null when there's none. */
function replaySuggestion({ access, best }: CampaignState): { level: Level; index: number } | null {
  const index = LEVELS.findIndex((level) => access[level.id]?.kind === 'open' && best[level.id] !== undefined && best[level.id] !== 'mastered');
  return index === -1 ? null : { level: LEVELS[index]!, index };
}

function NextUpCard({
  level,
  index,
  allPassed,
  access,
  replay,
}: {
  level: Level;
  index: number;
  allPassed: boolean;
  access: LevelAccess;
  replay: { level: Level; index: number } | null;
}) {
  const tease = troublemakerTease(level);
  const lock = lockSituation(access, LEVELS, CHAPTERS);
  const locked = lock ? cast.lockedLevel(lock) : null;
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

        {locked ? (
          <CastLine role={locked.role} size={96} className="index-card__boss" tone="alarm" lead="Locked">
            {locked.line}
          </CastLine>
        ) : (
          <CastLine role="boss" size={96} className="index-card__boss">
            "{cast.bossBrief(level)}"
          </CastLine>
        )}
        {tease && !locked && (
          <CastLine role="troublemaker" size={60} className="index-card__troublemaker" tone="alarm">
            {tease}
          </CastLine>
        )}
      </div>

      {locked ? (
        replay && (
          <a className="btn btn--primary index-card__start" href={routeHref({ name: 'level', levelId: replay.level.id })}>
            Replay {words.level} {replay.index + 1} for more nines
            <Arrow />
          </a>
        )
      ) : (
        <a className="btn btn--primary index-card__start" href={routeHref({ name: 'level', levelId: level.id })}>
          {allPassed ? `Replay ${words.level} ${index + 1}` : `Start ${words.level} ${index + 1}`}
          <Arrow />
        </a>
      )}
    </article>
  );
}
