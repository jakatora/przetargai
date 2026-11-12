import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const expoRequire = createRequire(require.resolve('expo/package.json'));
const metroRequire = createRequire(expoRequire.resolve('@expo/metro-config/package.json'));
const postcss = metroRequire('postcss');

test('Expo PostCSS still transforms CSS using the patched dependency', async () => {
  const plugin = { postcssPlugin: 'test-color', Declaration(decl) { if (decl.prop === 'color') decl.value = 'blue'; } };
  const result = await postcss([plugin]).process('a { color: red }', { from: undefined, map: false });
  assert.equal(result.css, 'a { color: blue }');
});

test('CSS annotation without from cannot disclose an arbitrary local source map', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'przetarg-postcss-'));
  const file = join(dir, 'private.map');
  const canary = 'LOCAL_TEST_CANARY_NOT_A_SECRET';
  writeFileSync(file, JSON.stringify({ version: 3, file: 'x.css', sources: ['private.css'], sourcesContent: [canary], names: [], mappings: 'AAAA' }));
  try {
    const css = `a { color: red }\n/*# sourceMappingURL=${file.replaceAll('\\', '/')} */`;
    const result = await postcss([]).process(css, { map: { inline: false } });
    assert.ok(!JSON.stringify(result.map?.toJSON()).includes(canary));
  } finally {
    unlinkSync(file); rmdirSync(dir);
  }
});
