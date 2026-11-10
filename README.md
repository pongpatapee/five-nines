# Five Nines

A puzzle game that teaches system design. See [docs/design.md](docs/design.md) for the design proposal.

## Layout

- `packages/sim`: the headless simulation engine and level definitions (`src/levels/*.json`). No DOM dependencies, so it can run in a Web Worker.

## Commands

Requires Node 24+ and pnpm.

```sh
pnpm install
pnpm test        # engine tests plus the level calibration contract
pnpm typecheck
pnpm sim levels  # grade every level's solutions and anti-solutions
pnpm sim grade 03-pull-the-plug path/to/design.json
```

Each level lists reference `solutions` (shown to players after an attempt) and `antiSolutions` (known traps). The test suite asserts each solution gets exactly its `expectedGrade` and each anti-solution fails exactly its `expectedFailure` checks, so engine or price changes that shift a level's balance show up as failing tests.
