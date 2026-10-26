// ==========================================
// CHEMISTRY DATA & LOGIC (EXTENDED & PRECISE)
// ==========================================

const chemicalColors = {
    'AgNO3': '#bae6fd', 'Pb(NO3)2': '#fef08a', 'BaCl2': '#bbf7d0',
    'NaCl': '#f1f5f9', 'KI': '#fde68a', 'Na2SO4': '#e9d5ff',
    'HCl': '#fecaca', 'NaOH': '#a7f3d0',
    'CH3COOH': '#fed7aa', 'NaHCO3': '#e0f2fe', 'Na2CO3': '#dcfce7',
    'CaCl2': '#e0e7ff', 'Ca(OH)2': '#fef9c3', 'NH3': '#ede9fe'
};

const chemicalNames = {
    'AgNO3': 'AgNO₃ (Silver Nitrate)',
    'Pb(NO3)2': 'Pb(NO₃)₂ (Lead(II) Nitrate)',
    'BaCl2': 'BaCl₂ (Barium Chloride)',
    'NaCl': 'NaCl (Sodium Chloride)',
    'KI': 'KI (Potassium Iodide)',
    'Na2SO4': 'Na₂SO₄ (Sodium Sulfate)',
    'HCl': 'HCl (Hydrochloric Acid)',
    'NaOH': 'NaOH (Sodium Hydroxide)',
    'CH3COOH': 'CH₃COOH (Acetic Acid)',
    'NaHCO3': 'NaHCO₃ (Sodium Bicarbonate / Baking Soda)',
    'Na2CO3': 'Na₂CO₃ (Sodium Carbonate)',
    'CaCl2': 'CaCl₂ (Calcium Chloride)',
    'Ca(OH)2': 'Ca(OH)₂ (Limewater / Calcium Hydroxide)',
    'NH3': 'NH₃ (Aqueous Ammonia)'
};

const reagentIons = {
    'AgNO3': [{t:'Ag⁺', c:'#94a3b8'}, {t:'NO₃⁻', c:'#f97316'}],
    'Pb(NO3)2': [{t:'Pb²⁺', c:'#64748b'}, {t:'NO₃⁻', c:'#f97316'}],
    'BaCl2': [{t:'Ba²⁺', c:'#84cc16'}, {t:'Cl⁻', c:'#22c55e'}],
    'NaCl': [{t:'Na⁺', c:'#3b82f6'}, {t:'Cl⁻', c:'#22c55e'}],
    'KI': [{t:'K⁺', c:'#a855f7'}, {t:'I⁻', c:'#eab308'}],
    'Na2SO4': [{t:'Na⁺', c:'#3b82f6'}, {t:'SO₄²⁻', c:'#ec4899'}],
    'HCl': [{t:'H⁺', c:'#ef4444'}, {t:'Cl⁻', c:'#22c55e'}],
    'NaOH': [{t:'Na⁺', c:'#3b82f6'}, {t:'OH⁻', c:'#facc15'}],
    'CH3COOH': [{t:'H⁺', c:'#ef4444'}, {t:'CH₃COO⁻', c:'#06b6d4'}],
    'NaHCO3': [{t:'Na⁺', c:'#3b82f6'}, {t:'HCO₃⁻', c:'#10b981'}],
    'Na2CO3': [{t:'Na⁺', c:'#3b82f6'}, {t:'CO₃²⁻', c:'#a3e635'}],
    'CaCl2': [{t:'Ca²⁺', c:'#0284c7'}, {t:'Cl⁻', c:'#22c55e'}],
    'Ca(OH)2': [{t:'Ca²⁺', c:'#0284c7'}, {t:'OH⁻', c:'#facc15'}],
    'NH3': [{t:'NH₄⁺', c:'#6366f1'}, {t:'OH⁻', c:'#facc15'}]
};

const reactionRules = [
    // Precipitation
    { cation: 'Ag⁺', anion: 'Cl⁻', ppt: 'AgCl', color: '#ffffff', name: 'Silver Chloride (AgCl)' },
    { cation: 'Ag⁺', anion: 'I⁻', ppt: 'AgI', color: '#facc15', name: 'Silver Iodide (AgI)' },
    { cation: 'Pb²⁺', anion: 'Cl⁻', ppt: 'PbCl2', color: '#ffffff', name: 'Lead(II) Chloride (PbCl₂)' },
    { cation: 'Pb²⁺', anion: 'I⁻', ppt: 'PbI2', color: '#eab308', name: 'Lead(II) Iodide (PbI₂)' },
    { cation: 'Ba²⁺', anion: 'SO₄²⁻', ppt: 'BaSO4', color: '#ffffff', name: 'Barium Sulfate (BaSO₄)' },
    { cation: 'Ca²⁺', anion: 'CO₃²⁻', ppt: 'CaCO3', color: '#f8fafc', name: 'Calcium Carbonate (CaCO₃ Chalk)' },
    { cation: 'Ba²⁺', anion: 'CO₃²⁻', ppt: 'BaCO3', color: '#ffffff', name: 'Barium Carbonate (BaCO₃)' },
    { cation: 'Pb²⁺', anion: 'CO₃²⁻', ppt: 'PbCO3', color: '#ffffff', name: 'Lead(II) Carbonate (PbCO₃)' },

    // Gas Evolution (Effervescence / Bubbles)
    { cation: 'H⁺', anion: 'HCO₃⁻', gas: 'CO2', gasName: 'Carbon Dioxide Gas (CO₂↑)', color: '#38bdf8' },
    { cation: 'H⁺', anion: 'CO₃²⁻', gas: 'CO2', gasName: 'Carbon Dioxide Gas (CO₂↑)', color: '#38bdf8' },
    { cation: 'NH₄⁺', anion: 'OH⁻', gas: 'NH3', gasName: 'Ammonia Gas (NH₃↑)', color: '#a78bfa' },

    // Neutralization
    { cation: 'H⁺', anion: 'OH⁻', ppt: 'H2O', color: 'spark', name: 'Water (Exothermic)' }
];

const reactionEquations = {
    'AgNO3-NaCl': 'AgNO₃(aq) + NaCl(aq) → AgCl(s)↓ + NaNO₃(aq)',
    'NaCl-AgNO3': 'AgNO₃(aq) + NaCl(aq) → AgCl(s)↓ + NaNO₃(aq)',
    'AgNO3-KI': 'AgNO₃(aq) + KI(aq) → AgI(s)↓ + KNO₃(aq)',
    'KI-AgNO3': 'AgNO₃(aq) + KI(aq) → AgI(s)↓ + KNO₃(aq)',
    'Pb(NO3)2-NaCl': 'Pb(NO₃)₂(aq) + 2NaCl(aq) → PbCl₂(s)↓ + 2NaNO₃(aq)',
    'NaCl-Pb(NO3)2': 'Pb(NO₃)₂(aq) + 2NaCl(aq) → PbCl₂(s)↓ + 2NaNO₃(aq)',
    'Pb(NO3)2-KI': 'Pb(NO₃)₂(aq) + 2KI(aq) → PbI₂(s)↓ + 2KNO₃(aq)',
    'KI-Pb(NO3)2': 'Pb(NO₃)₂(aq) + 2KI(aq) → PbI₂(s)↓ + 2KNO₃(aq)',
    'BaCl2-Na2SO4': 'BaCl₂(aq) + Na₂SO₄(aq) → BaSO₄(s)↓ + 2NaCl(aq)',
    'Na2SO4-BaCl2': 'BaCl₂(aq) + Na₂SO₄(aq) → BaSO₄(s)↓ + 2NaCl(aq)',
    'HCl-NaOH': 'HCl(aq) + NaOH(aq) → NaCl(aq) + H₂O(l) + Energy',
    'NaOH-HCl': 'HCl(aq) + NaOH(aq) → NaCl(aq) + H₂O(l) + Energy',

    // Everyday Chemistry & Gas Evolution
    'NaHCO3-HCl': 'NaHCO₃(aq) + HCl(aq) → NaCl(aq) + H₂O(l) + CO₂(g)↑',
    'HCl-NaHCO3': 'HCl(aq) + NaHCO₃(aq) → NaCl(aq) + H₂O(l) + CO₂(g)↑',
    'CH3COOH-NaHCO3': 'CH₃COOH(aq) + NaHCO₃(aq) → CH₃COONa(aq) + H₂O(l) + CO₂(g)↑',
    'NaHCO3-CH3COOH': 'CH₃COOH(aq) + NaHCO₃(aq) → CH₃COONa(aq) + H₂O(l) + CO₂(g)↑',
    'Na2CO3-HCl': 'Na₂CO₃(aq) + 2HCl(aq) → 2NaCl(aq) + H₂O(l) + CO₂(g)↑',
    'HCl-Na2CO3': '2HCl(aq) + Na₂CO₃(aq) → 2NaCl(aq) + H₂O(l) + CO₂(g)↑',
    'CaCl2-Na2CO3': 'CaCl₂(aq) + Na₂CO₃(aq) → CaCO₃(s)↓ + 2NaCl(aq)',
    'Na2CO3-CaCl2': 'CaCl₂(aq) + Na₂CO₃(aq) → CaCO₃(s)↓ + 2NaCl(aq)',
    'Ca(OH)2-Na2CO3': 'Ca(OH)₂(aq) + Na₂CO₃(aq) → CaCO₃(s)↓ + 2NaOH(aq)',
    'Na2CO3-Ca(OH)2': 'Ca(OH)₂(aq) + Na₂CO₃(aq) → CaCO₃(s)↓ + 2NaOH(aq)',
    'CH3COOH-NaOH': 'CH₃COOH(aq) + NaOH(aq) → CH₃COONa(aq) + H₂O(l)',
    'NaOH-CH3COOH': 'CH₃COOH(aq) + NaOH(aq) → CH₃COONa(aq) + H₂O(l)',
    'HCl-NH3': 'HCl(aq) + NH₃(aq) → NH₄Cl(aq) + Energy',
    'NH3-HCl': 'HCl(aq) + NH₃(aq) → NH₄Cl(aq) + Energy'
};

// Core Logic: Calculates what happens based on global 'state'
function getReactionResult() {
    const ionsA = reagentIons[state.reagentA] || []; 
    const ionsB = reagentIons[state.reagentB] || [];
    
    let result = { 
        color: '#f8fafc', 
        ppt: null, 
        pptColor: null, 
        gas: null,
        gasColor: null,
        hasGas: false,
        ph: '~7.0', 
        energy: 'Normal', 
        equation: 'No chemical reaction observed.' 
    };
    
    const eqKey = `${state.reagentA}-${state.reagentB}`;
    if (reactionEquations[eqKey]) {
        result.equation = reactionEquations[eqKey];
    }

    for (let iA of ionsA) {
        for (let iB of ionsB) {
            let rule = reactionRules.find(r => 
                (r.cation === iA.t && r.anion === iB.t) || 
                (r.cation === iB.t && r.anion === iA.t)
            );
            if (rule) {
                if (rule.gas) {
                    result.gas = rule.gasName;
                    result.gasColor = rule.color;
                    result.hasGas = true;
                    result.energy = 'Gas Evolution';
                    result.ph = '~6.5 (Carbonic Acid)';
                } else if (rule.ppt === 'H2O') { 
                    result.ph = '7.0 (Neutral)'; 
                    result.energy = 'Exothermic (Warm)'; 
                } else { 
                    result.ppt = rule.name; 
                    result.pptColor = rule.color; 
                    result.color = rule.color === '#ffffff' ? '#f1f5f9' : rule.color; 
                }
            }
        }
    }
    return result;
}