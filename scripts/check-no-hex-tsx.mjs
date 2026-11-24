/**
 * Lint / CI guard: fails if any hard-coded hex (#rgb, #rrggbb, #rrggbbaa)
 * or rgb()/rgba() color literal appears in app/**\/*.tsx or components/**\/*.tsx.
 *
 * All UI colors in TSX must reference CSS design tokens from app/tokens.css
 * (or lib/theme-tokens.ts for non-DOM print/WebGL/viewport buffers).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scanDirs = ['app', 'components'];
const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(/g;

function walkTsx(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walkTsx(full, out);
    } else if (entry.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

const violations = [];
for (const relDir of scanDirs) {
  const absDir = path.join(root, relDir);
  for (const file of walkTsx(absDir)) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      const matches = line.match(COLOR_RE);
      if (matches) {
        violations.push({
          file: path.relative(root, file).replace(/\\/g, '/'),
          line: index + 1,
          matches,
          snippet: line.trim().slice(0, 120),
        });
      }
    });
  }
}

if (violations.length > 0) {
  console.error(`Found ${violations.length} hardcoded hex/rgb color literal(s) in .tsx files:`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line} [${v.matches.join(', ')}] -> ${v.snippet}`);
  }
  process.exit(1);
}

console.log('check-no-hex-tsx: OK (0 hardcoded hex/rgb color literals in app/**/*.tsx and components/**/*.tsx)');
