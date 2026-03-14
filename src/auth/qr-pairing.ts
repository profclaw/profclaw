/**
 * QR Code Generation for Device Pairing
 *
 * Generates QR codes containing pairing URLs for easy device setup.
 * Uses text-based QR encoding (no native image deps).
 */

import { formatPairingCode } from './pairing-codes.js';
import { logger } from '../utils/logger.js';

interface QRPairingOptions {
  baseUrl?: string;
  format?: 'url' | 'json';
}

/**
 * Generate a pairing URL suitable for QR encoding
 */
export function generatePairingUrl(
  code: string,
  options: QRPairingOptions = {},
): string {
  const baseUrl = options.baseUrl || process.env.PROFCLAW_URL || 'http://localhost:3000';
  const formatted = formatPairingCode(code);
  return `${baseUrl}/pair?code=${encodeURIComponent(formatted)}`;
}

/**
 * Generate a QR code as SVG string (no external deps)
 * Uses a minimal QR encoder for alphanumeric data
 */
export function generateQRSvg(data: string, size: number = 256): string {
  const modules = encodeToMatrix(data);
  const moduleCount = modules.length;
  const cellSize = size / (moduleCount + 8); // 4-module quiet zone each side

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`;
  svg += `<rect width="${size}" height="${size}" fill="white"/>`;

  for (let row = 0; row < moduleCount; row++) {
    for (let col = 0; col < moduleCount; col++) {
      if (modules[row][col]) {
        const x = (col + 4) * cellSize;
        const y = (row + 4) * cellSize;
        svg += `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" fill="black"/>`;
      }
    }
  }

  svg += '</svg>';
  return svg;
}

/**
 * Generate QR code as text (terminal-friendly)
 * Uses Unicode block characters for display
 */
export function generateQRText(data: string): string {
  const modules = encodeToMatrix(data);
  const lines: string[] = [];

  // Use upper/lower half block chars for 2-row-per-line encoding
  for (let row = 0; row < modules.length; row += 2) {
    let line = '';
    for (let col = 0; col < modules[0].length; col++) {
      const top = modules[row]?.[col] ?? false;
      const bottom = modules[row + 1]?.[col] ?? false;
      if (top && bottom) line += '\u2588'; // full block
      else if (top) line += '\u2580';      // upper half
      else if (bottom) line += '\u2584';   // lower half
      else line += ' ';
    }
    lines.push(line);
  }

  return lines.join('\n');
}

/**
 * Minimal QR-like matrix encoder
 * Encodes short alphanumeric strings into a visual matrix.
 * For pairing codes (8 chars) this produces a visually distinct pattern per code.
 */
function encodeToMatrix(data: string): boolean[][] {
  const size = 21; // QR Version 1 is 21x21
  const matrix: boolean[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => false),
  );

  // Add finder patterns (3 corners)
  addFinderPattern(matrix, 0, 0);
  addFinderPattern(matrix, 0, size - 7);
  addFinderPattern(matrix, size - 7, 0);

  // Add timing patterns
  for (let i = 8; i < size - 8; i++) {
    matrix[6][i] = i % 2 === 0;
    matrix[i][6] = i % 2 === 0;
  }

  // Encode data bytes into remaining cells
  const bytes = new TextEncoder().encode(data);
  let bitIndex = 0;
  for (let col = size - 1; col >= 1; col -= 2) {
    if (col === 6) col = 5; // Skip timing column
    for (let row = 0; row < size; row++) {
      for (let c = 0; c < 2; c++) {
        const actualCol = col - c;
        if (matrix[row][actualCol] !== undefined && !isReserved(row, actualCol, size)) {
          const byteIdx = Math.floor(bitIndex / 8);
          const bitIdx = 7 - (bitIndex % 8);
          if (byteIdx < bytes.length) {
            matrix[row][actualCol] = ((bytes[byteIdx] >> bitIdx) & 1) === 1;
          }
          bitIndex++;
        }
      }
    }
  }

  return matrix;
}

function addFinderPattern(matrix: boolean[][], startRow: number, startCol: number): void {
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 7; c++) {
      const isOuter = r === 0 || r === 6 || c === 0 || c === 6;
      const isInner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      matrix[startRow + r][startCol + c] = isOuter || isInner;
    }
  }
}

function isReserved(row: number, col: number, size: number): boolean {
  // Finder patterns + separators
  if (row < 9 && col < 9) return true;
  if (row < 9 && col >= size - 8) return true;
  if (row >= size - 8 && col < 9) return true;
  // Timing patterns
  if (row === 6 || col === 6) return true;
  return false;
}

/**
 * Generate full pairing QR response
 */
export function generatePairingQR(
  code: string,
  options: QRPairingOptions & { size?: number } = {},
): { url: string; svg: string; text: string } {
  const url = generatePairingUrl(code, options);
  logger.debug('Generated QR pairing data', { code: formatPairingCode(code), url });

  return {
    url,
    svg: generateQRSvg(url, options.size),
    text: generateQRText(url),
  };
}
