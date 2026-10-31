export const LANGUAGES = [
  { code: "en", name: "English" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "it", name: "Italian" },
  { code: "pt-BR", name: "Portuguese (Brazil)" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "zh-CN", name: "Chinese (Simplified)" },
  { code: "ar", name: "Arabic" },
  { code: "hi", name: "Hindi" },
  { code: "ru", name: "Russian" },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]["code"];

const languageMap = new Map<string, (typeof LANGUAGES)[number]>(
  LANGUAGES.map((language) => [language.code.toLowerCase(), language]),
);

export function getLanguage(code: string | null | undefined) {
  if (!code) return LANGUAGES[0];
  return languageMap.get(code.toLowerCase()) ?? LANGUAGES[0];
}

export function isSupportedLanguage(code: string): code is LanguageCode {
  return languageMap.has(code.toLowerCase());
}
