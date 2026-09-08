/** Display-only migration; never use this for stored IDs, voice values or credentials. */
export function displayBrand(text: string) {
  return text
    .replace(/\bCall Vaani\b/g, 'Call Vani')
    .replace(/(?<!Call )\b(?:V-A-N-I|VANI|Vaani)\b/g, 'Call Vani');
}
