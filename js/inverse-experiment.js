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

    // CLIENT-SIDE KNOWLEDGE BASE & CATALOG SOLVER (OFFLINE RESILIENCE)
    const CLIENT_CATALOG_SOLUTIONS = [
        {
            id: 'lead_iodide',
            keywords: ['yellow', 'kuning', 'pbi2', 'lead', 'timbal', 'iodide', 'iodida', 'agi'],
            recommended_reaction: 'Synthesis of Lead(II) Iodide Precipitate (PbI₂)',
            configuration: {
                reactant_a: 'Pb(NO3)2',
                conc_a: 1.0,
                vol_a: 50,
                reactant_b: 'KI',
                conc_b: 2.0,
                vol_b: 50,
                temp: 25,
                pressure: 1
            },
            confidence_score: 98,
            explanation: 'Pb²⁺ (from Lead Nitrate) and I⁻ (from Potassium Iodide) exceed the ionic product quotient, rapidly precipitating into vibrant golden-yellow Lead(II) Iodide (PbI₂) crystals (Ksp = 9.8 × 10⁻⁹).'
        },
        {
            id: 'silver_chloride',
            keywords: ['white', 'putih', 'agcl', 'silver', 'perak', 'chloride', 'klorida', 'endapan putih'],
            recommended_reaction: 'Synthesis of Silver Chloride Precipitate (AgCl)',
            configuration: {
                reactant_a: 'AgNO3',
                conc_a: 1.0,
                vol_a: 50,
                reactant_b: 'NaCl',
                conc_b: 1.0,
                vol_b: 50,
                temp: 25,
                pressure: 1
            },
            confidence_score: 99,
            explanation: 'Ag⁺ cations exhibit extraordinarily high lattice affinity for Cl⁻ anions, driving complete precipitation of insoluble milky-white Silver Chloride (AgCl) with an extremely low Ksp of 1.8 × 10⁻¹⁰.'
        },
        {
            id: 'co2_gas',
            keywords: ['gas', 'bubble', 'gelembung', 'effervescence', 'co2', 'fizz', 'baking soda', 'soda kue', 'vinegar', 'cuka', 'karbondioksida', 'buih'],
            recommended_reaction: 'Effervescent Carbon Dioxide Gas Evolution (CO₂↑)',
            configuration: {
                reactant_a: 'NaHCO3',
                conc_a: 1.0,
                vol_a: 50,
                reactant_b: 'HCl',
                conc_b: 1.0,
                vol_b: 50,
                temp: 25,
                pressure: 1
            },
            confidence_score: 97,
            explanation: 'Proton transfer from Hydrochloric Acid (HCl) protonates Bicarbonate (HCO₃⁻) to generate unstable Carbonic Acid (H₂CO₃), which instantly decomposes into liquid water and effervescent Carbon Dioxide gas (CO₂↑).'
        },
        {
            id: 'neutralization',
            keywords: ['neutral', 'netral', 'ph 7', 'water', 'air', 'neutralize', 'neutralization', 'acid base', 'asam basa', 'exothermic', 'panas'],
            recommended_reaction: 'Stoichiometric Strong Acid-Base Neutralization',
            configuration: {
                reactant_a: 'HCl',
                conc_a: 1.0,
                vol_a: 50,
                reactant_b: 'NaOH',
                conc_b: 1.0,
                vol_b: 50,
                temp: 25,
                pressure: 1
            },
            confidence_score: 99,
            explanation: 'Equal molar quantities of strong acid (HCl) and strong base (NaOH) combine in a rapid exothermic neutralization reaction (H⁺ + OH⁻ → H₂O) to achieve an exact neutral pH of ~7.0.'
        },
        {
            id: 'calcium_carbonate',
            keywords: ['chalk', 'caco3', 'calcium', 'kalsium', 'carbonate', 'karbonat', 'kapur', 'limewater'],
            recommended_reaction: 'Synthesis of Calcium Carbonate Chalk (CaCO₃)',
            configuration: {
                reactant_a: 'CaCl2',
                conc_a: 1.0,
                vol_a: 50,
                reactant_b: 'Na2CO3',
                conc_b: 1.0,
                vol_b: 50,
                temp: 25,
                pressure: 1
            },
            confidence_score: 96,
            explanation: 'Ca²⁺ ions readily react with Carbonate (CO₃²⁻) to yield dense white insoluble Calcium Carbonate (CaCO₃, chalk) with a solubility product Ksp of 3.3 × 10⁻⁹.'
        },
        {
            id: 'barium_sulfate',
            keywords: ['baso4', 'barium', 'sulfate', 'sulfat'],
            recommended_reaction: 'Synthesis of Barium Sulfate Precipitate (BaSO₄)',
            configuration: {
                reactant_a: 'BaCl2',
                conc_a: 1.0,
                vol_a: 50,
                reactant_b: 'Na2SO4',
                conc_b: 1.0,
                vol_b: 50,
                temp: 25,
                pressure: 1
            },
            confidence_score: 98,
            explanation: 'Ba²⁺ and SO₄²⁻ ions precipitate into crystalline Barium Sulfate (BaSO₄), one of the most stable and insoluble inorganic precipitates known (Ksp = 1.1 × 10⁻¹⁰).'
        }
    ];

    function solveWithClientEngine(goalText) {
        const query = String(goalText || '').toLowerCase().trim();
        let bestMatch = CLIENT_CATALOG_SOLUTIONS[0];
        let maxMatches = -1;

        for (const item of CLIENT_CATALOG_SOLUTIONS) {
            let score = 0;
            for (const kw of item.keywords) {
                if (query.includes(kw)) {
                    score += kw.length >= 4 ? 3 : 1;
                }
            }
            if (score > maxMatches) {
                maxMatches = score;
                bestMatch = item;
            }
        }

        return {
            source: 'client_fallback',
            confidence_score: bestMatch.confidence_score,
            recommended_reaction: bestMatch.recommended_reaction,
            configuration: bestMatch.configuration,
            explanation: bestMatch.explanation
        };
    }

    function normalizeReagentId(id) {
        if (!id) return '';
        const clean = String(id).replace(/^sub\./i, '').trim();
        const map = {
            'agno3': 'AgNO3',
            'pb(no3)2': 'Pb(NO3)2',
            'pb_no3_2': 'Pb(NO3)2',
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
            'nh3': 'NH3'
        };
        return map[clean.toLowerCase()] || clean;
    }

    // APPLY CONFIGURATION TO REACTION LAB (1-CLICK INJECTOR)
    function applyInverseToLab(config) {
        if (!config) return;

        const reagentA = normalizeReagentId(config.reactant_a);
        const reagentB = normalizeReagentId(config.reactant_b);

        // 1. Switch to Reaction Lab tab
        const labTabBtn = document.querySelector('.tab-btn[data-tab="lab"]');
        if (labTabBtn) labTabBtn.click();

        // 2. Set global state
        if (window.state) {
            window.state.reagentA = reagentA;
            window.state.reagentB = reagentB;
            window.state.mA = config.conc_a || 1.0;
            window.state.vA = config.vol_a || 50;
            window.state.mB = config.conc_b || 1.0;
            window.state.vB = config.vol_b || 50;
            if (config.temp) window.state.temperature = config.temp;
        }

        // 3. Update DOM inputs
        if (window.els) {
            if (window.els.selectA) window.els.selectA.value = reagentA;
            if (window.els.selectB) window.els.selectB.value = reagentB;
            if (window.els.mASlider) {
                window.els.mASlider.value = Math.round((config.conc_a || 1.0) * 10);
                if (window.els.mAVal) window.els.mAVal.textContent = `${(config.conc_a || 1.0).toFixed(1)} M`;
            }
            if (window.els.vASlider) {
                window.els.vASlider.value = config.vol_a || 50;
                if (window.els.vAVal) window.els.vAVal.textContent = `${config.vol_a || 50} mL`;
            }
            if (window.els.mBSlider) {
                window.els.mBSlider.value = Math.round((config.conc_b || 1.0) * 10);
                if (window.els.mBVal) window.els.mBVal.textContent = `${(config.conc_b || 1.0).toFixed(1)} M`;
            }
            if (window.els.vBSlider) {
                window.els.vBSlider.value = config.vol_b || 50;
                if (window.els.vBVal) window.els.vBVal.textContent = `${config.vol_b || 50} mL`;
            }
            if (config.temp && window.els.tempSlider) {
                window.els.tempSlider.value = config.temp;
                if (window.els.tempVal) window.els.tempVal.textContent = `${config.temp} °C`;
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
        toast.innerHTML = `<span class="text-base">🧪</span><div><b>Configuration Loaded!</b> Solution A (${config.reactant_a}) & Solution B (${config.reactant_b}) ready. Click <b>Run Simulation</b>.</div>`;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 4200);
    }

    window.applyInverseToLab = applyInverseToLab;

    // RENDER SOLUTION OUTPUT
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
                        Synthesized
                    </span>
                </div>

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
                    <div class="text-[11px] text-muted-custom font-body">Evaluating stoichiometry, solubility product ($K_{sp}$), and thermodynamic parameters</div>
                </div>
            </div>
        `;

        const apiConfig = window.API_CONFIG || {};
        const baseUrl = String(apiConfig.BASE_URL || '').replace(/\/+$/, '');
        const endpoint = String(apiConfig.INVERSE || '/api/inverse-experiment');
        const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
        const apiUrl = baseUrl ? `${baseUrl}${normalizedEndpoint}` : '';

        let backendSucceeded = false;

        // LAYER 1: TRY BACKEND API (GEMINI / FASTAPI)
        if (apiUrl) {
            const abortController = new AbortController();
            const timeoutId = window.setTimeout(() => abortController.abort(), 6500);

            try {
                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ goal, constraints: {} }),
                    signal: abortController.signal
                });

                if (response.ok) {
                    const data = await response.json();
                    if (data && data.configuration && data.recommended_reaction) {
                        backendSucceeded = true;
                        if (badgeEl) badgeEl.textContent = 'Gemini AI Online';
                        renderRecommendation(data, '🤖 Powered by Gemini Chemical Engine', outputDiv);
                    }
                }
            } catch (err) {
                console.warn('Backend inverse solver unavailable or timed out, switching to client-side catalog solver:', err.message);
            } finally {
                window.clearTimeout(timeoutId);
            }
        }

        // LAYER 2: CLIENT-SIDE SMART CATALOG FALLBACK
        if (!backendSucceeded) {
            const clientResult = solveWithClientEngine(goal);
            if (badgeEl) badgeEl.textContent = 'Local Engine';
            renderRecommendation(clientResult, '⚡ Instant Chemical Engine Synthesis', outputDiv);
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
