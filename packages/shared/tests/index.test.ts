import { describe, expect, it } from "vitest";
import { messageId, resolveMessage } from "../src/index";

describe("messageId", () => {
  it("is deterministic", () => {
    expect(messageId("Hello", "greeting")).toBe(messageId("Hello", "greeting"));
  });

  it("differs by message", () => {
    expect(messageId("Hello")).not.toBe(messageId("Goodbye"));
  });

  it("differs by context", () => {
    expect(messageId("Open", "verb")).not.toBe(messageId("Open", "adjective"));
    expect(messageId("Open", "verb")).not.toBe(messageId("Open"));
  });

  it("treats undefined context as omitted", () => {
    expect(messageId("Hello", undefined)).toBe(messageId("Hello"));
  });

  it("only emits [0-9a-z]", () => {
    ["", "Hello {name}", "a.b_c", "😀 é", "x".repeat(1000)].forEach((m) => {
      expect(messageId(m, "ctx")).toMatch(/^[0-9a-z]+$/);
    });
  });

  it("never changes silently", () => {
    expect(messageId("Hello {name}")).toBe("14ip0v2n9um");
  });
});

describe("resolveMessage", () => {
  it("hashes plain strings", () => {
    expect(resolveMessage("x")).toEqual({ id: messageId("x"), message: "x", context: undefined });
  });

  it("prefers an explicit id", () => {
    expect(resolveMessage({ message: "x", id: "custom" })).toEqual({
      id: "custom",
      message: "x",
      context: undefined,
    });
  });

  it("includes context in the hash", () => {
    const resolved = resolveMessage({ message: "x", context: "c" });
    expect(resolved).toEqual({ id: messageId("x", "c"), message: "x", context: "c" });
    expect(resolved.id).not.toBe(resolveMessage("x").id);
  });
});
