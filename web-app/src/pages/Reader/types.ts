export interface ReaderSettingsState {
  appearance: 'light' | 'sepia' | 'dark';
  typography: 'serif' | 'sans';
  textSize: 'small' | 'medium' | 'large';
  textHeight: 'small' | 'medium' | 'large';
  alignment: 'left' | 'center' | 'justify';
  pageMargins: 'narrow' | 'medium' | 'wide';
  guideColor: string;
}

export const defaultSettings: ReaderSettingsState = {
  appearance: 'light',
  typography: 'sans',
  textSize: 'medium',
  textHeight: 'medium',
  alignment: 'left',
  pageMargins: 'medium',
  guideColor: '#fef08a', // Default yellow
};
