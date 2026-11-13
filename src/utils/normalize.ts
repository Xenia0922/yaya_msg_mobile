// 分级标准化：严格/中等/宽松三档
export type NormLevel = 'strict' | 'medium' | 'loose';

function removeBrackets(s: string): string {
  return s.replace(/[\(\（\[].*?[\)\）\]]/g, '').replace(/\s+/g, ' ').trim();
}

function removeNoise(s: string): string {
  return s
    .replace(/[\(\（\[].*?[\)\）\]]/g, '')      // 括号内容
    .replace(/[～～\~\-\–\—\:\：\|\/\.\,\，\、\!\！]/g, ' ') // 标点
    .replace(/\b(feat\.?|ft\.?|ver\.?|version|live|inst\.?|instrumental|off vocal|伴奏|remix|cover|翻唱)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeSong(keyword: string): { strict: string; medium: string; loose: string } {
  const strict = keyword.toLowerCase().replace(/\s+/g, ' ').trim();
  const medium = removeBrackets(keyword).toLowerCase().replace(/\s+/g, ' ').trim();
  const loose = removeNoise(keyword).toLowerCase().replace(/\s+/g, '').trim();
  return { strict, medium, loose };
}

export function normalizeArtist(keyword: string): { strict: string; medium: string; loose: string } {
  const strict = keyword.toLowerCase().replace(/\s+/g, ' ').trim();
  const medium = removeBrackets(keyword).toLowerCase().replace(/\s+/g, ' ').trim();
  const loose = removeNoise(keyword).toLowerCase().replace(/\s+/g, '').trim();
  return { strict, medium, loose };
}

export function normalizeGroup(keyword: string): { strict: string; medium: string; loose: string } {
  const s = keyword.toUpperCase().trim();
  const match = s.match(/\b(SNH48|GNZ48|BEJ48|CKG48|CGT48|SHY48)\b/);
  return { strict: s, medium: s, loose: match?.[1] || s };
}

export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  let matches = 0;
  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;
  for (let i = 0; i < shorter.length; i++) {
    if (shorter[i] === longer[i]) matches++;
  }
  return matches / longer.length;
}
