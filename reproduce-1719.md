# Reproduction: Cannot delete/edit a project under Settings > Projects

Issue: https://github.com/openchamber/openchamber/issues/1719

## Summary

The Settings > Projects page has no UI to delete a project. The `removeProject` store action exists in `useProjectsStore` but is not connected to any button in the Projects settings page.

## Code analysis

### Store action exists (useProjectsStore.ts, line 51, 568)

```ts
removeProject: (id: string) => void;
```

The `removeProject` method is fully implemented in `packages/ui/src/stores/useProjectsStore.ts` (line 568–603):
- Filters the project out of the list
- Updates active project if needed
- Persists changes to localStorage and desktop settings
- Cleans up worktree entries
- Switches directory

### But no UI to trigger it in Settings

**`packages/ui/src/components/sections/projects/ProjectsSidebar.tsx`** (line 95–107):
The `SettingsSidebarItem` for each project does NOT pass an `actions` prop, so there's no dropdown menu with a delete option. Compare this to other settings sidebars (e.g., snippets, agents) that provide delete/remove actions.

**`packages/ui/src/components/sections/projects/ProjectsPage.tsx`** (lines 241–506):
The main page content shows:
- Project name input
- Color picker
- Icon picker  
- Save button
- Project actions section
- Worktree section

There is NO "Delete Project" or "Remove Project" button anywhere in the page.

### Usage of removeProject elsewhere

The `removeProject` store method IS used in other parts of the app:
- `packages/ui/src/components/session/SessionSidebar.tsx` (line 267)
- `packages/ui/src/apps/MobileSessionsSheet.tsx` (line 515)

But NOT in the Settings > Projects page.

## Steps to reproduce

1. Build and run the application
2. Go to Settings > Projects
3. Observe that the list of projects is shown
4. Click on any project
5. Observe there is no "Delete", "Remove", or similar button anywhere on the page

## Expected behavior

The project settings page should provide a way to delete/remove a project, consistent with other settings pages (git-identities, agents, snippets, MCP servers, etc.) that all have delete functionality.

## Root cause

The `removeProject` action was implemented in the store but the corresponding UI was never added to the Settings > Projects page. The `ProjectsSidebar` doesn't pass an `actions` prop to `SettingsSidebarItem`, and the `ProjectsPage` doesn't include a delete button in the page content.
