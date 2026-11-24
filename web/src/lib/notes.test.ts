import { describe, expect, it } from "vitest";
import { cyclePhase, cycleText, noteApplies, noteSummary, type Note } from "./notes";

const note = (p: Partial<Note>): Note => ({ id: "n1", from: "2024-03-10", created_at: "", ...p });

describe("cyclePhase", () => {
  it("counts the first day of the period as day 1", () => {
    expect(cyclePhase("2024-03-01", "2024-03-01")).toEqual({ day: 1, phase: "menstrual" });
  });
  it("splits a 28-day cycle into the usual phases", () => {
    const at = (d: number) => cyclePhase("2024-03-01", `2024-03-${String(d).padStart(2, "0")}`)!.phase;
    expect([at(5), at(6), at(12), at(13), at(14), at(15), at(16), at(28)]).toEqual([
      "menstrual", "follicular", "follicular", "ovulation", "ovulation", "ovulation", "luteal", "luteal"]);
  });
  it("moves ovulation with a longer cycle (14 days before the next period)", () => {
    expect(cyclePhase("2024-03-01", "2024-03-15", 35)!.phase).toBe("follicular");
    expect(cyclePhase("2024-03-01", "2024-03-21", 35)!.phase).toBe("ovulation");
  });
  it("gives up before the period or well past the expected next one", () => {
    expect(cyclePhase("2024-03-10", "2024-03-01")).toBeNull();
    expect(cyclePhase("2024-03-01", "2024-04-10")).toBeNull();
  });
  it("crosses month ends", () => {
    expect(cyclePhase("2024-02-20", "2024-03-12")).toEqual({ day: 22, phase: "luteal" });
  });
});

describe("notes", () => {
  it("applies a dated note to results in its period, and a result note only to that result", () => {
    const period = note({ from: "2024-03-01", to: "2024-03-10" });
    expect(noteApplies(period, { id: "a", date: "2024-03-10" })).toBe(true);
    expect(noteApplies(period, { id: "a", date: "2024-03-11" })).toBe(false);
    const one = note({ result_id: "r1" });
    expect(noteApplies(one, { id: "r1", date: "1999-01-01" })).toBe(true);
    expect(noteApplies(one, { id: "r2", date: "2024-03-10" })).toBe(false);
  });
  it("summarises tags, text and cycle on one line", () => {
    const n = note({ tags: ["sick", "not_fasting"], text: " flu ", period_start: "2024-02-20" });
    expect(noteSummary(n, "2024-03-12")).toBe("Sick, Not fasting · flu · Luteal · day 22");
    expect(cycleText(note({ cycle_na: "contraception" }))).toBe("Hormonal contraception");
  });
});
