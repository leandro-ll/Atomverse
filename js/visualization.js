// ==========================================
// SUBMICROSCOPIC VISUALIZATION ENGINE
// ==========================================

let ctx; // Global context variable

// FIX: Only initialize if 'els' actually exists
function initCanvas() {
    if (typeof els !== 'undefined' && els && els.canvas) {
        ctx = els.canvas.getContext('2d');
    }
}

function resizeCanvas() { 
    if (typeof els === 'undefined' || !els || !els.canvas) return;
    els.canvas.width = els.canvas.offsetWidth; 
    els.canvas.height = els.canvas.offsetHeight; 
}

function createParticle(type, color) { 
    return { 
        type, color, 
        x: Math.random() * els.canvas.width, 
        y: Math.random() * els.canvas.height, 
        vx: (Math.random() - 0.5) * 2, 
        vy: (Math.random() - 0.5) * 2, 
        r: 5, 
        alive: true, 
        isPrecipitate: false, 
        side: 'A' 
    }; 
}

function generateParticles() {
    if (typeof els === 'undefined' || !els || typeof state === 'undefined' || !state) return; 
    
    state.particles = []; 
    state.effects = [];
    
    const scale = 20; 
    const ionsA = reagentIons[state.reagentA]; 
    const ionsB = reagentIons[state.reagentB];
    
    const countA = Math.min(40, Math.round(state.mA * state.vA / scale));
    const countB = Math.min(40, Math.round(state.mB * state.vB / scale));
    let legendHTML = '';

    ionsA.forEach(ion => {
        legendHTML += `<span class="flex items-center gap-1"><span class="w-3 h-3 rounded-full shadow-sm" style="background:${ion.c}"></span> ${ion.t}</span>`;
        for(let i=0; i<countA; i++) { 
            let p = createParticle(ion.t, ion.c); 
            p.side = 'A'; 
            p.x = Math.random() * (els.canvas.width / 2 - 20) + 10; 
            state.particles.push(p); 
        }
    });
    
    ionsB.forEach(ion => {
        if(!legendHTML.includes(ion.t)) legendHTML += `<span class="flex items-center gap-1"><span class="w-3 h-3 rounded-full shadow-sm" style="background:${ion.c}"></span> ${ion.t}</span>`;
        for(let i=0; i<countB; i++) { 
            let p = createParticle(ion.t, ion.c); 
            p.side = 'B'; 
            p.x = Math.random() * (els.canvas.width / 2 - 20) + (els.canvas.width / 2 + 10); 
            state.particles.push(p); 
        }
    });
    els.legend.innerHTML = legendHTML;
}

function animateParticles() {
    // Safety check to ensure ctx and els are ready
    if (!ctx || typeof els === 'undefined' || !els || !els.canvas) {
        requestAnimationFrame(animateParticles);
        return;
    }

    ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
    const mid = els.canvas.width / 2;
    const speedFactor = 0.5 + (state.temperature / 100) * 3.0; 

    if (!state.isReacted) {
        ctx.beginPath(); 
        ctx.moveTo(mid, 0); 
        ctx.lineTo(mid, els.canvas.height);
        ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--border-color').trim(); 
        ctx.lineWidth = 4; 
        ctx.setLineDash([10, 10]); 
        ctx.stroke(); 
        ctx.setLineDash([]);
    }

    state.particles.forEach(p => {
        if (!p.alive) return;
        
        if (p.isPrecipitate) { 
            p.vy += 0.2; p.y += p.vy; p.x += p.vx; 
            if (p.y > els.canvas.height - 15) { p.y = els.canvas.height - 15; p.vy = 0; p.vx = 0; } 
        } else {
            p.x += p.vx * speedFactor; p.y += p.vy * speedFactor;
            
            if (!state.isReacted) { 
                if (p.side === 'A') { if (p.x < p.r || p.x > mid - p.r) p.vx *= -1; } 
                else { if (p.x < mid + p.r || p.x > els.canvas.width - p.r) p.vx *= -1; } 
            } else { 
                if (p.x < p.r || p.x > els.canvas.width - p.r) p.vx *= -1; 
            }
            if (p.y < p.r || p.y > els.canvas.height - p.r) p.vy *= -1;
            
            if (speedFactor > 1.5 && !p.isPrecipitate) { 
                ctx.beginPath(); 
                ctx.moveTo(p.x - p.vx * speedFactor, p.y - p.vy * speedFactor); 
                ctx.lineTo(p.x, p.y); 
                ctx.strokeStyle = p.color + "40"; 
                ctx.lineWidth = p.r * 0.8; 
                ctx.stroke(); 
            }
        }
        
        if (state.isReacted && !p.isPrecipitate) {
            let partner = state.particles.find(other => other.alive && !other.isPrecipitate && other !== p && Math.hypot(p.x - other.x, p.y - other.y) < p.r + other.r + 2);
            if (partner) {
                let rule = reactionRules.find(r => (r.cation === p.type && r.anion === partner.type) || (r.cation === partner.type && r.anion === p.type));
                if (rule) {
                    p.alive = false; partner.alive = false;
                    if (rule.ppt === 'H2O') { 
                        for(let i=0; i<8; i++) state.effects.push({ x: p.x, y: p.y, vx: (Math.random()-0.5)*6, vy: (Math.random()-0.5)*6, life: 20, color: '#fbbf24' }); 
                    } else { 
                        state.particles.push({ type: rule.ppt, color: rule.color, x: (p.x+partner.x)/2, y: (p.y+partner.y)/2, vx: (Math.random()-0.5)*0.5, vy: 0, r: 8, alive: true, isPrecipitate: true, side: 'mix' }); 
                    }
                }
            }
        }
        
        ctx.beginPath(); 
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); 
        ctx.fillStyle = p.color; 
        ctx.fill();
        if(p.isPrecipitate) { ctx.strokeStyle = "#94a3b8"; ctx.lineWidth = 2; ctx.stroke(); }
    });

    state.effects.forEach(e => { 
        e.x += e.vx; e.y += e.vy; e.life--; 
        ctx.beginPath(); 
        ctx.arc(e.x, e.y, 3, 0, Math.PI*2); 
        ctx.fillStyle = `rgba(251, 191, 36, ${e.life/20})`; 
        ctx.fill(); 
    });
    state.effects = state.effects.filter(e => e.life > 0);
    
    requestAnimationFrame(animateParticles);
}