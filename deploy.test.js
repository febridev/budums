import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (file) => readFileSync(new URL(file, import.meta.url), 'utf8');
const major = (range) => Number(/^>=\s*(\d+)/.exec(range ?? '')?.[1] ?? 0);

const { packages } = JSON.parse(read('./package-lock.json'));
const { '': root, ...deps } = packages;
const depsFloor = Math.max(...Object.values(deps).map((p) => major(p.engines?.node)));

test('Docker image and engines meet every locked dependency Node floor', () => {
  const image = Number(/^FROM node:(\d+)/m.exec(read('./Dockerfile'))[1]);
  assert.ok(image >= depsFloor, `Dockerfile node ${image} < required ${depsFloor}`);
  assert.ok(major(root.engines.node) >= depsFloor, `engines ${root.engines.node} < required ${depsFloor}`);
});
