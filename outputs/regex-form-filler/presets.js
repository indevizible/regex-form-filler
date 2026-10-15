import { validateRules } from './core.js';

export function validatePresetName(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 80) {
    throw new Error('ชื่อชุดต้องไม่ว่างและยาวไม่เกิน 80 ตัวอักษร');
  }
  return value.trim();
}

export function validatePresetState(value) {
  const invalid = () => { throw new Error('ข้อมูลชุดกฎไม่ถูกต้อง · ยังไม่เขียนทับข้อมูลเดิม'); };
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      !Object.hasOwn(value, 'activeId') || !Array.isArray(value.presets) || !value.presets.length ||
      Reflect.ownKeys(value).some(key => !['activeId', 'presets'].includes(key))) invalid();
  const ids = new Set(), names = new Set();
  const presets = value.presets.map(preset => {
    if (!preset || typeof preset !== 'object' || Array.isArray(preset) ||
        !['id', 'name', 'rules'].every(key => Object.hasOwn(preset, key)) ||
        Reflect.ownKeys(preset).some(key => !['id', 'name', 'rules'].includes(key)) ||
        typeof preset.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/u.test(preset.id) || ids.has(preset.id)) invalid();
    const name = validatePresetName(preset.name);
    if (names.has(name)) throw new Error('ชื่อชุดซ้ำแล้ว · ใช้ชื่ออื่น');
    ids.add(preset.id); names.add(name);
    return { id: preset.id, name, rules: validateRules(preset.rules) };
  });
  if (!ids.has(value.activeId)) invalid();
  return { activeId: value.activeId, presets };
}

export function readPresetState(stored) {
  // The old key is fallback only. A malformed new state must never become empty rules.
  return validatePresetState(Object.hasOwn(stored, 'presetState') ? stored.presetState : {
    activeId: 'default', presets: [{ id: 'default', name: 'ค่าเริ่มต้น', rules: Object.hasOwn(stored, 'rules') ? stored.rules : [] }]
  });
}

export const activePreset = state => state.presets.find(preset => preset.id === state.activeId);
