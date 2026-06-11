// Montaje de la demo en archivo aparte: la CSP de helmet (script-src 'self') no permite
// scripts inline, asi que aqui vive la logica que crea el <ledesma-agent>.
const form = document.getElementById('mount-form');
const slot = document.getElementById('widget-slot');

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const agentId = document.getElementById('agent-id').value.trim();
  const providerKey = document.getElementById('provider-key').value.trim();
  if (agentId === '') return;

  const widget = document.createElement('ledesma-agent');
  widget.setAttribute('endpoint', `${window.location.origin}/v1/run/${agentId}`);
  if (providerKey !== '') widget.setAttribute('provider-key', providerKey);
  widget.setAttribute('title', 'Agente');
  slot.replaceChildren(widget);
});
