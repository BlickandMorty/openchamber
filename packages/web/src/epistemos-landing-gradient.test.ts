// EPISTEMOS (Plan 1-PRO R7 P2 acceptance): the theme-derived landing gradient
// must derive correctly on >=3 themes INCLUDING a custom palette — the wash
// always follows the active primary, never a hardcoded warm value.
import { describe, expect, it } from 'vitest';
import type { Theme } from '@/types/theme';
import { CSSVariableGenerator } from '@/lib/theme/cssGenerator';
import ayuDark from '@/lib/theme/themes/ayu-dark.json';
import auraLight from '@/lib/theme/themes/aura-light.json';
import amoledDark from '@/lib/theme/themes/amoled-dark.json';

const generator = new CSSVariableGenerator();

const washLine = (primaryBase: string): string =>
    `--landing-hero-wash: color-mix(in oklch, ${primaryBase} 11%, transparent);`;

describe('epistemos landing gradient (R6c)', () => {
    const stockThemes: Array<[string, unknown]> = [
        ['ayu-dark', ayuDark],
        ['aura-light', auraLight],
        ['amoled-dark', amoledDark],
    ];

    for (const [name, raw] of stockThemes) {
        it(`derives the wash from ${name}'s own primary`, () => {
            const theme = raw as Theme;
            const css = generator.generate(theme);
            expect(css).toContain(washLine(theme.colors.primary.base));
            expect(css).toContain('--landing-hero-wash-rim: color-mix(in oklch,');
            expect(css).toContain(
                '--landing-hero-wash-gradient: linear-gradient(to bottom, transparent 30%, var(--landing-hero-wash));',
            );
        });
    }

    it('derives the wash from a CUSTOM palette primary', () => {
        const custom = JSON.parse(JSON.stringify(ayuDark)) as Theme;
        custom.colors.primary.base = '#ab4642';
        custom.colors.surface.elevated = '#101418';
        const css = generator.generate(custom);
        expect(css).toContain(washLine('#ab4642'));
        expect(css).toContain('color-mix(in oklch, #101418 70%, transparent)');
        // The wash must not carry another theme's primary.
        expect(css).not.toContain(washLine((ayuDark as Theme).colors.primary.base));
    });
});
