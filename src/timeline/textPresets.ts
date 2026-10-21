import type { TextData, Transform } from '../types';

export interface TextPreset {
  id: string;
  label: string;
  text: Partial<TextData>;
  /** Where the preset places itself, e.g. subtitles near the bottom. */
  transform?: Partial<Transform>;
}

export const TEXT_PRESETS: TextPreset[] = [
  { id: 'default', label: 'Default', text: {} },
  { id: 'title', label: 'Title', text: { content: 'Title', fontFamily: 'Impact', fontSize: 140 } },
  {
    id: 'subtitle',
    label: 'Subtitle',
    text: { content: 'Subtitle text', fontSize: 48, backgroundOpacity: 0.6 },
    transform: { y: 0.38 },
  },
  {
    id: 'outline',
    label: 'Outline',
    text: { content: 'Outline', bold: true, fontSize: 96, color: '#ffe14d', strokeWidth: 0.08 },
  },
  { id: 'shadow', label: 'Shadow', text: { content: 'Shadow', bold: true, fontSize: 96, shadow: true } },
  {
    id: 'boxed',
    label: 'Boxed',
    text: { content: 'Boxed', bold: true, color: '#111111', backgroundColor: '#ffffff', backgroundOpacity: 1 },
  },
  {
    id: 'typewriter',
    label: 'Typewriter',
    text: { content: 'Typing…', fontFamily: 'Courier New', bold: true, animationIn: 'typewriter' },
  },
  {
    id: 'pop',
    label: 'Pop',
    text: { content: 'POP!', fontFamily: 'Impact', fontSize: 120, color: '#ff4fa3', strokeWidth: 0.06, strokeColor: '#ffffff', animationIn: 'pop', animationOut: 'pop' },
  },
];

/** Emoji stickers. They render as large text, so they get every text transform and animation. */
export const STICKERS = [
  '😀', '😂', '😍', '🥳', '😎', '🤯', '😭', '😡', '👍', '👏', '🙌', '🙏', '💪', '👀', '🔥', '✨',
  '💯', '❤️', '💔', '⭐', '🌈', '☀️', '⚡', '🎉', '🎁', '🎵', '📸', '🎬', '🚀', '💡', '✅', '❌',
  '⚠️', '➡️', '⬅️', '⬆️', '⬇️', '💬', '🗯️', '💰',
];

export const STICKER_TEXT: Partial<TextData> = { fontSize: 220, fontFamily: 'Arial' };
