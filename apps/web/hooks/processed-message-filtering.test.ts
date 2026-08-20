import { describe, expect, it } from "vitest";
import { sessionId as toSessionId, taskId as toTaskId, type Message } from "@/lib/types/http";
import { hasSuccessfulAgentBootAfter } from "./processed-message-filtering";

const ERROR_AT = "2026-05-30T00:00:00Z";
const AFTER = "2026-05-30T00:01:00Z";
const BEFORE = "2026-05-29T23:59:00Z";

function bootMessage(createdAt: string, metadata: Record<string, unknown> = {}): Message {
  return {
    id: `boot-${createdAt}-${JSON.stringify(metadata)}`,
    session_id: toSessionId("s1"),
    task_id: toTaskId("t1"),
    author_type: "agent",
    content: "",
    type: "script_execution",
    created_at: createdAt,
    metadata: {
      script_type: "agent_boot",
      agent_name: "Mock",
      is_resuming: true,
      status: "exited",
      ...metadata,
    },
  } as Message;
}

describe("hasSuccessfulAgentBootAfter", () => {
  it("returns true when the agent was resumed after the failure", () => {
    expect(hasSuccessfulAgentBootAfter([bootMessage(AFTER)], ERROR_AT)).toBe(true);
  });

  it("returns true when a fresh start re-established the agent after the failure", () => {
    expect(
      hasSuccessfulAgentBootAfter([bootMessage(AFTER, { is_resuming: false })], ERROR_AT),
    ).toBe(true);
  });

  it("returns true when an explicit zero exit code reports success", () => {
    expect(hasSuccessfulAgentBootAfter([bootMessage(AFTER, { exit_code: 0 })], ERROR_AT)).toBe(
      true,
    );
  });

  it("returns false when the only successful boot predates the failure", () => {
    expect(hasSuccessfulAgentBootAfter([bootMessage(BEFORE)], ERROR_AT)).toBe(false);
  });

  it("returns false when the resume attempt failed", () => {
    expect(hasSuccessfulAgentBootAfter([bootMessage(AFTER, { status: "failed" })], ERROR_AT)).toBe(
      false,
    );
  });

  it("returns false when the boot exited non-zero", () => {
    expect(hasSuccessfulAgentBootAfter([bootMessage(AFTER, { exit_code: 1 })], ERROR_AT)).toBe(
      false,
    );
  });

  it("returns false while the resume is still running", () => {
    expect(hasSuccessfulAgentBootAfter([bootMessage(AFTER, { status: "running" })], ERROR_AT)).toBe(
      false,
    );
  });

  it("ignores non-boot scripts that finished after the failure", () => {
    const setup = bootMessage(AFTER, { script_type: "setup" });
    expect(hasSuccessfulAgentBootAfter([setup], ERROR_AT)).toBe(false);
  });

  it("ignores messages that are not script executions", () => {
    const chat = { ...bootMessage(AFTER), type: "message" } as Message;
    expect(hasSuccessfulAgentBootAfter([chat], ERROR_AT)).toBe(false);
  });

  it("returns false for unparseable or missing timestamps", () => {
    expect(hasSuccessfulAgentBootAfter([bootMessage("")], ERROR_AT)).toBe(false);
    expect(hasSuccessfulAgentBootAfter([bootMessage(AFTER)], "")).toBe(false);
    expect(hasSuccessfulAgentBootAfter(undefined, ERROR_AT)).toBe(false);
    expect(hasSuccessfulAgentBootAfter([], ERROR_AT)).toBe(false);
  });

  it("finds the boot even when it is not the newest message", () => {
    const later = { ...bootMessage("2026-05-30T00:02:00Z"), type: "message" } as Message;
    expect(hasSuccessfulAgentBootAfter([bootMessage(AFTER), later], ERROR_AT)).toBe(true);
  });
});
