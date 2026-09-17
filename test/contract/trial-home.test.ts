import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { packagedTrialDshHome } from '../../packages/desktop/src/hima-home.ts';

test('a packaged trial version gets a fresh default DSH home without adopting the prior trial ledger', () => {
  const userData = path.resolve('/tmp/hima-user-data');
  assert.equal(packagedTrialDshHome(userData, '0.3.0-trial.3'),
    path.join(userData, 'trial-dsh-0.3.0-trial.3'));
  assert.notEqual(packagedTrialDshHome(userData, '0.3.0-trial.3'), path.join(userData, 'trial-dsh'));
  assert.throws(() => packagedTrialDshHome(userData, '../other-home'), /application version/);
});
