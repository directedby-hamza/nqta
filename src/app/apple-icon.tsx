import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#175c46',
        color: '#fffdf7',
        fontSize: 49,
        fontWeight: 700,
        letterSpacing: '-3px',
      }}
    >
      nqta.
    </div>,
    size,
  );
}
