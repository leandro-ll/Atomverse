/**
 * ATOMVERSE INTERACTIVE SPOTLIGHT TUTORIAL
 * Zero-dependency, interactive guided tour with live action triggers,
 * automatic module navigation, and Inverse Experiment integration.
 */

(function () {
    'use strict';

    const STORAGE_KEY = 'atomverse_tutorial_done';

    // Switch active tab in Atomverse
    function switchTab(tabKey) {
        const tabBtn = document.querySelector(`.tab-btn[data-tab="${tabKey}"]`);
        if (tabBtn && !tabBtn.classList.contains('active')) {
            tabBtn.click();
        }
    }

    // Floating action toast feedback
    function showActionToast(message) {
        const existing = document.getElementById('tut-action-toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.id = 'tut-action-toast';
        toast.style.cssText = `
            position: fixed;
            bottom: 28px;
            left: 50%;
            transform: translateX(-50%) translateY(10px);
            z-index: 10005;
            background: #0f172a;
            color: #ffffff;
            border: 1px solid #0891b2;
            box-shadow: 0 10px 25px -5px rgba(8, 145, 178, 0.4);
            padding: 10px 20px;
            border-radius: 9999px;
            font-family: 'Montserrat', sans-serif;
            font-size: 12px;
            font-weight: 700;
            display: flex;
            align-items: center;
            gap: 8px;
            opacity: 0;
            transition: all 240ms cubic-bezier(0.16, 1, 0.3, 1);
            pointer-events: none;
        `;
        toast.innerHTML = `<span style="color:#38bdf8;">⚡</span> <span>${message}</span>`;
        document.body.appendChild(toast);

        requestAnimationFrame(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateX(-50%) translateY(0)';
        });

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(-50%) translateY(-8px)';
            setTimeout(() => toast.remove(), 260);
        }, 1500);
    }

    const tourSteps = [
        {
            id: 'select-a',
            targetId: 'select-a',
            tab: 'lab',
            title: '1. Reagent Selection',
            content: 'Select chemical solutions from the left control panel. Choose from precipitation salts, everyday carbonates like Baking Soda (NaHCO₃), or acids and bases.',
            actionHint: 'Try picking a reagent from the dropdown, or click Next.',
            position: 'right',
            beforeStep: () => { switchTab('lab'); if (window.innerWidth < 1024 && window.setMobileLabDrawer) window.setMobileLabDrawer('controls'); },
            listen: {
                targetId: 'select-a',
                event: 'change',
                onAction: (advance) => {
                    showActionToast('Reagent selected! ✓');
                    setTimeout(advance, 650);
                }
            }
        },
        {
            id: 'sliders',
            targetId: 'm-a-slider',
            tab: 'lab',
            title: '2. Reaction Parameters',
            content: 'Fine-tune Concentration (Molarity), Solution Volume (mL), and Ambient Temperature. Temperature directly governs particle kinetic velocity and collision rates.',
            actionHint: 'Try dragging the concentration slider, or click Next.',
            position: 'right',
            beforeStep: () => { switchTab('lab'); if (window.innerWidth < 1024 && window.setMobileLabDrawer) window.setMobileLabDrawer('controls'); },
            listen: {
                targetId: 'm-a-slider',
                event: 'input',
                onAction: (advance) => {
                    showActionToast('Parameter adjusted! ✓');
                    setTimeout(advance, 800);
                }
            }
        },
        {
            id: 'run-sim',
            targetId: 'btn-run',
            tab: 'lab',
            title: '3. Execute Reaction',
            content: 'Click "Run Simulation" to initiate the experiment! Watch the molecular reaction analysis and observe color transitions, precipitate settling, or effervescent bubbling.',
            actionHint: 'Click "Run Simulation" to start the reaction!',
            position: 'right',
            beforeStep: () => { switchTab('lab'); if (window.innerWidth < 1024 && window.setMobileLabDrawer) window.setMobileLabDrawer('controls'); },
            listen: {
                targetId: 'btn-run',
                event: 'click',
                onAction: (advance) => {
                    showActionToast('Reaction initiated! 🧪');
                    setTimeout(advance, 1400);
                }
            }
        },
        {
            id: 'submicro',
            targetId: 'btn-submicro',
            tab: 'lab',
            title: '4. Johnstone Representation Levels',
            content: 'Seamlessly switch between Macroscopic (beakers) and Submicroscopic (particle dynamics) views to observe ion collisions, crystal lattices, and gas bubble nucleation.',
            actionHint: 'Click "Submicroscopic" to view atomic particles in motion.',
            position: 'bottom',
            beforeStep: () => { switchTab('lab'); if (window.setMobileLabDrawer) window.setMobileLabDrawer('stage'); },
            listen: {
                targetId: 'btn-submicro',
                event: 'click',
                onAction: (advance) => {
                    showActionToast('Viewing Submicroscopic particles! ⚛️');
                    setTimeout(advance, 800);
                }
            }
        },
        {
            id: 'metrics',
            targetId: 'stage-metrics',
            tab: 'lab',
            title: '5. Real-Time Reaction Metrics',
            content: 'Observe real-time measurements: final color, precipitate compound, pH, temperature, and gas evolution badges. You can also chat with the AI Tutor on the right!',
            actionHint: 'Review your experiment results, then click Next.',
            position: 'top',
            beforeStep: () => { switchTab('lab'); if (window.setMobileLabDrawer) window.setMobileLabDrawer('stage'); }
        },
        {
            id: 'inverse-intro',
            targetId: 'inv-goal-card',
            tab: 'inverse',
            title: '6. Inverse Experimentation Engine',
            content: 'Welcome to Inverse Chemistry! Instead of mixing chemicals and guessing what forms, type your desired outcome or pick an inspiration chip, and the AI algorithm computes the optimal reactant pair for you.',
            actionHint: 'Type your own goal (then click Compute) or click an inspiration prompt chip.',
            position: 'right',
            beforeStep: () => switchTab('inverse'),
            listen: [
                {
                    targetId: 'inv-chips-container',
                    event: 'click',
                    selector: '.inv-chip',
                    onAction: (advance) => {
                        showActionToast('Goal selected! 🎯');
                        setTimeout(advance, 850);
                    }
                },
                {
                    targetId: 'inv-submit-btn',
                    event: 'click',
                    onAction: (advance) => {
                        showActionToast('Computing configuration... ⚙️');
                        setTimeout(advance, 1100);
                    }
                }
            ]
        },
        {
            id: 'inverse-compute',
            targetId: 'inv-submit-btn',
            tab: 'inverse',
            title: '7. Compute Synthesis Plan',
            content: 'Now click "Compute Configuration". The smart solver evaluates solubility rules, Ksp equilibria, and thermodynamics to formulate the optimal synthesis recipe.',
            actionHint: 'Click "Compute Configuration" to calculate optimal reactants.',
            position: 'right',
            shouldSkip: () => {
                const output = document.getElementById('inv-output');
                return Boolean(output && output.querySelector('button[onclick*="applyInverseToLab"]'));
            },
            beforeStep: () => {
                switchTab('inverse');
                const input = document.getElementById('inv-input');
                if (input && !input.value.trim()) {
                    input.value = 'Form a yellow precipitate (PbI2)';
                    const clearBtn = document.getElementById('inv-clear-btn');
                    if (clearBtn) clearBtn.classList.remove('hidden');
                }
            },
            listen: {
                targetId: 'inv-submit-btn',
                event: 'click',
                onAction: (advance) => {
                    showActionToast('Computing configuration... ⚙️');
                    setTimeout(advance, 1100);
                }
            }
        },
        {
            id: 'inverse-apply',
            targetId: 'inv-output',
            tab: 'inverse',
            title: '8. AI Recommendation & 1-Click Load',
            content: 'Examine the computed recipe! The engine details Reactant A & B concentrations, temperatures, and scientific rationale. Click "🚀 Apply to Reaction Lab" to load this recipe directly into your lab!',
            actionHint: 'Click "Apply to Reaction Lab" to transfer these chemicals.',
            position: 'left',
            beforeStep: () => {
                switchTab('inverse');
                const output = document.getElementById('inv-output');
                const submitBtn = document.getElementById('inv-submit-btn');
                // Ensure output is generated if user skipped step 7
                if (output && !output.querySelector('button[onclick*="applyInverseToLab"]')) {
                    if (submitBtn) submitBtn.click();
                }
            },
            listen: {
                targetId: 'inv-output',
                event: 'click',
                selector: 'button',
                onAction: (advance) => {
                    showActionToast('Applying recipe to Reaction Lab! 🚀');
                    setTimeout(advance, 700);
                }
            }
        },
        {
            id: 'lab-loaded',
            targetId: 'btn-run',
            tab: 'lab',
            title: '9. Recipe Pre-Loaded in Lab!',
            content: 'Your synthesized chemicals from the Inverse Experiment are now pre-loaded into Solution A and Solution B! You can test your target outcome right here in the reaction flask.',
            actionHint: 'Click "Run Simulation" to see your inverse recipe in action, or click Next.',
            position: 'right',
            beforeStep: () => { switchTab('lab'); if (window.innerWidth < 1024 && window.setMobileLabDrawer) window.setMobileLabDrawer('controls'); },
            listen: {
                targetId: 'btn-run',
                event: 'click',
                onAction: (advance) => {
                    showActionToast('Target outcome verified! ✨');
                    setTimeout(advance, 1400);
                }
            }
        },
        {
            id: 'tour-finish',
            targetId: 'btn-student-profile',
            tab: 'lab',
            title: '10. Tour Complete! 🎉',
            content: 'You have mastered both forward simulation and inverse experimentation in Atomverse! Track your achievements, badges, and experiment history anytime in your Student Profile.',
            actionHint: 'Click Finish to claim your Onboarding Explorer badge!',
            position: 'bottom',
            beforeStep: () => { switchTab('lab'); if (window.setMobileLabDrawer) window.setMobileLabDrawer('stage'); }
        }
    ];

    let currentStepIndex = 0;
    let overlayEl = null;
    let popoverEl = null;
    let currentTargetEl = null;
    let activeCleanupFns = [];

    function injectStyles() {
        if (document.getElementById('atomverse-tutorial-styles')) return;

        const style = document.createElement('style');
        style.id = 'atomverse-tutorial-styles';
        style.textContent = `
            @keyframes tut-pulse-glow {
                0%, 100% {
                    box-shadow: 0 0 0 3px rgba(8, 145, 178, 0.7), 0 0 20px rgba(8, 145, 178, 0.35);
                }
                50% {
                    box-shadow: 0 0 0 5px rgba(8, 145, 178, 0.9), 0 0 30px rgba(8, 145, 178, 0.55);
                }
            }
            .tut-active-target {
                position: relative !important;
                z-index: 10000 !important;
                pointer-events: auto !important;
                animation: tut-pulse-glow 2s infinite ease-in-out !important;
                border-radius: 8px !important;
            }
            @keyframes tut-ring-dash {
                to {
                    stroke-dashoffset: -20;
                }
            }
            .tut-ring-animated {
                animation: tut-ring-dash 1.2s linear infinite;
            }
        `;
        document.head.appendChild(style);
    }

    function createOverlay() {
        if (overlayEl) return;
        injectStyles();

        overlayEl = document.createElement('div');
        overlayEl.id = 'atomverse-spotlight-overlay';
        overlayEl.style.cssText = `
            position: fixed;
            inset: 0;
            z-index: 9998;
            pointer-events: none;
            transition: opacity 200ms ease;
        `;

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.id = 'spotlight-svg';
        svg.setAttribute('width', '100%');
        svg.setAttribute('height', '100%');
        svg.style.cssText = 'position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none;';

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.id = 'spotlight-path';
        path.setAttribute('fill', 'rgba(15, 23, 42, 0.74)');
        path.setAttribute('fill-rule', 'evenodd');
        path.style.cssText = 'pointer-events: auto; cursor: default; transition: d 220ms cubic-bezier(0.16, 1, 0.3, 1);';

        const ring = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        ring.id = 'spotlight-ring';
        ring.setAttribute('fill', 'none');
        ring.setAttribute('stroke', '#0891b2');
        ring.setAttribute('stroke-width', '2.5');
        ring.setAttribute('rx', '10');
        ring.setAttribute('ry', '10');
        ring.setAttribute('stroke-dasharray', '6 3');
        ring.classList.add('tut-ring-animated');
        ring.style.cssText = 'pointer-events: none; transition: all 220ms cubic-bezier(0.16, 1, 0.3, 1);';

        svg.appendChild(path);
        svg.appendChild(ring);
        overlayEl.appendChild(svg);
        document.body.appendChild(overlayEl);

        // Popover card
        popoverEl = document.createElement('div');
        popoverEl.id = 'atomverse-spotlight-popover';
        popoverEl.style.cssText = `
            position: fixed;
            z-index: 10002;
            width: 360px;
            max-width: calc(100vw - 32px);
            background: var(--bg-surface);
            color: var(--text-main);
            border: 1px solid var(--border-color);
            border-radius: 16px;
            padding: 20px;
            box-shadow: 0 25px 45px -10px rgba(0, 0, 0, 0.45);
            font-family: 'Poppins', sans-serif;
            pointer-events: auto;
            transition: all 220ms cubic-bezier(0.16, 1, 0.3, 1);
        `;
        document.body.appendChild(popoverEl);

        window.addEventListener('resize', handleViewportChange);
        window.addEventListener('scroll', handleViewportChange, true);
        window.addEventListener('keydown', handleKeydown);
    }

    function handleViewportChange() {
        if (!overlayEl || overlayEl.style.display === 'none') return;
        updateSpotlight();
    }

    function handleKeydown(e) {
        if (!overlayEl || overlayEl.style.display === 'none') return;
        if (e.key === 'Escape') {
            endTutorial();
        } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
            // Prevent Enter from re-triggering focused buttons unintentionally
            if (e.target && e.target.tagName === 'BUTTON' && !e.target.id.startsWith('tut-')) {
                return;
            }
            nextStep();
        } else if (e.key === 'ArrowLeft') {
            prevStep();
        }
    }

    function cleanupActiveListeners() {
        while (activeCleanupFns.length > 0) {
            const cleanup = activeCleanupFns.pop();
            try { cleanup(); } catch (err) { /* noop */ }
        }
        if (currentTargetEl) {
            currentTargetEl.classList.remove('tut-active-target');
            currentTargetEl = null;
        }
    }

    function computeCutoutPath(rect, pad, radius) {
        const W = window.innerWidth;
        const H = window.innerHeight;
        const x = Math.max(0, rect.left - pad);
        const y = Math.max(0, rect.top - pad);
        const w = Math.min(W - x, rect.width + (pad * 2));
        const h = Math.min(H - y, rect.height + (pad * 2));
        const r = Math.max(0, Math.min(radius, w / 2, h / 2));

        return {
            x, y, w, h,
            d: `M 0,0 L ${W},0 L ${W},${H} L 0,${H} Z M ${x + r},${y} L ${x + w - r},${y} A ${r},${r} 0 0,1 ${x + w},${y + r} L ${x + w},${y + h - r} A ${r},${r} 0 0,1 ${x + w - r},${y + h} L ${x + r},${y + h} A ${r},${r} 0 0,1 ${x},${y + h - r} L ${x},${y + r} A ${r},${r} 0 0,1 ${x + r},${y} Z`
        };
    }

    function attachStepListeners(step) {
        if (!step.listen) return;

        const listeners = Array.isArray(step.listen) ? step.listen : [step.listen];
        let hasFired = false;
        const advanceOnce = () => {
            if (hasFired) return;
            hasFired = true;
            nextStep();
        };

        listeners.forEach(spec => {
            if (!spec || !spec.targetId) return;
            const target = document.getElementById(spec.targetId);
            if (!target) return;

            const handler = (e) => {
                if (spec.selector) {
                    const match = e.target.closest(spec.selector);
                    if (!match) return;
                }
                if (spec.onAction) {
                    spec.onAction(advanceOnce);
                } else {
                    advanceOnce();
                }
            };

            target.addEventListener(spec.event, handler);
            activeCleanupFns.push(() => target.removeEventListener(spec.event, handler));
        });
    }

    function computePopoverPlacement(cutout, popWidth, popHeight, preferredSide) {
        const W = window.innerWidth;
        const H = window.innerHeight;
        const margin = 16;
        const gap = 16;
        const clampX = (x) => Math.max(margin, Math.min(W - popWidth - margin, x));
        const clampY = (y) => Math.max(margin, Math.min(H - popHeight - margin, y));

        const order = [preferredSide || 'right', 'right', 'left', 'bottom', 'top']
            .filter((side, idx, arr) => arr.indexOf(side) === idx);

        const candidateFor = (side) => {
            if (side === 'right') {
                return {
                    side,
                    x: cutout.x + cutout.w + gap,
                    y: clampY(cutout.y),
                    space: W - (cutout.x + cutout.w)
                };
            }
            if (side === 'left') {
                return {
                    side,
                    x: cutout.x - popWidth - gap,
                    y: clampY(cutout.y),
                    space: cutout.x
                };
            }
            if (side === 'bottom') {
                return {
                    side,
                    x: clampX(cutout.x),
                    y: cutout.y + cutout.h + gap,
                    space: H - (cutout.y + cutout.h)
                };
            }
            return {
                side: 'top',
                x: clampX(cutout.x),
                y: cutout.y - popHeight - gap,
                space: cutout.y
            };
        };

        const overlapsCutout = (x, y) => !(
            x + popWidth <= cutout.x ||
            x >= cutout.x + cutout.w ||
            y + popHeight <= cutout.y ||
            y >= cutout.y + cutout.h
        );

        const fitsViewport = (x, y) => (
            x >= margin &&
            y >= margin &&
            x + popWidth <= W - margin &&
            y + popHeight <= H - margin
        );

        const candidates = order.map(candidateFor);
        for (const c of candidates) {
            if (fitsViewport(c.x, c.y) && !overlapsCutout(c.x, c.y)) {
                return { x: c.x, y: c.y };
            }
        }

        // Fallback: pick the side with the most available room and clamp to viewport
        const best = candidates.slice().sort((a, b) => b.space - a.space)[0] || candidates[0];
        return { x: clampX(best.x), y: clampY(best.y) };
    }

    function positionSpotlightElements(target, step, path, ring) {
        const rect = target.getBoundingClientRect();
        const pad = 8;
        const radius = 10;

        const cutout = computeCutoutPath(rect, pad, radius);
        path.setAttribute('d', cutout.d);

        ring.setAttribute('x', cutout.x);
        ring.setAttribute('y', cutout.y);
        ring.setAttribute('width', cutout.w);
        ring.setAttribute('height', cutout.h);

        const popRect = popoverEl.getBoundingClientRect();
        const popWidth = popRect.width || 360;
        const popHeight = popRect.height || 260;
        const pos = computePopoverPlacement(cutout, popWidth, popHeight, step.position);

        popoverEl.style.left = `${pos.x}px`;
        popoverEl.style.top = `${pos.y}px`;
    }

    function updateSpotlight() {
        if (!overlayEl || currentStepIndex < 0 || currentStepIndex >= tourSteps.length) return;

        cleanupActiveListeners();

        const step = tourSteps[currentStepIndex];
        if (typeof step.beforeStep === 'function') {
            step.beforeStep();
        }

        const target = document.getElementById(step.targetId);
        const path = document.getElementById('spotlight-path');
        const ring = document.getElementById('spotlight-ring');

        if (!target || !path || !ring) return;

        currentTargetEl = target;
        currentTargetEl.classList.add('tut-active-target');

        target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

        // Attach hybrid interaction listener
        attachStepListeners(step);

        const isLast = currentStepIndex === tourSteps.length - 1;
        const isFirst = currentStepIndex === 0;

        // Render progress pills
        const progressPills = tourSteps.map((_, i) => `
            <span style="display:inline-block; height:4px; flex:1; border-radius:2px; background:${i === currentStepIndex ? '#0891b2' : i < currentStepIndex ? '#99f6e4' : '#e2e8f0'}; transition:background 0.2s;"></span>
        `).join('');

        popoverEl.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <span style="font-size:11px; font-weight:700; color:#0891b2; text-transform:uppercase; letter-spacing:0.05em; font-family:'Montserrat',sans-serif;">
                    Step ${currentStepIndex + 1} of ${tourSteps.length}
                </span>
                <button id="tut-close" style="background:none; border:none; font-size:16px; color:#94a3b8; cursor:pointer; padding:2px; line-height:1;" title="Close Tutorial">✕</button>
            </div>

            <div style="display:flex; gap:3px; margin-bottom:14px;">
                ${progressPills}
            </div>

            <h3 style="font-family:'Montserrat',sans-serif; font-size:15px; font-weight:700; color:var(--text-main); margin-bottom:8px; line-height:1.35;">
                ${step.title}
            </h3>

            <p style="font-size:12px; color:var(--text-muted); line-height:1.6; margin-bottom:12px;">
                ${step.content}
            </p>

            ${step.actionHint ? `
                <div style="display:flex; align-items:center; gap:6px; background:var(--primary-soft); border:1px solid var(--primary); color:var(--primary); padding:6px 12px; border-radius:10px; font-size:11px; font-weight:600; margin-bottom:16px; line-height:1.4;">
                    <span style="font-size:13px;">💡</span>
                    <span>${step.actionHint}</span>
                </div>
            ` : ''}

            <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid var(--border-color); padding-top:10px; margin-top:4px;">
                <button id="tut-skip" style="background:none; border:none; color:var(--text-muted); font-size:12px; font-weight:600; cursor:pointer; padding:6px 0;">Skip</button>
                <div style="display:flex; gap:8px;">
                    ${!isFirst ? '<button id="tut-prev" style="background:var(--bg-surface-alt); border:1px solid var(--border-color); color:var(--text-main); padding:7px 14px; border-radius:8px; font-size:12px; font-weight:600; cursor:pointer;">Back</button>' : ''}
                    <button id="tut-next" style="background:#0891b2; border:none; color:#ffffff; padding:7px 18px; border-radius:8px; font-size:12px; font-weight:700; cursor:pointer; box-shadow:0 3px 10px rgba(8,145,178,0.35); font-family:'Montserrat',sans-serif;">
                        ${isLast ? 'Finish! 🎉' : 'Next →'}
                    </button>
                </div>
            </div>
        `;

        document.getElementById('tut-close').onclick = endTutorial;
        document.getElementById('tut-skip').onclick = endTutorial;
        document.getElementById('tut-next').onclick = isLast ? endTutorial : nextStep;
        const prevBtn = document.getElementById('tut-prev');
        if (prevBtn) prevBtn.onclick = prevStep;

        positionSpotlightElements(target, step, path, ring);
        requestAnimationFrame(() => {
            if (currentTargetEl === target) {
                positionSpotlightElements(target, step, path, ring);
            }
        });
    }

    function nextStep() {
        while (currentStepIndex < tourSteps.length - 1) {
            currentStepIndex++;
            const candidate = tourSteps[currentStepIndex];
            if (candidate && typeof candidate.shouldSkip === 'function' && candidate.shouldSkip()) {
                continue;
            }
            setTimeout(updateSpotlight, 60);
            return;
        }
        endTutorial();
    }

    function prevStep() {
        while (currentStepIndex > 0) {
            currentStepIndex--;
            const candidate = tourSteps[currentStepIndex];
            if (candidate && typeof candidate.shouldSkip === 'function' && candidate.shouldSkip()) {
                continue;
            }
            setTimeout(updateSpotlight, 60);
            return;
        }
    }

    function startTutorial() {
        createOverlay();
        currentStepIndex = 0;
        overlayEl.style.display = 'block';
        popoverEl.style.display = 'block';
        updateSpotlight();
    }

    function endTutorial() {
        cleanupActiveListeners();
        if (overlayEl) overlayEl.style.display = 'none';
        if (popoverEl) popoverEl.style.display = 'none';
        localStorage.setItem(STORAGE_KEY, 'true');

        // Switch back to lab view for normal student exploration
        switchTab('lab');

        // Trigger welcome achievement in progress tracker
        window.dispatchEvent(new CustomEvent('atomverse/tutorial-completed'));
    }

    // Expose global methods
    window.startAtomverseTutorial = startTutorial;

    document.addEventListener('DOMContentLoaded', () => {
        // Always auto-launch tutorial when the website loads
        setTimeout(startTutorial, 700);
    });

})();

