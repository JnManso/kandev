import type { Locator, Page } from "@playwright/test";
import { test, expect } from "../../fixtures/test-base";
import { SessionPage } from "../../pages/session-page";

/**
 * Guards consecutive model switches from the chat-input model selector.
 *
 * mock-agent re-advertises its whole config catalog on a model change (the
 * smart model publishes a different effort option set), which is what a real
 * ACP provider does. The regression this covers: after the first switch the
 * picker stopped accepting further selections — the trigger no longer opened
 * the list — until a prompt refreshed the session.
 */

/** Opens the picker from a known-closed state and selects a model. */
async function pickModel(page: Page, trigger: Locator, name: RegExp) {
  const listbox = page.getByRole("listbox");
  if (await listbox.isVisible()) {
    await page.keyboard.press("Escape");
    await expect(listbox).toBeHidden({ timeout: 5_000 });
  }
  await trigger.click();
  await expect(listbox).toBeVisible({ timeout: 10_000 });
  await listbox.getByRole("option", { name }).click();
}

test.describe("Chat model selector — consecutive switches", () => {
  test("applies a second and third model switch after the first", async ({
    testPage,
    apiClient,
    seedData,
  }) => {
    const task = await apiClient.createTaskWithAgent(
      seedData.workspaceId,
      "Consecutive Model Switch Test",
      seedData.agentProfileId,
      {
        description: "/e2e:simple-message",
        workflow_id: seedData.workflowId,
        workflow_step_id: seedData.startStepId,
        repository_ids: [seedData.repositoryId],
      },
    );
    if (!task.session_id) throw new Error("expected an auto-started session");

    await testPage.goto(`/t/${task.id}`);
    const session = new SessionPage(testPage);
    await session.waitForLoad();
    await session.waitForChatIdle({ timeout: 30_000 });

    const trigger = testPage.getByRole("button", { name: "Session model settings" });
    await expect(trigger).toContainText("Mock Fast", { timeout: 15_000 });

    await pickModel(testPage, trigger, /Mock Smart/);
    await expect(trigger).toContainText("Mock Smart", { timeout: 10_000 });

    await pickModel(testPage, trigger, /Mock Slow/);
    await expect(trigger).toContainText("Mock Slow", { timeout: 10_000 });

    // Back to the model the session started on.
    await pickModel(testPage, trigger, /Mock Fast/);
    await expect(trigger).toContainText("Mock Fast", { timeout: 10_000 });

    await expect
      .poll(
        async () => {
          const { sessions } = await apiClient.listTaskSessions(task.id);
          const metadata = sessions.find((item) => item.id === task.session_id)?.metadata;
          const overrides = metadata?.runtime_config_overrides as { model?: string } | undefined;
          return overrides?.model;
        },
        { timeout: 15_000 },
      )
      .toBe("mock-fast");
  });

  test("applies a switch made right after a page reload", async ({
    testPage,
    apiClient,
    seedData,
  }) => {
    const task = await apiClient.createTaskWithAgent(
      seedData.workspaceId,
      "Reloaded Model Switch Test",
      seedData.agentProfileId,
      {
        description: "/e2e:simple-message",
        workflow_id: seedData.workflowId,
        workflow_step_id: seedData.startStepId,
        repository_ids: [seedData.repositoryId],
      },
    );
    if (!task.session_id) throw new Error("expected an auto-started session");

    await testPage.goto(`/t/${task.id}`);
    const session = new SessionPage(testPage);
    await session.waitForLoad();
    await session.waitForChatIdle({ timeout: 30_000 });

    const trigger = testPage.getByRole("button", { name: "Session model settings" });
    await expect(trigger).toContainText("Mock Fast", { timeout: 15_000 });

    await pickModel(testPage, trigger, /Mock Smart/);
    await expect(trigger).toContainText("Mock Smart", { timeout: 10_000 });

    // A reload drops the client-side hydration bookkeeping while the persisted
    // session metadata still names the pre-switch model, so the next switch
    // must not be reverted by that stale copy.
    await testPage.reload();
    await session.waitForLoad();
    await expect(trigger).toContainText("Mock Smart", { timeout: 15_000 });

    await pickModel(testPage, trigger, /Mock Fast/);
    await expect(trigger).toContainText("Mock Fast", { timeout: 10_000 });
    await expect(trigger).not.toContainText("Mock Smart", { timeout: 10_000 });
  });
});
