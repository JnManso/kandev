import { expect, type Page } from "@playwright/test";
import { test } from "../../fixtures/test-base";
import { seedIdleSession } from "../../helpers/session";

const HISTORY_LOADING = "[data-testid='session-history-loading']";

/** Records whether the history loading banner is ever inserted, however briefly. */
async function watchHistoryBanner(page: Page) {
  await page.evaluate((selector) => {
    const w = window as unknown as { __historyBannerSeen?: boolean };
    w.__historyBannerSeen = false;
    new MutationObserver(() => {
      if (document.querySelector(selector)) w.__historyBannerSeen = true;
    }).observe(document.body, { childList: true, subtree: true });
  }, HISTORY_LOADING);
  return () =>
    page.evaluate(
      () => (window as unknown as { __historyBannerSeen?: boolean }).__historyBannerSeen,
    );
}

/** Proxies the app socket and drops the next conversation change once armed. */
async function dropNextConversationChange(page: Page) {
  const state = { armed: false, dropped: false };
  await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => server.send(message));
    server.onMessage((message) => {
      const text = String(message);
      const isChange =
        text.includes('"session.conversation.changed"') && text.includes('"operations":[{');
      if (state.armed && isChange) {
        state.armed = false;
        state.dropped = true;
        return;
      }
      ws.send(message);
    });
  });
  return state;
}

test("a conversation gap is recovered in place without a history loading banner", async ({
  testPage,
  apiClient,
  seedData,
}) => {
  test.setTimeout(120_000);
  const socket = await dropNextConversationChange(testPage);
  const session = await seedIdleSession(testPage, apiClient, seedData, "Silent gap recovery");
  const bannerSeen = await watchHistoryBanner(testPage);

  socket.armed = true;
  await session.sendMessage("/e2e:simple-message");
  await session.waitForChatIdle({ timeout: 30_000, requireEditable: true });
  await expect(session.activeChat().getByText("/e2e:simple-message")).toHaveCount(2);
  expect(socket.dropped).toBe(true);

  expect(await bannerSeen()).toBe(false);
});
