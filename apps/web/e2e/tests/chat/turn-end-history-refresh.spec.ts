import { expect, type Page } from "@playwright/test";
import { test } from "../../fixtures/test-base";
import { seedIdleSession } from "../../helpers/session";

const LOADING_ROWS =
  "[data-testid='session-history-loading'], [data-testid='conversation-loading-state']";
// The mock agent reports token usage for this prompt, as real agents do every turn.
const USAGE_PROMPT = "Reply briefly /with-usage";

/** Records whether either transcript loading row is ever inserted, however briefly. */
async function watchLoadingRows(page: Page) {
  await page.evaluate((selector) => {
    const w = window as unknown as { __loadingRowSeen?: boolean };
    w.__loadingRowSeen = false;
    new MutationObserver(() => {
      if (document.querySelector(selector)) w.__loadingRowSeen = true;
    }).observe(document.body, { childList: true, subtree: true });
  }, LOADING_ROWS);
  return () =>
    page.evaluate(() => (window as unknown as { __loadingRowSeen?: boolean }).__loadingRowSeen);
}

function revisionOf(text: string): number {
  const match = /"revision":"(\d+)"/.exec(text);
  return match ? Number(match[1]) : 0;
}

/**
 * Proxies the app socket. Once armed, it drops the first conversation change that
 * follows the turn's completion, so the client only finds the gap through the
 * periodic revision check while the transcript is idle. It records that check and
 * the history fetch the resulting recovery sends.
 */
async function forceIdleConversationGap(page: Page) {
  const state = {
    armed: false,
    completed: false,
    delivered: 0,
    gapChecked: false,
    recovered: false,
  };
  await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => {
      if (state.gapChecked && String(message).includes('"message.list"')) state.recovered = true;
      server.send(message);
    });
    server.onMessage((message) => {
      const text = String(message);
      if (!text.includes('"session.conversation.changed"')) return ws.send(message);
      const revision = revisionOf(text);
      if (text.includes('"check":true')) {
        if (state.completed && revision > state.delivered) state.gapChecked = true;
        return ws.send(message);
      }
      if (!text.includes('"operations":[{')) return ws.send(message);
      if (state.armed && state.completed && !state.gapChecked) return; // dropped
      if (state.armed && /"entity":"turn".*"completed_at":"[^"]/.test(text)) state.completed = true;
      state.delivered = Math.max(state.delivered, revision);
      ws.send(message);
    });
  });
  return state;
}

test("a conversation gap found after a turn is recovered without a loading row", async ({
  testPage,
  apiClient,
  seedData,
}) => {
  test.setTimeout(120_000);
  const gap = await forceIdleConversationGap(testPage);
  const session = await seedIdleSession(testPage, apiClient, seedData, "Silent gap recovery");
  const loadingRowSeen = await watchLoadingRows(testPage);

  gap.armed = true;
  await session.sendMessage(USAGE_PROMPT);
  await session.waitForChatIdle({ timeout: 30_000, requireEditable: true });
  // The periodic revision check finds the gap within a few seconds of the turn.
  await expect.poll(() => gap.recovered, { timeout: 20_000 }).toBe(true);
  await expect(session.activeChat().getByText(USAGE_PROMPT, { exact: true })).toBeVisible();

  expect(await loadingRowSeen()).toBe(false);
});
