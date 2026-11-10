import type { DesignIssue } from '@five-nines/sim';
import { CastLine, mentorCheckLine } from '../notebook/index.ts';

export interface IssueListProps {
  /** Already sorted, errors first. */
  issues: readonly DesignIssue[];
  onSelectNode(id: string): void;
}

/** Live validation results. Issues about a node select it when clicked. */
export function IssueList({ issues, onSelectNode }: IssueListProps) {
  const errors = issues.filter((issue) => issue.severity === 'error').length;
  const warnings = issues.length - errors;
  return (
    <section className="editor-section" aria-labelledby="issues-title">
      <h2 id="issues-title" className="editor-section__title issues__title">
        Checks
        <span className="issues__counts">
          {errors > 0 && <span className="issues__count" data-severity="error">{errors} error{errors === 1 ? '' : 's'}</span>}
          {warnings > 0 && (
            <span className="issues__count" data-severity="warning">
              {warnings} warning{warnings === 1 ? '' : 's'}
            </span>
          )}
        </span>
      </h2>
      <CastLine who="mentor" figureSize={58} erasmusMood={errors > 0 ? 'leaning' : 'calm'} className="issues__mentor">
        {mentorCheckLine(issues)}
      </CastLine>
      {issues.length === 0 ? (
        <p className="issues__ok">
          <span className="status-dot" data-status="healthy" aria-hidden /> Ready to run.
        </p>
      ) : (
        <ul className="issues">
          {issues.map((issue, i) => {
            const content = (
              <>
                <span className="issue__icon" data-severity={issue.severity} aria-label={issue.severity}>
                  {issue.severity === 'error' ? '✕' : '!'}
                </span>
                <span className="issue__message">{issue.message}</span>
              </>
            );
            const nodeId = issue.nodeId;
            return (
              <li key={`${issue.code}:${nodeId ?? ''}:${i}`}>
                {nodeId !== undefined ? (
                  <button
                    type="button"
                    className="issue issue--link"
                    data-severity={issue.severity}
                    onClick={() => onSelectNode(nodeId)}
                    title={`Select ${nodeId}`}
                  >
                    {content}
                  </button>
                ) : (
                  <div className="issue" data-severity={issue.severity}>
                    {content}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
