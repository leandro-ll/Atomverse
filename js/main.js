// ==========================================
// MAIN UI & STATE MANAGEMENT (GLOBAL)
// ==========================================

// We use 'var' here so these variables are GLOBAL and can be seen by visualization.js and ai-tutor.js
var state = {
    reagentA: 'AgNO3', reagentB: 'NaCl',
    mA: 1.0, vA: 50, mB: 1.0, vB: 50, temperature: 25,
    isReacted: false, isPouring: false, particles: [], effects: []
};

var els = {
    tabs: document.querySelectorAll('.tab-btn'), tabContents: document.querySelectorAll('.tab-content'),
    selectA: document.getElementById('select-a'), selectB: document.getElementById('select-b'),
    mAVal: document.getElementById('m-a-val'), mASlider: document.getElementById('m-a-slider'),
    vAVal: document.getElementById('v-a-val'), vASlider: document.getElementById('v-a-slider'),
    mBVal: document.getElementById('m-b-val'), mBSlider: document.getElementById('m-b-slider'),
    vBVal: document.getElementById('v-b-val'), vBSlider: document.getElementById('v-b-slider'),
    tempVal: document.getElementById('temp-val'), tempSlider: document.getElementById('temp-slider'),
    status: document.getElementById('sim-status'),
    resColor: document.getElementById('res-color'), resPpt: document.getElementById('res-ppt'),
    resPh: document.getElementById('res-ph'), resEnergy: document.getElementById('res-energy'),
    macroView: document.getElementById('macro-view'), submicroView: document.getElementById('submicro-view'),
    btnMacro: document.getElementById('btn-macro'), btnSubmicro: document.getElementById('btn-submicro'),
    canvas: document.getElementById('submicro-canvas'), legend: document.getElementById('particle-legend'),
    kineticInd: document.getElementById('kinetic-indicator'), chatWindow: document.getElementById('chat-window'),
    chatInput: document.getElementById('chat-input'),
    beakerA: document.getElementById('beaker-a-group'), stream: document.getElementById('liquid-stream'),
    beakerMixed: document.getElementById('beaker-mixed'), 
    liquidMixedBottom: document.getElementById('liquid-mixed-bottom'),
    liquidMixedTop: document.getElementById('liquid-mixed-top'),
    liquidBoundary: document.getElementById('liquid-boundary'),
    pptDots: document.getElementById('precipitate-dots'), 
    liquidA: document.getElementById('liquid-a'),
    liquidB: document.getElementById('liquid-b'), beakerB: document.getElementById('beaker-b'),
    equationContainer: document.getElementById('equation-container'),
    equationText: document.getElementById('equation-text'),
    layerNameTop: document.getElementById('layer-name-top'),
    layerNameBottom: document.getElementById('layer-name-bottom')
};

// --- THEME TOGGLE ---
const themeToggle = document.getElementById('theme-toggle');
const iconSun = document.getElementById('icon-sun');
const iconMoon = document.getElementById('icon-moon');
const html = document.documentElement;

themeToggle.addEventListener('click', () => {
    if (html.getAttribute('data-theme') === 'dark') {
        html.removeAttribute('data-theme');
        iconSun.classList.remove('hidden');
        iconMoon.classList.add('hidden');
    } else {
        html.setAttribute('data-theme', 'dark');
        iconSun.classList.add('hidden');
        iconMoon.classList.remove('hidden');
    }
});

// --- TAB SWITCHING ---
// Di bagian tab switching
els.tabs.forEach(tab => {
    tab.onclick = () => {
        els.tabs.forEach(t => { 
            t.classList.remove('active'); 
            t.classList.add('text-muted-custom'); 
        });
        tab.classList.add('active'); 
        tab.classList.remove('text-muted-custom');
        
        els.tabContents.forEach(c => c.classList.add('hidden'));
        document.getElementById(`tab-${tab.dataset.tab}`).classList.remove('hidden');
        
        // Render environmental cards saat tab environment dibuka
        if (tab.dataset.tab === 'environment') {
            if (typeof renderEnvironmentalCards === 'function') {
                renderEnvironmentalCards();
            }
        }
        
        if (tab.dataset.tab === 'lab') { 
            resizeCanvas(); 
            generateParticles(); 
        }
    };
});

// --- SIMULATION LOGIC ---
function updateMacroColors() {
    els.liquidA.setAttribute('fill', chemicalColors[state.reagentA] || '#e2e8f0');
    els.liquidB.setAttribute('fill', chemicalColors[state.reagentB] || '#e2e8f0');
    els.stream.setAttribute('stroke', chemicalColors[state.reagentA] || '#e2e8f0');
}

function runSimulation() {
    if(state.isPouring || state.isReacted) return;
    state.isPouring = true;
    els.status.textContent = "Status: Menuangkan & Bereaksi...";
    els.status.className = "text-xs font-bold mono animate-pulse";
    els.status.style.color = "var(--secondary)";
    
    els.beakerA.classList.add('pouring');
    els.liquidA.classList.add('draining');
    els.stream.classList.add('flowing');
    els.beakerB.classList.add('fading');
    els.beakerMixed.classList.add('mixed-appear');
    
    state.isReacted = true;
    state.particles.forEach(p => { if(p.side === 'A') p.vx += 8; });

    setTimeout(() => {
        const res = getReactionResult();
        const isNoReaction = (res.ppt === null && res.energy === 'Normal');
        
        if (isNoReaction) {
            els.liquidMixedBottom.setAttribute('fill', chemicalColors[state.reagentB] || '#bae6fd');
            els.liquidMixedTop.setAttribute('fill', chemicalColors[state.reagentA] || '#e9d5ff');
            els.liquidBoundary.setAttribute('opacity', '1');
            
            els.layerNameTop.textContent = chemicalNames[state.reagentA] || state.reagentA;
            els.layerNameBottom.textContent = chemicalNames[state.reagentB] || state.reagentB;
            els.layerNameTop.classList.add('visible');
            els.layerNameBottom.classList.add('visible');
        } else {
            els.liquidMixedBottom.setAttribute('fill', res.color);
            els.liquidMixedTop.setAttribute('fill', res.color);
            els.liquidBoundary.setAttribute('opacity', '0');
            els.layerNameTop.classList.remove('visible');
            els.layerNameBottom.classList.remove('visible');
        }

        els.equationText.textContent = res.equation;
        els.equationContainer.classList.remove('hidden');

        els.pptDots.innerHTML = '';
        if(res.ppt) {
            for(let i=0; i<60; i++) {
                const cx = 30 + Math.random() * 180; const cy = 220 + Math.random() * 30;
                els.pptDots.innerHTML += `<circle cx="${cx}" cy="${cy}" r="${2 + Math.random() * 2.5}" fill="${res.pptColor}" opacity="0.9"/>`;
            }
        }
        
        els.resColor.textContent = isNoReaction ? "Terpisah (2 Lapisan)" : (res.ppt ? "Keruh" : "Bening");
        els.resPpt.textContent = res.ppt || "-"; els.resPpt.style.color = res.pptColor || 'var(--text-main)';
        els.resPh.textContent = res.ph; els.resEnergy.textContent = res.energy;
        
        if(res.energy === 'Eksoterm (Panas)') els.resEnergy.style.color = "var(--danger)";
        else els.resEnergy.style.color = "var(--text-main)";

        els.status.textContent = "Status: Selesai (Kesetimbangan)";
        els.status.className = "text-xs font-bold mono";
        els.status.style.color = "var(--success)";
        state.isPouring = false;
    }, 4000);
}

function resetState() {
    state.isReacted = false; state.isPouring = false;
    els.beakerA.classList.remove('pouring');
    els.liquidA.classList.remove('draining');
    els.stream.classList.remove('flowing');
    els.beakerB.classList.remove('fading');
    els.beakerMixed.classList.remove('mixed-appear');
    els.equationContainer.classList.add('hidden');
    els.layerNameTop.classList.remove('visible');
    els.layerNameBottom.classList.remove('visible');
    void els.beakerA.offsetWidth; 
    els.status.textContent = "Status: Siap"; els.status.className = "text-xs font-bold mono text-muted-custom";
    els.resColor.textContent = "Bening"; els.resPpt.textContent = "-"; els.resPh.textContent = "-";
    els.resEnergy.textContent = "-";
    els.resEnergy.style.color = "var(--text-main)";
    updateMacroColors(); generateParticles();
}

// --- EVENT LISTENERS ---
els.selectA.onchange = (e) => { state.reagentA = e.target.value; resetState(); };
els.selectB.onchange = (e) => { state.reagentB = e.target.value; resetState(); };
els.mASlider.oninput = (e) => { state.mA = e.target.value / 10; els.mAVal.textContent = state.mA.toFixed(1) + ' M'; resetState(); };
els.vASlider.oninput = (e) => { state.vA = parseInt(e.target.value); els.vAVal.textContent = state.vA + ' mL'; resetState(); };
els.mBSlider.oninput = (e) => { state.mB = e.target.value / 10; els.mBVal.textContent = state.mB.toFixed(1) + ' M'; resetState(); };
els.vBSlider.oninput = (e) => { state.vB = parseInt(e.target.value); els.vBVal.textContent = state.vB + ' mL'; resetState(); };
els.tempSlider.oninput = (e) => { state.temperature = parseInt(e.target.value); els.tempVal.textContent = state.temperature + ' °C'; if(state.temperature < 20) els.kineticInd.textContent = "Rendah"; else if(state.temperature < 60) els.kineticInd.textContent = "Sedang"; else els.kineticInd.textContent = "Tinggi"; };

els.btnMacro.onclick = () => { els.macroView.classList.remove('hidden'); els.submicroView.classList.add('hidden'); els.btnMacro.classList.add('active'); els.btnSubmicro.classList.remove('active'); els.btnSubmicro.classList.add('text-muted-custom'); els.btnMacro.classList.remove('text-muted-custom'); };
els.btnSubmicro.onclick = () => { els.submicroView.classList.remove('hidden'); els.macroView.classList.add('hidden'); els.btnSubmicro.classList.add('active'); els.btnMacro.classList.remove('active'); els.btnMacro.classList.add('text-muted-custom'); els.btnSubmicro.classList.remove('text-muted-custom'); resizeCanvas(); };

document.getElementById('btn-run').onclick = runSimulation;
document.getElementById('btn-reset').onclick = resetState;
document.getElementById('btn-send').onclick = handleSend;
els.chatInput.addEventListener('keypress', (e) => { if(e.key === 'Enter') handleSend(); });

// --- INVERSE EXPERIMENT TAB ---
// Inverse Experiment Handler

// Fungsi untuk menampilkan hasil
function displayInverseResult(data, container) {
    container.innerHTML = `
        <div class="space-y-4">
            <div class="flex items-center justify-between">
                <h4 class="font-bold text-lg text-primary">${data.recommended_reaction}</h4>
                <span class="px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700">
                    Confidence: ${data.confidence_score}%
                </span>
            </div>
            
            <div class="p-4 bg-surface-alt rounded-lg">
                <h5 class="font-bold text-sm mb-2">Konfigurasi Optimal:</h5>
                <div class="grid grid-cols-2 gap-3 text-sm">
                    <div>
                        <span class="text-muted-custom">Reaktan A:</span>
                        <div class="font-mono">${data.configuration.reactant_a} ${data.configuration.conc_a}M, ${data.configuration.vol_a}mL</div>
                    </div>
                    <div>
                        <span class="text-muted-custom">Reaktan B:</span>
                        <div class="font-mono">${data.configuration.reactant_b} ${data.configuration.conc_b}M, ${data.configuration.vol_b}mL</div>
                    </div>
                    <div>
                        <span class="text-muted-custom">Suhu:</span>
                        <div class="font-mono">${data.configuration.temp}°C</div>
                    </div>
                    <div>
                        <span class="text-muted-custom">Tekanan:</span>
                        <div class="font-mono">${data.configuration.pressure} atm</div>
                    </div>
                </div>
            </div>
            
            <div class="p-4 bg-primary/10 border border-primary/30 rounded-lg">
                <h5 class="font-bold text-sm mb-2 text-primary">🔮 Prediksi Outcome:</h5>
                <ul class="text-xs space-y-1">
                    <li><b>Warna:</b> ${data.predicted_outcome.color || '-'}</li>
                    <li><b>Endapan:</b> ${data.predicted_outcome.precipitate || '-'}</li>
                    <li><b>pH Akhir:</b> ${data.predicted_outcome.ph_final || '-'}</li>
                </ul>
            </div>
            
            <div class="text-xs text-muted-custom italic">
                ${data.explanation || ''}
            </div>
        </div>
    `;
}

// --- ENVIRONMENTAL LITERACY TAB ---
// ==========================================
// ENVIRONMENTAL LITERACY MODULE
// ==========================================

const environmentalData = [
    {
        id: 'styrofoam',
        name: 'Styrofoam',
        risk: 'Tinggi',
        riskColor: 'bg-red-100 text-red-600',
        chemical: 'Polystyrene — (C₈H₈)ₙ',
        degradation: '>500 tahun',
        stability: 'Sangat stabil',
        impact: 'mikroplastik & pencemaran laut',
        bondDetail: {
            title: 'Struktur Ikatan Polystyrene',
            mainStructure: 'Rantai utama tersusun dari ikatan kovalen tunggal C–C yang kuat, dengan cincin benzena (aromatik) menempel di tiap unit.',
            resonance: 'Resonansi elektron π pada cincin benzena membuat rantai sukar diputus oleh air, mikroba, atau sinar UV biasa.',
            intermolecular: 'Antar-rantai polimer saling terikat lewat gaya van der Waals yang lemah namun sangat banyak jumlahnya.',
            whyStable: 'Ikatan C–C tunggal memiliki energi ikatan sekitar 347 kJ/mol, sangat stabil terhadap hidrolisis dan oksidasi.',
            diagram: '—[CH₂—CH(C₆H₅)]ₙ—'
        }
    },
    {
        id: 'pet',
        name: 'Plastik PET',
        risk: 'Sedang',
        riskColor: 'bg-yellow-100 text-yellow-600',
        chemical: 'Polyethylene terephthalate',
        degradation: '~450 tahun',
        stability: 'Tinggi (ester)',
        impact: 'dapat didaur ulang parsial',
        bondDetail: {
            title: 'Ikatan Ester pada PET',
            mainStructure: 'Rantai polimer terbentuk lewat ikatan ester kovalen (–C(=O)–O–) yang menghubungkan unit etilena glikol dan asam tereftalat.',
            hydrolysis: 'Ikatan ester ini lebih polar dan sedikit lebih mudah diserang air (hidrolisis) dibanding ikatan C–C murni pada styrofoam.',
            recycling: 'PET masih bisa dipecah kembali secara kimiawi untuk didaur ulang (depolimerisasi).',
            whyStable: 'Ikatan ester memiliki energi ikatan sekitar 358 kJ/mol.',
            diagram: '—[O—CH₂—CH₂—O—C(=O)—C₆H₄—C(=O)]—'
        }
    },
    {
        id: 'battery',
        name: 'Baterai Li-ion',
        risk: 'Tinggi',
        riskColor: 'bg-red-100 text-red-600',
        chemical: 'LiCoO₂ / logam berat',
        degradation: 'Tidak terurai alami',
        stability: 'Reaktif jika rusak',
        impact: 'pencemaran tanah & air tanah',
        bondDetail: {
            title: 'Struktur Kristal LiCoO₂',
            mainStructure: 'Litium kobalt oksida (LiCoO₂) memiliki struktur berlayer dengan ion Li⁺ yang dapat berinterkalasi.',
            redox: 'Saat pengisian/pengosongan, terjadi reaksi redoks: LiCoO₂ ⇌ Li₁ₓCoO₂ + xLi⁺ + xe⁻',
            hazard: 'Jika baterai rusak, ion Li⁺ dan Co² dapat terlepas ke lingkungan. Kobalt adalah logam berat beracun.',
            whyReactive: 'Senyawa interkalasi ini dirancang untuk melepaskan ion Li⁺ dengan mudah.',
            diagram: 'Layer: [CoO₂]⁻ — Li⁺ — [CoO₂]⁻'
        }
    },
    {
        id: 'detergent',
        name: 'Deterjen',
        risk: 'Rendah',
        riskColor: 'bg-emerald-100 text-emerald-600',
        chemical: 'Surfaktan alkil sulfonat',
        degradation: 'Biodegradable',
        stability: 'Sedang',
        impact: 'eutrofikasi bila berlebih',
        bondDetail: {
            title: 'Struktur Surfaktan',
            mainStructure: 'Surfaktan alkil sulfonat memiliki struktur amphiphilic: rantai hidrokarbon panjang (hidrofobik) dan gugus sulfonat (–SO₃⁻) yang hidrofilik.',
            biodegradation: 'Rantai alkil dapat dipecah oleh mikroorganisme melalui proses β-oksidasi.',
            eutrophication: 'Fosfat yang sering ditambahkan dapat menyebabkan eutrofikasi (ledakan alga) di perairan.',
            whyBiodegradable: 'Ikatan C–C pada rantai alkil linier lebih mudah diserang enzim mikroba.',
            diagram: 'CH₃—(CH₂)ₙ—SO₃⁻Na⁺'
        }
    },
    {
        id: 'ewaste',
        name: 'Limbah Elektronik',
        risk: 'Sedang',
        riskColor: 'bg-yellow-100 text-yellow-600',
        chemical: 'Campuran logam & polimer',
        degradation: 'Bervariasi',
        stability: 'Kompleks',
        impact: 'perlu daur ulang khusus',
        bondDetail: {
            title: 'Kompleksitas Material E-Waste',
            mainStructure: 'Limbah elektronik mengandung berbagai material: PCB (polimer epoksi), logam mulia (Au, Ag), logam berat (Pb, Cd, Hg).',
            metals: 'Logam-logam terikat dalam berbagai bentuk: ikatan metalik, ikatan ionik, dan kompleks koordinasi.',
            polymers: 'PCB menggunakan resin epoksi dengan ikatan C–O–C (eter) dan cincin aromatik yang sangat stabil.',
            whyComplex: 'Pemisahan material memerlukan proses metalurgi dan kimia yang kompleks.',
            diagram: 'Multi-layer: [Polymer]—[Cu]—[Solder]—[IC]'
        }
    },
    {
        id: 'pla',
        name: 'Polimer Biodegradable',
        risk: 'Rendah',
        riskColor: 'bg-emerald-100 text-emerald-600',
        chemical: 'Polylactic acid (PLA)',
        degradation: '~6 bulan (industri)',
        stability: 'Rendah–sedang',
        impact: 'alternatif ramah lingkungan',
        bondDetail: {
            title: 'Ikatan Ester pada PLA',
            mainStructure: 'PLA adalah poliester alifatik dengan unit berulang asam laktat (–O–CH(CH₃)–C(=O)–).',
            hydrolysis: 'Ikatan ester pada PLA mudah terhidrolisis, terutama pada suhu dan kelembaban tinggi.',
            composting: 'Dalam kondisi kompos industri (58°C), PLA terdegradasi dalam 6 bulan menjadi CO₂ dan H₂O.',
            whyBiodegradable: 'Ikatan ester alifatik lebih mudah diserang air dan enzim dibanding ikatan ester aromatik.',
            diagram: '—[O–CH(CH₃)–C(=O)]ₙ—'
        }
    }
];

// Render kartu-kartu environmental
function renderEnvironmentalCards() {
    const grid = document.getElementById('env-grid');
    if (!grid) {
        console.error('Element env-grid tidak ditemukan!');
        return;
    }
    
    console.log('Rendering environmental cards...');
    grid.innerHTML = environmentalData.map(material => `
        <div class="env-card surface border border-[var(--border-color)] rounded-xl p-6 flex flex-col cursor-pointer hover:shadow-lg transition-all" 
             onclick="openBondDetail('${material.id}')">
            <div class="flex justify-between items-start mb-3">
                <h3 class="text-lg font-bold font-heading">${material.name}</h3>
                <span class="px-2 py-1 rounded text-[10px] font-bold uppercase font-heading ${material.riskColor}">
                    Risiko ${material.risk}
                </span>
            </div>
            <p class="text-xs mono mb-2 font-medium" style="color: var(--primary);">${material.chemical}</p>
            <div class="space-y-1 text-xs text-muted-custom mb-4">
                <div><span class="font-semibold">Waktu urai:</span> ${material.degradation}</div>
                <div><span class="font-semibold">Stabilitas:</span> ${material.stability}</div>
                <div><span class="font-semibold">Dampak:</span> ${material.impact}</div>
            </div>
            <div class="mt-auto pt-4 border-t border-[var(--border-color)]">
                <button class="text-xs font-bold font-heading flex items-center gap-2" style="color: var(--primary);">
                    Tekan untuk lihat detail ikatan
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
                    </svg>
                </button>
            </div>
        </div>
    `).join('');
    console.log('Environmental cards rendered successfully!');
}

// Buka modal detail ikatan
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
                <div class="text-xs text-muted-custom mb-1">Rumus Kimia</div>
                <div class="font-mono font-bold" style="color: var(--primary);">${material.chemical}</div>
            </div>
            
            <div>
                <h4 class="font-bold text-sm mb-2 font-heading" style="color: var(--secondary);">${material.bondDetail.title}</h4>
                <div class="prose prose-sm max-w-none text-sm text-[var(--text-main)] space-y-3">
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
        <div class="p-4 rounded-lg bg-gradient-to-br from-[var(--bg-surface-alt)] to-[var(--bg-surface)] border border-[var(--border-color)]">
        <div class="flex items-center gap-2 mb-3">
            <svg class="w-4 h-4" style="color: var(--primary);" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"></path>
            </svg>
            <div class="text-xs font-bold uppercase tracking-wider" style="color: var(--primary);">Struktur Molekul</div>
        </div>
        <div class="font-mono text-xs sm:text-sm text-center p-4 rounded-lg bg-white dark:bg-slate-800/50 border-2 border-[var(--primary)]/20 shadow-inner overflow-x-auto">
            <code style="color: #ffffff; font-weight: 700; letter-spacing: 0.05em;">${material.bondDetail.diagram}</code>
        </div>
    </div>
` : ''}
            
            <div class="grid grid-cols-2 gap-3 text-xs">
                <div class="p-3 rounded-lg bg-[var(--bg-surface-alt)]">
                    <div class="text-muted-custom mb-1">Waktu Urai</div>
                    <div class="font-bold">${material.degradation}</div>
                </div>
                <div class="p-3 rounded-lg bg-[var(--bg-surface-alt)]">
                    <div class="text-muted-custom mb-1">Dampak Lingkungan</div>
                    <div class="font-bold">${material.impact}</div>
                </div>
            </div>
        </div>
    `;
    
    modal.classList.remove('hidden');
}

// Tutup modal
function closeBondModal() {
    const modal = document.getElementById('bond-detail-modal');
    modal.classList.add('hidden');
}

// Tutup modal dengan klik di luar
document.addEventListener('click', function(e) {
    const modal = document.getElementById('bond-detail-modal');
    if (e.target === modal) {
        closeBondModal();
    }
});

// Tutup modal dengan tombol ESC
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        closeBondModal();
    }
});

// Export functions agar bisa diakses dari HTML
window.renderEnvironmentalCards = renderEnvironmentalCards;
window.openBondDetail = openBondDetail;
window.closeBondModal = closeBondModal;

// Auto-render saat DOM loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderEnvironmentalCards);
} else {
    renderEnvironmentalCards();
}
// --- INITIALIZATION ---
window.addEventListener('resize', () => { resizeCanvas(); generateParticles(); });
resizeCanvas(); 
updateMacroColors(); 
generateParticles(); 
animateParticles();

// ... [Keep all your existing main.js code above this line exactly as it is] ...

// ==========================================
// INITIALIZATION (Put this at the VERY BOTTOM of main.js)
// ==========================================
window.addEventListener('DOMContentLoaded', () => {
    // 1. Initialize canvas context safely AFTER els is defined
    if (typeof initCanvas === 'function') {
        initCanvas();
    }
    
    // 2. Set up resize listener
    window.addEventListener('resize', () => { 
        resizeCanvas(); 
        generateParticles(); 
    });
    
    // 3. Start everything
    resizeCanvas(); 
    updateMacroColors(); 
    generateParticles(); 
    animateParticles();
});

// ==========================================
// RESIZABLE RIGHT PANEL LOGIC
// ==========================================
const resizeHandle = document.getElementById('resize-handle');
const rightPanel = document.getElementById('right-panel');
let isResizing = false;

resizeHandle.addEventListener('mousedown', (e) => {
    isResizing = true;
    resizeHandle.classList.add('bg-[var(--primary)]'); // Highlight handle
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none'; // Prevent text selection while dragging
});

document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    
    // Calculate new width based on mouse position
    const containerRect = document.querySelector('main').getBoundingClientRect();
    const newWidth = containerRect.right - e.clientX;
    
    // Enforce min/max constraints (280px to 600px)
    if (newWidth >= 280 && newWidth <= 600) {
        rightPanel.style.width = newWidth + 'px';
    }
});

document.addEventListener('mouseup', () => {
    if (isResizing) {
        isResizing = false;
        resizeHandle.classList.remove('bg-[var(--primary)]');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        
        // Optional: Re-render canvas if the window layout shifted significantly
        if (typeof resizeCanvas === 'function') {
            resizeCanvas();
        }
    }
});

