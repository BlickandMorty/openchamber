import React, { useCallback, useEffect, useState } from 'react';
import { Icon } from '@/components/icon/Icon';
import type { IconName } from '@/components/icon/icons';
import { gooseEngineClient } from '@/epistemos/gooseClient';
import { useSessionUIStore } from '@/sync/session-ui-store';

// EPISTEMOS overlay (Plan 1-PRO §7 Phase 4 / §8 goose-only row): a
// self-contained, THEME-COMPLIANT, read-only panel that surfaces goose's
// reserved value — recipes, scheduled jobs, MCP extensions — using the
// adapter methods over the verified /goose/* endpoints.
//
// This is the COMPONENT, not a mounted feature: the owner decides placement
// (a badge-gated tab, a sidebar section, a settings page). Render it only when
// a goose session is active — pass `active` accordingly. All colors come from
// theme tokens; all icons from the shared Icon sprite (theme-system skill).

type CapabilityRow = { id: string; title: string; subtitle?: string };

const asRows = (
    payload: unknown,
    pick: (item: Record<string, unknown>, index: number) => CapabilityRow | null,
): CapabilityRow[] => {
    if (!payload || typeof payload !== 'object') return [];
    const container = payload as Record<string, unknown>;
    // Tolerate {manifests|jobs|extensions|tools|apps|items: [...]} or a bare array.
    const list =
        (container.manifests as unknown[]) ??
        (container.jobs as unknown[]) ??
        (container.extensions as unknown[]) ??
        (container.tools as unknown[]) ??
        (container.apps as unknown[]) ??
        (container.items as unknown[]) ??
        (Array.isArray(payload) ? (payload as unknown[]) : []);
    if (!Array.isArray(list)) return [];
    return list
        .map((item, index) => (item && typeof item === 'object' ? pick(item as Record<string, unknown>, index) : null))
        .filter((row): row is CapabilityRow => row !== null);
};

const str = (value: unknown): string | undefined => (typeof value === 'string' && value.length > 0 ? value : undefined);

type Section = {
    key: string;
    label: string;
    icon: IconName;
    load: () => Promise<CapabilityRow[]>;
};

const SECTIONS: Section[] = [
    {
        key: 'extensions',
        label: 'MCP Extensions',
        icon: 'plug',
        load: async () =>
            asRows(await gooseEngineClient.listExtensions(), (item) => {
                const name = str(item.display_name) ?? str(item.name);
                if (!name) return null;
                return {
                    id: `ext-${str(item.name) ?? name}`,
                    title: name,
                    subtitle: str(item.description),
                };
            }),
    },
    {
        key: 'recipes',
        label: 'Recipes',
        icon: 'book',
        load: async () =>
            asRows(await gooseEngineClient.listRecipes(), (item, index) => {
                const title = str(item.title) ?? str(item.name) ?? `Recipe ${index + 1}`;
                return { id: `recipe-${str(item.id) ?? index}`, title, subtitle: str(item.description) };
            }),
    },
    {
        key: 'schedules',
        label: 'Scheduled Jobs',
        icon: 'calendar-schedule',
        load: async () =>
            asRows(await gooseEngineClient.listSchedules(), (item, index) => {
                const title = str(item.id) ?? str(item.name) ?? `Job ${index + 1}`;
                return { id: `job-${title}`, title, subtitle: str(item.cron) ?? str(item.source) };
            }),
    },
    {
        key: 'tools',
        label: 'Tools & Skills',
        icon: 'tools',
        load: async () => {
            const sid = useSessionUIStore.getState().currentSessionId;
            if (!sid) return [];
            return asRows(await gooseEngineClient.tools(sid), (item, index) => {
                const name = str(item.name) ?? str(item.display_name);
                if (!name) return null;
                return { id: `tool-${name}-${index}`, title: name, subtitle: str(item.description) };
            });
        },
    },
    {
        key: 'apps',
        label: 'Apps & CLIs',
        icon: 'terminal-box',
        load: async () =>
            asRows(await gooseEngineClient.listApps(), (item, index) => {
                const name = str(item.name) ?? str(item.title);
                if (!name) return null;
                return { id: `app-${name}-${index}`, title: name, subtitle: str(item.description) };
            }),
    },
];

type SectionState = { loading: boolean; rows: CapabilityRow[]; error: string | null };

export const EpistemosGooseCapabilitiesPanel: React.FC<{ active: boolean }> = ({ active }) => {
    const [states, setStates] = useState<Record<string, SectionState>>({});

    const reload = useCallback(async () => {
        const next: Record<string, SectionState> = {};
        for (const section of SECTIONS) next[section.key] = { loading: true, rows: [], error: null };
        setStates(next);
        await Promise.all(
            SECTIONS.map(async (section) => {
                try {
                    const rows = await section.load();
                    setStates((prev) => ({ ...prev, [section.key]: { loading: false, rows, error: null } }));
                } catch (error) {
                    setStates((prev) => ({
                        ...prev,
                        [section.key]: {
                            loading: false,
                            rows: [],
                            error: error instanceof Error ? error.message : 'Failed to load',
                        },
                    }));
                }
            }),
        );
    }, []);

    useEffect(() => {
        if (active) void reload();
    }, [active, reload]);

    if (!active) return null;

    return (
        <div className="flex flex-col gap-4 p-4" style={{ color: 'var(--foreground)' }}>
            <div className="flex items-center justify-between">
                <span className="text-body-md font-medium">Goose capabilities</span>
                <button
                    type="button"
                    onClick={() => void reload()}
                    className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs hover:bg-[var(--interactive-hover)]"
                    style={{ color: 'var(--muted-foreground)' }}
                    aria-label="Refresh goose capabilities"
                >
                    <Icon name="refresh" className="h-3.5 w-3.5" />
                    Refresh
                </button>
            </div>

            {SECTIONS.map((section) => {
                const state = states[section.key] ?? { loading: true, rows: [], error: null };
                return (
                    <section key={section.key} className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-1.5" style={{ color: 'var(--muted-foreground)' }}>
                            <Icon name={section.icon} className="h-3.5 w-3.5" />
                            <span className="text-body-sm font-medium">{section.label}</span>
                        </div>

                        {state.loading ? (
                            <div className="flex items-center gap-2 px-1 text-body-sm" style={{ color: 'var(--muted-foreground)' }}>
                                <Icon name="loader-4" className="h-3.5 w-3.5 animate-spin" />
                                Loading…
                            </div>
                        ) : state.error ? (
                            <span className="px-1 text-body-sm" style={{ color: 'var(--status-error)' }}>
                                {state.error}
                            </span>
                        ) : state.rows.length === 0 ? (
                            <span className="px-1 text-body-sm" style={{ color: 'var(--muted-foreground)' }}>
                                None yet.
                            </span>
                        ) : (
                            <ul className="flex flex-col gap-1">
                                {state.rows.map((row) => (
                                    <li
                                        key={row.id}
                                        className="rounded-md border px-2.5 py-1.5"
                                        style={{
                                            borderColor: 'var(--border)',
                                            backgroundColor: 'var(--surface-elevated)',
                                        }}
                                    >
                                        <div className="text-body-sm font-medium">{row.title}</div>
                                        {row.subtitle ? (
                                            <div className="text-body-sm" style={{ color: 'var(--muted-foreground)' }}>
                                                {row.subtitle}
                                            </div>
                                        ) : null}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>
                );
            })}
        </div>
    );
};
