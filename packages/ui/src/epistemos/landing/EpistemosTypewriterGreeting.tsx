import React, { useEffect, useState } from 'react';

// EPISTEMOS overlay (Plan 1-PRO §5): the RetroGaming typewriter greeting —
// landing headline treatment only. It types the DONOR's own localized string,
// so i18n and copy stay stock; the signature is the font + the effect.

const TYPE_INTERVAL_MS = 46;

const prefersReducedMotion = (): boolean =>
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const EpistemosTypewriterGreeting: React.FC<{ text: string; className?: string }> = ({ text, className }) => {
    const [visibleCount, setVisibleCount] = useState(() => (prefersReducedMotion() ? text.length : 0));

    useEffect(() => {
        if (prefersReducedMotion()) {
            setVisibleCount(text.length);
            return;
        }
        setVisibleCount(0);
        let index = 0;
        const timer = window.setInterval(() => {
            index += 1;
            setVisibleCount(index);
            if (index >= text.length) {
                window.clearInterval(timer);
            }
        }, TYPE_INTERVAL_MS);
        return () => window.clearInterval(timer);
    }, [text]);

    return (
        <span className={className ? `epistemos-typewriter ${className}` : 'epistemos-typewriter'} aria-label={text}>
            <span aria-hidden="true">{text.slice(0, Math.min(visibleCount, text.length))}</span>
            <span className="epistemos-typewriter-caret" aria-hidden="true" />
        </span>
    );
};
