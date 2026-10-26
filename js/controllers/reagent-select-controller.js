/**
 * js/controllers/reagent-select-controller.js
 *
 * Accessible grouped searchable combobox for reagent selection (~52 selectable options).
 * Implements WAI-ARIA 1.2 Combobox pattern with keyboard navigation, grouped listbox,
 * reduced motion support, and catalog substance identifier validation.
 *
 * Validates: Requirements 13.1, 13.2, 13.3, 13.4, 13.5, 13.6
 */

export function mountReagentSelect({
  root,
  side,
  catalog,
  onSelect,
  labelId,
  descriptionId,
  errorId,
  initialSubstanceId = null,
}) {
  if (!root) {
    throw new Error('mountReagentSelect requires a valid root element');
  }

  const sideLower = String(side || 'a').toLowerCase();
  const inputId = `reagent-select-${sideLower}-input`;
  const listboxId = `reagent-select-${sideLower}-listbox`;

  // Check if catalog is absent
  if (!catalog || !catalog.substances || !Array.isArray(catalog.substances)) {
    root.innerHTML = `
      <div class="reagent-combobox-container relative">
        <input
          id="${inputId}"
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="false"
          aria-disabled="true"
          disabled
          aria-labelledby="${labelId || ''}"
          aria-describedby="${descriptionId || ''}"
          class="w-full rounded-lg p-2.5 text-sm mb-4 outline-none border bg-gray-100 text-gray-500 cursor-not-allowed"
          placeholder="Katalog pereaksi tidak tersedia"
        />
      </div>
    `;
    return {
      destroy() {
        root.innerHTML = '';
      },
      getSelectedId() {
        return null;
      },
    };
  }

  // Collect selectable substances and groups
  const selectableSubstances = catalog.substances.filter((s) => Boolean(s.selectable));
  const substancesById = new Map(selectableSubstances.map((s) => [s.id, s]));
  const groups = Array.isArray(catalog.presentation?.reagentGroups)
    ? [...catalog.presentation.reagentGroups].sort((a, b) => (a.order || 0) - (b.order || 0))
    : [{ id: 'grp.all', label: 'Semua Pereaksi' }];

  let selectedId = initialSubstanceId && substancesById.has(initialSubstanceId)
    ? initialSubstanceId
    : (selectableSubstances[0]?.id || null);

  let isOpen = false;
  let activeIndex = -1;
  let filterText = '';
  let escapeCount = 0;

  function getOptionLabel(sub) {
    const unicode = sub?.notation?.unicode || sub?.formulaToken || '';
    const name = sub?.indonesianName || sub?.id || '';
    return `${name} (${unicode})`;
  }

  function getFilteredSubstances() {
    let base = selectableSubstances;
    if (filterText.trim()) {
      const term = filterText.toLowerCase().trim();
      base = selectableSubstances.filter((sub) => {
        const name = (sub.indonesianName || '').toLowerCase();
        const unicode = (sub.notation?.unicode || '').toLowerCase();
        const token = (sub.formulaToken || '').toLowerCase();
        return name.includes(term) || unicode.includes(term) || token.includes(term);
      });
    }

    const grouped = [];
    for (const grp of groups) {
      for (const sub of base) {
        if ((sub.presentationGroupId || 'grp.other') === grp.id) {
          grouped.push(sub);
        }
      }
    }
    const added = new Set(grouped.map((s) => s.id));
    for (const sub of base) {
      if (!added.has(sub.id)) grouped.push(sub);
    }
    return grouped;
  }

  // Render container shell
  root.innerHTML = `
    <div class="reagent-combobox-wrapper relative mb-4">
      <div class="relative">
        <input
          id="${inputId}"
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="false"
          aria-haspopup="listbox"
          aria-controls="${listboxId}"
          aria-labelledby="${labelId || ''}"
          aria-describedby="${[descriptionId, errorId].filter(Boolean).join(' ')}"
          aria-invalid="false"
          aria-activedescendant=""
          autocomplete="off"
          class="w-full rounded-lg p-2.5 text-sm outline-none border border-[var(--border-color,#cbd5e1)] bg-[var(--surface-color,#ffffff)] text-[var(--text-main,#0f172a)] focus:ring-2 focus:ring-[var(--primary,#3b82f6)] transition-colors pr-9"
          placeholder="Cari pereaksi..."
        />
        <button
          type="button"
          tabindex="-1"
          aria-hidden="true"
          class="combobox-toggle-btn absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none"
        >
          <svg class="w-4 h-4 transition-transform duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>
      <div
        id="${listboxId}"
        role="listbox"
        aria-labelledby="${labelId || ''}"
        class="reagent-listbox absolute left-0 right-0 top-full mt-1 max-h-60 overflow-y-auto rounded-lg border border-[var(--border-color,#cbd5e1)] bg-[var(--surface-color,#ffffff)] shadow-xl z-50 hidden"
        tabindex="-1"
      ></div>
    </div>
  `;

  const inputEl = root.querySelector(`#${inputId}`);
  const listboxEl = root.querySelector(`#${listboxId}`);
  const toggleBtn = root.querySelector('.combobox-toggle-btn');
  const errorEl = errorId ? document.getElementById(errorId) : null;

  function showError(message) {
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.classList.remove('hidden');
    }
    inputEl.setAttribute('aria-invalid', 'true');
  }

  function clearError() {
    if (errorEl) {
      errorEl.textContent = '';
      errorEl.classList.add('hidden');
    }
    inputEl.setAttribute('aria-invalid', 'false');
  }

  // Initial input display value
  const initialSelected = selectedId ? substancesById.get(selectedId) : null;
  if (initialSelected) {
    inputEl.value = getOptionLabel(initialSelected);
  }

  function renderListbox() {
    const filtered = getFilteredSubstances();
    if (filtered.length === 0) {
      listboxEl.innerHTML = `
        <div class="p-3 text-xs text-gray-500 italic text-center" role="status">
          Tidak ada pereaksi yang cocok
        </div>
      `;
      return;
    }

    const filteredSet = new Set(filtered.map((s) => s.id));
    let html = '';
    let globalIndex = 0;

    for (const grp of groups) {
      const inGroup = filtered.filter((s) => (s.presentationGroupId || 'grp.other') === grp.id);
      if (inGroup.length === 0) continue;

      html += `<div role="group" aria-label="${grp.label}" class="reagent-group border-b border-gray-100 last:border-b-0">`;
      html += `<div class="reagent-group-header px-3 py-1.5 text-[11px] font-bold text-gray-400 uppercase tracking-wider bg-gray-50 select-none" role="presentation">${grp.label}</div>`;

      for (const sub of inGroup) {
        const optionId = `opt-${sideLower}-${sub.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
        const isSelected = sub.id === selectedId;
        const isActive = globalIndex === activeIndex;

        html += `
          <div
            id="${optionId}"
            role="option"
            data-substance-id="${sub.id}"
            data-option-index="${globalIndex}"
            aria-selected="${isSelected ? 'true' : 'false'}"
            class="reagent-option px-3 py-2 text-xs flex items-center justify-between cursor-pointer select-none transition-colors ${
              isActive ? 'bg-blue-50 text-blue-700 font-semibold' : isSelected ? 'bg-blue-50/50 font-medium' : 'text-gray-700 hover:bg-gray-100'
            }"
          >
            <span>${getOptionLabel(sub)}</span>
            ${isSelected ? '<svg class="w-3.5 h-3.5 text-blue-600" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>' : ''}
          </div>
        `;
        globalIndex += 1;
      }

      html += `</div>`;
    }

    listboxEl.innerHTML = html;
  }

  function openPopup() {
    if (isOpen) return;
    isOpen = true;
    inputEl.setAttribute('aria-expanded', 'true');
    listboxEl.classList.remove('hidden');

    const filtered = getFilteredSubstances();
    const selIdx = filtered.findIndex((s) => s.id === selectedId);
    activeIndex = selIdx >= 0 ? selIdx : 0;

    renderListbox();
    updateActiveDescendant();
    scrollActiveIntoView();
  }

  function closePopup() {
    if (!isOpen) return;
    isOpen = false;
    inputEl.setAttribute('aria-expanded', 'false');
    listboxEl.classList.add('hidden');
    inputEl.removeAttribute('aria-activedescendant');
    activeIndex = -1;
  }

  function updateActiveDescendant() {
    const options = listboxEl.querySelectorAll('[role="option"]');
    if (activeIndex >= 0 && activeIndex < options.length) {
      const activeOption = options[activeIndex];
      inputEl.setAttribute('aria-activedescendant', activeOption.id);
      options.forEach((opt, idx) => {
        const isAct = idx === activeIndex;
        opt.classList.toggle('bg-blue-50', isAct);
        opt.classList.toggle('text-blue-700', isAct);
      });
    } else {
      inputEl.removeAttribute('aria-activedescendant');
    }
  }

  function scrollActiveIntoView() {
    const activeEl = listboxEl.querySelector(`[data-option-index="${activeIndex}"]`);
    if (activeEl && typeof activeEl.scrollIntoView === 'function') {
      const isReduced = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      activeEl.scrollIntoView({ block: 'nearest', behavior: isReduced ? 'auto' : 'smooth' });
    }
  }

  function commitSelection(substanceId) {
    if (!substanceId || !substancesById.has(substanceId)) {
      showError(`Pereaksi tidak valid: ${substanceId}`);
      return;
    }

    clearError();
    selectedId = substanceId;
    const sub = substancesById.get(substanceId);
    inputEl.value = getOptionLabel(sub);
    filterText = '';
    closePopup();

    if (typeof onSelect === 'function') {
      onSelect(substanceId);
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('experiment/setReagent', {
          detail: { side: sideLower.toUpperCase(), reagentId: substanceId },
        })
      );
    }
  }

  // Event Listeners
  inputEl.addEventListener('focus', () => {
    openPopup();
  });

  inputEl.addEventListener('click', () => {
    if (!isOpen) openPopup();
  });

  inputEl.addEventListener('input', () => {
    filterText = inputEl.value;
    escapeCount = 0;
    if (!isOpen) openPopup();
    else {
      activeIndex = 0;
      renderListbox();
      updateActiveDescendant();
    }
  });

  inputEl.addEventListener('keydown', (e) => {
    const filtered = getFilteredSubstances();
    const count = filtered.length;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!isOpen) {
          openPopup();
        } else if (count > 0) {
          activeIndex = (activeIndex + 1) % count;
          updateActiveDescendant();
          scrollActiveIntoView();
        }
        break;

      case 'ArrowUp':
        e.preventDefault();
        if (!isOpen) {
          openPopup();
        } else if (count > 0) {
          activeIndex = (activeIndex - 1 + count) % count;
          updateActiveDescendant();
          scrollActiveIntoView();
        }
        break;

      case 'Home':
        if (isOpen && count > 0) {
          e.preventDefault();
          activeIndex = 0;
          updateActiveDescendant();
          scrollActiveIntoView();
        }
        break;

      case 'End':
        if (isOpen && count > 0) {
          e.preventDefault();
          activeIndex = count - 1;
          updateActiveDescendant();
          scrollActiveIntoView();
        }
        break;

      case 'Enter':
        e.preventDefault();
        if (isOpen && activeIndex >= 0 && activeIndex < count) {
          commitSelection(filtered[activeIndex].id);
        }
        break;

      case 'Escape':
        e.preventDefault();
        if (isOpen) {
          closePopup();
          escapeCount = 1;
        } else if (escapeCount >= 1 || inputEl.value !== '') {
          // Second Escape: clear filter and reset input to selected label
          filterText = '';
          const current = selectedId ? substancesById.get(selectedId) : null;
          inputEl.value = current ? getOptionLabel(current) : '';
          escapeCount = 0;
        }
        break;

      case 'Tab':
        // Tab commits active option if popup open, without trapping focus
        if (isOpen && activeIndex >= 0 && activeIndex < count) {
          commitSelection(filtered[activeIndex].id);
        } else {
          closePopup();
        }
        break;

      default:
        escapeCount = 0;
        break;
    }
  });

  toggleBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if (isOpen) {
      closePopup();
    } else {
      inputEl.focus();
      openPopup();
    }
  });

  listboxEl.addEventListener('click', (e) => {
    const opt = e.target.closest('[role="option"]');
    if (opt && opt.dataset.substanceId) {
      commitSelection(opt.dataset.substanceId);
    }
  });

  // Close when clicking outside
  function handleDocumentClick(e) {
    if (!root.contains(e.target)) {
      if (isOpen) {
        // Reset input text to selected label if user typed a partial filter
        const current = selectedId ? substancesById.get(selectedId) : null;
        if (current) inputEl.value = getOptionLabel(current);
        filterText = '';
        closePopup();
      }
    }
  }

  document.addEventListener('click', handleDocumentClick);

  return {
    destroy() {
      document.removeEventListener('click', handleDocumentClick);
      root.innerHTML = '';
    },
    getSelectedId() {
      return selectedId;
    },
    setSelectedId(substanceId) {
      commitSelection(substanceId);
    },
    open: openPopup,
    close: closePopup,
  };
}
