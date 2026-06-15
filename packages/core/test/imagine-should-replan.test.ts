import { describe, expect, it } from 'vitest';

import { shouldReplan } from '../src/pipeline/imagine';

const RUN = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';

describe('shouldReplan', () => {
  it('re-plans when there are no existing points (fresh run)', () => {
    expect(shouldReplan([], RUN)).toBe(true);
  });

  it('skips the re-plan when every point already carries this run id (retry)', () => {
    expect(shouldReplan([{ runId: RUN }, { runId: RUN }, { runId: RUN }], RUN)).toBe(false);
  });

  it('re-plans when points carry a different (older) run id', () => {
    expect(shouldReplan([{ runId: OTHER }, { runId: OTHER }], RUN)).toBe(true);
  });

  it('re-plans when any point carries a null run id (pre-stamp rows)', () => {
    expect(shouldReplan([{ runId: null }], RUN)).toBe(true);
  });

  it('re-plans on a mixed set (some this run, some older/null)', () => {
    expect(shouldReplan([{ runId: RUN }, { runId: OTHER }], RUN)).toBe(true);
    expect(shouldReplan([{ runId: RUN }, { runId: null }], RUN)).toBe(true);
  });
});
