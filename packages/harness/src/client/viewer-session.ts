import { createContext, useContext } from 'react';

// The native viewing conversation, not a Run owner or a permission grant. Host rechecks every read.
const viewerSession = createContext<string | undefined>(undefined);
export const HimaViewerSession = viewerSession.Provider;
export const useViewerSession = (): string | undefined => useContext(viewerSession);
