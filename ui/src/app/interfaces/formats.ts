import { Quality } from './quality';

export interface Option {
  id: string;
  text: string;
}

export interface AudioFormatOption extends Option {
  qualities: Quality[];
}

export const AUDIO_FORMATS: AudioFormatOption[] = [
  {
    id: 'mp3',
    text: 'MP3',
    qualities: [
      { id: 'best', text: 'Best' },
      { id: '320', text: '320 kbps' },
      { id: '192', text: '192 kbps' },
      { id: '128', text: '128 kbps' },
    ],
  },
  {
    id: 'm4a',
    text: 'M4A',
    qualities: [
      { id: 'best', text: 'Best' },
      { id: '192', text: '192 kbps' },
      { id: '128', text: '128 kbps' },
    ],
  },
  { id: 'opus', text: 'Opus', qualities: [{ id: 'best', text: 'Best' }] },
  { id: 'flac', text: 'FLAC', qualities: [{ id: 'best', text: 'Best' }] },
  { id: 'wav', text: 'WAV', qualities: [{ id: 'best', text: 'Best' }] },
];
