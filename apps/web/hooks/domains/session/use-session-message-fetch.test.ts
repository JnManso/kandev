import { describe, expect, it, vi } from "vitest";
import type { Message } from "@/lib/types/http";
import { doFetchMessages } from "./use-session-message-fetch";

const SESSION_ID = "session-1";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function makeParams(
  fetchAndStoreMessages: (
    sessionId: string,
    store: never,
    isActive?: () => boolean,
  ) => Promise<Message[]>,
  setMessagesLoading: ReturnType<typeof vi.fn>,
) {
  return {
    taskSessionId: SESSION_ID,
    store: {
      getState: () => ({ setMessagesLoading, setMessages: vi.fn() }),
    } as never,
    setIsLoading: vi.fn(),
    setIsWaitingForInitialMessages: vi.fn(),
    setHistoryStatus: vi.fn(),
    setHistoryError: vi.fn(),
    initialFetchStartRef: { current: null },
    lastFetchedSessionIdRef: { current: null },
    fetchAndStoreMessages,
  };
}

describe("doFetchMessages", () => {
  it("settles a tool-only initial fetch without waiting for older history", async () => {
    const setMessagesLoading = vi.fn();
    const params = makeParams(
      vi.fn().mockResolvedValue([
        {
          id: "tool-1",
          type: "tool_call",
          author_type: "agent",
        } as Message,
      ]),
      setMessagesLoading,
    );

    await doFetchMessages(params as never);

    expect(setMessagesLoading).toHaveBeenLastCalledWith(SESSION_ID, false);
  });

  it("keeps the shared loading flag set until overlapping fetches all settle", async () => {
    const first = deferred<Message[]>();
    const second = deferred<Message[]>();
    const fetchAndStoreMessages = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const setMessagesLoading = vi.fn();

    const firstFetch = doFetchMessages(
      makeParams(fetchAndStoreMessages, setMessagesLoading) as never,
    );
    const secondFetch = doFetchMessages(
      makeParams(fetchAndStoreMessages, setMessagesLoading) as never,
    );

    expect(setMessagesLoading).toHaveBeenNthCalledWith(1, SESSION_ID, true);
    expect(setMessagesLoading).toHaveBeenNthCalledWith(2, SESSION_ID, true);

    first.resolve([]);
    await firstFetch;
    expect(setMessagesLoading).toHaveBeenCalledTimes(2);

    second.resolve([]);
    await secondFetch;
    expect(setMessagesLoading).toHaveBeenLastCalledWith(SESSION_ID, false);
  });

  it("releases store and local loading bookkeeping when a stale fetch settles", async () => {
    const result = deferred<Message[]>();
    const setMessagesLoading = vi.fn();
    const params = makeParams(vi.fn().mockReturnValue(result.promise), setMessagesLoading);
    const isActive = { value: true };
    const fetch = doFetchMessages({ ...params, isActive: () => isActive.value } as never);

    isActive.value = false;
    result.resolve([]);
    await fetch;

    expect(params.setIsLoading).toHaveBeenLastCalledWith(false);
    expect(params.setIsWaitingForInitialMessages).toHaveBeenLastCalledWith(true);
    expect(setMessagesLoading).toHaveBeenLastCalledWith(SESSION_ID, false);
  });

  it("does not finalize a newer hook generation from a stale fetch", async () => {
    const result = deferred<Message[]>();
    const setMessagesLoading = vi.fn();
    const params = makeParams(vi.fn().mockReturnValue(result.promise), setMessagesLoading);
    const isActive = { value: true };
    const fetch = doFetchMessages({
      ...params,
      isActive: () => isActive.value,
      canFinalizeLoading: () => isActive.value,
    } as never);

    isActive.value = false;
    result.resolve([]);
    await fetch;

    expect(params.setIsLoading).toHaveBeenLastCalledWith(true);
    expect(setMessagesLoading).toHaveBeenLastCalledWith(SESSION_ID, false);
  });

  it("preserves cached messages when the history request fails", async () => {
    const setMessages = vi.fn();
    const setMessagesLoading = vi.fn();
    const store = {
      getState: () => ({ setMessages, setMessagesLoading }),
    } as unknown as Parameters<typeof doFetchMessages>[0]["store"];
    const lastFetchedSessionIdRef = { current: null as string | null };
    const initialFetchStartRef = { current: null as number | null };

    await doFetchMessages({
      taskSessionId: SESSION_ID,
      store,
      setIsLoading: vi.fn(),
      setIsWaitingForInitialMessages: vi.fn(),
      setHistoryStatus: vi.fn(),
      setHistoryError: vi.fn(),
      initialFetchStartRef,
      lastFetchedSessionIdRef,
      fetchAndStoreMessages: vi.fn().mockRejectedValue(new Error("history unavailable")),
      onError: vi.fn(),
    });

    expect(setMessages).not.toHaveBeenCalled();
    expect(lastFetchedSessionIdRef.current).toBeNull();
  });
});

describe("doFetchMessages background refresh", () => {
  it("refreshes a transcript already on screen in the background without loading feedback", async () => {
    const result = deferred<Message[]>();
    const setMessagesLoading = vi.fn();
    const params = makeParams(vi.fn().mockReturnValue(result.promise), setMessagesLoading);
    const shown = [{ id: "m1" } as Message];
    params.store = {
      getState: () => ({
        setMessagesLoading,
        setMessages: vi.fn(),
        messages: { bySession: { [SESSION_ID]: shown } },
      }),
    } as never;

    // A recovery resets the fetched marker, so this is also its first fetch.
    const fetch = doFetchMessages({ ...params, background: true } as never);
    expect(params.setIsLoading).not.toHaveBeenCalledWith(true);
    expect(params.setHistoryStatus).not.toHaveBeenCalledWith("loading");
    expect(setMessagesLoading).toHaveBeenCalledWith(SESSION_ID, true);

    result.resolve([]);
    await fetch;
    expect(params.setIsLoading).toHaveBeenLastCalledWith(false);
    expect(params.setHistoryStatus).toHaveBeenLastCalledWith("ready");
    expect(setMessagesLoading).toHaveBeenLastCalledWith(SESSION_ID, false);
  });

  it("still shows loading feedback when a background refresh has nothing on screen", async () => {
    const setMessagesLoading = vi.fn();
    const params = makeParams(vi.fn().mockResolvedValue([]), setMessagesLoading);

    await doFetchMessages({ ...params, background: true } as never);

    expect(params.setIsLoading).toHaveBeenCalledWith(true);
    expect(params.setHistoryStatus).toHaveBeenCalledWith("loading");
  });
});
