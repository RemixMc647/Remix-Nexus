(function(){
  const params = new URLSearchParams(window.location.search);
  const type = params.get('type') || '';
  const id = params.get('id') || '';

  // Build the backend URL in a way that works on Render and locally.
  // On Render, the backend and static files are usually served from the same origin.
  // Fallback to localhost for local/dev usage.
  const origin = window.location && window.location.origin ? window.location.origin : '';
  const base = origin || 'http://localhost:3000';
  const url = `${base}/download?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`;



  const status = document.getElementById('status');
  const fallback = document.getElementById('fallback');

  const metaType = document.getElementById('meta-type');
  const metaId = document.getElementById('meta-id');

  if (metaType) metaType.textContent = type || '—';
  if (metaId) metaId.textContent = id || '—';

  if (fallback) fallback.href = url;
  if (status) status.textContent = `Downloading…`;

  const win = window.open(url, '_blank');
  if (!win) {
    window.location.href = url;
    return;
  }

  const state = document.getElementById('download-state');
  const stateTitle = state ? state.querySelector('.download-state-title') : null;

  // Note: browsers can't reliably confirm when a file download is finished
  // (especially via direct link downloads). Avoid showing a fake success message.
})();





