import { parseMaybeJson } from './data';

const FLIP_KEYS = ['flipCardInfo', 'filpCardInfo', 'flipCardAudioInfo', 'filpCardAudioInfo', 'flipCardVideoInfo', 'filpCardVideoInfo'];

function validId(value: unknown): string {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return '';
  const id = String(value ?? '');
  return /^[1-9]\d{0,31}$/.test(id) ? id : '';
}

export function getRoomFlipInfo(payload: any, type: string) {
  if (!payload || typeof payload !== 'object' || !`${type} ${payload.messageType || ''}`.toUpperCase().includes('FLIPCARD')) return null;
  const nested = parseMaybeJson(payload.bodys) || {};
  const info = FLIP_KEYS.map((key) => parseMaybeJson(payload[key] || nested[key])).find((value) => value && typeof value === 'object') || payload;
  const answer = info.answer ?? payload.answer ?? '';
  let answerText = '';
  if (typeof answer === 'string') {
    try { const parsed = JSON.parse(answer); answerText = String(parsed?.text || parsed?.content || ''); }
    catch { answerText = answer; }
  }
  return { question: String(info.question || payload.question || ''), answerText, questionId: validId(info.questionId), answerId: validId(info.answerId) };
}

