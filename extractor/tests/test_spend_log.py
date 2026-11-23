from pmt.llm import Usage
from pmt.pipeline import rebuild, record_spend
from pmt.store import LocalStore


def test_spend_log_survives_without_documents(tmp_path):
    s = LocalStore(tmp_path)
    u = Usage(input_tokens=1000, output_tokens=200)
    record_spend(s, "a1", "ok.pdf", 2, "claude-opus-5-5", u, "done", at="2026-01-02T03:04:05+00:00")
    record_spend(s, "a1", "ok.pdf", 2, "claude-opus-5-5", u, "failed", at="2026-01-02T03:04:06+00:00")
    out = rebuild(s)  # no extractions at all: spend must still be reported
    assert [x["status"] for x in out["spend"]] == ["done", "failed"]
    assert out["spend"][0]["cost_usd"] == u.cost("claude-opus-5-5") > 0
