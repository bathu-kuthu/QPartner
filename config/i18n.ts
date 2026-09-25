import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import AsyncStorage from '@react-native-async-storage/async-storage';

import en from '../assets/translations/en.json';
import ta from '../assets/translations/ta.json';

const resources = {
  en: { translation: en },
  ta: { translation: ta },
};

const LANGUAGE_KEY = 'user-language';

const initI18n = async () => {
  // Skip AsyncStorage during SSR (expo-router static render in Node.js — window/window is undefined)
  const isSSR = typeof window === 'undefined';

  let savedLanguage: string | null = null;

  if (!isSSR) {
    savedLanguage = await AsyncStorage.getItem(LANGUAGE_KEY);
  }

  if (!savedLanguage) {
    const locales = Localization.getLocales();
    const systemLanguage = locales[0]?.languageCode || 'en';
    savedLanguage = systemLanguage === 'ta' ? 'ta' : 'en';
  }

  i18n
    .use(initReactI18next)
    .init({
      resources,
      lng: savedLanguage,
      fallbackLng: 'en',
      interpolation: {
        escapeValue: false,
      },
    });
};

initI18n();

export default i18n;
