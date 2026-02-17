// popup.js – BlindBug popup logic

document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('bb-toggle');

  // Load saved state
  chrome.storage?.local?.get('blindbugEnabled', (data) => {
    const enabled = data.blindbugEnabled !== false; // default on
    toggle.classList.toggle('active', enabled);
  });

  toggle.addEventListener('click', () => {
    const isActive = toggle.classList.toggle('active');

    // Persist state
    chrome.storage?.local?.set({ blindbugEnabled: isActive });

    // Send toggle message to content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'blindbug-toggle',
          enabled: isActive
        });
      }
    });
  });
});
