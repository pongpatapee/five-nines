import { CHAPTERS, isCapstone } from '@five-nines/sim';
import { story } from '../theme/index.ts';

/** What a level works on in the story, beside its title, and the capstone's mark. Nothing for a level with neither. */
export function LevelProduct({ levelId }: { levelId: string }) {
  const product = story.product(levelId);
  const capstone = isCapstone(CHAPTERS, levelId);
  if (!product && !capstone) return null;
  return (
    <p className="level-product">
      {product}
      {capstone && (
        <>
          {product && ' '}
          <span className="capstone-mark">{story.words.capstone}</span>
        </>
      )}
    </p>
  );
}
