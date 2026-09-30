/**
 * The tag the label designer (Settings → Labels) draws, kept in settings as `labelLayout` so the
 * shop's layout survives a reload and is the same on every device (it was page state only).
 */
export interface LabelField {
  id: string;
  type: 'text' | 'qr';
  x: number;
  y: number;
  rotation?: 0 | 90 | 180 | 270;
  data: string;
  fontFamily?: string;
  fontSize?: number;
  qrMagnification?: number;
}

export interface StoredLabelLayout {
  id: string;
  name: string;
  widthDots: number;
  heightDots: number;
  fields: LabelField[];
}
