/**
 * ATOMVERSE GAMIFIED PROGRESS TRACKER & STUDENT PROFILE
 * Manages XP, levels, quest checklist, badges, and lab history in localStorage (English).
 */

(function () {
    'use strict';

    const STORAGE_KEY = 'atomverse_student_data';

    const ALL_QUESTS = [
        {
            id: 'quest_tutorial',
            title: 'Star Student',
            desc: 'Complete the interactive onboarding tutorial of Atomverse.',
            xp: 50,
            icon: '🎓'
        },
        {
            id: 'quest_first_run',
            title: 'Novice Chemist',
            desc: 'Run your very first chemical reaction simulation.',
            xp: 50,
            icon: '🧪'
        },
        {
            id: 'quest_precipitate',
            title: 'Precipitate Hunter',
            desc: 'Synthesize an insoluble solid precipitate (e.g. white AgCl or yellow PbI₂).',
            xp: 100,
            icon: '💎'
        },
        {
            id: 'quest_gas',
            title: 'Bubbling Reaction',
            desc: 'Produce CO₂ or NH₃ gas evolution from acid-base or carbonate reactions.',
            xp: 100,
            icon: '🫧'
        },
        {
            id: 'quest_neutralize',
            title: 'Neutralization Master',
            desc: 'Perform an acid-base neutralization reaching pH ~7.0.',
            xp: 100,
            icon: '⚖️'
        },
        {
            id: 'quest_high_temp',
            title: 'Thermal Dynamics',
            desc: 'Experiment at elevated temperature (≥60°C) to accelerate ion kinetics.',
            xp: 75,
            icon: '🔥'
        },
        {
            id: 'quest_inverse',
            title: 'Inverse Sleuth',
            desc: 'Explore and solve an inverse target reaction problem.',
            xp: 100,
            icon: '🎯'
        },
        {
            id: 'quest_env',
            title: 'Green Chemist',
            desc: 'Examine polymer bond stability in the Environmental Literacy module.',
            xp: 75,
            icon: '🌿'
        }
    ];

    const ALL_BADGES = [
        { id: 'badge_novice', name: 'Junior Chemist', icon: '🧪', desc: 'Begun the journey of virtual chemistry exploration.' },
        { id: 'badge_precipitate', name: 'Precipitate Master', icon: '❄️', desc: 'Observed ionic lattice crystallization and precipitation.' },
        { id: 'badge_gas', name: 'Gas Evolution Expert', icon: '🫧', desc: 'Generated effervescent gas bubbles through real reaction pathways.' },
        { id: 'badge_acid_base', name: 'Equilibrium Seeker', icon: '⚖️', desc: 'Mastered stoichiometric neutralization and proton transfer.' },
        { id: 'badge_inverse', name: 'Inverse Sleuth', icon: '🕵️', desc: 'Derived reaction configurations from targeted chemical outcomes.' },
        { id: 'badge_eco', name: 'Green Chemist', icon: '🌱', desc: 'Investigated the molecular bond persistence of everyday polymer waste.' }
    ];

    function getDefaultData() {
        return {
            profile: {
                name: 'Student Chemist',
                grade: 'Grade 11 Chemistry',
                avatar: '🧪',
                level: 1,
                xp: 0
            },
            completedQuests: {},
            unlockedBadges: {
                badge_novice: new Date().toLocaleDateString('en-US')
            },
            history: []
        };
    }

    function loadData() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return getDefaultData();
            const data = JSON.parse(raw);
            return {
                profile: { ...getDefaultData().profile, ...(data.profile || {}) },
                completedQuests: data.completedQuests || {},
                unlockedBadges: data.unlockedBadges || getDefaultData().unlockedBadges,
                history: Array.isArray(data.history) ? data.history : []
            };
        } catch (e) {
            return getDefaultData();
        }
    }

    function saveData(data) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
            updateUI();
        } catch (e) {
            console.error('Failed to save student data', e);
        }
    }

    function addXP(amount, reason) {
        const data = loadData();
        data.profile.xp += amount;
        const newLevel = Math.floor(data.profile.xp / 150) + 1;
        const leveledUp = newLevel > data.profile.level;
        data.profile.level = newLevel;

        saveData(data);

        showToast(`+${amount} XP: ${reason}`, 'xp');
        if (leveledUp) {
            showToast(`🎉 Level Up! You reached Level ${newLevel}!`, 'level');
        }
    }

    function completeQuest(questId) {
        const data = loadData();
        if (data.completedQuests[questId]) return;

        const quest = ALL_QUESTS.find(q => q.id === questId);
        if (!quest) return;

        data.completedQuests[questId] = new Date().toISOString();
        saveData(data);
        addXP(quest.xp, `Quest Completed: "${quest.title}"`);

        // Check badge unlocks
        if (questId === 'quest_precipitate') unlockBadge('badge_precipitate');
        if (questId === 'quest_gas') unlockBadge('badge_gas');
        if (questId === 'quest_neutralize') unlockBadge('badge_acid_base');
        if (questId === 'quest_inverse') unlockBadge('badge_inverse');
        if (questId === 'quest_env') unlockBadge('badge_eco');
    }

    function unlockBadge(badgeId) {
        const data = loadData();
        if (data.unlockedBadges[badgeId]) return;

        const badge = ALL_BADGES.find(b => b.id === badgeId);
        if (!badge) return;

        data.unlockedBadges[badgeId] = new Date().toLocaleDateString('en-US');
        saveData(data);
        showToast(`🏆 New Badge: ${badge.name}!`, 'badge');
    }

    function recordHistory(entry) {
        const data = loadData();
        data.history.unshift({
            timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
            reagentA: entry.reagentA,
            reagentB: entry.reagentB,
            equation: entry.result?.equation || '-',
            ppt: entry.result?.ppt || null,
            gas: entry.result?.gas || null,
            ph: entry.result?.ph || '-'
        });
        if (data.history.length > 15) data.history.pop();
        saveData(data);
    }

    function showToast(message, type = 'info') {
        let container = document.getElementById('atomverse-toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'atomverse-toast-container';
            container.style.cssText = `
                position: fixed;
                bottom: 24px;
                right: 24px;
                z-index: 10000;
                display: flex;
                flex-direction: column;
                gap: 8px;
                pointer-events: none;
            `;
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        toast.style.cssText = `
            background: #ffffff;
            color: #0f172a;
            border: 1px solid #e2e8f0;
            border-left: 4px solid ${type === 'xp' ? '#0891b2' : (type === 'badge' ? '#f59e0b' : '#10b981')};
            padding: 10px 16px;
            border-radius: 10px;
            box-shadow: 0 10px 20px -3px rgba(0,0,0,0.15);
            font-size: 12px;
            font-weight: 600;
            font-family: 'Poppins', sans-serif;
            display: flex;
            align-items: center;
            gap: 8px;
            animation: toastIn 200ms ease forwards;
            pointer-events: auto;
        `;
        toast.innerHTML = `<span>${message}</span>`;
        container.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(8px)';
            toast.style.transition = 'all 200ms ease';
            setTimeout(() => toast.remove(), 250);
        }, 3200);
    }

    function updateUI() {
        const data = loadData();
        const pillBtn = document.getElementById('btn-student-profile');
        if (pillBtn) {
            pillBtn.innerHTML = `
                <span class="w-4 h-4 rounded-full bg-cyan-100 text-cyan-700 flex items-center justify-center text-[10px] font-bold">${data.profile.avatar}</span>
                <span class="text-xs font-semibold text-slate-700 hidden sm:inline">${data.profile.name}</span>
                <span class="text-[9px] bg-cyan-600 text-white font-bold px-1.5 py-0.5 rounded-full">Lv.${data.profile.level}</span>
            `;
        }
    }

    // Modal creation & management
    let modalEl = null;

    function openProfileModal() {
        if (!modalEl) {
            modalEl = document.createElement('div');
            modalEl.id = 'atomverse-profile-modal';
            modalEl.style.cssText = `
                position: fixed;
                inset: 0;
                background: rgba(15, 23, 42, 0.65);
                backdrop-filter: blur(4px);
                z-index: 9999;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 16px;
                font-family: 'Poppins', sans-serif;
            `;
            document.body.appendChild(modalEl);
            modalEl.onclick = (e) => { if (e.target === modalEl) closeProfileModal(); };
        }

        const data = loadData();
        const totalQuests = ALL_QUESTS.length;
        const doneQuests = Object.keys(data.completedQuests).length;
        const questPercent = Math.round((doneQuests / totalQuests) * 100);

        const currentLvlXp = (data.profile.xp % 150);
        const xpProgress = Math.round((currentLvlXp / 150) * 100);

        modalEl.innerHTML = `
            <div style="background:#ffffff; color:#0f172a; width:680px; max-width:100%; max-height:90vh; border-radius:18px; border:1px solid #e2e8f0; box-shadow:0 25px 50px -12px rgba(0,0,0,0.25); display:flex; flex-direction:column; overflow:hidden;">
                
                <!-- HEADER -->
                <div style="padding:20px 24px; background:#f8fafc; border-bottom:1px solid #e2e8f0; display:flex; justify-content:space-between; align-items:center;">
                    <div style="display:flex; align-items:center; gap:14px;">
                        <div style="width:48px; height:48px; border-radius:999px; background:#e0f2fe; color:#0369a1; display:flex; align-items:center; justify-content:center; font-size:22px; border:2px solid #38bdf8;">
                            ${data.profile.avatar}
                        </div>
                        <div>
                            <div style="display:flex; align-items:center; gap:8px;">
                                <h2 style="font-family:'Montserrat',sans-serif; font-size:16px; font-weight:700; color:#0f172a;">${data.profile.name}</h2>
                                <span style="background:#0891b2; color:#ffffff; font-size:10px; font-weight:700; padding:2px 8px; border-radius:999px;">Level ${data.profile.level}</span>
                            </div>
                            <span style="font-size:12px; color:#64748b;">${data.profile.grade} • Total XP: ${data.profile.xp}</span>
                        </div>
                    </div>
                    <button id="modal-close-btn" style="background:#f1f5f9; border:none; border-radius:8px; width:32px; height:32px; font-size:14px; color:#64748b; cursor:pointer;">✕</button>
                </div>

                <!-- XP BAR -->
                <div style="padding:10px 24px; background:#f1f5f9; border-bottom:1px solid #e2e8f0; font-size:11px; display:flex; align-items:center; gap:12px;">
                    <span style="color:#64748b; font-weight:600;">Level ${data.profile.level} Progress:</span>
                    <div style="flex:1; height:8px; background:#e2e8f0; border-radius:999px; overflow:hidden;">
                        <div style="width:${xpProgress}%; height:100%; background:#0891b2; transition:width 300ms ease;"></div>
                    </div>
                    <span style="font-weight:700; color:#0891b2;">${currentLvlXp} / 150 XP</span>
                </div>

                <!-- TABS -->
                <div style="display:flex; border-bottom:1px solid #e2e8f0; background:#ffffff; padding:0 24px;">
                    <button class="pm-tab active" data-tab="tab-badges" style="padding:12px 16px; border:none; background:none; font-size:12px; font-weight:700; color:#0891b2; border-bottom:2px solid #0891b2; cursor:pointer;">Badges (${Object.keys(data.unlockedBadges).length}/${ALL_BADGES.length})</button>
                    <button class="pm-tab" data-tab="tab-quests" style="padding:12px 16px; border:none; background:none; font-size:12px; font-weight:600; color:#64748b; border-bottom:2px solid transparent; cursor:pointer;">Quests (${doneQuests}/${totalQuests})</button>
                    <button class="pm-tab" data-tab="tab-history" style="padding:12px 16px; border:none; background:none; font-size:12px; font-weight:600; color:#64748b; border-bottom:2px solid transparent; cursor:pointer;">Lab Journal (${data.history.length})</button>
                </div>

                <!-- CONTENT AREA -->
                <div style="padding:20px 24px; overflow-y:auto; flex:1;">
                    
                    <!-- TAB 1: BADGES -->
                    <div id="tab-badges" class="pm-tab-pane" style="display:grid; grid-template-columns:repeat(2, 1fr); gap:12px;">
                        ${ALL_BADGES.map(badge => {
                            const isUnlocked = !!data.unlockedBadges[badge.id];
                            return `
                                <div style="display:flex; gap:12px; padding:12px; border-radius:12px; border:1px solid ${isUnlocked ? '#bbf7d0' : '#e2e8f0'}; background:${isUnlocked ? '#f0fdf4' : '#f8fafc'}; opacity:${isUnlocked ? '1' : '0.55'};">
                                    <div style="font-size:26px; line-height:1; filter:${isUnlocked ? 'none' : 'grayscale(1)'};">${badge.icon}</div>
                                    <div>
                                        <div style="display:flex; align-items:center; gap:6px;">
                                            <h4 style="font-size:12px; font-weight:700; color:#0f172a;">${badge.name}</h4>
                                            ${isUnlocked ? '<span style="font-size:9px; color:#16a34a; font-weight:bold;">✓ Unlocked</span>' : ''}
                                        </div>
                                        <p style="font-size:11px; color:#64748b; margin-top:2px;">${badge.desc}</p>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>

                    <!-- TAB 2: QUESTS -->
                    <div id="tab-quests" class="pm-tab-pane" style="display:none; flex-direction:column; gap:10px;">
                        <div style="margin-bottom:6px; display:flex; justify-content:space-between; font-size:12px; color:#475569;">
                            <span>Mission Completion: <b>${questPercent}%</b></span>
                            <span>${doneQuests} of ${totalQuests} quests completed</span>
                        </div>
                        ${ALL_QUESTS.map(quest => {
                            const isDone = !!data.completedQuests[quest.id];
                            return `
                                <div style="display:flex; align-items:center; justify-content:space-between; padding:12px 14px; border-radius:10px; border:1px solid ${isDone ? '#e2e8f0' : '#cbd5e1'}; background:${isDone ? '#f8fafc' : '#ffffff'};">
                                    <div style="display:flex; align-items:center; gap:10px;">
                                        <span style="font-size:20px;">${quest.icon}</span>
                                        <div>
                                            <h4 style="font-size:12px; font-weight:700; color:${isDone ? '#64748b' : '#0f172a'}; text-decoration:${isDone ? 'line-through' : 'none'};">${quest.title}</h4>
                                            <p style="font-size:11px; color:#64748b;">${quest.desc}</p>
                                        </div>
                                    </div>
                                    <span style="font-size:11px; font-weight:700; padding:3px 8px; border-radius:6px; ${isDone ? 'background:#dcfce7; color:#15803d;' : 'background:#e0f2fe; color:#0369a1;'}">
                                        ${isDone ? '✓ Completed' : `+${quest.xp} XP`}
                                    </span>
                                </div>
                            `;
                        }).join('')}
                    </div>

                    <!-- TAB 3: HISTORY -->
                    <div id="tab-history" class="pm-tab-pane" style="display:none;">
                        ${data.history.length === 0 ? '<p style="text-align:center; color:#94a3b8; font-size:12px; padding:30px 0;">No experiment history yet. Run your first simulation in Reaction Lab!</p>' : `
                            <div style="display:flex; flex-direction:column; gap:8px;">
                                ${data.history.map(item => `
                                    <div style="padding:10px 14px; border-radius:8px; border:1px solid #e2e8f0; background:#f8fafc; font-size:11px; display:flex; justify-content:space-between; align-items:center;">
                                        <div>
                                            <div style="font-weight:700; font-family:'JetBrains Mono',monospace; color:#0891b2;">${item.equation}</div>
                                            <div style="color:#64748b; font-size:10px; margin-top:2px;">
                                                ${item.ppt ? `Precipitate: <b>${item.ppt}</b> • ` : ''}
                                                ${item.gas ? `Gas: <b>${item.gas}</b> • ` : ''}
                                                pH: ${item.ph}
                                            </div>
                                        </div>
                                        <span style="color:#94a3b8; font-size:10px; font-family:'JetBrains Mono',monospace;">${item.timestamp}</span>
                                    </div>
                                `).join('')}
                            </div>
                        `}
                    </div>

                </div>

            </div>
        `;

        document.getElementById('modal-close-btn').onclick = closeProfileModal;

        const tabs = modalEl.querySelectorAll('.pm-tab');
        tabs.forEach(tab => {
            tab.onclick = () => {
                tabs.forEach(t => {
                    t.style.fontWeight = '600';
                    t.style.color = '#64748b';
                    t.style.borderBottomColor = 'transparent';
                });
                tab.style.fontWeight = '700';
                tab.style.color = '#0891b2';
                tab.style.borderBottomColor = '#0891b2';

                const targetTabId = tab.getAttribute('data-tab');
                modalEl.querySelectorAll('.pm-tab-pane').forEach(p => p.style.display = 'none');
                const targetPane = document.getElementById(targetTabId);
                if (targetPane) targetPane.style.display = targetTabId === 'tab-quests' ? 'flex' : (targetTabId === 'tab-badges' ? 'grid' : 'block');
            };
        });
    }

    function closeProfileModal() {
        if (modalEl) {
            modalEl.remove();
            modalEl = null;
        }
    }

    // EVENT LISTENERS
    window.addEventListener('atomverse/reaction-completed', (e) => {
        if (!e.detail) return;
        const { reagentA, reagentB, result } = e.detail;

        completeQuest('quest_first_run');
        recordHistory({ reagentA, reagentB, result });

        if (result.ppt) {
            completeQuest('quest_precipitate');
        }

        if (result.hasGas) {
            completeQuest('quest_gas');
        }

        if (result.ph && result.ph.includes('7.0')) {
            completeQuest('quest_neutralize');
        }

        if (window.state && window.state.temperature >= 60) {
            completeQuest('quest_high_temp');
        }
    });

    window.addEventListener('atomverse/tutorial-completed', () => {
        completeQuest('quest_tutorial');
    });

    // Expose methods
    window.openStudentProfileModal = openProfileModal;
    window.completeStudentQuest = completeQuest;

    document.addEventListener('DOMContentLoaded', () => {
        updateUI();

        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.getAttribute('data-tab');
                if (tab === 'inverse') completeQuest('quest_inverse');
                if (tab === 'env') completeQuest('quest_env');
            });
        });
    });

})();
