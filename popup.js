// popup.js – BlindBug popup logic + Stripe checkout + license activation

// ============================================================
// STRIPE CONFIGURATION
// Replace these with your actual Stripe Payment Link URLs
// Create them at: https://dashboard.stripe.com/payment-links
// ============================================================
const STRIPE_LINKS = {
  monthly: 'https://buy.stripe.com/dRm5kEd5nfDf56o5jxao80f',
  lifetime: 'https://buy.stripe.com/00w3cwghzfDfgP6h2fao80g'
};

document.addEventListener('DOMContentLoaded', () => {
  // ---- DOM refs ----
  const toggle = document.getElementById('bb-toggle');
  const badge = document.getElementById('bb-badge');
  const pricing = document.getElementById('bb-pricing');
  const stripeBadge = document.getElementById('bb-stripe-badge');
  const licenseSection = document.getElementById('bb-license-section');
  const licenseToggle = document.getElementById('bb-license-toggle');
  const licenseForm = document.getElementById('bb-license-form');
  const licenseInput = document.getElementById('bb-license-input');
  const licenseActivateBtn = document.getElementById('bb-license-activate');
  const licenseMsg = document.getElementById('bb-license-msg');
  const activatedBanner = document.getElementById('bb-activated');
  const activatedPlan = document.getElementById('bb-activated-plan');
  const deactivateLink = document.getElementById('bb-deactivate');

  // ---- Toggle (enable/disable) ----
  chrome.storage?.local?.get('blindbugEnabled', (data) => {
    const enabled = data.blindbugEnabled !== false;
    toggle.classList.toggle('active', enabled);
  });

  toggle.addEventListener('click', () => {
    const isActive = toggle.classList.toggle('active');
    chrome.storage?.local?.set({ blindbugEnabled: isActive });
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'blindbug-toggle',
          enabled: isActive
        });
      }
    });
  });

  // ---- Load license state ----
  function refreshLicenseUI() {
    chrome.storage?.local?.get(['blindbugLicense', 'blindbugPlan'], (data) => {
      if (data.blindbugLicense) {
        showActivatedState(data.blindbugPlan || 'Professional');
      } else {
        showFreeState();
      }
    });
  }

  function showActivatedState(plan) {
    badge.textContent = plan.toUpperCase();
    badge.className = 'badge pro';
    pricing.classList.add('hidden');
    stripeBadge.classList.add('hidden');
    licenseSection.classList.add('hidden');
    activatedBanner.classList.remove('hidden');
    activatedPlan.textContent = plan;
  }

  function showFreeState() {
    badge.textContent = 'FREE';
    badge.className = 'badge free';
    pricing.classList.remove('hidden');
    stripeBadge.classList.remove('hidden');
    licenseSection.classList.remove('hidden');
    activatedBanner.classList.add('hidden');
  }

  refreshLicenseUI();

  // ---- Stripe checkout (Buy Now buttons) ----
  document.querySelectorAll('.plan-buy').forEach((btn) => {
    btn.addEventListener('click', () => {
      const plan = btn.dataset.plan;
      const url = STRIPE_LINKS[plan];
      if (url && !url.includes('YOUR_')) {
        chrome.tabs.create({ url });
      } else {
        showLicenseMsg('Stripe not configured yet. Use a license key below.', 'error');
      }
    });
  });

  // ---- License key section ----
  licenseToggle.addEventListener('click', () => {
    licenseForm.classList.toggle('show');
    licenseInput.focus();
  });

  licenseActivateBtn.addEventListener('click', () => activateLicense());
  licenseInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') activateLicense();
  });

  function activateLicense() {
    const key = licenseInput.value.trim();
    if (!key) {
      showLicenseMsg('Please enter a license key.', 'error');
      return;
    }

    // Determine plan from key format (simple heuristic)
    // Keys starting with 'ST-' = Startup, everything else = Professional
    const plan = key.toUpperCase().startsWith('ST-') ? 'Startup' : 'Professional';

    // Store the license
    chrome.storage?.local?.set({
      blindbugLicense: key,
      blindbugPlan: plan
    }, () => {
      showLicenseMsg('License activated!', 'success');
      setTimeout(() => refreshLicenseUI(), 600);
    });
  }

  function showLicenseMsg(text, type) {
    licenseMsg.textContent = text;
    licenseMsg.className = 'license-msg ' + type;
    clearTimeout(licenseMsg._timer);
    licenseMsg._timer = setTimeout(() => {
      licenseMsg.textContent = '';
      licenseMsg.className = 'license-msg';
    }, 4000);
  }

  // ---- Deactivate license ----
  deactivateLink.addEventListener('click', () => {
    chrome.storage?.local?.remove(['blindbugLicense', 'blindbugPlan'], () => {
      refreshLicenseUI();
    });
  });
});
