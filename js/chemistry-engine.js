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
    'NaCl-AgNO3': 'AgNO₃(aq) + NaCl(aq) → AgCl(s) + NaNO₃(aq)',
    'AgNO3-KI': 'AgNO₃(aq) + KI(aq) → AgI(s) + KNO₃(aq)',
    'KI-AgNO3': 'AgNO₃(aq) + KI(aq) → AgI(s) + KNO₃(aq)',
    'Pb(NO3)2-NaCl': 'Pb(NO₃)₂(aq) + 2NaCl(aq) → PbCl₂(s) + 2NaNO₃(aq)',
    'NaCl-Pb(NO3)2': 'Pb(NO₃)₂(aq) + 2NaCl(aq) → PbCl₂(s) + 2NaNO₃(aq)',
    'Pb(NO3)2-KI': 'Pb(NO₃)₂(aq) + 2KI(aq) → PbI₂(s) + 2KNO₃(aq)',
    'KI-Pb(NO3)2': 'Pb(NO₃)₂(aq) + 2KI(aq) → PbI₂(s) + 2KNO₃(aq)',
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

// Calculate product concentrations based on stoichiometry
function calculateProductConcentrations() {
    // Volume total campuran (mL)
    const totalVolume = state.vA + state.vB;
    
    // Hitung mol awal reaktan
    const molA = state.mA * (state.vA / 1000); // konversi mL ke L
    const molB = state.mB * (state.vB / 1000);
    
    // Tentukan reaksi yang terjadi
    const ionsA = reagentIons[state.reagentA];
    const ionsB = reagentIons[state.reagentB];
    
    let products = {};
    let limitingReagent = null;
    let reactionOccurred = false;
    
    // Cek apakah ada reaksi
    for(let iA of ionsA) {
        for(let iB of ionsB) {
            let rule = reactionRules.find(r => (r.cation === iA.t && r.anion === iB.t) || (r.cation === iB.t && r.anion === iA.t));
            if(rule) {
                reactionOccurred = true;
                
                if(rule.ppt === 'H2O') {
                    // Reaksi netralisasi HCl + NaOH -> NaCl + H2O
                    // Rasio 1:1
                    let molProduct = Math.min(molA, molB);
                    limitingReagent = molA < molB ? state.reagentA : state.reagentB;
                    
                    // Hitung konsentrasi produk (NaCl atau garam lainnya)
                    let spectatorIon1, spectatorIon2;
                    
                    // Tentukan ion spektator berdasarkan reaktan
                    if(state.reagentA === 'HCl') {
                        spectatorIon1 = 'Cl-';
                        spectatorIon2 = 'Na+';
                    } else if(state.reagentA === 'NaOH') {
                        spectatorIon1 = 'Na+';
                        spectatorIon2 = 'Cl-';
                    }
                    
                    products['H2O'] = {
                        name: 'H2O',
                        concentration: molProduct / (totalVolume / 1000),
                        type: 'liquid'
                    };
                    
                    // Produk garam (misal NaCl)
                    const saltName = 'NaCl';
                    products[saltName] = {
                        name: 'NaCl (aq)',
                        concentration: molProduct / (totalVolume / 1000),
                        type: 'aqueous'
                    };
                    
                } else {
                    // Reaksi pengendapan: AgNO3 + NaCl -> AgCl(s) + NaNO3(aq)
                    // Rasio 1:1 untuk kebanyakan reaksi kita
                    
                    // Tentukan pereaksi pembatas
                    limitingReagent = molA < molB ? state.reagentA : state.reagentB;
                    const excessReagent = molA < molB ? state.reagentB : state.reagentA;
                    
                    // Mol endapan yang terbentuk = mol pereaksi pembatas
                    const molPrecipitate = Math.min(molA, molB);
                    
                    // Nama endapan
                    const pptFormula = rule.ppt;
                    products[pptFormula] = {
                        name: rule.name + ' (s)',
                        concentration: molPrecipitate / (totalVolume / 1000),
                        type: 'precipitate'
                    };
                    
                    // Hitung garam terlarut (produk sampingan)
                    // Misal: AgNO3 + NaCl -> AgCl(s) + NaNO3(aq)
                    // Ion spektator membentuk garam terlarut
                    let saltFormula, saltName;
                    
                    if(state.reagentA === 'AgNO3' && state.reagentB === 'NaCl') {
                        saltFormula = 'NaNO3';
                        saltName = 'NaNO3';
                    } else if(state.reagentA === 'NaCl' && state.reagentB === 'AgNO3') {
                        saltFormula = 'NaNO3';
                        saltName = 'NaNO3';
                    } else if(state.reagentA === 'Pb(NO3)2' && state.reagentB === 'KI') {
                        saltFormula = 'KNO3';
                        saltName = 'KNO3';
                    } else if(state.reagentA === 'KI' && state.reagentB === 'Pb(NO3)2') {
                        saltFormula = 'KNO3';
                        saltName = 'KNO3';
                    } else if(state.reagentA === 'BaCl2' && state.reagentB === 'Na2SO4') {
                        saltFormula = 'NaCl';
                        saltName = 'NaCl';
                    } else if(state.reagentA === 'Na2SO4' && state.reagentB === 'BaCl2') {
                        saltFormula = 'NaCl';
                        saltName = 'NaCl';
                    } else if(state.reagentA === 'AgNO3' && state.reagentB === 'KI') {
                        saltFormula = 'KNO3';
                        saltName = 'KNO3';
                    } else if(state.reagentA === 'KI' && state.reagentB === 'AgNO3') {
                        saltFormula = 'KNO3';
                        saltName = 'KNO3';
                    } else if(state.reagentA === 'Pb(NO3)2' && state.reagentB === 'NaCl') {
                        saltFormula = 'NaNO3';
                        saltName = 'NaNO3';
                    } else if(state.reagentA === 'NaCl' && state.reagentB === 'Pb(NO3)2') {
                        saltFormula = 'NaNO3';
                        saltName = 'NaNO3';
                    }
                    
                    if(saltFormula) {
                        products[saltFormula] = {
                            name: saltName + ' (aq)',
                            concentration: molPrecipitate / (totalVolume / 1000),
                            type: 'aqueous'
                        };
                    }
                    
                    // Hitung sisa pereaksi berlebih
                    const excessMol = Math.abs(molA - molB);
                    if(excessMol > 0) {
                        products[excessReagent] = {
                            name: chemicalNames[excessReagent] + ' (sisa)',
                            concentration: excessMol / (totalVolume / 1000),
                            type: 'excess'
                        };
                    }
                }
            }
        }
    }
    
    // Jika tidak ada reaksi, tampilkan konsentrasi ion awal setelah pencampuran
    if(!reactionOccurred) {
        // Pengenceran saja
        const concA_diluted = (state.mA * state.vA) / totalVolume;
        const concB_diluted = (state.mB * state.vB) / totalVolume;
        
        products[state.reagentA] = {
            name: chemicalNames[state.reagentA] + ' (terlarut)',
            concentration: concA_diluted,
            type: 'diluted'
        };
        
        products[state.reagentB] = {
            name: chemicalNames[state.reagentB] + ' (terlarut)',
            concentration: concB_diluted,
            type: 'diluted'
        };
    }
    
    return products;
}
