// ==========================================
// AI ADAPTIVE TUTOR LOGIC
// ==========================================

function addMessage(sender, text) {
    const div = document.createElement('div'); 
    div.className = sender === 'user' ? 'flex justify-end' : 'flex gap-2 items-start';
    
    const aiAvatar = `<div class="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0 font-heading" style="background-color: var(--success);">AI</div>`;
    const userBubble = `<div class="chat-bubble-user p-3 text-xs max-w-[85%]">${escapeHtml(text)}</div>`;
    
    // Parse Markdown to HTML
    let htmlContent = marked.parse(text);
    
    // FIX: Manually convert LaTeX delimiters if auto-render fails
    htmlContent = htmlContent
        .replace(/\$\$(.*?)\$\$/g, '<div class="katex-display"><span class="katex">$1</span></div>')
        .replace(/\$(.*?)\$/g, '<span class="katex">$1</span>');
    
    const aiBubble = `<div class="chat-bubble-ai p-3 text-xs max-w-[85%] leading-relaxed markdown-content">${htmlContent}</div>`;
    
    div.innerHTML = sender === 'user' ? userBubble : aiAvatar + aiBubble;
    els.chatWindow.appendChild(div); 
    
    // Render KaTeX manually
    if (sender === 'ai') {
        const contentDiv = div.querySelector('.markdown-content');
        if (contentDiv && typeof renderMathInElement === 'function') {
            renderMathInElement(contentDiv, {
                delimiters: [
                    {left: '$$', right: '$$', display: true},
                    {left: '$', right: '$', display: false},
                    {left: '\\(', right: '\\)', display: false},
                    {left: '\\[', right: '\\]', display: true}
                ],
                throwOnError: false,
                strict: false
            });
        }
    }
    
    els.chatWindow.scrollTop = els.chatWindow.scrollHeight;
}

// Helper function to escape HTML in user input
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

async function handleSend() {
    const text = els.chatInput.value.trim(); 
    if (!text) return;
    
    addMessage('user', text); 
    els.chatInput.value = '';
    
    // Show temporary loading state
    const loadingId = 'loading-' + Date.now();
    const loadingDiv = document.createElement('div');
    loadingDiv.id = loadingId;
    loadingDiv.className = 'flex gap-2 items-start';
    loadingDiv.innerHTML = `<div class="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0 font-heading" style="background-color: var(--success);">AI</div><div class="chat-bubble-ai p-3 text-xs max-w-[85%] leading-relaxed italic text-muted-custom">Sedang menganalisis data eksperimen...</div>`;
    els.chatWindow.appendChild(loadingDiv);
    els.chatWindow.scrollTop = els.chatWindow.scrollHeight;

    const labState = {
        reagentA: state.reagentA,
        reagentB: state.reagentB,
        temp: state.temperature,
        status: state.isReacted ? "Sedang Bereaksi / Selesai" : "Belum dijalankan"
    };

    try {
        const response = await fetch('http://127.0.0.1:8000/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: text, lab_state: labState })
        });

        if (!response.ok) throw new Error("Backend error");
        
        const data = await response.json();
        document.getElementById(loadingId).remove();
        addMessage('ai', data.reply);

    } catch (error) {
        console.warn("Backend offline, using fallback:", error);
        await new Promise(r => setTimeout(r, 800));
        document.getElementById(loadingId).remove();
        
        let res = getReactionResult(); 
        let reply = "";
        
        if(text.toLowerCase().includes('endapan')) { 
            reply = res.ppt ? `Ya, kombinasi ini menghasilkan endapan **${res.ppt}**. Perhatikan partikel yang jatuh ke dasar!` : "Kombinasi ini tidak menghasilkan endapan."; 
        } else if(text.toLowerCase().includes('suhu') || text.toLowerCase().includes('panas')) { 
            reply = "Menaikkan suhu meningkatkan energi kinetik partikel. Mereka bergerak lebih cepat, memperbesar peluang tumbukan efektif. 🔥"; 
        } else {
            reply = "Coba tanyakan tentang endapan, suhu, atau apa yang terjadi pada reaksi ini! 🧪";
        }
        
        addMessage('ai', reply + " <br><br><i>(Catatan: AI Backend sedang offline, menggunakan respons lokal)</i>");
    }
}
