import React, { useEffect, useState } from 'react';
import { runtimeFetch } from '@/lib/runtime-fetch';
import { getNextSessionEngine, setNextSessionEngine, type EngineKind } from '@/epistemos/engineDispatch';

// EPISTEMOS overlay (Plan 1-PRO §0.3/§5): the composer engine chip — engine
// is chosen PER CONVERSATION at draft time; a session's engine never changes
// after creation. Capability truth: the chip renders only when the goose
// engine is actually reachable through the same-origin proxy; when goose is
// absent the composer is byte-identical to donor-stock.

let cachedGooseAvailable: boolean | null = null;

const probeGooseAvailability = async (): Promise<boolean> => {
    if (cachedGooseAvailable !== null) return cachedGooseAvailable;
    try {
        const response = await runtimeFetch('/goose/status', { headers: { Accept: 'text/plain' } });
        cachedGooseAvailable = response.ok;
    } catch {
        cachedGooseAvailable = false;
    }
    return cachedGooseAvailable;
};

export const EpistemosEngineChip: React.FC<{ visible: boolean }> = ({ visible }) => {
    const [gooseAvailable, setGooseAvailable] = useState(false);
    const [engine, setEngine] = useState<EngineKind>(getNextSessionEngine());

    useEffect(() => {
        let cancelled = false;
        void probeGooseAvailability().then((available) => {
            if (!cancelled) setGooseAvailable(available);
        });
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        // Draft closed/opened: new drafts always start on the default engine.
        if (!visible) {
            setNextSessionEngine('opencode');
            setEngine('opencode');
        }
    }, [visible]);

    if (!visible || !gooseAvailable) return null;

    const toggle = () => {
        const next: EngineKind = engine === 'goose' ? 'opencode' : 'goose';
        setEngine(next);
        setNextSessionEngine(next);
    };

    return (
        <button
            type="button"
            onClick={toggle}
            title="Engine for this new conversation"
            aria-label={`Engine: ${engine}. Click to switch.`}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-border/60 px-2 text-xs text-muted-foreground hover:bg-interactive-hover hover:text-foreground transition-colors"
        >
            <span
                aria-hidden="true"
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: engine === 'goose' ? 'var(--status-warning, #d97706)' : 'var(--primary)' }}
            />
            {engine === 'goose' ? 'goose' : 'opencode'}
        </button>
    );
};
