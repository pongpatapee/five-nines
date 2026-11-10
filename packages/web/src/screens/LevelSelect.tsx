import { LEVELS } from '@five-nines/sim';
import { GRADE_LABELS } from '../format.ts';
import { routeHref } from '../routing.ts';
import { useBestGrades } from '../state/index.ts';
import './screens.css';

/** `#/`: every level, all unlocked in this test build. */
export function LevelSelect() {
  const best = useBestGrades();
  return (
    <main className="level-select">
      <header className="level-select__header">
        <h1 className="wordmark">
          Five <span>Nines</span>
        </h1>
        <p className="muted">Design systems that stay up. Build, run, watch it break, fix it.</p>
      </header>
      <ol className="level-list">
        {LEVELS.map((level, i) => {
          const grade = best[level.id];
          return (
            <li key={level.id}>
              <a className="level-card" href={routeHref({ name: 'level', levelId: level.id })}>
                <span className="level-card__number num">{String(i + 1).padStart(2, '0')}</span>
                <span className="level-card__text">
                  <span className="level-card__title">{level.title}</span>
                  <span className="level-card__concept">{level.concept}</span>
                </span>
                <span className="grade-badge" data-grade={grade}>
                  {grade ? GRADE_LABELS[grade] : 'Not played'}
                </span>
              </a>
            </li>
          );
        })}
      </ol>
    </main>
  );
}
