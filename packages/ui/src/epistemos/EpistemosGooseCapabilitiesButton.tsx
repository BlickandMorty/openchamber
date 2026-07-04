import React, { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/icon/Icon';
import { useActiveEngineIsGoose } from '@/epistemos/useActiveEngine';
import { EpistemosGooseCapabilitiesPanel } from '@/epistemos/EpistemosGooseCapabilitiesPanel';

// EPISTEMOS overlay (Plan 1-PRO §0.6 / §7 Phase 4): a goose-ONLY entry point
// that surfaces goose's live capability surface — MCP extensions, recipes, the
// scheduler, tools/skills, and apps/CLIs — reachable ONLY when a goose session
// is active. This mounts the previously-orphaned EpistemosGooseCapabilitiesPanel
// so goose's reserved value is REACHABLE (never dropped), while an OpenCode
// session never sees it (zero cross-engine bleed). The panel live-loads from
// goose's own /goose/* endpoints on open.
export const EpistemosGooseCapabilitiesButton: React.FC = () => {
    const isGoose = useActiveEngineIsGoose();
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [open]);

    if (!isGoose) return null;

    return (
        <div ref={ref} style={{ position: 'relative' }}>
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="inline-flex h-7 items-center gap-1 rounded-md px-2 typography-meta text-[var(--surface-mutedForeground)] hover:bg-[var(--interactive-hover)]"
                title="goose capabilities — extensions, recipes, scheduler, tools, apps"
                aria-haspopup="dialog"
                aria-expanded={open}
            >
                <Icon name="stack" className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="hidden sm:inline">Capabilities</span>
            </button>
            {open && (
                <div className="absolute bottom-full right-0 mb-1 z-50 w-80 max-h-[28rem] overflow-y-auto rounded-lg border border-[var(--interactive-border)] bg-[var(--surface-elevated)] p-2 shadow-xl">
                    <EpistemosGooseCapabilitiesPanel active={open} />
                </div>
            )}
        </div>
    );
};
