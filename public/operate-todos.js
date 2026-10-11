/* Shared by the Operate page and its offline regression tests. */
(function (root) {
  'use strict';
  const STORAGE_KEY = 'blastybiz_operate_checks';
  const SQUARE_ID = 'square-checkout';
  const LEGACY_REASON = 'legacy-default-not-confirmed-owner-action';
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
  // These historical defaults are reference material, not confirmed owner actions.
  // Match exact seed text so an admin's renamed/reworded task is never hidden.
  function migrate(current, defaults, legacy = {}) {
    const tasks = { ...(current.tasks || {}) };
    for (const original of [...defaults, square]) {
      let task = tasks[original.id];
      // Preserve checked browser history without recreating unchecked defaults.
      if (!task && legacy[original.id] === true) task = { ...original, done: true, completionUpdated: true };
      if (!task) continue;
      if (legacy[original.id] === true && !task.completionUpdated) {
        task = { ...task, done: true, completionUpdated: true };
      }
      if (!task.ownerAuthored && task.title === original.title && task.notes === original.notes) {
        task = { ...task, archivedReason: LEGACY_REASON };
      } else if (task.archivedReason === LEGACY_REASON) {
        task = { ...task };
        delete task.archivedReason;
      }
      tasks[original.id] = task;
    }
    return { ...current, version: 2, tasks };
  }
  function visible(current) {
    const ownerTasks = Object.values(current.tasks || {}).filter(task => !task.archivedReason);
    return { active: ownerTasks.filter(task => !task.done), completed: ownerTasks.filter(task => task.done) };
  }
  function change(current, action) {
    const tasks = { ...(current.tasks || {}) };
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(action.id)) throw new Error('Invalid task ID.');
    if (action.type === 'save') {
      const title = String(action.title || '').trim();
      const notes = String(action.notes || '').trim();
      if (!title || title.length > 160 || notes.length > 2000) throw new Error('Use a title up to 160 characters and notes up to 2,000 characters.');
      if (!tasks[action.id] && Object.keys(tasks).length >= 200) throw new Error('The list is full (200 tasks).');
      tasks[action.id] = { ...(tasks[action.id] || { id: action.id, done: false, completionUpdated: false }), title, notes, ownerAuthored: true };
      delete tasks[action.id].archivedReason;
    } else if (action.type === 'complete') {
      if (!tasks[action.id]) throw new Error('Task no longer exists. Reload the list.');
      tasks[action.id] = { ...tasks[action.id], done: action.done === true, completionUpdated: true };
    } else throw new Error('Unknown task action.');
    return { ...current, version: 2, tasks };
  }
  root.OperateTodos = { STORAGE_KEY, SQUARE_ID, readLegacy, migrate, visible, change };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.OperateTodos;
})(typeof window !== 'undefined' ? window : globalThis);
