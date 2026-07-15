// ==========================================
// CHEMISTRY DATA & LOGIC
// ==========================================

const chemicalColors = {
    'AgNO3': '#bae6fd', 'Pb(NO3)2': '#fef08a', 'BaCl2': '#bbf7d0',
    'NaCl': '#f1f5f9', 'KI': '#fde68a', 'Na2SO4': '#e9d5ff',
    'HCl': '#fecaca', 'NaOH': '#a7f3d0'
};

const chemicalNames = {
    'AgNO3': 'AgNO₃', 'Pb(NO3)2': 'Pb(NO₃)₂', 'BaCl2': 'BaCl₂',
    'NaCl': 'NaCl', 'KI': 'KI', 'Na2SO4': 'Na₂SO₄',
    'HCl': 'HCl', 'NaOH': 'NaOH'
};

const reagentIons = {
    'AgNO3': [{t:'Ag⁺', c:'#94a3b8'}, {t:'NO₃⁻', c:'#f97316'}],
    'Pb(NO3)2': [{t:'Pb²⁺', c:'#64748b'}, {t:'NO₃⁻', c:'#f97316'}],
    'BaCl2': [{t:'Ba²⁺', c:'#84cc16'}, {t:'Cl⁻', c:'#22c55e'}],
    'NaCl': [{t:'Na⁺', c:'#3b82f6'}, {t:'Cl⁻', c:'#22c55e'}],
    'KI': [{t:'K⁺', c:'#a855f7'}, {t:'I⁻', c:'#eab308'}],
    'Na2SO4': [{t:'Na⁺', c:'#3b82f6'}, {t:'SO₄²⁻', c:'#ec4899'}],
    'HCl': [{t:'H⁺', c:'#ef4444'}, {t:'Cl⁻', c:'#22c55e'}],
    'NaOH': [{t:'Na⁺', c:'#3b82f6'}, {t:'OH⁻', c:'#facc15'}]
};

const reactionRules = [
    { cation: 'Ag⁺', anion: 'Cl⁻', ppt: 'AgCl', color: '#ffffff', name: 'Perak Klorida' },
    { cation: 'Ag⁺', anion: 'I⁻', ppt: 'AgI', color: '#facc15', name: 'Perak Iodida' },
    { cation: 'Pb²⁺', anion: 'Cl⁻', ppt: 'PbCl2', color: '#ffffff', name: 'Timbal(II) Klorida' },
    { cation: 'Pb²⁺', anion: 'I⁻', ppt: 'PbI2', color: '#eab308', name: 'Timbal(II) Iodida' },
    { cation: 'Ba²⁺', anion: 'SO₄²⁻', ppt: 'BaSO4', color: '#ffffff', name: 'Barium Sulfat' },
    { cation: 'H⁺', anion: 'OH⁻', ppt: 'H2O', color: 'spark', name: 'Air (Eksoterm)' }
];

const reactionEquations = {
    'AgNO3-NaCl': 'AgNO₃(aq) + NaCl(aq) → AgCl(s) + NaNO₃(aq)',
    'NaCl-AgNO3': 'AgNO(aq) + NaCl(aq) → AgCl(s) + NaNO₃(aq)',
    'AgNO3-KI': 'AgNO(aq) + KI(aq) → AgI(s) + KNO₃(aq)',
    'KI-AgNO3': 'AgNO₃(aq) + KI(aq) → AgI(s) + KNO₃(aq)',
    'Pb(NO3)2-NaCl': 'Pb(NO₃)₂(aq) + 2NaCl(aq) → PbCl₂(s) + 2NaNO₃(aq)',
    'NaCl-Pb(NO3)2': 'Pb(NO₃)₂(aq) + 2NaCl(aq) → PbCl₂(s) + 2NaNO₃(aq)',
    'Pb(NO3)2-KI': 'Pb(NO₃)₂(aq) + 2KI(aq) → PbI₂(s) + 2KNO₃(aq)',
    'KI-Pb(NO3)2': 'Pb(NO)₂(aq) + 2KI(aq) → PbI₂(s) + 2KNO₃(aq)',
    'BaCl2-Na2SO4': 'BaCl₂(aq) + Na₂SO₄(aq) → BaSO₄(s) + 2NaCl(aq)',
    'Na2SO4-BaCl2': 'BaCl₂(aq) + Na₂SO₄(aq) → BaSO₄(s) + 2NaCl(aq)',
    'HCl-NaOH': 'HCl(aq) + NaOH(aq) → NaCl(aq) + H₂O(l) + Energi',
    'NaOH-HCl': 'HCl(aq) + NaOH(aq) → NaCl(aq) + H₂O(l) + Energi'
};

// Core Logic: Calculates what happens based on global 'state'
function getReactionResult() {
    const ionsA = reagentIons[state.reagentA]; 
    const ionsB = reagentIons[state.reagentB];
    
    let result = { 
        color: '#e2e8f0', 
        ppt: null, 
        pptColor: null, 
        ph: '~7.0', 
        energy: 'Normal', 
        equation: 'Tidak terjadi reaksi kimia.' 
    };
    
    const eqKey = `${state.reagentA}-${state.reagentB}`;
    if (reactionEquations[eqKey]) {
        result.equation = reactionEquations[eqKey];
    }

    for(let iA of ionsA) {
        for(let iB of ionsB) {
            let rule = reactionRules.find(r => (r.cation === iA.t && r.anion === iB.t) || (r.cation === iB.t && r.anion === iA.t));
            if(rule) {
                if(rule.ppt === 'H2O') { 
                    result.ph = '7.0 (Netral)'; 
                    result.energy = 'Eksoterm (Panas)'; 
                } else { 
                    result.ppt = rule.name; 
                    result.pptColor = rule.color; 
                    result.color = '#f8fafc'; 
                }
            }
        }
    }
    return result;
}