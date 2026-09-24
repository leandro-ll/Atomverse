const isLocalDevelopment = ['localhost', '127.0.0.1'].includes(window.location.hostname);

window.API_CONFIG = {
    BASE_URL: isLocalDevelopment
        ? 'http://localhost:8000'
        : 'https://atomverse-backend-production.up.railway.app',
    CHAT: '/api/chat',
    HEALTH: '/api/health',
    INVERSE: '/api/inverse-experiment'
};
