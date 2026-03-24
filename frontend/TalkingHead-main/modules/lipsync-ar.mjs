/**
 * Arabic Lip-sync Module for TalkingHead
 * Maps Arabic phonemes to Oculus visemes
 */

const ARABIC_TO_VISEME = {
  // Voyelles
  'ا': 'aa', 'أ': 'aa', 'إ': 'E', 'آ': 'aa',
  'و': 'O',  'ؤ': 'O',
  'ي': 'I',  'ئ': 'I',
  'ى': 'aa',
  'ه': 'E',
  // Consonnes labiales (lèvres)
  'ب': 'PP', 'م': 'PP', 'ف': 'FF', 'و': 'U',
  // Consonnes dentales
  'ت': 'TH', 'ث': 'TH', 'ذ': 'TH', 'ظ': 'TH',
  'د': 'DD', 'ر': 'RR', 'ز': 'SS', 'س': 'SS',
  'ص': 'SS', 'ض': 'DD', 'ن': 'nn', 'ل': 'nn',
  // Consonnes vélaires/gutturales
  'ك': 'kk', 'ق': 'kk', 'خ': 'kk',
  'غ': 'kk', 'ح': 'E',  'ع': 'aa',
  // Autres
  'ج': 'CH', 'ش': 'CH', 'ط': 'DD',
  'ي': 'I',  'ء': 'aa',
};

export class LipsyncAr {

  preProcessText(text) {
    // Nettoyer le texte arabe
    return text
      .replace(/[^\u0600-\u06FF\s]/g, ' ')  // garder seulement l'arabe
      .replace(/\s+/g, ' ')
      .trim();
  }

  wordsToVisemes(text) {
    const visemes    = [];
    const times      = [];
    const durations  = [];

    const chars = [...text.replace(/\s/g, '')];
    if (chars.length === 0) return { visemes, times, durations };

    // Durée moyenne par phonème en ms
    const phonemeDuration = 80;
    let t = 0;

    for (const char of chars) {
      const viseme = ARABIC_TO_VISEME[char] || 'aa';
      visemes.push(viseme);
      times.push(t);
      durations.push(phonemeDuration);
      t += phonemeDuration;
    }

    return { visemes, times, durations };
  }
}
