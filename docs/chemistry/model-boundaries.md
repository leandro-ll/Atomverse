# Chemistry Model Boundaries and Scope

This document specifies the supported chemical domain, physical model boundaries, saturation thresholds, and explicit non-goals for Atomverse's chemistry engine.

---

## 1. Supported Species and Ions

The chemistry engine models aqueous solutions and precipitates formed from a closed set of 11 cations and 9 anions (yielding up to 99 binary formula-unit combinations).

### Cations (11)
- **Monovalent**: $\text{Ag}^+$ (Perak), $\text{H}^+$ (Hidrogen / strong acid), $\text{K}^+$ (Kalium), $\text{Na}^+$ (Natrium)
- **Divalent**: $\text{Ba}^{2+}$ (Barium), $\text{Ca}^{2+}$ (Kalsium), $\text{Cu}^{2+}$ (Tembaga), $\text{Mg}^{2+}$ (Magnesium), $\text{Pb}^{2+}$ (Timbal), $\text{Zn}^{2+}$ (Seng)
- **Trivalent**: $\text{Fe}^{3+}$ (Besi)

### Anions (9)
- **Monovalent**: $\text{Br}^-$ (bromida), $\text{Cl}^-$ (klorida), $\text{I}^-$ (iodida), $\text{NO}_3^-$ (nitrat), $\text{OH}^-$ (hidroksida / strong base)
- **Divalent**: $\text{CO}_3^{2-}$ (karbonat), $\text{S}^{2-}$ (sulfida), $\text{SO}_4^{2-}$ (sulfat)
- **Trivalent**: $\text{PO}_4^{3-}$ (fosfat)

---

## 2. Closed Outcome Categories

Every experiment evaluated by the pure engine yields exactly one of five closed string categories:

1. **`precipitate_forms`**: Ion product $Q > K_{sp}$ strictly. A solid phase forms, the product identifier is populated, and balanced molecular and net-ionic equations are exposed.
2. **`below_saturation`**: The candidate solid is modeled and its $K_{sp}$ is cited, but quantities are dilute such that $Q \le K_{sp}$. No precipitate forms, equations are absent (`null`), and the candidate solid is named in an educational explanation disclosing $Q$ and $K_{sp}$.
3. **`no_modeled_reaction`**: All cross-swap products are soluble according to solubility rules, or no cited $K_{sp}$ is available for a precipitate candidate. The mixture remains homogeneous aqueous. Equations and products are absent (`null`).
4. **`neutralization`**: Strong-acid and strong-base reaction ($\text{HCl} + \text{NaOH} \to \text{NaCl} + \text{H}_2\text{O}$). Evaluated using stoichiometric proton/hydroxide tracking and $pKw$ cologarithms.
5. **`unsupported`**: Reagent combinations that fall outside the modeled physical mechanisms (e.g. acid with carbonate/sulfide or metal displacement), returning a typed reason code explaining the boundary.

---

## 3. Strong-Acid / Strong-Base pH Model

- **Model**: Ideal, monoprotic strong acid/base treatment.
- **System**: $\text{HCl}(aq) + \text{NaOH}(aq) \to \text{NaCl}(aq) + \text{H}_2\text{O}(l)$.
- **Constants**: $pK_w = 14.0$, neutral $\text{pH} = 7.0$ at standard temperature ($25^\circ\text{C}$).
- **Equivalence**: Equimolar condition decided within $\pm 10^{-6}\text{ mol}$ tolerance.
- **Scope Limit**: Non-modeled pairs report supported: `false` with explicit Indonesian boundary explanations rather than an invented pH (e.g., no default 7.0 for arbitrary salts).

---

## 4. The Borderline $\text{PbCl}_2$ Saturation Threshold

### Background and Intentional Behavior Change
In early quantity-blind prototypes, mixing $\text{Pb(NO}_3)_2$ and $\text{NaCl}$ unconditionally returned a precipitate outcome because lead(II) chloride is traditionally listed as "sparingly soluble / insoluble" in high school solubility tables.

Under the saturation model, precipitation is governed strictly by the solubility product comparison ($Q > K_{sp}$). Because $\text{PbCl}_2$ has a relatively large solubility product ($K_{sp} = 1.7 \times 10^{-5}$ at $25^\circ\text{C}$ per CRC Handbook 97th ed.), it can remain completely dissolved at dilute concentrations achievable via the user-interface sliders.

### Mathematical Derivation of Equal-Volume Threshold
For an equimolar mixing of equal volumes ($V_A = V_B$, so $V_{total} = 2V$):
$$[\text{Pb}^{2+}] = \frac{c}{2}, \quad [\text{Cl}^-] = \frac{c}{2}$$

The ion product is:
$$Q = [\text{Pb}^{2+}][\text{Cl}^-]^2 = \left(\frac{c}{2}\right) \left(\frac{c}{2}\right)^2 = \left(\frac{c}{2}\right)^3$$

Equating $Q$ to $K_{sp}$:
$$\left(\frac{c}{2}\right)^3 = 1.7 \times 10^{-5}$$
$$\frac{c}{2} = \sqrt[3]{1.7 \times 10^{-5}} \approx 0.0257128\text{ M}$$
$$c_{threshold} \approx 2 \times 0.0257128\text{ M} \approx 0.051426\text{ M} \approx \mathbf{0.0515\text{ M}}$$

### Borderline Outcomes
1. **Default UI Quantities ($0.1\text{ M}$, $50\text{ mL}$ each)**:
   - $[\text{Pb}^{2+}] = 0.05\text{ M}$, $[\text{Cl}^-] = 0.05\text{ M}$
   - $Q = 0.05 \times (0.05)^2 = 1.25 \times 10^{-4}$
   - Ratio $Q / K_{sp} \approx 7.35 > 1$
   - Outcome: **`precipitate_forms`** ($\text{PbCl}_2$ white solid)
2. **Dilute Quantities ($0.002\text{ M}$, $50\text{ mL}$ each)**:
   - $[\text{Pb}^{2+}] = 0.001\text{ M}$, $[\text{Cl}^-] = 0.001\text{ M}$
   - $Q = 0.001 \times (0.001)^2 = 1.0 \times 10^{-9}$
   - Ratio $Q / K_{sp} \approx 5.88 \times 10^{-5} < 1$
   - Outcome: **`below_saturation`** (homogeneous aqueous solution; explanation provided)

Because the UI concentration slider covers $0.001\text{ M}$ to $2.0\text{ M}$, learners can observe precipitation appearing as concentration crosses $\approx 0.0515\text{ M}$.

---

## 5. Declared Non-Goals

The following areas are explicitly outside the scope of version 2:

1. **Gas Evolution Reactions**: Acid reacting with carbonates ($\to \text{CO}_2(g)$) or sulfides ($\to \text{H}_2\text{S}(g)$) are flagged with the `unsupported.gas_evolution` reason code and rejected rather than incorrectly forced into an aqueous-only product.
2. **Redox and Metal Displacement**: Single-displacement reactions and redox electron tracking are excluded (`unsupported.redox`).
3. **Weak-Acid / Weak-Base Equilibria**: Hydrolysis of salts, partial dissociation, and buffer equilibria ($K_a$, $K_b$) are excluded (`unsupported.weak_equilibrium`).
4. **Runtime Database Migration**: The chemistry catalog is fully resolved and frozen at build time; no database engine or SQL migration runs at runtime.
