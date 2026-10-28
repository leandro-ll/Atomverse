// ==========================================
// REACTION LAB DATABASE (INVERSE EXPERIMENT ALLOW-LIST)
// ==========================================
// Mirrors backend/app/services/lab_reactions.py (same IDs and reagent pairs).
// Every entry can be reproduced with the 14 reagents in the Reaction Lab dropdowns.
// The Inverse Experiment UI will only ever show reactions listed here.

(function () {
    'use strict';

    const LAB_REAGENTS = {
        'AgNO3': { name: 'Silver Nitrate', aliases: ['agno3', 'silver nitrate', 'perak nitrat'] },
        'Pb(NO3)2': { name: 'Lead(II) Nitrate', aliases: ['pb(no3)2', 'pbno32', 'lead nitrate', 'lead(ii) nitrate', 'timbal nitrat', 'timbal(ii) nitrat'] },
        'BaCl2': { name: 'Barium Chloride', aliases: ['bacl2', 'barium chloride', 'barium klorida'] },
        'CaCl2': { name: 'Calcium Chloride', aliases: ['cacl2', 'calcium chloride', 'kalsium klorida'] },
        'NaCl': { name: 'Sodium Chloride', aliases: ['nacl', 'sodium chloride', 'natrium klorida', 'table salt', 'garam dapur'] },
        'KI': { name: 'Potassium Iodide', aliases: ['ki', 'potassium iodide', 'kalium iodida'] },
        'Na2SO4': { name: 'Sodium Sulfate', aliases: ['na2so4', 'sodium sulfate', 'sodium sulphate', 'natrium sulfat'] },
        'Na2CO3': { name: 'Sodium Carbonate', aliases: ['na2co3', 'sodium carbonate', 'washing soda', 'natrium karbonat', 'soda abu'] },
        'HCl': { name: 'Hydrochloric Acid', aliases: ['hcl', 'hydrochloric acid', 'asam klorida'] },
        'CH3COOH': { name: 'Acetic Acid', aliases: ['ch3cooh', 'acetic acid', 'vinegar', 'asam asetat', 'asam cuka', 'cuka'] },
        'NaOH': { name: 'Sodium Hydroxide', aliases: ['naoh', 'sodium hydroxide', 'natrium hidroksida', 'soda api', 'lye'] },
        'NaHCO3': { name: 'Sodium Bicarbonate', aliases: ['nahco3', 'baking soda', 'sodium bicarbonate', 'sodium hydrogen carbonate', 'soda kue', 'natrium bikarbonat'] },
        'Ca(OH)2': { name: 'Calcium Hydroxide', aliases: ['ca(oh)2', 'caoh2', 'limewater', 'lime water', 'calcium hydroxide', 'air kapur', 'kalsium hidroksida'] },
        'NH3': { name: 'Aqueous Ammonia', aliases: ['nh3', 'ammonia', 'amonia', 'ammonium hydroxide', 'nh4oh'] }
    };

    const PRODUCTS = {
        'AgCl': { name: 'Silver Chloride', color: 'white', keywords: ['agcl', 'silver chloride', 'perak klorida'] },
        'AgI': { name: 'Silver Iodide', color: 'yellow', keywords: ['agi', 'silver iodide', 'perak iodida'] },
        'PbI2': { name: 'Lead(II) Iodide', color: 'yellow', keywords: ['pbi2', 'lead iodide', 'lead(ii) iodide', 'timbal iodida', 'timbal(ii) iodida', 'golden rain', 'hujan emas'] },
        'PbCl2': { name: 'Lead(II) Chloride', color: 'white', keywords: ['pbcl2', 'lead chloride', 'lead(ii) chloride', 'timbal klorida'] },
        'PbCO3': { name: 'Lead(II) Carbonate', color: 'white', keywords: ['pbco3', 'lead carbonate', 'lead(ii) carbonate', 'timbal karbonat'] },
        'BaSO4': { name: 'Barium Sulfate', color: 'white', keywords: ['baso4', 'barium sulfate', 'barium sulphate', 'barium sulfat'] },
        'BaCO3': { name: 'Barium Carbonate', color: 'white', keywords: ['baco3', 'barium carbonate', 'barium karbonat'] },
        'CaCO3': { name: 'Calcium Carbonate', color: 'white', keywords: ['caco3', 'calcium carbonate', 'kalsium karbonat', 'chalk', 'kapur tulis', 'limestone', 'batu kapur'] },
        'CO2': { name: 'Carbon Dioxide', color: 'colorless', keywords: ['co2', 'carbon dioxide', 'karbon dioksida', 'karbondioksida'] },
        'NH3': { name: 'Ammonia Gas', color: 'colorless', keywords: ['ammonia gas', 'gas amonia', 'gas ammonia', 'nh3 gas', 'gas nh3', 'bau amonia', 'ammonia smell'] },
        'H2O': { name: 'Water (Neutralization)', color: 'colorless', keywords: ['h2o', 'salt and water', 'garam dan air'] }
    };

    // [id, type, reactantA, reactantB, product, equation, concA, concB, priority]
    const RAW_REACTIONS = [
        ['agcl_nacl', 'precipitate', 'AgNO3', 'NaCl', 'AgCl', 'AgNO₃(aq) + NaCl(aq) → AgCl(s)↓ + NaNO₃(aq)', 1.0, 1.0, 10],
        ['agcl_bacl2', 'precipitate', 'AgNO3', 'BaCl2', 'AgCl', '2AgNO₃(aq) + BaCl₂(aq) → 2AgCl(s)↓ + Ba(NO₃)₂(aq)', 2.0, 1.0, 3],
        ['agcl_cacl2', 'precipitate', 'AgNO3', 'CaCl2', 'AgCl', '2AgNO₃(aq) + CaCl₂(aq) → 2AgCl(s)↓ + Ca(NO₃)₂(aq)', 2.0, 1.0, 3],
        ['agcl_hcl', 'precipitate', 'AgNO3', 'HCl', 'AgCl', 'AgNO₃(aq) + HCl(aq) → AgCl(s)↓ + HNO₃(aq)', 1.0, 1.0, 4],
        ['agi_ki', 'precipitate', 'AgNO3', 'KI', 'AgI', 'AgNO₃(aq) + KI(aq) → AgI(s)↓ + KNO₃(aq)', 1.0, 1.0, 6],
        ['pbi2_ki', 'precipitate', 'Pb(NO3)2', 'KI', 'PbI2', 'Pb(NO₃)₂(aq) + 2KI(aq) → PbI₂(s)↓ + 2KNO₃(aq)', 1.0, 2.0, 9],
        ['pbcl2_nacl', 'precipitate', 'Pb(NO3)2', 'NaCl', 'PbCl2', 'Pb(NO₃)₂(aq) + 2NaCl(aq) → PbCl₂(s)↓ + 2NaNO₃(aq)', 1.0, 2.0, 5],
        ['pbcl2_bacl2', 'precipitate', 'Pb(NO3)2', 'BaCl2', 'PbCl2', 'Pb(NO₃)₂(aq) + BaCl₂(aq) → PbCl₂(s)↓ + Ba(NO₃)₂(aq)', 1.0, 1.0, 2],
        ['pbcl2_cacl2', 'precipitate', 'Pb(NO3)2', 'CaCl2', 'PbCl2', 'Pb(NO₃)₂(aq) + CaCl₂(aq) → PbCl₂(s)↓ + Ca(NO₃)₂(aq)', 1.0, 1.0, 2],
        ['pbcl2_hcl', 'precipitate', 'Pb(NO3)2', 'HCl', 'PbCl2', 'Pb(NO₃)₂(aq) + 2HCl(aq) → PbCl₂(s)↓ + 2HNO₃(aq)', 1.0, 2.0, 2],
        ['pbco3_na2co3', 'precipitate', 'Pb(NO3)2', 'Na2CO3', 'PbCO3', 'Pb(NO₃)₂(aq) + Na₂CO₃(aq) → PbCO₃(s)↓ + 2NaNO₃(aq)', 1.0, 1.0, 4],
        ['baso4_na2so4', 'precipitate', 'BaCl2', 'Na2SO4', 'BaSO4', 'BaCl₂(aq) + Na₂SO₄(aq) → BaSO₄(s)↓ + 2NaCl(aq)', 1.0, 1.0, 7],
        ['baco3_na2co3', 'precipitate', 'BaCl2', 'Na2CO3', 'BaCO3', 'BaCl₂(aq) + Na₂CO₃(aq) → BaCO₃(s)↓ + 2NaCl(aq)', 1.0, 1.0, 4],
        ['caco3_cacl2', 'precipitate', 'CaCl2', 'Na2CO3', 'CaCO3', 'CaCl₂(aq) + Na₂CO₃(aq) → CaCO₃(s)↓ + 2NaCl(aq)', 1.0, 1.0, 8],
        ['caco3_caoh2', 'precipitate', 'Ca(OH)2', 'Na2CO3', 'CaCO3', 'Ca(OH)₂(aq) + Na₂CO₃(aq) → CaCO₃(s)↓ + 2NaOH(aq)', 1.0, 1.0, 6],
        ['co2_hcl_nahco3', 'gas', 'NaHCO3', 'HCl', 'CO2', 'NaHCO₃(aq) + HCl(aq) → NaCl(aq) + H₂O(l) + CO₂(g)↑', 1.0, 1.0, 10],
        ['co2_ch3cooh_nahco3', 'gas', 'CH3COOH', 'NaHCO3', 'CO2', 'CH₃COOH(aq) + NaHCO₃(aq) → CH₃COONa(aq) + H₂O(l) + CO₂(g)↑', 1.0, 1.0, 9],
        ['co2_hcl_na2co3', 'gas', 'Na2CO3', 'HCl', 'CO2', 'Na₂CO₃(aq) + 2HCl(aq) → 2NaCl(aq) + H₂O(l) + CO₂(g)↑', 1.0, 2.0, 6],
        ['co2_ch3cooh_na2co3', 'gas', 'CH3COOH', 'Na2CO3', 'CO2', '2CH₃COOH(aq) + Na₂CO₃(aq) → 2CH₃COONa(aq) + H₂O(l) + CO₂(g)↑', 2.0, 1.0, 5],
        ['nh3_naoh', 'gas', 'NH3', 'NaOH', 'NH3', 'NH₄⁺(aq) + OH⁻(aq) → NH₃(g)↑ + H₂O(l)', 1.0, 1.0, 8],
        ['nh3_caoh2', 'gas', 'NH3', 'Ca(OH)2', 'NH3', '2NH₄⁺(aq) + Ca(OH)₂(aq) → 2NH₃(g)↑ + 2H₂O(l) + Ca²⁺(aq)', 1.0, 1.0, 5],
        ['neut_hcl_naoh', 'neutralization', 'HCl', 'NaOH', 'H2O', 'HCl(aq) + NaOH(aq) → NaCl(aq) + H₂O(l)', 1.0, 1.0, 10],
        ['neut_hcl_caoh2', 'neutralization', 'HCl', 'Ca(OH)2', 'H2O', '2HCl(aq) + Ca(OH)₂(aq) → CaCl₂(aq) + 2H₂O(l)', 2.0, 1.0, 5],
        ['neut_hcl_nh3', 'neutralization', 'HCl', 'NH3', 'H2O', 'HCl(aq) + NH₃(aq) → NH₄Cl(aq)', 1.0, 1.0, 5],
        ['neut_ch3cooh_naoh', 'neutralization', 'CH3COOH', 'NaOH', 'H2O', 'CH₃COOH(aq) + NaOH(aq) → CH₃COONa(aq) + H₂O(l)', 1.0, 1.0, 7],
        ['neut_ch3cooh_caoh2', 'neutralization', 'CH3COOH', 'Ca(OH)2', 'H2O', '2CH₃COOH(aq) + Ca(OH)₂(aq) → Ca(CH₃COO)₂(aq) + 2H₂O(l)', 2.0, 1.0, 4],
        ['neut_ch3cooh_nh3', 'neutralization', 'CH3COOH', 'NH3', 'H2O', 'CH₃COOH(aq) + NH₃(aq) → CH₃COONH₄(aq)', 1.0, 1.0, 4]
    ];

    function reactionName(r) {
        const info = PRODUCTS[r.product];
        if (r.type === 'precipitate') return `${info.name} Precipitate (${r.product})`;
        if (r.type === 'gas') return r.product === 'CO2' ? `${info.name} Gas Evolution (CO₂↑)` : `${info.name} Evolution (NH₃↑)`;
        return `Acid-Base Neutralization (${LAB_REAGENTS[r.reactant_a].name} + ${LAB_REAGENTS[r.reactant_b].name})`;
    }

    function reactionExplanation(r) {
        const nameA = LAB_REAGENTS[r.reactant_a].name;
        const nameB = LAB_REAGENTS[r.reactant_b].name;
        const info = PRODUCTS[r.product];
        if (r.type === 'precipitate') {
            return `Mixing ${nameA} (${r.reactant_a}) with ${nameB} (${r.reactant_b}) brings together ions whose product is insoluble in water, so a ${info.color} solid of ${info.name} (${r.product}) precipitates out. The remaining ions stay dissolved as spectator ions.`;
        }
        if (r.type === 'gas' && r.product === 'CO2') {
            const acid = ['HCl', 'CH3COOH'].includes(r.reactant_a) ? r.reactant_a : r.reactant_b;
            return `The acid (${acid}) donates H⁺ to the carbonate/bicarbonate ions, forming unstable carbonic acid (H₂CO₃) that immediately decomposes into water and carbon dioxide gas, seen as fizzing bubbles.`;
        }
        if (r.type === 'gas') {
            const base = r.reactant_a === 'NH3' ? nameB : nameA;
            return `Hydroxide ions (OH⁻) from ${base} push the ammonium/ammonia equilibrium toward free ammonia (NH₄⁺ + OH⁻ → NH₃ + H₂O), releasing pungent ammonia gas.`;
        }
        return `H⁺ ions from the acid react with OH⁻ ions from the base (H⁺ + OH⁻ → H₂O). Using matching amounts of ${nameA} and ${nameB} brings the solution close to neutral pH and releases heat (exothermic).`;
    }

    const REACTIONS = RAW_REACTIONS.map(([id, type, a, b, product, equation, concA, concB, priority]) => {
        const r = { id, type, reactant_a: a, reactant_b: b, product, equation, conc_a: concA, conc_b: concB, priority };
        r.color = PRODUCTS[product].color;
        r.name = reactionName(r);
        r.explanation = reactionExplanation(r);
        return r;
    });

    const REACTIONS_BY_ID = Object.fromEntries(REACTIONS.map(r => [r.id, r]));
    const pairKey = (a, b) => [a, b].sort().join('|');
    const REACTIONS_BY_PAIR = Object.fromEntries(REACTIONS.map(r => [pairKey(r.reactant_a, r.reactant_b), r]));

    const SUGGESTIONS = [
        { label: '🟡 Yellow Precipitate', prompt: 'Form a yellow precipitate (PbI2)' },
        { label: '⚪ White Precipitate', prompt: 'Form a white precipitate of Silver Chloride (AgCl)' },
        { label: '💨 CO₂ Gas Evolution', prompt: 'Produce effervescent carbon dioxide (CO2) gas' },
        { label: '⚖️ Neutral pH (7.0)', prompt: 'Neutralize acid and base to reach neutral pH 7.0' },
        { label: '🧱 Chalk (CaCO₃)', prompt: 'Form white chalk precipitate (CaCO3)' },
        { label: '🧪 Ammonia Gas', prompt: 'Release ammonia gas (NH3)' }
    ];

    // ---------- Goal matching (mirrors the backend matcher) ----------
    const INTENT_KEYWORDS = {
        gas: ['gas', 'gases', 'bubble', 'bubbles', 'bubbling', 'fizz', 'fizzy', 'fizzing', 'effervescent', 'effervescence', 'foam', 'foaming', 'gelembung', 'buih', 'berbuih', 'busa', 'berbusa'],
        neutralization: ['neutral', 'neutralize', 'neutralise', 'neutralization', 'neutralisation', 'netral', 'penetralan', 'netralisasi', 'ph 7', 'ph7', 'ph 7.0', 'acid base', 'acid-base', 'asam basa', 'asam-basa'],
        precipitate: ['precipitate', 'precipitates', 'precipitation', 'solid', 'endapan', 'mengendap', 'padatan', 'ppt', 'insoluble', 'tidak larut']
    };
    const COLOR_KEYWORDS = {
        white: ['white', 'putih', 'milky'],
        yellow: ['yellow', 'kuning', 'golden', 'gold', 'emas']
    };
    const UNSUPPORTED_COLOR_KEYWORDS = ['blue', 'biru', 'red', 'merah', 'green', 'hijau', 'brown', 'coklat', 'cokelat', 'black', 'hitam', 'orange', 'jingga', 'oranye', 'purple', 'ungu', 'pink', 'violet'];
    const UNSUPPORTED_TERMS = ['hydrogen', 'hidrogen', 'oxygen', 'oksigen', 'chlorine', 'klorin', 'gas klor', 'copper', 'tembaga', 'iron', 'besi', 'zinc', 'seng', 'magnesium', 'aluminium', 'aluminum', 'sulfur dioxide', 'belerang', 'hydrogen sulfide', 'nitrogen', 'bromide', 'bromida', 'bromine', 'permanganate', 'permanganat', 'silver mirror', 'cermin perak', 'rust', 'karat', 'combustion', 'pembakaran', 'explosion', 'ledakan', 'electrolysis', 'elektrolisis', 'redox', 'displacement'];
    const SAFE_PHRASES = ['hydrogen carbonate', 'hidrogen karbonat'];
    const ELEMENT_SYMBOLS = new Set(['H', 'He', 'Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne', 'Na', 'Mg', 'Al', 'Si', 'P', 'S', 'Cl', 'Ar', 'K', 'Ca', 'Sc', 'Ti', 'V', 'Cr', 'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn', 'Ga', 'Ge', 'As', 'Se', 'Br', 'Kr', 'Rb', 'Sr', 'Y', 'Zr', 'Nb', 'Mo', 'Tc', 'Ru', 'Rh', 'Pd', 'Ag', 'Cd', 'In', 'Sn', 'Sb', 'Te', 'I', 'Xe', 'Cs', 'Ba', 'La', 'Ce', 'Pt', 'Au', 'Hg', 'Tl', 'Pb', 'Bi', 'Po', 'At', 'Rn', 'Fr', 'Ra', 'U', 'W', 'Ir', 'Os', 'Re', 'Ta', 'Hf']);
    const KNOWN_FORMULAS = new Set([
        'agno3', 'pbno32', 'bacl2', 'cacl2', 'nacl', 'ki', 'na2so4', 'na2co3', 'hcl', 'ch3cooh', 'naoh', 'nahco3', 'caoh2', 'nh3',
        'agcl', 'agi', 'pbi2', 'pbcl2', 'pbco3', 'baso4', 'baco3', 'caco3', 'co2', 'h2o',
        'nano3', 'kno3', 'bano32', 'cano32', 'hno3', 'nh4cl', 'ch3coona', 'cach3coo2', 'ch3coonh4', 'h2co3', 'nh4oh', 'nh4', 'co3', 'hco3', 'so4', 'no3', 'oh', 'ch3coo'
    ]);
    const FORMULA_IGNORE = new Set(['ph', 'ph7', 'ok', 'no', 'hi']);

    const SUBSCRIPT_MAP = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9' };
    const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const formulaKey = (token) => token.toLowerCase().replace(/[()]/g, '');

    function normalizeText(text) {
        return String(text || '')
            .replace(/[₀-₉]/g, ch => SUBSCRIPT_MAP[ch] || ch)
            .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]/g, '')
            .replace(/(?<=[A-Za-z0-9)])\^?\d?[+\-](?![A-Za-z0-9])/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function contains(lower, phrase) {
        return new RegExp(`(?<![a-z0-9])${escapeRegExp(phrase)}(?![a-z0-9])`).test(lower);
    }

    function findUnsupportedTerms(goalText) {
        const text = normalizeText(goalText);
        let lower = text.toLowerCase();
        SAFE_PHRASES.forEach(p => { lower = lower.split(p).join(' '); });

        const found = [];
        UNSUPPORTED_TERMS.forEach(term => { if (contains(lower, term)) found.push(term); });
        UNSUPPORTED_COLOR_KEYWORDS.forEach(color => { if (contains(lower, color)) found.push(color); });

        const upperRe = /(?<![A-Za-z0-9])((?:[A-Z][a-z]?\d*|\((?:[A-Z][a-z]?\d*)+\)\d*)+)(?![A-Za-z0-9])/g;
        let m;
        while ((m = upperRe.exec(text)) !== null) {
            const token = m[1];
            const symbols = token.match(/[A-Z][a-z]?/g) || [];
            if (!symbols.length || symbols.some(s => !ELEMENT_SYMBOLS.has(s))) continue;
            const hasDigit = /\d/.test(token);
            if (!hasDigit && symbols.length < 2) continue;
            const key = formulaKey(token);
            if (FORMULA_IGNORE.has(key) || KNOWN_FORMULAS.has(key)) continue;
            found.push(token);
        }

        const lowerRe = /(?<![a-z0-9])([a-z][a-z0-9()]*\d[a-z0-9()]*)(?![a-z0-9])/g;
        while ((m = lowerRe.exec(lower)) !== null) {
            const key = formulaKey(m[1]);
            if (FORMULA_IGNORE.has(key) || KNOWN_FORMULAS.has(key)) continue;
            if (!found.some(f => formulaKey(f) === key)) found.push(m[1]);
        }

        const seen = new Set();
        return found.filter(item => {
            const k = item.toLowerCase();
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
        });
    }

    function detectIntent(lower) {
        for (const intent of ['gas', 'neutralization', 'precipitate']) {
            if (INTENT_KEYWORDS[intent].some(kw => contains(lower, kw))) return intent;
        }
        return null;
    }

    function detectColor(lower) {
        for (const [color, words] of Object.entries(COLOR_KEYWORDS)) {
            if (words.some(w => contains(lower, w))) return color;
        }
        return null;
    }

    function mentionedReagents(lower) {
        return Object.entries(LAB_REAGENTS)
            .filter(([, info]) => info.aliases.some(alias => contains(lower, alias)))
            .map(([id]) => id);
    }

    function scoreReaction(r, lower, intent, color, reagents) {
        let score = 0;
        let strong = false;
        if (PRODUCTS[r.product].keywords.some(kw => contains(lower, kw))) {
            score += 6;
            strong = true;
        }
        const pair = new Set([r.reactant_a, r.reactant_b]);
        const matched = reagents.filter(x => pair.has(x));
        score += 4 * matched.length;
        score -= 2 * reagents.filter(x => !pair.has(x)).length;
        if (matched.length === 2) strong = true;
        if (intent) score += intent === r.type ? 3 : -4;
        if (color && r.type === 'precipitate') score += color === r.color ? 3 : -5;
        else if (color) score -= 2;
        score += r.priority * 0.01;
        return { score, strong };
    }

    function matchGoal(goalText) {
        const unsupportedTerms = findUnsupportedTerms(goalText);
        if (unsupportedTerms.length) return { reaction: null, score: 0, strong: false, unsupportedTerms };

        let lower = normalizeText(goalText).toLowerCase();
        SAFE_PHRASES.forEach(p => { lower = lower.split(p).join('sodium bicarbonate'); });
        const intent = detectIntent(lower);
        const color = detectColor(lower);
        const reagents = mentionedReagents(lower);

        let best = null;
        let bestScore = -Infinity;
        let bestStrong = false;
        for (const r of REACTIONS) {
            const { score, strong } = scoreReaction(r, lower, intent, color, reagents);
            if (score > bestScore) {
                best = r;
                bestScore = score;
                bestStrong = strong;
            }
        }
        if (!best || bestScore < 3) return { reaction: null, score: Math.max(bestScore, 0), strong: false, unsupportedTerms: [] };
        return { reaction: best, score: bestScore, strong: bestStrong, unsupportedTerms: [] };
    }

    function confidenceFromScore(score) {
        return Math.max(60, Math.min(99, Math.round(70 + score * 3)));
    }

    function findByPair(a, b) {
        return REACTIONS_BY_PAIR[pairKey(a, b)] || null;
    }

    window.ATOMVERSE_LAB_REACTIONS = Object.freeze({
        reagents: LAB_REAGENTS,
        products: PRODUCTS,
        reactions: REACTIONS,
        byId: REACTIONS_BY_ID,
        suggestions: SUGGESTIONS,
        findByPair,
        matchGoal,
        findUnsupportedTerms,
        confidenceFromScore
    });
})();
