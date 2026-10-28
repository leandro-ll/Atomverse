// ==========================================
// INVERSE EXPERIMENT ENGINE (DUAL-LAYER SMART SOLVER)
// ==========================================

(function() {
    'use strict';

    const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
    })[character]);

    const clamp = (value, min, max, fallback) => {
        const n = Number(value);
        if (!Number.isFinite(n)) return fallback;
        return Math.max(min, Math.min(max, n));
    };

    const getLabDb = () => window.ATOMVERSE_LAB_REACTIONS || null;

    function normalizeReagentId(id) {
        if (!id) return '';
        const clean = String(id).replace(/^sub\./i, '').trim();
        const map = {
            'agno3': 'AgNO3',
            'pb(no3)2': 'Pb(NO3)2',
            'pb_no3_2': 'Pb(NO3)2',
            'pbno32': 'Pb(NO3)2',
            'bacl2': 'BaCl2',
            'nacl': 'NaCl',
            'ki': 'KI',
            'na2so4': 'Na2SO4',
            'hcl': 'HCl',
            'naoh': 'NaOH',
            'ch3cooh': 'CH3COOH',
            'nahco3': 'NaHCO3',
            'na2co3': 'Na2CO3',
            'cacl2': 'CaCl2',
            'ca(oh)2': 'Ca(OH)2',
            'ca_oh_2': 'Ca(OH)2',
            'caoh2': 'Ca(OH)2',
            'nh3': 'NH3'
        };
        return map[clean.toLowerCase()] || clean;
    }

    // Check that both reagents exist in the Reaction Lab and produce a supported reaction.
    function findSupportedReaction(data) {
        const db = getLabDb();
        if (!db || !data) return null;

        if (data.reaction_id && db.byId[data.reaction_id]) {
            return db.byId[data.reaction_id];
        }
        const cfg = data.configuration;
        if (!cfg) return null;
        const a = normalizeReagentId(cfg.reactant_a);
        const b = normalizeReagentId(cfg.reactant_b);
        return db.findByPair(a, b);
    }

    function isPairSimulatableInLab(reagentA, reagentB) {
        const db = getLabDb();
        if (db && (!db.reagents[reagentA] || !db.reagents[reagentB] || !db.findByPair(reagentA, reagentB))) {
            return false;
        }
        // Also verify against chemistry-engine.js globals if present.
        if (typeof reagentIons === 'object' && reagentIons) {
            const ionsA = reagentIons[reagentA];
            const ionsB = reagentIons[reagentB];
            if (!ionsA || !ionsB) return false;
            if (Array.isArray(reactionRules)) {
                const triggersRule = ionsA.some(iA =>
                    ionsB.some(iB =>
                        reactionRules.some(r =>
                            (r.cation === iA.t && r.anion === iB.t) ||
                            (r.cation === iB.t && r.anion === iA.t)
                        )
                    )
                );
                if (!triggersRule) return false;
            }
        }
        return true;
    }

    function buildFromDbEntry(entry, confidence, source, overrides = {}) {
        const concA = clamp(overrides.conc_a ?? entry.conc_a, 0.1, 2.0, entry.conc_a || 1.0);
        const concB = clamp(overrides.conc_b ?? entry.conc_b, 0.1, 2.0, entry.conc_b || 1.0);
        const volA = Math.round(clamp(overrides.vol_a ?? 50, 10, 100, 50));
        const volB = Math.round(clamp(overrides.vol_b ?? 50, 10, 100, 50));
        const temp = Math.round(clamp(overrides.temp ?? 25, 0, 100, 25));

        return {
            supported: true,
            source,
            reaction_id: entry.id,
            confidence_score: Math.round(clamp(confidence, 0, 100, 90)),
            recommended_reaction: entry.name,
            equation: entry.equation,
            configuration: {
                reactant_a: entry.reactant_a,
                conc_a: concA,
                vol_a: volA,
                reactant_b: entry.reactant_b,
                conc_b: concB,
                vol_b: volB,
                temp,
                pressure: 1
            },
            explanation: entry.explanation
        };
    }

    function buildUnsupportedResult(goalText, unsupportedTerms = []) {
        const db = getLabDb();
        const terms = unsupportedTerms.length
            ? unsupportedTerms
            : (db ? db.findUnsupportedTerms(goalText) : []);
        const detail = terms.length
            ? `The Reaction Lab can't simulate ${terms.join(', ')} yet.`
            : "This goal doesn't match any reaction the Reaction Lab can simulate yet.";

        return {
            supported: false,
            source: 'local',
            confidence_score: 0,
            recommended_reaction: 'Outcome not supported in the Reaction Lab',
            configuration: null,
            explanation: `${detail} Choose one of the supported outcomes below: precipitates (AgCl, AgI, PbI₂, PbCl₂, PbCO₃, BaSO₄, BaCO₃, CaCO₃), CO₂ or NH₃ gas evolution, or acid-base neutralization.`,
            unsupported_terms: terms,
            suggestions: db ? db.suggestions : []
        };
    }

    function solveWithClientEngine(goalText) {
        const db = getLabDb();
        if (!db) return buildUnsupportedResult(goalText);

        const match = db.matchGoal(goalText);
        if (!match.reaction) {
            return buildUnsupportedResult(goalText, match.unsupportedTerms);
        }
        return buildFromDbEntry(match.reaction, db.confidenceFromScore(match.score), 'local');
    }

    // APPLY CONFIGURATION TO REACTION LAB (1-CLICK INJECTOR)
    function applyInverseToLab(config) {
        if (!config) return;

        const reagentA = normalizeReagentId(config.reactant_a);
        const reagentB = normalizeReagentId(config.reactant_b);
        if (!isPairSimulatableInLab(reagentA, reagentB)) return;

        const concA = clamp(config.conc_a, 0.1, 2.0, 1.0);
        const concB = clamp(config.conc_b, 0.1, 2.0, 1.0);
        const volA = Math.round(clamp(config.vol_a, 10, 100, 50));
        const volB = Math.round(clamp(config.vol_b, 10, 100, 50));
        const temp = Math.round(clamp(config.temp, 0, 100, 25));

        // 1. Switch to Reaction Lab tab
        const labTabBtn = document.querySelector('.tab-btn[data-tab="lab"]');
        if (labTabBtn) labTabBtn.click();
        if (typeof window.setMobileLabDrawer === 'function') {
            window.setMobileLabDrawer('stage');
        }

        // 2. Set global state
        if (window.state) {
            window.state.reagentA = reagentA;
            window.state.reagentB = reagentB;
            window.state.mA = concA;
            window.state.vA = volA;
            window.state.mB = concB;
            window.state.vB = volB;
            window.state.temperature = temp;
        }

        // 3. Update DOM inputs
        if (window.els) {
            if (window.els.selectA) window.els.selectA.value = reagentA;
            if (window.els.selectB) window.els.selectB.value = reagentB;
            if (window.els.mASlider) {
                window.els.mASlider.value = Math.round(concA * 10);
                if (window.els.mAVal) window.els.mAVal.textContent = `${concA.toFixed(1)} M`;
            }
            if (window.els.vASlider) {
                window.els.vASlider.value = volA;
                if (window.els.vAVal) window.els.vAVal.textContent = `${volA} mL`;
            }
            if (window.els.mBSlider) {
                window.els.mBSlider.value = Math.round(concB * 10);
                if (window.els.mBVal) window.els.mBVal.textContent = `${concB.toFixed(1)} M`;
            }
            if (window.els.vBSlider) {
                window.els.vBSlider.value = volB;
                if (window.els.vBVal) window.els.vBVal.textContent = `${volB} mL`;
            }
            if (window.els.tempSlider) {
                window.els.tempSlider.value = temp;
                if (window.els.tempVal) window.els.tempVal.textContent = `${temp} °C`;
            }
        }

        // 4. Reset simulation state to reflect new reagents
        if (typeof window.resetState === 'function') {
            window.resetState();
        }

        // 5. Trigger gamification quest
        if (typeof window.completeStudentQuest === 'function') {
            window.completeStudentQuest('quest_inverse');
        }

        // 6. Toast alert
        const toast = document.createElement('div');
        toast.className = 'fixed bottom-6 right-6 z-50 bg-[var(--bg-surface)] text-[var(--text-main)] border border-[var(--primary)] px-4 py-3 rounded-xl shadow-xl flex items-center gap-3 text-xs animate-bounce font-body';
        toast.innerHTML = `<span class="text-base">🧪</span><div><b>Configuration Loaded!</b> Solution A (${escapeHtml(reagentA)}) & Solution B (${escapeHtml(reagentB)}) ready. Click <b>Run Simulation</b>.</div>`;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 4200);
    }

    window.applyInverseToLab = applyInverseToLab;

    // RENDER SUPPORTED SOLUTION OUTPUT
    function renderRecommendation(data, sourceLabel, outputDiv) {
        const config = data.configuration;
        const configJson = encodeURIComponent(JSON.stringify(config));

        outputDiv.innerHTML = `
            <div class="space-y-4">
                <div class="flex items-center justify-between gap-3">
                    <div>
                        <h4 class="font-bold text-base font-heading" style="color: var(--primary);">${escapeHtml(data.recommended_reaction)}</h4>
                        <div class="text-[10px] text-muted-custom flex items-center gap-2 mt-0.5">
                            <span>${escapeHtml(sourceLabel)}</span>
                            <span>•</span>
                            <span class="text-emerald-700 font-bold">Confidence: ${escapeHtml(data.confidence_score)}%</span>
                        </div>
                    </div>
                    <span class="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 shrink-0">
                        Lab Verified
                    </span>
                </div>

                ${data.equation ? `
                <div class="px-3 py-2 rounded-lg surface border border-[var(--border-color)] font-mono text-xs text-[var(--text-main)]">
                    ${escapeHtml(data.equation)}
                </div>
                ` : ''}

                <div class="p-4 rounded-xl bg-[var(--bg-surface-alt)] border border-[var(--border-color)]">
                    <h5 class="font-bold text-xs mb-3 font-heading" style="color: var(--secondary);">Computed Optimal Parameters:</h5>
                    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                        <div class="surface p-2.5 rounded-lg border border-[var(--border-color)]">
                            <span class="text-muted-custom block text-[10px] uppercase font-bold mb-0.5">Reactant A</span>
                            <div class="font-mono font-bold text-teal-700">${escapeHtml(config.reactant_a)}</div>
                            <div class="text-[11px] text-muted-custom">${escapeHtml(config.conc_a)}M, ${escapeHtml(config.vol_a)}mL</div>
                        </div>
                        <div class="surface p-2.5 rounded-lg border border-[var(--border-color)]">
                            <span class="text-muted-custom block text-[10px] uppercase font-bold mb-0.5">Reactant B</span>
                            <div class="font-mono font-bold text-amber-700">${escapeHtml(config.reactant_b)}</div>
                            <div class="text-[11px] text-muted-custom">${escapeHtml(config.conc_b)}M, ${escapeHtml(config.vol_b)}mL</div>
                        </div>
                        <div class="surface p-2.5 rounded-lg border border-[var(--border-color)]">
                            <span class="text-muted-custom block text-[10px] uppercase font-bold mb-0.5">Temperature</span>
                            <div class="font-mono font-bold">${escapeHtml(config.temp)} °C</div>
                            <div class="text-[11px] text-muted-custom">Ambient Control</div>
                        </div>
                        <div class="surface p-2.5 rounded-lg border border-[var(--border-color)]">
                            <span class="text-muted-custom block text-[10px] uppercase font-bold mb-0.5">Pressure</span>
                            <div class="font-mono font-bold">${escapeHtml(config.pressure || '1')} atm</div>
                            <div class="text-[11px] text-muted-custom">Standard State</div>
                        </div>
                    </div>
                </div>

                <div class="text-xs text-muted-custom leading-relaxed p-3 rounded-lg surface border border-[var(--border-color)]">
                    <div class="font-bold text-[11px] text-[var(--text-main)] mb-1">Scientific Rationale:</div>
                    ${escapeHtml(data.explanation)}
                </div>

                <!-- 1-CLICK APPLY ACTION -->
                <div class="pt-2 flex justify-end">
                    <button type="button" class="px-5 py-2.5 rounded-lg text-xs font-bold text-white shadow-sm flex items-center gap-2 transition-transform hover:scale-[1.02] active:scale-[0.98] font-heading" 
                        style="background-color: var(--primary);"
                        onclick="window.applyInverseToLab(JSON.parse(decodeURIComponent('${configJson}')))">
                        <span>🚀 Apply to Reaction Lab</span>
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
                    </button>
                </div>
            </div>
        `;
    }

    // RENDER UNSUPPORTED OUTCOME CARD WITH CLICKABLE SUGGESTIONS
    function renderUnsupported(data, outputDiv) {
        const db = getLabDb();
        const suggestions = (Array.isArray(data.suggestions) && data.suggestions.length)
            ? data.suggestions
            : (db ? db.suggestions : []);

        const chipsHtml = suggestions.map(item => `
            <button type="button"
                class="inv-suggestion-chip text-[11px] px-2.5 py-1 rounded-full border border-[var(--border-color)] surface hover:border-[var(--primary)] hover:bg-[var(--bg-surface-alt)] transition-all text-left font-medium cursor-pointer"
                data-prompt="${escapeHtml(item.prompt)}">
                ${escapeHtml(item.label)}
            </button>
        `).join('');

        outputDiv.innerHTML = `
            <div class="space-y-4">
                <div class="flex items-start justify-between gap-3">
                    <div>
                        <h4 class="font-bold text-base font-heading text-amber-800">${escapeHtml(data.recommended_reaction || 'Outcome not supported in the Reaction Lab')}</h4>
                        <div class="text-[11px] text-muted-custom mt-1 leading-relaxed">
                            ${escapeHtml(data.explanation)}
                        </div>
                    </div>
                    <span class="px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 shrink-0">
                        Not in Lab Database
                    </span>
                </div>

                ${chipsHtml ? `
                <div class="p-3.5 rounded-xl surface border border-[var(--border-color)]">
                    <div class="text-[10px] uppercase font-bold text-muted-custom mb-2 font-heading">Try a supported outcome:</div>
                    <div class="flex flex-wrap gap-1.5">
                        ${chipsHtml}
                    </div>
                </div>
                ` : ''}
            </div>
        `;

        outputDiv.querySelectorAll('.inv-suggestion-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                const prompt = chip.dataset.prompt;
                const invInput = document.getElementById('inv-input');
                const invClearBtn = document.getElementById('inv-clear-btn');
                if (prompt && invInput) {
                    invInput.value = prompt;
                    if (invClearBtn) invClearBtn.classList.remove('hidden');
                    solveGoal(prompt);
                }
            });
        });
    }

    // Validate backend payload against the Reaction Lab database before displaying it.
    function normalizeBackendResponse(raw, goalText) {
        if (!raw || typeof raw !== 'object') return null;

        if (raw.supported === false || !raw.configuration) {
            return {
                supported: false,
                source: raw.source || 'local',
                recommended_reaction: raw.recommended_reaction,
                explanation: raw.explanation,
                unsupported_terms: raw.unsupported_terms || [],
                suggestions: raw.suggestions || []
            };
        }

        const entry = findSupportedReaction(raw);
        if (!entry) return null;
        if (!isPairSimulatableInLab(entry.reactant_a, entry.reactant_b)) return null;

        // If the local matcher has a strong hit of a different type (e.g. gas vs precipitate),
        // reject the mismatched backend pick so the local database matcher handles it.
        const db = getLabDb();
        if (db) {
            const localMatch = db.matchGoal(goalText);
            if (localMatch.unsupportedTerms.length) {
                return buildUnsupportedResult(goalText, localMatch.unsupportedTerms);
            }
            if (localMatch.reaction && localMatch.strong && localMatch.reaction.type !== entry.type) {
                return null;
            }
        }

        return buildFromDbEntry(
            entry,
            raw.confidence_score ?? 92,
            raw.source === 'gemini' ? 'gemini' : 'local',
            raw.configuration
        );
    }

    // MAIN SOLVE FUNCTION
    async function solveGoal(goalText) {
        const goal = String(goalText || '').trim();
        const outputDiv = document.getElementById('inv-output');
        const badgeEl = document.getElementById('inv-engine-badge');
        const submitBtn = document.getElementById('inv-submit-btn');

        if (!outputDiv) return;

        if (!goal) {
            outputDiv.innerHTML = `
                <div class="p-4 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 text-xs font-body">
                    Please describe your experimental outcome in the box on the left, or click one of the quick inspiration chips.
                </div>
            `;
            return;
        }

        if (submitBtn) submitBtn.disabled = true;
        if (badgeEl) badgeEl.textContent = 'Synthesizing...';

        outputDiv.innerHTML = `
            <div class="flex items-center gap-3 p-5">
                <div class="animate-spin rounded-full h-6 w-6 border-2 border-[var(--primary)] border-t-transparent"></div>
                <div>
                    <div class="font-bold text-xs font-heading" style="color: var(--primary);">Inverse Algorithm Synthesizing Configuration...</div>
                    <div class="text-[11px] text-muted-custom font-body">Checking the Reaction Lab database for supported reactants and stoichiometry</div>
                </div>
            </div>
        `;

        const apiConfig = window.API_CONFIG || {};
        const baseUrl = String(apiConfig.BASE_URL || '').replace(/\/+$/, '');
        const endpoint = String(apiConfig.INVERSE || '/api/inverse-experiment');
        const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
        const apiUrl = baseUrl ? `${baseUrl}${normalizedEndpoint}` : '';

        let resolved = null;

        // LAYER 1: TRY BACKEND API (GEMINI / FASTAPI), THEN VERIFY AGAINST LAB DATABASE
        if (apiUrl) {
            const abortController = new AbortController();
            const timeoutId = window.setTimeout(() => abortController.abort(), 15000);

            try {
                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ goal, constraints: {} }),
                    signal: abortController.signal
                });

                if (response.ok) {
                    const data = await response.json();
                    resolved = normalizeBackendResponse(data, goal);
                }
            } catch (err) {
                console.warn('Backend inverse solver unavailable or timed out, switching to client-side database solver:', err.message);
            } finally {
                window.clearTimeout(timeoutId);
            }
        }

        // LAYER 2: CLIENT-SIDE LAB DATABASE MATCHER
        if (!resolved) {
            resolved = solveWithClientEngine(goal);
        }

        if (!resolved.supported) {
            if (badgeEl) badgeEl.textContent = 'Unsupported Goal';
            renderUnsupported(resolved, outputDiv);
        } else {
            const isGemini = resolved.source === 'gemini';
            if (badgeEl) badgeEl.textContent = isGemini ? 'Gemini AI (Verified)' : 'Lab Database Engine';
            const label = isGemini
                ? '🤖 Selected by Gemini • Verified against Lab Database'
                : '⚡ Matched from Reaction Lab Database';
            renderRecommendation(resolved, label, outputDiv);
        }

        if (submitBtn) submitBtn.disabled = false;
    }

    // EVENT LISTENERS & INITIALIZATION
    document.addEventListener('DOMContentLoaded', () => {
        const invInput = document.getElementById('inv-input');
        const invSubmitBtn = document.getElementById('inv-submit-btn');
        const invClearBtn = document.getElementById('inv-clear-btn');
        const invChips = document.querySelectorAll('.inv-chip');

        if (invInput) {
            invInput.addEventListener('input', () => {
                if (invClearBtn) {
                    invClearBtn.classList.toggle('hidden', !invInput.value.trim());
                }
            });

            invInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    solveGoal(invInput.value);
                }
            });
        }

        if (invClearBtn && invInput) {
            invClearBtn.addEventListener('click', () => {
                invInput.value = '';
                invClearBtn.classList.add('hidden');
                invInput.focus();
            });
        }

        if (invSubmitBtn && invInput) {
            invSubmitBtn.addEventListener('click', () => {
                solveGoal(invInput.value);
            });
        }

        if (invChips.length && invInput) {
            invChips.forEach(chip => {
                chip.addEventListener('click', () => {
                    const prompt = chip.dataset.prompt;
                    if (prompt) {
                        invInput.value = prompt;
                        if (invClearBtn) invClearBtn.classList.remove('hidden');
                        solveGoal(prompt);
                    }
                });
            });
        }
    });

})();
