// ==========================================
// MAIN UI & STATE MANAGEMENT (GLOBAL)
// ==========================================

var state = {
    reagentA: 'AgNO3', reagentB: 'NaCl',
    mA: 1.0, vA: 50, mB: 1.0, vB: 50, temperature: 25,
    isReacted: false, isPouring: false, particles: [], effects: []
};

var els = {
    tabs: document.querySelectorAll('.tab-btn'),
    tabContents: document.querySelectorAll('.tab-content'),
    selectA: document.getElementById('select-a'),
    selectB: document.getElementById('select-b'),
    mAVal: document.getElementById('m-a-val'),
    mASlider: document.getElementById('m-a-slider'),
    vAVal: document.getElementById('v-a-val'),
    vASlider: document.getElementById('v-a-slider'),
    mBVal: document.getElementById('m-b-val'),
    mBSlider: document.getElementById('m-b-slider'),
    vBVal: document.getElementById('v-b-val'),
    vBSlider: document.getElementById('v-b-slider'),
    tempVal: document.getElementById('temp-val'),
    tempSlider: document.getElementById('temp-slider'),
    status: document.getElementById('sim-status'),
    statusText: document.getElementById('sim-status-text'),
    resColor: document.getElementById('res-color'),
    resPpt: document.getElementById('res-ppt'),
    resPh: document.getElementById('res-ph'),
    resEnergy: document.getElementById('res-energy'),
    resGas: document.getElementById('res-gas'),
    resGasCard: document.getElementById('res-gas-card'),
    stageMetrics: document.getElementById('stage-metrics'),
    macroView: document.getElementById('macro-view'),
    submicroView: document.getElementById('submicro-view'),
    btnMacro: document.getElementById('btn-macro'),
    btnSubmicro: document.getElementById('btn-submicro'),
    canvas: document.getElementById('submicro-canvas'),
    legend: document.getElementById('particle-legend'),
    kineticInd: document.getElementById('kinetic-indicator'),
    chatWindow: document.getElementById('chat-window'),
    chatInput: document.getElementById('chat-input'),
    reactionLoading: document.getElementById('reaction-loading'),
    beakerA: document.getElementById('beaker-a-group'),
    beakerB: document.getElementById('beaker-b-group'),
    beakerMixed: document.getElementById('beaker-mixed'),
    stream: document.getElementById('liquid-stream'),
    liquidA: document.getElementById('liquid-a'),
    liquidB: document.getElementById('liquid-b'),
    liquidMixedTop: document.getElementById('liquid-mixed-top'),
    liquidMixedBottom: document.getElementById('liquid-mixed-bottom'),
    liquidBoundary: document.getElementById('liquid-boundary'),
    layerNameTop: document.getElementById('layer-name-top'),
    layerNameBottom: document.getElementById('layer-name-bottom'),
    pptDots: document.getElementById('precipitate-dots'),
    bubblesGroup: document.getElementById('bubbles-group'),
    labelA: document.getElementById('label-beaker-a'),
    labelB: document.getElementById('label-beaker-b'),
    equationContainer: document.getElementById('equation-container'),
    equationText: document.getElementById('equation-text')
};

// --- TAB SWITCHING ---
els.tabs.forEach(tab => {
    tab.onclick = () => {
        els.tabs.forEach(t => {
            const isActive = t === tab;
            t.classList.toggle('active', isActive);
            t.classList.toggle('text-muted-custom', !isActive);
            t.setAttribute('aria-selected', String(isActive));
        });

        els.tabContents.forEach(c => c.classList.add('hidden'));
        const targetPanel = document.getElementById(`tab-${tab.dataset.tab}`);
        if (!targetPanel) return;
        targetPanel.classList.remove('hidden');
        
        if (tab.dataset.tab === 'env') {
            if (typeof renderEnvironmentalCards === 'function') {
                renderEnvironmentalCards();
            }
        }
        
        if (tab.dataset.tab === 'lab' && !els.submicroView.classList.contains('hidden')) {
            scheduleCanvasResize(state.particles.length === 0);
        }
    };
});

// --- SIMULATION LOGIC ---
function updateMacroColors() {
    if (els.liquidA) els.liquidA.setAttribute('fill', chemicalColors[state.reagentA] || '#bae6fd');
    if (els.liquidB) els.liquidB.setAttribute('fill', chemicalColors[state.reagentB] || '#e2e8f0');
    if (els.labelA) els.labelA.textContent = state.reagentA;
    if (els.labelB) els.labelB.textContent = state.reagentB;
}

const SIMULATION_DURATION_MS = 2200;
let simulationTimers = [];
let simulationRunId = 0;

function clearSimulationTimers() {
    simulationTimers.forEach(timerId => window.clearTimeout(timerId));
    simulationTimers = [];
}

function setSimulationControlsDisabled(disabled) {
    [els.selectA, els.selectB, els.mASlider, els.vASlider, els.mBSlider, els.vBSlider, els.tempSlider, els.btnMacro, els.btnSubmicro]
        .filter(Boolean)
        .forEach(control => { control.disabled = disabled; });
    const pressureSelect = document.getElementById('press-select');
    const runButton = document.getElementById('btn-run');
    if (pressureSelect) pressureSelect.disabled = disabled;
    if (runButton) runButton.disabled = disabled;
}

function finishSimulation(runId) {
    if (runId !== simulationRunId || !state.isPouring) return;
    clearSimulationTimers();
    state.isReacted = true;
    state.isPouring = false;
    setSimulationControlsDisabled(false);

    if (els.reactionLoading) els.reactionLoading.classList.add('hidden');
    if (els.submicroView) els.submicroView.classList.add('hidden');
    if (els.macroView) els.macroView.classList.remove('hidden');
    if (els.btnMacro) {
        els.btnMacro.classList.add('active');
        els.btnMacro.classList.remove('text-muted-custom');
    }
    if (els.btnSubmicro) {
        els.btnSubmicro.classList.remove('active');
        els.btnSubmicro.classList.add('text-muted-custom');
    }

    if (els.beakerA) els.beakerA.classList.add('hidden');
    if (els.beakerB) els.beakerB.classList.add('hidden');
    if (els.beakerMixed) {
        els.beakerMixed.classList.remove('hidden');
        els.beakerMixed.setAttribute('opacity', '1');
        els.beakerMixed.classList.add('result-reveal');
    }

    if (typeof resolveParticleReactions === 'function') {
        resolveParticleReactions();
    }
    state.particles.forEach(particle => {
        if (particle.side === 'A' && !particle.isPrecipitate) particle.vx += 3.5;
        else if (particle.side === 'B' && !particle.isPrecipitate) particle.vx -= 3.5;
    });

    const res = getReactionResult();
    const isNoReaction = res.ppt === null && !res.hasGas && res.energy === 'Normal';

    if (isNoReaction) {
        if (els.liquidMixedBottom) els.liquidMixedBottom.setAttribute('fill', chemicalColors[state.reagentB] || '#bae6fd');
        if (els.liquidMixedTop) els.liquidMixedTop.setAttribute('fill', chemicalColors[state.reagentA] || '#e9d5ff');
        if (els.liquidBoundary) els.liquidBoundary.setAttribute('opacity', '1');
        if (els.layerNameTop) {
            els.layerNameTop.textContent = chemicalNames[state.reagentA] || state.reagentA;
            els.layerNameTop.classList.add('visible');
        }
        if (els.layerNameBottom) {
            els.layerNameBottom.textContent = chemicalNames[state.reagentB] || state.reagentB;
            els.layerNameBottom.classList.add('visible');
        }
    } else {
        if (els.liquidMixedBottom) els.liquidMixedBottom.setAttribute('fill', res.color);
        if (els.liquidMixedTop) els.liquidMixedTop.setAttribute('fill', res.color);
        if (els.liquidBoundary) els.liquidBoundary.setAttribute('opacity', '0');
        if (els.layerNameTop) els.layerNameTop.classList.remove('visible');
        if (els.layerNameBottom) els.layerNameBottom.classList.remove('visible');
    }

    // Reveal equation
    if (els.equationText) els.equationText.textContent = res.equation;
    if (els.equationContainer) els.equationContainer.classList.remove('hidden');

    if (res.ppt && els.pptDots) {
        const dots = Array.from({ length: 60 }, () => {
            const cx = 30 + Math.random() * 180;
            const cy = 220 + Math.random() * 30;
            const radius = 2.5 + Math.random() * 2.5;
            return `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="${res.pptColor}" opacity="0.95"/>`;
        });
        els.pptDots.innerHTML = dots.join('');
    }

    if (res.hasGas && els.bubblesGroup) {
        const bubbles = Array.from({ length: 36 }, () => {
            const cx = 35 + Math.random() * 170;
            const cy = 60 + Math.random() * 170;
            const radius = 2.5 + Math.random() * 4;
            const delay = (Math.random() * 0.9).toFixed(2);
            return `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="rgba(255,255,255,0.85)" stroke="${res.gasColor || '#38bdf8'}" stroke-width="1.2" class="effervescence-bubble" style="animation-delay: ${delay}s"/>`;
        });
        els.bubblesGroup.innerHTML = bubbles.join('');
    }

    // Update Floating Metrics
    if (els.resColor) {
        els.resColor.textContent = isNoReaction ? 'Immiscible' : (res.ppt ? 'Turbid' : 'Clear');
    }
    if (els.resPpt) {
        if (res.ppt) {
            const dotColor = res.pptColor === '#ffffff' ? '#ffffff' : (res.pptColor || 'var(--secondary)');
            const dotBorder = res.pptColor === '#ffffff' ? 'border: 1.5px solid #94a3b8;' : 'border: 1px solid rgba(0,0,0,0.15);';
            els.resPpt.innerHTML = `<span class="inline-flex items-center gap-1.5 justify-center max-w-full" title="${res.ppt}"><span class="w-2.5 h-2.5 rounded-full inline-block shrink-0 shadow-sm" style="background-color: ${dotColor}; ${dotBorder}"></span><span class="truncate" style="color: var(--text-main); font-weight: 700;">${res.ppt}</span></span>`;
            els.resPpt.style.color = 'var(--text-main)';
        } else {
            els.resPpt.textContent = '-';
            els.resPpt.style.color = 'var(--text-main)';
            els.resPpt.removeAttribute('title');
        }
    }
    if (els.resPh) els.resPh.textContent = res.ph;
    if (els.resEnergy) {
        els.resEnergy.textContent = res.energy;
        els.resEnergy.style.color = res.energy.includes('Exothermic') ? 'var(--danger)' : 'var(--text-main)';
    }

    if (res.hasGas) {
        if (els.resGasCard) els.resGasCard.classList.remove('hidden');
        if (els.resGas) els.resGas.textContent = res.gas || 'Gas Evolved';
        if (els.stageMetrics) els.stageMetrics.classList.add('has-gas');
    } else {
        if (els.resGasCard) els.resGasCard.classList.add('hidden');
        if (els.stageMetrics) els.stageMetrics.classList.remove('has-gas');
    }

    if (els.status) els.status.className = 'status-pill';
    if (els.statusText) els.statusText.textContent = 'Status: Equilibrium Reached';

    // Dispatch reaction event for progress tracking
    window.dispatchEvent(new CustomEvent('atomverse/reaction-completed', {
        detail: {
            reagentA: state.reagentA,
            reagentB: state.reagentB,
            result: res
        }
    }));
}

function runSimulation() {
    if (state.isPouring || state.isReacted) return;

    clearSimulationTimers();
    const runId = ++simulationRunId;
    state.isPouring = true;
    state.isReacted = false;
    setSimulationControlsDisabled(true);

    if (els.status) els.status.className = 'status-pill reacting';
    if (els.statusText) els.statusText.textContent = 'Status: Reacting...';
    if (els.equationContainer) els.equationContainer.classList.add('hidden');
    if (els.pptDots) els.pptDots.innerHTML = '';
    if (els.bubblesGroup) els.bubblesGroup.innerHTML = '';

    // Hide stage views and display orbit loading overlay
    if (els.macroView) els.macroView.classList.add('hidden');
    if (els.submicroView) els.submicroView.classList.add('hidden');
    if (els.reactionLoading) els.reactionLoading.classList.remove('hidden');

    simulationTimers.push(window.setTimeout(() => {
        finishSimulation(runId);
    }, SIMULATION_DURATION_MS));
}

function resetState() {
    simulationRunId += 1;
    clearSimulationTimers();
    state.isReacted = false;
    state.isPouring = false;
    setSimulationControlsDisabled(false);

    if (els.reactionLoading) els.reactionLoading.classList.add('hidden');
    if (els.macroView) els.macroView.classList.remove('hidden');
    if (els.submicroView) els.submicroView.classList.add('hidden');
    if (els.btnMacro) {
        els.btnMacro.classList.add('active');
        els.btnMacro.classList.remove('text-muted-custom');
    }
    if (els.btnSubmicro) {
        els.btnSubmicro.classList.remove('active');
        els.btnSubmicro.classList.add('text-muted-custom');
    }

    if (els.beakerA) els.beakerA.classList.remove('hidden');
    if (els.beakerB) els.beakerB.classList.remove('hidden');
    if (els.beakerMixed) {
        els.beakerMixed.setAttribute('opacity', '0');
        els.beakerMixed.classList.remove('result-reveal');
        els.beakerMixed.classList.add('hidden');
    }
    if (els.equationContainer) els.equationContainer.classList.add('hidden');
    if (els.layerNameTop) els.layerNameTop.classList.remove('visible');
    if (els.layerNameBottom) els.layerNameBottom.classList.remove('visible');
    if (els.pptDots) els.pptDots.innerHTML = '';
    if (els.bubblesGroup) els.bubblesGroup.innerHTML = '';

    if (els.status) els.status.className = 'status-pill';
    if (els.statusText) els.statusText.textContent = 'Status: Ready';
    if (els.resColor) els.resColor.textContent = 'Clear';
    if (els.resPpt) {
        els.resPpt.textContent = '-';
        els.resPpt.style.color = 'var(--text-main)';
        els.resPpt.removeAttribute('title');
    }
    if (els.resPh) els.resPh.textContent = '-';
    if (els.resEnergy) {
        els.resEnergy.textContent = `${state.temperature} °C`;
        els.resEnergy.style.color = 'var(--text-main)';
    }
    if (els.resGasCard) els.resGasCard.classList.add('hidden');
    if (els.resGas) els.resGas.textContent = '-';
    if (els.stageMetrics) els.stageMetrics.classList.remove('has-gas');

    updateMacroColors();
    if (!els.submicroView.classList.contains('hidden')) {
        scheduleCanvasResize(true);
    } else {
        state.particles = [];
        state.effects = [];
    }
}

// --- EVENT LISTENERS ---
els.selectA.onchange = (e) => { state.reagentA = e.target.value; resetState(); };
els.selectB.onchange = (e) => { state.reagentB = e.target.value; resetState(); };
els.mASlider.oninput = (e) => { state.mA = e.target.value / 10; els.mAVal.textContent = state.mA.toFixed(1) + ' M'; resetState(); };
els.vASlider.oninput = (e) => { state.vA = parseInt(e.target.value); els.vAVal.textContent = state.vA + ' mL'; resetState(); };
els.mBSlider.oninput = (e) => { state.mB = e.target.value / 10; els.mBVal.textContent = state.mB.toFixed(1) + ' M'; resetState(); };
els.vBSlider.oninput = (e) => { state.vB = parseInt(e.target.value); els.vBVal.textContent = state.vB + ' mL'; resetState(); };
els.tempSlider.oninput = (e) => { 
    state.temperature = parseInt(e.target.value); 
    els.tempVal.textContent = state.temperature + ' °C'; 
    if (state.temperature < 20) els.kineticInd.textContent = "Low"; 
    else if (state.temperature < 60) els.kineticInd.textContent = "Medium"; 
    else els.kineticInd.textContent = "High"; 
};

els.btnMacro.onclick = () => {
    els.macroView.classList.remove('hidden');
    els.submicroView.classList.add('hidden');
    els.btnMacro.classList.add('active');
    els.btnSubmicro.classList.remove('active');
    els.btnSubmicro.classList.add('text-muted-custom');
    els.btnMacro.classList.remove('text-muted-custom');
};
els.btnSubmicro.onclick = () => {
    els.submicroView.classList.remove('hidden');
    els.macroView.classList.add('hidden');
    els.btnSubmicro.classList.add('active');
    els.btnMacro.classList.remove('active');
    els.btnMacro.classList.add('text-muted-custom');
    els.btnSubmicro.classList.remove('text-muted-custom');
    if (typeof initCanvas === 'function') initCanvas();
    if (typeof animateParticles === 'function') animateParticles();
    scheduleCanvasResize(state.particles.length === 0);
};

document.getElementById('btn-run').onclick = runSimulation;
document.getElementById('btn-reset').onclick = resetState;

// --- INVERSE EXPERIMENT TAB ---
function displayInverseResult(data, container) {
    container.innerHTML = `
        <div class="space-y-4">
            <div class="flex items-center justify-between">
                <h4 class="font-bold text-base text-[var(--primary)]">${data.recommended_reaction}</h4>
                <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700">
                    Confidence: ${data.confidence_score}%
                </span>
            </div>
            
            <div class="p-3 bg-[var(--bg-surface-alt)] rounded-lg border border-[var(--border-color)]">
                <h5 class="font-bold text-xs mb-2">Optimal Reagent Parameters:</h5>
                <div class="grid grid-cols-2 gap-2 text-xs">
                    <div>
                        <span class="text-muted-custom">Reactant A:</span>
                        <div class="font-mono font-bold">${data.configuration.reactant_a} ${data.configuration.conc_a}M, ${data.configuration.vol_a}mL</div>
                    </div>
                    <div>
                        <span class="text-muted-custom">Reactant B:</span>
                        <div class="font-mono font-bold">${data.configuration.reactant_b} ${data.configuration.conc_b}M, ${data.configuration.vol_b}mL</div>
                    </div>
                    <div>
                        <span class="text-muted-custom">Temperature:</span>
                        <div class="font-mono font-bold">${data.configuration.temp}°C</div>
                    </div>
                    <div>
                        <span class="text-muted-custom">Pressure:</span>
                        <div class="font-mono font-bold">${data.configuration.pressure} atm</div>
                    </div>
                </div>
            </div>
            
            <div class="p-3 bg-cyan-50/60 border border-cyan-200 rounded-lg">
                <h5 class="font-bold text-xs mb-1.5 text-[var(--primary)]">Predicted Outcome:</h5>
                <ul class="text-xs space-y-0.5">
                    <li><b>Color:</b> ${data.predicted_outcome.color || '-'}</li>
                    <li><b>Precipitate:</b> ${data.predicted_outcome.precipitate || '-'}</li>
                    <li><b>Final pH:</b> ${data.predicted_outcome.ph_final || '-'}</li>
                </ul>
            </div>
            
            <div class="text-xs text-muted-custom italic">
                ${data.explanation || ''}
            </div>
        </div>
    `;
}

// --- ENVIRONMENTAL LITERACY MODULE ---
const environmentalData = [
    {
        id: 'styrofoam',
        name: 'Styrofoam',
        risk: 'High',
        riskColor: 'bg-red-100 text-red-600',
        chemical: 'Polystyrene — (C₈H₈)ₙ',
        degradation: '>500 years',
        stability: 'Highly Stable',
        impact: 'Microplastics & marine ecosystem pollution',
        bondDetail: {
            title: 'Polystyrene Molecular Bond Structure',
            mainStructure: 'The polymer backbone is composed of strong single covalent C–C bonds, with non-polar aromatic benzene rings on alternating carbons.',
            resonance: 'Delocalized π-electrons in the aromatic ring resist cleavage by water, ambient bacteria, or standard sunlight UV rays.',
            intermolecular: 'Massive cumulative van der Waals forces between polymer chains impart strong structural rigidity.',
            whyStable: 'Single C–C bonds possess a high bond dissociation energy of ~347 kJ/mol, rendering it inert to hydrolysis and ambient oxidation.',
            diagram: '—[CH₂—CH(C₆H₅)]ₙ—'
        }
    },
    {
        id: 'pet',
        name: 'PET Plastic',
        risk: 'Moderate',
        riskColor: 'bg-yellow-100 text-yellow-700',
        chemical: 'Polyethylene terephthalate',
        degradation: '~450 years',
        stability: 'High (Ester)',
        impact: 'Partially recyclable via depolymerization',
        bondDetail: {
            title: 'Ester Bonds in PET Polymers',
            mainStructure: 'Polyester chains linked by covalent ester bonds (–C(=O)–O–) bridging ethylene glycol and terephthalic acid monomers.',
            hydrolysis: 'Polar ester linkages are susceptible to chemical cleavage (hydrolysis) under acid/alkaline catalysis.',
            recycling: 'PET can be chemically recycled through glycolysis or methanolysis into pure terephthalic acid.',
            whyStable: 'Aromatic rings provide steric hindrance and resonance stabilization to the ester carbonyl bond (~358 kJ/mol).',
            diagram: '—[O—CH₂—CH₂—O—C(=O)—C₆H₄—C(=O)]—'
        }
    },
    {
        id: 'battery',
        name: 'Li-ion Battery',
        risk: 'High',
        riskColor: 'bg-red-100 text-red-600',
        chemical: 'LiCoO₂ / Heavy Metal Cathode',
        degradation: 'Non-biodegradable',
        stability: 'Reactive if punctured',
        impact: 'Groundwater leaching & heavy metal toxicity',
        bondDetail: {
            title: 'LiCoO₂ Layered Crystal Lattice',
            mainStructure: 'Lithium cobalt oxide (LiCoO₂) features octahedrally coordinated CoO₂ layers with intercalated Li⁺ ions.',
            redox: 'Electrochemical cycling involves reversible redox intercalation: LiCoO₂ ⇌ Li₁₋ₓCoO₂ + xLi⁺ + xe⁻.',
            hazard: 'Physical breach triggers thermal runaway and leaches bioaccumulative cobalt and volatile electrolyte salts.',
            whyReactive: 'Lattice designed with high chemical potential to readily mobilize lithium ions.',
            diagram: 'Layer: [CoO₂]⁻ — Li⁺ — [CoO₂]⁻'
        }
    },
    {
        id: 'detergent',
        name: 'Synthetic Detergent',
        risk: 'Low',
        riskColor: 'bg-emerald-100 text-emerald-700',
        chemical: 'Alkyl Sulfonate Surfactant',
        degradation: 'Biodegradable (Aerobic)',
        stability: 'Moderate',
        impact: 'Eutrophication when phosphate builders present',
        bondDetail: {
            title: 'Amphiphilic Surfactant Architecture',
            mainStructure: 'Alkyl sulfonate molecules combine a non-polar hydrophobic hydrocarbon tail with a hydrophilic anionic sulfonate head (–SO₃⁻).',
            biodegradation: 'Linear alkyl chains are cleaved enzymatically by environmental microbes via cellular β-oxidation.',
            eutrophication: 'Historically added phosphate builders induce rapid aquatic algal blooms that deplete dissolved oxygen.',
            whyBiodegradable: 'Linear C–C chains present minimal steric hindrance to microbial enzymatic cleavage.',
            diagram: 'CH₃—(CH₂)ₙ—SO₃⁻Na⁺'
        }
    },
    {
        id: 'ewaste',
        name: 'Electronic Waste',
        risk: 'Moderate',
        riskColor: 'bg-yellow-100 text-yellow-700',
        chemical: 'Composite Metals & Brominated FRs',
        degradation: 'Variable (Centuries)',
        stability: 'Complex Composite',
        impact: 'Requires pyrometallurgical & hydrometallurgical recycling',
        bondDetail: {
            title: 'E-Waste Multilayer Composite Complexity',
            mainStructure: 'Printed circuit boards feature epoxy fiberglass laminates cross-linked with copper traces, lead/tin solders, and gold pin contacts.',
            metals: 'Metals are held via metallic bonding; flame retardants are bonded covalently into the thermoset polymer matrix.',
            polymers: 'Thermoset epoxy resins cannot be melted for remolding and require chemical recycling or high-temperature pyrolysis.',
            whyComplex: 'Separation demands multistage physical crushing, electrostatic sorting, and hydrometallurgical leaching.',
            diagram: 'Multi-layer: [Polymer]—[Cu]—[Solder]—[IC]'
        }
    },
    {
        id: 'pla',
        name: 'Bioplastic (PLA)',
        risk: 'Low',
        riskColor: 'bg-emerald-100 text-emerald-700',
        chemical: 'Polylactic Acid — (C₃H₄O₂)ₙ',
        degradation: '~6 months (Industrial Compost)',
        stability: 'Low–Moderate',
        impact: 'Renewable plant-based packaging alternative',
        bondDetail: {
            title: 'Aliphatic Ester Bonds in PLA',
            mainStructure: 'Renewable aliphatic polyester synthesized through ring-opening polymerization of lactide dimers from fermented plant starch.',
            hydrolysis: 'Aliphatic ester linkages undergo spontaneous abiotic hydrolysis followed by microbial digestion into lactic acid, water, and CO₂.',
            composting: 'Requires controlled thermophilic composting conditions (58°C, >60% relative humidity) to break crystalline domains.',
            whyBiodegradable: 'Aliphatic ester chains lack aromatic rigidity, enabling rapid enzymatic esterase cleavage.',
            diagram: '—[O–CH(CH₃)–C(=O)]ₙ—'
        }
    }
];

function renderEnvironmentalCards() {
    const grid = document.getElementById('env-grid');
    if (!grid) return;
    
    grid.innerHTML = environmentalData.map(material => `
        <div class="env-card surface border border-[var(--border-color)] rounded-xl p-5 flex flex-col cursor-pointer hover:shadow-md transition-all" 
             onclick="openBondDetail('${material.id}')">
            <div class="flex justify-between items-start mb-2.5">
                <h3 class="text-sm font-bold font-heading">${material.name}</h3>
                <span class="px-2 py-0.5 rounded text-[9px] font-bold uppercase font-heading ${material.riskColor}">
                    Risk: ${material.risk}
                </span>
            </div>
            <p class="text-xs mono mb-2 font-medium" style="color: var(--primary);">${material.chemical}</p>
            <div class="space-y-1 text-xs text-muted-custom mb-3">
                <div><span class="font-semibold text-slate-700">Degradation:</span> ${material.degradation}</div>
                <div><span class="font-semibold text-slate-700">Stability:</span> ${material.stability}</div>
                <div><span class="font-semibold text-slate-700">Impact:</span> ${material.impact}</div>
            </div>
            <div class="mt-auto pt-3 border-t border-[var(--border-color)]">
                <button class="text-xs font-bold font-heading flex items-center gap-1.5" style="color: var(--primary);">
                    Explore Molecular Bonds
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
                    </svg>
                </button>
            </div>
        </div>
    `).join('');
}

function openBondDetail(materialId) {
    const material = environmentalData.find(m => m.id === materialId);
    if (!material) return;
    
    const modal = document.getElementById('bond-detail-modal');
    const modalTitle = document.getElementById('modal-title');
    const modalContent = document.getElementById('modal-content');
    
    modalTitle.textContent = material.name;
    modalContent.innerHTML = `
        <div class="space-y-4">
            <div class="p-3 rounded-lg bg-[var(--bg-surface-alt)] border border-[var(--border-color)]">
                <div class="text-[10px] text-muted-custom uppercase font-bold mb-1">Chemical Formula</div>
                <div class="font-mono font-bold text-xs" style="color: var(--primary);">${material.chemical}</div>
            </div>
            
            <div>
                <h4 class="font-bold text-sm mb-2 font-heading" style="color: var(--secondary);">${material.bondDetail.title}</h4>
                <div class="prose prose-sm max-w-none text-xs text-[var(--text-main)] space-y-2.5 leading-relaxed">
                    <p>${material.bondDetail.mainStructure}</p>
                    ${material.bondDetail.resonance ? `<p>${material.bondDetail.resonance}</p>` : ''}
                    ${material.bondDetail.hydrolysis ? `<p>${material.bondDetail.hydrolysis}</p>` : ''}
                    ${material.bondDetail.redox ? `<p>${material.bondDetail.redox}</p>` : ''}
                    ${material.bondDetail.biodegradation ? `<p>${material.bondDetail.biodegradation}</p>` : ''}
                    ${material.bondDetail.intermolecular ? `<p>${material.bondDetail.intermolecular}</p>` : ''}
                    ${material.bondDetail.recycling ? `<p>${material.bondDetail.recycling}</p>` : ''}
                    ${material.bondDetail.hazard ? `<p>${material.bondDetail.hazard}</p>` : ''}
                    ${material.bondDetail.eutrophication ? `<p>${material.bondDetail.eutrophication}</p>` : ''}
                    ${material.bondDetail.metals ? `<p>${material.bondDetail.metals}</p>` : ''}
                    ${material.bondDetail.polymers ? `<p>${material.bondDetail.polymers}</p>` : ''}
                    ${material.bondDetail.whyStable ? `<p class="font-semibold text-[var(--primary)]">${material.bondDetail.whyStable}</p>` : ''}
                    ${material.bondDetail.whyBiodegradable ? `<p class="font-semibold text-[var(--primary)]">${material.bondDetail.whyBiodegradable}</p>` : ''}
                    ${material.bondDetail.whyReactive ? `<p class="font-semibold text-[var(--primary)]">${material.bondDetail.whyReactive}</p>` : ''}
                    ${material.bondDetail.whyComplex ? `<p class="font-semibold text-[var(--primary)]">${material.bondDetail.whyComplex}</p>` : ''}
                </div>
            </div>
            
            ${material.bondDetail.diagram ? `
            <div class="p-3 rounded-lg bg-[var(--bg-surface-alt)] border border-[var(--border-color)]">
                <div class="text-[10px] font-bold uppercase tracking-wider mb-1.5" style="color: var(--primary);">Molecular Representation</div>
                <div class="font-mono text-xs text-center p-2 rounded bg-white border border-[var(--border-color)] overflow-x-auto">
                    <code style="color: var(--text-main); font-weight: 700;">${material.bondDetail.diagram}</code>
                </div>
            </div>` : ''}
            
            <div class="grid grid-cols-2 gap-3 text-xs">
                <div class="p-2.5 rounded-lg bg-[var(--bg-surface-alt)] border border-[var(--border-color)]">
                    <div class="text-[10px] text-muted-custom uppercase font-bold mb-0.5">Degradation Span</div>
                    <div class="font-bold">${material.degradation}</div>
                </div>
                <div class="p-2.5 rounded-lg bg-[var(--bg-surface-alt)] border border-[var(--border-color)]">
                    <div class="text-[10px] text-muted-custom uppercase font-bold mb-0.5">Ecological Impact</div>
                    <div class="font-bold">${material.impact}</div>
                </div>
            </div>
        </div>
    `;
    
    modal.classList.remove('hidden');
}

function closeBondModal() {
    const modal = document.getElementById('bond-detail-modal');
    if (modal) modal.classList.add('hidden');
}

document.addEventListener('click', function(e) {
    const modal = document.getElementById('bond-detail-modal');
    if (modal && e.target === modal) closeBondModal();
});

document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeBondModal();
});

window.renderEnvironmentalCards = renderEnvironmentalCards;
window.openBondDetail = openBondDetail;
window.closeBondModal = closeBondModal;

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        renderEnvironmentalCards();
        updateMacroColors();
    });
} else {
    renderEnvironmentalCards();
    updateMacroColors();
}

let pendingCanvasResize = 0;
function scheduleCanvasResize(regenerateParticles = false) {
    if (pendingCanvasResize) window.cancelAnimationFrame(pendingCanvasResize);
    pendingCanvasResize = window.requestAnimationFrame(() => {
        pendingCanvasResize = 0;
        if (typeof resizeCanvas === 'function') {
            const resized = resizeCanvas();
            if (resized && (regenerateParticles || state.particles.length === 0)) {
                if (typeof generateParticles === 'function') generateParticles();
                if (state.isReacted && typeof resolveParticleReactions === 'function') {
                    resolveParticleReactions();
                }
            }
        }
    });
}

window.addEventListener('resize', () => scheduleCanvasResize(false), { passive: true });
window.addEventListener('DOMContentLoaded', () => {
    if (typeof initCanvas === 'function') initCanvas();
    updateMacroColors();
    if (typeof animateParticles === 'function') animateParticles();

    if (typeof ResizeObserver !== 'undefined' && els.submicroView) {
        submicroResizeObserver = new ResizeObserver(() => {
            if (!els.submicroView.classList.contains('hidden')) {
                scheduleCanvasResize(state.particles.length === 0);
            }
        });
        submicroResizeObserver.observe(els.submicroView);
    }
});
