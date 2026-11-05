// =============================================================================
// KOT-ScanDeck: Shipment Auditor Engine (High 3-Beep Noticeable Alarm)
// =============================================================================

window.KOT_AuditorModule = (function () {
  let auditorTargetSet = new Set();
  let auditorFoundSet = new Set();
  let enableAuditorAlarm = true;
  let lastAuditorAlertTime = 0;
  let currentShadowRoot = null;

  // 1. Load Permanent TIDs from chrome.storage.local
  function loadPersistedTids() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['auditor_target_tids', 'auditor_alarm_enabled'], (data) => {
        if (data.auditor_target_tids && Array.isArray(data.auditor_target_tids)) {
          auditorTargetSet = new Set(data.auditor_target_tids);
        }
        if (typeof data.auditor_alarm_enabled !== 'undefined') {
          enableAuditorAlarm = data.auditor_alarm_enabled;
        }
        updateAuditorUi();
      });
    } else {
      const cached = localStorage.getItem('auditor_target_tids') || '';
      auditorTargetSet = new Set(cached.split(/[\n,;\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean));
      updateAuditorUi();
    }
  }

  loadPersistedTids();

  // 2. Storage Event Listener (Instant update when dispatched from website)
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.auditor_target_tids) {
        auditorTargetSet = new Set(changes.auditor_target_tids.newValue || []);
        auditorFoundSet.clear();
        updateAuditorUi();
        console.log(`%c[Auditor] Storage synced live: ${auditorTargetSet.size} TIDs active.`, 'color:#06b6d4;font-weight:bold;');
      }
    });
  }

  // 3. HIGH 3-BEEP PIERCING NOTICEABLE ALARM (2400Hz + 1600Hz Square Wave Harmonic)
  function playAuditorPiercingAlarm() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      // 3 sharp, urgent bursts: 0s, 0.16s, 0.32s
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

  // 4. Update Targets & Persist Permanently
  function setTargetTids(list) {
    const cleanList = (Array.isArray(list) ? list : String(list).split(/[\n,;\s]+/))
      .map(s => String(s).trim().toUpperCase())
      .filter(Boolean);

    auditorTargetSet = new Set(cleanList);
    auditorFoundSet.clear();

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ auditor_target_tids: Array.from(auditorTargetSet) });
    }
    localStorage.setItem('auditor_target_tids', Array.from(auditorTargetSet).join('\n'));

    updateAuditorUi();
  }

  // Listen for direct sync messages from background.js
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message) => {
      if (message && message.action === 'SYNC_AUDITOR_TIDS') {
        setTargetTids(message.tids);
      }
    });
  }

  // BroadcastChannel Handshake
  try {
    const channel = new BroadcastChannel('KOT_AUDITOR_CHANNEL');
    channel.onmessage = (event) => {
      if (event.data && event.data.type === 'SYNC_AUDITOR_TIDS') {
        setTargetTids(event.data.tids);
      }
    };
  } catch (e) {}

  // 5. Inspect DOM for Missing Scans
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

  // 6. Mount into ScanDeck UI
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
        <p style="font-size:7.5px; color:#155e75; margin:0;">Urgent 3-beep alarm when target missing TIDs are scanned.</p>
      </div>

      <div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:2px;">
          <label style="font-size:8px; font-weight:700; color:#64748b;">Target Missing TIDs (Synced)</label>
          <span id="auditor-counter" style="font-size:8px; font-weight:700; color:#0891b2;">${auditorFoundSet.size}/${auditorTargetSet.size} Detected</span>
        </div>
        <textarea id="auditor-input" style="height:50px; font-size:9px; width:100%; border:1px solid #cbd5e1; border-radius:5px; padding:4px; font-family:monospace;" placeholder="Waiting for TIDs from portal...">${Array.from(auditorTargetSet).join('\n')}</textarea>
      </div>

      <div style="display:flex; gap:4px;">
        <button id="auditor-paste-btn" class="btn btn-secondary" style="padding:4px; font-size:8px; flex:1.2; font-weight:700; background:#e0f2fe; color:#0369a1; border-color:#bae6fd;">📋 Sync from Clipboard</button>
        <button id="auditor-test-sound" class="btn btn-secondary" style="padding:4px; font-size:8px; flex:1;">🔊 Test 3-Beep</button>
        <button id="auditor-clear-btn" class="btn btn-secondary" style="padding:4px; font-size:8px; flex:0.8;">🗑️ Clear</button>
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

    auditorBtn.addEventListener('click', () => {
      switchToTab(auditorBtn, auditorContent);
    });

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

    // Input handlers
    const input = shadowRoot.getElementById('auditor-input');
    const chk = shadowRoot.getElementById('auditor-alarm-chk');
    const testBtn = shadowRoot.getElementById('auditor-test-sound');
    const clearBtn = shadowRoot.getElementById('auditor-clear-btn');
    const pasteBtn = shadowRoot.getElementById('auditor-paste-btn');

    input.addEventListener('input', () => {
      setTargetTids(input.value);
    });

    chk.addEventListener('change', () => {
      enableAuditorAlarm = chk.checked;
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ auditor_alarm_enabled: enableAuditorAlarm });
      }
    });

    testBtn.addEventListener('click', () => playAuditorPiercingAlarm());

    clearBtn.addEventListener('click', () => {
      setTargetTids([]);
    });

    pasteBtn.addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          setTargetTids(text);
          pasteBtn.textContent = '✅ Synced!';
          setTimeout(() => { pasteBtn.textContent = '📋 Sync from Clipboard'; }, 1500);
        }
      } catch (err) {
        alert('Please allow clipboard permission to sync.');
      }
    });

    updateAuditorUi();
  }

  function renderActiveBadges() {
    if (auditorTargetSet.size === 0) {
      return '<span style="color:#94a3b8;">No TIDs loaded</span>';
    }
    return Array.from(auditorTargetSet).map(tid => {
      const isFound = auditorFoundSet.has(tid);
      return `<span style="background:${isFound ? '#bbf7d0' : '#e2e8f0'}; color:${isFound ? '#15803d' : '#334155'}; padding:1px 3px; border-radius:3px; border:1px solid ${isFound ? '#86efac' : '#cbd5e1'}; font-weight:bold;">${tid}</span>`;
    }).join(' ');
  }

  function renderFoundList() {
    if (auditorFoundSet.size === 0) {
      return '<span style="color:#94a3b8;">None detected yet</span>';
    }
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
    if (input && document.activeElement !== input) {
      input.value = Array.from(auditorTargetSet).join('\n');
    }
    if (activeBadges) activeBadges.innerHTML = renderActiveBadges();
    if (foundList) foundList.innerHTML = renderFoundList();
  }

  const root = document.getElementById('barcode-injector-root');
  if (root && root.shadowRoot) mount(root.shadowRoot);

  window.addEventListener('SCANDECK_PANEL_READY', (e) => {
    if (e.detail && e.detail.shadowRoot) mount(e.detail.shadowRoot);
  });

  return { mount, setTargetTids };
})();