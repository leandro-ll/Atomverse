// js/ai-tutor.js

function addMessage(sender, text) {
    const chatWindow = document.getElementById('chat-window');
    if (!chatWindow) return;

    const div = document.createElement('div'); 
    div.className = sender === 'user' ? 'flex justify-end' : 'flex gap-2 items-start';
    
    const aiAvatar = `<div class="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0 font-heading" style="background-color: var(--success);">AI</div>`;
    const userBubble = `<div class="chat-bubble-user p-3 text-xs max-w-[85%]">${text}</div>`;
    
    let htmlContent = text;
    if (sender === 'ai' && typeof marked !== 'undefined') {
        htmlContent = marked.parse(text);
    }
    
    const aiBubble = `<div class="chat-bubble-ai p-3 text-xs max-w-[85%] leading-relaxed markdown-content">${htmlContent}</div>`;
    
    div.innerHTML = sender === 'user' ? userBubble : aiAvatar + aiBubble;
    chatWindow.appendChild(div); 
    
    if (sender === 'ai' && typeof renderMathInElement === 'function') {
        renderMathInElement(div.querySelector('.markdown-content'), {
            delimiters: [
                {left: '$$', right: '$$', display: true},
                {left: '$', right: '$', display: false}
            ],
            throwOnError: false
        });
    }
    
    chatWindow.scrollTop = chatWindow.scrollHeight;
}

async function handleSend() {
    const chatInput = document.getElementById('chat-input');
    if (!chatInput) return;
    
    const text = chatInput.value.trim(); 
    if (!text) return;
    
    addMessage('user', text); 
    chatInput.value = '';
    
    const chatWindow = document.getElementById('chat-window');
    const loadingId = 'loading-' + Date.now();
    const loadingDiv = document.createElement('div');
    loadingDiv.id = loadingId;
    loadingDiv.className = 'flex gap-2 items-start';
    loadingDiv.innerHTML = `<div class="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0 font-heading" style="background-color: var(--success);">AI</div><div class="chat-bubble-ai p-3 text-xs max-w-[85%] leading-relaxed italic text-muted-custom">Sedang menganalisis...</div>`;
    chatWindow.appendChild(loadingDiv);
    chatWindow.scrollTop = chatWindow.scrollHeight;

    const labState = {
        reagentA: window.state?.reagentA || 'None',
        reagentB: window.state?.reagentB || 'None',
        temp: window.state?.temperature || 25,
        status: window.state?.isReacted ? "Sedang Bereaksi" : "Belum dijalankan"
    };

    try {
        const apiUrl = typeof API_CONFIG !== 'undefined' 
            ? `${API_CONFIG.BASE_URL}${API_CONFIG.CHAT}` 
            : 'https://atomverse-backend-production.up.railway.app/api/chat';

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: text, lab_state: labState })
        });

        document.getElementById(loadingId)?.remove();

        if (!response.ok) throw new Error("Backend error");
        
        const data = await response.json();
        addMessage('ai', data.reply);

    } catch (error) {
        console.error("Chat error:", error);
        document.getElementById(loadingId)?.remove();
        addMessage('ai', "Maaf, terjadi kesalahan koneksi ke AI. Pastikan backend berjalan.");
    }
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    const btnSend = document.getElementById('btn-send');
    const chatInput = document.getElementById('chat-input');
    
    if (btnSend) btnSend.onclick = handleSend;
    if (chatInput) {
        chatInput.addEventListener('keypress', (e) => { 
            if (e.key === 'Enter') handleSend(); 
        });
    }
});