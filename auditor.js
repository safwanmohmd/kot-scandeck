// =============================================================================
// KOT-ScanDeck: PRC Reconciliation (/shipments/pendingreco) Manual Scan Auditor
// Active whenever the main ScanDeck popup panel is open (Any Tab Selected)
// =============================================================================

window.KOT_AuditorModule = (function () {
  const SUPABASE_CONFIG = {
    url: 'https://pjlkrgqzghndndasdxik.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBqbGtyZ3F6Z2huZG5kYXNkeGlrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3MTk5MzcsImV4cCI6MjA5ODI5NTkzN30.V0CDT9JQwXtVeMOxrbvD5TD4nEX30F_cM-EX6WqIzAI',
    pollIntervalMs: 8000,
    targetPath: '/shipments/pendingreco'
  };

  let auditorTargetSet = new Set();
  let auditorFoundSet = new Set();
  let globalRemoteAlarmActive = true;
  let localAlarmEnabled = true;
  let currentShadowRoot = null;
  let syncTimer = null;

  // ---------------------------------------------------------------------------
  // GUARD 1: Check if the Main ScanDeck Extension Popup Menu is Open (Any Tab)
  // ---------------------------------------------------------------------------
  function isExtensionPanelVisible() {
    if (!currentShadowRoot) {
      const root = document.getElementById('barcode-injector-root');
      if (root && root.shadowRoot) currentShadowRoot = root.shadowRoot;
    }
    if (!currentShadowRoot) return false;
    const panel = currentShadowRoot.getElementById('panel');
    return !!(panel && !panel.classList.contains('panel-hidden'));
  }

  // ---------------------------------------------------------------------------
  // GUARD 2: Strict URL Binding (/shipments/pendingreco) + PRC DOM Verification
  // ---------------------------------------------------------------------------
  function isPrcPendingRecoActive() {
    const currentUrl = window.location.href.toLowerCase();
    if (!currentUrl.includes(SUPABASE_CONFIG.targetPath)) {
      return false;
    }

    const elements = Array.from(document.querySelectorAll('.sc-AykKC, .fmcvyS, div, td, tr, span'));

    const hasRtoNode = elements.some((el) => {
      const text = el.textContent ? el.textContent.trim().toUpperCase() : '';
      return text === 'IS RTO' || text === 'IS RTO:';
    });

    const hasCpdNode = elements.some((el) => {
      const text = el.textContent ? el.textContent.trim().toUpperCase() : '';
      return text === 'CPD' || text === 'CPD:';
    });

    if (hasRtoNode || hasCpdNode) return true;

    const bodyText = (document.body.textContent || document.body.innerText || '')
      .replace(/\s+/g, ' ')
      .toUpperCase();

    return bodyText.includes('IS RTO YES') || bodyText.includes('IS RTO NO') || bodyText.includes('IS RTO:');
  }

  // ---------------------------------------------------------------------------
  // HELPER: Detect if Scanned Shipment is RTO (Exact content.js Logic)
  // ---------------------------------------------------------------------------
  function detectIsRtoOnScreen() {
    const elements = Array.from(document.querySelectorAll('.sc-AykKC, .fmcvyS, div, td, tr, span'));

    const rtoLabelNode = elements.find((el) => {
      const text = el.textContent ? el.textContent.trim().toUpperCase() : '';
      return text === 'IS RTO' || text === 'IS RTO:';
    });

    if (rtoLabelNode) {
      const parentCell = rtoLabelNode.closest('.fmcvyS, div, td') || rtoLabelNode.parentElement;
      const containerText = parentCell ? parentCell.textContent.toUpperCase() : '';
      if (containerText.includes('YES') && !containerText.includes('IS RTO CV')) {
        return true;
      }
    } else {
      const bodyText = (document.body.textContent || document.body.innerText || '')
        .replace(/\s+/g, ' ')
        .toUpperCase();
      if (bodyText.includes('IS RTO YES')) {
        return true;
      }
    }

    return false;
  }

  // ---------------------------------------------------------------------------
  // 1. Fetch Cloud Missing Targets & Remote Alarm Switch
  // ---------------------------------------------------------------------------
  async function fetchCloudData() {
    try {
      const resTargets = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/auditor_targets?select=tracking_id`, {
        headers: {
          'apikey': SUPABASE_CONFIG.anonKey,
          'Authorization': `Bearer ${SUPABASE_CONFIG.anonKey}`
        }
      });
      if (resTargets.ok) {
        const data = await resTargets.json();
        auditorTargetSet = new Set(data.map((item) => item.tracking_id.trim().toUpperCase()));
      }

      const resConfig = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/auditor_config?key=eq.global_alarm_enabled&select=value`, {
        headers: {
          'apikey': SUPABASE_CONFIG.anonKey,
          'Authorization': `Bearer ${SUPABASE_CONFIG.anonKey}`
        }
      });
      if (resConfig.ok) {
        const configData = await resConfig.json();
        if (configData.length > 0) {
          globalRemoteAlarmActive = configData[0].value === 'true';
        }
      }

      updateAuditorUi();
    } catch (e) {
      console.warn('[Auditor] Cloud poll error:', e);
    }
  }

  fetchCloudData();
  if (syncTimer) clearInterval(syncTimer);
  syncTimer = setInterval(fetchCloudData, SUPABASE_CONFIG.pollIntervalMs);

  // ---------------------------------------------------------------------------
  // 2. High 3-Beep Piercing Alarm (Menu Open + /shipments/pendingreco + Cloud ON)
  // ---------------------------------------------------------------------------
  function playAuditorPiercingAlarm() {
    if (!globalRemoteAlarmActive) return;
    if (!isExtensionPanelVisible()) return;
    if (!window.location.href.toLowerCase().includes(SUPABASE_CONFIG.targetPath)) return;

    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.16, 0.32].forEach((startOffset) => {
        [2400, 1600].forEach((freq) => {
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
    } catch (e) {}
  }

  // ---------------------------------------------------------------------------
  // 3. Log Scanned Shipment Details (TID, Is RTO, Scan Time) to Supabase
  // ---------------------------------------------------------------------------
  async function logManualScanToCloud(tid, isMissing, isRto, scanTimestamp) {
    if (!isExtensionPanelVisible()) return;
    if (!window.location.href.toLowerCase().includes(SUPABASE_CONFIG.targetPath)) return;

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
        scanned_at: scanTimestamp,
        is_missing_match: isMissing,
        is_rto: isRto,
        device_info: 'PendingReco (' + (window.location.hostname || 'Hub') + ')'
      })
    }).catch(() => {});

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
          found_at: scanTimestamp,
          notes: isRto ? 'Scanned on /shipments/pendingreco (RTO: YES)' : 'Scanned on /shipments/pendingreco (RTO: NO)'
        })
      }).catch(() => {});
    }
  }

  // ---------------------------------------------------------------------------
  // 4. Hardware Scanner Interceptor (Bound to /shipments/pendingreco + Open Menu)
  // ---------------------------------------------------------------------------
  function setupManualScanInterceptor() {
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;

      // Guard 1: Main popup panel must be visible/open (regardless of active tab)
      if (!isExtensionPanelVisible()) return;

      // Guard 2: URL must be /shipments/pendingreco
      if (!window.location.href.toLowerCase().includes(SUPABASE_CONFIG.targetPath)) return;

      // Guard 3: Ignore automated bulk scanner injections
      if (window._kotIsAutomatedScanningActive) return;

      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.id === 'enteredShipmentId' ||
          activeEl.getAttribute('data-testid') === 'enterShipment' ||
          activeEl.tagName === 'INPUT')
      ) {
        const scannedTid = (activeEl.value || '').trim().toUpperCase();
        if (scannedTid.length >= 6) {
          const exactScanTime = new Date().toISOString();

          // Wait 350ms for ERP DOM to render IS RTO / CPD details for the scanned shipment
          setTimeout(() => {
            if (!isExtensionPanelVisible()) return;
            if (!isPrcPendingRecoActive()) return;

            const isMissing = auditorTargetSet.has(scannedTid);
            const isRto = detectIsRtoOnScreen();

            logManualScanToCloud(scannedTid, isMissing, isRto, exactScanTime);

            if (isMissing) {
              auditorFoundSet.add(scannedTid);
              if (localAlarmEnabled) {
                playAuditorPiercingAlarm();
              }
              updateAuditorUi();
            }
          }, 350);
        }
      }
    }, true);
  }

  setupManualScanInterceptor();

  // ---------------------------------------------------------------------------
  // 5. DOM Mutation Observer (Open Menu + /shipments/pendingreco Only)
  // ---------------------------------------------------------------------------
  function inspectPageForAuditedTids() {
    if (!isExtensionPanelVisible() || !isPrcPendingRecoActive()) return;
    if (auditorTargetSet.size === 0) return;

    const pageText = (document.body.innerText || document.body.textContent || '').toUpperCase();

    for (const tid of auditorTargetSet) {
      if (pageText.includes(tid) && !auditorFoundSet.has(tid)) {
        auditorFoundSet.add(tid);
        const isRto = detectIsRtoOnScreen();
        const exactScanTime = new Date().toISOString();
        if (localAlarmEnabled) {
          playAuditorPiercingAlarm();
        }
        logManualScanToCloud(tid, true, isRto, exactScanTime);
        updateAuditorUi();
      }
    }
  }

  const observer = new MutationObserver(() => inspectPageForAuditedTids());
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });

  // ---------------------------------------------------------------------------
  // 6. Mount into ScanDeck UI Tab
  // ---------------------------------------------------------------------------
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
          <span style="font-size:8.5px; font-weight:700; color:#0891b2;">🎯 PendingReco Auditor</span>
          <div style="display:flex; align-items:center; gap:4px;">
            <span id="remote-alarm-indicator" style="font-size:7px; font-weight:800; padding:1px 3px; border-radius:3px; background:${globalRemoteAlarmActive ? '#dcfce7' : '#fee2e2'}; color:${globalRemoteAlarmActive ? '#15803d' : '#b91c1c'};">
              CLOUD: ${globalRemoteAlarmActive ? 'ON' : 'OFF'}
            </span>
            <label style="cursor:pointer; display:flex; align-items:center; gap:2px; font-size:7.5px; font-weight:700; color:#0e7490;">
              <input type="checkbox" id="auditor-alarm-chk" ${localAlarmEnabled ? 'checked' : ''} /> ALARM
            </label>
          </div>
        </div>
        <p style="font-size:7.5px; color:#155e75; margin:0;">Active whenever menu is popped up on <b>/shipments/pendingreco</b> (any tab).</p>
      </div>

      <div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:2px;">
          <label style="font-size:8px; font-weight:700; color:#64748b;">Missing Target Queue</label>
          <span id="auditor-counter" style="font-size:8px; font-weight:700; color:#0891b2;">${auditorFoundSet.size}/${auditorTargetSet.size} Detected</span>
        </div>
        <textarea id="auditor-input" readonly style="height:42px; font-size:9px; width:100%; border:1px solid #cbd5e1; border-radius:5px; padding:4px; font-family:monospace; background:#f8fafc;">${Array.from(auditorTargetSet).join('\n')}</textarea>
      </div>

      <div style="display:flex; gap:4px;">
        <button id="auditor-refresh-btn" class="btn btn-secondary" style="padding:4px; font-size:8px; flex:1.2; font-weight:700; background:#e0f2fe; color:#0369a1; border-color:#bae6fd;">🔄 Force Sync</button>
        <button id="auditor-test-sound" class="btn btn-secondary" style="padding:4px; font-size:8px; flex:1;">🔊 Test Alarm</button>
      </div>

      <div style="display:flex; flex-direction:column; gap:2px;">
        <label style="font-size:7.5px; font-weight:700; color:#059669;">Found Shipments (PendingReco Synced):</label>
        <div id="auditor-found-list" style="max-height:55px; overflow-y:auto; background:#f0fdf4; border:1px solid #bbf7d0; border-radius:4px; padding:4px; font-size:8px; font-family:monospace; color:#15803d;">
          ${renderFoundList()}
        </div>
      </div>
    `;
    panelBody.appendChild(auditorContent);

    function switchToTab(targetBtn, targetContent) {
      const allButtons = shadowRoot.querySelectorAll('.tab-btn');
      const allContents = shadowRoot.querySelectorAll('.tab-content');
      allButtons.forEach((btn) => btn.classList.remove('active', 'rs-active'));
      allContents.forEach((content) => content.classList.add('hidden-tab'));
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

    chk.addEventListener('change', () => { localAlarmEnabled = chk.checked; });
    testBtn.addEventListener('click', () => playAuditorPiercingAlarm());
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.textContent = '⏳ Syncing...';
      await fetchCloudData();
      refreshBtn.textContent = '✅ Synced!';
      setTimeout(() => { refreshBtn.textContent = '🔄 Force Sync'; }, 1500);
    });

    updateAuditorUi();
  }

  function renderFoundList() {
    if (auditorFoundSet.size === 0) return '<span style="color:#94a3b8;">No missing scans recorded</span>';
    return Array.from(auditorFoundSet).map((id) => `✅ Found: ${id}`).join('<br>');
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
    const remoteIndicator = currentShadowRoot.getElementById('remote-alarm-indicator');

    if (counter) counter.textContent = `${auditorFoundSet.size}/${auditorTargetSet.size} Detected`;
    if (input && document.activeElement !== input) input.value = Array.from(auditorTargetSet).join('\n');
    if (foundList) foundList.innerHTML = renderFoundList();
    if (remoteIndicator) {
      remoteIndicator.style.background = globalRemoteAlarmActive ? '#dcfce7' : '#fee2e2';
      remoteIndicator.style.color = globalRemoteAlarmActive ? '#15803d' : '#b91c1c';
      remoteIndicator.textContent = `CLOUD: ${globalRemoteAlarmActive ? 'ON' : 'OFF'}`;
    }
  }

  const root = document.getElementById('barcode-injector-root');
  if (root && root.shadowRoot) mount(root.shadowRoot);

  window.addEventListener('SCANDECK_PANEL_READY', (e) => {
    if (e.detail && e.detail.shadowRoot) mount(e.detail.shadowRoot);
  });

  return { mount, fetchCloudData };
})();