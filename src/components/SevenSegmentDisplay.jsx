import React from 'react';

// 7-segment map for digits 0-9, minus sign, and spaces
const SEGMENTS = {
  '0': ['a', 'b', 'c', 'd', 'e', 'f'],
  '1': ['b', 'c'],
  '2': ['a', 'b', 'd', 'e', 'g'],
  '3': ['a', 'b', 'c', 'd', 'g'],
  '4': ['f', 'g', 'b', 'c'],
  '5': ['a', 'f', 'g', 'c', 'd'],
  '6': ['a', 'f', 'e', 'd', 'c', 'g'],
  '7': ['a', 'b', 'c'],
  '8': ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
  '9': ['a', 'b', 'c', 'd', 'f', 'g'],
  '-': ['g'],
  ' ': []
};

// SVG paths for the 7 segments (a, b, c, d, e, f, g) inside a 30x50 bounding box
const PATHS = {
  a: "M 4,4 L 26,4 L 22,8 L 8,8 Z",
  b: "M 26,5 L 26,23 L 22,20 L 22,9 Z",
  c: "M 26,27 L 26,45 L 22,41 L 22,30 Z",
  d: "M 26,46 L 4,46 L 8,42 L 22,42 Z",
  e: "M 4,45 L 4,27 L 8,30 L 8,41 Z",
  f: "M 4,23 L 4,5 L 8,9 L 8,20 Z",
  g: "M 5,25 L 9,22 L 21,22 L 25,25 L 21,28 L 9,28 Z"
};

function SingleDigit({ char, color = '#FFC107', offColor = 'rgba(255, 193, 7, 0.12)', height = 30 }) {
  const activeSegs = SEGMENTS[char] || [];
  const width = Math.round(height * 0.62);

  return (
    <svg viewBox="0 0 30 50" style={{ width: `${width}px`, height: `${height}px`, transform: 'skewX(-7deg)', filter: 'drop-shadow(0 0 2px rgba(255, 176, 0, 0.4))' }}>
      {Object.keys(PATHS).map((segKey) => {
        const isLit = activeSegs.includes(segKey);
        return (
          <path
            key={segKey}
            d={PATHS[segKey]}
            fill={isLit ? color : offColor}
            style={{ transition: 'fill 0.08s ease' }}
          />
        );
      })}
    </svg>
  );
}

export default function SevenSegmentDisplay({ value = '0', color = '#FFC107', offColor = 'rgba(255, 193, 7, 0.12)', height = 30, digits = 5 }) {
  const strVal = String(value).replace(/[^0-9-]/g, '');
  const padded = strVal.padStart(digits, ' ').slice(-digits);

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', padding: '0 2px' }}>
      {padded.split('').map((ch, idx) => (
        <SingleDigit key={idx} char={ch} color={color} offColor={offColor} height={height} />
      ))}
    </div>
  );
}
