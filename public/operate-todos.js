/* Shared by the Operate page and its offline regression tests. */
(function (root) {
  'use strict';
  const STORAGE_KEY = 'blastybiz_operate_checks';
  const SQUARE_ID = 'square-checkout';
  const square = {
    id: SQUARE_ID,
    title: 'Fix Square checkout and verify Sandbox',
    notes: 'Review the payment-link request: provide quickPay or order with price and location; verify the subscription plan variation ID. Add a provider-contract test, then run an authorized Square Sandbox check. Do not use real payments.',
    done: false,
    completionUpdated: false
  };
  function readLegacy(storage) {
    try {
      const value = JSON.parse(storage.getItem(STORAGE_KEY) || '{}');
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch (_) { return {}; }
  }
  function equivalentSquare(task) {
    return task.id === SQUARE_ID || /square/i.test(task.title + ' ' + task.notes) && /checkout|payment.?link|sandbox/i.test(task.title + ' ' + task.notes);
  }
  function seed(current, defaults, legacy) {
    const tasks = { ...(current.tasks || {}) };
    for (const task of defaults) {
      if (!Object.hasOwn(tasks, task.id)) tasks[task.id] = { ...task, done: false, completionUpdated: false };
      // Import checked items only; old browser false values never erase cloud progress.
      // Explicit cloud completion/reopening always wins over stale browser state.
      if (legacy[task.id] === true && !tasks[task.id].completionUpdated) {
        tasks[task.id] = { ...tasks[task.id], done: true, completionUpdated: true };
      }
    }
    if (!Object.values(tasks).some(equivalentSquare)) tasks[SQUARE_ID] = { ...square };
    return { ...current, version: 1, tasks };
  }
  function change(current, action) {
    const tasks = { ...(current.tasks || {}) };
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(action.id)) throw new Error('Invalid task ID.');
    if (action.type === 'save') {
      const title = String(action.title || '').trim();
      const notes = String(action.notes || '').trim();
      if (!title || title.length > 160 || notes.length > 2000) throw new Error('Use a title up to 160 characters and notes up to 2,000 characters.');
      if (!tasks[action.id] && Object.keys(tasks).length >= 200) throw new Error('The list is full (200 tasks).');
      tasks[action.id] = { ...(tasks[action.id] || { id: action.id, done: false, completionUpdated: false }), title, notes };
    } else if (action.type === 'complete') {
      if (!tasks[action.id]) throw new Error('Task no longer exists. Reload the list.');
      tasks[action.id] = { ...tasks[action.id], done: action.done === true, completionUpdated: true };
    } else throw new Error('Unknown task action.');
    return { ...current, version: 1, tasks };
  }
  root.OperateTodos = { STORAGE_KEY, SQUARE_ID, readLegacy, seed, change };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.OperateTodos;
})(typeof window !== 'undefined' ? window : globalThis);
