import { useId } from 'react';
import type { NapkinWorkingProps } from '../contract.ts';
import { NOTEBOOK_SCRIPT } from './cast.ts';
import { mainLine, workedSolution, type WorkedLine } from './hints.ts';

/**
 * The napkin maths worked out on the page: numbered steps in ink, each with why it is taken and its arithmetic, the
 * step's result run over with highlighter, and the answer boxed in red pen. What it means for the design follows as
 * a margin note.
 */
export function NapkinWorking({ solution }: NapkinWorkingProps) {
  const headingId = useId();
  const worked = workedSolution(solution);
  const last = worked.steps.length - 1;
  return (
    <section className="napkin-working" aria-labelledby={headingId}>
      <h3 id={headingId} className="napkin-working__title hand">
        {NOTEBOOK_SCRIPT.members.mentor.name}'s working
      </h3>
      <ol className="napkin-working__steps">
        {worked.steps.map((step, i) => {
          const main = mainLine(step);
          return (
            <li key={i} className="napkin-working__step">
              <p className="napkin-working__why">{step.reason}</p>
              {step.lines.map((line, j) => (
                <Line key={j} line={line} answer={i === last && line === main} />
              ))}
            </li>
          );
        })}
      </ol>
      <p className="napkin-working__takeaway">
        <span className="napkin-working__takeaway-lead hand">So: </span>
        {worked.takeaway}
      </p>
    </section>
  );
}

function Line({ line, answer }: { line: WorkedLine; answer: boolean }) {
  return (
    <p className="napkin-working__line" data-answer={answer || undefined}>
      {line.sum !== null && <span className="napkin-working__sum num">{line.sum} = </span>}
      <strong className="napkin-working__result num">
        {answer && <span className="visually-hidden">Answer: </span>}
        {line.result}
      </strong>
      {line.note && <span className="napkin-working__note"> {line.note}</span>}
    </p>
  );
}
