import { auth, db } from './firebase-init-v2.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { doc, runTransaction, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const model = window.OperateTodos;
const ref = doc(db, 'config', 'operateTodos'); // Existing verified-admin-only config boundary.
const status = document.getElementById('todo-status');
const form = document.getElementById('todo-form');
const editor = document.getElementById('todo-editor');
const titleInput = document.getElementById('todo-title');
const notesInput = document.getElementById('todo-notes');
const defaults = [...document.querySelectorAll('template[data-legacy-todos]')].flatMap(template => [...template.content.querySelectorAll('.check-box[id^="chk-"]')]).map(box => {
  const header = box.closest('.op-card-header');
  return { id: box.id.slice(4), title: header.querySelector('.op-card-title').textContent.trim(), notes: header.querySelector('.op-card-sub').textContent.trim() };
});
let tasks = {}, ready = false, busy = false, epoch = 0, unsubscribe, editingId, returnFocus;

function controls() {
  document.querySelectorAll('[data-todo-control]').forEach(el => { el.disabled = !ready || busy; });
}
function message(text) { status.textContent = text; }
function edit(id, trigger) {
  if (!ready || busy) return;
  editingId = id || 'task-' + crypto.randomUUID();
  returnFocus = trigger;
  titleInput.value = tasks[id]?.title || '';
  notesInput.value = tasks[id]?.notes || '';
  editor.hidden = false;
  document.getElementById('todo-editor-heading').textContent = id ? 'Edit to-do' : 'Add a to-do';
  titleInput.focus();
  editor.scrollIntoView({ block: 'nearest' });
}
function closeEditor() {
  if (busy) return;
  editor.hidden = true;
  returnFocus?.focus();
}
function editButton(id) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'todo-edit'; button.textContent = 'Edit';
  button.dataset.todoControl = '';
  button.addEventListener('click', event => { event.stopPropagation(); edit(id, button); });
  return button;
}
function render() {
  const list = document.getElementById('todo-list'); list.replaceChildren();
  const completedList = document.getElementById('todo-completed-list'); completedList.replaceChildren();
  const { active, completed } = model.visible({ tasks });
  [...active, ...completed].forEach(task => {
    const row = document.createElement('div'); row.className = 'todo-row';
    const box = document.createElement('button'); box.type = 'button'; box.className = 'check-box' + (task.done ? ' done' : '');
    box.dataset.todoControl = ''; box.setAttribute('aria-pressed', String(task.done)); box.setAttribute('aria-label', (task.done ? 'Reopen: ' : 'Complete: ') + task.title);
    box.addEventListener('click', () => save({ type: 'complete', id: task.id, done: !task.done }));
    const content = document.createElement('div'); content.className = 'todo-copy';
    const title = document.createElement('strong'); title.textContent = task.title;
    const notes = document.createElement('p'); notes.textContent = task.notes;
    content.append(title, notes); row.append(box, content, editButton(task.id)); (task.done ? completedList : list).append(row);
  });
  document.getElementById('prog-label').textContent = ready ? `${active.length} open ${active.length === 1 ? 'action' : 'actions'}` : 'Loading…';
  document.getElementById('todo-empty').hidden = !ready || active.length > 0;
  document.getElementById('todo-completed').hidden = !ready || completed.length === 0;
  document.getElementById('todo-completed-heading').textContent = `Completed (${completed.length})`;
  controls();
}
async function save(action) {
  if (!ready || busy || !auth.currentUser?.emailVerified) return;
  busy = true; controls(); message('Saving…');
  const generation = epoch, uid = auth.currentUser.uid;
  try {
    await runTransaction(db, async transaction => {
      const snapshot = await transaction.get(ref);
      if (epoch !== generation || auth.currentUser?.uid !== uid) throw new Error('Sign-in changed. Reload the list.');
      transaction.set(ref, model.change(model.migrate(snapshot.data() || {}, defaults), action));
    });
    if (generation !== epoch) return;
    busy = false;
    if (action.type === 'save') closeEditor();
    message('Saved to your admin account.');
  } catch (error) {
    if (generation === epoch) message('Not saved. ' + error.message + ' Try again.');
  } finally { if (generation === epoch) { busy = false; controls(); } }
}
form.addEventListener('submit', event => { event.preventDefault(); save({ type: 'save', id: editingId, title: titleInput.value, notes: notesInput.value }); });
document.getElementById('todo-add').addEventListener('click', event => edit(null, event.currentTarget));
document.getElementById('todo-close').addEventListener('click', closeEditor);
editor.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); closeEditor(); } });

async function connect(user) {
  const generation = ++epoch;
  unsubscribe?.(); unsubscribe = null; ready = false; busy = false; tasks = {}; editor.hidden = true; render();
  if (!user?.emailVerified) { message('Sign in with a verified admin account to load your to-dos.'); return; }
  message('Loading saved to-dos…');
  try {
    const marker = model.STORAGE_KEY + ':migrated:' + user.uid;
    let legacy = {};
    try { if (!localStorage.getItem(marker)) legacy = model.readLegacy(localStorage); } catch (_) { /* Cloud persistence still works when storage is blocked. */ }
    await runTransaction(db, async transaction => {
      const snapshot = await transaction.get(ref);
      if (generation !== epoch || auth.currentUser?.uid !== user.uid) throw new Error('Sign-in changed.');
      const current = snapshot.data() || {};
      const next = model.migrate(current, defaults, legacy);
      if (JSON.stringify(current) !== JSON.stringify(next)) transaction.set(ref, next);
    });
    if (generation !== epoch) return;
    // Keep the original browser record as a backup. Mark only after server success.
    try { localStorage.setItem(marker, '1'); } catch (_) { /* Safe idempotent import on next load. */ }
    unsubscribe = onSnapshot(ref, snapshot => {
      if (generation !== epoch) return;
      tasks = model.migrate(snapshot.data() || {}, defaults).tasks; ready = true; render();
      if (!busy) message(snapshot.metadata.fromCache ? 'Showing cached to-dos. Reconnect to save changes.' : 'Saved to your admin account. Shared across admin devices.');
    }, error => { if (generation === epoch) { ready = false; controls(); message('Unable to sync to-dos. ' + error.message + ' Use Retry.'); } });
  } catch (error) {
    if (generation === epoch) { ready = false; controls(); message('Unable to load to-dos. ' + error.message + ' Use Retry.'); }
  }
}
document.getElementById('todo-retry').addEventListener('click', () => { if (!busy) connect(auth.currentUser); });
onAuthStateChanged(auth, connect);
