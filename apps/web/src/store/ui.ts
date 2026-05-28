import { create } from 'zustand'

type UiState = {
  /** Mobile drawer visibility. On md+ the sidebar is always shown. */
  sidebarOpen: boolean
  openSidebar: () => void
  closeSidebar: () => void
  toggleSidebar: () => void
  /** Desktop-only: collapses the md+ sidebar down to a column of avatars. */
  sidebarCollapsed: boolean
  toggleSidebarCollapsed: () => void
}

export const useUi = create<UiState>((set) => ({
  sidebarOpen: false,
  openSidebar: () => set({ sidebarOpen: true }),
  closeSidebar: () => set({ sidebarOpen: false }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  sidebarCollapsed: false,
  toggleSidebarCollapsed: () =>
    set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
}))
