// Test-only picker response. No external requests, upload endpoint, auth or Google state.
const fixture = parent.fileFixture;
const input = document.getElementById('upload');
const progress = document.getElementById('progress');
const mode = fixture.mode;
let innerWrapper;
if (mode === 'inner-progress-two') {
  const dialog = input.closest('[role="dialog"]');
  innerWrapper = document.createElement('div');
  dialog.replaceWith(innerWrapper); innerWrapper.append(dialog);
}
document.getElementById('browse').addEventListener('click', () => input.click());
let selectedFile;
if (mode === 'reject') input.accept = 'image/png';
window.completeSyntheticUpload = () => {
  if (selectedFile) fixture.finish(mode === 'wrong' ? `prefix-${selectedFile.name}` : selectedFile.name);
};
// Bind only at module evaluation; never replay an event dispatched before readiness.
input.addEventListener('input', () => fixture.event('input'));
input.addEventListener('change', () => {
  fixture.event('change'); selectedFile = input.files[0];
  if (!selectedFile) return;
  if (mode.startsWith('sequence-')) { input.remove(); fixture.event('removedInputs'); }
  progress.textContent = `Received actual File: ${selectedFile.name} · ${selectedFile.size} bytes`;
  if (mode === 'pending') { fixture.waiting(); return; }
  let progressDialog;
  if (innerWrapper) {
    progressDialog = document.createElement('div'); progressDialog.setAttribute('role', 'dialog');
    progressDialog.setAttribute('aria-label', 'Upload progress'); progressDialog.textContent = 'Uploading synthetic file…';
    document.body.append(progressDialog); innerWrapper.setAttribute('aria-hidden', 'true');
    fixture.event('progressDialogs');
  }
  setTimeout(() => {
    if (progressDialog) {
      progressDialog.remove(); innerWrapper.removeAttribute('aria-hidden'); fixture.event('progressClosures');
    }
    if (mode === 'confirm') {
      const item = document.createElement('div'); item.setAttribute('role', 'option'); item.setAttribute('aria-selected', 'true');
      const name = document.createElement('span'); name.textContent = selectedFile.name; item.append(name);
      document.getElementById('selection').append(item); document.getElementById('insert').hidden = false;
    } else window.completeSyntheticUpload();
  }, 700);
});
document.getElementById('insert').addEventListener('click', () => window.completeSyntheticUpload());
document.getElementById('close').addEventListener('click', () => fixture.close());
const moduleStarted = Date.now();
let timerTicks = 0, lastTick = moduleStarted, largestGap = 0;
function heartbeat() {
  const now = Date.now(); largestGap = Math.max(largestGap, now - lastTick); lastTick = now;
  document.getElementById('module-marker').textContent = `Module ready; timer callbacks=${timerTicks}; elapsed=${now - moduleStarted}ms; max gap=${largestGap}ms`;
  if (now - moduleStarted < 65000 && !window.frameElement.closest('[hidden]')) setTimeout(() => { timerTicks++; heartbeat(); }, 250);
}
heartbeat();
