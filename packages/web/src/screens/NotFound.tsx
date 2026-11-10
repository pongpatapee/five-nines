import { routeHref } from '../routing.ts';
import './screens.css';

export function NotFound({ levelId }: { levelId: string }) {
  return (
    <main className="not-found">
      <h1>No level called “{levelId}”</h1>
      <a className="btn" href={routeHref({ name: 'levels' })}>
        Back to levels
      </a>
    </main>
  );
}
