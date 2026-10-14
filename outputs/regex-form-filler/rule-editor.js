import { escapeRegex, formatDateAnswer, normalizeLabel, parseDateAnswer, validateFileReference, validateRules } from './core.js';

export function ruleFromDraft({ mode, source, flags, answerType, answer, date, inputCalendar, textCalendar, textFormat, file }, original) {
  let pattern = source;
  if (mode !== 'regex') {
    const label = normalizeLabel(source);
    if (!label) throw new Error('กรอกชื่อคำถามหรือคำที่ต้องการจับคู่');
    pattern = mode === 'exact' ? `^${escapeRegex(label)}$` : escapeRegex(label);
    flags = 'iu';
  }
  // Keep old/default numeric dates free of added metadata; preserve imported explicit numeric.
  if (textFormat === 'numeric' && original?.value?.textFormat !== 'numeric') textFormat = undefined;
  let value = answerType === 'file' ? validateFileReference(file) : answerType === 'date' ? parseDateAnswer(date, inputCalendar, textCalendar, textFormat) :
    answerType === 'multiple' ? answer.split(/\r?\n/u).map(line => line.trim()).filter(Boolean) : answer;
  // Preserve imported choices that cannot be represented losslessly as one choice per line.
  if (answerType === 'multiple' && Array.isArray(original?.value) && answer === original.value.join('\n')) value = original.value;
  return validateRules([{ pattern, flags, value }])[0];
}

export function ruleToDraft(rule) {
  const date = rule.value?.type === 'date';
  const file = rule.value?.type === 'file';
  const draft = { mode: 'regex', source: rule.pattern, flags: rule.flags,
    answerType: file ? 'file' : date ? 'date' : Array.isArray(rule.value) ? 'multiple' : 'single',
    answer: date || file ? '' : Array.isArray(rule.value) ? rule.value.join('\n') : rule.value };
  if (file) draft.file = validateFileReference(rule.value);
  if (date) Object.assign(draft, { date: formatDateAnswer({ ...rule.value, textCalendar: 'buddhist', textFormat: 'numeric' }),
    inputCalendar: 'buddhist', textCalendar: rule.value.textCalendar, textFormat: rule.value.textFormat ?? 'numeric' });
  if (rule.flags !== 'iu') return draft;
  for (const mode of ['exact', 'contains']) {
    const pattern = mode === 'exact' ? rule.pattern.slice(1, -1) : rule.pattern;
    const source = pattern.replace(/\\([.*+?^${}()|[\]\\])/gu, '$1');
    const label = normalizeLabel(source);
    const encoded = mode === 'exact' ? `^${escapeRegex(label)}$` : escapeRegex(label);
    if (label && encoded === rule.pattern) return { ...draft, mode, source: label };
  }
  return draft;
}
