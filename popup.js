// popup.js – BlindBug popup logic

document.addEventListener('DOMContentLoaded', () => {
  const powerBtn = document.getElementById('bb-power');
  const powerLabel = document.getElementById('bb-power-label');
  const powerStatus = document.getElementById('bb-power-status');

  function updateUI(enabled) {
    if (enabled) {
      powerBtn.className = 'power-btn on';
      powerLabel.textContent = 'Turn Off BlindBug';
      powerStatus.textContent = 'BlindBug is active on all pages';
    } else {
      powerBtn.className = 'power-btn off';
      powerLabel.textContent = 'Turn On BlindBug';
      powerStatus.textContent = 'BlindBug is hidden on all pages';
    }
  }

  // Load saved state (default ON)
  chrome.storage?.local?.get('blindbugEnabled', (data) => {
    const enabled = data.blindbugEnabled !== false;
    updateUI(enabled);
  });

  powerBtn.addEventListener('click', () => {
    chrome.storage?.local?.get('blindbugEnabled', (data) => {
      const wasEnabled = data.blindbugEnabled !== false;
      const nowEnabled = !wasEnabled;

      chrome.storage.local.set({ blindbugEnabled: nowEnabled });
      updateUI(nowEnabled);

      // Notify all tabs
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach((tab) => {
          if (tab.id) {
            chrome.tabs.sendMessage(tab.id, {
              type: 'blindbug-toggle',
              enabled: nowEnabled
            }).catch(() => {}); // ignore tabs without content script
          }
        });
      });
    });
  });

  // ---- Request a Feature ----
  document.getElementById('bb-feature-req').addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://forms.gle/Udyvmu4zc48qMqqi8' });
  });

  // ---- Support toggle ----
  document.getElementById('bb-support-btn').addEventListener('click', () => {
    document.getElementById('bb-support-panel').classList.toggle('show');
  });
});
