// =============================================================================
// KOT-ScanDeck: Globally Synchronized Shipment Auditor Engine (auditor.js)
// =============================================================================

window.KOT_AuditorModule = (function () {
  // CONFIG: Put your Supabase project credentials here
  const SUPABASE_CONFIG = {
    url: 'https://pjlkrgqzghndndasdxik.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBqbGtyZ3F6Z2huZG5kYXNkeGlrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3MTk5MzcsImV4cCI6MjA5ODI5NTkzN30.V0CDT9JQwXtVeMOxrbvD5TD4nEX30F_cM-EX6WqIzAI',
    pollIntervalMs: 8000 // Automatically syncs across all devices every 8s
  };

  let auditorTargetSet = new Set();
  let auditorFoundSet = new Set();
  let enableAuditorAlarm = true;
  let lastAuditorAlertTime = 0;
  let currentShadowRoot = null;
  let syncTimer = null;

  // 1. Fetch Global TIDs from Cloud Database
  async function fetchGlobalTids() {
    if (!SUPABASE_CONFIG.url || SUPABASE_CONFIG.url.includes('YOUR_PROJECT_ID')) {
      console.warn('[Auditor] Supabase URL not configured.');
      return;
    }

    try {
      const response = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/auditor_targets?select=tracking_id`, {
        headers: {
          'apikey': SUPABASE_CONFIG.anonKey,
          'Authorization': `Bearer ${SUPABASE_CONFIG.anonKey}`
        }
      });

      if (!response.ok) throw new Error('Failed to fetch from cloud');

      const data = await response.json();
      const newTids = new Set(data.map(item => item.tracking_id.trim().toUpperCase()));

      // Update in-memory set
      auditorTargetSet = newTids;

      // Update local storage backup
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ auditor_target_tids: Array.from(auditorTargetSet) });
      }

      updateAuditorUi();
    } catch (err) {
      console.error('[Auditor Cloud Sync Error]', err);
    }
  }

  // Initial fetch and start background polling for all devices
  fetchGlobalTids();
  if (syncTimer) clearInterval(syncTimer);
  syncTimer = setInterval(fetchGlobalTids, SUPABASE_CONFIG.pollIntervalMs);

  // 2. High 3-Beep Noticeable Warning Alarm (2400Hz + 1600Hz)
  function playAuditorPiercingAlarm() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.16, 0.32].forEach(startOffset => {
        [2400, 1600].forEach(freq => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'square';
          
          const t = ctx.currentTime + startOffset;
          osc.frequency.setValueAtTime(freq, t);
          
          gain.gain.setValueAtTime(0.35, t);
          gain.gain.setValueAtTime(0.35, t + 0.10);
          gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
          
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(t);
          osc.stop(t + 0.12);
        });
      });
    } catch (e) {
      console.warn('[Auditor] Audio alert failed:', e);
    }
  }

  // 3. Inspect Live DOM Scans
  function inspectPageForAuditedTids() {
    if (!enableAuditorAlarm || auditorTargetSet.size === 0) return;

    const pageText = (document.body.innerText || document.body.textContent || '').toUpperCase();

    for (const tid of auditorTargetSet) {
      if (pageText.includes(tid)) {
        const now = Date.now();
        if (!auditorFoundSet.has(tid) || (now - lastAuditorAlertTime > 2000)) {
          lastAuditorAlertTime = now;
          auditorFoundSet.add(tid);
          playAuditorPiercingAlarm();
          console.warn(`🎯 [AUDITOR HIT] Missing shipment found on screen: ${tid}`);
          updateAuditorUi();
        }
      }
    }
  }

  const observer = new MutationObserver(() => inspectPageForAuditedTids());
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });

  // 4. Mount into ScanDeck UI
  function mount(shadowRoot) {
    if (!shadowRoot || shadowRoot.getElementById('tab-btn-auditor')) return;
    currentShadowRoot = shadowRoot;

    const tabBar = shadowRoot.querySelector('.tab-bar');
    const panelBody = shadowRoot.querySelector('#panel-body');
    if (!tabBar || !panelBody) return;

    const auditorBtn = document.createElement('button');
    auditorBtn.id = 'tab-btn-auditor';
    auditorBtn.className = 'tab-btn';
    auditorBtn.innerHTML = '🔍 Auditor';
    tabBar.appendChild(auditorBtn);

    const auditorContent = document.createElement('div');
    auditorContent.id = 'tab-content-auditor';
    auditorContent.className = 'tab-content hidden-tab';
    auditorContent.innerHTML = `
      <div style="background:#ecfeff; border:1px solid #a5f3fc; border-radius:6px; padding:6px; display:flex; flex-direction:column; gap:4px;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span style="font-size:8.5px; font-weight:700; color:#0891b2;">🎯 Global Shipment Auditor</span>
          <label style="cursor:pointer; display:flex; align-items:center; gap:3px; font-size:7.5px; font-weight:700; color:#0e7490;">
            <input type="checkbox" id="auditor-alarm-chk" ${enableAuditorAlarm ? 'checked' : ''} /> ALARM
          </label>
        </div>
        <p style="font-size:7.5px; color:#155e75; margin:0;">Cloud-synchronized. Alerts when missing TIDs are scanned.</p>
      </div>

      <div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:2px;">
          <label style="font-size:8px; font-weight:700; color:#64748b;">Global Missing Queue (Cloud)</label>
          <span id="auditor-counter" style="font-size:8px; font-weight:700; color:#0891b2;">${auditorFoundSet.size}/${auditorTargetSet.size} Detected</span>
        </div>
        <textarea id="auditor-input" readonly style="height:45px; font-size:9px; width:100%; border:1px solid #cbd5e1; border-radius:5px; padding:4px; font-family:monospace; background:#f8fafc;" placeholder="Loading from cloud...">${Array.from(auditorTargetSet).join('\n')}</textarea>
      </div>

      <div style="display:flex; gap:4px;">
        <button id="auditor-refresh-btn" class="btn btn-secondary" style="padding:4px; font-size:8px; flex:1.2; font-weight:700; background:#e0f2fe; color:#0369a1; border-color:#bae6fd;">🔄 Force Sync</button>
        <button id="auditor-test-sound" class="btn btn-secondary" style="padding:4px; font-size:8px; flex:1;">🔊 Test Alarm</button>
      </div>

      <!-- ACTIVE TIDS PREVIEW LIST -->
      <div style="display:flex; flex-direction:column; gap:2px;">
        <label style="font-size:7.5px; font-weight:700; color:#64748b;">Active Monitored Queue:</label>
        <div id="auditor-active-badges" style="max-height:55px; overflow-y:auto; background:#f8fafc; border:1px solid #e2e8f0; border-radius:4px; padding:4px; font-size:8px; font-family:monospace; display:flex; flex-wrap:wrap; gap:3px;">
          ${renderActiveBadges()}
        </div>
      </div>

      <!-- FOUND SHIPMENTS STATUS -->
      <div style="display:flex; flex-direction:column; gap:2px;">
        <label style="font-size:7.5px; font-weight:700; color:#059669;">Found Shipments:</label>
        <div id="auditor-found-list" style="max-height:45px; overflow-y:auto; background:#f0fdf4; border:1px solid #bbf7d0; border-radius:4px; padding:4px; font-size:8px; font-family:monospace; color:#15803d;">
          ${renderFoundList()}
        </div>
      </div>
    `;
    panelBody.appendChild(auditorContent);

    // Tab Switcher
    function switchToTab(targetBtn, targetContent) {
      const allButtons = shadowRoot.querySelectorAll('.tab-btn');
      const allContents = shadowRoot.querySelectorAll('.tab-content');

      allButtons.forEach(btn => btn.classList.remove('active', 'rs-active'));
      allContents.forEach(content => content.classList.add('hidden-tab'));

      targetBtn.classList.add('active');
      targetContent.classList.remove('hidden-tab');
    }

    auditorBtn.addEventListener('click', () => switchToTab(auditorBtn, auditorContent));

    const scannerTabBtn = shadowRoot.querySelector('#tab-btn-scanner');
    const scannerTabContent = shadowRoot.querySelector('#tab-content-scanner');
    if (scannerTabBtn && scannerTabContent) {
      scannerTabBtn.addEventListener('click', () => switchToTab(scannerTabBtn, scannerTabContent));
    }

    const runsheetTabBtn = shadowRoot.querySelector('#tab-btn-runsheet');
    const runsheetTabContent = shadowRoot.querySelector('#tab-content-runsheet');
    if (runsheetTabBtn && runsheetTabContent) {
      runsheetTabBtn.addEventListener('click', () => {
        switchToTab(runsheetTabBtn, runsheetTabContent);
        runsheetTabBtn.classList.add('rs-active');
      });
    }

    const chk = shadowRoot.getElementById('auditor-alarm-chk');
    const testBtn = shadowRoot.getElementById('auditor-test-sound');
    const refreshBtn = shadowRoot.getElementById('auditor-refresh-btn');

    chk.addEventListener('change', () => {
      enableAuditorAlarm = chk.checked;
    });

    testBtn.addEventListener('click', () => playAuditorPiercingAlarm());

    refreshBtn.addEventListener('click', async () => {
      refreshBtn.textContent = '⏳ Syncing...';
      await fetchGlobalTids();
      refreshBtn.textContent = '✅ Synced!';
      setTimeout(() => { refreshBtn.textContent = '🔄 Force Sync'; }, 1500);
    });

    updateAuditorUi();
  }

  function renderActiveBadges() {
    if (auditorTargetSet.size === 0) return '<span style="color:#94a3b8;">No TIDs in cloud</span>';
    return Array.from(auditorTargetSet).map(tid => {
      const isFound = auditorFoundSet.has(tid);
      return `<span style="background:${isFound ? '#bbf7d0' : '#e2e8f0'}; color:${isFound ? '#15803d' : '#334155'}; padding:1px 3px; border-radius:3px; border:1px solid ${isFound ? '#86efac' : '#cbd5e1'}; font-weight:bold;">${tid}</span>`;
    }).join(' ');
  }

  function renderFoundList() {
    if (auditorFoundSet.size === 0) return '<span style="color:#94a3b8;">None detected yet</span>';
    return Array.from(auditorFoundSet).map(id => `✅ Found: ${id}`).join('<br>');
  }

  function updateAuditorUi() {
    if (!currentShadowRoot) {
      const root = document.getElementById('barcode-injector-root');
      if (root && root.shadowRoot) currentShadowRoot = root.shadowRoot;
    }
    if (!currentShadowRoot) return;

    const counter = currentShadowRoot.getElementById('auditor-counter');
    const input = currentShadowRoot.getElementById('auditor-input');
    const activeBadges = currentShadowRoot.getElementById('auditor-active-badges');
    const foundList = currentShadowRoot.getElementById('auditor-found-list');

    if (counter) counter.textContent = `${auditorFoundSet.size}/${auditorTargetSet.size} Detected`;
    if (input && document.activeElement !== input) input.value = Array.from(auditorTargetSet).join('\n');
    if (activeBadges) activeBadges.innerHTML = renderActiveBadges();
    if (foundList) foundList.innerHTML = renderFoundList();
  }

  const root = document.getElementById('barcode-injector-root');
  if (root && root.shadowRoot) mount(root.shadowRoot);

  window.addEventListener('SCANDECK_PANEL_READY', (e) => {
    if (e.detail && e.detail.shadowRoot) mount(e.detail.shadowRoot);
  });

  return { mount, fetchGlobalTids };
})();