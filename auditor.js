// =============================================================================
// KOT-ScanDeck: Universal Manual Scan Monitor & Missing Shipment Auditor
// =============================================================================

window.KOT_AuditorModule = (function () {
  const SUPABASE_CONFIG = {
    url: 'https://pjlkrgqzghndndasdxik.supabase.co', // Your project URL
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBqbGtyZ3F6Z2huZG5kYXNkeGlrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3MTk5MzcsImV4cCI6MjA5ODI5NTkzN30.V0CDT9JQwXtVeMOxrbvD5TD4nEX30F_cM-EX6WqIzAI', // Your VITE_SUPABASE_ANON_KEY
    pollIntervalMs: 8000
  };

  let auditorTargetSet = new Set();
  let auditorFoundSet = new Set();
  let enableAuditorAlarm = true;
  let lastAuditorAlertTime = 0;
  let currentShadowRoot = null;
  let syncTimer = null;

  // 1. Fetch Global Missing TIDs from Cloud
  async function fetchGlobalTids() {
    if (!SUPABASE_CONFIG.url || SUPABASE_CONFIG.url.includes('YOUR_PROJECT_ID')) return;
    try {
      const res = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/auditor_targets?select=tracking_id`, {
        headers: {
          'apikey': SUPABASE_CONFIG.anonKey,
          'Authorization': `Bearer ${SUPABASE_CONFIG.anonKey}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        auditorTargetSet = new Set(data.map(item => item.tracking_id.trim().toUpperCase()));
        updateAuditorUi();
      }
    } catch (e) {
      console.warn('[Auditor] Cloud poll error:', e);
    }
  }

  fetchGlobalTids();
  if (syncTimer) clearInterval(syncTimer);
  syncTimer = setInterval(fetchGlobalTids, SUPABASE_CONFIG.pollIntervalMs);

  // Helper: Check if Extension Panel is Open/Active
  function isExtensionPanelVisible() {
    if (!currentShadowRoot) {
      const root = document.getElementById('barcode-injector-root');
      if (root && root.shadowRoot) currentShadowRoot = root.shadowRoot;
    }
    if (!currentShadowRoot) return false;
    const panel = currentShadowRoot.getElementById('panel');
    return !!(panel && !panel.classList.contains('panel-hidden'));
  }

  // 2. High 3-Beep Piercing Alarm (Only sounds if menu is active)
  function playAuditorPiercingAlarm() {
    if (!isExtensionPanelVisible()) {
      console.log('[Auditor] Missing item scanned, but alarm muted because panel is closed.');
      return;
    }

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

  // 3. Cloud Logging Engine (Every Manual Scan Recorded)
  async function logManualScanToCloud(tid, isMissing) {
    const timestamp = new Date().toISOString();

    // Log EVERY manual scan directly to manual_scans table
    fetch(`${SUPABASE_CONFIG.url}/rest/v1/manual_scans`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_CONFIG.anonKey,
        'Authorization': `Bearer ${SUPABASE_CONFIG.anonKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify({
        tracking_id: tid,
        scanned_at: timestamp,
        is_missing_match: isMissing,
        device_info: navigator.userAgent.slice(0, 50)
      })
    }).catch(err => console.warn('[Auditor] Scan log failed:', err));

    // If parcel is a target missing item, record in auditor_found_logs
    if (isMissing) {
      fetch(`${SUPABASE_CONFIG.url}/rest/v1/auditor_found_logs`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_CONFIG.anonKey,
          'Authorization': `Bearer ${SUPABASE_CONFIG.anonKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          tracking_id: tid,
          found_at: timestamp,
          notes: 'Scanned manually on ERP terminal'
        })
      }).catch(err => console.warn('[Auditor] Found log failed:', err));
    }
  }

  // 4. Capture All Manual Scanner Entries (Hardware Enter Event)
  function setupManualScanInterceptor() {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const activeEl = document.activeElement;
        if (activeEl && (activeEl.id === 'enteredShipmentId' || activeEl.getAttribute('data-testid') === 'enterShipment' || activeEl.tagName === 'INPUT')) {
          
          // Skip automated loop injections from Scanner tab
          if (window._kotIsAutomatedScanningActive) {
            return;
          }

          const scannedTid = (activeEl.value || '').trim().toUpperCase();
          if (scannedTid.length >= 6) {
            const isMissing = auditorTargetSet.has(scannedTid);

            // Log EVERY manual scan to cloud
            logManualScanToCloud(scannedTid, isMissing);

            if (isMissing) {
              auditorFoundSet.add(scannedTid);
              if (enableAuditorAlarm) {
                playAuditorPiercingAlarm();
              }
              updateAuditorUi();
            }
          }
        }
      }
    }, true);
  }

  setupManualScanInterceptor();

  // 5. DOM Mutation Observer Fallback (For visually loaded table rows)
  function inspectPageForAuditedTids() {
    if (!enableAuditorAlarm || auditorTargetSet.size === 0) return;
    const pageText = (document.body.innerText || document.body.textContent || '').toUpperCase();

    for (const tid of auditorTargetSet) {
      if (pageText.includes(tid) && !auditorFoundSet.has(tid)) {
        auditorFoundSet.add(tid);
        if (enableAuditorAlarm) {
          playAuditorPiercingAlarm();
        }
        logManualScanToCloud(tid, true);
        updateAuditorUi();
      }
    }
  }

  const observer = new MutationObserver(() => inspectPageForAuditedTids());
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });

  // 6. Mount into ScanDeck UI Tab
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
          <span style="font-size:8.5px; font-weight:700; color:#0891b2;">🎯 Missing Shipment Auditor</span>
          <label style="cursor:pointer; display:flex; align-items:center; gap:3px; font-size:7.5px; font-weight:700; color:#0e7490;">
            <input type="checkbox" id="auditor-alarm-chk" ${enableAuditorAlarm ? 'checked' : ''} /> ALARM
          </label>
        </div>
        <p style="font-size:7.5px; color:#155e75; margin:0;">Alarm triggers only when panel is visible. All manual scans sync to cloud.</p>
      </div>

      <div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:2px;">
          <label style="font-size:8px; font-weight:700; color:#64748b;">Target Missing TIDs (Cloud)</label>
          <span id="auditor-counter" style="font-size:8px; font-weight:700; color:#0891b2;">${auditorFoundSet.size}/${auditorTargetSet.size} Detected</span>
        </div>
        <textarea id="auditor-input" readonly style="height:45px; font-size:9px; width:100%; border:1px solid #cbd5e1; border-radius:5px; padding:4px; font-family:monospace; background:#f8fafc;">${Array.from(auditorTargetSet).join('\n')}</textarea>
      </div>

      <div style="display:flex; gap:4px;">
        <button id="auditor-refresh-btn" class="btn btn-secondary" style="padding:4px; font-size:8px; flex:1.2; font-weight:700; background:#e0f2fe; color:#0369a1; border-color:#bae6fd;">🔄 Force Sync</button>
        <button id="auditor-test-sound" class="btn btn-secondary" style="padding:4px; font-size:8px; flex:1;">🔊 Test Alarm</button>
      </div>

      <div style="display:flex; flex-direction:column; gap:2px;">
        <label style="font-size:7.5px; font-weight:700; color:#059669;">Found Missing Shipments (Logged to Cloud):</label>
        <div id="auditor-found-list" style="max-height:55px; overflow-y:auto; background:#f0fdf4; border:1px solid #bbf7d0; border-radius:4px; padding:4px; font-size:8px; font-family:monospace; color:#15803d;">
          ${renderFoundList()}
        </div>
      </div>
    `;
    panelBody.appendChild(auditorContent);

    // Tab Navigation
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

    chk.addEventListener('change', () => { enableAuditorAlarm = chk.checked; });
    testBtn.addEventListener('click', () => playAuditorPiercingAlarm());
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.textContent = '⏳ Syncing...';
      await fetchGlobalTids();
      refreshBtn.textContent = '✅ Synced!';
      setTimeout(() => { refreshBtn.textContent = '🔄 Force Sync'; }, 1500);
    });

    updateAuditorUi();
  }

  function renderFoundList() {
    if (auditorFoundSet.size === 0) return '<span style="color:#94a3b8;">No missing scans detected yet</span>';
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
    const foundList = currentShadowRoot.getElementById('auditor-found-list');

    if (counter) counter.textContent = `${auditorFoundSet.size}/${auditorTargetSet.size} Detected`;
    if (input && document.activeElement !== input) input.value = Array.from(auditorTargetSet).join('\n');
    if (foundList) foundList.innerHTML = renderFoundList();
  }

  const root = document.getElementById('barcode-injector-root');
  if (root && root.shadowRoot) mount(root.shadowRoot);

  window.addEventListener('SCANDECK_PANEL_READY', (e) => {
    if (e.detail && e.detail.shadowRoot) mount(e.detail.shadowRoot);
  });

  return { mount, fetchGlobalTids };
})();