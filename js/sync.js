// UI for the sync-code panel (see js/storage.js for the actual sync logic).

const syncBtn = document.getElementById('syncBtn');
const syncPanel = document.getElementById('syncPanel');
const syncCodeDisplay = document.getElementById('syncCodeDisplay');
const syncStatusMsg = document.getElementById('syncStatusMsg');
const linkCodeInput = document.getElementById('linkCodeInput');
const syncOwnCount = document.getElementById('syncOwnCount');

function showSyncStatus(message, kind) {
  syncStatusMsg.textContent = message;
  syncStatusMsg.className = 'sync-status-msg' + (kind ? ' ' + kind : '');
}

function updateSyncOwnCount() {
  const count = trails.filter(t => t.isCustom).length;
  syncOwnCount.textContent = count === 0
    ? "You haven't saved any traced routes on this device yet."
    : `${count} route${count === 1 ? '' : 's'} on this device, linked to the code below.`;
}

function openSyncPanel() {
  syncCodeDisplay.textContent = ensureSyncCode();
  updateSyncOwnCount();
  showSyncStatus('', '');
  linkCodeInput.value = '';
  syncPanel.hidden = false;
}

syncBtn.addEventListener('click', () => {
  if (syncPanel.hidden) openSyncPanel();
  else syncPanel.hidden = true;
});

document.getElementById('syncPanelClose').addEventListener('click', () => {
  syncPanel.hidden = true;
});

document.getElementById('copySyncCodeBtn').addEventListener('click', async () => {
  const code = syncCodeDisplay.textContent;
  try {
    await navigator.clipboard.writeText(code);
    showSyncStatus('Copied to clipboard.', 'success');
  } catch {
    showSyncStatus('Could not copy automatically — select and copy the code above.', 'error');
  }
});

document.getElementById('linkCodeBtn').addEventListener('click', async () => {
  const value = linkCodeInput.value;
  if (!value.trim()) {
    showSyncStatus('Enter a code first.', 'error');
    return;
  }
  showSyncStatus('Linking…', '');
  const result = await switchSyncCode(value);
  if (result.ok) {
    syncCodeDisplay.textContent = getSyncCode();
    updateSyncOwnCount();
    showSyncStatus(`Linked — loaded ${result.count} route${result.count === 1 ? '' : 's'} from that code.`, 'success');
  } else {
    showSyncStatus(result.error, 'error');
  }
});
