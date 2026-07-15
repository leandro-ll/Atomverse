// js/inverse-experiment.js

document.addEventListener('DOMContentLoaded', () => {
    const invButtons = document.querySelectorAll('.inv-btn');
    
    invButtons.forEach(btn => {
        btn.addEventListener('click', async function() {
            const goal = this.dataset.goal;
            const outputDiv = document.getElementById('inv-output');
            
            // PENGAMAN: Jika elemen tidak ditemukan, berhenti di sini
            if (!outputDiv) {
                console.error('❌ ERROR: Element inv-output TIDAK DITEMUKAN di HTML!');
                return;
            }
            
            // Tampilkan loading
            outputDiv.innerHTML = `
                <div class="flex items-center gap-3 p-4">
                    <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-[var(--primary)]"></div>
                    <div>
                        <div class="font-bold">AI sedang menganalisis...</div>
                        <div class="text-xs text-muted-custom">Mencari konfigurasi optimal</div>
                    </div>
                </div>
            `;
            
            try {
                // Ambil URL dari config, atau gunakan fallback jika config belum terbaca
                const baseUrl = (typeof API_CONFIG !== 'undefined' && API_CONFIG.BASE_URL) 
                    ? API_CONFIG.BASE_URL 
                    : 'https://atomverse-backend-production.up.railway.app';
                    
                const endpoint = (typeof API_CONFIG !== 'undefined' && API_CONFIG.INVERSE) 
                    ? API_CONFIG.INVERSE 
                    : '/api/inverse-experiment';

                // Gabungkan URL dengan benar (tanpa double slash)
                const cleanBaseUrl = baseUrl.replace(/\/+$/, ''); // Hapus slash di akhir jika ada
                const apiUrl = `${cleanBaseUrl}${endpoint}`;

                console.log('📤 Mengirim request ke:', apiUrl);

                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ goal: goal, constraints: {} })
                });
                
                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`Server error: ${response.status} - ${errorText}`);
                }
                
                const data = await response.json();
                console.log('✅ Data diterima:', data);
                
                // Tampilkan hasil
                outputDiv.innerHTML = `
                    <div class="space-y-4">
                        <div class="flex items-center justify-between">
                            <h4 class="font-bold text-lg font-heading" style="color: var(--primary);">${data.recommended_reaction}</h4>
                            <span class="px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700">Confidence: ${data.confidence_score}%</span>
                        </div>
                        <div class="p-4 rounded-lg bg-[var(--bg-surface-alt)] border border-[var(--border-color)]">
                            <h5 class="font-bold text-sm mb-2 font-heading">Konfigurasi Optimal:</h5>
                            <div class="grid grid-cols-2 gap-3 text-sm">
                                <div><span class="text-muted-custom block text-xs">Reaktan A</span><div class="font-mono font-semibold">${data.configuration.reactant_a} ${data.configuration.conc_a}M, ${data.configuration.vol_a}mL</div></div>
                                <div><span class="text-muted-custom block text-xs">Reaktan B</span><div class="font-mono font-semibold">${data.configuration.reactant_b} ${data.configuration.conc_b}M, ${data.configuration.vol_b}mL</div></div>
                                <div><span class="text-muted-custom block text-xs">Suhu</span><div class="font-mono font-semibold">${data.configuration.temp}°C</div></div>
                            </div>
                        </div>
                        <div class="text-xs text-muted-custom italic leading-relaxed">${data.explanation || ''}</div>
                    </div>
                `;
                
            } catch (error) {
                console.error('❌ Fetch error:', error);
                outputDiv.innerHTML = `
                    <div class="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400">
                        <div class="font-bold">Error:</div>
                        <div class="text-sm">${error.message}</div>
                        <div class="text-xs mt-2">Pastikan backend Railway berjalan dan API Key sudah diisi.</div>
                    </div>
                `;
            }
        });
    });
});