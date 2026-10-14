// The packaged App's bundled-Pack seed list (packages/desktop/src/bundled-packs.ts), exercised
// without Electron: main.ts seeds exactly these ids into a fresh versioned Home, installing only the
// absent ones. HIMA_BUNDLED_PACKS overrides the default; an unknown id is refused, never skipped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { bundledPackIds, DEFAULT_BUNDLED_PACK_IDS } from '../../packages/desktop/src/bundled-packs.ts';
import { repoRoot } from './support/dsh-home.ts';

const available = readdirSync(path.join(repoRoot, 'packs'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).map((entry) => entry.name);

test('unset env seeds the default list unchanged, and every default id exists in packs/', () => {
  assert.deepEqual(bundledPackIds({}, available), [...DEFAULT_BUNDLED_PACK_IDS]);
  for (const id of DEFAULT_BUNDLED_PACK_IDS) assert.ok(available.includes(id), `default bundled Pack ${id} is missing from packs/`);
});

test('a set value overrides the default with its own comma list', () => {
  assert.deepEqual(bundledPackIds({ HIMA_BUNDLED_PACKS: 'libinsight-analysis' }, available), ['libinsight-analysis']);
  assert.deepEqual(
    bundledPackIds({ HIMA_BUNDLED_PACKS: 'xtop-timing-closure,libinsight-analysis' }, available),
    ['xtop-timing-closure', 'libinsight-analysis'],
  );
});

test('the empty string seeds no Pack', () => {
  assert.deepEqual(bundledPackIds({ HIMA_BUNDLED_PACKS: '' }, available), []);
  assert.deepEqual(bundledPackIds({ HIMA_BUNDLED_PACKS: '   ' }, available), []);
});

test('whitespace is trimmed and duplicates fold to first-seen order', () => {
  assert.deepEqual(
    bundledPackIds({ HIMA_BUNDLED_PACKS: ' libinsight-analysis , xtop-timing-closure , libinsight-analysis ' }, available),
    ['libinsight-analysis', 'xtop-timing-closure'],
  );
});

test('an unknown id is refused, naming it and the ids that exist', () => {
  assert.throws(
    () => bundledPackIds({ HIMA_BUNDLED_PACKS: 'no-such-pack,libinsight-analysis' }, available),
    (error: Error) => {
      assert.match(error.message, /no-such-pack/);
      assert.match(error.message, /libinsight-analysis/); // an available id is listed
      assert.doesNotMatch(error.message, /\bxtop-timing-closure.*no-such-pack\b/s); // unknowns are not silently dropped
      return true;
    },
  );
});
