document.addEventListener('DOMContentLoaded', () => {
    const invButtons = document.querySelectorAll('.inv-btn');

    const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
    })[character]);

    invButtons.forEach(button => {
        button.addEventListener('click', async function() {
            const goal = this.dataset.goal?.trim();
            const outputDiv = document.getElementById('inv-output');

            if (!outputDiv) {
                console.error('Element #inv-output tidak ditemukan.');
                return;
            }

            if (!goal) {
                outputDiv.innerHTML = `
                    <div class="p-4 rounded-lg border border-red-200 bg-red-50 text-red-700">
                        Goal eksperimen tidak valid.
                    </div>
                `;
                return;
            }

            const apiConfig = window.API_CONFIG || {};
            const baseUrl = String(apiConfig.BASE_URL || '').replace(/\/+$/, '');
            const endpoint = String(apiConfig.INVERSE || '/api/inverse-experiment');
            const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
            const apiUrl = `${baseUrl}${normalizedEndpoint}`;
            const abortController = new AbortController();
            const timeoutId = window.setTimeout(() => abortController.abort(), 25000);

            invButtons.forEach(item => { item.disabled = true; });
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
                if (!baseUrl) {
                    throw new Error('API BASE_URL belum dikonfigurasi.');
                }

                console.log('Mengirim inverse request ke:', apiUrl);

                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ goal, constraints: {} }),
                    signal: abortController.signal
                });

                const responseText = await response.text();

                if (!response.ok) {
                    let detail = responseText;
                    try {
                        detail = JSON.parse(responseText).detail || responseText;
                    } catch (_) {
                        // Keep the plain response body when it is not JSON.
                    }
                    throw new Error(`Server ${response.status}: ${detail || response.statusText}`);
                }

                let data;
                try {
                    data = JSON.parse(responseText);
                } catch (_) {
                    throw new Error('Server mengembalikan respons yang bukan JSON valid.');
                }

                if (!data.configuration || !data.recommended_reaction) {
                    throw new Error('Struktur respons server tidak lengkap.');
                }

                const configuration = data.configuration;
                outputDiv.innerHTML = `
                    <div class="space-y-4">
                        <div class="flex items-center justify-between gap-3">
                            <h4 class="font-bold text-lg font-heading" style="color: var(--primary);">${escapeHtml(data.recommended_reaction)}</h4>
                            <span class="px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700">Confidence: ${escapeHtml(data.confidence_score)}%</span>
                        </div>
                        <div class="p-4 rounded-lg bg-[var(--bg-surface-alt)] border border-[var(--border-color)]">
                            <h5 class="font-bold text-sm mb-2 font-heading">Konfigurasi Optimal:</h5>
                            <div class="grid grid-cols-2 gap-3 text-sm">
                                <div><span class="text-muted-custom block text-xs">Reaktan A</span><div class="font-mono font-semibold">${escapeHtml(configuration.reactant_a)} ${escapeHtml(configuration.conc_a)}M, ${escapeHtml(configuration.vol_a)}mL</div></div>
                                <div><span class="text-muted-custom block text-xs">Reaktan B</span><div class="font-mono font-semibold">${escapeHtml(configuration.reactant_b)} ${escapeHtml(configuration.conc_b)}M, ${escapeHtml(configuration.vol_b)}mL</div></div>
                                <div><span class="text-muted-custom block text-xs">Suhu</span><div class="font-mono font-semibold">${escapeHtml(configuration.temp)}°C</div></div>
                            </div>
                        </div>
                        <div class="text-xs text-muted-custom italic leading-relaxed">${escapeHtml(data.explanation)}</div>
                    </div>
                `;
            } catch (error) {
                console.error('Inverse experiment error:', error);

                const timedOut = error.name === 'AbortError';
                const errorMessage = timedOut
                    ? 'Server tidak merespons dalam 25 detik.'
                    : (error.message || 'Terjadi kesalahan yang tidak diketahui.');

                outputDiv.innerHTML = `
                    <div class="p-4 bg-[var(--bg-surface-alt)] border border-[var(--danger)] rounded-lg" style="color: var(--danger);">
                        <div class="font-bold">Eksperimen gagal diproses</div>
                        <div class="text-sm">${escapeHtml(errorMessage)}</div>
                        <div class="text-xs mt-2">Endpoint: ${escapeHtml(apiUrl)}</div>
                    </div>
                `;
            } finally {
                window.clearTimeout(timeoutId);
                invButtons.forEach(item => { item.disabled = false; });
            }
        });
    });
});
