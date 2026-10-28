// js/ai-tutor.js

let chatRequestInFlight = false;
let chatTutorInitialized = false;

function escapeChatHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
    })[character]);
}

function getChatApiUrl(pathKey = 'CHAT', fallbackPath = '/api/chat') {
    const config = window.API_CONFIG || {};
    const baseUrl = String(config.BASE_URL || '').replace(/\/+$/, '');
    const endpoint = String(config[pathKey] || fallbackPath);
    const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    return baseUrl ? `${baseUrl}${normalizedEndpoint}` : '';
}

function setChatConnectionStatus(label, mode) {
    const status = document.getElementById('chat-connection-status');
    if (!status) return;

    status.textContent = label;
    status.dataset.mode = mode;
    status.title = mode === 'online'
        ? 'Tutor powered by Gemini via backend service.'
        : mode === 'fallback'
            ? 'Backend connected; Tutor using local chemistry knowledge base.'
            : 'Backend service offline.';
}

async function checkChatConnection() {
    const healthUrl = getChatApiUrl('HEALTH', '/api/health');
    if (!healthUrl) {
        setChatConnectionStatus('Offline', 'offline');
        return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 4000);
    try {
        const response = await fetch(healthUrl, { signal: controller.signal });
        if (!response.ok) throw new Error(`Health check ${response.status}`);
        const health = await response.json();
        const isGeminiActive = ['active', 'configured'].includes(health.chat_mode);
        setChatConnectionStatus(isGeminiActive ? 'AI Online' : 'Local Engine', isGeminiActive ? 'online' : 'fallback');
    } catch (error) {
        console.error('Chat health check failed:', error);
        setChatConnectionStatus('Offline', 'offline');
    } finally {
        window.clearTimeout(timeoutId);
    }
}

function addMessage(sender, text) {
    const chatWindow = document.getElementById('chat-window');
    if (!chatWindow) return;

    const div = document.createElement('div');
    div.className = sender === 'user' ? 'flex justify-end' : 'flex gap-2 items-start';
    const aiAvatar = '<div class="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0 font-heading" style="background-color: var(--primary);">AI</div>';
    const safeText = escapeChatHtml(text);

    if (sender === 'user') {
        div.innerHTML = `<div class="chat-bubble-user p-3 text-xs max-w-[85%]">${safeText}</div>`;
    } else {
        const htmlContent = typeof marked !== 'undefined' ? marked.parse(safeText) : safeText;
        div.innerHTML = `${aiAvatar}<div class="chat-bubble-ai p-3 text-xs max-w-[85%] leading-relaxed markdown-content">${htmlContent}</div>`;
    }

    chatWindow.appendChild(div);

    if (sender === 'ai' && typeof renderMathInElement === 'function') {
        const content = div.querySelector('.markdown-content');
        if (content) {
            renderMathInElement(content, {
                delimiters: [
                    { left: '$$', right: '$$', display: true },
                    { left: '$', right: '$', display: false }
                ],
                throwOnError: false
            });
        }
    }
    chatWindow.scrollTop = chatWindow.scrollHeight;
}

async function handleSend() {
    if (chatRequestInFlight) return;

    const chatInput = document.getElementById('chat-input');
    const chatWindow = document.getElementById('chat-window');
    const sendButton = document.getElementById('btn-send');
    if (!chatInput || !chatWindow) return;

    const text = chatInput.value.trim();
    if (!text) return;

    const apiUrl = getChatApiUrl();
    const abortController = new AbortController();
    const timeoutId = window.setTimeout(() => abortController.abort(), 20000);
    const loadingId = `loading-${Date.now()}`;

    chatRequestInFlight = true;
    if (sendButton) sendButton.disabled = true;
    addMessage('user', text);
    chatInput.value = '';

    const loadingDiv = document.createElement('div');
    loadingDiv.id = loadingId;
    loadingDiv.className = 'flex gap-2 items-start';
    loadingDiv.innerHTML = '<div class="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0 font-heading" style="background-color: var(--primary);">AI</div><div class="chat-bubble-ai p-3 text-xs max-w-[85%] leading-relaxed italic text-muted-custom">Analyzing chemistry reaction...</div>';
    chatWindow.appendChild(loadingDiv);
    chatWindow.scrollTop = chatWindow.scrollHeight;

    const labState = {
        reagentA: window.state?.reagentA || 'None',
        reagentB: window.state?.reagentB || 'None',
        temp: window.state?.temperature || 25,
        status: window.state?.isPouring
            ? 'Reacting'
            : (window.state?.isReacted ? 'Completed' : 'Not Run')
    };

    try {
        if (!apiUrl) throw new Error('API BASE_URL is not configured.');

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: text, lab_state: labState }),
            signal: abortController.signal
        });

        const responseText = await response.text();
        if (!response.ok) {
            let detail = responseText;
            try {
                detail = JSON.parse(responseText).detail || responseText;
            } catch (_) {
                // Keep a non-JSON response body for diagnostics.
            }
            throw new Error(`Server ${response.status}: ${detail || response.statusText}`);
        }

        let data;
        try {
            data = JSON.parse(responseText);
        } catch (_) {
            throw new Error('Server returned non-JSON response.');
        }

        if (typeof data.reply !== 'string' || !data.reply.trim()) {
            throw new Error('AI response contains no reply.');
        }

        setChatConnectionStatus(data.source === 'gemini' ? 'AI Online' : 'Local Engine', data.source === 'gemini' ? 'online' : 'fallback');
        addMessage('ai', data.reply);
    } catch (error) {
        console.error('Chat error:', error);
        setChatConnectionStatus('Offline', 'offline');
        const message = error.name === 'AbortError'
            ? 'AI did not respond within 20 seconds. Please try again.'
            : `Chat notice: ${error.message || 'unknown error'}`;
        addMessage('ai', message);
    } finally {
        window.clearTimeout(timeoutId);
        document.getElementById(loadingId)?.remove();
        chatRequestInFlight = false;
        if (sendButton) sendButton.disabled = false;
        chatInput.focus();
    }
}

function initializeChatTutor() {
    if (chatTutorInitialized) return;
    const sendButton = document.getElementById('btn-send');
    const chatInput = document.getElementById('chat-input');
    if (!sendButton || !chatInput) return;

    chatTutorInitialized = true;
    sendButton.addEventListener('click', handleSend);
    chatInput.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            event.preventDefault();
            handleSend();
        }
    });
    checkChatConnection();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeChatTutor, { once: true });
} else {
    initializeChatTutor();
}
