// ==========================================
// SUBMICROSCOPIC VISUALIZATION ENGINE
// ==========================================

let ctx;
let logicalWidth = 0;
let logicalHeight = 0;
let dividerColor = '#3f3f46';
let particleAnimationRunning = false;
let lastFrameTime = 0;
let accumulatedTime = 0;

const FIXED_STEP_MS = 1000 / 60;
const MAX_FRAME_DELTA_MS = 50;
const EFFECT_DURATION_MS = 330;

function initCanvas() {
    if (typeof els === 'undefined' || !els?.canvas) return false;
    ctx = els.canvas.getContext('2d');
    dividerColor = getComputedStyle(document.documentElement)
        .getPropertyValue('--border-color')
        .trim() || dividerColor;
    return Boolean(ctx);
}

function resizeCanvas() {
    if (!ctx || typeof els === 'undefined' || !els?.canvas) return false;

    const rect = els.canvas.getBoundingClientRect();
    const width = Math.floor(rect.width);
    const height = Math.floor(rect.height);
    if (width < 2 || height < 2) return false;

    const oldWidth = logicalWidth;
    const oldHeight = logicalHeight;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

    logicalWidth = width;
    logicalHeight = height;
    els.canvas.width = Math.round(width * pixelRatio);
    els.canvas.height = Math.round(height * pixelRatio);
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

    if (oldWidth > 0 && oldHeight > 0 && state?.particles?.length) {
        const scaleX = width / oldWidth;
        const scaleY = height / oldHeight;
        state.particles.forEach(particle => {
            particle.x = Math.max(particle.r, Math.min(width - particle.r, particle.x * scaleX));
            particle.y = Math.max(particle.r, Math.min(height - particle.r, particle.y * scaleY));
        });
        state.effects.forEach(effect => {
            effect.x *= scaleX;
            effect.y *= scaleY;
        });
    }

    return true;
}

function createParticle(type, color) {
    return {
        type,
        color,
        x: Math.random() * logicalWidth,
        y: Math.random() * logicalHeight,
        previousX: 0,
        previousY: 0,
        vx: (Math.random() - 0.5) * 2,
        vy: (Math.random() - 0.5) * 2,
        r: 5,
        alive: true,
        isPrecipitate: false,
        side: 'A'
    };
}

function generateParticles() {
    if (!ctx || typeof state === 'undefined' || !state || logicalWidth < 2 || logicalHeight < 2) return false;

    state.particles = [];
    state.effects = [];

    const scale = 20;
    const ionsA = reagentIons[state.reagentA];
    const ionsB = reagentIons[state.reagentB];
    const countA = Math.min(40, Math.round(state.mA * state.vA / scale));
    const countB = Math.min(40, Math.round(state.mB * state.vB / scale));
    const legendItems = [];

    ionsA.forEach(ion => {
        legendItems.push(`<span class="flex items-center gap-1"><span class="w-3 h-3 rounded-full shadow-sm" style="background:${ion.c}"></span>${ion.t}</span>`);
        for (let index = 0; index < countA; index += 1) {
            const particle = createParticle(ion.t, ion.c);
            particle.side = 'A';
            particle.x = 10 + Math.random() * Math.max(1, logicalWidth / 2 - 30);
            particle.y = 10 + Math.random() * Math.max(1, logicalHeight - 20);
            state.particles.push(particle);
        }
    });

    ionsB.forEach(ion => {
        if (!ionsA.some(item => item.t === ion.t)) {
            legendItems.push(`<span class="flex items-center gap-1"><span class="w-3 h-3 rounded-full shadow-sm" style="background:${ion.c}"></span>${ion.t}</span>`);
        }
        for (let index = 0; index < countB; index += 1) {
            const particle = createParticle(ion.t, ion.c);
            particle.side = 'B';
            particle.x = logicalWidth / 2 + 10 + Math.random() * Math.max(1, logicalWidth / 2 - 30);
            particle.y = 10 + Math.random() * Math.max(1, logicalHeight - 20);
            state.particles.push(particle);
        }
    });

    if (els.legend) els.legend.innerHTML = legendItems.join('');
    return true;
}

function clampAndBounce(particle, minX, maxX, minY, maxY) {
    if (particle.x < minX) {
        particle.x = minX;
        particle.vx = Math.abs(particle.vx);
    } else if (particle.x > maxX) {
        particle.x = maxX;
        particle.vx = -Math.abs(particle.vx);
    }

    if (particle.y < minY) {
        particle.y = minY;
        particle.vy = Math.abs(particle.vy);
    } else if (particle.y > maxY) {
        particle.y = maxY;
        particle.vy = -Math.abs(particle.vy);
    }
}

function resolveParticleReactions() {
    const particles = state.particles;

    for (let firstIndex = 0; firstIndex < particles.length; firstIndex += 1) {
        const first = particles[firstIndex];
        if (!first.alive || first.isPrecipitate) continue;

        for (let secondIndex = firstIndex + 1; secondIndex < particles.length; secondIndex += 1) {
            const second = particles[secondIndex];
            if (!second.alive || second.isPrecipitate) continue;

            const dx = first.x - second.x;
            const dy = first.y - second.y;
            const collisionDistance = first.r + second.r + 2;
            if (dx * dx + dy * dy >= collisionDistance * collisionDistance) continue;

            const rule = reactionRules.find(item =>
                (item.cation === first.type && item.anion === second.type) ||
                (item.cation === second.type && item.anion === first.type)
            );
            if (!rule) continue;

            first.alive = false;
            second.alive = false;

            if (rule.ppt === 'H2O') {
                for (let sparkIndex = 0; sparkIndex < 8; sparkIndex += 1) {
                    state.effects.push({
                        x: first.x,
                        y: first.y,
                        vx: (Math.random() - 0.5) * 6,
                        vy: (Math.random() - 0.5) * 6,
                        lifeMs: EFFECT_DURATION_MS,
                        color: '#fbbf24'
                    });
                }
            } else {
                state.particles.push({
                    type: rule.ppt,
                    color: rule.color,
                    x: (first.x + second.x) / 2,
                    y: (first.y + second.y) / 2,
                    previousX: first.x,
                    previousY: first.y,
                    vx: (Math.random() - 0.5) * 0.5,
                    vy: 0,
                    r: 8,
                    alive: true,
                    isPrecipitate: true,
                    side: 'mix'
                });
            }
            break;
        }
    }
}

function updateParticles() {
    const mid = logicalWidth / 2;
    const speedFactor = 0.5 + (state.temperature / 100) * 3;

    state.particles.forEach(particle => {
        if (!particle.alive) return;
        particle.previousX = particle.x;
        particle.previousY = particle.y;

        if (particle.isPrecipitate) {
            particle.vy += 0.2;
            particle.x += particle.vx;
            particle.y += particle.vy;
            if (particle.y >= logicalHeight - 15) {
                particle.y = logicalHeight - 15;
                particle.vx = 0;
                particle.vy = 0;
            }
            return;
        }

        particle.x += particle.vx * speedFactor;
        particle.y += particle.vy * speedFactor;

        let minX = particle.r;
        let maxX = logicalWidth - particle.r;
        if (!state.isReacted) {
            if (particle.side === 'A') maxX = mid - particle.r;
            if (particle.side === 'B') minX = mid + particle.r;
        }
        clampAndBounce(particle, minX, maxX, particle.r, logicalHeight - particle.r);
    });

    if (state.isReacted) resolveParticleReactions();

    state.effects.forEach(effect => {
        effect.x += effect.vx;
        effect.y += effect.vy;
        effect.lifeMs -= FIXED_STEP_MS;
    });
    state.effects = state.effects.filter(effect => effect.lifeMs > 0);
}

function renderParticles() {
    ctx.clearRect(0, 0, logicalWidth, logicalHeight);
    const mid = logicalWidth / 2;
    const speedFactor = 0.5 + (state.temperature / 100) * 3;

    if (!state.isReacted) {
        ctx.beginPath();
        ctx.moveTo(mid, 0);
        ctx.lineTo(mid, logicalHeight);
        ctx.strokeStyle = dividerColor;
        ctx.lineWidth = 4;
        ctx.setLineDash([10, 10]);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    state.particles.forEach(particle => {
        if (!particle.alive) return;

        if (speedFactor > 1.5 && !particle.isPrecipitate) {
            ctx.beginPath();
            ctx.moveTo(particle.previousX, particle.previousY);
            ctx.lineTo(particle.x, particle.y);
            ctx.strokeStyle = `${particle.color}40`;
            ctx.lineWidth = particle.r * 0.8;
            ctx.stroke();
        }

        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.r, 0, Math.PI * 2);
        ctx.fillStyle = particle.color;
        ctx.fill();
        if (particle.isPrecipitate) {
            ctx.strokeStyle = '#94a3b8';
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    });

    state.effects.forEach(effect => {
        ctx.beginPath();
        ctx.arc(effect.x, effect.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(251, 191, 36, ${effect.lifeMs / EFFECT_DURATION_MS})`;
        ctx.fill();
    });
}

function particleFrame(timestamp) {
    if (!particleAnimationRunning) return;

    const labTabHidden = document.getElementById('tab-lab')?.classList.contains('hidden');
    const hidden = document.hidden || labTabHidden || els.submicroView?.classList.contains('hidden');
    if (!ctx || logicalWidth < 2 || logicalHeight < 2 || hidden) {
        lastFrameTime = timestamp;
        requestAnimationFrame(particleFrame);
        return;
    }

    const frameDelta = Math.min(MAX_FRAME_DELTA_MS, Math.max(0, timestamp - lastFrameTime));
    lastFrameTime = timestamp;
    accumulatedTime += frameDelta;

    let simulationSteps = 0;
    while (accumulatedTime >= FIXED_STEP_MS && simulationSteps < 3) {
        updateParticles();
        accumulatedTime -= FIXED_STEP_MS;
        simulationSteps += 1;
    }

    renderParticles();
    requestAnimationFrame(particleFrame);
}

function animateParticles() {
    if (particleAnimationRunning) return;
    particleAnimationRunning = true;
    lastFrameTime = performance.now();
    accumulatedTime = 0;
    requestAnimationFrame(particleFrame);
}
