import React from 'react';
import { ModelControls } from '@/components/chat/ModelControls';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { gooseEngineClient } from '@/epistemos/gooseClient';
import { useActiveEngineIsGoose } from '@/epistemos/useActiveEngine';
import { Icon } from '@/components/icon/Icon';

// EPISTEMOS overlay (Plan 1-PRO §0.6 capability truth): the composer model
// control must RE-DERIVE from the active engine. For a goose session it shows
// goose's OWN configured providers (live-enumerated from goose's GET
// /config/providers) and NEVER the OpenCode model alias ("Big Pickle"); for an
// OpenCode session it is the untouched donor ModelControls. The instant the
// engine chip flips, this re-renders from the new engine's live config.

const MemoModelControls = React.memo(ModelControls);

type GooseProvider = { name: string; displayName: string; defaultModel: string; models: string[] };

const GooseModelButton: React.FC<{ className?: string }> = ({ className }) => {
    const currentSessionId = useSessionUIStore((s) => s.currentSessionId);
    const [providers, setProviders] = React.useState<GooseProvider[]>([]);
    const [active, setActive] = React.useState<string | null>(null);
    const [open, setOpen] = React.useState(false);
    const rootRef = React.useRef<HTMLDivElement>(null);
    // Guards the initial load from clobbering a fast user pick (pick-during-load race).
    const pickedRef = React.useRef(false);

    React.useEffect(() => {
        let cancelled = false;
        void Promise.all([
            gooseEngineClient.listConfiguredProviders().catch(() => [] as GooseProvider[]),
            gooseEngineClient.getActiveProvider().catch(() => null),
        ]).then(([ps, a]) => {
            if (cancelled) return;
            setProviders(ps);
            if (!pickedRef.current) setActive(a);
        });
        return () => {
            cancelled = true;
        };
    }, []);

    React.useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [open]);

    const activeProvider = providers.find((p) => p.name === active);
    const label = activeProvider
        ? activeProvider.defaultModel
            ? `${activeProvider.displayName} · ${activeProvider.defaultModel}`
            : activeProvider.displayName
        : active ?? 'Select goose provider';

    const pick = async (name: string) => {
        pickedRef.current = true;
        setActive(name);
        setOpen(false);
        // Persist as goose's config default so a NEW draft's session (created on
        // send, via applyConfiguredProvider) adopts it too — not just the label.
        await gooseEngineClient.setActiveProvider(name).catch(() => undefined);
        // Apply immediately to a live session.
        if (currentSessionId) {
            await gooseEngineClient.setSessionProvider(currentSessionId, name).catch(() => undefined);
        }
    };

    return (
        <div ref={rootRef} className={className} style={{ position: 'relative' }}>
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="inline-flex items-center gap-1 rounded px-2 py-1 typography-meta text-[var(--surface-mutedForeground)] hover:bg-[var(--interactive-hover)]"
                title="goose provider (live from goose config)"
                aria-haspopup="listbox"
                aria-expanded={open}
            >
                <Icon name="plug" className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="truncate max-w-[11rem]">{label}</span>
                <Icon name="arrow-down-s" className="h-3.5 w-3.5 flex-shrink-0" />
            </button>
            {open && (
                <div
                    role="listbox"
                    className="absolute bottom-full right-0 mb-1 z-50 min-w-[13rem] max-h-72 overflow-y-auto rounded border border-[var(--interactive-border)] bg-[var(--surface-elevated)] p-1 shadow-lg"
                >
                    <div className="typography-micro text-[var(--surface-mutedForeground)] px-2 py-1">
                        goose providers · live
                    </div>
                    {providers.length === 0 && (
                        <div className="px-2 py-1 typography-meta text-[var(--surface-mutedForeground)]">
                            No configured goose providers
                        </div>
                    )}
                    {providers.map((p) => (
                        <button
                            key={p.name}
                            type="button"
                            role="option"
                            aria-selected={p.name === active}
                            onClick={() => void pick(p.name)}
                            className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left typography-meta hover:bg-[var(--interactive-hover)] ${
                                p.name === active
                                    ? 'text-[var(--surface-foreground)]'
                                    : 'text-[var(--surface-mutedForeground)]'
                            }`}
                        >
                            <span className="truncate">{p.displayName}</span>
                            {p.name === active && <Icon name="check" className="h-3.5 w-3.5 flex-shrink-0" />}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

export const EpistemosEngineModelControls: React.FC<{ className?: string }> = ({ className }) => {
    const isGoose = useActiveEngineIsGoose();
    if (isGoose) return <GooseModelButton className={className} />;
    return <MemoModelControls className={className} />;
};
