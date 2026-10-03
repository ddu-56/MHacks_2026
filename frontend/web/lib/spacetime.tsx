'use client';

import { useMemo } from 'react';
import { SpacetimeDBProvider } from 'spacetimedb/react';
import { DbConnection } from '@holdless/db';

const HOST = process.env.NEXT_PUBLIC_SPACETIMEDB_HOST || 'ws://127.0.0.1:3000';
const MODULE = process.env.NEXT_PUBLIC_SPACETIMEDB_MODULE || 'holdless';
const TOKEN_KEY = `holdless:${HOST}/${MODULE}/token`;

function readToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || undefined;
  } catch {
    return undefined;
  }
}

export function SpacetimeProvider({ children }: { children: React.ReactNode }) {
  const builder = useMemo(
    () =>
      DbConnection.builder()
        .withUri(HOST)
        .withDatabaseName(MODULE)
        .withToken(typeof window === 'undefined' ? undefined : readToken())
        .onConnect((_conn, _identity, token) => {
          try {
            localStorage.setItem(TOKEN_KEY, token);
          } catch {}
        })
        .onConnectError((_ctx, err) => {
          // A stale token from a wiped local database is the usual cause; retry anonymously next load.
          console.warn('SpacetimeDB connection error', err);
          try {
            localStorage.removeItem(TOKEN_KEY);
          } catch {}
        }),
    [],
  );
  return <SpacetimeDBProvider connectionBuilder={builder}>{children}</SpacetimeDBProvider>;
}

export const SPACETIME_TARGET = `${HOST} · ${MODULE}`;
