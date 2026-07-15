// js/inverse-experiment.js

document.querySelectorAll('.inv-btn').forEach(btn => {
    btn.addEventListener('click', async function() {
        const goal = this.dataset.goal;
        const outputDiv = document.getElementById('inverse-output');
        
        // Show Loading State (Box 2: Proses Sistem)
        outputDiv.innerHTML = `
            <div class="flex items-center gap-3 p-4 bg-[var(--bg-surface-alt)] rounded-lg">
                <div class="animate-spin rounded-full h-5 w-5 border-b-2 border-[var(--primary)]"></div>
                <div>
                    <div class="font-bold text-sm">Menganalisis Tujuan...</div>
                    <div class="text-xs text-muted-custom">Pencarian Pola & Solusi di Knowledge Base</div>
                </div>
            </div>
        `;

        try {
            const response = await fetch('http://127.0.0.1:8000/api/inverse-experiment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ goal: goal })
            });

            if (!response.ok) throw new Error("AI Engine Error");
            const data = await response.json();

            // Render Box 3: Output UI
            outputDiv.innerHTML = `
                <div class="space-y-4">
                    <div class="flex items-center justify-between">
                        <h4 class="font-bold text-lg font-heading" style="color: var(--primary);">${data.recommended_reaction}</h4>
                        <span class="px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700">Confidence: ${data.confidence_score}%</span>
                    </div>

                    <!-- Configuration Table -->
                    <div class="overflow-hidden rounded-lg border border-[var(--border-color)]">
                        <table class="w-full text-sm text-left">
                            <thead class="bg-[var(--bg-surface-alt)] text-xs uppercase text-muted-custom">
                                <tr>
                                    <th class="px-4 py-2">Variabel</th>
                                    <th class="px-4 py-2">Nilai Rekomendasi</th>
                                    <th class="px-4 py-2">Satuan</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-[var(--border-color)]">
                                <tr><td class="px-4 py-2 font-medium">Konsentrasi ${data.configuration.reactant_a}</td><td class="px-4 py-2 font-mono">${data.configuration.conc_a}</td><td class="px-4 py-2">${data.configuration.unit_conc}</td></tr>
                                <tr><td class="px-4 py-2 font-medium">Volume ${data.configuration.reactant_a}</td><td class="px-4 py-2 font-mono">${data.configuration.vol_a}</td><td class="px-4 py-2">${data.configuration.unit_vol}</td></tr>
                                <tr><td class="px-4 py-2 font-medium">Konsentrasi ${data.configuration.reactant_b}</td><td class="px-4 py-2 font-mono">${data.configuration.conc_b}</td><td class="px-4 py-2">${data.configuration.unit_conc}</td></tr>
                                <tr><td class="px-4 py-2 font-medium">Volume ${data.configuration.reactant_b}</td><td class="px-4 py-2 font-mono">${data.configuration.vol_b}</td><td class="px-4 py-2">${data.configuration.unit_vol}</td></tr>
                                <tr><td class="px-4 py-2 font-medium">Suhu</td><td class="px-4 py-2 font-mono">${data.configuration.temp}</td><td class="px-4 py-2">${data.configuration.unit_temp}</td></tr>
                                <tr><td class="px-4 py-2 font-medium">Tekanan</td><td class="px-4 py-2 font-mono">${data.configuration.pressure}</td><td class="px-4 py-2">${data.configuration.unit_press}</td></tr>
                            </tbody>
                        </table>
                    </div>

                    <!-- Prediksi Outcome -->
                    <div class="p-4 rounded-lg bg-[var(--primary)]/10 border border-[var(--primary)]/30">
                        <h5 class="font-bold text-sm mb-2" style="color: var(--primary);">🔮 Prediksi Outcome</h5>
                        <ul class="text-xs space-y-1 list-disc list-inside">
                            <li><b>Warna:</b> ${data.predicted_outcome.color}</li>
                            <li><b>Endapan:</b> ${data.predicted_outcome.precipitate || '-'}</li>
                            <li><b>Gas:</b> ${data.predicted_outcome.gas || '-'}</li>
                            <li><b>pH Akhir:</b> ${data.predicted_outcome.ph_final}</li>
                            <li><b>Laju Reaksi:</b> ${data.predicted_outcome.rate}</li>
                        </ul>
                    </div>

                    <button onclick="applyInverseRecommendation(${JSON.stringify(data.configuration).replace(/"/g, '&quot;')})" class="w-full py-2 rounded-lg btn-primary text-sm">
                        ▶ Terapkan ke Lab & Jalankan Simulasi
                    </button>
                </div>
            `;

        } catch (error) {
            outputDiv.innerHTML = `<div class="text-red-500 text-sm">Error: ${error.message}</div>`;
        }
    });
});

// Function to auto-fill the Lab Reaksi tab
function applyInverseRecommendation(config) {
    // Switch to Lab tab
    document.querySelector('[data-tab="lab"]').click();
    
    // Set values (You will need to map your select options correctly)
    document.getElementById('select-a').value = config.reactant_a;
    document.getElementById('select-b').value = config.reactant_b;
    
    // Note: You'll need to adjust slider logic here based on your min/max values
    // For example, if slider is 1-20 representing 0.1 - 2.0 M
    document.getElementById('m-a-slider').value = config.conc_a * 10; 
    document.getElementById('m-b-slider').value = config.conc_b * 10;
    document.getElementById('v-a-slider').value = config.vol_a;
    document.getElementById('v-b-slider').value = config.vol_b;
    document.getElementById('temp-slider').value = config.temp;
    
    // Update text displays
    document.getElementById('m-a-val').textContent = config.conc_a.toFixed(1) + ' M';
    document.getElementById('m-b-val').textContent = config.conc_b.toFixed(1) + ' M';
    document.getElementById('v-a-val').textContent = config.vol_a + ' mL';
    document.getElementById('v-b-val').textContent = config.vol_b + ' mL';
    document.getElementById('temp-val').textContent = config.temp + ' °C';
    
    // Trigger visual update
    if(typeof updateMacroColors === 'function') updateMacroColors();
    if(typeof generateParticles === 'function') generateParticles();
}