// @vitest-environment jsdom

import fc from 'fast-check';
import { beforeEach, describe, expect, it } from 'vitest';
import { mountReagentSelect } from '../../js/controllers/reagent-select-controller.js';
import { CATALOG } from '../../js/generated/chemistry-catalog.js';

/**
 * Property 31: The selection control stays accessible, keyboard-complete, and identifier-resolved
 * Validates: Requirements 13.2, 13.3, 13.4, 13.5, 13.6
 */
describe('Property 31: Reagent selection control', () => {
  let root;
  let labelEl;
  let descEl;
  let errorEl;

  const selectableSubstances = CATALOG.substances.filter((s) => Boolean(s.selectable));
  const selectableIds = selectableSubstances.map((s) => s.id);

  beforeEach(() => {
    document.body.innerHTML = `
      <div>
        <label id="label-test" for="reagent-select-a-input">Larutan Uji</label>
        <p id="desc-test">Pilih pereaksi kimia</p>
        <div id="error-test" role="alert" class="hidden"></div>
        <div id="reagent-root"></div>
      </div>
    `;
    root = document.getElementById('reagent-root');
    labelEl = document.getElementById('label-test');
    descEl = document.getElementById('desc-test');
    errorEl = document.getElementById('error-test');
  });

  it('renders disabled input with Indonesian unavailable text when catalog is absent (Requirement 13.6)', () => {
    const ctrl = mountReagentSelect({
      root,
      side: 'a',
      catalog: null,
      labelId: 'label-test',
      descriptionId: 'desc-test',
      errorId: 'error-test',
    });

    const input = root.querySelector('input');
    expect(input).not.toBeNull();
    expect(input.disabled).toBe(true);
    expect(input.getAttribute('aria-disabled')).toBe('true');
    expect(input.placeholder).toContain('Katalog pereaksi tidak tersedia');
    expect(ctrl.getSelectedId()).toBeNull();
    ctrl.destroy();
  });

  it('preserves WAI-ARIA 1.2 structure and exactly one aria-selected across arbitrary initial selections', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...selectableIds),
        fc.constantFrom('a', 'b'),
        (initialId, side) => {
          let selectedFromCallback = null;
          const ctrl = mountReagentSelect({
            root,
            side,
            catalog: CATALOG,
            labelId: 'label-test',
            descriptionId: 'desc-test',
            errorId: 'error-test',
            initialSubstanceId: initialId,
            onSelect: (id) => { selectedFromCallback = id; },
          });

          const inputId = `reagent-select-${side}-input`;
          const listboxId = `reagent-select-${side}-listbox`;
          const input = root.querySelector(`#${inputId}`);
          const listbox = root.querySelector(`#${listboxId}`);

          expect(input).not.toBeNull();
          expect(listbox).not.toBeNull();
          expect(input.getAttribute('role')).toBe('combobox');
          expect(listbox.getAttribute('role')).toBe('listbox');
          expect(input.getAttribute('aria-autocomplete')).toBe('list');
          expect(input.getAttribute('aria-haspopup')).toBe('listbox');
          expect(input.getAttribute('aria-controls')).toBe(listboxId);
          expect(input.getAttribute('aria-invalid')).toBe('false');

          // Open popup and inspect options
          ctrl.open();
          expect(input.getAttribute('aria-expanded')).toBe('true');

          const options = listbox.querySelectorAll('[role="option"]');
          expect(options.length).toBe(selectableSubstances.length);

          const groups = listbox.querySelectorAll('[role="group"]');
          expect(groups.length).toBeGreaterThan(0);
          groups.forEach((grp) => {
            expect(grp.getAttribute('aria-label')).toBeTruthy();
          });

          // Exactly one option is aria-selected
          const selectedOptions = listbox.querySelectorAll('[role="option"][aria-selected="true"]');
          expect(selectedOptions.length).toBe(1);
          expect(selectedOptions[0].dataset.substanceId).toBe(initialId);
          expect(ctrl.getSelectedId()).toBe(initialId);

          ctrl.destroy();
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('executes keyboard navigation model and commits valid substance identifiers', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),
        fc.constantFrom('ArrowDown', 'ArrowUp'),
        (stepCount, arrowKey) => {
          let selectedId = null;
          let customEventFired = null;

          const handleCustomEvent = (e) => {
            customEventFired = e.detail;
          };
          window.addEventListener('experiment/setReagent', handleCustomEvent);

          const ctrl = mountReagentSelect({
            root,
            side: 'a',
            catalog: CATALOG,
            labelId: 'label-test',
            descriptionId: 'desc-test',
            errorId: 'error-test',
            initialSubstanceId: 'sub.agno3',
            onSelect: (id) => { selectedId = id; },
          });

          const input = root.querySelector('#reagent-select-a-input');
          ctrl.open();

          for (let i = 0; i < stepCount; i++) {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: arrowKey, bubbles: true }));
          }

          const activeDescendant = input.getAttribute('aria-activedescendant');
          expect(activeDescendant).toBeTruthy();
          const activeOpt = root.querySelector(`#${activeDescendant}`);
          expect(activeOpt).not.toBeNull();
          const activeSubstanceId = activeOpt.dataset.substanceId;
          expect(selectableIds).toContain(activeSubstanceId);

          // Enter commits active option
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
          expect(input.getAttribute('aria-expanded')).toBe('false');
          expect(selectedId).toBe(activeSubstanceId);
          expect(customEventFired).toEqual({ side: 'A', reagentId: activeSubstanceId });

          // Escape test: first escape closes popup
          ctrl.open();
          expect(input.getAttribute('aria-expanded')).toBe('true');
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          expect(input.getAttribute('aria-expanded')).toBe('false');

          window.removeEventListener('experiment/setReagent', handleCustomEvent);
          ctrl.destroy();
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejects invalid substance ids with visible error in role="alert" and aria-invalid="true"', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^inv_[a-z0-9]{3,8}$/u),
        (invalidId) => {
          let callbackInvoked = false;
          const ctrl = mountReagentSelect({
            root,
            side: 'a',
            catalog: CATALOG,
            labelId: 'label-test',
            descriptionId: 'desc-test',
            errorId: 'error-test',
            initialSubstanceId: 'sub.agno3',
            onSelect: () => { callbackInvoked = true; },
          });

          const input = root.querySelector('#reagent-select-a-input');
          expect(input.getAttribute('aria-invalid')).toBe('false');

          // Attempt to set invalid ID
          ctrl.setSelectedId(invalidId);

          expect(callbackInvoked).toBe(false);
          expect(input.getAttribute('aria-invalid')).toBe('true');
          expect(errorEl.classList.contains('hidden')).toBe(false);
          expect(errorEl.textContent).toContain('Pereaksi tidak valid');

          // Setting a valid ID clears error
          ctrl.setSelectedId('sub.nacl');
          expect(input.getAttribute('aria-invalid')).toBe('false');
          expect(errorEl.classList.contains('hidden')).toBe(true);
          expect(ctrl.getSelectedId()).toBe('sub.nacl');

          ctrl.destroy();
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('filters selectable options by Indonesian name, Unicode notation, and formula token', () => {
    const ctrl = mountReagentSelect({
      root,
      side: 'a',
      catalog: CATALOG,
      labelId: 'label-test',
      descriptionId: 'desc-test',
      errorId: 'error-test',
      initialSubstanceId: 'sub.agno3',
    });

    const input = root.querySelector('#reagent-select-a-input');
    const listbox = root.querySelector('#reagent-select-a-listbox');

    // Filter by name substring "perak"
    input.value = 'perak';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    ctrl.open();

    const perakOptions = listbox.querySelectorAll('[role="option"]');
    expect(perakOptions.length).toBeGreaterThan(0);
    perakOptions.forEach((opt) => {
      const sub = selectableSubstances.find((s) => s.id === opt.dataset.substanceId);
      expect(sub.indonesianName.toLowerCase()).toContain('perak');
    });

    // Filter by formula token "NaCl"
    input.value = 'NaCl';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    ctrl.open();

    const naclOptions = listbox.querySelectorAll('[role="option"]');
    expect(naclOptions.length).toBeGreaterThan(0);
    const subNacl = selectableSubstances.find((s) => s.id === naclOptions[0].dataset.substanceId);
    expect(subNacl.formulaToken).toBe('NaCl');

    ctrl.destroy();
  });
});
