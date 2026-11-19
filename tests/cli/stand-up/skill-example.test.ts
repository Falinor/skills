import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { makeStandUpSandbox, started, type StandUpSandbox } from '../../support/stand-up.ts';

let sandbox: StandUpSandbox;
afterEach(() => sandbox.cleanup());

const skill = path.join(import.meta.dirname, '../../../skills/stand-up/SKILL.md');

test("SKILL.md's example plan renders", () => {
  sandbox = makeStandUpSandbox('2026-11-19');
  const example = fs.readFileSync(skill, 'utf8').match(/^```json\n([\s\S]*?)^```$/m);
  assert.ok(example, 'SKILL.md has no json example');
  const folder = started(sandbox);
  fs.writeFileSync(path.join(folder, 'plan.json'), example[1]);

  const result = sandbox.run(['render', folder]);

  assert.equal(result.status, 0, result.stderr);
});
