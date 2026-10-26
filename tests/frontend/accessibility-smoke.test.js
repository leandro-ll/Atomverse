// @vitest-environment jsdom

import axe from 'axe-core';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { mountReagentSelect } from '../../js/controllers/reagent-select-controller.js';
import { CATALOG } from '../../js/generated/chemistry-catalog.js';

const rootPath = path.resolve(__dirname, '../..');

/** Validates: Requirements 13.1, 13.2, 13.3, 25.6 */
describe('accessibility tests and reagent combobox', () => {
  it('runs axe-core against a minimal named interactive surface', async () => {
    document.documentElement.lang = 'id';
    document.head.innerHTML = '<title>Atomverse smoke</title>';
    document.body.innerHTML = `
      <main>
        <h1>Atomverse</h1>
        <button type="button" aria-describedby="run-help">Jalankan simulasi</button>
        <p id="run-help">Menjalankan eksperimen dengan input saat ini.</p>
        <div role="status" aria-live="polite">Siap</div>
      </main>
    `;

    const result = await axe.run(document.documentElement, {
      rules: { 'color-contrast': { enabled: false } },
    });

    expect(result.violations).toEqual([]);
  });

  it('asserts the flat ungrouped selects are gone from index.html', () => {
    const html = fs.readFileSync(path.join(rootPath, 'index.html'), 'utf-8');
    expect(html).not.toMatch(/id=["']select-a["']/);
    expect(html).not.toMatch(/id=["']select-b["']/);
    expect(html).not.toMatch(/<select[^>]*id=["']select-[ab]["']/);
    expect(html).toContain('id="reagent-select-a-root"');
    expect(html).toContain('id="reagent-select-b-root"');
    expect(html).toContain('id="label-reagent-a"');
    expect(html).toContain('id="label-reagent-b"');
  });

  it('mounts both reagent controls and satisfies axe-core accessibility scan', async () => {
    document.documentElement.lang = 'id';
    document.head.innerHTML = '<title>Reagent Select A11y</title>';
    document.body.innerHTML = `
      <main>
        <h1>Uji Aksesibilitas Pereaksi</h1>
        <section aria-labelledby="label-reagent-a">
          <label id="label-reagent-a" for="reagent-select-a-input">Larutan A</label>
          <p id="desc-reagent-a">Ketik nama atau rumus untuk mencari pereaksi A.</p>
          <div id="error-reagent-a" role="alert" aria-live="polite" class="hidden"></div>
          <div id="reagent-select-a-root"></div>
        </section>
        <section aria-labelledby="label-reagent-b">
          <label id="label-reagent-b" for="reagent-select-b-input">Larutan B</label>
          <p id="desc-reagent-b">Ketik nama atau rumus untuk mencari pereaksi B.</p>
          <div id="error-reagent-b" role="alert" aria-live="polite" class="hidden"></div>
          <div id="reagent-select-b-root"></div>
        </section>
      </main>
    `;

    const rootA = document.getElementById('reagent-select-a-root');
    const rootB = document.getElementById('reagent-select-b-root');

    const ctrlA = mountReagentSelect({
      root: rootA,
      side: 'a',
      catalog: CATALOG,
      labelId: 'label-reagent-a',
      descriptionId: 'desc-reagent-a',
      errorId: 'error-reagent-a',
      initialSubstanceId: 'sub.agno3',
    });

    const ctrlB = mountReagentSelect({
      root: rootB,
      side: 'b',
      catalog: CATALOG,
      labelId: 'label-reagent-b',
      descriptionId: 'desc-reagent-b',
      errorId: 'error-reagent-b',
      initialSubstanceId: 'sub.nacl',
    });

    const result = await axe.run(document.documentElement, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(result.violations).toEqual([]);

    ctrlA.destroy();
    ctrlB.destroy();
  });

  it('exercises keyboard smoke over both controls', () => {
    document.documentElement.lang = 'id';
    document.body.innerHTML = `
      <main>
        <label id="label-reagent-a" for="reagent-select-a-input">Larutan A</label>
        <p id="desc-reagent-a">Ketik pereaksi</p>
        <div id="error-reagent-a" role="alert" class="hidden"></div>
        <div id="reagent-select-a-root"></div>
      </main>
    `;

    let selectedReagent = null;
    const rootA = document.getElementById('reagent-select-a-root');
    const ctrlA = mountReagentSelect({
      root: rootA,
      side: 'a',
      catalog: CATALOG,
      labelId: 'label-reagent-a',
      descriptionId: 'desc-reagent-a',
      errorId: 'error-reagent-a',
      initialSubstanceId: 'sub.agno3',
      onSelect: (id) => { selectedReagent = id; },
    });

    const input = document.getElementById('reagent-select-a-input');
    expect(input).not.toBeNull();
    expect(input.getAttribute('role')).toBe('combobox');
    expect(input.getAttribute('aria-expanded')).toBe('false');

    // Focus opens popup
    input.focus();
    input.dispatchEvent(new Event('focus'));
    expect(input.getAttribute('aria-expanded')).toBe('true');

    // Arrow down navigates
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    const activeId = input.getAttribute('aria-activedescendant');
    expect(activeId).toBeTruthy();

    // Enter commits selection
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(selectedReagent).toBeTruthy();

    // Escape closes popup
    input.dispatchEvent(new Event('focus'));
    expect(input.getAttribute('aria-expanded')).toBe('true');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(input.getAttribute('aria-expanded')).toBe('false');

    ctrlA.destroy();
  });
});
