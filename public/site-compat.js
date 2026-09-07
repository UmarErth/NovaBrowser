// Brave's client-side search handler can fail inside a rewritten document.
// Keep its ordinary GET search usable even when that handler does not initialize.
(() => {
  function search(input) {
    const query = input.value.trim();
    if (!query) return;
    location.href = __uv$config.prefix + __uv$config.encodeUrl('https://search.brave.com/search?q=' + encodeURIComponent(query));
  }
  document.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.isComposing || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey ||
        !event.target.matches('input[name="q"], textarea[name="q"]')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    search(event.target);
  }, true);
  document.addEventListener('submit', event => {
    const input = event.target.querySelector('input[name="q"], textarea[name="q"]');
    if (!input) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    search(input);
  }, true);
})();
