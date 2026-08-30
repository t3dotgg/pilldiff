const favicon = document.querySelector('#proposal-favicon');
const previewButtons = [...document.querySelectorAll('[data-preview]')];
const themeButtons = [...document.querySelectorAll('[data-artboard-theme]')];
const previewStatus = document.querySelector('#preview-status');
const resetPreview = document.querySelector('#reset-preview');
const initialFavicon = favicon.getAttribute('href');
const initialStatus = previewStatus.textContent;

function clearPreview() {
  favicon.setAttribute('href', initialFavicon);
  previewStatus.textContent = initialStatus;
  resetPreview.disabled = true;

  for (const button of previewButtons) {
    button.setAttribute('aria-pressed', 'false');
    button.textContent = 'Try in this tab';
  }
}

for (const button of previewButtons) {
  button.addEventListener('click', () => {
    const wasSelected = button.getAttribute('aria-pressed') === 'true';
    clearPreview();

    if (wasSelected) return;

    favicon.setAttribute('href', button.dataset.preview);
    button.setAttribute('aria-pressed', 'true');
    button.textContent = 'Previewing in this tab';
    previewStatus.textContent = `${button.dataset.name} is in this tab. The player is unchanged.`;
    resetPreview.disabled = false;
  });
}

for (const button of themeButtons) {
  button.addEventListener('click', () => {
    document.documentElement.dataset.artboard = button.dataset.artboardTheme;

    for (const themeButton of themeButtons) {
      themeButton.setAttribute('aria-pressed', String(themeButton === button));
    }
  });
}

resetPreview.addEventListener('click', () => {
  const selectedButton = previewButtons.find((button) => button.getAttribute('aria-pressed') === 'true');
  clearPreview();
  selectedButton?.focus();
});

for (const element of document.querySelectorAll('[data-enhance]')) {
  element.hidden = false;
}
