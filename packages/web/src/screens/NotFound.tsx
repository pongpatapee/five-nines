import { routeHref } from '../routing.ts';

/** An address that leads nowhere: a level, or a chapter's all-hands, that doesn't exist. */
export function NotFound({ id, kind = 'level' }: { id: string; kind?: 'level' | 'chapter' }) {
  return (
    <main className="not-found">
      <h1>
        No {kind} called “{id}”
      </h1>
      <a className="btn" href={routeHref({ name: 'levels' })}>
        Back to levels
      </a>
    </main>
  );
}
